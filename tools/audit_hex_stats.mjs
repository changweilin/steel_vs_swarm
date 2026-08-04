// ============ 圖鑑六角能力圖 稽核 ============
// 用途:改 `data.js` 的 `HEX_AXES`/`heroHexStats()`/`hexBand()`/`HEX`/`strikeAreaM2()`/
// `zoneAreaM2()`/`weaponDps()`/`weaponCycleS()`,或 `main.js` 的 `heroHexHTML`/`hexPt`/`hexPoly`
// 與其兩個消費端,或 `style.css` 的 `.hx-*` 之後跑。
//
// 使用者定案(2026-08-04):「角色能力使用六角圖顯示:HP 和護盾合併顯示為耐久,另外加上
// 兩個項目:火力、射程 + 傷害面積」。四條可量測的不變式:
//
//   ① 六軸、且合併/新增的內容如實  —— 恰 6 軸;耐久 = 裝甲 HP + 護盾(不是只取其一、也不是
//      再乘個係數);火力與制域確實存在且分別吃 DPS 與「射程 × 傷害面積」。
//   ② 值全部走既有唯一縫          —— `heroArmor` / `heroMobility` / `heroWeapon` → `weaponDps`。
//      在 UI 端或軸表裡自己寫一份公式 = 圖鑑與實戰分家,症狀是「圖上看起來很強、打起來不是」,
//      而且沒有任何錯誤訊息。
//   ③ 滿格基準推導不手寫          —— `hexBand` 由現役角色算出來(舊制 `BAR_MAX` 是手寫的:
//      改一名角色的數值,別人的長條就悄悄失準)。另驗正規化保序、每軸都有人貼到內圈與外框。
//   ④ UI 只負責畫                —— `heroHexHTML` 一份實作、軸序照 `HEX_AXES` 不重排、
//      不自己算比例;並**執行 main.js 原文**產生 SVG,逐頂點量半徑 = f × R(圖形與數值同源)。
//
// 跑法:`node tools/audit_hex_stats.mjs`(不需伺服器/瀏覽器/網路)
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化)。
import { readSrc, grabFn } from './audit_src.mjs';
import { UI_TIPS, helpItemP } from '../public/js/help.js';
import {
  HEX, HEX_AXES, heroHexStats, hexBand, strikeAreaM2, zoneAreaM2, weaponDps, weaponCycleS,
  CHARACTERS, UNITS, charKind, heroWeapon, heroArmor, heroMobility, buildDps,
  aoeClass, blastFootprintR, fanArcHalf, lanceR, hitR, BLAST, RATE_DEF,
} from '../public/js/data.js';

