// ============ 飛行動力學(爬升動力 + 受擊掉高)+ 機種絕招載具 HP 校準 稽核 ============
// 用途:改 `data.js` 的 `FLIGHT`/`airSinkM`/`liftMax`/`liftRegen`/`liftDrainPS`/`HYPER`/`towerDps`/
//      `kamiHp`/`hyperHp`/`decoyHp`/`kamiSide`,或 `game.js` 的 `_stepLift`/`_airSinkHit`/
//      `_updatePlayer` 飛行段/`_fireHoldAbility`/`_tryFire` 之後跑。跑法:`node tools/audit_flight_power.mjs`
//
// 三條規則共用一支稽核,因為破法都一樣**無聲**:
//   ①**機種絕招的載具 HP 一律由「前線一組塔位打幾秒」反解**(2026-08-01 使用者定調的三句話,
//      2026-08-02 由 bal ⑦f 把尺從「一座孤塔」換成前線真正的火力 = 同塔位雙塔):
//      飽和攻擊 4 架、剛好擊落 2 架;極音速飛彈剛好打不爆(它飛越整條前線 ⇒ 另計一波兵);
//      集束轟炸機剛好投得完 5+1 顆。
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
// 原文一律經 `audit_src.mjs readSrc()`(換行正規化):本檔逐行剝註解 + 「全檔只有 N 處」計數,
// 而 `//.*$` 在 CRLF 檢出的工作區靜默失效 ⇒ 註解裡的名字會被算進單一縫計數(同一份程式碼
// LF 全綠、Windows 紅字)。MUST NOT 退回自己 `readFileSync`(§5 通則 ㋑)。
import { readSrc } from './audit_src.mjs';
import {
  FLIGHT, airSinkM, liftMax, liftRegen, liftDrainPS,
  SQUAD, TARGET_H, UNITS, CHARACTERS, ECON, chargeF,
  HYPER, DECOY, LANCE, lanceR, towerDps, towerSurviveHp, towerKillHp,
  kamiHp, kamiExposureS, kamiSide, hyperHp, hyperFlightS, hyperApex, hyperRange, decoyHp, decoyExposureS,
  hyperArcY, hyperClimbVx, hyperClimbS, hyperTrackR, hyperClimbLen, hyperTerminalF,
  TOWER_SITE_N, frontKillHp, overflySurviveHp, waveDps, waveComp, blastFootprintR,
  kamiBlast, decoyBlast, decoyBombBlast, hyperBlast,
  SPECIAL, specialBudget, specialBlastR, hyperShare,
  GAME,
} from '../public/js/data.js';

