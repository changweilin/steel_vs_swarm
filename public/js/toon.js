// ============ 3D 賽璐璐(celluloid)渲染核心 ============
// 依 doc/drone_vs_robot_fps_dota_plan.html Task 3.1 的方法:
//   1. MeshToonMaterial + 3 階高對比色階 ramp(硬邊明暗交界,漫畫式打光)
//   2. 反轉外殼(Inverted Hull)黑色描邊:BackSide 外殼沿法線外推,
//      螢幕上呈現 2~3px 的漫畫勾線;支援 SkinnedMesh(外殼共用同一副骨骼)
//   3. 硬邊金屬高光(sharp specular band)+ 邊緣光(rim):
//      onBeforeCompile 注入,非模糊的白色反光帶 → 機甲/槍械像動漫插畫的金屬
// 全專案共用:hazards.js re-export 舊入口(toonMat/toonify/toonGradient)保持相容。
import * as THREE from 'three';
import { visualPref, onVisualChange } from './visualPrefs.js';

// ---- cel ramp 家族(NearestFilter = 硬邊界)----
// **單一縫**:全專案的明暗階梯只有這一張表,ramp 的 DataTexture MUST 只在本檔建構 ——
// 散在各處 new DataTexture 就是「同一個場景裡有兩套明暗規則」,而畫面上只表現成
// 「某些物件的陰影邊界跟別人對不上」,不會有任何錯誤訊息。
//
// 為什麼要分階數(2026-08-03):單一 3 階 ramp 對**淺色大面積**沒有階可以走 ——
// 雪地/白色塗裝/水面的三階全擠在亮端,看起來就是一片平的;而小件深色零件(輪胎/線纜)
// 三階又切得太碎。故依「這塊面積在畫面上要表現多少層次」選階數,不是依物件種類。
//
//   2     小塊深色件(輪胎/線纜/深色裝甲):只要一刀明暗界
//   3     現役預設 —— **MUST 逐位元不變**,改了整個場景會重新上色
//   4     大型結構(地形/建物量體):中間多一階,坡面才有轉折
//   soft  淺色大面積(雪/煙/水/白色塗裝):把整條 ramp 抬到亮端,兩階之間才看得出交界
//
// A14 / #INC-106:每一組的**暗階 MUST ≥ 102** —— 低於此深色物件疊上 cool 會塌成全黑。
const RAMPS = {
  2: [102, 255],
  3: [102, 182, 255],
  4: [102, 158, 206, 255],
  soft: [190, 255],
};
const _grads = new Map();
/**
 * cel 明暗階梯貼圖(依階數快取;同一組 bands 整場共用一張)。
 * @param bands 2 / 3 / 4 / 'soft';省略 = 3(呼叫端不傳就**逐位元同舊制**)
 */
export function toonGradient(bands = 3) {
  const key = RAMPS[bands] ? bands : 3;
  let g = _grads.get(key);
  if (g) return g;
  const stops = RAMPS[key];
  g = new THREE.DataTexture(new Uint8Array(stops), stops.length, 1, THREE.RedFormat);
  g.minFilter = THREE.NearestFilter;
  g.magFilter = THREE.NearestFilter;
  g.needsUpdate = true;
  _grads.set(key, g);
  return g;
}

// ---------------- 陰影偏色搬進 ramp(P1-B;2026-08-03)----------------
// 舊制的 `CEL_COOL` 是**事後**把 `outgoingLight` 往冷色拌一下,而且**只有 `envMat` 開**;
// 機甲/英雄/武器走 `toonMat` ⇒ 它們的陰影只是「比較暗」,不是「有顏色」。
// 賽璐璐的暗面本來就該讀成天光反射,這是這批改動裡唯一會動到每一台機甲外觀的一項,
// 故 docs/visual_upgrade_plan.md 把它單獨列成一個批次並要求先確認方向 ——
// 落地方式因此是**設定頁的拉桿**(visualPrefs.js),預設 0 = 逐位元同舊制。
//
// 做法:把偏色接在 **ramp 查表**上(`getGradientIrradiance` 的回傳值),不是接在最終顏色上。
// 差別在於它從此吃到**每一盞燈**、也自動跟著 ramp 的階走(暗階偏得多、亮階不偏),
// 而事後拌色只認得到那一條手寫的 `dot(normal, sun)`。
//
// **偏色 MUST 是亮度中性的**:A14 / #INC-106 規定 ramp 暗階不得低於 102,而「把暗階乘上一個
// 亮度 < 1 的顏色」正是繞過那條規則的後門(畫面上只表現成深色件在暗面塌成黑塊)。
// 故色相向量先除以自身的 Rec.709 亮度 ⇒ 任何強度下 `luma(tint) === 1`,暗階的**亮度**
// 逐位元不動,只有色相在走。
const SHADOW_HUE = [0.86, 0.93, 1.10];      // 天光藍綠(與 postfx GRADE.SHADOW 同方向)
const LUMA_709 = [0.2126, 0.7152, 0.0722];
const SHADOW_HUE_N = (() => {
  const l = SHADOW_HUE[0] * LUMA_709[0] + SHADOW_HUE[1] * LUMA_709[1] + SHADOW_HUE[2] * LUMA_709[2];
  return SHADOW_HUE.map((c) => c / l);
})();
/**
 * 陰影偏色乘數(單一縫:GLSL 的 uniform 與樣品畫面同吃這一支)。
 * @param amount 0~1(0 = 白 = 不偏色,逐位元同舊制)
 */
