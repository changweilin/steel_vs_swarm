#!/usr/bin/env node
// ============ 載具 / 擺件型錄稽核(序 10 ③-1 / ③-2 / ③-3 / ③-4)============
//
// 這一支守的是「同一台車只有一份實作」以及「型錄宣告的盒子真的是它的外廓」。
// **每一條都對應一個沒有錯誤訊息的壞法**:
//   Ⅰ 宣告的 L×W×H 與零件實測外廓兩個方向都要對得上 —— 頂出去 = 看得見的車頭打不到
//     (A30 家族);虛胖 = 停車格白線畫得比車大一圈、碰撞柱比看得見的車寬。
//   Ⅱ 輪心 y === R —— 差一點就是「輪子半埋」或「整台車浮在地上 2cm」,而 `audit_object_joints`
//     的接合判定容許縫是 0.05m,埋 3cm 它照樣綠。
//   Ⅲ 三條水平線的序 —— roof > waist > sill > R 壞掉時車艙會長在車底下,而外廓照樣合格。
//   Ⅳ 鼻頭在 +x —— 反過來就是「一整排停車場的車全部倒著停」,零斷言看得見。
//   Ⅴ 零 import / 零亂數 —— 抽一枚共享 `rnd()` 就把全圖佈局整條推移(§2.3 / A4)。
//   Ⅵ 停車場九台車的**碰撞盒世界四角點**逐點凍結 —— 欄位表示從 `2.2×4.8, ry=0` 換成
//     `4.8×2.2, ry=π/2` 是同一個有向盒的另一種寫法,比欄位會假紅、比角點才是真的。
//   Ⅶ `detailR('carwreck')` / `detailR('container')` 新基準 —— **§2.3 的哨兵**:
//     那兩個數一動,`detFree` 的淘汰結果就變 ⇒ 全圖每一株植被的落點整條推移,
//     而畫面上只表現成「這張圖跟上次不一樣」。
//   Ⅷ 公設分桶數(③-4)—— 顏色回到材質就是 25 個 draw call 一座停車場。
//   Ⅹ 凹處零件的最小 z ≥ 量體前緣(③-2)—— 往內挖 = 面板整片消失,不報錯。
//   Ⅺ 可視角(③-3)—— 淺而深的凹槽在站立高度上看不到底,做了等於沒做。
//   Ⅻ `edgewall.partBox` 轉呼 `partAABB` —— AABB 只有一份實作。
//   ⅩⅢ hazards 靜態件合併，但 rock / 動態 / 透明件排除。
//
// 反向驗證(`--break-*`;§5.4 ㋑:CRLF 容忍 + 替換無效當場失敗 + 期望值不隨 break 改變)
//   --break-spec   輪拱/保險桿改回手寫常數(與型錄脫鉤)      ⇒ Ⅰ・Ⅱ 紅
//   --break-dup    停車場的車繞過 makeVehicle 寫回手寫方盒     ⇒ Ⅴ-b・Ⅵ 紅
//   --break-face   鼻頭改成 −x                                 ⇒ Ⅳ 紅
//   --break-recess 凹處改成往內挖                              ⇒ Ⅹ 紅
//   --break-sight  可視角門檻拿掉                              ⇒ Ⅺ 紅
//   --break-batch  公設分桶鍵把顏色放回材質                    ⇒ Ⅷ 紅
//   --break-detr   DETAIL_DEFS.carwreck/container 縮回舊尺寸     ⇒ Ⅶ 紅
//   --break-converge edgewall/beacons 寫回手工副本              ⇒ Ⅴ-b・Ⅻ 紅
//   --break-hazard hazards 略過合併或吞掉 rock                  ⇒ ⅩⅢ 紅
import * as V from '../public/js/vehicles.js';
import { partBox } from '../public/js/edgewall.js';
import { readSrc } from './audit_src.mjs';
import { CHARACTERS, heroTargetH, charKind, SELF_F } from '../public/js/data.js';

const A = process.argv.slice(2);
const BREAK_SPEC = A.includes('--break-spec');
const BREAK_DUP = A.includes('--break-dup');
const BREAK_FACE = A.includes('--break-face');
const BREAK_RECESS = A.includes('--break-recess');
const BREAK_SIGHT = A.includes('--break-sight');
const BREAK_BATCH = A.includes('--break-batch');
const BREAK_DETR = A.includes('--break-detr');
const BREAK_CONVERGE = A.includes('--break-converge');
const BREAK_HAZARD = A.includes('--break-hazard');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, re) => (s.match(re) || []).length;

