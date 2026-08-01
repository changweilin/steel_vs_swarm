// ============ 電腦玩家:前方視野 + 實體碰撞 稽核(2026-08-02 使用者需求)============
// 需求原文:「電腦應該要跟玩家一樣只有前方特定角度範圍的視野,其他方向敵人來襲視角要跟著轉向,
//            不可以有全角度視野」/「電腦玩家的碰撞法則一律跟正常玩家一樣,移動與攻擊都不可
//            穿牆穿越各種物理碰撞的物件」。
// 改 `data.js` 的 `BOT_VIEW`/`botFovHalf`/`SELF_F`/`selfCollider`/`COLLIDE_KINDS`、
// `bots.js` 的 `_face`/`_turn`/`_alertLook`/`_bearing`/`_fovHalf`/`_move`/`_skirt`/`_stuck`/`_acquire`、
// `sim.js` 的 `solidResolve`/`_solidsNear`/`solidPush`/`solidEnter`/`_hurtLog`、
// `game.js` 的 `_collide`/`COLLIDER` 之後跑:`node tools/audit_bot_vision.mjs`
//
// 這支盯的是「**看不出來但玩起來就是不對**」的那一批寫壞法:
//   ① 視野錐漏掉一條路:`_acquire` 以外還有第二處選敵 ⇒ bot 照樣從背後鎖人,肉眼只覺得「AI 好神」。
//   ② 轉頭寫成直接指派 `h.ry = 目標角`:視野錐立刻失去意義(瞬間回頭 = 等於全角度),
//      而畫面上只是「bot 轉得比較快」,沒人查得出來。
//   ③ 受擊警戒自己記一份帳:伺服器唯一知道「被誰從哪裡打」的地方是 `_hurtLog`,另開第二份
//      必定與濺血那份分家(A1 家族)。
//   ④ 碰撞係數兩端各寫一份:真人撞得到、電腦穿得過 —— 這是碰撞版的 A30(兩端幾何分家)。
//   ⑤ 只做 push-out 不做掃掠:低速貼牆看起來完全正常,擊退/掉幀的那一幀直接穿到牆的另一側。
//   ⑥ 碰撞上線卻沒有繞行:bot 沒有尋路,正面頂著建物會**原地卡死**= 整條兵線不推,
//      而「bot 站著不動」很容易被誤判成 AI 難度問題。
//
// 手法:常數/曲線直接 import(data.js 是純模組)、原文單一縫走 `audit_src.mjs`、
// 行為一律以**真的 BattleSim + 真的 BotBrain** 直測。
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  BOT_VIEW, botFovHalf, VIEW_LOCK, viewLockStep, wrapPi, SELF_F, selfCollider, COLLIDE_KINDS,
  UNITS, CHARACTERS, heroKindOf, heroWeapon, hitR, hitH, MAPGEO, GAME,
} from '../public/js/data.js';
import { BattleSim, cumLen, pointAt } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';

