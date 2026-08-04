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
//   Ⅴ 消費端單一縫 —— biomes.js 的接線(一份實作一個呼叫點、零共享 rnd、朝向公式共用)
//
// 反向驗證(原則 9):
//   --break-line    進深上限撐破排距 ⇒ Ⅰ 的排距不變式與後棟淨距 MUST 紅字
//   --break-shy     冠緣間隙歸零 ⇒ Ⅲ 的「冠緣不相碰」MUST 紅字
//   --break-strike  長軸抖動放大 ⇒ Ⅳ 的「長軸同向」MUST 紅字
import { readSrc } from './audit_src.mjs';

const BREAK_LINE = process.argv.includes('--break-line');
const BREAK_SHY = process.argv.includes('--break-shy');
const BREAK_STRIKE = process.argv.includes('--break-strike');

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
const { partExtent } = new Function(`
  ${bcn.slice(b0, b1).replace(/^export /gm, '')}
  return { partExtent };
`)();

const M = new Function('partExtent', `
  ${pureSrc.replace(/^export /gm, '')}
  return { URBAN, urbanRowPitch, CIVIC, CIVIC_KINDS, CIVIC_ORDER, CIVIC_PARTS, CIVIC_TREES,
           plotSeed, frac, roadFaceRy, planBlocks, civicExtent, partCollider, civicColliders,
           CROWN, crownGap, planShyGrove, ROCKFIELD, strikeRad, planRockField };
`)(partExtent);

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
  // 冠幅推導不手寫
  ok(/function giantCrownR\(/.test(bio), '冠幅由 giantCrownR 推導');
  ok(!/\bcr:\s*\d+(\.\d+)?\s*[,}]/.test(strip(bio.slice(bio.indexOf('const GIANT_DEFS'), bio.indexOf('const GIANT_DECO')))),
    'GIANT_DEFS 沒有手寫的冠幅欄(推導值 MUST NOT 手寫)');
  ok(/parameters/.test(strip(bio.slice(bio.indexOf('function giantCrownR'), bio.indexOf('function placeGiantGroves')))),
    'giantCrownR 由零件表的幾何參數推導(不是抄一組常數)');
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
  let ranErr = null, out = null, seeds = null;
  try {
    // `infillSeeds` 是這一段的產出之一(補間的種子名冊),一併取回來驗
    [out, seeds] = new Function(...names, `${blockSrc}\n return [civics, infillSeeds];`)(...names.map((k) => env[k]));
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
    const run = (g0, lm = [], segs = null) => {
      const b2 = [], it2 = {}, ad2 = [];
      const e2 = { ...env, generic: g0, landmarks: lm, items: it2, blockers: b2,
        ...(segs ? { frontSegs: segs } : {}), group: { add: (g) => ad2.push(g) } };
      const [, sd] = new Function(...names, `${blockSrc}\n return [civics, infillSeeds];`)(...names.map((k) => e2[k]));
      return { added: g0.length - (Array.isArray(g0) ? 0 : 0), civics: ad2.length, seeds: sd };
    };
    const g2 = [{ x: 5000, z: 5000, w: 20, d: 20 }];
    const r2 = run(g2);
    ok(g2.length === 1 && r2.civics === 0, '**市區閘**:聚落在 5km 外 ⇒ 這條街一棟都不配、一處公設都不劃');

    // ---- 孤立設施(2026-08-04 使用者回報「太魯閣、合歡山不在市區還這麼多建築」)----
    // 峽谷/草原上真實圖資往往只有一兩棟(遊客中心、工務段、山廟)。舊制的市區閘只問
    // 「±1 格內有沒有建物」⇒ 那一棟就足以讓整條省道兩旁長出街屋,而那批街屋又回頭當
    // 補間種子。閘門改成局部標準化的密度之後,這一組 MUST 是**零產出**;跨過最小街廓
    // (9 棟)才照配 —— 兩組的差別只有密度,證明量到的是「街廓」而不是「附近有房子」。
    for (const n of [1, 3, 8]) {
      const gN = cluster(n);
      const rN = run(gN);
      ok(gN.length === n && rN.civics === 0 && rN.seeds.length === 0,
        `**孤立設施**:路旁只有 ${n} 棟圖資建物(< 最小街廓 9 棟)⇒ 一棟都不配、補間種子也是 0`);
    }
    {
      const gN = cluster(9);
      const rN = run(gN);
      ok(gN.length > 9 && rN.seeds.length === 9,
        `門檻上緣:密到一塊最小街廓(9 棟)⇒ 照配(+${gN.length - 9} 棟),補間種子 9 棵`);
    }
    // 地標本身就是聚落的證據(車站/廟宇/體育場…)⇒ 與建物同權計數
    {
      const gN = cluster(5);
      const lm = Array.from({ length: 5 }, (_, i) => ({ x: 10 + (i % 4) * 30, z: 70 }));
      const rN = run(gN, lm);
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
      const rN = run(gN, [], longSeg);
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

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
process.exit(fail ? 1 : 0);