export function shadowTintRGB(amount) {
  const a = Math.min(1, Math.max(0, amount || 0));
  return SHADOW_HUE_N.map((c) => 1 + (c - 1) * a);
}

// three `lights_toon_pars_fragment` 裡 ramp 查表的**那一行原文**。
// 升級 three MUST 重新核對這一行(chunk 改寫 ⇒ 替換靜默失效)。
// 替換不成功時走 `uCelRampFb` 的等效落地路徑(原則 6 降級不例外),不會變成「拉桿沒反應」。
const RAMP_HOOK = 'return vec3( texture2D( gradientMap, coord ).r );';
const RAMP_INC = '#include <lights_toon_pars_fragment>';
// **MUST 從 `THREE.ShaderChunk` 取 chunk 原文再換掉 include 指令**,MUST NOT 直接在
// `shader.fragmentShader` 上找那一行 —— `onBeforeCompile` 收到的是**還沒展開 include** 的原始碼
// (本檔其餘每一處補丁都錨在 `#include <…>` 上,正是這個理由)。在展開後的字串上找,
// 永遠找不到、永遠走落地路徑,而畫面上只表現成「偏色比預期柔一點」,不會有任何錯誤。
// chunk 從 three 自己身上讀 ⇒ 不必把它的原始碼抄一份進來。
const RAMP_PATCHED = (() => {
  const chunk = THREE.ShaderChunk?.lights_toon_pars_fragment;
  if (typeof chunk !== 'string' || !chunk.includes(RAMP_HOOK)) return null;
  return chunk.replace(RAMP_HOOK, `
    {
      // ramp 的階值 celG:0 = 最暗階、1 = 最亮階。偏色只給暗階(mix 的權重就是 celG),
      // 亮階恆不偏 —— 賽璐璐的受光面本來就該是光源本色。
      // 乘數的 Rec.709 亮度恆 = 1(shadowTintRGB 已正規化)⇒ 暗階亮度逐位元不動,A14 不受影響。
      float celG = texture2D( gradientMap, coord ).r;
      return vec3( celG ) * mix( uCelRampTint, vec3( 1.0 ), celG );
    }`);
})();

// 共享 uniform:一份物件餵給所有材質 ⇒ 拉桿改值即全場生效,MUST NOT 改成重建材質
// (材質早就發到 GPU 了,戰鬥中重建等於整場卡住)。
const _rampTint = {
  mech: { value: new THREE.Color(1, 1, 1) },
  env: { value: new THREE.Color(1, 1, 1) },
};

// ---------------- 風化屬性場(P2-A;2026-08-03)----------------
// 舊制的 moss / wash 對**全場每一個環境物件**一視同仁 —— 沒有任何「這一區比那一區老」的
// 概念,而那正是大面積場景看起來像貼圖重複的原因。改吃 `field.js` 的散布橢圓場
// (與地表色階梯同一支縫,但**種子錯開**:兩者鎖在一起的話「顏色深的地方剛好也長最多苔」,
// 反而更假)。場烤成一張小貼圖由世界 XZ 取樣 ⇒ 逐像素成本 = 一次 texture2D,
// MUST NOT 在片段著色器裡跑 26 個橢圓的迴圈。
const WEATHER_SPREAD = 0.8;      // 場 0/1 兩端相對中性值的擺幅(× 拉桿值)
let _wTex = null;
const _wField = { value: null };
const _wRect = { value: new THREE.Vector4(0, 0, 1, 1) };   // (minX, minZ, 1/寬, 1/高)
const _wSpread = { value: 0 };

