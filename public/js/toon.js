// ============ 3D 賽璐璐(celluloid)渲染核心 ============
// 依 doc/drone_vs_robot_fps_dota_plan.html Task 3.1 的方法:
//   1. MeshToonMaterial + 3 階高對比色階 ramp(硬邊明暗交界,漫畫式打光)
//   2. 反轉外殼(Inverted Hull)黑色描邊:BackSide 外殼沿法線外推,
//      螢幕上呈現 2~3px 的漫畫勾線;支援 SkinnedMesh(外殼共用同一副骨骼)
//   3. 硬邊金屬高光(sharp specular band)+ 邊緣光(rim):
//      onBeforeCompile 注入,非模糊的白色反光帶 → 機甲/槍械像動漫插畫的金屬
// 全專案共用:hazards.js re-export 舊入口(toonMat/toonify/toonGradient)保持相容。
import * as THREE from 'three';

// ---- 3 階 cel ramp(暗部 / 中間調 / 亮部;NearestFilter = 硬邊界)----
let _grad = null;
export function toonGradient() {
  if (_grad) return _grad;
  const data = new Uint8Array([102, 182, 255]);  // 3 階:高對比漫畫式明暗(暗部保底,深色機體不至於全黑)
  _grad = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  _grad.minFilter = THREE.NearestFilter;
  _grad.magFilter = THREE.NearestFilter;
  _grad.needsUpdate = true;
  return _grad;
}

// ---- 共用光向 uniform(view space;每幀由 updateCelLight 更新)----
// 所有 cel 材質共享同一個 Vector3 實例,主迴圈更新一次即全場生效。
const _celLightDirView = new THREE.Vector3(0.4, 0.8, 0.4);
let _sunDirWorld = new THREE.Vector3(0.4, 0.8, 0.4);

/** environment.js 建立太陽光後呼叫:記錄世界空間光向 */
export function setCelSun(pos) {
  _sunDirWorld = pos.clone().normalize();
}

/** 每幀呼叫(render 前):把太陽光向轉到 view space 餵給硬邊高光 */
export function updateCelLight(camera) {
  _celLightDirView.copy(_sunDirWorld).transformDirection(camera.matrixWorldInverse);
}

/**
 * 注入賽璐璐補丁:邊緣光(rim)+ 金屬硬邊高光帶(CEL_METAL 定義時)。
 * 沿用 MeshToonMaterial 既有光照結果,只疊加漫畫式高光。
 * BotW 環境擴充(doc/botw_plan.html;僅靜態環境物件開啟,機體/英雄不受影響):
 *   wash — 低頻世界空間水彩暈染,打破大面積單色的貼圖重複感(Task 2.1)
 *   moss — 世界 Y 軸朝上投影的手繪苔蘚(Task 2.2 / cliff-rocks 參考圖)
 *   cool — 陰影面偏冷藍 tint(Task 3.1;只偏色相、亮度≈0.93,不違反 #INC-106)
 */
