// ============ 移速壓縮(機體之間拉近差距、排序不變) 稽核 ============
// 用途:改 `data.js` 的 `SPEED_COMP`/`speedMid()`/`spdComp()`/`heroMobility()`、任一機種的
// `UNITS[kind].speed`·`fly`、任一角色的 `mods.speed`,或任何一個取速消費端
// (`game.js _mobility` 與其三個呼叫點、`bots.js _speed`、`charPreview.topSpeed`)之後跑。
//
// 使用者定案(2026-08-04):「所有機體的移動速度拉近差距,但排序不變」。兩句話都是可量測的
// 不變式,本稽核逐條釘死;另加兩條「這件事有沒有真的發生在腳下」的反模式:
//
//   ① 排序不變   —— `spdComp` **嚴格遞增**(這是保證不是巧合;改成分段表或整數倍率會當場翻掉
//                   排名),另在現役 32 台機體 × 兩種型態的真實資料上逐對複驗。
//   ② 拉近差距   —— 壓縮後的全距比值嚴格小於壓縮前,且**每一對**機體的速度比值都不變大。
//   ③ 重分配不是削弱 —— 壓縮前後整組的**幾何中點逐位元不動**(這是取中點為軸的全部理由;
//                   錨在帶底 = 全體變慢 = 對局節奏整個拖掉,那不是「拉近差距」)。
//   ④ 推導不手寫 —— `speedMid()` 由現役資料算出來,任一機種基準或任一 `mods.speed` 一改,
//                   軸自己跟著走;定義式裡不得出現速度字面值。
//   ⑤ 唯一縫     —— 全專案的「這台機體跑多快」只准經 `heroMobility`。舊制客戶端與 bot 讀的是
//                   `UNITS[kind].speed`(**機種基準**,少乘角色 `mods.speed`、也吃不到壓縮)
//                   ⇒ 伺服器閃避門檻、平衡模型、圖鑑機動欄與腳下實際跑的速度分成兩份,
//                   而這種分歧只有拿碼表量才看得出來(沒有任何錯誤訊息)。
//   ⑥ K = 1 逐位元回到舊制(反向驗證的落點)。
//
// 跑法:`node tools/audit_speed_comp.mjs`(不需伺服器/瀏覽器/網路)
// 讀原文走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  SPEED_COMP, speedMid, spdComp, heroMobility, evasionMinSpeed, CHARACTERS, UNITS, charKind, EVASION,
} from '../public/js/data.js';

const dataSrc = readSrc('public', 'js', 'data.js');
const gameSrc = readSrc('public', 'js', 'game.js');
const botsSrc = readSrc('server', 'bots.js');
const prevSrc = readSrc('public', 'js', 'charPreview.js');

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
/** 只數執行原文,且跳過 import 區塊(import 也提得到同一個名字) */
const codeOf = (s) => strip(s).split("from '../public/js/data.js';").slice(-1)[0]
  .split("from './data.js';").slice(-1)[0];
const gameCode = codeOf(gameSrc), botsCode = codeOf(botsSrc), prevCode = codeOf(prevSrc);

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const count = (s, needle) => (s.match(needle) || []).length;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const geo = (v) => Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length);

/** 現役全部「機體 × 型態」的**壓縮前**移速(取樣面與 speedMid 同一組) */
const RAW = [];
for (const ch of Object.keys(CHARACTERS)) {
  const u = UNITS[charKind(ch)], f = CHARACTERS[ch].mods?.speed ?? 1;
  if (u?.speed > 0) RAW.push({ ch, form: 'ground', v: u.speed * f });
  if (u?.fly > 0) RAW.push({ ch, form: 'fly', v: u.fly * f });
}
const rawV = RAW.map((r) => r.v);
const compV = rawV.map(spdComp);

