// ============ 場址配置規則稽核(都市計畫 / 樹冠羞避 / 地質排列)============
// 2026-08-03 使用者定案三條(市區沿街配置 + 公設 / 綠地樹冠羞避 / 裸露地地質排列)。
// 三條全是**排列規則**,而排列規則壞掉的方式一律是無聲的:
//   ① 少了建築線退縮或排距不變式 ⇒ 街牆參差、後棟壓進巷弄 —— 沒有任何錯誤訊息
//   ② 少了冠緣間隙 ⇒ 神木樹冠糊成一團(遠看只是「森林比較密」)
//   ③ 少了走向 ⇒ 巨石各轉各的(遠看只是「石頭比較多」)
// 故本檔全部以 **執行 `siteplan.js` 的純區塊原文**(㋑)做行為直測 —— 抄一份公式進稽核,
// 公式改了稽核照舊全綠。不需要網路、不需要瀏覽器、不需要 three(純區塊零 THREE)。
//
// 分段:
//   Ⅰ 都市計畫 —— 常數不變式 / 建築線對齊 / 沿街節奏 / 路口留白 / 公設優先 / 零亂數
//   Ⅱ 公設 —— foot 雙向貼齊零件實算 / 鋪面不掛碰撞 / 碰撞柱實算 / 三款輪替
//   Ⅲ 樹冠羞避 —— 冠緣不相碰(核心不變式)/ 縮冠而非淘汰 / 下限 / 傾斜方向與有界 / 確定性
//   Ⅳ 地質排列 —— 走向 ⟂ 傾向 / 平地回 null / 長軸同向 / 排間錯縫 / 由核心往外 / 體格遞減
//   Ⅴ 消費端單一縫 —— biomes.js 的接線(一份實作一個呼叫點、零共享 rnd、朝向公式共用、
//      AI 零件庫解析只有 build 時的 partGeo 一份且佈局數學只讀保險絲 p.g —— §8 修正 1)
//   Ⅶ 建物來源信任階梯(2026-08-05 使用者回報「綠地/裸露地建築太多、不符真實圖資」)——
//      每一條會生出建物的路都要有圖資背書:邊界樓過聚落場、備援街區只在查詢失敗時觸發、
//      市區種子影像在手就走純影像判(手寫 mix 不得憑空生出市區)
//
// 反向驗證(原則 9):
//   --break-line    進深上限撐破排距 ⇒ Ⅰ 的排距不變式與後棟淨距 MUST 紅字
//   --break-shy     冠緣間隙歸零 ⇒ Ⅲ 的「冠緣不相碰」MUST 紅字
//   --break-strike  長軸抖動放大 ⇒ Ⅳ 的「長軸同向」MUST 紅字
//   --break-gate    邊界樓的聚落場閘改成恆放行 ⇒ Ⅶ 的「荒野邊界零棟」MUST 紅字
//   --break-mass2   第二個整棟量體桶(低矮建物)退回壞版:兩桶挑選數加總超出總額度 /
//                   低矮桶拿掉保險絲 / 兩桶資格重疊
//   --break-mass    整棟量體那一段退回舊制(pick_n 與預算分家 / 等高不再以座標定序 / 色抖吃拆桶後
//                   的新索引)⇒ Ⅴ 的整棟量體三條 MUST 紅字
//   --break-roof    屋頂帶退回壞版(帶寬與 tri_budget 分家 / 斜頂那條呼叫端不傳屋頂色)
//                   ⇒ Ⅴ 的屋頂帶兩條 MUST 紅字
//   --break-storey  層高不再夾在帶內(拿掉「先取落在帶內的候選」那一步)
//                   ⇒ Ⅴ 的層高全域不變式 MUST 紅字
import { readSrc } from './audit_src.mjs';
import { makeVehicle, makeRecess } from '../public/js/vehicles.js';
import { objHeightMax, objScaleFit, WORLD_EDGE, edgeWallInsetM, edgeWallDeepM } from '../public/js/data.js';
// AI 零件庫的消費端讀取縫(入庫閘與 3D 對照台同一支;這裡驗的是「接線有沒有漏」,
// 不是外廓 —— 外廓歸 intake_parts.mjs,兩邊 MUST 吃同一份解析)
import { bioLibDescs, partLibs, parseGlb } from './ai3d/parts_src.mjs';
// 窗格貼齊面板的**行為直測**(⑥-d):規則本體零 import ⇒ 這裡直接載真品跑一次
import * as WALLPANEL from '../public/js/wallpanel.js';

const BREAK_LINE = process.argv.includes('--break-line');
const BREAK_SHY = process.argv.includes('--break-shy');
const BREAK_STRIKE = process.argv.includes('--break-strike');
const BREAK_GATE = process.argv.includes('--break-gate');
const BREAK_MASS = process.argv.includes('--break-mass');
const BREAK_ROOF = process.argv.includes('--break-roof');
const BREAK_STOREY = process.argv.includes('--break-storey');
// 第二個整棟量體桶(低矮建物)的反向驗證:①兩桶挑選數加起來超出總額度
// ②低矮桶拿掉保險絲 ③兩桶資格重疊(低矮那一邊漏掉門檻)
const BREAK_MASS2 = process.argv.includes('--break-mass2');
// 2026-08-12 三支(使用者「物理碰撞應該要與建模的 3D 外表一致」「調整目標物件到適合的大小」
// 「不同建築使用窗戶圖層間距不要都一樣」):
//   --break-prof  碰撞柱退回整顆方盒(剖面白量了)⇒ 碰撞剖面四條 MUST 紅字
//   --break-fill  實例縮放退回直接吃 (w,h,d) 且拿掉拉伸夾制 ⇒ 尺寸貼合那一條 MUST 紅字
//   --break-glass 窗格覆寫整批拿掉 ⇒ 間距種類與玻璃牆那兩條 MUST 紅字
//   --break-flat  平整那一條退回上一輪(窗牆帶只看傾角 / 招牌不篩平整段)⇒ ⑥-c 四條 MUST 紅字
const BREAK_FLAT = process.argv.includes('--break-flat');
const BREAK_PROF = process.argv.includes('--break-prof');
const BREAK_FILL = process.argv.includes('--break-fill');
const BREAK_GLASS = process.argv.includes('--break-glass');
// 2026-08-14(使用者「相對周邊面積過小且角度差異沒有過大的區塊,與角度最接近的鄰居合併,
// 最後收斂成多面柱體/錐台/角錐/圓柱/圓台/圓錐等幾何多面體構成」):
//   --break-merge 整條 ㋗ 拿掉(退回第三輪)⇒ ⑥-e 五條 MUST 紅字
const BREAK_MERGE = process.argv.includes('--break-merge');
// 2026-08-14 第五輪(使用者「處理合併平面前,隨機凹凸不平的面先弄平整」):
//   --break-denoise 整條 ㋘ 拿掉(退回第四輪)⇒ ⑥-e 的去噪四條 MUST 紅字
const BREAK_DENOISE = process.argv.includes('--break-denoise');
// 2026-08-14(使用者圈了三處「破洞」⇒ 量出來是底面內凹的穹頂 + 扇貝狀底緣):
//   --break-seal 封底的三道夾制拿掉 ⇒ ⑥-e 的封底四條 MUST 紅字
const BREAK_SEAL = process.argv.includes('--break-seal');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const src = readSrc('public', 'js', 'siteplan.js');
const bcn = readSrc('public', 'js', 'beacons.js');
const bio = readSrc('public', 'js', 'biomes.js');

// ---- 抽出「純區塊」= 常數起點 → 建構段起點(界標與 beacons.js 同一句,刻意的)----
const i0 = src.indexOf('export const URBAN = {');
const i1 = src.indexOf('// ---- 建構(以下才需要 THREE)----');
if (i0 < 0 || i1 < 0 || i1 <= i0) { console.log('❌ 找不到 siteplan 純區塊界標'); process.exit(1); }
const pureSrc = src.slice(i0, i1);

// `partExtent` 住 beacons.js(零件外廓的唯一縫,公設與地標共用)—— 一併執行原文注入進來
const b0 = bcn.indexOf('export const BEACON = {');
const b1 = bcn.indexOf('// ---- 建構(以下才需要 THREE)----');
const { partExtent } = new Function('makeVehicle', `
  ${bcn.slice(b0, b1).replace(/^export /gm, '')}
  return { partExtent };
`)(makeVehicle);

// `makeVehicle` / `makeRecess` 住 vehicles.js(載具型錄唯一縫,零 import ⇒ Node 端直接載得動)
//  —— 停車場的九台車與收費亭的窗口凹處都經它產出,漏了注入就是整支稽核在
//     `const CIVIC_PARTS = {…}` 那一行 ReferenceError,而錯誤訊息與場址配置完全無關。
const M = new Function('partExtent', 'makeVehicle', 'makeRecess', `
  ${pureSrc.replace(/^export /gm, '')}
  return { URBAN, urbanRowPitch, CIVIC, CIVIC_KINDS, CIVIC_ORDER, CIVIC_PARTS, CIVIC_TREES,
           plotSeed, frac, roadFaceRy, planBlocks, civicExtent, partCollider, civicColliders,
           CROWN, crownGap, planShyGrove, ROCKFIELD, strikeRad, planRockField };
`)(partExtent, makeVehicle, makeRecess);

if (BREAK_LINE) M.URBAN.DEPTH = [12, 40];
if (BREAK_SHY) { M.CROWN.GAP_M = 0; M.CROWN.GAP_F = 0; M.CROWN.FIT_MIN = 0; }
if (BREAK_STRIKE) M.ROCKFIELD.RY_JIT = 3;

// 剝註解後的原文(㋑:註解裡當然可以提到 three / rnd,會壞事的是真的用到)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const pureCode = strip(pureSrc);

