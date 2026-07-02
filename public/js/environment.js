// ============ 環境系統:季節 × 日夜 × 天氣 ============
// 依 battleConfig.env(開房時由伺服器定案,全房一致)設定:
//   - 天色 / 霧 / 太陽(或月光)角度、色溫、強度
//   - 雨 / 雪粒子(跟隨相機的粒子盒,便宜又看不出邊界)
// 粒子手法參考 mapping_elf/weatherFx3D.js(程序生成、無外部資產)。
import * as THREE from 'three';
import { ENV } from './data.js';

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
const WEATHERS = {
  clear:  { light: 1.0,  fogNear: 0.25, fogFar: 1.2 },
  cloudy: { light: 0.55, fogNear: 0.20, fogFar: 1.0 },
  rain:   { light: 0.45, fogNear: 0.12, fogFar: 0.75, particle: 'rain' },
  snow:   { light: 0.60, fogNear: 0.14, fogFar: 0.80, particle: 'snow', fogTint: 0xcfd8dd },
  fog:    { light: 0.50, fogNear: 0.04, fogFar: 0.35 },
};

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
  scene.background = skyC;
  scene.fog = new THREE.Fog(fogC, span * W.fogNear, span * W.fogFar);

  const hemi = new THREE.HemisphereLight(T.hemiSky, T.hemiGnd, T.hemiI * (W.light * 0.6 + 0.4) * S.mul);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(
    new THREE.Color(T.sun).multiply(new THREE.Color(S.tint)),
    T.sunI * W.light * S.mul,
  );
  const az = env?.time === 'dusk' ? 0.9 : 0.4;   // 黃昏太陽壓低偏西
  sun.position.set(span * Math.cos(az), span * T.elev, span * Math.sin(az) * 0.5);
  scene.add(sun);

  let particles = null;
  if (W.particle) {
    particles = makeParticles(W.particle);
    scene.add(particles.obj);
  }

  return {
    update(dt, camera) { particles?.update(dt, camera); },
    dispose() {
      scene.remove(hemi); scene.remove(sun);
      if (particles) scene.remove(particles.obj);
    },
  };
}