/** 中性場(還沒載入戰場、或展示台/角色預覽):恆 0.5 ⇒ 乘數恆 1 */
function neutralWField() {
  const t = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
  t.needsUpdate = true;
  return t;
}
_wField.value = neutralWField();

/**
 * 安裝風化場(唯一寫入點;呼叫端 = `terrain.js buildTerrain`,每場一次)。
 * @param data   `field.js bakeFieldTexture` 的 Uint8Array(size × size,0~255)
 * @param size   邊長格數
 * @param bounds { minX, maxX, minZ, maxZ } 世界邊界(取樣用)
 */
export function setWeatherField(data, size, bounds) {
  const old = _wTex;
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  t.minFilter = THREE.LinearFilter;      // 線性內插:場本來就是低頻的,取樣格點不該看得出來
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  _wTex = t;
  _wField.value = t;
  _wRect.value.set(bounds.minX, bounds.minZ,
    1 / Math.max(1e-6, bounds.maxX - bounds.minX), 1 / Math.max(1e-6, bounds.maxZ - bounds.minZ));
  old?.dispose();   // A25:上一場的場貼圖不放掉就是每開一場漏一張
}

// 拉桿 → 共享 uniform(訂閱一次;本檔是全專案唯一持有這些 uniform 的地方)
function syncVisualPrefs() {
  _rampTint.mech.value.setRGB(...shadowTintRGB(visualPref('shadowMech')));
  _rampTint.env.value.setRGB(...shadowTintRGB(visualPref('shadowEnv')));
  _wSpread.value = WEATHER_SPREAD * visualPref('weather');
}
syncVisualPrefs();
onVisualChange(syncVisualPrefs);

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
 * 機體塗裝(paint.js;英雄機體專用):
 *   paint — { tex, matrix, scale } 以「靜止姿勢的機體局部座標」三平面投影花紋。
 *           matrix = mesh 局部 → 機體根(建模當下固定,不隨動畫更新)⇒ 花紋鎖在裝甲板上。
 * 招牌圖集(signage.js;文字招牌專用):
 *   atlas — true 時吃逐實例屬性 `aTexRect`(vec4 ox,oy,sx,sy),把 `map` 的 UV 重映到
 *           圖集的某一格。**招牌上的字每一塊都不同,但 InstancedMesh 只有一張貼圖** ——
 *           沒有這條就只能一塊牌一個 mesh(幾百個 draw call),或者整座城的招牌寫同一行字。
 *           著色器補丁一律住本檔(同 ramp 的單一縫紀律):散出去就是同一個場景兩套 UV 規則。
 */
