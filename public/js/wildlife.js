// ============ 鳥群(⑥-2;唯一縫)============
// 2026-08-16 序 11。計畫 `docs/anime_style_plan.md` ⑥ 第 2 點列的**六項一項不刪**:
//   曲線 + 逐軸不同時標的噪聲 + 弱彈簧 0.0003 + 摩擦 + 分群 + `uSnap`。
//
// ---- 對計畫字面的一處偏離(積分器落在 JS 而不是 GPGPU)----
// 計畫寫「GPGPU 鳥群」。實地查完,本專案**沒有任何 ping-pong render-to-texture**:
// `postfx.js` 是唯一的 RT 持有者(檔頭「3 個 RenderTarget + 1 張 depthTexture + 4 個
// FullScreenQuad 材質」)且是「唯一消費端 game.pipeline」;世界內容的運動傳統一律是
// **零狀態純函式**(頂點著色器的 `uWindT`/`celGust`/`celSeaH`,或 CPU 的
// `clouds.step(celWindTime())`)。GPGPU 的四筆成本:①WebGL2 在本專案只是**能力探測**
// 不是保證(`postfx.js` 的 `_mrtCap`)⇒ 必須配一份 CPU fallback = **兩份實作**;
// ②compute pass 要在 pipeline 之外呼叫 `setRenderTarget`,撞上「MUST NOT 在 game.js
// 另開第二條更新迴圈」;③積分器在 GLSL 裡 ⇒ **反向驗證(原則 9)離線做不出來**
// (`--break-spring`/`--break-friction` 全部退化成 ㋓ 真瀏覽器);④A25 多兩張浮點 RT。
// 買到的是零:GPGPU 要 1e4 以上才回本,而鳥群的隻數由「2 = 一對 / 3 = 幾隻 / ≥4 = 一群」
// 的美術語意決定 —— 量級是數十。**這是對計畫字面的偏離,已開票請使用者裁決**
// (`docs/_pending/lane-world-w3.md` ⑤)。
//
// ---- 五條紀律(每一條壞掉都沒有錯誤訊息)----
//  ① **零 THREE**:本檔只算「第 i 隻鳥這一幀在哪裡」,建 mesh 的動作住 `biomes.buildFlocks`。
//     這才是四項積分器離線驗得到的原因(同 `edgewall.js` / `flags.js` / `petals.js` 的紀律)。
//  ② **零共享 `rnd()` 消耗**(§2.3 / A4):逐鳥的相位 / 速度抖動 / 分群偏移一律由
//     **座標雜湊** `flockSeed(x, z)` 餵自己的 `mulberry32`。多抽一枚就把後面每一株植被、
//     每一棟建物的佈局整條推移,而畫面上只表現成「整張圖變了」。
//  ③ **摩擦走 `data.js frictionFPS`**(§2.1 F「幀率無關阻尼」的唯一縫),
//     MUST NOT 寫 `v *= 0.99` —— 那是幀率相依的,症狀是「高刷新率的機器上鳥群比較黏」。
//     彈簧那一半同理:`SPRING` 是**每 60fps 幀**的係數(計畫給的 0.0003),
//     每秒係數 `springPS()` 由它**推導**,MUST NOT 兩個都手寫。
//  ④ **錨不到就不放**(原則 6):鳥群為什麼在那裡由**真實圖資**回答 ——
//     順位 水域岸線 > 神木林 > 地標,三類都錨不到就回空陣列。
//     **MUST NOT 拿兵線 / 塔位 / 主堡當錨**:那是戰術資訊,繞著前線飛的鳥會洩漏它。
//  ⑤ **時鐘由呼叫端給**(`celWindTime()`,雲與植被同一支):自己累加 dt 的話,暫停一次
//     就與地面上的草、天上的雲錯開,而 `stepCelWind` 已內建背景分頁的 dt 夾制。
import { mulberry32 } from './rng.js';
import { frictionFPS } from './data.js';

