// ============ 環境系統:季節 × 日夜 × 天氣 ============
// 依 battleConfig.env(開房時由伺服器定案,全房一致)設定:
//   - 天色 / 霧 / 太陽(或月光)角度、色溫、強度
//   - 雨 / 雪粒子(跟隨相機的粒子盒,便宜又看不出邊界)
// 粒子手法參考 mapping_elf/weatherFx3D.js(程序生成、無外部資產)。
import * as THREE from 'three';
import {
  clockHour, phaseBlend, sunDirAt, moonDirAt, bodyFade,
  SHADOW, shadowRangeM,
} from './data.js';
import { setCelSun, WIND, celWindTime, INK_INFO_DECL, INK_INFO_NONE } from './toon.js';
import { mulberry32 } from './rng.js';

// 環境標籤的唯一縫已抽到 `data.js`(它只是 ENV 的取名查表,而本檔 import three ⇒ Node 端載不動)。
// 這裡只留**舊入口**(同 `hazards.js` re-export `rng.js` 的 mulberry32),MUST NOT 在此重寫一份。
export { envLabel } from './data.js';

// 日夜基調。**四個錨點的顏色,不是四種模式** —— 當下的天色一律由 `phaseBlend()` 在相鄰兩格
// 之間內插(2026-08-14 時間流逝上線)。`elev` 欄已退場:太陽在哪由 `data.js sunDirAt()` 推導,
// 留著它就是第二把尺(色表說 0.16、軌道說別的,而畫面上只表現成「黃昏的影子方向怪怪的」)。
// `sun` 這一欄在夜格裝的是**月光色** ⇒ 主光換手時色相自己就接上了,不必另開一張月光表。
const TIMES = {
  dawn:  { sky: 0x8690ae, fogC: 0xa08e93, sun: 0xffc79c, sunI: 0.80, hemiSky: 0xbda6b6, hemiGnd: 0x2e2b31, hemiI: 0.62 },
  day:   { sky: 0x8fa9bd, fogC: 0x9aacba, sun: 0xfff2dd, sunI: 1.30, hemiSky: 0x9fb4c8, hemiGnd: 0x3a352c, hemiI: 0.85 },
  dusk:  { sky: 0x8a5a46, fogC: 0x7a5a4c, sun: 0xff9a4d, sunI: 0.95, hemiSky: 0xc98a6a, hemiGnd: 0x2a2430, hemiI: 0.60 },
  night: { sky: 0x0a1220, fogC: 0x0d1522, sun: 0x9db8e8, sunI: 0.30, hemiSky: 0x2a3a55, hemiGnd: 0x11141a, hemiI: 0.35 },
};
/** 兩個基調之間的內插(顏色寫進呼叫端給的實例:每幀都要跑,不配新物件) */
function mixTime(out, a, b, t) {
  const A = TIMES[a] || TIMES.day, B = TIMES[b] || TIMES.day;
  for (const k of ['sky', 'fogC', 'sun', 'hemiSky', 'hemiGnd']) {
    out[k].setHex(A[k]).lerp(_tmpC.setHex(B[k]), t);
  }
  out.sunI = A.sunI + (B.sunI - A.sunI) * t;
  out.hemiI = A.hemiI + (B.hemiI - A.hemiI) * t;
  return out;
}
const _tmpC = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const newPhase = () => ({
  sky: new THREE.Color(), fogC: new THREE.Color(), sun: new THREE.Color(),
  hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(), sunI: 1, hemiI: 1,
});
// 季節微調(色溫/亮度)
const SEASONS = {
  spring: { tint: 0xf2ffe8, mul: 1.0 },
  summer: { tint: 0xffffff, mul: 1.08 },
  autumn: { tint: 0xffe2b8, mul: 0.95 },
  winter: { tint: 0xdceaf2, mul: 0.88 },
};
// 天氣:光量倍率 + 霧(near/far 為地圖跨距倍率)+ 粒子
// 霧距離放遠(2026-07-10):舊值 near 0.25×span 在小圖 400m 就開始洗白,
// 中景地貌全變白;遠處靠 fogFar 前緣淡淡藍灰即可,地圖邊緣仍融入天色。
const WEATHERS = {
  clear:  { light: 1.0,  fogNear: 0.50, fogFar: 1.9 },
  cloudy: { light: 0.55, fogNear: 0.40, fogFar: 1.6 },
  rain:   { light: 0.45, fogNear: 0.20, fogFar: 1.0, particle: 'rain' },
  snow:   { light: 0.60, fogNear: 0.22, fogFar: 1.1, particle: 'snow', fogTint: 0xcfd8dd },
  fog:    { light: 0.50, fogNear: 0.04, fogFar: 0.35 },
};

