// ============ Temporal Anti-Aliasing & Dynamic Resolution Scaling (TAA / DRS) Audit ============
// Guards the TAA + DRS single seam (`public/js/taa.js`) and its integration in
// `public/js/postfx.js` and `public/js/game.js`:
//   ① `taa.js` is zero-import pure deterministic math (Halton(2,3) sub-pixel jitter,
//      DRS-adaptive temporal blend & sharpening, and scene-complexity-weighted DRS governor).
//      Server authority (`server/sim.js`) never imports `taa.js`.
//   ② `postfx.js` applies Halton sub-pixel jitter to `camera.projectionMatrix.elements[8..9]`
//      ONLY around `r.render(this.scene, this.camera)` and immediately restores it so
//      gameplay raycasts and HUD projections never observe jittered matrices.
//   ③ `postfx.js` runs TAA in linear color space after `grade` and before `wipe`/`fxaa`,
//      using 3D depth motion reprojection (`uReprojMat`), 3x3 YCoCg variance neighborhood
//      clamping, Karis luma weighting, and lazy ping-pong history resize (`rtHistA`/`rtHistB`)
//      so DRS step changes preserve history rather than flashing un-antialiased frames.
//   ④ `game.js` samples scene complexity (`calls`, `triangles`, `entities`, `effects`) in
//      `_sceneComplexity()`, feeds `_tickResGov(ms, now)` to dynamically scale `_resScale`
//      when complexity rises and FPS drops, and syncs `_resScale` to `pipeline.setResScale`.
// Run: `node tools/audit_taa_drs.mjs`
import { readSrc } from './audit_src.mjs';
import {
  TAA, DRS,
  halton, taaJitterPx, taaProjectionOffset, taaBlendAlpha, taaSharpenWeight,
  drsComplexity, drsEffectiveMs, drsStepDown, drsHoldS, drsRecoverLoMs,
} from '../public/js/taa.js';

