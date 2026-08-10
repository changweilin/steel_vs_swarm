// ============ 世界邊界(不可越過的障礙環 + 不可進入的緩衝空間) 稽核 ============
// 用途:改 `data.js` 的 `WORLD_EDGE`/`edgeWallInsetM`/`heroTallestH`/`edgeWallHM`/`edgeBufferM`、
// `biomes.js` 的 `buildEdgeWall`/`placeBoundary` 的帶寬/`buildRoadBlocks` 的內縮/散布內縮 `inb`、
// `terrain.js` 的外緣裙、`game.js` 的邊界夾制,或任何會動到地平線的東西(射程/砲塔/機體尺寸,
// 因為 `edgeBufferM` ← `curveHorizonM`)之後跑。
//
// 使用者定案(2026-08-10)一句:「邊界加入不可越過的障礙,會再延伸可視距離但不可進入的緩衝空間」。
// 拆成兩個可量測的不變式,本稽核逐條釘死:
//
//   Ⅰ 推導不手寫 —— 環高 ← 最高機體全高、緩衝深度 ← 地平線距離。手寫公尺數的下場是改了
//       射程/砲塔/機體之後地平線自己跑掉、裙留在原地,而畫面上只表現成「某些場地站在邊界
//       看得到世界的盡頭」。
//   Ⅱ 「不可越過」是**結構保證**不是校準 —— 以**真品原文**的 `buildEdgeWall` 跑合成地形,
//       驗環上**沒有縫**(相鄰段的區間互相咬住,聯集覆蓋整條邊)。有縫的話「穿不過去」就
//       退化成「看最窄的機體有多寬」那種校準,而最窄的那一台隨平衡數值漂。
//   Ⅲ 兩端同一個盒 —— 演出的箱子與登記的碰撞盒逐位元同尺寸(A30 / 原則 4:看到多粗 =
//       撞到多粗 = 打到多粗);環頂刻意不可站立(掛 bld/std 就變成「跳上牆沿著邊界跑」)。
//   Ⅳ 單一縫 + 順序 —— 內縮量只有 `edgeWallInsetM()` 一份(夾制 / 環體 / 封路 / 散布內縮 /
//       邊界帶同吃);環 MUST 是 `blockers` 的第一批(`main.js` 的 occ 上傳是
//       `slice(0, LOS.MAX_OCC)`,排尾端會被密集市區擠掉 = 伺服器不知道有牆)。
//   Ⅴ 緩衝空間 —— 深度推導、與地形逐點水密(內緣取地形格距)、共用地形材質(不新增第四份
//       envMat)、內域的格留給真地形。
//   Ⅵ 純表現層 —— 裙不進 blockers/occ/heights,伺服器對這一整套一無所知(原則 4)。
//
// 跑法:`node tools/audit_world_edge.mjs`(不需伺服器/瀏覽器/網路)
//       反向驗證:`--break-lap`(段長重疊係數 < 1 ⇒ 環上出現縫 ⇒ Ⅱ 紅)
//                 `--break-buffer`(緩衝深度砍半 ⇒ 外緣落進地平線之內 ⇒ Ⅰ・Ⅴ 紅)
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabFn } from './audit_src.mjs';
import {
  WORLD_EDGE, edgeWallInsetM, heroTallestH, edgeWallHM, edgeBufferM,
  objHeightMax, curveHorizonM, curveMaxEdgeM, CHARACTERS, charKind, heroTargetH, xzToLL,
} from '../public/js/data.js';

if (process.argv.includes('--break-lap')) WORLD_EDGE.SEG_LAP_F = 0.8;
if (process.argv.includes('--break-buffer')) WORLD_EDGE.BUFFER_F = 0.5;

