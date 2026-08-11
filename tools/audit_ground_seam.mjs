// 地貌交界外溢(邊界鋸齒改制 + 逐組合交界樣式 2026-07-29)稽核 —— node tools/audit_ground_seam.mjs
// 使用者回報①「不同類型的地貌邊界常常形成非常不自然的鋸齒」②「真實世界的邊界通常
// 不是用融合的,不同類型地貌有各自多元的邊界,有的明確、有的有各種中間過渡樣態」。
// 新制 = planSeamOverlays 角點隸屬度雙線性淡出(dual-grid;含對角鄰、兩側對稱互溢、
// 崖/圖界正規化)+ SEAM_STYLES 逐分區組合樣式(明確 sharp / 柔和 soft / 斑塊 dither /
// 中間過渡帶 mid)+ seamAlpha 頂點塑形 + 每 key 微升差與同雜湊繪序。
// 本稽核「執行 ground.js 真正的原文」(四個 export 皆零依賴純函式/純資料,抽原文 eval):
//   Ⅰ 配置直測(直線交界對稱互溢 / 對角補角 / 孤格軟化 / 崖面淡出連續 / null 不收不溢
//      / 值域去重 / 與獨立鏡射實作全等 / 決定性 / 水密)
//   Ⅱ 鋸齒量測(45° 斜向交界:雙線性 0.5 等值線長度比 ≈ 1.0,舊制 cell 邊階梯 = √2)
//   Ⅲ 對照組(反向驗證內建):拿掉對角鄰 / 正規化寫回 /4
//   Ⅳ 靜態規則(單一縫 / spillPair 不得回歸 / 塑形端點歸零 / 微升差與脊帶 lift 不越
//      fade 下限 / renderOrder 恆 <0 / 純函式零 rnd)
//   Ⅴ 逐組合交界樣式(明確/柔和/斑塊/中間樣態帶 + 脊帶三水密不變式 + seamAlpha 直測
//      + 對照組ⓒ單邊帶公式 ⓓ逐格閘門)
'use strict';
import { readSrc } from './audit_src.mjs';

let fail = 0;
const bad = (m) => { console.log('  ✗', m); fail++; };
const ok = (m) => console.log('  ✓', m);

const src = readSrc('public', 'js', 'ground.js');

// ===== 抽原文(零依賴 → eval 執行真品)=====
const stylesM = src.match(/export const SEAM_STYLES = \{[\s\S]*?\n\};/);
const softM = src.match(/export const SEAM_SOFT = .*$/m);
const alphaM = src.match(/export function seamAlpha\(a, q, st\) \{[\s\S]*?\n\}/);
const fnM = src.match(/export function planSeamOverlays\(keys, gnx, gnz, opts = \{\}\) \{[\s\S]*?\n\}/);
if (!stylesM || !softM || !alphaM || !fnM) {
  bad('ground.js 找不到 SEAM_STYLES / SEAM_SOFT / seamAlpha / planSeamOverlays 原文');
  console.log(`\nFAIL(${fail} 項)`); process.exit(1);
}
const build = (planText) => new Function(`
  ${stylesM[0].replace('export ', '')}
  ${softM[0].replace('export ', '')}
  ${alphaM[0].replace('export ', '')}
  ${planText.replace('export ', '')}
  return { planSeamOverlays, seamAlpha, SEAM_STYLES, SEAM_SOFT };
`)();
const { planSeamOverlays, seamAlpha, SEAM_STYLES, SEAM_SOFT } = build(fnM[0]);

