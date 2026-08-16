#!/usr/bin/env node
// ============ 鳥群稽核(序 11 / ⑥-2)============
//
// 這一支的存在理由:計畫列的六項(曲線 + 逐軸噪聲 + 弱彈簧 + 摩擦 + 分群 + `uSnap`)
// **每一項壞掉都沒有錯誤訊息**,只表現成「那群鳥看起來怪怪的」。積分器落在零 THREE 的
// JS 模組(而不是計畫字面的 GPGPU)正是為了讓這六項能在 Node 端**行為直測**——
// 寫在 GLSL 裡的話,`--break-spring` / `--break-friction` 全部退化成 ㋓ 真瀏覽器。
//
//   Ⅰ 檔案邊界 —— 零 THREE / 零 Math.random / 只 import rng.js + data.js(阻尼唯一縫)
//   Ⅱ① 弱彈簧:跑 60s 之後逐鳥離「曲線上自己那一點」的 RMS ≥ `TRACK_MIN`
//        ⚠ 量的是**追不追得緊**不是「離曲線多遠」:強彈簧讓鳥貼著 `曲線 + 噪聲` 走,
//          離曲線的距離反而變**大**(= 噪聲振幅)⇒ 拿那個當判據兩邊都綠。
//   Ⅱ② 逐軸噪聲時標:三軸的過零率 max/min ≥ `TS_RATIO`(同時標 = 球形抖動 = 蟲不是鳥)
//   Ⅱ③ 摩擦:|v| 峰值 ≤ `V_MAX`(沒有摩擦時彈簧積分成振盪)
//   Ⅱ④ `uSnap`:snap 之後速度全零、位置恰在目標上
//   Ⅲ  分群:同一時刻整群沿曲線的弧長跨度 ≥ 曲線長 × `SPREAD_F`
//   Ⅳ  **零共享 `rnd()` 消耗**(本輪最重要的一條:抽一枚就把全圖佈局整條推移而零錯誤訊息)
//   Ⅴ  錨不到就不放(空錨點 ⇒ 空陣列;MUST NOT 退回「戰場中央一條環」)
//   Ⅵ  剪影下限(鳥在動漫背景裡是剪影:要有翹起的尾與離開頭部輪廓的喙)
//   Ⅶ  幀率無關(同一段時間切成 30/60/144fps,終點位置差 < 容差)
//   Ⅷ  接線(biomes.js:排在錨點之後、推既有 dynamics、不 castShadow、frustumCulled = false、
//        拉桿 def 0 ⇒ 一條曲線都不建)
//
// 反向驗證(§5.4 ㋑:CRLF 容忍 + 替換無效當場失敗 + 期望值不隨 break 改變)
//   --break-spring   SPRING 0.0003 → 0.05(弱彈簧寫回強彈簧)   ⇒ Ⅱ① 紅
//   --break-noise    三軸時標改吃同一個                          ⇒ Ⅱ② 紅
//   --break-friction 拿掉摩擦(FRICTION_K → 0)                   ⇒ Ⅱ③ 紅
//   --break-group    GROUPS → 1(取消分群偏移)                   ⇒ Ⅲ  紅
//   --break-rnd      在 planFlockRoutes 裡插一次 rnd() 呼叫       ⇒ Ⅳ  紅
//   --break-anchor   錨不到時退回「戰場中央一條圓環」            ⇒ Ⅴ  紅
//   --break-snap     flockSnap 只貼位置不歸零速度                ⇒ Ⅱ④ 紅
import * as W from '../public/js/wildlife.js';
import { readSrc } from './audit_src.mjs';

const A = process.argv.slice(2);
const BK = {
  spring: A.includes('--break-spring'),
  noise: A.includes('--break-noise'),
  friction: A.includes('--break-friction'),
  group: A.includes('--break-group'),
  rnd: A.includes('--break-rnd'),
  anchor: A.includes('--break-anchor'),
  snap: A.includes('--break-snap'),
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };
const src = readSrc('public', 'js', 'wildlife.js');
const bio = readSrc('public', 'js', 'biomes.js');