// ---- 漸層天空穹頂(2026-08-03)----
// 舊制 `scene.background = skyC` 是**一個顏色**:畫面上第二大的一塊面整片同色,
// 4 種天氣 × 3 個時段全靠那一個顏色加霧表達。改成三停點漸層穹頂 + 柔量化。
//
// **顏色一律由 TIMES / SEASONS / WEATHERS 推導,MUST NOT 另開第四張色表**(§2.1):
// 多一張表就會出現「某些季節 × 天氣的組合裡,天空與霧色對不上」這種只在特定組合現形的分歧。
//   地平線 = 霧色本身  ⇒ 遠景融進天空是**恆等式**而不是調出來的
//   天頂   = 天色壓暗  ⇒ 抬頭比較深,才有「天空是有厚度的」
//   中段   = 兩者內插再微亮(逆光帶)
// 兩道封頂(缺一不可):
//   ① 任何一階 MUST NOT 亮過**今天的天色** —— 夜戰的天空不可以把場地照亮(A14 的精神延伸);
//   ② 雨/霧天(由既有表的 `fogFar ≤ 1.0` 判,不是新旗標)MUST NOT 亮過**霧的遠端色**,
//      否則霧茫茫的地面上頂著一片亮天,遠近關係整個讀反。
const SKY_QUANT = 26;      // 柔量化階數(35% 混回原值:硬階梯太像色票,純漸層又不是賽璐璐)
const SKY_QUANT_MIX = 0.35;
const CLOUD_N = 26;        // 雲量基數;實際枚數與 WEATHERS[w].light 反比
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
/** 亮度封頂(保色相):超過就整體等比壓下來 */
function capLum(c, cap) {
  const l = lum(c);
  return l > cap && l > 1e-4 ? c.multiplyScalar(cap / l) : c;
}

// 空氣透視(雙色霧)的近端色:**近處的散射帶著日照的顏色**,遠處才收斂到地平線。
// 單色霧的問題不是「不夠濃」而是「沒有方向」—— 整片同色的霧讀起來像一層灰玻璃,
// 而真實的空氣在背光側偏冷、向光側偏暖。強度由拉桿定案(visualPrefs `air`,預設 0)。
const AIR_SUN_MIX = 0.35;
/**
 * 近霧色。**與 `skyStops` 同一條規則**:由 fogC / sunC / skyC / W 推導(不開第四張色表),
 * 並吃同一道亮度封頂 —— 夜戰的 `sun` 是冷藍**而且比霧色亮**,不封頂的話近處會浮出一層
 * 比天空還亮的藍霧(A14 那條「夜空不可以把場地照亮」的同一個坑)。
 * 封頂把夜戰與雨霧天自動壓回接近霧色本身 ⇒ 那些場景等於沒有這一層,這是刻意的。
 */
function nearFogColor(fogC, sunC, skyC, W) {
  const near = fogC.clone().lerp(sunC, AIR_SUN_MIX);
  const cap = W.fogFar <= 1.0 ? Math.min(lum(skyC), lum(fogC)) : lum(skyC);
  return capLum(near, cap);
}

