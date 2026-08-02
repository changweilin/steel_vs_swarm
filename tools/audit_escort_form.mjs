// ============ 待命護衛機 ㄑ 字編隊 稽核 ============
// 用途:改 `data.js` 的 `ESCORT`/`escortSlot()`/`escortLagK()`/`escortDrift()`,
// 或 `game.js` 的 `_buildDroneEscorts`/`_updateEscorts` 後跑。
// 跑法:`node tools/audit_escort_form.mjs`
//
// 使用者需求(2026-08-02):「小無人機與無人機編隊呈現ㄑ字型,位置加點浮動誤差,
// 跟隨旗艦機時有微小操作延遲,以免動作看起來太死硬」。三件事各自都會**靜默退化**:
//   ① ㄑ 字:`SWEEP_M` 歸零 = 退回舊制橫排,畫面上只是「站得比較開」,沒有任何錯誤;
//   ② 浮動誤差:相位若不逐架錯開(或乾脆同頻同相),四架會**整組同步**擺動 ——
//      比不動更假(看起來像整台機身在晃),而振幅量測完全正常;
//   ③ 跟隨延遲:逼近率若收成同一個值,四架仍是逐位元同步 = 焊回機身;
//      平滑若退回逐幀固定係數(`x += d * 0.2`),不會報錯,只會讓 30fps 比 120fps 拖得多。
// 另兩條反模式:浮動誤差 MUST NOT 用 `Math.random()`(A4;而且每幀重抽 = 抖動不是漂移);
// `_updateEscorts` MUST NOT 自己手寫 `1 − e^(−k·dt)`(`camSmoothF` 是既有的幀率無關平滑縫)。
//
// 手法比照 `audit_spectator_cam.mjs`:曲線直接 import(data.js 是純模組),
// game.js 的方法**抽執行原文**評估(three 走 CDN、Node 端 import 不了整支;抄一份公式永遠會通過)。
// 讀原文與抽方法走 `audit_src.mjs` 單一縫(換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  ESCORT, escortSlot, escortLagK, escortLagBase, escortDrift, kamiSide, SQUAD, UNITS,
  camSmoothF, camAngleStep, wrapPi,
} from '../public/js/data.js';

const gameSrc = readSrc('public', 'js', 'game.js');
const dataSrc = readSrc('public', 'js', 'data.js');

// 「全檔只有 N 處」這類計數 MUST 只數**執行原文**(註解與 import 清單也提得到同一個名字)
const code = gameSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  .split("} from './data.js';").slice(1).join("} from './data.js';");

let pass = 0, fail = 0;
const sec = (s) => console.log(`\n■ ${s}`);
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

const N = SQUAD.KAMI.N;
const IDX = Array.from({ length: N }, (_, i) => i);