// 壞版一律走「改常數 / 包一層」,MUST NOT 改斷言的期望值
if (BK.spring) W.FLOCK.SPRING = 0.05;
if (BK.noise) W.FLOCK.NOISE_TS = [0.05, 0.05, 0.05];
if (BK.friction) W.FLOCK.FRICTION_K = 0;
if (BK.group) W.FLOCK.GROUPS = 1;

// ---- 合成場景(閉合的橢圓岸線;純幾何 ⇒ 每一次跑逐位元相同)----
const BOUNDS = { minX: -600, maxX: 600, minZ: -600, maxZ: 600 };
const SHORE = Array.from({ length: 24 }, (_, i) => {
  const t = (i / 24) * Math.PI * 2;
  return [Math.cos(t) * 300, Math.sin(t) * 180];
});
const plan = (anchors, extra = {}) => {
  const routes = W.planFlockRoutes({ anchors, probe: () => 10, bounds: BOUNDS, ...extra });
  // `--break-anchor`:錨不到就退回「戰場中央一條圓環」(= 沒有真實理由的那種鳥)
  if (BK.anchor && !routes.length) {
    return W.planFlockRoutes({
      anchors: { shore: Array.from({ length: 16 }, (_, i) => {
        const t = (i / 16) * Math.PI * 2;
        return [Math.cos(t) * 120, Math.sin(t) * 120];
      }) },
      probe: () => 10, bounds: BOUNDS, ...extra,
    });
  }
  return routes;
};
const ROUTE = plan({ shore: SHORE })[0];

const snap = (st) => {
  if (!BK.snap) return W.flockSnap(st);
  // 壞版:只貼位置不歸零速度(殘留速度會讓出生那一瞬間整群甩出去)
  const keep = Float32Array.from(st.vel);
  W.flockSnap(st);
  st.vel.set(keep);
  return st;
};
const run = (T, fps = 60) => {
  const st = W.flockInit(ROUTE);
  const dt = 1 / fps;
  let vmax = 0;
  for (let t = 0; t < T; t += dt) {
    W.flockStep(st, t, dt);
    for (let i = 0; i < st.count; i++) {
      const v = Math.hypot(st.vel[i * 3], st.vel[i * 3 + 1], st.vel[i * 3 + 2]);
      if (v > vmax) vmax = v;
    }
  }
  return { st, vmax };
};
const P = [0, 0, 0];
/** 第 i 隻鳥「應該在的曲線點」(不含噪聲) */
const homeOf = (st, i, t) => W.curveAt(st, (t * W.FLOCK.SPEED * st.spd[i]) / st.len + st.off[i], P);

