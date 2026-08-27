// ============ 生態動物群 (鳥群 / 魚群 / 貓 / 狗; 唯一縫) ============
// 2026-08-16 序 11 / 2026-08-27 生態擴充。以飛鳥技術擴充至魚群、貓、狗之活動行為:
//   導引曲線 + 逐軸不同時標的噪聲 + 弱彈簧 + 幀率無關摩擦阻尼 + 分群 + `uSnap`。
//
// ---- 五條紀律(每一條壞掉都沒有錯誤訊息)----
//  ① **零 THREE**: 本檔只算位置、速度與姿態，建 mesh 的動作住 `biomes.buildWildlife`。
//     四項積分器離線直測的依據(同 `edgewall.js` / `flags.js` / `petals.js`)。
//  ② **零共享 `rnd()` 消耗**(§2.3 / A4): 相位 / 速度抖動 / 分群偏移一律由
//     **座標雜湊** `flockSeed(x, z)` 餵自己的 `mulberry32`。
//  ③ **摩擦走 `data.js frictionFPS`**(§2.1 F「幀率無關阻尼」的唯一縫),
//     MUST NOT 寫 `v *= 0.99` —— 那是幀率相依的。
//     每秒係數 `springPS()` 由 `SPRING` (每 60fps 幀之係數) 推導，MUST NOT 兩個都手寫。
//  ④ **錨不到就不放**(原則 6): 生態活動依真實圖資錨點生成。
//     鳥群: 水域岸線 > 神木林 > 地標
//     魚群: 水體內部 / 沿岸水下
//     貓咪: 聚落庭院 / 屋頂邊緣 / 巷弄 / 林緣
//     狗狗: 人行街道 / 公園綠地 / 聚落前庭
//     **MUST NOT 拿兵線 / 塔位 / 主堡當錨**: 避免洩漏戰術資訊。
//  ⑤ **時鐘由呼叫端給**(`celWindTime()`): 與雲、植被共用同一個環境風時鐘。
import { mulberry32 } from './rng.js';
import { frictionFPS } from './data.js';

export const FLOCK = {
  // —— 六項核心參數 (鳥群) ——
  SPRING: 0.0003,        // 弱彈簧(每 60fps 幀的係數); 每秒係數見 springPS()
  FRICTION_K: 0.9,       // 摩擦(每秒; 走 frictionFPS ⇒ 幀率無關)
  GROUPS: 5,             // 分群數
  NOISE_AMP: [2.2, 0.9, 2.2],      // 逐軸噪聲振幅(m)—— y 軸小(鳥不上下亂彈)
  NOISE_TS: [0.05, 0.10, 0.025],   // 逐軸不同時標(同時標 = 球形抖動)
  SPEED_JITTER: 0.22,    // 逐隻巡航速度抖動(±比例)
  // —— 曲線與編隊 ——
  CURVE_N: 48,           // 曲線取樣點數(閉合環)
  SPEED: 12,             // 沿曲線的巡航速度(m/s)
  ALT_BAND: [16, 42],    // 離地高帶(m)
  GROUP_SPREAD: 0.55,    // 分群沿曲線的最大相對偏移
  COUNTS: { shore: 9, grove: 5, landmark: 3 },   // 逐錨點型的隻數
  MAX_ROUTES: 3,         // 一張圖最多幾條曲線
  // —— 稽核用的行為門檻 ——
  TRACK_MIN: 4.0,        // 弱彈簧的證明 RMS 距離(m)
  SPREAD_F: 0.30,        // 弧長跨度比例
  V_MAX: 26,             // |v| 峰值上界(m/s)
  TS_RATIO: 1.6,         // 逐軸噪聲過零率 max/min 比值門檻
  DT_MAX: 0.25,          // 逐幀 dt 夾制
  WING_HZ: 3.4,          // 拍翼頻率
  WING_MAX: 0.85,        // 拍翼幅度(rad)
};

