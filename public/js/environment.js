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
  weatherVectorAt, resolveWeatherDynamics, WEATHER_ATTRS, WEATHER_PRESETS, mapRot,
  lunarMoonDirAt, tideLevelAt,
} from './data.js';
import { setCelSun, celWindTime, INK_INFO_DECL, INK_INFO_NONE, setWeatherDynamics } from './toon.js';
import { mulberry32 } from './rng.js';
import { resolveWeatherVisuals } from './weatherVisuals.js';
import { makeClouds, makeFog, makeParticles, makeRainImpacts, makeLightningSystem } from './weatherFx.js';
import { stepWeatherSurface } from './weatherState.js';
import { makeScorchAtlas, setSurfaceWeather } from './weatherMaterial.js';
import { makeWeatherDeposits } from './weatherDeposits.js';

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

function makeBodies(span, lunarDay = 15) {
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
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(C, C, S * 0.30, 0, Math.PI * 2); g.fill();
    } else if (kind === 'moon') {
      const R = S * 0.34;
      const d = Number.isFinite(lunarDay) ? Math.max(1, Math.min(30, lunarDay)) : 15;
      const phaseAngle = ((d - 1) / 29.53059) * Math.PI * 2; // [0, 2pi)

      // 先繪製微弱地照灰光圓底 (Earthshine)
      g.fillStyle = 'rgba(70, 85, 110, 0.28)';
      g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fill();

      // 繪製受光月球亮面與月海暗斑
      const fullCv = document.createElement('canvas');
      fullCv.width = fullCv.height = S;
      const fg = fullCv.getContext('2d');
      fg.fillStyle = '#f0f4ff';
      fg.beginPath(); fg.arc(C, C, R, 0, Math.PI * 2); fg.fill();
      fg.fillStyle = 'rgba(145,158,180,0.55)';
      for (const [dx, dy, r] of [[-0.09, -0.07, 0.085], [0.07, 0.03, 0.065], [-0.02, 0.11, 0.05], [0.12, -0.10, 0.04]]) {
        fg.beginPath(); fg.arc(C + dx * S, C + dy * S, r * S, 0, Math.PI * 2); fg.fill();
      }

      if (d === 15) {
        // 十五滿月：全圓亮面
        g.drawImage(fullCv, 0, 0);
      } else if (d !== 1) {
        // 初二至十四、十六至廿九：月相晨昏線 (Terminator)
        const isWaxing = phaseAngle < Math.PI; // 上半月右亮，下半月左亮
        const cosPhase = Math.cos(phaseAngle);

        fg.save();
        fg.globalCompositeOperation = 'destination-in';
        fg.beginPath();
        if (isWaxing) {
          fg.arc(C, C, R, -Math.PI / 2, Math.PI / 2, false);
          if (fg.ellipse) {
            fg.ellipse(C, C, Math.max(0.1, Math.abs(R * cosPhase)), R, 0, Math.PI / 2, -Math.PI / 2, cosPhase > 0);
          } else {
            fg.lineTo(C, C - R);
          }
        } else {
          fg.arc(C, C, R, Math.PI / 2, -Math.PI / 2, false);
          if (fg.ellipse) {
            fg.ellipse(C, C, Math.max(0.1, Math.abs(R * cosPhase)), R, 0, -Math.PI / 2, Math.PI / 2, cosPhase < 0);
          } else {
            fg.lineTo(C, C + R);
          }
        }
        fg.closePath();
        fg.fill();
        fg.restore();

        g.drawImage(fullCv, 0, 0);
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

export function applyEnvironment(scene, terrain, env, opts = {}) {
  const span = Math.max(terrain.worldW, terrain.worldH);
  const backgroundOnly = !!opts.backgroundOnly;
  let surfaceState = stepWeatherSurface();
  let surfaceSynced = false;
  const scorchAtlas = backgroundOnly ? null : makeScorchAtlas(terrain);
  const deposits = backgroundOnly ? null : makeWeatherDeposits(scene, terrain, opts);
  if (!backgroundOnly) setSurfaceWeather(surfaceState);
  const startTime = TIMES[env?.time] ? env.time : 'day';
  const startSeason = env?.season || 'summer';
  const startWeather = env?.weather || 'clear';
  const latDeg = terrain?.center?.lat ?? 25.0;
  const seed = Math.round((terrain.center?.lat ?? 0) * 1e4) * 31 + Math.round((terrain.center?.lng ?? 0) * 1e4);

  const mapRotation = terrain?.center ? mapRot(terrain.center) : 0;
  const sched = computeSolarSchedule(startSeason, latDeg, mapRotation, env?.lunarDay ?? 15);
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

  const visuals = resolveWeatherVisuals(curDyn);
  const fog = makeFog(terrain, seed, opts);
  scene.add(fog.obj);
  const previewRnd = mulberry32((seed ^ 0x62A391) >>> 0);
  const clouds = makeClouds(span, seed, opts);
  if (clouds) scene.add(clouds.obj);

  const bodies = makeBodies(span, sched?.lunarDay ?? 15);
  scene.add(bodies.obj);

  // Preview lights follow this environment without changing the battle's shared sun or weather.
  const hemi = backgroundOnly ? opts.previewLights?.hemi || null : new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  if (hemi) scene.add(hemi);

  const sun = backgroundOnly ? opts.previewLights?.sun || null : new THREE.DirectionalLight(0xffffff, 1);
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

  const particles = makeParticles(seed, opts);
  scene.add(particles.obj);
  const rainImpacts = makeRainImpacts(terrain, seed, opts);
  scene.add(rainImpacts.obj);

  const lightning = makeLightningSystem(seed);
  scene.add(lightning.obj);

  const air = { near: new THREE.Color(), far: new THREE.Color(), fogNear: span * curDyn.fogNear, fogFar: span * curDyn.fogFar };
  const _sunD = new THREE.Vector3(), _moonD = new THREE.Vector3(), _lit = new THREE.Vector3(), _cam = new THREE.Object3D(), _fwd = new THREE.Vector3();

  // 雷電計時器
  let lightningTimer = 3.5;
  let flashStrength = 0;

  const out = { air, lightDirection: _lit, hour: 0, sunUp: true, weather: curDyn.dominantWeather, weatherVec, dynamics: curDyn };

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
    const md = backgroundOnly
      ? (sched?.lunarDay != null ? lunarMoonDirAt(h, sched.lunarDay, sched.riseH, sched.setH) : sunDirAt(h + 12, sched.riseH, sched.setH))
      : (sched?.lunarDay != null ? lunarMoonDirAt(h, sched.lunarDay) : moonDirAt(h));
    _sunD.set(sd.x, sd.y, sd.z);
    _moonD.set(md.x, md.y, md.z);
    const up = sd.y > 0;
    out.sunUp = up;
    _lit.copy(up ? _sunD : _moonD);
    const fade = bodyFade(up ? sd.y : md.y);
    const moonIllum = sched?.lunarPhaseAngle != null
      ? (0.08 + 0.92 * (1 - Math.cos(sched.lunarPhaseAngle)) * 0.5)
      : 1.0;
    if (sun) {
      sun.color.copy(sunC);
      sun.intensity = (T.sunI * curDyn.light * S.mul * fade * (up ? 1.0 : moonIllum)) + (flashStrength * 5.0);
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
      dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      curDyn = resolveWeatherDynamics(weatherVec, curDyn, dt);
      resolveWeatherVisuals(curDyn, visuals);
      if (!backgroundOnly) setWeatherDynamics(curDyn, visuals);
      if (!surfaceSynced) surfaceState = stepWeatherSurface(surfaceState, curDyn, dt);
      if (!backgroundOnly) setSurfaceWeather(surfaceState);
      deposits?.update(dt, camera, surfaceState);

      // Background previews schedule visual strikes; battles render server events only.
      if (backgroundOnly && curDyn.effectiveThunder > 0) {
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          lightningTimer = 2 + (1 - curDyn.effectiveThunder) * 6 + previewRnd() * 2;
          const angle = previewRnd() * Math.PI * 2;
          const dist = span * (.12 + previewRnd() * .42);
          const endX = camera.position.x + Math.cos(angle) * dist;
          const endZ = camera.position.z + Math.sin(angle) * dist;
          const endY = terrain.heightAt?.(endX, endZ);
          if (Number.isFinite(endY)) {
            const start = new THREE.Vector3(endX + (previewRnd() - .5) * span * .15,
              endY + Math.min(span * .35, 180), endZ + (previewRnd() - .5) * span * .15);
            lightning.strike(start, new THREE.Vector3(endX, endY, endZ), visuals.lightning);
          }
        }
      }
      flashStrength = lightning.update(dt, camera);

      // 3. 推進日照時段與更新光影
      const h = clockHour(startTime, elapsedS, sched.startH);
      setHour(h);

      // 動態海域潮汐更新
      if (terrain && typeof terrain.updateTide === 'function' && terrain.isMarine) {
        const tideH = tideLevelAt(h, sched?.lunarDay ?? 15, true);
        terrain.updateTide(tideH);
      }

      // 4. 能見度與空氣透視動態調整(2026-09-06 改制:渲染霧錨定權威視野 ——
      // 敵機在視野邊界消失時 3D 必須已經一片白,否則消失讀成憑空不見。
      // 舊制只在最濃霧壓至塔射程:霧預設(d=0.6,span 1000)時 far ~630m、near ~150m,
      // 而步行視野只剩 72m ⇒ 霧連開始都還沒開始,遠方一片清明,正是「遠方不夠濃」。
      // 錨:END_FAR ≈ 1.5 × 全霧步行視野(120/3=40m)⇒ 消失點落在 smoothstep ~0.6(約六成白);
      // 權重 w=(1-eff)^5:eff=0 恆等舊制(clear 逐像素相同),eff≳0.5 幾乎全壓,全程連續無跳變。
      // 狙擊鏡/小兵視野不可能同時對上單一全域霧 —— 取步行英雄為錨(小兵消失點偏清、
      // 狙擊鏡內偏白,皆為同一條曲線的兩端;狙擊快照視野加成照吃,小地圖標記不受影響)。)
      const FOG_SIGHT_FAR_M = 65;
      const FOG_SIGHT_NEAR_M = FOG_SIGHT_FAR_M * 0.10;
      const normalFogNear = span * curDyn.fogNear;
      const normalFogFar = span * curDyn.fogFar;
      const fogW = Math.pow(1 - (curDyn.effectiveFog ?? 0), 5);
      const actualFogFar = normalFogFar * fogW + FOG_SIGHT_FAR_M * (1 - fogW);
      const actualFogNear = normalFogNear * fogW + FOG_SIGHT_NEAR_M * (1 - fogW);

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
      particles.update(dt, camera, curDyn, visuals);
      rainImpacts.update(dt, camera, curDyn, visuals);
      fog.update(dt, camera, curDyn, visuals.fog, fogC);

      dome.position.copy(camera.position);
      if (clouds) {
        clouds.obj.position.copy(camera.position);
        clouds.step(backgroundOnly ? elapsedS : celWindTime(), dt, skyC, curDyn, visuals.clouds);
      }
    },
    strikeLightningAt(targetX, targetY, targetZ) {
      if (![targetX, targetY, targetZ].every(Number.isFinite)) return;
      const angle = previewRnd() * Math.PI * 2;
      const dist = Math.min(span * .25, 120);
      const start = new THREE.Vector3(targetX + Math.cos(angle) * dist,
        targetY + Math.min(span * .35, 180), targetZ + Math.sin(angle) * dist);
      lightning.strike(start, new THREE.Vector3(targetX, targetY, targetZ), visuals.lightning);
    },
    getWeatherDynamics() {
      return curDyn;
    },
    getWeatherSurface() {
      return surfaceState;
    },
    syncSurface(state, marks) {
      if (state) { surfaceState = state; surfaceSynced = true; }
      scorchAtlas?.sync(marks);
    },
    dispose() {
      deposits?.dispose();
      scorchAtlas?.dispose();
      if (!backgroundOnly) setSurfaceWeather();
      if (hemi) scene.remove(hemi);
      if (sun) {
        scene.remove(sun);
        scene.remove(sun.target);
      }
      scene.remove(particles.obj);
      particles.dispose();
      scene.remove(rainImpacts.obj);
      rainImpacts.dispose();
      scene.remove(fog.obj);
      fog.dispose();
      scene.remove(lightning.obj);
      lightning.dispose();
      scene.remove(dome);
      dome.geometry.dispose(); dome.material.dispose();
      scene.remove(bodies.obj);
      bodies.dispose();
      if (clouds) {
        scene.remove(clouds.obj);
        clouds.dispose();
      }
    },
  });
}