console.log('Ⅰ 檔案邊界');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const code = strip(src);
  ok(!/\bTHREE\b/.test(code), 'wildlife.js 零 THREE(這才是四項積分器能離線行為直測的原因)');
  ok(!/Math\.random/.test(code), '全檔零 `Math.random`(A4:確定性散布路徑)');
  const imps = (code.match(/^import .*$/gm) || []);
  ok(imps.length === 2 && imps.some((l) => /rng\.js/.test(l)) && imps.some((l) => /data\.js/.test(l)),
    `只 import rng.js(亂數唯一縫)+ data.js(阻尼唯一縫 frictionFPS)—— 現況 ${imps.length} 條`);
  ok(/frictionFPS\(/.test(code) && !/\*=\s*0\.9\d/.test(code),
    '摩擦走 `frictionFPS(k, dt)`,MUST NOT 寫 `v *= 0.99`(那是幀率相依的)');
  ok(!/Math\.min\(1,\s*dt\s*\*/.test(code) && (code.match(/Math\.exp/g) || []).length === 0,
    '零第二份 `Math.exp` / 零 `Math.min(1, dt*k)`(§2.1 F 幀率無關阻尼的唯一縫在 data.js)');
  ok(/springPS\s*=\s*\(\)\s*=>\s*FLOCK\.SPRING \* FPS_REF \* FPS_REF/.test(src),
    '每秒彈簧係數由「每幀」那個數**推導**(×fps²),MUST NOT 兩個都手寫');
}

console.log('\nⅡ 四項積分器的行為證明');
{
  // ① 弱彈簧
  const { st } = run(60);
  let sum = 0;
  for (let i = 0; i < st.count; i++) {
    homeOf(st, i, st.t);
    sum += (st.pos[i * 3] - P[0]) ** 2 + (st.pos[i * 3 + 1] - P[1]) ** 2 + (st.pos[i * 3 + 2] - P[2]) ** 2;
  }
  const track = Math.sqrt(sum / st.count);
  ok(track >= W.FLOCK.TRACK_MIN,
    `① 彈簧夠弱:跑 60s 後離「曲線上自己那一點」的 RMS ${track.toFixed(2)}m ≥ ${W.FLOCK.TRACK_MIN}m(強彈簧 = 鳥群可見地飛曲線)`);
  // ② 逐軸噪聲的時標真的不同 —— 量**過零率**(相關係數對「同時標但不同相位」不成立)
  const s2 = W.flockInit(ROUTE);
  const series = [[], [], []];
  for (let k = 0; k < 2400; k++) {
    const t = k / 60;
    s2.t = t; W.flockSnap(s2);            // snap ⇒ pos 恰在「曲線 + 噪聲」上 ⇒ 差值就是純噪聲
    homeOf(s2, 0, t);
    for (let a = 0; a < 3; a++) series[a].push(s2.pos[a] - P[a]);
  }
  const zc = series.map((v) => {
    let c = 0;
    for (let i = 1; i < v.length; i++) if ((v[i - 1] < 0) !== (v[i] < 0)) c++;
    return c;
  });
  const ratio = Math.max(...zc) / Math.max(1, Math.min(...zc));
  ok(ratio >= W.FLOCK.TS_RATIO,
    `② 三軸噪聲時標互異:過零率 ${zc.join('/')} ⇒ max/min ${ratio.toFixed(2)} ≥ ${W.FLOCK.TS_RATIO}(同時標 = 球形抖動,讀起來是蟲不是鳥)`);
  // ③ 摩擦
  const { vmax } = run(180);
  ok(vmax <= W.FLOCK.V_MAX,
    `③ 速度有界:跑 180s 的 |v| 峰值 ${vmax.toFixed(2)} ≤ ${W.FLOCK.V_MAX} m/s(沒有摩擦時彈簧積分成振盪)`);
  // ④ uSnap
  const s4 = run(20).st;
  snap(s4);
  let vz = 0, off = 0;
  for (let i = 0; i < s4.count; i++) {
    vz = Math.max(vz, Math.abs(s4.vel[i * 3]), Math.abs(s4.vel[i * 3 + 1]), Math.abs(s4.vel[i * 3 + 2]));
    homeOf(s4, i, s4.t);
    off = Math.max(off, Math.hypot(s4.pos[i * 3] - P[0], s4.pos[i * 3 + 1] - P[1], s4.pos[i * 3 + 2] - P[2]));
  }
  ok(vz === 0, `④ snap 之後速度全零(最大殘留 ${vz.toExponential(2)})—— 殘留速度 = 出生那一瞬間整群甩出去`);
  const amp = Math.hypot(...W.FLOCK.NOISE_AMP);
  ok(off <= amp + 1e-6, `④ snap 之後位置恰在「曲線 + 噪聲」上(最大偏移 ${off.toFixed(2)}m ≤ 噪聲振幅 ${amp.toFixed(2)}m)`);
}

console.log('\nⅢ 分群(同一時刻整群沿曲線攤開)');
{
  const { st } = run(30);
  const us = [];
  for (let i = 0; i < st.count; i++) {
    let bu = 0, bd = Infinity;
    for (let k = 0; k < 600; k++) {
      W.curveAt(st, k / 600, P);
      const d = Math.hypot(st.pos[i * 3] - P[0], st.pos[i * 3 + 2] - P[2]);
      if (d < bd) { bd = d; bu = k / 600; }
    }
    us.push(bu);
  }
  us.sort((a, b) => a - b);
  let gap = 0;
  for (let i = 0; i < us.length; i++) gap = Math.max(gap, ((us[(i + 1) % us.length] - us[i]) + 1) % 1);
  const spread = 1 - gap;
  ok(spread >= W.FLOCK.SPREAD_F,
    `弧長跨度 ${(spread * 100).toFixed(1)}% ≥ ${(W.FLOCK.SPREAD_F * 100).toFixed(0)}%(GROUPS = 1 ⇒ 全部擠在曲線上同一點)`);
}

console.log('\nⅣ 零共享 `rnd()` 消耗(本輪最重要的一條)');
{
  // 計數型假 rnd:規劃器**根本拿不到**共享序列(簽章裡沒有 rnd)⇒ 消耗恆為 0 是構造保證。
  // 這一段直測「有沒有人把它偷渡進去」:注入一個會計數的全域 rnd,跑完 MUST 是 0。
  let calls = 0;
  const g = globalThis;
  const prevRnd = g.rnd, prevRandom = Math.random;
  g.rnd = () => { calls++; return 0.5; };
  Math.random = () => { calls++; return 0.5; };
  try {
    const routes = plan({ shore: SHORE, groves: [{ x: 10, z: 10, r: 20 }, { x: 90, z: -40, r: 25 }], landmarks: [{ x: -80, z: 60, r: 12 }] });
    for (const r of routes) W.flockInit(r);
    if (BK.rnd) { g.rnd(); }   // 壞版:模擬「順手在規劃器裡抽一枚」
  } finally { Math.random = prevRandom; if (prevRnd === undefined) delete g.rnd; else g.rnd = prevRnd; }
  ok(calls === 0,
    `規劃 + 初始化全程零共享亂數消耗(實測 ${calls} 次)—— 抽一枚就把後面每一株植被、每一棟建物的佈局整條推移,而**沒有任何錯誤訊息**`);
  ok(/flockSeed\(/.test(src) && /mulberry32\(/.test(src),
    '逐鳥抖動走**座標雜湊**餵自己的 mulberry32(同 beacons.beaconSeed 的形狀)');
  // 同一份錨點兩次規劃 MUST 逐位元相同(跨客戶端一致的前提)
  const a = plan({ shore: SHORE })[0], b = plan({ shore: SHORE })[0];
  ok(a.pts.every((v, i) => v === b.pts[i]) && a.count === b.count && a.seed === b.seed,
    '同一份錨點兩次規劃逐位元相同');
}

console.log('\nⅤ 錨不到就不放(原則 6)');
{
  ok(plan({}).length === 0, '三類錨點全空 ⇒ 空陣列(MUST NOT 退回「戰場中央一條圓環」)');
  ok(plan({ shore: null, groves: [], landmarks: [] }).length === 0, '空陣列同理');
  ok(plan({ landmarks: [{ x: 0, z: 0, r: 10 }] }).length === 1, '只有地標 ⇒ 一條曲線(第三順位仍成立)');
  const three = plan({ shore: SHORE, groves: [{ x: 10, z: 10, r: 20 }, { x: 90, z: -40, r: 25 }], landmarks: [{ x: -80, z: 60, r: 12 }] });
  ok(three.length <= W.FLOCK.MAX_ROUTES, `曲線數 ${three.length} ≤ MAX_ROUTES ${W.FLOCK.MAX_ROUTES}(draw call 預算)`);
  ok(three[0]?.kind === 'shore', `順位:水域岸線在最前(實得 ${three.map((r) => r.kind).join(' > ')})`);
  // 隻數的美術語意:2 = 一對 / 3 = 幾隻 / ≥4 = 一群
  ok(Object.values(W.FLOCK.COUNTS).every((n) => n >= 2), '逐錨點型的隻數 ≥ 2(1 隻不是「群」)');
  const lowR = plan({ shore: SHORE }, { low: true })[0];
  ok(lowR.count < ROUTE.count && lowR.count >= 2, `低功耗折半(${ROUTE.count} → ${lowR.count} 隻)`);
  // 水平夾制:曲線 MUST 收在障礙環內緣之內(飛出去會被世界曲面往下沉)
  const wide = W.planFlockRoutes({
    anchors: { shore: SHORE.map(([x, z]) => [x * 5, z * 5]) },
    probe: () => 10, bounds: BOUNDS,
  })[0];
  let inside = true;
  for (let i = 0; i < wide.n; i++) {
    if (wide.pts[i * 3] < BOUNDS.minX - 1e-9 || wide.pts[i * 3] > BOUNDS.maxX + 1e-9
      || wide.pts[i * 3 + 2] < BOUNDS.minZ - 1e-9 || wide.pts[i * 3 + 2] > BOUNDS.maxZ + 1e-9) inside = false;
  }
  ok(inside, '曲線逐點夾在呼叫端給的水平界內(注入不寫死,同 edgewall 的坡度門檻)');
  const cap = W.planFlockRoutes({ anchors: { shore: SHORE }, probe: () => 10, bounds: BOUNDS, altMax: 5 })[0];
  let maxAlt = 0;
  for (let i = 0; i < cap.n; i++) maxAlt = Math.max(maxAlt, cap.pts[i * 3 + 1] - 10);
  ok(maxAlt <= 5 + 1e-9, `離地高夾在呼叫端注入的 altMax(實測 ${maxAlt.toFixed(2)} ≤ 5)`);
}

console.log('\nⅥ 剪影下限(鳥在動漫背景裡是剪影)');
{
  const parts = W.birdParts();
  const box = (p) => {
    const [t, a, b, c] = p.g;
    let hx, hy, hz;
    if (t === 'box') { hx = a / 2; hy = b / 2; hz = c / 2; } else if (t === 'cone') { hx = a; hy = b / 2; hz = a; } else { hx = hy = hz = a; }
    const [px = 0, py = 0, pz = 0] = p.p || [];
    return { x0: px - hx, x1: px + hx, y0: py - hy, y1: py + hy, z0: pz - hz, z1: pz + hz };
  };
  const bs = parts.map(box);
  const span = Math.max(...bs.map((b) => b.x1)) - Math.min(...bs.map((b) => b.x0));
  ok(span >= 0.3, `最大水平跨距 ${span.toFixed(2)}m ≥ 0.3m(再小就是天上幾個黑點)`);
  const tail = parts.find((p) => p.key === 'tail'), beak = parts.find((p) => p.key === 'beak');
  const body = parts.find((p) => p.key === 'body');
  ok(!!tail && (tail.r?.[0] ?? 0) !== 0, '有**翹起**的尾(平貼的尾在輪廓上看不出來)');
  ok(!!beak && box(beak).z1 > box(body).z1, '喙**離開頭部輪廓**(縮在裡面 = 剪影上是一顆蛋)');
  ok(parts.filter((p) => p.wing).length === 2, '兩片翅膀各自成件(拍翼要獨立的矩陣 ⇒ 逐邊一顆 InstancedMesh)');
  ok(parts.every((p) => Array.isArray(p.g) && typeof p.c === 'number'),
    '零件表是**純資料**描述子(格式同 edgewall / vehicles ⇒ 外廓離線量得到)');
  // 拍翼:逐鳥相位不同(整群同步拍 = 讀起來像機械)
  const st = W.flockInit(ROUTE);
  const angs = new Set();
  for (let i = 0; i < st.count; i++) angs.add(W.wingAngle(st, i, 1.234).toFixed(6));
  ok(angs.size >= Math.min(4, st.count), `拍翼相位逐鳥不同(${angs.size}/${st.count} 個相異角)`);
}

console.log('\nⅦ 幀率無關(摩擦走 frictionFPS 的直接推論)');
{
  const T = 60;
  const a = run(T, 60).st, b = run(T, 30).st, c = run(T, 144).st;
  const dev = (x, y) => {
    let m = 0;
    for (let i = 0; i < x.pos.length; i++) m = Math.max(m, Math.abs(x.pos[i] - y.pos[i]));
    return m;
  };
  const tol = ROUTE.len * 0.01;   // 曲線長的 1%(半隱式尤拉是 O(dt) 精度,不是逐位元)
  ok(dev(a, b) <= tol && dev(a, c) <= tol,
    `30 / 60 / 144fps 跑同一段 ${T}s,終點最大偏差 ${Math.max(dev(a, b), dev(a, c)).toFixed(3)}m ≤ 曲線長的 1%(${tol.toFixed(1)}m)`);
  // dt 夾制:背景分頁切回來那一幀的 dt 是好幾秒
  const s = W.flockInit(ROUTE);
  const before = Float32Array.from(s.pos);
  W.flockStep(s, 5, 999);
  let jump = 0;
  for (let i = 0; i < s.pos.length; i++) jump = Math.max(jump, Math.abs(s.pos[i] - before[i]));
  ok(jump <= W.FLOCK.SPEED * W.FLOCK.DT_MAX * 4,
    `單幀 dt 夾在 ${W.FLOCK.DT_MAX}s(dt = 999 那一幀位移 ${jump.toFixed(2)}m,不夾就是整群瞬移)`);
}

console.log('\nⅧ 接線(biomes.js)');
{
  ok(/function buildFlocks\(/.test(bio), '建構出口恰一支 `buildFlocks`');
  ok(/dynamics\.push\(\(dt\) => \{[\s\S]{0,200}?flockStep/.test(bio),
    '逐幀更新推進**既有的** `dynamics` 桶(MUST NOT 在 game.js 另開第二條更新迴圈)');
  ok(/const t = celWindTime\(\);/.test(bio),
    '時鐘吃 `celWindTime()`(雲 / 植被同一支;自己數 dt 的話暫停一次就與地面錯開)');
  const seg = /function buildFlocks\([\s\S]*?\n\}\n/.exec(bio)?.[0] || '';
  ok(/frustumCulled = false/.test(seg),
    '`frustumCulled = false`(整群橫跨全圖,包圍球恆過期 ⇒ 某些鏡頭角度整批消失)');
  ok(/castShadow = false/.test(seg) && !/castShadow = true/.test(seg),
    '不投影(投影旗標只有 makeUnit 與 buildGroundCover 兩個縫,§2.1 F 時間流逝 ⑧)');
  ok(/instanceMatrix\.needsUpdate = true/.test(seg),
    '每幀 `instanceMatrix.needsUpdate = true`(忘了就是鳥群凍結在出生位置,而每一支稽核全綠)');
  ok(/const dens = visualPref\('birds'\);/.test(seg) && /if \(BIRDS_OFF \|\| !\(dens > 0\)\) return 0;/.test(seg),
    '拉桿 `birds` def = 0 ⇒ **一條曲線都不建**(零 mesh、零 dynamics 條目)= 逐位元同舊制');
  ok(/\[?\?&\]birds=0/.test(bio.replace(/\\/g, '')) || /birds=0/.test(bio),
    '`?birds=0` killswitch(同 ?petal=0 / ?gait=0 / ?morph=0 的 A/B 慣例)');
  ok(!/lanes|towerSites|basesW/.test(seg),
    '錨點**刻意排除**兵線 / 塔位 / 主堡(那是戰術資訊,鳥繞著前線飛就是把它畫出來)');
  // ⚠ 找**呼叫點**不是宣告(`function buildFlocks(group, terrain, dynamics, {` 逐字含同一段)
  const ci = bio.indexOf('const birdsBuilt = buildFlocks(');
  const call = ci < 0 ? '' : bio.slice(ci, bio.indexOf('\n  });', ci) + 6);
  ok(/anchors:/.test(call) && /shoreRing\(terrain\)/.test(call) && /greenSites/.test(call) && /landmarkG/.test(call),
    '錨點三類由**已定案的世界幾何**推導(水域 / 神木林候選地 / 地標)');
  ok(bio.indexOf('const giantTrees = placeGiantGroves') < bio.indexOf('const birdsBuilt = buildFlocks')
    && bio.indexOf('const landmarkG = []') < bio.indexOf('const birdsBuilt = buildFlocks'),
  '呼叫點排在 `placeGiantGroves` 與 `landmarkG` **之後**(錨點取的是它們已經定案的幾何)');
  ok(/function shoreRing\(terrain\) \{/.test(bio) && !/Math\.random/.test(/function shoreRing[\s\S]*?\n\}\n/.exec(bio)?.[0] || 'Math.random'),
    '岸線環是純幾何、零亂數');
}

console.log(`\n${fail ? '❌' : '🎉'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
