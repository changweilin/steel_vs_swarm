// ============ 賽璐璐後製管線(螢幕空間勾線 → 調色 → FXAA)============
// 2026-08-03。在此之前畫面上的描邊**只有反轉外殼**,而 `biomes.js` 一次都沒有呼叫
// `outlinify` ⇒ 機體有黑線、世界沒有,機體看起來像貼在照片上的貼紙。
// 用外殼把整個世界包起來不可行:那是幾百個額外 draw call,而本渲染器已經是 draw call 瓶頸。
// 螢幕空間勾線是**一個 pass 蓋全場**,成本與場景複雜度無關。
//
// ---- 勾線為什麼是深度的「二階差分」而不是一階 ----
// 一階差分(相鄰深度相減)在**掠射面**上恆為大值 —— 地面往遠處延伸時每個像素的深度都在
// 快速變化,結果整片地面刷滿線。二階差分量的是深度的**曲率**:平面(不論多斜)恆為 0,
// 只有真正的折邊才有值。這是「地面不該有線、屋角該有線」唯一分得開的判據。
// 凸邊(物體輪廓)給全強度、凹邊(牆角內側)乘 CONCAVE_F —— 手繪的內角線本來就比外輪廓輕。
//
// ---- 三個一定要有的細節 ----
//   ① 墨色 MUST 與底色相混而不是塗黑:純黑線疊在暗部上會糊成一塊。
//   ② 遠處淡出:遠景的線密到一定程度就變成雜訊(而且會蓋掉霧)。
//   ③ 天空早退:天空的深度是 far,不early-out 的話整條天際線會被畫成一條粗黑邊。
//
// ---- A25 GPU 生命週期 ----
// 這支持有 3 個 RenderTarget + 1 張 depthTexture + 3 個 FullScreenQuad 材質,
// **全部** MUST 在 `dispose()` 釋放。`audit_gpu_lifecycle.mjs` ⑦ 逐項釘住。
//
// ---- RES_GOV 交互(最容易靜默壞掉的一條)----
// RT 尺寸 MUST 由 `renderer.getDrawingBufferSize()` 取得 —— 那已經是
// `_dpr() × _resScale` 的結果。管線自己算像素比 = 調節器降階時 RT 尺寸不動 =
// **調節器整個變成 no-op**,而畫面上只表現成「手機還是一樣卡」,不會有任何錯誤。
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ---- 勾線參數 ----
const INK = {
  THICK: 1.0,        // 取樣半徑(像素);> 1 會讓細線斷開
  EDGE: 0.9,         // 二階差分門檻(以「該像素深度的比例」量,故遠近一致)
  CONCAVE_F: 0.42,   // 凹邊強度倍率(手繪內角線比外輪廓輕)
  DARK: 0.14,        // 墨色(與底色相混的目標值,不是純黑)
  FADE0: 0.55,       // 開始淡出的深度(相機 far 的比例)
  FADE1: 0.95,       // 完全不畫線
};
// ---- 調色(split-tone + 陰影抬升)----
// 賽璐璐的陰影 MUST 是**有顏色的**,不是壓黑的。`uLift` 把最暗的部分抬離 0,
// split-tone 讓暗部偏冷、亮部偏暖 —— 這與 toon.js 的 `CEL_COOL` 是同一個需求的兩個尺度
// (那個逐材質、這個逐畫面),兩者相加才是完整的「陰影是天光反射」。
const GRADE = {
  LIFT: 0.045,
  SHADOW: [0.86, 0.94, 1.10],
  HIGH: [1.05, 1.01, 0.94],
  SAT: 1.06,
};

const QUAD_VS = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/** 線性 → sRGB(RT 是 NoColorSpace,最後一 pass 自己轉;three 只對預設 framebuffer 轉) */
const SRGB_GLSL = `
  vec3 toSRGB( vec3 c ) {
    c = clamp( c, 0.0, 1.0 );
    return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) );
  }`;

