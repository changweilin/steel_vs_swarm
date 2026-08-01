// ============ 觀戰相機稽核(2026-08-02 使用者需求)============
// 使用者定調兩件事:
//   ①「觀戰時:上帝視角加入下降操作」
//   ②「玩家視角可切換第一人稱 / 第三人稱跟隨視角 / 第三人稱自由視角,運鏡時避免太晃,
//      會顯示該玩家所有資訊(包括商店升級)」
// 用途:改 `data.js SPEC_CAM`/`specViewNext`/`camSmoothF`/`camAngleStep`、
//      `game.js _updateSpectator`/`_specSetView`/`_specCycleView`/`_specFollow`/`_specHud`、
//      觀戰鍵位(_onKey 的 F・Q/E、_cmd 的 special・swap)、或觀戰資訊面板
//      (main.js renderSpecUpg / hud.self 的 spec 分支、index.html #specUpg、CSS body.spectating)
//      之後跑這一支。
// 跑法:`node tools/audit_spectator_cam.mjs [-v]`(純原文 + 純函式直測,不需瀏覽器/外網)
//
// 這支要釘住的**五件事**(每一件壞掉都不會報錯,只會「手感怪」或「看不到東西」):
//   Ⅰ 常數與單一縫:視角序只有 `SPEC_CAM.VIEWS` 一份(鍵盤 F 與觸控十字鍵左同吃 ⇒ 兩端不會
//     走出不同的循環)、`_specView` 只有兩個寫入點(初值 + `_specSetView`)、
//     game.js MUST NOT 自留一份係數表或手寫平滑常數。
//   Ⅱ 平滑數學(**運鏡不晃的全部本錢**):`camSmoothF` 是 `1 − e^(−k·dt)` ⇒ 幀率無關 ——
//     同一段時間不論切成幾幀,收斂到同一個位置。退回逐幀固定係數(`x += (t−x)*0.1`)不會報錯,
//     只會讓 30fps 比 120fps 晃得多(正是使用者回報的那種「太晃」)。
//     角度平滑 MUST 走最短路徑,否則機體轉過 ±π 時相機會繞一整圈。
//   Ⅲ 相機行為直測(以真品 `_updateSpectator` 原文跑):上帝視角三顆升降鍵、下降地板夾制、
//     四種視角各自的相機解、**只有第一人稱藏機體**(第三人稱藏掉就只剩空鏡頭)、
//     瞬移超過 SNAP_M 直接貼上(否則換人會拉出一條橫越全圖的長鏡頭)。
//   Ⅳ 鍵位與派發:F / 十字鍵左 → `_specCycleView` 同一個出口;說明文字(help.js)四種視角齊全。
//   Ⅴ 玩家資訊面板:欄位一律**照抄快照**(A1:觀戰端不自算)、八軌軌名吃 `ECON.UPGRADES`
//     同一份表、面板 DOM 只有一塊(與交戰共用 `.hud-self`,MUST NOT 另做第二塊)。
import { readSrc, grabMethod } from './audit_src.mjs';
// heroTargetH 取 data.js 那一份(models.js 只是轉出;直接 import models.js 會拉進 three,
// 而 three 走 CDN importmap,Node 端解析不了)
import { SPEC_CAM, specViewNext, camSmoothF, camAngleStep, wrapPi, ECON, CHARACTERS, SIDES, heroTargetH } from '../public/js/data.js';

const dataSrc = readSrc('public', 'js', 'data.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const helpSrc = readSrc('public', 'js', 'help.js');
const htmlSrc = readSrc('public', 'index.html');
const cssSrc = readSrc('public', 'css', 'style.css');

const verbose = process.argv.includes('-v');
let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; if (verbose) console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}${extra ? ` — ${extra}` : ''}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
const count = (src, re) => (src.match(re) || []).length;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── Ⅰ 常數與單一縫 ──────────────────────────────────────────────
sec('Ⅰ 常數與單一縫');
ok(Array.isArray(SPEC_CAM.VIEWS) && SPEC_CAM.VIEWS.length === 4,
  '視角序 SPEC_CAM.VIEWS 恰四種(上帝 / 第一人稱 / 第三人稱跟隨 / 第三人稱自由)');