const veh = readSrc('public', 'js', 'vehicles.js');
const site = readSrc('public', 'js', 'siteplan.js');
let hz = readSrc('public', 'js', 'hazards.js');
const bio = readSrc('public', 'js', 'biomes.js');
let ground = readSrc('public', 'js', 'ground.js');
let edge = readSrc('public', 'js', 'edgewall.js');
let beacon = readSrc('public', 'js', 'beacons.js');

// ---- `--break-*` 的字面替換:MUST 是 CRLF 容忍樣式,替換無效 MUST 當場失敗 ----
const mustReplace = (src, re, to, flag) => {
  const out = src.replace(re, to);
  if (out === src) { console.error(`  ✗ ${flag} 的字面替換沒有生效(原文改過了?)`); process.exit(1); }
  return out;
};

if (BREAK_CONVERGE) {
  edge = mustReplace(edge, /return partAABB\(part\);/, 'return part;', '--break-converge');
  beacon = mustReplace(beacon, /\.\.\.makeVehicle\('container20', \{ paint: 0xb4553c,[^\n]*\}\),/,
    "{ g: ['box', 6.1, 2.6, 2.5], c: 0xb4553c, p: [0, 1.3, -1.5] },", '--break-converge');
}
if (BREAK_HAZARD) {
  hz = mustReplace(hz, /\n  batchHazardParts\(g\);/, '', '--break-hazard');
}

// 壞版的型錄:
//  `--break-spec` 把保險桿的位置從「由 L 推導」改回**手寫常數**(型錄值一格未動)
//    ⇒ 兩者脫鉤,實測外廓當場頂出宣告盒 —— 這正是紀律③要擋的東西。
//  `--break-face` 整份零件 x 取負(鼻頭改成 −x)。
const mkVehicle = (kind, opts) => {
  let rows = V.makeVehicle(kind, opts);
  if (BREAK_SPEC) {
    rows = rows.concat([{ g: ['box', 0.4, 0.3, 1.0], c: 0x333333, p: [V.VEHICLE_SPEC[kind].L / 2 + 0.2, 0.5, 0] }]);
  }
  if (BREAK_FACE) rows = rows.map((p) => ({ ...p, p: [-(p.p?.[0] ?? 0), p.p?.[1] ?? 0, p.p?.[2] ?? 0] }));
  return rows;
};

console.log('Ⅰ 型錄:宣告的 L×W×H ⊇ 實測外廓,且沒有虛胖(兩個方向)');
{
  const kinds = V.vehicleKinds();
  ok(kinds.length >= 4, `型錄至少四款(${kinds.length} 款:${kinds.join('/')})`);
  for (const k of kinds) {
    const s = V.VEHICLE_SPEC[k];
    const rows = mkVehicle(k, {});
    const b = V.partsAABB(rows);
    const ox = Math.max(b.x1 - s.L / 2, -s.L / 2 - b.x0);
    const oy = Math.max(b.y1 - s.H, -b.y0);
    const oz = Math.max(b.z1 - s.W / 2, -s.W / 2 - b.z0);
    ok(ox <= 1e-9 && oy <= 1e-9 && oz <= 1e-9,
      `${k}:零件全部收在宣告盒內(頂出量 x ${ox.toFixed(4)} / y ${oy.toFixed(4)} / z ${oz.toFixed(4)} m)`);
    const fill = [(b.x1 - b.x0) / s.L, (b.y1 - b.y0) / s.H, (b.z1 - b.z0) / s.W];
    ok(fill.every((f) => f >= 1 - V.VEHICLE.FILL_TOL - 1e-9),
      `${k}:宣告沒有虛胖(三軸填充率 ${fill.map((f) => (f * 100).toFixed(1) + '%').join(' / ')} ≥ ${((1 - V.VEHICLE.FILL_TOL) * 100).toFixed(0)}%)`);
  }
}

