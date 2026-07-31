// ============ 飛行動力學(爬升動力 + 受擊掉高)+ 機種絕招載具 HP 校準 稽核 ============
// 用途:改 `data.js` 的 `FLIGHT`/`airSinkM`/`liftMax`/`liftRegen`/`liftDrainPS`/`HYPER`/`towerDps`/
//      `kamiHp`/`hyperHp`/`decoyHp`/`kamiSide`,或 `game.js` 的 `_stepLift`/`_airSinkHit`/
//      `_updatePlayer` 飛行段/`_launchHyper`/`_tryFire` 之後跑。跑法:`node tools/audit_flight_power.mjs`
//
// 三條規則共用一支稽核,因為破法都一樣**無聲**:
//   ①**機種絕招的載具 HP 一律由「一座砲塔打幾秒」反解**(2026-08-01 使用者定調):
//      飽和攻擊 4 架、一座砲塔剛好擊落 2 架;極音速飛彈剛好打不爆;集束轟炸機剛好投得完 5+1 顆。
//      無聲寫壞法:任一個 HP 手寫(改砲塔數值就整組漂掉)、載具帶 armor/護盾(EHP 隨主機角色浮動,
//      「剛好」變成看人品)、巨砲時代的彈夾旁路殘留在 _gateFire/_tryFire(重武器又能免費開火)。
//      伺服器那半由 `npm test`(sim 直測)把關;這裡驗**推導與客戶端消費端**。
//   ②**受擊掉高**:掉的公尺數 ∝ 傷害,校準錨 = 打完「平均護盾+裝甲」掉 SINK_TOWERS 個砲塔高。
//      無聲寫壞法:在 game.js 手寫公尺數/係數(校準錨一改就分家)、把掉幅做成「速度」
//      (同一份傷害分幾發打完就掉不一樣多)、忘了在陣亡/換座機/觸地清帳(舊帳把新機體往下拉)。
//   ③**爬升動力**:只有往上飛消耗,滿動力全速爬升撐 DRAIN_S 秒,上限/回速正比於電力。
//      無聲寫壞法:耗速手寫(改 DRAIN_S 無效)、動力見底改「減速」而不是「爬不上去」
//      (玩家分不出來,且會與坡度阻擋 slopeBlocked 的語意分家)、把水平分量一起砍掉。
//
// 手法比照 `audit_cc_flash.mjs`:公式直接 import(data.js 是純模組),game.js 的方法**抽執行原文**
// 評估(three 走 CDN,Node 端 import 不了整支;抄一份公式到稽核裡就永遠會通過)。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLIGHT, airSinkM, liftMax, liftRegen, liftDrainPS,
  SQUAD, TARGET_H, UNITS, CHARACTERS, ECON, chargeF,
  HYPER, DECOY, LANCE, lanceR, towerDps, towerSurviveHp, towerKillHp,
  kamiHp, kamiExposureS, kamiSide, hyperHp, hyperFlightS, hyperApex, hyperRange, decoyHp, decoyExposureS,
  GAME,
} from '../public/js/data.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'public', 'js', 'game.js'), 'utf8');
const dataSrc = readFileSync(join(ROOT, 'public', 'js', 'data.js'), 'utf8');
const simSrc = readFileSync(join(ROOT, 'server', 'sim.js'), 'utf8');
const mainSrc = readFileSync(join(ROOT, 'public', 'js', 'main.js'), 'utf8');
const css = readFileSync(join(ROOT, 'public', 'css', 'style.css'), 'utf8');
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');

/** 抽出 class 方法的原文(含大括號區塊);與 audit_cc_flash.mjs 同一手法 */
const grab = (name, s = src) => {
  const i = s.indexOf(`\n  ${name}(`);
  if (i < 0) throw new Error(`找不到 ${name}`);
  let d = 0, started = false, j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return s.slice(i, j);
};