/**
 * 三個停點(地平線 / 中段 / 天頂)。**單一縫**:顏色全部由 skyC / fogC / W 推導,
 * 這裡出現任何十六進位色值就是開了第四張色表(見上方註解)。稽核直測這一支。
 */
function skyStops(skyC, fogC, W) {
  const horiz = fogC.clone();
  const zen = skyC.clone().multiplyScalar(0.72);
  const mid = horiz.clone().lerp(zen, 0.45).multiplyScalar(1.06);
  // **地平線階刻意不吃封頂**:它就是霧色本身,而霧色今天已經畫在同一排像素上了 ——
  // 夾它只會讓天空與霧在地平線上差一階(一條橫貫畫面的接縫),而那正是這一階存在的理由。
  // 封頂只作用在天空那半(中段/天頂)。
  const cap = W.fogFar <= 1.0 ? Math.min(lum(skyC), lum(fogC)) : lum(skyC);
  for (const c of [mid, zen]) capLum(c, cap);
  return { horiz, mid, zen };
}

// **穹頂刻意不吃世界曲面**(2026-08-09):它自寫 vertexShader ⇒ 天生吃不到 `project_vertex`
// 的那一刀,而這正是對的 —— 天空在無限遠,沉降的是地面不是天。地表沉到地平線以下之後
// 露出來的就是這片穹頂(它 `depthWrite: false` + `renderOrder: -10`,本來就墊在最底下),
// 所以「遠處只剩天色」是這兩件事湊出來的,不需要任何新程式。
// MUST NOT 為了統一而把它改成標準材質(那會讓穹頂整片跟著沉,地平線當場塌掉)。
function makeSkyDome(span, skyC, fogC, W) {
  const { horiz, mid, zen } = skyStops(skyC, fogC, W);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uH: { value: horiz }, uM: { value: mid }, uZ: { value: zen } },
    vertexShader: `
      varying float vH;
      void main() {
        vH = normalize( position ).y * 0.5 + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: `
      ${INK_INFO_DECL}
      uniform vec3 uH; uniform vec3 uM; uniform vec3 uZ;
      varying float vH;
      void main() {
        ${INK_INFO_NONE}   // 天空沒有法線可給:寫哨兵 0,勾線 pass 會退回深度那一份
        // 柔量化:26 階再混回 35%,交界看得出來但不是色票
        float t = clamp( vH * 1.15 + 0.02, 0.0, 1.0 );
        float q = floor( t * ${SKY_QUANT}.0 ) / ${SKY_QUANT}.0;
        t = mix( t, q, ${SKY_QUANT_MIX} );
        vec3 c = t < 0.5 ? mix( uH, uM, t * 2.0 ) : mix( uM, uZ, ( t - 0.5 ) * 2.0 );
        gl_FragColor = vec4( c, 1.0 );
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(span * 1.5, 24, 16), mat);
  dome.frustumCulled = false;    // 中心恆在相機上,包圍球判定沒有意義
  dome.renderOrder = -10;        // 最先畫:深度不寫,後面所有東西照常覆蓋
  return dome;
}

/** 賽璐璐雲的貼圖:幾個硬邊圓疊出一朵,一張整場共用(手繪感靠硬邊,不靠柔化) */
let _cloudTex = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S / 2;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  for (const [cx, cy, r] of [[0.28, 0.62, 0.20], [0.46, 0.44, 0.28], [0.68, 0.58, 0.22], [0.84, 0.66, 0.14]]) {
    g.beginPath(); g.arc(cx * S, cy * S / 2, r * S / 2 * 2, 0, Math.PI * 2); g.fill();
  }
  _cloudTex = new THREE.CanvasTexture(cv);
  _cloudTex.colorSpace = THREE.SRGBColorSpace;
  return _cloudTex;
}