// ---------------- Ⅰ 曲線:排序不變 / 拉近差距 / 重分配 ----------------
console.log('\nⅠ 壓縮曲線');
{
  t('K ∈ (0, 1](1 = 逐位元舊制、0 = 全員同速)', SPEED_COMP.K > 0 && SPEED_COMP.K <= 1);
  // 嚴格遞增 —— 排名不變的**保證**(全值域掃描,不是抽樣運氣)
  let mono = true, ratio = true;
  for (let v = 1; v < 80; v += 0.05) {
    if (!(spdComp(v + 0.05) > spdComp(v))) mono = false;
    // 任一對的比值都不放大 = 「差距只會拉近不會拉開」
    if (spdComp(v * 1.5) / spdComp(v) > 1.5 + 1e-12) ratio = false;
  }
  t('嚴格遞增(排序不變的保證,MUST NOT 改成分段表或整數倍率)', mono);
  t('任一對機體的速度比值都不變大(拉近,不是重排)', ratio);
  t('中點恆為不動點(spdComp(MID) === MID)', near(spdComp(speedMid()), speedMid(), 1e-9));
  t('高於中點者變慢、低於中點者變快(重分配不是削弱)',
    spdComp(speedMid() * 2) < speedMid() * 2 && spdComp(speedMid() / 2) > speedMid() / 2);
  t('壓縮後整組的幾何中點逐位元不動(水位不變的來源)',
    near(geo(compV), geo(rawV), 1e-9) && near(geo(rawV), speedMid(), 1e-9));
  // 齊次:整體縮放(COMBAT_SCALE)不改變任何相對關係
  t('對整體縮放齊次(reach 縮放不改變相對關係)',
    near(spdComp(10) / spdComp(20), (speedMid() * (10 / speedMid()) ** SPEED_COMP.K)
      / (speedMid() * (20 / speedMid()) ** SPEED_COMP.K), 1e-12));
  t('非正值原樣回傳(靜止建築/腳本實體不進曲線)', spdComp(0) === 0 && spdComp(-3) === -3);
}

// ---------------- Ⅱ 推導不手寫 ----------------
console.log('\nⅡ 中點推導');
{
  t('speedMid() = 現役「機體 × 型態」移速的幾何中點(逐位元)', near(speedMid(), geo(rawV), 1e-9));
  t('取樣面含變形者的飛行巡航(漏掉 = 飛行型態不受壓縮)',
    RAW.some((r) => r.form === 'fly') && RAW.filter((r) => r.form === 'fly').length
      === Object.keys(CHARACTERS).filter((c) => UNITS[charKind(c)]?.fly > 0).length);
  const def = dataSrc.slice(dataSrc.indexOf('export function speedMid()'));
  t('speedMid 定義式裡沒有任何速度字面值(推導不手寫)',
    !/[^\w.](?:9\.45|10\.5|12\.6|14\.6|18|21|25\.2|42)[^\w]/.test(def.slice(0, def.indexOf('\n}'))));
  t('spdComp / speedMid / heroMobility 各只有一份實作',
    count(dataSrc, /export const spdComp = /g) === 1
    && count(dataSrc, /export function speedMid\(\)/g) === 1
    && count(dataSrc, /export const heroMobility = /g) === 1);
}

// ---------------- Ⅲ 現役機體:排序與差距 ----------------
console.log('\nⅢ 現役 32 台機體');
{
  const byRaw = [...RAW].sort((a, b) => a.v - b.v);
  t('逐對複驗:壓縮後的排序與壓縮前完全一致',
    byRaw.every((r, i) => i === 0 || spdComp(r.v) >= spdComp(byRaw[i - 1].v) - 1e-12));
  t('同速者壓縮後仍同速(不得憑空拆出先後)',
    byRaw.every((r, i) => i === 0 || (r.v !== byRaw[i - 1].v)
      || near(spdComp(r.v), spdComp(byRaw[i - 1].v))));
  const rawSpread = Math.max(...rawV) / Math.min(...rawV);
  const compSpread = Math.max(...compV) / Math.min(...compV);
  t(`全距比值收窄 ${rawSpread.toFixed(2)}× → ${compSpread.toFixed(2)}×`, compSpread < rawSpread - 1e-9);
  t('全距比值 = 舊比值 ^ K(曲線形狀的直接後果)',
    near(compSpread, rawSpread ** SPEED_COMP.K, 1e-9));
  t('壓縮後仍是「無人機 > 變形者飛行 > 地面機甲」的機種階梯(排序不變的實務面)',
    Math.min(...RAW.filter((r) => charKind(r.ch) === 'drone').map((r) => spdComp(r.v)))
      > Math.max(...RAW.filter((r) => r.form === 'ground' && charKind(r.ch) !== 'drone').map((r) => spdComp(r.v))));
  t('heroMobility 回傳的就是壓縮後的值(消費端不需要自己再壓一次)',
    Object.keys(CHARACTERS).every((ch) => {
      const k = charKind(ch), u = UNITS[k];
      return near(heroMobility(k, CHARACTERS[ch].mods, false), spdComp(u.speed * (CHARACTERS[ch].mods?.speed ?? 1)));
    }));
  // 閃避門檻是同一條速度軸上的一個點 ⇒ MUST 走同一張映射,否則壓縮會無聲重畫「誰閃得掉」
  t('閃避門檻經 evasionMinSpeed 同步壓縮', near(evasionMinSpeed(), spdComp(EVASION.MOBILITY_MIN)));
  t('壓縮前後「誰在閃避門檻之上」逐位元不變(保序的實務面)',
    RAW.every((r) => (r.v > EVASION.MOBILITY_MIN) === (spdComp(r.v) > evasionMinSpeed())));
  t('門檻仍分得出快慢(不得整組落在同一側)',
    compV.some((v) => v > evasionMinSpeed()) && compV.some((v) => v <= evasionMinSpeed()));
}