export const FISH = {
  // —— 魚群核心參數 ——
  SPRING: 0.0004,        // 水中群聚弱彈簧
  FRICTION_K: 0.88,      // 水阻流體黏滯阻尼
  GROUPS: 6,             // 魚群高凝聚分群
  NOISE_AMP: [1.6, 0.35, 1.6],     // 魚群以水平游動為主，y 軸垂直起伏小
  NOISE_TS: [0.08, 0.03, 0.08],
  SPEED_JITTER: 0.25,
  CURVE_N: 48,
  SPEED: 4.8,            // 巡航游動速度 (m/s)
  DEPTH_BAND: [0.5, 2.2],// 水下深度帶 (m)
  GROUP_SPREAD: 0.45,
  COUNTS: { shore: 12, grove: 8, water: 16 },
  MAX_ROUTES: 3,
  TAIL_HZ: 4.2,          // 擺尾頻率 (Hz)
  TAIL_MAX: 0.52,        // 擺尾幅度 (rad)
  TRACK_MIN: 2.0,
  SPREAD_F: 0.30,
  V_MAX: 15,
  TS_RATIO: 1.6,
  DT_MAX: 0.25,
};

export const CAT = {
  // —— 貓咪活動參數 ——
  SPRING: 0.0005,
  FRICTION_K: 0.85,
  GROUPS: 2,             // 獨行或一對
  NOISE_AMP: [0.8, 0.04, 0.8],     // 貼地活動，y 軸極小
  NOISE_TS: [0.03, 0.01, 0.03],    // 悠閒漫遊時標
  SPEED_JITTER: 0.18,
  CURVE_N: 36,
  SPEED: 1.8,            // 慢步踱步速度 (m/s)
  GROUND_OFFSET: 0.15,   // 著地高度 (m)
  GROUP_SPREAD: 0.25,
  COUNTS: { settlement: 2, alley: 1, rooftop: 2, grove: 2 },
  MAX_ROUTES: 3,
  TAIL_HZ: 1.4,          // 優雅慢速微擺 (Hz)
  TAIL_MAX: 0.45,        // 尾巴微彎幅度 (rad)
  STRIDE_HZ: 2.8,        // 步伐頻率
  TRACK_MIN: 1.0,
  SPREAD_F: 0.15,
  V_MAX: 8,
  TS_RATIO: 1.6,
  DT_MAX: 0.25,
};

export const DOG = {
  // —— 狗狗活動參數 ——
  SPRING: 0.0004,
  FRICTION_K: 0.86,
  GROUPS: 2,
  NOISE_AMP: [1.2, 0.06, 1.2],
  NOISE_TS: [0.06, 0.02, 0.06],
  SPEED_JITTER: 0.20,
  CURVE_N: 36,
  SPEED: 4.2,            // 巡邏輕快小跑速度 (m/s)
  GROUND_OFFSET: 0.22,   // 著地高度 (m)
  GROUP_SPREAD: 0.30,
  COUNTS: { settlement: 2, street: 3, meadow: 2 },
  MAX_ROUTES: 3,
  TAIL_HZ: 5.4,          // 興奮快速搖尾 (Hz)
  TAIL_MAX: 0.65,        // 搖尾幅度 (rad)
  BOUNCE_HZ: 4.8,        // 小跑微彈跳頻率 (Hz)
  BOUNCE_AMP: 0.035,     // 彈跳振幅 (m)
  TRACK_MIN: 1.5,
  SPREAD_F: 0.20,
  V_MAX: 12,
  TS_RATIO: 1.6,
  DT_MAX: 0.25,
};

export const FPS_REF = 60;
export const springPS = () => FLOCK.SPRING * FPS_REF * FPS_REF;
export const specSpringPS = (spec) => (spec?.SPRING || FLOCK.SPRING) * FPS_REF * FPS_REF;

/**
 * 座標雜湊種子。零共享 `rnd()` 消耗。
 */
export function flockSeed(x, z) {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) | 0;
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
}

// 確定性 sin-hash 噪聲(逐隻 × 逐軸 × 逐時標)。MUST NOT 用 Math.random()
const nz = (seed, i, axis, t) => {
  const a = Math.sin((seed % 9973) * 0.0007 + i * 12.9898 + axis * 78.233) * 43758.5453;
  const ph = a - Math.floor(a);
  return Math.sin((t + ph) * Math.PI * 2) * 0.6 + Math.sin((t * 1.618 + ph * 3.1) * Math.PI * 2) * 0.4;
};

