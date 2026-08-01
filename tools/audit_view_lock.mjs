// ============ 視野鎖定稽核(觸控 ZR 按住鎖定目標;2026-08-01 使用者需求)============
// 用途:改 `data.js VIEW_LOCK`/`viewLockStep`、`game.js _tickViewLock`/`_coneAcquire`/`_entAimPoint`、
// 或觸控鍵位(index.html #touchLayer、mobile.js HOLD、help.js 文案)之後跑這一支。
// 跑法:`node tools/audit_view_lock.mjs [-v]`(純原文 + 純函式直測,不需瀏覽器/外網)
//
// 2026-08-02 改制(使用者定案「按 ZR 時會輪流切換前方視野內看見的所有敵人,狙擊模式時以狙擊鏡視野為主」):
// 取景從準星錐換成**視野框**(一般 = 畫面矩形、狙擊 = `SCOPE` 鏡圈),按一次輪替一個。
//
// 這支要釘住的**四件事**(每一件壞掉都不會報錯,只會「手感怪」或「靜默沒反應」):
//   Ⅰ 常數與推導:DROP > EDGE(遲滯 —— 取得只認畫面內、脫鎖放寬一截,否則目標貼邊跑就忽鎖忽脫)、
//     鏡圈半徑只有 `scopeRvmin` 一份(CSS 遮罩與鎖定取景同吃 ⇒ 黑掉的地方鎖不到)、
//     每幀轉角只有 `viewLockStep` 一份實作,game.js MUST NOT 手寫 W/EASE。
//   Ⅱ **後座力不得被抵銷**(使用者指定「還是會有後座力」):鎖定只准經 `_applyLook` 改基準角
//     yaw/pitch;相機角 = 基準角 + `recoil` + 震動的合成 MUST 原封不動。
//     無聲寫壞法 = 在 `_tickViewLock` 裡直接設 `camera.rotation` / `lookAt()` / 扣掉 `this.recoil`
//     —— 畫面會「鎖得很死」,而玩家再也感覺不到每一發的上踢。
//   Ⅲ 收斂行為直測(`viewLockStep` 純函式):不瞬移(單幀 ≤ W·dt)、不過衝、不隨幀率漂移。
//   Ⅳ 鍵位與單一縫:ZR = 鎖定(按住型)、機種絕招搬到十字鍵左且仍只有一個派發縫、
//     目標解析只有 `_coneAcquire` 一份、瞄準點只有 `_entAimPoint` 一份、
//     **按一次輪替一個**(錨點 `_vlockPrev` 跨放開保留,名冊依畫面由左至右)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VIEW_LOCK, viewLockStep, SCOPE, scopeRvmin } from '../public/js/data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const dataSrc = read('public', 'js', 'data.js');
const gameSrc = read('public', 'js', 'game.js');
const mobileSrc = read('public', 'js', 'mobile.js');
const htmlSrc = read('public', 'index.html');
const helpSrc = read('public', 'js', 'help.js');
const mainSrc = read('public', 'js', 'main.js');
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
ok(VIEW_LOCK.DROP > VIEW_LOCK.EDGE,
  `遲滯:脫鎖邊界 DROP(${VIEW_LOCK.DROP})MUST > 取得邊界 EDGE(${VIEW_LOCK.EDGE})`);
ok(VIEW_LOCK.EDGE === 1,
  '取得邊界 EDGE === 1:偏離度已正規化(1 = 畫面邊緣 / 鏡圈邊)⇒ 不是 1 就是在別處又乘了一次');
ok(VIEW_LOCK.W > 0 && VIEW_LOCK.EASE > 0, '角速度上限 W 與逼近係數 EASE 皆為正');
// 狙擊鏡圈:CSS 遮罩與「鎖不鎖得到」MUST 同一份半徑 —— 遮罩黑掉的地方鎖得到 = 鎖到看不見的人
ok(scopeRvmin(0) === SCOPE.R_VMIN && scopeRvmin(1) === SCOPE.FOG_R_VMIN,
  '`scopeRvmin` 兩端點 = SCOPE.R_VMIN / FOG_R_VMIN(縮圈曲線推導不手寫)');
