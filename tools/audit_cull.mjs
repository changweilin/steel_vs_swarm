// ============ Pre-shading cull seam audit (presentation only) ============
// Guards the culling single seam introduced for "filter invisible objects before
// the expensive shading pipeline" (frustum + occlusion + distance, normal vs
// sniper modes).
//
// Pinned rules (all presentation-layer, A1/A10-compatible):
//   ① cull.js is zero-import pure math (same reason as lod.js): offline audits
//      import the real thing; data.js anchors (dofNearM/dofFarM/scopeRvminFog)
//      stay caller-owned in game.js, never hand-written here.
//   ② Stagger reuses lod.js lodDue (no second hash in cull.js).
//   ③ Sniper/normal is one continuous aim blend (dofAimBlend of camera.fov),
//      never an aiming-boolean gate (fov eases, the boolean flips instantly).
//   ④ Visibility flips live ONLY in _renderCulledMain (hide around the sync
//      main render, restore before PiP): gameplay gates reading mesh.visible
//      (collision, audio, foe()) never observe the culled state.
//   ⑤ Main-camera render has exactly one call site (inside _renderCulledMain);
//      PiP/deathcam render with their own camera after restore.
// Run: `node tools/audit_cull.mjs`
import { readSrc } from './audit_src.mjs';
import { CULL, scopeRadiusPx } from '../public/js/cull.js';

