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
// ---- 軟性物質的細線(2026-08-04;契約寫在 `toon.js` 的「軟性物質」段)----
// 使用者定案「雲朵/芒草/草原/花園/樹葉/旗幟這些軟性的物質的線條會細得多,其他堅硬的
// 物體則依據設定的數值」。本 pass 是**螢幕空間**的,天生不認識「這個像素是什麼東西」⇒
// 逐像素的通道只有一條:**場景 RT 的 alpha ≡ 這一格的勾線門檻倍率**(1 = 硬性 = 舊制)。
// 材質端怎麼寫進去、為什麼那個通道是空的,全部住 toon.js;本檔只負責讀它、乘進門檻。
// 「細」= 抬高門檻而不是縮小取樣半徑:半徑已經是 1 像素(`INK.THICK`,再小就斷線),
// 而 `|e|` 從邊緣往外遞減 ⇒ 門檻抬高,越過門檻的像素帶真的變窄(不是只變淡)。
//
// ---- 景深模糊(2026-08-09;距離與不變式住 `data.js DOF`)----
// 使用者定案「加入遠的物件隨距離景深模糊的效果」。四件事先講清楚,因為每一件寫反了都不報錯:
//   ① **這一 pass 是加成本的**。它不省效能(同日已向使用者說明);採用理由是畫面。
//      代價收在兩處:拉桿 0% 時**整個 pass 退出鏈**(不是跑一個乘 0 的 pass),
//      以及焦內像素在第一行就早退(只留 1 次深度 + 1 次顏色取樣)。
//   ② **順序 MUST 排在勾線之後**。勾線讀的是**深度**、畫的是線;先糊後勾 = 深度仍然銳利
//      ⇒ 在已經糊掉的色塊上畫出銳利的黑線(「糊掉的物件卻有清楚的輪廓」)。反過來排,
//      線本身跟著一起糊,遠景才真的退到背景去。
//   ③ **鄰居取樣 MUST 過焦外閘**(`step(coc*0.5, ct)`):不擋的話近處清晰物件的顏色會被抹進
//      遠景 = 前景剪影外一圈光暈,而剪影正是玩家在看的東西(FPV 的座艙/武器占畫面很大一塊)。
//   ④ 取樣點是**黃金角螺旋**(填滿圓盤)不是單一圓環:圓環在低取樣數下會糊成甜甜圈邊。
//
// ---- A25 GPU 生命週期 ----
// 這支持有 3 個 RenderTarget + 1 張 depthTexture + 4 個 FullScreenQuad 材質,
// **全部** MUST 在 `dispose()` 釋放。`audit_gpu_lifecycle.mjs` ⑦ 逐項釘住。
//
// ---- RES_GOV 交互(最容易靜默壞掉的一條)----
// RT 尺寸 MUST 由 `renderer.getDrawingBufferSize()` 取得 —— 那已經是
// `_dpr() × _resScale` 的結果。管線自己算像素比 = 調節器降階時 RT 尺寸不動 =
// **調節器整個變成 no-op**,而畫面上只表現成「手機還是一樣卡」,不會有任何錯誤。
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { visualPref, onVisualChange } from './visualPrefs.js';
import { DOF } from './data.js';

// ---- 勾線參數 ----
const INK = {
  THICK: 1.0,        // 取樣半徑(像素);> 1 會讓細線斷開
  // 門檻的兩項係數與起畫/全強度全部是 **2026-08-03 用 `tools/shot_scene.mjs` 逐輪實測**出來的
  // (定場照 + 除錯輸出把 e 直接畫成紅色通道),不是猜的;調校紀錄見下方 shader 內註解。
  K_D: 0.020,        // 門檻的「距離項」係數(× 該像素深度)—— 遠近一致的那一半
  K_S: 3.0,          // 門檻的「掠射項」係數(× 一階差分)—— 壓掉高度場的網格折邊
  EDGE0: 0.14,       // 起畫(實測:地形網格折邊 e ≈ 0.1、建物輪廓 e ≈ 0.4~1.2)
  EDGE1: 0.36,       // 全強度
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
  LIFT: 0.0055,
  SHADOW: [0.86, 0.94, 1.10],
  HIGH: [1.05, 1.01, 0.94],
  SAT: 1.06,
};

const QUAD_VS = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/**
 * 圓盤取樣點(黃金角螺旋 = 向日葵排列):`a = i × 137.5°`、`r = √((i+0.5)/n)`。
 * √ 是**面積均勻**的來源(不開根號會全部擠在圓心);單一圓環則在低取樣數下糊成甜甜圈邊。
 * 展開成一串具名運算式而不是 GLSL 迴圈 + const 陣列:WebGL1 的 GLSL ES 1.00 沒有陣列
 * 建構式,而這一層本來就該完全展開。
 */
