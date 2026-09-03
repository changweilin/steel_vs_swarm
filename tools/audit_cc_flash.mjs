// ============ 異常狀態致盲白幕 + 蓄力跳水平移速 稽核 ============
// 用途:改 `data.js` 的 `CC_FLASH`/`ccFlashAlpha()`/`CJUMP.AIR_SPD_F`,或 `game.js` 的
// `_ccFeed`/`_blindFlash`/`_updateCcFlash`/`_clearCcFlash`/`_chargeJump`/`_updatePlayer` 移動段後跑。
//
// 為什麼兩件事合在一支:它們是同一種形狀的縫 —— **data.js 一個常數 → game.js 多個消費端**,
// 而「只改了其中一個消費端」在遊戲裡都看不出來:
//   ① 白幕:峰值/曲線在 data.js,觸發在 `_ccFeed` 上升沿、衰減在 `_updateCcFlash`。
//      漏掉任一端 = 「只白一幀」或「白著不淡」,肉眼以為是掉幀。
//   ② 蓄力跳水平移速:`CJUMP.AIR_SPD_F` 有兩個消費端(起跳彈射初速 + 騰空操縱移速)。
//      只改一處 = 「彈得遠但空中推杆很慢」或「起跳沒變快只是滑得久」,量不出來只感覺怪。
// 另驗兩條反模式:白幕 MUST NOT 掛 CSS transition/animation(與逐幀曲線相爭 ⇒ 峰值被鈍化);
// 蓄力跳的**垂直**項(CJUMP.V / GRAV_F)MUST NOT 吃水平倍率(否則跳躍高度/滯空一起變,
// 滿蓄頂點會撞上 GAME.AA_MIN_ALT 的設計前提)。
//
// 手法比照 `audit_minimap_view.mjs`:曲線直接 import(data.js 是純模組),
// game.js 的方法**抽執行原文**評估(three 走 CDN、Node 端 import 不了整支;抄一份公式就永遠會通過)。
// 跑法:`node tools/audit_cc_flash.mjs`
// 讀原文與抽方法走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabMethod } from './audit_src.mjs';
import { CC_FLASH, ccFlashAlpha, ccFlashDur, CJUMP } from '../public/js/data.js';

