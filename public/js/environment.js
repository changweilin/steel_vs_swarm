// ============ 環境系統:季節 × 日夜 × 多元天氣 (environment.js) ============
// 依 battleConfig.env(開房時由伺服器定案,全房一致)設定:
//   - 7 維天氣屬性 (雲量/霧量/風量/雨量/沙量/雪量/雷量) 連續布朗運動演化
//   - 天色 / 霧 / 太陽(或月光)角度、色溫、強度、閃電打雷強光
//   - 雨 / 雪 / 沙塵粒子 (跟隨相機,隨風向動態傾斜與強度連動)
//   - 雲朵多尺度群聚、生滅、聚合分散與烏雲漸變
// 粒子手法參考 mapping_elf/weatherFx3D.js(程序生成、無外部資產)。
import * as THREE from 'three';
import {
  clockHour, phaseBlend, sunDirAt, moonDirAt, bodyFade,
  SHADOW, shadowRangeM, weatherAtTime, WEATHER_DYNAMICS, computeSolarSchedule, setSolarSchedule,
  weatherVectorAt, resolveWeatherDynamics, WEATHER_ATTRS, WEATHER_PRESETS,
} from './data.js';
import { setCelSun, WIND, celWindTime, INK_INFO_DECL, INK_INFO_NONE, setWeatherDynamics } from './toon.js';
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
const DARK_CLOUD_COLOR = new THREE.Color(0x23272e);
const FLASH_COLOR = new THREE.Color(0xdbeeff);

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

// 天氣:光量倍率 + 霧(near/far 為地圖跨距倍率)+ 粒子 (相容性與預設定義)
const WEATHERS = {
  clear:     { light: 1.0,  fogNear: 0.50, fogFar: 1.9 },
  cloudy:    { light: 0.58, fogNear: 0.40, fogFar: 1.6 },
  rain:      { light: 0.45, fogNear: 0.20, fogFar: 1.0, particle: 'rain' },
  heavy_rain:{ light: 0.40, fogNear: 0.16, fogFar: 0.90, particle: 'heavy_rain' },
  storm:     { light: 0.32, fogNear: 0.12, fogFar: 0.75, particle: 'storm', fogTint: 0x4a5568 },
  windy:     { light: 0.85, fogNear: 0.35, fogFar: 1.5, particle: 'wind' },
  sandstorm: { light: 0.38, fogNear: 0.08, fogFar: 0.55, particle: 'sand', fogTint: 0xc89858 },
  fog:       { light: 0.50, fogNear: 0.04, fogFar: 0.35 },
  snow:      { light: 0.60, fogNear: 0.22, fogFar: 1.1, particle: 'snow', fogTint: 0xcfd8dd },
  drizzle:   { light: 0.65, fogNear: 0.30, fogFar: 1.3, particle: 'drizzle' },
  blizzard:  { light: 0.35, fogNear: 0.10, fogFar: 0.65, particle: 'blizzard', fogTint: 0xd8e4ee },
};

// ---- 漸層天空穹頂 ----
const SKY_QUANT = 26;      // 柔量化階數(35% 混回原值:硬階梯太像色票,純漸層又不是賽璐璐)
const SKY_QUANT_MIX = 0.35;
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

/** 亮度封頂(保色相):超過就整體等比壓下來 */
function capLum(c, cap) {
  const l = lum(c);
  return l > cap && l > 1e-4 ? c.multiplyScalar(cap / l) : c;
}

const AIR_SUN_MIX = 0.35;
/**
 * 近霧色。由 fogC / sunC / skyC / W 推導,並吃同一道亮度封頂。
 */
function nearFogColor(fogC, sunC, skyC, W) {
  const near = fogC.clone().lerp(sunC, AIR_SUN_MIX);
  const fogFar = W?.fogFar ?? 1.5;
  const cap = fogFar <= 1.0 ? Math.min(lum(skyC), lum(fogC)) : lum(skyC);
  return capLum(near, cap);
}

/**
 * 三個停點(地平線 / 中段 / 天頂)。
 */