function applyCelPatch(mat, { metal = false, rim = 0.22, wash = 0, moss = null, cool = 0, paint = null, tint = 'mech', atlas = false } = {}) {
  const defines = { ...(mat.defines || {}) };
  if (metal) defines.CEL_METAL = '';
  if (wash > 0) defines.CEL_WASH = '';
  if (moss) defines.CEL_MOSS = '';
  if (cool > 0) defines.CEL_COOL = '';
  if (paint) defines.CEL_PAINT = '';
  // 單一主徽(totem/tattoo/flag)只貼一面朝外的顯眼裝甲:用 rig 空間法線與指定朝向(paint.face,
  // 直立機甲取 +Z 胸甲、橫置飛行器取 +Y 頂面)的夾角把貼花閘在該半球,避免三平面投影
  // 在機體背面/底面鏡像出第二枚徽記(使用者要求「一個完整的」)。
  if (paint?.face) defines.CEL_PAINT_GATE = '';
  // 平面閘(hinomaru):只在與 paint.flat 軸「平行」的面(頂+底兩面,|N·軸| 大)顯現 →
  // 抑制三平面投影在薄件側緣(垂直面)的溢色。與 GATE(單一半球)互斥。
  if (paint?.flat) defines.CEL_PAINT_FLAT = '';
  if (wash > 0 || moss) defines.CEL_WP = '';   // 需要世界座標 varying
  // 圖集 UV 只在**真的有 map** 時開:`<uv_vertex>` 沒有 USE_MAP 就不會產生 vMapUv,
  // 補丁會編不過(而畫面上只表現成那批物件整批消失)。
  if (atlas && mat.map) defines.CEL_ATLAS = '';
  mat.defines = defines;
  mat.userData.celOpts = { metal, rim, wash, moss, cool, paint, tint, atlas };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCelLightDir = { value: _celLightDirView };
    // 陰影偏色(P1-B):共享 uniform 物件 ⇒ 拉桿一動,全場材質同一幀跟著換
    shader.uniforms.uCelRampTint = _rampTint[tint] || _rampTint.mech;
    shader.uniforms.uCelWField = _wField;
    shader.uniforms.uCelWRect = _wRect;
    shader.uniforms.uCelWSpread = _wSpread;
    shader.uniforms.uCelRim = { value: rim };
    shader.uniforms.uCelWash = { value: wash };
    shader.uniforms.uCelCool = { value: cool };
    shader.uniforms.uCelMossC = { value: new THREE.Color(moss?.color ?? 0x6d8f4a) };
    shader.uniforms.uCelMossAmt = { value: moss?.amount ?? 0.85 };
    shader.uniforms.uPaintTex = { value: paint?.tex ?? null };
    shader.uniforms.uPaintM = { value: paint?.matrix ?? new THREE.Matrix4() };
    shader.uniforms.uPaintS = { value: paint?.scale ?? 1 };
    shader.uniforms.uPaintFace = { value: paint?.face ?? paint?.flat ?? new THREE.Vector3(0, 0, 1) };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `
        #ifdef CEL_WP
        varying vec3 vCelWP;
        #endif
        #ifdef CEL_PAINT
        uniform mat4 uPaintM;
        uniform float uPaintS;
        varying vec3 vPaintP;
        varying vec3 vPaintN;
        #endif
        #ifdef CEL_ATLAS
        attribute vec4 aTexRect;
        #endif
        void main() {`)
      // 圖集重映 MUST 排在 `<uv_vertex>` **之後**:那一段才剛把 vMapUv 算出來,
      // 排前面等於改一個還沒賦值的 varying(不報錯,只是整批招牌用第 0 格)。
      .replace('#include <uv_vertex>', `
        #include <uv_vertex>
        #ifdef CEL_ATLAS
          vMapUv = aTexRect.xy + vMapUv * aTexRect.zw;
        #endif`)
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
        #endif
        #ifdef CEL_PAINT
        {
          // Rest-pose rig-space position/normal: paint sticks to the armor plate,
          // so joint rotation never makes the pattern swim across the body.
          vPaintP = ( uPaintM * vec4( transformed, 1.0 ) ).xyz * uPaintS;
          vPaintN = mat3( uPaintM ) * objectNormal;
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
            diffuseColor.rgb *= mix( vec3( 1.0 ), celTint, uCelWash * celWeatherF() );
          }
          #endif
          #ifdef CEL_MOSS
          {
            // Top-down world-Y moss projection: upward-facing surfaces receive a
            // painterly moss coat; a second noise breaks the edge into patches.
            // celWeatherF(): 「這一區有多老」——場高的地方苔長得厚,場低的地方幾乎沒有。
            vec3 celWN = inverseTransformDirection( normal, viewMatrix );
            float mossW = smoothstep( 0.45, 0.8, celWN.y ) * uCelMossAmt * celWeatherF();
            mossW *= smoothstep( 0.28, 0.72, celNoise( vCelWP.xz * 0.3 + vCelWP.yy * 0.17 ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, uCelMossC, mossW );
          }
          #endif
        }
        #endif
        #ifdef CEL_PAINT
        {
          // Triplanar decal in rig-rest space; hard alpha cut keeps the cel look.
          // Canvas textures are premultiplied, so un-premultiply after the blend.
          vec3 pw = abs( normalize( vPaintN ) );
          pw = pow( pw, vec3( 4.0 ) );
          pw /= ( pw.x + pw.y + pw.z );
          vec4 pc = texture2D( uPaintTex, vPaintP.zy ) * pw.x
                  + texture2D( uPaintTex, vPaintP.xz ) * pw.y
                  + texture2D( uPaintTex, vPaintP.xy ) * pw.z;
          float pa = smoothstep( 0.4, 0.62, pc.a );
          #ifdef CEL_PAINT_GATE
          // 只在朝 uPaintFace 的半球顯現;背面/底面淡出 → 全機唯一一枚徽記。
          pa *= smoothstep( 0.02, 0.4, dot( normalize( vPaintN ), uPaintFace ) );
          #endif
          #ifdef CEL_PAINT_FLAT
          // 只在與 uPaintFace 軸平行的面(頂+底,|N·軸| 大)顯現 → 薄件側緣不溢色。
          pa *= smoothstep( 0.5, 0.82, abs( dot( normalize( vPaintN ), uPaintFace ) ) );
          #endif
          diffuseColor.rgb = mix( diffuseColor.rgb, pc.rgb / max( pc.a, 0.001 ), pa );
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
          // 落地保險(原則 6):three 若改寫 lights_toon_pars_fragment,上面那道 ramp 替換會
          // **靜默**失效 —— 畫面只表現成「拉桿拉了沒反應」,不會有任何錯誤。uCelRampFb 在
          // onBeforeCompile 當下就知道替換成不成功:成功恆 0(以下完全不執行),
          // 失敗才走這條等效路徑(逐像素而非逐 ramp 階,交界略柔,但不會整項消失)。
          if ( uCelRampFb > 0.5 ) {
            float celFbG = saturate( dot( normal, uCelLightDir ) * 0.5 + 0.5 );
            outgoingLight *= mix( uCelRampTint, vec3( 1.0 ), celFbG );
          }
        }
        #include <opaque_fragment>`)
      .replace('void main() {', `
        uniform vec3 uCelLightDir;
        uniform float uCelRim;
        uniform float uCelWash;
        uniform float uCelCool;
        uniform vec3 uCelMossC;
        uniform float uCelMossAmt;
        uniform sampler2D uCelWField;
        uniform vec4 uCelWRect;
        uniform float uCelWSpread;
        #ifdef CEL_PAINT
        uniform sampler2D uPaintTex;
        uniform vec3 uPaintFace;
        varying vec3 vPaintP;
        varying vec3 vPaintN;
        #endif
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
        // 風化場(P2-A):「這一區有多老」。中性 0.5 ⇒ 乘數恆 1;**uCelWSpread = 0 時逐位元同舊制**
        // (拉桿歸零 = 全場均勻,回到這批改動之前)。取不到世界座標的材質一律回中性 ——
        // 場只服務環境物件,機體不該因為停在哪裡而換一種鏽。
        float celWeatherF() {
          #ifdef CEL_WP
            vec2 wuv = clamp( ( vCelWP.xz - uCelWRect.xy ) * uCelWRect.zw, 0.0, 1.0 );
            return 1.0 + ( texture2D( uCelWField, wuv ).r - 0.5 ) * 2.0 * uCelWSpread;
          #else
            return 1.0;
          #endif
        }
        void main() {`);
    // ---- 陰影偏色接進 ramp 查表(P1-B)----
    // MUST 在最後做:上面那一串 replace 都靠 three 的 `#include` 錨點,先動這裡不影響它們,
    // 但把宣告塞到最前面會讓 `void main() {` 的錨點落在我們自己的字串上。
    // 宣告一律**頂在整份片段程式最前**:`getGradientIrradiance` 展開後的位置比 `void main()`
    // 早得多,uniform 若跟著其他人塞在 main 前面就是「宣告在使用之後」。
    const canPatch = RAMP_PATCHED && shader.fragmentShader.includes(RAMP_INC);
    shader.uniforms.uCelRampFb = { value: canPatch ? 0 : 1 };
    shader.fragmentShader = 'uniform vec3 uCelRampTint;\nuniform float uCelRampFb;\n'
      + (canPatch ? shader.fragmentShader.replace(RAMP_INC, RAMP_PATCHED) : shader.fragmentShader);
  };
  mat.customProgramCacheKey = () =>
    `cel${metal ? 'M' : ''}${wash > 0 ? 'W' : ''}${moss ? 'S' : ''}${cool > 0 ? 'C' : ''}${paint ? 'P' : ''}${paint?.face ? 'G' : ''}${paint?.flat ? 'F' : ''}${rim}`;
  return mat;
}