function applyCelPatch(mat, { metal = false, rim = 0.22, wash = 0, moss = null, cool = 0 } = {}) {
  const defines = { ...(mat.defines || {}) };
  if (metal) defines.CEL_METAL = '';
  if (wash > 0) defines.CEL_WASH = '';
  if (moss) defines.CEL_MOSS = '';
  if (cool > 0) defines.CEL_COOL = '';
  if (wash > 0 || moss) defines.CEL_WP = '';   // 需要世界座標 varying
  mat.defines = defines;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCelLightDir = { value: _celLightDirView };
    shader.uniforms.uCelRim = { value: rim };
    shader.uniforms.uCelWash = { value: wash };
    shader.uniforms.uCelCool = { value: cool };
    shader.uniforms.uCelMossC = { value: new THREE.Color(moss?.color ?? 0x6d8f4a) };
    shader.uniforms.uCelMossAmt = { value: moss?.amount ?? 0.85 };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `
        #ifdef CEL_WP
        varying vec3 vCelWP;
        #endif
        void main() {`)
      .replace('#include <project_vertex>', `
        #include <project_vertex>
        #ifdef CEL_WP
        {
          // World-space position varying (instancing-aware) for wash / moss projection.
          vec4 celWP = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            celWP = instanceMatrix * celWP;
          #endif
          vCelWP = ( modelMatrix * celWP ).xyz;
        }
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', `
        #include <normal_fragment_begin>
        #if defined( CEL_WASH ) || defined( CEL_MOSS )
        {
          #ifdef CEL_WASH
          {
            // Low-frequency watercolor wash: shift tint across world XZ to break
            // up flat color blocks / tiling (painterly, no photoreal noise).
            float celN = celNoise( vCelWP.xz * 0.011 );
            vec3 celTint = mix( vec3( 0.93, 0.965, 1.06 ), vec3( 1.07, 1.025, 0.94 ), celN );
            diffuseColor.rgb *= mix( vec3( 1.0 ), celTint, uCelWash );
          }
          #endif
          #ifdef CEL_MOSS
          {
            // Top-down world-Y moss projection: upward-facing surfaces receive a
            // painterly moss coat; a second noise breaks the edge into patches.
            vec3 celWN = inverseTransformDirection( normal, viewMatrix );
            float mossW = smoothstep( 0.45, 0.8, celWN.y ) * uCelMossAmt;
            mossW *= smoothstep( 0.28, 0.72, celNoise( vCelWP.xz * 0.3 + vCelWP.yy * 0.17 ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, uCelMossC, mossW );
          }
          #endif
        }
        #endif`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 celV = normalize( vViewPosition );
          // 邊緣光:背光輪廓亮一圈(硬邊 smoothstep,不是柔霧)
          float celRim = 1.0 - saturate( dot( normal, celV ) );
          outgoingLight += diffuse.rgb * uCelRim * smoothstep( 0.62, 0.78, celRim );
          #ifdef CEL_METAL
            // 漫畫金屬:非模糊白色反光帶(step 硬切,Gundam / Borderlands 手感)
            vec3 celH = normalize( uCelLightDir + celV );
            float celS = pow( saturate( dot( normal, celH ) ), 42.0 );
            outgoingLight += vec3( 0.9 ) * step( 0.5, celS );
          #endif
          #ifdef CEL_COOL
            // Cool-tinted shadow side: hue shift toward blue-teal, near-constant
            // luminance, so shaded regions read as bounced sky light, not grey.
            float celShade = smoothstep( 0.05, 0.45, dot( normal, uCelLightDir ) );
            outgoingLight = mix( outgoingLight * mix( vec3( 1.0 ), vec3( 0.86, 0.93, 1.1 ), uCelCool ), outgoingLight, celShade );
          #endif
        }
        #include <opaque_fragment>`)
      .replace('void main() {', `
        uniform vec3 uCelLightDir;
        uniform float uCelRim;
        uniform float uCelWash;
        uniform float uCelCool;
        uniform vec3 uCelMossC;
        uniform float uCelMossAmt;
        #ifdef CEL_WP
        varying vec3 vCelWP;
        // Cheap 2D value noise (hash-based); low frequency only, never photoreal grain.
        float celHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float celNoise( vec2 p ) {
          vec2 i = floor( p ), f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( celHash( i ), celHash( i + vec2( 1.0, 0.0 ) ), f.x ),
                      mix( celHash( i + vec2( 0.0, 1.0 ) ), celHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
        }
        #endif
        void main() {`);
  };
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${cool > 0 ? 'C' : ''}${rim}`;
  return mat;
}

/**
 * 賽璐璐材質(全專案共用入口)。
 * opts.celMetal = true → 硬邊金屬高光帶(槍管/砲塔/機甲裝甲)。
 */
export function toonMat(color, opts = {}) {
  const { celMetal, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...rest });
  return applyCelPatch(m, { metal: !!celMetal });
}

/**
 * 環境賽璐璐材質(靜態環境物件專用:障礙物/建物/道路/地標)。
 * 預設帶低頻水彩 wash + 冷藍陰影;opts.moss = { color?, amount? } 開苔蘚投影。
 * 機體/英雄/武器一律仍走 toonMat,不吃這裡的環境偏色。
 */
export function envMat(color, opts = {}) {
  const { celMetal, wash = 0.5, cool = 0.5, moss = null, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...rest });
  return applyCelPatch(m, { metal: !!celMetal, wash, cool, moss });
}

/**
 * 接地環境光遮蔽(botw_plan Task 2.2):對群組內每個 mesh 烤頂點色,
 * 越貼近群組地面(局部 y=0)越暗偏冷 → 物件「長」在地上而不是浮貼。
 * 跳過透明/發光/wireframe 件(火舌/水面/信標/電塔),只動不透明結構件。
 * @param root 障礙物 / 地標的 Group(尚未進場景,局部座標即可)
 * @param fade AO 衰減高度(局部公尺;群組整體縮放前)
 */
const _aoTint = { r: 0.72, g: 0.7, b: 0.78 };   // 冷紫灰接地陰影(偏淺:深色件疊 toon 暗部也不塌黑,#INC-106 精神)
export function bakeContactAO(root, fade = 2.4) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRoot = new THREE.Matrix4();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent || m.wireframe) return;
    if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05 && (m.emissiveIntensity ?? 1) >= 0.5) return;
    toRoot.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      const t = Math.min(1, Math.max(0, v.y / fade));   // 0 = 貼地全暗,1 = 無 AO
      colors[i * 3] = _aoTint.r + (1 - _aoTint.r) * t;
      colors[i * 3 + 1] = _aoTint.g + (1 - _aoTint.g) * t;
      colors[i * 3 + 2] = _aoTint.b + (1 - _aoTint.b) * t;
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    m.vertexColors = true;
    m.needsUpdate = true;
  });
  return root;
}

/** 把載入的 GLB(或任何子樹)整棵換成 cel 材質,保留貼圖/顏色/透明度 */
export function toonify(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material || o.userData.isOutline) return;
    const swap = (m) => {
      if (m.isMeshToonMaterial) return m;
      const t = new THREE.MeshToonMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null,
        gradientMap: toonGradient(),
        transparent: m.transparent || false,
        opacity: m.opacity ?? 1,
        side: m.side ?? THREE.FrontSide,
      });
      if (m.emissive) { t.emissive = m.emissive.clone(); t.emissiveIntensity = m.emissiveIntensity ?? 1; }
      return applyCelPatch(t, { metal: (m.metalness ?? 0) >= 0.5 });
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return root;
}

// ---- 反轉外殼描邊(Inverted Hull)----
// BackSide 黑殼沿頂點法線外推固定世界寬度;寬度在建立時除以該 mesh 的
// 世界縮放,讓 fitToHeight 縮放過的模型描邊粗細一致(≈ 螢幕 2~3px)。
const OUTLINE_COLOR = new THREE.Color(0x0a0b12);

function outlineMaterial(w) {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOW = { value: w };
    shader.vertexShader = ('uniform float uOW;\n' + shader.vertexShader)
      .replace('#include <begin_vertex>', 'vec3 transformed = position + normal * uOW;');
  };
  m.customProgramCacheKey = () => 'celOutline';
  return m;
}

const _ws = new THREE.Vector3();

/**
 * 對子樹所有不透明 mesh 加描邊外殼。
 * @param root  目標(單位/障礙/座艙…)
 * @param width 描邊世界寬度(公尺);依單位尺寸給,例:高 6m 機甲 ≈ 0.09
 * 透明件(旋翼/水面/偽裝網/火舌)與 userData.noOutline 跳過。
 */
export function outlinify(root, width = 0.08) {
  root.updateMatrixWorld(true);
  const jobs = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || o.userData.noOutline) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent) return;
    const ws = o.getWorldScale(_ws);
    const s = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3 || 1;
    jobs.push([o, width / s]);
  });
  for (const [o, w] of jobs) {
    let shell;
    if (o.isSkinnedMesh) {
      shell = new THREE.SkinnedMesh(o.geometry, outlineMaterial(w));
      shell.bindMode = o.bindMode;
      shell.bind(o.skeleton, o.bindMatrix);   // 共用骨骼:描邊跟著動畫走
    } else {
      // 鑿刻岩等 per-face 硬邊法線幾何:外殼沿面法線外推會裂縫,
      // 改用建構時附帶的平滑法線副本(userData.outlineGeo)
      shell = new THREE.Mesh(o.userData.outlineGeo || o.geometry, outlineMaterial(w));
    }
    shell.userData.isOutline = true;
    shell.frustumCulled = false;
    o.add(shell);   // 掛在原 mesh 下(identity 局部變換 = 同位置同縮放)
  }
  return root;
}
