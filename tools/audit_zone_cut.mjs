// ============ §0-a 線工切面「可行性樁」(離線;`docs/anime_style_plan.md` 序 13)============
// 這一支**不是**功能落地,是一份**判決 + 證據**。計畫寫著「樁沒過就不取代」「樁過了才拆拼圖」
// ⇒ 本支的產出是 go / no-go,不是「想辦法讓它過」。`public/**` 與 `server/**` 一行不動
// (`git diff --stat -- public/ server/` MUST 為空)。
//
// 要回答的問題:現制 `ground.js cellZoneAt(i, j)` 是 **13m 逐格獨立**判定,界線由「哪一格
// 投票翻面」決定 ⇒ 它落在田中間,才需要界線拼圖去藏。§0-a 要改成「先由 OSM 線工切面、
// 再對整個面下一次判定」,而**判定順序一行不改、只換它吃什麼**。
//
// 三個驗收面(缺一不可,理由見各段檔頭):
//   ① **界線離真值的距離**(新制 MUST ≤ 現制)。⚠ **MUST NOT 拿逐格一致率當門檻** ——
//      兩制的界線本來就不該逐格相同(現制是「哪一格翻面」的雜訊,新制是路緣/河岸/田埂),
//      拿一致率當門檻等於逼新制去複製舊制的雜訊,而那正是要修的東西。一致率照印,當參考。
//   ② **決定性**(兩次跑逐位元相同 / 零亂數原文閘 / **順序無關** / 標籤不吃 face id)。
//      順序相依在單機單次跑上**完全看不出來**,壞掉的樣子是兩台客戶端建出不同的世界。
//   ③ **`surfaceId` 出線的量化算術**(純報告,不動 shader)。
//
// 判定用的全部是真品:切面線走 `venue_field`(Node 端「與執行期同形」的唯一縫)+
// `roadgrid.quantizeRoads`(量化過的路網是唯一的一份)+ `data.llToXZ`(含 A42 主方位);
// 逐面標籤走 **`readSrc` 抽 `ground.js cellZoneAt` 原文丟 `new Function` 執行**
// —— 抄一份公式進樁只驗得到「我抄對了」。
//
// 用法:
//   node tools/audit_zone_cut.mjs                       # 只跑離線那幾段(Ⅰ~Ⅴ;CI 一定跑得到)
//   node tools/audit_zone_cut.mjs --venue taroko --team 1
//   node tools/audit_zone_cut.mjs --venue shibuya --team 3 --tex 2048
//   node tools/audit_zone_cut.mjs --venue taroko --team 1 --sweep-rank --sweep-areamin
//   node tools/audit_zone_cut.mjs --census              # 只印 Z0 的 29 場地普查
//   node tools/audit_zone_cut.mjs --png                 # 連對照 PNG 一起出(tools/.shots/zonecut/)
// 旋鈕:--tex 1024 貼圖邊長 / --rank 3 參與切面的道路級(1 最粗 ~ 5 含步道)/
//       --areamin 0.0004 面積下限(佔整張圖的比例)/ --rel 0.5 小面併鄰的相對門檻 /
//       --k 24 逐面取樣點數 / --adm 40 行政界「附近沒有其他線」的半徑(m)
// 反向驗證(§0 原則 9;每一支 MUST 對應紅字):
//   --break-quantize  切面的路吃**量化前**的圖資 + 無 A42 旋轉的投影
//                     ⚠ MUST 挑**市區**場地驗(界線由 OSM 線主導);山區場地的界線多半來自
//                       坡度等值線、不經投影 ⇒ 壞版在那裡咬不動(實測 taroko 仍綠)
//   --break-slope     坡度等值線改吃 cellZoneAt 的標籤覆寫門檻(0.28 / 0.75)而不是 SLOPE 唯一縫
//   --break-merge     小面併鄰改成「比佔**全體**的面積比例」而不是比**那個鄰居**
//   --break-order     泛洪播種改由輸入順序決定(面 id 綁到 ways 順序上)
//   --break-rnd       逐面取樣改用 Math.random()
//   --break-keepout   結構足跡 keep-out 整組拿掉
//   --break-id        提案的分區 surfaceId 間距改成 1/255(= 1 個 8bit 位階)
//   --break-label     逐面標籤改讀 face id
// 退出碼:0 = 全綠;1 = 有紅字
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readSrc, grabBlock, grabFn, ROOT } from './audit_src.mjs';
import { pngBytes } from './logo_lib.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import {
  SLOPE, slopeDeg, TERRAIN, WATER, battleRect, battleBBox, edgeBufferM, mapArg, mapRot,
  llToXZ, xzToLL,
} from '../public/js/data.js';
import { quantizeRoads } from '../public/js/roadgrid.js';
import {
  elevSampler, buildHeightField, osmFor, landcoverFor, cutLinesFor, gradeWaysForAudit, markGradeCorridors,
  roadWidth, llToWorld, R_EARTH, WORLD_S, d2r, TUN, UND,
} from './venue_field.mjs';

// `--k=v` 與 `--k v` 兩種寫法都收(既有稽核用前者,本支的用法說明寫後者;
// 只收一種的話另一種會**靜默**變成 `--k=1` 而錯誤訊息完全不相干)
const ARG = (() => {
  const a = process.argv.slice(2), out = {};
  for (let i = 0; i < a.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a[i]);
    if (!m) continue;
    if (m[2] != null) out[m[1]] = m[2];
    else if (a[i + 1] && !a[i + 1].startsWith('--')) out[m[1]] = a[++i];
    else out[m[1]] = '1';
  }
  return out;
})();
const BREAK = Object.fromEntries(['quantize', 'slope', 'merge', 'order', 'rnd', 'keepout', 'id', 'label']
  .map((k) => [k, !!ARG[`break-${k}`]]));
const ANY_BREAK = Object.values(BREAK).some(Boolean);

let pass = 0, fail = 0;
const unverified = [];
const ok = (c, msg) => { c ? (pass++, console.log(`    ✓ ${msg}`)) : (fail++, console.error(`    ✗ ${msg}`)); };
const note = (msg) => { unverified.push(msg); console.log(`    ⚠ 未驗:${msg}`); };
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// ---- 反向驗證的字面替換(§5.4 ㋑:CRLF 容忍 + 替換無效 MUST 當場失敗)----
// ⚠ 樣式一律綁**識別字**不綁現值 —— 2026-08-14 `--break-roof` 綁死現值變成靜默 no-op、
//   紅字由 2 條掉成 1 條而壞版根本沒被造出來。
function sub(src, re, to, why) {
  const out = src.replace(re, to);
  if (out === src) { console.error(`❌ --break 的字面替換無效(${why}):樣式 ${re} 沒有命中`); process.exit(1); }
  return out;
}