export const FLOCK = {
  // —— 計畫列的六項 ——
  SPRING: 0.0003,        // 弱彈簧(**每 60fps 幀**的係數,= 計畫給的數字);每秒係數見 springPS()
  FRICTION_K: 0.9,       // 摩擦(每秒;走 frictionFPS ⇒ 幀率無關)
  GROUPS: 5,             // 分群數:同一條曲線上的鳥分成幾撮(1 = 全部擠在同一點)
  NOISE_AMP: [2.2, 0.9, 2.2],      // 逐軸噪聲振幅(m)—— y 軸刻意小(鳥不上下亂彈)
  NOISE_TS: [0.05, 0.10, 0.025],   // 逐軸**不同時標**(同時標 = 球形抖動,讀起來是蟲不是鳥)
  SPEED_JITTER: 0.22,    // 逐鳥巡航速度抖動(±比例)
  // —— 曲線與編隊 ——
  CURVE_N: 48,           // 曲線取樣點數(閉合環)
  SPEED: 12,             // 沿曲線的巡航速度(m/s)
  ALT_BAND: [16, 42],    // 離地高帶(m);實得高度另受世界天花板夾制
  GROUP_SPREAD: 0.55,    // 分群沿曲線的最大相對偏移(0.55 = 撒在半條曲線上)
  COUNTS: { shore: 9, grove: 5, landmark: 3 },   // 逐錨點型的隻數(2 = 一對 / 3 = 幾隻 / ≥4 = 一群)
  MAX_ROUTES: 3,         // 一張圖最多幾條曲線(draw call 預算:逐條 2 顆 InstancedMesh)
  // —— 稽核用的行為門檻(不是旋鈕:它們是「這四項真的在做事」的判準)——
  TRACK_MIN: 4.0,        // **弱彈簧的證明**:跑 60s 之後逐鳥離「曲線上自己那一點」的 RMS 距離(m)。
  //                        ⚠ 量的是**追不追得緊**不是「離曲線多遠」—— 強彈簧會讓鳥貼著
  //                        `曲線 + 噪聲` 走,離曲線的距離反而**變大**(等於噪聲振幅),
  //                        拿那個當判據會兩邊都綠。實測 弱 9.7m / 強(×167)1.8m。
  SPREAD_F: 0.30,        // 同一時刻整群沿曲線的弧長跨度 ≥ 曲線長 × 這個(分群的證明;實測 G5 0.46 / G1 0.03)
  V_MAX: 26,             // |v| 峰值上界(m/s)—— 沒有摩擦時彈簧積分成振盪(實測 18.0 → 33.3)
  TS_RATIO: 1.6,         // 逐軸噪聲的過零率 max/min ≥ 這個(同時標 ⇒ 恆為 1 = 球形抖動)
  DT_MAX: 0.25,          // 逐幀 dt 夾制(同 stepCelWind / PETAL.DT_MAX)
  WING_HZ: 3.4,          // 拍翼頻率
  WING_MAX: 0.85,        // 拍翼幅度(rad)
};

/**
 * 每秒彈簧係數(m/s² per m):由「每 60fps **幀**」那個數推導,MUST NOT 兩個都手寫。
 *
 * ⚠ 換算是 **×fps²** 不是 ×fps:GPGPU 那一份寫的是 `v += (T − p) * S` 配 `p += v`,
 * 兩處的單位都是「每幀」⇒ 加速度 = S × fps² 才是同一條彈簧
 * (ω = √(0.0003) rad/frame × 60 = 1.04 rad/s,時間常數 ≈ 1s = 「跟得上但會晃」)。
 * 寫成 ×60 的話 ω 掉到 0.13 rad/s、對 12 m/s 的目標穩態落後 **667m** ——
 * 畫面上就是「鳥群跟曲線完全沒有關係」,而每一條斷言照樣綠(它們只量離散度)。
 */
export const FPS_REF = 60;
export const springPS = () => FLOCK.SPRING * FPS_REF * FPS_REF;

/**
 * 座標雜湊種子(照 `beacons.js beaconSeed` 的形狀)。
 * **零共享 `rnd()` 消耗**:鳥群的一切隨機性都從這裡長出來。
 */
export function flockSeed(x, z) {
  const h = (Math.imul(Math.round(x * 8) | 0, 0x9E3779B1) ^ Math.imul(Math.round(z * 8) | 0, 0x85EBCA77)) | 0;
  return Math.imul(h ^ (h >>> 15), 0xC2B2AE3D) >>> 0;
}

// 確定性 sin-hash 噪聲(逐鳥 × 逐軸 × 逐時標)。**MUST NOT 用 `Math.random()`**:
// 跨客戶端逐位元一致是前提,而且它是 t 的純函式 ⇒ 暫停/快轉都不會分家。
const nz = (seed, i, axis, t) => {
  const a = Math.sin((seed % 9973) * 0.0007 + i * 12.9898 + axis * 78.233) * 43758.5453;
  const ph = a - Math.floor(a);
  return Math.sin((t + ph) * Math.PI * 2) * 0.6 + Math.sin((t * 1.618 + ph * 3.1) * Math.PI * 2) * 0.4;
};

