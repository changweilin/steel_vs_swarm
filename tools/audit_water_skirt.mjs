// ============ Road crossing water skirt audit (offline direct test, executes biomes.js source) ============
// User requirement (2026-07-28): roads crossing water or swamp need no bridge when they can skirt the edge; only a crossing to the far bank needs a bridge.
//   Rule (user decision of vertical two-side sampling plus tolerance, slanted-crossing fix reviewed 2026-07-28): for a soaked vertex measure dry-land distance lo and hi on both sides along the road normal --
//   edge skimming means asymmetry (near-bank side lo below SKIRT_NEAR, open-water side hi at or above SKIRT_OPEN), so push the vertex to the near bank;
//   far-bank crossing means symmetry or both sides near (lo near hi is never edge skimming, including slanted crossings), so build a bridge without skirting.
// Executes skirtWaterClips plus isWaterPt from biomes.js verbatim, verifying logic on synthetic terrain (heightAt).
// Usage: node tools/audit_water_skirt.mjs   exit code: 0 means all green, 1 means red
// After edits MUST reverse-verify (built-in control): 1 turning skirtWaterClips into a no-op turns the edge-skim section red; 2 dropping the other-side-open condition
//   (back to the old near-bank-only check) turns the slanted-crossing section red (a slanted crossing misjudged as edge skimming drops the whole bridge, the reviewed regression).
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

// Synthetic terrain: water predicate maps to heightAt (water -1, dry land 5; isWaterPt only checks heightAt below WATER.LEVEL plus 0.05)
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
  const t = terr((x) => Math.abs(x) < 20);      // North-south water band (20m half width, 40m wide), endless along z
  const run = lineRun(-80, 0, 80, 0);           // Road runs east-west at a right angle
  const before = wetCount(run, t, isWaterPt);
  skirtWaterClips(run, t);
  ok(before >= 6 && wetCount(run, t, isWaterPt) === before, `直角穿越:泡水頂點不變(${before} 全留)`);
}

console.log('Ⅱ 斜交穿越 45°(40m 河)→ 建橋不繞(複審回歸案)');
{
  const t = terr((x) => Math.abs(x) < 20);      // Same 40m-wide water band
  const run = lineRun(-70, -70, 70, 70);        // Road crosses at 45 degrees (both banks symmetric near 28m, the old build misjudged it as edge skimming)
  const before = wetCount(run, t, isWaterPt);
  skirtWaterClips(run, t);
  ok(before >= 6 && wetCount(run, t, isWaterPt) === before, `斜交穿越:泡水頂點不變(${before} 全留;不被繞掉整座橋)`);
}

console.log('Ⅲ 貼邊橫切(湖岸)→ 內部頂點推到乾地繞行');
{
  const t = terr((x, z) => z > -10);            // North half lake (water where z above -10), shoreline at z equal -10 (near bank 10m, open side infinite)
  const run = lineRun(0, 0, 90, 0);             // Road hugs the bank inside water (z equal 0)
  const before = wetCount(run, t, isWaterPt);
  skirtWaterClips(run, t);
  const afterInner = run.slice(1, -1).filter(([x, z]) => isWaterPt(t, x, z)).length;
  ok(before >= 6, `湖岸貼邊:繞行前泡水 ${before} 頂點`);
  ok(afterInner === 0, `繞行後內部頂點全脫水(貼到乾地;殘留 ${afterInner})`);
  ok(run.slice(1, -1).every(([x, z]) => z < -10), '內部頂點都被推到岸外乾地(z<-10)');
}

console.log('Ⅳ 一側中距岸(lo ≥ SKIRT_NEAR)→ 判橫跨,建橋不繞');
{
  const t = terr((x, z) => z > -40);            // Near bank 40m (at or above SKIRT_NEAR 30), other side endless deep water
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