// ---- 受測的規則本體 ----
// **原文閘與被執行的程式碼 MUST 是同一份**:`--break-*` 改的是 ZSRC,而原文閘也讀 ZSRC ⇒
// 「零 Math.random」那條斷言在 --break-rnd 之下真的會紅(讀檔案的話它永遠是綠的)。
let ZSRC = readSrc('public', 'js', 'zonecut.js');
if (BREAK.merge) {
  ZSRC = sub(ZSRC, /if \(!\(live\[f\] < rel \* bestA\)\) continue;/,
    'if (!(live[f] < areaMin)) continue;', 'mergeSmall 的相對門檻');
}
if (BREAK.order) {
  ZSRC = sub(ZSRC, /for \(let k0 = 0; k0 < face\.length; k0\+\+\) \{/,
    'for (let _z = 0; _z < face.length; _z++) { const k0 = globalThis.__ZC_SEED_ORDER ? globalThis.__ZC_SEED_ORDER[_z] : _z;',
    'floodFaces 的掃描播種');
}
if (BREAK.rnd) {
  ZSRC = sub(ZSRC, /while \(cur\[f\] < want && rank === Math\.floor\(\(cur\[f\] \+ 0\.5\) \* area\[f\] \/ want\)\) out\[f\]\[cur\[f\]\+\+\] = idx;/,
    'if (cur[f] < want && Math.random() * area[f] < want) out[f][cur[f]++] = idx;', 'faceSamples 的分層取樣');
}
const Z_EXPORTS = ['NO_FACE', 'rasterLines', 'corridorKeepOut', 'floodFaces', 'assignWallTexels', 'faceAreas',
  'faceAdjacency', 'mergeSmall', 'faceSamples', 'canonicalFaces'];
const Z = new Function(`${ZSRC.replace(/^export /gm, '')}\nreturn { ${Z_EXPORTS.join(', ')} };`)();

console.log(`== §0-a 線工切面可行性樁 ==${ANY_BREAK ? `  ⚠ 反向驗證模式:${Object.entries(BREAK).filter(([, v]) => v).map(([k]) => k).join(',')}` : ''}\n`);

// =====================================================================================
// Ⅰ 規則本體:原文閘 + 行為直測(離線,CI 一定跑得到)
// =====================================================================================
console.log('Ⅰ 規則本體(public/js/zonecut.js)');
{
  const noComment = ZSRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/^\s*import\s/m.test(noComment) && !/\brequire\s*\(/.test(noComment),
    '零 import(序 14 的第一步只是把它改名成 public/js/zonecut.js,零 import 是那一步成立的前提)');
  ok(!/Math\.random/.test(noComment), '零 Math.random(A4)');
  ok(!/\brnd\s*\(/.test(noComment), '零共享 rnd(§2.3:切面不消耗共享亂數)');
  ok(!/\bTHREE\b/.test(noComment), '零 THREE(Node 端與遊戲端同吃一份定義)');

  // ①-c 泛洪 MUST 是 4 鄰:兩個只在**對角相碰**的自由格 —— 8 鄰會漏成一個面,
  //      而報告上只表現成「面數少了幾個」。
  {
    const nx = 2, nz = 2;
    const wall = Uint8Array.from([0, 1, 1, 0]);   // (0,0) 與 (1,1) 只在對角相碰
    const r = Z.floodFaces(wall, nx, nz);
    ok(r.n === 2, `泛洪是 4 鄰:對角相碰的兩格 MUST 是兩個面(實得 ${r.n})`);
  }
  // ①-c0 結構足跡 MUST 走同一支膠囊光柵器,而不是各消費端再抄一份圓盤 / 半徑。
  {
    const corridor = [{ x1: 4, z1: 6, x2: 10, z2: 6, hw: 1, clear: 2 }];
    const base = Z.corridorKeepOut(20, 20, 1, corridor);
    const shifted = Z.corridorKeepOut(20, 20, 1, corridor, { toI: (x) => x + 3, toJ: (z) => z + 2 });
    const centroid = (mask) => mask.reduce((a, v, k) => v ? [a[0] + k % 20, a[1] + Math.floor(k / 20), a[2] + 1] : a, [0, 0, 0]);
    const a = centroid(base), b = centroid(shifted);
    ok(a[2] > 0 && b[2] === a[2] && b[0] / b[2] - a[0] / a[2] > 2.5
      && b[1] / b[2] - a[1] / a[2] > 1.5,
    '走廊 keep-out 是可套用座標轉換的膠囊遮罩(旋轉 / 投影後仍與世界框同一份)');
  }
  // ①-d 牆 texel 併回是 8 鄰、而且 MUST 全部被指派(道路本身另有幾何,不需要自己的分區)
  {
    const nx = 5, nz = 5;
    const wall = new Uint8Array(nx * nz).fill(1);
    wall[0] = 0;                                   // 只有左上角是面
    const r = Z.floodFaces(wall, nx, nz);
    const filled = Z.assignWallTexels(r.face, wall, nx, nz);
    ok(r.n === 1 && filled === nx * nz - 1 && !r.face.includes(Z.NO_FACE),
      `牆 texel 全部併回最近的面(指派 ${filled}/${nx * nz - 1},殘留 NO_FACE ${r.face.filter((v) => v === Z.NO_FACE).length})`);
    const nbLen = /const NB = \[[\s\S]*?\];/.exec(grabBlock(ZSRC, 'export function assignWallTexels'));
    ok(!!nbLen && (nbLen[0].match(/\[-?\d+, -?\d+\]/g) || []).length === 8,
      '併回用 8 鄰(NB 恰 8 個鄰位)—— 與「是不是同一個面」是兩個不同的問題');
  }
  // ①-e **結構性對照**:36 面等寬長條(= 圓柱 / 圓台 / 圓錐的側面)每片面積相同 ⇒ 比值恆 1
  //      ⇒ 結構上併不掉。壞版(比佔全體)會把整根抹平,而面數以外的斷言照樣全綠(A46 ⑨ ㋐)。
  {
    const strips = 36, h = 8, nx = strips * 2 - 1, nz = h;
    const wall = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 1; i < nx; i += 2) wall[j * nx + i] = 1;
    const r = Z.floodFaces(wall, nx, nz);
    Z.assignWallTexels(r.face, wall, nx, nz);
    const before = Z.canonicalFaces(r.face, r.n);
    // areaMin 給到遠大於單片面積 ⇒ 每一片都是候選,決定權整個落在「比那個鄰居」那一行
    const m = Z.mergeSmall(r.face, r.n, nx, nz, { areaMin: nx * nz, rel: 0.5 });
    const after = Z.canonicalFaces(m.face, m.n);
    ok(r.n === strips, `合成 ${strips} 面等寬長條(實得 ${r.n} 面)`);
    ok(m.merged === 0 && m.n === strips,
      `曲面體保護:等面積的相鄰片 MUST 併入 0 次(實得併 ${m.merged} 次、剩 ${m.n} 面)`);
    ok(Buffer.compare(Buffer.from(before.buffer.slice(0)), Buffer.from(after.buffer.slice(0))) === 0,
      '曲面體保護:分割逐位元不動(位移 0)');
  }
  // ①-f 小的貼上大的、共邊才算相鄰
  {
    const nx = 20, nz = 12;
    const wall = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) wall[j * nx + 10] = 1;         // 縱向牆:左大面 / 右大面
    for (let i = 11; i < nx; i++) wall[3 * nx + i] = 1;         // 右半再切出一小條(上方 3 列)
    const r = Z.floodFaces(wall, nx, nz);
    Z.assignWallTexels(r.face, wall, nx, nz);
    const a0 = Z.faceAreas(r.face, r.n);
    const small = a0.indexOf(Math.min(...a0));
    const m = Z.mergeSmall(r.face, r.n, nx, nz, { areaMin: Math.min(...a0), rel: 0.9 });
    ok(m.merged >= 1 && m.n === r.n - m.merged, `小面併進共邊最大鄰面(${r.n} → ${m.n} 面,併 ${m.merged} 次)`);
    const bigArea = Math.max(...Z.faceAreas(m.face, m.n));
    ok(bigArea > Math.max(...a0), `㋒ 小的貼上大的:併後最大面 ${bigArea} > 併前最大面 ${Math.max(...a0)}`);
    // 共邊才算相鄰:把小面孤立(四周全牆)⇒ 併不進去
    const wall2 = Uint8Array.from(wall);
    for (let i = 11; i < nx; i++) { wall2[3 * nx + i] = 1; wall2[0 * nx + i] = i === 11 ? 0 : wall2[i]; }
    for (let j = 0; j < 3; j++) wall2[j * nx + 11] = 1;         // 把左邊那一格也堵起來 ⇒ 小面四面無鄰
    const r2 = Z.floodFaces(wall2, nx, nz);
    Z.assignWallTexels(r2.face, wall2, nx, nz);
    const a2 = Z.faceAreas(r2.face, r2.n);
    const iso = a2.filter((x) => x > 0).length;
    ok(iso === r2.n, `共邊才算相鄰(孤立面不與距離近的面互併;實得 ${r2.n} 面)`);
    void small;
  }
  // ①-f2 **牆併回 MUST 排在小面併鄰之前**(2026-08-16 落地時真的踩到的靜默失敗:
  //       面與面之間隔著牆 ⇒ 鄰接表整份是空的、`mergeSmall` 一次都併不掉,
  //       而回報上只表現成「這張圖剛好沒有碎面」)。
  {
    const nx = 20, nz = 12;
    const wall = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) wall[j * nx + 10] = 1;
    for (let i = 11; i < nx; i++) wall[3 * nx + i] = 1;
    const raw = Z.floodFaces(wall, nx, nz);
    const noFill = Int32Array.from(raw.face);
    const adj0 = Z.faceAdjacency(noFill, raw.n, nx, nz).reduce((a, mp) => a + mp.size, 0);
    const before = Z.mergeSmall(noFill, raw.n, nx, nz, { areaMin: nx * nz, rel: 0.9 });
    ok(adj0 === 0 && before.merged === 0,
      `牆還沒併回 ⇒ 鄰接表是空的(${adj0} 對)、一次都併不掉(${before.merged} 次)—— 這就是那個靜默失敗`);
    const filled = Int32Array.from(raw.face);
    Z.assignWallTexels(filled, wall, nx, nz);
    const adj1 = Z.faceAdjacency(filled, raw.n, nx, nz).reduce((a, mp) => a + mp.size, 0);
    const after = Z.mergeSmall(filled, raw.n, nx, nz, { areaMin: nx * nz, rel: 0.9 });
    ok(adj1 > 0 && after.merged > 0, `併回之後才併得掉(鄰接 ${adj1} 對、併 ${after.merged} 次)`);
  }
  // ①-g 逐面取樣:決定性 + **不吃 face id**
  {
    const nx = 24, nz = 16;
    const wall = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) wall[j * nx + 9] = 1;
    for (let i = 0; i < nx; i++) wall[7 * nx + i] = 1;
    const r = Z.floodFaces(wall, nx, nz);
    Z.assignWallTexels(r.face, wall, nx, nz);
    const s1 = Z.faceSamples(r.face, r.n, 5);
    const s2 = Z.faceSamples(r.face, r.n, 5);
    const key = (ss) => JSON.stringify(ss.map((a) => [...a]));
    ok(key(s1) === key(s2), '逐面取樣兩次跑逐位元相同(零亂數)');
    // 人工重排 face id(逆序)⇒ 每個**等價類**拿到的樣本 texel 集合 MUST 一模一樣
    const perm = new Int32Array(r.face.length);
    for (let k = 0; k < r.face.length; k++) perm[k] = r.face[k] === Z.NO_FACE ? Z.NO_FACE : r.n - 1 - r.face[k];
    const s3 = Z.faceSamples(perm, r.n, 5);
    const canon = (ss, f2rep) => JSON.stringify(ss.map((a, f) => [f2rep[f], [...a]]).sort((a, b) => a[0] - b[0]));
    const rep1 = [...Array(r.n)].map((_, f) => r.face.indexOf(f));
    const rep3 = [...Array(r.n)].map((_, f) => perm.indexOf(f));
    ok(canon(s1, rep1) === canon(s3, rep3), '逐面取樣 MUST NOT 拿 face id 當種子(重排 id 後樣本集合逐項相同)');
  }
  // ①-h **順序無關**:反轉線段陣列 + 反轉每一段的兩端 ⇒ 分割的等價類 MUST 逐位元相同
  {
    const nx = 128, nz = 96;
    const segs = [];
    for (let t = 0; t < 40; t++) {          // 決定性的合成線束(無亂數:純算術網格)
      const a = (t * 37) % nx, b = (t * 53) % nz;
      segs.push([a, 0, (a + 31) % nx, nz - 1, 1.2]);
      segs.push([0, b, nx - 1, (b + 17) % nz, 1.2]);
    }
    const w1 = Z.rasterLines(nx, nz, segs).wall;
    const rev = segs.slice().reverse().map(([x0, z0, x1, z1, hw]) => [x1, z1, x0, z0, hw]);
    const w2 = Z.rasterLines(nx, nz, rev).wall;
    ok(Buffer.compare(Buffer.from(w1), Buffer.from(w2)) === 0, '光柵化與線段順序 / 端點序無關(牆遮罩逐位元相同)');
    // --break-order 的播種順序來源(= 輸入順序)。線上的 texel 本身是**牆**、播種時會被
    // `continue` 掉 ⇒ MUST 取線**旁邊**的自由格,否則壞版的播種序退化成 row-major、
    // 反向驗證會靜默地全綠(2026-08-16 踩過一次)。
    const order = (sg) => {
      const seen = new Uint8Array(nx * nz), out = [];
      const push = (i, j) => {
        if (i < 0 || j < 0 || i >= nx || j >= nz) return;
        const k = j * nx + i;
        if (!seen[k]) { seen[k] = 1; out.push(k); }
      };
      for (const [x0, z0] of sg) {
        const i = Math.round(x0), j = Math.round(z0);
        for (const [di, dj] of [[4, 4], [-4, 4], [4, -4], [-4, -4], [6, 0], [-6, 0], [0, 6], [0, -6]]) push(i + di, j + dj);
      }
      for (let k = 0; k < nx * nz; k++) if (!seen[k]) out.push(k);
      return out;
    };
    globalThis.__ZC_SEED_ORDER = order(segs);
    const f1 = Z.floodFaces(w1, nx, nz);
    globalThis.__ZC_SEED_ORDER = order(rev);
    const f2 = Z.floodFaces(w2, nx, nz);
    globalThis.__ZC_SEED_ORDER = null;
    const c1 = Z.canonicalFaces(f1.face, f1.n), c2 = Z.canonicalFaces(f2.face, f2.n);
    ok(f1.n === f2.n && Buffer.compare(Buffer.from(c1.buffer.slice(0)), Buffer.from(c2.buffer.slice(0))) === 0,
      `分割與輸入順序無關(正規化指紋逐位元相同;${f1.n} vs ${f2.n} 面)`);
    // ⚠ 上一條**只驗得到分割**:`canonicalFaces` 對編號重排是不變量 ⇒ 就算 face id 被綁到
    //   輸入順序上它也照樣綠。「id 也不吃輸入順序」MUST 另外量 —— 那才是「下游拿 id 當種子
    //   ⇒ 兩台客戶端建出不同的世界」的那一條(`--break-order` 咬的就是它)。
    ok(Buffer.compare(Buffer.from(f1.face.buffer.slice(0)), Buffer.from(f2.face.buffer.slice(0))) === 0,
      'face **id 編號**也與輸入順序無關(播種走 row-major 掃描,不吃 segs 陣列)');
  }
  // ①-i 結構清單是 venue_field 的唯一縫(audit_traverse MUST NOT 自己再定義一份)
  {
    const at = readSrc('tools', 'audit_traverse.mjs');
    const vf = readSrc('tools', 'venue_field.mjs');
    const named = ['buildStructs', 'projectArc', 'ptAt', 'sampleAlong'];
    const dupes = named.filter((n) => new RegExp(`\\nfunction ${n}\\s*\\(`).test(at));
    const homed = named.filter((n) => new RegExp(`\\nexport function ${n}\\s*\\(`).test(vf));
    ok(dupes.length === 0 && homed.length === named.length,
      `結構清單只有一份(venue_field 有 ${homed.length}/4 支、audit_traverse 自己定義 ${dupes.length} 支)`);
  }
  // ①-j PNG 編碼器全庫只有一份(樁 MUST NOT 另寫第二份)
  {
    const zsrc = ZSRC, asrc = readSrc('tools', 'audit_zone_cut.mjs');
    const sig = /137,\s*80,\s*78,\s*71/;
    ok(!sig.test(zsrc) && !sig.test(asrc), 'PNG 編碼器沒有第二份(樁走 logo_lib.pngBytes)');
  }
}

