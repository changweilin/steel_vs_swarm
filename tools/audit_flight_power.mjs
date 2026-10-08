// ============ Flight dynamics (climb power + hit-induced sink) + chassis-ult vehicle HP calibration audit ============
// Purpose: run after changing `data.js` `FLIGHT`/`airSinkM`/`liftMax`/`liftRegen`/`liftDrainPS`/`HYPER`/
// `towerDps`/`kamiHp`/`hyperHp`/`decoyHp`/`kamiSide`, or `game.js` `_stepLift`/`_airSinkHit`/ the
// `_updatePlayer` flight section / `_fireHoldAbility` / `_tryFire`. Usage: `node tools/audit_flight_power.mjs`
//
// Three rules share one audit because they all break **silently**:
//   1 **Chassis-ult vehicle HP is always reverse-solved from "how many seconds one frontline tower position
//     shoots"** (the three sentences set by the user 2026-08-01, with bal 7f swapping the yardstick on
//     2026-08-02 from "one lone tower" to the front line's real firepower = twin towers per position):
//     saturation strike 4 frames, exactly 2 shot down; hypersonic missile exactly unsurvivable (it overflies
//     the whole front line ⇒ plus one creep wave counted separately); cluster bomber exactly delivers 5+1.
//     Silent breakage: any hand-written HP (tower retune drifts the whole set), vehicles carrying armor /
//     shields (EHP floats with the host chassis, so "exactly" becomes luck of the draw), cannon-era magazine
//     bypass remnants in _gateFire/_tryFire (heavy weapons firing free again). The server half is guarded by
//     `npm test` (direct sim tests); here verify **derivation and client consumers**.
//   2 **Hit-induced sink**: meters lost ∝ damage, calibration anchor = draining "mean shields+armor" drops
//     SINK_TOWERS tower-heights. Sinking counts as an unbalance effect (2026-10-06): drones flying low
//     (below one tower height AGL) do not unbalance ⇒ no sink, no power lock either.
//     Silent breakage: hand-written meters/coefficients in game.js (anchor retune splits them), sink amount
//     as a "rate" (same damage split across shots sinks differently), forgetting to clear books on
//     death/chassis-swap/touchdown (old books drag the new chassis down).
//   3 **Climb power**: consumed only flying upward; full power at full climb lasts DRAIN_S seconds;
//     cap/regen fixed fleet-wide (LIFT_MAX = 100, REGEN_PS = 10); full-charge super-jump costs 60%,
//     full-charge morph 40% (both x charge fraction).
//     Silent breakage: hand-written drain rate (DRAIN_S retune does nothing), per-chassis cap/regen (fix
//     one, miss one), jump/morph costs as fixed points (LIFT_MAX retune splits them), empty power as
//     "slow down" instead of "cannot climb" (players cannot tell, and it splits from slope-block
//     semantics), cutting the horizontal component too.
//     Higher altitude costs more power for the same climb rate: exponential curve liftAltF (base = 1,
//     doubling per tower height, capped at ALT_TOP_F = 3 tower heights = 8x); base = sea level when a sea
//     exists, else the map's lowest terrain; descent recharge rides the same curve (more back from higher
//     up, the 2/3 ratio holding everywhere).
//     Silent breakage: stepped ladders (one meter higher suddenly costs a notch), base hard-coded 0
//     (coastal maps price sea level as altitude), NaN when the ceiling is void, per-consumer coefficient
//     copies, climb riding the curve while descent does not (a round trip at one altitude evaporates power
//     from nothing).
//
// Method follows `audit_cc_flash.mjs`: formulas imported directly (data.js is a pure module), game.js
// methods evaluated by **extracting executable source** (three.js rides the CDN, Node cannot import the
// whole file; a recopied formula in the audit would pass forever). Source always passes through
// `audit_src.mjs readSrc()` (newline normalization): this file strips per-line comments + "only N
// occurrences" counting, while `//.*$` silently fails on CRLF checkouts ⇒ names inside comments get
// counted into single-seam counts (same code green on LF, red on Windows). MUST NOT fall back to a
// private `readFileSync` (section-5 general rule ㋑).
import { readSrc } from './audit_src.mjs';
import {
  FLIGHT, airSinkM, liftMax, liftRegen, liftDrainPS, liftDescentPS, liftAltF, unbalMissP,
  cjumpLiftCost, morphLiftCost, CJUMP, MORPH,
  SQUAD, TARGET_H, UNITS, CHARACTERS, ECON, chargeF,
  HYPER, DECOY, LANCE, lanceR, towerDps, towerSurviveHp, towerKillHp,
  kamiHp, kamiExposureS, kamiSide, hyperHp, hyperFlightS, hyperMaxArcM, ultLaunchLegM,
  hyperApex, hyperRange, decoyHp, decoyExposureS,
  hyperArcY, hyperClimbVx, hyperClimbS, hyperTrackR, hyperClimbLen, hyperTerminalF,
  TOWER_SITE_N, frontKillHp, overflySurviveHp, waveDps, waveComp, blastFootprintR,
  kamiBlast, decoyBlast, decoyBombBlast, hyperBlast,
  SPECIAL, specialBudget, specialBlastR, hyperShare,
  GAME, fluidFactor,
} from '../public/js/data.js';