/**
 * 天空的 billboard 雲。枚數與 `WEATHERS[w].light` **反比**(光量越低雲越多),
 * 霧天一朵都不放 —— 霧的可視距離本來就到不了天空,放了只會在白牆上疊白斑。
 * 散布走 mulberry32(§2.3 確定性,MUST NOT 用 Math.random)。
 *
 * ---- 雲的「軟性」(2026-08-04)----
 * 使用者把雲朵列在「軟性物質」的第一個。**勾線那一半在雲身上是恆等式**:雲是
 * `depthWrite: false` 的 sprite,那些像素的深度是天空的 far ⇒ `postfx.js` 的勾線 pass
 * 第一行就早退(檔頭 ③「天空早退」),雲從來沒有被畫過線。所以這裡要做的只有另一半 ——
 * **隨風飄揚**:沿全場風向平移(與植被/旗幟同一份 `WIND`,MUST NOT 另寫一個風向),
 * 外加逐朵的微幅起伏與呼吸,免得一整片雲像一張硬紙板在滑。
 * 平移在 `WRAP` 的長度上循環(≈ 20 分鐘一圈)⇒ 是使用者要的「重複性變化」,
 * 而繞回的那一刻發生在雲場最外緣、多半在視野之外。
 */
const CLOUD_BOB = 0.012;      // 逐朵上下起伏(× span)
const CLOUD_BREATH = 0.05;    // 逐朵尺寸呼吸(比例)
function makeClouds(span, skyC, W, seed) {
  const n = Math.max(0, Math.round(CLOUD_N * (1.05 - W.light)));
  if (!n || W.fogNear <= 0.05) return null;
  const rnd = mulberry32(seed >>> 0);
  const grp = new THREE.Group();
  const tex = cloudTexture();
  const tint = skyC.clone().lerp(new THREE.Color(0xffffff), 0.55);
  const mats = [0.9, 0.55].map((o) => new THREE.SpriteMaterial({
    map: tex, color: tint, transparent: true, opacity: o, depthWrite: false, fog: false,
  }));
  const wd = [Math.cos(WIND.DIR_DEG * Math.PI / 180), Math.sin(WIND.DIR_DEG * Math.PI / 180)];
  const WRAP = span * 2.8;    // 沿風向的循環長度(雲場直徑的量級)
  const drift = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = span * (0.55 + rnd() * 0.75);
    const y = span * (0.18 + rnd() * 0.42);
    const s = span * (0.10 + rnd() * 0.16);
    const ph = rnd() * Math.PI * 2;                       // 逐朵相位(§2.3:走同一條序列)
    const sp = new THREE.Sprite(mats[i & 1]);
    sp.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    sp.scale.set(s * 2, s, 1);
    grp.add(sp);
    // 沿風向 / 垂直風向拆成兩個分量:漂移只加在**沿風向**那一個,側向與高度不動
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    drift.push({ sp, along: px * wd[0] + pz * wd[1], side: -px * wd[1] + pz * wd[0], y, s, ph });
  }
  grp.frustumCulled = false;
  grp.renderOrder = -9;
  return {
    obj: grp,
    mats,
    /** @param t 全場風的時鐘(秒;與植被同一支 `celWindTime`) */
    step(t) {
      for (const d of drift) {
        // 取模 MUST 先加半個 WRAP 再減:JS 的 % 對負數回負值,直接取模會讓半邊的雲跳到另一側
        const a = ((d.along + WIND.CLOUD_MPS * t + WRAP * 0.5) % WRAP + WRAP) % WRAP - WRAP * 0.5;
        d.sp.position.set(a * wd[0] - d.side * wd[1],
          d.y + Math.sin(t * 0.11 + d.ph) * span * CLOUD_BOB,
          a * wd[1] + d.side * wd[0]);
        const b = 1 + Math.sin(t * 0.17 + d.ph * 1.7) * CLOUD_BREATH;
        d.sp.scale.set(d.s * 2 * b, d.s * b, 1);
      }
    },
  };
}