const src = readSrc('public', 'js', 'game.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const css = readSrc('public', 'css', 'style.css');
const html = readSrc('public', 'index.html');

/** 抽出 class 方法的原文(含大括號區塊);與 audit_minimap_view.mjs 同一手法 */
const grab = (name) => grabMethod(src, name);

// 「全檔只有 N 處」這類計數 MUST 只數**執行原文** —— 註解與 import 清單也提得到同一個名字,
// 連著數會把「說明寫得詳細」誤判成「縫破了」。故先剝掉區塊/行註解與檔頭 import 段再數。
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  .split("} from './data.js';").slice(1).join("} from './data.js';");

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const count = (s, needle) => s.split(needle).length - 1;

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 白幕曲線(data.js CC_FLASH / ccFlashAlpha:全白段 → 漸淡 → 歸零)');
// ---------------------------------------------------------------------------
{
  const D = ccFlashDur();
  t('總長 = HOLD_S + FADE_S(推導不手寫)', near(D, CC_FLASH.HOLD_S + CC_FLASH.FADE_S), `${D}`);
  t('全白段:剛觸發即峰值', near(ccFlashAlpha(D, 0.8), 0.8), `${ccFlashAlpha(D, 0.8)}`);
  t('全白段:剩餘 = FADE_S 仍為峰值(HOLD 段邊界)', near(ccFlashAlpha(CC_FLASH.FADE_S, 0.8), 0.8));
  t('全白段長度實測 = HOLD_S', near(
    (() => {   // 由 D 往下掃,找出最後一個仍為峰值的時點
      let last = D;
      for (let i = 0; i <= 2000; i++) { const x = D - i * D / 2000; if (near(ccFlashAlpha(x, 1), 1, 1e-12)) last = x; else break; }
      return D - last;
    })(), CC_FLASH.HOLD_S, D / 2000 + 1e-9));
  t('漸淡段:低於峰值', ccFlashAlpha(CC_FLASH.FADE_S * 0.5, 1) < 1);
  t('漸淡段:單調遞減(剩餘越少越透明)', (() => {
    let prev = Infinity;
    for (let i = 0; i <= 60; i++) {
      const a = ccFlashAlpha(CC_FLASH.FADE_S * (1 - i / 60), 1);
      if (a > prev + 1e-12) return false;
      prev = a;
    }
    return true;
  })());
  t('尾端歸零(不留殘影)', ccFlashAlpha(0, 1) === 0 && ccFlashAlpha(1e-6, 1) < 1e-9);
  t('smoothstep 收尾:中點 = 峰值一半', near(ccFlashAlpha(CC_FLASH.FADE_S * 0.5, 1), 0.5));
  t('peak 夾制 [0,1]', ccFlashAlpha(D, 5) === 1 && ccFlashAlpha(D, -1) === 0 && ccFlashAlpha(D, undefined) === 0);
  t('left 夾制:負數 / 超長皆合法', ccFlashAlpha(-3, 1) === 0 && near(ccFlashAlpha(D * 9, 1), 1));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅱ 致盲強度表(只有光學/電子系狀態進表)');
// ---------------------------------------------------------------------------
{
  const keys = Object.keys(CC_FLASH.PEAK).sort();
  t('PEAK 鍵集 = emp / conf / stun', keys.join(',') === 'conf,emp,stun', keys.join(','));
  t('物理系狀態不在表內(slow/bleed/mark/inv)',
    ['slow', 'bleed', 'mark', 'inv'].every((k) => CC_FLASH.PEAK[k] === undefined));
  t('強度皆 ∈ (0,1]', keys.every((k) => CC_FLASH.PEAK[k] > 0 && CC_FLASH.PEAK[k] <= 1));
  t('emp(雷爆閃光)最強', keys.every((k) => CC_FLASH.PEAK.emp >= CC_FLASH.PEAK[k]));
  t('conf(纏擾致盲)強於 stun(電擊麻痺)', CC_FLASH.PEAK.conf > CC_FLASH.PEAK.stun);
}

// ---------------------------------------------------------------------------
console.log('■ Ⅲ 白幕單一縫(觸發 / 衰減 / 清除只各一處)');
// ---------------------------------------------------------------------------
{
  const feed = grab('_ccFeed'), blind = grab('_blindFlash'), upd = grab('_updateCcFlash'), clr = grab('_clearCcFlash');
  t('啟動白幕只在 _blindFlash(全檔只有它寫 ccFlashDur())',
    count(code, 'ccFlashDur()') === count(blind, 'ccFlashDur()') && count(blind, 'ccFlashDur()') === 1,
    `全檔 ${count(code, 'ccFlashDur()')} 處`);
  t('查表 CC_FLASH.PEAK 只在 _ccFeed(強度不散寫)',
    count(code, 'CC_FLASH.PEAK[') === 1 && count(feed, 'CC_FLASH.PEAK[') === 1);
  t('推 HUD 只有衰減與清除兩處', count(code, 'hud.ccFlash?.(') === 2
    && count(upd, 'hud.ccFlash?.(') === 1 && count(clr, 'hud.ccFlash?.(') === 1);
  t('光學系三狀態 MUST 帶致盲參數',
    /_stunOn[\s\S]*?'stun'\)/.test(feed) && /_confOn[\s\S]*?'conf'\)/.test(feed) && /_empOn[\s\S]*?'emp'\)/.test(feed));
  t('物理系狀態 MUST NOT 帶致盲參數', ['_slowOn', '_bleedOn', '_markOn', '_invOn'].every((k) => {
    const line = feed.split('\n').find((l) => l.includes(k)) || '';
    return !/,\s*'\w+'\)/.test(line.replace(/'[^']*[!!][^']*'/, "''"));   // 播報字串本身不算參數
  }));
  // 觸發/衰減兩端 MUST 都接上:漏了衰減 = 白幕定格不淡(玩家以為畫面壞了),
  // 漏了觸發 = 整個系統靜默失效 —— 兩者在單測裡都看不出來,只能驗「呼叫點確實在幀迴圈/上升沿裡」。
  t('_updateCcFlash 掛在主渲染幀(與玩家視角模式無關)',
    /this\._updatePlayer\(dt, now\);[\s\S]{0,180}?this\._updateCcFlash\(dt\);/.test(code)
    && count(code, 'this._updateCcFlash(dt)') === 1);
  t('_blindFlash 唯一呼叫點在 _ccFeed 上升沿',
    count(code, 'this._blindFlash(') === 1 && count(feed, 'this._blindFlash(') === 1);
  t('main.js 有 hud.ccFlash 且只設 opacity(不掛 class 動畫)', /ccFlash:\s*\(a\)\s*=>/.test(mainSrc)
    && /\$\('ccFlash'\)\.style\.opacity/.test(mainSrc) && !/ccFlash'\)\.classList/.test(mainSrc));
  t('index.html 有 #ccFlash 疊層', /id="ccFlash"/.test(html));
  const rule = /\.cc-flash\s*\{[^}]*\}/.exec(css)?.[0] || '';
  t('.cc-flash 全屏白、不吃指標事件、z 9(HUD 之下)',
    /inset:\s*0/.test(rule) && /background:\s*#fff/.test(rule) && /pointer-events:\s*none/.test(rule) && /z-index:\s*9\b/.test(rule), rule);
  t('.cc-flash MUST NOT 掛 transition/animation(逐幀曲線唯一驅動)',
    !/transition|animation/.test(rule) && !/\.cc-flash[^{]*\{[^}]*animation/.test(css));
}

// ---------------------------------------------------------------------------
console.log('■ Ⅳ 白幕行為直測(執行 game.js 原文:更亮者勝 / 逐幀衰減 / 清除)');
// ---------------------------------------------------------------------------
{
  const body = `({ ${grab('_blindFlash')}, ${grab('_updateCcFlash')}, ${grab('_clearCcFlash')} })`;
  const proto = new Function('CC_FLASH', 'ccFlashAlpha', 'ccFlashDur', `return ${body};`)(CC_FLASH, ccFlashAlpha, ccFlashDur);
  const mk = () => {
    const pushed = [];
    const c = Object.assign(Object.create(null), proto, {
      _ccFlashLeft: 0, _ccFlashPeak: 0, hud: { ccFlash: (a) => pushed.push(a) },
    });
    return [c, pushed];
  };
  {
    const [c] = mk();
    c._blindFlash(CC_FLASH.PEAK.stun);
    t('觸發:剩餘 = 總長、峰值 = 該狀態強度',
      near(c._ccFlashLeft, ccFlashDur()) && near(c._ccFlashPeak, CC_FLASH.PEAK.stun));
    c._blindFlash(0);
    t('強度 0 / 未進表的狀態不觸發(peak undefined 無效果)', near(c._ccFlashPeak, CC_FLASH.PEAK.stun));
  }
  {
    // 峰值直接給定(MUST NOT 拿 PEAK 表的值當測資:表一調就變成兩個都比得過/比不過的空轉斷言)
    const [c] = mk();
    c._blindFlash(1);
    c._updateCcFlash(CC_FLASH.HOLD_S + CC_FLASH.FADE_S * 0.5);    // 淡到一半(alpha = 0.5)
    const half = ccFlashAlpha(c._ccFlashLeft, c._ccFlashPeak);
    const leftHalf = c._ccFlashLeft;
    c._blindFlash(half * 0.5);                                    // 明顯更暗的新狀態
    t('較暗的新狀態 MUST NOT 打斷正在淡出的亮白幕',
      near(c._ccFlashPeak, 1) && near(c._ccFlashLeft, leftHalf), `half=${half.toFixed(3)}`);
    c._blindFlash(Math.min(1, half * 1.5));                       // 比當下更亮 → 重新來一次
    t('更亮的新狀態重置白幕(當下更亮者勝)',
      near(c._ccFlashLeft, ccFlashDur()) && near(c._ccFlashPeak, Math.min(1, half * 1.5)), `half=${half.toFixed(3)}`);
  }
  {
    const [c, pushed] = mk();
    c._blindFlash(1);
    let a = [];
    for (let i = 0; i < 200; i++) { c._updateCcFlash(1 / 60); a.push(pushed.at(-1)); }
    t('逐幀衰減:單調不遞增', a.every((v, i) => i === 0 || v <= a[i - 1] + 1e-12));
    t('全白段撐住(前幾幀仍 1)', near(a[0], 1) && near(a[Math.floor(CC_FLASH.HOLD_S * 60) - 1], 1));
    t('末端歸零', near(pushed.at(-1), 0) && near(c._ccFlashLeft, 0));
    const n = pushed.length;
    c._updateCcFlash(1 / 60);
    t('歸零後早退,不再碰 DOM', pushed.length === n);
  }
  {
    const [c, pushed] = mk();
    c._blindFlash(1);
    c._clearCcFlash();
    t('清除:剩餘/峰值歸零並推一次 0(陣亡/換座機不留白幕)',
      c._ccFlashLeft === 0 && c._ccFlashPeak === 0 && pushed.at(-1) === 0);
  }
  t('陣亡與換座機都清白幕', count(code, '_clearCcFlash()') >= 3);   // 定義 1 + 陣亡 1 + 換座機 1
}

// ---------------------------------------------------------------------------
console.log('■ Ⅴ 蓄力跳水平移速(CJUMP.AIR_SPD_F 兩個消費端同吃,垂直項不吃)');
// ---------------------------------------------------------------------------
{
  t('AIR_SPD_F = 2(水平移速 +100%)', near(CJUMP.AIR_SPD_F, 2), `${CJUMP.AIR_SPD_F}`);
  // ① 起跳彈射初速:抽 _chargeJump 原文執行,量水平/垂直兩軸
  const THREE = {
    Vector3: class {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
      normalize() { const l = Math.sqrt(this.lengthSq()) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
    },
  };
  const proto = new Function('THREE', 'CJUMP', 'shockRing', `return ({ ${grab('_chargeJump')} });`)(THREE, CJUMP, () => {});
  // 移速取自 `_mobility`(2026-08-04 移速壓縮起的唯一取速處;見 audit_speed_comp.mjs)
  const u = { speed: 20 };
  const run = (charge) => {
    const c = Object.assign(Object.create(null), proto, {
      charge, vy: 0, _lowG: false, vel: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 },
      trauma: 0, scene: null, effects: null, hud: {},
      camera: { getWorldDirection: (v) => { v.x = 0; v.y = -0.5; v.z = -1; return v; } },
      _modF: () => 1, _reqIframe: () => {}, _mobility: () => u.speed,
    });
    c._chargeJump();
    return c;
  };
  const full = run(1);
  t('滿蓄水平初速 = 機體移速 × FWD_F × AIR_SPD_F',
    near(Math.hypot(full.vel.x, full.vel.z), u.speed * CJUMP.FWD_F * CJUMP.AIR_SPD_F, 1e-9),
    `${Math.hypot(full.vel.x, full.vel.z)}`);
  t('垂直初速 MUST NOT 吃水平倍率(跳躍高度不變)', near(full.vy, CJUMP.V));
  t('水平初速 ∝ 蓄力比例', near(Math.hypot(run(0.5).vel.x, run(0.5).vel.z),
    u.speed * CJUMP.FWD_F * CJUMP.AIR_SPD_F * 0.5));
  t('起跳即進低重力(_lowG)', full._lowG === true);
  // ② 騰空操縱移速:_updatePlayer 移動段(整支太大,驗原文的乘法鏈)
  const move = /const airK = this\._lowG \? CJUMP\.AIR_SPD_F : 1;/.test(code);
  const applied = /this\.pos\.addScaledVector\(move,[\s\S]{0,260}?\* airK \* dt\)/.test(code);
  t('騰空操縱移速乘 airK = _lowG ? AIR_SPD_F : 1', move && applied, `宣告 ${move} / 套用 ${applied}`);
  t('AIR_SPD_F 全檔只有兩個消費端(彈射初速 + 騰空操縱)', count(code, 'CJUMP.AIR_SPD_F') === 2,
    `${count(code, 'CJUMP.AIR_SPD_F')} 處`);
  const gravLine = code.split('\n').find((l) => l.includes('AIR.GRAV') && l.includes('CJUMP.GRAV_F')) || '';
  t('低重力(滯空)不吃水平倍率', gravLine !== '' && !gravLine.includes('AIR_SPD_F'), gravLine.trim());
}

console.log(`\n${fail ? '❌' : '✅'} 致盲白幕 / 蓄力跳水平移速稽核:${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