function skyStops(skyC, fogC, W) {
  const horiz = fogC.clone();
  const zen = skyC.clone().multiplyScalar(0.72);
  const mid = horiz.clone().lerp(zen, 0.45).multiplyScalar(1.06);
  const fogFar = W?.fogFar ?? 1.5;
  const cap = fogFar <= 1.0 ? Math.min(lum(skyC), lum(fogC)) : lum(skyC);
  for (const c of [mid, zen]) capLum(c, cap);
  return { horiz, mid, zen };
}

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
        ${INK_INFO_NONE}   // 天空沒有法線可給:寫哨兵 0
        float t = clamp( vH * 1.15 + 0.02, 0.0, 1.0 );
        float q = floor( t * ${SKY_QUANT}.0 ) / ${SKY_QUANT}.0;
        t = mix( t, q, ${SKY_QUANT_MIX} );
        vec3 c = t < 0.5 ? mix( uH, uM, t * 2.0 ) : mix( uM, uZ, ( t - 0.5 ) * 2.0 );
        gl_FragColor = vec4( c, 1.0 );
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(span * 1.5, 24, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  return dome;
}

/** 賽璐璐雲的貼圖:幾個硬邊圓疊出一朵,一張整場共用 */
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
 * 多元動態雲層系統:
 * 1. 雲量 (0~100%): 數量隨雲量遞增; >50% 轉為烏雲, 越黑且照度越低。
 * 2. 雲朵動態: 隨風漂移、微幅隨機飄動、生命週期顯現/消失。
 * 3. 聚合與分散: 小雲聚合成大雲 (Clustering), 大雲分散為小雲 (Dispersal)。
 */
const CLOUD_N = 26;        // 雲量基數;實際枚數與 WEATHERS[w].light 反比
const CLOUD_BOB = 0.015;      // 逐朵上下起伏
const CLOUD_BREATH = 0.08;    // 逐朵尺寸呼吸
function makeClouds(span, skyC, W, seed) {
  const n = Math.max(0, Math.round(CLOUD_N * (1.05 - W.light)));
  if (!n || W.fogNear <= 0.05) return null;
  const rnd = mulberry32(((seed ?? 0) ^ 0x93B7C1) >>> 0);
  const grp = new THREE.Group();
  const tex = cloudTexture();

  const numClusters = 7;
  const spritesPerCluster = 6;
  const totalClouds = numClusters * spritesPerCluster;

  const mat = new THREE.SpriteMaterial({
    map: tex, color: new THREE.Color(0xffffff), transparent: true, opacity: 0.85, depthWrite: false, fog: false,
  });

  const WRAP = span * 2.8;
  const clusters = [];
  for (let c = 0; c < numClusters; c++) {
    const a = (c / numClusters) * Math.PI * 2 + rnd() * 0.4;
    const r = span * (0.45 + rnd() * 0.85);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const y = span * (0.20 + rnd() * 0.35);
    const speedScale = 0.85 + rnd() * 0.3;
    const phase = rnd() * Math.PI * 2;
    clusters.push({ cx, cz, y, speedScale, phase, along: cx, side: cz });
  }

  const cloudItems = [];
  const drift = [];
  for (let i = 0; i < totalClouds; i++) {
    const cIdx = i % numClusters;
    const c = clusters[cIdx];
    const sp = new THREE.Sprite(mat.clone());
    grp.add(sp);

    const offA = rnd() * Math.PI * 2;
    const offR = span * (0.04 + rnd() * 0.12);
    const baseScale = span * (0.09 + rnd() * 0.14);
    const lifePeriod = 18.0 + rnd() * 14.0;
    const lifePhase = rnd() * Math.PI * 2;

    const item = {
      sp,
      cIdx,
      offX: Math.cos(offA) * offR,
      offZ: Math.sin(offA) * offR,
      baseScale,
      lifePeriod,
      lifePhase,
      bobPhase: rnd() * Math.PI * 2,
    };
    cloudItems.push(item);
    drift.push({ sp, along: c.cx + item.offX, side: c.cz + item.offZ, y: c.y, s: baseScale, ph: lifePhase });
  }

  grp.frustumCulled = false;
  grp.renderOrder = -9;

  let driftOffset = 0;
  return {
    obj: grp,
    mats: cloudItems.map((c) => c.sp.material),
    /**
     * @param {number} t 風時鐘
     * @param {number} dt 幀時間差
     * @param {THREE.Color} currentSkyC 天空顏色
     * @param {{ clouds:number, isDarkCloud:boolean, cloudDarkness:number, windDir:number[], windAmp:number }} dyn
     */
    step(t, dt, currentSkyC, dyn) {
      const cloudsPct = dyn?.clouds ?? 50;
      const darkness = dyn?.cloudDarkness ?? 0;
      const windDir = dyn?.windDir ?? [1, 0];
      const windAmp = dyn?.windAmp ?? 1.0;

      driftOffset += WIND.CLOUD_MPS * windAmp * (dt || 0.016);

      // 雲色更新: >50% 時由亮白/天色過渡為烏雲黑灰色
      const baseCloudColor = (currentSkyC || skyC).clone().lerp(WHITE, 0.70);
      if (dyn?.isDarkCloud) {
        baseCloudColor.lerp(DARK_CLOUD_COLOR, Math.min(1.0, darkness * 0.90));
      }

      // 可見雲數比例 (0% 雲量時極少/淡, 100% 雲量時全滿/厚)
      const cloudCoverage = Math.max(0.05, Math.min(1.0, cloudsPct / 100));

      for (let i = 0; i < cloudItems.length; i++) {
        const item = cloudItems[i];
        const d = drift[i];
        const c = clusters[item.cIdx];

        const a = ((d.along + WIND.CLOUD_MPS * t + WRAP * 0.5) % WRAP + WRAP) % WRAP - WRAP * 0.5;

        // 1. 生命週期淡入淡出 (顯現 / 消失)
        const life = Math.sin(t * (Math.PI * 2 / item.lifePeriod) + item.lifePhase) * 0.5 + 0.5;
        const fadeAlpha = Math.max(0, Math.min(1, life * 1.5 - 0.2)) * cloudCoverage;

        // 2. 小雲匯聚成大雲 (Clustering) 與 大雲分散為小雲 (Dispersal)
        const clusterPulse = Math.sin(t * 0.12 + c.phase) * 0.5 + 0.5; // [0, 1] 聚合 -> 分散循環
        const clusterMerge = (cloudsPct > 50 ? 0.35 : 0.65) * clusterPulse + (cloudsPct > 50 ? 0.45 : 0.15);
        // 匯聚時 offset 縮小且 scale 放大; 分散時 offset 擴散且 scale 縮小
        const curOffX = item.offX * (1.6 - clusterMerge * 0.9);
        const curOffZ = item.offZ * (1.6 - clusterMerge * 0.9);
        const scaleMul = (0.7 + clusterMerge * 0.7) * (1 + Math.sin(t * 0.2 + item.bobPhase) * CLOUD_BREATH);

        const posX = a * windDir[0] - d.side * windDir[1] + curOffX;
        const posZ = a * windDir[1] + d.side * windDir[0] + curOffZ;
        const posY = d.y + Math.sin(t * 0.14 + item.bobPhase) * span * CLOUD_BOB;

        item.sp.position.set(posX, posY, posZ);
        item.sp.scale.set(item.baseScale * 2 * scaleMul, item.baseScale * scaleMul, 1);
        item.sp.material.color.copy(baseCloudColor);
        item.sp.material.opacity = fadeAlpha * (dyn?.isDarkCloud ? 0.92 : 0.75);
        item.sp.visible = fadeAlpha > 0.02;
      }
    },
  };
}