// ---- 曲線取樣工具(純幾何)----
const resample = (poly, n, closed) => {
  const pts = new Float32Array(n * 3);
  const seg = [];
  let total = 0;
  const m = poly.length;
  const last = closed ? m : m - 1;
  for (let i = 0; i < last; i++) {
    const a = poly[i], b = poly[(i + 1) % m];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(d); total += d;
  }
  if (!(total > 0)) return null;
  let si = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total;
    while (si < seg.length - 1 && acc + seg[si] < want) { acc += seg[si]; si++; }
    const f = seg[si] > 0 ? (want - acc) / seg[si] : 0;
    const a = poly[si], b = poly[(si + 1) % m];
    pts[k * 3] = a[0] + (b[0] - a[0]) * f;
    pts[k * 3 + 2] = a[1] + (b[1] - a[1]) * f;
  }
  return { pts, total };
};

/** 曲線上參數 u ∈ [0,1) 的點(線性內插; 閉合環) */
export function curveAt(st, u, out) {
  const n = st.n;
  const f = ((u % 1) + 1) % 1 * n;
  const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, w = f - Math.floor(f);
  for (let a = 0; a < 3; a++) out[a] = st.pts[i0 * 3 + a] + (st.pts[i1 * 3 + a] - st.pts[i0 * 3 + a]) * w;
  return out;
}

/**
 * 規劃鳥群航線。純幾何、零共享 `rnd()`。
 */
export function planFlockRoutes({ anchors = {}, probe, bounds, altMax = Infinity, ceilY = Infinity, low = false }) {
  const out = [];
  const clampXZ = (x, z) => [
    Math.max(bounds.minX, Math.min(bounds.maxX, x)),
    Math.max(bounds.minZ, Math.min(bounds.maxZ, z)),
  ];
  const finish = (kind, poly, closed) => {
    if (out.length >= FLOCK.MAX_ROUTES || poly.length < 3) return;
    const r = resample(poly.map(([x, z]) => clampXZ(x, z)), FLOCK.CURVE_N, closed);
    if (!r) return;
    const seed = flockSeed(r.pts[0], r.pts[2]);
    const rnd = mulberry32(seed);
    const alt = Math.min(altMax, FLOCK.ALT_BAND[0] + rnd() * (FLOCK.ALT_BAND[1] - FLOCK.ALT_BAND[0]));
    for (let i = 0; i < FLOCK.CURVE_N; i++) {
      const g = probe(r.pts[i * 3], r.pts[i * 3 + 2]) || 0;
      r.pts[i * 3 + 1] = Math.min(ceilY, g + alt);
    }
    const base = FLOCK.COUNTS[kind] || 3;
    const count = Math.max(2, low ? Math.round(base / 2) : base);
    out.push({ kind, pts: r.pts, n: FLOCK.CURVE_N, len: r.total, count, seed, spec: FLOCK });
  };
  // ① 水域岸線
  const shore = anchors.shore;
  if (shore && shore.length >= 3) finish('shore', shore, true);
  // ② 神木林
  const gr = anchors.groves || [];
  if (gr.length >= 2) {
    const a = gr[0], b = gr[1];
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const dx = b.x - a.x, dz = b.z - a.z;
    const half = Math.hypot(dx, dz) / 2 + Math.max(a.r || 0, b.r || 0);
    const ux = half > 0 ? dx / (half * 2) : 1, uz = half > 0 ? dz / (half * 2) : 0;
    const minor = Math.max(24, half * 0.45);
    const poly = [];
    for (let i = 0; i < 24; i++) {
      const th = (i / 24) * Math.PI * 2;
      const ca = Math.cos(th) * half, sa = Math.sin(th) * minor;
      poly.push([cx + ux * ca - uz * sa, cz + uz * ca + ux * sa]);
    }
    finish('grove', poly, true);
  } else if (gr.length === 1) {
    const a = gr[0], rr = Math.max(30, (a.r || 0) * 2.2);
    finish('grove', Array.from({ length: 20 }, (_, i) => {
      const th = (i / 20) * Math.PI * 2;
      return [a.x + Math.cos(th) * rr, a.z + Math.sin(th) * rr];
    }), true);
  }
  // ③ 地標
  const lm = (anchors.landmarks || [])[0];
  if (lm) {
    const rr = Math.max(22, (lm.r || 10) * 1.8);
    finish('landmark', Array.from({ length: 18 }, (_, i) => {
      const th = (i / 18) * Math.PI * 2;
      return [lm.x + Math.cos(th) * rr, lm.z + Math.sin(th) * rr];
    }), true);
  }
  return out;
}

/**
 * 規劃水下魚群迴游路徑。
 */
