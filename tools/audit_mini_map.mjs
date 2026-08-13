// ============ 迷你地圖稽核(2026-08-13 使用者定案)============
// 使用者原句:「為了讓手機版更順暢,新增迷你地圖:只有 1vs1/2vs2,兵線只有前線砲塔 + 主堡,
// 地圖對應縮小,邊緣緩衝縮小到 1/3,必要的話也縮小據點之間的距離。手機版只允許連線遊玩
// 迷你地圖,桌機版不限制」。規格與禁令住 `data.js MINI` 檔頭與 CLAUDE.md A47;這一支驗真品。
//
// 這一族**會靜默壞掉**的地方(每一條對應下面一段,壞掉時畫面上看不出是這裡的問題):
//   ① **半套狀態** —— 塔拆了而地圖沒縮(或反過來)。四件事全是同一個布林的推論,任一條漏接,
//      症狀只是「這張圖的塔擠在主堡旁邊」或「這張圖空得莫名其妙」,而既有斷言全綠。
//   ② **縮小比手寫** —— 寫死 0.6 之後改 `MINI.STAGES`(或完整版加第三階塔),地圖大小留在原地。
//   ③ **完整戰場被波及** —— 省略參數 MUST 逐位元同舊制。`mapScaleF(undefined)` 只要不是**恆等
//      的 1**(例如寫成 `mini ? 0.6 : 1.0000001`),全場地圖尺寸就整組漂移,而 bal / e2e 都不碰它。
//   ④ **剪短把兵線帶離真實道路** —— 「等比縮小座標」看起來也對(距離一樣、規則照樣過),
//      但那條線從此不在任何一條路上。故本支內建**對照組**:等比縮小版 MUST 被同一個判準擋下來。
//   ⑤ **驗錯塔** —— `towerLayoutAudit` 漏傳 mini 會拿「不存在的後塔」去驗,把本來合法的地圖
//      擋在門外(症狀:選了場地卻開不了房,而錯誤訊息講的是砲塔重疊)。
//   ⑥ **深度分家** —— 裙鋪多遠只有 terrain 知道;消費端各自再呼叫一次 `edgeBufferM()` 而漏傳
//      mini,就會把緩衝布景/背景擺到裙**外面**的虛空裡。故深度對外只准有 `terrain.bufferM` 一個數。
//
// 反向驗證(原則 9;每一支 MUST 讓對應段落紅字):
//   --break-buffer  邊緣緩衝不縮(MINI.BUFFER_F = 1)
//   --break-stage   迷你也留兩階塔(MINI.STAGES = FULL_STAGES)
//   --break-team    人數上限放到 TEAM.MAX(迷你不再恆為單兵線)
//   --break-full    Ⅸ 的行為直測改用完整戰場的 cfg(證明那幾條斷言真的分得出兩者,不是恆真)
// 用法:node tools/audit_mini_map.mjs [--break-*]
import { readSrc } from './audit_src.mjs';
import {
  MINI, FULL_STAGES, TEAM, towerStages, laneChainF, miniScaleF, mapScaleF, miniAllowed, miniOnlyFor,
  lanesFor, realSideMFor, sideMFor, targetDistFor, realDistFor, overlapCellM,
  edgeBufferM, curveHorizonM, WORLD_EDGE, MAPGEO,
  solveTowerSites, towerLayoutAudit, laneSeparationAudit, siegeSiteStages,
} from '../public/js/data.js';
import { VENUES, venueConfig, trimLaneTo } from '../public/js/venues.js';
import { validateBattleConfig } from '../server/rooms.js';
import { BattleSim } from '../server/sim.js';

const ARG = new Set(process.argv.slice(2));
const BRK = (k) => ARG.has(`--break-${k}`);
// 反向驗證一律**改真品的可變常數**(MINI 是一般物件)⇒ 不需要改檔就能把規則寫回壞版本
if (BRK('buffer')) MINI.BUFFER_F = 1;
if (BRK('stage')) MINI.STAGES = FULL_STAGES;
if (BRK('team')) MINI.TEAM_MAX = TEAM.MAX;
const BREAK_FULL = BRK('full');   // 行為直測改吃完整戰場的 cfg(斷言不變 ⇒ 該紅)