ok(SPEC_CAM.VIEWS[0] === 'god', '序首 = god:沒有跟隨目標時的降級落點');
ok(['fpv', 'tps', 'orbit'].every((v) => SPEC_CAM.VIEWS.includes(v)),
  '使用者指定的三種玩家視角全在序內');
ok(SPEC_CAM.VIEWS.every((v) => typeof SPEC_CAM.NAMES[v] === 'string' && SPEC_CAM.NAMES[v]),
  '每一種視角都有中文名(播報 / HUD 標題 / 說明文字共用這一份)');
ok(new Set(Object.values(SPEC_CAM.NAMES)).size === SPEC_CAM.VIEWS.length,
  '四個視角名互異(重名 = 玩家分不出現在是哪一種)');
{
  // 循環閉合:從序首連按 N 次回到序首,且中途剛好走遍每一種
  let v = SPEC_CAM.VIEWS[0];
  const seen = [v];
  for (let i = 0; i < SPEC_CAM.VIEWS.length - 1; i++) { v = specViewNext(v); seen.push(v); }
  ok(new Set(seen).size === SPEC_CAM.VIEWS.length && specViewNext(v) === SPEC_CAM.VIEWS[0],
    '`specViewNext` 走遍四種後回到序首(循環閉合,不漏不重)', seen.join('→'));
}
ok(specViewNext('不存在的視角') === SPEC_CAM.VIEWS[0],
  '未知視角一律回到序首(降級不例外,MUST NOT 丟例外或卡住)');
ok(SPEC_CAM.FPV_YAW_K > SPEC_CAM.YAW_K,
  `第一人稱的偏航跟得比第三人稱緊(FPV_YAW_K ${SPEC_CAM.FPV_YAW_K} > YAW_K ${SPEC_CAM.YAW_K})`
  + ' —— 第一人稱是「用他的眼睛看」,鏡頭落後於他轉頭就是暈');