export function planFishRoutes({ anchors = {}, probe, bounds, waterY = null, low = false }) {
  const out = [];
  if (waterY == null) return out;
  const clampXZ = (x, z) => [
    Math.max(bounds.minX, Math.min(bounds.maxX, x)),
    Math.max(bounds.minZ, Math.min(bounds.maxZ, z)),
  ];
  const finish = (kind, poly, closed) => {
    if (out.length >= FISH.MAX_ROUTES || poly.length < 3) return;
    const r = resample(poly.map(([x, z]) => clampXZ(x, z)), FISH.CURVE_N, closed);
    if (!r) return;
    const seed = flockSeed(r.pts[0], r.pts[2]);
    const rnd = mulberry32(seed);
    const dTarget = FISH.DEPTH_BAND[0] + rnd() * (FISH.DEPTH_BAND[1] - FISH.DEPTH_BAND[0]);
    for (let i = 0; i < FISH.CURVE_N; i++) {
      const bedY = probe(r.pts[i * 3], r.pts[i * 3 + 2]) || (waterY - 4);
      // 水中深度夾制: 保持在床底之上 0.15m 與水面下 0.25m 之間
      const y = Math.max(bedY + 0.15, Math.min(waterY - 0.25, waterY - dTarget));
      r.pts[i * 3 + 1] = y;
    }
    const base = FISH.COUNTS[kind] || 8;
    const count = Math.max(2, low ? Math.round(base / 2) : base);
    out.push({ kind, pts: r.pts, n: FISH.CURVE_N, len: r.total, count, seed, spec: FISH });
  };

  // ① 沿水岸水下游動線 (微內縮)
  const shore = anchors.shore;
  if (shore && shore.length >= 3) {
    const cx = shore.reduce((s, p) => s + p[0], 0) / shore.length;
    const cz = shore.reduce((s, p) => s + p[1], 0) / shore.length;
    const insetPoly = shore.map(([x, z]) => [x * 0.88 + cx * 0.12, z * 0.88 + cz * 0.12]);
    finish('shore', insetPoly, true);
  }
  // ② 神木林或深水水體中心環線
  const gr = anchors.groves || [];
  if (gr.length >= 1) {
    const g = gr[0], rr = Math.max(16, (g.r || 15) * 1.2);
    finish('grove', Array.from({ length: 18 }, (_, i) => {
      const th = (i / 18) * Math.PI * 2;
      return [g.x + Math.cos(th) * rr, g.z + Math.sin(th) * rr];
    }), true);
  }
  return out;
}

/**
 * 規劃貓咪活動路徑 (聚落角落 / 屋頂邊緣 / 矮牆 / 林緣)。
 */
export function planCatRoutes({ anchors = {}, probe, bounds, low = false }) {
  const out = [];
  const clampXZ = (x, z) => [
    Math.max(bounds.minX, Math.min(bounds.maxX, x)),
    Math.max(bounds.minZ, Math.min(bounds.maxZ, z)),
  ];
  const finish = (kind, poly, closed) => {
    if (out.length >= CAT.MAX_ROUTES || poly.length < 3) return;
    const r = resample(poly.map(([x, z]) => clampXZ(x, z)), CAT.CURVE_N, closed);
    if (!r) return;
    const seed = flockSeed(r.pts[0], r.pts[2]);
    for (let i = 0; i < CAT.CURVE_N; i++) {
      const g = probe(r.pts[i * 3], r.pts[i * 3 + 2]) || 0;
      r.pts[i * 3 + 1] = g + CAT.GROUND_OFFSET;
    }
    const base = CAT.COUNTS[kind] || 2;
    const count = Math.max(1, low ? Math.round(base / 2) : base);
    out.push({ kind, pts: r.pts, n: CAT.CURVE_N, len: r.total, count, seed, spec: CAT });
  };

  // ① 聚落巷弄與庭院
  const setts = anchors.settlements || anchors.landmarks || [];
  for (let sIdx = 0; sIdx < Math.min(2, setts.length); sIdx++) {
    const s = setts[sIdx];
    const rr = Math.max(10, (s.r || 12) * 0.85);
    finish('settlement', Array.from({ length: 16 }, (_, i) => {
      const th = (i / 16) * Math.PI * 2;
      return [s.x + Math.cos(th) * rr, s.z + Math.sin(th) * rr];
    }), true);
  }
  // ② 林緣漫遊
  const gr = anchors.groves || [];
  if (gr.length >= 1 && out.length < CAT.MAX_ROUTES) {
    const g = gr[0], rr = Math.max(12, (g.r || 15) * 0.9);
    finish('grove', Array.from({ length: 16 }, (_, i) => {
      const th = (i / 16) * Math.PI * 2;
      return [g.x + Math.cos(th) * rr, g.z + Math.sin(th) * rr];
    }), true);
  }
  return out;
}