/**
 * 事後掛塗裝(paint.js paintUnit):材質在建模時就已 applyCelPatch 過,
 * 這裡沿用它當初的 cel 選項(metal/rim…)重新注入,只多一層花紋。
 */
export function applyPaint(mat, paint) {
  applyCelPatch(mat, { ...(mat.userData.celOpts || {}), paint });
  mat.needsUpdate = true;
  return mat;
}

/**
 * 賽璐璐材質(全專案共用入口)。
 * opts.celMetal = true → 硬邊金屬高光帶(槍管/砲塔/機甲裝甲)。
 */
export function toonMat(color, opts = {}) {
  const { celMetal, bands, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(bands), ...rest });
  return applyCelPatch(m, { metal: !!celMetal });
}

/**
 * 環境賽璐璐材質(靜態環境物件專用:障礙物/建物/道路/地標)。
 * 預設帶低頻水彩 wash + 冷藍陰影;opts.moss = { color?, amount? } 開苔蘚投影。
 * 機體/英雄/武器一律仍走 toonMat,不吃這裡的環境偏色。
 */
export function envMat(color, opts = {}) {
  // rim 可覆寫:貼地平面(地被/道路)在遠處掠射角 rim 全開會整片洗白,傳 rim:0 關閉
  const { celMetal, wash = 0.5, cool = 0.5, moss = null, rim = 0.22, bands, atlas = false, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(bands), ...rest });
  // tint: 'env' —— 陰影偏色分「機體」與「環境」兩軌(P1-B):機甲要保住陣營塗裝的色相,
  // 環境可以偏得重一點。兩軌各自一根拉桿,MUST NOT 併成一個值。
  return applyCelPatch(m, { metal: !!celMetal, rim, wash, cool, moss, tint: 'env', atlas });
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
// 描邊的**螢幕最小半寬**(NDC;垂直方向 2 單位 = 整個畫面高)。
// 舊制只沿法線外推固定的**世界**寬度 ⇒ 線粗與距離成反比:近的胖、遠的直接消失 ——
// 一台機甲跑遠一點就從「漫畫角色」變回「沒有描邊的多邊形」。
// 2026-08-03 改成「世界寬度」與「螢幕下限」取大者:
//   ・近距離 uOW 勝出 ⇒ **逐位元同舊制**(所有 15 處呼叫端的寬度不必重調);
//   ・遠距離下限勝出 ⇒ 線粗鎖在約 1.2px,不再消失。
// 下限 MUST 由 `projectionMatrix[1][1]` 反推(= 1/tan(fov/2)):狙擊縮 FOV 時投影矩陣本來就變,
// 手寫一個常數換算 = 一開鏡描邊全部變粗(而那正是最需要看清輪廓的時候)。
const OUTLINE_MIN_NDC = 0.0022;