// ===== 工具:格網建構 / 輸出索引 =====
const grid = (gnx, gnz, fn) => {
  const keys = new Array(gnx * gnz).fill(null);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) keys[j * gnx + i] = fn(i, j);
  return keys;
};
const index = (out) => {
  const m = new Map();
  for (const ov of out) {
    const k = `${ov.i},${ov.j},${ov.key}`;
    if (m.has(k)) m.set(k, 'DUP');
    else m.set(k, ov.alphas);
  }
  return m;
};
const eq4 = (a, b) => a && b && a !== 'DUP' && a.length === 4 && a.every((v, k) => Math.abs(v - b[k]) < 1e-12);
// 共享角點水密:任兩張同 key 外溢/脊帶格,在同一角點的 α 必須逐位元相同
const cornerTight = (items) => {
  const cw = new Map();
  for (const ov of items) {
    const corners = [[ov.i, ov.j, 0], [ov.i + 1, ov.j, 1], [ov.i + 1, ov.j + 1, 2], [ov.i, ov.j + 1, 3]];
    for (const [ci, cj, k] of corners) {
      const ck = `${ci},${cj},${ov.key}`;
      if (cw.has(ck) && Math.abs(cw.get(ck) - ov.alphas[k]) > 1e-12) return false;
      cw.set(ck, ov.alphas[k]);
    }
  }
  return true;
};