const cull = readSrc('public', 'js', 'cull.js');
let game = readSrc('public', 'js', 'game.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.error(`  ✗ ${msg}`)); };
// ---- Reverse verification: flip the tick call off, the audit MUST go red ----
const BREAKS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--break-')));
const bend = (src, tag, re, to) => {
  if (!BREAKS.has(tag)) return src;
  const out = src.replace(re, to);
  if (out === src) { console.error(`✗ ${tag}:替换无效(样式没咬到原文)`); process.exit(1); }
  return out;
};
game = bend(game, '--break-tick', /this\._tickCull\(\);/, 'this._tickCullX();');
/** Strip comments/template strings: mentions in prose MUST NOT count as code */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

console.log('== Pre-shading cull seam audit ==\n');

console.log('① cull.js 是零 import 純數學(單一縫、可離線直測)');
{
  ok(!/^\s*import\s/m.test(cull), 'cull.js 無 import(零依賴)');
  ok(!/from '\.\/data\.js'/.test(cull) && !/from '\.\/lod\.js'/.test(cull),
    'cull.js 不直連 data.js / lod.js(錨與節流由呼叫端餵入)');
  ok(/export const CULL = \{/.test(cull), 'CULL 常數表存在');
  ok(/export function cullFarM\(baseNear, baseFar,/.test(cull), 'cullFarM 由呼叫端餵錨(不手寫公尺)');
  ok(/export function keepDistance\(/.test(cull)
    && /export function occludedBySphere\(/.test(cull)
    && /export function scopeKeep\(/.test(cull)
    && /export function scopeRadiusPx\(/.test(cull), '四判據全在同一縫(距離/遮擋/鏡圈/鏡圈退場半徑)');
  ok(CULL.FRUSTUM_PAD_F >= 1.3 && CULL.FRUSTUM_PAD_M >= 5,
    `視錐保護邊距充足(FRUSTUM_PAD_F=${CULL.FRUSTUM_PAD_F}, FRUSTUM_PAD_M=${CULL.FRUSTUM_PAD_M}m)`);
  const hw = 960, hh = 540, rScope = 432, rDiag = Math.hypot(hw, hh);
  ok(scopeRadiusPx(rScope, hw, hh, 1) === rScope, '滿倍狙擊鏡(aimBlend=1)鏡圈半徑 = rScope');
  ok(scopeRadiusPx(rScope, hw, hh, 0.5) > rScope && scopeRadiusPx(rScope, hw, hh, 0.5) < rDiag,
    '退鏡過渡期鏡圈平滑擴張至螢幕對角線');
  ok(scopeRadiusPx(rScope, hw, hh, CULL.AIM_BLEND_EPS) === 0 && scopeRadiusPx(rScope, hw, hh, 0) === 0,
    '切回一般視野(aimBlend ≤ AIM_BLEND_EPS)鏡圈剔除完整歸零還原');
}

console.log('\n② 節流與曲線吃現有單一縫(無第二份實作)');
{
  const G = code(game);
  ok(/import \{[^}]*\} from '\.\/cull\.js'/.test(G), 'game.js 引用 cull.js 真品');
  ok(/lodDue\(frame, ent\.id/.test(G), '遮擋重測走 lod.js lodDue(無第二份 hash)');
  ok(/dofAimBlend\(cam\.fov, this\.baseFov,/.test(G), '狙擊/一般是 fov 連續 blend(非 aiming 布林)');
  ok(!/this\.aiming \? (cull|CULL)/.test(G), '無 aiming 三元分支的第二條剔除曲線');
  ok(/dofNearM\(\), farFar = dofFarM\(\)/.test(G), '距離錨取 dofNearM/dofFarM(與 DOF 全糊圈同一組)');
  ok(/scopeRvminFog\(this\._scopeFog/.test(G) && /scopeRadiusPx\(rScope, HW, HH, aimBlend\)/.test(G),
    '鏡圈半徑取 scopeRvminFog 並經 scopeRadiusPx 隨退鏡平滑還原至全螢幕');
  ok(/else if \(this\.camera\.fov !== wantFov\) \{\s*this\.camera\.fov = wantFov;/.test(G),
    '_updatePlayer 於 FOV 差 ≤ 0.05° 時精確吸附 wantFov(防退鏡卡在殘餘 blend)');
  ok(/_onSelfDeath\(\) \{[\s\S]*?this\.camera\.fov = this\.baseFov;/.test(G),
    '_onSelfDeath 立即還原 camera.fov = baseFov(防開鏡陣亡卡住狙擊鏡剔除)');
}

console.log('\n③ 可見性翻轉只住渲染窗口(玩法判定看不到剔除態)');
{
  const G = code(game);
  ok(/this\._tickCull\(\);/.test(G), '_tickCull 每幀呼叫');
  ok(/_renderCulledMain\(\) \{[^}]*ent\.mesh\.visible = false;/.test(G)
    && /_renderCulledMain\(\) \{[\s\S]*?ent\.mesh\.visible = true;/.test(G),
    '藏匿/還原成對住在 _renderCulledMain 內');
  const hideN = (G.match(/for \(const ent of list\) ent\.mesh\.visible = false;/g) || []).length;
  const showN = (G.match(/for \(const ent of list\) ent\.mesh\.visible = true;/g) || []).length;
  ok(hideN === 1 && showN === 1, `藏匿/還原各恰一處(實測 hide×${hideN}/show×${showN})`);
  // Blink & false-cull guards: staggered occlusion MUST persist its verdict (hiding
  // only on test frames is a 15Hz blink + render-list churn), track 3D movement
  // (including vertical y so jumping/flying units re-test), use inscribed building
  // spheres Math.min(r.w, r.d, r.h) * 0.5 (never circumscribed hypot), and cache
  // _cullOcc until _cullOccDirty; distance needs hysteresis.
  ok(/ent\._occCull/.test(G) && /ent\._occX/.test(G) && /ent\._occY/.test(G) && /ent\._occCY/.test(G),
    '遮擋判據帶 3D 座標戳記跨幀沿用(含垂直位移 _occY/_occCY,跳躍/升空即刻重測)');
  ok(/Math\.min\(r\.w, r\.d, r\.h\) \* 0\.5/.test(G) && /this\._cullOccDirty/.test(G),
    '遮擋球取建物真實內切半徑 Math.min(w,d,h)*0.5 並快取 _cullOcc(建物坍塌才重算)');
  ok(/ent\._distCull/.test(G) && /CULL\.DIST_HYST/.test(G),
    '距離剔除帶遲滯(邊界抖動不閃進閃出)');
  ok(/Math\.hypot\(rHoriz \* Math\.SQRT2, h \* 0\.5\) \* sk \* CULL\.FRUSTUM_PAD_F \+ CULL\.FRUSTUM_PAD_M/.test(G)
    && /\(top - h \* 0\.5\) \* sk/.test(G),
    '視錐球採 3D 外接球 + FRUSTUM_PAD_M 保護帶並對齊 dimTop(頭頂血條/陣營標/建築轉角掠邊不消失)');
  ok(/d2 > Math\.max\(25, rFrustum \* rFrustum\)/.test(G) && /v\.z <= 1 && !scopeKeep/.test(G),
    '鏡圈剔除防護近平面跨越球體(d ≤ rFrustum 或 z > 1 不誤剔)');
  ok(/if \(this\.pipeline\) this\.pipeline\.render\(\); else this\.renderer\.render\(this\.scene, this\.camera\);/.test(G),
    '主相機渲染唯一出口在 _renderCulledMain 內(PiP/陣亡鏡頭走自己的相機)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
