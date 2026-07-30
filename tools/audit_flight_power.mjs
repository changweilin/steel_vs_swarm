// ============ 飛行動力學(爬升動力 + 受擊掉高)+ 巨砲改制 稽核 ============
// 用途:改 `data.js` 的 `FLIGHT`/`airSinkM`/`liftMax`/`liftRegen`/`liftDrainPS`/`BARRAGE`/`barrageShots`/
//      `barrageDur`,或 `game.js` 的 `_stepLift`/`_airSinkHit`/`_updatePlayer` 飛行段/`_launchBarrage`/
//      `_barragingShot`/`_tryFire` 之後跑。跑法:`node tools/audit_flight_power.mjs`
//
// 三條規則(2026-07-30 使用者需求)共用一支稽核,因為破法都一樣**無聲**:
//   ①**巨砲不消耗一般重武器的彈夾、每發 100% 傷害**:等值性(三招同預算)改由**發數**承擔。
//      無聲寫壞法:_heroDmg 留著任一重砲倍率(那就不是 100%)、_gateFire 的重砲分支照扣 ammo/mp
//      (那就又吃彈夾)、只看時間窗不看發數(窗內無限免費開火,傷害隨幀率浮動)。
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
  BARRAGE, barrageShots, barrageDur, specialBudget, heroWeapon,
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
console.log('■ Ⅰ 巨砲改制推導(發數 = 預算 ÷ 每發傷害;開窗長度 ← 發數;100% 傷害)');
// ---------------------------------------------------------------------------
{
  const L1 = { light: 1, heavy: 1 }, L4 = { light: 4, heavy: 4 };
  t('BARRAGE MUST NOT 再留每發傷害倍率(DMG_MIN/DMG_MAX 已退場)',
    BARRAGE.DMG_MIN === undefined && BARRAGE.DMG_MAX === undefined);
  t('data.js MUST NOT 再匯出 barrageDmgF(舊制每發倍率)', !/export const barrageDmgF/.test(dataSrc));
  const chs = Object.keys(CHARACTERS);
  const worst = chs.map((ch) => {
    const w = heroWeapon(ch, 'heavy', 1, true);
    return Math.abs(barrageShots(w, L1) * w.dmg - specialBudget(L1)) / w.dmg;
  });
  t('整輪傷害 ≈ 一份絕招預算(32 角誤差 ≤ 半發;離散化是 100% 傷害的必然代價)',
    worst.every((e) => e <= 0.5 + 1e-9), `最大 ${Math.max(...worst).toFixed(3)} 發`);
  t('發數為整數且夾在 SHOTS_MIN~MAX', chs.every((ch) => {
    const n = barrageShots(heroWeapon(ch, 'heavy', 1, true), L1);
    return Number.isInteger(n) && n >= BARRAGE.SHOTS_MIN && n <= BARRAGE.SHOTS_MAX;
  }));
  t('發數隨綜合等級單調不減(預算成長 ⇒ 轟更多發)', chs.every((ch) => {
    const w1 = heroWeapon(ch, 'heavy', 1, true), w4 = heroWeapon(ch, 'heavy', 4, true);
    return barrageShots(w4, L4) * w4.dmg >= barrageShots(w1, L1) * w1.dmg;
  }));
  t('每發傷害越高 → 發數越少(預算切分,非固定發數)',
    barrageShots({ dmg: 50 }, L1) > barrageShots({ dmg: 200 }, L1));
  t('開窗長度 = max(DUR, 發數 × SHOT_GAP)(推導不手寫)',
    near(barrageDur(BARRAGE.SHOTS_MAX), Math.max(BARRAGE.DUR, BARRAGE.SHOTS_MAX * BARRAGE.SHOT_GAP))
    && near(barrageDur(1), BARRAGE.DUR));
  t('開窗長度隨發數單調不減(低幀率也打得完 ⇒ 不會靜默少掉預算)',
    barrageDur(BARRAGE.SHOTS_MAX) >= barrageDur(BARRAGE.SHOTS_MIN));
  t('barrageDur 原文取自 BARRAGE.DUR / SHOT_GAP,MUST NOT 手寫秒數',
    /export const barrageDur[\s\S]{0,160}?BARRAGE\.DUR[\s\S]{0,80}?BARRAGE\.SHOT_GAP/.test(dataSrc));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ 巨砲免除窗的兩端(伺服器不扣彈夾/電力 + 客戶端同一條判據)');
// ---------------------------------------------------------------------------
{
  const gate = grab('_gateFire', simSrc);
  t('sim._gateFire 的巨砲分支先於彈夾/電力扣減,直接 return true(不扣 ammo/mp)',
    /if \(barrage\) \{[\s\S]{0,420}?return true;/.test(gate)
    && !/if \(barrage\)[\s\S]{0,420}?h\.ammo\[id\]--/.test(gate));
  t('sim._gateFire 的巨砲分支逐發遞減 barrageLeft(發數 = 權威資源)',
    /if \(barrage\) \{[\s\S]{0,300}?h\.barrageLeft = Math\.max\(0, \(h\.barrageLeft \|\| 0\) - 1\)/.test(gate));
  const dmg = grab('_heroDmg', simSrc);
  t('sim._heroDmg MUST NOT 再乘任何重砲倍率(每發 100% 傷害)',
    !/barrag/i.test(dmg.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/')).join('\n')));
  const bd = grab('_barragingDmg', simSrc);
  t('sim._barragingDmg 同時看「窗」與「發數」(缺一即無限免費開火 / 窗過期仍白吃)',
    /barrageUntil/.test(bd) && /barrageLeft/.test(bd) && /DMG_GRACE/.test(bd));
  t('sim.heroBarrage 不再以彈夾狀態為前置條件(空夾/裝填中照樣能轟)',
    !/reloadUntil\?\.heavy[\s\S]{0,80}?return;/.test(grab('heroBarrage', simSrc)));
  t('sim.heroBarrage 的發數走 barrageShots 單一縫',
    /barrageShots\(/.test(grab('heroBarrage', simSrc)) && count(simCode, 'barrageShots(') === 1);
  // 客戶端:免彈夾/免電力/解射速閘/射程加成 四個消費端 MUST 全吃 _barragingShot
  t('game.js 有 _barragingShot 單一判據(窗 + 發數)',
    /_barragingShot\(now = performance/.test(src)
    && /_barrageUntil \|\| 0\) > now && \(this\._barrageLeft \|\| 0\) > 0/.test(code));
  t('_barrageUntil 只在「開窗」與「判據」兩處被讀寫(其餘消費端一律走 _barragingShot)',
    count(code, '_barrageUntil') === 2, `${count(code, '_barrageUntil')} 處`);
  // 自機那一側的 RANGE_F 消費端一律走 _barragingShot;他人那側是事件轉播(_isBarraging(pid)),
  // 兩者 MUST NOT 互串 —— 拿自機旗標畫別人的曳光 = 別人的巨砲永遠沒有加程演出。
  {
    const lines = code.split('\n').filter((l) => l.includes('BARRAGE.RANGE_F'));
    const bad = lines.filter((l) => !/_barragingShot|barraging|\bbar \?/.test(l));
    t('BARRAGE.RANGE_F 的每個消費端都掛在 _barragingShot(自機)或事件轉播旗標(他人)上',
      lines.length >= 3 && bad.length === 0, bad.join(' | '));
  }
  const fire = grab('_tryFire');
  t('_tryFire:巨砲那一發不扣彈夾、不扣電力,改扣該輪發數',
    /if \(barraging\) this\._barrageLeft = Math\.max\(0, \(this\._barrageLeft \|\| 0\) - 1\);/.test(fire)
    && /else \{\s*\n\s*st\.ammo--;/.test(fire));
  t('_tryFire:裝填中 / 空夾不擋巨砲(巨砲不吃彈夾)',
    /if \(!barraging && st\.reloadEnd > 0\) return;/.test(fire)
    && /if \(!barraging && st\.ammo <= 0\) \{ this\._startReload/.test(fire));
  t('_launchBarrage 不再以彈夾為閘、發數走 barrageShots',
    /barrageShots\(hvDef, this\.abil\)/.test(grab('_launchBarrage'))
    && !/reloadEnd > 0 \|\| hv\.ammo <= 0/.test(grab('_launchBarrage')));
  t('他人巨砲的演出窗長也走 barrageDur(兩端同一支)', /barrageDur\(ev\.n\)/.test(code));
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
  t('airSinkM 的唯一消費端 = _airSinkHit',
    count(code, 'airSinkM(') === 1 && /airSinkM\(/.test(grab('_airSinkHit')));
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

console.log(`\n${fail ? '❌' : '✅'} 飛行動力學 / 巨砲改制稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