/**
 * 規劃狗狗活動路徑 (道路街道邊緣 / 公園綠地 / 聚落前庭)。
 */
export function planDogRoutes({ anchors = {}, probe, bounds, low = false }) {
  const out = [];
  const clampXZ = (x, z) => [
    Math.max(bounds.minX, Math.min(bounds.maxX, x)),
    Math.max(bounds.minZ, Math.min(bounds.maxZ, z)),
  ];
  const finish = (kind, poly, closed) => {
    if (out.length >= DOG.MAX_ROUTES || poly.length < 3) return;
    const r = resample(poly.map(([x, z]) => clampXZ(x, z)), DOG.CURVE_N, closed);
    if (!r) return;
    const seed = flockSeed(r.pts[0], r.pts[2]);
    for (let i = 0; i < DOG.CURVE_N; i++) {
      const g = probe(r.pts[i * 3], r.pts[i * 3 + 2]) || 0;
      r.pts[i * 3 + 1] = g + DOG.GROUND_OFFSET;
    }
    const base = DOG.COUNTS[kind] || 2;
    const count = Math.max(1, low ? Math.round(base / 2) : base);
    out.push({ kind, pts: r.pts, n: DOG.CURVE_N, len: r.total, count, seed, spec: DOG });
  };

  // ① 聚落前庭
  const setts = anchors.settlements || anchors.landmarks || [];
  if (setts.length >= 1) {
    const s = setts[0];
    const rx = Math.max(15, (s.r || 14) * 1.3), rz = Math.max(10, (s.r || 14) * 0.8);
    finish('settlement', Array.from({ length: 16 }, (_, i) => {
      const th = (i / 16) * Math.PI * 2;
      return [s.x + Math.cos(th) * rx, s.z + Math.sin(th) * rz];
    }), true);
  }
  // ② 草地 / 神木林周圍小跑
  const gr = anchors.groves || [];
  if (gr.length >= 1 && out.length < DOG.MAX_ROUTES) {
    const g = gr[0], rr = Math.max(18, (g.r || 16) * 1.4);
    finish('meadow', Array.from({ length: 16 }, (_, i) => {
      const th = (i / 16) * Math.PI * 2;
      return [g.x + Math.cos(th) * rr, g.z + Math.sin(th) * rr];
    }), true);
  }
  return out;
}

/**
 * 通用生態狀態初始化。
 */
export function wildlifeInit(route, spec = null) {
  const cfg = spec || route.spec || FLOCK;
  const n = route.count;
  const rnd = mulberry32((route.seed * 2654435761) >>> 0);
  const st = {
    pts: route.pts, n: route.n, len: route.len, kind: route.kind, seed: route.seed, count: n,
    pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
    spd: new Float32Array(n), off: new Float32Array(n), wing: new Float32Array(n),
    t: 0, spec: cfg,
  };
  for (let i = 0; i < n; i++) {
    st.spd[i] = 1 + (rnd() - 0.5) * 2 * cfg.SPEED_JITTER;
    const g = i % cfg.GROUPS;
    st.off[i] = (g / cfg.GROUPS + (rnd() - 0.5) * 0.06 / cfg.GROUPS) * cfg.GROUP_SPREAD;
    st.wing[i] = rnd();
  }
  wildlifeSnap(st, cfg);
  return st;
}

/** 向後相容既有鳥群 flockInit 簽章 */
export function flockInit(route) {
  return wildlifeInit(route, FLOCK);
}

/** 第 i 隻動物這一刻的「目標點」(曲線 + 逐軸不同時標的噪聲) */
function targetOf(st, i, t, out, spec = null) {
  const cfg = spec || st.spec || FLOCK;
  const u = (t * cfg.SPEED * st.spd[i]) / st.len + st.off[i];
  curveAt(st, u, out);
  for (let a = 0; a < 3; a++) out[a] += cfg.NOISE_AMP[a] * nz(st.seed, i, a, t * cfg.NOISE_TS[a] * 10);
  return out;
}

const _tg = [0, 0, 0];

/**
 * 通用一步積分 (曲線目標 + 逐軸噪聲 + 弱彈簧 + 摩擦阻尼)。
 */