// ---- 曲線工具(純幾何)----
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

/** 曲線上參數 u ∈ [0,1) 的點(線性內插;閉合環)*/
export function curveAt(st, u, out) {
  const n = st.n;
  const f = ((u % 1) + 1) % 1 * n;
  const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, w = f - Math.floor(f);
  for (let a = 0; a < 3; a++) out[a] = st.pts[i0 * 3 + a] + (st.pts[i1 * 3 + a] - st.pts[i0 * 3 + a]) * w;
  return out;
}

/**
 * 規劃鳥群曲線。**純幾何、零共享 `rnd()`**。
 *
 * @param {object} o
 *   `anchors` { shore: [[x,z],…] 岸線折線 / groves: [{x,z,r}] / landmarks: [{x,z,r,h}] }
 *   `probe(x,z)` 地表高度回呼(規劃器不認得地形,同 `siteplan.js` 的紀律)
 *   `bounds`  { minX, maxX, minZ, maxZ } 水平夾制線(飛出去會被世界曲面往下沉)
 *   `altMax`  離地高上限(選用;呼叫端注入 `objHeightMax()` —— 本檔 MUST NOT 自己寫死度量)
 *   `ceilY`   世界天花板(選用;絕對高度一律夾在它之下)
 *   `low`     低功耗 ⇒ 隻數折半
 * @returns [{ kind, pts, n, len, count, seed }];**一類都錨不到 ⇒ 空陣列**(原則 6)
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
    // 高度:整條曲線一個帶內高度(逐點再由地形抬起)⇒ 鳥群不會鑽進山裡
    const alt = Math.min(altMax, FLOCK.ALT_BAND[0] + rnd() * (FLOCK.ALT_BAND[1] - FLOCK.ALT_BAND[0]));
    for (let i = 0; i < FLOCK.CURVE_N; i++) {
      const g = probe(r.pts[i * 3], r.pts[i * 3 + 2]) || 0;
      r.pts[i * 3 + 1] = Math.min(ceilY, g + alt);
    }
    const base = FLOCK.COUNTS[kind] || 3;
    const count = Math.max(2, low ? Math.round(base / 2) : base);
    out.push({ kind, pts: r.pts, n: FLOCK.CURVE_N, len: r.total, count, seed });
  };
  // ① 水域岸線(最長那一條 run)
  const shore = anchors.shore;
  if (shore && shore.length >= 3) finish('shore', shore, true);
  // ② 神木林:兩片林子之間的橢圓環(棲地環線)
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
  // ③ 地標:高塔上的熱氣柱盤旋(半徑隨高度縮 ⇒ 讀得出「繞著它轉」)
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
 * 由一條曲線建出鳥群狀態(逐鳥相位 / 速度抖動 / 分群偏移;**零共享 rnd**)。
 * 位置與速度一律經 `flockSnap` 就位 —— 出生那一瞬間 MUST NOT 帶殘留速度。
 */
export function flockInit(route) {
  const n = route.count;
  const rnd = mulberry32((route.seed * 2654435761) >>> 0);
  const st = {
    pts: route.pts, n: route.n, len: route.len, kind: route.kind, seed: route.seed, count: n,
    pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
    spd: new Float32Array(n), off: new Float32Array(n), wing: new Float32Array(n),
    t: 0,
  };
  for (let i = 0; i < n; i++) {
    st.spd[i] = 1 + (rnd() - 0.5) * 2 * FLOCK.SPEED_JITTER;
    // 分群:同一條曲線上分成 GROUPS 撮,撮內再抖一點(GROUPS = 1 ⇒ 全部擠在同一點)
    const g = i % FLOCK.GROUPS;
    st.off[i] = (g / FLOCK.GROUPS + (rnd() - 0.5) * 0.06 / FLOCK.GROUPS) * FLOCK.GROUP_SPREAD;
    st.wing[i] = rnd();
  }
  flockSnap(st);
  return st;
}