let pass = 0, fail = 0;
const t = (msg, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}${extra ? ` ${extra}` : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// 兵線(lat/lng)→ 遊戲公尺:與 rooms.lanesToGame / mapSelect / 烘焙同一換算(只用相對距離 ⇒ 原點任取)
const EARTH = 6371000, SC = 1 / MAPGEO.REAL_SCALE;
const toGame = (lanes) => {
  const o = lanes[0][0], cos = Math.cos(o[0] * Math.PI / 180);
  return lanes.map((l) => l.map(([la, ln]) => [
    (ln - o[1]) * Math.PI / 180 * EARTH * cos * SC,
    (la - o[0]) * Math.PI / 180 * EARTH * SC,
  ]));
};
const distM = (a, b) => Math.hypot(
  (b[1] - a[1]) * Math.PI / 180 * EARTH * Math.cos(a[0] * Math.PI / 180),
  (b[0] - a[0]) * Math.PI / 180 * EARTH,
);
/** 點到線段的距離(真實公尺;等距圓柱近似,本尺度誤差可忽略) */
const segDist = (p, a, b) => {
  const cos = Math.cos(a[0] * Math.PI / 180);
  const px = (p[1] - a[1]) * cos, pz = p[0] - a[0];
  const bx = (b[1] - a[1]) * cos, bz = b[0] - a[0];
  const L2 = bx * bx + bz * bz;
  const s = L2 > 0 ? Math.max(0, Math.min(1, (px * bx + pz * bz) / L2)) : 0;
  return Math.hypot(px - bx * s, pz - bz * s) * Math.PI / 180 * EARTH;
};
/** 折線 A 的每個頂點離折線 B 最遠多少(真實公尺)—— 「還在不在那條路上」的判準 */
const maxOffPolyline = (pts, poly) => {
  let worst = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i - 1], poly[i]));
    worst = Math.max(worst, best);
  }
  return worst;
};