export class Pipeline {
  /**
   * @param renderer three 的 WebGLRenderer(像素比由呼叫端管,見檔頭 RES_GOV 註解)
   * @param opts { ink, grade, fxaa, lowPower } —— 全部可關;lowPower 走 8bit RT
   */
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = { ink: opts.ink !== false, grade: opts.grade !== false, fxaa: opts.fxaa !== false };
    // 半浮點 RT 在 tile GPU 上是**頻寬**成本(與 game.js 關 MSAA 同一個瓶頸)⇒ 低功耗走 8bit。
    // 8bit 線性緩衝在暗部會有輕微色帶,但那遠比掉幀好。
    const type = opts.lowPower ? THREE.UnsignedByteType : THREE.HalfFloatType;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const mk = (depth) => {
      const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
        type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: true, stencilBuffer: false,
      });
      if (depth) {
        rt.depthTexture = new THREE.DepthTexture(Math.max(1, size.x), Math.max(1, size.y));
        rt.depthTexture.type = THREE.UnsignedIntType;
      }
      return rt;
    };
    this.rtScene = mk(true);
    this.rtA = mk(false);
    this.rtB = mk(false);
    this._size = size.clone();

    this.inkQuad = new FullScreenQuad(this._inkMaterial());
    this.gradeQuad = new FullScreenQuad(this._gradeMaterial());
    this.fxaaQuad = new FullScreenQuad(this._fxaaMaterial());
  }

  _inkMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 }, uFar: { value: 1000 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar;
        varying vec2 vUv;
        float lin( vec2 uv ) {                     // 非線性深度 → 視線距離(公尺)
          float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
          return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
        }
        void main() {
          vec4 base = texture2D( tColor, vUv );
          float d = lin( vUv );
          // ③ 天空早退:天空的深度就是 far,不擋掉會沿整條天際線畫出一條粗黑邊
          if ( d >= uFar * 0.995 ) { gl_FragColor = base; return; }
          vec2 t = uTexel * ${INK.THICK.toFixed(2)};
          float l = lin( vUv - vec2( t.x, 0.0 ) ), r = lin( vUv + vec2( t.x, 0.0 ) );
          float u = lin( vUv + vec2( 0.0, t.y ) ), b = lin( vUv - vec2( 0.0, t.y ) );
          // 二階差分(拉普拉斯):平面恆 0 —— 掠射的地面不會刷滿線(見檔頭)
          float lap = ( l + r + u + b ) - 4.0 * d;
          // 以「該像素深度的比例」量門檻 ⇒ 同一條折邊在遠近都畫得出來
          float e = lap / max( d, 0.001 );
          // 凸邊(lap < 0,物體在前)全強度;凹邊(lap > 0)壓低
          float ink = max( 0.0, -e ) + max( 0.0, e ) * ${INK.CONCAVE_F.toFixed(2)};
          ink = smoothstep( ${INK.EDGE.toFixed(3)} * 0.01, ${INK.EDGE.toFixed(3)} * 0.03, ink );
          // ② 遠處淡出:遠景線密到變雜訊,而且會蓋掉霧
          ink *= 1.0 - smoothstep( uFar * ${INK.FADE0.toFixed(2)}, uFar * ${INK.FADE1.toFixed(2)}, d );
          // ① 墨色與底色相混,不是塗黑
          gl_FragColor = vec4( mix( base.rgb, base.rgb * ${INK.DARK.toFixed(2)}, ink ), base.a );
        }`,
    });
  }

  _gradeMaterial() {
    const g = GRADE;
    return new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D( tColor, vUv ).rgb;
          float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
          // split-tone:暗部偏冷、亮部偏暖(賽璐璐的陰影是有顏色的,不是壓黑的)
          vec3 sh = vec3( ${g.SHADOW.map((v) => v.toFixed(3)).join(', ')} );
          vec3 hi = vec3( ${g.HIGH.map((v) => v.toFixed(3)).join(', ')} );
          c *= mix( sh, hi, smoothstep( 0.18, 0.72, l ) );
          c = mix( vec3( l ), c, ${g.SAT.toFixed(3)} );      // 微幅提彩度
          c = c * ( 1.0 - ${g.LIFT.toFixed(3)} ) + ${g.LIFT.toFixed(3)};   // 陰影抬升:最暗不落到 0
          gl_FragColor = vec4( c, 1.0 );
        }`,
    });
  }

  /**
   * FXAA。**MSAA 對 pass 畫出來的線一點用都沒有**(那些線不是幾何邊),所以勾線上線之後
   * 抗鋸齒的責任整個落在這裡;也因此觸控裝置第一次有了抗鋸齒(舊制 `antialias: !isTouchUI()`)。
   * 這一 pass 同時負責**線性 → sRGB**(RT 是 NoColorSpace,見 SRGB_GLSL)。
   */
  _fxaaMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uAA: { value: 1 } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform vec2 uTexel; uniform float uAA;
        varying vec2 vUv;
        ${SRGB_GLSL}
        float lum( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }
        void main() {
          vec3 m  = texture2D( tColor, vUv ).rgb;
          if ( uAA < 0.5 ) { gl_FragColor = vec4( toSRGB( m ), 1.0 ); return; }
          vec3 nw = texture2D( tColor, vUv + vec2( -uTexel.x, -uTexel.y ) ).rgb;
          vec3 ne = texture2D( tColor, vUv + vec2(  uTexel.x, -uTexel.y ) ).rgb;
          vec3 sw = texture2D( tColor, vUv + vec2( -uTexel.x,  uTexel.y ) ).rgb;
          vec3 se = texture2D( tColor, vUv + vec2(  uTexel.x,  uTexel.y ) ).rgb;
          float lm = lum( m ), lnw = lum( nw ), lne = lum( ne ), lsw = lum( sw ), lse = lum( se );
          float lo = min( lm, min( min( lnw, lne ), min( lsw, lse ) ) );
          float hi = max( lm, max( max( lnw, lne ), max( lsw, lse ) ) );
          if ( hi - lo < max( 0.03, hi * 0.125 ) ) { gl_FragColor = vec4( toSRGB( m ), 1.0 ); return; }
          vec2 dir = normalize( vec2( -( ( lnw + lne ) - ( lsw + lse ) ), ( lnw + lsw ) - ( lne + lse ) ) + 1e-6 );
          dir = clamp( dir, -8.0, 8.0 ) * uTexel;
          vec3 a = 0.5 * ( texture2D( tColor, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb
                         + texture2D( tColor, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
          vec3 b = a * 0.5 + 0.25 * ( texture2D( tColor, vUv - dir * 0.5 ).rgb
                                    + texture2D( tColor, vUv + dir * 0.5 ).rgb );
          float lb = lum( b );
          gl_FragColor = vec4( toSRGB( ( lb < lo || lb > hi ) ? a : b ), 1.0 );
        }`,
    });
  }

  /** 畫布尺寸或 `_resScale` 改變時呼叫;尺寸一律由 drawing buffer 取得(見檔頭) */
  setSize() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (s.x === this._size.x && s.y === this._size.y) return;
    this._size.copy(s);
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.setSize(Math.max(1, s.x), Math.max(1, s.y));
  }

  /** 取代 `renderer.render(scene, camera)`;結束時 render target 一律歸零(PiP 隨後直接畫在畫布上) */
  render() {
    const r = this.renderer;
    this.setSize();
    const texel = new THREE.Vector2(1 / this._size.x, 1 / this._size.y);
    const chain = [];
    if (this.enabled.ink) chain.push('ink');
    if (this.enabled.grade) chain.push('grade');
    // 最後一 pass **一定要跑**:它同時負責線性 → sRGB。`?fxaa=0` 只是把邊緣混合關掉
    // (`uAA = 0`),MUST NOT 整個 pass 跳過 —— 跳過的話畫面會整片變暗變濁(少了色彩空間轉換),
    // 而那看起來像「調色把畫面弄壞了」,查半天查不到。
    chain.push('fxaa');
    this.fxaaQuad.material.uniforms.uAA.value = this.enabled.fxaa ? 1 : 0;

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);

    let src = this.rtScene;
    for (let i = 0; i < chain.length; i++) {
      const last = i === chain.length - 1;
      const dst = last ? null : (src === this.rtA ? this.rtB : this.rtA);
      const quad = chain[i] === 'ink' ? this.inkQuad : chain[i] === 'grade' ? this.gradeQuad : this.fxaaQuad;
      const u = quad.material.uniforms;
      u.tColor.value = src.texture;
      if (u.uTexel) u.uTexel.value.copy(texel);
      if (u.tDepth) {
        u.tDepth.value = this.rtScene.depthTexture;
        u.uNear.value = this.camera.near;
        u.uFar.value = this.camera.far;
      }
      r.setRenderTarget(dst);
      quad.render(r);
      src = dst || src;
    }
    r.setRenderTarget(null);
  }

  /** A25:3 個 RT + depthTexture + 3 個全螢幕材質,一個都不能漏 */
  dispose() {
    for (const rt of [this.rtScene, this.rtA, this.rtB]) {
      rt.depthTexture?.dispose();
      rt.dispose();
    }
    for (const q of [this.inkQuad, this.gradeQuad, this.fxaaQuad]) {
      q.material.dispose();
      q.dispose();
    }
  }
}