/** 「全檔只有 N 處」的計數 MUST 只數執行原文 —— 註解與 import 清單也提得到同一個名字 */
const strip = (s, cut) => {
  const noCom = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  return cut ? noCom.split(cut).slice(1).join(cut) : noCom;
};
const code = strip(src, "} from './data.js';");
const simCode = strip(simSrc, "} from '../public/js/data.js';");

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 機種絕招載具 HP:一律由「一座砲塔打幾秒」反解(推導不手寫)');
// ---------------------------------------------------------------------------
{
  t('towerDps() = 砲塔 dmg × rate(砲塔無 wid ⇒ pen 0,不吃 armorMul)',
    near(towerDps(), UNITS.tower.dmg * UNITS.tower.rate));
  t('towerDps 原文由 UNITS.tower 推導,MUST NOT 手寫',
    /export const towerDps = \(\) => UNITS\.tower\.dmg \* UNITS\.tower\.rate;/.test(dataSrc));
  t('towerSurviveHp(sec) 打完剩 ≥1 滴(「剛好打不爆」)',
    towerSurviveHp(3) > towerDps() * 3 && towerSurviveHp(3) - towerDps() * 3 <= 1);
  t('towerKillHp(sec) = 這段時間的傷害量(「剛好被打爆」)',
    Math.abs(towerKillHp(3) - towerDps() * 3) <= 0.5);

  // —— 飽和攻擊:4 架、一座砲塔剛好擊落 SHOT_DOWN 架 ——
  t('KAMI.N = 4 且 SHOT_DOWN = 2 ⇒ 成功自爆 2 架(使用者定調)',
    SQUAD.KAMI.N === 4 && SQUAD.KAMI.SHOT_DOWN === 2);
  t('舊 KAMI.HP_F(主機血量比例)已退場(HP 改由砲塔火力反解)',
    SQUAD.KAMI.HP_F === undefined);
  t('kamiExposureS = 砲塔射程 ÷ 撲擊速度(推導不手寫)',
    near(kamiExposureS(), UNITS.tower.range / (UNITS.drone.speed * SQUAD.KAMI.SPEED_MUL)));
  t('kamiHp = towerKillHp(曝險窗 ÷ SHOT_DOWN)',
    kamiHp() === towerKillHp(kamiExposureS() / SQUAD.KAMI.SHOT_DOWN));
  t('kamiHp 原文走 towerKillHp,MUST NOT 手寫',
    /export const kamiHp = \(\) => towerKillHp\(/.test(dataSrc));
  t('「攻擊力減半、數量加倍」= 同一件事:每架 = 預算 ÷ N(整份預算不變)',
    /export const kamiBlast = \(abil\) => \(\{ \.\.\.WEAPONS\.bomb, dmg: Math\.round\(specialBudget\(abil\) \/ SQUAD\.KAMI\.N\) \}\);/.test(dataSrc));
  {
    const ss = Array.from({ length: SQUAD.KAMI.N }, (_, i) => kamiSide(i));
    t('kamiSide 均勻散開、對稱、涵蓋 [−1, 1]',
      ss[0] === -1 && ss[ss.length - 1] === 1 && near(ss.reduce((a2, b2) => a2 + b2, 0), 0), ss.join(', '));
    t('兩端同吃 kamiSide(伺服器生成側偏移 + 客戶端貼身站位),MUST NOT 復辟 `const s = i === 0 ? -1 : 1`',
      /const s = kamiSide\(i\);/.test(simCode) && /s: kamiSide\(i\)/.test(code)
      && !/const s = i === 0 \? -1 : 1/.test(simCode) && !/const s = i === 0 \? -1 : 1/.test(code));
  }

  // —— 極音速飛彈:撐得住最長一次飛行 ——
  t('hyperApex / hyperRange / hyperFlightS 全由已縮好的量推導(MUST NOT 手寫遊戲公尺)',
    /export const hyperApex = \(\) => GAME\.GUN_CEIL_M \* HYPER\.APEX_F;/.test(dataSrc)
    && /export const hyperRange = \(\) => UNITS\.tower\.range \* HYPER\.RANGE_F;/.test(dataSrc)
    && /hyperApex\(\) \/ HYPER\.CLIMB_SPD \+ Math\.hypot\(hyperRange\(\), hyperApex\(\)\) \/ hyperDiveSpd\(\)/.test(dataSrc));
  t('爬升頂點高過直射鎖定天花板(是「高空」不是抬個頭)', hyperApex() > GAME.GUN_CEIL_M);
  t('接戰距離大於砲塔射程(機甲的攻塔手段)', hyperRange() > UNITS.tower.range);
  t('俯衝遠快於爬升(「極音速」那一段幾乎攔不住)', HYPER.DIVE_F > 2);
  t('hyperHp = towerSurviveHp(最長飛行時間)⇒ 一座砲塔剛好打不爆',
    hyperHp() === towerSurviveHp(hyperFlightS()) && hyperHp() > towerDps() * hyperFlightS());
  t('「剛好」不是「綽綽有餘」:餘裕 < 一發塔砲', hyperHp() - towerDps() * hyperFlightS() < towerDps());
  t('單一戰鬥部 = 整份絕招預算(一發打完,離散化誤差為零)',
    /export const hyperBlast = \(abil\) => \(\{\s*\n\s*dmg: Math\.round\(specialBudget\(abil\)\),/.test(dataSrc));

  // —— 集束炸彈:撐到投完 DROP_N 顆 ——
  t('BOMB_MAX = 6 且 DROP_N + 墜毀補投 1 顆 = BOMB_MAX(使用者定調的 5+1)',
    DECOY.BOMB_MAX === 6 && DECOY.DROP_N + 1 === DECOY.BOMB_MAX);
  t('舊 DECOY.HP_F(主機血量比例)已退場', DECOY.HP_F === undefined);
  t('decoyExposureS = 接近時間 + (DROP_N − 0.5) 個投彈間隔(半個間隔的餘量也是推導,不手寫秒數)',
    near(decoyExposureS(),
      Math.max(0, UNITS.tower.range - DECOY.BOMB_R) / DECOY.SPEED + (DECOY.DROP_N - 0.5) * DECOY.BOMB_GAP));
  // 行為直測:曝險窗內剛好投得出第 DROP_N 顆、且撐不到第 DROP_N+1 顆
  {
    const live = decoyHp() / towerDps();
    const approach = Math.max(0, UNITS.tower.range - DECOY.BOMB_R) / DECOY.SPEED;
    const dropped = 1 + Math.floor((live - approach) / DECOY.BOMB_GAP + 1e-9);
    t('一座砲塔火力下剛好投出 DROP_N 顆 + 墜毀補投 1 顆 = BOMB_MAX',
      dropped === DECOY.DROP_N && dropped + 1 === DECOY.BOMB_MAX, `實得 ${dropped} + 1`);
  }
  // 行為直測:一座砲塔在曝險窗內剛好擊落 SHOT_DOWN 架
  {
    const downed = Math.floor(kamiExposureS() / (kamiHp() / towerDps()) + 1e-9);
    t('一座砲塔在曝險窗內剛好擊落 SHOT_DOWN 架、其餘成功自爆',
      downed === SQUAD.KAMI.SHOT_DOWN, `實得 ${downed} 架`);
  }
  t('decoyHp = towerKillHp(曝險窗)', decoyHp() === towerKillHp(decoyExposureS()));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ 巨砲整組退場:重武器射擊路徑上不得留任何免彈夾/免射速閘旁路');
// ---------------------------------------------------------------------------
{
  t('data.js MUST NOT 再匯出 BARRAGE / barrageShots / barrageDur / barrageDmgF',
    !/export const (BARRAGE|barrageShots|barrageDur|barrageDmgF)\b/.test(dataSrc));
  t('LANCE MUST NOT 再有 BARRAGE_F(貫穿粗細無情境倍率)',
    LANCE.BARRAGE_F === undefined && lanceR({ type: 'beam' }, true) === LANCE.R.beam);
  t('sim.js 全檔已無 barrage 殘骸(_gateFire / _barragingDmg / heroBarrage)',
    !/barrag/i.test(simCode));
  t('game.js 全檔已無 barrage 殘骸(_launchBarrage / _barragingShot / _isBarraging)',
    !/barrag/i.test(code));
  const gate = grab('_gateFire', simSrc);
  t('sim._gateFire 沒有任何「先 return true」的旁路(彈夾/電力/射速閘一律照走)',
    !/return true;[\s\S]{0,400}?reloadUntil\[id\] \|\| 0\) > now/.test(gate));
  const fire = grab('_tryFire');
  t('_tryFire:射速閘 / 裝填中 / 空夾三道閘門一律無條件生效',
    /if \(now - \(this\.lastFireAt\[id\] \|\| 0\) < 1 \/ def\.rate\) return;/.test(fire)
    && /if \(st\.reloadEnd > 0\) return;/.test(fire)
    && /if \(st\.ammo <= 0\) \{ this\._startReload/.test(fire));
  t('_tryFire:一律扣彈夾 + 扣電力(無免除分支)',
    /st\.ammo--;\s*\n\s*if \(mpc > 0\) this\.mp = Math\.max\(0, this\.mp - mpc\);/.test(fire));
  t('_tryFire:未按開火鍵就不擊發(舊巨砲的窗內自動擊發已移除)',
    /if \(!this\.firing\) return;/.test(fire));
  // 新招的客戶端入口:純「送請求 + 樂觀 CD」,MUST NOT 在客戶端算任何傷害/爆風(A1)
  const lh = grab('_launchHyper');
  t('game._launchHyper 只送 { t: \'hyper\' } + 樂觀本地 CD(彈道與傷害全在伺服器)',
    /this\.net\.send\(\{ t: 'hyper' \}\);/.test(lh) && !/_blast|dmg/.test(lh));
  t('game._launchHyper 有本地 CD 時戳(不被在途舊快照的 hcd=0 洗掉)',
    /_hyperCdUntil/.test(lh) && /Math\.max\(this\.hyperCd \|\| 0, \(this\._hyperCdUntil \|\| 0\) - now\)/.test(lh));
  t('機種派發縫仍只有一處(_fireHoldAbility),機甲那支改指 _launchHyper',
    /else this\._launchHyper\(\);/.test(code) && count(code, '_launchHyper(') === 2);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅲ 受擊掉高:推導(校準錨 = 打完平均護盾+裝甲 → SINK_TOWERS 個砲塔高)');
// ---------------------------------------------------------------------------
{
  t(`校準錨:掉光平均總血量(${SQUAD.DRONE_AVG_HP.toFixed(0)})= ${FLIGHT.SINK_TOWERS} 個砲塔高`,
    near(airSinkM(SQUAD.DRONE_AVG_HP), FLIGHT.SINK_TOWERS * TARGET_H.tower, 1e-6),
    `${airSinkM(SQUAD.DRONE_AVG_HP).toFixed(2)}m vs ${FLIGHT.SINK_TOWERS * TARGET_H.tower}m`);
  t('掉幅 ∝ 傷害(線性;半份傷害掉一半)', near(airSinkM(200), airSinkM(100) * 2, 1e-9));
  t('零/負傷害不掉高(寧缺勿錯)', airSinkM(0) === 0 && airSinkM(-50) === 0 && airSinkM(undefined) === 0);
  t('砲塔高取 TARGET_H.tower、分母取 SQUAD.DRONE_AVG_HP(推導不手寫)',
    /export const airSinkM[\s\S]{0,220}?SQUAD\.DRONE_AVG_HP[\s\S]{0,120}?TARGET_H\.tower/.test(dataSrc));
  t('SINK_S 只是節奏旋鈕:MUST NOT 出現在掉幅公式裡',
    !/export const airSinkM[\s\S]{0,220}?SINK_S/.test(dataSrc));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅳ 爬升動力:推導(滿動力全速爬升撐 DRAIN_S 秒;上限/回速正比於電力)');
// ---------------------------------------------------------------------------
{
  for (const mp of [60, 100, 145]) {
    t(`電力上限 ${mp}:滿動力全速爬升 = DRAIN_S(${FLIGHT.DRAIN_S}s)`,
      near(liftMax(mp) / liftDrainPS(mp), FLIGHT.DRAIN_S, 1e-9),
      `${(liftMax(mp) / liftDrainPS(mp)).toFixed(3)}s`);
  }
  t('動力上限正比於電力上限', near(liftMax(200), liftMax(100) * 2) && liftMax(0) === 0);
  t('耗速正比於電力上限(大電力 = 大條也耗得快 ⇒ 秒數不變)',
    near(liftDrainPS(200), liftDrainPS(100) * 2));
  t('liftDrainPS 由 liftMax / DRAIN_S 推導(MUST NOT 手寫每秒耗量)',
    /export const liftDrainPS[\s\S]{0,140}?liftMax\([\s\S]{0,40}?FLIGHT\.DRAIN_S/.test(dataSrc));
  t('回速正比於電力回速(mpRegen)', near(liftRegen(8, 3), liftRegen(4, 3) * 2));
  t('回速隨「充能」軌單調成長(充能軌 = 飛行續航軌)', (() => {
    let prev = -1;
    for (let l = 0; l <= ECON.UPGRADES.ch.max; l++) {
      const v = liftRegen(UNITS.drone.mpRegen, l);
      if (v <= prev) return false;
      prev = v;
    }
    return true;
  })(), `${liftRegen(UNITS.drone.mpRegen, 0)} → ${liftRegen(UNITS.drone.mpRegen, ECON.UPGRADES.ch.max)}`);
  t('回速吃 chargeF(與電力回復同一條升級軌)',
    /export const liftRegen[\s\S]{0,160}?chargeF\(/.test(dataSrc));
  t('回充比耗盡慢(爬升是有代價的機動)',
    liftMax(UNITS.drone.mp) / liftRegen(UNITS.drone.mpRegen, ECON.UPGRADES.ch.max) > FLIGHT.DRAIN_S,
    `${(liftMax(UNITS.drone.mp) / liftRegen(UNITS.drone.mpRegen, ECON.UPGRADES.ch.max)).toFixed(1)}s 回滿`);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅴ 消費端單一縫(game.js:飛行段唯一入口 + 清帳點齊全 + HUD)');
// ---------------------------------------------------------------------------
{
  t('liftDrainPS / liftRegen 的唯一消費端 = _stepLift',
    count(code, 'liftDrainPS(') === 1 && count(code, 'liftRegen(') === 1
    && /liftDrainPS\(/.test(grab('_stepLift')) && /liftRegen\(/.test(grab('_stepLift')));
  t('airSinkM 在客戶端的唯一消費端 = _airSinkHit',
    count(code, 'airSinkM(') === 1 && /airSinkM\(/.test(grab('_airSinkHit')));
  // bot 沒有客戶端 ⇒ 伺服器補同一條規則(同一支 airSinkM);兩條扣血路徑(護盾全擋的早退 + 一般路徑)
  // MUST 都掛到,漏掉早退那條 = 「還有護盾時打不掉高度」。
  t('airSinkM 在伺服器的唯一消費端 = _botAirSink(bot 那一半)',
    count(simCode, 'airSinkM(') === 1 && /airSinkM\(/.test(grab('_botAirSink', simSrc)));
  t('_damage 的兩條扣血路徑都呼叫 _botAirSink(含護盾全擋的早退)',
    count(strip(grab('_damage', simSrc)), 'this._botAirSink(') === 2);
  t('_botAirSink 只作用於 bot 的飛行機體(真人由客戶端物理結算,套兩次會打架)',
    /isBotId\(t\.pid\)/.test(grab('_botAirSink', simSrc))
    && /kind === 'drone'/.test(grab('_botAirSink', simSrc)));
  t('_stepLift 只在飛行段呼叫一次,且排在速度積分之前',
    count(code, 'this._stepLift(') === 1
    && /this\._stepLift\(dt, now, target, u\);[\s\S]{0,200}?this\.vel\.y \+= \(target\.y - this\.vel\.y\)/.test(code));
  t('掉高只作用於高度(pos.y),且在飛行段消化待落帳',
    /if \(this\._airSink > 0\) \{[\s\S]{0,220}?this\.pos\.y -= d;[\s\S]{0,80}?this\._airSink -= d;/.test(code));
  t('掉高入帳掛在「快照偵測到掉血」那一處(與受傷暈影同一個縫)',
    count(code, 'this._airSinkHit(') === 1
    && /this\._lastHurtAt = performance\.now\(\) \/ 1000;\s*[^\n]*\n\s*this\._airSinkHit\(this\._prevVital - vital\)/.test(code));
  t('待落帳在陣亡 / 重生 / 換座機 / 觸地地面型各清一次(舊帳 MUST NOT 跟著新機體)',
    count(code, '_airSink = 0') >= 5, `${count(code, '_airSink = 0')} 處(含建構子)`);
  t('game.js MUST NOT 手寫掉高係數(砲塔高 / 平均血量只准住 data.js)',
    !/SINK_TOWERS/.test(code) && !/DRONE_AVG_HP/.test(code));
  t('HUD:飛行機體才送 lift(地面機甲 null ⇒ 整條收起)',
    /lift: this\._flying\(\) \? \{ v:[\s\S]{0,120}?\} : null,/.test(code));
  t('main.js 依 lift 有無顯隱動力條、低動力才轉警示色(唯一渲染來源)',
    /\$\('liftBox'\)\.classList\.toggle\('hidden', !lf\)/.test(mainSrc)
    && /classList\.toggle\('low', p2 <= FLIGHT\.LOW_F\)/.test(mainSrc));
  t('index.html 有 #liftBox / #liftBar / #liftText',
    /id="liftBox"/.test(html) && /id="liftBar"/.test(html) && /id="liftText"/.test(html));
  t('.liftbar 與既有 hp/sp/mp 條同族(同一版型,不新增控件)',
    /\.liftbar \{/.test(css) && /\.liftbar-fill \{/.test(css)
    && /body\.touch-ui \.hpbar[^{]*\.liftbar \{/.test(css));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅵ 行為直測(執行 game.js 原文:5 秒耗盡 / 見底爬不上去 / 掉幅只由傷害決定)');
// ---------------------------------------------------------------------------
{
  const proto = new Function('FLIGHT', 'airSinkM', 'liftMax', 'liftRegen', 'liftDrainPS', 'UNITS',
    `return ({ ${grab('_stepLift')}, ${grab('_airSinkHit')}, ${grab('_liftMax')} });`)(
    FLIGHT, airSinkM, liftMax, liftRegen, liftDrainPS, UNITS);
  const u = { vspeed: UNITS.drone.vspeed, mpRegen: UNITS.drone.mpRegen };
  const mk = (over = {}) => Object.assign(Object.create(null), proto, {
    maxMp: UNITS.drone.mp, heroKind: 'drone', upg: { ch: 0 }, hud: { feed: () => {} },
    lift: null, _airSink: 0, _airSinkV: 0, _flying: () => true, ...over,
  });

  // ① 全速爬升:滿動力恰好撐 DRAIN_S 秒
  {
    const c = mk();
    const dt = 1 / 60;
    let s = 0;
    for (let i = 0; i < 60 * 30; i++) {
      const target = { x: 0, y: u.vspeed, z: 0 };
      c._stepLift(dt, i * dt, target, u);
      if (target.y <= 0) break;
      s += dt;
    }
    t(`全速爬升 ${FLIGHT.DRAIN_S}s 耗盡滿動力(實測 ${s.toFixed(2)}s)`, Math.abs(s - FLIGHT.DRAIN_S) <= 2 * dt);
  }
  // ② 半速爬升:撐兩倍時間(耗速 ∝ 爬升率)
  {
    const c = mk();
    const dt = 1 / 60;
    let s = 0;
    for (let i = 0; i < 60 * 60; i++) {
      const target = { x: 0, y: u.vspeed * 0.5, z: 0 };
      c._stepLift(dt, i * dt, target, u);
      if (target.y <= 0) break;
      s += dt;
    }
    t(`半速爬升撐兩倍時間(實測 ${s.toFixed(2)}s ≈ ${FLIGHT.DRAIN_S * 2}s)`,
      Math.abs(s - FLIGHT.DRAIN_S * 2) <= 4 * dt);
  }
  // ③ 動力見底:上升分量歸零(爬不上去),水平與下降完全不受影響
  {
    const c = mk({ lift: 0 });
    const up = { x: 7, y: u.vspeed, z: -3 };
    c._stepLift(0.1, 1, up, u);
    t('動力見底:上升分量歸零 = 爬不上去(不是變慢)', up.y === 0);
    t('動力見底:水平分量原封不動(只鎖垂直)', up.x === 7 && up.z === -3);
    const down = { x: 0, y: -u.vspeed, z: 0 };
    const c2 = mk({ lift: 0 });
    c2._stepLift(0.1, 1, down, u);
    t('動力見底:下降不受影響', down.y === -u.vspeed);
    t('不爬升即回充(下降/懸停都回)', c2.lift > 0);
  }
  // ④ 回充上限與比例
  {
    const c = mk({ lift: 0, upg: { ch: ECON.UPGRADES.ch.max } });
    const hover = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60 * 60; i++) c._stepLift(1 / 60, i / 60, hover, u);
    t('回充夾在上限(不會超充)', near(c.lift, c._liftMax(), 1e-9), `${c.lift}`);
    const lo = mk({ lift: 0, upg: { ch: 0 } });
    const hi = mk({ lift: 0, upg: { ch: ECON.UPGRADES.ch.max } });
    for (let i = 0; i < 60; i++) { lo._stepLift(1 / 60, i / 60, { x: 0, y: 0, z: 0 }, u); hi._stepLift(1 / 60, i / 60, { x: 0, y: 0, z: 0 }, u); }
    t('充能軌越高回得越快(回復正比於電力回速)', hi.lift > lo.lift * 1.5, `${lo.lift.toFixed(1)} vs ${hi.lift.toFixed(1)}`);
  }
  // ⑤ 掉高:總掉幅只由傷害決定(分幾次打完/幀率都不影響)
  {
    const sink = (hits, dt) => {
      const c = mk();
      let dropped = 0;
      for (const h of hits) c._airSinkHit(h);
      for (let i = 0; i < 10000 && c._airSink > 1e-9; i++) {
        const d = Math.min(c._airSink, c._airSinkV * dt);
        dropped += d; c._airSink -= d;
      }
      return dropped;
    };
    t('一發 300 傷害的總掉幅 = airSinkM(300)', near(sink([300], 1 / 60), airSinkM(300), 1e-6));
    t('連續受擊累加入帳(MUST NOT 覆寫 —— 那會讓連射只算最後一發)',
      sink([100, 100, 100], 1 / 60) > sink([100], 1 / 60) * 2.5);
    t('分三發打完掉一樣多(掉幅是位移不是速度)',
      near(sink([100, 100, 100], 1 / 60), airSinkM(300), 1e-6));
    t('幀率不影響總掉幅(30fps 與 144fps 同值)',
      near(sink([300], 1 / 30), sink([300], 1 / 144), 1e-6));
    t(`打完平均護盾+裝甲 ⇒ 掉 ${FLIGHT.SINK_TOWERS} 個砲塔高(${FLIGHT.SINK_TOWERS * TARGET_H.tower}m)`,
      near(sink([SQUAD.DRONE_AVG_HP], 1 / 60), FLIGHT.SINK_TOWERS * TARGET_H.tower, 1e-6));
    const c = mk({ _flying: () => false });
    c._airSinkHit(300);
    t('地面機體不掉高(規則只作用於飛行機體)', c._airSink === 0);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 飛行動力學 / 絕招載具 HP 校準稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
