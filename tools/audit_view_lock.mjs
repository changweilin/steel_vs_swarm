// ============ 視野鎖定稽核(觸控 ZR 按住鎖定目標;2026-08-01 使用者需求)============
// 用途:改 `data.js VIEW_LOCK`/`viewLockStep`、`game.js _tickViewLock`/`_coneAcquire`/`_entAimPoint`、
// 或觸控鍵位(index.html #touchLayer、mobile.js HOLD、help.js 文案)之後跑這一支。
// 跑法:`node tools/audit_view_lock.mjs [-v]`(純原文 + 純函式直測,不需瀏覽器/外網)
//
// 這支要釘住的**四件事**(每一件壞掉都不會報錯,只會「手感怪」或「靜默沒反應」):
//   Ⅰ 常數與推導:DROP > CONE(遲滯 —— 取得窄、脫鎖寬,否則目標一跑動就忽鎖忽脫)、
//     每幀轉角只有 `viewLockStep` 一份實作,game.js MUST NOT 手寫 W/EASE。
//   Ⅱ **後座力不得被抵銷**(使用者指定「還是會有後座力」):鎖定只准經 `_applyLook` 改基準角
//     yaw/pitch;相機角 = 基準角 + `recoil` + 震動的合成 MUST 原封不動。
//     無聲寫壞法 = 在 `_tickViewLock` 裡直接設 `camera.rotation` / `lookAt()` / 扣掉 `this.recoil`
//     —— 畫面會「鎖得很死」,而玩家再也感覺不到每一發的上踢。
//   Ⅲ 收斂行為直測(`viewLockStep` 純函式):不瞬移(單幀 ≤ W·dt)、不過衝、不隨幀率漂移。
//   Ⅳ 鍵位與單一縫:ZR = 鎖定(按住型)、機種絕招搬到十字鍵左且仍只有一個派發縫、
//     目標解析只有 `_coneAcquire` 一份、瞄準點只有 `_entAimPoint` 一份。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VIEW_LOCK, viewLockStep } from '../public/js/data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const dataSrc = read('public', 'js', 'data.js');
const gameSrc = read('public', 'js', 'game.js');
const mobileSrc = read('public', 'js', 'mobile.js');
const htmlSrc = read('public', 'index.html');
const helpSrc = read('public', 'js', 'help.js');
const cssSrc = read('public', 'css', 'style.css');