console.log('== Ⅰ planSeamOverlays 配置直測(執行原文)==');
{
  // ① 直線交界:左半 A、右半 B(邊界在 i=3|4)→ 兩側對稱互溢、共享邊角點 0.5
  const N = 8;
  const keys = grid(N, N, (i) => i < 4 ? 'A#0' : 'B#0');
  const out = planSeamOverlays(keys, N, N);
  const idx = index(out);
  const aSide = idx.get('3,3,B#0'), bSide = idx.get('4,3,A#0');
  eq4(aSide, [0, 0.5, 0.5, 0]) ? ok('直線交界 A 側收 B 外溢,共享邊角點 α=0.5、對邊 0(對稱淡出)')
    : bad(`直線交界 A 側外溢 alphas=${JSON.stringify(aSide)} ≠ [0,.5,.5,0]`);
  eq4(bSide, [0.5, 0, 0, 0.5]) ? ok('直線交界 B 側收 A 外溢(兩側互溢 → 交界中線 50/50 混色)')
    : bad(`直線交界 B 側外溢 alphas=${JSON.stringify(bSide)} ≠ [.5,0,0,.5]`);
  (!idx.has('1,3,B#0') && !idx.has('6,3,A#0'))
    ? ok('離交界一格以上的內部格不收外溢(過渡帶寬恰兩格)')
    : bad('內部格出現外溢(過渡帶失控)');
  const nA = out.filter((o) => o.key === 'A#0').length, nB = out.filter((o) => o.key === 'B#0').length;
  nA === nB ? ok(`兩側外溢張數對稱(${nA}=${nB})`) : bad(`兩側外溢張數不對稱 A=${nA} B=${nB}`);

  // ② 對角補角:A 海中單一 B 格 → 對角鄰格也收 B 外溢(α=0.25 在共享角),階梯轉角無缺口
  const keys2 = grid(N, N, (i, j) => (i === 3 && j === 3) ? 'B#0' : 'A#0');
  const out2 = planSeamOverlays(keys2, N, N);
  const idx2 = index(out2);
  const diag = idx2.get('2,2,B#0');
  eq4(diag, [0, 0, 0.25, 0]) ? ok('對角鄰格收外溢(共享角 α=0.25)→ 階梯轉角缺口補齊')
    : bad(`對角鄰格外溢 alphas=${JSON.stringify(diag)} ≠ [0,0,0.25,0]`);
  out2.filter((o) => o.key === 'B#0').length === 8
    ? ok('單格周圍 8 鄰(4 邊 + 4 對角)全數收到外溢')
    : bad(`單格外溢鄰格數 ${out2.filter((o) => o.key === 'B#0').length} ≠ 8`);

  // ③ 孤格軟化:B 海中單一 A 格(影像分類雜訊斑點)→ 自身收 B 外溢四角 0.75,被鄰區吞掉
  const keys3 = grid(N, N, (i, j) => (i === 3 && j === 3) ? 'A#0' : 'B#0');
  const island = index(planSeamOverlays(keys3, N, N)).get('3,3,B#0');
  eq4(island, [0.75, 0.75, 0.75, 0.75]) ? ok('孤立單格四角收 0.75 外溢(分類雜訊斑點被軟化)')
    : bad(`孤格外溢 alphas=${JSON.stringify(island)} ≠ [.75,.75,.75,.75]`);

  // ④ 崖面淡出連續:左半 A、右半 '!' 崖 → 崖格收 A 外溢且共享邊角點 α=1(正規化分母只算有毯格)
  //    = 與不透明底毯無縫銜接;A 側不收、'!' 不外溢
  const keys4 = grid(N, N, (i) => i < 4 ? 'A#0' : '!');
  const out4 = planSeamOverlays(keys4, N, N);
  const idx4 = index(out4);
  const cliff = idx4.get('4,3,A#0');
  eq4(cliff, [1, 0, 0, 1]) ? ok("崖('!')格收底毯外溢且共享邊 α=1 → 不透明底毯 → 崖面連續無階差")
    : bad(`崖格外溢 alphas=${JSON.stringify(cliff)} ≠ [1,0,0,1](正規化分母失守)`);
  out4.every((o) => o.key !== '!') ? ok("'!' 不作為外溢來源") : bad("'!' 被當外溢來源");
  !idx4.has('3,3,!') && out4.every((o) => !(o.i === 3 && o.j === 3))
    ? ok('崖旁的底毯格不收崖外溢(單向淡出)') : bad('底毯格收到崖側外溢');

  // ⑤ null(未鋪:水色灰帶/岸線)不收不溢
  const keys5 = grid(N, N, (i) => i < 4 ? 'A#0' : null);
  const out5 = planSeamOverlays(keys5, N, N);
  out5.length === 0 ? ok('null 未鋪格不收外溢也不外溢(留空露衛星底圖,行為同舊制)')
    : bad(`null 交界產生 ${out5.length} 張外溢`);

  // ⑥ 值域 / 去重 / 自 key 不外溢(隨機格網 ×3 seed,摻 '!' 與 null)
  let lcg = 12345;
  const rndi = (n) => { lcg = (lcg * 1103515245 + 12345) & 0x7fffffff; return lcg % n; };
  const POOL = ['A#0', 'A#1', 'B#0', 'C#2', '!', null];
  let allOk = true, refOk = true;
  // 獨立鏡射實作(語意同、寫法異;無樣式表 = 全預設柔和):角點權重 = 圍角四格中該 key
  // 的比例(分母 = 有毯格)
  const refPlan = (keys, gnx, gnz) => {
    const at = (i, j) => (i >= 0 && j >= 0 && i < gnx && j < gnz) ? keys[j * gnx + i] : null;
    const w = (k, ci, cj) => {
      const cells = [at(ci - 1, cj - 1), at(ci, cj - 1), at(ci - 1, cj), at(ci, cj)]
        .filter((c) => c != null && c !== '!');
      return cells.length ? cells.filter((c) => c === k).length / cells.length : 0;
    };
    const res = [];
    for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) {
      const k0 = at(i, j);
      if (k0 == null) continue;
      const near = new Set();
      for (const [oi, oj] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const kn = at(i + oi, j + oj);
        if (kn != null && kn !== '!' && kn !== k0) near.add(kn);
      }
      for (const kn of near) {
        const al = [w(kn, i, j), w(kn, i + 1, j), w(kn, i + 1, j + 1), w(kn, i, j + 1)];
        if (al.some((v) => v > 0)) res.push({ i, j, key: kn, alphas: al });
      }
    }
    return res;
  };
  for (let t = 0; t < 3; t++) {
    const keys6 = grid(12, 12, () => POOL[rndi(POOL.length)]);
    const out6 = planSeamOverlays(keys6, 12, 12);
    const idx6 = index(out6);
    for (const ov of out6) {
      if (ov.alphas.some((v) => v < 0 || v > 1)) { allOk = false; bad(`α 越界 ${JSON.stringify(ov)}`); }
      if (ov.key === keys6[ov.j * 12 + ov.i]) { allOk = false; bad('外溢 key = 目標格自身 key'); }
    }
    for (const v of idx6.values()) if (v === 'DUP') { allOk = false; bad('同格同 key 重複外溢'); }
    const ridx = index(refPlan(keys6, 12, 12));
    if (ridx.size !== idx6.size) refOk = false;
    else for (const [k, v] of ridx) if (!eq4(idx6.get(k), v)) refOk = false;
  }
  if (allOk) ok('隨機格網:α ∈ [0,1]、同格同 key 至多一張、自 key 不外溢');
  refOk ? ok('與獨立鏡射實作逐項全等(角點權重守恆/正規化/8 鄰語意)')
    : bad('原文與鏡射實作結果不一致');

  // ⑦ 決定性:同輸入重呼位元相同
  const keys7 = grid(10, 10, (i, j) => POOL[(i * 7 + j * 13) % 4]);
  JSON.stringify(planSeamOverlays(keys7, 10, 10)) === JSON.stringify(planSeamOverlays(keys7, 10, 10))
    ? ok('同輸入重呼結果位元相同(§2.3 跨客戶端一致)') : bad('重呼結果不一致');

  // ⑧ 水密:相鄰同 key 外溢格在共享角點的 α 相同(階梯交界全掃)
  const keys8 = grid(N, N, (i, j) => i + j < N ? 'A#0' : 'B#0');
  cornerTight(planSeamOverlays(keys8, N, N))
    ? ok('斜向階梯交界:同 key 外溢在共享角點 α 逐位元相同(拼面水密)')
    : bad('共享角點 α 不一致(外溢格間開縫)');
}