const dataSrc = readSrc('public', 'js', 'data.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const simSrc = readSrc('server', 'sim.js');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
/** 只數執行原文,且跳過 import 區塊(import 也提得到同一個名字) */
const codeOf = (s) => strip(s).split("from './data.js';").slice(-1)[0];
const gameCode = codeOf(gameSrc), bioCode = codeOf(bioSrc), terrCode = codeOf(terrSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, re) => (s.match(re) || []).length;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ---- 真品原文的 buildEdgeWall(住在 import three 的檔案裡,Node 端 import 不了整支;
//      抄一份擺位公式進稽核則永遠會通過)----
const rec = [];   // 每個 InstancedMesh 的實例矩陣紀錄(驗「演出 = 碰撞」)
class V3 { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class Eul { set(x, y, z) { this.y = y; return this; } }
class Quat { setFromEuler(e) { this.y = e.y; return this; } }
class Mat4 {
  compose(p, q, s) { this.v = { px: p.x, py: p.y, pz: p.z, sx: s.x, sy: s.y, sz: s.z, ry: q.y }; return this; }
}
class IM {
  constructor(geo, mat, n) { this.mat = mat; this.count = n; this.inst = []; this.instanceMatrix = {}; rec.push(this); }
  setMatrixAt(i, m) { this.inst[i] = { ...m.v }; }
}
const THREE_STUB = {
  Matrix4: Mat4, Quaternion: Quat, Euler: Eul, Vector3: V3, InstancedMesh: IM, BoxGeometry: class {},
};
const classifyImg = new Function(`${grabFn(bioSrc, 'classifyImg')} return classifyImg;`)();
const buildEdgeWall = new Function(
  'THREE', 'envMat', 'classifyImg', 'WORLD_EDGE', 'edgeWallInsetM', 'edgeWallHM',
  `${grabFn(bioSrc, 'buildEdgeWall')} return buildEdgeWall;`,
)(THREE_STUB, (c, o) => ({ c, o }), classifyImg, WORLD_EDGE, edgeWallInsetM, edgeWallHM);

// 合成地形:起伏 + 斜坡(段身取樣的 lo/hi 要真的不同,平地驗不到「不懸空也不被吃掉」)
const T = {
  minX: -500, maxX: 500, minZ: -400, maxZ: 400, worldW: 1000, worldH: 800,
  heightAt: (x, z) => 30 + Math.sin(x / 37) * 9 + Math.cos(z / 53) * 7 + x * 0.02,
  sampleColor: (x) => (x < 0 ? [120, 120, 120] : [150, 120, 80]),
};
const group = { add: () => {} };
const blockers = [];
const segs = buildEdgeWall({ group, terrain: T, blockers });
const IN = edgeWallInsetM(), HD = WORLD_EDGE.WALL_T / 2;

// ============ Ⅰ 推導不手寫 ============
console.log('\nⅠ 推導不手寫(環高 ← 機體 / 緩衝 ← 地平線)');
{
  // 稽核端**獨立重算**最高機體,不呼叫被測的那一支去驗它自己
  let mx = 0;
  for (const ch of Object.keys(CHARACTERS)) mx = Math.max(mx, heroTargetH(charKind(ch), ch));
  t(`最高機體全高 ${mx.toFixed(2)}m 與 heroTallestH() 一致`, near(heroTallestH(), mx));
  t(`環高 ${edgeWallHM().toFixed(2)}m = 最高機體 × ${WORLD_EDGE.WALL_H_F}(夾在物件上限之內)`,
    near(edgeWallHM(), Math.min(objHeightMax(), mx * WORLD_EDGE.WALL_H_F)));
  t('環高 > 每一台機體的全高(沒有任何機體看得到自己越過它)', edgeWallHM() > mx);
  t(`環高 ${edgeWallHM().toFixed(1)}m ≤ 物件高度上限 ${objHeightMax()}m(與建物/地標同一個天花板)`,
    edgeWallHM() <= objHeightMax());
  t(`緩衝深度 ${edgeBufferM().toFixed(1)}m = 地平線 ${curveHorizonM().toFixed(1)}m × ${WORLD_EDGE.BUFFER_F}`,
    near(edgeBufferM(), curveHorizonM() * WORLD_EDGE.BUFFER_F));
  t('緩衝深度 ≥ 地平線距離(外緣恆落在「再往外也看不到」的那一圈之外)',
    edgeBufferM() >= curveHorizonM() - 1e-9,
    `（BUFFER_F=${WORLD_EDGE.BUFFER_F} ⇒ ${edgeBufferM().toFixed(1)} < ${curveHorizonM().toFixed(1)}）`);
  // 視點恆在環之內 ⇒ 到裙外緣至少多出 WALL_M 的餘裕
  t(`可達視點到裙外緣 ≥ ${(IN + edgeBufferM()).toFixed(0)}m > 地平線(還多出一段餘裕)`,
    IN + edgeBufferM() > curveHorizonM());
  const defs = ['edgeWallInsetM', 'edgeWallHM', 'edgeBufferM', 'heroTallestH'];
  for (const d of defs) {
    const m = new RegExp(`export const ${d} = [\\s\\S]*?;\\n`).exec(dataSrc);
    t(`${d}() 的定義式內無公尺數字面值(全部轉呼既有的尺)`,
      !!m && !/[^.\w]\d{2,}(\.\d+)?[^\w]/.test(m[0].replace(/WALL_M: ?\d+/, '')));
  }
}

// ============ Ⅱ 「不可越過」是結構保證(執行真品原文)============
console.log('\nⅡ 不可越過 = 環上沒有縫(真品 buildEdgeWall + 合成地形)');
{
  t(`四條邊都鋪滿(${segs.length} 段;perimeter/SEG_M ≈ ${Math.round(2 * (T.worldW + T.worldH) / WORLD_EDGE.SEG_M)})`,
    segs.length >= 2 * (T.worldW + T.worldH) / WORLD_EDGE.SEG_M - 4);
  // 逐邊做區間聯集:沿邊軸的 [d−half, d+half] MUST 首尾相連地覆蓋整條邊
  const byEdge = new Map();
  for (const s of segs) {
    const along = s.ry === 0 ? 'x' : 'z';
    const key = `${along}@${(along === 'x' ? s.z : s.x).toFixed(3)}`;
    (byEdge.get(key) || byEdge.set(key, []).get(key)).push(s);
  }
  t('恰四條邊', byEdge.size === 4, `（實得 ${byEdge.size}）`);
  let holes = 0, minLap = Infinity, covered = true;
  for (const [key, list] of byEdge) {
    const along = key[0] === 'x' ? 'x' : 'z';
    const lo = along === 'x' ? T.minX : T.minZ, hi = along === 'x' ? T.maxX : T.maxZ;
    const iv = list.map((s) => [ (along === 'x' ? s.x : s.z) - s.hw2, (along === 'x' ? s.x : s.z) + s.hw2 ])
      .sort((a, b) => a[0] - b[0]);
    if (iv[0][0] > lo + 1e-6 || iv[iv.length - 1][1] < hi - 1e-6) covered = false;
    for (let i = 1; i < iv.length; i++) {
      const lap = iv[i - 1][1] - iv[i][0];
      minLap = Math.min(minLap, lap);
      if (lap <= 0) holes++;
    }
  }
  t('環的兩端都蓋到圖界(四個角由 X 邊與 Z 邊互相跨過封死)', covered);
  t(`相鄰段互相咬住、零縫隙(最小重疊 ${minLap.toFixed(2)}m)`, holes === 0 && minLap > 0,
    `（${holes} 處有縫；SEG_LAP_F=${WORLD_EDGE.SEG_LAP_F}）`);
  t('重疊來自 SEG_LAP_F > 1 而不是碰巧(係數本身就是那個保證)', WORLD_EDGE.SEG_LAP_F > 1);
  // 內緣恰在夾制線上 ⇒ 地面機體恆先撞到環,game.js 那兩行永遠用不到
  let onLine = true, outward = true;
  for (const s of segs) {
    const inner = s.ry === 0
      ? (s.z < 0 ? s.z + s.hd2 - T.minZ : T.maxZ - (s.z - s.hd2))
      : (s.x < 0 ? s.x + s.hd2 - T.minX : T.maxX - (s.x - s.hd2));
    if (!near(inner, IN, 1e-6)) onLine = false;
    const outer = inner - WORLD_EDGE.WALL_T;
    if (outer < 0) outward = false;   // 環體整個在夾制線之外
  }
  t(`每一段的內緣恰好落在夾制線(內縮 ${IN}m)上`, onLine);
  t('環體整個位在夾制線之外(飛行機體停在夾制線上時不會卡進環裡)', outward);
  // 地形起伏:底埋進去、頂高出去
  let baseOk = true, topOk = true;
  for (const s of segs) {
    let lo = Infinity, hi = -Infinity;
    for (let k = -2; k <= 2; k++) {
      const o = k / 2 * s.hw2;
      const h = T.heightAt(s.ry === 0 ? s.x + o : s.x, s.ry === 0 ? s.z : s.z + o);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (s.y >= lo) baseOk = false;
    if (s.y + s.h < hi + edgeWallHM() - 1e-6) topOk = false;
  }
  t('斜坡上不懸空(底面埋在該段最低的地形之下)', baseOk);
  t(`頂面恆高出該段最高的地形 ${edgeWallHM().toFixed(1)}m`, topOk);
  const src = grabFn(bioSrc, 'buildEdgeWall');
  t('零共享 rnd 消耗(§2.3:插在任何位置都不推移植被佈局)',
    !/\brnd\s*\(/.test(strip(src)) && !/Math\.random/.test(strip(src)));
  t('選色走 classifyImg(純影像判、零亂數),MUST NOT 改吃會抽 rnd 的 classify',
    /classifyImg\(/.test(strip(src)) && !/[^g]\bclassify\(/.test(strip(src)));
  t('決定性:同一份輸入跑兩次逐位元相同',
    JSON.stringify(segs) === JSON.stringify(buildEdgeWall({ group, terrain: T, blockers: [] })));
}

// ============ Ⅲ 兩端同一個盒 ============
console.log('\nⅢ 演出 = 碰撞(A30 / 原則 4)');
{
  t(`碰撞柱數 = 段數(${blockers.length})`, blockers.length === segs.length);
  t('每一根都是有向盒(hw2/hd2/ry)且廣相 r = 外接半對角',
    blockers.every((b) => b.hw2 > 0 && b.hd2 > 0 && b.ry != null
      && near(b.r, Math.hypot(b.hw2, b.hd2))));
  t('環頂刻意不可站立(無 bld / std ⇒ 不進 makeBlockerTopIndex)',
    blockers.every((b) => !b.bld && !b.std));
  t('不可攀爬(無 cl ⇒ climb.js 不會把梯子架到邊界牆上)', blockers.every((b) => !b.cl));
  t(`ry 只取 0 / π/2(對稱盒在這兩個角度上「繞 +ry 還是 −ry」逐位元同判 ⇒ A30 的正負號坑天生不存在)`,
    blockers.every((b) => near(b.ry, 0) || near(b.ry, Math.PI / 2)));
  // 演出:body 的箱子尺寸 MUST 與碰撞盒逐位元相同
  const bodies = rec.filter((m) => m.inst.some((v) => v && Math.abs(v.sy) > 1));
  t('至少建出一個 InstancedMesh(合成地形涵蓋兩種地貌 ⇒ 至少兩種型式)', rec.length >= 4);
  let sameBox = true;
  for (const m of bodies) {
    for (const v of m.inst) {
      if (!v) continue;
      const s = segs.find((q) => near(q.x, v.px) && near(q.z, v.pz));
      if (!s) { sameBox = false; continue; }
      if (!near(v.sx, s.hw2 * 2) || !near(v.sz, s.hd2 * 2)) sameBox = false;
      if (!near(v.ry, s.ry)) sameBox = false;
    }
  }
  t('箱子的水平尺寸與朝向 = 碰撞盒(看到多粗 = 撞到多粗)', sameBox);
  const capMax = Math.min(0.9, edgeWallHM() * 0.14);
  const caps = rec.filter((m) => m.inst.some((v) => v && near(v.sy, capMax)));
  t('壓頂帶的腳印不大於環體(不外凸 ⇒ 沒有「看得見卻打不到」的簷)',
    caps.length > 0 && caps.every((m) => m.inst.every((v) => {
      if (!v) return true;
      const s = segs.find((q) => near(q.x, v.px) && near(q.z, v.pz));
      return s && v.sx <= s.hw2 * 2 + 1e-9 && v.sz <= s.hd2 * 2 + 1e-9;
    })));
}

// ============ Ⅳ 單一縫 + blockers 順序 ============
console.log('\nⅣ 單一縫與順序');
{
  t('`edgeWallInsetM` 在 data.js 恰一份定義', count(strip(dataSrc), /export const edgeWallInsetM/g) === 1);
  t('game.js 的邊界夾制吃 edgeWallInsetM()(不再手寫 40)',
    /edgeWallInsetM\(\)/.test(gameCode)
    && !/terrain\.minX \+ 40|terrain\.maxX - 40/.test(gameCode));
  t('夾制恰兩行(x / z 各一)且共用同一個 eIn',
    count(gameCode, /Math\.max\(this\.terrain\.min[XZ] \+ eIn/g) === 2);
  t('biomes.js 的封路內縮吃同一支(舊制手寫 `const INSET = 40` 已退場)',
    /const INSET = edgeWallInsetM\(\)/.test(bioCode) && !/const INSET = 40/.test(bioCode));
  t('地物散布內縮吃同一支(舊制 `const inb = 30` 已退場 —— 那個值讓落點抽得進環體)',
    /const inb = edgeWallInsetM\(\)/.test(bioCode) && !/const inb = 30/.test(bioCode));
  t('邊界帶的內緣由環推導(IN1 = 內縮 − 環厚,不手寫 34)',
    /IN1 = edgeWallInsetM\(\) - WORLD_EDGE\.WALL_T/.test(bioCode) && !/IN1 = 34/.test(bioCode));
  t('`buildEdgeWall` 一份實作、一個呼叫點',
    count(bioCode, /function buildEdgeWall/g) === 1
    && count(bioCode, /const edgeSegs = buildEdgeWall\(/g) === 1);
  // 順序:環 MUST 是 blockers 的第一批(main.js 的 occ 上傳會 slice 掉尾端)。
  // 比對的一律是**呼叫點**(`= fn(`)而不是 `fn(` —— 後者會先命中函式定義本身,而定義的位置
  // 與執行順序無關,那樣寫的稽核只是在量原始碼的排版。
  const iWall = bioCode.indexOf('const edgeSegs = buildEdgeWall(');
  const others = ['= placeMegaliths({', '= placeGiantGroves({', '= placeBeacons({', 'blockers.push(...roadRes.cols)'];
  t('環排在其餘每一個 blockers 生產者之前(occ 上傳 slice(0, LOS.MAX_OCC) 不會把它切掉)',
    iWall > 0 && others.every((k) => bioCode.indexOf(k) > iWall),
    `（${others.filter((k) => bioCode.indexOf(k) <= iWall).join(' / ')}）`);
  t('環同時登記進占位網格(邊界帶的樓群/神木經 occ.room 自動縮到環外)',
    /for \(const s of edgeSegs\) occ\.add\(/.test(bioCode));
  t(`段數遠低於 LOS.MAX_OCC(${segs.length} 段 ⇒ 上傳預算幾乎不受影響)`, segs.length < 400);
}

// ============ Ⅴ 緩衝空間(外緣裙)============
console.log('\nⅤ 緩衝空間:延伸可視距離、不可進入');
{
  t('terrain.js 自 data.js import edgeBufferM(不是自己算一份深度)',
    /edgeBufferM/.test(terrSrc.split('\n').find((l) => l.includes("from './data.js'")) || ''));
  t('裙的深度吃 edgeBufferM()、外帶細度吃 curveMaxEdgeM()(與水面同一把尺)',
    /const B = edgeBufferM\(\), OUT = Math\.max\(1, Math\.ceil\(B \/ curveMaxEdgeM\(\)\)\)/.test(terrCode));
  t('裙的內緣取地形自己的格距 N−1(粗格會在起伏地形上裂出幾公尺的縫)',
    /for \(let k = 1; k <= N - 1; k\+\+\) a\.push\(lo \+ \(\(hi - lo\) \* k\) \/ \(N - 1\)\)/.test(terrCode));
  t('內域的格留給真地形(只鋪「地形範圍之外」那一圈)',
    /if \(i >= OUT && i < OUT \+ N - 1 && j >= OUT && j < OUT \+ N - 1\) continue;/.test(terrCode));
  t('高度是地形自己的坡度外推 + 夾回全圖 [minH, maxH](不憑空造山)',
    /Math\.min\(maxH, Math\.max\(minH, h0 \+ g \* DEC \* \(1 - Math\.exp\(-d \/ DEC\)\)\)\)/.test(terrCode));
  t('接縫連續:d = 0 直接回 heightAt(邊點)= 地形自己那一顆頂點', /if \(d < 1e-6\) return h0;/.test(terrCode));
  t('與地形**共用材質**(影像路徑靠 UV 夾制取邊緣像素、無影像路徑走同一支 paintTerrainTones)',
    /new THREE\.Mesh\(sgeo, mat\)/.test(terrCode)
    && /paintTerrainTones\(sgeo, spos, \{ minX, maxX, minZ, maxZ \}, center\)/.test(terrCode));
  t('外環水面共用既有水盤的材質(沿海場地的海面一路連到地平線)',
    /new THREE\.Mesh\(wgeo, waterMat\)/.test(terrCode) && /waterMat = water\.material/.test(terrCode));
  t('沒有新增第四份 envMat(cel 管線稽核以「地形兩條路徑 + 水面共三處」釘住這個計數)',
    count(terrCode, /envMat\(/g) === 3);
  t('內域水面仍是既有那一片(PlaneGeometry 那一行沒動 ⇒ 世界曲面稽核不受影響)',
    /new THREE\.PlaneGeometry\(worldW, worldH, wSeg\(worldW\), wSeg\(worldH\)\)/.test(terrCode));
}

// ---- Ⅴ-b 行為直測:執行**真品原文**的裙區塊(合成起伏地形 × 兩條材質路徑)----
// 只驗字串的話,一個 `ReferenceError` 會讓整張圖的地形建構當場失敗,而每一條原文斷言照樣全綠。
console.log('\nⅤ-b 外緣裙行為直測(執行 terrain.js 原文)');
{
  const blk = terrSrc.slice(terrSrc.indexOf('  {\n    const B = edgeBufferM()'), terrSrc.indexOf('  // ---- 地形射線'));
  class BA { constructor(a, i) { this.array = a; this.itemSize = i; } }
  const meshes = [];
  const TH = {
    BufferGeometry: class { constructor() { this.att = {}; } setAttribute(k, v) { this.att[k] = v; } setIndex(i) { this.idx = i; } computeVertexNormals() {} },
    BufferAttribute: BA,
    Mesh: class { constructor(g, m) { this.g = g; this.m = m; meshes.push(this); } },
  };
  const N = 193, mnX = -500, mxX = 500, mnZ = -400, mxZ = 400, mnH = 0, mxH = 120;
  const hAt = (x, z) => 40 + Math.sin(x / 60) * 20 + Math.cos(z / 80) * 15;
  const run = (imagery) => {
    meshes.length = 0;
    // 沙箱的自由變數清單 MUST 跟著 terrain.js 走:裙的 uvOf 自 2026-08-10 起改吃 `xzToLL`
    // (地圖主方位的逆旋轉),漏掉它就是 ReferenceError —— 而那正是這一段存在的理由
    new Function('THREE', 'edgeBufferM', 'curveMaxEdgeM', 'minX', 'maxX', 'minZ', 'maxZ', 'N', 'minH', 'maxH',
      'heightAt', 'imagery', 'bbox', 'lon2tx', 'lat2ty', 'paintTerrainTones', 'center', 'mat', 'group', 'waterY', 'waterMat', 'xzToLL', blk)(
      TH, edgeBufferM, curveMaxEdgeM, mnX, mxX, mnZ, mxZ, N, mnH, mxH, hAt, imagery,
      { minLng: 0, maxLng: 1, minLat: 0, maxLat: 1 }, (l) => l, (l) => l,
      (g, p) => { g.att.color = new BA(new Float32Array(p.length), 3); }, { lat: 25, lng: 121 }, {}, { add() {} }, 2, {}, xzToLL);
    return meshes;
  };
  let err = null, plain = null, sat = null;
  try { plain = run(null).slice(); sat = run({ z: 16, tx0: 0, ty0: 0, canvas: { width: 2048, height: 2048 } }).slice(); }
  catch (e) { err = e; }
  t(`裙的原文執行不炸(兩條材質路徑各跑一次)${err ? ` —— ${err.message}` : ''}`, !err);
  if (!err) {
    const g = plain[0].g, pos = g.att.position.array;
    let finite = true, inBand = true, seam = 0;
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) finite = false;
      if (y < mnH - 1e-6 || y > mxH + 1e-6) inBand = false;
      if (x >= mnX - 1e-9 && x <= mxX + 1e-9 && z >= mnZ - 1e-9 && z <= mxZ + 1e-9) {
        seam = Math.max(seam, Math.abs(y - hAt(x, z)));   // 內緣頂點 MUST 與地形同高
      }
    }
    t('每一顆頂點都是有限值', finite);
    t('高度夾在全圖的 [minH, maxH](不憑空長出比這張圖更高的山)', inBand);
    t(`與地形的接縫逐點對齊(最大落差 ${seam.toExponential(1)}m ≪ 岸線容差)`, seam < 1e-4);
    t(`只鋪環狀那一圈(${pos.length / 3} 顆頂點 / ${g.idx.length / 3} 三角形 —— 內域一顆都沒建)`,
      pos.length / 3 < 12000 && g.idx.length / 3 > 4000);
    t('無影像路徑走 paintTerrainTones 取得頂點色(與地形同一支 ⇒ 顏色接得上)', !!g.att.color);
    t('影像路徑不需要頂點色、但一定要有 UV(否則整片採到同一個 texel)',
      !sat[0].g.att.color && !!sat[0].g.att.uv);
    t('有水域時另鋪外環水面(沿海場地的海面一路連到地平線)', plain.length === 2);
  }
}

// ============ Ⅵ 純表現層 ============
console.log('\nⅥ 純表現層(伺服器對這一整套一無所知)');
{
  // 裙的區塊 = 從它自己的標題到下一個區塊的標題(其餘稽核以同樣的標題切 terrain.js 的
  // 開挖/射線/打洞三段 —— 裙**刻意**擺在那三段之外,不然它會被連帶抽進那些沙箱裡執行)
  // 切片一律在**未剝註解**的原文上做(`codeOf` 會把 `// ----` 標題整行拿掉 ⇒ 在它上面
  // 找標題必然 indexOf = −1,slice 悄悄變成「從這裡到檔尾」,而斷言看起來只是紅了一條)
  const skirt = strip(terrSrc.slice(terrSrc.indexOf('const B = edgeBufferM()'), terrSrc.indexOf('  // ---- 地形射線')));
  t('裙的區塊不碰 blockers / occ / heights(不進權威幾何、不改高度場)',
    skirt.length > 200 && !/blockers|\bocc\b|heights\[/.test(skirt));
  t('裙不影響 terrain 的對外範圍(minX..maxX 仍是可玩區;小地圖/高程網格/兵線稽核同框)',
    !/minX = |maxX = |minZ = |maxZ = /.test(skirt));
  t('伺服器原文完全不涉世界邊界(位置夾制本就是客戶端物理,同 FLIGHT 全族)',
    !/WORLD_EDGE|edgeWallInsetM|edgeBufferM|buildEdgeWall/.test(strip(simSrc)));
  t('環的碰撞柱走既有的 blockers 路徑(不新增第二條上傳管道)',
    !/edgeSegs/.test(strip(readSrc('public', 'js', 'main.js'))));
}

if (process.argv.includes('--break-lap')) console.log('\n（--break-lap:段長重疊係數 < 1,Ⅱ MUST 紅字）');
if (process.argv.includes('--break-buffer')) console.log('\n（--break-buffer:緩衝深度砍半,Ⅰ・Ⅴ MUST 紅字）');
console.log(`\n${fail === 0 ? '🎉' : '❌'} 世界邊界稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