const src = readSrc('public', 'js', 'game.js');
const dataSrc = readSrc('public', 'js', 'data.js');
const simSrc = readSrc('server', 'sim.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const css = readSrc('public', 'css', 'style.css');
const html = readSrc('public', 'index.html');

/** Extract a class method's source (with brace block); same technique as audit_cc_flash.mjs */
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

/** "Only N occurrences in the whole file" counts MUST scan executable source only — comments and import lists mention the same names */
const strip = (s, cut) => {
  const noCom = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  return cut ? noCom.split(cut).slice(1).join(cut) : noCom;
};
const laneSrc = readSrc('tools', 'lanesim.mjs');
const code = strip(src, "} from './data.js';");
const simCode = strip(simSrc, "} from '../public/js/data.js';");
const laneCode = strip(laneSrc, "} from '../public/js/data.js';");

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 機種絕招載具 HP + 爆風面積:一律由「前線一組塔位打幾秒」與「預算比例」反解(推導不手寫)');
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

  // — Saturation strike: 4 frames, one tower shoots down exactly SHOT_DOWN —
  t('KAMI.N = 4 且 SHOT_DOWN = 2 ⇒ 成功自爆 2 架(使用者定調)',
    SQUAD.KAMI.N === 4 && SQUAD.KAMI.SHOT_DOWN === 2);
  t('舊 KAMI.HP_F(主機血量比例)已退場(HP 改由砲塔火力反解)',
    SQUAD.KAMI.HP_F === undefined);
  t('kamiExposureS = 砲塔射程 ÷ 撲擊速度(推導不手寫)',
    near(kamiExposureS(), UNITS.tower.range / (UNITS.drone.speed * SQUAD.KAMI.SPEED_MUL)));
  t('kamiHp = frontKillHp(曝險窗 ÷ SHOT_DOWN)',
    kamiHp() === frontKillHp(kamiExposureS() / SQUAD.KAMI.SHOT_DOWN));
  t('kamiHp 原文走 frontKillHp,MUST NOT 手寫',
    /export const kamiHp = \(\) => frontKillHp\(/.test(dataSrc));
  t('「攻擊力減半、數量加倍」= 同一件事:每架 = 預算 ÷ N(整份預算不變)',
    /dmg: Math\.round\(specialBudget\(abil\) \/ SQUAD\.KAMI\.N\),/.test(dataSrc));
  {
    const ss = Array.from({ length: SQUAD.KAMI.N }, (_, i) => kamiSide(i));
    t('kamiSide 均勻散開、對稱、涵蓋 [−1, 1]',
      ss[0] === -1 && ss[ss.length - 1] === 1 && near(ss.reduce((a2, b2) => a2 + b2, 0), 0), ss.join(', '));
    // 2026-08-06 user decision "drop the persistent module, appear only when attacking" ⇒ the client
    // close-escort consumer retires as a group (`ESCORT`/`escortSlot`/`_buildDroneEscorts`/`_updateEscorts`);
    // kamiSide keeps only the server consumer.
    t('kamiSide 只剩伺服器生成側偏移一個消費端,MUST NOT 復辟 `const s = i === 0 ? -1 : 1`',
      /const s = kamiSide\(i\);/.test(simCode)
      && !/const s = i === 0 \? -1 : 1/.test(simCode) && !/const s = i === 0 \? -1 : 1/.test(code));
    t('常駐護衛機外觀已退場(客戶端零殘留:模型/每幀擺位/ESCORT 常數)',
      !/escort|ESCORT/i.test(code) && !/ESCORT|escortSlot|escortDrift|escortLag/.test(dataSrc.replace(/\/\/.*$/gm, '')));
  }

  // — Hypersonic missile: 45° parabolic climb + surviving the single longest flight —
  // 2026-08-02 user-set trajectory: "first half parabolas skyward at a 45° initial angle, second half
  // spirals down at extreme speed onto the target" ⇒ apex height is no longer a constant but the derived
  // "launch angle × engagement distance".
  t('hyperApex / hyperRange / hyperFlightS 全由已縮好的量推導(MUST NOT 手寫遊戲公尺)',
    /export const hyperApex = \(d = hyperRange\(\)\) => d \* Math\.tan\(hyperLaunchRad\(\)\) \/ 2;/.test(dataSrc)
    && /export const hyperRange = \(\) => UNITS\.tower\.range \* HYPER\.RANGE_F;/.test(dataSrc)
    && /hyperClimbS\(d\) \+ hyperApex\(d\) \/ hyperDiveSpd\(\)/.test(dataSrc)
    && /export const hyperMaxArcM = \(\) => ultLaunchLegM\(\) \+ hyperRange\(\);/.test(dataSrc));
  t('曝險窗基準 = **原軌跡**(爬升 + 垂直落下),MUST NOT 改吃追擊斜距 —— 追擊是「打得到人」的加分,'
    + '連生存性也加成會把 bal ⑦f 的三招實得比推到 1.93×(實測)',
    near(hyperFlightS(hyperMaxArcM()),
      hyperClimbS(hyperMaxArcM()) + hyperApex(hyperMaxArcM()) / (HYPER.CLIMB_SPD * HYPER.DIVE_F))
    && !/Math\.hypot\(hyperApex\(\), hyperTrackR\(\)\)/.test(dataSrc));
  // 2026-08-07 user decision "ults now summon from the nearest tower or base": the longest shot gains an
  // extra **representative launch leg**, while the missile overflies the whole front line at altitude (it
  // eats overflyDps) ⇒ that leg is genuinely more exposure, so the exposure window MUST grow with it.
  // The other two forms deliberately stay: their windows measure "frontline tower-position range entry →
  // arrival", which a shifted-back launch point does not change.
  t('最長航程 = 代表發射腿 + 遞送距離(工事召喚多飛的那一段真的進了曝險窗)',
    hyperMaxArcM() === ultLaunchLegM() + hyperRange()
    && hyperFlightS(hyperMaxArcM()) > hyperFlightS(hyperRange())
    && kamiHp() === frontKillHp(kamiExposureS() / SQUAD.KAMI.SHOT_DOWN)
    && decoyHp() === frontKillHp(decoyExposureS()));
  t('代表發射腿推導不手寫(= 半個塔距 = 兵線接觸線到自家前線塔的距離)',
    /export const ultLaunchLegM = \(\) => UNITS\.tower\.range \* GAME\.TOWER_SEP_F \/ 2;/.test(dataSrc)
    && near(ultLaunchLegM(), UNITS.tower.range * GAME.TOWER_SEP_F / 2));
  t('舊制固定頂點係數 APEX_F 已退場(垂直爬升放不下「初始角度」)', HYPER.APEX_F === undefined);
  t('出膛角 = HYPER.LAUNCH_DEG(拋物線在 f = 0 的切線斜率 = tanθ;數值微分驗真品)', (() => {
    const d = hyperRange(), e = 1e-7;
    const deg = Math.atan((hyperArcY(d, e) - hyperArcY(d, 0)) / (e * d)) * 180 / Math.PI;
    return HYPER.LAUNCH_DEG === 45 && Math.abs(deg - HYPER.LAUNCH_DEG) < 1e-3;
  })());
  t('拋物線只有一份實作:hyperArcY 是唯一的高度式,伺服器不自己寫多項式',
    /m\.y = m\.y0 \+ hyperArcY\(m\.arcD, f\);/.test(simCode)
    && (simCode.match(/hyperArcY\(/g) || []).length === 1
    && !/m\.y \+= HYPER\.CLIMB_SPD \* dt/.test(simCode));
  t('爬升段水平等速 = 出膛速度的水平分量(hyperClimbVx 單一縫)',
    /export const hyperClimbVx = \(\) => HYPER\.CLIMB_SPD \* Math\.cos\(hyperLaunchRad\(\)\);/.test(dataSrc)
    && /m\.trav \+ hyperClimbVx\(\) \* dt/.test(simCode)
    && near(hyperClimbS(hyperRange()) * hyperClimbVx(), hyperRange()));
  t('頂點恰在目標正上方(後半段才是真正的「向下」俯衝)',
    near(hyperArcY(hyperRange(), 1), hyperApex(hyperRange())));
  t('螺旋基底取固定水平法向,MUST NOT 由彈道軸現算(垂直落下時軸的水平分量 → 0 = 沒有螺旋)',
    /m\.uz \* c \+ m\.ux \* s/.test(simCode) && !/px = -az \/ Math\.hypot/.test(simSrc));

  // — Terminal pursuit has a range (2026-08-05 user decision) —
  // "First 2/3 flies to the target's launch-time position; the last 1/3 spirals onto it only while the
  // target stays within half a tower range, else holds the original track". Every breakage is silent:
  // hand-written verdict radius (tower retune splits it), climb phase peeking at live position (apex
  // dragged away = parabola void), per-tick re-verdicts (trajectory snaps in the last fractions of a
  // second).
  t('終端追擊半徑推導不手寫 = 砲塔射程 × TRACK_R_F',
    /export const hyperTrackR = \(\) => UNITS\.tower\.range \* HYPER\.TRACK_R_F;/.test(dataSrc)
    && near(hyperTrackR(), UNITS.tower.range * HYPER.TRACK_R_F)
    && HYPER.TRACK_R_F === 0.5);
  t('「前 2/3 / 後 1/3」是推導比例不是手寫邊界:俯衝段佔全航跡的比例與交戰距離無關,且落在 1/3 帶',
    near(hyperTerminalF(80), hyperTerminalF(900), 1e-12)
    && Math.abs(hyperTerminalF() - 1 / 3) < 0.05,
    `實得 ${(hyperTerminalF() * 100).toFixed(1)}%`);
  t('爬升弧長走閉式解(比水平距離長、比兩倍短;MUST NOT 手寫係數或改數值積分)',
    hyperClimbLen(200) > 200 && hyperClimbLen(200) < 400
    && near(hyperClimbLen(400), hyperClimbLen(200) * 2)
    && /Math\.asinh\(k\) \/ \(2 \* k\)/.test(dataSrc));
  t('追擊判定**只做一次**,而且就掛在既有的頂點切換點上(MUST NOT 另立第三相位)',
    count(simCode, 'm.chase =') === 1
    && /m\.phase = 'dive';[\s\S]{0,200}m\.chase = !!t && Math\.hypot\(t\.x - m\.tx, t\.z - m\.tz\) <= hyperTrackR\(\);/.test(simCode));
  t('前 2/3 不讀目標的即時位置:落點只有「追擊中」才改寫(舊制無條件跟蹤已退場)',
    count(simCode, 'm.tx = t.x') === 1
    && /if \(m\.chase && t\) \{ m\.tx = t\.x; m\.tz = t\.z; \}/.test(simCode)
    && !/if \(t && t\.hp > 0 && !\(t\.hero && t\.dead\)\) \{ m\.tx = t\.x/.test(simCode));
  t('放棄追擊 = 這一發從此與那個實體無關(tid 清掉 ⇒ 落點與高度都回原軌跡)',
    /if \(!m\.chase\) m\.tid = 0;/.test(simCode));
  t('判定半徑在伺服器只有這一個消費端(MUST NOT 在別處再判一次)',
    count(simCode, 'hyperTrackR()') === 1);
  t('前線交戰模型吃同一條規則(lanesim 的 hyper 也會追丟 —— 否則 bal ⑦f 把它算成必中)',
    /v\.kind !== 'hyper' \|\| v\.chase/.test(laneCode)
    && /v\.chase = v\.tgt\.hp > 0 && Math\.hypot\(v\.tgt\.x - v\.tx, v\.tgt\.y - v\.ty\) <= hyperTrackR\(\);/.test(laneCode)
    && count(laneCode, 'hyperTrackR()') === 1);
  // Client only interpolates server-reported positions (`b.chase` is the fire-and-forget **shell's**
  // pursuit-fuel flag, unrelated to this move)
  t('客戶端不參與追擊判定(彈道與命中全在伺服器)',
    !/hyperTrackR/.test(code) && !/m\.chase|hyperChase/.test(code));
  t('爬升頂點高過直射鎖定天花板(是「高空」不是抬個頭)', hyperApex() > GAME.GUN_CEIL_M);
  t('接戰距離大於砲塔射程(機甲的攻塔手段)', hyperRange() > UNITS.tower.range);
  t('俯衝遠快於爬升(「極音速」那一段幾乎攔不住)', HYPER.DIVE_F > 2);
  t('hyperHp = overflySurviveHp(最長飛行時間)⇒ 飛越整條前線剛好打不爆',
    hyperHp() === overflySurviveHp(hyperFlightS(hyperMaxArcM()))
    && hyperHp() > (towerDps() * TOWER_SITE_N + waveDps()) * hyperFlightS(hyperMaxArcM()));
  t('「剛好」不是「綽綽有餘」:餘裕 < 一發塔砲',
    hyperHp() - (towerDps() * TOWER_SITE_N + waveDps()) * hyperFlightS(hyperMaxArcM()) < towerDps());
  // — Firepower / area migration (2026-08-06 user decision: 2.5 kamikaze-drone damage / tower-range
  // 2/5 blast) —
  t('戰鬥部 = 2.5 架自爆無人機的傷害(逐等級都成立)',
    [{ light: 1, heavy: 1 }, { light: 4, heavy: 1 }, { light: 4, heavy: 4 }].every((ab2) =>
      Math.abs(hyperBlast(ab2).dmg - kamiBlast(ab2).dmg * HYPER.KAMI_EQ) <= 2),
    `Lv1 ${hyperBlast({ light: 1, heavy: 1 }).dmg} vs ${kamiBlast({ light: 1, heavy: 1 }).dmg} × ${HYPER.KAMI_EQ}`);
  t('比例推導不手寫:hyperShare = KAMI_EQ / KAMI.N(改 N 這句話仍成立)',
    /export const hyperShare = \(\) => HYPER\.KAMI_EQ \/ Math\.max\(1, SQUAD\.KAMI\.N\);/.test(dataSrc)
    && near(hyperShare(), HYPER.KAMI_EQ / SQUAD.KAMI.N));
  t('傷害走 hyperShare,MUST NOT 悄悄調回整份預算(那正是「一轟就爆」的成因)',
    /dmg: Math\.round\(specialBudget\(abil\) \* hyperShare\(\)\)/.test(dataSrc)
    && hyperBlast({ light: 1, heavy: 1 }).dmg < Math.round(specialBudget({ light: 1, heavy: 1 })));
  t('爆風半徑仍是 share = 1 的基準(2026-08-06 使用者定案「範圍改回舊制」)—— 少領預算 MUST NOT 順手連範圍也削',
    /r: specialBlastR\(1\), pen: HYPER\.PEN/.test(dataSrc)
    && near(hyperBlast({ light: 1, heavy: 1 }).r, HYPER.BLAST_R) && HYPER.BLAST_R_F === undefined,
    `${hyperBlast({ light: 1, heavy: 1 }).r.toFixed(1)}m`);

  // — Cluster bomb: survive to deliver all DROP_N —
  t('BOMB_MAX = 6 且 DROP_N + 墜毀補投 1 顆 = BOMB_MAX(使用者定調的 5+1)',
    DECOY.BOMB_MAX === 6 && DECOY.DROP_N + 1 === DECOY.BOMB_MAX);
  t('舊 DECOY.HP_F(主機血量比例)已退場', DECOY.HP_F === undefined);
  t('decoyExposureS = 接近時間 + (DROP_N − 0.5) 個投彈間隔(半個間隔的餘量也是推導,不手寫秒數)',
    near(decoyExposureS(),
      Math.max(0, UNITS.tower.range - DECOY.BOMB_R) / DECOY.SPEED + (DECOY.DROP_N - 0.5) * DECOY.BOMB_GAP));
  // Behavior test: the DROP_N-th bomb just fits inside the exposure window, the (DROP_N+1)-th never does
  {
    const live = decoyHp() / (towerDps() * TOWER_SITE_N);
    const approach = Math.max(0, UNITS.tower.range - DECOY.BOMB_R) / DECOY.SPEED;
    const dropped = 1 + Math.floor((live - approach) / DECOY.BOMB_GAP + 1e-9);
    t('前線一組塔位火力下剛好投出 DROP_N 顆 + 墜毀補投 1 顆 = BOMB_MAX',
      dropped === DECOY.DROP_N && dropped + 1 === DECOY.BOMB_MAX, `實得 ${dropped} + 1`);
  }
  // Behavior test: one frontline tower position shoots down exactly SHOT_DOWN frames inside the window
  {
    const downed = Math.floor(kamiExposureS() / (kamiHp() / (towerDps() * TOWER_SITE_N)) + 1e-9);
    t('前線一組塔位在曝險窗內剛好擊落 SHOT_DOWN 架、其餘成功自爆',
      downed === SQUAD.KAMI.SHOT_DOWN, `實得 ${downed} 架`);
  }
  t('decoyHp = frontKillHp(曝險窗)', decoyHp() === frontKillHp(decoyExposureS()));
  // — Calibration basis: one frontline tower position (set by bal 7f on 2026-08-02) —
  t('前線基準 = 同塔位雙塔,且 front* 由 tower* 推導(MUST NOT 各寫一份 dps)',
    TOWER_SITE_N === 2
    && /export const frontSurviveHp = \(sec\) => towerSurviveHp\(sec \* TOWER_SITE_N\);/.test(dataSrc)
    && /export const frontKillHp = \(sec\) => towerKillHp\(sec \* TOWER_SITE_N\);/.test(dataSrc));
  t('waveDps 由 waveComp 推導(飛越前線的載具才另計這一份)',
    near(waveDps(), waveComp().reduce((s, k) => s + UNITS[k].dmg * UNITS[k].rate, 0))
    && /export const waveDps = \(\) => waveComp\(\)\.reduce\(/.test(dataSrc));
  t('三個 HP 全部走同一把前線的尺(MUST NOT 有人還留在單塔基準)',
    !/= towerKillHp\(kamiExposureS|= towerSurviveHp\(hyperFlightS|= towerKillHp\(decoyExposureS/.test(dataSrc));
  // — Blast-radius area pricing: total covered area is independent of "how many pieces" (the 2026-08-06
  // firepower migration deliberately leaves this line alone) —
  {
    const A = (d) => d.n * Math.PI * (blastFootprintR(d.r) ** 2);
    const ab = { light: 1, heavy: 1 };
    const areas = [
      A({ n: SQUAD.KAMI.N, r: kamiBlast(ab).r }),
      A({ n: DECOY.BOMB_MAX, r: decoyBombBlast(ab).r }) + A({ n: 1, r: decoyBlast(ab).r }),
      A({ n: 1, r: hyperBlast(ab).r }),
    ];
    t('三招總覆蓋面積相同(半徑 ∝ √預算比例 ⇒ 切分不生範圍)',
      areas.every((x) => Math.abs(x / areas[2] - 1) < 1e-9), areas.map((x) => (x / 1000).toFixed(1)).join(' / '));
    t('specialBlastR 是唯一的半徑式,舊的逐招常數已退場',
      /export const specialBlastR = \(share\) => HYPER\.BLAST_R \* Math\.sqrt\(/.test(dataSrc)
      && DECOY.R === undefined && DECOY.BOMB_BLAST_R === undefined
      && near(hyperBlast(ab).r, HYPER.BLAST_R));
  }
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ 巨砲 + 機種絕招整組退場:射擊路徑無旁路、客戶端無機種分派表');
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
  // ---- Chassis-ult client entry (2026-08-06 phase two: hold-right becomes the ability gesture) retired wholesale ----
  // The legacy _launchKamikaze / _launchDecoy / _launchHyper trio were the three leaves of a "chassis
  // dispatch table"; with chassis ults retired the table has nothing left to dispatch ⇒ the A22 seam is now
  // expressed by the data.js `abilHoldSlot` **mode** split (normal = light / aimed = heavy). One survivor left
  // in source is a button that does nothing when pressed (the server no longer honors the message), showing
  // on screen only as "this chassis's hold is broken".
  for (const m of ['_launchKamikaze', '_launchDecoy', '_launchHyper']) {
    t(`game.${m} 已整組退場(MUST NOT 復辟)`, !new RegExp(`\\n  ${m}\\(`).test(code));
  }
  t('客戶端不再送 kami / decoy / hyper 三條機種絕招訊息(一律走 t:\'cast\' 單一縫)',
    !/t: 'kami'|t: 'decoy'|t: 'hyper'/.test(code));
  t('長按派發縫仍只有一處(_fireHoldAbility),且不再有機種分派表',
    /_castAbility\(abilHoldSlot\(this\.(aiming|defending)\)\)/.test(grab('_fireHoldAbility', code))
    && !/isDrone|isMorph/.test(grab('_fireHoldAbility', code)));
  t('模式分流只有 abilHoldSlot 一個消費端(MUST NOT 在觸控鈕/鍵盤各判一次 `aiming ? …`)',
    count(code, 'abilHoldSlot(') === 1, `實得 ${count(code, 'abilHoldSlot(')} 處`);
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
  t('受擊動力鎖定時長為正', FLIGHT.HIT_LOCK_S > 0, `${FLIGHT.HIT_LOCK_S}s`);
  t('失衡異常狀態命中與暴擊率皆減半', FLIGHT.UNBAL_ACC_MUL === 0.5 && FLIGHT.UNBAL_CRIT_MUL === 0.5);
  t('失衡時長 = 掉高消化 + 穩住時長(FLIGHT.UNBAL_S)', FLIGHT.UNBAL_S === FLIGHT.SINK_S + FLIGHT.HIT_LOCK_S);
  t('unbalMissP 單一縫:失衡命中率減半、未失衡維持原值',
    unbalMissP(0, true) === 0.5 && unbalMissP(0.2, true) === 0.6 && unbalMissP(0.2, false) === 0.2);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅳ 爬升動力:推導(滿動力全速爬升撐 DRAIN_S 秒;上限/回速全機固定)');
// ---------------------------------------------------------------------------
{
  t(`滿動力全速爬升 = DRAIN_S(${FLIGHT.DRAIN_S}s)`,
    near(liftMax() / liftDrainPS(), FLIGHT.DRAIN_S, 1e-9),
    `${(liftMax() / liftDrainPS()).toFixed(3)}s`);
  t('動力上限全機相同 = FLIGHT.LIFT_MAX(100)',
    FLIGHT.LIFT_MAX === 100 && liftMax() === 100);
  t('上限 MUST NOT 按機體/電力區分(舊 MAX_F / MORPH_F 已退場)',
    FLIGHT.MAX_F === undefined && FLIGHT.MORPH_F === undefined
    && liftMax(60) === liftMax(200) && liftMax(200, true) === liftMax(100, false));
  t('liftDrainPS 由 liftMax / DRAIN_S 推導(MUST NOT 手寫每秒耗量)',
    /export const liftDrainPS[\s\S]{0,140}?liftMax\(\)[\s\S]{0,40}?FLIGHT\.DRAIN_S/.test(dataSrc)
    && near(liftDrainPS(), FLIGHT.LIFT_MAX / FLIGHT.DRAIN_S, 1e-9));
  t('回速全機相同 = FLIGHT.REGEN_PS(10),MUST NOT 吃電力/充能軌(舊 REGEN_F 已退場)',
    FLIGHT.REGEN_PS === 10 && liftRegen() === 10
    && FLIGHT.REGEN_F === undefined
    && liftRegen(8, 3) === liftRegen(4, 0)
    && !/export const liftRegen[\s\S]{0,160}?chargeF\(/.test(dataSrc));
  t('回充比耗盡慢(爬升是有代價的機動)',
    liftMax() / liftRegen() > FLIGHT.DRAIN_S,
    `${(liftMax() / liftRegen()).toFixed(1)}s 回滿`);
  t('大跳躍滿蓄耗上限 60%(輕按按蓄力比例折算,推導不手寫)',
    FLIGHT.CJUMP_F === 0.6 && cjumpLiftCost(1) === Math.ceil(liftMax() * 0.6)
    && cjumpLiftCost(0.5) === Math.ceil(liftMax() * 0.6 * 0.5)
    && /export const cjumpLiftCost[\s\S]{0,160}?FLIGHT\.CJUMP_F/.test(dataSrc));
  t('變形滿蓄耗上限 40%(輕按按蓄力比例折算,推導不手寫)',
    FLIGHT.MORPH_COST_F === 0.4 && morphLiftCost(1) === Math.ceil(liftMax() * 0.4)
    && morphLiftCost(0.5) === Math.ceil(liftMax() * 0.4 * 0.5)
    && /export const morphLiftCost[\s\S]{0,160}?FLIGHT\.MORPH_COST_F/.test(dataSrc));
  t('舊 CJUMP.LIFT / MORPH.LIFT 固定點數已退場(改上限就分家的那一組)',
    CJUMP.LIFT === undefined && MORPH.LIFT === undefined);
  t('DESCENT_RECHARGE_F = 2 / 3(正常操作下降高度回充 2/3 電力)',
    near(FLIGHT.DESCENT_RECHARGE_F, 2 / 3, 1e-9));
  t('liftDescentPS 由 liftDrainPS * FLIGHT.DESCENT_RECHARGE_F 推導(MUST NOT 手寫每秒回充量)',
    /export const liftDescentPS[\s\S]{0,140}?liftDrainPS\(\)[\s\S]{0,40}?FLIGHT\.DESCENT_RECHARGE_F/.test(dataSrc));
  t('全速下降回充 = 全速爬升耗速 × 2/3',
    near(liftDescentPS() / liftDrainPS(), FLIGHT.DESCENT_RECHARGE_F, 1e-9));
  // ---- Altitude climb curve (2026-09-30 user request: higher altitude costs more power for the same
  //      climb; 2026-10-06 migrated to exponential: one tower height per unit, doubling per tower height,
  //      capped at 3 tower heights = 8x) ----
  // Base = sea level when a sea exists, else the map's lowest terrain; cap height = base + ALT_TOP_F tower heights.
  t('高度曲線由 FLIGHT.ALT_TOP_F 推導(MUST NOT 手寫倍率)',
    /export const liftAltF[\s\S]{0,600}?FLIGHT\.ALT_TOP_F/.test(dataSrc)
    && /Math\.pow\(2,/.test(dataSrc));
  t('ALT_TOP_F = 3(指數封頂高度,塔高倍數;封頂耗速 = 2^3 = 8 倍)', FLIGHT.ALT_TOP_F === 3);
  t('封頂耗速 = 2^ALT_TOP_F(推導不手寫)',
    near(liftAltF(10 + 3 * TARGET_H.tower, 10, 200), Math.pow(2, FLIGHT.ALT_TOP_F), 1e-9));
  t('每多一個塔高翻倍(指數的定義)',
    near(liftAltF(10 + TARGET_H.tower, 10, 200), 2, 1e-9)
    && near(liftAltF(10 + 2 * TARGET_H.tower, 10, 200), 4, 1e-9));
  t('起點錨點:liftAltF(起點以下) = 1(既有 DRAIN_S 節奏在起點不動)',
    liftAltF(10, 10, 200) === 1 && liftAltF(-50, 10, 200) === 1);
  t('起點缺失降級回 1(原則 6)',
    liftAltF(100, null, 200) === 1 && liftAltF(100, NaN, 200) === 1
    && liftAltF(100, undefined, Infinity) === 1);
  t('超界夾邊:3 個塔高以上 = 封頂 8 倍(連續不爆)',
    near(liftAltF(500, 10, 200), 8, 1e-9)
    && near(liftAltF(10 + 10 * TARGET_H.tower, 10, 200), 8, 1e-9));
  t('單調非遞減:越高越貴(千點取樣)', (() => {
    const H = TARGET_H.tower;
    let prev = 1;
    for (let i = 1; i <= 1000; i++) {
      const v = liftAltF(10 + i / 1000 * 3 * H, 10, 200);
      if (!(v >= prev)) return false;
      prev = v;
    }
    return prev === 8;
  })());
  t('連續無階梯:千點最大鄰差 < 0.05(階梯式曲線在此現形)', (() => {
    const H = TARGET_H.tower;
    let worst = 0, prev = liftAltF(10, 10, 200);
    for (let i = 1; i <= 1000; i++) {
      const v = liftAltF(10 + i / 1000 * 3 * H, 10, 200);
      worst = Math.max(worst, Math.abs(v - prev));
      prev = v;
    }
    return worst < 0.05;
  })());
  t('只認塔高單位:起點平移,同相對高度耗速相同(海平面起算與最低點起算是同一條曲線)',
    near(liftAltF(60, 10, 210), liftAltF(160, 110, 310), 1e-9));
  t('liftAltF 在 game.js 只有 _stepLift 一個消費端(爬升扣 + 下降回充兩處,單一縫)',
    count(code, 'liftAltF(') === 2 && count(grab('_stepLift'), 'liftAltF(') === 2);
  t('game.js MUST NOT 手寫塔高倍數(上限只准吃 FLIGHT.ALT_TOP_F;飛行夾制兩處)',
    count(code, 'FLIGHT.ALT_TOP_F') === 2 && !/TARGET_H\.tower \* [0-9]/.test(code));
  // Base rule: sea level when a sea exists, else lowest terrain; missing data returns null ( executes
  // the _liftBaseY source)
  {
    const baseOf = (terrain) =>
      new Function(`return { ${grab('_liftBaseY').trim()} };`)()._liftBaseY.call({ terrain });
    t('有海面 ⇒ 起點 = 海平面(不是地形最低點)', baseOf({ waterY: 0.3, minH: -12 }) === 0.3);
    t('無水域 ⇒ 起點 = 全圖地形最低點', baseOf({ waterY: null, minH: -12 }) === -12);
    t('地形統計全缺 ⇒ null(交給 liftAltF 降級回 1)', baseOf({}) === null && baseOf(null) === null);
  }
}

// ---------------------------------------------------------------------------
console.log('■ Ⅴ 消費端單一縫(game.js:飛行段唯一入口 + 清帳點齊全 + HUD)');
// ---------------------------------------------------------------------------
{
  t('liftDrainPS / liftRegen / liftDescentPS 的唯一消費端 = _stepLift',
    count(code, 'liftDrainPS(') === 1 && count(code, 'liftRegen(') === 1 && count(code, 'liftDescentPS(') === 1
    && /liftDrainPS\(/.test(grab('_stepLift')) && /liftRegen\(/.test(grab('_stepLift')) && /liftDescentPS\(/.test(grab('_stepLift')));
  t('airSinkM 在客戶端的唯一消費端 = _airSinkHit',
    count(code, 'airSinkM(') === 1 && /airSinkM\(/.test(grab('_airSinkHit')));
  // Bots have no client ⇒ the server covers the same rule (the same airSinkM); both damage paths (the
  // fully-blocked early exit + the normal path) MUST hook in — missing the early-exit path reads as
  // "shields up means altitude never drops".
  t('airSinkM 在伺服器的唯一消費端 = _botAirSink(bot 那一半)',
    count(simCode, 'airSinkM(') === 1 && /airSinkM\(/.test(grab('_botAirSink', simSrc)));
  t('_damage 的兩條扣血路徑都呼叫 _botAirSink(含護盾全擋的早退)',
    count(strip(grab('_damage', simSrc)), 'this._botAirSink(') === 2);
  t('_botAirSink 只作用於 bot 的飛行機體(真人由客戶端物理結算,套兩次會打架)',
    /isBotId\(t\.pid\)/.test(grab('_botAirSink', simSrc))
    && /kind === 'drone'/.test(grab('_botAirSink', simSrc)));
  // Authoritative flag for the power cap: single write site = snapshot parsing (beside the line
  // receiving e.mm).
  t('_mpAuth 只在收到快照的 e.mm 時寫 true(建構子那一次 false 不算)',
    count(code, 'this._mpAuth = true') === 1
    && /this\.maxMp = e\.mm \?\? this\.maxMp;[\s\S]{0,120}?this\._mpAuth = true/.test(code)
    && count(code, 'this._mpAuth = false') === 1);
  t('爬升動力不吃 _mpAuth 閘(固定上限,開場即解析)',
    !/this\._mpAuth/.test(grab('_stepLift'))
    && /_liftMax\(\) \{ return liftMax\(\); \}/.test(grab('_liftMax')));
  t('_stepLift 於飛行段與地面段各呼叫一次,且飛行段排在速度積分之前',
    count(code, 'this._stepLift(') === 2
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
  t('失衡戳記只在飛行機體受擊時設置(_stampUnbal)', /this\._stampUnbal\(t\)/.test(simSrc));
  t('失衡命中率減半在伺服器唯一命中處(_missP)結算', /unbalMissP\(p, this\._isUnbalanced\(shooter\)\)/.test(simSrc));
  t('失衡暴擊率減半在伺服器唯一暴擊處(_rollCrit)結算', /UNBAL_CRIT_MUL/.test(simSrc));
  t('飛行動力回充以 _unbalanced 為閘', /if \(!this\._unbalanced\(now\)\)/.test(grab('_stepLift')));
  t('HUD _ccFeed 有失衡警示', /_unbalOn/.test(grab('_ccFeed')));
  t('HUD:全機種皆送 lift 動力數據',
    /lift: \{ v: Math\.max\(0, this\.lift \?\? this\._liftMax\(\)\), max: this\._liftMax\(\) \},/.test(code));
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
  const proto = new Function('FLIGHT', 'airSinkM', 'liftMax', 'liftRegen', 'liftDrainPS', 'liftDescentPS', 'liftAltF', 'UNITS', 'fluidFactor', 'TARGET_H',
    `return ({ ${grab('_unbalanced')}, ${grab('_stepLift')}, ${grab('_airSinkHit')}, ${grab('_liftMax')} });`)(
    FLIGHT, airSinkM, liftMax, liftRegen, liftDrainPS, liftDescentPS, liftAltF, UNITS, fluidFactor, TARGET_H);
  const u = { vspeed: UNITS.drone.vspeed, mpRegen: UNITS.drone.mpRegen };
  const mk = (over = {}) => Object.assign(Object.create(null), proto, {
    maxMp: UNITS.drone.mp, _mpAuth: true, heroKind: 'drone', upg: { ch: 0 }, hud: { feed: () => {} },
    lift: null, _airSink: 0, _airSinkV: 0, _liftLockUntil: 0, unbalLeft: 0, _flying: () => true,
    pos: { y: 0 }, _liftBaseY: () => 0, _ceilY: () => Infinity, ...over,
  });

  // 1 Full-rate climb: full power lasts exactly DRAIN_S seconds
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
  // 2 Half-rate climb: lasts twice as long (drain ∝ climb rate)
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
  // 3 Power empty: upward component zeroes (cannot climb), horizontal and descent fully unaffected
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
  // 4 Recharge cap fixed (identical fleet-wide, no charge track)
  {
    const c = mk({ lift: 0 });
    const hover = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60 * 60; i++) c._stepLift(1 / 60, i / 60, hover, u);
    t('回充夾在統一上限(不會超充)', near(c.lift, FLIGHT.LIFT_MAX, 1e-9), `${c.lift}`);
    t('回滿約 2 × DRAIN_S(固定回速)',
      near(FLIGHT.LIFT_MAX / liftRegen(), FLIGHT.DRAIN_S * 2, 1e-9),
      `${(FLIGHT.LIFT_MAX / liftRegen()).toFixed(1)}s`);
  }
  // 4' First frame at boot: lift = null tops up to the unified cap (fixed value, no power snapshot)
  {
    const boot = mk({ lift: null });
    boot._stepLift(1 / 60, 0, { x: 0, y: 0, z: 0 }, u);
    t('開場第一幀補滿(開場動力條 = 滿格)', near(boot.lift, FLIGHT.LIFT_MAX, 1e-9), `${boot.lift}`);
    t('全機上限相同:變形者不再打折', near(mk({})._liftMax(), FLIGHT.LIFT_MAX, 1e-9));
  }
  // 5 Sink: total drop decided by damage alone (shot count / frame rate change nothing)
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
  // 5' Low-altitude unbalance exemption (2026-10-06 user request: sinking counts as an unbalance
  // effect; low drones neither sink nor lock power)
  {
    const low = mk({ isDrone: true, _altAG: TARGET_H.tower - 1 });
    low._airSinkHit(300, 1.0);
    t('低空無人機被擊中不掉高(掉高是失衡效果)', low._airSink === 0);
    t('低空無人機被擊中不鎖動力', !(1.0 < (low._liftLockUntil || 0)));
    t('低空無人機不受擊失衡(_unbalanced 同判)', low._unbalanced(1.0) === false);
    const high = mk({ isDrone: true, _altAG: TARGET_H.tower + 50 });
    high._airSinkHit(300, 1.0);
    t('高空無人機被擊中照常掉高', high._airSink > 0 && near(high._airSink, airSinkM(300), 1e-6));
    t('高空無人機受擊進入失衡', high._unbalanced(1.0) === true);
    const edge = mk({ isDrone: true, _altAG: TARGET_H.tower });
    edge._airSinkHit(300, 1.0);
    t('恰一個塔高不再豁免(邊界與伺服器 _stampUnbal 同判)', edge._airSink > 0);
  }
  // 6 Power-regen lock after hit-induced sink (2026-09-01 user request: a window with no power regen
  // while descending after a mid-flight hit)
  {
    const c = mk({ lift: 0 });
    c._airSinkHit(100, 1.0);
    c._stepLift(0.1, 1.5, { x: 0, y: 0, z: 0 }, u);
    t('受擊掉高/鎖定窗內動力不回充', c.lift === 0);
    c._airSink = 0;
    c._stepLift(0.1, 1.0 + FLIGHT.HIT_LOCK_S + 0.1, { x: 0, y: 0, z: 0 }, u);
    t('鎖定期結束後恢復回充', c.lift > 0);
  }
  // 7 Normal-operation descent recharges 2/3 power (2026-09-11 user request)
  {
    const dt = 1 / 60;
    // Full-rate descent recharges per second = liftRegen + liftDescentPS
    const cFull = mk({ lift: 0 });
    const fullDown = { x: 0, y: -u.vspeed, z: 0 };
    cFull._stepLift(dt, 0, fullDown, u);
    const expectedFull = (liftRegen() + liftDescentPS()) * dt;
    t('正常操作全速下降:回充量 = (liftRegen + liftDescentPS) * dt',
      near(cFull.lift, expectedFull, 1e-6), `${cFull.lift} vs ${expectedFull}`);

    // Half-rate descent: potential-energy recharge halves per second
    const cHalf = mk({ lift: 0 });
    const halfDown = { x: 0, y: -u.vspeed * 0.5, z: 0 };
    cHalf._stepLift(dt, 0, halfDown, u);
    const expectedHalf = (liftRegen() + liftDescentPS() * 0.5) * dt;
    t('正常操作半速下降:位能回充量折半(正比於下降率)',
      near(cHalf.lift, expectedHalf, 1e-6), `${cHalf.lift} vs ${expectedHalf}`);

    // Descent recharges faster than hover
    const cHover = mk({ lift: 0 });
    cHover._stepLift(dt, 0, { x: 0, y: 0, z: 0 }, u);
    t('下降回充速度大於純懸停(位能回充加成)', cFull.lift > cHover.lift * 2);

    // Descent's potential-energy increment is exactly 2/3 of full-rate climb drain
    const descContribution = cFull.lift - cHover.lift;
    const climbDrainPerDt = liftDrainPS() * dt;
    t('下降每公尺回充之動力 = 爬升該公尺耗電之 2/3 (DESCENT_RECHARGE_F)',
      near(descContribution / climbDrainPerDt, FLIGHT.DESCENT_RECHARGE_F, 1e-6));

    // No recharge on normal-operation descent during hit-unbalance (outside the normal-operation window)
    const cUnbal = mk({ lift: 0 });
    cUnbal._airSinkHit(100, 1.0);
    cUnbal._stepLift(dt, 1.05, fullDown, u);
    t('受擊失衡/受傷鎖定期間下降不回充(非正常操作)', cUnbal.lift === 0);
  }
  // 8 Same-rate climb costs more power higher up (exponential; 2026-10-06 user request: doubling per
  // tower height, capped 8x at 3 tower heights)
  {
    const H = TARGET_H.tower, dt = 0.5;
    const drainRate = (y) => {
      const c = mk({ pos: { y } });
      const before = c.lift ?? c._liftMax();
      c._stepLift(dt, 0, { x: 0, y: u.vspeed, z: 0 }, u);
      return (before - c.lift) / dt;
    };
    const dLo = drainRate(0), dMid = drainRate(H), dHi = drainRate(3 * H);
    t('同速爬升:高處比低處耗動力多(指數,非階梯)',
      dHi > dMid && dMid > dLo, `${dLo.toFixed(2)} / ${dMid.toFixed(2)} / ${dHi.toFixed(2)}`);
    t('每多一個塔高翻倍',
      near(dMid / dLo, 2, 1e-9) && near(drainRate(2 * H) / dLo, 4, 1e-9),
      `${(dMid / dLo).toFixed(3)} / ${(drainRate(2 * H) / dLo).toFixed(3)}`);
    t('3 個塔高封頂 = 8 倍',
      near(dHi / dLo, 8, 1e-9), `${(dHi / dLo).toFixed(3)} vs 8`);
    t('封頂以上維持 8 倍(平台連續,山區稜線飛得過去)',
      near(drainRate(10 * H) / dLo, 8, 1e-9));
    t('起點耗速 = 既有 liftDrainPS(高度錨點不動,DRAIN_S 節奏不變)',
      near(dLo, liftDrainPS(), 1e-9));
    // Behavior version of the base rule: same relative height costs the same whether counted from sea
    // level or the lowest point
    const drainBase = (y, base) => {
      const c = mk({ pos: { y }, _liftBaseY: () => base });
      const before = c.lift ?? c._liftMax();
      c._stepLift(dt, 0, { x: 0, y: u.vspeed, z: 0 }, u);
      return (before - c.lift) / dt;
    };
    t('起點以下與起點同價(夾邊連續)', near(drainBase(-20, 10), drainBase(10, 10), 1e-12));
    t('相對高度相同 ⇒ 耗速相同(海平面/最低點起算同一條)',
      near(drainBase(60, 10), drainBase(160, 110), 1e-9));
    // Descent recharge rides the same curve: same descent rate returns more from higher up, and the
    // "returned/spent = 2/3" ratio holds at every altitude
    const rechargeRate = (y) => {
      const c = mk({ lift: 0, pos: { y } });
      c._stepLift(dt, 0, { x: 0, y: -u.vspeed, z: 0 }, u);
      return c.lift / dt;
    };
    const hoverRate = (y) => {
      const c = mk({ lift: 0, pos: { y } });
      c._stepLift(dt, 0, { x: 0, y: 0, z: 0 }, u);
      return c.lift / dt;
    };
    const rLo = rechargeRate(0), rHi = rechargeRate(3 * H);
    t('同速下降:高處比低處回充多(與爬升同一條曲線)',
      rHi > rLo, `${rLo.toFixed(2)} vs ${rHi.toFixed(2)}`);
    for (const [y, tag] of [[0, '起點'], [H, '一個塔高'], [3 * H, '封頂']]) {
      const extra = rechargeRate(y) - hoverRate(y);   // potential-energy recharge at this height (minus hover baseline)
      const drain = drainRate(y);                        // climb drain at the same height
      t(`${tag}:下降位能回充 = 爬升耗速 × 2/3(同曲線 ⇒ 比例處處成立)`,
        near(extra / drain, FLIGHT.DESCENT_RECHARGE_F, 1e-9),
        `${extra.toFixed(2)} / ${drain.toFixed(2)}`);
    }
  }
  // 9 Morph climb/sink rates: up = drone x 2/3, down = drone x 3/2 (derived, never hand-written)
  {
    t('MORPH.UP_F = 2/3、DOWN_F = 3/2', MORPH.UP_F === 2 / 3 && MORPH.DOWN_F === 3 / 2);
    t('變形者 vspeed 由無人機 vspeed 推導(MUST NOT 手寫公尺數)',
      /vspeed: UNITS\.drone\.vspeed \* MORPH\.UP_F/.test(dataSrc)
      && near(UNITS.morph.vspeed, UNITS.drone.vspeed * 2 / 3, 1e-9),
      `${UNITS.morph.vspeed} vs ${UNITS.drone.vspeed}`);
    t('變形者 vdown 由無人機 vspeed 推導(無此欄者回退 vspeed)',
      /vdown: UNITS\.drone\.vspeed \* MORPH\.DOWN_F/.test(dataSrc)
      && near(UNITS.morph.vdown, UNITS.drone.vspeed * 3 / 2, 1e-9)
      && UNITS.drone.vdown === undefined,
      `${UNITS.morph.vdown} vs ${UNITS.drone.vspeed}`);
    t('vdown 吃 COMBAT_SCALE 縮放(與 vspeed 同表)',
      /'fly', 'vspeed', 'vdown', 'jump'/.test(dataSrc));
    t('game.js 下降吃 vdown(回退 vspeed):飛行分支 + _stepLift 歸一化各一處',
      count(code, 'vdown') === 2
      && /target\.y -= \(u\.vdown \?\? u\.vspeed\)/.test(code)
      && /-target\.y \/ dnV/.test(grab('_stepLift'))
      && /target\.y \/ upV/.test(grab('_stepLift')));
    // Behavior: morphs at full climb likewise last DRAIN_S seconds (drain normalized to their own rate);
    // full descent recharge follows the same 2/3
    const um = { vspeed: UNITS.morph.vspeed, vdown: UNITS.morph.vdown };
    const cm = mk();
    {
      const dt = 1 / 60;
      let s = 0;
      for (let i = 0; i < 60 * 30; i++) {
        const target = { x: 0, y: um.vspeed, z: 0 };
        cm._stepLift(dt, i * dt, target, um);
        if (target.y <= 0) break;
        s += dt;
      }
      t(`變形者全速爬升同樣撐 DRAIN_S(實測 ${s.toFixed(2)}s)`, Math.abs(s - FLIGHT.DRAIN_S) <= 2 * dt);
    }
    {
      const dt = 1 / 60;
      const cM = mk({ lift: 0 });
      cM._stepLift(dt, 0, { x: 0, y: -um.vdown, z: 0 }, um);
      const cH = mk({ lift: 0 });
      cH._stepLift(dt, 0, { x: 0, y: 0, z: 0 }, um);
      const drain = liftDrainPS() * dt;
      t('變形者全速下降位能回充 = 爬升耗速 × 2/3',
        near((cM.lift - cH.lift) / drain, FLIGHT.DESCENT_RECHARGE_F, 1e-6));
    }
  }
}

console.log(`\n${fail ? '❌' : '✅'} 飛行動力學 / 絕招載具 HP 校準稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