console.log('== Ⅱ 鋸齒量測(45° 斜向交界的 0.5 等值線)==');
{
  // 角點權重場的雙線性 0.5 等值線 = 玩家看到的混色中線。
  // 舊制:可見交界 = 底毯 cell 邊階梯,45° 邊界長度比 = √2 ≈ 1.414(90° 鋸齒)。
  // 新制:marching squares 逐 cell 取等值段,總長 / 直線距 應 ≈ 1.0(階梯被削成平滑斜線)。
  const N = 24;
  const keys = grid(N, N, (i, j) => i + j < N ? 'A#0' : 'B#0');
  const at = (i, j) => (i >= 0 && j >= 0 && i < N && j < N) ? keys[j * N + i] : null;
  const w = (ci, cj) => {
    const cells = [at(ci - 1, cj - 1), at(ci, cj - 1), at(ci - 1, cj), at(ci, cj)].filter((c) => c != null);
    return cells.length ? cells.filter((c) => c === 'B#0').length / cells.length : 0;
  };
  const ISO = 0.5 + 1e-9;
  let len = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = [[i, j, w(i, j)], [i + 1, j, w(i + 1, j)], [i + 1, j + 1, w(i + 1, j + 1)], [i, j + 1, w(i, j + 1)]];
    const pts = [];
    for (let e = 0; e < 4; e++) {
      const [x0, z0, v0] = c[e], [x1, z1, v1] = c[(e + 1) % 4];
      if ((v0 < ISO) !== (v1 < ISO)) {
        const t = (ISO - v0) / (v1 - v0);
        pts.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
      }
    }
    if (pts.length === 2) len += Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  }
  const straight = Math.hypot(N, N) - Math.hypot(2, 2);
  const ratio = len / straight;
  (ratio > 0.9 && ratio < 1.08)
    ? ok(`45° 交界等值線長度比 ${ratio.toFixed(3)} ≈ 1.0(舊制 cell 邊階梯 = ${Math.SQRT2.toFixed(3)})→ 90° 鋸齒被削平`)
    : bad(`45° 交界等值線長度比 ${ratio.toFixed(3)} 偏離 1.0(平滑化失效;舊制 ${Math.SQRT2.toFixed(3)})`);
}