function outlineMaterial(w) {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOW = { value: w };
    shader.uniforms.uOMin = { value: OUTLINE_MIN_NDC };
    shader.vertexShader = ('uniform float uOW;\nuniform float uOMin;\n' + shader.vertexShader)
      .replace('#include <begin_vertex>', `
        // 視距:骨骼變形前的綁定姿勢即可(同一根骨頭上的頂點距離差異遠小於一個像素)
        float oDist = max( 0.05, -( modelViewMatrix * vec4( position, 1.0 ) ).z );
        // uOMin(NDC)換回這個距離上的世界寬度;projectionMatrix[1][1] = 1/tan(fov/2)
        float oMinW = uOMin * oDist / max( 0.001, projectionMatrix[1][1] );
        vec3 transformed = position + normal * max( uOW, oMinW );`);
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

// ---------------- 一次性物件的 GPU 資源回收(唯一縫)----------------
// three 的 WebGLRenderer 以 `geometry.dispose()` / `material.dispose()` 事件釋放顯示卡上的緩衝:
// 只 `scene.remove()` 不 dispose,緩衝會一直留著。特效/彈體是**每發數十顆**的一次性物件,
// 漏掉就是「打越久越卡」(手機顯存吃緊後更明顯)。
//
// 共用幾何(單位圓柱/單位球/碎塊池…)整場只有一份,MUST NOT dispose —— 一旦誤放,
// 之後所有借用同一份幾何的物件都會變空白。故共用幾何一律先 `markShared()` 註冊,
// 回收時依此跳過。**castfx.js / vfx.js / game.js 共用這一支**,MUST NOT 各寫一份。
const _sharedGeo = new Set();
/** 註冊「整場共用、永不釋放」的幾何;回傳原幾何(方便 `markShared(new …Geometry())` 串接) */
export function markShared(geo) { _sharedGeo.add(geo); return geo; }
/** 一次性物件樹的資源回收:幾何(非共用)+ 材質;貼圖一律不動(皆為快取共用) */
export function disposeTree(root) {
  root.traverse((o) => {
    // Sprite.geometry 是 three 全域共用的一份,MUST NOT dispose(會打到全 app 的 sprite)
    if (!o.isSprite && o.geometry && !_sharedGeo.has(o.geometry)) o.geometry.dispose();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x?.dispose());
  });
}
