// Preset changes must notify once with complete, immutable state. Reloads must preserve the
// choice, while legacy knobs and broken storage must converge on a usable default.
// All preset shade floors must remain above the renderer's derived ramp floor.
import assert from 'node:assert/strict';
import { readSrc, grabFn, grabMethod } from './audit_src.mjs';
import * as prefs from '../public/js/visualPrefs.js';
import { ENV } from '../public/js/data.js';

const { VISUAL_PRESETS, VISUAL_KNOBS } = prefs;
assert.equal(VISUAL_PRESETS.length, 8);
assert.equal(prefs.DEFAULT_VISUAL_PRESET, 'messenger');
assert.equal(VISUAL_PRESETS[0].values.renderStyle, VISUAL_KNOBS.renderStyle.def);
assert.equal(new Set(VISUAL_PRESETS.map((p) => p.id)).size, VISUAL_PRESETS.length);
for (const environment of prefs.VISUAL_PREVIEW_ENVIRONMENTS) {
  assert.ok(ENV.times[environment.time]);
  assert.ok(ENV.weathers[environment.weather]);
  if (environment.season) assert.ok(ENV.seasons[environment.season]);
}
for (const p of VISUAL_PRESETS) {
  assert.equal(p.values.renderStyle, ['messenger', 'sakura'].includes(p.id) ? p.id : 'cel');
  assert.equal(p.values.celSchool, 'b');
  assert.equal(p.values.landInk, 0);
  assert.equal(p.values.lutSrc, 'none');
  assert.equal(p.values.shadow, 'on');
  assert.equal(p.values.inkGroup, 'on');
  for (const [k, v] of Object.entries(p.values)) {
    const d = VISUAL_KNOBS[k];
    assert.ok(d.choices ? d.choices.includes(v) : Number.isFinite(v) && v >= d.min && v <= d.max, `${p.id}.${k}`);
  }
  assert.ok(p.surface.cutWidth > 0);
  assert.ok(p.surface.shadowValue > 0);
  assert.ok(p.surface.outline > 0 && p.surface.outline < 1, `${p.id} keeps a thin silhouette`);
  assert.ok(Number.isInteger(p.surface.outlineColor) && p.surface.outlineColor >= 0 && p.surface.outlineColor <= 0xffffff);
  assert.ok(p.grade.nightLift >= 0 && p.grade.nightLift < 1);
  assert.ok(Number.isFinite(p.grade.exposure) && p.grade.exposure >= 1);
  assert.equal(p.grade.shadow.length, 3);
  assert.equal(p.grade.high.length, 3);
  assert.ok([...Object.values(p.surface), ...p.grade.shadow, ...p.grade.high,
    p.grade.saturation, p.grade.lift, p.grade.contrast].every(Number.isFinite));
  assert.ok(Object.isFrozen(p.values) && Object.isFrozen(p.grade.shadow));
}

const classic = VISUAL_PRESETS.find(p => p.id === 'classic');
const bold = VISUAL_PRESETS.find(p => p.id === 'bold');
const soft = VISUAL_PRESETS.find(p => p.id === 'soft');
assert.ok(bold.surface.outline > classic.surface.outline && bold.values.ink > classic.values.ink);
for (const p of VISUAL_PRESETS.filter(p => p.values.renderStyle === 'cel' && !['bold', 'classic', 'soft'].includes(p.id))) {
  assert.ok(p.surface.outline > soft.surface.outline && p.surface.outline < classic.surface.outline);
  assert.ok(p.values.ink > soft.values.ink && p.values.ink < classic.values.ink);
}

