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
 */
function applyCelPatch(mat, { metal = false, rim = 0.22 } = {}) {
  if (metal) mat.defines = { ...(mat.defines || {}), CEL_METAL: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCelLightDir = { value: _celLightDirView };
    shader.uniforms.uCelRim = { value: rim };
    shader.fragmentShader = shader.fragmentShader
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
        }
        #include <opaque_fragment>`)
      .replace('void main() {', 'uniform vec3 uCelLightDir;\nuniform float uCelRim;\nvoid main() {');
  };
  mat.customProgramCacheKey = () => `cel${metal ? 'M' : ''}${rim}`;
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
      shell = new THREE.Mesh(o.geometry, outlineMaterial(w));
    }
    shell.userData.isOutline = true;
    shell.frustumCulled = false;
    o.add(shell);   // 掛在原 mesh 下(identity 局部變換 = 同位置同縮放)
  }
  return root;
}