const verbose = process.argv.includes('-v');
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; if (verbose) console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
};
const sec = (t) => console.log(`\n▍${t}`);
/** 取出某個方法的原文(從 `  <name>(` 起算到下一個同縮排的方法定義) */
const body = (src, name) => {
  const i = src.indexOf(`\n  ${name}(`);
  if (i < 0) return '';
  const rest = src.slice(i + 3);
  const j = rest.search(/\n  [_A-Za-z$][\w$]*\(/);
  return j < 0 ? rest : rest.slice(0, j);
};
const count = (src, re) => (src.match(re) || []).length;

// ── Ⅰ 常數與推導 ────────────────────────────────────────────────
sec('Ⅰ 常數與單一縫');
ok(VIEW_LOCK.DROP > VIEW_LOCK.CONE,
  `遲滯:脫鎖錐 DROP(${VIEW_LOCK.DROP})MUST > 取得錐 CONE(${VIEW_LOCK.CONE})`);
ok(VIEW_LOCK.CONE > 0 && VIEW_LOCK.CONE < Math.PI / 2,
  '取得錐 CONE ∈ (0, 90°):鎖背後的敵人不是「準星最近的目標」');
ok(VIEW_LOCK.W > 0 && VIEW_LOCK.EASE > 0, '角速度上限 W 與逼近係數 EASE 皆為正');
ok(/export const viewLockStep/.test(dataSrc), '每幀轉角唯一縫 `viewLockStep` 住 data.js');
ok(count(gameSrc, /viewLockStep\(/g) === 2,
  'game.js 兩軸(yaw/pitch)都吃 viewLockStep,且只有這兩處');
const tick = body(gameSrc, '_tickViewLock');
ok(tick.length > 0, 'game.js 有 `_tickViewLock`');
ok(!/VIEW_LOCK\.(W|EASE)/.test(tick),
  '`_tickViewLock` MUST NOT 自己拿 W/EASE 算步長(推導值手寫 = 與稽核的直測分家)');
ok(/VIEW_LOCK\.CONE/.test(tick) && /VIEW_LOCK\.DROP/.test(tick),
  '取得/脫鎖錐角由 VIEW_LOCK 供給,MUST NOT 在 game.js 手寫弧度');

// ── Ⅱ 後座力刻意不抵銷 ──────────────────────────────────────────
sec('Ⅱ 後座力不得被抵銷(使用者指定)');
ok(/this\._applyLook\(viewLockStep\(/.test(tick),
  '鎖定只經 `_applyLook`(視角套用唯一縫)改基準角 yaw/pitch');
ok(!/camera\.(rotation|quaternion|lookAt|rotateX|rotateY)/.test(tick),
  '`_tickViewLock` MUST NOT 直接動相機朝向 —— 那會把後座力與鏡頭震動一起吃掉');
ok(!/recoil/.test(tick),
  '`_tickViewLock` MUST NOT 讀寫 `recoil`(補償後座力 = 玩家再也感覺不到上踢)');
ok(/this\.camera\.rotateY\(this\.yaw \+ this\.recoil\.y/.test(gameSrc)
  && /this\.camera\.rotateX\(this\.pitch \+ this\.recoil\.p/.test(gameSrc),
  '相機合成仍是「基準角 + recoil + 震動」—— 鎖定期間每一發照樣上踢、照樣要等回穩');
const upd = gameSrc.slice(gameSrc.indexOf('\n  _updatePlayer('));
const iTick = upd.indexOf('this._tickViewLock(');
const iCam = upd.indexOf('this.camera.rotateY(this.yaw');
ok(iTick > 0 && iCam > 0 && iTick < iCam,
  '`_tickViewLock` MUST 排在相機合成之前(晚一步 = 鎖定慢半拍)');
// `_updatePlayer` 對 dead 早退 ⇒ 陣亡的清帳 MUST 另外掛在 `_onSelfDeath`(比照 `_clearCcFlash`),
// 漏掉的話鈕面亮燈會一路留到重生後(狀態顯示與實際鎖定分家)。
ok(/_setVlockUi\(false\)/.test(body(gameSrc, '_onSelfDeath')),
  '陣亡清帳:`_onSelfDeath` MUST 清掉鎖定目標與鈕面亮燈');
ok(/_setVlockUi\(false\)/.test(body(gameSrc, 'dispose')),
  '離場清帳:`dispose` MUST 清掉鈕面亮燈(留著 = 下一局開場就亮)');

// ── Ⅲ 收斂行為直測 ──────────────────────────────────────────────
sec('Ⅲ 收斂行為(viewLockStep 直測)');
{
  const dt = 1 / 60;
  ok(Math.abs(viewLockStep(Math.PI, dt)) <= VIEW_LOCK.W * dt + 1e-12,
    '大角度差:單幀轉角 ≤ W·dt(不瞬移吸附)');
  ok(viewLockStep(-Math.PI, dt) === -viewLockStep(Math.PI, dt), '左右對稱');
  const small = 0.02;
  ok(Math.abs(viewLockStep(small, dt)) < VIEW_LOCK.W * dt,
    '小角度差:貼近時步長遠小於上限(貼臉不抖)');
  ok(Math.abs(viewLockStep(small, dt)) <= Math.abs(small),
    '單幀 MUST NOT 轉過頭(過衝 = 準星在目標兩側來回擺)');
  // 收斂:1.2 rad 差 → 1 秒內收斂到 < 0.01 rad,且全程不變號(不過衝)
  let d = 1.2, sign = 0, over = false;
  for (let i = 0; i < 60; i++) {
    const s = viewLockStep(d, dt);
    if (sign === 0) sign = Math.sign(s);
    if (Math.sign(s) !== sign && s !== 0) over = true;
    d -= s;
  }
  ok(Math.abs(d) < 0.01, `1.2 rad 差在 1 秒內收斂(剩 ${d.toFixed(4)} rad)`);
  ok(!over, '收斂全程不變號(無過衝振盪)');
  // 幀率無關:60fps 與 240fps 跑同樣 1 秒,殘差 MUST 接近(離散化差異 < 0.02 rad)
  const run = (fps) => {
    let e = 1.2;
    for (let i = 0; i < fps; i++) e -= viewLockStep(e, 1 / fps);
    return e;
  };
  const e60 = run(60), e240 = run(240);
  ok(Math.abs(e60 - e240) < 0.02,
    `幀率無關:60fps 殘差 ${e60.toFixed(4)} vs 240fps ${e240.toFixed(4)}`);
  ok(viewLockStep(0.5, 0) === 0, 'dt=0 不轉(暫停幀不會偷轉視角)');
}

// ── Ⅳ 鍵位與消費端單一縫 ────────────────────────────────────────
sec('Ⅳ 鍵位與單一縫');
ok(/data-act="lock"/.test(htmlSrc) && count(htmlSrc, /data-act="lock"/g) === 1,
  '視野鎖定鈕恰好一顆(index.html)');
ok(/class="tl-sysb"[^>]*data-act="lock"/.test(htmlSrc), '鎖定鈕住系統鍵直條(扳機位 ZR)');
ok(/ZR 鎖定/.test(htmlSrc), '鈕面字樣寫明是 ZR');
ok(/const HOLD = new Set\(\[[^\]]*'lock'/.test(mobileSrc),
  'mobile.js 把 lock 列為**按住型**(放開才解鎖,不是點一下切換)');
// 絕招:從 ZR 搬到十字鍵左,但派發縫不變(A22)
ok(count(htmlSrc, /data-act="special"/g) === 1, '機種絕招鈕恰好一顆');
ok(/tl-dp-b[^>]*data-act="special"/.test(htmlSrc), '機種絕招搬到十字鍵(.tl-dp-b)');
ok(/data-act="special"[^>]*>[^<]*<span class="gb-cd">/.test(htmlSrc),
  '絕招鈕面仍帶 .gb-cd(padMirror 鏡射冷卻秒數)');
ok(/case 'special': if \(down\) this\._fireHoldAbility\(\);/.test(gameSrc),
  'A22:絕招仍只有 `_fireHoldAbility` 一個派發縫(換了鈕不等於換了實作)');
ok(!/\.reserved/.test(cssSrc) && !/reserved/.test(htmlSrc),
  '十字鍵左已接上功能 ⇒ 舊的 .reserved 佔位樣式/標記整條拔掉(不留死鍵)');
// _cmd:lock MUST 排在 dead 閘之前(陣亡瞬間的放開事件被吃掉 = 重生後視角自己黏著目標)
const cmd = body(gameSrc, '_cmd');
ok(/act === 'lock'/.test(cmd), '`_cmd` 受理 lock');
ok(cmd.indexOf("act === 'lock'") < cmd.indexOf('if (this.dead)'),
  'lock 的受理 MUST 排在 `dead` 閘之前(比照 fire:放開事件不可被吃掉)');
// 目標解析與瞄準點各只有一份實作
ok(count(gameSrc, /\n  _coneAcquire\(/g) === 1, '錐形索敵 `_coneAcquire` 只有一份實作');
ok(/this\._coneAcquire\(/.test(tick), '視野鎖定的目標解析走 `_coneAcquire`(不另寫掃描)');
ok(!/for \(const ent of this\.ents\.values\(\)\)/.test(tick),
  '`_tickViewLock` MUST NOT 自己掃全場實體(第二份「誰最正對準星」必定與鎖定光暈分家)');
// 瞄準點:索敵與鎖定 MUST 同吃 `_entAimPoint` —— 兩邊各寫一次就會「鎖得到卻瞄到腳邊」。
// (自動索敵/對空火控另有各自的瞄準點,錨的是快照內插座標而非 mesh,不在這條的射程內。)
ok(count(gameSrc, /\n  _entAimPoint\(/g) === 1, '瞄準點 `_entAimPoint` 只有一份實作');
ok(/this\._entAimPoint\(/.test(body(gameSrc, '_coneAcquire')) && /this\._entAimPoint\(/.test(tick),
  '索敵與視野鎖定同吃 `_entAimPoint`,兩處都 MUST NOT 自己內插機體中心');
ok(!/dimTop/.test(tick) && !/dimTop/.test(body(gameSrc, '_coneAcquire')),
  '兩個消費端都沒有第二份 dimTop/dimH 算式');
ok(/def\.range \* this\._altRangeMul\(def\)/.test(tick),
  '可鎖距離與 `_tickLock` 同一把尺(射程 × 高度制空)');
// 亮燈狀態:唯一真相在 game.js,經 body class 落到鈕面(觸控層不自己記一份)
ok(/document\.body\.classList\.toggle\('vlock'/.test(gameSrc)
  && /body\.vlock \.tl-sysb\[data-act="lock"\]/.test(cssSrc),
  '鎖定亮燈 = body class(比照 body.mm-near),觸控層不必自己記狀態');
ok(!/vlock/.test(mobileSrc), 'mobile.js MUST NOT 自己判鎖定狀態(A1 家族:狀態只有一個來源)');
// A21:裝置分支文案只住 help.js
ok(/ZR/.test(helpSrc) && /視野鎖定/.test(helpSrc), 'help.js 有視野鎖定的觸控說明(A21)');
ok(/pTouch[^\n]*ZR 鎖定|按住 ZR/.test(helpSrc), 'help.js 寫明「按住」才生效');
ok(/後座力/.test(helpSrc), 'help.js 說明「後座力仍然存在」(避免玩家以為壞了)');

console.log(fail
  ? `\n✗ 視野鎖定稽核:${fail} 項未通過(共 ${pass + fail})`
  : `\n✓ 視野鎖定稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