prefs.resetVisualPrefs();
prefs.setVisualPref('worldTextLang', 'zh');
let notifications = 0;
const events = [];
const off = prefs.onVisualChange((values) => {
  notifications++;
  events.push({ values, preset: prefs.visualPreset().id });
});
for (const p of VISUAL_PRESETS.slice(1)) {
  const before = notifications;
  prefs.setVisualPreset(p.id);
  assert.equal(notifications, before + 1);
  assert.equal(prefs.visualPreset().id, p.id);
  assert.equal(events.at(-1).preset, p.id);
  assert.ok(Object.isFrozen(events.at(-1).values));
  assert.deepEqual(events.at(-1).values, { ...p.values, worldTextLang: 'zh' });
  assert.deepEqual(prefs.visualPrefs(), { ...p.values, worldTextLang: 'zh' });
  prefs.setVisualPreset(p.id);
  assert.equal(notifications, before + 1);
}
off();
assert.equal(prefs.setVisualPreset('unknown'), prefs.DEFAULT_VISUAL_PRESET);
assert.ok(prefs.visualPrefsDefault());
assert.equal(prefs.visualPref('worldTextLang'), 'zh');
for (const key of ['toString', '__proto__', 'constructor']) {
  assert.equal(prefs.setVisualPref(key, 9), 0);
  assert.equal(prefs.visualPref(key), 0);
}
const copy = prefs.visualPrefs();
copy.ink = -99;
assert.notEqual(prefs.visualPref('ink'), copy.ink);

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let serial = 0;
async function loadStored(raw, blocked = false) {
  let stored = raw;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { if (blocked) throw new Error('Storage blocked'); return stored; },
    setItem(key, value) { if (blocked) throw new Error('Storage blocked'); stored = value; },
  } });
  const module = await import(`../public/js/visualPrefs.js?preset-audit=${serial++}`);
  return { module, stored: () => stored };
}
try {
  for (const raw of [null, '{broken', 'null', '[]', '7', JSON.stringify({ renderStyle: 'oil', ink: 999, worldTextLang: 'en' }), JSON.stringify({ preset: 'missing', ink: -100 })]) {
    const { module } = await loadStored(raw);
    assert.equal(module.visualPreset().id, prefs.DEFAULT_VISUAL_PRESET);
    assert.equal(module.visualPref('renderStyle'), VISUAL_PRESETS[0].values.renderStyle);
    assert.ok(module.visualPrefsDefault());
  }
  const legacy = await loadStored(JSON.stringify({ renderStyle: 'realistic', worldTextLang: 'en' }));
  assert.equal(legacy.module.visualPref('worldTextLang'), 'en');
  const stale = await loadStored(JSON.stringify({ preset: 'sky', renderStyle: 'oil', ink: 999, worldTextLang: 'en' }));
  assert.deepEqual(stale.module.visualPrefs(), { ...VISUAL_PRESETS.find(p => p.id === 'sky').values, worldTextLang: 'en' });
  for (const p of VISUAL_PRESETS) {
    const session = await loadStored(null);
    session.module.setVisualPreset(p.id);
    // The default may have no write; first toggle a different style to force persistence.
    if (session.stored() === null) { session.module.setVisualPreset('neon'); session.module.setVisualPreset(p.id); }
    const restored = await loadStored(session.stored());
    assert.equal(restored.module.visualPreset().id, p.id);
    assert.deepEqual(restored.module.visualPrefs(), p.values);
  }
  const blocked = await loadStored(null, true);
  blocked.module.setVisualPreset('bold');
  assert.equal(blocked.module.visualPreset().id, 'bold');
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else delete globalThis.localStorage;
}

const toon = readSrc('public', 'js', 'toon.js');
const post = readSrc('public', 'js', 'postfx.js');
const main = readSrc('public', 'js', 'main.js');
const preview = readSrc('public', 'js', 'matsample.js');
const styleIds = new Function(`return ${/export const RENDER_STYLES = (\{[\s\S]*?\});/.exec(toon)[1]};`)();
assert.deepEqual(Object.keys(styleIds), VISUAL_KNOBS.renderStyle.choices);
assert.equal(new Set(Object.values(styleIds)).size, Object.keys(styleIds).length);
const styleIndex = new Function('RENDER_STYLES', `${grabFn(toon, 'renderStyleIndex')}\nreturn renderStyleIndex;`)(styleIds);
for (const style of VISUAL_KNOBS.renderStyle.choices) assert.equal(styleIndex(style), styleIds[style]);
assert.match(toon, /outlineInkUniform\.value\.setHex\(surface\.outlineColor\)/);
assert.match(toon, /shader\.uniforms\.uOInk = outlineInkUniform/);
assert.match(post, /uInkColor: outlineInkUniform/);
assert.match(toon, /Math\.max\(rampFloor\(3\), CEL_CUT\.SHADOW_V \* surface\.shadowValue\)/);
assert.match(toon, /shader\.uniforms\.uCelCutWidth = _celCutWidth/);
assert.match(toon, /shader\.uniforms\.uCelShadowV = _celShadowValue/);
assert.match(post, /\.\.\._gradeUniforms/);
assert.match(post, /mix\( uGradeNightLift, 1\.0, daylight \)/);
assert.match(post, /mix\( 1\.0, uGradeExposure, daylight \)/);
assert.match(post, /this\._syncPrefs = \(\) => \{\s*this\.resetTaaHistory\(\)/);
const selector = grabFn(main, 'renderVisualSettings');
assert.doesNotMatch(selector, /type="range"|VISUAL_KNOBS|setVisualPref\(/);
assert.match(selector, /aria-pressed/);
assert.match(grabFn(main, 'disposeVisualSettings'), /_offVisualSettings\?\.\(\)/);
assert.match(grabMethod(preview, 'setEnvironment'), /this\.envFx\?\.dispose\(\)/);
assert.match(preview, /backgroundOnly: true, previewLights: this\._previewLights/);
assert.match(preview, /updateCelLight\(this\.camera, this\.envFx\?\.lightDirection/);
console.log('PASS: eight presets, Messenger default, style mapping, atomic changes, persistence/migration, shared ink and preview isolation');