const src = readSrc('public', 'js', 'game.js');
const dataSrc = readSrc('public', 'js', 'data.js');
const simSrc = readSrc('server', 'sim.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const css = readSrc('public', 'css', 'style.css');
const html = readSrc('public', 'index.html');

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

  // —— 飽和攻擊:4 架、一座砲塔剛好擊落 SHOT_DOWN 架 ——
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
    // 2026-08-06 使用者定案「拿掉常駐模組,攻擊時再出現」⇒ 客戶端貼身站位那一個消費端整組退場
    // (`ESCORT`/`escortSlot`/`_buildDroneEscorts`/`_updateEscorts`),kamiSide 只剩伺服器一個消費端。
    t('kamiSide 只剩伺服器生成側偏移一個消費端,MUST NOT 復辟 `const s = i === 0 ? -1 : 1`',
      /const s = kamiSide\(i\);/.test(simCode)
      && !/const s = i === 0 \? -1 : 1/.test(simCode) && !/const s = i === 0 \? -1 : 1/.test(code));
    t('常駐護衛機外觀已退場(客戶端零殘留:模型/每幀擺位/ESCORT 常數)',
      !/escort|ESCORT/i.test(code) && !/ESCORT|escortSlot|escortDrift|escortLag/.test(dataSrc.replace(/\/\/.*$/gm, '')));
  }

  // —— 極音速飛彈:45° 拋物線爬升 + 撐得住最長一次飛行 ——
  // 2026-08-02 使用者定案彈道:「前半段拋物線飛向高空,初始角度 45 度,後半段再以極快速度
  // 向下螺旋飛向目標」⇒ 頂點高不再是常數,而是「發射角 × 交戰距離」的推導值。
  t('hyperApex / hyperRange / hyperFlightS 全由已縮好的量推導(MUST NOT 手寫遊戲公尺)',
    /export const hyperApex = \(d = hyperRange\(\)\) => d \* Math\.tan\(hyperLaunchRad\(\)\) \/ 2;/.test(dataSrc)
    && /export const hyperRange = \(\) => UNITS\.tower\.range \* HYPER\.RANGE_F;/.test(dataSrc)
    && /hyperClimbS\(hyperRange\(\)\) \+ hyperApex\(\) \/ hyperDiveSpd\(\)/.test(dataSrc));
  t('曝險窗基準 = **原軌跡**(爬升 + 垂直落下),MUST NOT 改吃追擊斜距 —— 追擊是「打得到人」的加分,'
    + '連生存性也加成會把 bal ⑦f 的三招實得比推到 1.93×(實測)',
    near(hyperFlightS(), hyperClimbS(hyperRange()) + hyperApex() / (HYPER.CLIMB_SPD * HYPER.DIVE_F))
    && !/Math\.hypot\(hyperApex\(\), hyperTrackR\(\)\)/.test(dataSrc));
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

  // —— 終端追擊有射程(2026-08-05 使用者定案)——
  // 「前 2/3 飛往發射時目標的初始地點;後 1/3 只有目標仍在砲塔射程 1/2 內才螺旋追擊,
  //   否則保持原軌跡」。破法全無聲:判定半徑手寫(改砲塔射程就分家)、爬升段偷讀即時位置
  //   (頂點被拉走 = 拋物線不成立)、逐 tick 重判(最後零點幾秒彈道整條折斷)。
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
  // 客戶端只插值伺服器回報的位置(`b.chase` 是射後不理**彈體**的追擊燃料旗標,與這一招無關)
  t('客戶端不參與追擊判定(彈道與命中全在伺服器)',
    !/hyperTrackR/.test(code) && !/m\.chase|hyperChase/.test(code));
  t('爬升頂點高過直射鎖定天花板(是「高空」不是抬個頭)', hyperApex() > GAME.GUN_CEIL_M);
  t('接戰距離大於砲塔射程(機甲的攻塔手段)', hyperRange() > UNITS.tower.range);
  t('俯衝遠快於爬升(「極音速」那一段幾乎攔不住)', HYPER.DIVE_F > 2);
  t('hyperHp = overflySurviveHp(最長飛行時間)⇒ 飛越整條前線剛好打不爆',
    hyperHp() === overflySurviveHp(hyperFlightS())
    && hyperHp() > (towerDps() * TOWER_SITE_N + waveDps()) * hyperFlightS());
  t('「剛好」不是「綽綽有餘」:餘裕 < 一發塔砲',
    hyperHp() - (towerDps() * TOWER_SITE_N + waveDps()) * hyperFlightS() < towerDps());
  // —— 火力 / 範圍改制(2026-08-06 使用者定案:2.5 架自爆無人機的傷害 / 砲塔射程 2/5 的爆風)——
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

  // —— 集束炸彈:撐到投完 DROP_N 顆 ——
  t('BOMB_MAX = 6 且 DROP_N + 墜毀補投 1 顆 = BOMB_MAX(使用者定調的 5+1)',
    DECOY.BOMB_MAX === 6 && DECOY.DROP_N + 1 === DECOY.BOMB_MAX);
  t('舊 DECOY.HP_F(主機血量比例)已退場', DECOY.HP_F === undefined);
  t('decoyExposureS = 接近時間 + (DROP_N − 0.5) 個投彈間隔(半個間隔的餘量也是推導,不手寫秒數)',
    near(decoyExposureS(),
      Math.max(0, UNITS.tower.range - DECOY.BOMB_R) / DECOY.SPEED + (DECOY.DROP_N - 0.5) * DECOY.BOMB_GAP));
  // 行為直測:曝險窗內剛好投得出第 DROP_N 顆、且撐不到第 DROP_N+1 顆
  {
    const live = decoyHp() / (towerDps() * TOWER_SITE_N);
    const approach = Math.max(0, UNITS.tower.range - DECOY.BOMB_R) / DECOY.SPEED;
    const dropped = 1 + Math.floor((live - approach) / DECOY.BOMB_GAP + 1e-9);
    t('前線一組塔位火力下剛好投出 DROP_N 顆 + 墜毀補投 1 顆 = BOMB_MAX',
      dropped === DECOY.DROP_N && dropped + 1 === DECOY.BOMB_MAX, `實得 ${dropped} + 1`);
  }
  // 行為直測:前線一組塔位在曝險窗內剛好擊落 SHOT_DOWN 架
  {
    const downed = Math.floor(kamiExposureS() / (kamiHp() / (towerDps() * TOWER_SITE_N)) + 1e-9);
    t('前線一組塔位在曝險窗內剛好擊落 SHOT_DOWN 架、其餘成功自爆',
      downed === SQUAD.KAMI.SHOT_DOWN, `實得 ${downed} 架`);
  }
  t('decoyHp = frontKillHp(曝險窗)', decoyHp() === frontKillHp(decoyExposureS()));
  // —— 校準基準:前線一組塔位(2026-08-02 由 bal ⑦f 定案)——
  t('前線基準 = 同塔位雙塔,且 front* 由 tower* 推導(MUST NOT 各寫一份 dps)',
    TOWER_SITE_N === 2
    && /export const frontSurviveHp = \(sec\) => towerSurviveHp\(sec \* TOWER_SITE_N\);/.test(dataSrc)
    && /export const frontKillHp = \(sec\) => towerKillHp\(sec \* TOWER_SITE_N\);/.test(dataSrc));
  t('waveDps 由 waveComp 推導(飛越前線的載具才另計這一份)',
    near(waveDps(), waveComp().reduce((s, k) => s + UNITS[k].dmg * UNITS[k].rate, 0))
    && /export const waveDps = \(\) => waveComp\(\)\.reduce\(/.test(dataSrc));
  t('三個 HP 全部走同一把前線的尺(MUST NOT 有人還留在單塔基準)',
    !/= towerKillHp\(kamiExposureS|= towerSurviveHp\(hyperFlightS|= towerKillHp\(decoyExposureS/.test(dataSrc));
  // —— 爆風半徑的面積計價:總覆蓋面積與「切成幾顆」無關(2026-08-06 火力改制**不動**這一條)——
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
  // ---- 機種絕招的客戶端入口(2026-08-06 第二階段:長按右鍵改成招式手勢)整組退場 ----
  // 舊制三支 _launchKamikaze / _launchDecoy / _launchHyper 是「機種分派表」的三個葉子;
  // 機種絕招退場之後分派表本身也沒有東西可派 ⇒ A22 那條縫改由 data.js `abilHoldSlot` 表達
  // **模式**分流(一般 = 小招 / 狙擊 = 大招)。留一支在原文裡就是一顆按了沒反應的鈕
  //(伺服器連對應的訊息都不再受理),而畫面上只表現成「這台機體的長按壞了」。
  for (const m of ['_launchKamikaze', '_launchDecoy', '_launchHyper']) {
    t(`game.${m} 已整組退場(MUST NOT 復辟)`, !new RegExp(`\\n  ${m}\\(`).test(code));
  }
  t('客戶端不再送 kami / decoy / hyper 三條機種絕招訊息(一律走 t:\'cast\' 單一縫)',
    !/t: 'kami'|t: 'decoy'|t: 'hyper'/.test(code));
  t('長按派發縫仍只有一處(_fireHoldAbility),且不再有機種分派表',
    /_castAbility\(abilHoldSlot\(this\.aiming\)\)/.test(grab('_fireHoldAbility', code))
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
  // 電力上限的權威旗標:唯一寫入點 = 快照解析(收到 e.mm 那一行旁邊)。自己在別處補 true
  // 就等於又拿佔位值當上限,而症狀只是「開場動力條是空的」,沒有任何錯誤訊息。
  t('_mpAuth 只在收到快照的 e.mm 時寫 true(建構子那一次 false 不算)',
    count(code, 'this._mpAuth = true') === 1
    && /this\.maxMp = e\.mm \?\? this\.maxMp;[\s\S]{0,120}?this\._mpAuth = true/.test(code)
    && count(code, 'this._mpAuth = false') === 1);
  t('_stepLift 與 _liftMax 都以 _mpAuth 為閘(未定案 = 視同滿動力,不扣不夾)',
    /if \(!this\._mpAuth\) return;/.test(grab('_stepLift'))
    && /this\._mpAuth && this\.maxMp/.test(grab('_liftMax')));
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
    maxMp: UNITS.drone.mp, _mpAuth: true, heroKind: 'drone', upg: { ch: 0 }, hud: { feed: () => {} },
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
  // ④' 電力上限未定案(開場第一幀):MUST 視同滿動力,MUST NOT 拿建構子佔位的 maxMp 去夾
  //     ——夾了就是「無人機一出場動力條是空的,只能靠回充慢慢爬回上限」(2026-08-03 使用者回報)
  {
    const boot = mk({ _mpAuth: false, maxMp: 1, lift: null });
    const up = { x: 0, y: u.vspeed, z: 0 };
    for (let i = 0; i < 60 * 3; i++) boot._stepLift(1 / 60, i / 60, { x: 0, y: u.vspeed, z: 0 }, u);
    boot._stepLift(1 / 60, 3, up, u);
    t('上限未定案:不解析動力(lift 維持 null = 滿)', boot.lift === null);
    t('上限未定案:爬升不被擋(寧可放行,不可誤鎖)', up.y === u.vspeed);
    t('上限未定案:_liftMax 退回機種基準電力,MUST NOT 吃佔位的 maxMp',
      near(boot._liftMax(), liftMax(UNITS.drone.mp, false), 1e-9), `${boot._liftMax()}`);
    boot._mpAuth = true; boot.maxMp = UNITS.drone.mp;
    boot._stepLift(1 / 60, 4, { x: 0, y: 0, z: 0 }, u);
    t('上限定案的第一幀補滿(開場動力條 = 滿格)', near(boot.lift, boot._liftMax(), 1e-9), `${boot.lift}`);
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