ok(SPEC_CAM.POS_K > 0 && SPEC_CAM.YAW_K > 0 && SPEC_CAM.SNAP_M > 0, '平滑係數與瞬移門檻皆為正');
ok(SPEC_CAM.FLOOR_M > 0, '下降地板餘裕 FLOOR_M > 0(降到地面就停住,不鑽進地形)');
ok(SPEC_CAM.FOV_MIN < SPEC_CAM.FOV_MAX && SPEC_CAM.FOV_STEP > 1, '滾輪縮放:視野角上下界與等比步進合法');
ok(!/\nconst SPEC = \{/.test(gameSrc),
  'game.js 已無本地 `SPEC` 常數表(常數只准住 data.js SPEC_CAM,否則稽核驗的與跑的是兩份)');
ok(count(gameSrc, /SPEC_CAM\./g) >= 8 && !/SPEC\.(FOV|FLY)/.test(gameSrc),
  'game.js 全面改吃 SPEC_CAM,舊的 `SPEC.FOV_*` / `SPEC.FLY_Y` 已無殘留');
ok(count(gameSrc, /this\._specView = /g) === 2,
  '`_specView` 恰兩個寫入點(建構子初值 + `_specSetView`)—— 散出去就會有人繞過循環序',
  `目前 ${count(gameSrc, /this\._specView = /g)} 處`);
const upd = grabMethod(gameSrc, '_updateSpectator');
ok(!/Math\.exp\(/.test(upd) && !/\* 0\.\d+\)/.test(upd.replace(/\/\/.*$/gm, '')),
  '`_updateSpectator` MUST NOT 手寫平滑係數(一律經 camSmoothF / camAngleStep)');
ok(/camSmoothF\(/.test(upd) && /camAngleStep\(/.test(upd),
  '位置與偏航兩軸都吃平滑縫');
ok(count(dataSrc, /export const camSmoothF/g) === 1 && count(dataSrc, /export const camAngleStep/g) === 1,
  '平滑數學唯一縫住 data.js(離線稽核 import 得到真品)');

// ── Ⅱ 平滑數學:幀率無關 + 最短路徑 ─────────────────────────────
sec('Ⅱ 平滑數學(運鏡不晃的本錢)');
ok(near(camSmoothF(SPEC_CAM.POS_K, 0), 0), 'dt = 0 ⇒ 完全不移動(暫停/切分頁不會偷偷位移)');
ok(camSmoothF(SPEC_CAM.POS_K, 1 / 60) > 0 && camSmoothF(SPEC_CAM.POS_K, 1 / 60) < 1,
  '單幀權重落在 (0, 1):既會逼近也不會一步到位');
ok(camSmoothF(SPEC_CAM.POS_K, 1 / 30) > camSmoothF(SPEC_CAM.POS_K, 1 / 60),
  '同係數下 dt 越大權重越大(掉幀時追得更多,才補得回落後量)');
ok(camSmoothF(SPEC_CAM.POS_K, 1e6) <= 1 && camSmoothF(-5, 0.1) === 0 && camSmoothF(3, -1) === 0,
  '權重恆 ≤ 1、負係數/負 dt 夾到 0(不過衝、不反向)');
{
  // **幀率無關直測**:同一段 1 秒的追隨,30 / 60 / 240fps 收斂到同一個位置。
  // 這正是「太晃」的根因測試 —— 退回固定係數的話三者會差到 10% 以上。
  const chase = (fps) => {
    let x = 0;
    for (let i = 0; i < fps; i++) x += (100 - x) * camSmoothF(SPEC_CAM.POS_K, 1 / fps);
    return x;
  };
  const a = chase(30), b = chase(60), c = chase(240);
  ok(Math.abs(a - b) < 0.5 && Math.abs(b - c) < 0.5,
    '追隨 1 秒後的位置與幀率無關(30/60/240fps 差 < 0.5m)',
    `30fps=${a.toFixed(3)} 60fps=${b.toFixed(3)} 240fps=${c.toFixed(3)}`);
  ok(Math.abs(c - 100 * (1 - Math.exp(-SPEC_CAM.POS_K))) < 0.5,
    '收斂值 = 解析解 100·(1 − e^−k)(推導不手寫)');
}
ok(near(wrapPi(0), 0) && near(wrapPi(Math.PI * 2), 0) && near(wrapPi(-Math.PI * 2), 0)
  && near(Math.abs(wrapPi(Math.PI * 3)), Math.PI, 1e-9) && near(wrapPi(Math.PI * 2.5), Math.PI / 2, 1e-9),
  '`wrapPi` 把角度差摺回 ±π 之內(整圈歸零;180° 兩端等價)');
{
  // 跨 ±π:從 +179° 追到 −179°(實際只差 2°)MUST 走短的那一邊
  const cur = Math.PI - 0.02, tgt = -Math.PI + 0.02;
  const next = camAngleStep(cur, tgt, SPEC_CAM.YAW_K, 1 / 60);
  ok(next > cur, '跨 ±π 走最短路徑(往同方向繼續轉,不繞回去掃過整圈)',
    `cur=${cur.toFixed(3)} → ${next.toFixed(3)}`);
  ok(Math.abs(wrapPi(next - cur)) < 0.05, '單幀轉角遠小於一整圈(不瞬移)');
}
{
  let y = 0;
  for (let i = 0; i < 600; i++) y = camAngleStep(y, 1.2, SPEC_CAM.YAW_K, 1 / 60);
  ok(near(y, 1.2, 1e-3), '長時間追同一個角度會收斂到目標(不殘留穩態誤差)', y.toFixed(6));
  const over = camAngleStep(0, 1, SPEC_CAM.YAW_K, 10);
  ok(over <= 1 + 1e-9, '超長 dt(卡幀)也不過衝目標角');
}

// ── Ⅲ 相機行為直測(真品 `_updateSpectator` 原文)────────────────
sec('Ⅲ 相機行為直測');
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v) { return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2; }
  lerp(v, f) { this.x += (v.x - this.x) * f; this.y += (v.y - this.y) * f; this.z += (v.z - this.z) * f; return this; }
}
const THREE_STUB = { Vector3: V3 };
const HERO_VIEW = () => ({ e: 0.85, f: 0.1 });   // 視點比例:真品住 game.js 模組層,行為與本測無關
const proto = new Function(
  'THREE', 'SPEC_CAM', 'camSmoothF', 'camAngleStep', 'CHARACTERS', 'SIDES', 'heroTargetH', 'heroView',
  `return ({ ${grabMethod(gameSrc, '_updateSpectator')} });`,
)(THREE_STUB, SPEC_CAM, camSmoothF, camAngleStep, CHARACTERS, SIDES, heroTargetH, HERO_VIEW);

const CH = Object.keys(CHARACTERS)[0];
const HH = heroTargetH(CHARACTERS[CH].kind, CH);
const mkTarget = (x = 0, y = 0, z = 0, ry = 0) => ({
  pid: 'p1', ch: CH, side: CHARACTERS[CH].side || 'SWARM', ry, heroY: 0, dead: false,
  hero: true, act: true, mesh: { position: new V3(x, y, z), visible: true },
});
/** 造一個最小可跑的觀戰客戶端(surf = 站立面高度) */
const mkSpec = (view, tgt, surf = 0) => {
  const c = Object.assign(Object.create(null), proto, {
    side: null, keys: {}, yaw: 0, pitch: 0,
    pos: new V3(0, 300, 0),
    camera: {
      position: new V3(), fov: 68, rotation: { set() {} },
      rotateY() {}, rotateX() {}, updateProjectionMatrix() {},
    },
    _specFov: 68, _specView: view, _specPid: tgt ? tgt.pid : null,
    _specHid: null, _specAnchor: new V3(), _specAnchorOk: false, _specYaw: 0,
    _moveAxis: () => ({ f: 0, r: 0, mag: 0, boost: false }),
    _specRoster: () => (tgt ? [tgt] : []),
    _specSetView(id) { this._specView = id; this._specPid = null; this._specAnchorOk = false; },
    _surf: () => surf,
    hud: { feed() {} },
  });
  return c;
};
const DT = 1 / 60;
{
  // ① 上帝視角:三顆升降鍵(使用者需求「上帝視角加入下降操作」)
  const up = mkSpec('god', null); up.keys.Space = true; up.pos.set(0, 300, 0);
  up._updateSpectator(DT);
  ok(up.pos.y > 300, 'Space = 上升');
  const dn = mkSpec('god', null); dn.keys.KeyC = true; dn.pos.set(0, 300, 0);
  dn._updateSpectator(DT);
  ok(dn.pos.y < 300, 'C = 下降(使用者需求的那一顆)');
  const dc = mkSpec('god', null); dc.keys.ControlLeft = true; dc.pos.set(0, 300, 0);
  dc._updateSpectator(DT);
  ok(near(dc.pos.y, dn.pos.y), 'Ctrl 與 C 同一顆下降鍵(與飛行機體的下降鍵一致,肌肉記憶不分家)');
  ok(near(300 - dn.pos.y, SPEC_CAM.MOVE_MPS * DT, 1e-9),
    '下降速率 = SPEC_CAM.MOVE_MPS(推導不手寫)');
  const bo = mkSpec('god', null); bo.keys.KeyC = true; bo.pos.set(0, 300, 0);
  bo._moveAxis = () => ({ f: 0, r: 0, mag: 0, boost: true });
  bo._updateSpectator(DT);
  ok(near(300 - bo.pos.y, SPEC_CAM.MOVE_MPS * SPEC_CAM.BOOST_F * DT, 1e-9),
    'Shift 加速同時作用在升降(不然按著 Shift 只有水平變快,垂直像卡住)');
  // 地板夾制:降到站立面上方 FLOOR_M 就停住
  const fl = mkSpec('god', null, 120); fl.keys.KeyC = true; fl.pos.set(0, 120 + SPEC_CAM.FLOOR_M + 0.1, 0);
  fl._updateSpectator(DT);
  ok(near(fl.pos.y, 120 + SPEC_CAM.FLOOR_M),
    '下降到站立面上方 FLOOR_M 停住(鑽進地形只會看到黑畫面 —— 降不下去比掉進山肚子好)');
  ok(near(fl.camera.position.y, fl.pos.y), '上帝視角:相機 = 自由飛行座標(夾制後才同步)');
}
{
  // ② 第一人稱:藏機體、偏航跟著伺服器 ry(且**平滑**不是直接賦值)
  const tgt = mkTarget(10, 5, -20, 1.0);
  const c = mkSpec('fpv', tgt);
  c._updateSpectator(DT);
  ok(tgt.mesh.visible === false, '第一人稱藏掉座機(不要從自己的鼻子裡往外看)');
  ok(c._specHid === tgt, '藏起來的機體有登記(換視角 / 換人時才還得回去)');
  ok(c._specAnchorOk && near(c._specAnchor.x, 10), '首幀錨點直接貼上目標(不從原點拉一條長鏡頭)');
  ok(c.yaw > 0 && c.yaw < tgt.ry,
    '偏航朝該玩家的視線平滑逼近,MUST NOT 直接賦值(ry 量化到 0.01 rad,貼上去就是一格一格跳)',
    `yaw=${c.yaw.toFixed(4)} ry=${tgt.ry}`);
  for (let i = 0; i < 300; i++) c._updateSpectator(DT);
  ok(near(c.yaw, tgt.ry, 1e-3), '穩定後偏航收斂到該玩家的視線');
  ok(near(c.pos.x, 10) && near(c.pos.z, -20),
    '`this.pos` 跟著目標跑(迷霧 / 小地圖 / 音場都讀它)');
}
{
  // ③ 第三人稱:不藏機體、相機在距離上、注視點對準機體頂高
  for (const view of ['tps', 'orbit']) {
    const tgt = mkTarget(0, 0, 0, 0);
    const c = mkSpec(view, tgt);
    c.pitch = SPEC_CAM.TPS_PITCH;
    c._updateSpectator(DT);
    ok(tgt.mesh.visible === true, `${SPEC_CAM.NAMES[view]}:MUST NOT 藏掉機體(藏了就只剩空鏡頭)`);
    const cp = c.camera.position;
    const dist = Math.max(SPEC_CAM.MIN_DIST, HH * SPEC_CAM.DIST_F);
    ok(near(Math.hypot(cp.x, cp.z), dist * Math.cos(c.pitch), 1e-6),
      `${SPEC_CAM.NAMES[view]}:水平距離 = max(MIN_DIST, 機體高 × DIST_F) 的水平分量(距離以機體實高為尺)`);
    // 注視點反算:相機沿俯仰射出去 dist 之後,MUST 落在機體頂高 × AIM_F
    const aim = cp.y + Math.sin(c.pitch) * dist;
    ok(near(aim, HH * SPEC_CAM.AIM_F, 1e-6),
      `${SPEC_CAM.NAMES[view]}:注視點 = 機體頂高 × AIM_F(不論俯仰怎麼調,人都在畫面中心)`);
  }
  // 跟隨 vs 自由:偏航歸誰管
  const t1 = mkTarget(0, 0, 0, 1.2);
  const tp = mkSpec('tps', t1); tp.yaw = -2.5;
  for (let i = 0; i < 300; i++) tp._updateSpectator(DT);
  ok(near(tp.yaw, 1.2, 1e-3), '第三人稱跟隨:偏航由該玩家的朝向決定(觀戰者不用一直手動追)');
  const t2 = mkTarget(0, 0, 0, 1.2);
  const ob = mkSpec('orbit', t2); ob.yaw = -2.5;
  for (let i = 0; i < 300; i++) ob._updateSpectator(DT);
  ok(near(ob.yaw, -2.5), '第三人稱自由:偏航完全由觀戰者控(MUST NOT 被 ry 蓋掉)');
}
{
  // ④ 平滑 vs 瞬移:小位移要平滑(不晃),換人/重生的大跳一律直接貼上(不拉長鏡頭)
  const tgt = mkTarget(0, 0, 0, 0);
  const c = mkSpec('tps', tgt);
  c._updateSpectator(DT);
  tgt.mesh.position.set(SPEC_CAM.SNAP_M * 0.2, 0, 0);
  c._updateSpectator(DT);
  ok(c._specAnchor.x > 0 && c._specAnchor.x < SPEC_CAM.SNAP_M * 0.2,
    '目標小幅移動:錨點平滑逼近(直接貼上 = 8Hz 快照的逐幀抖動全進相機)');
  tgt.mesh.position.set(SPEC_CAM.SNAP_M * 5, 0, 0);
  c._updateSpectator(DT);
  ok(near(c._specAnchor.x, SPEC_CAM.SNAP_M * 5),
    `超過 SNAP_M(${SPEC_CAM.SNAP_M}m)的瞬移直接貼上 —— 換人/重生不該拉出一條橫越全圖的長鏡頭`);
}
{
  // ⑤ 目標退場:還原機體 + 降級回上帝視角(且走 `_specSetView` 同一個縫)
  const tgt = mkTarget(0, 0, 0, 0);
  const c = mkSpec('fpv', tgt);
  c._updateSpectator(DT);
  c._specRoster = () => [];
  c._updateSpectator(DT);
  ok(tgt.mesh.visible === true, '目標退場:藏起來的機體 MUST 還原(留著就是一台永久隱形機)');
  ok(c._specView === 'god' && c._specPid === null, '目標退場降級回上帝視角(寧缺勿錯)');
  ok(/_specSetView\('god'\)/.test(upd),
    '降級走 `_specSetView` 同一個縫,MUST NOT 在 `_updateSpectator` 就地指派 `_specView`');
  // 換視角(fpv → tps)也要還原機體
  const t2 = mkTarget(0, 0, 0, 0);
  const c2 = mkSpec('fpv', t2);
  c2._updateSpectator(DT);
  c2._specView = 'tps';
  c2._updateSpectator(DT);
  ok(t2.mesh.visible === true && c2._specHid === null,
    '第一人稱 → 第三人稱:機體 MUST 現身(切過去看不到人就是這條漏了)');
}
{
  // ⑥ 第三人稱相機不鑽地(站立面之下 = 黑畫面)
  const tgt = mkTarget(0, 0, 0, 0);
  const c = mkSpec('orbit', tgt, 500);   // 站立面遠高於機體 ⇒ 相機解必然落在地底
  c.pitch = 0;
  c._updateSpectator(DT);
  ok(c.camera.position.y >= 500 + SPEC_CAM.FLOOR_M - 1e-9,
    '第三人稱相機被地形/橋面擋住時抬回站立面上方(與上帝視角同一條地板規則)');
}

// ── Ⅳ 鍵位與派發單一縫 ─────────────────────────────────────────
sec('Ⅳ 鍵位與派發');
const onKey = gameSrc.slice(gameSrc.indexOf('this._onKey = (e) =>'), gameSrc.indexOf('window.addEventListener(\'keydown\''));
ok(/KeyF'\) this\._specCycleView\(\)/.test(onKey), '鍵盤 F = 循環視角');
ok(/KeyQ'\) this\._specFollow\(-1\)/.test(onKey) && /KeyE'\) this\._specFollow\(1\)/.test(onKey),
  'Q/E = 名冊前後換人(與視角切換分開:換誰 ≠ 怎麼看)');
ok(/!this\.side && !this\.paused/.test(onKey),
  '觀戰鍵位關在 side=null 分支內(F/Q/E 在交戰中另有他用)');
const cmd = grabMethod(gameSrc, '_cmd');
ok(/act === 'special'\) this\._specCycleView\(\)/.test(cmd),
  '觸控十字鍵左 = 循環視角(與鍵盤 F 同一個出口 `_specCycleView`)');