// ---- 太陽 / 月亮的圓盤(2026-08-14)----
// 兩顆 billboard,恆掛在**相機為心**的天球上(同穹頂與雲:天空沒有視差)。
// 三條:
//   ① 方向只有 `data.js sunDirAt/moonDirAt` 一份 —— 圓盤畫在哪與主光從哪來 MUST 是同一個
//      向量,否則影子的方向與看得見的太陽對不上(而那是最刺眼的一種不對)。
//   ② 圓盤是**純表現層**:不進 blockers / 不參與任何判定,`fog:false` + 不寫深度。
//   ③ 亮度吃同一支 `bodyFade()`:地平線以下淡出。月亮在白天另外再壓一次(白日的月亮很淡,
//      不壓的話正午天上會掛一顆亮白圓餅)。
const BODY_R_F = 0.055;      // 圓盤半徑 ÷ 天球半徑(太陽;月亮見 MOON_R_F)
const MOON_R_F = 0.050;
const BODY_DIST_F = 1.25;    // 天球半徑 ÷ span(在穹頂 1.5 之內 ⇒ 不會被穹頂蓋掉)
function bodyTexture(kind) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const C = S / 2;
  // 光暈(只有太陽有):硬邊圓盤外一圈徑向淡出,賽璐璐風格不做柔邊本體
  if (kind === 'sun') {
    const gr = g.createRadialGradient(C, C, S * 0.16, C, C, C);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.45, 'rgba(255,238,200,0.28)');
    gr.addColorStop(1, 'rgba(255,238,200,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(C, C, S * (kind === 'sun' ? 0.30 : 0.34), 0, Math.PI * 2); g.fill();
  if (kind === 'moon') {
    // 環形海:圓盤本體是白的,坑用半透明灰疊上去(不另開第二張貼圖)
    g.fillStyle = 'rgba(150,162,182,0.55)';
    for (const [dx, dy, r] of [[-0.09, -0.07, 0.085], [0.07, 0.03, 0.065], [-0.02, 0.11, 0.05], [0.12, -0.10, 0.04]]) {
      g.beginPath(); g.arc(C + dx * S, C + dy * S, r * S, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeBodies(span) {
  const grp = new THREE.Group();
  const mk = (kind, rf) => {
    const tex = bodyTexture(kind);
    // `depthTest` MUST 留著:天體是透明佇列的東西 ⇒ 恆在不透明的地形之**後**才畫,
    // 關掉深度測試的話山稜線後面的太陽會浮在山坡上(2026-08-14 實測 taroko lane_mid)。
    // `renderOrder` 只在透明佇列內排序,救不了這件事。
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false,
    });
    const sp = new THREE.Sprite(mat);
    const r = span * BODY_DIST_F * rf;
    sp.scale.set(r * 2, r * 2, 1);
    grp.add(sp);
    return { sp, mat, tex };
  };
  const sun = mk('sun', BODY_R_F), moon = mk('moon', MOON_R_F);
  grp.frustumCulled = false;
  grp.renderOrder = -9.5;      // 穹頂(-10)之後、雲(-9)之前 ⇒ 雲可以遮住太陽
  return {
    obj: grp,
    /** @param dir 單位向量;@param tint 圓盤色;@param a 不透明度 */
    place(camera, sunDir, moonDir, sunC, moonC, dayness) {
      const D = span * BODY_DIST_F;
      for (const [b, d, c, a] of [
        [sun, sunDir, sunC, bodyFade(sunDir.y)],
        // 白天的月亮只剩淡淡一片:`1 − dayness` 就是那一層
        [moon, moonDir, moonC, bodyFade(moonDir.y) * (0.25 + 0.75 * (1 - dayness))],
      ]) {
        b.sp.position.set(camera.position.x + d.x * D, camera.position.y + d.y * D, camera.position.z + d.z * D);
        b.mat.color.copy(c);
        b.mat.opacity = a;
        b.sp.visible = a > 0.01;
      }
    },
    dispose() { for (const b of [sun, moon]) { b.mat.dispose(); b.tex.dispose(); } },
  };
}

/** 雨/雪粒子盒:跟著相機走,粒子落出底部就回頂部 */
function makeParticles(kind) {
  const N = kind === 'rain' ? 1600 : 1100;
  const BOX = 260, H = 180;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * BOX;
    pos[i * 3 + 1] = Math.random() * H;
    pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    seed[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: kind === 'rain' ? 0x9db8cc : 0xffffff,
    size: kind === 'rain' ? 0.55 : 1.15,
    transparent: true, opacity: kind === 'rain' ? 0.55 : 0.85,
    sizeAttenuation: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const speed = kind === 'rain' ? 85 : 9;
  let t = 0;
  return {
    obj: pts,
    update(dt, camera) {
      t += dt;
      pts.position.set(camera.position.x, camera.position.y - H * 0.45, camera.position.z);
      const p = geo.attributes.position;
      for (let i = 0; i < N; i++) {
        let y = p.array[i * 3 + 1] - speed * dt;
        if (kind === 'snow') {
          p.array[i * 3] += Math.sin(t * 1.4 + seed[i]) * dt * 4;   // 雪花飄移
        }
        if (y < 0) {
          y = H;
          p.array[i * 3] = (Math.random() - 0.5) * BOX;
          p.array[i * 3 + 2] = (Math.random() - 0.5) * BOX;
        }
        p.array[i * 3 + 1] = y;
      }
      p.needsUpdate = true;
    },
  };
}

/**
 * 套用環境到場景(取代原本固定的天光/太陽/霧)。
 * 回傳 { air, hour, update(dt, camera, elapsedS), dispose() }。
 *
 * ---- 時間流逝(2026-08-14)----
 * 開場時段只決定**第 0 秒的鐘點**;之後每一幀都由 `clockHour(開場時段, 經過秒數)` 重算,
 * 整份調色盤在相鄰兩個基調之間內插。三條紀律:
 *   ① **經過秒數由呼叫端傳進來**,本檔不自己數(權威時鐘住伺服器快照 —— 自己數一份的話
 *      兩台客戶端的天色會慢慢分家,而畫面上只表現成「你那邊天比較亮」)。
 *   ② **每幀只改共享 uniform / 既有實例的欄位**,MUST NOT 重建穹頂、雲、燈或材質
 *      (與 visualPrefs 的紀律③同一條:重建就會變成幻燈片)。
 *   ③ 顏色的推導路徑**逐字沿用舊制**(skyC/fogC/sunC 三行的算式一格未動),
 *      改的只有「T 從哪來」—— 從查表變成內插。時間停在開場錨點時逐位元同舊制。
 */
export function applyEnvironment(scene, terrain, env, opts = {}) {
  const span = Math.max(terrain.worldW, terrain.worldH);
  const startTime = TIMES[env?.time] ? env.time : 'day';
  const S = SEASONS[env?.season] || SEASONS.summer;
  const W = WEATHERS[env?.weather] || WEATHERS.clear;
  const tintC = new THREE.Color(S.tint);

  const T = newPhase();                       // 內插出來的當下基調(每幀就地覆寫)
  const skyC = new THREE.Color(), fogC = new THREE.Color(), sunC = new THREE.Color();
  const moonC = new THREE.Color();
  scene.background = skyC;   // 穹頂沒畫到的像素(建構失敗/極端視角)仍是舊行為
  scene.fog = new THREE.Fog(0x000000, span * W.fogNear, span * W.fogFar);

  // 漸層穹頂 + 賽璐璐雲(顏色全由上面三張表推導,見 makeSkyDome 檔頭)
  const dome = makeSkyDome(span, skyC, fogC, W);
  scene.add(dome);
  const clouds = makeClouds(span, skyC, W, Math.round((terrain.center?.lat ?? 0) * 1e4) * 31
    + Math.round((terrain.center?.lng ?? 0) * 1e4));
  if (clouds) scene.add(clouds.obj);
  const bodies = makeBodies(span);
  scene.add(bodies.obj);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  // 主光:白天是太陽、夜裡是月亮,**同一盞燈**換方向與顏色(兩盞的話換手那一刻會疊光)。
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(sun);
  scene.add(sun.target);     // target 是獨立物件:不進場景的話它的世界矩陣不會更新

  // ---- 影子 ----
  // 正交框**跟著相機走**(全圖一張陰影圖的話每 texel 好幾公尺,機體的影子連一個像素都不到)。
  // 開關由呼叫端給(visualPrefs `shadow` + `?shadow=0`):關著時這一整段等於不存在。
  const shadowOn = !!opts.shadow;
  const shSize = opts.lowPower ? SHADOW.SIZE_LOW : SHADOW.SIZE;
  const shR = shadowRangeM(shSize);
  if (shadowOn) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shSize, shSize);
    const c = sun.shadow.camera;
    c.left = -shR; c.right = shR; c.top = shR; c.bottom = -shR;
    c.near = 1; c.far = shR * 6;
    c.updateProjectionMatrix();
    sun.shadow.bias = SHADOW.BIAS;
    sun.shadow.normalBias = SHADOW.NORMAL_BIAS;
  }
  const shTexel = (shR * 2) / shSize;   // 位置量化到 texel:不量化的話相機一動影子邊緣就爬行

  let particles = null;
  if (W.particle) {
    particles = makeParticles(W.particle);
    scene.add(particles.obj);
  }

  // 空氣透視(雙色霧)給後製管線的四個值。**近/遠色與 scene.fog 的兩段距離 MUST 一起給** ——
  // 後製那一 pass 是用同一份 near/far 重算 fogFactor 再把近端色的差額補回去的(exact,
  // 不是近似);距離對不上就會在遠景留一圈色帶,而那看起來像「霧壞掉了」。
  // 物件識別**恆定**:呼叫端每幀拿同一個物件去餵 `pipeline.setAirFog`。
  const air = { near: new THREE.Color(), far: new THREE.Color(), fogNear: span * W.fogNear, fogFar: span * W.fogFar };

  const _sunD = new THREE.Vector3(), _moonD = new THREE.Vector3(), _lit = new THREE.Vector3();
  const _cam = new THREE.Object3D();   // 第一次 update 之前也要有相機位置(原點即可)
  const _fwd = new THREE.Vector3();
  const out = { air, hour: 0, sunUp: true };

  /** 把整份調色盤 + 光向重算到鐘點 h(每幀一次;只寫既有實例) */
  function setHour(h) {
    out.hour = h;
    const { a, b, t } = phaseBlend(h);
    mixTime(T, a, b, t);

    // 三行算式逐字沿用舊制(紀律③):只有 T 的來源換了
    skyC.copy(T.sky).multiply(tintC).multiplyScalar(W.light * 0.7 + 0.3);
    fogC.copy(W.fogTint !== undefined ? _tmpC.setHex(W.fogTint) : T.fogC).multiplyScalar(W.light * 0.6 + 0.4);
    sunC.copy(T.sun).multiply(tintC);
    scene.fog.color.copy(fogC);

    const stops = skyStops(skyC, fogC, W);
    const u = dome.material.uniforms;
    u.uH.value.copy(stops.horiz); u.uM.value.copy(stops.mid); u.uZ.value.copy(stops.zen);
    if (clouds) for (const m of clouds.mats) m.color.copy(skyC).lerp(WHITE, 0.55);

    hemi.color.copy(T.hemiSky); hemi.groundColor.copy(T.hemiGnd);
    hemi.intensity = T.hemiI * (W.light * 0.6 + 0.4) * S.mul;

    // 主光:太陽在地平線上就用太陽,否則用月亮。強度吃 `bodyFade` ⇒ 換手發生在兩者都
    // 淡到 0 的那一刻(A 家族的「不可以跳」:方向從西邊瞬移到東邊,但那時沒有影子可看)。
    const sd = sunDirAt(h), md = moonDirAt(h);
    _sunD.set(sd.x, sd.y, sd.z); _moonD.set(md.x, md.y, md.z);
    const up = sd.y > 0;
    out.sunUp = up;
    _lit.copy(up ? _sunD : _moonD);
    const fade = bodyFade(up ? sd.y : md.y);
    sun.color.copy(sunC);
    sun.intensity = T.sunI * W.light * S.mul * fade;
    setCelSun(_lit);   // 賽璐璐硬邊高光帶跟著當下的主光走(不是跟著開場那一格)

    // 月亮圓盤永遠是冷白,不吃季節色溫(那是日照的東西)
    moonC.setHex(TIMES.night.sun).lerp(WHITE, 0.45);
    // 「白天有多白」= 太陽的高度;圓盤的白日淡出吃它
    bodies.place(_cam, _sunD, _moonD, sunC, moonC, Math.max(0, Math.min(1, sd.y / 0.35)));
  }

  setHour(clockHour(startTime, 0));
  air.near.copy(nearFogColor(fogC, sunC, skyC, W)); air.far.copy(fogC);

  return Object.assign(out, {
    update(dt, camera, elapsedS = 0) {
      _cam.position.copy(camera.position);
      setHour(clockHour(startTime, elapsedS));
      // 空氣透視的兩個顏色跟著天色走(距離不變:那是地圖尺度,與時間無關)
      air.near.copy(nearFogColor(fogC, sunC, skyC, W)); air.far.copy(fogC);

      // 主光的位置:框心以相機為基準、**往視線前方推** `AHEAD_F`(玩家看的是前面,
      // 把框心放在腳底下等於把一半的 texel 花在背後),再沿光向退到框外。
      // **量化到 texel**:不量化的話相機每動一格,整張陰影圖的取樣格就偏半個 texel,
      // 影子邊緣會沿著幾何爬(shimmer)。
      _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); _fwd.y = 0;
      if (_fwd.lengthSq() > 1e-6) _fwd.normalize().multiplyScalar(shR * SHADOW.AHEAD_F);
      const q = shadowOn ? shTexel : 0;
      const px = camera.position.x + _fwd.x, pz = camera.position.z + _fwd.z;
      const cx = q ? Math.round(px / q) * q : px;
      const cz = q ? Math.round(pz / q) * q : pz;
      const cy = camera.position.y;
      sun.target.position.set(cx, cy, cz);
      sun.position.set(cx + _lit.x * shR * 2.5, cy + _lit.y * shR * 2.5, cz + _lit.z * shR * 2.5);

      particles?.update(dt, camera);
      // 穹頂/雲**恆以相機為中心**:天空沒有視差,不然走到地圖邊緣會看到「天空的邊」
      dome.position.copy(camera.position);
      if (clouds) {
        clouds.obj.position.copy(camera.position);
        // 時鐘吃 `celWindTime()`(植被/旗幟同一支):自己數一份 dt 的話,暫停一次就與地面錯開
        clouds.step(celWindTime());
      }
    },
    dispose() {
      scene.remove(hemi); scene.remove(sun); scene.remove(sun.target);
      if (particles) scene.remove(particles.obj);
      // A25:一次性 3D 物件移除 MUST 釋放 GPU 資源(貼圖是整場共用的快取,一律不動)
      scene.remove(dome);
      dome.geometry.dispose(); dome.material.dispose();
      scene.remove(bodies.obj); bodies.dispose();
      if (clouds) { scene.remove(clouds.obj); clouds.mats.forEach((m) => m.dispose()); }
    },
  });
}