// ── Ⅰ 編隊幾何(ㄑ 字型;推導不手寫)───────────────────────────
sec('Ⅰ 編隊幾何(ㄑ 字型)');
{
  const slots = IDX.map((i) => escortSlot(i));
  ok('橫向站位 = kamiSide × SIDE_M(仍是那一份唯一縫,MUST NOT 另寫排列式)',
    slots.every((s, i) => near(s.x, kamiSide(i) * ESCORT.SIDE_M) && near(s.s, kamiSide(i))));
  ok('全員在旗艦機**後方**(z < 0 ⇒ 旗艦機在 ㄑ 的頂點)', slots.every((s) => s.z < 0));
  ok('ㄑ 字:|橫向| 越大越靠後(嚴格單調,MUST NOT 退回等距橫排)', (() => {
    const byAbs = slots.map((s) => ({ a: Math.abs(s.s), z: s.z })).sort((p, q) => p.a - q.a);
    for (let i = 1; i < byAbs.length; i++) {
      if (near(byAbs[i].a, byAbs[i - 1].a)) { if (!near(byAbs[i].z, byAbs[i - 1].z)) return false; continue; }
      if (byAbs[i].z >= byAbs[i - 1].z - 1e-9) return false;   // 更外側 MUST 更後面
    }
    return true;
  })());
  ok('後掠量真的存在(SWEEP_M > 0;歸零 = 靜默退回舊制橫排)', ESCORT.SWEEP_M > 0);
  ok('左右鏡射對稱(橫向反號、前後相同)', (() => {
    for (const a of slots) {
      const b = slots.find((q) => near(q.s, -a.s));
      if (!b || !near(b.x, -a.x) || !near(b.z, a.z)) return false;
    }
    return true;
  })());
  ok('最內側也在旗艦機後方 BACK_M 以上(不會與旗艦機重疊穿模)',
    slots.every((s) => -s.z >= ESCORT.BACK_M - 1e-9));
  ok('後掠角在「看得出是 ㄑ」與「排成一直線縱隊」之間', (() => {
    const out = slots.find((s) => near(Math.abs(s.s), 1));
    const deg = Math.atan2(Math.abs(out.x), -out.z) * 180 / Math.PI;   // 與機軸的夾角
    return deg > 15 && deg < 75;
  })(), `${(Math.atan2(ESCORT.SIDE_M, ESCORT.BACK_M + ESCORT.SWEEP_M) * 180 / Math.PI).toFixed(1)}°`);
  ok('槽位原文由 kamiSide 推導,MUST NOT 手寫逐架座標表',
    /export const escortSlot = \(i\) => \{\n  const s = kamiSide\(i\);/.test(dataSrc)
    && /z: -\(ESCORT\.BACK_M \+ Math\.abs\(s\) \* ESCORT\.SWEEP_M\)/.test(dataSrc));
}

// ── Ⅱ 浮動誤差(逐架錯開、有界、零亂數)──────────────────────
sec('Ⅱ 浮動誤差');
{
  ok('振幅有界:水平 ≤ DRIFT_R、垂直 ≤ DRIFT_Y(MUST NOT 漂到看得出脫隊)', (() => {
    for (const i of IDX) for (let t = 0; t < 400; t += 0.05) {
      const d = escortDrift(i, t);
      if (Math.abs(d.x) > ESCORT.DRIFT_R + 1e-9 || Math.abs(d.z) > ESCORT.DRIFT_R + 1e-9
        || Math.abs(d.y) > ESCORT.DRIFT_Y + 1e-9) return false;
    }
    return true;
  })());
  ok('浮動幅度遠小於編隊間距(是「誤差」不是「亂飛」)',
    Math.hypot(ESCORT.DRIFT_R, ESCORT.DRIFT_R) < ESCORT.SIDE_M / 2);
  ok('確定性:同 (i, t) 恆同解(零亂數;跨客戶端一致,A4)', (() => {
    for (const i of IDX) {
      const a = escortDrift(i, 12.34), b = escortDrift(i, 12.34);
      if (!near(a.x, b.x) || !near(a.y, b.y) || !near(a.z, b.z)) return false;
    }
    return true;
  })());
  ok('data.js ESCORT 區塊零亂數(MUST NOT 用 Math.random)', (() => {
    const i = dataSrc.indexOf('export const ESCORT = {');
    const j = dataSrc.indexOf('\n/**', dataSrc.indexOf('export const escortDrift'));
    return i > 0 && j > i && !/Math\.random/.test(dataSrc.slice(i, j));
  })());
  ok('逐架相位錯開:任一時刻四架的漂移向量互不相同(同相 = 整組同步擺 = 比不動更假)', (() => {
    for (const t of [0, 0.7, 3.3, 11.9]) {
      const ds = IDX.map((i) => escortDrift(i, t));
      for (let a = 0; a < ds.length; a++) for (let b = a + 1; b < ds.length; b++)
        if (Math.hypot(ds[a].x - ds[b].x, ds[a].y - ds[b].y, ds[a].z - ds[b].z) < 1e-3) return false;
    }
    return true;
  })());
  ok('相位由架次序號推導(黃金角),MUST NOT 逐架手寫相位表',
    /const ph = i \* ESCORT\.PHASE/.test(dataSrc));
  ok('三軸不同頻(Lissajous;同頻 = 原地繞圓,看起來像掛在轉盤上)', (() => {
    let min = Infinity, max = -Infinity;
    for (let t = 0; t < 200; t += 0.05) {
      const d = escortDrift(0, t), r = Math.hypot(d.x, d.z);
      min = Math.min(min, r); max = Math.max(max, r);
    }
    return max - min > ESCORT.DRIFT_R * 0.5;   // 半徑會變 ⇒ 不是圓
  })(), `r ∈ [${(0).toFixed(2)}…]`);
  ok('長期零均值(在槽位附近漂,不會整體偏掉)', (() => {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let t = 0; t < 2000; t += 0.01, n++) { const d = escortDrift(1, t); sx += d.x; sy += d.y; sz += d.z; }
    return Math.abs(sx / n) < 0.02 && Math.abs(sy / n) < 0.02 && Math.abs(sz / n) < 0.02;
  })());
  ok('真的在動:每一架逐秒都有可見位移', (() => IDX.every((i) => {
    const a = escortDrift(i, 0), b = escortDrift(i, 1.0);
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.05;
  }))());
}