const dataSrc = readSrc('public', 'js', 'data.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const cssSrc = readSrc('public', 'css', 'style.css');
const balSrc = readSrc('tools', 'balance.mjs');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const mainCode = strip(mainSrc).split("} from './data.js';").slice(1).join("} from './data.js';");
const dataCode = strip(dataSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, re) => (s.match(re) || []).length;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const CHS = Object.keys(CHARACTERS);

// ---------------- Ⅰ 六軸定義 ----------------
console.log('\nⅠ 六軸定義');
{
  t('恰好六軸(六角形)', HEX_AXES.length === 6);
  t('軸鍵互異、名稱與取值函式齊全',
    new Set(HEX_AXES.map((a) => a.key)).size === 6
    && HEX_AXES.every((a) => a.name && typeof a.val === 'function'));
  const keys = HEX_AXES.map((a) => a.key);
  t('使用者點名的兩個新軸都在(火力 / 射程+傷害面積)',
    keys.includes('fire') && keys.includes('zone'));
  // 說明只有一份:軸的意思寫在 help.js(⓵ 懸浮提示與說明分頁同源),data.js 不得再抄一份
  t('六軸的意思寫在 help.js UI_TIPS.charHex,且六個軸名全部講得到',
    !!UI_TIPS.charHex && HEX_AXES.every((a) => UI_TIPS.charHex.p.includes(a.name))
    && UI_TIPS.charHex.p.includes('射程') && UI_TIPS.charHex.p.includes('傷害面積'));
  t('data.js 的軸表不附說明字串(說明的唯一縫在 help.js)',
    HEX_AXES.every((a) => a.tip === undefined));
  t('HP 與護盾**合併**成耐久(逐角色驗 = 兩者相加,不是取其一也不是再乘係數)', CHS.every((ch) => {
    const u = UNITS[charKind(ch)], m = CHARACTERS[ch].mods || {};
    const want = Math.round(u.hp * (m.hp ?? 1)) + Math.round(u.shield * (m.sp ?? 1));
    return HEX_AXES.find((a) => a.key === 'dur').val(ch) === want;
  }));
  t('舊制五條長條(裝甲 HP / 護盾 分列)已退場,`BAR_MAX` 與 `heroStatCells` 不得復辟',
    !/(^|[^_])\bBAR_MAX\s*=/.test(mainCode) && !/function heroStatCells/.test(mainCode));
  // 值全走既有唯一縫(② —— 逐角色與唯一縫的回傳比對,不是比對字串)
  t('機動 = heroMobility(壓縮後的實戰移速)', CHS.every((ch) =>
    near(HEX_AXES.find((a) => a.key === 'mob').val(ch),
      heroMobility(charKind(ch), CHARACTERS[ch].mods, charKind(ch) === 'drone'))));
  t('護甲 = heroArmor(無人機等比縮放後的實戰護甲)', CHS.every((ch) =>
    near(HEX_AXES.find((a) => a.key === 'armor').val(ch), heroArmor(ch))));
  t('火力 = 輕 + 重武器的持續 DPS(走 heroWeapon → weaponDps)', CHS.every((ch) =>
    near(HEX_AXES.find((a) => a.key === 'fire').val(ch),
      weaponDps(heroWeapon(ch, 'light')) + weaponDps(heroWeapon(ch, 'heavy')))));
  t('六軸取 Lv1 未升級(與卡面「數值 Lv1 → Lv4」的左端一致)',
    !/HEX_AXES[\s\S]{0,2000}heroWeapon\(ch, '\w+', [2-9]/.test(dataCode));
}

// ---------------- Ⅱ 持續 DPS 的唯一量法 ----------------
console.log('\nⅡ 持續 DPS 唯一縫');
{
  t('weaponCycleS / weaponDps 各只有一份實作',
    count(dataCode, /export const weaponCycleS = /g) === 1
    && count(dataCode, /export const weaponDps = /g) === 1);
  t('對建築收斂 buildDps 吃這一支(不得再手抄彈匣週期)',
    /weaponDps\(w, shieldSplit\(w, w\.dmg, 0\)\.toHp/.test(dataCode)
    && !/const cycle = w\.mag \/ \(w\.rate \|\| RATE_DEF\) \+ w\.reload/.test(dataCode));
  t('平衡 balance.mjs 的 slotDps 也吃這一支(圖鑑火力與平衡量到的是同一個數)',
    /weaponDps\(/.test(strip(balSrc))
    && !/const cycle = w\.mag \/ \(w\.rate \|\| 3\) \+ w\.reload/.test(strip(balSrc)));
  // 行為:週期 = 打完彈匣 + 裝填;DPS = 一個週期的傷害 ÷ 週期
  const w = { dmg: 10, rate: 2, mag: 6, reload: 4 };
  t('彈匣週期 = mag/rate + reload', near(weaponCycleS(w), 6 / 2 + 4));
  t('持續 DPS = dmg × mag ÷ 週期', near(weaponDps(w), 10 * 6 / 7));
  t('dmg 可覆寫成「對某目標的實得傷害」(buildDps 用的就是這條路)',
    near(weaponDps(w, 5), weaponDps(w) / 2) && buildDps(CHS[0], 'heavy') > 0);
}

// ---------------- Ⅲ 制域 = 射程 × 傷害面積 ----------------
console.log('\nⅢ 制域 / 打擊足跡');
{
  t('足跡分類走 aoeClass 單一縫(原文不得自己比對 def.type)',
    /export function strikeAreaM2/.test(dataCode)
    && !/function strikeAreaM2[\s\S]{0,400}def\.type/.test(dataCode));
  const R = 100;
  const blast = { id: 'heavy', type: 'launcher', r: 5, range: R };
  const fan = { id: 'heavy', type: 'plasma', fan: true, arc: 30, range: R };
  const line = { id: 'heavy', type: 'beam', range: R };
  const point = { id: 'light', type: 'gun', range: R };
  t('blast 足跡 = π × (r × BLAST.EDGE)²(= 傷害歸零邊界)',
    near(strikeAreaM2(blast), Math.PI * blastFootprintR(5) ** 2)
    && near(blastFootprintR(5), 5 * BLAST.EDGE));
  t('fan 足跡 = 半角 × R²(扇形面積)', near(strikeAreaM2(fan), fanArcHalf(fan) * R * R));
  t('line 足跡 = 貫穿圓柱的地面投影 2R_圓柱 × 射程', near(strikeAreaM2(line), 2 * lanceR(line) * R));
  t('單體直擊足跡 = 一名步兵的命中量體(不是 0 ⇒ 制域退化成純射程的線性量)',
    near(strikeAreaM2(point), Math.PI * hitR({ kind: 'soldier' }) ** 2)
    && strikeAreaM2(point) > 0);
  t('四類分類正確(blast/fan/line/單體)',
    aoeClass(blast) === 'blast' && aoeClass(fan) === 'fan'
    && aoeClass(line) === 'line' && aoeClass(point) === null);
  t('制域 = 射程 × 足跡等效直徑(m²)',
    near(zoneAreaM2(blast), R * 2 * Math.sqrt(strikeAreaM2(blast) / Math.PI)));
  t('射程加倍 ⇒ 單體直擊的制域加倍(足跡不變時只剩射程)',
    near(zoneAreaM2({ ...point, range: 2 * R }), 2 * zoneAreaM2(point)));
  t('同射程下足跡越大制域越大', zoneAreaM2(blast) > zoneAreaM2(point));
  t('現役 32 台的制域全部 > 0(沒有任何一台掉進「面積 0」的死角)',
    CHS.every((ch) => HEX_AXES.find((a) => a.key === 'zone').val(ch) > 0));
  t('缺武器/空定義回 0 而不是 NaN(圖形不得因此塌掉)',
    strikeAreaM2(null) === 0 && zoneAreaM2(null) === 0);
}

// ---------------- Ⅳ 正規化 ----------------
console.log('\nⅣ 正規化');
{
  t('FLOOR ∈ (0, 0.5)(0 = 最低者的頂點塌成一點、太大 = 讀不出差距)',
    HEX.FLOOR > 0 && HEX.FLOOR < 0.5);
  t('hexBand 由現役角色推導(逐軸比對 min/max)', HEX_AXES.every((ax) => {
    const v = CHS.map((c) => ax.val(c));
    const b = hexBand(ax.key);
    return near(b.lo, Math.min(...v), 1e-6) && near(b.hi, Math.max(...v), 1e-6);
  }));
  t('main.js 沒有第二張軸表 / 沒有自己算比例(UI 只負責畫)',
    !/hexBand\(|Math\.log\(/.test(mainCode.slice(mainCode.indexOf('function heroHexHTML'),
      mainCode.indexOf('function heroHexHTML') + 2000)));
  const all = CHS.map((ch) => heroHexStats(ch));
  t('每名角色都回六軸,且順序 = HEX_AXES(消費端不得重排)',
    all.every((s) => s.length === 6 && s.every((x, i) => x.key === HEX_AXES[i].key)));
  t('f 一律夾在 [FLOOR, 1]', all.every((s) => s.every((x) => x.f >= HEX.FLOOR - 1e-12 && x.f <= 1 + 1e-12)));
  t('每一軸都恰有人貼到外框、也有人落在內圈(值域用滿 ⇒ 形狀讀得出相對位置)',
    HEX_AXES.every((ax, i) => all.some((s) => near(s[i].f, 1, 1e-9))
      && all.some((s) => near(s[i].f, HEX.FLOOR, 1e-9))));
  t('保序:同一軸上值越大 f 越大', HEX_AXES.every((ax, i) => {
    const rows = all.map((s) => s[i]).sort((a, b) => a.v - b.v);
    return rows.every((r, j) => j === 0 || r.f >= rows[j - 1].f - 1e-12);
  }));
  // 對數尺度:等比例的三個值在圖上等距(長尾軸不會整組擠在內圈)
  {
    const ax = HEX_AXES[0], b = hexBand(ax.key);
    const f = (v) => HEX.FLOOR + (1 - HEX.FLOOR) * Math.log(v / b.lo) / Math.log(b.hi / b.lo);
    const q = Math.sqrt(b.hi / b.lo);
    t('對數尺度:等比級數在半徑上等距(差幾倍決定半徑,不是差多少)',
      near(f(b.lo * q) - f(b.lo), f(b.hi) - f(b.lo * q), 1e-9));
  }
  t('值域退化(全員同值)時不炸、回滿格', (() => {
    const s = heroHexStats(CHS[0]);
    return s.every((x) => Number.isFinite(x.f));
  })());
  t('未知角色回六軸且不炸', heroHexStats('__none__').length === 6);
}

// ---------------- Ⅴ UI:執行 main.js 原文產生 SVG ----------------
console.log('\nⅤ 六角圖繪製(執行 main.js 原文)');
{
  t('heroHexHTML 只有一份實作', count(mainCode, /function heroHexHTML\(/g) === 1);
  t('角色卡與放大視窗兩個消費端都吃它', count(mainCode, /heroHexHTML\(/g) === 3);   // 定義 1 + 呼叫 2
  // 原文直測:抽 HEXG / hexPt / hexPoly / heroHexHTML 起來跑(esc 與 heroHexStats 由外部注入)
  const HEXG_SRC = mainSrc.match(/const HEXG = \{[^\n]*\};/)[0];
  const HEXPOLY_SRC = mainSrc.match(/const hexPoly = [^\n]*;/)[0];
  const fn = new Function('heroHexStats', 'esc', 'tipHTML', 'uiTip', 'TOUCH_UI', `
    ${HEXG_SRC}
    ${grabFn(mainSrc, 'hexPt')}
    ${HEXPOLY_SRC}
    ${grabFn(mainSrc, 'heroHexHTML')}
    return { heroHexHTML, hexPt, HEXG };
  `)(heroHexStats, (s) => String(s), (x) => `<i class="tip">${x}</i>`,
    (k, touch) => helpItemP(UI_TIPS[k], touch), () => false);
  const ch = CHS.find((c) => charKind(c) === 'drone');
  const html = fn.heroHexHTML(ch);
  const st = heroHexStats(ch);
  t('產出單一 <svg>,且六軸名稱與數值都寫在圖上',
    count(html, /<svg/g) === 1 && st.every((s) => html.includes(s.name)));
  // 資料多邊形:六個點,逐點半徑 = f × R
  const poly = html.match(/class="hx-fill" points="([^"]+)"/)[1].trim().split(/\s+/).map((p) => p.split(',').map(Number));
  t('資料多邊形恰六個頂點', poly.length === 6);
  t('逐頂點半徑 = f × R(圖形與數值同源,不是各畫各的)',
    poly.every(([x, y], i) => near(Math.hypot(x - fn.HEXG.cx, y - fn.HEXG.cy), st[i].f * fn.HEXG.r, 0.02)));
  t('頂點順時針、第一軸在正上方(角度 = -90° 起算)',
    near(poly[0][0], fn.HEXG.cx, 0.02) && poly[0][1] < fn.HEXG.cy
    && poly[1][0] > fn.HEXG.cx && poly[1][1] < fn.HEXG.cy);
  t('格線環由外而內都有(讀得出刻度)', count(html, /class="hx-grid"/g) === fn.HEXG.ring.length);
  t('六根軸線齊全', count(html, /class="hx-spoke"/g) === 6);
  // 兩台差很多的機體 MUST 畫出不同形狀(這是整張圖存在的理由)
  {
    const a = heroHexStats(CHS.find((c) => charKind(c) === 'drone'));
    const b = heroHexStats(CHS.find((c) => charKind(c) === 'robot'));
    t('不同機種的六角形形狀明顯不同(不是每台都畫成同一個正六邊形)',
      a.some((x, i) => Math.abs(x.f - b[i].f) > 0.2));
  }
  t('SVG 只用 class 上色,MUST NOT 在 JS 端硬寫色碼(陣營色由 CSS 的 --railW 給)',
    !/fill="#|stroke="#|fill: *rgb/.test(html));
  // 標籤(名稱 + 數值)MUST 收在 viewBox 內 —— 溢出就會壓到下面那行說明(2026-08-04 實測)
  {
    const vb = html.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
    const ys = [...html.matchAll(/<text class="hx-lab"[^>]*y="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    const LINE = 12;   // 名稱下方還有一行數值 tspan
    t('六個軸標籤(含下方數值那一行)都收在 viewBox 內',
      ys.every((y) => y - LINE >= vb[1] && y + LINE * 2 <= vb[1] + vb[3]));
  }
  t('說明改走 ⓘ 懸浮提示(常駐圖例已退場,見 2026-07-31 定案)',
    /tipHTML\(uiTip\('charHex'/.test(mainCode) && !/cd-hex-legend/.test(mainCode));
  for (const cls of ['hx-grid', 'hx-spoke', 'hx-fill', 'hx-dot', 'hx-lab', 'hx-num', 'cd-hex', 'cd-hex-cap']) {
    t(`style.css 有 .${cls} 的樣式`, cssSrc.includes(`.${cls}`));
  }
}

console.log(`\n${fail === 0 ? '🎉' : '❌'} 六角能力圖稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