export function wildlifeStep(st, t, dt, spec = null) {
  const cfg = spec || st.spec || FLOCK;
  const d = Math.max(0, Math.min(cfg.DT_MAX, dt || 0));
  st.t = t;
  const kSpring = specSpringPS(cfg) * d;
  const fr = frictionFPS(cfg.FRICTION_K, d);
  for (let i = 0; i < st.count; i++) {
    targetOf(st, i, t, _tg, cfg);
    for (let a = 0; a < 3; a++) {
      const j = i * 3 + a;
      st.vel[j] += (_tg[a] - st.pos[j]) * kSpring;
      st.vel[j] *= fr;
      st.pos[j] += st.vel[j] * d;
    }
  }
  return st;
}

/** 向後相容既有鳥群 flockStep 簽章 */
export function flockStep(st, t, dt) {
  return wildlifeStep(st, t, dt, FLOCK);
}

/**
 * uSnap: 貼齊曲線並歸零速度。
 */
export function wildlifeSnap(st, spec = null) {
  const cfg = spec || st.spec || FLOCK;
  for (let i = 0; i < st.count; i++) {
    targetOf(st, i, st.t, _tg, cfg);
    for (let a = 0; a < 3; a++) {
      st.pos[i * 3 + a] = _tg[a];
      st.vel[i * 3 + a] = 0;
    }
  }
  return st;
}

/** 向後相容既有鳥群 flockSnap 簽章 */
export function flockSnap(st) {
  return wildlifeSnap(st, FLOCK);
}

/**
 * 計算前進朝向向量。
 */
export function wildlifeHeading(st, i, out, spec = null) {
  const cfg = spec || st.spec || FLOCK;
  const j = i * 3;
  const vx = st.vel[j], vz = st.vel[j + 2];
  if (vx * vx + vz * vz > 1e-8) {
    out[0] = vx; out[1] = st.vel[j + 1]; out[2] = vz;
    return out;
  }
  const u = (st.t * cfg.SPEED * st.spd[i]) / st.len + st.off[i];
  const a = [0, 0, 0], b = [0, 0, 0];
  curveAt(st, u, a); curveAt(st, u + 0.01, b);
  out[0] = b[0] - a[0]; out[1] = b[1] - a[1]; out[2] = b[2] - a[2];
  return out;
}

/** 向後相容既有鳥群 flockHeading 簽章 */
export function flockHeading(st, i, out) {
  return wildlifeHeading(st, i, out, FLOCK);
}

/** 鳥群拍翼角 (rad) */
export function wingAngle(st, i, t) {
  const cfg = st.spec || FLOCK;
  return Math.sin((t * (cfg.WING_HZ || 3.4) + st.wing[i]) * Math.PI * 2) * (cfg.WING_MAX || 0.85);
}

/** 魚尾 / 貓尾 / 狗尾擺動角 (rad) */
export function tailAngle(st, i, t, spec = null) {
  const cfg = spec || st.spec || FLOCK;
  const hz = cfg.TAIL_HZ || 3.0;
  const max = cfg.TAIL_MAX || 0.5;
  return Math.sin((t * hz + st.wing[i]) * Math.PI * 2) * max;
}

/** 狗狗小跑步態垂直彈跳位移 (m) */
export function bounceOffset(st, i, t, spec = null) {
  const cfg = spec || st.spec || DOG;
  const hz = cfg.BOUNCE_HZ || DOG.BOUNCE_HZ;
  const amp = cfg.BOUNCE_AMP || DOG.BOUNCE_AMP;
  return Math.abs(Math.sin((t * hz + st.wing[i]) * Math.PI * 2)) * amp;
}

// ============ 純資料零件描述子 ============

export function birdParts() {
  return [
    { g: ['cone', 0.10, 0.46, 5], c: 0x2f3238, p: [0, 0, 0], r: [Math.PI / 2, 0, 0], key: 'body' },
    { g: ['cone', 0.045, 0.16, 4], c: 0xd8a24a, p: [0, 0, 0.30], r: [Math.PI / 2, 0, 0], key: 'beak' },
    { g: ['box', 0.05, 0.12, 0.20], c: 0x24272c, p: [0, 0.06, -0.26], r: [-0.55, 0, 0], key: 'tail' },
    { g: ['box', 0.34, 0.02, 0.13], c: 0x3a3e45, p: [0.20, 0.02, 0.02], wing: 1, key: 'wingL' },
    { g: ['box', 0.34, 0.02, 0.13], c: 0x3a3e45, p: [-0.20, 0.02, 0.02], wing: -1, key: 'wingR' },
  ];
}