const dofTaps = (n) => Array.from({ length: n }, (_, i) => {
  const a = i * 2.39996323, r = Math.sqrt((i + 0.5) / n);
  return `TAP( ${(Math.cos(a) * r).toFixed(4)}, ${(Math.sin(a) * r).toFixed(4)} )`;
}).join('\n          ');

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
    this.enabled = {
      ink: opts.ink !== false, dof: opts.dof !== false,
      grade: opts.grade !== false, fxaa: opts.fxaa !== false,
    };
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
    // 取樣數折半走與 8bit RT 同一條降級規則(tile GPU 的瓶頸是頻寬,而這一 pass 對焦外
    // 的每個像素都是 1 + n 次取樣)。展開在 shader 原始碼裡 ⇒ 兩者是不同的程式,不是分支。
    this.dofQuad = new FullScreenQuad(this._dofMaterial(opts.lowPower ? Math.max(2, DOF.TAPS >> 1) : DOF.TAPS));
    this.gradeQuad = new FullScreenQuad(this._gradeMaterial());
    this.fxaaQuad = new FullScreenQuad(this._fxaaMaterial());
    this._quads = { ink: this.inkQuad, dof: this.dofQuad, grade: this.gradeQuad, fxaa: this.fxaaQuad };
    // 景深的兩個轉折點由呼叫端餵(`setDof`)。**沒餵過就不掛這一 pass** —— 猜一個距離的話
    // 就是「某個消費端的遠景莫名其妙糊掉」,而預設不生效才是寧缺勿錯(原則 6)。
    this._dofRange = null;
    // 進鏡程度(0~1)。**預設 1 = 不做狙擊閘**:那是戰場才有的概念,設定頁樣品與定場鏡頭組
    // 沒有「瞄準」這回事,預設 0 的話它們會靜靜地什麼都不糊 = 拉桿與定場照都看不到這一層。
    this._dofBlend = 1;

    // 勾線強度拉桿(visualPrefs.js):線的濃淡是**口味**,不同螢幕看起來差很多 ——
    // 給一個 uniform 讓玩家自己定案,而不是把某一台螢幕上調出來的數字寫死給所有人。
    // 拉到 0 = 沒有線(等同 `?ink=0`,但不必重開);預設 1 = 定場照調校出來的現值。
    // MUST 是 uniform 不是重建材質:重建會在拉桿拖動時每一格丟一次 shader 編譯。
    this._syncPrefs = () => {
      this.inkQuad.material.uniforms.uInk.value = visualPref('ink');
      // 景深強度同理走 uniform;但**拉到 0 時整個 pass 退出鏈**(見 render 組 chain 那一段)
      // —— 這一 pass 與勾線不同,它是後加的成本,0% MUST 是「不跑」而不是「跑一個乘 0 的」。
      this._dofA = DOF.MAX_R * visualPref('dof');
      this._pushDofA();
    };
    this._syncPrefs();
    this._offPrefs = onVisualChange(this._syncPrefs);
  }

  /**
   * 景深的兩個轉折點(公尺;`near` = 開始糊、`far` = 全糊)。**唯一寫入點** ——
   * 戰場與定場鏡頭組餵 `data.js dofNearM()/dofFarM()`(由全場最遠交戰距離推導,456 / 608m)、
   * 設定頁樣品餵它自己那個 24m 場景的尺度 —— **兩軌同 `toon.js _rampTint` 的 mech/env:
   * 同一套規則、兩組尺度**。沒有這一支的話樣品那 24m 全部落在 456m 的焦內帶裡 = 拉桿拉了
   * 看不出差異,而那正是陰影偏色與風化密度各踩過一次的同一個坑。
   */
  setDof(near, far) {
    if (!(near >= 0) || !(far > near)) { this._dofRange = null; return; }
    this._dofRange = [near, far];
    const u = this.dofQuad.material.uniforms;
    u.uDofNear.value = near;
    u.uDofFar.value = far;
  }

  /**
   * 進鏡程度 0~1(2026-08-09 使用者補充「遠景景深模糊只有在狙擊模式」)。**逐幀呼叫** ——
   * 值由 `data.js dofAimBlend` 自當下 fov 反解,本檔 MUST NOT 自己判 `aiming` 或自己跑淡入
   * (那就是第二條時間曲線,模糊會比鏡頭慢半拍)。0 ⇒ 整個 pass 退出鏈 ⇒ 一般視角的成本
   * 逐位元回到這批改動之前,而這也是這一層真正便宜的地方:它只在進鏡那幾秒跑。
   */
  setDofBlend(f) {
    const v = Math.max(0, Math.min(1, f || 0));
    if (v === this._dofBlend) return;      // 逐幀呼叫 ⇒ 沒變就不要碰 uniform
    this._dofBlend = v;
    this._pushDofA();
  }

  /** `uDofA` 的**唯一寫入點**:拉桿強度 × 進鏡程度。兩個來源各寫一次 = 後寫的把前一個蓋掉 */
  _pushDofA() {
    this.dofQuad.material.uniforms.uDofA.value = this._dofA * this._dofBlend;
  }

  _inkMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 }, uFar: { value: 1000 }, uInk: { value: 1 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uInk;
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
          // 門檻 = **距離項 + 掠射項**,兩項缺一不可(2026-08-03 定場照四輪實測):
          //   ・只有距離項(lap/d):地形是高度場、由 193² 個平三角面拼成,每一條網格折邊
          //     都是**真的**折邊 ⇒ 整片山坡畫滿等高線一樣的細線;把門檻拉高到山坡乾淨時,
          //     300m 外的建物輪廓(深度跳變只有 20m)也一起不見了 —— 兩者在 lap/d 上重疊。
          //   ・只有掠射項(lap 除以一階差分,相對曲率):重疊在 0.3~0.7,同樣是「山坡乾淨了、
          //     建物的線也沒了」(第二版實測,整個世界回到沒有描邊)。
          //   ・兩項相加才分得開:掠射的地面**一階差分極大**(每像素跑好幾公尺)⇒ 門檻自動抬高;
          //     建物輪廓的一階差分只有那一格跳變 ⇒ 門檻仍低,線畫得出來。
          float slope = abs( l - r ) + abs( u - b );
          float e = lap / max( 0.001, d * ${INK.K_D.toFixed(3)} + slope * ${INK.K_S.toFixed(1)} );
          // 門檻 MUST 吃 **|e| 本身**,凸/凹的強度差要**乘在 smoothstep 之後**。
          // 反過來寫(先乘 CONCAVE_F 再進 smoothstep)= 把凹邊的門檻整個往上推 1/0.42 倍 ——
          // 而建物輪廓在這個 stencil 下大多算凹邊(近景像素旁邊是更遠的背景)⇒ 整批被吃掉:
          // 2026-08-03 定場照的除錯輸出裡,建物邊的 e 明明有 2 以上,ink 卻是 0。
          float ae = abs( e );
          // 早退:軟性倍率 ∈ (0,1] ⇒ ae × soft ≤ ae,硬性門檻都跨不過的一定也跨不過。
          // 絕大多數像素在這裡離開(邊緣偵測本來就只有少數像素有值)⇒ 下面那四個 alpha
          // 取樣只發生在「真的要畫線」的像素上,平均成本接近零。
          if ( ae <= ${INK.EDGE0.toFixed(3)} ) { gl_FragColor = base; return; }
          // 軟性倍率取**這一格與四鄰的最小值**:一條輪廓線同時落在物件側與背景側的像素上,
          // 只看中心的話背景側那半條仍是硬性粗細 ⇒ 葉叢邊緣會一半粗一半細。
          // 四鄰用的是與深度取樣**同一組偏移**(同一條線的兩側必定在其中)。
          float soft = min( min( base.a, texture2D( tColor, vUv - vec2( t.x, 0.0 ) ).a ),
                       min( min( texture2D( tColor, vUv + vec2( t.x, 0.0 ) ).a,
                                 texture2D( tColor, vUv + vec2( 0.0, t.y ) ).a ),
                                 texture2D( tColor, vUv - vec2( 0.0, t.y ) ).a ) );
          soft = clamp( soft, 0.0, 1.0 );   // 硬性恆 1 ⇒ 這一行以下逐位元同舊制
          float ink = smoothstep( ${INK.EDGE0.toFixed(3)}, ${INK.EDGE1.toFixed(3)}, ae * soft );
          if ( e > 0.0 ) ink *= ${INK.CONCAVE_F.toFixed(2)};   // 凹邊(牆角內側)比外輪廓輕
          // ② 遠處淡出:遠景線密到變雜訊,而且會蓋掉霧
          ink *= 1.0 - smoothstep( uFar * ${INK.FADE0.toFixed(2)}, uFar * ${INK.FADE1.toFixed(2)}, d );
          // 強度拉桿:夾在 [0,1] —— 拉桿最大到 150% 是為了讓「線更濃」有得調,
          // 但覆蓋率本身是機率意義的權重,超過 1 只會把半透明的線推成實線,不會更黑。
          ink = clamp( ink * uInk, 0.0, 1.0 );
          // ① 墨色與底色相混,不是塗黑
          gl_FragColor = vec4( mix( base.rgb, base.rgb * ${INK.DARK.toFixed(2)}, ink ), base.a );
        }`,
    });
  }

  /**
   * 景深模糊(檔頭「景深模糊」那一段)。距離一律吃 `uDofNear`/`uDofFar`(公尺,由 `setDof`
   * 餵入)—— 本檔 MUST NOT 手寫任何公尺數:那兩個轉折點是 `data.js dofNearM/dofFarM` 由
   * 狙擊模式可視範圍推導的,寫死在著色器裡就與「這台機體看得多遠」分家了。
   * @param taps 圓盤取樣數(低功耗折半)
   */
  _dofMaterial(taps) {
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 }, uFar: { value: 1000 },
        uDofNear: { value: 1e9 }, uDofFar: { value: 2e9 }, uDofA: { value: 0 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar;
        uniform float uDofNear; uniform float uDofFar; uniform float uDofA;
        varying vec2 vUv;
        float lin( vec2 uv ) {                     // 非線性深度 → 視線距離(公尺),與勾線同式
          float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
          return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
        }
        void main() {
          vec4 base = texture2D( tColor, vUv );
          // 焦外程度 0~1。天空的深度就是 far ⇒ coc 恆為 1,**刻意不早退**:天空本來就在全糊帶
          // 裡,而它是平滑漸層 ⇒ 糊它看不出差別也幾乎沒有成本,特判反而會在天際線切出一條
          // 「糊的地面 / 清晰的天空」的硬邊(勾線那邊要早退是因為它畫的是**線**,不是同一件事)。
          float coc = smoothstep( uDofNear, uDofFar, lin( vUv ) );
          float rp = coc * uDofA / uTexel.y;       // 半徑(像素)= 焦外程度 × 螢幕高度比例
          // 焦內早退:半徑不到半個像素就沒有任何取樣意義。絕大多數交戰畫面落在這裡 ⇒
          // 這一 pass 的平均成本 = 一次深度 + 一次顏色取樣。
          if ( rp < 0.5 ) { gl_FragColor = base; return; }
          vec3 sum = base.rgb; float wsum = 1.0;
          // 焦外閘:只收「自己也在糊帶裡」的鄰居。不擋的話近處清晰物件會被抹進遠景 =
          // 前景剪影外一圈光暈(見檔頭 ③)。門檻取中心的一半 = 容許糊帶內的漸層互相混合。
          #define TAP(dx,dy) { vec2 o = vec2( dx, dy ) * rp * uTexel; \
            float w = step( coc * 0.5, smoothstep( uDofNear, uDofFar, lin( vUv + o ) ) ); \
            sum += texture2D( tColor, vUv + o ).rgb * w; wsum += w; }
          ${dofTaps(taps)}
          #undef TAP
          gl_FragColor = vec4( sum / wsum, base.a );
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
          // 陰影抬升:最暗不落到 0。**數值是線性空間的**,而畫面是 sRGB ——
          // 線性 0.045 經 sRGB 轉換會變成 0.23(整片暗部一口氣被洗成灰),2026-08-03 定場照實測。
          // 現值 0.0055 ≈ sRGB 0.06,才是「抬離全黑」而不是「把陰影拿掉」。
          c = c * ( 1.0 - ${g.LIFT.toFixed(4)} ) + ${g.LIFT.toFixed(4)};
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
    // 景深 MUST 排在勾線**之後**(檔頭 ②:先糊後勾 = 糊掉的色塊配上銳利的黑線)。
    // 四個關法任一成立就整個 pass 退出鏈,而不是跑一個沒有作用的 pass:`?dof=0` /
    // 呼叫端沒餵距離 / 拉桿 0% / **不在狙擊模式**(`_dofBlend = 0`,逐幀由呼叫端餵)。
    // 退出時輸出**逐位元**同這一批改動之前 —— 一般視角因此完全不付這一 pass 的錢。
    if (this.enabled.dof && this._dofRange && this._dofA * this._dofBlend > 0) chain.push('dof');
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
      const quad = this._quads[chain[i]];
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

  /** A25:3 個 RT + depthTexture + 4 個全螢幕材質,一個都不能漏(拉桿訂閱也要退掉) */
  dispose() {
    this._offPrefs?.();   // 不解訂閱 = 已 dispose 的材質被拉桿的 closure 抓著不放
    this._offPrefs = null;
    for (const rt of [this.rtScene, this.rtA, this.rtB]) {
      rt.depthTexture?.dispose();
      rt.dispose();
    }
    for (const q of [this.inkQuad, this.dofQuad, this.gradeQuad, this.fxaaQuad]) {
      q.material.dispose();
      q.dispose();
    }
  }
}