console.log('== Ⅲ 對照組(反向驗證內建:壞版本必須被 Ⅰ 抓到)==');
{
  // ⓐ 拿掉對角鄰(寫回「只看四鄰」)→ 對角補角消失
  const edgeOnlyText = fnM[0].replace('if (!oi && !oj) continue;', 'if (Math.abs(oi) + Math.abs(oj) !== 1) continue;');
  if (edgeOnlyText === fnM[0]) bad('對照組 ⓐ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const edgeOnly = build(edgeOnlyText).planSeamOverlays;
    const N = 8;
    const keys = grid(N, N, (i, j) => (i === 3 && j === 3) ? 'B#0' : 'A#0');
    const out = edgeOnly(keys, N, N);
    (!index(out).has('2,2,B#0') && out.filter((o) => o.key === 'B#0').length === 4)
      ? ok('對照組ⓐ:只看四鄰的壞版本確實漏掉對角補角(Ⅰ-② 有牙)')
      : bad('對照組ⓐ:壞版本竟仍補了對角(Ⅰ-② 驗不到東西)');
  }
  // ⓑ 正規化寫回 /4 → 崖面交界 α 只到 0.5,與不透明底毯出現階差
  const div4Text = fnM[0].replace('return valid ? n / valid : 0;', 'return n / 4;');
  if (div4Text === fnM[0]) bad('對照組 ⓑ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const div4 = build(div4Text).planSeamOverlays;
    const N = 8;
    const keys = grid(N, N, (i) => i < 4 ? 'A#0' : '!');
    const cliff = index(div4(keys, N, N)).get('4,3,A#0');
    (cliff && Math.abs(cliff[0] - 0.5) < 1e-12)
      ? ok('對照組ⓑ:/4 壞版本崖邊 α=0.5(≠1)→ Ⅰ-④ 的連續性檢查有牙')
      : bad('對照組ⓑ:壞版本未呈現預期缺陷(Ⅰ-④ 驗不到東西)');
  }
}