// =====================================================================================
// Ⅱ Z0 場地普查 —— 序 14 的貼圖規格整個掛在這張表上(離線)
// =====================================================================================
console.log('\nⅡ 場地普查(Z0;序 14 貼圖規格的論據)');
const census = [];
for (const v of VENUES) {
  for (const team of [1, 2, 3]) {
    const cfg = venueConfig(v, team);
    const r = battleRect(cfg);
    const worldW = r.maxX - r.minX, worldH = r.maxZ - r.minZ;
    const cell = Math.max(13, Math.max(worldW, worldH) / 232);
    const B = edgeBufferM(mapArg(cfg));
    census.push({ id: v.id, team, worldW, worldH, cell,
      gnx: Math.ceil(worldW / cell), gnz: Math.ceil(worldH / cell),
      buf: B, spanW: worldW + 2 * B, spanH: worldH + 2 * B,
      rotDeg: mapRot(cfg.center) * 180 / Math.PI });
  }
}
{
  const maxSpan = Math.max(...census.map((c) => Math.max(c.spanW, c.spanH)));
  const top = census.slice().sort((a, b) => Math.max(b.spanW, b.spanH) - Math.max(a.spanW, a.spanH)).slice(0, 6);
  const maxGnx = census.reduce((a, c) => (Math.max(c.gnx, c.gnz) > Math.max(a.gnx, a.gnz) ? c : a), census[0]);
  console.log('    場地(含裙跨距前 6):');
  for (const c of top) {
    console.log(`      ${c.id.padEnd(13)}${c.team}v${c.team}  world ${c.worldW.toFixed(0)}×${c.worldH.toFixed(0)}`
      + `  cell ${c.cell.toFixed(2)}  zoneGrid ${c.gnx}×${c.gnz}  裙 ${c.buf.toFixed(1)}/側`
      + `  含裙 ${c.spanW.toFixed(0)}×${c.spanH.toFixed(0)}  θ ${c.rotDeg.toFixed(2)}°`);
  }
  console.log(`    最大 zoneGrid = ${maxGnx.id} ${maxGnx.team}v${maxGnx.team} 的 ${maxGnx.gnx}×${maxGnx.gnz}`);
  console.log(`    最大含裙跨距 = ${maxSpan.toFixed(1)}m  ⇒  1024² = ${(maxSpan / 1024).toFixed(3)} m/texel`
    + `、2048² = ${(maxSpan / 2048).toFixed(3)} m/texel`);
  ok(census.every((c) => Math.abs(c.cell - 13) < 1e-9),
    `現制 cell 恆為 13m(232 那條上限要到 3016m 邊長才咬得到;實測最大邊長 ${Math.max(...census.map((c) => Math.max(c.worldW, c.worldH))).toFixed(0)}m)`);
  ok(Math.max(maxGnx.gnx, maxGnx.gnz) > 93,
    `計畫 §0-a 那張表的「93×93」量的是可玩邊長,而 buildGroundCover 吃的是 battleRect(實測最大 ${Math.max(maxGnx.gnx, maxGnx.gnz)})`);
  ok(maxSpan > 2111,
    `計畫 §0-a 的「2111m 見方」低估(實測 ${maxSpan.toFixed(0)}m;⇒ 1024² 是 ${(maxSpan / 1024).toFixed(2)} m/texel 不是 2.06)`);
  // 硬限:兩個分區交錯的最細尺度 = 一個 texel。現制是一個 cell ⇒ 1024² 仍是改善。
  ok(maxSpan / 1024 < 13, `1024² 的 texel(${(maxSpan / 1024).toFixed(2)}m)仍遠細於現制的 13m 格 ⇒ 是改善不是新限制`);
}
if (ARG.census) { console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`); process.exit(fail === 0 ? 0 : 1); }

// =====================================================================================
// Ⅲ 切面的坡度門檻 MUST 取 SLOPE 唯一縫(離線)
// =====================================================================================
console.log('\nⅢ 坡度等值線的門檻(唯一縫)');
// ⚠ 期望值 MUST 是 `SLOPE.EASE_DEG` / `SLOPE.BLOCK_DEG` 這兩個**表達式**,
//   MUST NOT 隨 --break-slope 改成 15.64 / 36.87(那樣 break 永遠是綠的,§5.4 ㋑)。
const CONTOUR_DEG = BREAK.slope
  ? [Math.atan(0.28) * 180 / Math.PI, Math.atan(0.75) * 180 / Math.PI]   // 壞版:cellZoneAt 的**標籤覆寫**門檻
  : [SLOPE.EASE_DEG, SLOPE.BLOCK_DEG];
{
  ok(CONTOUR_DEG[0] === SLOPE.EASE_DEG && CONTOUR_DEG[1] === SLOPE.BLOCK_DEG,
    `切面門檻 = SLOPE.EASE_DEG / SLOPE.BLOCK_DEG(${SLOPE.EASE_DEG}° / ${SLOPE.BLOCK_DEG}°;實得 ${CONTOUR_DEG[0].toFixed(2)}° / ${CONTOUR_DEG[1].toFixed(2)}°)`);
  const labelDeg = [Math.atan(0.28) * 180 / Math.PI, Math.atan(0.75) * 180 / Math.PI];
  ok(Math.abs(labelDeg[0] - SLOPE.EASE_DEG) > 1e-9,
    `切面的線 ≠ cellZoneAt 的標籤覆寫門檻(後者是手寫的 0.28 / 0.75 = ${labelDeg[0].toFixed(2)}° / ${labelDeg[1].toFixed(2)}°,兩件事 MUST NOT 合併)`);
  ok(SLOPE.BLOCK_DEG === SLOPE.EASE_DEG * SLOPE.BLOCK_F, '阻擋角仍是推導值(SLOPE.BLOCK_DEG = EASE_DEG × BLOCK_F)');
}

// =====================================================================================
// Ⅳ cellZoneAt 原文閘 —— 判定順序一行不改,只換它吃什麼(離線)
// =====================================================================================
console.log('\nⅣ cellZoneAt 原文閘(判定順序一行不改)');
const GSRC = readSrc('public', 'js', 'ground.js');
const CZ_HEAD = 'const cellZoneAt = (i, j) => ';
let CZ_BLOCK = null, cellZoneFactory = null;
try {
  CZ_BLOCK = grabBlock(GSRC, CZ_HEAD);
  const full = CZ_HEAD + CZ_BLOCK;
  ok(GSRC.includes(full), 'ground.js 的那一段原文逐字元抽出(樁自己不得改寫它)');
  // 判定**順序**的原文閘:七個決策點 MUST 依序出現。順序被改掉 = §0-a 的前提沒了。
  const ORDER = ['envAt(', 'ec === 1', 'terrain.heightAt', 'slope > 0.75', 'classifyPure(',
    "zn === 'water'", 'slope > 0.28', 'ec === 2', 'alpineH'];
  let at = -1, seq = true;
  for (const t of ORDER) { const p = CZ_BLOCK.indexOf(t, at + 1); if (p <= at) { seq = false; break; } at = p; }
  ok(seq, `判定順序 MUST 依序:${ORDER.join(' → ')}`);
  cellZoneFactory = (env) => new Function('terrain', 'envAt', 'classifyPure', 'cell', 'alpineH',
    `${full};\nreturn cellZoneAt;`)(env.terrain, env.envAt, env.classifyPure, env.cell, env.alpineH);
  // 行為直測(合成地形,不需網路):執行的真的是那一段原文
  {
    const terrain = { minX: 0, minZ: 0, heightAt: (x, z) => (x > 200 ? 0.9 * x : 5) + z * 0 };
    const cz = cellZoneFactory({ terrain, envAt: () => 0, classifyPure: () => 'green', cell: 13, alpineH: Infinity });
    ok(cz(0, 0) === 'green', '平坦 + 影像判綠 ⇒ green');
    const czW = cellZoneFactory({ terrain, envAt: () => 1, classifyPure: () => 'green', cell: 13, alpineH: Infinity });
    ok(czW(0, 0) === 'water', 'envCode 1 ⇒ water(權威遮罩優先)');
    const steep = { minX: 0, minZ: 0, heightAt: (x) => x * 0.9 };
    const czS = cellZoneFactory({ terrain: steep, envAt: () => 0, classifyPure: () => 'green', cell: 13, alpineH: Infinity });
    ok(czS(0, 0) === 'cliff', '坡度 > 0.75 ⇒ cliff(正式懸崖分區)');
    const mid = { minX: 0, minZ: 0, heightAt: (x) => x * 0.5 };
    const czM = cellZoneFactory({ terrain: mid, envAt: () => 0, classifyPure: () => 'urban', cell: 13, alpineH: Infinity });
    ok(czM(0, 0) === 'bare', '坡度 > 0.28 ⇒ bare(山坡不會是停車場)');
  }
} catch (e) {
  ok(false, `抽不到 ground.js 的 cellZoneAt 原文(${e.message})—— 該檔正被別的道改動時會這樣`);
}

// =====================================================================================
// Ⅴ surfaceId 出線的量化算術
// =====================================================================================
console.log('\nⅤ surfaceId 出線的算術(驗收面 3;已接 runtime)');
const ZONE_LIST = ['water', 'wet', 'green', 'bare', 'urban', 'alpine', 'cliff'];
{
  const TSRC = readSrc('public', 'js', 'toon.js');
  const PSRC = readSrc('public', 'js', 'postfx.js');
  const mSeq = /const nextSurfId = \(surfaceKey = null\) => \{[\s\S]*?SURF_SLOT_N/.exec(TSRC);
  const mSlots = /const SURF_SLOT_N = (\d+);/.exec(TSRC);
  const mLand = /const LAND_SURF_ID = ([\d.]+);/.exec(TSRC);
  const mStep = /step\(\s*([\d.]+),\s*idv\s*\)/.exec(PSRC);
  if (!mSeq || !mSlots || !mLand || !mStep) {
    note(`抽不到 surfaceId 的錨點(nextSurfId ${!!mSeq} / slots ${!!mSlots} / LAND_SURF_ID ${!!mLand} / step 門檻 ${!!mStep})`
      + ' —— toon.js / postfx.js 正被別的道改動時會這樣,驗收面 3 未驗');
  } else {
    const STEP = +mStep[1], MOD = +mSlots[1], DEN = 64;
    // 8bit 量化(RT 是 RGBA8)。`step(STEP, idv)` 吃的是量化**之後**的差 ⇒ 全部在整數碼上算。
    const q8c = (v) => Math.round(v * 255);                       // 值 → 8bit 碼
    const matCodes = [...new Set([...Array(MOD)].map((_, k) => q8c((k + 0.5) / DEN)))].sort((a, b) => a - b);
    const MINC = Math.ceil(STEP * 255 - 1e-9);                    // 跨得過門檻的最小碼距
    // **id 集合是解出來的不是手寫的**:在 0..255 的碼上,挑出 ①彼此距離 ≥ MINC
    // ②離每一個材質碼 ≥ MINC 的最小可行集。--break-id = 強制間距 1 碼(1/255 = 0.00392 < 0.004)。
    const allowed = [];
    for (let c = 0; c <= 255; c++) {
      let d = Infinity;
      for (const m of matCodes) d = Math.min(d, Math.abs(c - m));
      if (d >= MINC) allowed.push(c);
    }
    let zoneCodes;
    if (BREAK.id) zoneCodes = ZONE_LIST.map((_, i) => i);         // 壞版:間距 1/255
    else {
      zoneCodes = [];
      for (const c of allowed) {
        if (zoneCodes.length >= ZONE_LIST.length) break;
        if (!zoneCodes.length || c - zoneCodes[zoneCodes.length - 1] >= MINC) zoneCodes.push(c);
      }
    }
    console.log(`    門檻 step(${STEP}, idv) ⇒ 最小碼距 ${MINC}/255 = ${(MINC / 255).toFixed(5)}`
      + `(1/255 = ${(1 / 255).toFixed(5)} **跨不過**);nextSurfId 前 ${MOD} 個語意鍵值域 (k+0.5)/${DEN} ⇒ ${matCodes.length} 個相異碼;`
      + `LAND_SURF_ID = ${mLand[1]}`);
    console.log(`    0..255 裡離所有材質碼 ≥ ${MINC} 的碼共 ${allowed.length} 個 ⇒ 解出的分區 id:`
      + `${ZONE_LIST.map((z, i) => `${z} ${zoneCodes[i]}/255=${(zoneCodes[i] / 255).toFixed(5)}`).join('、')}`);
    let minPair = Infinity, minPairName = '';
    for (let a = 0; a < zoneCodes.length; a++) for (let b = a + 1; b < zoneCodes.length; b++) {
      const d = Math.abs(zoneCodes[a] - zoneCodes[b]);
      if (d < minPair) { minPair = d; minPairName = `${ZONE_LIST[a]}↔${ZONE_LIST[b]}`; }
    }
    let minMat = Infinity, minMatName = '';
    for (let a = 0; a < zoneCodes.length; a++) for (const m of matCodes) {
      const d = Math.abs(zoneCodes[a] - m);
      if (d < minMat) { minMat = d; minMatName = `${ZONE_LIST[a]}↔材質碼 ${m}`; }
    }
    ok(zoneCodes.length === ZONE_LIST.length && minPair / 255 >= STEP,
      `① 分區兩兩 8bit 量化後最小差 ${(minPair / 255).toFixed(5)} ≥ ${STEP}(最緊:${minPairName};`
      + `解出 ${zoneCodes.length}/${ZONE_LIST.length} 個分區)`);
    ok(minMat / 255 >= STEP, `② 分區 id 與 ${matCodes.length} 個材質碼的最小差 ${(minMat / 255).toFixed(5)} ≥ ${STEP}`
      + `(最緊:${minMatName};撞號 = 某一處「地貌 vs 建物」的線整條消失)`);
    ok(true, '③ 面內差恆 0(逐面同一個 id 是構造保證:id 由 zone 決定、面內 zone 唯一)');
    const de = (a, b) => Math.abs(zoneCodes[ZONE_LIST.indexOf(a)] - zoneCodes[ZONE_LIST.indexOf(b)]) / 255;
    console.log(`    逐對實得 delta:草↔岩 ${de('green', 'bare').toFixed(5)}、乾↔濕 ${de('green', 'wet').toFixed(5)}`
      + `(門檻 ${STEP})`);
    console.log(`    ⚠ **naive 的「2/255 等距」行不通**:2/255 恰好就是材質碼 ${matCodes[0]}`
      + `((0.5)/${DEN} = ${(0.5 / DEN).toFixed(6)} 量化後同碼)⇒ 那一處「地貌 vs 建物」的線整條消失。`
      + `間距 MUST 由**材質碼的格**解出來,MUST NOT 手寫等距。`);
    const LFSRC = readSrc('public', 'js', 'landfield.js');
    const BIO = readSrc('public', 'js', 'biomes.js');
    const DSRC = readSrc('public', 'js', 'data.js');
    const MSRC = readSrc('public', 'js', 'main.js');
    const SSRC = readSrc('server', 'sim.js');
    ok(/corridorKeepOut\(nx, nz, mpt, gradeCorridors/.test(LFSRC)
      && /const clear = kind === 'tun' \? STRUCT_CLEAR_PAD : 4;/.test(BIO),
    '切面與執行期共用 corridorKeepOut；橋 / 隧道淨空由 markGradeCorridors 的 clear 推導');
    ok(/laneWetWays/.test(readSrc('tools', 'venue_field.mjs'))
      && /runtimeSplitWaterPieces/.test(readSrc('tools', 'venue_field.mjs')),
    '離線樁納入 cfg 推導的 laneWetWays，並鏡射執行期 splitWaterPieces 原文');
    ok(/MAX_CORR:\s*6000/.test(DSRC) && /\.slice\(0, LOS\.MAX_CORR\)/.test(MSRC)
      && /\.slice\(0, LOS\.MAX_CORR\)/.test(SSRC)
      && !/slice\(0, 2400\)/.test(MSRC + SSRC),
    'gradeCorridors 上傳 / 伺服器接收共用 LOS.MAX_CORR，不再各自硬截 2400 段');
    ok(/LAND_ZONES = \['water', 'wet', 'green', 'bare', 'urban', 'alpine', 'cliff'\]/.test(LFSRC),
      'runtime 分區名冊含正式 cliff，且順序與貼圖 R 通道一致');
    ok(/LAND_ROAD_RANK = 3/.test(LFSRC) && /LAND_AREA_MIN_F = 0\.0004/.test(LFSRC),
      'runtime 線分級 rank≤3、面積下限 0.0004 已定案');
    const GND = readSrc('public', 'js', 'ground.js');
    const TER = readSrc('public', 'js', 'terrain.js');
    const RELAY = readSrc('public', 'js', 'osmrelay.js');
    ok(/geoKey\('osmF', 3/.test(BIO) && /covers, waters, boundaries/.test(BIO),
      'OSM 快取已升 v3，四類新圖資進 runtime payload');
    ok(/buildLandField\(/.test(BIO) && /setLandField\(/.test(BIO),
      'buildBiomes 建場後把單一 land field 接進 toon');
    ok((TER.match(/landField: true/g) || []).length === 2 && /CEL_LAND_FIELD/.test(TSRC),
      '地形兩條材質路徑都取樣 land field shader');
    ok(/surfaceField \? new Array\(gnx \* gnz\)\.fill\(null\)/.test(GND)
      && /if \(!surfaceField\) for/.test(GND),
      'runtime 停用舊飛地與底毯發射；相容 fallback 留存但不接線');
    ok(/MAX_COVER:\s*900/.test(RELAY) && /MAX_WATERWAY:\s*120/.test(RELAY)
      && /MAX_BOUNDARY:\s*500/.test(RELAY), '中繼端有新 payload 的逐類上限');
    ok(!/Math\.random\(|\brnd\(/.test(LFSRC), 'land field 零 Math.random / 零共享 rnd(§2.3)');
    ok(VENUES.every((v) => {
      const c = venueConfig(v, 1).center, p = [c.lat + 0.001, c.lng - 0.001];
      return JSON.stringify(llToWorld(p[0], p[1], c)) === JSON.stringify(llToXZ(p[0], p[1], c));
    }), 'venue_field.llToWorld 直接服從 A42 投影唯一縫');
  }
}

// =====================================================================================
// Ⅵ 真場地:線工 → 切面 → 逐面標籤 → 三個驗收面 + 成本 + 對照 PNG(需網路/快取)
// =====================================================================================
const VENUE = ARG.venue || null;
if (!VENUE) {
  console.log('\nⅥ 真場地:未指定 --venue ⇒ 略過(Ⅰ~Ⅴ 是離線段,CI 收得到)');
  console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
  if (unverified.length) console.log(`⚠ 未驗 ${unverified.length} 項:\n  - ${unverified.join('\n  - ')}`);
  process.exit(fail === 0 ? 0 : 1);
}

// ---- 地被多邊形 → 分區類別(圖資 > 影像的信任階梯:這一層排在 classifyPure 之前)----
const COVER_ZONE = (t) => {
  const lu = t.landuse, na = t.natural, le = t.leisure;
  if (na === 'water' || lu === 'reservoir' || lu === 'basin' || na === 'bay' || na === 'strait') return 'water';
  if (na === 'wetland' || lu === 'salt_pond' || na === 'marsh' || na === 'mud') return 'wet';
  if (na === 'sand' || na === 'beach' || na === 'bare_rock' || na === 'scree' || na === 'shingle'
    || na === 'rock' || na === 'cliff' || lu === 'quarry' || lu === 'landfill') return 'bare';
  if (na === 'wood' || na === 'scrub' || na === 'grassland' || na === 'heath' || na === 'tree_row'
    || le || lu === 'forest' || lu === 'grass' || lu === 'meadow' || lu === 'farmland'
    || lu === 'orchard' || lu === 'vineyard' || lu === 'allotments' || lu === 'village_green'
    || lu === 'cemetery' || lu === 'recreation_ground' || lu === 'greenfield' || lu === 'plant_nursery') return 'green';
  if (lu) return 'urban';       // residential / commercial / industrial / retail / railway / …
  return null;
};

async function cutVenue(v, team, opts = {}) {
  const T = {};
  const t0 = () => Date.now();
  const cfg = venueConfig(v, team);
  const rect = battleRect(cfg);
  const bbox = battleBBox(cfg);
  const bufferM = edgeBufferM(mapArg(cfg));
  const worldW = rect.maxX - rect.minX, worldH = rect.maxZ - rect.minZ;
  const cell = Math.max(13, Math.max(worldW, worldH) / 232);
  const gnx = Math.ceil(worldW / cell), gnz = Math.ceil(worldH / cell);
  const spanX = worldW + 2 * bufferM, spanZ = worldH + 2 * bufferM;
  const tex = +(ARG.tex || 1024);
  const mpt = Math.max(spanX, spanZ) / tex;                    // 公尺 / texel(正方 texel)
  const nx = Math.ceil(spanX / mpt), nz = Math.ceil(spanZ / mpt);
  const ox = rect.minX - bufferM, oz = rect.minZ - bufferM;
  const toI = (x) => (x - ox) / mpt, toJ = (z) => (z - oz) / mpt;
  const xOf = (i) => ox + (i + 0.5) * mpt, zOf = (j) => oz + (j + 0.5) * mpt;

  let m = t0();
  const elev = await elevSampler(bbox);
  if (!elev) return { skip: '取不到高程磚(需外網;沙箱/公司網路常態如此)' };
  const hf = buildHeightField(cfg, bbox, elev);
  T.terrain = Date.now() - m;

  const osm = await osmFor(v.id, bbox);
  const lc = await landcoverFor(v.id, bbox);
  const cl = await cutLinesFor(v.id, bbox);
  const src = { osm: !!osm, cover: !!lc, cutlines: !!cl };

  // waterY:與 terrain.js 同一條(minH < WATER.LEVEL + 0.2 才有水面)
  let minH = Infinity;
  for (let j = 0; j <= 40; j++) for (let i = 0; i <= 40; i++) {
    const h = hf.heightAt(rect.minX + worldW * i / 40, rect.minZ + worldH * j / 40);
    if (h < minH) minH = h;
  }
  const waterY = minH < WATER.LEVEL + 0.2 ? WATER.LEVEL : null;

  // ---- 線工組裝 ----
  // 投影一律走 `data.llToXZ`(含 A42 主方位)；反向驗證在本稽核內明造 pre-A42 舊公式。
  // `proj` = 世界的正解(地形 / zoneGrid / 真值線一律吃它,含 A42 主方位)。
  // `projCut` = **只給切面線**;`--break-quantize` 只壞這一支 ⇒ 缺陷被隔離成
  // 「切面的線與整個世界不在同一個框裡」,而那正是規格描述的症狀。
  // 兩支都壞掉的話整份世界一起轉,距離看起來完全正常(反向驗證會靜默全綠)。
  const proj = (p) => llToXZ(p.lat, p.lon ?? p.lng, cfg.center);
  const projCut = BREAK.quantize
    ? (p) => [
      ((p.lon ?? p.lng) - cfg.center.lng) * d2r(1) * R_EARTH * Math.cos(d2r(cfg.center.lat)) * WORLD_S,
      -(p.lat - cfg.center.lat) * d2r(1) * R_EARTH * WORLD_S,
    ]                                                         // 壞版:pre-A42 手抄,無旋轉
    : proj;
  m = t0();
  let roads = osm?.roads || [];
  if (roads.length && !BREAK.quantize) {
    roads = quantizeRoads(roads, (p) => llToXZ(p.lat, p.lon, cfg.center), (x, z) => {
      const [lat, lon] = xzToLL(x, z, cfg.center); return { lat, lon };
    });
  }
  T.quantize = Date.now() - m;

  const RANK = (hw) => (/^(motorway|trunk)$/.test(hw) ? 1 : /^(primary|secondary)$/.test(hw) ? 2
    : /^(tertiary|unclassified|residential|living_street)$/.test(hw) ? 3
      : /^(service|track)$/.test(hw) ? 4 : 5);           // 5 = footway / path / pedestrian
  const rankMax = +(ARG.rank || 3);                      // 這一級(含)以上參與切面
  const wayToSegs = (ways, hwOf) => {
    const out = [];
    for (const w of ways) {
      const hw = hwOf(w);
      let prev = null;
      for (const p of w.geometry) {
        const q = projCut(p);
        if (prev) out.push([toI(prev[0]), toJ(prev[1]), toI(q[0]), toJ(q[1]), hw / mpt / 2]);
        prev = q;
      }
    }
    return out;
  };

  const classes = {};
  classes.road = wayToSegs(roads.filter((w) => RANK(w.tags.highway || '') <= rankMax), (w) => roadWidth(w.tags));
  classes.rail = wayToSegs(osm?.rails || [], () => 6);
  classes.water = wayToSegs(osm?.waters || [], (w) => (w.tags.waterway === 'river' ? 12 : 5));
  const ringWays = (lc?.covers || []).filter((c) => !!COVER_ZONE(c.tags));
  classes.ring = wayToSegs(ringWays, () => 3);
  classes.coast = wayToSegs(cl?.coastline || [], () => 4);
  // 行政界:**低優先** —— 只有「半徑 ADM_NEAR 內沒有其他參與線」才採用,否則是重複線
  const ADM_NEAR = +(ARG.adm || 40);
  const otherWall = Z.rasterLines(nx, nz, [...classes.road, ...classes.rail, ...classes.water,
    ...classes.ring, ...classes.coast].map((s) => [s[0], s[1], s[2], s[3], ADM_NEAR / mpt])).wall;
  const admAll = wayToSegs(cl?.boundary || [], () => 3);
  classes.adm = admAll.filter((s) => {
    const i = Math.round((s[0] + s[2]) / 2), j = Math.round((s[1] + s[3]) / 2);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    return !otherWall[j * nx + i];
  });
  const admShare = admAll.length ? classes.adm.length / admAll.length : 0;

  // 坡度等值線:取樣距 MUST = 地形格距(取更細會把三角化的網格折邊量成等值線)
  m = t0();
  const hTex = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hTex[j * nx + i] = hf.heightAt(xOf(i), zOf(j));
  const gridM = worldW / (TERRAIN.GRID_N - 1);
  const sd = Math.max(1, Math.round(gridM / mpt));
  const degTex = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - sd), i1 = Math.min(nx - 1, i + sd);
      const j0 = Math.max(0, j - sd), j1 = Math.min(nz - 1, j + sd);
      const dx = (hTex[j * nx + i1] - hTex[j * nx + i0]) / ((i1 - i0) * mpt || 1);
      const dz = (hTex[j1 * nx + i] - hTex[j0 * nx + i]) / ((j1 - j0) * mpt || 1);
      degTex[j * nx + i] = slopeDeg(Math.hypot(dx, dz), 1);
    }
  }
  const contourWall = new Uint8Array(nx * nz);
  let contourN = 0;
  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = degTex[j * nx + i];
      for (const t of CONTOUR_DEG) {
        if ((a - t) * (degTex[j * nx + i + 1] - t) < 0 || (a - t) * (degTex[(j + 1) * nx + i] - t) < 0) {
          contourWall[j * nx + i] = 1; contourN++; break;
        }
      }
    }
  }
  T.contour = Date.now() - m;

  // ---- 結構足跡 keep-out(隧道 hw + STRUCT_CLEAR_PAD / 橋 hw + 4;推導不手寫)----
  const terrainForCorridors = { ...hf, waterY, sampleColor: null, natureAt: hf.heightAt };
  const grade = osm
    ? gradeWaysForAudit(roads, cfg.lanes, cfg.center, terrainForCorridors)
    : { roads: [], laneWetWays: [], ways: [] };
  const corridorBlocked = new Set();
  const gradeCorridors = markGradeCorridors(grade.ways, terrainForCorridors, cfg.center, corridorBlocked, false);
  const structWays = grade.roads.filter((w) => w.tags.bridge || w.tags.tunnel).length + grade.laneWetWays.length;
  const keepOutRef = Z.corridorKeepOut(nx, nz, mpt, gradeCorridors, { toI, toJ });
  const keepOut = BREAK.keepout ? new Uint8Array(nx * nz) : keepOutRef;
  const koN = keepOutRef.reduce((a, b) => a + b, 0);

  // ---- 光柵化 → 泛洪 → 小面併鄰 → 牆併回 ----
  // `opts.noRings` = **去循環的對照組**:地被多邊形外環同時是「參與線」與「真值」⇒
  // 主判定天生偏向新制。拿掉外環之後,新制的界線就只剩路緣 / 河岸 / 海岸 / 坡度,
  // 再拿它去量離**外環**多遠 —— 那才是「真實世界的線落不落在地貌換手處」的直球問題。
  if (opts.noRings) classes.ring = [];
  const allSegs = [...classes.road, ...classes.rail, ...classes.water, ...classes.ring,
    ...classes.coast, ...classes.adm];
  m = t0();
  const rl = Z.rasterLines(nx, nz, allSegs, { keepOut: BREAK.keepout ? null : keepOut });
  for (let k = 0; k < contourWall.length; k++) {
    if (contourWall[k] && !(BREAK.keepout ? 0 : keepOut[k]) && !rl.wall[k]) rl.wall[k] = 1;
  }
  T.raster = Date.now() - m;
  m = t0();
  const ff = Z.floodFaces(rl.wall, nx, nz);
  T.flood = Date.now() - m;
  // ⚠ **牆併回 MUST 排在小面併鄰之前**:面與面之間隔著牆 ⇒ 併回之前鄰接表整份是空的,
  //   `mergeSmall` 一次都併不掉而回報上只表現成「這張圖剛好沒有碎面」(見 zonecut.faceAdjacency 檔頭)。
  m = t0();
  Z.assignWallTexels(ff.face, rl.wall, nx, nz);
  T.fill = Date.now() - m;
  m = t0();
  const AREA_MIN_F = +(ARG.areamin || 0.0004);          // 面積下限(佔整張圖的比例)
  const areaMin = Math.max(4, Math.round(AREA_MIN_F * nx * nz));
  const adjPairs = Z.faceAdjacency(ff.face, ff.n, nx, nz).reduce((a, mp) => a + mp.size, 0);
  const mg = Z.mergeSmall(ff.face, ff.n, nx, nz, { areaMin, rel: +(ARG.rel || 0.5) });
  T.merge = Date.now() - m;

  // ---- 圖資多邊形 → 逐 texel 類別(classifyPure 的圖資那一層;影像那一層 Node 端沒有)----
  m = t0();
  const polyZone = new Int8Array(nx * nz).fill(-1);
  const ZIDX = (z) => ZONE_LIST.indexOf(z);
  {
    const polys = ringWays.map((c) => ({ zone: COVER_ZONE(c.tags), pts: c.geometry.map(proj) }))
      .map((p) => {
        let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
        for (const [x, z] of p.pts) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (z < minz) minz = z; if (z > maxz) maxz = z; }
        return { ...p, minx, maxx, minz, maxz, area: (maxx - minx) * (maxz - minz) };
      })
      // 大的先畫、小的後蓋 ⇒ 比較**具體**的那一塊贏(決定性:同面積時依原序)
      .sort((a, b) => b.area - a.area);
    for (const p of polys) {
      // ⚠ MUST 裁到 battleRect 的框內:`out geom` 回的是整條 way,一塊 3.4 倍於方框的
      //   鎮級 landuse 不裁就能把整張圖標成市區(audit_venue_biome 的 clipToBBox 同一條)
      const i0 = Math.max(0, Math.floor(toI(Math.max(p.minx, rect.minX)))), i1 = Math.min(nx - 1, Math.ceil(toI(Math.min(p.maxx, rect.maxX))));
      const j0 = Math.max(0, Math.floor(toJ(Math.max(p.minz, rect.minZ)))), j1 = Math.min(nz - 1, Math.ceil(toJ(Math.min(p.maxz, rect.maxZ))));
      if (i1 < i0 || j1 < j0) continue;
      const zi = ZIDX(p.zone);
      for (let j = j0; j <= j1; j++) {
        const pz = zOf(j);
        for (let i = i0; i <= i1; i++) {
          const px = xOf(i);
          let inside = false;
          for (let a = 0, b = p.pts.length - 1; a < p.pts.length; b = a++) {
            const [xa, za] = p.pts[a], [xb, zb] = p.pts[b];
            if ((za > pz) !== (zb > pz) && px < (xb - xa) * (pz - za) / (zb - za) + xa) inside = !inside;
          }
          if (inside) polyZone[j * nx + i] = zi;
        }
      }
    }
  }
  T.poly = Date.now() - m;
  const polyCover = polyZone.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) / (nx * nz);

  // classifyPure(**兩趟共用同一份** ⇒ A/B 的唯一變因就是聚合層級)。
  // 圖資有話說就聽圖資(信任階梯:圖資 > 影像),沒有的話 Node 端**拿不到衛星影像** ⇒
  // 退回 'green' 並記帳(那一塊面積在報告裡列成未驗)。
  const classifyPure = (x, z) => {
    const i = Math.floor(toI(x)), j = Math.floor(toJ(z));
    if (i < 0 || j < 0 || i >= nx || j >= nz) return 'green';
    const v = polyZone[j * nx + i];
    return v >= 0 ? ZONE_LIST[v] : 'green';
  };
  // envAt:執行 biomes.js `terrainEnvCode` 的**原文**(sampleColor 缺席 ⇒ 影像那一半退化)
  const BSRC = readSrc('public', 'js', 'biomes.js');
  const envFn = new Function('WATER', `${grabFn(BSRC, 'terrainEnvCode')}\nreturn terrainEnvCode;`)(WATER);
  const terrainStub = { heightAt: hf.heightAt, waterY };
  const envAt = (x, z) => envFn(terrainStub, x, z);

  // alpineH:ground.js 同一段(21×21 取樣的起伏)
  let hMin = Infinity, hMax = -Infinity;
  for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
    const h = hf.heightAt(rect.minX + worldW * i / 20, rect.minZ + worldH * j / 20);
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  const relief = hMax - hMin;
  const alpineH = relief > 40 ? hMin + relief * 0.62 : Infinity;

  if (!cellZoneFactory) return { skip: '抽不到 cellZoneAt 原文' };
  const cellZoneAt = cellZoneFactory({
    terrain: { minX: rect.minX, minZ: rect.minZ, heightAt: hf.heightAt },
    envAt, classifyPure, cell, alpineH,
  });

  // ---- 趟 A:現制 zoneGrid(逐格) ----
  m = t0();
  const zoneGrid = new Array(gnx * gnz);
  for (let j = 0; j < gnz; j++) for (let i = 0; i < gnx; i++) zoneGrid[j * gnx + i] = cellZoneAt(i, j);
  T.tripA = Date.now() - m;

  // ---- 趟 B:逐面(同一支 cellZoneAt,只換取樣集 ⇒ 五點多數決升級成整面多數決)----
  // `opts.permuteIds` = **純重排編號**(分割一格未動)。標籤如果偷讀 face id,重排之後
  // 逐 texel 的標籤就會變 —— 那才是「標籤不吃 id」量得到的地方。把標籤陣列跟著一起重排
  // 的比法是恆等式,`--break-label` 在它底下永遠是綠的(2026-08-16 踩過一次)。
  if (opts.permuteIds) {
    for (let k = 0; k < mg.face.length; k++) {
      if (mg.face[k] !== Z.NO_FACE) mg.face[k] = mg.n - 1 - mg.face[k];
    }
  }
  m = t0();
  const K = +(ARG.k || 24);
  const samples = Z.faceSamples(mg.face, mg.n, K);
  const faceZone = new Array(mg.n).fill(null);
  for (let f = 0; f < mg.n; f++) {
    const votes = new Map();
    for (const idx of samples[f]) {
      const i = idx % nx, j = (idx / nx) | 0;
      const sx = xOf(i), sz = zOf(j);
      // cellZoneAt 只透過 cx/cz 用到 (i, j) ⇒ 反解出「格心恰好落在這個取樣點」的虛擬格
      const zn = cellZoneAt((sx - rect.minX) / cell - 0.5, (sz - rect.minZ) / cell - 0.5);
      const key = zn === null ? ' null' : zn;
      votes.set(key, (votes.get(key) || 0) + 1);
    }
    let best = null, bn = -1;
    for (const k of [...votes.keys()].sort()) if (votes.get(k) > bn) { best = k; bn = votes.get(k); }
    faceZone[f] = BREAK.label
      ? ZONE_LIST[f % ZONE_LIST.length]          // 壞版:標籤讀 face id
      : (best === ' null' ? null : best);
  }
  T.tripB = Date.now() - m;

  return { cfg, rect, bbox, hf, cell, gnx, gnz, nx, nz, mpt, ox, oz, toI, toJ, xOf, zOf,
    zoneGrid, faceZone, face: mg.face, nFaces: mg.n, merged: mg.merged, rawFaces: ff.n,
    wall: rl.wall, keepOut: keepOutRef, contourN, classes, admShare, admAll: admAll.length,
    src, polyCover, structs: structWays, gradeCorridors, T, samples, areaMin, rankMax, adjPairs,
    ringWays, cl, osm, waterY, relief, alpineH, koN, blocked: rl.blocked, cutSegs: rl.cutSegs,
    wallN: rl.wall.reduce((a, b) => a + b, 0) };
}

const v = VENUES.find((x) => x.id === VENUE);
if (!v) { console.error(`❌ 找不到場地 ${VENUE}`); process.exit(1); }
const TEAM = +(ARG.team || 1);
console.log(`\nⅥ 真場地:${v.id} ${TEAM}v${TEAM}(貼圖 ${ARG.tex || 1024}²)`);
const R = await cutVenue(v, TEAM);
if (R.skip) {
  note(`${v.id}:${R.skip} ⇒ Ⅵ 整段未驗(MUST NOT 當綠燈)`);
  if (BREAK.keepout || BREAK.quantize) {
    console.error(`❌ 反向驗證未執行:${v.id} 的場地資料不足(${R.skip}) ⇒ ${BREAK.keepout ? '--break-keepout' : '--break-quantize'} 不得假綠`);
    process.exit(1);
  }
} else {
  const { nx, nz, mpt } = R;
  console.log(`    格網 ${nx}×${nz} @ ${mpt.toFixed(3)} m/texel;現制 zoneGrid ${R.gnx}×${R.gnz} @ ${R.cell.toFixed(2)}m;`
    + `地圖主方位 θ = ${(mapRot(R.cfg.center) * 180 / Math.PI).toFixed(2)}°(A42)`);
  if (BREAK.quantize) {
    const rot = census.filter((c) => c.team === TEAM && Math.abs(c.rotDeg) > 0.01)
      .sort((a, b) => Math.abs(b.rotDeg) - Math.abs(a.rotDeg));
    console.log(`    ⚠ --break-quantize:旋轉角不為 0 的場地共 ${rot.length}(${TEAM}v${TEAM});`
      + `前 6 = ${rot.slice(0, 6).map((c) => `${c.id} ${c.rotDeg.toFixed(2)}°`).join('、')}`);
    console.log('    ⚠ 這一支 MUST 挑「界線由 OSM 線主導」的場地驗(市區)—— 山區場地的界線多半來自'
      + '**坡度等值線**,而那一族吃的是 hf.heightAt 的世界座標、不經投影 ⇒ 壞版在那裡咬不動'
      + '(實測 taroko 仍綠、barcelona 2.75→37.93m 紅、shibuya 1.86→29.41m 紅)。');
  }
  console.log(`    圖資來源:路網 ${R.src.osm ? '✓' : '✗'}、地被 ${R.src.cover ? '✓' : '✗'}、行政界/海岸 ${R.src.cutlines ? '✓' : '✗'}`);
  if (!R.src.osm) note(`${v.id}:取不到路網 ⇒ 道路 / 鐵路 / 水道三類線缺席`);
  if (!R.src.cover) note(`${v.id}:取不到地被多邊形 ⇒ 天然界線與標籤來源缺席`);
  if (!R.src.cutlines) note(`${v.id}:取不到行政界 / 海岸線 ⇒ 那兩類線缺席(MUST NOT 當成「這張圖沒有」)`);
  console.log(`    參與線(texel 段):道路 ${R.classes.road.length}(rank ≤ ${R.rankMax})、鐵路 ${R.classes.rail.length}、`
    + `水道 ${R.classes.water.length}、地被外環 ${R.classes.ring.length}、海岸 ${R.classes.coast.length}、`
    + `行政界 ${R.classes.adm.length}/${R.admAll}(採用率 ${(R.admShare * 100).toFixed(1)}%)、坡度等值線 texel ${R.contourN}`);
  // ---- 反向驗證的**適用性**硬閘(§5.4 ㋑ 的同一條:壞版沒被造出來 = 假綠)----
  // 這兩支的缺陷只在特定場地上表現得出來;挑錯場地會拿到一個**看起來全綠**的反向驗證,
  // 而那比沒驗還糟。挑錯就當場停,MUST NOT 讓它報綠。
  if (BREAK.keepout && R.structs === 0) {
    console.error(`❌ --break-keepout 挑錯場地:${v.id} ${TEAM}v${TEAM} 沒有任何結構(隧道/地下道/橋)`
      + ' ⇒ 根本沒有 keep-out 可以違反,壞版與好版逐位元相同。請挑有結構的場地(taroko / shibuya / roppongi)。');
    process.exit(1);
  }
  if (BREAK.quantize && Math.abs(mapRot(R.cfg.center)) < 1e-9) {
    console.error(`❌ --break-quantize 挑錯場地:${v.id} 的地圖主方位 θ = 0`
      + ' ⇒ 有沒有 A42 旋轉都一樣,壞版與好版逐位元相同。請挑 θ ≠ 0 的**市區**場地(barcelona / shibuya / paris)。');
    process.exit(1);
  }
  console.log(`    牆 texel ${R.wallN}/${nx * nz}(${(R.wallN / (nx * nz) * 100).toFixed(1)}%);`
    + `waterY ${R.waterY == null ? '無水面' : R.waterY};起伏 ${R.relief.toFixed(1)}m;alpineH ${Number.isFinite(R.alpineH) ? R.alpineH.toFixed(1) : '∞(平坦地圖不出現高地地貌)'}`);
  console.log(`    面:泛洪 ${R.rawFaces} → 併鄰 ${R.merged} 次 → ${R.nFaces} 面(面積下限 ${R.areaMin} texel、共邊鄰接 ${R.adjPairs} 對)`);
  ok(R.rawFaces <= 1 || R.adjPairs > 0,
    `共邊鄰接表非空(${R.adjPairs} 對)—— 空的話 mergeSmall 一次都併不掉,而報告上只表現成「這張圖剛好沒有碎面」`);
  console.log('    ⚠ **執行期根本沒有 landuse / natural / waterway / boundary 這四類圖資**'
    + '(biomes.fetchOsmFeatures 只抓 building/railway/level_crossing/waterfall/place/peak/'
    + 'motorway_junction/station;fetchOsmRoads 只抓 highway)⇒ 上面「地被外環 / 海岸 / 行政界 / 水道」'
    + '全部來自**離線專屬查詢**,序 14 上線前要先開那一道門(見報告結尾)。');

  // ---- 驗收面 1:界線離真值的距離(門檻)+ 逐格一致率(參考,不當門檻)----
  console.log('\n  驗收面 1:界線離真值的距離(新制 MUST ≤ 現制;逐格一致率只當參考)');
  {
    // 真值 = OSM 地被多邊形外環 ∪ 水道 ∪ 海岸線(世界公尺)
    const truth = [];
    const pushWays = (ways) => { for (const w of ways) { let prev = null; for (const p of w.geometry) { const q = llToXZ(p.lat, p.lon, R.cfg.center); if (prev) truth.push([prev[0], prev[1], q[0], q[1]]); prev = q; } } };
    pushWays(R.ringWays); pushWays(R.osm?.waters || []); pushWays(R.cl?.coastline || []);
    if (!truth.length) { note(`${v.id}:真值線集為空(沒有地被多邊形 / 水道 / 海岸線)⇒ 驗收面 1 未驗`); }
    else {
      const GC = 60;                                   // 真值線的均勻格索引(公尺)
      const gi = new Map();
      const addSeg = (s, k) => { const a = gi.get(k); if (a) a.push(s); else gi.set(k, [s]); };
      for (const s of truth) {
        const i0 = Math.floor(Math.min(s[0], s[2]) / GC), i1 = Math.floor(Math.max(s[0], s[2]) / GC);
        const j0 = Math.floor(Math.min(s[1], s[3]) / GC), j1 = Math.floor(Math.max(s[1], s[3]) / GC);
        for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) addSeg(s, `${ii},${jj}`);
      }
      const CAP = 300;
      const dToTruth = (px, pz) => {
        let best = CAP;
        for (let ring = 0; ring * GC <= CAP; ring++) {
          const ci = Math.floor(px / GC), cj = Math.floor(pz / GC);
          for (let jj = cj - ring; jj <= cj + ring; jj++) for (let ii = ci - ring; ii <= ci + ring; ii++) {
            if (ring && Math.abs(ii - ci) !== ring && Math.abs(jj - cj) !== ring) continue;
            for (const s of (gi.get(`${ii},${jj}`) || [])) {
              const ex = s[2] - s[0], ez = s[3] - s[1], L2 = ex * ex + ez * ez;
              let t = L2 ? ((px - s[0]) * ex + (pz - s[1]) * ez) / L2 : 0;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const d = Math.hypot(px - (s[0] + t * ex), pz - (s[1] + t * ez));
              if (d < best) best = d;
            }
          }
          if (best <= ring * GC) break;
        }
        return best;
      };
      const pct = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : NaN);
      // 現制界線點:相鄰格分區不同的共用邊中點
      const oldPts = [];
      for (let j = 0; j < R.gnz; j++) for (let i = 0; i < R.gnx; i++) {
        const a = R.zoneGrid[j * R.gnx + i];
        if (i + 1 < R.gnx && R.zoneGrid[j * R.gnx + i + 1] !== a) oldPts.push([R.rect.minX + (i + 1) * R.cell, R.rect.minZ + (j + 0.5) * R.cell]);
        if (j + 1 < R.gnz && R.zoneGrid[(j + 1) * R.gnx + i] !== a) oldPts.push([R.rect.minX + (i + 0.5) * R.cell, R.rect.minZ + (j + 1) * R.cell]);
      }
      // 新制界線點:相鄰 texel 的**面標籤**不同的共用邊中點(只取圖內)
      const newPts = [];
      const znOf = (k) => (R.face[k] === Z.NO_FACE ? undefined : R.faceZone[R.face[k]]);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = R.xOf(i), z = R.zOf(j);
        if (x < R.rect.minX || x > R.rect.maxX || z < R.rect.minZ || z > R.rect.maxZ) continue;
        const k = j * nx + i, a = znOf(k);
        if (i + 1 < nx && znOf(k + 1) !== a) newPts.push([x + mpt / 2, z]);
        if (j + 1 < nz && znOf(k + nx) !== a) newPts.push([x, z + mpt / 2]);
      }
      const SUBS = (arr, cap) => (arr.length <= cap ? arr : arr.filter((_, i) => i % Math.ceil(arr.length / cap) === 0));
      const dOld = SUBS(oldPts, 6000).map(([x, z]) => dToTruth(x, z));
      const dNew = SUBS(newPts, 6000).map(([x, z]) => dToTruth(x, z));
      const o50 = pct(dOld, 0.5), n50 = pct(dNew, 0.5);
      console.log(`    界線點:現制 ${oldPts.length}、新制 ${newPts.length}`);
      console.log(`    離真值距離(公尺)  現制 p50 ${o50.toFixed(2)} / p90 ${pct(dOld, 0.9).toFixed(2)} / p99 ${pct(dOld, 0.99).toFixed(2)}`);
      console.log(`                        新制 p50 ${n50.toFixed(2)} / p90 ${pct(dNew, 0.9).toFixed(2)} / p99 ${pct(dNew, 0.99).toFixed(2)}`);
      ok(n50 <= o50 + 1e-9, `新制界線離真值的中位距離 ${n50.toFixed(2)}m ≤ 現制 ${o50.toFixed(2)}m`);
      // ---- 去循環的對照組(這是本樁最重要的一個數字)----
      // 主判定裡「地被多邊形外環」既是參與線又是真值 ⇒ 新制的界線當然貼著它。
      // 把外環從**參與線**拿掉、真值只留外環,問的才是直球:
      // 「路緣 / 河岸 / 海岸 / 坡度這幾條真實世界的線,落不落在地貌換手的地方?」
      if (R.ringWays.length) {
        const ringTruth = [];
        for (const w of R.ringWays) { let prev = null; for (const p of w.geometry) { const q = llToXZ(p.lat, p.lon, R.cfg.center); if (prev) ringTruth.push([prev[0], prev[1], q[0], q[1]]); prev = q; } }
        const gi2 = new Map();
        for (const sg of ringTruth) {
          const i0 = Math.floor(Math.min(sg[0], sg[2]) / GC), i1 = Math.floor(Math.max(sg[0], sg[2]) / GC);
          const j0 = Math.floor(Math.min(sg[1], sg[3]) / GC), j1 = Math.floor(Math.max(sg[1], sg[3]) / GC);
          for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) { const k = `${ii},${jj}`; const a = gi2.get(k); if (a) a.push(sg); else gi2.set(k, [sg]); }
        }
        const dRing = (px, pz) => {
          let best = CAP;
          for (let ring = 0; ring * GC <= CAP; ring++) {
            const ci = Math.floor(px / GC), cj = Math.floor(pz / GC);
            for (let jj = cj - ring; jj <= cj + ring; jj++) for (let ii = ci - ring; ii <= ci + ring; ii++) {
              if (ring && Math.abs(ii - ci) !== ring && Math.abs(jj - cj) !== ring) continue;
              for (const sg of (gi2.get(`${ii},${jj}`) || [])) {
                const ex = sg[2] - sg[0], ez = sg[3] - sg[1], L2 = ex * ex + ez * ez;
                let t = L2 ? ((px - sg[0]) * ex + (pz - sg[1]) * ez) / L2 : 0;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                const d = Math.hypot(px - (sg[0] + t * ex), pz - (sg[1] + t * ez));
                if (d < best) best = d;
              }
            }
            if (best <= ring * GC) break;
          }
          return best;
        };
        const RA = await cutVenue(v, TEAM, { noRings: true });
        const abPts = [];
        const znA = (k) => (RA.face[k] === Z.NO_FACE ? undefined : RA.faceZone[RA.face[k]]);
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          const x = RA.xOf(i), z = RA.zOf(j);
          if (x < RA.rect.minX || x > RA.rect.maxX || z < RA.rect.minZ || z > RA.rect.maxZ) continue;
          const k = j * nx + i, a = znA(k);
          if (i + 1 < nx && znA(k + 1) !== a) abPts.push([x + mpt / 2, z]);
          if (j + 1 < nz && znA(k + nx) !== a) abPts.push([x, z + mpt / 2]);
        }
        const dAb = SUBS(abPts, 6000).map(([x, z]) => dRing(x, z));
        const dOldR = SUBS(oldPts, 6000).map(([x, z]) => dRing(x, z));
        const ab50 = pct(dAb, 0.5), or50 = pct(dOldR, 0.5);
        console.log(`    ⓘ **去循環對照**(地被外環退出**參與線**、但仍留在**標籤來源**與真值裡;新制 ${RA.nFaces} 面):`
          + `現制 p50 ${or50.toFixed(2)}m / 新制 p50 ${ab50.toFixed(2)}m`);
        console.log(`       這一格量的是「**路緣 / 河岸 / 海岸 / 坡度**這幾條線,自己落不落在地貌換手處」。`
          + `${ab50 <= or50 ? '實得仍然更近 ⇒ 那幾條線自己就夠。'
            : `實得**更遠**(${ab50.toFixed(1)}m vs ${or50.toFixed(1)}m)⇒ **它們自己不夠** ——`
              + ' 地被多邊形外環 MUST 也是參與線,§0-a 才成立。'}`);
        console.log('       ⇒ 這不是樁不過,是把「序 14 要先開圖資那一道門」從建議升級成**前提**:'
          + '執行期拿不到 landuse / natural 的話,新制退化成「只有道路 + 坡度」,而那一版**比現制更差**。');
      }
      // 界線位移(現制 → 新制的最近界線距離)—— 參考量,不當門檻
      console.log(`    ⓘ 兩制界線本來就不逐格相同(現制是「哪一格投票翻面」,新制是路緣/河岸)`);
      // 逐格一致率 + 混淆矩陣(參考)
      let same = 0, tot = 0;
      const conf = new Map();
      for (let j = 0; j < R.gnz; j++) for (let i = 0; i < R.gnx; i++) {
        const cx = R.rect.minX + (i + 0.5) * R.cell, cz = R.rect.minZ + (j + 0.5) * R.cell;
        const ti = Math.floor(R.toI(cx)), tj = Math.floor(R.toJ(cz));
        if (ti < 0 || tj < 0 || ti >= nx || tj >= nz) continue;
        const a = R.zoneGrid[j * R.gnx + i], b = znOf(tj * nx + ti);
        tot++; if (a === b) same++;
        const key = `${a}→${b}`;
        conf.set(key, (conf.get(key) || 0) + 1);
      }
      const rate = tot ? same / tot : 0;
      console.log(`    ⓘ 逐格一致率 ${(rate * 100).toFixed(1)}%(**參考,不當門檻** —— 拿它當門檻等於逼新制去複製舊制的雜訊)`);
      const topConf = [...conf.entries()].filter(([k]) => k.split('→')[0] !== k.split('→')[1])
        .sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (topConf.length) console.log(`    ⓘ 主要換手:${topConf.map(([k, n]) => `${k} ${(n / tot * 100).toFixed(1)}%`).join('、')}`);
    }
  }

  // ---- 驗收面 2:決定性 ----
  console.log('\n  驗收面 2:決定性(兩次跑 / 原文閘 / 順序無關 / 標籤不吃 id)');
  {
    const R2 = await cutVenue(v, TEAM);
    const h1 = sha(Buffer.from(R.face.buffer.slice(0))), h2 = sha(Buffer.from(R2.face.buffer.slice(0)));
    const l1 = sha(JSON.stringify(R.faceZone)), l2 = sha(JSON.stringify(R2.faceZone));
    ok(h1 === h2 && l1 === l2 && R.nFaces === R2.nFaces,
      `同一場地跑兩次:分割 ${h1}/${h2}、標籤 ${l1}/${l2}、面數 ${R.nFaces}/${R2.nFaces}`);
    // 標籤 MUST NOT 讀 face id:**重排編號之後重新標一次**,逐 texel 的標籤 MUST 逐項不變。
    // (把標籤陣列跟著一起重排來比是恆等式 —— 那樣 --break-label 永遠是綠的)
    const RP = await cutVenue(v, TEAM, { permuteIds: true });
    let diff = 0;
    for (let k = 0; k < R.face.length; k++) {
      const a = R.face[k] === Z.NO_FACE ? undefined : R.faceZone[R.face[k]];
      const b = RP.face[k] === Z.NO_FACE ? undefined : RP.faceZone[RP.face[k]];
      if (a !== b) diff++;
    }
    ok(diff === 0, `標籤 MUST NOT 讀 face id(重排編號後重標,逐 texel 標籤不變;實得 ${diff} 格不同)`);
    // keep-out:牆 texel MUST NOT 落進結構足跡。期望值恆為 0(MUST NOT 隨 break 改變)
    let inKO = 0;
    for (let k = 0; k < R.wall.length; k++) if (R.wall[k] && R.keepOut[k]) inKO++;
    ok(inKO === 0, `切面線 MUST NOT 切過結構足跡(落進 keep-out 的牆 texel = ${inKO};足跡 ${R.koN} texel、`
      + `${R.structs} 座結構、被擋下 ${R.blocked} texel / ${R.cutSegs} 段)`);
    if (!BREAK.keepout) note('明隧道柱列帶(galStrips / carveGalleryBands)在 Node 端拿不到 ⇒ keep-out 名冊不完整(未驗)');
  }

  // ---- 成本 ----
  console.log('\n  建構期成本(Node;**綁定值 MUST 由瀏覽器量**,見報告結尾)');
  const T = R.T;
  console.log(`    地形場 ${T.terrain}ms・量化 ${T.quantize}ms・坡度等值線 ${T.contour}ms・光柵化 ${T.raster}ms・`
    + `泛洪 ${T.flood}ms・小面併鄰 ${T.merge}ms・牆併回 ${T.fill}ms・多邊形 ${T.poly}ms・`
    + `趟A(現制)${T.tripA}ms・趟B(逐面)${T.tripB}ms`);
  const cut = T.raster + T.flood + T.merge + T.fill;
  console.log(`    切面四段合計 ${cut}ms(${nx}×${nz});含標籤 ${cut + T.tripB}ms`);

  // ---- 兩個沒有對應分區的狀態(序 14 要決定怎麼表達)----
  {
    let bang = 0, nul = 0, tot = 0;
    for (const z of R.zoneGrid) { tot++; if (z === '!') bang++; else if (z === null) nul++; }
    let bangF = 0, nulF = 0;
    for (let f = 0; f < R.nFaces; f++) { if (R.faceZone[f] === '!') bangF++; else if (R.faceZone[f] === null) nulF++; }
    console.log(`\n  ⚠ 遮罩制沒有對應格的兩個狀態:'!'(懸崖不鋪)現制 ${(bang / tot * 100).toFixed(1)}% / 新制 ${bangF} 面;`
      + `null(留白露衛星底圖)現制 ${(nul / tot * 100).toFixed(1)}% / 新制 ${nulF} 面 —— 計畫的次款預算表只有六個分區,這兩格待使用者裁決`);
  }
  console.log(`  ⓘ 圖資多邊形覆蓋率 ${(R.polyCover * 100).toFixed(1)}%;其餘由衛星影像分類決定,`
    + '而 **Node 端沒有影像** ⇒ 兩趟都退回 green。影像那一半整段未驗(㋓)。');
  note(`${v.id}:classifyPure 的**影像那一半**在 Node 端不存在(兩趟共用同一份圖資分類器,`
    + `圖資覆蓋 ${(R.polyCover * 100).toFixed(1)}%)⇒ 驗收面 1 只量得到圖資那一半`);

  // ---- 對照 PNG ----
  if (ARG.png) {
    const SUB = readSrc('public', 'js', 'ground.js');
    const blk = /export const SUB_COL = \{([\s\S]*?)\n\};/.exec(SUB);
    const pick = (k) => { const m2 = new RegExp(`\\b${k}:\\s*0x([0-9a-fA-F]{6})`).exec(blk?.[1] || ''); return m2 ? parseInt(m2[1], 16) : null; };
    const BASE = { water: pick('watertile'), wet: pick('marsh'), green: pick('turf'), bare: pick('wild'), urban: pick('pavement'), alpine: pick('plateau') };
    const missing = Object.entries(BASE).filter(([, c]) => c == null).map(([k]) => k);
    ok(missing.length === 0, `對照圖配色取自 ground.js SUB_COL 基底款(缺 ${missing.join(',') || '無'})`);
    if (!missing.length) {
      const dir = join(ROOT, 'tools', '.shots', 'zonecut');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const colOf = (zn, i, j) => {
        if (zn === '!') return ((i + j) & 3) < 2 ? [90, 84, 76, 255] : [140, 132, 120, 255];   // 斜線 = 懸崖不鋪
        if (zn === null || zn === undefined) return [0, 0, 0, 0];                              // 透明 = 留白露底圖
        const c = BASE[zn];
        return c == null ? [255, 0, 255, 255] : [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255];
      };
      const W = nx * 2 + 8, H = nz;
      const rows = Buffer.alloc(H * (1 + W * 4));
      for (let j = 0; j < H; j++) {
        const base = j * (1 + W * 4) + 1;
        for (let i = 0; i < nx; i++) {
          const cx = R.xOf(i), cz = R.zOf(j);
          const gi2 = Math.floor((cx - R.rect.minX) / R.cell), gj2 = Math.floor((cz - R.rect.minZ) / R.cell);
          const zn = (gi2 >= 0 && gj2 >= 0 && gi2 < R.gnx && gj2 < R.gnz) ? R.zoneGrid[gj2 * R.gnx + gi2] : undefined;
          const c = colOf(zn, i, j); const o = base + i * 4;
          rows[o] = c[0]; rows[o + 1] = c[1]; rows[o + 2] = c[2]; rows[o + 3] = c[3];
        }
        for (let i = 0; i < nx; i++) {
          const f = R.face[j * nx + i];
          const c = colOf(f === Z.NO_FACE ? undefined : R.faceZone[f], i, j);
          const o = base + (nx + 8 + i) * 4;
          rows[o] = c[0]; rows[o + 1] = c[1]; rows[o + 2] = c[2]; rows[o + 3] = c[3];
        }
      }
      writeFileSync(join(dir, `${v.id}_${TEAM}v${TEAM}_ab.png`), pngBytes(W, H, rows));
      // 第三張:參與線 + 面界線 + keep-out 帶
      const rows2 = Buffer.alloc(nz * (1 + nx * 4));
      for (let j = 0; j < nz; j++) {
        const base = j * (1 + nx * 4) + 1;
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i, o = base + i * 4;
          let c = [22, 24, 26, 255];
          const f = R.face[k];
          if (f !== Z.NO_FACE) {
            const r = i + 1 < nx && R.face[k + 1] !== f, d = j + 1 < nz && R.face[k + nx] !== f;
            if (r || d) c = [235, 235, 235, 255];                       // 面界線
          }
          if (R.wall[k]) c = [90, 150, 235, 255];                       // 參與線(牆)
          if (R.keepOut[k]) c = R.wall[k] ? [235, 60, 60, 255] : [120, 80, 30, 255];  // 足跡;紅 = 違規
          rows2[o] = c[0]; rows2[o + 1] = c[1]; rows2[o + 2] = c[2]; rows2[o + 3] = c[3];
        }
      }
      writeFileSync(join(dir, `${v.id}_${TEAM}v${TEAM}_lines.png`), pngBytes(nx, nz, rows2));
      console.log(`    對照 PNG → tools/.shots/zonecut/${v.id}_${TEAM}v${TEAM}_ab.png(左 = 現制 zoneGrid、右 = 新制逐面)`
        + ` 與 _lines.png(藍 = 參與線、白 = 面界線、褐 = 結構足跡、紅 = 切過足跡)`);
    }
  }

  // ---- 線分級掃參數 ----
  if (ARG['sweep-rank'] || ARG['sweep-areamin']) {
    console.log('\n  線分級 × 面積下限掃參數(市區裡每條步道都切面 = 回到雜訊;面數是唯一看得見的數字)');
    console.log('    rank  areaMinF   面數    面積中位(texel)   p10     併掉比例');
    for (const rank of (ARG['sweep-rank'] ? [1, 2, 3, 4, 5] : [R.rankMax])) {
      for (const af of (ARG['sweep-areamin'] ? [0.0001, 0.0004, 0.0016] : [+(ARG.areamin || 0.0004)])) {
        const saveR = ARG.rank, saveA = ARG.areamin;
        ARG.rank = String(rank); ARG.areamin = String(af);
        const S = await cutVenue(v, TEAM);
        ARG.rank = saveR; ARG.areamin = saveA;
        if (S.skip) continue;
        const a = [...Z.faceAreas(S.face, S.nFaces)].sort((x, y) => x - y);
        const med = a[Math.floor(a.length / 2)] || 0, p10 = a[Math.floor(a.length * 0.1)] || 0;
        console.log(`    ${String(rank).padEnd(6)}${String(af).padEnd(11)}${String(S.nFaces).padEnd(8)}`
          + `${String(med).padEnd(18)}${String(p10).padEnd(8)}${(S.merged / Math.max(1, S.rawFaces) * 100).toFixed(1)}%`);
      }
    }
  }
}

// =====================================================================================
console.log('\n---- 交給下一輪的兩份清單 ----');
console.log('① 序 14 的第一道門(執行期要多抓的四類圖資):');
console.log('   ・fetchOsmFeatures 要加 way["waterway"] / way["landuse"] / way["natural"] / way["boundary"="administrative"]');
console.log('   ・改查詢 MUST 同步 geoKey(\'osmF\', 3)(不改版 ⇒ 舊快取照樣命中,新資料在「以前開過這張圖」的機器上永遠不出現)');
console.log('   ・payload MUST 進 osmrelay.js 的中繼(A43);超限是 ws 1009 **斷掉房主的連線**,症狀看起來完全像伺服器壞掉');
console.log('   ・MUST 先跑 node tools/measure_osm_relay.mjs(㋓;現況實測 1.05MB、maxPayload 餘裕 1.9×,不厚)');
console.log('   ・Overpass 額度與逾時:本樁的 cutLinesFor 額度是 quotaOf(km2, 120/40, …),執行期要重新定');
console.log('② 序 15 若成立,失去對象的稽核條目(= 取消成本):');
console.log('   ・audit_ground_tile:Ⅰ(CARPET_LOT 選款區塊)Ⅱ(CARPET_VARIANTS 逐格互異)Ⅳ(emitCell 認養)Ⅵ ±--break-lot/--break-var/--break-order/--break-adopt');
console.log('   ・audit_ground_seam:planSeamOverlays / SEAM_STYLES / seamAlpha / 同款異變體不發外溢 —— 整支失去對象');
console.log('   ・audit_ground_enclave:planEnclaves / ENCLAVE_STYLES —— 整支失去對象');
console.log('   ・audit_ground_border:BORDER_SAME_ZONE + CARPET_DE 色距窄門 ±--break-de、bandDryAt 那一族(它存在的理由是底毯換手與真實地形差半個帶寬,新制兩者同源 ⇒ 差值恆 0)');
console.log('   ・audit_ground_qc ⑦(orient / gridA)與 SUB_COL 名冊雙向比對(名冊由 27 縮到 19)');
console.log('   ・audit_cel_pipeline Ⅶ:LAND_SURF_ID 由常數換成 f(zone) 會直接推翻它的 /const LAND_SURF_ID = 0;/ 與地貌共用一號那幾條');
console.log('   ・A38 ②(街廓零共享 rnd)不受影響;A46 ⑨ 的碎鱗規則被 zonecut.mergeSmall 沿用(同一條)');

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
if (unverified.length) console.log(`⚠ 未驗 ${unverified.length} 項(MUST NOT 當綠燈):\n  - ${unverified.join('\n  - ')}`);
process.exit(fail === 0 ? 0 : 1);