// ── Ⅲ 跟隨逼近率(逐架不同、恆為正)──────────────────────────
sec('Ⅲ 跟隨逼近率');
{
  const ks = IDX.map((i) => escortLagK(i));
  ok('恆 > 0(≤0 = 護衛機永遠停在原地)', ks.every((k) => k > 0));
  ok('外側更拖(逼近率隨 |橫向| 遞減 ⇒ 轉向時 ㄑ 字甩尾)', (() => {
    const rows = IDX.map((i) => ({ a: Math.abs(kamiSide(i)), k: escortLagK(i) })).sort((p, q) => p.a - q.a);
    for (let i = 1; i < rows.length; i++) {
      if (near(rows[i].a, rows[i - 1].a)) { if (!near(rows[i].k, rows[i - 1].k)) return false; continue; }
      if (rows[i].k >= rows[i - 1].k - 1e-12) return false;
    }
    return true;
  })(), ks.map((k) => k.toFixed(2)).join(', '));
  ok('MUST NOT 收成同一個值(全同 = 四架逐位元同步 = 又焊回機身)',
    new Set(ks.map((k) => k.toFixed(6))).size > 1);
  ok('落差由 LAG_SPREAD 推導,不手寫逐架係數',
    /escortLagBase\(\) \* \(1 - ESCORT\.LAG_SPREAD \* Math\.abs\(kamiSide\(i\)\)\)/.test(dataSrc));
  ok('基礎逼近率由校準錨反解(MUST NOT 手寫;無人機提速後僚機才不會整組拖到編隊外)',
    /export const escortLagBase = \(\) => UNITS\.drone\.speed \/ \(ESCORT\.TRAIL_M \* \(1 - ESCORT\.LAG_SPREAD\)\);/.test(dataSrc)
    && near(escortLagBase(), UNITS.drone.speed / (ESCORT.TRAIL_M * (1 - ESCORT.LAG_SPREAD))));
  ok('校準錨兌現:巡航直線前進時最外側落後剛好 TRAIL_M',
    near(UNITS.drone.speed / Math.min(...ks), ESCORT.TRAIL_M, 1e-9), `${(UNITS.drone.speed / Math.min(...ks)).toFixed(3)}m`);
  ok('落後量 MUST 小於編隊本身的尺度(是「跟得有點慢」不是「脫隊」)',
    ESCORT.TRAIL_M < Math.min(ESCORT.SIDE_M, ESCORT.SWEEP_M));
  ok('延遲是「微小」的:最拖的一架時間常數 < 0.2 秒(拖過頭會看成脫隊)',
    1 / Math.min(...ks) < 0.2, `${(1 / Math.min(...ks)).toFixed(3)}s`);
  ok('機首也是延遲的,但半秒內轉到位', ESCORT.YAW_K > 0 && 1 / ESCORT.YAW_K < 0.5);
}