console.log('== Ⅳ 靜態規則(單一縫 / 舊制不回歸 / 圖層與塑形紀律)==');
{
  /for \(const ov of planSeamOverlays\(keys, gnx, gnz, \{ coarseOf: coarseOfKey, seed, variants: VARIANTS \}\)\)/.test(src)
    ? ok('buildGroundCover 經 planSeamOverlays 發外溢且傳入 coarse 分區查詢(單一縫)')
    : bad('外溢發射未走 planSeamOverlays / 未接分區樣式(第二份實作?)');
  src.includes('emitCell(ov.st?.band ? bandBuckets : spillBuckets, ov.key, ov.i, ov.j, ov.alphas, ov.st)')
    ? ok('中間樣態脊帶進獨立 bandBuckets(與一般外溢分桶)')
    : bad('脊帶未分桶(renderOrder/lift 會與一般外溢打架)');
  !src.includes('spillPair') ? ok('舊制 spillPair(單向整格外溢)已移除,不得回歸')
    : bad('spillPair 仍存在(舊制回歸)');
  (src.includes('a = seamAlpha(a, qcVal(px, pz, SEAM_QC_W), st)') && /if \(alphas && a > 0 && a < 1\) \{/.test(src))
    ? ok('emitCell 交界塑形只走 seamAlpha 且只作用外溢層(單一縫)')
    : bad('emitCell 塑形缺失或另寫第二份');
  (alphaM[0].includes('if (a <= 0) return 0;') && alphaM[0].includes('if (a >= 1) return 1;')
    && alphaM[0].includes('a * (1 - a) * 4'))
    ? ok('seamAlpha 端點恆定 + band 包絡(與不透明底毯水密)')
    : bad('seamAlpha 端點/包絡紀律缺失');
  const slift = src.match(/SLIFT = ([0-9.]+);/), step = src.match(/% 8\) \* ([0-9.]+);/);
  const bandLift = src.match(/SLIFT \+ ([0-9.]+) : SLIFT \+ seamLift\(key\)/);
  const fadeMin = 0.110;
  (slift && step && (+slift[1]) + 7 * (+step[1]) < fadeMin - 1e-9)
    ? ok(`外溢微升差上限 ${((+slift[1]) + 7 * (+step[1])).toFixed(3)} < 不規律 fade 下限 ${fadeMin}(圖層交會分級不亂)`)
    : bad('外溢微升差越過 fade 下限(或常數漂移)');
  (bandLift && (+slift[1]) + (+bandLift[1]) < fadeMin - 1e-9 && (+bandLift[1]) > 7 * (+step[1]))
    ? ok(`脊帶 lift ${((+slift[1]) + (+bandLift[1])).toFixed(3)}:高於全部一般外溢、仍 < fade 下限`)
    : bad('脊帶 lift 越界或未高於一般外溢');
  (src.includes('if (pass === 1) m.renderOrder = -2 + seamLift(key) * 100') && src.includes('else if (pass === 2) m.renderOrder = -1.2'))
    ? ok('外溢繪序與微升差同雜湊、脊帶 -1.2 恆最後(皆 < 0 早於特徵層)')
    : bad('外溢/脊帶 renderOrder 紀律缺失');
  (!/rnd\(/.test(fnM[0]) && !fnM[0].includes('Math.random') && !fnM[0].includes('THREE'))
    ? ok('planSeamOverlays 原文零 rnd / 零 Math.random / 零 THREE(純函式,A4)')
    : bad('planSeamOverlays 摻入 rnd / Math.random / THREE');
  (src.match(/const subCoarse = new Map\(\)/g) || []).length === 1
    ? ok('subCoarse 分區表只有一份(交界樣式與地貌界線拼圖共用,單一縫)')
    : bad('subCoarse 分區表出現多份實作');
}

console.log('== Ⅴ 逐組合交界樣式(明確/柔和/斑塊/中間樣態帶)==');
{
  // coarse 分區替身:key 首字母 → 分區
  const ZMAP = { G: 'green', B: 'bare', U: 'urban', W: 'wet', A: 'alpine', Q: 'water' };
  const coarseOf = (key) => ZMAP[key[0]];
  const N = 8;
  const opt = { coarseOf, seed: 0xC0FFEE | 0, variants: 6 };

  // ① 明確(人工)邊界:市區交界壓窄 + 低擾動
  const outGU = planSeamOverlays(grid(N, N, (i) => i < 4 ? 'G#0' : 'U#0'), N, N, opt);
  const hard = outGU.find((o) => o.i === 3 && o.j === 3 && o.key === 'U#0');
  (hard && hard.st.sharp === 3.2 && hard.st.noise === 0.12)
    ? ok('綠地↔市區 → 明確邊界樣式(sharp 3.2、noise 0.12:路緣式直線切換)')
    : bad(`綠地↔市區樣式錯誤 st=${JSON.stringify(hard?.st)}`);
  const outUU = planSeamOverlays(grid(N, N, (i) => i < 4 ? 'U#0' : 'U#1'), N, N, opt);
  (outUU.length && outUU.every((o) => o.st.sharp === 3.6))
    ? ok('市區↔市區換鋪面 → 切線最直(sharp 3.6)')
    : bad('市區↔市區樣式未命中 urban|urban');

  // ② 同分區異款 → 預設柔和(green|green 不在表上)
  const outGG = planSeamOverlays(grid(N, N, (i) => i < 4 ? 'G#0' : 'G#1'), N, N, opt);
  (outGG.length && outGG.every((o) => !o.st.sharp && !o.st.dither && !o.st.mid && o.st.noise === 0.4))
    ? ok('同分區異款(草皮↔花田)→ 預設柔和淡出(SEAM_SOFT)')
    : bad('同分區異款未走預設柔和');

  // ③ 雪線斑塊:alpine 交界 dither
  const outAG = planSeamOverlays(grid(N, N, (i) => i < 4 ? 'A#0' : 'G#0'), N, N, opt);
  (outAG.length && outAG.filter((o) => !o.st.band).every((o) => o.st.dither))
    ? ok('高地↔綠地 → 斑塊樣式(dither:雪線/岩屑殘斑,不是漸層也不是直線)')
    : bad('高地↔綠地未走 dither');

  // ④ 中間過渡樣態帶:綠地↔裸露地夾乾草原(steppe),長交界上「間歇」出現。
  //    邊界放在 i=7|8(跨 8 格超格線)—— 變體若逐格/逐區換款,兩側 key 會分家(反向驗證點)
  const M = 48;
  const outGB = planSeamOverlays(grid(16, M, (i) => i < 8 ? 'G#0' : 'B#0'), 16, M, opt);
  const bands = outGB.filter((o) => o.st.band);
  const bandCells = bands.length, maxCells = 2 * M;
  (bandCells > 0 && bandCells < maxCells)
    ? ok(`綠地↔裸露地脊帶「間歇」出現(${bandCells}/${maxCells} 格:時有時無,整條鑲滿反而假)`)
    : bad(`脊帶間歇失效(${bandCells}/${maxCells})`);
  bands.every((o) => o.key.startsWith('steppe#'))
    ? ok('中間樣態 = 乾草原(steppe)—— 生態過渡帶的第三種地表')
    : bad('脊帶 key 非 steppe');
  bands.every((o) => o.alphas.every((v) => v >= 0 && v <= 1))
    ? ok('脊帶 α ∈ [0,1]') : bad('脊帶 α 越界');
  bands.every((o) => (o.i === 7
    ? Math.max(...o.alphas) === Math.max(o.alphas[1], o.alphas[2]) && o.alphas[0] === 0 && o.alphas[3] === 0
    : Math.max(...o.alphas) === Math.max(o.alphas[0], o.alphas[3]) && o.alphas[1] === 0 && o.alphas[2] === 0))
    ? ok('脊帶在 50/50 混色線(共享邊)達峰、內側歸零(蓋住殘縫的位置正確)')
    : bad('脊帶峰位不在交界線上');
  new Set(bands.map((o) => o.key)).size === 1
    ? ok('脊帶全圖單一變體(避免變體換款在帶峰上切出新縫)')
    : bad('脊帶變體不一致(帶峰上會有換款縫)');
  // 三分區交點水密:左欄 G/W 逐列交替、右欄 B ⇒ 交界上每個角點都是 G/W/B 三分區交點
  // (G|B=steppe、B|W=mud 兩種帶沿線交會;48 列保證間歇閘總有開著的段)
  const keysT = grid(8, M, (i, j) => i < 4 ? (j % 2 ? 'W#0' : 'G#0') : 'B#0');
  const outT = planSeamOverlays(keysT, 8, M, opt);
  (outT.some((o) => o.st.band) && cornerTight(outT.filter((o) => o.st.band)))
    ? ok('三分區交點鏈:脊帶兩 key 權重「乘積」對稱 ⇒ 兩側算出同值(共享角逐位元水密)')
    : bad('三分區交點脊帶開縫(乘積對稱失守)');
  cornerTight(outT.filter((o) => !o.st.band))
    ? ok('三分區交點鏈:一般外溢共享角仍水密') : bad('三分區交點一般外溢開縫');
  // 間歇閘決定性:同 seed 同結果、異 seed 帶分佈不同
  const outGB2 = planSeamOverlays(grid(16, M, (i) => i < 8 ? 'G#0' : 'B#0'), 16, M, opt);
  JSON.stringify(outGB) === JSON.stringify(outGB2) ? ok('脊帶間歇閘同 seed 位元相同(§2.3)') : bad('脊帶不決定性');
  const outGB3 = planSeamOverlays(grid(16, M, (i) => i < 8 ? 'G#0' : 'B#0'), 16, M, { ...opt, seed: 0x5EED | 0 });
  JSON.stringify(outGB.filter((o) => o.st.band)) !== JSON.stringify(outGB3.filter((o) => o.st.band))
    ? ok('異 seed → 帶分佈不同(每圖不同貌)') : bad('異 seed 帶分佈退化相同');

  // ⑤ 自然岸:綠地↔水域夾蘆葦緣(marsh);市區↔水域 = 硬岸線無帶
  const outGQ = planSeamOverlays(grid(N, N, (i) => i < 4 ? 'G#0' : 'Q#0'), N, N, opt);
  outGQ.some((o) => o.st.band && o.key.startsWith('marsh#'))
    ? ok('綠地↔水域 → 蘆葦緣帶(marsh;泡沫/潮間帶仍住 buildWaterEdges)')
    : bad('綠地↔水域無蘆葦帶(或 midP 過低致本 seed 全空 —— 檢查 gate)');
  const outUQ = planSeamOverlays(grid(N, N, (i) => i < 4 ? 'U#0' : 'Q#0'), N, N, opt);
  (outUQ.every((o) => !o.st.band) && outUQ.every((o) => o.st.sharp === 3.2))
    ? ok('市區↔水域 → 硬岸線(碼頭/堤岸),無中間樣態帶')
    : bad('市區↔水域樣式錯誤');

  // ⑥ seamAlpha 直測:端點恆定 / 明確壓窄 / 斑塊二值化 / 柔和擾動有界
  const styles = [undefined, SEAM_SOFT, { sharp: 3.2, noise: 0.12 }, { dither: 1 }];
  let endOk = true;
  for (const st of styles) for (const q of [-1, -0.3, 0, 0.7, 1]) {
    if (seamAlpha(0, q, st) !== 0 || seamAlpha(1, q, st) !== 1) endOk = false;
  }
  endOk ? ok('seamAlpha 全樣式端點恆定(α=0→0、1→1)⇒ 交界帶盡頭與不透明底毯無縫')
    : bad('seamAlpha 端點漂移');
  (seamAlpha(0.3, 0, { sharp: 3.2 }) === 0 && seamAlpha(0.7, 0, { sharp: 3.2 }) === 1)
    ? ok('明確樣式:0.3/0.7 被壓到 0/1(過渡帶壓窄約 ×3.2)') : bad('sharp 壓窄失效');
  (seamAlpha(0.5, -1, { dither: 1 }) === 0 && seamAlpha(0.5, 1, { dither: 1 }) === 1)
    ? ok('斑塊樣式:帶中央隨場值推成 0/1 斑塊(殘雪語彙)') : bad('dither 二值化失效');
  let softOk = true;
  for (let a = 0.05; a < 1; a += 0.05) for (const q of [-1, 0, 1]) {
    const r = seamAlpha(a, q, SEAM_SOFT);
    if (r < 0 || r > 1) softOk = false;
  }
  softOk ? ok('柔和樣式:擾動後 α 全程有界 [0,1]') : bad('柔和擾動越界');

  // ⑦ 對照組(反向驗證內建)
  // ⓒ 脊帶公式寫回單邊 w(1−w) → 三分區交點兩側算出不同值 → 水密紅字
  const oneSideText = fnM[0].replace('bandAl[c] = 4 * wS * wF * gateAt(', 'bandAl[c] = 4 * wF * (1 - wF) * gateAt(');
  if (oneSideText === fnM[0]) bad('對照組 ⓒ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const oneSide = build(oneSideText).planSeamOverlays;
    !cornerTight(oneSide(keysT, 8, M, opt).filter((o) => o.st.band))
      ? ok('對照組ⓒ:單邊帶公式在三分區交點開縫(乘積對稱檢查有牙)')
      : bad('對照組ⓒ:壞版本未呈現預期缺陷(檢查驗不到東西)');
  }
  // ⓓ 間歇閘寫回逐格(吃格索引不吃角點)→ 相鄰帶格共享角不同值 → 水密紅字
  const cellGateText = fnM[0].replace('bandAl[c] = 4 * wS * wF * gateAt(cs[c][0], cs[c][1], st.midP ?? 0.5);',
    'bandAl[c] = 4 * wS * wF * gateAt(i, j, st.midP ?? 0.5);');
  if (cellGateText === fnM[0]) bad('對照組 ⓓ 替換點失配(原文已漂移,請同步稽核)');
  else {
    const cellGate = build(cellGateText).planSeamOverlays;
    const outBad = cellGate(grid(8, M, (i) => i < 4 ? 'G#0' : 'B#0'), 8, M, opt);
    !cornerTight(outBad.filter((o) => o.st.band))
      ? ok('對照組ⓓ:逐格閘門在帶內切出格邊硬縫(角點閘檢查有牙)')
      : bad('對照組ⓓ:壞版本未呈現預期缺陷(檢查驗不到東西)');
  }
}

console.log(fail ? `\nFAIL(${fail} 項)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
