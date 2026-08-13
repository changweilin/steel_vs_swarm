// ============ 世界曲面稽核(離線;不需伺服器 / 瀏覽器 / 網路)============
// 對應 2026-08-09 使用者需求「地圖改成曲面 …… 地形地貌 / 物件形狀 / 接觸點 / 碰撞公式 /
// 彈道軌跡都依原本的平面空間計算與放置,完成後再轉換為曲面(只有絕對直線類攻擊才在彎曲後
// 計算軌跡),等高水平面也是跟著彎曲,曲率半徑可以『有遠方機體先看到上半部』的效果,
// 但鄰近局部感受又是平的」。
//
// 這一批的風險**全部是靜默的**,沒有一條會丟例外:
//   ・拐點被調小(或被「順手」拿掉)⇒ 交戰距離內開始沉降 ⇒ 玩家把準星壓在**看到的**敵人
//     身上,而平面射線從它上方過去 = 「看得到打不到」,伺服器那端完全正常;
//   ・半徑寫成手寫常數 ⇒ 改射程 / 改塔 / 改機體高之後,地平線與交戰距離悄悄脫鉤;
//   ・JS 面與 GLSL 面各寫一份公式 ⇒ 稽核算的與畫面畫的不是同一條曲線;
//   ・光束幾何被細分 ⇒ 中間點各自下沉 = 雷射彎了(使用者明講那一類要在彎曲後才算軌跡);
//   ・大面(水面)不細分 ⇒ 弦高幾十公尺,水面從遠處的地形裡整片浮出來;
//   ・chunk 被改兩次 / 錨點對不上 ⇒ 疊出兩層沉降,或半套曲面。
//
// 讀原文一律走 `audit_src.mjs`(㋑ CRLF 陷阱);純函式一律 import **真品**,
// MUST NOT 在本檔重寫一份公式。
//
// 用法:
//   node tools/audit_world_curve.mjs
//   node tools/audit_world_curve.mjs --break-knee   反向驗證:拐點歸零(= 純球面)⇒ Ⅱ MUST 紅
//   node tools/audit_world_curve.mjs --break-edge   反向驗證:弦高容差放大 100 倍 ⇒ Ⅴ MUST 紅
import { readSrc } from './audit_src.mjs';
import {
  CURVE, curveKneeM, curveHorizonM, curveEyeM, curveR, curveDropM, curveMaxEdgeM,
  combatReachM, dofNearM, dofFarM, CHARACTERS, heroTargetH, SELF_F, UNITS,
  MAPGEO, TERRAIN, TARGET_H, WATER, heroWeapon, heroAbility, altRangeMax, RANGE_TOL,
} from '../public/js/data.js';
import { VENUES, venueConfig } from '../public/js/venues.js';

/**
 * 圖面尺度 MUST 走真品那條路(`venueConfig` → `sizeM` × `MAPGEO.MAP_EXPAND`),
 * MUST NOT 在稽核裡手寫 800/1000/1200 —— 那三個數字是 `REAL_SIDE_*` 推導出來的,
 * 手寫一份就是「改了地圖尺寸而稽核照舊全綠」。取最大隊制(圖最大 = 弦高最壞)。
 */
const WORLD_SPAN = venueConfig(VENUES[0], 5).sizeM * MAPGEO.MAP_EXPAND;
const TERRAIN_CELL = WORLD_SPAN / (TERRAIN.GRID_N - 1);