// ── Ⅳ 消費端單一縫(game.js 執行原文)─────────────────────────
sec('Ⅳ 消費端單一縫');
{
  const build = grabMethod(gameSrc, '_buildDroneEscorts');
  const upd = grabMethod(gameSrc, '_updateEscorts');
  ok('槽位 / 逼近率在建構時經 data.js 縫取得', /slot: escortSlot\(i\)/.test(build) && /k: escortLagK\(i\)/.test(build));
  ok('每幀擺位吃 escortDrift(浮動誤差不在 game.js 自寫)', /escortDrift\(/.test(upd));
  ok('平滑走 camSmoothF / camAngleStep(既有幀率無關縫)',
    /camSmoothF\(/.test(upd) && /camAngleStep\(/.test(upd));
  ok('MUST NOT 自己手寫 1 − e^(−k·dt)(退回逐幀固定係數不報錯,只會讓 30fps 比 120fps 拖得多)',
    !/Math\.exp\(/.test(upd));
  ok('MUST NOT 手寫舊制橫排常數(off = 3.5 / back = -1.0)',
    !/off = 3\.5/.test(upd) && !/back = -1\.0/.test(upd));
  ok('MUST NOT 用 Math.random(A4)', !/Math\.random/.test(upd) && !/Math\.random/.test(build));
  ok('escortSlot / escortLagK / escortDrift 在 game.js 各只有一處消費',
    count(code, 'escortSlot(') === 1 && count(code, 'escortLagK(') === 1 && count(code, 'escortDrift(') === 1,
    `${count(code, 'escortSlot(')}/${count(code, 'escortLagK(')}/${count(code, 'escortDrift(')}`);
  ok('`_updateEscorts` 只有一處呼叫,且吃得到 dt / now(拿不到就只能瞬移貼位)',
    count(code, 'this._updateEscorts(') === 1 && /this\._updateEscorts\(ent, dt, now\)/.test(code));
  ok('隱藏期間重置 warm(重現 MUST NOT 從上次自爆的位置飛回來)',
    /if \(!ready\) \{ es\.warm = false; continue; \}/.test(upd));
}

// ── Ⅴ 行為直測(真品 `_updateEscorts` 原文)──────────────────
sec('Ⅴ 行為直測(真品原文)');
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
const proto = new Function(
  'ESCORT', 'escortDrift', 'camSmoothF', 'camAngleStep',
  `return ({ ${grabMethod(gameSrc, '_updateEscorts')} });`,
)(ESCORT, escortDrift, camSmoothF, camAngleStep);

/** 最小可跑的旗艦機 ent(escorts 由 `_buildDroneEscorts` 的同一份縫造出) */
const mkEnt = (x = 0, y = 0, z = 0, yaw = 0) => ({
  kcd: 0,
  mesh: { visible: true, position: new V3(x, y, z), rotation: { y: yaw } },
  escorts: IDX.map((i) => ({
    mesh: { visible: false, position: new V3(), rotation: { y: 0 } },
    i, slot: escortSlot(i), k: escortLagK(i), warm: false,
  })),
});
const step = (ent, dt, now) => proto._updateEscorts(ent, dt, now);
/** 世界座標 → 旗艦機局部座標(右 / 前) */
const toLocal = (ent, m) => {
  const p = ent.mesh.position, yaw = ent.mesh.rotation.y;
  const dx = m.x - p.x, dz = m.z - p.z;
  return { r: dx * Math.cos(yaw) - dz * Math.sin(yaw), f: dx * Math.sin(yaw) + dz * Math.cos(yaw) };
};

{
  // ① 首幀貼上 + 畫面上真的是 ㄑ 字
  const e = mkEnt(120, 40, -80, 0);
  step(e, 1 / 60, 0);
  ok('首幀直接貼上槽位(不從原點拉一條橫越戰場的長鏡頭)', e.escorts.every((es) => {
    const d = escortDrift(es.i, 0), l = toLocal(e, es.mesh.position);
    return near(l.r, es.slot.x + d.x, 1e-6) && near(l.f, es.slot.z + d.z, 1e-6);
  }));
  ok('全部顯示(kcd = 0 = 護衛機已重現)', e.escorts.every((es) => es.mesh.visible));
  ok('局部座標呈 ㄑ 字:外側比內側後面(扣掉當幀浮動誤差後比)', (() => {
    const rows = e.escorts.map((es) => ({
      a: Math.abs(es.slot.s), f: toLocal(e, es.mesh.position).f - escortDrift(es.i, 0).z,
    })).sort((p, q) => p.a - q.a);
    return near(rows[rows.length - 1].f - rows[0].f, -ESCORT.SWEEP_M * (rows[rows.length - 1].a - rows[0].a), 1e-6);
  })());
}
{
  // ② 隨旗艦機朝向整組旋轉(不是黏在世界軸上)
  const yaw = 1.1, e = mkEnt(0, 0, 0, yaw);
  step(e, 1 / 60, 0);
  ok('編隊跟著機首轉(局部槽位不變 ⇒ 世界座標已旋轉)', e.escorts.every((es) => {
    const d = escortDrift(es.i, 0), l = toLocal(e, es.mesh.position);
    return near(l.r, es.slot.x + d.x, 1e-6) && near(l.f, es.slot.z + d.z, 1e-6);
  }));
  ok('機首朝向與旗艦機一致(首幀貼上)', e.escorts.every((es) => near(es.mesh.rotation.y, yaw)));
}
{
  // ③ 跟隨延遲:旗艦機開始移動,護衛機 MUST 落後(now 凍結 ⇒ 排除浮動誤差干擾)
  const e = mkEnt(0, 0, 0, 0), V = UNITS.drone.speed, DT = 1 / 60;
  step(e, DT, 0);
  const lagOf = () => e.escorts.map((es) => {
    const d = escortDrift(es.i, 0);
    return Math.hypot(
      e.mesh.position.x + es.slot.x + d.x - es.mesh.position.x,
      e.mesh.position.z + es.slot.z + d.z - es.mesh.position.z);
  });
  for (let i = 0; i < 1; i++) { e.mesh.position.x += V * DT; step(e, DT, 0); }
  ok('旗艦機一動,護衛機不是同一幀就到位(這就是使用者要的「微小操作延遲」)',
    lagOf().every((l) => l > 0.01));
  for (let i = 0; i < 240; i++) { e.mesh.position.x += V * DT; step(e, DT, 0); }
  const lag = lagOf();
  // 逐幀離散逼近的穩態解:L = (L + V·dt)(1 − f) ⇒ L = V·dt·(1 − f)/f(旗艦機整幀跳完才輪到僚機)
  ok('等速追隨時落後量 = 指數逼近的穩態解', lag.every((l, j) => {
    const f = camSmoothF(escortLagK(j), DT);
    return near(l, V * DT * (1 - f) / f, 1e-6);
  }),
    lag.map((l) => l.toFixed(3)).join(', '));
  ok('與連續解 速度 ÷ 逼近率 相符(離散誤差 < 半幀位移)',
    lag.every((l, j) => Math.abs(l - V / escortLagK(j)) < V * DT / 2 + 1e-9),
    lag.map((l) => l.toFixed(3)).join(', '));
  ok('外側落後得比內側多(轉向時 ㄑ 字會甩尾再收攏)',
    lag[0] > lag[1] + 0.05 && lag[3] > lag[2] + 0.05, lag.map((l) => l.toFixed(3)).join(', '));
  ok('巡航落後量在校準錨附近(< 一個槽位間距,不會看成脫隊)',
    lag.every((l) => l < ESCORT.SIDE_M) && Math.max(...lag) < ESCORT.TRAIL_M + V * DT,
    lag.map((l) => l.toFixed(3)).join(', '));
  // 停下來就補回來(不是永久偏移)
  for (let i = 0; i < 600; i++) step(e, DT, 0);
  ok('旗艦機停下後護衛機收攏回槽位(無穩態誤差)', lagOf().every((l) => l < 1e-3));
}
{
  // ④ 幀率無關:30fps 與 240fps 追同一段等速航程,落後量 MUST 同樣落在連續解 V/k 上
  //    (逐幀固定係數 `x += d * 0.2` 不會報錯,但 30fps 的落後量會是 240fps 的八倍)
  const V = UNITS.drone.speed;
  const run = (fps) => {
    const e = mkEnt(0, 0, 0, 0), dt = 1 / fps;
    step(e, dt, 0);
    for (let t = 0; t < 2; t += dt) { e.mesh.position.x += V * dt; step(e, dt, 0); }
    return e.escorts.map((es) => e.mesh.position.x + es.slot.x + escortDrift(es.i, 0).x - es.mesh.position.x);
  };
  const a = run(30), b = run(240);
  ok('30fps 與 240fps 的落後量一致(差距 ≤ 慢幀的半格位移 —— 離散化本身的下限)',
    a.every((v, i) => Math.abs(v - b[i]) <= V / 30 / 2 + 1e-9),
    `${a.map((v) => v.toFixed(3))} vs ${b.map((v) => v.toFixed(3))}`);
  ok('兩種幀率都落在連續解 速度 ÷ 逼近率 上(逐幀固定係數會在這裡整組偏掉)',
    a.every((v, i) => Math.abs(v - V / escortLagK(i)) <= V / 30 / 2 + 1e-9)
    && b.every((v, i) => Math.abs(v - V / escortLagK(i)) <= V / 240 / 2 + 1e-9),
    `${a.map((v) => v.toFixed(3))} / ${b.map((v) => v.toFixed(3))}`);
}
{
  // ⑤ 浮動誤差:旗艦機完全靜止,護衛機仍在微幅漂移(而且四架不同步)
  const e = mkEnt(0, 0, 0, 0), DT = 1 / 60;
  let now = 0;
  step(e, DT, now);
  const trail = IDX.map(() => []);
  for (let i = 0; i < 600; i++) { now += DT; step(e, DT, now); e.escorts.forEach((es, j) => trail[j].push({ ...es.mesh.position })); }
  const span = trail.map((tr) => {
    const xs = tr.map((p) => p.x), ys = tr.map((p) => p.y), zs = tr.map((p) => p.z);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs));
  });
  ok('旗艦機靜止時護衛機仍在動(死硬的擺件 = 完全不動)', span.every((s) => s > 0.1), span.map((s) => s.toFixed(2)).join(', '));
  ok('漂移幅度有界(不會慢慢飄走)',
    span.every((s) => s < 2 * Math.max(ESCORT.DRIFT_R, ESCORT.DRIFT_Y) + 0.2), span.map((s) => s.toFixed(2)).join(', '));
  ok('四架不同步(逐幀位移向量互不相同)', (() => {
    const v = trail.map((tr) => ({ x: tr[300].x - tr[299].x, y: tr[300].y - tr[299].y, z: tr[300].z - tr[299].z }));
    for (let a = 0; a < v.length; a++) for (let b = a + 1; b < v.length; b++)
      if (Math.hypot(v[a].x - v[b].x, v[a].y - v[b].y, v[a].z - v[b].z) < 1e-6) return false;
    return true;
  })());
  ok('垂直向也在浮動(只動水平看起來像貼在同一片玻璃上)',
    trail.every((tr) => Math.max(...tr.map((p) => p.y)) - Math.min(...tr.map((p) => p.y)) > 0.1));
}
{
  // ⑥ 顯隱:冷卻中藏起 + warm 重置;重現首幀直接貼上(MUST NOT 從自爆位置飛回來)
  const e = mkEnt(0, 0, 0, 0), DT = 1 / 60;
  step(e, DT, 0);
  e.kcd = 12;
  step(e, DT, 0);
  ok('kami 冷卻中一律藏起', e.escorts.every((es) => !es.mesh.visible && es.warm === false));
  e.kcd = 0;
  e.mesh.position.set(900, 0, -900);          // 期間旗艦機跑到天邊
  e.escorts.forEach((es) => es.mesh.position.set(0, 0, 0));
  step(e, DT, 0);
  ok('重現首幀直接貼上(不是從上次自爆的位置一路飛回來)', e.escorts.every((es) => {
    const d = escortDrift(es.i, 0), l = toLocal(e, es.mesh.position);
    return near(l.r, es.slot.x + d.x, 1e-6) && near(l.f, es.slot.z + d.z, 1e-6);
  }));
  ok('主機不可見時一律藏起(不留孤兒護衛機)', (() => {
    e.mesh.visible = false; step(e, DT, 0);
    return e.escorts.every((es) => !es.mesh.visible);
  })());
}
{
  // ⑦ 瞬移:超過 SNAP_M 直接貼上(重生 / 迷霧重進視野)
  const e = mkEnt(0, 0, 0, 0), DT = 1 / 60;
  step(e, DT, 0);
  e.mesh.position.set(ESCORT.SNAP_M + 60, 0, 0);
  step(e, DT, 0);
  ok('瞬移超過 SNAP_M 直接貼上', e.escorts.every((es) => {
    const d = escortDrift(es.i, 0), l = toLocal(e, es.mesh.position);
    return near(l.r, es.slot.x + d.x, 1e-6) && near(l.f, es.slot.z + d.z, 1e-6);
  }));
  const e2 = mkEnt(0, 0, 0, 0);
  step(e2, DT, 0);
  e2.mesh.position.set(ESCORT.SNAP_M - 6, 0, 0);   // 門檻內 ⇒ 照樣走延遲
  step(e2, DT, 0);
  ok('門檻內的位移仍走延遲(MUST NOT 被 SNAP 吃掉整條跟隨手感)', e2.escorts.some((es) => {
    const d = escortDrift(es.i, 0), l = toLocal(e2, es.mesh.position);
    return Math.hypot(l.r - es.slot.x - d.x, l.f - es.slot.z - d.z) > 1;
  }));
}
{
  // ⑧ 機首:延遲轉向且走最短路徑(跨 ±π MUST NOT 繞一整圈)
  const e = mkEnt(0, 0, 0, 0), DT = 1 / 60;
  step(e, DT, 0);
  e.mesh.rotation.y = 1.0;
  step(e, DT, 0);
  ok('機首也是逼近而非瞬轉', e.escorts.every((es) => es.mesh.rotation.y > 0 && es.mesh.rotation.y < 1.0));
  for (let i = 0; i < 600; i++) step(e, DT, 0);
  ok('久了收斂到旗艦機朝向', e.escorts.every((es) => near(es.mesh.rotation.y, 1.0, 1e-3)));
  const e2 = mkEnt(0, 0, 0, Math.PI - 0.05);
  step(e2, DT, 0);
  e2.mesh.rotation.y = -Math.PI + 0.05;
  step(e2, DT, 0);
  ok('跨 ±π 走最短路徑(繞一整圈在畫面上就是「原地自轉一圈」)',
    e2.escorts.every((es) => Math.abs(wrapPi(es.mesh.rotation.y - (Math.PI - 0.05))) < 0.05));
}

console.log(`\n通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
