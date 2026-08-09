// ============ 環境系統:季節 × 日夜 × 天氣 ============
// 依 battleConfig.env(開房時由伺服器定案,全房一致)設定:
//   - 天色 / 霧 / 太陽(或月光)角度、色溫、強度
//   - 雨 / 雪粒子(跟隨相機的粒子盒,便宜又看不出邊界)
// 粒子手法參考 mapping_elf/weatherFx3D.js(程序生成、無外部資產)。
import * as THREE from 'three';
import { ENV } from './data.js';
import { setCelSun, WIND, celWindTime } from './toon.js';
import { mulberry32 } from './rng.js';

export function envLabel(env) {
  if (!env) return '';
  const s = ENV.seasons[env.season]?.name || '?';
  const t = ENV.times[env.time]?.name || '?';
  const w = ENV.weathers[env.weather]?.name || '?';
  return `${s}・${t}・${w}`;
}

// 日夜基調
const TIMES = {
  day:   { sky: 0x8fa9bd, fogC: 0x9aacba, sun: 0xfff2dd, sunI: 1.30, hemiSky: 0x9fb4c8, hemiGnd: 0x3a352c, hemiI: 0.85, elev: 0.55 },
  dusk:  { sky: 0x8a5a46, fogC: 0x7a5a4c, sun: 0xff9a4d, sunI: 0.95, hemiSky: 0xc98a6a, hemiGnd: 0x2a2430, hemiI: 0.60, elev: 0.16 },
  night: { sky: 0x0a1220, fogC: 0x0d1522, sun: 0x9db8e8, sunI: 0.30, hemiSky: 0x2a3a55, hemiGnd: 0x11141a, hemiI: 0.35, elev: 0.45 },
};
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
      uniform vec3 uH; uniform vec3 uM; uniform vec3 uZ;
      varying float vH;
      void main() {
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
 * 回傳 { update(dt, camera), dispose() }。
 */
export function applyEnvironment(scene, terrain, env) {
  const span = Math.max(terrain.worldW, terrain.worldH);
  const T = TIMES[env?.time] || TIMES.day;
  const S = SEASONS[env?.season] || SEASONS.summer;
  const W = WEATHERS[env?.weather] || WEATHERS.clear;

  const skyC = new THREE.Color(T.sky).multiply(new THREE.Color(S.tint)).multiplyScalar(W.light * 0.7 + 0.3);
  const fogC = new THREE.Color(W.fogTint ?? T.fogC).multiplyScalar(W.light * 0.6 + 0.4);
  scene.background = skyC;   // 穹頂沒畫到的像素(建構失敗/極端視角)仍是舊行為
  scene.fog = new THREE.Fog(fogC, span * W.fogNear, span * W.fogFar);

  // 漸層穹頂 + 賽璐璐雲(顏色全由上面三張表推導,見 makeSkyDome 檔頭)
  const dome = makeSkyDome(span, skyC, fogC, W);
  scene.add(dome);
  const clouds = makeClouds(span, skyC, W, Math.round((terrain.center?.lat ?? 0) * 1e4) * 31
    + Math.round((terrain.center?.lng ?? 0) * 1e4));
  if (clouds) scene.add(clouds.obj);

  const hemi = new THREE.HemisphereLight(T.hemiSky, T.hemiGnd, T.hemiI * (W.light * 0.6 + 0.4) * S.mul);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(
    new THREE.Color(T.sun).multiply(new THREE.Color(S.tint)),
    T.sunI * W.light * S.mul,
  );
  const az = env?.time === 'dusk' ? 0.9 : 0.4;   // 黃昏太陽壓低偏西
  sun.position.set(span * Math.cos(az), span * T.elev, span * Math.sin(az) * 0.5);
  scene.add(sun);
  setCelSun(sun.position);   // 賽璐璐硬邊高光帶跟著本場太陽走

  let particles = null;
  if (W.particle) {
    particles = makeParticles(W.particle);
    scene.add(particles.obj);
  }

  return {
    update(dt, camera) {
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
      scene.remove(hemi); scene.remove(sun);
      if (particles) scene.remove(particles.obj);
      // A25:一次性 3D 物件移除 MUST 釋放 GPU 資源(貼圖是整場共用的快取,一律不動)
      scene.remove(dome);
      dome.geometry.dispose(); dome.material.dispose();
      if (clouds) { scene.remove(clouds.obj); clouds.mats.forEach((m) => m.dispose()); }
    },
  };
}