const dataSrc = readSrc('public', 'js', 'data.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const groundSrc = readSrc('public', 'js', 'ground.js');
const simSrc = readSrc('server', 'sim.js');
const roomsSrc = readSrc('server', 'rooms.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const dataCode = strip(dataSrc), mainCode = strip(mainSrc);

console.log('迷你地圖稽核(規格 = data.js MINI;禁令 = CLAUDE.md A47)');

// ============ Ⅰ 規格與推導 ============
console.log('\nⅠ 規格:四件事全是同一個布林的推論,而縮小比是推導不是旋鈕');
{
  t(`只開放 ${MINI.TEAM_MAX}v${MINI.TEAM_MAX} 以下(使用者:只有 1vs1/2vs2)`, MINI.TEAM_MAX === 2);
  t('迷你地圖恆為單兵線(TEAM_MAX 反推 lanesFor = 1)—— 剪短兵線的兩端就是兩座主堡,靠的是這一條',
    lanesFor(MINI.TEAM_MAX) === 1 && miniAllowed(MINI.TEAM_MAX) && !miniAllowed(MINI.TEAM_MAX + 1));
  t(`每側只有前線砲塔(towerStages 迷你 ${towerStages(true)} / 完整 ${towerStages(false)})`,
    towerStages(true) === MINI.STAGES && towerStages(false) === FULL_STAGES && MINI.STAGES === 1);
  t(`塔鏈需求 = 2·stages + 1(完整 ${laneChainF(FULL_STAGES)} SEP / 迷你 ${laneChainF(MINI.STAGES)} SEP)`,
    laneChainF(2) === 5 && laneChainF(1) === 3);
  t(`縮小比 = 塔鏈需求比(${miniScaleF()})—— 推導不手寫`,
    near(miniScaleF(), laneChainF(MINI.STAGES) / laneChainF(FULL_STAGES)));
  // 原文閘:實作 MUST 由 laneChainF 組成。手寫 0.6 的話「改 STAGES 之後地圖大小留在原地」,
  // 而畫面上只表現成「這張圖的塔擠在一起」——沒有任何錯誤訊息,既有斷言也全綠。
  const miniScaleSrc = /export const miniScaleF = \(\) => ([^;]+);/.exec(dataCode)?.[1] || '';
  t('縮小比的實作由 laneChainF 組成,且不出現任何字面比值', /laneChainF\(MINI\.STAGES\)/.test(miniScaleSrc)
    && /laneChainF\(FULL_STAGES\)/.test(miniScaleSrc) && !/\d\.\d/.test(miniScaleSrc), `（${miniScaleSrc}）`);
  t('邊緣緩衝倍率 = 1/3(使用者指定的數字,不是推導值)', near(MINI.BUFFER_F, 1 / 3));
  t('手機閘門是「裝置判定 → 只准迷你」的純述詞(裝置判定本身住 ctrlmode.js)',
    miniOnlyFor('pad') === true && miniOnlyFor('kbm') === false && miniOnlyFor(undefined) === false);
}

// ============ Ⅱ 完整戰場逐位元同舊制 ============
console.log('\nⅡ 省略參數 = 完整戰場 = 逐位元同舊制(這一段紅 = 迷你地圖漏到一般對戰上)');
{
  t('尺度倍率恆等 1(MUST 是 IEEE754 的恆等式,不是「差不多 1」)',
    mapScaleF(false) === 1 && mapScaleF(undefined) === 1 && mapScaleF(0) === 1);
  const sizeOK = [1, 2, 3].every((L) => {
    const base = (MAPGEO.REAL_SIDE_BASE_KM + MAPGEO.REAL_SIDE_PER_LANE_KM * L) * 1000;
    return realSideMFor(L) === base && sideMFor(L) === base / MAPGEO.REAL_SCALE
      && targetDistFor(L) === sideMFor(L) * MAPGEO.BASE_DIST_FRAC * Math.SQRT2
      && realDistFor(L) === targetDistFor(L) * MAPGEO.REAL_SCALE
      && overlapCellM(L) === Math.max(MAPGEO.OVERLAP_CELL_MIN_M, realDistFor(L) * MAPGEO.OVERLAP_CELL_FRAC);
  });
  t('L1/L2/L3 的邊長 / 兩堡距離 / 重合網格逐位元 = 舊公式', sizeOK);
  t('緩衝深度省略參數 = 地平線 × BUFFER_F(舊制)', edgeBufferM() === curveHorizonM() * WORLD_EDGE.BUFFER_F);
  // 塔位解:同一條兵線,mini 省略 / false 兩種呼叫 MUST 逐位元相同
  const lanes = toGame(venueConfig(VENUES[0], 5).lanes);
  t('solveTowerSites 省略參數 ≡ 明寫 false(逐位元)',
    JSON.stringify(solveTowerSites(lanes)) === JSON.stringify(solveTowerSites(lanes, false)));
  const same = VENUES.every((v) => [1, 3, 5].every((ts) =>
    JSON.stringify(venueConfig(v, ts)) === JSON.stringify({ ...venueConfig(v, ts, false), mini: false })));
  t('venueConfig 省略參數 ≡ 明寫 false(逐位元;差別只有多出來的 mini 欄)', same);
}

// ============ Ⅲ 兵線只有前線砲塔 + 主堡 ============
console.log('\nⅢ 兵線只有前線砲塔 + 主堡(而前線那一趟的解 MUST 不受影響)');
{
  let allOne = true, stagesOK = true, frontSame = true, worstFrac = 0;
  for (const v of VENUES) {
    const cfgM = venueConfig(v, 2, !BREAK_FULL);
    const g = toGame(cfgM.lanes);
    const mSites = solveTowerSites(g, true), fSites = solveTowerSites(g, false);
    for (let li = 0; li < g.length; li++) {
      if (mSites[li].length !== 1) allOne = false;
      if (siegeSiteStages(mSites[li]).some((s) => s !== 0)) stagesOK = false;
      // 前線塔是「趟 1」解出來的,迷你只是不跑趟 2 ⇒ 同一條兵線上兩者的前線 MUST 逐位元相同
      const mf = mSites[li][mSites[li].length - 1], ff = fSites[li][fSites[li].length - 1];
      if (JSON.stringify(mf) !== JSON.stringify(ff)) frontSame = false;
      worstFrac = Math.max(worstFrac, mf.frac);
    }
  }
  t(`每條兵線恰一個塔位(${VENUES.length} 個場地 × 2v2)`, allOne);
  t('那一座恆是「前線」(攻堅階段 siegeSiteStages 全 0;拿陣列索引當判據會剛好相反)', stagesOK);
  t('前線塔位的解與完整戰場逐位元相同(迷你只是不跑趟 2,不是換一套規則)', frontSame);
  t(`前線塔位仍落在合法搜尋帶內(最大 frac ${worstFrac.toFixed(3)} ≤ TOWER_MAX_FRAC)`, worstFrac <= 0.45 + 1e-9);
  // 原文閘:MUST 是「整趟不跑」,MUST NOT 是「解完再由呼叫端丟掉後塔」
  t('趟 2 由 towerStages 整趟跳過(biomes 淨空 / 地標錨點 / 橋上墩座吃同一份解 ⇒ 解出來卻不生成 = 世界繞著不存在的塔讓路)',
    /if \(towerStages\(mini\) < 2\) return frontSites\.map/.test(dataCode));
  t('三個建圖消費端與伺服器都把 mini 傳進 solveTowerSites',
    /solveTowerSites\(lanesW, mapArg\(cfg\)\)/.test(bioSrc) && /solveTowerSites\(lanesW, mapA\)/.test(bioSrc)
    && /solveTowerSites\(this\.lanes, this\.mapArg\)/.test(simSrc));
  t('砲塔佈局複驗也吃 mini(漏傳 = 拿不存在的後塔去驗,把合法地圖擋在門外)',
    /towerLayoutAudit\(game, mapA\)/.test(roomsSrc) && /const sites = solveTowerSites\(lanes, mini\)/.test(dataCode));
}

// ============ Ⅳ 地圖對應縮小 + 據點距離縮小 + 邊緣緩衝 1/3 ============
console.log('\nⅣ 地圖 / 據點距離 / 邊緣緩衝');
{
  const f = { side: sideMFor(1), dist: targetDistFor(1), buf: edgeBufferM() };
  const m = { side: sideMFor(1, true), dist: targetDistFor(1, true), buf: edgeBufferM(true) };
  t(`地圖邊長縮小(${f.side}m → ${m.side.toFixed(0)}m,比 ${(m.side / f.side).toFixed(3)})`,
    near(m.side / f.side, miniScaleF()));
  t(`據點距離同一個係數(${f.dist.toFixed(0)}m → ${m.dist.toFixed(0)}m)—— 邊長與兩堡距離是同一條公式的兩端`,
    near(m.dist / f.dist, miniScaleF()));
  t(`邊緣緩衝縮到 1/3(${f.buf.toFixed(1)}m → ${m.buf.toFixed(1)}m)`,
    near(m.buf, f.buf * MINI.BUFFER_F) && near(m.buf / f.buf, 1 / 3));
  // 深度只准有一個數:裙自己算完交出 bufferM,消費端一律讀它
  t('裙的深度吃 edgeBufferM(mini) 並對外交出 bufferM',
    /const B = edgeBufferM\(mapArg\(cfg\)\)/.test(terrSrc) && /bufferM = B;/.test(terrSrc) && /bufferM,/.test(terrSrc));
  t('緩衝布景 / 視線背景 / 地貌底毯一律讀 terrain.bufferM,MUST NOT 各自再呼叫 edgeBufferM',
    !/edgeBufferM/.test(strip(bioSrc)) && !/edgeBufferM/.test(strip(groundSrc))
    && /buffer: terrain\.bufferM/.test(bioSrc) && /const B = terrain\.bufferM/.test(groundSrc));
}

// ============ Ⅴ 剪短:兵線仍是同一條真實道路 ============
console.log('\nⅤ 縮圖手法 = 兩端對稱剪短(⇒ 每一段仍是真實道路),不是等比縮小座標');
{
  const TOL = 0.05;   // 5cm:剪短只做線性內插 ⇒ 浮點尾差以外沒有理由偏離
  let worstOff = 0, worstErr = 0, worstGrow = 0, baked = 0;
  for (const v of VENUES) {
    const full = venueConfig(v, 1), mini = venueConfig(v, 1, true);
    if (full.synthetic) continue;   // 合成弧本來就吃 realD,沒有「剪短」這回事
    baked++;
    worstOff = Math.max(worstOff, maxOffPolyline(mini.lanes[0], full.lanes[0]));
    worstErr = Math.max(worstErr, Math.abs(distM(mini.bases.SWARM, mini.bases.STEEL) - realDistFor(1, true)));
    worstGrow = Math.max(worstGrow, mini.lanes[0].length - full.lanes[0].length);
    // 兩座主堡 = 剪短後的兩個端點(單兵線 ⇒ 這是構造保證,不是巧合)
    if (JSON.stringify(mini.bases.SWARM) !== JSON.stringify(mini.lanes[0][0])
      || JSON.stringify(mini.bases.STEEL) !== JSON.stringify(mini.lanes[0].at(-1))) worstOff = Infinity;
  }
  t(`剪短後每個頂點都還在原兵線上(${baked} 個烘焙場地,最大偏離 ${worstOff.toExponential(1)}m ≤ ${TOL}m)`,
    worstOff <= TOL);
  t(`兩堡距離命中迷你目標(最大誤差 ${worstErr.toExponential(1)}m)`, worstErr <= TOL);
  t('剪短不會讓兵線長出新頂點(端點以外只保留原頂點)', worstGrow <= 0);
  // 內建對照組:「等比縮小座標」距離一樣正確、規則照樣過,但整條線離開了它自己的道路。
  // 這一組 MUST 被同一個判準擋下來 —— 不然上面那條「還在原兵線上」是恆真的。
  const ctrl = VENUES.find((v) => !venueConfig(v, 1).synthetic);
  const fullLane = venueConfig(ctrl, 1).lanes[0];
  const c = [(fullLane[0][0] + fullLane.at(-1)[0]) / 2, (fullLane[0][1] + fullLane.at(-1)[1]) / 2];
  const k = realDistFor(1, true) / distM(fullLane[0], fullLane.at(-1));
  const scaled = fullLane.map(([la, ln]) => [c[0] + (la - c[0]) * k, c[1] + (ln - c[1]) * k]);
  const scaledOff = maxOffPolyline(scaled, fullLane);
  t(`對照組:等比縮小座標的版本被同一個判準擋下來(偏離 ${scaledOff.toFixed(0)}m > ${TOL}m)`, scaledOff > TOL);
  t('對照組的兩堡距離同樣正確 ⇒ 上面那一條真的在驗「還在不在路上」,不是在驗距離',
    near(distM(scaled[0], scaled.at(-1)), realDistFor(1, true), 0.5));
  // 剪短本身:比目標還短的兵線原樣回傳(降級不例外)
  const shortLane = [[25, 121], [25.0005, 121]];
  t('已經比目標還短的兵線原樣回傳(降級不例外)',
    JSON.stringify(trimLaneTo(shortLane, 1e6)) === JSON.stringify(shortLane));
}

// ============ Ⅵ 規則仍然成立 ============
console.log('\nⅥ 縮完之後,砲塔佈局 / 兵線分離 / 主堡距離門檻 MUST 全部照樣過');
{
  let bad = [];
  for (const ts of [1, 2]) {
    for (const v of VENUES) {
      const cfg = venueConfig(v, ts, true);
      const g = toGame(cfg.lanes);
      if (!towerLayoutAudit(g, true).ok || !laneSeparationAudit(g).ok || !(cfg.distM >= cfg.diagM * 0.8)) {
        bad.push(`${v.id}@${ts}v${ts}`);
      }
    }
  }
  t(`${VENUES.length} 個場地 × {1v1, 2v2} 全數合規`, bad.length === 0, `（${bad.slice(0, 5).join(' / ')}）`);
}

// ============ Ⅶ 伺服器閘門 ============
console.log('\nⅦ 伺服器:人數上限是房間規則(對雙方對稱),旗標一律正規化成布林');
{
  const mk = (ts, mini) => ({ ...venueConfig(VENUES[0], ts, mini) });
  t('迷你 + 2v2 → 受理', validateBattleConfig(mk(2, true), 2) === null);
  t('迷你 + 3v3 → 拒絕(迷你地圖恆為單兵線,3v3 開不成)',
    typeof validateBattleConfig({ ...mk(1, true), lanes: mk(3, false).lanes }, 3) === 'string');
  t('完整 + 3v3 → 照樣受理(這一條紅 = 迷你把一般對戰擋掉了)', validateBattleConfig(mk(3, false), 3) === null);
  t('cfg.mini 於 createRoom 正規化成布林(客戶端送上來的整包 MUST NOT 原樣塞進 sim)',
    /cfg\.mini = !!cfg\.mini && !cfg\.defSide;/.test(roomsSrc));
  t('房間列表帶 mini(手機要在**加入之前**看得到,同 ctrl)', /mini: !!room\.battleConfig\?\.mini,/.test(roomsSrc));
  t('sim 把旗標收成 this.mini(一般對戰恆 false)', /this\.mini = !!config\.mini;/.test(simSrc));
}

// ============ Ⅷ 手機閘門(住客戶端;裝置判定只有一份)============
console.log('\nⅧ 手機閘門:住客戶端、裝置判定只問 deviceScheme、四個出口都擋');
{
  t('main.js 的裝置判定只經 ctrlmode 的 deviceScheme(MUST NOT 自己看螢幕寬 / 觸控點數)',
    /miniOnlyFor\(deviceScheme\(\)\)/.test(mainCode)
    && !/maxTouchPoints|pointer: coarse|any-hover/.test(mainCode));
  t('閘門只有一支 miniLocked(),四個出口共用', (mainCode.match(/miniLocked\(\)/g) || []).length >= 5);
  t('出口①開房:cfg 可能來自舊的最愛 ⇒ 鈕面擋過還要再驗一次',
    /if \(miniLocked\(\) && !cfg\.mini\)/.test(mainCode));
  t('出口②大廳戰區列表:完整戰場的房連加入鈕都不給', /miniLocked\(\) && !r\.mini/.test(mainCode));
  t('出口③我的最愛:完整戰場的最愛整顆停用', /miniLocked\(\) && !favMini/.test(mainCode));
  t('出口④準備鈕:私人房只能靠 PIN 進來,列表那道閘門看不到它',
    /const miniBlocked = miniLocked\(\) && cfg && !cfg\.mini;/.test(mainCode));
  t('伺服器 MUST NOT 涉入裝置判定(它無從知道對面是不是手機;A1 管的是權威狀態不是裝置能力)',
    !/miniOnlyFor|deviceScheme/.test(strip(roomsSrc)) && !/miniOnlyFor|deviceScheme/.test(strip(simSrc)));
  t('地形預建鍵帶 mini(塔位階數與緩衝深度都由它推導 ⇒ 換了就得重建)',
    /cfg\.lanes, !!cfg\.mini, cfg\.defSide \|\| null\]/.test(mainCode));
}

// ============ Ⅸ 行為直測:BattleSim 真的只生成前線砲塔 ============
console.log('\nⅨ 行為直測(跑真品 BattleSim):砲塔真的少了一排,而主堡與兵線照舊');
{
  const count = (cfg) => {
    const sim = new BattleSim(cfg);
    const ents = [...sim.ents.values()];
    return {
      tower: ents.filter((e) => e.kind === 'tower').length,
      base: ents.filter((e) => e.kind === 'base').length,
      sites: sim.towerSites.flat().length,
    };
  };
  const cfgM = { ...venueConfig(VENUES[0], 2, !BREAK_FULL), env: { season: 'summer', time: 'day', weather: 'clear' } };
  const cfgF = { ...venueConfig(VENUES[0], 2, false), env: { season: 'summer', time: 'day', weather: 'clear' } };
  const m = count(cfgM), f = count(cfgF);
  const L = cfgM.lanes.length;
  t(`迷你:每線每方 1 個塔位 × 左右 2 座 × 兩陣營 = ${L * 4} 座(實得 ${m.tower})`, m.tower === L * 4);
  t(`完整:兩階塔 ⇒ ${L * 8} 座(實得 ${f.tower})—— 兩者不同,上面那一條才不是恆真`,
    f.tower === L * 8 && m.tower !== f.tower);
  t('主堡兩座照舊(使用者:兵線只有前線砲塔 + 主堡)', m.base === 2 && f.base === 2);
  t('sim.towerSites 與生成的塔逐一對得上(_prefillLanes 吃同一份解)', m.sites * 4 === m.tower);
}

console.log(`\n${fail ? '❌' : '🎉'} 迷你地圖稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
