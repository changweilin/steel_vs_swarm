// Mixed maps retain a real OSM battle frame and borrow elevation and regional appearance
// from two independently verified road-bearing regions. No geographic centroid is sampled.
// Random maps use independently seeded terrain, street/land-use and regional rules.
// Their local frame never identifies a real region or triggers geographic providers.
//
// 單一真相縫:
//   clampBiomeMix = 地貌比例唯一夾限(水域+沼澤 ≤ 50%,總和恆 1);UI、生成器、
//     伺服器驗證 MUST 全走這一支,MUST NOT 各寫一套。
//   procReliefAt = 程序化起伏唯一實作(座標雜湊值雜訊,零共享 rnd 消耗 —
//     .claude.md B.5:地貌拼圖一律零共享亂數,免推移植被/建築序列)。
//   sanitizeProcRelief = procRelief 欄位唯一淨化(振幅夾上限)。
// 本檔零 three import、零 Node API:瀏覽器 / rooms.js(單機) / Node 稽核共用。
import { MAPGEO, BIOMES, lanesFor, targetDistFor, sideMFor, MOTHER_LANES, laneSubsetFor, xzToLL, llToXZ,
  lanePathBalanceAudit, laneSeparationAudit, towerLayoutAudit, MAX_MAP_WATER_WET } from './data.js';
import { mulberry32 } from './rng.js';
import { MIXED_LAYERS, MIXED_SOURCE_VERSION, validMixedLayers } from './mapLayerSources.js';
import { geographicEnvironment } from './seasonalEnvironment.js';
import { MIXED_MAP_TEXT } from './mixedMapContent.js';
import { RANDOM_MAP_VERSION, RANDOM_MAP_RANGES, randomMapLayers } from './randomMapRules.js';
import { RANDOM_MAP_TEXT } from './randomMapContent.js';
import { MAP_RULE_VERSION, mapGeometryAudit, settleMapMetrics } from './mapRules.js';
import { syntheticLaneEvidence } from './roadEvidence.js';

/** 地貌鍵(與 data.js BIOMES / venues.js mix 同鍵) */
export const GEN_BIOMES = ['urban', 'green', 'bare', 'water', 'wet'];
/** 水域+沼澤上限(使用者定案):可玩性 — 超過一半是水,地面單位無處落腳 */
export const MAX_WATER_WET = MAX_MAP_WATER_WET;
/** 程序化起伏振幅上限(m):波長 ≥150m 時坡度 <16° 平緩帶,不製造新擋坡 */
export const PROC_RELIEF_MAX_M = 12;
/** 程序化起伏基波長(m,遊戲世界) */
export const PROC_RELIEF_WAVE_M = 220;

const R_EARTH = 6371000;

/**
 * 地貌比例唯一夾限:非負 → 正規化總和為 1 → 水域+沼澤超標時等比壓回 50%,
 * 餘額按原比例還給市區/綠地/裸露(三者全零則歸綠地,純水圖不可玩)。
 * 缺鍵補 0,非有限值視為 0;輸入 null/非物件回 null(寧缺勿錯)。
 */
