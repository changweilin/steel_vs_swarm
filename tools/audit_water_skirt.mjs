// ============ 馬路橫切水域「貼邊繞行」稽核(離線直測,執行 biomes.js 原文)============
// 使用者需求(2026-07-28):「馬路從水域/沼澤橫切時不需要建橋,貼著邊界繞過去即可,橫跨對岸時才需要建橋。」
//   判定法(使用者定案「垂向雙側取樣 + 誤差」,2026-07-28 複審修斜交):泡水頂點沿道路垂直方向兩側量到乾地距 lo/hi ——
//   貼邊橫切 = **不對稱**(一側近岸 lo<SKIRT_NEAR、另一側開放水域 hi≥SKIRT_OPEN)⇒ 推頂點到近岸繞行;
//   橫跨對岸 = **對稱或兩側皆近**(lo≈hi 恆非貼邊 ⇒ 含斜交穿越)⇒ 建橋不繞。
// 抽 biomes.js 的 skirtWaterClips + isWaterPt **原文**執行,合成地形(heightAt)驗證邏輯。
// 跑法:node tools/audit_water_skirt.mjs   退出碼:0 = 全綠;1 = 紅字
// **改完 MUST 反向驗證**(內建對照組):①skirtWaterClips 改 no-op ⇒「貼邊繞行」段紅字 ②去掉「另一側開放」條件
//   (回到舊版單看近岸)⇒「斜交穿越」段紅字(斜交被誤判成貼邊繞掉整座橋 = 複審抓到的回歸)。
import { WATER } from '../public/js/data.js';
import { readSrc } from './audit_src.mjs';

const src = readSrc('public', 'js', 'biomes.js');

function loadCore(mutate = (s) => s) {
  const iw0 = src.indexOf('function isWaterPt(terrain, x, z) {');
  const iwSrc = src.slice(iw0, src.indexOf('\n}', iw0) + 2);
  const skSrc = src.slice(src.indexOf('const SKIRT_NEAR = 30;'), src.indexOf('/**\n * 大面積水域自動高架橋'));
  if (skSrc.length < 100) throw new Error('切片標記找不到(改過就要同步改稽核)');
  const body = mutate(iwSrc + '\n' + skSrc).replace(/^export /gm, '');
  return new Function('WATER', `${body}\nreturn { skirtWaterClips, isWaterPt };`)(WATER);
}

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.error(`  ✗ ${msg}`)); };

// 合成地形:water 述詞 → heightAt(水域 −1、乾地 5;isWaterPt 只看 heightAt < WATER.LEVEL+0.05)
const terr = (isWater) => ({ heightAt: (x, z) => (isWater(x, z) ? -1 : 5) });
const lineRun = (x0, z0, x1, z1, step = 6) => {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / step)), r = [];
  for (let i = 0; i <= n; i++) r.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
  return r;
};
const wetCount = (run, t, iw) => run.filter(([x, z]) => iw(t, x, z)).length;

const { skirtWaterClips, isWaterPt } = loadCore();

console.log('Ⅰ 直角穿越(河)→ 建橋不繞');
{
  const t = terr((x) => Math.abs(x) < 20);      // 南北向水帶(|x|<20,40m 寬),沿 z 無限長
  const run = lineRun(-80, 0, 80, 0);           // 道路東西向直角穿越
  const before = wetCount(run, t, isWaterPt);
  skirtWaterClips(run, t);
  ok(before >= 6 && wetCount(run, t, isWaterPt) === before, `直角穿越:泡水頂點不變(${before} 全留)`);
}

console.log('Ⅱ 斜交穿越 45°(40m 河)→ 建橋不繞(複審回歸案)');
{
  const t = terr((x) => Math.abs(x) < 20);      // 同一條 40m 寬水帶
  const run = lineRun(-70, -70, 70, 70);        // 道路 45° 斜交穿越(兩岸垂向對稱 ≈28m,舊版誤判貼邊)
  const before = wetCount(run, t, isWaterPt);
  skirtWaterClips(run, t);
  ok(before >= 6 && wetCount(run, t, isWaterPt) === before, `斜交穿越:泡水頂點不變(${before} 全留;不被繞掉整座橋)`);
}

console.log('Ⅲ 貼邊橫切(湖岸)→ 內部頂點推到乾地繞行');
{
  const t = terr((x, z) => z > -10);            // 北半面湖(z>-10 水),岸線 z=-10(近岸側 10m,開放側 Inf)
  const run = lineRun(0, 0, 90, 0);             // 道路貼岸走在水裡(z=0)
  const before = wetCount(run, t, isWaterPt);
  skirtWaterClips(run, t);
  const afterInner = run.slice(1, -1).filter(([x, z]) => isWaterPt(t, x, z)).length;
  ok(before >= 6, `湖岸貼邊:繞行前泡水 ${before} 頂點`);
  ok(afterInner === 0, `繞行後內部頂點全脫水(貼到乾地;殘留 ${afterInner})`);
  ok(run.slice(1, -1).every(([x, z]) => z < -10), '內部頂點都被推到岸外乾地(z<-10)');
}

console.log('Ⅳ 一側中距岸(lo ≥ SKIRT_NEAR)→ 判橫跨,建橋不繞');
{
  const t = terr((x, z) => z > -40);            // 近岸側 40m(≥ SKIRT_NEAR 30)、另一側無限深水
  const run = lineRun(0, 0, 60, 0);
  const before = wetCount(run, t, isWaterPt);
  skirtWaterClips(run, t);
  ok(before >= 6 && wetCount(run, t, isWaterPt) === before, `近側 40≥30 → 不繞(泡水 ${before} 全留)`);
}

console.log('Ⅴ 反向驗證 A:skirtWaterClips 改 no-op ⇒ 貼邊不繞');
{
  const bad = loadCore((s) => s.replace('function skirtWaterClips(run, terrain) {', 'function skirtWaterClips(run, terrain) {\n  return;'));
  const t = terr((x, z) => z > -10);
  const run = lineRun(0, 0, 90, 0);
  bad.skirtWaterClips(run, t);
  ok(run.slice(1, -1).filter(([x, z]) => bad.isWaterPt(t, x, z)).length > 0, '對照組:no-op ⇒ 內部頂點仍泡水(稽核有牙齒)');
}

console.log('Ⅵ 反向驗證 B:去掉「另一側開放」條件(回舊版單看近岸)⇒ 斜交穿越被誤繞');
{
  const bad = loadCore((s) => s.replace('lo < SKIRT_NEAR && hi >= SKIRT_OPEN', 'lo < SKIRT_NEAR'));
  const t = terr((x) => Math.abs(x) < 20);
  const run = lineRun(-70, -70, 70, 70);
  const before = wetCount(run, t, bad.isWaterPt);
  bad.skirtWaterClips(run, t);
  ok(wetCount(run, t, bad.isWaterPt) < before, `對照組:少了對稱判斷 ⇒ 斜交穿越被繞掉(泡水 ${before}→${wetCount(run, t, bad.isWaterPt)},稽核有牙齒)`);
}

console.log(`\n${fail === 0 ? '✅ 全綠' : '❌ 有紅字'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