/** 第 i 隻鳥這一刻的「目標點」(曲線 + 逐軸不同時標的噪聲)*/
function targetOf(st, i, t, out) {
  const u = (t * FLOCK.SPEED * st.spd[i]) / st.len + st.off[i];
  curveAt(st, u, out);
  for (let a = 0; a < 3; a++) out[a] += FLOCK.NOISE_AMP[a] * nz(st.seed, i, a, t * FLOCK.NOISE_TS[a] * 10);
  return out;
}

const _tg = [0, 0, 0];

/**
 * 一步積分(四項:曲線目標 + 逐軸噪聲 + 弱彈簧 + 摩擦)。
 * `t` = **全場共用的風時鐘**(`celWindTime()`),`dt` = 這一幀的秒數。
 * 摩擦走 `frictionFPS` ⇒ 幀率無關(紀律③);彈簧的每秒係數由 `springPS()` 推導。
 */
export function flockStep(st, t, dt) {
  const d = Math.max(0, Math.min(FLOCK.DT_MAX, dt || 0));
  st.t = t;
  const kSpring = springPS() * d;
  const fr = frictionFPS(FLOCK.FRICTION_K, d);
  for (let i = 0; i < st.count; i++) {
    targetOf(st, i, t, _tg);
    for (let a = 0; a < 3; a++) {
      const j = i * 3 + a;
      st.vel[j] += (_tg[a] - st.pos[j]) * kSpring;
      st.vel[j] *= fr;
      st.pos[j] += st.vel[j] * d;
    }
  }
  return st;
}

/**
 * `uSnap`:把整群貼到曲線上並把速度歸零(出生 / 重生 / 瞬移)。
 * **只貼位置不歸零速度**的症狀是「出生那一瞬間整群甩出去」。
 */
export function flockSnap(st) {
  for (let i = 0; i < st.count; i++) {
    targetOf(st, i, st.t, _tg);
    for (let a = 0; a < 3; a++) { st.pos[i * 3 + a] = _tg[a]; st.vel[i * 3 + a] = 0; }
  }
  return st;
}

/** 第 i 隻鳥的飛行方向(由速度推;靜止時退回曲線切向)*/
export function flockHeading(st, i, out) {
  const j = i * 3;
  const vx = st.vel[j], vz = st.vel[j + 2];
  if (vx * vx + vz * vz > 1e-8) { out[0] = vx; out[1] = st.vel[j + 1]; out[2] = vz; return out; }
  const u = (st.t * FLOCK.SPEED * st.spd[i]) / st.len + st.off[i];
  const a = [0, 0, 0], b = [0, 0, 0];
  curveAt(st, u, a); curveAt(st, u + 0.01, b);
  out[0] = b[0] - a[0]; out[1] = b[1] - a[1]; out[2] = b[2] - a[2];
  return out;
}

/** 第 i 隻鳥這一刻的拍翼角(rad;逐鳥相位 ⇒ 不會整群同步拍) */
export function wingAngle(st, i, t) {
  return Math.sin((t * FLOCK.WING_HZ + st.wing[i]) * Math.PI * 2) * FLOCK.WING_MAX;
}

/**
 * 鳥的**純資料**零件表(格式同 `edgewall.js` / `vehicles.js` 的描述子)。
 * 剪影下限離線量得到:MUST 有「翹起的尾」與「離開頭部輪廓的喙」兩個特徵件 ——
 * 少了它們,天上那一群在賽璐璐輪廓下就是幾個黑色橢圓(SKILL 的 prop-scale 規則)。
 * `wing: 1` 的兩件由 `buildFlocks` 另建一顆 InstancedMesh(拍翼要獨立的矩陣)。
 */
export function birdParts() {
  return [
    { g: ['cone', 0.10, 0.46, 5], c: 0x2f3238, p: [0, 0, 0], r: [Math.PI / 2, 0, 0], key: 'body' },
    { g: ['cone', 0.045, 0.16, 4], c: 0xd8a24a, p: [0, 0, 0.30], r: [Math.PI / 2, 0, 0], key: 'beak' },
    { g: ['box', 0.05, 0.12, 0.20], c: 0x24272c, p: [0, 0.06, -0.26], r: [-0.55, 0, 0], key: 'tail' },
    { g: ['box', 0.34, 0.02, 0.13], c: 0x3a3e45, p: [0.20, 0.02, 0.02], wing: 1, key: 'wingL' },
    { g: ['box', 0.34, 0.02, 0.13], c: 0x3a3e45, p: [-0.20, 0.02, 0.02], wing: -1, key: 'wingR' },
  ];
}
