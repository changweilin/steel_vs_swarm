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
  UNITS,
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

// 天氣:光量倍率 + 霧(near/far 為地圖跨距倍率)+ 粒子 (8 大天氣預設定義)
const WEATHERS = {
  clear:     { light: 1.0,  fogNear: 0.50, fogFar: 1.9 },
  cloudy:    { light: 0.58, fogNear: 0.40, fogFar: 1.6 },
  heavy_rain:{ light: 0.40, fogNear: 0.16, fogFar: 0.90, particle: 'heavy_rain' },
  storm:     { light: 0.32, fogNear: 0.12, fogFar: 0.75, particle: 'storm', fogTint: 0x4a5568 },
  windy:     { light: 0.85, fogNear: 0.35, fogFar: 1.5 },
  sandstorm: { light: 0.38, fogNear: 0.08, fogFar: 0.55, particle: 'sand', fogTint: 0xc89858 },
  fog:       { light: 0.50, fogNear: 0.02, fogFar: 0.25 },
  snow:      { light: 0.60, fogNear: 0.22, fogFar: 1.1, particle: 'snow', fogTint: 0xcfd8dd },
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

/** 穹頂刻意不吃世界曲面:天空在無限遠,不彎是對的 */
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

/** 賽璐璐雲的多樣態貼圖:多種硬邊圓程序化疊合形態,整場共享 */
let _cloudTextures = null;
function cloudTextures() {
  if (_cloudTextures) return _cloudTextures;
  const S = 128;
  const puffConfigs = [
    // 1. 標準積雲 (典型多丘起伏)
    [[0.28, 0.62, 0.20], [0.46, 0.44, 0.28], [0.68, 0.58, 0.22], [0.84, 0.66, 0.14]],
    // 2. 扁平層積雲 (橫向延展)
    [[0.20, 0.64, 0.15], [0.38, 0.52, 0.24], [0.58, 0.46, 0.26], [0.76, 0.52, 0.22], [0.88, 0.65, 0.12]],
    // 3. 高聳堡狀雲 (中央隆起圓頂)
    [[0.25, 0.58, 0.20], [0.48, 0.36, 0.32], [0.72, 0.52, 0.23], [0.52, 0.66, 0.16]],
    // 4. 複合滾軸雲 (雙峰交疊)
    [[0.24, 0.60, 0.18], [0.42, 0.42, 0.26], [0.62, 0.40, 0.25], [0.80, 0.58, 0.17], [0.36, 0.38, 0.16]],
    // 5. 飄逸卷積雲 (尾翼拖曳)
    [[0.18, 0.66, 0.13], [0.34, 0.56, 0.21], [0.54, 0.48, 0.27], [0.74, 0.54, 0.20], [0.90, 0.68, 0.10]],
    // 6. 緊湊團塊雲 (圓潤豐滿)
    [[0.30, 0.54, 0.22], [0.50, 0.42, 0.30], [0.70, 0.50, 0.25], [0.40, 0.64, 0.18], [0.60, 0.64, 0.18]],
    // 7. 斜向羽狀雲 (不對稱掠風)
    [[0.22, 0.68, 0.14], [0.40, 0.58, 0.22], [0.60, 0.46, 0.28], [0.82, 0.40, 0.22], [0.88, 0.62, 0.12]],
    // 8. 廣域砧狀雲 (寬頂覆蓋)
    [[0.26, 0.48, 0.24], [0.48, 0.40, 0.29], [0.70, 0.44, 0.27], [0.38, 0.66, 0.17], [0.62, 0.66, 0.17]],
  ];
  _cloudTextures = puffConfigs.map((puffs) => {
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S / 2;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    for (const [cx, cy, r] of puffs) {
      g.beginPath(); g.arc(cx * S, cy * S / 2, r * S / 2 * 2, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
  return _cloudTextures;
}

/**
 * 多元動態雲層系統:
 * 1. 雲量 (0~100%): 控制水平密度; >50% 轉為烏雲, 越黑且照度越低。
 * 2. 雲朵動態: 隨風漂移、微幅隨機飄動、生命週期顯現/消失。
 * 3. 聚合與分散: 小雲聚合成大雲 (Clustering), 大雲分散為小雲 (Dispersal)。
 * 4. 緩慢變形機制: 多頻非對稱縱橫拉伸、內部子結構慢速旋流位移與風切微旋轉。
 */
const CLOUD_N = 28;        // 雲量基數;實際枚數與 WEATHERS[w].light 反比
const CLOUD_BOB = 0.015;      // 逐朵上下起伏
const CLOUD_BREATH = 0.08;    // 逐朵尺寸呼吸
function makeClouds(span, skyC, W, seed) {
  if (W?.fogNear <= 0.05) return null;
  const rnd = mulberry32(((seed ?? 0) ^ 0x93B7C1) >>> 0);
  const grp = new THREE.Group();
  const texs = cloudTextures();

  const numClusters = 12;
  const spritesPerCluster = 6;
  const totalClouds = numClusters * spritesPerCluster; // 72 枚雲朵群

  const WRAP = span * 3.2;
  const clusters = [];
  for (let c = 0; c < numClusters; c++) {
    const a = (c / numClusters) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const r = span * (0.15 + (c % 4) * 0.28 + rnd() * 0.22);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const y = span * (0.20 + (c % 3) * 0.08 + rnd() * 0.09);
    const speedScale = 0.85 + rnd() * 0.3;
    const phase = rnd() * Math.PI * 2;
    clusters.push({ cx, cz, y, speedScale, phase, along: cx, side: cz });
  }

  const cloudItems = [];
  const drift = [];
  for (let i = 0; i < totalClouds; i++) {
    const cIdx = i % numClusters;
    const c = clusters[cIdx];
    const tex = texs[i % texs.length];
    const spMat = new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(0xffffff), transparent: true, opacity: 0.85, depthWrite: false, fog: false,
    });
    const sp = new THREE.Sprite(spMat);
    grp.add(sp);

    const offA = rnd() * Math.PI * 2;
    const offR = span * (0.05 + rnd() * 0.16);
    const baseScale = span * (0.10 + rnd() * 0.16);
    // 初始形狀形態多樣化 (非對稱寬高比與層級高度初始偏移)
    const baseScaleX = baseScale * (0.90 + rnd() * 0.40);
    const baseScaleY = baseScale * (0.80 + rnd() * 0.35);
    const tierAltitude = (rnd() - 0.5) * span * 0.09;
    const lifePeriod = 18.0 + rnd() * 14.0;
    const lifePhase = rnd() * Math.PI * 2;

    // 緩慢變形參數 (慢速非線性多頻相位與速率，週期 25s ~ 60s)
    const morphSpeedX = 0.035 + rnd() * 0.025;
    const morphSpeedY = 0.028 + rnd() * 0.022;
    const morphPhaseX = rnd() * Math.PI * 2;
    const morphPhaseY = rnd() * Math.PI * 2;
    const rotSpeed = 0.015 + rnd() * 0.018;
    const rotPhase = rnd() * Math.PI * 2;
    const rot0 = (rnd() - 0.5) * 0.25;
    const swirlSpeed = 0.020 + rnd() * 0.025;
    const swirlPhase = rnd() * Math.PI * 2;

    const item = {
      sp,
      cIdx,
      offA,
      offR,
      baseScaleX,
      baseScaleY,
      tierAltitude,
      lifePeriod,
      lifePhase,
      bobPhase: rnd() * Math.PI * 2,
      morphSpeedX,
      morphSpeedY,
      morphPhaseX,
      morphPhaseY,
      rotSpeed,
      rotPhase,
      rot0,
      swirlSpeed,
      swirlPhase,
    };
    cloudItems.push(item);
    drift.push({ sp, along: c.cx + Math.cos(offA) * offR, side: c.cz + Math.sin(offA) * offR, y: c.y + tierAltitude, s: baseScale, ph: lifePhase });
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
     * @param {{ clouds:number, fog:number, effectiveFog:number, isDarkCloud:boolean, cloudDarkness:number, windDir:number[], windAmp:number }} dyn
     */
    step(t, dt, currentSkyC, dyn) {
      const cloudsPct = dyn?.clouds ?? 50;
      const fogPct = dyn?.fog ?? 0;
      const darkness = dyn?.cloudDarkness ?? 0;
      const windDir = dyn?.windDir ?? [1, 0];
      const windAmp = dyn?.windAmp ?? 1.0;

      // 1. 高空風力直接驅動雲層飄移速度 (Wind drift speed)
      driftOffset += WIND.CLOUD_MPS * windAmp * (dt || 0.016);

      // 雲色更新: >50% 時由亮白/天色過渡為烏雲黑灰色
      const baseCloudColor = (currentSkyC || skyC).clone().lerp(WHITE, 0.70);
      if (dyn?.isDarkCloud) {
        baseCloudColor.lerp(DARK_CLOUD_COLOR, Math.min(1.0, darkness * 0.90));
      }

      // 2. 雲朵數量與雲量成嚴格正比，並受霧數值垂直擴展與低空凝結增益
      const fogFactor = fogPct / 100;
      const fogCountBoost = fogFactor * 0.20;
      const activeRatio = Math.max(0.08, Math.min(1.0, Math.pow(cloudsPct / 100, 0.85) + fogCountBoost));
      const activeCount = Math.min(totalClouds, Math.max(4, Math.round(totalClouds * activeRatio)));

      // 3. 陰天時 (>=50%) 大幅擴展雲朵尺寸與水平覆蓋率，使一半以上的天空都是雲朵
      const overcastF = Math.max(0, (cloudsPct - 40) / 60);
      const scaleFactor = (0.80 + (cloudsPct / 100) * 1.30) * (1.0 + overcastF * 0.50);
      const spreadFactor = 0.55 + (cloudsPct / 100) * 0.90;
      const cloudCoverage = Math.max(0.08, Math.min(1.0, (cloudsPct / 100) * 1.15));

      // 4. 霧數值垂直擴展: 越濃雲朵最小高度越低 (貼近地平線與低空)，且垂直厚度展布越大
      const minAltitude = span * Math.max(0.04, 0.26 * (1.0 - fogFactor * 0.85) + 0.04);
      const vertExpansion = 1.0 + fogFactor * 0.75;

      for (let i = 0; i < cloudItems.length; i++) {
        const item = cloudItems[i];
        if (i >= activeCount) {
          item.sp.visible = false;
          continue;
        }

        const d = drift[i];
        const c = clusters[item.cIdx];

        // 5. 風力直接驅動雲層飄移位置 (Wind drift position)
        const a = ((d.along + WIND.CLOUD_MPS * windAmp * t + WRAP * 0.5) % WRAP + WRAP) % WRAP - WRAP * 0.5;

        // 生命週期淡入淡出 (顯現 / 消失)
        const life = Math.sin(t * (Math.PI * 2 / item.lifePeriod) * Math.max(0.5, windAmp * 0.8) + item.lifePhase) * 0.5 + 0.5;
        const fadeAlpha = Math.max(0, Math.min(1, life * 1.5 - 0.15)) * cloudCoverage;

        // 6. 風力驅動高空聚散速率 (Clustering & Dispersal pulse frequency scales with windAmp)
        const clusterPulse = Math.sin(t * 0.12 * Math.max(0.4, windAmp) + c.phase) * 0.5 + 0.5; // 聚合 -> 分散循環
        const clusterMerge = (cloudsPct > 50 ? 0.35 : 0.65) * clusterPulse + (cloudsPct > 50 ? 0.45 : 0.15);

        // 7. 緩慢變形動態 (Slow Morphing Dynamics, 速率隨風力加乘)
        // a. 雲團內部子結構慢速旋流位移 (Swirl Deformation)
        const curSwirlA = item.offA + Math.sin(t * item.swirlSpeed * Math.max(0.5, windAmp) + item.swirlPhase) * 0.45;
        const curSwirlR = item.offR * (0.85 + Math.cos(t * item.swirlSpeed * Math.max(0.5, windAmp) * 1.3 + item.swirlPhase) * 0.30);
        const curOffX = Math.cos(curSwirlA) * curSwirlR * (1.6 - clusterMerge * 0.9) * spreadFactor;
        const curOffZ = Math.sin(curSwirlA) * curSwirlR * (1.6 - clusterMerge * 0.9) * spreadFactor;

        // b. 縱橫非對稱拉伸變形 (Aspect-Ratio Stretch Morphing)
        const morphX = 1.0 + Math.sin(t * item.morphSpeedX * Math.max(0.5, windAmp) + item.morphPhaseX) * 0.26 + Math.cos(t * item.morphSpeedX * 0.47) * 0.08;
        const morphY = 1.0 + Math.cos(t * item.morphSpeedY * Math.max(0.5, windAmp) + item.morphPhaseY) * 0.22 + Math.sin(t * item.morphSpeedY * 0.53) * 0.07;
        const scaleMul = (0.75 + clusterMerge * 0.75) * (1 + Math.sin(t * 0.2 * Math.max(0.5, windAmp) + item.bobPhase) * CLOUD_BREATH);

        // c. 風切與渦流慢速自轉微傾 (Eddy Rotation Morphing)
        item.sp.material.rotation = item.rot0 + Math.sin(t * item.rotSpeed * Math.max(0.5, windAmp) + item.rotPhase) * 0.16 + Math.cos(t * item.rotSpeed * 0.38) * 0.05;

        const posX = a * windDir[0] - d.side * windDir[1] + curOffX;
        const posZ = a * windDir[1] + d.side * windDir[0] + curOffZ;

        // 雲層垂直高度: 霧越濃，雲底越低 (minAltitude)，垂直跨度 (vertExpansion) 越大
        const posY = minAltitude + (d.y - span * 0.18) * vertExpansion + Math.sin(t * 0.14 * Math.max(0.5, windAmp) + item.bobPhase) * span * CLOUD_BOB;

        item.sp.position.set(posX, posY, posZ);
        item.sp.scale.set(item.baseScaleX * 2 * scaleMul * morphX * scaleFactor, item.baseScaleY * scaleMul * morphY * scaleFactor, 1);
        item.sp.material.color.copy(baseCloudColor);
        item.sp.material.opacity = fadeAlpha * (dyn?.isDarkCloud ? 0.95 : 0.80);
        item.sp.visible = fadeAlpha > 0.01;
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

/** 粒子專屬程序化 Canvas 紋理快取 (雨絲 / 結晶雪花 / 粗粒砂塵) */
let _particleTextures = null;
function particleTextures() {
  if (_particleTextures) return _particleTextures;
  // 1. 雨絲紋理: 高長寬比細長雨滴, 帶半透明導光與尖端漸層
  const rainCv = document.createElement('canvas');
  rainCv.width = 32; rainCv.height = 128;
  const rg = rainCv.getContext('2d');
  const rGr = rg.createLinearGradient(16, 0, 16, 128);
  rGr.addColorStop(0, 'rgba(255, 255, 255, 0)');
  rGr.addColorStop(0.35, 'rgba(210, 235, 255, 0.45)');
  rGr.addColorStop(0.85, 'rgba(240, 248, 255, 0.95)');
  rGr.addColorStop(1.0, 'rgba(255, 255, 255, 1.0)');
  rg.fillStyle = rGr;
  rg.beginPath();
  rg.moveTo(14, 0); rg.lineTo(18, 0); rg.lineTo(19, 116);
  rg.arc(16, 118, 3.5, 0, Math.PI); rg.lineTo(13, 0);
  rg.fill();
  const rainTex = new THREE.CanvasTexture(rainCv);
  rainTex.colorSpace = THREE.SRGBColorSpace;

  // 2. 雪花紋理: 柔軟羽狀六角結晶, 具備核心微光與枝狀分叉
  const snowCv = document.createElement('canvas');
  snowCv.width = 64; snowCv.height = 64;
  const sg = snowCv.getContext('2d');
  const sC = 32;
  const sGr = sg.createRadialGradient(sC, sC, 2, sC, sC, 28);
  sGr.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  sGr.addColorStop(0.35, 'rgba(240, 248, 255, 0.85)');
  sGr.addColorStop(0.7, 'rgba(215, 235, 255, 0.4)');
  sGr.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
  sg.fillStyle = sGr;
  sg.beginPath(); sg.arc(sC, sC, 28, 0, Math.PI * 2); sg.fill();
  sg.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  sg.lineWidth = 2.5;
  for (let a = 0; a < 6; a++) {
    const rad = a * Math.PI / 3;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    sg.beginPath();
    sg.moveTo(sC, sC);
    sg.lineTo(sC + cos * 22, sC + sin * 22);
    sg.stroke();
    const mx = sC + cos * 14, my = sC + sin * 14;
    const pCos = Math.cos(rad + Math.PI / 4), pSin = Math.sin(rad + Math.PI / 4);
    const nCos = Math.cos(rad - Math.PI / 4), nSin = Math.sin(rad - Math.PI / 4);
    sg.beginPath();
    sg.moveTo(mx, my); sg.lineTo(mx + pCos * 7, my + pSin * 7);
    sg.moveTo(mx, my); sg.lineTo(mx + nCos * 7, my + nSin * 7);
    sg.stroke();
  }
  const snowTex = new THREE.CanvasTexture(snowCv);
  snowTex.colorSpace = THREE.SRGBColorSpace;

  // 3. 沙塵紋理: 粗糙不規則多角砂粒, 帶磨蝕質感與微細砂塵
  const sandCv = document.createElement('canvas');
  sandCv.width = 64; sandCv.height = 64;
  const dg = sandCv.getContext('2d');
  const dC = 32;
  const dGr = dg.createRadialGradient(dC, dC, 3, dC, dC, 26);
  dGr.addColorStop(0, 'rgba(255, 220, 150, 1.0)');
  dGr.addColorStop(0.45, 'rgba(212, 163, 89, 0.85)');
  dGr.addColorStop(0.85, 'rgba(180, 130, 60, 0.35)');
  dGr.addColorStop(1.0, 'rgba(180, 130, 60, 0)');
  dg.fillStyle = dGr;
  dg.beginPath();
  const pts = [[-12, -18], [14, -14], [22, 6], [8, 22], [-16, 18], [-22, -2]];
  dg.moveTo(dC + pts[0][0], dC + pts[0][1]);
  for (let i = 1; i < pts.length; i++) dg.lineTo(dC + pts[i][0], dC + pts[i][1]);
  dg.closePath();
  dg.fill();
  dg.fillStyle = 'rgba(255, 235, 180, 0.9)';
  for (const [ox, oy, r] of [[-4, -3, 2.5], [6, 4, 3], [-7, 6, 2], [5, -8, 2]]) {
    dg.beginPath(); dg.arc(dC + ox, dC + oy, r, 0, Math.PI * 2); dg.fill();
  }
  const sandTex = new THREE.CanvasTexture(sandCv);
  sandTex.colorSpace = THREE.SRGBColorSpace;

  _particleTextures = { rain: rainTex, snow: snowTex, sand: sandTex };
  return _particleTextures;
}

/**
 * 粒子系統 (雨 / 沙 / 雪 實體微粒):
 * 根據多元天氣之有效雨量 (effectiveRain)、沙量 (effectiveSand)、雪量 (effectiveSnow) 與即時風向風力更新。
 * 雨/雪/沙塵各自具備專屬程序化紋理與完全相異之運動物理軌跡。
 * 風力數值不使用虛擬氣流條紋，高空透過雲朵飄移與聚散表現，低空透過落花落葉表現。
 */
// 快速餘弦查表 (256 階，消除粒子每幀的動態三角計算)
const _COS_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) _COS_LUT[i] = Math.cos((i / 256) * Math.PI * 2);

function makeParticles() {
  const pTexs = particleTextures();
  const systems = {};
  const kinds = ['rain', 'sand', 'snow'];
  const grp = new THREE.Group();

  for (const k of kinds) {
    let N = 900, size = 1.60, speed = 135, color = 0xa4c6df;
    if (k === 'sand')       { N = 700; size = 2.60; speed = 28;  color = 0xd4a359; }
    else if (k === 'snow')  { N = 600; size = 2.40; speed = 12;  color = 0xffffff; }

    const BOX = 260, H = 180, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 1] = Math.random() * H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      seed[i] = Math.random() * Math.PI * 2;
    }

    // 預先計算粒子種子相位之三角常數 (雪花與沙塵紊流)
    const sinS1 = new Float32Array(N), cosS1 = new Float32Array(N);
    const sinS2 = new Float32Array(N), cosS2 = new Float32Array(N);
    const sinS3 = new Float32Array(N), cosS3 = new Float32Array(N);
    const sinS4 = new Float32Array(N), cosS4 = new Float32Array(N);
    const sinS5 = new Float32Array(N), cosS5 = new Float32Array(N);

    if (k === 'snow') {
      for (let i = 0; i < N; i++) {
        const s = seed[i];
        sinS1[i] = Math.sin(s * 4.1); cosS1[i] = Math.cos(s * 4.1);
        sinS2[i] = Math.sin(s);       cosS2[i] = Math.cos(s);
        sinS3[i] = Math.sin(s * 2.3); cosS3[i] = Math.cos(s * 2.3);
        sinS4[i] = Math.sin(s * 1.7); cosS4[i] = Math.cos(s * 1.7);
        sinS5[i] = Math.sin(s * 3.1); cosS5[i] = Math.cos(s * 3.1);
      }
    } else if (k === 'sand') {
      for (let i = 0; i < N; i++) {
        const s = seed[i];
        sinS1[i] = Math.sin(s * 3.7); cosS1[i] = Math.cos(s * 3.7);
        sinS2[i] = Math.sin(s);       cosS2[i] = Math.cos(s);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size,
      map: pTexs[k],
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    grp.add(pts);
    systems[k] = { pts, geo, mat, N, BOX, H, seed, speed, sinS1, cosS1, sinS2, cosS2, sinS3, cosS3, sinS4, cosS4, sinS5, cosS5 };
  }

  let t = 0;
  return {
    obj: grp,
    /**
     * @param {number} dt
     * @param {THREE.Camera} camera
     * @param {{ effectiveRain:number, effectiveSand:number, effectiveSnow:number, windDir:number[], windAmp:number }} dyn
     */
    update(dt, camera, dyn) {
      t += dt;
      const windDir = dyn?.windDir ?? [1, 0];
      const windAmp = dyn?.windAmp ?? 1.0;
      const effRain = dyn?.effectiveRain ?? 0;
      const effSand = dyn?.effectiveSand ?? 0;
      const effSnow = dyn?.effectiveSnow ?? 0;

      for (const [k, sys] of Object.entries(systems)) {
        let isActive = false;
        let targetOpacity = 0;
        let driftSpeedX = windDir[0] * windAmp;
        let driftSpeedZ = windDir[1] * windAmp;

        if (k === 'rain' && effRain > 0.01) {
          isActive = true;
          targetOpacity = Math.min(0.88, 0.28 + effRain * 0.60);
          driftSpeedX *= 32;
          driftSpeedZ *= 32;
        } else if (k === 'sand' && effSand > 0.01) {
          isActive = true;
          targetOpacity = Math.min(0.85, 0.32 + effSand * 0.50);
          driftSpeedX *= 70;
          driftSpeedZ *= 70;
        } else if (k === 'snow' && effSnow > 0.01) {
          isActive = true;
          targetOpacity = Math.min(0.92, 0.35 + effSnow * 0.55);
          driftSpeedX *= 12;
          driftSpeedZ *= 12;
        }

        sys.pts.visible = isActive;
        if (!isActive) continue;

        sys.mat.opacity = targetOpacity;
        sys.pts.position.set(camera.position.x, camera.position.y - sys.H * 0.45, camera.position.z);
        const p = sys.geo.attributes.position;
        const arr = p.array;
        const halfBox = sys.BOX * 0.5;

        if (k === 'rain') {
          // 雨滴: 高速垂直直墜穿刺 + 隨風強烈傾斜 (純線性浮點運算)
          const vy = sys.speed * dt;
          const vx = driftSpeedX * dt;
          const vz = driftSpeedZ * dt;
          for (let i = 0; i < sys.N; i++) {
            const idx = i * 3;
            let px = arr[idx] + vx;
            let y = arr[idx + 1] - vy;
            let pz = arr[idx + 2] + vz;

            if (y < 0) {
              y = sys.H;
              px = (Math.random() - 0.5) * sys.BOX;
              pz = (Math.random() - 0.5) * sys.BOX;
            }
            if (px > halfBox) px -= sys.BOX; else if (px < -halfBox) px += sys.BOX;
            if (pz > halfBox) pz -= sys.BOX; else if (pz < -halfBox) pz += sys.BOX;

            arr[idx] = px; arr[idx + 1] = y; arr[idx + 2] = pz;
          }
        } else if (k === 'snow') {
          // 雪花: 和角公式展開，迴圈外計算一次時間諧波，迴圈內零三角呼叫
          const sinT1 = Math.sin(t * 2.2), cosT1 = Math.cos(t * 2.2);
          const sinT2 = Math.sin(t * 1.8), cosT2 = Math.cos(t * 1.8);
          const sinT3 = Math.sin(t * 0.8), cosT3 = Math.cos(t * 0.8);
          const sinT4 = Math.sin(t * 1.6), cosT4 = Math.cos(t * 1.6);
          const sinT5 = Math.sin(t * 0.7), cosT5 = Math.cos(t * 0.7);

          const { sinS1, cosS1, sinS2, cosS2, sinS3, cosS3, sinS4, cosS4, sinS5, cosS5 } = sys;
          const baseVy = sys.speed * dt;
          const baseVx = driftSpeedX * dt;
          const baseVz = driftSpeedZ * dt;

          for (let i = 0; i < sys.N; i++) {
            const idx = i * 3;
            const sinW1 = sinT1 * cosS1[i] + cosT1 * sinS1[i];
            const sinW2 = sinT2 * cosS2[i] + cosT2 * sinS2[i];
            const cosW3 = cosT3 * cosS3[i] - sinT3 * sinS3[i];
            const cosW4 = cosT4 * cosS4[i] - sinT4 * sinS4[i];
            const sinW5 = sinT5 * cosS5[i] + cosT5 * sinS5[i];

            let y = arr[idx + 1] - baseVy - sinW1 * dt * 2.0;
            let px = arr[idx] + (sinW2 * 7.5 + cosW3 * 3.5) * dt + baseVx;
            let pz = arr[idx + 2] + (cosW4 * 7.5 + sinW5 * 3.5) * dt + baseVz;

            if (y < 0) {
              y = sys.H;
              px = (Math.random() - 0.5) * sys.BOX;
              pz = (Math.random() - 0.5) * sys.BOX;
            } else if (y > sys.H) {
              y = 0;
            }
            if (px > halfBox) px -= sys.BOX; else if (px < -halfBox) px += sys.BOX;
            if (pz > halfBox) pz -= sys.BOX; else if (pz < -halfBox) pz += sys.BOX;

            arr[idx] = px; arr[idx + 1] = y; arr[idx + 2] = pz;
          }
        } else if (k === 'sand') {
          // 沙塵: 和角展開 + 查表地滾翻，迴圈內零三角呼叫
          const sinT1 = Math.sin(t * 4.2), cosT1 = Math.cos(t * 4.2);
          const sinT2 = Math.sin(t * 3.5), cosT2 = Math.cos(t * 3.5);
          const tPhase = t * 3.0;

          const { sinS1, cosS1, sinS2, cosS2 } = sys;
          const baseVy = sys.speed * dt;
          const lutMul = 256 / 6.2831853;

          for (let i = 0; i < sys.N; i++) {
            const idx = i * 3;
            let px = arr[idx];
            let y = arr[idx + 1];
            let pz = arr[idx + 2];

            const sinW1 = sinT1 * cosS1[i] + cosT1 * sinS1[i];
            const cosW2 = cosT2 * cosS2[i] - sinT2 * sinS2[i];
            const sinW2 = sinT2 * cosS2[i] + cosT2 * sinS2[i];

            const lutIdx = (((px * 0.05 + tPhase) * lutMul) & 255);
            const roll = _COS_LUT[lutIdx] * 8.0;

            y -= baseVy;
            y += (sinW1 * 16.0 + roll) * dt;
            px += (driftSpeedX + cosW2 * 12.0) * dt;
            pz += (driftSpeedZ + sinW2 * 12.0) * dt;

            if (y < 0) {
              y = sys.H;
              px = (Math.random() - 0.5) * sys.BOX;
              pz = (Math.random() - 0.5) * sys.BOX;
            } else if (y > sys.H) {
              y = 0;
            }
            if (px > halfBox) px -= sys.BOX; else if (px < -halfBox) px += sys.BOX;
            if (pz > halfBox) pz -= sys.BOX; else if (pz < -halfBox) pz += sys.BOX;

            arr[idx] = px; arr[idx + 1] = y; arr[idx + 2] = pz;
          }
        }
        p.needsUpdate = true;
      }
    },
    dispose() {
      for (const sys of Object.values(systems)) {
        sys.geo.dispose();
        sys.mat.dispose();
      }
      if (_particleTextures) {
        for (const tex of Object.values(_particleTextures)) tex.dispose();
        _particleTextures = null;
      }
    },
  };
}

/**
 * 3D 烏雲閃電電弧系統 (3D Branching Lightning Bolts)
 * 在雷雨/風暴天從高空烏雲群向下擊出真實折線分支閃電弧光與地面衝擊光暈。
 */
function makeLightningSystem(span, terrain) {
  const grp = new THREE.Group();
  const MAX_POINTS = 128;
  const mainPos = new Float32Array(MAX_POINTS * 3);
  const branchPos = new Float32Array(MAX_POINTS * 3);

  const mainGeo = new THREE.BufferGeometry();
  mainGeo.setAttribute('position', new THREE.BufferAttribute(mainPos, 3));
  const branchGeo = new THREE.BufferGeometry();
  branchGeo.setAttribute('position', new THREE.BufferAttribute(branchPos, 3));

  const mainMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const branchMat = new THREE.LineBasicMaterial({
    color: 0x98dcff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });

  const mainLine = new THREE.LineSegments(mainGeo, mainMat);
  const branchLine = new THREE.LineSegments(branchGeo, branchMat);
  mainLine.frustumCulled = false;
  branchLine.frustumCulled = false;
  grp.add(mainLine);
  grp.add(branchLine);

  // 地面落雷光暈
  const glowCv = document.createElement('canvas');
  glowCv.width = 64; glowCv.height = 64;
  const gg = glowCv.getContext('2d');
  const gGr = gg.createRadialGradient(32, 32, 2, 32, 32, 30);
  gGr.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gGr.addColorStop(0.3, 'rgba(180, 230, 255, 0.85)');
  gGr.addColorStop(0.7, 'rgba(100, 180, 255, 0.35)');
  gGr.addColorStop(1.0, 'rgba(100, 180, 255, 0)');
  gg.fillStyle = gGr;
  gg.beginPath(); gg.arc(32, 32, 30, 0, Math.PI * 2); gg.fill();
  const glowTex = new THREE.CanvasTexture(glowCv);
  glowTex.colorSpace = THREE.SRGBColorSpace;

  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.set(span * 0.15, span * 0.15, 1);
  glowSprite.visible = false;
  grp.add(glowSprite);

  let active = false;
  let timer = 0;
  const DURATION = 0.26;

  return {
    obj: grp,
    /**
     * 從烏雲向地面擊出閃電電弧
     * @param {THREE.Vector3} start 起點 (高空烏雲)
     * @param {THREE.Vector3} end 終點 (地面/建築)
     */
    strike(start, end) {
      active = true;
      timer = DURATION;
      grp.visible = true;

      let mPtr = 0;
      let bPtr = 0;

      // 1. 主電弧折線 (分 16 段)
      const SEGMENTS = 16;
      let cur = start.clone();
      const delta = end.clone().sub(start);

      for (let i = 0; i < SEGMENTS; i++) {
        const next = start.clone().add(delta.clone().multiplyScalar((i + 1) / SEGMENTS));
        if (i < SEGMENTS - 1) {
          const jitterAmp = span * (0.022 * (1.0 - i / SEGMENTS) + 0.008);
          next.x += (Math.random() - 0.5) * jitterAmp * 2;
          next.y += (Math.random() - 0.5) * jitterAmp * 0.8;
          next.z += (Math.random() - 0.5) * jitterAmp * 2;
        }

        // 寫入主電弧線段 (每段兩頂點)
        if (mPtr + 6 <= MAX_POINTS * 3) {
          mainPos[mPtr++] = cur.x; mainPos[mPtr++] = cur.y; mainPos[mPtr++] = cur.z;
          mainPos[mPtr++] = next.x; mainPos[mPtr++] = next.y; mainPos[mPtr++] = next.z;
        }

        // 2. 隨機生成 2~3 條側向分叉電弧
        if ((i === 4 || i === 8 || i === 12) && Math.random() < 0.85) {
          let bCur = cur.clone();
          const branchDir = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            -0.8 - Math.random() * 0.6,
            (Math.random() - 0.5) * 2
          ).normalize();
          const bSegs = 4 + Math.floor(Math.random() * 4);
          const bStepLen = span * (0.015 + Math.random() * 0.012);

          for (let b = 0; b < bSegs; b++) {
            const bNext = bCur.clone().add(branchDir.clone().multiplyScalar(bStepLen));
            bNext.x += (Math.random() - 0.5) * span * 0.012;
            bNext.y += (Math.random() - 0.5) * span * 0.008;
            bNext.z += (Math.random() - 0.5) * span * 0.012;

            if (bPtr + 6 <= MAX_POINTS * 3) {
              branchPos[bPtr++] = bCur.x; branchPos[bPtr++] = bCur.y; branchPos[bPtr++] = bCur.z;
              branchPos[bPtr++] = bNext.x; branchPos[bPtr++] = bNext.y; branchPos[bPtr++] = bNext.z;
            }
            bCur = bNext;
          }
        }
        cur = next;
      }

      // 清空剩餘線段緩衝
      while (mPtr < MAX_POINTS * 3) mainPos[mPtr++] = 0;
      while (bPtr < MAX_POINTS * 3) branchPos[bPtr++] = 0;

      mainGeo.attributes.position.needsUpdate = true;
      branchGeo.attributes.position.needsUpdate = true;

      glowSprite.position.set(end.x, end.y + 1.5, end.z);
      glowSprite.visible = true;
    },
    update(dt) {
      if (!active) {
        grp.visible = false;
        return;
      }
      timer -= dt;
      if (timer <= 0) {
        active = false;
        grp.visible = false;
        mainMat.opacity = 0;
        branchMat.opacity = 0;
        glowMat.opacity = 0;
        return;
      }
      // 快速放電頻閃與餘暉衰減
      const strobe = Math.sin(timer * 55.0) > -0.2 ? 1.0 : 0.25;
      const fade = Math.max(0, timer / DURATION);
      mainMat.opacity = fade * strobe * 0.95;
      branchMat.opacity = fade * strobe * 0.75;
      glowMat.opacity = fade * strobe * 0.90;
    },
    dispose() {
      mainGeo.dispose();
      mainMat.dispose();
      branchGeo.dispose();
      branchMat.dispose();
      glowTex.dispose();
      glowMat.dispose();
    },
  };
}

export function applyEnvironment(scene, terrain, env, opts = {}) {
  const span = Math.max(terrain.worldW, terrain.worldH);
  const backgroundOnly = !!opts.backgroundOnly;
  const startTime = TIMES[env?.time] ? env.time : 'day';
  const startSeason = env?.season || 'summer';
  const startWeather = env?.weather || 'clear';
  const latDeg = terrain?.center?.lat ?? 25.0;
  const seed = Math.round((terrain.center?.lat ?? 0) * 1e4) * 31 + Math.round((terrain.center?.lng ?? 0) * 1e4);

  const sched = computeSolarSchedule(startSeason, latDeg);
  const S = SEASONS[startSeason] || SEASONS.summer;
  if (!backgroundOnly) setSolarSchedule(sched);

  let weatherVec = weatherVectorAt(startSeason, startTime, startWeather, 0, seed, latDeg);
  let curDyn = resolveWeatherDynamics(weatherVec);
  if (!backgroundOnly) setWeatherDynamics(curDyn);

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

  // 設定頁樣品只借用同一套天空/雲/天氣；燈光仍由 matsample 的鍵光控制，
  // 避免背景預覽改寫戰場共享的 cel 光向。
  const hemi = backgroundOnly ? null : new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  if (hemi) scene.add(hemi);

  const sun = backgroundOnly ? null : new THREE.DirectionalLight(0xffffff, 1);
  if (sun) {
    scene.add(sun);
    scene.add(sun.target);
  }

  const shadowOn = !backgroundOnly && !!opts.shadow;
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

  const lightning = makeLightningSystem(span, terrain);
  scene.add(lightning.obj);

  const air = { near: new THREE.Color(), far: new THREE.Color(), fogNear: span * curDyn.fogNear, fogFar: span * curDyn.fogFar };
  const _sunD = new THREE.Vector3(), _moonD = new THREE.Vector3(), _lit = new THREE.Vector3(), _cam = new THREE.Object3D(), _fwd = new THREE.Vector3();

  // 雷電計時器
  let lightningTimer = 3.5;
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

    if (hemi) {
      hemi.color.copy(T.hemiSky);
      hemi.groundColor.copy(T.hemiGnd);
      hemi.intensity = (T.hemiI * (curDyn.light * 0.6 + 0.4) * S.mul) + (flashStrength * 3.5);
    }

    const sd = backgroundOnly ? sunDirAt(h, sched.riseH, sched.setH) : sunDirAt(h);
    const md = backgroundOnly ? sunDirAt(h + 12, sched.riseH, sched.setH) : moonDirAt(h);
    _sunD.set(sd.x, sd.y, sd.z);
    _moonD.set(md.x, md.y, md.z);
    const up = sd.y > 0;
    out.sunUp = up;
    _lit.copy(up ? _sunD : _moonD);
    const fade = bodyFade(up ? sd.y : md.y);
    if (sun) {
      sun.color.copy(sunC);
      sun.intensity = (T.sunI * curDyn.light * S.mul * fade) + (flashStrength * 5.0);
    }
    if (!backgroundOnly) setCelSun(_lit);

    moonC.setHex(TIMES.night.sun).lerp(WHITE, 0.45);
    bodies.place(_cam, _sunD, _moonD, sunC, moonC, Math.max(0, Math.min(1, sd.y / 0.35)));
  }

  setHour(clockHour(startTime, 0, sched.startH));
  air.near.copy(nearFogColor(fogC, sunC, skyC, curDyn));
  air.far.copy(fogC);

  return Object.assign(out, {
    update(dt, camera, elapsedS = 0) {
      _cam.position.copy(camera.position);

      // 1. 連續 7 維布朗運動與四季時段氣候演化 (含大雪凍結保溫與解凍動態)
      weatherVec = weatherVectorAt(startSeason, startTime, startWeather, elapsedS, seed, latDeg);
      curDyn = resolveWeatherDynamics(weatherVec, curDyn, dt);
      if (!backgroundOnly) setWeatherDynamics(curDyn);

      // 2. 打雷閃電系統 (>75% 觸發實體 3D 閃電擊向地面與全場強光頻閃)
      flashStrength = 0;
      if (curDyn.effectiveThunder > 0.01) {
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          flashTimer = 0.22 + (Math.sin(elapsedS * 13.7) * 0.5 + 0.5) * 0.15;
          lightningTimer = Math.max(1.8, (1.0 - curDyn.effectiveThunder) * 6.5 + (Math.sin(elapsedS * 7.9) * 0.5 + 0.5) * 3.0);
          // 從高空烏雲群向地面擊出 3D 分支閃電
          const angle = Math.random() * Math.PI * 2;
          const dist = span * (0.12 + Math.random() * 0.42);
          const startX = camera.position.x + Math.cos(angle) * dist;
          const startZ = camera.position.z + Math.sin(angle) * dist;
          const startY = span * (0.35 + Math.random() * 0.15);
          const endX = startX + (Math.random() - 0.5) * span * 0.20;
          const endZ = startZ + (Math.random() - 0.5) * span * 0.20;
          const endY = terrain?.heightAt ? terrain.heightAt(endX, endZ) : 0;
          lightning.strike(new THREE.Vector3(startX, startY, startZ), new THREE.Vector3(endX, endY, endZ));
        }
        if (flashTimer > 0) {
          flashTimer -= dt;
          flashStrength = Math.sin(flashTimer * 42.0) > 0 ? (flashTimer / 0.25) * curDyn.effectiveThunder : 0;
        }
      }
      lightning.update(dt);

      // 3. 推進日照時段與更新光影
      const h = clockHour(startTime, elapsedS, sched.startH);
      setHour(h);

      // 4. 能見度與空氣透視動態調整 (濃霧最濃時壓至 1 個砲塔射程 UNITS.tower.range)
      const denseFogFarM = UNITS.tower?.range ?? 155;
      const denseFogNearM = denseFogFarM * 0.10;
      const normalFogNear = span * curDyn.fogNear;
      const normalFogFar = span * curDyn.fogFar;
      // 只有在最濃霧時 (effectiveFog 趨近 1.0) 能見度才精準壓至 1 個砲塔射程
      const effFog = Math.pow(Math.max(0, curDyn.effectiveFog), 1.8);
      const actualFogFar = THREE.MathUtils.lerp(normalFogFar, Math.min(normalFogFar, denseFogFarM), effFog);
      const actualFogNear = THREE.MathUtils.lerp(normalFogNear, Math.min(normalFogNear, denseFogNearM), effFog);

      scene.fog.near = actualFogNear;
      scene.fog.far = actualFogFar;
      air.fogNear = actualFogNear;
      air.fogFar = actualFogFar;
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
      if (sun) {
        sun.target.position.set(cx, cy, cz);
        sun.position.set(cx + _lit.x * shR * 2.5, cy + _lit.y * shR * 2.5, cz + _lit.z * shR * 2.5);
      }

      // 6. 粒子與雲群動態步進
      particles.update(dt, camera, curDyn);

      dome.position.copy(camera.position);
      if (clouds) {
        clouds.obj.position.copy(camera.position);
        clouds.step(backgroundOnly ? elapsedS : celWindTime(), dt, skyC, curDyn);
      }
    },
    strikeLightningAt(targetX, targetY, targetZ) {
      flashTimer = 0.25;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.min(span * 0.25, 120);
      const startX = targetX + Math.cos(angle) * dist;
      const startZ = targetZ + Math.sin(angle) * dist;
      const startY = (targetY || 0) + Math.min(span * 0.35, 180);
      lightning.strike(new THREE.Vector3(startX, startY, startZ), new THREE.Vector3(targetX, targetY || 0, targetZ));
    },
    getWeatherDynamics() {
      return curDyn;
    },
    dispose() {
      if (hemi) scene.remove(hemi);
      if (sun) {
        scene.remove(sun);
        scene.remove(sun.target);
      }
      scene.remove(particles.obj);
      particles.dispose();
      scene.remove(lightning.obj);
      lightning.dispose();
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