console.log('\nⅡ 輪心 y === R(觸地是構造保證,不是擺出來的)');
{
  let checked = 0, bad = [];
  for (const k of V.vehicleKinds()) {
    const s = V.VEHICLE_SPEC[k];
    if (s.R <= 0) continue;
    const wheels = mkVehicle(k, {}).filter((p) => p.g[0] === 'cyl' && near(p.g[1], p.g[2]) && near(p.g[1], s.R, 1e-9));
    ok(wheels.length >= 4, `${k}:至少四個輪子(${wheels.length} 個)`);
    for (const w of wheels) { checked++; if (!near(w.p[1], s.R, 1e-9)) bad.push(`${k}@${w.p[1].toFixed(4)}`); }
    // 輪軸 MUST 沿 z(繞 x 躺平)—— 繞 z 躺平的話輪軸落在車身長軸上 = 輪子側著滾
    ok(wheels.every((w) => near(Math.abs(w.r?.[0] ?? 0), Math.PI / 2, 1e-9) && !(w.r?.[2] ?? 0)),
      `${k}:輪子繞 x 躺平(輪軸沿 z = 垂直於行進方向)`);
  }
  ok(bad.length === 0, `逐輪 y === R(${checked} 個輪子)${bad.length ? `;偏差:${bad.join(',')}` : ''}`);
}

console.log('\nⅢ 三條水平線的序(roof ≥ waist > sill ≥ R;帶輪的款 sill > R)');
{
  for (const k of V.vehicleKinds()) {
    const s = V.VEHICLE_SPEC[k];
    ok(s.roof >= s.waist && s.waist > s.sill && s.sill >= 0,
      `${k}:roof ${s.roof} ≥ waist ${s.waist} > sill ${s.sill} ≥ 0`);
    if (s.R > 0) ok(s.sill > s.R, `${k}:底盤離地(sill ${s.sill} > R ${s.R})—— 反過來就是輪子埋在車身裡`);
    ok(s.roof <= s.H + 1e-9, `${k}:車頂不超過宣告全高(roof ${s.roof} ≤ H ${s.H})`);
    ok(s.side[0] >= 0 && s.side[1] <= s.H + 1e-9 && s.side[1] > s.side[0],
      `${k}:側面接縫帶 [${s.side[0]}, ${s.side[1]}] 落在車身之內`);
  }
}

console.log('\nⅣ 鼻頭在 +x(紀律④:`ry` 就是車頭朝向)');
{
  // 「哪一頭是前面」MUST 由**推導出來的硬體**指認,MUST NOT 拿體積比猜:
  // 轎車的車艙偏後(引擎蓋比行李廂長)、貨車的車艙在最前 —— 體積那一半兩款剛好相反,
  // 拿它當判據就是「有一款恆紅、而另一款倒過來裝也綠」。頭燈與斜切才是方向的定義。
  for (const k of V.vehicleKinds()) {
    const s = V.VEHICLE_SPEC[k];
    const rows = mkVehicle(k, {});
    const front = rows.filter((p) => p.c === V.VEHICLE.LAMP_F);
    const rear = rows.filter((p) => p.c === V.VEHICLE.LAMP_R);
    if (s.R > 0) {
      ok(front.length === 2 && rear.length === 2, `${k}:前照燈 2 顆 / 尾燈 2 顆(由 L/waist 推導,不是逐款手寫)`);
      ok(front.every((p) => p.p[0] > 0) && rear.every((p) => p.p[0] < 0),
        `${k}:前照燈在 +x、尾燈在 −x(鼻頭約定;整份 x 取負就是這一條紅)`);
    }
    if (Math.abs(s.rakeF - s.rakeR) > 1e-9) {
      // 斜切楔形:傾角大的那一片是引擎蓋,MUST 在 +x
      const wedges = rows.filter((p) => p.g[0] === 'box' && (p.r?.[2] ?? 0) !== 0 && (p.r?.[0] ?? 0) === 0);
      const deep = wedges.slice().sort((a, b) => Math.abs(b.r[2]) - Math.abs(a.r[2]))[0];
      const want = (s.rakeF > 0 ? 1 : 0) + (s.rakeR > 0 ? 1 : 0);   // rake = 0 ⇒ 那一片不生
      ok(wedges.length === want && deep && deep.p[0] > 0,
        `${k}:傾角較大的斜切(引擎蓋 rake ${Math.max(s.rakeF, s.rakeR)})在 +x(${wedges.length}/${want} 片)`);
    }
  }
  // 剛體擺放:轉 90° 之後鼻頭 MUST 落在 three 的 Ry(θ) 給的方向上
  const nose0 = V.partsAABB(V.makeVehicle('sedan', { lod: 0 })).x1;
  const rot = V.placeParts(V.makeVehicle('sedan', { lod: 0 }), [0, 0, 0], Math.PI / 2);
  const bb = V.partsAABB(rot);
  ok(near(-bb.z0, nose0, 1e-9),
    `ry = 90° 之後鼻頭落在 −z(three 的 Ry 慣例;寫成 +z 就是整排車朝向差 180°)`);
  // 帶 rx 的零件(輪子)MUST 跟著整株轉 —— `ry0 + ry` 那種寫法在這裡會紅
  const w0 = V.makeVehicle('sedan', { lod: 1 }).filter((p) => p.g[0] === 'cyl');
  const w1 = V.placeParts(w0, [0, 0, 0], Math.PI / 2);
  const spanZ0 = V.partsAABB(w0).z1 - V.partsAABB(w0).z0;
  const spanX1 = V.partsAABB(w1).x1 - V.partsAABB(w1).x0;
  ok(near(spanZ0, spanX1, 1e-6),
    `輪組轉 90° 之後輪距換到 x 軸(${spanZ0.toFixed(3)} → ${spanX1.toFixed(3)} m)—— Euler 合成寫成相加時這一條紅`);
}