export function clampBiomeMix(mix) {
  if (!mix || typeof mix !== 'object') return null;
  const out = {};
  for (const k of GEN_BIOMES) {
    const v = Number(mix[k]);
    out[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  const sum = GEN_BIOMES.reduce((s, k) => s + out[k], 0);
  if (!(sum > 0)) { out.green = 1; return out; }
  for (const k of GEN_BIOMES) out[k] /= sum;
  const ww = out.water + out.wet;
  if (ww > MAX_WATER_WET) {
    const f = MAX_WATER_WET / ww;
    out.water *= f; out.wet *= f;
    const rest = 1 - MAX_WATER_WET;
    const land = out.urban + out.green + out.bare;
    if (land > 0) {
      const g = rest / land;
      out.urban *= g; out.green *= g; out.bare *= g;
    } else {
      out.green = rest;
    }
  }
  // 四捨五入尾差補第一個非零鍵 ⇒ 總和恆為 1(手法同 venues.js mixFor)
  const fix = GEN_BIOMES.find((k) => out[k] > 0) || 'green';
  out[fix] = Math.round((out[fix] + (1 - GEN_BIOMES.reduce((s, k) => s + out[k], 0))) * 1e4) / 1e4;
  return out;
}

/** 多來源 mix 加權平均 → 唯一夾限(parts:[{mix, weight}]) */
export function blendBiomeMix(parts) {
  const acc = { urban: 0, green: 0, bare: 0, water: 0, wet: 0 };
  let wsum = 0;
  for (const p of (parts || [])) {
    const w = Number(p?.weight);
    if (!p?.mix || !(w > 0)) continue;
    wsum += w;
    for (const k of GEN_BIOMES) {
      const v = Number(p.mix[k]);
      if (Number.isFinite(v) && v > 0) acc[k] += v * w;
    }
  }
  if (!(wsum > 0)) return null;
  for (const k of GEN_BIOMES) acc[k] /= wsum;
  return clampBiomeMix(acc);
}

/** 加權平均(ampF / relief 用);無有效權重回 fallback */
export function blendNum(parts, key, fallback) {
  let s = 0, wsum = 0;
  for (const p of (parts || [])) {
    const w = Number(p?.weight), v = Number(p?.[key]);
    if (!(w > 0) || !Number.isFinite(v)) continue;
    s += v * w; wsum += w;
  }
  return wsum > 0 ? s / wsum : fallback;
}

/** 加權地理質心(parts:[{ll:[lat,lng], weight}]) */
export function centroidOf(parts) {
  let la = 0, ln = 0, wsum = 0;
  for (const p of (parts || [])) {
    const w = Number(p?.weight);
    if (!Array.isArray(p?.ll) || !(w > 0)) continue;
    la += p.ll[0] * w; ln += p.ll[1] * w; wsum += w;
  }
  if (!(wsum > 0)) return null;
  return [la / wsum, ln / wsum];
}

/** FNV-1a 字串 → uint32(種子推導,不耗共享 rnd) */
export function hashSeed(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 座標雜湊 → [0,1)(純函式,跨端一致;鹽字串區分用途) */
function hash01(seedU32, ix, iz, salt) {
  let h = (seedU32 ^ Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ hashSeed(salt)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const sstep = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

/** 值雜訊(雙線性+平滑步,回 [-1,1]) */
function valueNoise(seedU32, x, z, wave) {
  const gx = x / wave, gz = z / wave;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = sstep(gx - ix), fz = sstep(gz - iz);
  const a = hash01(seedU32, ix, iz, 'rel') * 2 - 1;
  const b = hash01(seedU32, ix + 1, iz, 'rel') * 2 - 1;
  const c = hash01(seedU32, ix, iz + 1, 'rel') * 2 - 1;
  const d = hash01(seedU32, ix + 1, iz + 1, 'rel') * 2 - 1;
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

/**
 * 程序化起伏(唯一實作,回 [-1,1]):3 倍頻 fBm,基波長 PROC_RELIEF_WAVE_M。
 * 座標雜湊 ⇒ 同 (seed,x,z) 跨端逐位元一致;零共享 rnd 消耗。
 */
export function procReliefAt(seedU32, x, z) {
  const s = seedU32 >>> 0;
  return valueNoise(s, x, z, PROC_RELIEF_WAVE_M) * 0.6
    + valueNoise(s, x + 1317, z - 719, PROC_RELIEF_WAVE_M / 2.3) * 0.28
    + valueNoise(s, x - 911, z + 1541, PROC_RELIEF_WAVE_M / 5.1) * 0.12;
}

/** procRelief 欄位唯一淨化:非法 → null(關閉);振幅夾 [0,上限] */
export function sanitizeProcRelief(p) {
  if (!p || typeof p !== 'object') return null;
  const seed = Number(p.seed), amp = Number(p.amp);
  if (!Number.isFinite(seed) || !Number.isFinite(amp) || !(amp > 0)) return null;
  return { seed: seed >>> 0, amp: Math.min(PROC_RELIEF_MAX_M, amp) };
}

// ---- 經緯度小工具(與 mapSelect/venues 同算法,僅供本縫內部使用)----
function distMeters(a, b) {
  const x = (b[1] - a[1]) * Math.PI / 180 * R_EARTH * Math.cos(a[0] * Math.PI / 180);
  const z = (b[0] - a[0]) * Math.PI / 180 * R_EARTH;
  return Math.hypot(x, z);
}

function destPoint([lat, lng], bearingDeg, d) {
  const br = bearingDeg * Math.PI / 180;
  return [
    lat + d * Math.cos(br) / R_EARTH * 180 / Math.PI,
    lng + d * Math.sin(br) / (R_EARTH * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI,
  ];
}

/**
 * 確定性合成兵線(side:-1/0/+1):結構同 venues.synthLane(側移主脊+交錯側擺+
 * Chaikin 平滑),但亂數流由 (seedU32, A, B) 推導 ⇒ 同一種子同輸出、不同種子
 * 與既有合成線不同構(隨機地圖「不可完全與現實地圖相同」的一環)。
 */
export function synthGenLanes(A, B, L, seedU32) {
  const cosLat = Math.cos(A[0] * Math.PI / 180);
  const vx = (B[1] - A[1]) * Math.PI / 180 * R_EARTH * cosLat;
  const vz = (B[0] - A[0]) * Math.PI / 180 * R_EARTH;
  const d = Math.hypot(vx, vz) || 1;
  const px = -vz / d, pz = vx / d;
  // 種子不含 side:三線共用同一組側擺相位(同進同退),線間距離恆為主脊間距,
  // 側擺不會互相吃掉分離度(與 venues.synthLane 同構;跨線共用一條 rnd 流反而會互穿)。
  const laneRnd = () => mulberry32((hashSeed(`${A[0].toFixed(5)},${A[1].toFixed(5)}|${B[0].toFixed(5)},${B[1].toFixed(5)}`) ^ (seedU32 >>> 0)) >>> 0);
  const latOf = (t, lateral) => [
    A[0] + (B[0] - A[0]) * t + lateral * pz / R_EARTH * 180 / Math.PI,
    A[1] + (B[1] - A[1]) * t + lateral * px / (R_EARTH * cosLat) * 180 / Math.PI,
  ];
  const one = (side) => {
    const rnd = laneRnd();
    const N = Math.max(3, Math.round(d / (400 * MAPGEO.REAL_SCALE)));
    const spacing = d / (N + 1);
    const ctrl = [[...A]];
    const phase = rnd() * Math.PI * 2;   // 種子相位:同進同退的擺動起點不同構
    for (let i = 1; i <= N; i++) {
      const t = i / (N + 1);
      const spine = d * MAPGEO.LANE_OFFSET_FRAC * side * Math.sin(Math.PI * t);
      const wiggle = Math.sin(phase + i * 1.7) * spacing * (0.30 + rnd() * 0.18);
      ctrl.push(latOf(t, spine + wiggle));
    }
    ctrl.push([...B]);
    const pts = [ctrl[0]];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const [x1, y1] = ctrl[i], [x2, y2] = ctrl[i + 1];
      pts.push([x1 * 0.75 + x2 * 0.25, y1 * 0.75 + y2 * 0.25]);
      pts.push([x1 * 0.25 + x2 * 0.75, y1 * 0.25 + y2 * 0.75]);
    }
    pts.push(ctrl[ctrl.length - 1]);
    return pts;
  };
  const sides = L === 1 ? [0] : L === 2 ? [1, -1] : [1, 0, -1];
  return sides.map(one);
}

/** 兩堡/兵線骨架 → battleConfig 外殼(混合/隨機共用;幾何公式與現制同源)。
 * 框架恆為三線母體(2026-09-25 同一張圖):邊長/兩堡距取母體尺度,lanes 為當下啟用子集。 */
function genConfigShell({ A, B, lanes, mother, mix, ampF, name, venueId, mode, seed, sources, procAmp }) {
  const L = lanes.length;
  const sub = laneSubsetFor(L);
  const D = targetDistFor(MOTHER_LANES);
  const sizeM = sideMFor(MOTHER_LANES);
  const distGame = distMeters(A, B) / MAPGEO.REAL_SCALE;
  return settleMapMetrics({
    center: { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2, rot: 0 },
    bases: { SWARM: A, STEEL: B },
    lanes,
    laneCount: L,
    laneIds: [...sub],
    motherLanes: (mother || lanes).map((l) => l.map((p) => [...p])),
    sizeM, diagM: sizeM * Math.SQRT2, distM: distGame,
    geoScaleVer: MAPGEO.GEO_SCALE_VER,
    mapRuleVersion: MAP_RULE_VERSION, roadMode: 'procedural',
    roadSources: (mother || lanes).map(syntheticLaneEvidence),
    tactics: null,
    synthetic: true, precomputed: true,
    venue: { id: venueId, name, mix, country: null, base: null, variant: mode, ampF },
    procRelief: sanitizeProcRelief({ seed, amp: procAmp }),
    gen: { mode, seed: seed >>> 0, sources: (sources || []).map((s) => ({ name: s.name || '', weight: s.weight || 0 })) },
    placeName: name,
    defSide: null,
  });
}

/** Assemble verified source layers; absence of a real three-road mother fails closed. */
export function mixedMapConfig(sources, opts = {}) {
  if (!Array.isArray(sources) || sources.length !== MIXED_LAYERS.length) return null;
  const list = MIXED_LAYERS.map(role => sources.find(s => s?.role === role));
  if (list.some(s => !s?.frame?.center)) return null;
  const layers = Object.fromEntries(list.map(s => [s.role, {
    id: s.id, name: s.name || '', center: { ...s.frame.center }, roadCount: s.roadCount,
  }]));
  if (!validMixedLayers(layers)) return null;
  const elevation = list[0], surface = list[1], regional = list[2];
  const frame = surface.frame;
  if (!Array.isArray(frame.motherLanes) || frame.motherLanes.length !== MOTHER_LANES
    || frame.synthetic || surface.laneSource !== 'osm-baked') return null;
  const teamSize = Math.max(1, Math.min(5, opts.teamSize | 0 || 1));
  const L = lanesFor(teamSize);
  const mix = opts.mixOverride ? clampBiomeMix(opts.mixOverride) : blendBiomeMix(list);
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : hashSeed(list.map(s => s.id).join('|'));
  const mother = frame.motherLanes.map(lane => lane.map(p => [...p]));
  const sub = laneSubsetFor(L);
  const profile = geographicEnvironment(regional.frame.center.lat, regional.frame.center.lng);
  if (!profile) return null;
  const name = MIXED_MAP_TEXT.name(list.map(s => s.name));
  return {
    ...frame, center: { ...frame.center },
    bases: { SWARM: [...frame.bases.SWARM], STEEL: [...frame.bases.STEEL] },
    lanes: sub.map(i => mother[i]), motherLanes: mother, laneIds: [...sub], laneCount: L,
    synthetic: false, procRelief: null, mapEvidence: null,
    roadTerrain: null,
    venue: { id: `mixed-${seed.toString(16)}-${list.map(s => s.id).join('-')}`, name, mix,
      country: regional.country || null, base: null, variant: 'mixed', ampF: elevation.ampF ?? 1,
      forest: profile },
    gen: { mode: 'mixed', version: MIXED_SOURCE_VERSION, seed, layers, laneSource: 'osm-baked',
      sources: list.map(s => ({ id: s.id, role: s.role, name: s.name || '', weight: 1 })) },
    placeName: name,
  };
}

/** Three independently seeded procedural layers; center is an inert local projection frame. */
export function randomMapConfig(opts = {}) {
  const teamSize = Math.max(1, Math.min(5, opts.teamSize | 0 || 1));
  const seed = (opts.seed != null && Number.isFinite(Number(opts.seed)))
    ? Number(opts.seed) >>> 0 : (Math.random() * 4294967296) >>> 0;
  const layers = randomMapLayers(seed, opts.ranges);
  const rnd = mulberry32(seed);
  const center = { lat: 0, lng: 0, rot: 0 };
  const p = layers.surface;
  const rest = 1 - p.urbanFraction - p.waterFraction - p.wetFraction;
  const mix = clampBiomeMix({ urban: p.urbanFraction, water: p.waterFraction, wet: p.wetFraction,
    bare: rest * p.bareFraction, green: rest * (1 - p.bareFraction) });
  const L = lanesFor(teamSize);
  const D = targetDistFor(MOTHER_LANES);
  const angle = rnd() * Math.PI * 2;
  const A = xzToLL(-Math.sin(angle) * D / 2, -Math.cos(angle) * D / 2, center);
  const B = xzToLL(Math.sin(angle) * D / 2, Math.cos(angle) * D / 2, center);
  let mother = null;
  for (let attempt = 0; attempt < 32; attempt++) {
    const candidate = synthGenLanes(A, B, MOTHER_LANES, (seed ^ 0x9E3779B9 ^ Math.imul(attempt, 0x85ebca6b)) >>> 0);
    const ids = laneSubsetFor(L);
    const frame = { center, bases: { SWARM: A, STEEL: B }, motherLanes: candidate,
      lanes: ids.map(i => candidate[i]), laneIds: ids, laneCount: L, sizeM: sideMFor(MOTHER_LANES) };
    if (mapGeometryAudit(frame, teamSize).ok) {
      mother = candidate; break;
    }
  }
  if (!mother) return null;
  const lanes = laneSubsetFor(L).map((i) => mother[i]);
  const cfg = genConfigShell({
    A, B, lanes, mother, mix, ampF: 0,
    name: RANDOM_MAP_TEXT.name(seed),
    venueId: `random-${(seed >>> 0).toString(16)}`,
    mode: 'random', seed, sources: [], procAmp: 0,
  });
  cfg.center = center;
  cfg.gen = { mode: 'random', version: RANDOM_MAP_VERSION, seed, layers, sources: [] };
  cfg.venue.forest = { ...layers.regional, geologyInferred: true,
    rainfall: layers.regional.rainfallMm,
    rainfallIntensity: layers.regional.rainfallMm / RANDOM_MAP_RANGES.regional.rainfallMm[1],
    volcanic: ['basalt', 'volcanic'].includes(layers.regional.geology) ? .8 : 0 };
  return mapGeometryAudit(cfg, teamSize).ok ? cfg : null;
}

/** 生成摘要一行(UI 狀態列 / 稽核共用同一份,不各寫一套) */
export function describeGen(cfg) {
  if (!cfg?.gen && !cfg?.procRelief) return '';
  const bioName = { urban: '市區', green: '綠地', bare: '裸露', water: '水域', wet: '沼澤' };
  const mix = cfg.venue?.mix
    ? Object.entries(cfg.venue.mix).map(([k, f]) => `${bioName[k]}${Math.round(f * 100)}%`).join('・')
    : '—';
  const mode = cfg.gen?.mode === 'mixed' ? '混合地圖' : cfg.gen?.mode === 'random' ? '隨機地圖' : '生成地圖';
  return `${mode}｜${mix}｜兩堡 ${(cfg.distM / 1000).toFixed(2)}km・${cfg.laneCount}線`;
}

/** 地貌鍵中文名(UI 滑桿 / 摘要共用) */
export function biomeName(k) {
  return BIOMES[k]?.name || k;
}
