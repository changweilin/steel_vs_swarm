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
    && /export function scopeKeep\(/.test(cull), '三判據全在同一縫(距離/遮擋/鏡圈)');
}

console.log('\n② 節流與曲線吃現有單一縫(無第二份實作)');
{
  const G = code(game);
  ok(/import \{[^}]*\} from '\.\/cull\.js'/.test(G), 'game.js 引用 cull.js 真品');
  ok(/lodDue\(frame, ent\.id/.test(G), '遮擋重測走 lod.js lodDue(無第二份 hash)');
  ok(/dofAimBlend\(cam\.fov, this\.baseFov,/.test(G), '狙擊/一般是 fov 連續 blend(非 aiming 布林)');
  ok(!/this\.aiming \? (cull|CULL)/.test(G), '無 aiming 三元分支的第二條剔除曲線');
  ok(/dofNearM\(\), farFar = dofFarM\(\)/.test(G), '距離錨取 dofNearM/dofFarM(與 DOF 全糊圈同一組)');
  ok(/scopeRvminFog\(this\._scopeFog/.test(G), '鏡圈半徑取 scopeRvminFog(與視野鎖定同一支)');
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
  // Blink guards: staggered occlusion MUST persist its verdict (hiding only on
  // test frames is a 15Hz blink + render-list churn); distance needs hysteresis.
  ok(/ent\._occCull/.test(G) && /ent\._occX/.test(G),
    '遮擋判據帶戳記跨幀沿用(到期或任一端位移才重測)');
  ok(/ent\._distCull/.test(G) && /CULL\.DIST_HYST/.test(G),
    '距離剔除帶遲滯(邊界抖動不閃進閃出)');
  ok(/CULL\.FRUSTUM_PAD_F/.test(G), '視錐球帶擴張邊距(掠邊不閃)');
  ok(/if \(this\.pipeline\) this\.pipeline\.render\(\); else this\.renderer\.render\(this\.scene, this\.camera\);/.test(G),
    '主相機渲染唯一出口在 _renderCulledMain 內(PiP/陣亡鏡頭走自己的相機)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 通過 ${pass} 項,失敗 ${fail} 項`);
process.exit(fail === 0 ? 0 : 1);