ok(/act === 'swap'\) this\._specFollow\(1\)/.test(cmd), '觸控 ⇄換人 = 下一位玩家');
ok(/act === 'dive'\) \{ this\.keys\.KeyC/.test(cmd),
  '觸控 ZL 下降對映到 KeyC(上帝視角與飛行機體共用同一顆鍵,MUST NOT 另寫垂直位移)');
ok(count(gameSrc, /_specCycleView\(\)\s*\{/g) === 1, '`_specCycleView` 只有一份實作');
ok(/specViewNext\(this\._specView\)/.test(gameSrc),
  '循環序取自 `specViewNext`,MUST NOT 在 game.js 手寫下一個是誰');
ok(!/_specFollow\(this\._specPid \? null : 0\)/.test(gameSrc),
  '舊的「上帝 ⇄ 玩家視角」二態切換已整組退場(留著 = 兩端走不同的循環)');
for (const v of SPEC_CAM.VIEWS) {
  ok(helpSrc.includes(SPEC_CAM.NAMES[v]),
    `help.js 說明寫得出「${SPEC_CAM.NAMES[v]}」(A21:操作說明只住 help.js)`);
}
ok(/Ctrl/.test(helpSrc) && /下降/.test(helpSrc), 'help.js 寫明上帝視角的下降鍵');

// ── Ⅴ 玩家資訊面板(含商店升級)──────────────────────────────
sec('Ⅴ 玩家資訊面板');
const specHud = grabMethod(gameSrc, '_specHud');
ok(/spec: true/.test(specHud) && /follow: true/.test(specHud),
  '`_specHud` 以 spec/follow 旗標標記自己(HUD 端據此換標題與收放面板)');
ok(!/this\.wstate|this\.upg|this\.money|this\.abil/.test(specHud),
  '面板欄位 MUST NOT 讀自機狀態(讀了就會顯示觀戰者自己的舊值)');
ok(/tgt\.up/.test(specHud) && /tgt\.cds/.test(specHud) && /tgt\.money/.test(specHud) && /tgt\.mp/.test(specHud),
  '金錢 / 電力 / 招式冷卻 / 八軌升級一律取自該玩家的快照欄位(A1:觀戰端不自算)');
ok(/ammo: null/.test(specHud),
  '彈藥回 null(伺服器不發別人的彈夾狀態)—— 寧缺勿錯,MUST NOT 拿本地值假裝');
ok(/lift: null/.test(specHud) && /mobil: null/.test(specHud),
  '爬升動力與空白鍵機動 CD 是純客戶端量測 ⇒ 觀戰一律 null,不編造');
const snap = grabMethod(gameSrc, '_applySnap');
ok(/if \(!this\.side && e\.act\) \{/.test(snap),
  '快照留存只在觀戰 + 主視野機(交戰中沒有消費端,別多存)');
ok(/ent\.up = e\.up/.test(snap) && /ent\.money = e\.\$/.test(snap),
  '八軌升級與金錢由快照落地到 ent(伺服器 _serializeEnt 本來就發這幾欄)');
ok(count(gameSrc, /_specHud\(\)/g) === 2,
  '`_specHud` 只有定義 + HUD 呼叫兩處', `目前 ${count(gameSrc, /_specHud\(\)/g)} 處`);
// 面板 DOM:與交戰共用同一塊 .hud-self
ok(count(htmlSrc, /id="specUpg"/g) === 1, 'index.html 的八軌升級列只有一塊(#specUpg)');
ok(/id="specUpg"[^>]*>\s*<\/div>/.test(htmlSrc),
  '#specUpg 靜態標記為空(內容由 main.js 灌;寫死一份 = 與 ECON.UPGRADES 漂開)');
ok(htmlSrc.indexOf('id="specUpg"') > htmlSrc.indexOf('class="hud-self"')
  && htmlSrc.indexOf('id="specUpg"') < htmlSrc.indexOf('id="minimap"'),
  '#specUpg 掛在 .hud-self 之內(觀戰面板 MUST NOT 另開一塊蓋住戰場)');
const upgFn = mainSrc.slice(mainSrc.indexOf('function renderSpecUpg'), mainSrc.indexOf('function makeHud'));
ok(/Object\.entries\(ECON\.UPGRADES\)/.test(upgFn),
  '八軌軌名/上限吃 `ECON.UPGRADES` 同一份表(加軌改名兩邊自動同步)');
ok(!/輕武器強化|裝甲強化|充能系統/.test(upgFn),
  'renderSpecUpg MUST NOT 手抄軌名(抄一份就是第二份實作)');
ok(count(mainSrc, /function renderSpecUpg/g) === 1 && count(mainSrc, /renderSpecUpg\(/g) === 2,
  '`renderSpecUpg` 只有一份實作 + 一個呼叫點');
ok(/if \(w\?\.spec\) \{/.test(mainSrc),
  'hud.self 以 `w.spec` 分流 —— 觀戰與交戰共用同一塊面板渲染(MUST NOT 另做第二塊)');
ok(/TOUCH_UI\(\) && !w\.spec/.test(mainSrc),
  '觀戰不把別人的招式 CD 鏡射到搖桿鈕面(那幾顆在觀戰版型下是視角/換人)');
ok(/l\.ammo == null \? '—'/.test(mainSrc), '彈藥未知時顯示「—」');
ok(/body\.spectating:not\(\.spec-follow\) \.hud-self > :not\(\.hud-side\)/.test(cssSrc),
  '沒跟人時面板只留標題(靠 CSS 收起 —— 欄位增減不必再補一份顯隱清單)');
ok(/body\.spectating\.spec-follow \.spec-upg/.test(cssSrc), '跟上玩家才顯示八軌升級列');
ok(/classList\.remove\('spectating', 'spec-follow'\)/.test(gameSrc),
  '離場 MUST 清掉觀戰版型 class(留著 = 下一局角色數據面板整塊被收起)');

console.log(fail
  ? `\n✗ 觀戰相機稽核:${fail} 項未通過(共 ${pass + fail})`
  : `\n✓ 觀戰相機稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