function makeBodies(span) {
  const grp = new THREE.Group();
  const BODY_R_F = 0.055, MOON_R_F = 0.050, BODY_DIST_F = 1.25;

  function bodyTexture(kind) {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const C = S / 2;
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
      g.fillStyle = 'rgba(150,162,182,0.55)';
      for (const [dx, dy, r] of [[-0.09, -0.07, 0.085], [0.07, 0.03, 0.065], [-0.02, 0.11, 0.05], [0.12, -0.10, 0.04]]) {
        g.beginPath(); g.arc(C + dx * S, C + dy * S, r * S, 0, Math.PI * 2); g.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const mk = (kind, rf) => {
    const tex = bodyTexture(kind);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const sp = new THREE.Sprite(mat);
    const r = span * BODY_DIST_F * rf;
    sp.scale.set(r * 2, r * 2, 1);
    grp.add(sp);
    return { sp, mat, tex };
  };
  const sun = mk('sun', BODY_R_F), moon = mk('moon', MOON_R_F);
  grp.frustumCulled = false;
  grp.renderOrder = -9.5;
  return {
    obj: grp,
    place(camera, sunDir, moonDir, sunC, moonC, dayness) {
      const D = span * BODY_DIST_F;
      for (const [b, d, c, a] of [
        [sun, sunDir, sunC, bodyFade(sunDir.y)],
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

/**
 * 粒子系統 (雨 / 沙 / 雪 / 風微粒):
 * 根據多元天氣之有效雨量 (effectiveRain)、沙量 (effectiveSand)、雪量 (effectiveSnow) 與即時風向風力更新。
 */
function makeParticles() {
  const systems = {};
  const kinds = ['rain', 'sand', 'snow', 'wind'];
  const grp = new THREE.Group();

  for (const k of kinds) {
    let N = 1600, size = 0.55, speed = 90, color = 0x9db8cc;
    if (k === 'rain')       { N = 2400; size = 0.65; speed = 110; color = 0x98b2c6; }
    else if (k === 'sand')  { N = 2000; size = 1.25; speed = 45;  color = 0xd4a359; }
    else if (k === 'snow')  { N = 1800; size = 1.20; speed = 14;  color = 0xffffff; }
    else if (k === 'wind')  { N = 600;  size = 0.90; speed = 25;  color = 0xd8e4ee; }

    const BOX = 260, H = 180, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 1] = Math.random() * H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      seed[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0, sizeAttenuation: true, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    grp.add(pts);
    systems[k] = { pts, geo, mat, N, BOX, H, seed, speed };
  }

  let t = 0;
  return {
    obj: grp,
    /**
     * @param {number} dt
     * @param {THREE.Camera} camera
     * @param {{ effectiveRain:number, effectiveSand:number, effectiveSnow:number, wind:number, windAmp:number, windDir:number[] }} dyn
     */
    update(dt, camera, dyn) {
      t += dt;
      const windDir = dyn?.windDir ?? [1, 0];
      const windAmp = dyn?.windAmp ?? 1.0;
      const effRain = dyn?.effectiveRain ?? 0;
      const effSand = dyn?.effectiveSand ?? 0;
      const effSnow = dyn?.effectiveSnow ?? 0;
      const windPct = dyn?.wind ?? 0;

      for (const [k, sys] of Object.entries(systems)) {
        let isActive = false;
        let targetOpacity = 0;
        let driftSpeedX = windDir[0] * windAmp;
        let driftSpeedZ = windDir[1] * windAmp;

        if (k === 'rain' && effRain > 0.01) {
          isActive = true;
          targetOpacity = Math.min(0.85, 0.25 + effRain * 0.60);
          driftSpeedX *= 28;
          driftSpeedZ *= 28;
        } else if (k === 'sand' && effSand > 0.01) {
          isActive = true;
          targetOpacity = Math.min(0.80, 0.30 + effSand * 0.50);
          driftSpeedX *= 42;
          driftSpeedZ *= 42;
        } else if (k === 'snow' && effSnow > 0.01) {
          isActive = true;
          targetOpacity = Math.min(0.90, 0.35 + effSnow * 0.55);
          driftSpeedX *= 16;
          driftSpeedZ *= 16;
        } else if (k === 'wind' && windPct > 55 && !effRain && !effSand && !effSnow) {
          isActive = true;
          targetOpacity = Math.min(0.50, ((windPct - 55) / 45) * 0.45);
          driftSpeedX *= 35;
          driftSpeedZ *= 35;
        }

        sys.pts.visible = isActive;
        if (!isActive) continue;

        sys.mat.opacity = targetOpacity;
        sys.pts.position.set(camera.position.x, camera.position.y - sys.H * 0.45, camera.position.z);
        const p = sys.geo.attributes.position;

        for (let i = 0; i < sys.N; i++) {
          let y = p.array[i * 3 + 1] - sys.speed * dt;
          let px = p.array[i * 3] + driftSpeedX * dt;
          let pz = p.array[i * 3 + 2] + driftSpeedZ * dt;

          if (k === 'snow') {
            px += Math.sin(t * 1.5 + sys.seed[i]) * dt * 5;
            pz += Math.cos(t * 1.3 + sys.seed[i]) * dt * 5;
          }

          if (y < 0) {
            y = sys.H;
            px = (Math.random() - 0.5) * sys.BOX;
            pz = (Math.random() - 0.5) * sys.BOX;
          }
          if (px > sys.BOX * 0.5) px -= sys.BOX;
          else if (px < -sys.BOX * 0.5) px += sys.BOX;
          if (pz > sys.BOX * 0.5) pz -= sys.BOX;
          else if (pz < -sys.BOX * 0.5) pz += sys.BOX;

          p.array[i * 3] = px;
          p.array[i * 3 + 1] = y;
          p.array[i * 3 + 2] = pz;
        }
        sys.geo.attributes.position.needsUpdate = true;
      }
    },
    dispose() { for (const sys of Object.values(systems)) { sys.geo.dispose(); sys.mat.dispose(); } },
  };
}

export function applyEnvironment(scene, terrain, env, opts = {}) {
  const span = Math.max(terrain.worldW, terrain.worldH);
  const startTime = TIMES[env?.time] ? env.time : 'day';
  const startSeason = env?.season || 'summer';
  const startWeather = env?.weather || 'clear';
  const latDeg = terrain?.center?.lat ?? 25.0;
  const seed = Math.round((terrain.center?.lat ?? 0) * 1e4) * 31 + Math.round((terrain.center?.lng ?? 0) * 1e4);

  const sched = computeSolarSchedule(startSeason, latDeg);
  const S = SEASONS[startSeason] || SEASONS.summer;
  setSolarSchedule(sched);

  let weatherVec = weatherVectorAt(startSeason, startTime, startWeather, 0, seed, latDeg);
  let curDyn = resolveWeatherDynamics(weatherVec);
  setWeatherDynamics(curDyn);

  const tintC = new THREE.Color(S.tint);
  const T = newPhase();
  const skyC = new THREE.Color();
  const fogC = new THREE.Color();
  const sunC = new THREE.Color();
  const moonC = new THREE.Color();

  scene.background = skyC;
  scene.fog = new THREE.Fog(0x000000, span * curDyn.fogNear, span * curDyn.fogFar);

  const dome = makeSkyDome(span, skyC, fogC, curDyn);
  scene.add(dome);

  const clouds = makeClouds(span, skyC, curDyn, seed);
  if (clouds) scene.add(clouds.obj);

  const bodies = makeBodies(span);
  scene.add(bodies.obj);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(sun);
  scene.add(sun.target);

  const shadowOn = !!opts.shadow;
  const shSize = opts.lowPower ? SHADOW.SIZE_LOW : SHADOW.SIZE;
  const shR = shadowRangeM(shSize);
  if (shadowOn) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shSize, shSize);
    const c = sun.shadow.camera;
    c.left = -shR; c.right = shR; c.top = shR; c.bottom = -shR; c.near = 1; c.far = shR * 6;
    c.updateProjectionMatrix();
    sun.shadow.bias = SHADOW.BIAS;
    sun.shadow.normalBias = SHADOW.NORMAL_BIAS;
  }
  const shTexel = (shR * 2) / shSize;

  const particles = makeParticles();
  scene.add(particles.obj);

  const air = { near: new THREE.Color(), far: new THREE.Color(), fogNear: span * curDyn.fogNear, fogFar: span * curDyn.fogFar };
  const _sunD = new THREE.Vector3(), _moonD = new THREE.Vector3(), _lit = new THREE.Vector3(), _cam = new THREE.Object3D(), _fwd = new THREE.Vector3();

  // 雷電計時器
  let lightningTimer = 4.0;
  let flashTimer = 0;
  let flashStrength = 0;

  const out = { air, hour: 0, sunUp: true, weather: curDyn.dominantWeather, weatherVec, dynamics: curDyn };

  function setHour(h) {
    out.hour = h;
    out.weather = curDyn.dominantWeather;
    out.weatherVec = weatherVec;
    out.dynamics = curDyn;

    const { a, b, t } = phaseBlend(h);
    mixTime(T, a, b, t);

    skyC.copy(T.sky).multiply(tintC).multiplyScalar(curDyn.light * 0.7 + 0.3);

    // 沙塵暴與雪景微調
    if (curDyn.effectiveSand > 0.1) {
      _tmpC.setHex(0xc89858);
      fogC.copy(T.fogC).lerp(_tmpC, curDyn.effectiveSand * 0.7).multiplyScalar(curDyn.light * 0.6 + 0.4);
    } else if (curDyn.isFrozen) {
      _tmpC.setHex(0xd8e6f0);
      fogC.copy(T.fogC).lerp(_tmpC, 0.4).multiplyScalar(curDyn.light * 0.6 + 0.4);
    } else {
      fogC.copy(T.fogC).multiplyScalar(curDyn.light * 0.6 + 0.4);
    }

    sunC.copy(T.sun).multiply(tintC);

    // 閃電強光頻閃
    if (flashStrength > 0) {
      skyC.lerp(FLASH_COLOR, Math.min(0.85, flashStrength * 0.75));
      fogC.lerp(FLASH_COLOR, Math.min(0.80, flashStrength * 0.70));
      sunC.lerp(FLASH_COLOR, Math.min(0.90, flashStrength * 0.85));
    }

    scene.fog.color.copy(fogC);

    const stops = skyStops(skyC, fogC, curDyn);
    const u = dome.material.uniforms;
    u.uH.value.copy(stops.horiz);
    u.uM.value.copy(stops.mid);
    u.uZ.value.copy(stops.zen);

    hemi.color.copy(T.hemiSky);
    hemi.groundColor.copy(T.hemiGnd);
    hemi.intensity = (T.hemiI * (curDyn.light * 0.6 + 0.4) * S.mul) + (flashStrength * 3.5);

    const sd = sunDirAt(h), md = moonDirAt(h);
    _sunD.set(sd.x, sd.y, sd.z);
    _moonD.set(md.x, md.y, md.z);
    const up = sd.y > 0;
    out.sunUp = up;
    _lit.copy(up ? _sunD : _moonD);
    const fade = bodyFade(up ? sd.y : md.y);
    sun.color.copy(sunC);
    sun.intensity = (T.sunI * curDyn.light * S.mul * fade) + (flashStrength * 5.0);
    setCelSun(_lit);

    moonC.setHex(TIMES.night.sun).lerp(WHITE, 0.45);
    bodies.place(_cam, _sunD, _moonD, sunC, moonC, Math.max(0, Math.min(1, sd.y / 0.35)));
  }

  setHour(clockHour(startTime, 0, sched.startH));
  air.near.copy(nearFogColor(fogC, sunC, skyC, curDyn));
  air.far.copy(fogC);

  return Object.assign(out, {
    update(dt, camera, elapsedS = 0) {
      _cam.position.copy(camera.position);

      // 1. 連續 7 維布朗運動與四季時段氣候演化
      weatherVec = weatherVectorAt(startSeason, startTime, startWeather, elapsedS, seed, latDeg);
      curDyn = resolveWeatherDynamics(weatherVec);
      setWeatherDynamics(curDyn);

      // 2. 打雷閃電系統 (>75% 觸發頻閃)
      flashStrength = 0;
      if (curDyn.effectiveThunder > 0.01) {
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          flashTimer = 0.22 + (Math.sin(elapsedS * 13.7) * 0.5 + 0.5) * 0.15;
          lightningTimer = Math.max(1.8, (1.0 - curDyn.effectiveThunder) * 7.5 + (Math.sin(elapsedS * 7.9) * 0.5 + 0.5) * 3.5);
        }
        if (flashTimer > 0) {
          flashTimer -= dt;
          flashStrength = Math.sin(flashTimer * 42.0) > 0 ? (flashTimer / 0.25) * curDyn.effectiveThunder : 0;
        }
      }

      // 3. 推進日照時段與更新光影
      const h = clockHour(startTime, elapsedS, sched.startH);
      setHour(h);

      // 4. 能見度與空氣透視動態調整
      scene.fog.near = span * curDyn.fogNear;
      scene.fog.far = span * curDyn.fogFar;
      air.fogNear = span * curDyn.fogNear;
      air.fogFar = span * curDyn.fogFar;
      air.near.copy(nearFogColor(fogC, sunC, skyC, curDyn));
      air.far.copy(fogC);

      // 5. 陰影相機前方推移與量化
      _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      _fwd.y = 0;
      if (_fwd.lengthSq() > 1e-6) _fwd.normalize().multiplyScalar(shR * SHADOW.AHEAD_F);
      const q = shadowOn ? shTexel : 0;
      const px = camera.position.x + _fwd.x, pz = camera.position.z + _fwd.z;
      const cx = q ? Math.round(px / q) * q : px;
      const cz = q ? Math.round(pz / q) * q : pz;
      const cy = camera.position.y;
      sun.target.position.set(cx, cy, cz);
      sun.position.set(cx + _lit.x * shR * 2.5, cy + _lit.y * shR * 2.5, cz + _lit.z * shR * 2.5);

      // 6. 粒子與雲群動態步進
      particles.update(dt, camera, curDyn);

      dome.position.copy(camera.position);
      if (clouds) {
        clouds.obj.position.copy(camera.position);
        clouds.step(celWindTime(), dt, skyC, curDyn);
      }
    },
    dispose() {
      scene.remove(hemi);
      scene.remove(sun);
      scene.remove(sun.target);
      scene.remove(particles.obj);
      particles.dispose();
      scene.remove(dome);
      dome.geometry.dispose(); dome.material.dispose();
      scene.remove(bodies.obj);
      bodies.dispose();
      if (clouds) {
        scene.remove(clouds.obj);
        clouds.mats.forEach((m) => m.dispose());
      }
    },
  });
}