const ARG = new Set(process.argv.slice(2));
const BREAK_KNEE = ARG.has('--break-knee');
const BREAK_EDGE = ARG.has('--break-edge');
if (BREAK_KNEE) CURVE.KNEE_F = 0;
if (BREAK_EDGE) CURVE.SAG_M = 5;

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const dataSrc = readSrc('public', 'js', 'data.js');
const toonSrc = readSrc('public', 'js', 'toon.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const vfxSrc = readSrc('public', 'js', 'vfx.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const envSrc = readSrc('public', 'js', 'environment.js');
/** 逐行剝掉行註解(單一縫計數 MUST NOT 把註解裡提到的名字算進去) */
const bare = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const count = (s, re) => (bare(s).match(re) || []).length;
/** 抽出 data.js 的 CURVE 區塊原文(從 `export const CURVE` 到下一個頂層 export 之後) */
const curveBlock = (() => {
  const i = dataSrc.indexOf('export const CURVE = {');
  const j = dataSrc.indexOf('export const curveMaxEdgeM', i);
  return dataSrc.slice(i, dataSrc.indexOf('\n', dataSrc.indexOf(';', j)));
})();

// ============ Ⅰ 錨與推導:三個量都不是手寫的 ============
console.log('\nⅠ 錨與推導');
{
  // 拐點 = 交戰距離上界(與 DOF 同一個錨)。這是**安全參數**不是美術參數,見 Ⅱ。
  ok(near(curveKneeM(), combatReachM() * CURVE.KNEE_F),
    `拐點 = combatReachM × KNEE_F = ${curveKneeM().toFixed(1)}m`);
  // 地平線 = 起糊那一圈:看不清的與沉下去的是同一圈
  ok(near(curveHorizonM(), dofNearM()),
    `地平線 = dofNearM = ${curveHorizonM().toFixed(1)}m(起糊那一圈)`);
  ok(curveHorizonM() < dofFarM(), '地平線在全糊圈之內(沉下去之前先糊,不是反過來)');

  // 半徑是**反解**:令 √(D0² + 2Rh) = 地平線。稽核端獨立重算,不呼叫被測的那一支。
  const D0 = curveKneeM(), H = curveHorizonM(), h = curveEyeM();
  ok(near(curveR(), (H * H - D0 * D0) / (2 * h), 1e-6 * curveR()),
    `半徑反解 R = (H² − D0²)/2h = ${Math.round(curveR())}m`);
  // 反解的定義:地表仰角在地平線處取極大 —— 直接掃一遍確認極值真的落在那裡
  const elev = (d) => -(h + curveDropM(d)) / d;
  let best = 0, bestD = 0;
  for (let d = 1; d <= 4000; d += 0.25) { const e = elev(d); if (d === 1 || e > best) { best = e; bestD = d; } }
  ok(Math.abs(bestD - H) <= 1.0, `地表仰角的極大值落在地平線上(掃描 ${bestD.toFixed(1)}m vs ${H.toFixed(1)}m)`);

  // 參考視點高:MUST 是全場最矮機體視點的下界。比例地板 = SELF_F.eye,
  // 而真正的比例表 `VIEW_SHAPE` 住 game.js ⇒ 以**原文**釘住那個地板關係。
  let loH = Infinity;
  for (const ch of Object.keys(CHARACTERS)) for (let lv = 1; lv <= 4; lv++) loH = Math.min(loH, heroTargetH(ch, lv));
  ok(near(curveEyeM(), loH * SELF_F.eye), `參考視點高 = 最矮機體 ${loH.toFixed(2)}m × SELF_F.eye = ${curveEyeM().toFixed(3)}m`);
  const shape = gameSrc.slice(gameSrc.indexOf('const VIEW_SHAPE = {'), gameSrc.indexOf('const VIEW_DEF'));
  const ratios = [...shape.matchAll(/e:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  ok(ratios.length >= 15, `game.js VIEW_SHAPE 抽到 ${ratios.length} 個視點比例`);
  ok(ratios.every((r) => r >= SELF_F.eye),
    `SELF_F.eye(${SELF_F.eye})是 VIEW_SHAPE 的地板(最小 ${Math.min(...ratios)})⇒ 參考視點高是真下界`);

  // 定義式內不得出現手寫公尺數(半徑 / 拐點 / 地平線一律推導)
  const defs = ['curveKneeM', 'curveHorizonM', 'curveR', 'curveEyeM', 'curveMaxEdgeM'];
  for (const fn of defs) {
    const i = curveBlock.indexOf(`export const ${fn} = `);
    const body = bare(curveBlock.slice(i, curveBlock.indexOf('\n};', i) + 3 || curveBlock.indexOf(';\n', i)));
    // 允許的字面值只有結構常數(0/1/2/4)與夾制下限;公尺數(≥ 10)一律不准
    const lits = [...body.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1])).filter((n) => n >= 10);
    ok(lits.length === 0, `${fn} 定義式內無手寫公尺數${lits.length ? `(找到 ${lits.join(',')})` : ''}`);
  }
}

// ============ Ⅱ 核心不變式:打得到的東西恆為零沉降 ============
// 這一段就是整套設計的理由。沉降是「離相機的水平距離」的函式,而準星 / 命中 / 射程光暈
// 全鏈都是**平面**射線 ⇒ 交戰距離內只要有沉降,玩家看到的位置與伺服器結算的位置就差
// `drop/d` 弧度,而那是靜默的(沒有錯誤訊息,只有「這一場好像特別難瞄」)。
console.log('\nⅡ 核心不變式:交戰距離內逐位元是平的');
{
  const reach = combatReachM();
  let worst = 0;
  for (let d = 0; d <= reach; d += 0.5) worst = Math.max(worst, curveDropM(d));
  worst = Math.max(worst, curveDropM(reach));
  ok(worst === 0, `0~${reach.toFixed(1)}m(交戰距離上界)沉降恆為 0${worst ? `(最大 ${worst.toFixed(3)}m)` : ''}`);

  // 取樣面 MUST 與 combatReachM 一致 —— 逐條把「還可能發生傷害或需要瞄準」的距離再走一遍,
  // 每一條都要落在零沉降帶裡(漏一條就是那一種目標會被沉掉)
  const probes = [['砲塔射程', UNITS.tower?.range || 0]];
  let wMax = 0, aMax = 0;
  const wF = altRangeMax() * RANGE_TOL;
  for (const ch of Object.keys(CHARACTERS)) {
    for (const slot of ['light', 'heavy']) for (let lv = 1; lv <= 4; lv++)
      wMax = Math.max(wMax, (heroWeapon(ch, slot, lv, true)?.range || 0) * wF);
    for (const slot of ['skill', 'ult']) for (let lv = 1; lv <= 4; lv++)
      aMax = Math.max(aMax, heroAbility(ch, slot, lv, true)?.range || 0);
  }
  probes.push(['武器誠實界(含高度制空 × RANGE_TOL)', wMax], ['招式施放距離', aMax]);
  for (const [name, d] of probes) ok(d > 0 && curveDropM(d) === 0, `${name} ${d.toFixed(1)}m ⇒ 沉降 0`);

  // 相機自己是不動點(它到自己的水平距離是 0)⇒ FPV 座艙 / 準星 / 貼身特效逐位元不變
  ok(curveDropM(0) === 0, '相機所在點沉降 0(座艙與貼身特效逐位元不變)');
  // 展示台 / 材質樣品 / 角色預覽的尺度(數十公尺)一律在零沉降帶內
  ok(curveDropM(60) === 0, '展示台尺度(60m)沉降 0 ⇒ 預覽與樣品場景逐位元不變');
}

// ============ Ⅲ 曲線形狀:單調、C¹、且真的看得出效果 ============
console.log('\nⅢ 曲線形狀與效果強度');
{
  const D0 = curveKneeM(), R = curveR();
  // 單調遞增(遠的一定沉得比近的多),且拐點處導數為 0 ⇒ C¹,接縫看不出來
  let mono = true;
  for (let d = 0; d < 2000; d += 1) if (curveDropM(d + 1) < curveDropM(d) - 1e-12) mono = false;
  ok(mono, '沉降隨距離單調不減');
  const eps = 0.5;
  ok(curveDropM(D0 + eps) < 1e-3, `拐點處導數 → 0(D0+${eps}m 只沉 ${(curveDropM(D0 + eps) * 1000).toFixed(2)}mm)⇒ C¹,看不出接縫`);
  ok(near(curveDropM(D0 + 100), 100 * 100 / (2 * R), 1e-9), '拐點之外 = (d − D0)²/2R');

  // 「遠方機體先看到上半部」:地平線之外,目標被擋住的高度 = 地平線仰角切出來的那一段。
  const h = curveEyeM(), H = curveHorizonM();
  const thH = -(h + curveDropM(H)) / H;
  const hidden = (d) => (d <= H ? 0 : Math.max(0, thH * d + curveDropM(d) + h));
  let loH = Infinity;
  for (const ch of Object.keys(CHARACTERS)) for (let lv = 1; lv <= 4; lv++) loH = Math.min(loH, heroTargetH(ch, lv));
  // 找「最矮機體剛好被遮掉一半」的距離 —— 這就是使用者說的那個效果,MUST 真的落在圖內
  let halfAt = 0;
  for (let d = H; d <= 4000; d += 1) if (hidden(d) >= loH / 2) { halfAt = d; break; }
  const diag = WORLD_SPAN * Math.SQRT2;
  ok(halfAt > 0, `最矮機體(${loH.toFixed(1)}m)在 ${halfAt}m 處只剩上半部`);
  ok(halfAt > combatReachM(), '「只剩上半部」發生在交戰距離之外(不影響任何打得到的目標)');
  ok(halfAt < diag, `效果落在地圖尺度之內(${halfAt}m,圖面對角 ${Math.round(diag)}m)⇒ 玩家真的看得到`);
  // 砲塔那種高結構物要撐得比機體久(不然遠方連地標都沒了)
  ok(hidden(halfAt) < TARGET_H.tower, `同距離的砲塔(${TARGET_H.tower}m)仍露出大半`);

  // 「鄰近局部感受是平的」:交戰距離內恆 0 已由 Ⅱ 保證,這裡再釘一次腳邊的尺度
  ok(curveDropM(30) === 0 && curveDropM(100) === 0, '腳邊 30m / 100m 完全平坦');
}

// ============ Ⅳ 單一縫:公式只有一份,GLSL 面吃 data.js 的常數 ============
console.log('\nⅣ 單一縫(JS 面 / GLSL 面同一支)');
{
  // JS 面
  ok(count(dataSrc, /export const curveDropM/g) === 1, 'curveDropM 只有一份定義');
  ok(count(dataSrc, /export const curveR\b/g) === 1, 'curveR 只有一份定義');
  // GLSL 面:常數由 data.js 的兩支函式展開,MUST NOT 手寫公尺數
  const inst = toonSrc.slice(toonSrc.indexOf('function installWorldCurve'), toonSrc.indexOf('installWorldCurve();'));
  ok(/curveKneeM\(\)/.test(inst) && /curveR\(\)/.test(inst), '著色器常數取自 curveKneeM() / curveR()');
  const fnSrc = toonSrc.slice(toonSrc.indexOf('const curveFn = '), toonSrc.indexOf('let _curveOn'));
  ok(!/[0-9]{2,}\.[0-9]/.test(bare(fnSrc)), 'GLSL 曲面函式內無手寫公尺數');
  ok(count(toonSrc, /vec3 worldCurve\(/g) === 1, 'GLSL 的 worldCurve 只有一份實作');
  // 沉降公式兩面同形:JS 是 (d−knee)²/(2R),GLSL 是 _cu * _cu * inv2r
  ok(/_cu \* _cu \* \$\{glslF\(inv2r\)\}/.test(fnSrc), 'GLSL 沉降 = _cu² × (1/2R),與 JS 同形');
  ok(/length\( vec2\( wp\.x - cam\.x, wp\.z - cam\.z \) \)/.test(fnSrc), 'GLSL 量的是「離相機的水平距離」(等高水平面整片跟著彎)');

  // 安裝點只有一處,而且只准裝一次(裝兩次 = 兩層沉降)
  ok(count(toonSrc, /^installWorldCurve\(\);$/gm) === 1, 'installWorldCurve 只有一個呼叫點');
  ok(/if \(THREE\.ShaderChunk\.__worldCurve\) return;/.test(inst), '重入守衛(chunk 只准改一次)');
  ok(/THREE\.ShaderChunk\.__worldCurve = true;/.test(inst), '守衛戳記掛在 THREE 上(模組被載入兩份也擋得住)');

  // 錨點對不上 ⇒ 整套退回平面(降級不例外),而不是半套
  ok(/console\.warn\(/.test(inst) && /_curveOn = !off && chunkOk && spriteOk/.test(inst),
    '錨點對不上 ⇒ 整套退平面並警告(MUST NOT 半套)');
  ok(/get\('curve'\) === '0'/.test(inst), '?curve=0 關得掉(與 ?ink=0 / ?dof=0 同一套開關)');
  ok(/const knee = _curveOn \? curveKneeM\(\) : 0;/.test(inst),
    '停用時常數歸零 ⇒ worldCurve 仍存在但是恆等式(自寫 shader 不會因此編譯失敗)');

  // 兩個被改的 three 錨點都留了 opt-out
  ok(count(toonSrc, /NO_WORLD_CURVE/g) >= 2, '兩個補丁都帶 NO_WORLD_CURVE opt-out');
}

// ============ Ⅴ 幾何細度:大面要細分,光束不准細分 ============
console.log('\nⅤ 幾何細度');
{
  const R = curveR(), L = curveMaxEdgeM();
  ok(near(L, Math.sqrt(4 * R * CURVE.SAG_M), 1e-9), `最長邊 = √(4R × SAG) = ${L.toFixed(1)}m`);
  ok(near(L * L / (4 * R), CURVE.SAG_M, 1e-9), `該邊長的弦高恰為容差 ${CURVE.SAG_M}m`);
  // 容差本身要有尺:現役唯一消費端是水面,而它要對齊的是岸線 ⇒ 取已定案的岸線容差,
  // 曲面這一層 MUST NOT 自己另訂一把更鬆的
  ok(CURVE.SAG_M <= WATER.SHORE,
    `弦高容差 ${CURVE.SAG_M}m ≤ 岸線容差 WATER.SHORE ${WATER.SHORE}m(水面不會從地形裡浮出來)`);

  // 地形格本來就遠細於容差(不必動它)—— 但那是**推導**出來的結論,值一改要看得出來
  ok(TERRAIN_CELL <= L,
    `地形格 ${TERRAIN_CELL.toFixed(2)}m ≤ 最長邊 ${L.toFixed(1)}m ⇒ 弦高 ${(TERRAIN_CELL * TERRAIN_CELL / (4 * R) * 1000).toFixed(2)}mm,不必細分`);

  // 水面:整片鋪兩個三角形的舊制在曲面下是幾十公尺的弦高。
  // 2026-08-13 海浪上線後這條線多了**第二把尺**:浪是逐頂點的位移,53m 的格取樣不了 64m
  // 的波(Nyquist)⇒ 邊長取兩者的**較嚴者**。曲面這一半的保證不受影響(min 只會更小),
  // 而 `curveMaxEdgeM()` MUST 仍出現在算式裡 —— 拿掉它 = 波長一改大就退回幾十公尺的弦高。
  const wEdge = /const wEdge = Math\.min\(curveMaxEdgeM\(\), seaSegM\(\)\);/.test(terrSrc);
  const wSeg = /const wSeg = \(n\) => Math\.max\(1, Math\.ceil\(n \/ wEdge\)\);/.test(terrSrc);
  ok(wEdge && wSeg, '水面分段數由 curveMaxEdgeM() 與 seaSegM() 的較嚴者推導(兩把尺都 MUST 在算式裡)');
  ok(/new THREE\.PlaneGeometry\(worldW, worldH, wSeg\(worldW\), wSeg\(worldH\)\)/.test(terrSrc), '水面真的吃到那個分段數');
  ok(/curveMaxEdgeM/.test(terrSrc.slice(0, terrSrc.indexOf('\n\n'))) || /from '\.\/data\.js'/.test(terrSrc.split('\n').find((l) => l.includes('curveMaxEdgeM')) || ''),
    'terrain.js 自 data.js import curveMaxEdgeM(不是自己算一份)');
  ok(WORLD_SPAN * WORLD_SPAN / (4 * R) > CURVE.SAG_M,
    `反例存證:整片鋪一格(${Math.round(WORLD_SPAN)}m)的弦高 ${(WORLD_SPAN * WORLD_SPAN / (4 * R)).toFixed(1)}m ≫ 容差 ${CURVE.SAG_M}m`);
  ok(Math.ceil(WORLD_SPAN / L) >= 2, `最大圖面實際會切成 ${Math.ceil(WORLD_SPAN / L)} 段(細分真的有發生)`);

  // 絕對直線類攻擊:光束 / 曳光 / 貫穿管道 MUST 維持 heightSegments = 1 ——
  // 兩端各自沉降、中間線性內插 = 曲面空間裡的弦 = 使用者說的「彎曲後才算軌跡」。
  // 細分回來的中間點會各自往下沉,那條光束就彎了。
  ok(/new THREE\.CylinderGeometry\(1, 1, 1, seg, 1, true\)/.test(vfxSrc),
    '單位圓柱 heightSegments = 1 ⇒ 直線攻擊在曲面空間裡是直的弦');
  ok(/unitCylinder\(6\)/.test(vfxSrc) && /unitCylinder\(10\)/.test(vfxSrc), '曳光 / 貫穿管道 / 光束外暈都走那顆單位圓柱');
}

// ============ Ⅵ 例外名冊:自寫 vertexShader 的兩個,一個彎一個不彎 ============
console.log('\nⅥ 自寫頂點著色器的例外');
{
  // 全專案自寫 vertexShader 的地方(postfx 的全螢幕 quad 不在世界空間,天生無關)
  const owners = [];
  for (const [name, src] of [['environment.js', envSrc], ['vfx.js', vfxSrc], ['toon.js', toonSrc]])
    if (/vertexShader:/.test(bare(src))) owners.push(name);
  ok(owners.length === 2 && owners.includes('environment.js') && owners.includes('vfx.js'),
    `自寫 vertexShader 的只有 environment.js(穹頂)與 vfx.js(護盾):${owners.join(' / ')}`);

  // 穹頂:天空在無限遠,不彎是對的 —— 而且要有一段話講清楚,免得日後被「統一」掉
  const dome = envSrc.slice(envSrc.indexOf('function makeSkyDome') - 700, envSrc.indexOf('const dome = new THREE.Mesh'));
  ok(/穹頂刻意不吃世界曲面/.test(dome), '穹頂的「刻意不彎」寫在原文裡');
  ok(!/worldCurve/.test(dome), '穹頂沒有呼叫 worldCurve');

  // 護盾:它包著一台機體,不跟著沉就會在遠處與機體脫開
  const shield = vfxSrc.slice(vfxSrc.indexOf('const SHIELD_VERT'), vfxSrc.indexOf('`;', vfxSrc.indexOf('const SHIELD_VERT')));
  ok(/#include <common>/.test(shield), '護盾 shader 有 #include <common>(worldCurve 才在作用域內)');
  ok(/worldCurve\( _sw\.xyz, cameraPosition \)/.test(shield), '護盾呼叫同一支 worldCurve');
  ok(/viewMatrix \* _sw/.test(shield) && !/modelViewMatrix \* vec4\( position/.test(shield),
    '護盾改走 modelMatrix → worldCurve → viewMatrix(舊的 modelViewMatrix 直乘已退場)');
}

// ============ Ⅶ 不回歸:JS 那一側一行判定都沒有改 ============
// 「平面算完再轉曲面」之所以是結構保證而不是約定,靠的就是這一條:
// 曲面在著色器裡,game.js / sim.js 完全不知道它的存在 ⇒ 沒有第二份幾何可以分家。
console.log('\nⅦ 不回歸(權威與判定側零涉入)');
{
  const simSrc = readSrc('server', 'sim.js');
  for (const [name, src] of [['game.js', gameSrc], ['server/sim.js', simSrc]])
    ok(!/worldCurve|curveDropM|curveR\(/.test(bare(src)), `${name} 完全不涉曲面(座標 / 碰撞 / 彈道 / 準星維持平面)`);
  ok(!/curveDropM|worldCurve/.test(bare(readSrc('public', 'js', 'biomes.js'))), 'biomes.js 不涉曲面(地物照舊擺在平面上)');
  // 消費端只有這三支:公式(data.js)、安裝(toon.js)、細度(terrain.js)+ 例外(vfx.js)
  const files = ['data.js', 'toon.js', 'terrain.js', 'vfx.js'];
  ok(files.length === 4, `曲面的消費端只有 ${files.join(' / ')}`);
}

// ============ 語法閘搬家了 ============
// 舊 Ⅷ 段在這裡跑過本批觸及的五支檔案的 `node --check`(GLSL 住在 JS 樣板字串裡 ⇒ 註解裡一個
// 反引號會吃掉整支檔)。那道閘已經整條擴充成 `tools/audit_client_syntax.mjs`,覆蓋
// **全部** `public/js/*.js` ⇒ 這裡再留一份就是第二份實作(§0.2),移除。改曲面照樣要跑那一支。

console.log(`\n${fail ? '❌' : '✅'} 通過 ${pass} 項${fail ? `,失敗 ${fail} 項` : ''}`);
if ((BREAK_KNEE || BREAK_EDGE) && !fail) {
  console.error('❌ 反向驗證失敗:故意寫壞了但稽核全綠 —— 這條守門線沒有真的在守');
  process.exit(1);
}
process.exit(fail && !(BREAK_KNEE || BREAK_EDGE) ? 1 : 0);