// ---------------- Ⅳ 取速唯一縫(原文) ----------------
console.log('\nⅣ 取速唯一縫');
{
  t('game.js 的 `_mobility` 只有一份實作,且就是 heroMobility 的轉呼',
    count(gameCode, /_mobility\(flying\) \{/g) === 1
    && /_mobility\(flying\) \{ return heroMobility\(this\.heroKind, CHARACTERS\[this\.ch\]\?\.mods, flying\); \}/.test(gameCode));
  const moveCalls = count(gameCode, /this\._mobility\(/g);
  t(`game.js 的三個移動端全走 _mobility(地面 / 飛行 / 蓄力跳,實得 ${moveCalls} 處)`, moveCalls >= 3);
  t('game.js 不再有 `u.speed` / `u.fly` 當自機移速(那是機種基準,少了角色修正與壓縮)',
    !/\bu\.speed\b/.test(gameCode) && !/\bu\.fly\b/.test(gameCode));
  t('bots.js 的地速走 heroMobility(A32:電腦玩家 MUST NOT 比真人多走)',
    /heroMobility\(h\.kind, CHARACTERS\[h\.ch\]\?\.mods, this\._fly\(h\)\)/.test(strip(grabMethod(botsSrc, '_speed'))));
  t('bots.js 全檔沒有第二處直接讀 UNITS 的移速', !/\bu\.speed\b|UNITS\.\w+\.speed/.test(botsCode));
  t('閃避門檻只有 evasionMinSpeed 一份,三個消費端不得直接比 MOBILITY_MIN',
    count(dataSrc, /export const evasionMinSpeed = /g) === 1
    && !/EVASION\.MOBILITY_MIN/.test(codeOf(readSrc('server', 'sim.js')))
    && !/EVASION\.MOBILITY_MIN/.test(codeOf(readSrc('tools', 'duel.mjs')))
    && !/EVASION\.MOBILITY_MIN/.test(codeOf(readSrc('tools', 'lanesim.mjs'))));
  t('展示台巡航速同吃 heroMobility(圖鑑動起來的速度 = 戰場實速)',
    /heroMobility\(kind, CHARACTERS\[id\]\.mods/.test(prevCode)
    && !/UNITS\[kind\]\?\.speed/.test(prevCode));
}

// ---------------- Ⅴ 反向驗證的落點:K = 1 逐位元回到舊制 ----------------
console.log('\nⅤ K = 1 逐位元回到舊制');
{
  const K0 = SPEED_COMP.K;
  SPEED_COMP.K = 1;
  const same = RAW.every((r) => spdComp(r.v) === r.v)
    && Object.keys(CHARACTERS).every((ch) => {
      const k = charKind(ch), u = UNITS[k];
      return heroMobility(k, CHARACTERS[ch].mods, false) === u.speed * (CHARACTERS[ch].mods?.speed ?? 1);
    });
  SPEED_COMP.K = K0;
  t('K = 1 時每一台機體的速度逐位元等於壓縮前', same);
  t('還原 K 後壓縮仍生效(本測項不留副作用)', spdComp(Math.max(...rawV)) < Math.max(...rawV));
}

console.log(`\n${fail === 0 ? '🎉' : '❌'} 移速壓縮稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