ok(scopeRvmin(0.5) < scopeRvmin(0) && scopeRvmin(0.5) > scopeRvmin(1), '火場越濃鏡圈越小(單調)');
ok(scopeRvmin(-1) === SCOPE.R_VMIN && scopeRvmin(9) === SCOPE.FOG_R_VMIN, '濃度夾制在 0~1');
ok(count(dataSrc, /export const scopeRvmin/g) === 1, '鏡圈半徑唯一縫 `scopeRvmin` 住 data.js');
ok(/scopeRvmin\(/.test(mainSrc) && !/40 - f \* 22/.test(mainSrc),
  'main.js 的 `--scope-r` 吃 `scopeRvmin`,舊的手寫縮圈式已拔掉');
ok(/scopeRvmin\(this\._scopeFog\)/.test(gameSrc),
  'game.js 的取景吃同一支 `scopeRvmin`(MUST NOT 去讀 CSS 變數字串或另寫一份半徑)');
ok(/export const viewLockStep/.test(dataSrc), '每幀轉角唯一縫 `viewLockStep` 住 data.js');
ok(count(gameSrc, /viewLockStep\(/g) === 2,
  'game.js 兩軸(yaw/pitch)都吃 viewLockStep,且只有這兩處');
const tick = body(gameSrc, '_tickViewLock');
ok(tick.length > 0, 'game.js 有 `_tickViewLock`');
ok(!/VIEW_LOCK\.(W|EASE)/.test(tick),
  '`_tickViewLock` MUST NOT 自己拿 W/EASE 算步長(推導值手寫 = 與稽核的直測分家)');
ok(/VIEW_LOCK\.EDGE/.test(tick) && /VIEW_LOCK\.DROP/.test(tick),
  '取得/脫鎖邊界由 VIEW_LOCK 供給,MUST NOT 在 game.js 手寫門檻');

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
// 鈕面字 2026-08-02 起住 `.gb-f` span(觀戰借用這顆鈕時要換字)⇒ 只驗同一顆鈕內有 .gb-cd,
// MUST NOT 綁死「文字直接是 button 的子節點」那種標記形狀。
ok(/data-act="special"[^\n]*<span class="gb-cd">/.test(htmlSrc),
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
ok(/this\._maxRange\(def\)/.test(tick),
  '可鎖距離與 `_tickLock` 同一把尺(索敵半徑 = `_maxRange` 機制上限)');
// 亮燈狀態:唯一真相在 game.js,經 body class 落到鈕面(觸控層不自己記一份)
ok(/document\.body\.classList\.toggle\('vlock'/.test(gameSrc)
  && /body\.vlock \.tl-sysb\[data-act="lock"\]/.test(cssSrc),
  '鎖定亮燈 = body class(比照 body.mm-near),觸控層不必自己記狀態');
ok(!/vlock/.test(mobileSrc), 'mobile.js MUST NOT 自己判鎖定狀態(A1 家族:狀態只有一個來源)');
// A21:裝置分支文案只住 help.js
ok(/ZR/.test(helpSrc) && /視野鎖定/.test(helpSrc), 'help.js 有視野鎖定的觸控說明(A21)');
ok(/pTouch[^\n]*ZR 鎖定|按住 ZR/.test(helpSrc), 'help.js 寫明「按住」才生效');
ok(/後座力/.test(helpSrc), 'help.js 說明「後座力仍然存在」(避免玩家以為壞了)');


// ── 輪替(2026-08-02):按一次 = 下一個 ──────────────────────────
sec('Ⅴ 輪替:按一次切換視野內的下一個敵人');
ok(/if \(down\) this\._vlockNext = true;/.test(cmd),
  '按下 MUST 只是掛起「輪替一次」的旗標(實際索敵住 `_tickViewLock`,`_cmd` 不掃場)');
ok(/else this\._vlockId = null;/.test(cmd) && !/_vlockPrev\s*=/.test(cmd),
  '放開只清 `_vlockId`;輪替錨點 `_vlockPrev` MUST NOT 在放開時清掉 —— 清了就永遠鎖同一個人');
ok(/list: true/.test(tick) && /_coneAcquire\(rng, \{ \.\.\.opt, keepId: this\._vlockPrev, list: true \}\)/.test(tick),
  '名冊由 `_coneAcquire` 的 list 模式供給(與黏著判定同一份「看不看得見」條件)');
ok(/\(i \+ 1\) % list\.length/.test(tick),
  '輪替 = 名冊索引 +1 取模(輪到底回到最左邊)');
ok(/this\._vlockPrev = this\._vlockId;/.test(tick),
  '輪替後 MUST 回寫錨點,否則下一次按下又從同一個開始');
const acq = body(gameSrc, '_coneAcquire');
ok(/list\.sort\(\(a, b\) => a\.x - b\.x\)/.test(acq),
  '名冊依**畫面由左至右**排序(依「離準星遠近」排 ⇒ 每切一次就重排,第三個以後輪不到)');
ok(!/\.sort\(/.test(tick), '排序只有 `_coneAcquire` 那一份,`_tickViewLock` MUST NOT 自己再排一次');
// 取景:一般 = 畫面矩形、狙擊 = 鏡圈正圓(使用者:「狙擊模式時以狙擊鏡視野為主」)
ok(/this\.aiming \?/.test(acq) && /scopeRvmin\(/.test(acq),
  '狙擊模式的取景 MUST 換成鏡圈半徑(遮罩黑掉的地方鎖不到)');
ok(/projectionMatrix/.test(acq) && !/zoomFov/.test(acq),
  '視野框吃相機投影矩陣 ⇒ 狙擊 FOV 自動生效,MUST NOT 另寫一份角度縮放');
ok(/v\.z > -0\.05\) return Infinity/.test(acq),
  '相機後方 MUST 先擋掉(投影會左右鏡射 ⇒ 背後的敵人會被算成正前方)');
ok(/matrixWorld\)\.invert\(\)/.test(acq),
  '反矩陣自己算:`camera.matrixWorldInverse` 是 renderer 才寫的,開場第一幀是單位矩陣');
// 清帳:錨點跟著陣亡/離場收掉(留著 = 重生後第一次按 ZR 跳過一個人)
ok(/_vlockPrev = null/.test(body(gameSrc, '_onSelfDeath')), '陣亡 MUST 清掉輪替錨點');
ok(/_vlockPrev = null/.test(body(gameSrc, 'dispose')), '離場 MUST 清掉輪替錨點');
ok(/輪流|輪替|下一個/.test(helpSrc), 'help.js 說明「再按一次換下一個」(A21)');
ok(/狙擊鏡/.test(helpSrc), 'help.js 寫明狙擊模式以鏡圈為取景');
console.log(fail
  ? `\n✗ 視野鎖定稽核:${fail} 項未通過(共 ${pass + fail})`
  : `\n✓ 視野鎖定稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