// ============ Ⅰ 都市計畫 ============
console.log('\nⅠ 都市計畫(街廓配置)');
{
  ok(!/\bTHREE\b/.test(pureCode), '純區塊零 THREE(這才是本項能離線驗的原因)');
  ok(!/Math\.random/.test(src), '全檔無 Math.random(A4)');
  ok(!/\brnd\s*\(/.test(pureCode), '規劃器零亂數消耗(§2.3:不推移共享序列)');
  // 排距不變式:進深上限 + 巷弄 = 排距。手寫兩份的症狀是「後棟壓進巷弄」,不會報錯。
  ok(near(M.urbanRowPitch(), M.URBAN.ROW_PITCH),
    `排距不變式:DEPTH[1](${M.URBAN.DEPTH[1]})+ ALLEY(${M.URBAN.ALLEY})= ROW_PITCH(${M.URBAN.ROW_PITCH})`);
  ok(M.URBAN.SETBACK > 0, `建築線退縮 > 0(${M.URBAN.SETBACK}m)`);
  ok(M.URBAN.PITCH > M.URBAN.FRONT_W[1], `臨街節奏(${M.URBAN.PITCH}m)寬於最大面寬(${M.URBAN.FRONT_W[1]}m)⇒ 樓與樓之間留得下縫`);
  ok(M.URBAN.MAIN_COMM > M.URBAN.SIDE_COMM && M.URBAN.SIDE_COMM > M.URBAN.BACK_COMM,
    '分區梯度:幹道臨街 > 支道臨街 > 後棟(商辦臨街、住宅在後)');
  ok(M.URBAN.MIN_SEG > M.URBAN.PITCH, `MIN_SEG(${M.URBAN.MIN_SEG}m)> 臨街節奏 ⇒ 路口碎段不配置`);

  // ---- 行為直測:一條 600m 的正東西向幹道,全放行 ----
  const hw = 5;
  const seg = { x1: -300, z1: 0, x2: 300, z2: 0, hw, main: true };
  const all = M.planBlocks({ segs: [seg], probeLot: () => true, probeCivic: () => true });
  ok(all.plots.length > 20, `單段 600m 幹道配得出建築(${all.plots.length} 棟)`);
  ok(all.civics.length >= 1, `同一段街上劃得出公設(${all.civics.length} 處)`);

  // 建築線:第 r 排的臨街立面一律落在 hw + SETBACK + r × ROW_PITCH(紀律③)
  let lineOk = true, pitchOk = true, endOk = true;
  for (const p of all.plots) {
    const perp = Math.abs(p.z);                    // 街道沿 x 軸 ⇒ 垂距就是 |z|
    const face = perp - p.d / 2;                   // 臨街立面到路心的距離
    if (!near(face, hw + M.URBAN.SETBACK + p.row * M.URBAN.ROW_PITCH, 1e-6)) lineOk = false;
    if (Math.abs(p.x) > 300 - M.URBAN.END_PAD) endOk = false;
  }
  ok(lineOk, '**建築線對齊**:每一排的臨街立面共線(進深不同也不影響)');
  ok(endOk, `路口留白:沒有任何一棟落在線段兩端 ${M.URBAN.END_PAD}m 內`);
  // 沿街節奏:同側同排的相鄰建物中心距 = PITCH 的整數倍
  for (const side of [1, -1]) {
    for (const row of [0, 1]) {
      const xs = all.plots.filter((p) => Math.sign(p.z) === side && p.row === row).map((p) => p.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        if (!near((xs[i] - xs[i - 1]) % M.URBAN.PITCH, 0, 1e-6)
          && !near((xs[i] - xs[i - 1]) % M.URBAN.PITCH, M.URBAN.PITCH, 1e-6)) pitchOk = false;
      }
    }
  }
  ok(pitchOk, '沿街節奏:同側同排的間距恆為 PITCH 的整數倍');

  // 後棟淨距:兩排之間留得下巷弄(排距 − 兩半進深 ≥ 0)。--break-line 正是打這一條
  let alleyMin = Infinity;
  for (const a of all.plots.filter((p) => p.row === 0)) {
    for (const b of all.plots.filter((p) => p.row === 1 && Math.sign(p.z) === Math.sign(a.z) && near(p.x, a.x, 1e-6))) {
      alleyMin = Math.min(alleyMin, Math.abs(b.z) - b.d / 2 - (Math.abs(a.z) + a.d / 2));
    }
  }
  ok(!(alleyMin < 0), `前後棟之間留得下巷弄(最窄 ${alleyMin === Infinity ? 'n/a' : alleyMin.toFixed(2)}m)`);

  // 門朝街:立面法線指向路心
  let faceOk = true;
  for (const p of all.plots) {
    // three 的 ry:local +z → (sin ry, cos ry);它應該指向街道(z=0)那一側
    const fz = Math.cos(p.ry);
    if (Math.sign(fz) === Math.sign(p.z) || Math.abs(fz) < 0.99) faceOk = false;
  }
  ok(faceOk, '門朝街:立面法線指向路心且平行街道(roadFaceRy 單一縫)');

  // 公設優先:公設用地上不得再配建築
  let clash = false;
  for (const c of all.civics) {
    const def = M.CIVIC_KINDS[c.kind];
    for (const p of all.plots) {
      if (Math.sign(p.z) !== Math.sign(c.z)) continue;
      const pr = Math.hypot(p.w, p.d) / 2;
      if (Math.abs(p.x - c.x) < def.w / 2 + pr && Math.abs(Math.abs(p.z) - Math.abs(c.z)) < def.d / 2 + pr) clash = true;
    }
  }
  ok(!clash, '**公設優先**:先劃公設用地、再劃建築基地(兩者不重疊)');

  // 短段不配置 / 空段回空
  ok(M.planBlocks({ segs: [{ x1: 0, z1: 0, x2: M.URBAN.MIN_SEG - 1, z2: 0, hw, main: true }], probeLot: () => true, probeCivic: () => true }).plots.length === 0,
    '短於 MIN_SEG 的路段一棟都不配(路口碎段/彎道細分段)');
  ok(M.planBlocks({ segs: [], probeLot: () => true, probeCivic: () => true }).plots.length === 0, '沒有街道就沒有配置');
  // 全拒 ⇒ 一棟都不擺(原則 6:規劃器不認得地形,通過與否全由 probe 決定)
  const none = M.planBlocks({ segs: [seg], probeLot: () => false, probeCivic: () => false });
  ok(none.plots.length === 0 && none.civics.length === 0, 'probe 全拒 ⇒ 一棟一處都不擺(寧缺勿錯)');
  // 確定性:同輸入逐位元同輸出
  const again = M.planBlocks({ segs: [seg], probeLot: () => true, probeCivic: () => true });
  ok(JSON.stringify(again) === JSON.stringify(all), '確定性:同輸入逐位元同輸出');
  // 上限
  const many = Array.from({ length: 400 }, (_, i) => ({ x1: -300, z1: i * 400, x2: 300, z2: i * 400, hw, main: true }));
  const cap = M.planBlocks({ segs: many, probeLot: () => true, probeCivic: () => true });
  ok(cap.plots.length <= M.URBAN.MAX, `全圖上限生效(${cap.plots.length} ≤ ${M.URBAN.MAX})`);
  ok(cap.civics.length <= M.CIVIC.MAX, `公設上限生效(${cap.civics.length} ≤ ${M.CIVIC.MAX})`);
  // 公設間距
  let sepOk = true;
  for (let i = 0; i < cap.civics.length; i++) {
    for (let j = i + 1; j < cap.civics.length; j++) {
      if (Math.hypot(cap.civics[i].x - cap.civics[j].x, cap.civics[i].z - cap.civics[j].z) < M.CIVIC.SEP - 1e-6) sepOk = false;
    }
  }
  ok(sepOk, `公設彼此間距 ≥ SEP(${M.CIVIC.SEP}m)`);
  // 三款都輪得到
  const kinds = new Set(cap.civics.map((c) => c.kind));
  ok(M.CIVIC_ORDER.every((k) => kinds.has(k)) || cap.civics.length < M.CIVIC_ORDER.length,
    `公設三款輪替都輪得到(${[...kinds].join('/')})`);
  // 朝向公式:轉 180° 的反例(側別一翻,立面就該翻過去)
  ok(near(Math.abs(M.roadFaceRy(1, 0, 1) - M.roadFaceRy(1, 0, -1)), Math.PI, 1e-9),
    'roadFaceRy:兩側相差恰 180°');
}

// ============ Ⅱ 公設(型錄 / 外廓 / 碰撞) ============
console.log('\nⅡ 公設(公園 / 運動場 / 停車場)');
{
  const kinds = Object.keys(M.CIVIC_KINDS);
  ok(kinds.length === 3 && kinds.includes('park') && kinds.includes('pitch') && kinds.includes('lot'),
    '使用者點名的三種公設齊全(公園 / 運動場 / 停車場)');
  ok(kinds.every((k) => M.CIVIC_PARTS[k]?.length), '每一款都有零件表');
  ok(Object.keys(M.CIVIC_PARTS).every((k) => M.CIVIC_KINDS[k]), '每一份零件表都有型錄(沒有孤兒)');
  ok(M.CIVIC_ORDER.every((k) => M.CIVIC_KINDS[k]), '輪替序全在型錄內');
  for (const k of kinds) {
    const ext = M.civicExtent(k);
    const foot = M.CIVIC_KINDS[k].foot;
    // 低報 = A30(規劃期預留 foot + PAD,而零件真的伸到 foot 之外 ⇒ 侵進沒申請過的空間)
    ok(ext <= foot + 1e-9, `${k}:實算外廓 ${ext.toFixed(2)}m ≤ 標稱 foot ${foot}m`);
    ok(ext >= foot * 0.75, `${k}:標稱 foot 沒有虛胖(實算佔 ${(ext / foot * 100).toFixed(0)}%)`);
    // 鋪面尺寸 MUST 收在 foot 內(否則草坪/柏油會鋪到淨空之外)
    const half = Math.hypot(M.CIVIC_KINDS[k].w, M.CIVIC_KINDS[k].d) / 2;
    ok(half <= foot + 1e-9, `${k}:標稱 w×d 的半對角 ${half.toFixed(1)}m ≤ foot`);
    ok(M.CIVIC_KINDS[k].flat > 0, `${k}:有平坦度門檻(${M.CIVIC_KINDS[k].flat}m)—— 坡地上不擺大平板`);
  }
  // 紀律④:鋪面/低矮件不得掛碰撞;掛了碰撞的一律有量體
  let padCol = false, tinyCol = false;
  for (const k of kinds) {
    for (const p of M.CIVIC_PARTS[k]) {
      if (!p.col) continue;
      const c = M.partCollider(p);
      if (c.h < 1.0) tinyCol = true;            // 高度不到膝蓋還擋路 = 隱形絆腳石
      if (p.g[0] === 'box' && p.g[1] > 45) padCol = true;   // 大鋪面掛碰撞 = 走不進去的公園
    }
  }
  ok(!padCol, '**開放空間不掛碰撞**:草坪/跑道/柏油面走得進去(紀律④)');
  ok(!tinyCol, '掛碰撞的一律有量體(不會冒出隱形絆腳石)');
  // A30:長條件 MUST 登記有向盒,圓只當 broad-phase 且恆為外接半對角
  let boxOk = true, oriented = 0;
  for (const k of kinds) {
    for (const p of M.CIVIC_PARTS[k]) {
      if (!p.col) continue;
      const c = M.partCollider(p);
      if (p.g[0] !== 'box') { if (c.hw2 != null) boxOk = false; continue; }
      oriented++;
      if (c.hw2 == null || !near(c.r, Math.hypot(c.hw2 * 2, c.hd2 * 2) / 2, 1e-9)) boxOk = false;
      if (Math.max(c.hw2, c.hd2) / Math.min(c.hw2, c.hd2) > 2 && c.hw2 == null) boxOk = false;
    }
  }
  ok(boxOk && oriented > 0, `方盒件登記有向盒、圓恆為外接半對角(${oriented} 件;A30)`);
  for (const k of kinds) {
    const cols = M.civicColliders(k);
    ok(cols.length >= 1, `${k}:至少有一件實心結構登記碰撞柱(${cols.length} 根)`);
    // 碰撞體一律收在 foot 內(規劃期預留的就是這一圈)。量的是**該件的實際外廓**
    // (`partExtent`,與 foot 同一把尺)—— 長條件拿外接圓量會虛胖到假紅字。
    ok(M.CIVIC_PARTS[k].filter((p) => p.col).every((p) => partExtent(p) <= M.CIVIC_KINDS[k].foot + 1e-9),
      `${k}:每一件碰撞體都收在 foot 內`);
  }
  // 停車場的車一定是實心的(使用者說的「停車場」不是一片畫著白線的空地)
  ok(M.civicColliders('lot').length >= 6, `停車場的停放車輛各自登記碰撞柱(${M.civicColliders('lot').length} 根)`);
  // partCollider 實算(方盒取水平半對角,不是抄一個常數)
  const c1 = M.partCollider({ g: ['box', 6, 2, 8], p: [3, 1, 4] });
  ok(near(c1.r, Math.hypot(6, 8) / 2) && near(c1.px, 3) && near(c1.pz, 4) && near(c1.h, 2),
    'partCollider:方盒取水平半對角、位移原樣帶出、高度含離地');
  const c2 = M.partCollider({ g: ['cyl', 1.5, 2.5, 9, 6], p: [0, 4.5, 0] });
  ok(near(c2.r, 2.5) && near(c2.h, 9), 'partCollider:圓柱取較粗那一端');
  // 公園的樹走既有植被(自建 mesh 就是多幾個 draw call 畫同一棵樹)
  ok((M.CIVIC_TREES.park || []).length >= 4, `公園有園樹落點(${(M.CIVIC_TREES.park || []).length} 株)`);
  ok(Object.keys(M.CIVIC_TREES).every((k) => (M.CIVIC_TREES[k] || []).every(
    ([lx, lz]) => Math.hypot(lx, lz) <= M.CIVIC_KINDS[k].foot + 1e-9)), '園樹落點收在 foot 內');
}

// ============ Ⅲ 樹冠羞避 ============
console.log('\nⅢ 樹冠羞避(Crown shyness)');
{
  ok(M.CROWN.GAP_M > 0 || BREAK_SHY, `冠緣間隙有固定底(${M.CROWN.GAP_M}m)`);
  ok(M.CROWN.GAP_F > 0 || BREAK_SHY, '間隙隨樹高遞增(高樹搖擺幅度大,裂隙也大)');
  ok(M.crownGap(100, 50) === M.crownGap(50, 100), 'crownGap 對稱(取較矮那株)');
  ok(M.crownGap(200, 50) < M.crownGap(200, 120) || BREAK_SHY, 'crownGap 隨較矮那株的樹高單調遞增');

  // ---- 核心不變式:任兩株的冠緣間距 ≥ crownGap ----
  // 合成一片刻意過密的群落(株距遠小於冠幅)
  const mk = (n, spread) => Array.from({ length: n }, (_, i) => {
    const s = M.plotSeed(7, i, 1, 0);
    return {
      x: (M.frac(s, 1) - 0.5) * spread, z: (M.frac(s, 2) - 0.5) * spread,
      s: 0.8 + M.frac(s, 3) * 0.7, cr: 12, h: 100,
    };
  });
  // 密度比照真實群落:5~11 株散在半徑 34~82m 內、冠幅半徑 ~12m(`giantCrownR` 實測量級)
  const dense = mk(11, 130);
  const out = M.planShyGrove(dense);
  let worst = Infinity;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const d = Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z);
      worst = Math.min(worst, d - out[i].cr * out[i].s - out[j].cr * out[j].s
        - M.crownGap(out[i].h * out[i].s, out[j].h * out[j].s));
    }
  }
  ok(out.length > 0, `過密群落仍留得下樹(${out.length}/${dense.length} 株)`);
  ok(!(worst < -1e-9), `**冠緣不相碰**:最小餘裕 ${worst === Infinity ? 'n/a' : worst.toFixed(3)}m ≥ 0`);
  // 縮冠而非淘汰:使用者要的是「森林」,一律淘汰會打成稀疏散株
  // 羞避本來就會篩掉一部分(冠幅 12~18m 的樹擠在 130m 見方裡,幾何上就是放不下 11 株)——
  // 這一條只防「規則把整群刷光」,不是要求全留。真正保住森林密度的是**群落半徑**
  // (`placeGiantGroves` 的 cr:羞避上線後同步放大 ⇒ 樹一樣多、只是林子攤得開)。
  ok(out.length >= dense.length * 0.4, `保留率不至於崩掉(${(out.length / dense.length * 100).toFixed(0)}%)`);
  // 縮冠而非淘汰:兩株相距 30m、冠幅各 12m、間隙 9m ⇒ 差 3m。使用者要的是「森林」,
  // 一律淘汰會把群落打成稀疏散株 ⇒ 這一株 MUST 是被**縮**下來的,不是被丟掉的。
  const tight = M.planShyGrove([
    { x: 0, z: 0, s: 1, cr: 12, h: 100 }, { x: 30, z: 0, s: 1, cr: 12, h: 100 },
  ]);
  ok(tight.length === 2 && tight[1].shy && tight[1].s < 1,
    `塞不下的那一株走**縮冠**(縮到 ${tight[1] ? tight[1].s.toFixed(3) : 'n/a'})`);
  // 間隙以**候選原體格**估(保守:縮小後的實際間隙只會更寬),故解出來的縮冠量
  // 剛好讓冠緣間距 = crownGap(原體格) —— 這是規則的定義,不是近似
  ok(tight.length === 2 && near(30 - 12 - tight[1].cr * tight[1].s, M.crownGap(100, 100), 1e-9),
    '縮冠量由不變式**解**出來(冠緣間距剛好等於規則值,不多留也不少留)');
  // 下限:縮到 FIT_MIN 以下就丟
  ok(out.every((t) => t.s >= (dense.find((c) => c.x === t.x && c.z === t.z).s) * M.CROWN.FIT_MIN - 1e-9),
    `縮冠不低於 FIT_MIN(${M.CROWN.FIT_MIN}）`);
  // 稀疏群落:一株都不該被縮(規則只在真的碰到時才作用)
  const sparse = mk(6, 900);
  const so = M.planShyGrove(sparse);
  ok(so.length === sparse.length && so.every((t) => !t.shy), '稀疏群落逐株原樣通過(規則不無故縮樹)');
  ok(so.every((t) => t.lean[0] === 0 && t.lean[1] === 0), '沒有鄰株就不傾斜');
  // 傾斜:有界、且方向遠離鄰株
  const pair = M.planShyGrove([
    { x: 0, z: 0, s: 1, cr: 12, h: 100 },
    { x: 30, z: 0, s: 1, cr: 12, h: 100 },
  ]);
  ok(pair.length === 2, '兩株剛好放得下');
  ok(pair[1].lean[0] > 0 && Math.abs(pair[1].lean[1]) < 1e-9, '傾斜方向遠離鄰株');
  ok(Math.hypot(...pair[1].lean) <= M.CROWN.LEAN + 1e-9, `傾斜量有界(≤ ${M.CROWN.LEAN}）`);
  ok(out.every((t) => Math.hypot(...t.lean) <= M.CROWN.LEAN + 1e-9), '過密群落的傾斜量同樣有界');
  // 確定性 + 零亂數
  ok(JSON.stringify(M.planShyGrove(dense)) === JSON.stringify(out), '確定性:同輸入逐位元同輸出');
  ok(M.planShyGrove([]).length === 0, '空輸入回空');
  // 冠幅為 0(退化輸入)不得炸掉也不得無限縮
  ok(M.planShyGrove([{ x: 0, z: 0, s: 1, cr: 0, h: 10 }, { x: 0.5, z: 0, s: 1, cr: 0, h: 10 }]).length >= 1,
    '冠幅 0 的退化輸入不炸');
}

// ============ Ⅳ 地質排列 ============
console.log('\nⅣ 地質排列(裸露地巨石露頭)');
{
  // 走向 ⟂ 傾向:梯度朝 +x(往東變高)⇒ 走向沿 z 軸
  const st = M.strikeRad(1, 0);
  ok(near(Math.abs(Math.cos(st)), 0, 1e-9) && near(Math.abs(Math.sin(st)), 1, 1e-9),
    '走向 ⟂ 傾向:梯度朝 +x ⇒ 走向沿 z 軸(等高線方向)');
  for (const [gx, gz] of [[1, 0], [0, 1], [1, 1], [-2, 0.7], [0.3, -1.4]]) {
    const a = M.strikeRad(gx, gz);
    const dot = Math.cos(a) * gx + Math.sin(a) * gz;
    if (!near(dot, 0, 1e-9)) { ok(false, `走向與梯度正交(${gx},${gz})`); break; }
  }
  ok(true, '走向與梯度逐例正交(五組梯度)');
  ok(M.strikeRad(0, 0) === null, '平地(梯度趨零)回 null ⇒ 呼叫端退回落點雜湊(原則 6)');
  ok(M.strikeRad(1e-9, 1e-9) === null, '梯度低於 eps 一律回 null(不會每格跳一個方向)');

  const pitch = 100, strike = 0.7;
  const cells = M.planRockField({ cx: 0, cz: 0, strike, pitch, seed: 12345 });
  ok(cells.length === M.ROCKFIELD.ROWS * M.ROCKFIELD.PER_ROW,
    `格點數 = ROWS × PER_ROW(${cells.length})`);
  // 由核心往外:回傳序的離心距不遞減(呼叫端逐一驗淨空,先放的是最該保住的)
  let radial = true, prev = -1;
  for (const c of cells) {
    const d = Math.hypot(c.x, c.z);
    if (d < prev - pitch * M.ROCKFIELD.JITTER * 2 - 1e-9) radial = false;
    prev = d;
  }
  ok(radial, '**由核心往外**:回傳序依離心距(抖動範圍內)');
  ok(near(cells[0].sf, 1, 1e-9), '核心那顆體格係數 = 1');
  ok(cells[cells.length - 1].sf < cells[0].sf, `體格自核心往外遞減(外緣 ${cells[cells.length - 1].sf.toFixed(2)}）`);
  ok(cells.every((c) => c.sf >= 1 - M.ROCKFIELD.FALL - 1e-9), `遞減不超過 FALL(${M.ROCKFIELD.FALL}）`);
  // 長軸同向:所有岩塊的 ry 落在 strike ± RY_JIT
  const off = cells.map((c) => Math.abs(((c.ry - strike + Math.PI) % (Math.PI * 2)) - Math.PI));
  ok(Math.max(...off) <= M.ROCKFIELD.RY_JIT + 1e-9,
    `**長軸同向**:最大偏離 ${Math.max(...off).toFixed(3)} rad ≤ RY_JIT`);
  ok(Math.max(...off) < 0.5, '長軸偏離小到看得出「同一組節理」(< 0.5 rad)');
  // 節理間距:垂直走向的分量恆為 pitch 的整數倍(± 抖動)
  const ca = Math.cos(strike), sa = Math.sin(strike);
  const vs = cells.map((c) => -sa * c.x + ca * c.z);
  const rows = new Set(vs.map((v) => Math.round(v / pitch)));
  ok(rows.size === M.ROCKFIELD.ROWS, `節理成排:${rows.size} 排(垂直走向分量分層)`);
  ok(vs.every((v) => Math.abs(v - Math.round(v / pitch) * pitch) <= pitch * M.ROCKFIELD.JITTER + 1e-9),
    '排距 = pitch(抖動之內)');
  // 相鄰排錯縫:奇數排沿走向偏移 ROW_SKEW × pitch
  const us = cells.map((c) => ca * c.x + sa * c.z);
  const rowOf = (i) => Math.round(vs[i] / pitch);
  const evenU = us.filter((_, i) => Math.abs(rowOf(i)) % 2 === 0).map((u) => u / pitch);
  const oddU = us.filter((_, i) => Math.abs(rowOf(i)) % 2 === 1).map((u) => u / pitch);
  const fracOf = (a) => a.map((u) => Math.abs(u - Math.round(u)));
  ok(oddU.length === 0 || Math.max(...fracOf(evenU)) < 0.3,
    '偶數排落在格線上');
  ok(oddU.length === 0 || Math.min(...fracOf(oddU)) > 0.2,
    `**相鄰排錯縫**(ROW_SKEW=${M.ROCKFIELD.ROW_SKEW}）`);
  // 緊密:相鄰格點距離就是 pitch 量級(不是舊制的 +70m 孤立)
  ok(M.ROCKFIELD.PACK > 1 && M.ROCKFIELD.PACK < 1.6, `緊密度 PACK ∈ (1, 1.6)(${M.ROCKFIELD.PACK}）`);
  ok(M.ROCKFIELD.GAP_M >= 0, `同片露頭的碰撞柱淨距 ≥ 0(${M.ROCKFIELD.GAP_M}m;緊密的界線是不互穿)`);
  // 確定性
  ok(JSON.stringify(M.planRockField({ cx: 0, cz: 0, strike, pitch, seed: 12345 })) === JSON.stringify(cells),
    '確定性:同輸入逐位元同輸出');
  ok(JSON.stringify(M.planRockField({ cx: 0, cz: 0, strike, pitch, seed: 999 })) !== JSON.stringify(cells),
    '不同種子 ⇒ 不同抖動(同一張圖恆定、不同場地不同貌)');
  // 平移/旋轉不變:換中心只是整片搬過去
  const moved = M.planRockField({ cx: 500, cz: -200, strike, pitch, seed: 12345 });
  ok(moved.every((c, i) => near(c.x - cells[i].x, 500, 1e-6) && near(c.z - cells[i].z, -200, 1e-6)),
    '換中心 = 整片平移(格局不變)');
}