export function fishParts() {
  return [
    { g: ['box', 0.12, 0.18, 0.52], c: 0x48768e, p: [0, 0, 0], key: 'body' },
    { g: ['cone', 0.10, 0.24, 5], c: 0x5b8fa8, p: [0, 0, 0.30], r: [Math.PI / 2, 0, 0], key: 'head' },
    { g: ['box', 0.02, 0.12, 0.18], c: 0x3d667c, p: [0, 0.12, -0.04], r: [-0.4, 0, 0], key: 'dorsal' },
    { g: ['box', 0.14, 0.02, 0.08], c: 0x4d7c95, p: [0.10, -0.03, 0.10], r: [0, 0.3, -0.3], key: 'pectoralL' },
    { g: ['box', 0.14, 0.02, 0.08], c: 0x4d7c95, p: [-0.10, -0.03, 0.10], r: [0, -0.3, 0.3], key: 'pectoralR' },
    { g: ['box', 0.02, 0.22, 0.22], c: 0x5d93ad, p: [0, 0.02, -0.36], tail: 1, key: 'tail' },
  ];
}

export function catParts() {
  return [
    { g: ['box', 0.16, 0.18, 0.44], c: 0xd4a373, p: [0, 0, 0], key: 'body' },
    { g: ['box', 0.15, 0.14, 0.15], c: 0xddb892, p: [0, 0.08, 0.24], key: 'head' },
    { g: ['cone', 0.04, 0.08, 4], c: 0xbb8555, p: [0.05, 0.18, 0.24], r: [0, 0, -0.2], key: 'earL' },
    { g: ['cone', 0.04, 0.08, 4], c: 0xbb8555, p: [-0.05, 0.18, 0.24], r: [0, 0, 0.2], key: 'earR' },
    { g: ['box', 0.05, 0.16, 0.05], c: 0xcca070, p: [0.06, -0.10, 0.14], key: 'legFL' },
    { g: ['box', 0.05, 0.16, 0.05], c: 0xcca070, p: [-0.06, -0.10, 0.14], key: 'legFR' },
    { g: ['box', 0.05, 0.16, 0.05], c: 0xcca070, p: [0.06, -0.10, -0.14], key: 'legBL' },
    { g: ['box', 0.05, 0.16, 0.05], c: 0xcca070, p: [-0.06, -0.10, -0.14], key: 'legBR' },
    { g: ['box', 0.04, 0.26, 0.04], c: 0xb07d4f, p: [0, 0.12, -0.24], r: [0.75, 0, 0], tail: 1, key: 'tail' },
  ];
}

export function dogParts() {
  return [
    { g: ['box', 0.22, 0.26, 0.58], c: 0x8d6e63, p: [0, 0, 0], key: 'body' },
    { g: ['box', 0.18, 0.18, 0.18], c: 0xa1887f, p: [0, 0.15, 0.32], key: 'head' },
    { g: ['box', 0.10, 0.09, 0.14], c: 0x5d4037, p: [0, 0.11, 0.44], key: 'muzzle' },
    { g: ['box', 0.04, 0.12, 0.06], c: 0x4e342e, p: [0.10, 0.18, 0.28], r: [0.2, 0, 0.3], key: 'earL' },
    { g: ['box', 0.04, 0.12, 0.06], c: 0x4e342e, p: [-0.10, 0.18, 0.28], r: [0.2, 0, -0.3], key: 'earR' },
    { g: ['box', 0.06, 0.22, 0.06], c: 0x795548, p: [0.08, -0.14, 0.20], key: 'legFL' },
    { g: ['box', 0.06, 0.22, 0.06], c: 0x795548, p: [-0.08, -0.14, 0.20], key: 'legFR' },
    { g: ['box', 0.07, 0.22, 0.07], c: 0x795548, p: [0.08, -0.14, -0.20], key: 'legBL' },
    { g: ['box', 0.07, 0.22, 0.07], c: 0x795548, p: [-0.08, -0.14, -0.20], key: 'legBR' },
    { g: ['box', 0.05, 0.05, 0.28], c: 0x6d4c41, p: [0, 0.14, -0.34], r: [0.85, 0, 0], tail: 1, key: 'tail' },
  ];
}