const botsSrc = readSrc('server', 'bots.js');
const simSrc = readSrc('server', 'sim.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const climbSrc = readSrc('public', 'js', 'climb.js');

// 「全檔只有 N 處」MUST 只數**執行原文**:註解也提得到同一個名字,連著數會把「說明寫得詳細」
// 誤判成「縫破了」(與 audit_blood_splat / audit_cc_flash 同一支剝法)。
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const botsCode = strip(botsSrc).split("} from '../public/js/data.js';").slice(1).join('');
const simCode = strip(simSrc);
const gameCode = strip(gameSrc).split("} from './data.js';").slice(1).join("} from './data.js';");
const count = (s, needle) => s.split(needle).length - 1;

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const sec = (s) => console.log(`\n■ ${s}`);

// ---- 共用:真 BattleSim ----
function fakeCfg() {
  const A = [25.0330, 121.5654], Dm = 1600, R = 6371000;
  const dLat = Dm * MAPGEO.REAL_SCALE / R * 180 / Math.PI;
  const B = [A[0] + dLat, A[1]];
  const pts = [];
  for (let s = 0; s <= 1.001; s += 0.05) pts.push([A[0] + (B[0] - A[0]) * s, A[1]]);
  const sizeM = Dm / (0.85 * Math.SQRT2);
  return {
    center: { lat: (A[0] + B[0]) / 2, lng: A[1] }, bases: { SWARM: A, STEEL: B }, lanes: [pts],
    sizeM, diagM: sizeM * Math.SQRT2, distM: Dm, geoScaleVer: MAPGEO.GEO_SCALE_VER,
    maxOverlap: 0.05, synthetic: true, placeName: '稽核戰區',
    env: { season: 'summer', time: 'day', weather: 'clear' },
  };
}
/** 空戰場:清掉全部既有實體與野營,只留稽核自己放的東西(推擠/選敵不被小兵與塔干擾) */
function blank(world = null) {
  const sim = new BattleSim(fakeCfg());
  sim.camps = [];
  for (const e of [...sim.ents.values()]) sim.ents.delete(e.id);
  sim.mines = []; sim.hazBlockers = [];
  if (world) sim.setWorld(world);
  return sim;
}
// 撞牆門檻:bots.js `STUCK.F`(達成率低於此即算推不動)—— 稽核端不另立第二份語意
const STUCK_F = 0.35;
const chOf = (side, kind) => Object.keys(CHARACTERS).find((c) =>
  (CHARACTERS[c].side === side || CHARACTERS[c].side === 'MERC') && heroKindOf(c, side) === kind);
const CH_ROBOT = chOf('STEEL', 'robot');
const CH_DRONE = chOf('SWARM', 'drone');
/** 以 sim 座標放一個「相對 h 的朝向偏 bearing、距離 d」的點 */
const atBearing = (h, bearing, d) => [h.x - Math.sin(bearing + (h.ry || 0)) * d, h.z + Math.cos(bearing + (h.ry || 0)) * d];

// ---------------------------------------------------------------------------------
sec('Ⅰ 常數與推導(data.js:視野半角/碰撞量體 MUST 推導不手寫)');
// ---------------------------------------------------------------------------------
{
  for (const k of ['drone', 'robot', 'morph']) {
    const want = Math.atan(Math.tan(UNITS[k].fov * Math.PI / 360) * BOT_VIEW.ASPECT);
    t(`${k}:半視角 = atan(tan(fov/2) × 寬高比)(推導不手寫)`, near(botFovHalf(k), want), `${botFovHalf(k)}`);
  }
  t('全機種同一個半視角(A8:FOV 全機種一律 68,MUST NOT 用視野做差異化)',
    near(botFovHalf('drone'), botFovHalf('robot')) && near(botFovHalf('drone'), botFovHalf('morph')));
  const deg = botFovHalf('robot') * 180 / Math.PI;
  t(`**不是全角度視野**:半角 ${deg.toFixed(1)}° < 90°`, deg < 90 - 1e-9, `${deg}`);
  t('也不是針孔:半角 > 30°(真人 16:9 畫面的水平視野量級)', deg > 30, `${deg}`);
  t('未知機種退回 68 基準(降級不例外)', near(botFovHalf('不存在的機種'), botFovHalf('robot')));
  t('警戒秒數為正且有限(受擊後轉頭不會永久黏著)', BOT_VIEW.ALERT_S > 0 && BOT_VIEW.ALERT_S < 30);

  // ---- 碰撞量體:客戶端與伺服器的同一支 ----
  for (const H of [3, 6, 12, 26]) {
    const g = selfCollider(H, false), f = selfCollider(H, true);
    t(`H=${H} 地面量體 = 身高 × SELF_F(推導不手寫)`,
      near(g.r, H * SELF_F.groundR) && near(g.bot, 0) && near(g.top, H * SELF_F.groundTop));
    t(`H=${H} 飛行量體:機腹在機體 y 之下(bot < 0)且半徑更寬`,
      near(f.r, H * SELF_F.flyR) && near(f.bot, -H * SELF_F.flyBot) && f.bot < 0 && f.r > g.r);
    t(`H=${H} 垂直帶恆有厚度(top > bot)`, g.top > g.bot && f.top > f.bot);
  }
  t('舊制觀感校準值不變(robot 6m → r 1.9 / drone 3m → r 1.6)',
    near(selfCollider(6, false).r, 1.902, 1e-3) && near(selfCollider(3, true).r, 1.599, 1e-3));
  t('COLLIDE_KINDS = 會擋住座機的 5 種(MUST NOT 隨 TARGET_R 增列而擴張)',
    COLLIDE_KINDS.length === 5 && ['base', 'tower', 'tank', 'apc', 'soldier'].every((k) => COLLIDE_KINDS.includes(k)),
    COLLIDE_KINDS.join(','));
  t('直升機/碉堡刻意不擋路', !COLLIDE_KINDS.includes('heli') && !COLLIDE_KINDS.includes('bunker'));
}

// ---------------------------------------------------------------------------------
sec('Ⅱ 單一縫(原文:視角/位置各只有一個寫入點,量體兩端同吃)');
// ---------------------------------------------------------------------------------
{
  t('bots.js:`h.ry` 全檔只有一處寫入', count(botsCode, 'h.ry =') === 1, `${count(botsCode, 'h.ry =')} 處`);
  t('唯一的寫入點是 `_turn`', /h\.ry\s*=/.test(strip(grabMethod(botsSrc, '_turn'))));
  t('`_face` 只寫意圖不寫 ry(寫了就是瞬間回頭 = 視野錐失效)',
    !/h\.ry\s*=/.test(strip(grabMethod(botsSrc, '_face'))) && /_wantRy\s*=/.test(strip(grabMethod(botsSrc, '_face'))));
  t('轉頭步進只准經 `viewLockStep`(與真人的視野鎖定輔助同一支角速度上限)',
    count(botsCode, 'viewLockStep(') === 1 && /viewLockStep\(/.test(strip(grabMethod(botsSrc, '_turn'))));
  t('bots.js MUST NOT 手寫角速度 / 逼近係數', !/VIEW_LOCK\.(W|EASE)/.test(botsCode));
  t('視野半角只有一處取(`_fovHalf`)', count(botsCode, 'botFovHalf(') === 1);
  t('方位換算只有一支(`_bearing`;視野錐與受擊警戒共用)',
    count(botsCode, '_bearing(h') === 1 + count(botsCode, 'this._bearing('), `_bearing 定義 1 + 呼叫 ${count(botsCode, 'this._bearing(')}`);
  t('視野錐真的掛在 `_acquire` 上', /this\._bearing\(/.test(strip(grabMethod(botsSrc, '_acquire')))
    && /fovHalf/.test(strip(grabMethod(botsSrc, '_acquire'))));
  t('受擊警戒排在狀態機之後(來襲方向優先於原本想看的方向)', (() => {
    const u = strip(grabMethod(botsSrc, 'update'));
    return u.indexOf('this._alertLook(') > u.indexOf('this._push(') && u.indexOf('this._alertLook(') < u.indexOf('this._turn(');
  })());

  t('bots.js:`h.x` 全檔只有一處寫入(位置唯一縫 = `_move`)',
    count(botsCode, 'h.x =') === 1 && count(botsCode, 'h.z =') === 1,
    `x ${count(botsCode, 'h.x =')} / z ${count(botsCode, 'h.z =')} 處`);
  t('唯一的寫入點是 `_move`,且先過 `sim.solidResolve`', (() => {
    const m = strip(grabMethod(botsSrc, '_move'));
    return /h\.x = /.test(m) && /solidResolve\(/.test(m);
  })());
  t('`solidResolve` 在 bots.js 只被呼叫一處', count(botsCode, 'solidResolve(') === 1);
  t('舊制的 hazBlockers 就地繞行已整組退場(改吃同一個碰撞縫)', !/hazBlockers/.test(botsCode));
  t('三種移動狀態(推線/交戰/撤退)全部走 `_move`',
    /this\._move\(/.test(strip(grabMethod(botsSrc, '_push')))
    && /this\._move\(/.test(strip(grabMethod(botsSrc, '_engage')))
    && /this\._move\(/.test(strip(grabMethod(botsSrc, '_moveToward'))));
  t('飛行判定只有一支(`_fly`;地速與碰撞量體同判)',
    count(botsCode, '_fly(h)') === 1 + count(botsCode, 'this._fly(h)'), `${count(botsCode, 'this._fly(h)')} 個消費端`);

  t('sim.js:碰撞量體只經 `selfCollider`,MUST NOT 手寫 SELF_F 係數',
    count(simCode, 'selfCollider(') === 1 && !/SELF_F\./.test(simCode));
  t('game.js:自機碰撞也吃 `selfCollider`(兩端同一支 ⇒ 撞得到 = 撞得到)',
    /selfCollider\(/.test(strip(grabMethod(gameSrc, '_collide'))));
  t('game.js `_collide` MUST NOT 再手寫 SELF_F 的碰撞係數',
    !/SELF_F\.(groundR|flyR|groundTop|flyTop|flyBot)/.test(strip(grabMethod(gameSrc, '_collide'))));
  t('climb.js 的 MAX_BODY_R 也吃同一支(舊制在該檔手抄 0.317)',
    /selfCollider\(/.test(climbSrc) && !/\* 0\.317/.test(strip(climbSrc)));
  t('推擠/掃掠幾何各只有一份實作',
    count(simCode, 'function solidPush(') === 1 && count(simCode, 'function solidEnter(') === 1);
  t('`solidResolve` 掃掠與 push-out 都在(只做其一 = 高速穿牆 / 殘留重疊)', (() => {
    const s = strip(grabMethod(simSrc, 'solidResolve'));
    return /solidEnter\(/.test(s) && /solidPush\(/.test(s);
  })());
  t('障礙集含「上傳碰撞柱」與「有量體的實體」兩個來源', (() => {
    const s = strip(grabMethod(simSrc, '_solidsNear'));
    return /_losGrid/.test(s) && /COLLIDE_KINDS/.test(s) && /HAZARDS\[/.test(s);
  })());
  t('自己的僚機不碰撞(客戶端同判)', /e\.pid === self\.pid/.test(strip(grabMethod(simSrc, '_solidsNear'))));

  t('受擊警戒掛在 `_hurtLog`(全伺服器唯一知道「被誰從哪裡打」的地方)', (() => {
    const s = strip(grabMethod(simSrc, '_hurtLog'));
    return /_alert = \{/.test(s) && /isBotId\(/.test(s);
  })());
  t('`_alert` 只有 `_hurtLog` 一處記帳(MUST NOT 另開第二份)',
    count(simCode, '_alert = {') === 1 && !/_alert\s*=/.test(botsCode.replace(/_alert = null/g, '')));
  t('警戒 MUST 排在「只記主視野機」那道閘之前(僚機挨打也算打這一隊)', (() => {
    const s = strip(grabMethod(simSrc, '_hurtLog'));
    return s.indexOf('_alert = {') < s.indexOf('this.heroes.get(t.pid) !== t');
  })());
}

// ---------------------------------------------------------------------------------
sec('Ⅲ 前方視野錐 行為直測(真 BattleSim + 真 BotBrain)');
// ---------------------------------------------------------------------------------
{
  const sim = blank();
  const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
  const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
  h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
  const R = heroWeapon(h.ch, 'light', h.abil.light, true).range * 0.5;
  const half = botFovHalf(h.kind);
  /** 在相對朝向 bearing 的方位放一個敵方步兵,回傳 `_acquire` 有沒有選到它 */
  const seen = (bearing) => {
    for (const e of [...sim.ents.values()]) if (e !== h) sim.ents.delete(e.id);
    const [x, z] = atBearing(h, bearing, R);
    const tgt = sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x, z, y: 0, hp: 999, maxHp: 999 });
    sim._tickN++;                       // 視野快取換代(位置/單位數變了)
    const got = brain._acquire(h);
    return got === tgt;
  };
  t('正前方的敵人:鎖得到', seen(0));
  t('正背後的敵人:**鎖不到**(舊制照樣鎖得到 = 全角度視野)', !seen(Math.PI));
  t('正左 / 正右(90°):鎖不到', !seen(Math.PI / 2) && !seen(-Math.PI / 2));
  t('視野邊界內側(半角 −0.05 rad):鎖得到', seen(half - 0.05) && seen(-(half - 0.05)));
  t('視野邊界外側(半角 +0.05 rad):鎖不到', !seen(half + 0.05) && !seen(-(half + 0.05)));
  t('轉過身去就鎖得到(視野是相對機體朝向,不是相對世界)', (() => {
    h.ry = Math.PI;                     // 面向 −z
    const ok = seen(0);                 // atBearing 已含 h.ry ⇒ 正前方 = 機體背後那一側
    h.ry = 0;
    return ok;
  })());
  // 推線時的朝向:視野錐上線後,「看向腳下那個線上目標點」= 看向**側面**(機體停在
  // 目標點旁 ±jitter 處)⇒ 一路側著頭推線、正前方的敵人全數失明。MUST 看前進方向。
  {
    const s2 = blank();
    const p = s2.addHero('SWARM', 'b9', CH_ROBOT);
    const br = new BotBrain(s2, 'b9', 'SWARM', 0, 'high');
    br.jitter = [12, 12];                                   // 最大側向散開(最容易踩到這個坑)
    br.prog = 400; p.y = 0; p.ry = 0;
    const cum = cumLen(s2.lanes[br.lane]);
    for (let k = 0; k < 80; k++) { br._push(p, UNITS[p.kind], 0.125); br._turn(p, 0.125); }
    const [ax, az] = pointAt(s2.lanes[br.lane], cum, br.prog + 200);   // 前方 200m 的兵線點
    const [nx, nz] = pointAt(s2.lanes[br.lane], cum, br.prog);         // 腳下那個目標點
    t('推線時朝向沿兵線前進方向(前方 200m 的兵線點落在視野錐內)',
      Math.abs(br._bearing(p, ax, az)) <= botFovHalf(p.kind), `${(br._bearing(p, ax, az) * 180 / Math.PI).toFixed(1)}°`);
    t('而**不是**看向腳下那個線上目標點(側向散開時那條連線幾乎垂直於兵線)',
      Math.abs(br._bearing(p, nx, nz)) > botFovHalf(p.kind) * 0.5,
      `${(br._bearing(p, nx, nz) * 180 / Math.PI).toFixed(1)}°`);
  }
  t('塔/主堡同樣吃視野錐(真人也得轉頭才看得到塔)', (() => {
    for (const e of [...sim.ents.values()]) if (e !== h) sim.ents.delete(e.id);
    const [bx, bz] = atBearing(h, Math.PI, 60);
    sim._add({ kind: 'tower', side: 'SWARM', x: bx, z: bz, y: 0, hp: 9999, maxHp: 9999 });
    sim._tickN++;
    return brain._acquire(h) == null;
  })());
}

// ---------------------------------------------------------------------------------
sec('Ⅳ 受擊警戒:其他方向來襲 → 視角跟著轉(真 BattleSim)');
// ---------------------------------------------------------------------------------
{
  const sim = blank();
  const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
  const foe = sim.addHero('SWARM', 'p1', CH_DRONE);
  const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
  h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
  [foe.x, foe.z] = atBearing(h, Math.PI, 120);   // 正背後開火
  foe.y = 0;

  sim._damage(h, 20, foe, 0);
  t('背後挨打 ⇒ 伺服器記下來源方位', h._alert != null
    && near(h._alert.x, foe.x, 1e-6) && near(h._alert.z, foe.z, 1e-6));

  const dt = GAME.TICK_MS / 1000;
  const ry0 = h.ry;
  brain._alertLook(h); brain._turn(h, dt);
  t('一拍轉不完(角速度上限 = 跟真人一樣不能瞬間回頭)',
    Math.abs(wrapPi(h.ry - ry0)) <= VIEW_LOCK.W * dt + 1e-9 && Math.abs(wrapPi(h.ry - ry0)) > 1e-6,
    `${Math.abs(wrapPi(h.ry - ry0)).toFixed(3)} rad`);
  t('轉的方向是朝攻擊者(偏離角變小)',
    Math.abs(brain._bearing(h, foe.x, foe.z)) < Math.abs(Math.PI) - 1e-6);

  let n = 1;
  for (; n < 200 && h._alert; n++) { brain._alertLook(h); brain._turn(h, dt); }
  t(`轉到看得見就收手(${n} 拍後警戒自動清空)`, h._alert == null && n < 200);
  t('收手時攻擊者已落在視野錐內', Math.abs(brain._bearing(h, foe.x, foe.z)) <= botFovHalf(h.kind) + 1e-9);
  t('轉頭所需時間 ≈ 180° ÷ 角速度上限(不是瞬間、也不是永遠轉不完)',
    n * dt > 0.2 && n * dt < 3, `${(n * dt).toFixed(2)}s`);
  t('轉過去之後就鎖得到剛剛打我的人', (() => { sim._tickN++; return brain._acquire(h) === foe; })());

  sim._damage(h, 20, null, 0);
  t('環境傷害(沼澤/火場/地雷)沒有方位 ⇒ 不觸發警戒', h._alert == null);

  const human = sim.addHero('STEEL', 'p2', CH_ROBOT);
  sim._damage(human, 20, foe, 0);
  t('真人英雄不記警戒(視角是玩家自己的;純 bot 專用欄位)', human._alert == null);

  const dsim = blank();
  const dh = dsim.addHero('STEEL', 'b2', CH_DRONE);
  const wing = dsim.squads.get('b2').bodies.find((b) => b !== dh);
  const dfoe = dsim.addHero('SWARM', 'p3', CH_DRONE);
  dfoe.x = dh.x; dfoe.z = dh.z - 100;
  if (wing) dsim._damage(wing, 20, dfoe, 0);
  t('僚機挨打 ⇒ 主視野機一樣警戒(整組小隊在同一個位置)', !wing || dh._alert != null);

  const stale = blank();
  const sh = stale.addHero('STEEL', 'b3', CH_ROBOT);
  const sbrain = new BotBrain(stale, 'b3', 'STEEL', 0, 'high');
  sh.x = 0; sh.z = 0; sh.ry = 0;
  sh._alert = { x: 0, z: -100, t: 0 };
  stale.t = BOT_VIEW.ALERT_S + 0.1;
  sbrain._alertLook(sh);
  t('警戒逾時即放掉(不會永遠盯著一個早就跑掉的方向)', sh._alert == null);
}

// ---------------------------------------------------------------------------------
sec('Ⅴ 移動不穿牆:與客戶端 `_collide` 同一份幾何(真 BattleSim)');
// ---------------------------------------------------------------------------------
{
  // 一堵橫牆:中心 (0,30)、沿 x 半長 30、厚 3、高 20、ry=0(setWorld 會把 ry 轉成 cos/−sin)
  const WALL = [0, 30, Math.hypot(30, 3), 20, 30, 3, 0];
  const world = () => ({ occ: [WALL], cor: [], slabs: [] });

  const free = blank();
  const fh = free.addHero('STEEL', 'b1', CH_ROBOT);
  fh.x = 0; fh.z = 0; fh.y = 0;
  t('無障礙:位移逐位元不變(碰撞不影響原本的走位)', (() => {
    const [x, z] = free.solidResolve(fh, 0, 0, 4, 7, false);
    return x === 4 && z === 7;
  })());

  const sim = blank(world());
  t('稽核牆真的進了 worldOcc(有向盒 8 欄)', sim.worldOcc.length === 1 && sim.worldOcc[0].length === 8,
    `${sim.worldOcc.length} 根 / ${sim.worldOcc[0]?.length} 欄`);
  const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
  h.x = 0; h.z = 0; h.y = 0;
  const myR = selfCollider(hitH(h), false).r;
  {
    const [, z] = sim.solidResolve(h, 0, 0, 0, 60, false);
    t('正面撞有向盒:停在牆的近側面之前(不穿過去)', z < 30 - 3 - myR + 1e-9 && z > 10, `z=${z.toFixed(2)}`);
  }
  {
    const [, z] = sim.solidResolve(h, 0, 0, 0, 400, false);   // 單幀橫越整堵牆(擊退/掉幀)
    t('單幀高速橫越:掃掠夾在進入面(只做 push-out 會直接穿到另一側)',
      z < 30 - 3 - myR + 1e-9, `z=${z.toFixed(2)}`);
  }
  {
    // 終點**剛好**落在通過障礙中心的平分面(fwd === 0):push-out 的最小穿透軸在正中央等機率
    // 翻向另一側 ⇒ 這一格 MUST 由掃掠夾住,否則就是一步穿牆(2026-08-02 實測復現)。
    const [, z] = sim.solidResolve(h, 0, 24, 0, 30, false);
    t('終點剛好落在盒中心平分面:仍夾在進入面(不得被 push-out 推出另一側)',
      z < 30 - 3 - myR + 1e-9, `z=${z.toFixed(2)}`);
  }
  {
    const [x, z] = sim.solidResolve(h, 0, 0, 200, 0, false);  // 沿牆走(側向不受阻)
    t('沿牆橫移不被誤擋', near(x, 200) && near(z, 0), `(${x},${z})`);
  }
  {
    const [, z] = sim.solidResolve(h, 0, 60, 0, 0, false);    // 從另一側往回走
    t('反方向同樣擋(碰撞不分來向)', z > 30 + 3 + myR - 1e-9, `z=${z.toFixed(2)}`);
  }
  {
    const d = sim.addHero('SWARM', 'b2', CH_DRONE);
    d.x = 0; d.z = 0; d.y = 40;                              // 巡航高度遠高於 20m 的牆
    const [, z] = sim.solidResolve(d, 0, 0, 0, 60, true);
    t('飛得比障礙高就飛得過去(無人機飛越屋頂,與客戶端同語意)', near(z, 60), `z=${z}`);
    d.y = 4;                                                  // 貼地飛
    const [, z2] = sim.solidResolve(d, 0, 0, 0, 60, true);
    t('貼著地面飛就撞得到', z2 < 30, `z=${z2.toFixed(2)}`);
  }

  // 圓柱(神木/巨岩/橋墩:上傳格式只有 4 欄)
  const cyl = blank({ occ: [[0, 30, 8, 20]], cor: [], slabs: [] });
  const ch2 = cyl.addHero('STEEL', 'b1', CH_ROBOT);
  ch2.x = 0; ch2.z = 0; ch2.y = 0;
  {
    const [, z] = cyl.solidResolve(ch2, 0, 0, 0, 60, false);
    t('圓柱障礙同樣擋', z < 30 - 8 - myR + 1e-9 && z > 5, `z=${z.toFixed(2)}`);
    const [, z2] = cyl.solidResolve(ch2, 0, 10, 0, 30, false);   // 終點剛好落在圓心
    t('圓柱:終點剛好落在圓心平分面也夾在進入面', z2 < 30 - 8 - myR + 1e-9 && z2 > 5, `z=${z2.toFixed(2)}`);
  }

  // 實體來源:塔(COLLIDE_KINDS)/ 阻擋型障礙(HAZARDS.block)—— 未上傳世界也 MUST 生效
  const ent = blank();
  const eh = ent.addHero('STEEL', 'b1', CH_ROBOT);
  eh.x = 0; eh.z = 0; eh.y = 0;
  ent._add({ kind: 'tower', side: 'SWARM', x: 0, z: 30, y: 0, hp: 9999, maxHp: 9999 });
  {
    const [, z] = ent.solidResolve(eh, 0, 0, 0, 60, false);
    t('砲塔擋路(舊制 bot 直接穿過塔身)', z < 30 - hitR({ kind: 'tower' }) - myR + 1e-9, `z=${z.toFixed(2)}`);
  }
  {
    // broad-phase 若只比中心點,半徑最大的量體(主堡 20m)在一小步位移下會整個被篩掉
    const big = blank();
    const bh = big.addHero('STEEL', 'b1', CH_ROBOT);
    bh.x = 0; bh.z = 0; bh.y = 0;
    big._add({ kind: 'base', side: 'SWARM', x: 0, z: 24, y: 0, hp: 99999, maxHp: 99999 });
    const [, z] = big.solidResolve(bh, 0, 0, 0, 3, false);   // 一小步(粗篩範圍遠小於主堡半徑)
    t('大量體(主堡 r=20)即使只走一小步也擋得到(broad-phase 帶上目標自身半徑)',
      z < 24 - hitR({ kind: 'base', side: 'SWARM' }) - myR + 1e-9, `z=${z.toFixed(2)}`);
  }
  const haz = blank();
  const hh = haz.addHero('STEEL', 'b1', CH_ROBOT);
  hh.x = 0; hh.z = 0; hh.y = 0;
  haz._add({ kind: 'boulder', neutral: true, side: null, x: 0, z: 30, y: 0, sc: 1, hp: 420, maxHp: 420 });
  {
    const [, z] = haz.solidResolve(hh, 0, 0, 0, 60, false);
    t('阻擋型障礙(巨石)擋路,且未上傳世界(headless)一樣生效', z < 22 + 1e-9 && z > 5, `z=${z.toFixed(2)}`);
  }
  t('中立非阻擋型障礙(坑洞/淹水區)刻意不擋', (() => {
    const s = blank();
    const x = s.addHero('STEEL', 'b1', CH_ROBOT);
    x.x = 0; x.z = 0; x.y = 0;
    s._add({ kind: 'pothole', neutral: true, side: null, x: 0, z: 30, y: 0, sc: 1 });
    const [, z] = s.solidResolve(x, 0, 0, 0, 60, false);
    return near(z, 60);
  })());
}

// ---------------------------------------------------------------------------------
sec('Ⅵ 撞牆繞行:碰撞上線不得讓 bot 原地卡死');
// ---------------------------------------------------------------------------------
{
  const sim = blank({ occ: [[0, 30, Math.hypot(30, 3), 20, 30, 3, 0]], cor: [], slabs: [] });
  const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
  const brain = new BotBrain(sim, 'b1', 'STEEL', 0, 'high');
  h.x = 0; h.z = 0; h.y = 0; h.ry = 0;
  const dt = GAME.TICK_MS / 1000;
  const side0 = brain._skirtSide;
  let ticks = 0, hit = 0;
  while (ticks < 60 && brain._skirtUntil === 0) {
    sim.t += dt;
    const f = brain._move(h, h.x, h.z + 6);   // 一路往牆裡推
    if (f < STUCK_F) hit++;
    brain._stuck(f, dt);
    ticks++;
  }
  t('推到牆前就真的推不動了(掃掠 + push-out 生效)', hit > 0, `${hit} 拍推不動`);
  t(`連續撞牆 ${(hit * dt).toFixed(2)}s 後啟動繞行`, brain._skirtUntil > 0 && hit * dt < 2, `${ticks} 拍`);
  t('繞行側左右輪替(同一側繞不出去就換邊)', brain._skirtSide === -side0);
  t('繞行把目標點往側向挪(垂直於前進方向,前進分量不變)', (() => {
    const [gx, gz] = brain._skirt(h, h.x, h.z + 10);
    return Math.abs(gx - h.x) > 1 && near(gz, h.z + 10, 1e-9);
  })());
  t('沒卡住就不繞行(目標點原樣放行)', (() => {
    brain._skirtUntil = 0;
    const [gx, gz] = brain._skirt(h, 5, 9);
    return near(gx, 5) && near(gz, 9);
  })());
  t('推得動就把撞牆計時歸零', (() => { brain._stuckT = 99; brain._stuck(1, dt); return brain._stuckT === 0; })());
}

// ---------------------------------------------------------------------------------
sec('Ⅶ 攻擊不穿牆:bot 的每一條開火路徑都驗 LOS');
// ---------------------------------------------------------------------------------
{
  t('`botFire`(輕/重直擊)驗 `_losBlocked`', /this\._losBlocked\(/.test(strip(grabMethod(simSrc, 'botFire'))));
  t('`heroPlasma`(扇形,伺服器自己選目標)逐目標驗 LOS + 稜線',
    /this\._losBlocked\(/.test(strip(grabMethod(simSrc, 'heroPlasma')))
    && /this\._ridgeBlocked\(/.test(strip(grabMethod(simSrc, 'heroPlasma'))));
  t('`_lanceHits`(直線貫穿;含 botFire 自建的未截斷射線)同樣兩道都驗',
    /this\._losBlocked\(/.test(strip(grabMethod(simSrc, '_lanceHits')))
    && /this\._ridgeBlocked\(/.test(strip(grabMethod(simSrc, '_lanceHits'))));
  t('`_engage` 的火箭/飛彈分支發射前先驗 LOS(bot 沒有客戶端彈道擋牆)',
    /_losBlocked\(/.test(strip(grabMethod(botsSrc, '_engage'))));

  const WALL = [0, 30, Math.hypot(30, 3), 20, 30, 3, 0];
  const shoot = (withWall) => {
    const sim = blank(withWall ? { occ: [WALL], cor: [], slabs: [] } : null);
    const h = sim.addHero('STEEL', 'b1', CH_ROBOT);
    h.x = 0; h.z = 0; h.y = 0;
    const tgt = sim._add({ kind: 'soldier', side: 'SWARM', lane: 0, x: 0, z: 60, y: 0, hp: 99999, maxHp: 99999 });
    sim.t += 10;
    const wp = heroWeapon(h.ch, 'light', h.abil.light, true);
    h.ammo.light = wp.mag; h.reloadUntil.light = 0; h.fireAt.light = -99;
    return sim.botFire('b1', tgt.id, 'light');
  };
  t('牆後的目標:bot 一發都打不掉血(對照組:沒牆時打得到)', shoot(true) === false && shoot(false) === true);
}

console.log(`\n${fail ? '❌' : '✅'} 電腦玩家視野 / 碰撞稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