const taaSrc = readSrc('public', 'js', 'taa.js');
let postfxSrc = readSrc('public', 'js', 'postfx.js');
let gameSrc = readSrc('public', 'js', 'game.js');
const simSrc = readSrc('server', 'sim.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };

const BREAKS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--break-')));
const bend = (src, tag, re, to) => {
  if (!BREAKS.has(tag)) return src;
  const out = src.replace(re, to);
  if (out === src) { console.error(`✗ ${tag}:替換無效(樣式沒咬到原文)`); process.exit(1); }
  return out;
};

postfxSrc = bend(postfxSrc, '--break-jitter-restore', /if \(useTaa && pe\) \{ pe\[8\] = p8; pe\[9\] = p9; \}/, '');
postfxSrc = bend(postfxSrc, '--break-taa-order', /if \(useTaa\) chain\.push\('taa'\);/, '');
gameSrc = bend(gameSrc, '--break-drs-complexity', /const complexity = this\._sceneComplexity\(\);/, 'const complexity = 0;');
gameSrc = bend(gameSrc, '--break-res-sync', /this\.pipeline\?\.setResScale\?\.\(this\._resScale\);/g, '');

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('== TAA / DRS (時間性抗鋸齒與動態解析度) 稽核 ==\n');

console.log('① taa.js 單一縫與純數學不變量(Halton 抖動 / 權重 / 複雜度)');
{
  const T = code(taaSrc), S = code(simSrc);
  ok(!/^\s*import\s/m.test(T) && !/Math\.random|mulberry32/.test(T) && !/taa\.js/.test(S),
    'taa.js 零 import、零隨機數,且與 server/sim.js 完全隔離');
  ok(TAA.SAMPLES === 8 && TAA.BASE_ALPHA > 0 && TAA.DRS_ALPHA_BOOST > 0 && TAA.MIN_ALPHA < TAA.BASE_ALPHA,
    'TAA 常數表齊備(8 相位 Halton、DRS 降階時提高歷史權重以累積更多次像素細節)');
  ok(DRS.MIN === 0.7 && DRS.STEP === 0.1 && DRS.MAX_DOWN_STEP === 0.2 && DRS.HI_MS === 20 && DRS.LO_MS === 17.2,
    'DRS 常數表齊備(下限 0.7、常規步幅 0.1、重載加速步幅 0.2)');

  // Halton(2,3) 8 相位覆蓋四個象限且均值趨近 0(無次像素偏移偏差)
  let sumX = 0, sumY = 0, qPP = 0, qPN = 0, qNP = 0, qNN = 0;
  for (let i = 0; i < TAA.SAMPLES; i++) {
    const [jx, jy] = taaJitterPx(i, 1.0);
    sumX += jx; sumY += jy;
    if (jx > 0 && jy > 0) qPP++;
    if (jx > 0 && jy < 0) qPN++;
    if (jx < 0 && jy > 0) qNP++;
    if (jx < 0 && jy < 0) qNN++;
  }
  ok(qPP > 0 && qPN > 0 && qNP > 0 && qNN > 0,
    `Halton(2,3) 8 相位完整覆蓋次像素四象限(${qPP}/${qPN}/${qNP}/${qNN})`);
  ok(Math.abs(sumX / TAA.SAMPLES) < 0.1 && Math.abs(sumY / TAA.SAMPLES) < 0.1,
    'Halton 序列週期重心接近 0(不會把畫面恆定往單側推)');
  ok(halton(1, 2) === 0.5 && Math.abs(halton(1, 3) - 1 / 3) < 1e-12,
    'halton(index, base) 基數反轉精確(1/2 與 1/3)');

  // DRS 降階時自動放大次像素取樣跨度、加深歷史累積並補償銳化
  const [jFullX, jFullY] = taaJitterPx(0, 1.0), [jLowX, jLowY] = taaJitterPx(0, DRS.MIN);
  ok(Math.hypot(jLowX, jLowY) > Math.hypot(jFullX, jFullY),
    'DRS 降解析度時自動拉大次像素抖動跨度以提升超解析重建覆蓋率');
  const [ox, oy] = taaProjectionOffset(0.5, -0.25, 1920, 1080);
  ok(Math.abs(ox - 1 / 1920) < 1e-12 && Math.abs(oy - (-0.5 / 1080)) < 1e-12,
    'taaProjectionOffset 正確換算 NDC 投影矩陣偏移(2 * j / dim)');
  ok(taaProjectionOffset(NaN, 0.5, 0, 1080)[0] === 0, '非法輸入安全退回 0 偏移');

  const aStaticFull = taaBlendAlpha(1.0, 0);
  const aStaticLow = taaBlendAlpha(DRS.MIN, 0);
  const aMotionFull = taaBlendAlpha(1.0, 0.05);
  ok(aStaticLow > aStaticFull && aMotionFull < aStaticFull && aMotionFull >= TAA.MIN_ALPHA,
    `時間歷史權重隨解析度與運動自適應(滿檔靜止 ${aStaticFull.toFixed(3)} / 低解靜止 ${aStaticLow.toFixed(3)} / 高速移動 ${aMotionFull.toFixed(3)})`);
  ok(taaSharpenWeight(DRS.MIN) > taaSharpenWeight(1.0),
    `反差自適應銳化隨 DRS 降階自動補償(${taaSharpenWeight(1.0).toFixed(3)} → ${taaSharpenWeight(DRS.MIN).toFixed(3)})`);
}

console.log('\n② 動態解析度(DRS)複雜度感知與穩幀曲線');
{
  const cIdle = drsComplexity({ calls: 0, triangles: 0, entities: 0, effects: 0 });
  const cMid = drsComplexity({ calls: 80, triangles: 45000, entities: 22, effects: 30 });
  const cHeavy = drsComplexity({ calls: 400, triangles: 200000, entities: 160, effects: 120 });
  ok(cIdle === 0 && cMid > 0.3 && cMid < 0.7 && Math.abs(cHeavy - 1) < 1e-12,
    `畫面複雜度正規化正確(閒置 ${cIdle} / 中載 ${cMid.toFixed(2)} / 滿載 ${cHeavy.toFixed(2)})`);

  ok(drsEffectiveMs(19.6, 0) === 19.6 && drsEffectiveMs(19.6, 0.9) > DRS.HI_MS,
    '高複雜度下有效幀時提前跨越 HI_MS 門檻(大場面掉幀前兆即啟動降解析度)');
  ok(drsStepDown(21, 0.1) === DRS.STEP && drsStepDown(26, 0.9) === DRS.MAX_DOWN_STEP,
    '重度複雜度合併嚴重掉幀時單次跨雙階(0.2)快速救回幀率');
  ok(drsHoldS(19, 0.2) === DRS.HOLD_S && drsHoldS(24, 0.9) < DRS.HOLD_S && drsHoldS(30, 1.0) === DRS.FAST_HOLD_S,
    `高複雜度掉幀時縮短降階觀察期(HOLD_S ${DRS.HOLD_S}s → ${DRS.FAST_HOLD_S}s)`);
  ok(drsRecoverLoMs(0) === DRS.LO_MS && drsRecoverLoMs(0.9) < DRS.LO_MS - 1.5,
    '高複雜度交戰中壓低升階門檻(防止大場面剛穩住就立刻升回高解析度造成震盪)');
}

console.log('\n③ postfx.js 時間性抗鋸齒(TAA)管線與歷史緩衝生命週期');
{
  const P = code(postfxSrc);
  ok(/import \{[^}]*taaJitterPx[^}]*\} from '\.\/taa\.js'/.test(P), 'postfx.js 從 taa.js 單一縫匯入 TAA 數學');
  ok(/this\.rtHistA = this\._mkRT\(false\)/.test(P) && /this\.rtHistB = this\._mkRT\(false\)/.test(P),
    '配置雙歷史緩衝 rtHistA / rtHistB 供跨幀 ping-pong 累積');
  ok(/for \(const rt of \[this\.rtScene, this\.rtA, this\.rtB, this\.rtHistA, this\.rtHistB\]\)/.test(P),
    'dispose() 完整釋放 rtHistA 與 rtHistB');
  ok(/pe\[8\] = p8 \+ dxNdc;\s*pe\[9\] = p9 \+ dyNdc;/.test(P)
    && /r\.render\(this\.scene, this\.camera\);\s*if \(useTaa && pe\) \{ pe\[8\] = p8; pe\[9\] = p9; \}/.test(P),
    '相機投影次像素抖動僅包裹主場景渲染並在結束當場還原(不汙染 raycast 與 HUD 投影)');
  ok(/if \(histWrite\.width !== w \|\| histWrite\.height !== h\) histWrite\.setSize\(w, h\);/.test(P),
    '歷史緩衝採寫入端延遲縮放(DRS 切換解析度當幀仍能雙線性取樣上一幀歷史,不閃爍)');

  const R = /  render\(\) \{[\s\S]*?\n  \}/.exec(P)?.[0] || '';
  const iG = R.indexOf("chain.push('grade')"), iT = R.indexOf("chain.push('taa')"), iF = R.indexOf("chain.push('fxaa')");
  ok(iG >= 0 && iT > iG && iF > iT,
    'TAA 排在 grade 之後、fxaa 之前(在線性空間累積勾線與調色後的像素,再交由鏈尾轉 sRGB)');

  const M = /_taaMaterial\(\) \{[\s\S]*?\n  \}/.exec(P)?.[0] || '';
  ok(/uReprojMat/.test(M) && /rgbToYCoCg/.test(M) && /ycocgToRgb/.test(M) && /wCurr/.test(M) && /wHist/.test(M) && /uTaaSharp/.test(M),
    'TAA Shader 具備 3D 深度重投影、YCoCg 3x3 變異數鄰域夾制、Karis 亮度權重與反差銳化補償');
}