// ============ Ⅴ 消費端單一縫(biomes.js 接線)============
console.log('\nⅤ 消費端單一縫(biomes.js)');
{
  const bcode = strip(bio);
  const count = (re) => (bcode.match(re) || []).length;
  ok(count(/\bplanBlocks\s*\(/g) === 1, 'planBlocks 恰一個呼叫點');
  ok(count(/\bplanShyGrove\s*\(/g) === 1, 'planShyGrove 恰一個呼叫點');
  ok(count(/\bplanRockField\s*\(/g) === 1, 'planRockField 恰一個呼叫點');
  ok(count(/\bcivicColliders\s*\(/g) === 1, 'civicColliders 恰一個呼叫點(碰撞柱只有一條登記路徑)');
  ok(count(/\bstrikeRad\s*\(/g) === 1, 'strikeRad 恰一個呼叫點');
  // 朝向公式單一縫:biomes 不得自己再拼一次 atan2(nx, nz)
  ok(count(/\broadFaceRy\s*\(/g) === 1, 'nearestRoadAngle 吃 roadFaceRy(朝向公式單一縫)');
  ok(!/atan2\(nx, nz\)/.test(bcode), '舊的手寫朝向式已退場');
  // 街道線段與占位/朝向同一次迴圈(另開一趟就是第二份街道清單)
  ok(count(/const frontSegs = \[\]/g) === 1 && count(/frontSegs\.push\(/g) === 1,
    '街道線段只收一次(與占位/朝向同一次迴圈)');
  // 零共享 rnd:整段街廓配置不得出現 rnd(
  // 區塊界標自 2026-08-04 起自「聚落場」起算 —— 市區閘與補間種子跟街廓配置是同一段接線
  // (兩個放大器共用同一支 `settlement`),切在中間就會有一半的閘門沒被任何稽核執行到。
  const i2 = bio.indexOf('  // ---- 聚落場(單一縫)');
  const i3 = bio.indexOf('  // 市區補間:把被 8 倍世界撐開的街廓填回連續街區');
  ok(i2 > 0 && i3 > i2, '找得到街廓配置區塊界標');
  const blockSrc = strip(bio.slice(i2, i3));
  ok(!/\brnd\s*\(/.test(blockSrc), '**零共享 rnd 消耗**:街廓配置不推移植被/圖資建物的亂數序列(§2.3)');
  // 聚落場是單一縫:兩個放大器(planBlocks 的 probe、densifyUrban 的種子)MUST 吃同一支,
  // 且 MUST NOT 在別處再數一次格子(第二份門檻的症狀是「公設劃得出來、補間卻不補」)。
  ok((blockSrc.match(/const settlement = /g) || []).length === 1, '聚落場 `settlement` 恰一份實作');
  ok(/const nearUrban = settlement/.test(blockSrc), '街廓配置的市區閘 = 聚落場(不另判一次)');
  ok(/settlement\(b\.x, b\.z\)/.test(blockSrc), '補間種子也過聚落場(舊制 densifyUrban 一道地貌閘都沒有)');
  // 局部標準化(2026-08-04 使用者定案「建立局部標準化判斷」):門檻 MUST 是**比例**,
  // MUST NOT 是手寫的棵數 —— 同一個數字在東京是空地、在峽谷是市鎮。
  ok(/URBAN_DENS_Q \* urbanPeak/.test(blockSrc),
    '閘門 = DENS_Q × 這張圖自己的密度尖峰(比例,不是手寫棵數)');
  ok(/densSamples\[.*URBAN_DENS_P/s.test(blockSrc) && /\.sort\(/.test(blockSrc),
    '尖峰取**分位數**(不是最大值:單一密集格會綁架基準;也不是平均:空地會壓平)');
  ok(/urbanSeeds\.map\(\(b\) => localDens\(b\.x, b\.z\)\)/.test(blockSrc),
    '取樣點 = 每一棟既有建物自己的位置(全圖每一格會被空地的 0 把分位數拉到 0)');
  ok(/const URBAN_MIN_PEAK = INFILL\.cols\[0\] \* INFILL\.rows\[0\]/.test(blockSrc),
    '退化保險 URBAN_MIN_PEAK **推導不手寫**(= densifyUrban 畫得出來的最小一塊街廓)');
  ok(!/URBAN_SEED_MIN/.test(bcode), '舊制的手寫棵數門檻 URBAN_SEED_MIN 已退場');
  ok(/Math\.max\(1, URBAN_DENS_Q \* urbanPeak\)/.test(blockSrc),
    '下限 1 ⇒ DENS_Q = 0 退化成舊制「附近有一棟就算」(反向驗證的錨)');
  // 種子 MUST 在街廓配置之前定案:排在後面 = planBlocks 配出來的臨街樓回頭當補間種子
  {
    // MUST 兩件事一起驗:①真的有這一行(找不到時 indexOf 回 −1,單比大小會**假綠**)
    // ②它排在 planBlocks 之前。
    const iSeed = blockSrc.indexOf('const infillSeeds = generic.slice(');
    ok(iSeed >= 0 && iSeed < blockSrc.indexOf('planBlocks({'),
      '補間種子排在 planBlocks **之前**定案(否則新配的街屋會回頭當種子,圖資越稀疏放大越兇)');
  }
  ok((strip(bio).match(/[^n] densifyUrban\(\{/g) || []).length === 1
    && /densifyUrban\(\{ seeds: infillSeeds/.test(strip(bio)),
    'densifyUrban 恰一個呼叫點且吃呼叫端給的 seeds(MUST NOT 自己去 generic 撈)');
  {
    const d0 = bio.indexOf('function densifyUrban');
    const dSrc = strip(bio.slice(d0, bio.indexOf('\n}', d0)));
    ok(!/generic\.slice\(/.test(dSrc) && !/INFILL\.maxSeeds/.test(dSrc),
      '舊制「densifyUrban 就地 generic.slice(0, maxSeeds)」已退場');
  }
  // 地貌閘 MUST 只問圖資,不得讀場地宣告的 mix(使用者問的正是「有沒有從圖資判斷地貌」)
  ok(!/\bmix\b/.test(blockSrc), '聚落場/街廓配置不讀 venue.mix(地貌一律由圖資判,宣告不參與)');
  // 四道閘 + 平坦度
  for (const [re, m] of [[/areaFree\(/, '走廊淨空 areaFree'], [/occ\.free\(/, '建物占位 occ.free'],
    [/terrainEnvCode\(/, '水域/沼澤 terrainEnvCode'], [/flatRadiusAt\(/, '公設平坦度 flatRadiusAt'],
    [/nearUrban\(/, '市區閘 nearUrban']]) {
    ok(re.test(blockSrc), `probe 收得住:${m}`);
  }
  // 巨岩朝向:改吃 cell.ry(舊制每顆各轉各的已退場)
  const i4 = bio.indexOf('function placeMegaliths');
  const i5 = bio.indexOf('/** OSM tags → 建物類型 */');
  const megaSrc = strip(bio.slice(i4, i5));
  ok(/g\.rotation\.y = cell\.ry;/.test(megaSrc), '巨岩長軸吃 cell.ry(走向對齊)');
  ok(!/g\.rotation\.y = rnd\(\)/.test(megaSrc), '舊制「每顆各轉各的」已退場');
  ok(/ROCKFIELD\.GAP_M/.test(megaSrc), '同片露頭的緊密判定吃 ROCKFIELD.GAP_M(不再是手寫的 +70)');
  ok(/ROCKFIELD\.FIELDS/.test(megaSrc) && /ROCKFIELD\.SEP/.test(megaSrc), '露頭群數與間距吃常數表');
  // 主堡退避(2026-08-05 使用者定案「直接把名岩排除在主堡周圍一整個岩體直徑之外」)
  ok(/basesW\?\.some\(/.test(megaSrc) && /BASE_CLEAR_R \+ r \* 2/.test(megaSrc),
    '名岩退避主堡:中心距 ≥ 淨空圈 + 一整個岩體直徑');
  ok(!/\bBASE_CLEAR_R \+ \d+(\.\d+)?\s*\)/.test(megaSrc),
    '退避距的尺是岩體自己的外廓,MUST NOT 退回定值(名岩體格差到四倍)');
  ok((strip(bio).match(/const BASE_CLEAR_R\s*=/g) || []).length === 1
    && (strip(bio).match(/\bBASE_CLEAR_R\b/g) || []).length >= 3,
    '主堡淨空半徑只有一份定義,buildClearance 與 placeMegaliths 同吃(手寫兩個 70 會悄悄分家)');
  ok(!/blockPoint\(x, z, 70\)/.test(strip(bio)), 'buildClearance 的主堡那圈已改吃 BASE_CLEAR_R');
  ok((strip(bio).match(/llToWorld\(cfg\.bases\[side\]\[0\]/g) || []).length === 2,
    '主堡世界座標恰兩處(buildClearance 一份 + buildBiomes 的 basesW 一份,地標與名岩共用後者)');
  // 退避距真的把名岩推出去:以現役 MEGALITHS 的體格反算最小中心距
  {
    const megaBlk = strip(bio.slice(bio.indexOf('const MEGALITHS = {'), bio.indexOf('function synthMegalith')));
    const cols = [...megaBlk.matchAll(/col:\s*\{\s*r:\s*(\d+(?:\.\d+)?)/g)].map((m) => +m[1]);
    const ss = [...megaBlk.matchAll(/s:\s*\[(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\]/g)].map((m) => +m[2]);
    ok(cols.length >= 4 && cols.length === ss.length, `名岩體格表解析到 ${cols.length} 型`);
    const rMax = Math.max(...cols.map((c, i) => c * ss[i]));
    // 舊制:岩壁邊緣可逼近到離主堡中心 BASE_CLEAR_R + 6;新制邊緣至少再退一個岩體半徑
    ok(70 + rMax * 2 - rMax > (70 + 6) * 2,
      `最大名岩(r=${rMax.toFixed(0)}m)的岩壁邊緣退到 ≥${(70 + rMax).toFixed(0)}m(舊制 76m)`);
  }
  // 冠幅推導不手寫
  ok(/function giantCrownR\(/.test(bio), '冠幅由 giantCrownR 推導');
  ok(!/\bcr:\s*\d+(\.\d+)?\s*[,}]/.test(strip(bio.slice(bio.indexOf('const GIANT_DEFS'), bio.indexOf('const GIANT_DECO')))),
    'GIANT_DEFS 沒有手寫的冠幅欄(推導值 MUST NOT 手寫)');
  ok(/parameters/.test(strip(bio.slice(bio.indexOf('function giantCrownR'), bio.indexOf('function placeGiantGroves')))),
    'giantCrownR 由零件表的幾何參數推導(不是抄一組常數)');
  // AI 零件庫消費端縫(2026-08-05;docs/ai3d_runbook.md §0.2 不變式 7):
  // 解析只有 build 時的 partGeo 一份(模組載入期 VEG_DEFS 建表早於 GLB 抓取,表內解析恆
  // miss);佈局數學(冠幅/擺動分母)MUST 只讀保險絲 `p.g` —— 庫幾何隨載入成敗而異,
  // 佈局讀它 = 跨客戶端逐位元分家(§2.3),intake 契約(GLB 外廓 ≤ fallback)讓保險絲恆保守。
  {
    const bioC = strip(bio);
    ok((bioC.match(/libGeo\(/g) || []).length === 3
      && /const partGeo = \(p\) => \(p\.lib && libGeo\(p\.lib\)\) \|\| p\.g;/.test(bioC)
      && /const megaGeo = \(name\) => \{ const g2 = name \? libGeo\(name\) : null; return g2 \? g2\.clone\(\) : null; \};/.test(bioC)
      && /const bldGeo = \(key, i = 0\) => \{/.test(bioC) && /BLD_LIB\[key\]/.test(bioC),
      'AI 零件庫解析恰三份:partGeo(宣告式零件表)+ megaGeo(命令式巨岩呼叫點守衛;'
      + '一律 clone —— 巨岩群組會過 bakeContactAO 就地烤頂點色,共用庫幾何被烤一次全場帶著別顆岩的 AO)'
      + '+ bldGeo(建物屋頂配件桶守衛;不 clone —— 配件桶不過 bakeContactAO,幾何唯讀共用)');
    {   // bldGeo 只住 buildBldBucket 桶建構表(凍結四桶:煙囪/水塔/空調機組/**整棟量體**),
        // 逐桶恆以 `|| 原 primitive` 收尾(保險絲,原則 6;載入失敗 = 舊畫面);遊戲內消費點
        // 恰 4 處(屋頂配件三桶 + 一般建物繪製段的整棟量體桶)+ 一處**探詢**(繪製段開頭
        // 一次問完名冊裡哪幾顆真的載到 —— 放進逐棟迴圈就是同一個名字每棟查一遍)。
        // 增刪桶 MUST 同步這裡與 tri_budget families.building(名冊桶數是 deco 那三桶的除數;
        // mass 刻意不進那個除數,理由見 tri_budget 的 mass.justification)。
      const uses = (bioC.match(/bldGeo\('(?:chimney|tank|acbox)'\) \|\| new THREE\.(?:Box|Cylinder)Geometry\(/g) || []).length
        // 整棟量體那一桶的保險絲自 2026-08-12 起是**剖面疊出來的**(與碰撞柱同源),
        // 連剖面都沒宣告才退回單位方盒 —— 那是保險絲的保險絲
        + (bioC.match(/bldGeo\(key, i\) \|\| \(prof \? profGeo\(prof, MASS\.UVB\[key\] \|\| MASS\.UVB\.mass\) : new THREE\.BoxGeometry\(1, 1, 1\)\)/g) || []).length;
      const calls = (bioC.match(/buildBldBucket\.(?:chimney|tank|acbox|mass)\(/g) || []).length;
      ok(uses === 4 && (bioC.match(/bldGeo\(/g) || []).length === 4 && calls === 4,
        `bldGeo 只在 buildBldBucket 四桶且逐桶帶保險絲、遊戲內消費點恰 4 處(實得 ${uses}/${calls})`);
      // 兩個整棟量體桶只差**名冊與挑選規則**,幾何/材質/保險絲同一份實作 ⇒ 桶建構表
      // MUST NOT 長出第二支;`buildBldBucket.masslow` 一出現就是「兩桶的保險絲不一樣」。
      ok(/mass: \(n, mat, i = 0, key = 'mass'\) =>/.test(bioC) && !/masslow: \(n/.test(bioC),
        '整棟量體桶建構器只有一份實作(key 參數選名冊),MUST NOT 為低矮桶另開一支');
    }
    {   // 整棟量體(佇列 F,2026-08-08):**只換子集**是 tri_budget 推導出來的,不是偏好 ——
        // 整桶換的逐節點上限只有 36 tris。三條契約逐一釘住。
      const budget = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.mass;
      // 反向驗證:把這一段退回舊制(pick_n 與預算分家 / 拿掉保險絲閘 / 色抖吃新索引)
      const bioM = BREAK_MASS2
        ? bioC.replace('PICK_N_LOW: 8,', 'PICK_N_LOW: 16,')
          .replace('generic.filter((b) => !b.commercial && b.h <= MASS.MIN_H)', 'generic.filter((b) => true)')
        : BREAK_MASS
        ? bioC.replace('PICK_N: 8,', 'PICK_N: 24,')
          .replace('q.h - p.h || p.x - q.x || p.z - q.z', 'q.h - p.h')
          .replace('((t.ord * 2654435761)', '((i * 2654435761)')
        : bioC;
      // 錨到 `const MASS = {`:`FACADE_PX` 也有一個 `MIN_H`(貼圖高度下限),
      // 不錨就會抓到它 —— 而那條斷言的訊息會說「門檻 256/55」,看起來像是門檻被改壞了
      const M = bioM.slice(bioM.indexOf('const MASS = {')).match(/MIN_H:\s*(\d+),[\s\S]*?PICK_N:\s*(\d+),[\s\S]*?PICK_N_LOW:\s*(\d+),/);
      ok(!!M && +M[1] === budget.min_h && +M[2] === budget.pick_n_high && +M[3] === budget.pick_n_low,
        `MASS 的挑選門檻與 tri_budget 同一份(min_h ${M?.[1]}/${budget.min_h}、`
        + `pick_n 高 ${M?.[2]}/${budget.pick_n_high}、低 ${M?.[3]}/${budget.pick_n_low})`);
      // **兩個桶吃同一個 facade_wall 桶 ⇒ 額度是同一份**:高低兩份挑選數加起來才是那個
      // draw call 上界,而 node_cap 的除數正是它。加總對不上 = 額度憑空多出來一份,
      // 而畫面上只表現成「這張圖的高樓好像特別多」(§5al-b;使用者 2026-08-09 選 (a) 8/8)。
      ok(budget.pick_n_high + budget.pick_n_low === budget.pick_n && !!M
        && +M[2] + +M[3] === budget.pick_n,
        `兩桶的挑選數加起來 = 總額度(${budget.pick_n_high} + ${budget.pick_n_low} = ${budget.pick_n})`);
      // 低矮桶的 node_cap 是**同一份推導**,tri_budget 只是為了 `nodeCap(fam, kind)` 的
      // 名冊鍵查表多存一格 ⇒ 分家寫不出來。
      const budLow = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.masslow;
      ok(!!budLow && budLow.node_cap === budget.node_cap && budLow.same_as === 'mass',
        `低矮桶的逐節點上限與高層同一份(${budLow?.node_cap}/${budget.node_cap})`);
      ok(budget.node_cap === Math.floor((budget.whole_factor - 1) * budget.measured_mass_total_max / budget.pick_n),
        `整棟節點上限是推導值(3 × ${budget.measured_mass_total_max} ÷ ${budget.pick_n} = ${budget.node_cap})`);
      ok(budget.full_swap_cap < 50 && budget.full_swap_cap
        === Math.floor((budget.whole_factor - 1) * budget.measured_mass_total_max / budget.measured_mass_instances_max),
        `「整桶換」被量測否決的那個數也是推導值(${budget.full_swap_cap} tris ≪ §5o 的 500 面下限)`);
      // ①挑選是純函式:零 rnd、只讀權威佈局資料與**名冊裡的剖面**(純資料),不讀庫幾何
      //   (§2.3 / A4)。2026-08-12 起額度是「挑到 n 棟為止」而不是 `.slice(0, n)` ——
      //   拉伸過頭的那一棟會被跳過(退回方盒),額度留給下一棟。
      const pickBlk = bioM.slice(bioM.indexOf('const massPick = new Map();'), bioM.indexOf('for (const commercial of'));
      ok(pickBlk.length > 80 && !/rnd\(/.test(pickBlk)
        && /if \(taken >= n\) break;/.test(pickBlk) && /MASS\.PICK_N\)/.test(pickBlk) && /MASS\.PICK_N_LOW\)/.test(pickBlk)
        && /q\.h - p\.h \|\| p\.x - q\.x \|\| p\.z - q\.z/.test(pickBlk)
        && /q\.w \* q\.d - p\.w \* p\.d \|\| p\.x - q\.x \|\| p\.z - q\.z/.test(pickBlk),
        '整棟量體的挑選:零 rnd 消耗、兩桶各由自己的 pick_n 夾住、'
        + '高層排最高/低矮排足跡面積、同值時以座標定序(跨客戶端逐位元同一組)');
      // ①-b **挑選與「庫載到了沒」解耦**(2026-08-12;碰撞柱改吃剖面之後這一條是致命的):
      //     舊制的閘是 `if (ok.length)`,而它會讓「載到庫的客戶端登記剖面柱、沒載到的登記
      //     方盒柱」⇒ 權威幾何跨客戶端分家(A30 + §2.3),畫面上只表現成「你說你打中了,
      //     我這邊沒掉血」。挑選 MUST 只讀純資料;載入成敗只決定畫出來的是網格還是保險絲。
      ok(!/bldGeo\(/.test(pickBlk) && !/libOk/.test(pickBlk) && /bldProfile\(key, k\)/.test(pickBlk),
        '挑選只讀名冊純資料(bldProfile),不問庫載到了沒 —— 否則碰撞柱跨客戶端分家');
      // ①-c **尺寸貼合**(使用者這一輪第 ①):實例縮放由剖面實測外廓推導(把網格撐滿基地),
      //     拉伸倍率超過 `ASPECT_MAX` 就不換這一棟。舊制直接拿 (w,h,d) 縮單位方盒,而節點
      //     只佔單位盒的 0.13~0.42 ⇒ 那幾棟塔樓縮在自己的空地中央、外面一圈看不見的碰撞盒。
      const bioF = BREAK_FILL
        ? bioC.replace('        sx: (f.rot ? b.d : b.w) * 0.5 / p.hw,', '        sx: (f.rot ? b.d : b.w),')
          .replace('      if (!best || Math.exp(best.dist) > MASS.ASPECT_MAX) return null;', '      if (!best) return null;')
        : bioC;
      const fitBlk = bioF.slice(bioF.indexOf('const fitNode = (key, b) =>'), bioF.indexOf('for (const commercial of'));
      ok(/sx: \(f\.rot \? b\.d : b\.w\) \* 0\.5 \/ p\.hw,/.test(fitBlk)
        && /sy: b\.h \* 0\.5 \/ p\.hy,/.test(fitBlk)
        && /sz: \(f\.rot \? b\.w : b\.d\) \* 0\.5 \/ p\.hd,/.test(fitBlk)
        && /Math\.exp\(best\.dist\) > MASS\.ASPECT_MAX\) return null;/.test(fitBlk),
        '實例縮放由剖面外廓推導(網格撐滿基地)且拉伸夾在 ASPECT_MAX 內(超過就不換這一棟)');
      // ②-a 兩桶**互斥**且共用同一個門檻:高層 = commercial && h > MIN_H、低矮 = h <= MIN_H。
      //     低矮那一邊漏掉門檻 ⇒ 同一棟樓可能被兩個名冊各挑一次(後挑的覆寫前一個),
      //     而預算是照「總共挑幾棟」算的 ⇒ 帳與畫面同時錯,兩邊都不報錯。
      ok(/b\.commercial && b\.h > MASS\.MIN_H/.test(pickBlk) && /!b\.commercial && b\.h <= MASS\.MIN_H/.test(pickBlk),
        '兩桶資格取自同兩個既有判準的對角線兩格(高層 commercial && h > MIN_H / '
        + '低矮 !commercial && h <= MIN_H,互斥;另兩格刻意維持方盒)');
      // ②-b 名冊沒宣告剖面 ⇒ `bldProfile` 回 null ⇒ `fitNode` 挑不到 ⇒ 那一桶一棟都不換
      //     ⇒ 逐位元同舊制(保險絲;**逐桶各自成立**)
      ok(/const f = fitNode\(key, b\);\s*\r?\n\s*if \(!f\) continue;/.test(bioM)
        && /if \(!best \|\| Math\.exp\(best\.dist\) > MASS\.ASPECT_MAX\) return null;/.test(bioM),
        '名冊剖面缺席或拉伸過頭 ⇒ 該棟不換 ⇒ 主量體落回單位方盒(逐位元同舊制;逐桶各自成立)');
      // ③色抖的雜湊吃原始序:拆桶後拿新索引去雜湊會讓其餘每一棟的配色跟著平移
      const emitBlk = bioM.slice(bioM.indexOf('const emitMass = (rows, mesh) =>'), bioM.indexOf('const boxRows = new Map()'));
      ok(/inst\.forEach\(\(t, i\) => \{ t\.ord = i; \}\);/.test(bioM)
        && /\(\(t\.ord \* 2654435761\)/.test(emitBlk) && /\(\(t\.ord \* 1597334677\)/.test(emitBlk)
        && !/\(\(i \* \d+\) >>> 0\) % 100/.test(emitBlk),
        '逐實例色抖吃 inst 的原始序 t.ord(拆桶不改其餘建物的配色)');
      // ④**碰撞剖面**(2026-08-12;使用者「物理碰撞應該要與建模的 3D 外表一致」)。
      //   舊制:挑中庫節點的那幾棟碰撞柱仍是整個足跡的單一方盒,而剖面體積只佔它的
      //   16%~38%(tri_budget profile_spec.measured_solid)⇒ 退縮塔上半段整圈是空氣卻擋彈、
      //   擋 LOS、爬得上去。改成**一段一根有向盒**:三端(客戶端 `_collide`/`_blockerHitT`、
      //   伺服器 occ)一行都不用改(A30 只認有向盒與圓柱)。
      {
        const bioP = BREAK_PROF
          ? bioC.replace('const cols = fit\n', 'const cols = false\n')
          : bioC;
        const blkSeg = bioP.slice(bioP.indexOf('const cols = fit'), bioP.indexOf('if (fit) bldFaces.set(b,'));
        ok(/fit\.prof\.slabs\.map\(\(s, si\) => \{/.test(blkSeg) && /hw2: bx\.hw2, hd2: bx\.hd2, ry: b\.ry, ty: bx\.y1/.test(blkSeg),
          '挑中庫節點的那幾棟:碰撞柱逐段登記(有向盒仍是 A30 那一種,只是一顆變一疊)');
        // 地面那一段 MUST 仍是整個足跡(剖面最寬的一段被 `fitScale` 撐到 OSM 足跡)⇒
        // 街廓通行寬逐位元同舊制(`audit_traverse` 不動);收窄的只有上面的退縮階與山牆
        ok(/const bot = si === 0 \? gy - 1 : bx\.y0;/.test(blkSeg),
          '最底那一段仍沉進地形 1m(地面層的通行寬與舊制逐位元相同)');
        // 每一段各帶自己的 ty ⇒ 退縮平台站得上去;h 一律比可見頂高 0.5m(同舊制那一條)
        ok(/h: bx\.y1 \+ 0\.5 - bot,/.test(blkSeg),
          '每一段的碰撞柱比自己的可見頂高 0.5m(站上退縮平台不被垂直閘推下去)');
        // 方盒那條路**逐位元不變**:沒挑中的仍是整顆 b.w/b.d/b.ry
        ok(/hw2: b\.w \/ 2, hd2: b\.d \/ 2, ry: b\.ry, ty: gy \+ b\.h - 0\.5 \}\]/.test(blkSeg),
          '沒挑中庫節點的仍是單顆有向盒 b.w/b.d/b.ry(逐位元同舊制)');
      }
      // ④-b **保險絲幾何直測**(執行 `profGeo` 原文,THREE 給樁)。這一支只有兩種壞法,
      //     而兩種在離線讀原文時都看不出來:①面的繞向反了 ⇒ 那一面背朝外,從外面看穿;
      //     ②UV 的三帶算錯 ⇒ 窗格印在屋頂帶或素牆帶上。兩者都要真的算一次才知道。
      {
        // `bioC` 已剝註解 ⇒ 錨點取程式碼本身(下一個 `export const`),MUST NOT 拿註解當界
        const seg = bioC.slice(bioC.indexOf('function profGeo('),
          bioC.indexOf('export const buildBldBucket'));
        const THREE = {
          BufferGeometry: class { constructor() { this.a = {}; } setAttribute(k, v) { this.a[k] = v; } setIndex(i) { this.idx = i; } computeBoundingSphere() {} },
          Float32BufferAttribute: class { constructor(arr) { this.array = arr; } },
        };
        const UVB = { mass: { roof: 0.128, plain: 0.275 }, masslow: { roof: 0.203, plain: 0.259 },
          MINZ: 0.30, WALL_NY: 0.15, FLAT_DEG: 6, FLAT_MIN: 0.005 };
        let g = null, err = null;
        // 名冊的第五欄(平整垂直牆佔比)對 `profGeo` 無語意 —— 它只讀前四欄。刻意帶著它跑,
        // 驗的是「多一欄不會把保險絲幾何算歪」(消費端 MUST 只解構前四欄)。
        const prof = { slabs: [[-0.475, -0.1187, 0.376, 0.4093, 0.5931], [-0.1187, 0.1187, 0.3026, 0.242, 0.5803],
          [0.1187, 0.4156, 0.303, 0.1914, 0.3589], [0.4156, 0.475, 0.1222, 0.0313, 0.0416]] };
        try {
          g = new Function('THREE', 'MASS', `${seg}\n return profGeo;`)(THREE, { UVB })(prof, UVB.mass);
        } catch (e) { err = e.message; }
        if (!g) ok(false, `profGeo 原文跑不起來:${err}`);
        else {
          const pos = g.a.position.array, nor = g.a.normal.array, uv = g.a.uv.array, idx = g.idx;
          let bad = 0; const band = { roof: [], plain: [], wall: [] };
          for (let i = 0; i < idx.length; i += 3) {
            const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
            const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
            const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const L = Math.hypot(nx, ny, nz) || 1;
            if ((nx / L) * nor[a] + (ny / L) * nor[a + 1] + (nz / L) * nor[a + 2] < 0.99) bad++;
            for (const V of [idx[i], idx[i + 1], idx[i + 2]]) {
              const n1 = nor[V * 3 + 1], v = uv[V * 2 + 1];
              band[n1 > UVB.MINZ ? 'roof' : Math.abs(n1) > UVB.WALL_NY ? 'plain' : 'wall'].push(v);
            }
          }
          ok(pos.length / 3 === prof.slabs.length * 24 && idx.length / 3 === prof.slabs.length * 12 && !bad,
            `保險絲幾何 = 剖面疊盒(${prof.slabs.length} 段 → ${idx.length / 3} 面),每一面都朝外(繞向錯 ${bad} 面)`);
          const lo = UVB.mass.roof, hi = lo + UVB.mass.plain;
          const inb = (a, x, y) => a.length && Math.min(...a) >= x - 1e-6 && Math.max(...a) <= y + 1e-6;
          ok(inb(band.roof, 0, lo) && inb(band.plain, lo, hi) && inb(band.wall, hi, 1),
            `保險絲的 UV 三帶與庫節點同一份規則(屋頂 ≤ ${lo}、素牆 ∈ [${lo}, ${hi.toFixed(3)}]、窗牆 ≥ ${hi.toFixed(3)})`);
        }
      }
      // ⑤屋頂上的純視覺附件改推丟棄桶(節點自帶頂部造型 ⇒ 程序頂塔/看板/天線會浮在半空),
      //   而**帶碰撞柱的兩件 MUST NOT 進丟棄桶** —— 少掛一根碰撞柱 = 載到庫的客戶端與
      //   沒載到的權威幾何分家。`vis()` 只換「推去哪裡」,rnd() 一枚都不能少(A4)。
      {
        const fSeg = bioM.slice(bioM.indexOf('const inst = [];'), bioM.indexOf('inst.forEach((t, i) => { t.ord = i; });'));
        const visN = (fSeg.match(/\bvis\([a-zA-Z]/g) || []).length;
        ok(/const vis = \(arr\) => \(fit \? sink : arr\);/.test(fSeg) && visN >= 15,
          `純視覺附件經 vis() 分流(實得 ${visN} 處;丟棄桶只換目的地,不動 rnd)`);
        ok(!/vis\(blockers\)/.test(fSeg) && (fSeg.match(/blockers\.push\(/g) || []).length === 2
          && /for \(const c of cols\) blockers\.push\(c\);/.test(fSeg),
          '碰撞柱兩個 push 出口(主量體逐段 + 臨街裙樓)MUST NOT 走丟棄桶(不隨庫的有無增減)');
        // 主量體那一列自己也不能被分流掉 —— 它就是要被庫節點取代的那一列
        ok(/\n\s+inst\.push\(\{\r?\n\s+x: b\.x, y: gy \+ b\.h \/ 2 - 0\.5, z: b\.z,/.test(fSeg),
          '主量體那一列直接進 inst(它才是被庫節點取代的那一列,不進丟棄桶)');
        // ⑤-b **牆面直式招牌不再整批丟掉**(2026-08-12 使用者「招牌會懸空」)——
        //     它當初被丟的理由是「掛在方盒側面而節點比方盒瘦 ⇒ 浮在半空」,而落點改吃剖面
        //     之後那個理由消失了。丟著不管等於「最顯眼的十幾棟樓一塊招牌都沒有」。
        ok(!/vis\(wallSigns\)/.test(fSeg) && /wallSigns\.push\(\{/.test(fSeg)
          && /const fw = bldFace\(fit, b, gy, sy\);/.test(fSeg),
          '牆面招牌落點吃剖面側面(不再整批丟掉,也不再掛在方盒側面的空氣裡)');
      }
      // ⑥**屋頂帶**(2026-08-09 §5ao):庫節點只有一個材質群組 ⇒ 方盒那條路的屋頂材質對它
      //   不生效(窗格印在斜屋頂上),而拆群組會多一個 draw call ⇒ 區分移進 UV。
      //   這裡驗的是「兩份數字沒有分家」與「只有斜頂那一桶吃得到」;**成品 GLB 的 UV 帶
      //   由 intake_parts 直接量**(那才是節點真的長什麼樣,指令打對了沒不算數)。
      {
        const bioR = BREAK_ROOF
          // ⚠ 壞版的替換 MUST **不綁現值** —— 綁死數字的話重量帶寬之後這一行就是靜默
          //   no-op(2026-08-14 實測:帶寬 0.203 → 0.193 之後 `--break-roof` 由紅 2 條
          //   變成紅 1 條,而「壞版」其實根本沒被造出來)。CLAUDE.md §5.4 ㋑ 的同一條。
          ? bioC.replace(/(    masslow: \{ roof: )([\d.]+)(, plain: )/,
            (m, a, v, b) => `${a}${(+v + 0.007).toFixed(3)}${b}`)
            .replace('pd.style, pd.wall,\n              pd.roof, pd.rf, MASS.UVB.masslow, pd.win)', 'pd.style, pd.wall)')
          : bioC;
        const budHi = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.mass;
        const R = bioR.match(/UVB: \{\s*\r?\n\s*mass: \{ roof: ([\d.]+), plain: ([\d.]+) \},\s*\r?\n\s*masslow: \{ roof: ([\d.]+), plain: ([\d.]+) \},\s*\r?\n\s*MINZ: ([\d.]+),\s*\r?\n\s*WALL_NY: ([\d.]+),/);
        ok(!!R && +R[1] === budHi.roof_band && +R[2] === budHi.plain_band
          && +R[3] === budLow.roof_band && +R[4] === budLow.plain_band
          && +R[5] === budLow.roof_minz && +R[6] === budLow.wall_ny,
          `三帶的六個數字與 tri_budget 同一份(高層 ${R?.[1]}/${R?.[2]}、低矮 ${R?.[3]}/${R?.[4]}、`
          + `門檻 ${R?.[5]}/${R?.[6]};節點那一側是 --uvbands 烤進 UV 的同一組)`);
        // 兩個庫節點桶都 MUST 傳帶(2026-08-12:高層那一桶原本刻意不傳,而那正是「窗格印在
        // 退縮頂的斜切面與尖塔上」的成因);方盒那條(FACADES 16 款)MUST NOT 傳
        // ⇒ `band = pband = 0` ⇒ `WW === H` ⇒ 既有 16 款與六支地標**逐位元不變**
        ok(/pd\.roof, pd\.rf, MASS\.UVB\.masslow, pd\.win\)/.test(bioR)
          && /band \? fd\.roof : 0, band \? 'flat' : '', band \? MASS\.UVB\.mass : null, fd\.win\)/.test(bioR)
          && /wallOf\(rowsOf\(t\), true\)/.test(bioR) && /const wall = wallOf\(rw\);/.test(bioR),
          '兩個庫節點桶都吃三帶,方盒那條不吃(⇒ 16 款與地標逐位元不變)');
        // 牆的繪製一律吃 `WW`(= H − 屋頂帶 − 素牆帶):殘留一個 `H` 就是基座暗帶/遮陽棚
        // 被帶蓋掉;而 `wallLayer` 吃 `WH`(素牆帶就是「這棟樓的牆,只是沒有窗」)
        const fx = bioR.slice(bioR.indexOf('function facadeTex('), bioR.indexOf('// 一般建物外牆色盤'));
        ok(!/\bH - \d/.test(fx) && (fx.match(/\bWW\b/g) || []).length >= 6
          && /const band = roofC \? Math\.round\(H \* \(bands \? bands\.roof : 0\)\) : 0;/.test(fx)
          && /const pband = roofC && bands \? Math\.round\(H \* bands\.plain\) : 0;/.test(fx)
          && /wallLayer\(cx, W, WH, wall, rnd\);/.test(fx),
          '窗的繪製全部吃 WW(H − 兩帶)、牆材質吃 WH;沒有屋頂色 ⇒ 兩帶皆 0 ⇒ WW === H');
        // 屋頂圖樣一份實作一個呼叫點,且畫在畫布**底部**那一條(v=0 那一側)
        ok((bioR.match(/function roofLayer\(/g) || []).length === 1
          && (bioR.match(/\broofLayer\(/g) || []).length === 2
          && /if \(band\) roofLayer\(cx, W, WH, band,/.test(fx),
          '屋頂圖樣只有 roofLayer 一份實作、一個呼叫點,畫在畫布底部那一條(= UV 的 v ∈ [0, roof))');
        // 六款的「牆 × 屋頂形式」MUST 兩兩不同 —— 使用者要的「不同類型/風格/屋頂形式都要
        // 不同」在這張表上就是這件事;少了它,新增一款只要複製貼上就會多一款一模一樣的
        const pit = [...bioR.matchAll(/\{ key: 'pit\d'[^}]*wall: '(\w+)',\s*roof: 0x[0-9a-f]+, rf: '(\w+)'/g)]
          .map((m) => `${m[1]}/${m[2]}`);
        ok(pit.length === 6 && new Set(pit).size === 6,
          `斜頂六款的「牆 × 屋頂形式」兩兩不同(${pit.join('、')})`);
      }
      // ⑥-c **平整那一條**(2026-08-13 使用者「建築外部不平整的多塊法線角小的平面牆合併平整」
      //      +「密集窗戶圖層與外掛招牌只貼在垂直地面且完全平整的平面牆」)。
      //      三個消費端的門檻 MUST 與量測檔同一份;成品 GLB 那一半由 intake_parts 直接量。
      {
        const bioF = BREAK_FLAT
          // 壞版 = 上一輪:窗牆帶只看傾角、招牌不篩平整段
          ? bioC.replace(/const okBox = bldFaceList\(f, b, gy\);\n\s+if \(!okBox\.length\) return null;/,
            'const okBox = f.prof.slabs.map((s) => slabBox(f, b, s, gy));')
            .replace('    FLAT_DEG: 6,\n', '')
            .replace(/(\[-?[\d.]+, -?[\d.]+, [\d.]+, [\d.]+), [\d.]+\]/g, '$1]')
          : bioC;
        const ps = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.planar_spec;
        const pspec = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.profile_spec;
        const FD = bioF.match(/FLAT_DEG: ([\d.]+),\s*\r?\n\s*FLAT_MIN: ([\d.]+),/);
        ok(!!FD && +FD[1] === ps.flat_deg && +FD[2] === ps.min_f && ps.flat_deg < ps.deg,
          `平整門檻與 tri_budget 的 planar_spec 同一份(FLAT_DEG ${FD?.[1]} / FLAT_MIN ${FD?.[2]};`
          + `MUST ≪ 分群容差 ${ps.deg}° —— 同一個數字這道閘就退化成「有分到群就算平」)`);
        const SF = bioF.match(/SIGN_FLAT_MIN: ([\d.]+),/);
        ok(!!SF && +SF[1] === pspec.sign_flat_min,
          `招牌落點的平整門檻與量測檔同一份(SIGN_FLAT_MIN ${SF?.[1]} = profile_spec.sign_flat_min)`);
        // 名冊逐段 MUST 帶第五欄 —— 缺席時消費端一律放行 ⇒ 牌子照樣掛在尖塔前面的空氣裡
        // 取值範圍 MUST 收在 BLD_LIB 這一塊:biomes.js 別處也有四個數字的陣列字面量
        const libBlk = bioF.slice(bioF.indexOf('const BLD_LIB = {'), bioF.indexOf('const bldGeo = '));
        const rows = [...libBlk.matchAll(/\[(-?[\d.]+), (-?[\d.]+), ([\d.]+), ([\d.]+)(, ([\d.]+))?\]/g)];
        const five = rows.filter((m) => m[5] !== undefined).length;
        ok(rows.length >= 20 && five === rows.length,
          `BLD_LIB 剖面逐段都帶第五欄(平整垂直牆佔比;${five}/${rows.length} 段)`);
        // 篩選只有一份(兩個招牌消費端同吃);挑不到就回 null = 這一棟不掛牌,
        // **MUST NOT** 退回方盒側面 —— 那正是「招牌懸空」那個成因本體
        ok(/const bldFaceList = \(f, b, gy\) =>\s*\r?\n\s*f\.prof\.slabs\.map\(\(s\) => slabBox\(f, b, s, gy\)\)\.filter\(\(k\) => k\.wall >= MASS\.SIGN_FLAT_MIN\);/.test(bioF)
          && /const okBox = bldFaceList\(f, b, gy\);/.test(bioF)
          && /if \(!okBox\.length\) return null;/.test(bioF)
          && /if \(fit\) bldFaces\.set\(b, bldFaceList\(fit, b, gy\)\);/.test(bioF),
          '「掛得了牌的那幾段」只有 bldFaceList 一份篩選,兩個招牌消費端同吃;一段都不合格 ⇒ 回 null');
        ok(/if \(!resolveName\(b\.tags\) && !\(fit && !fw\)\) \{/.test(bioF)
          && /if \(!faces\.length\) continue;/.test(bioF),
          '兩個招牌消費端都會在「挑不到平整段」時放棄這一棟(MUST NOT 退回 b.w/2、b.d/2)');
        // ⑥-c2 **窗格輪廓**(使用者「窗戶圖層輪廓都太模糊」):畫進去就要是硬邊。
        const fxF = bioF.slice(bioF.indexOf('function facadeTex('), bioF.indexOf('// 一般建物外牆色盤'));
        ok(/const snap = \(x, y, w, h\) => \{/.test(fxF) && /Math\.max\(1, R\(x \+ w\) - x0\)/.test(fxF)
          && /const pane = \(x, y, w, h\) => \{/.test(fxF) && /cx\.fillStyle = WIN_INK;/.test(fxF),
          '窗格邊界對齊整數 texel + 補一道窗框(Canvas2D 對非整數 fillRect 會反鋸齒 ⇒ NearestFilter 把那條漸層原封不動放大)');
        ok(/t\.anisotropy = FACADE_PX\.ANISO;/.test(fxF) && /t\.magFilter = THREE\.NearestFilter;/.test(fxF),
          '立面貼圖同時設 NearestFilter(放大)與 anisotropy(縮小;立面幾乎永遠是掠射角)');
        // 自發光層 MUST 吃 `pane` 回傳的**同一組**座標:兩層各自 round 會差半個 texel
        ok(!/ex\.fillRect\(x, y, w, h\)/.test(fxF)
          && (fxF.match(/ex\.fillRect\(px, py, pw, ph\)/g) || []).length >= 2,
          '夜間自發光吃窗格 snap 後的同一組座標(各自 round 會讓亮的那一塊與窗錯開一條邊)');
      }
      // ⑥-d **窗格貼齊面板**(2026-08-13 使用者「平面區域太小的話不渲染窗戶,窗戶會被裁切掉
      //      的時候也不渲染」)。規則本體在 `wallpanel.js`(零 import、離線工具吃同一支);
      //      這裡驗接線與三條不變式,**行為**由下面的直測跑真的一次。
      {
        const wpSrc = readSrc('public', 'js', 'wallpanel.js');
        ok(!/^\s*import\s/m.test(wpSrc),
          'wallpanel.js 零 import(離線工具與遊戲端吃同一份面板定義;抄第二份 = 兩邊切出不同的牆)');
        const ps = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.planar_spec;
        const PN = bioC.match(/PANEL: \{ DEG: ([\d.]+), OFF_F: ([\d.]+), WALL_NY: ([\d.]+), FLAT_DEG: ([\d.]+), MIN_F: ([\d.]+) \}/);
        ok(!!PN && +PN[1] === ps.deg && +PN[2] === ps.off_f && +PN[3] === ps.wall_ny
          && +PN[4] === ps.flat_deg && +PN[5] === ps.min_f,
          `面板門檻與 tri_budget 的 planar_spec 同一份(${PN?.slice(1, 6).join(' / ')})`);
        // 幾何/材質/instance 分組 MUST 不動 —— 只換 uv;沒有跨面板共用頂點要拆的話,
        // 連 position/normal/index 都沿用**同一份** BufferAttribute(不是 clone)
        ok(/im\.geometry = alignedGeo\(im\.geometry, g\.key, g\.grid\);/.test(bioC)
          && /g2\.setAttribute\('position', c\.split \? new THREE\.Float32BufferAttribute\(c\.pos, 3\) : geo\.attributes\.position\);/.test(bioC)
          && /g2\.setIndex\(c\.split \? new THREE\.BufferAttribute\(c\.idx, 1\) : geo\.index\);/.test(bioC)
          && !/geo\.clone\(\)/.test(bioC),
          '對齊只換 uv(沒有頂點要拆就連 position/normal/index 都沿用同一份 ⇒ draw call、三角形、分組逐位元不動)');
        // 斜牆的面板可以比投影軸還寬 ⇒ u 有機會 > 1,立面貼圖因此 MUST 橫向環繞;
        // **縱向 MUST 維持 clamp** —— v 是三條帶,捲起來就是屋頂帶接在窗牆帶上面
        const fxW = bioC.slice(bioC.indexOf('function facadeTex('), bioC.indexOf('const PALETTE = {'));
        ok(/t\.wrapS = THREE\.RepeatWrapping;/.test(fxW) && !/wrapT/.test(fxW),
          '立面貼圖橫向環繞、縱向維持 clamp(v 是三條帶,捲起來就是屋頂帶接在窗牆帶上面)');
        // **行為直測**:真的切一次面板、算一次格數(離線讀原文看不出「格數會不會 round 成 0」)
        {
          const W = WALLPANEL;
          // 帶寬取量測檔那一份(寫死在這裡就是第四份同值常數,而重烤節點時它會靜默過期)
          const mb = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.mass;
          const RB = mb.roof_band, PB = mb.plain_band;
          const nodes = parseGlb('public/assets/models/parts/building.glb');
          let panelN = 0, wholeOK = true, tooSmall = 0, spanOK = true, splitN = 0, vLo = 1, vHi = 0;
          for (const [nm, nd] of nodes) {
            if (!nm.startsWith('mass')) continue;
            const r0 = W.wallPanels(nd.pos, nd.idx, W.PANEL);
            const sp = W.splitByPanel({ pos: nd.pos, uv: new Float32Array(nd.pos.length / 3 * 2) }, nd.idx, r0.faceOf);
            const r = { ...r0, ...sp };
            splitN += sp.split;
            const hx = Math.max(r.hi[0] - r.lo[0], r.hi[2] - r.lo[2]) / 2, hy = (r.hi[1] - r.lo[1]) / 2;
            panelN += r.panels.length;
            for (const [cols, rows] of [[3, 1], [5, 9], [7, 26], [10, 41]]) {
              const cells = W.panelCells(r.panels, { cols, rows, hx, hy });
              tooSmall += cells.filter((c) => !c).length;
              // 格數 MUST 是整數且 ≥1 —— 這一條就是「不畫半扇窗」的**構造保證**
              wholeOK = wholeOK && cells.every((c) => !c || (Number.isInteger(c.k) && Number.isInteger(c.m) && c.k >= 1 && c.m >= 1));
              const uv = W.panelGridUV(r.pos, r.idx, r.uv, r.panels, r.faceOf,
                { cols, rows, roof: RB, plain: PB, hx, hy });
              // 逐面板量 u/v 的實得跨距:**u 跨距 MUST 是 1/cols 的整數倍**(= 面板兩側的
              // 邊界恰好落在格線上 = 不會有被裁一半的窗),v 跨距 MUST 是整數列
              const uR = r.panels.map(() => [Infinity, -Infinity]), vR = r.panels.map(() => [Infinity, -Infinity]);
              for (let t = 0; t < r.faceOf.length; t++) {
                const pi = r.faceOf[t];
                if (pi < 0) continue;
                for (let j = 0; j < 3; j++) {
                  const vi = r.idx[t * 3 + j];
                  uR[pi][0] = Math.min(uR[pi][0], uv[vi * 2]); uR[pi][1] = Math.max(uR[pi][1], uv[vi * 2]);
                  vR[pi][0] = Math.min(vR[pi][0], uv[vi * 2 + 1]); vR[pi][1] = Math.max(vR[pi][1], uv[vi * 2 + 1]);
                }
              }
              cells.forEach((c, pi) => {
                if (!c || !Number.isFinite(uR[pi][0])) return;
                const du = (uR[pi][1] - uR[pi][0]) * cols, dv = (vR[pi][1] - vR[pi][0]) / (1 - RB - PB) * rows;
                if (Math.abs(du - Math.round(du)) > 1e-4 || Math.abs(dv - Math.round(dv)) > 1e-4) spanOK = false;
                vLo = Math.min(vLo, vR[pi][0]); vHi = Math.max(vHi, vR[pi][1]);
              });
            }
          }
          ok(panelN > 20 && wholeOK,
            `逐面板的格數恆為 ≥1 的整數(${panelN} 片面板 × 4 種網格)`);
          ok(spanOK,
            'u 跨距恆為 1/cols 的整數倍、v 跨距恆為整數列 ⇒ **面板兩側的邊界恆落在格線上 = 不會有被裁一半的窗**');
          ok(tooSmall > 0, `放不下一整格的面板會被擋掉(4 種網格合計 ${tooSmall} 片改吃素牆帶)`);
          ok(vLo >= RB + PB - 1e-6 && vHi <= 1 + 1e-6,
            `窗格的 v 恆收在窗牆帶內([${vLo.toFixed(3)}, ${vHi.toFixed(3)}] ⊆ [${(RB + PB).toFixed(3)}, 1];溢出就是窗印到素牆/屋頂帶上)`);
        }
      }
      // ⑥-e **小區塊併入角度最接近的鄰居**(2026-08-14 使用者「法線角夾角小的**相鄰**平面
      //      合併,**相對周邊面積過小**且**角度差異沒有過大**的區塊,與**角度最接近的鄰居**
      //      合併,最後收斂成多面柱體 / 錐台 / 角錐 / 圓柱 / 圓台 / 圓錐等幾何多面體構成」)。
      //      刀住 `normalize_parts.py` 的 ㋗、尺住 `parts_src.solidConverge`,成品那一半由
      //      `intake_parts` 直接量 GLB(這裡驗的是規則本身與門檻的單一來源)。
      {
        const ps = JSON.parse(readSrc('tools', 'ai3d', 'tri_budget.json')).families.building.planar_spec;
        // 壞版:--break-merge = 第三輪(整條 ㋗ 拿掉)、--break-denoise = 第四輪(整條 ㋘ 拿掉)
        let npF = readSrc('tools', 'ai3d', 'normalize_parts.py');
        if (BREAK_MERGE) {
          npF = npF
            .replace(/^PLANAR_SMALL_F = [\d.]+/m, 'PLANAR_SMALL_F = 0.0')
            .replace(/^PLANAR_MERGE_DEG = [\d.]+/m, 'PLANAR_MERGE_DEG = 0.0')
            .replace(/def _face_adj\(me, rep\):/, 'def _face_adj_disabled(me, rep):')
            .replace(/for g in small:[\s\S]*?(?=# ㋖ 殘料吸附)/, '');
        }
        if (BREAK_DENOISE) {
          npF = npF
            .replace(/^PLANAR_DN_ITER = [\d.]+/m, 'PLANAR_DN_ITER = 0')
            .replace(/^PLANAR_DN_DEG = [\d.]+/m, `PLANAR_DN_DEG = ${(ps.flat_deg + 2).toFixed(1)}`)
            .replace(/    _denoise\(me, rep, home, off, adj\)\r?\n/, '')
            .replace(/math\.exp\(-q \* q \/ \(2 \* sr \* sr\)\)/, '1.0');
        }
        const SF = npF.match(/^PLANAR_SMALL_F = ([\d.]+)/m);
        const MD = npF.match(/^PLANAR_MERGE_DEG = ([\d.]+)/m);
        ok(!!SF && !!MD && +SF[1] === ps.small_f && +MD[1] === ps.merge_deg,
          `㋗ 的兩個門檻與 tri_budget 的 planar_spec 同一份(small_f ${SF?.[1]} / merge_deg ${MD?.[1]})`);
        // ---- ㋘ 前置去噪(2026-08-14 使用者「處理合併平面前,隨機凹凸不平的面先弄平整」)----
        const DN = ['DN_ITER', 'DN_VERT', 'DN_DEG', 'DN_SS']
          .map((k) => npF.match(new RegExp(`^PLANAR_${k} = ([\\d.]+)`, 'm')));
        ok(DN.every(Boolean) && +DN[0][1] === ps.dn_iter && +DN[1][1] === ps.dn_vert
          && +DN[2][1] === ps.dn_deg && +DN[3][1] === ps.dn_ss,
          `㋘ 的四個參數與 planar_spec 同一份(${DN.map((m) => m?.[1]).join(' / ')})`);
        // **順序就是使用者那句話的整個重點**:分群的入群條件吃法線角,隨機起伏會把一面平牆
        // 從中間切開 ⇒ 去噪 MUST 排在分群之前。倒過來做,群一旦切碎了後面每一步都在碎片上。
        // 錨在**呼叫點**(縮排 4 格)不是函式簽章 —— 抓到 def 的話這一條恆綠
        const iDn = npF.search(/\n {4}_denoise\(me, rep, home, off, adj\)/);
        const iGrp = npF.indexOf('for g in _plane_groups(me, off, axis=PLANAR_AXIS)');
        ok(iDn > 0 && iGrp > 0 && iDn < iGrp,
          '㋘ 去噪排在分群**之前**(排在後面 = 在已經被雜訊切碎的群上做事)');
        // 去噪門檻 MUST < 平整門檻 —— 平整那條線被去噪抹掉的話,「真的貼在平面上」恆真
        const FDs = +(npF.match(/^PLANAR_FLAT_DEG = ([\d.]+)/m)?.[1] ?? NaN);
        ok(ps.dn_deg < ps.flat_deg && +DN[2]?.[1] < FDs && FDs === ps.flat_deg
          && /assert PLANAR_DN_DEG < PLANAR_FLAT_DEG/.test(npF)
          && /assert ub_fdeg == 0\.0 or ub_fdeg == PLANAR_FLAT_DEG/.test(npF),
          `去噪門檻 ${DN[2]?.[1]}° < 平整門檻 ${FDs}°(= planar_spec.flat_deg ${ps.flat_deg});平整門檻只有一個數(--uvbands 解析時釘住)`);
        // **保稜線**:一般的平滑會把第三輪 ㋔ 修回來的邊角一起磨掉 ⇒ MUST 是雙邊(值域項)
        ok(/math\.exp\(-q \* q \/ \(2 \* sr \* sr\)\)/.test(npF)
          && /sr = 2\.0 \* math\.sin\(math\.radians\(PLANAR_DN_DEG\) \/ 2\.0\)/.test(npF)
          && /ss = \(ds \/ dn if dn else 1\.0\) \* PLANAR_DN_SS/.test(npF),
          '去噪是**雙邊**濾波(值域項讓夾角大的鄰居權重趨近 0 ⇒ 稜線兩側互不影響;少了它就是把 ㋔ 修回來的邊角再磨圓一次)');
        // 位移共用同一份累計夾制 ⇒「整顆離原始掃描最多跑多遠」仍然只有一個數字
        ok(iDn > 0 && /if ln > off:                     # 與合併共用同一個累計位移上限/.test(npF),
          '去噪與合併共用同一份 `home` 與同一個位移上限(第二個預算 = 「最多跑多遠」變成兩個數字)');
        // 兩條設計不變式:①在分群容差之內的本來就併掉了 ⇒ merge_deg MUST > deg
        //                ②45° 是兩面直角牆之間的**倒角** —— 那是特徵不是雜訊
        ok(ps.merge_deg > ps.deg && ps.merge_deg < 45,
          `㋗ 的角度上界收在 (${ps.deg}°, 45°) 之間(下界 = 分群容差,設得比它小 = ㋗ 整條是死碼;`
          + `上界 = 倒角,越過去就把特徵當雜訊併掉了;現值 ${ps.merge_deg}°)`);
        // 「相對周邊面積過小」MUST 比**那個鄰居**的面積,MUST NOT 比佔全體的比例 ——
        // 圓柱 / 圓台 / 圓錐的側面每一片都一樣大 ⇒ 比值恆 1 ⇒ 結構上併不掉(使用者列的
        // 那三種曲面體的保護就是這一行);拿佔全體比例當判據的話,一根 36 面的圓柱
        // 每一片只佔 2%,整根會被抹平,而每一條既有斷言照樣全綠。
        ok(/g\['area'\] > PLANAR_SMALL_F \* h\['area'\]/.test(npF),
          '「相對周邊面積過小」比的是**那個鄰居**的面積(比佔全體的比例 = 把圓柱/圓台/圓錐整根抹平)');
        // 「相鄰」是**共邊**:分群本來就不看連通性(對「是不是同一面牆」是對的),
        // 但「這塊碎屑該併給誰」只能由拓樸回答
        ok(/def _face_adj\(me, rep\):/.test(npF) && /adj = _face_adj\(me, rep\)/.test(npF)
          && /e2f\.setdefault\(\(a, b\) if a < b else \(b, a\), \[\]\)/.test(npF),
          '「相鄰」走共邊的 `_face_adj`,而邊的鍵經 `rep` 正規化(拿原始頂點索引當鍵 ⇒ 三角形湯上每片面自成孤島 ⇒ ㋗ 安靜地什麼都沒併)');
        // 「併得過去才併」:拉一半比不拉更糟(30° 的碎屑被拉成 5°,小角那一欄反而升高)
        ok(/vs = \{rep\[vi\] for fi in g\['faces'\] for vi in me\.polygons\[fi\]\.vertices\}/.test(npF)
          && /if any\(abs\(\(home\[vi\]\.x - best\['c'\]\[0\]\)/.test(npF),
          '㋗ 併之前先驗「整塊的頂點都能在累計位移上限之內落到那個平面上」(拉一半 = 半平不平)');
        // 被併的那一塊 MUST NOT 進大群的擬合 —— 反過來就是讓碎屑把一面好牆拉歪
        const i0 = npF.indexOf('for g in small:');
        const blk = i0 < 0 ? '' : npF.slice(i0, npF.indexOf('# ㋖ 殘料吸附'));
        ok(blk.length > 200 && !/refit/.test(blk),
          '併的方向是**小的貼上大的**(被併的那一塊不進大群的擬合;反過來 = 碎屑把一面好牆拉歪)');
        // 尺:JS 這一側的分群只有 `wallpanel.planeGroups` 一份,兩個消費端同吃
        const wpSrc2 = readSrc('public', 'js', 'wallpanel.js');
        const psSrc = readSrc('tools', 'ai3d', 'parts_src.mjs');
        ok((wpSrc2.match(/export function planeGroups\(/g) || []).length === 1
          && /const \{ G, fn, fa, totA, span, lo, hi, nT \} = planeGroups\(pos, idx, o\);/.test(wpSrc2)
          && /import \{ wallPanels, planeGroups \} from '\.\.\/\.\.\/public\/js\/wallpanel\.js';/.test(psSrc)
          && /planeGroups\(node\.pos, node\.idx, \{/.test(psSrc),
          '量測端的平面分群只有 wallpanel.planeGroups 一份(wallPanels 與 solidConverge 同吃)');
        // 收斂度 MUST 是**兩欄**:單看碎鱗率,把整顆抹成一顆大球也很「不碎」;
        // 單看貼平面,一層碎鱗每一片都貼在自己那一小群上,佔比一樣漂亮
        // ---- ㋙ 封底(2026-08-14 使用者圈了三處「破洞」)----
        // 先說量到的:圈起來的那幾處**不是破洞**(chimney_a / masslow_a / mass_c / masslow_b
        // 的邊界邊是 0),是 img→3D 的底面內凹成一顆穹頂 ⇒ 整顆靠一圈扇貝狀毛邊站在地上。
        const npS = BREAK_SEAL
          ? npF.replace(/^SEAL_OPEN_MAX = [\d.]+/m, 'SEAL_OPEN_MAX = 1.0')
            .replace(/^SEAL_RIM_F = [\d.]+/m, 'SEAL_RIM_F = 1.0')
            .replace(/if ok and fi >= 0 and nor\.z < 0\.0:/, 'if ok and fi >= 0:')
            .replace(/if open_r > SEAL_OPEN_MAX:/, 'if False:')
            .replace(/if me\.vertices\[rep\[v\]\]\.co\.z <= band/, 'if True')
            .replace(/^CAVITY_F = [\d.]+/m, 'CAVITY_F = 1.0')
            // ⚠ **全域**替換:乾跑區塊有一模一樣的一行,只換第一處的話這條壞版是靜默
            //   no-op(2026-08-14 實測:紅字由 6 條掉成 5 條,而壞版根本沒被造出來)
            .replace(/hok, hloc, _, _ = hull\.ray_cast\(tuple\(o\), tuple\(d\)\)/g, 'hok, hloc = True, o')
            .replace(/if opened:/g, 'if False:')
          : npF;
        const SO = +(npS.match(/^SEAL_OPEN_MAX = ([\d.]+)/m)?.[1] ?? NaN);
        const SR = +(npS.match(/^SEAL_RIM_F = ([\d.]+)/m)?.[1] ?? NaN);
        const CF = +(npS.match(/^CAVITY_F = ([\d.]+)/m)?.[1] ?? NaN);
        ok(SO > 0 && SO < 0.1 && SR > 0 && SR <= ps.off_f * 2 && CF > 0 && CF < 0.5,
          `㋙ 的三道夾制都在(破口上限 ${SO}、底緣帶 ${SR} × 跨距、凹陷深度上限 ${CF} × 該方向寬度)`);
        // **深度 MUST 相對於凸包**(周圍表面)而不是包圍盒:拿包圍盒當基準的話,一根圓柱
        // 從側面看,靠邊那幾條射線要走到圓心才碰到面 ⇒「深度 1.000 × 寬」,而它根本沒有
        // 凹陷(實測會誤拉 80 個頂點,把圓柱削成一根方柱)。
        ok(/hok, hloc, _, _ = hull\.ray_cast\(tuple\(o\), tuple\(d\)\)/.test(npS)
          && /dep = \(loc\[axis\] - hloc\[axis\]\) \* sgn/.test(npS) && /def _hull_obj\(ob\):/.test(npS),
          '「深度」量的是**相對於凸包的內凹量**(拿包圍盒當基準 = 把曲率當凹陷,圓柱會被削成方柱)');
        // 「類似甜甜圈這樣穿過去則不用處理」MUST 是**區塊級**的判定:逐點往側向打射線不夠
        // —— 甜甜圈的孔在側向被整個環圍住(實測會誤拉 281 個頂點,把它填成一塊圓餅)。
        ok(/thru\[p2\]\[q2\]/.test(npS) && /if opened:/.test(npS),
          '穿過去的通道**整塊**放行(候選區塊碰得到一條穿過去的射線就整塊不動)');
        // ①**破口太多就不封底**:選片的判據是「由下往上的第一個命中」,而那只在封閉網格上
        //   成立 —— 有破口時射線會鑽進去打到對面的內面,那一片被拉下來 = 整顆長出一排尖刺
        //   (實測 ac_a 破口佔面數 0.599,封底後側面一排黑色尖楔,而外廓與面數兩條照樣全綠)
        ok(/if open_r > SEAL_OPEN_MAX:/.test(npS) && /return 0/.test(npS)
          && /def _open_share\(me\):/.test(npS),
          '破口佔面數超過上限就**不封底**(原則 6;射線會從破口鑽進去,把對面的內面扯下來)');
        // ②**只壓底緣帶**:中空殼的內頂棚可以高到 0.9 × 跨距,無差別下拉會把那個高度的
        //   外牆一起扯垮(實測上方 90% 的小角佔比 mass_a 19.0% → 43.6%,而兩條斷言全綠)
        ok(/band = z0 \+ SEAL_RIM_F \* span/.test(npS)
          && /if me\.vertices\[rep\[v\]\]\.co\.z <= band/.test(npS),
          '只壓「底緣帶之內」的頂點(無差別下拉 = 把 0.9 × 跨距高的外牆一起扯垮)');
        // ③選片 MUST 只收**朝下**的命中(朝上的第一個命中 = 射線穿進側牆了)
        ok(/if ok and fi >= 0 and nor\.z < 0\.0:/.test(npS),
          '由下往上的命中只收朝下的面(收到朝上的 = 射線已經穿進側牆)');
        // ④封底 MUST 排在整平**之前**(整平吃的是形狀;反過來整的是還吊在半空中的底面)
        const iSeal = npS.indexOf("# ---- `--basefill`");
        const iRep = npS.indexOf("# ---- `--replanar`");
        ok(iSeal > 0 && iRep > 0 && iSeal < iRep, '㋙ 封底排在 --replanar 之前(整平吃的是形狀)');
        ok(/scales: G\.length \/ Math\.max\(nT, 1\)/.test(psSrc) && /onPlane: onA \/ T/.test(psSrc)
          && (readSrc('tools', 'ai3d', 'intake_parts.mjs').match(/cv\.scales <= |cv\.onPlane >= /g) || []).length === 2,
          '收斂度是**兩欄**(碎鱗率 + 貼平面)且入庫閘兩條都驗(只留一條都有一種騙得過去的壞法)');
      }
      // ⑥-b **窗戶圖層間距逐款不同 + 幾乎無間距的玻璃牆**(2026-08-12 使用者定案)。
      //     舊制只有兩組窗格幾何(帷幕 0.86×0.62、其餘一律 0.52×0.48)⇒ 十六款樓的窗間距
      //     只有兩種,一整條街讀起來是同一張貼圖。層高本身仍夾在 STOREY 帶內(2026-08-09
      //     的定案不動)—— 兩件事正交:層高是現實約束,窗佔比是建築風格。
      {
        // 壞版 = 這一輪之前的樣子:窗格幾何只有兩組、沒有無縫玻璃牆這一款
        const bioG = BREAK_GLASS
          ? bioC.replace(/win: \[0\.\d+, 0\.\d+\] \}/g, '}').replace(/style: 'glass'/g, "style: 'curtain'")
          : bioC;
        const wins = [...bioG.matchAll(/win: \[([\d.]+), ([\d.]+)\]/g)].map((m) => +m[2]);
        ok(wins.length >= 20 && new Set(wins).size >= 8,
          `窗的高佔比逐款不同(${wins.length} 款、${new Set(wins).size} 種間距;舊制只有 2 種)`);
        const glass = (bioG.match(/style: 'glass'/g) || []).length;
        const fxG = bioG.slice(bioG.indexOf('function facadeTex('), bioG.indexOf('// 一般建物外牆色盤'));
        ok(glass >= 1 && /style === 'glass'/.test(fxG)
          && /const gy0 = 12, gh = WW - 26;/.test(fxG) && /cx\.fillRect\(0, gy0, W, gh\);/.test(fxG),
          `幾乎無間距的玻璃牆是一種立面而不是一組參數(${glass} 款走 glass:整面玻璃 + 髮絲框,沒有裙板帶)`);
        // 覆寫 MUST **置中**:給了高卻讓窗黏在上緣的話,窗越高裙板就越偏,而使用者要的正是
        // 「間距不一樣」而不是「窗往上跑」
        ok(/\? \[\(1 - win\[0\]\) \/ 2, \(1 - win\[1\]\) \/ 2, win\[0\], win\[1\]\]/.test(fxG),
          '窗格覆寫由佔比反推置中偏移(不是把窗黏在格子上緣)');
      }
      // ⑦**樓層間距**(2026-08-09 使用者定案:「不同建築可以有不同窗戶大小,但上下樓層
      //   間距要在合理差異範圍以內」)。立面貼圖沒有 per-instance repeat ⇒ 一張圖被拉滿
      //   **那一件**的高度 ⇒ 層高 = 件高 ÷ 列數。舊制列數是款自帶的常數 ⇒ 實測全面出界
      //   (商辦 h=13m → 1.1m、100m 塔樓的裙樓 → 0.75m)。這一段驗的就是那個量。
      {
        const bioS = BREAK_STOREY
          ? bioC.replace('  const inBand = ROW_LADDER.filter((r) => h / r >= STOREY.MIN && h / r <= STOREY.MAX);',
            '  const inBand = [];')
          : bioC;
        const cut = (a, b) => { const i = bioS.indexOf(a), j = bioS.indexOf(b, i + 1); return i < 0 || j < 0 ? '' : bioS.slice(i, j); };
        // 結束錨點 MUST 是**程式碼**:bioC 已經剝掉註解,拿註解當錨會切到空字串,
        // 而症狀是「STOREY is not defined」—— 看起來像原文壞了,其實是錨壞了
        const seg = cut('const STOREY = {', 'function facadeStyle(');
        let S = null, ranErr = null;
        try { S = new Function('objHeightMax', `${seg}\n return { STOREY, ROW_LADDER, facadeRows };`)(objHeightMax); }
        catch (e) { ranErr = e; }
        ok(!ranErr && S, `層高區塊原文執行不炸${ranErr ? ` —— ${ranErr.message}` : ''}`);
        if (S) {
          const { STOREY, ROW_LADDER, facadeRows } = S;
          // 級距上界推導自世界物件高度上限,MUST NOT 手寫(改 objHeightMax 自己跟著長)
          // 頂級只需**放得下最高的那一棟**(層高 ≤ MAX);再往上加級只會多開桶
          const top = ROW_LADDER[ROW_LADDER.length - 1];
          const need = objHeightMax() / Math.min(STOREY.residential, STOREY.commercial);
          ok(top >= need && ROW_LADDER[ROW_LADDER.length - 2] < need,
            `列數級距的上界是推導值(頂級 ${top} 恰好蓋過 ${objHeightMax().toFixed(1)} ÷ ${Math.min(STOREY.residential, STOREY.commercial)} = ${need.toFixed(1)},不多開一級)`);
          ok(ROW_LADDER[0] === 1 && ROW_LADDER.every((r, i) => i === 0 || r > ROW_LADDER[i - 1]),
            `列數級距自 1 起嚴格遞增(${ROW_LADDER.length} 級)`);
          // 級距比 MUST < 帶寬比,否則某些高度會「找不到落在帶內的列數」而靜默出界
          const step = Math.max(...ROW_LADDER.map((r, i) => (i ? r / ROW_LADDER[i - 1] : 1)));
          ok(step <= STOREY.MAX / STOREY.MIN + 1e-9,
            `級距比 ${step.toFixed(2)} ≤ 帶寬比 ${(STOREY.MAX / STOREY.MIN).toFixed(2)}(恆有落在帶內的候選)`);
          // **核心不變式**:掃過整個高度域,層高一律落在使用者說的那個「合理差異範圍」
          let bad = null, lo = Infinity, hi = 0;
          for (const com of [false, true]) {
            for (let h = STOREY.MIN; h <= objHeightMax() + 1e-9; h += 0.02) {
              const s = h / facadeRows(h, com);
              if (s < lo) lo = s;
              if (s > hi) hi = s;
              if (!bad && (s < STOREY.MIN - 1e-9 || s > STOREY.MAX + 1e-9)) bad = `${com ? '商辦' : '住宅'} h=${h.toFixed(2)} → 層高 ${s.toFixed(2)}`;
            }
          }
          ok(!bad, `層高全域收在 [${STOREY.MIN}, ${STOREY.MAX}](實測 [${lo.toFixed(2)}, ${hi.toFixed(2)}])${bad ? ` —— ${bad}` : ''}`);
          // 「每棟差異不大」= **同一類**建物之間的離散度(住宅與商辦的目標本來就差
          // 1.26×,那是設計不是漂移 ⇒ 兩類混在一起量會把它算進離散度裡)
          for (const com of [false, true]) {
            let lo2 = Infinity, hi2 = 0;
            for (let h = 10; h <= objHeightMax(); h += 0.02) {
              const s = h / facadeRows(h, com);
              lo2 = Math.min(lo2, s); hi2 = Math.max(hi2, s);
            }
            ok(hi2 / lo2 <= 1.5,
              `${com ? '商辦' : '住宅'}:10m 以上的層高離散度 ${(hi2 / lo2).toFixed(2)}× ≤ 1.5×`
              + `(實測 [${lo2.toFixed(2)}, ${hi2.toFixed(2)}],目標 ${com ? STOREY.commercial : STOREY.residential}m)`);
          }
          ok(Math.abs(STOREY.commercial / STOREY.residential - 1.26) < 0.15,
            `兩類的目標層高差 ${(STOREY.commercial / STOREY.residential).toFixed(2)}×(現實:商辦/店面本來就比住宅挑高)`);
          // 逐件而非逐棟:退縮頂塔(0.22h)與臨街裙樓(max(6, 0.12h))吃自己的高度
          ok(facadeRows(100, true) !== facadeRows(12, true) && facadeRows(12, true) >= 2,
            `同一棟的附件件另外取列數(100m 主體 ${facadeRows(100, true)} 列、12m 裙樓 ${facadeRows(12, true)} 列)`);
        }
        // 單一縫:一份定義、三個消費端都經 `rowsOf`,而快取鍵 MUST 帶列數
        // `t.h` 對庫節點那一列自 2026-08-12 起是**縮放係數**不是樓高(fitScale 把網格撐滿基地)
        // ⇒ 列數 MUST 改吃另存的真樓高 `t.bh`;吃錯的話那幾棟塔樓的層高會是「係數公尺」
        ok((bioC.match(/function facadeRows\(/g) || []).length === 1
          && /const rowsOf = \(t\) => facadeRows\(t\.bh \?\? t\.h, commercial\);/.test(bioC)
          && /bh: b\.h,/.test(bioC)
          // 消費端家數會隨功能長(2026-08-13 的窗格對齊又多兩處)⇒ 釘的是**沒有第二條取值路**:
          // `facadeRows(` 只准出現在定義、`facadeStyle` 的帶位、與 `rowsOf` 這三處
          && (bioC.match(/facadeRows\(/g) || []).length === 3
          && (bioC.match(/rowsOf\(/g) || []).length >= 3
          && /facadeTex\(`\$\{fd\.key\}r\$\{rows\}\$\{band \? 'b' : ''\}`/.test(bioC) && /facadeTex\(`\$\{pd\.key\}r\$\{rw\}`/.test(bioC),
          '列數只有 facadeRows 一份、逐件經 rowsOf(庫節點吃真樓高 bh)、貼圖快取鍵帶列數與帶位');
        // 舊制退場:款表不再帶 rows、樓高分桶表不得復辟
        ok(!/FACADE_BUCKETS/.test(bioC) && !/\{ key: '(?:res|com)\d', cols: \d+, rows:/.test(bioC),
          '款表不再自帶 rows、FACADE_BUCKETS 已退場(款只管窗長什麼樣,層高歸 STOREY)');
        // 貼圖高度隨列數長:10 列以下維持 256 ⇒ 絕大多數建物的貼圖逐位元不變
        const H = new Function(`${cut('const FACADE_PX = {', '\nfunction facadeTex(')}\n return facadeTexH;`)();
        ok(H(1) === 256 && H(10) === 256 && H(24) === 576 && H(40) === 960
          && [1, 5, 10, 20, 40].every((r, i, a) => i === 0 || H(r) >= H(a[i - 1])),
          `貼圖高度隨列數單調不減且 10 列以下維持 256(24 列 → ${H(24)}、40 列 → ${H(40)})`);
      }
    }
    {   // megaGeo 呼叫點 = 凍結清單 7 處(marble 塊/崩落塊/伴生丘/hoodoo 整柱/疊石/tower 整座/mesa 整座),名字一律出自 MEGA_LIB 名冊
      const uses = (bioC.match(/megaGeo\(/g) || []).length;   // 定義式是 `= (name) =>`,不含 `megaGeo(`
      ok(uses === 7 && (bioC.match(/megaGeo\(MEGA_LIB\./g) || []).length === 7,
        `megaGeo 呼叫點 = 凍結的 7 處且全走 MEGA_LIB 名冊(實得 ${uses};增刪呼叫點 MUST 同步這裡與 tri_budget 的 max_lib_parts_per_rock)`);
      // 輪替除數推導不手寫:名冊擴充後第 4 顆以後的節點若取不到,檔案在、intake 綠、
      // 遊戲裡卻一顆都沒出現 —— 沒有任何錯誤訊息(2026-08-06 名冊 3 → 6 時補上)
      ok(!/MEGA_LIB\.block\[[^\]]*%\s*\d/.test(bioC) && /const NBLK = MEGA_LIB\.block\.length;/.test(bioC),
        'MEGA_LIB.block 的輪替除數取自名冊長度(NBLK),MUST NOT 寫死數字');
      // 「整座」型的兩支:載到庫就不 add 原 primitive,但**迴圈照跑** —— rnd() 枚數
      // 有無零件庫都要逐位元相同(§2.3 / A4:多消耗一枚,後面每一顆巨岩與每一株植被都位移)
      for (const [key, flag] of [['tower', 'gT'], ['mesa', 'gM']]) {
        const seg = bioC.slice(bioC.indexOf(`megaGeo(MEGA_LIB.${key})`));
        const body = seg.slice(0, seg.indexOf('} else if'));
        ok(!/if \(!?g[TM]\)[^\n]*rnd\(\)/.test(body) && new RegExp(`if \\(!${flag}\\) g\\.add`).test(body),
          `synthMegalith ${key} 分支:庫節點只換「add 進場景」,rnd() 不進條件分支(枚數不變)`);
      }
      const sm = strip(bio.slice(bio.indexOf('function synthMegalith'), bio.indexOf('function flatRadiusAt')));
      ok(!/megaGeo|MEGA_LIB/.test(sm.slice(sm.lastIndexOf('return {'))),
        'synthMegalith 的 col/anchor 回傳塊不讀庫(佈局與碰撞恆走 primitive 參數 —— 庫隨載入成敗而異,§2.3)');
    }
    ok(/new THREE\.InstancedMesh\(partGeo\(part\)/.test(bioC),
      '植被消費迴圈畫的是 partGeo 解析結果(載入失敗退回保險絲 = 舊畫面)');
    const crownSrc = strip(bio.slice(bio.indexOf('function giantCrownR'), bio.indexOf('function placeGiantGroves')));
    const spanSrc = strip(bio.slice(bio.indexOf('function vegSpan'), bio.indexOf('function buildVegMeshes')));
    ok(!/libGeo|partGeo|\.lib\b/.test(crownSrc) && !/libGeo|partGeo|\.lib\b/.test(spanSrc),
      '佈局數學(giantCrownR / vegSpan)只讀保險絲 p.g:庫幾何隨載入成敗而異,佈局讀它 = 跨客戶端分家(§2.3)');
    // 2026-08-05 綠地首批接線之後才有意義的三條(在此之前一列 lib 都沒有,恆真)
    const { rows, srcLibCount } = bioLibDescs(bio);
    ok(rows.length === srcLibCount,
      `biomes 的 lib 列全部在可執行的零件表裡(原文 ${srcLibCount} 筆 / 解析 ${rows.length} 筆)`
      + ' —— 對不上代表有 lib 列住在離線驗不到的表,那一列等於沒被驗過');
    ok(rows.every((r) => Array.isArray(r.fb) && r.fb.length >= 2),
      '每一列 lib 都留著保險絲 g(只有 lib 沒有 g = 載入失敗當場沒有幾何可畫)');
    const libs = new Set(partLibs());
    const orphanFam = [...new Set(rows.map((r) => r.family))].filter((f) => !libs.has(f));
    ok(orphanFam.length === 0,
      `lib 列的家族都在 PART_LIBS 裡(缺 ${orphanFam.join('、') || '無'})`
      + ' —— 不在的話那一族永遠查 null = 整批永久走保險絲,畫面與今天一樣而沒有任何錯誤訊息');
  }
  // 羞避傾斜吃既有 tx/tz 剛體通道(A27)
  ok(/cand\.lean\[0\]/.test(bio) && /cand\.lean\[1\]/.test(bio), '羞避傾斜併進既有 tx/tz(剛體通道,A27)');
  // 公設不進權威幾何以外的地方:鋪面沒有登記碰撞(只有 civicColliders 那一條路)
  ok(count(/x: wx, z: wz, y: gy - 1/g) === 1, '公設碰撞柱只有一條登記路徑');
  ok(/hw2: col\.hw2/.test(bcode), '公設的方盒件登記有向盒(A30:圓只當 broad-phase)');
}

// ============ Ⅵ 接線原文行為直測(biomes.js 的街廓配置區塊)============
// 這一段執行的是 **biomes.js 那個區塊的原文**,把它所有的自由變數換成假的地形/占位/型錄。
// 目的很具體:真瀏覽器冒煙在沙箱裡跑不動(three 走 CDN、無網路),而接線最容易壞的方式
// 是「某個變數名字打錯」—— 那在瀏覽器裡是 ReferenceError,整張地圖直接不生成,卻在
// 任何離線稽核裡都看不見。執行原文就把這一類抓在這裡。
console.log('\nⅥ 接線原文行為直測(biomes.js 街廓配置區塊)');
{
  const i6 = bio.indexOf('  // ---- 聚落場(單一縫)');
  const i7 = bio.indexOf('  // 市區補間:把被 8 倍世界撐開的街廓填回連續街區');
  const blockSrc = bio.slice(i6, i7);
  // 種子 = 一小撮**聚落**。棵數要跨過 `URBAN_MIN_PEAK`(= INFILL.cols[0] × rows[0] = 9,
  // 「densifyUrban 自己畫得出來的最小一塊街廓」)才算得上街廓;下面的反面對照組驗
  // 1~8 棵一棟都不配 —— 兩組的差別只有密度,正是聚落場量的那個量。
  const cluster = (n) => Array.from({ length: n }, (_, i) => ({ x: 10 + (i % 4) * 30, z: 10 + Math.floor(i / 4) * 30, w: 20, d: 20 }));
  const generic = cluster(12);
  const SEEDS = generic.length;
  const landmarks = [];
  const items = {};
  const blockers = [];
  const added = [];
  const frontSegs = [
    { x1: -400, z1: 0, x2: 400, z2: 0, hw: 5, main: true },
    { x1: 0, z1: -400, x2: 0, z2: 400, hw: 4, main: false },
  ];
  const env = {
    frontSegs, generic, landmarks, items, blockers,
    onProgress: null, inb: 30,
    terrain: { minX: -900, maxX: 900, minZ: -900, maxZ: 900, heightAt: () => 50 },
    blocked: new Set(),
    occ: { free: () => true, add: () => {}, room: () => 999 },
    group: { add: (g) => added.push(g) },
    // cols/rows:聚落場的退化保險 `URBAN_MIN_PEAK` 由它們推導(最小一塊補間街廓)
    INFILL: { gap: 2, maxSeeds: 160, cols: [3, 6], rows: [3, 6] }, OVER: { bldH: 1, bldCap: 170 },
    FACADES: { commercial: [0, 1, 2], residential: [0, 1] },
    MAX_BUILDINGS: 240, MAX_INFILL: 1200, VEG_SCALE: { broadleaf: 1 },
    areaFree: () => true, blockArea: () => {}, terrainEnvCode: () => 0,
    flatRadiusAt: (t, x, z, r) => r, sinkBaseY: () => 50,
    CIVIC_KINDS: M.CIVIC_KINDS, CIVIC_TREES: M.CIVIC_TREES, planBlocks: M.planBlocks,
    civicColliders: M.civicColliders, plotSeed: M.plotSeed, frac: M.frac,
    buildCivic: (kind) => ({ kind, position: { set() {} }, rotation: { y: 0 }, userData: {} }),
  };
  const names = Object.keys(env);
  // 沙箱 MUST 是 **async**:這一段原文帶著階段回報的讓步點(`await onProgress?.(…)`,
  // 2026-08-12 建構期讓步)。用同步的 `new Function` 包會直接是 SyntaxError,而錯誤訊息
  // (「await is only valid in async functions」)看起來完全像是 biomes.js 壞了。
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let ranErr = null, out = null, seeds = null;
  try {
    // `infillSeeds` 是這一段的產出之一(補間的種子名冊),一併取回來驗
    [out, seeds] = await new AsyncFunction(...names, `${blockSrc}\n return [civics, infillSeeds];`)(...names.map((k) => env[k]));
  } catch (e) { ranErr = e; }
  ok(!ranErr, `區塊原文執行不炸(自由變數全對得上)${ranErr ? ` —— ${ranErr.message}` : ''}`);
  if (!ranErr) {
    ok(generic.length > SEEDS, `建築進 generic(+${generic.length - SEEDS} 棟,與圖資建物同一條路徑)`);
    ok(generic.slice(SEEDS).every((b) => b.h > 0 && b.w > 0 && b.d > 0 && Number.isFinite(b.ry)
      && Number.isInteger(b.v) && typeof b.commercial === 'boolean'),
      '每一棟都帶齊 w/d/h/ry/commercial/v(下游立面與碰撞吃這些欄位)');
    ok(generic.slice(SEEDS).some((b) => b.commercial) && generic.slice(SEEDS).some((b) => !b.commercial),
      '商辦與住宅都配得出來(分區有生效)');
    // 補間種子 = 四棟圖資建物本身,**不含**這一段剛配出來的臨街樓(不然就是滾雪球)
    ok(seeds.length === SEEDS && seeds.every((s) => generic.slice(0, SEEDS).includes(s)),
      `補間種子恰為圖資建物(${seeds.length} 棵),不含本段新配的 ${generic.length - SEEDS} 棟`);
    ok(out.length >= 1 && added.length === out.length, `公設建了 mesh 並加進場景(${out.length} 處)`);
    ok(out.every((c) => M.CIVIC_KINDS[c.kind] && c.w === M.CIVIC_KINDS[c.kind].w),
      '公設回傳帶著鋪面尺寸(植被拔除那一段吃它)');
    ok(blockers.length > 0, `公設登記了碰撞柱(${blockers.length} 根)`);
    ok(blockers.every((b) => b.r > 0 && b.h > 0 && Number.isFinite(b.x) && Number.isFinite(b.z)),
      '每一根碰撞柱的座標與尺寸都是有限數');
    ok(blockers.some((b) => b.hw2 != null && b.hd2 != null && Number.isFinite(b.ry)),
      '長條件登記的是有向盒(A30:hw2/hd2/ry 齊全)');
    ok((items.broadleaf || []).length > 0, `園樹走既有植被 InstancedMesh(${(items.broadleaf || []).length} 株)`);
    ok((items.broadleaf || []).every((t) => Number.isFinite(t.x) && Number.isFinite(t.y)
      && Number.isFinite(t.s) && Number.isFinite(t.dj)), '園樹實例欄位齊全(x/y/z/s/ry/tx/tz/dj)');
    // 市區閘:聚落在 5km 外(圖資建物存在,但這條街周邊沒有)⇒ 一棟都不配。
    // 這正是「穿過山區的一條 primary 兩旁長出整排街屋」那個病灶的直測。
    const run = async (g0, lm = [], segs = null) => {
      const b2 = [], it2 = {}, ad2 = [];
      const e2 = { ...env, generic: g0, landmarks: lm, items: it2, blockers: b2,
        ...(segs ? { frontSegs: segs } : {}), group: { add: (g) => ad2.push(g) } };
      const [, sd] = await new AsyncFunction(...names, `${blockSrc}\n return [civics, infillSeeds];`)(...names.map((k) => e2[k]));
      return { added: g0.length - (Array.isArray(g0) ? 0 : 0), civics: ad2.length, seeds: sd };
    };
    const g2 = [{ x: 5000, z: 5000, w: 20, d: 20 }];
    const r2 = await run(g2);
    ok(g2.length === 1 && r2.civics === 0, '**市區閘**:聚落在 5km 外 ⇒ 這條街一棟都不配、一處公設都不劃');

    // ---- 孤立設施(2026-08-04 使用者回報「太魯閣、合歡山不在市區還這麼多建築」)----
    // 峽谷/草原上真實圖資往往只有一兩棟(遊客中心、工務段、山廟)。舊制的市區閘只問
    // 「±1 格內有沒有建物」⇒ 那一棟就足以讓整條省道兩旁長出街屋,而那批街屋又回頭當
    // 補間種子。閘門改成局部標準化的密度之後,這一組 MUST 是**零產出**;跨過最小街廓
    // (9 棟)才照配 —— 兩組的差別只有密度,證明量到的是「街廓」而不是「附近有房子」。
    for (const n of [1, 3, 8]) {
      const gN = cluster(n);
      const rN = await run(gN);
      ok(gN.length === n && rN.civics === 0 && rN.seeds.length === 0,
        `**孤立設施**:路旁只有 ${n} 棟圖資建物(< 最小街廓 9 棟)⇒ 一棟都不配、補間種子也是 0`);
    }
    {
      const gN = cluster(9);
      const rN = await run(gN);
      ok(gN.length > 9 && rN.seeds.length === 9,
        `門檻上緣:密到一塊最小街廓(9 棟)⇒ 照配(+${gN.length - 9} 棟),補間種子 9 棵`);
    }
    // 地標本身就是聚落的證據(車站/廟宇/體育場…)⇒ 與建物同權計數
    {
      const gN = cluster(5);
      const lm = Array.from({ length: 5 }, (_, i) => ({ x: 10 + (i % 4) * 30, z: 70 }));
      const rN = await run(gN, lm);
      ok(gN.length > 5 && rN.seeds.length === 5,
        `地標與建物同權計數:5 棟 + 5 座地標 = 一塊街廓 ⇒ 配得出來(+${gN.length - 5} 棟)`);
    }
    // ---- 局部標準化:同一張圖裡,密的地方配、疏的地方不配 ----
    // 這一組是「局部」那兩個字的直測:密集核心 + 遠處兩棟散戶,**同一次**規劃裡
    // 核心長街廓、散戶那一帶一棟都不長。手寫棵數門檻做得到這件事,但做不到跨圖可比
    // (同一個數字在東京是空地、在峽谷是市鎮);比例式兩件事都做得到。
    {
      const core = cluster(16);
      const outliers = [{ x: 700, z: 10, w: 20, d: 20 }, { x: 740, z: 10, w: 20, d: 20 }];
      const gN = [...core, ...outliers];
      // 幹道 MUST 一路延伸到散戶那裡 —— 不然「散戶周邊 0 棟」只是因為那邊沒有街道可配,
      // 量不到閘門有沒有生效(這一組的整個意義就在於兩端**都有街**)。
      const longSeg = [{ x1: -800, z1: 0, x2: 800, z2: 0, hw: 5, main: true }];
      const rN = await run(gN, [], longSeg);
      const added = gN.slice(core.length + outliers.length);
      const nearCore = added.filter((b) => Math.abs(b.x) < 300).length;
      const nearOut = added.filter((b) => b.x > 500).length;
      ok(added.length > 0 && nearCore > 0 && nearOut === 0,
        `**局部標準化**:密集核心配 ${nearCore} 棟、600m 外的兩棟散戶周邊配 ${nearOut} 棟`);
      ok(rN.seeds.length === core.length,
        `補間種子只收核心那 ${core.length} 棵,散戶不入選(${rN.seeds.length} 棵)`);
    }
  }
}

// ============ Ⅶ 建物來源信任階梯(2026-08-05)============
// 使用者回報「綠地和裸露地的建築太多了,不符合真實圖資,設計更符合現實世界的判斷機制」。
// 病灶有三條,全部沒有錯誤訊息:
//   ① `placeBoundary` 的邊界樓靠衛星像素低飽和度判 urban —— 裸岩/陰影/道路全是低飽和灰,
//      綠地/裸露地場地被沿整圈邊界圈上數十棟高樓,而圖資裡一棟都沒有;
//   ② 備援程序街區把「查詢成功但零建物」(真實答案:沒有建物)與「查詢失敗」(不知道)
//      混為一談 —— 真的空曠荒野也會長出一座程序市區;
//   ③ 市區種子 `urbanPts` 吃 classify 的手寫 mix 55% 改寫 —— 綠地場地宣告一成 urban
//      就在全圖撒假種子。
// 判斷機制 = **信任階梯**:圖資建物密度(聚落場)> 純影像分類 > 手寫 mix(只當全離線備援)。
console.log('\nⅦ 建物來源信任階梯(biomes.js)');
{
  const bcode = strip(bio);
  // ---- 原文單一縫 ----
  ok((bcode.match(/function classifyImg/g) || []).length === 1, '純影像判 `classifyImg` 恰一份實作');
  ok(/let c = classifyImg\(rgb\);/.test(bcode), 'classify 的第一層轉呼 classifyImg(色彩門檻只有一份)');
  {
    const c0 = bio.indexOf('function classifyImg');
    const cSrc = strip(bio.slice(c0, bio.indexOf('\n}', c0)));
    ok(!/\brnd\b/.test(cSrc), 'classifyImg 零亂數(收集閘多呼叫一次不推移共享序列,§2.3)');
  }
  ok(/\(!rgb \|\| classifyImg\(rgb\) === 'urban'\) && urbanPts\.length < 500/.test(bcode),
    '市區種子:影像在手只收純影像判為 urban 的點;無影像才退回 classify(mix 是最後備援)');
  ok(/if \(!osm && \(!mix \|\| \(mix\.urban \|\| 0\) > 0\.1\)\s*&& !landmarks\.length && !generic\.length && urbanPts\.length > 8\)/.test(bcode),
    '備援程序街區只在圖資**查詢失敗**(!osm)且場地宣告有市區成分時觸發 —— '
    + '查詢成功但零建物 = 荒野維持荒野;宣告 urban ≤ 10% = 沒有市區可重建(mix 是階梯第三層的否決票)');
  ok(/placeBoundary\(\{ terrain, items, generic, rnd, mix, occ, settlement \}\)/.test(bcode),
    '呼叫端把聚落場傳進 placeBoundary(邊界樓與兩個放大器同一把尺)');
  ok(/biome === 'urban' && !settlement\?\.\(x, z\)/.test(bcode),
    '邊界樓的市區判定過聚落場(衛星低飽和誤判 / mix 改寫不得憑空生出建物)');

  // ---- 行為直測:執行 classifyImg / classify / placeBoundary 原文 ----
  const h0 = bio.indexOf('function weightedPick');
  const hEnd = bio.indexOf('function classify(');
  const helpers = bio.slice(h0, bio.indexOf('\n}', hEnd) + 2);
  const H = new Function(`${helpers}\n return { classifyImg, classify };`)();
  ok(H.classifyImg([120, 120, 120]) === 'urban', '純影像:低飽和灰 → urban(誤判來源,故只當證據之一)');
  ok(H.classifyImg([150, 120, 90]) === 'bare' && H.classifyImg([80, 140, 60]) === 'green'
    && H.classifyImg([40, 80, 160]) === 'water' && H.classifyImg(null) === null,
    '純影像:棕黃 → bare、綠 → green、藍 → water、無影像 → null');
  {
    let calls = 0;
    const c = H.classify([120, 120, 120], 50, null, () => { calls++; return 0.9; });
    ok(c === 'urban' && calls === 0, 'classify 無 mix 時零亂數且等於純影像判(重構逐位元相容)');
    calls = 0;
    const c2 = H.classify(null, 50, { urban: 1 }, () => { calls++; return 0.1; });
    ok(c2 === 'urban' && calls === 2, '全離線(無影像)時 mix 仍是最後一層備援(降級鏈沒斷,原則 6)');
  }
  {
    const p0 = bio.indexOf('function placeBoundary');
    let pbSrc = bio.slice(p0, bio.indexOf('\n}', p0) + 2);
    // 反向驗證:把聚落場閘改成恆放行 =「舊制」⇒ 荒野邊界照樣長樓,下面那條 MUST 紅字
    if (BREAK_GATE) pbSrc = pbSrc.replace("biome === 'urban' && !settlement?.(x, z)", 'false');
    const runBoundary = (settle, mix) => {
      const env = {
        // 標稱高 `h` 是物件高度上限(2026-08-08)的輸入:邊界神木牆與圖中央的群落吃同一支
        // `objScaleFit`,少了它這段原文一執行就 undefined(而不是安靜地少驗一條)
        GIANT_DEFS: { kapok: { r: 6, h: 90 } },
        FACADES: { commercial: [0], residential: [0] },
        OVER: { bldCap: objHeightMax() },   // 真品上限(舊制手寫 170 已退場)
        objScaleFit,
        terrainEnvCode: () => 0,
        sinkBaseY: () => 50,
        // 帶的內緣自 2026-08-10 起由邊界障礙環推導(2026-08-11 環改吃型錄之後改讓開**最深的
        // 那一款**:IN1 = 內縮 − edgeWallDeepM(),見 data.js WORLD_EDGE):
        // 這三支不注入的話原文一執行就 ReferenceError,而那會被讀成「這段程式碼壞了」
        WORLD_EDGE, edgeWallInsetM, edgeWallDeepM,
      };
      const names = Object.keys(env);
      const fn = new Function(...names, `${helpers}\n${pbSrc}\n return placeBoundary;`)(
        ...names.map((k) => env[k]));
      const items = {}, generic = [];
      const n = fn({
        terrain: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, worldW: 1000, worldH: 1000,
          heightAt: () => 50, sampleColor: () => [120, 120, 120] },   // 整圈低飽和灰(裸岩/陰影)
        items, generic, rnd: () => 0.9, mix, occ: { room: () => 999, add() {} },
        settlement: settle,
      });
      return { n, items, generic };
    };
    let err = null, wild = null, town = null, bareV = null;
    try {
      wild = runBoundary(() => false, null);            // 荒野:圖資密度不足
      town = runBoundary(() => true, null);             // 市區:圖資密度背書
      bareV = runBoundary(() => false, { bare: 0.8, green: 0.2 });   // 裸露地場地的降格選型
    } catch (e) { err = e; }
    ok(!err, `placeBoundary 原文執行不炸${err ? ` —— ${err.message}` : ''}`);
    if (!err) {
      ok(wild.generic.length === 0 && wild.n > 0,
        `**荒野邊界零棟**:整圈影像誤判 urban + 聚落場不背書 ⇒ 樓 0 棟、視覺牆仍有 ${wild.n} 件(不留缺口)`);
      ok((wild.items.kapok || []).length > 0, '降格預設走神木牆(mix 缺席 → green)');
      ok(town.generic.length > 0, `市區邊界照長樓(聚落場背書 ⇒ ${town.generic.length} 棟,城市場地不受影響)`);
      ok((bareV.items.borderrock || []).length > 0 && bareV.generic.length === 0,
        '裸露地場地降格成巨岩(mix.bare 佔多 → borderrock;視覺牆選型走宣告,建物才要圖資背書)');
    }
  }
}

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
process.exit(fail ? 1 : 0);