console.log('\nⅤ 檔案邊界:零 import、零 THREE、零亂數');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const code = strip(veh);
  ok((code.match(/^import .*$/gm) || []).length === 0,
    'vehicles.js **零 import**(連 rng.js 都不要 ⇒ edgewall 可安全轉呼純型錄 / 量尺)');
  ok(!/\bTHREE\b/.test(code), 'vehicles.js 零 THREE(這才是型錄與量尺能離線驗的原因)');
  ok(!/Math\.random/.test(code) && !/\brnd\s*\(/.test(code),
    'vehicles.js 零亂數:`makeVehicle` 是純函式 —— 抽一枚共享 rnd 就把全圖佈局整條推移(§2.3 / A4)');
  // 純函式:同樣的輸入 MUST 逐位元同樣的輸出
  const a1 = JSON.stringify(V.makeVehicle('sedan', { paint: 0x123456, at: [3, 0, -7], ry: 0.4 }));
  const a2 = JSON.stringify(V.makeVehicle('sedan', { paint: 0x123456, at: [3, 0, -7], ry: 0.4 }));
  ok(a1 === a2, '同一組輸入兩次呼叫逐位元相同(跨客戶端一致的前提)');
}

console.log('\nⅤ-b 消費端:同一台車只有一份實作');
{
  let lotSrc = site;
  if (BREAK_DUP) {
    lotSrc = mustReplace(lotSrc,
      /\.\.\._row\(5, \(i\) => makeVehicle\('sedan', \{[\s\S]*?\}\)\)\.flat\(\),/,
      "..._row(5, (i) => ({ g: ['box', 2.2, 1.35, 4.8], c: LOT_PAINT[i], p: [-20 + i * 5, 0.68, -7.4], col: 1, vc: 1 + i })),",
      '--break-dup');
  }
  // 已接上型錄的四個消費端:各自 MUST 真的呼叫 `makeVehicle`
  const wired = [
    ['siteplan.js CIVIC_PARTS.lot', lotSrc, /makeVehicle\('sedan'/],
    ['hazards.js BUILDERS.wreck', hz, /makeVehicle\('sedan'/],
    ['biomes.js car()(封路車禍)', bio, /vehGroup\('sedan'/],
    ['biomes.js makeTrain()', bio, /vehGroup\('railcar'/],
  ];
  for (const [name, src, re] of wired) ok(re.test(src), `${name} 走型錄唯一縫`);
  // 停車場那一份 MUST NOT 再出現手寫的車身方盒(`--break-dup` 就是把它寫回去)
  ok(!/\['box', 2\.2, 1\.35, 4\.8\]/.test(lotSrc),
    'siteplan 的停車場沒有第二份手寫車體尺寸(繞過型錄 = 兩份遲早分家)');
  ok(count(bio, /new THREE\.BoxGeometry\(len, 1\.2, 1\.9\)/g) === 0,
    'biomes 的封路車禍沒有第二份手寫車體尺寸');
  // 型錄的 `fit` MUST 由宿主的既有契約推導(停車格白線與車吃同一個數)
  ok(/export const LOT_STALL = \{/.test(site) && /fit: LOT_STALL/.test(lotSrc),
    '停車格是一個數兩個消費端(白線節距 + 車的 fit 盒),MUST NOT 各寫一份');
  ok(/makeVehicle\('railcar'/.test(edge) && /makeVehicle\('truck'/.test(edge)
    && count(edge, /makeVehicle\('container20'/g) >= 3,
  'edgewall 的列車 / 貨車 / 貨櫃走型錄唯一縫');
  ok(count(beacon, /makeVehicle\('container20'/g) === 4
    && !/\['box', 6\.1, 2\.6, 2\.5\]/.test(beacon),
  'beacons depot 四只貨櫃走型錄唯一縫');
  ok(/container:\[\{ geo: box\(6\.058, 2\.591, 2\.438\)/.test(ground)
    && /carwreck: \[\{ geo: box\(4\.8, 1\.45, 1\.9\)/.test(ground),
  'ground 細節採 20ft ISO 貨櫃 / 轎車真實公稱外廓');
}

console.log('\nⅥ 停車場九台車的碰撞盒:世界四角點逐點凍結');
{
  // 改制前的九顆車身有向盒(`['box', 2.2, 1.35, 4.8]`,ry = 0):x 半寬 1.1 / z 半深 2.4。
  // 這九組角點是**凍結常數**(見證人),MUST NOT 隨型錄改動 —— 欄位表示已經換成
  // `4.8 × 2.2, ry = π/2`(同一個有向盒的另一種寫法),比欄位會假紅,比角點才是真的。
  const FROZEN = [];
  for (let i = 0; i < 5; i++) FROZEN.push([-20 + i * 5, -7.4]);
  for (let i = 0; i < 4; i++) FROZEN.push([2.5 + i * 5, 7.4]);
  const HW = 1.1, HD = 2.4;
  const M = new Function('partExtent', 'makeVehicle', 'makeRecess', `
    ${(() => {
    const i0 = site.indexOf('export const URBAN = {');
    const i1 = site.indexOf('// ---- 建構(以下才需要 THREE)----');
    let pure = site.slice(i0, i1).replace(/^export /gm, '');
    if (BREAK_DUP) {
      pure = mustReplace(pure,
        /\.\.\._row\(5, \(i\) => makeVehicle\('sedan', \{[\s\S]*?\}\)\)\.flat\(\),/,
        "..._row(5, (i) => ({ g: ['box', 2.2, 1.0, 4.8], c: LOT_PAINT[i], p: [-20 + i * 5, 0.5, -7.4], col: 1, vc: 1 + i })),",
        '--break-dup');
    }
    return pure;
  })()}
    return { CIVIC_PARTS, partCollider, civicColliders };
  `)(() => 0, V.makeVehicle, V.makeRecess);
  // 車身 = 帶 col 且水平半跨最大的那一組(車艙也帶 col,是**一疊**的上半;A46 ①)
  const cols = M.civicColliders('lot').filter((c) => c.hw2 != null
    && near(Math.max(c.hw2, c.hd2), HD, 1e-9) && near(Math.min(c.hw2, c.hd2), HW, 1e-9));
  ok(cols.length === 9, `停車場九台車的車身有向盒都在(${cols.length} 顆)`);
  let worst = 0;
  for (const [fx, fz] of FROZEN) {
    const c = cols.find((q) => near(q.px, fx, 1e-9) && near(q.pz, fz, 1e-9));
    if (!c) { worst = Infinity; continue; }
    const cs = Math.cos(c.ry), sn = Math.sin(c.ry);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lx = c.hw2 * sx, lz = c.hd2 * sz;
      const wx = c.px + lx * cs + lz * sn, wz = c.pz - lx * sn + lz * cs;
      // 凍結的四角(ry = 0、hw2 = 1.1、hd2 = 2.4)
      const best = Math.min(
        ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([ax, az]) => Math.hypot(wx - (fx + HW * ax), wz - (fz + HD * az))));
      worst = Math.max(worst, best);
    }
  }
  ok(worst <= 1e-9, `九顆碰撞盒的世界四角點與改制前逐點相同(最大偏差 ${worst === Infinity ? '找不到那一顆' : worst.toExponential(2)} m)`);
  ok(M.civicColliders('lot').length === 21,
    `碰撞柱是**一疊**不是一顆:九台車各登記車身 + 車艙(全款 ${M.civicColliders('lot').length} 根;舊制 12 根 = 車頂那一截是空氣)`);
}

console.log('\nⅦ §2.3 哨兵:detailR(\'carwreck\') / detailR(\'container\') 新基準');
{
  // 這兩個數由 `ground.js DETAIL_DEFS` 的幾何實算,而 `addDetail` 的所有早退都排在
  // `orient()` 與 `tx/tz` 兩枚共享 `rnd()` **之前** ⇒ 一件被 `detFree` 淘汰就少抽 3~4 枚。
  // 它們一動,全圖每一株植被、每一棟補間建物的落點整條推移,而**沒有任何錯誤訊息**。
  const FROZEN = { carwreck: Math.hypot(4.8 / 2, 1.9 / 2), container: Math.hypot(6.058 / 2, 2.438 / 2) };
  let G = ground;
  if (BREAK_DETR) {
    G = mustReplace(G, /container:\[\{ geo: box\(6\.058, 2\.591, 2\.438\)/,
      'container:[{ geo: box(3.0, 1.3, 1.25)', '--break-detr');
    G = mustReplace(G, /carwreck: \[\{ geo: box\(4\.8, 1\.45, 1\.9\)/,
      'carwreck: [{ geo: box(1.9, 0.6, 1.05)', '--break-detr');
  }
  const SHORTHAND = /^const cone = [\s\S]*?^const cyl = [^\n]*\n/m.exec(G)[0];
  const DEFS = /^const DETAIL_DEFS = \{[\s\S]*?^\};/m.exec(G)[0];
  class Geo {
    constructor(w, h, d) { this.b = { min: { x: -w / 2, y: -h / 2, z: -d / 2 }, max: { x: w / 2, y: h / 2, z: d / 2 } }; }
    get boundingBox() { return this.b; }
    computeBoundingBox() {}
    translate(x = 0, y = 0, z = 0) {
      this.b.min.x += x; this.b.max.x += x; this.b.min.y += y; this.b.max.y += y; this.b.min.z += z; this.b.max.z += z; return this;
    }
    rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; }
    scale(sx = 1, sy = 1, sz = 1) {
      this.b.min.x *= sx; this.b.max.x *= sx; this.b.min.y *= sy; this.b.max.y *= sy; this.b.min.z *= sz; this.b.max.z *= sz; return this;
    }
  }
  const T3 = new Proxy({
    BoxGeometry: function (w, h, d) { return new Geo(w, h, d); },
    CylinderGeometry: function (r0, r1, h) { const r = Math.max(r0, r1); return new Geo(r * 2, h, r * 2); },
    ConeGeometry: function (r, h) { return new Geo(r * 2, h, r * 2); },
    IcosahedronGeometry: function (r) { return new Geo(r * 2, r * 2, r * 2); },
    SphereGeometry: function (r) { return new Geo(r * 2, r * 2, r * 2); },
  }, { get: (t, k) => t[k] || function () { return new Geo(0, 0, 0); } });
  const defs = new Function('THREE', `${SHORTHAND}${DEFS}\nreturn DETAIL_DEFS;`)(T3);
  const rOf = (type) => {
    let r = 0;
    for (const p of defs[type]) {
      const bb = p.geo.boundingBox;
      r = Math.max(r, Math.hypot(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)),
        Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z))));
    }
    return r;
  };
  for (const [k, want] of Object.entries(FROZEN)) {
    const got = rOf(k);
    ok(near(got, want, 1e-12),
      `detailR('${k}') = ${got.toFixed(12)}(新基準 ${want.toFixed(12)})—— 這一條紅 = 新程式碼不再可重現`);
  }
}

console.log('\nⅧ ③-4 draw call:公設的顏色走頂點色,不是各佔一顆 mesh');
{
  let S = site;
  if (BREAK_BATCH) {
    S = mustReplace(S, /const mk = `\$\{b\.e \? `E\$\{b\.c\}` : ''\}\|\$\{b\.sf \|\| ''\}`;/,
      'const mk = `${b.c}|${b.e ? 1 : 0}|${b.sf || \'\'}`;', '--break-batch');
  }
  // 分桶鍵一格未動(它決定材質旗標與擺動 span 的分母)
  ok(/const key = `\$\{pc\}\|\$\{p\.e \? 1 : 0\}\|\$\{p\.sf \|\| ''\}`/.test(S),
    '零件分桶鍵一格未動(`sf` 混桶 = 同色的鋪面與草坪共用一份旗標)');
  ok(/mergeGeos\(b\.geos, b\.cols\)/.test(S) && /vertexColors: true/.test(S),
    '合併走 `mergeGeos(geos, cols)` 的頂點色通道(顏色回到材質 = 一個顏色一顆 mesh)');
  // 逐款 mesh 數 = 分組數:上界 = 1(素色)+ 軟性種類數 + 自發光顏色數
  const M = new Function('partExtent', 'makeVehicle', 'makeRecess', `
    ${(() => {
    const i0 = S.indexOf('export const URBAN = {');
    const i1 = S.indexOf('// ---- 建構(以下才需要 THREE)----');
    return S.slice(i0, i1).replace(/^export /gm, '');
  })()}
    return { CIVIC_PARTS, CIVIC_KINDS };
  `)(() => 0, V.makeVehicle, V.makeRecess);
  // 以真品的分組鍵重算(BREAK_BATCH 時是舊鍵 ⇒ 顏色回到材質 ⇒ 桶數爆開)
  const mkOf = BREAK_BATCH
    ? (p, pc) => `${pc}|${p.e ? 1 : 0}|${p.sf || ''}`
    : (p, pc) => `${p.e ? `E${pc}` : ''}|${p.sf || ''}`;
  for (const k of Object.keys(M.CIVIC_KINDS)) {
    const parts = M.CIVIC_PARTS[k] || [];
    const sfs = new Set(parts.filter((p) => p.sf).map((p) => p.sf));
    const es = new Set(parts.filter((p) => p.e).map((p) => p.c));
    const cap = 1 + sfs.size + es.size;
    const got = new Set(parts.map((p) => mkOf(p, p.c))).size;
    ok(got <= cap, `${k}:draw call ${got} ≤ 1 + 軟性 ${sfs.size} + 自發光 ${es.size} = ${cap}`);
  }
}

console.log('\nⅩ ③-2 真凹處:往外堆,不往內挖');
{
  let rows = V.makeRecess({ W: 2.0, H: 1.6, D: 0.5, c: 0x888888 });
  if (BREAK_RECESS) rows = rows.map((p) => ({ ...p, p: [p.p[0], p.p[1], -p.p[2]] }));
  const z0 = V.partsAABB(rows).z0;
  ok(z0 >= -1e-9, `凹處零件的最小 z = ${z0.toFixed(4)} ≥ 0(量體前緣)—— 寫在實心面後面就是整片消失,不報錯`);
  ok(rows.length >= 5, `一處凹處 = 背板 + 楣樑 + 檻 + 兩側側返(${rows.length} 件)`);
  ok(V.RECESS.MIN_D > 0 && V.makeRecess({ W: 1, H: 1, D: 0 }).some(
    (p) => V.partAABB(p).z1 >= V.RECESS.MIN_D - 1e-9),
  `凹深有下限 ${V.RECESS.MIN_D}m(再淺就只是一條陰影線,而它照樣要付一顆 draw call)`);
  // 收費亭真的接上了(③-2 的第一個消費端)
  ok(/makeRecess\(\{ W: [\d.]+, H: [\d.]+, D: [\d.]+, at: \[-23,/.test(site),
    'siteplan 的收費亭窗口走 `makeRecess`(③-2 的消費端之一)');
  ok(/'port'/.test(veh), '型錄的 `extra: [\'port\']` 語彙接上同一支 `makeRecess`(不是第二份實作)');
}

console.log('\nⅪ ③-3 可視角:凹處在站立高度上看不看得到底');
{
  // 站立視線高 **注入不寫死**(vehicles.js 零 import ⇒ 名冊由呼叫端給)。
  // ⚠ 刻意 MUST NOT 轉呼 `data.js curveEyeM()`:那一支帶著引數順序缺陷
  //   (`heroTargetH(ch, lv)` vs 簽章 `heroTargetH(kind, ch)`)⇒ 每一輪都走 `SOLDIER_H * 4`。
  const heights = Object.keys(CHARACTERS).map((ch) => heroTargetH(charKind(ch), ch));
  const eye = V.standEyeM(heights, SELF_F.eye);
  ok(eye > 0.5 && eye < 2.0, `站立視線高 ${eye.toFixed(5)}m(最矮機體 ${Math.min(...heights).toFixed(3)}m × SELF_F.eye ${SELF_F.eye})`);
  ok(eye < 4.0, '⚠ 見證人:`curveEyeM()` 現值 4.0824m(引數順序缺陷 ⇒ 恆走 SOLDIER_H × 4);本支刻意另立');
  const standR = 1.6;   // 機體自己的碰撞半徑(站得最近的距離)
  // 現役的兩處凹處 MUST 看得到底
  const cases = [
    ['收費亭窗口', 1.1, 0.4],
    ['補給箱出貨口(型錄 port)', V.VEHICLE_SPEC.container20.H * 0.62, V.RECESS.MIN_D],
  ];
  for (const [name, H, D] of cases) {
    const ang = V.vehicleSight(H, D) * 180 / Math.PI;
    const dMax = V.sightDepth(H, D, eye, standR);
    const good = BREAK_SIGHT ? true : V.sightOk(H, D, eye, standR);
    ok(good, `${name}:張角 ${ang.toFixed(1)}°、看得進去 ${dMax === Infinity ? '整條(開口高於眼睛)' : dMax.toFixed(2) + 'm'} ≥ 凹深 ${D}m`);
  }
  // **對照組(這道閘要有牙)**:同樣的開口高度,挖到超過看得進去的深度就 MUST 判不合格。
  // SKILL 的症狀表那一列(0.17 高的溝槽在站立高度上看不到底)就是這一格。
  const H0 = 0.17;
  const dMax0 = V.sightDepth(H0, 0, eye, standR);
  const tooDeep = dMax0 * 1.2;
  const bad = BREAK_SIGHT ? true : V.sightOk(H0, tooDeep, eye, standR);
  ok(bad === false,
    `對照組:${H0}m 高的溝槽最多看得進去 ${dMax0.toFixed(3)}m,挖到 ${tooDeep.toFixed(3)}m MUST 判不合格(門檻拿掉就是這一條紅)`);
  ok(BREAK_SIGHT ? true : V.sightOk(H0, dMax0 * 0.8, eye, standR),
    `對照組另一側:同一個溝槽挖 ${(dMax0 * 0.8).toFixed(3)}m MUST 判合格(兩側都有牙 ⇒ 不是恆真也不是恆假)`);
}

console.log('\nⅫ AABB 單一縫(edgewall.partBox → vehicles.partAABB)');
{
  const cases = [
    { g: ['box', 3, 1, 2], p: [1, 2, -3] },
    { g: ['box', 3, 1, 2], p: [1, 2, -3], r: [0, Math.PI / 4, 0] },
    { g: ['cyl', 0.4, 0.4, 1.2, 8], p: [0, 0.4, 0], r: [Math.PI / 2, 0, 0] },
    { g: ['cyl', 0.4, 0.6, 1.2, 8], p: [2, 1, 3], r: [0.3, -0.7, 1.1] },
    { g: ['cone', 1.2, 2.4, 6], p: [-1, 0, 2] },
    { g: ['ico', 0.8], p: [0.5, 0.5, 0.5], r: [0.2, 0.2, 0.2] },
  ];
  let worst = 0;
  for (const c of cases) {
    const a = V.partAABB(c), b = partBox(c);
    for (const k of ['x0', 'x1', 'y0', 'y1', 'z0', 'z1']) worst = Math.max(worst, Math.abs(a[k] - b[k]));
  }
  ok(worst <= 1e-12,
    `六個案例逐項相同(最大偏差 ${worst.toExponential(2)})`);
  ok(/export function partBox\(part\) \{\s*return partAABB\(part\);\s*\}/.test(edge),
    'edgewall.partBox 直接轉呼 partAABB，沒有第二份旋轉 AABB 算術');
}

console.log('\nⅩⅢ hazards 靜態件合併:rock / 動態 / 透明件排除');
{
  ok(/batchHazardParts\(g\);/.test(hz) && /mergeGeos\(geos\)/.test(hz),
    'jitter 後進逐材質合併唯一縫');
  ok(/o\.material\.transparent \|\| o\.userData\.outlineGeo \|\| Object\.keys\(o\.userData\)\.length/.test(hz),
    '透明件、rock outlineGeo、逐幀 userData 件維持獨立');
  ok(hz.indexOf('batchHazardParts(g);') > hz.indexOf('jitterParts(g,')
    && hz.indexOf('batchHazardParts(g);') < hz.indexOf('bakeContactAO(g,'),
  '合併順序 = jitter 後、AO / outlinify 前');
}

console.log(`\n${fail ? '❌' : '🎉'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