console.log('\n④ game.js 畫面複雜度取樣與 TAA / DRS 接線');
{
  const G = code(gameSrc);
  ok(/import \{[^}]*drsComplexity[^}]*\} from '\.\/taa\.js'/.test(G), 'game.js 從 taa.js 匯入 DRS 曲線');
  ok(/taa: !off\('taa'\)/.test(G), 'game.js 支援 ?taa=0 獨立圖層開關並預設啟用 TAA');
  const syncCount = (G.match(/this\.pipeline\?\.setResScale\?\.\(this\._resScale\);/g) || []).length;
  ok(syncCount === 2, `game.js 於初始化與 _applyRes 同步 _resScale 至 TAA 管線(實測 ${syncCount} 處)`);
  ok(/_sceneComplexity\(\) \{[\s\S]*?drsComplexity\(\{[\s\S]*?calls:[\s\S]*?triangles:[\s\S]*?entities:[\s\S]*?effects:/.test(G),
    '_sceneComplexity() 聚合 draw calls、triangles、entities 與動態特效數量');
  ok(/const complexity = this\._sceneComplexity\(\);/.test(G)
    && /drsEffectiveMs\(ms, complexity, RES_GOV\)/.test(G)
    && /drsHoldS\(g\.ema, complexity, RES_GOV\)/.test(G)
    && /drsStepDown\(g\.ema, complexity, RES_GOV\)/.test(G)
    && /drsRecoverLoMs\(complexity, RES_GOV\)/.test(G),
    '_tickResGov 完整接入複雜度加權幀時、動態降階步幅、緊急觀察期與抗震盪回復門檻');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
