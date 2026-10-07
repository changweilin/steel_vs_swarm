import assert from 'node:assert/strict';
import { readSrc, grabFn } from '../tools/audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox } from '../public/js/data.js';
import { mapSourceKey } from '../public/js/mapLayerSources.js';
import { isRandomMap } from '../public/js/randomMapRules.js';
import { laneFingerprint, makeTerrainAssessment, validTerrainAssessment } from '../public/js/roadEvidence.js';
import { validMapSources } from '../public/js/mapSourceValidation.js';
import { projectAreaRecord, catalogAreas, subdivideLargeZones } from '../public/js/osmAreas.js';
import { MAP_EVIDENCE } from '../public/js/mapEvidence.js';
import { MAP_EVIDENCE_COPY } from '../public/js/help.js';
import { MAP_RULE_TEXT } from '../public/js/mapRulesContent.js';
import { mapGeometryAudit, requiresRoadTerrain } from '../public/js/mapRules.js';

const source = readSrc('public', 'js', 'mapPreparation.js').replace(/^import .*\n/gm, '').replace(/^export /gm, '');
const cfg = () => venueConfig(VENUES.find(v => v.id === 'berlin'), 5);

function harness(buildTerrain, persistentCache = new Map()) {
  let evidenceCalls = 0;
  const deps = { buildTerrain, warmOsm: async () => [null, []], battleBBox,
    projectAreaRecord, catalogAreas, subdivideLargeZones, llToWorld: () => [0, 0],
    prepareMapEvidence: async () => { evidenceCalls++; return { version: MAP_EVIDENCE.VERSION, checksum: 1, complete: true }; },
    MAP_EVIDENCE, MAP_EVIDENCE_COPY, MAP_RULE_TEXT, mapSourceKey, isRandomMap, requiresRoadTerrain,
    randomMapSources: () => { throw new Error('Unexpected procedural source'); },
    laneFingerprint, makeTerrainAssessment, validTerrainAssessment,
    geoKey: (...parts) => JSON.stringify(parts),
    geoGet: async key => structuredClone(persistentCache.get(key)),
    geoPut: async (key, pack) => { persistentCache.set(key, structuredClone(pack)); },
    validateEvidence: pack => pack.complete === true,
    localStorage: { getItem: () => null, setItem: () => {} }, console: { warn() {} } };
  const result = new Function(...Object.keys(deps), source + '\nreturn { prepareMapCreation, awaitPreparedPack, mapPrepKey };')(...Object.values(deps));
  return { ...result, evidenceCalls: () => evidenceCalls };
}

{
  let release, builds = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness(async () => { builds++; await gate; throw new Error('Relief unavailable'); });
  const first = cfg(), concurrent = cfg();
  const p1 = h.prepareMapCreation(first), p2 = h.prepareMapCreation(concurrent);
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert(a.failed && b.failed);
  assert.equal(builds, 1, 'concurrent preparations share one source request');
  for (const c of [first, concurrent]) assert(c.roadTerrain === null && !validMapSources(c));
  const cached = cfg();
  assert(validMapSources(cached), 'the cloned preset initially carries its archived assessment');
  assert((await h.prepareMapCreation(cached)).failed);
  assert(cached.roadTerrain === null && !validMapSources(cached), 'failed cache cannot reuse an inherited assessment');
  assert.equal(await h.awaitPreparedPack(cached), null);
  assert.equal(h.evidenceCalls(), 0);
}

{
  let builds = 0;
  const h = harness(async () => { builds++; return { sourceQuality: { elevationComplete: true }, elevationAt: () => 12 }; });
  const first = cfg(), concurrent = cfg();
  const [a, b] = await Promise.all([h.prepareMapCreation(first), h.prepareMapCreation(concurrent)]);
  assert(a.complete && b.complete);
  assert.equal(builds, 1);
  assert(validMapSources(first) && validMapSources(concurrent));
  assert.deepEqual(first.roadTerrain, concurrent.roadTerrain);
  assert.notEqual(first.roadTerrain, concurrent.roadTerrain);
  first.roadTerrain.samples[0] = 999;
  const cached = cfg();
  await h.prepareMapCreation(cached);
  assert(validMapSources(cached), 'caller mutation cannot corrupt the cached assessment');
  assert.equal(builds, 1);
  assert.equal(h.evidenceCalls(), 1);
  const altered = cfg(); altered.motherLanes[0][1][0] += .001;
  assert.notEqual(h.mapPrepKey(cached), h.mapPrepKey(altered), 'changed lanes invalidate their preparation key');
}

{
  const cache = new Map();
  const first = harness(async () => ({ sourceQuality: { elevationComplete: true }, elevationAt: () => 12 }), cache);
  await first.prepareMapCreation(cfg());
  const reloaded = harness(async () => { throw new Error('Cached relief must avoid a rebuild'); }, cache);
  const c = cfg(); c.roadTerrain = null;
  assert((await reloaded.prepareMapCreation(c)).complete);
  assert(validTerrainAssessment(c), 'persistent cache restores verified relief after reload');
  assert.equal(reloaded.evidenceCalls(), 0);
  for (const pack of cache.values()) delete pack.roadTerrain;
  const incomplete = harness(async () => { throw new Error('Relief unavailable'); }, cache);
  assert((await incomplete.prepareMapCreation(cfg())).failed, 'cached observations cannot bypass missing relief');
}

for (const terrain of [
  { sourceQuality: { elevationComplete: false }, elevationAt: () => 0 },
  { sourceQuality: { elevationComplete: true }, elevationAt: (x, z) => x * 10 + z * 10 },
]) {
  const h = harness(async () => terrain), c = cfg();
  assert((await h.prepareMapCreation(c)).failed);
  assert.equal(c.roadTerrain, null);
  assert.equal(h.evidenceCalls(), 0, 'incomplete or excessive relief stops before map observations');
}

{
  const h = harness(async () => { throw new Error('Missing natural relief'); });
  const natural = () => venueConfig(VENUES.find(v => v.id === 'phoenix'), 5);
  for (const c of [natural(), natural()]) {
    assert(validMapSources(c));
    assert((await h.prepareMapCreation(c)).failed);
    assert.equal(c.roadTerrain, null);
    assert(!validMapSources(c), 'the relaxed road count still clears stale terrain on cached failure');
  }
}

const main = readSrc('public', 'js', 'main.js');
function uiHarness(prepareMapCreation, phase = 'mapbuilder') {
  const app = { favCfg: cfg(), phaseShown: phase, teamSize: 5,
    mapSel: { fetchPlaceName: async () => {}, resetPlaceNameStats() {} } };
  const saves = [], sent = [], messages = [];
  app.net = { send: m => sent.push(m) };
  const elements = {
    mapStatus: { innerHTML: 'Original map', textContent: '' },
    openRoomStatus: { textContent: '' }, createRoomBtn: { disabled: false },
    envSeason: { value: 'summer' }, envTime: { value: 'day' }, envWeather: { value: 'clear' },
    roomNameInput: { value: '' }, createPublic: { checked: true },
  };
  let saveDisabled = false, prompts = 0;
  const deps = { app, $: id => elements[id], MAP_BUILD_TEAMSIZE: 5,
    isRandomMap, resolveMapRot: async () => {}, prepareMapCreation, buildYield: async () => {},
    mapGeometryAudit, validMapSources, MAP_RULE_TEXT, MAP_EVIDENCE_COPY,
    setFavBtnDisabled: value => { saveDisabled = value; }, toast: message => messages.push(message),
    prompt: () => { prompts++; return 'Saved map'; }, saveFavorite: (...args) => saves.push(args),
    console: { error() {} }, myName: () => 'Host', loadPrefs: () => ({}),
    DEFAULT_BOT_DIFF: 'medium', ctrlPref: () => 'fps',
  };
  const save = new Function(...Object.keys(deps), grabFn(main, 'saveMapFavorite') + '\nreturn saveMapFavorite;')(...Object.values(deps));
  const create = new Function(...Object.keys(deps), grabFn(main, 'createSelectedRoom') + '\nreturn createSelectedRoom;')(...Object.values(deps));
  return { app, elements, save, create, saves, sent, messages,
    disabled: () => saveDisabled, prompts: () => prompts };
}

for (const action of ['save', 'create']) {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const h = uiHarness(async () => { started(); await gate; return { complete: true }; }, action === 'save' ? 'mapbuilder' : 'openroom');
  const pending = h[action]();
  await ready;
  h.app.favCfg = cfg();
  h.elements.mapStatus.innerHTML = 'New map';
  h.elements.openRoomStatus.textContent = 'New room map';
  h.elements.createRoomBtn.disabled = false;
  release(); await pending;
  assert.equal(h.prompts(), 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.saves.length, 0);
  assert.equal(h.elements.mapStatus.innerHTML, 'New map');
  assert.equal(h.elements.openRoomStatus.textContent, 'New room map');
  assert.equal(h.elements.createRoomBtn.disabled, false, 'late preparation cannot change the new selection state');
}

for (const action of ['save', 'create']) {
  const h = uiHarness(async c => { c.roadTerrain = null; return { complete: false, failed: true }; }, action === 'save' ? 'mapbuilder' : 'openroom');
  await h[action]();
  assert.equal(h.prompts(), 0);
  assert.equal(h.saves.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(action === 'save' ? h.elements.mapStatus.textContent : h.elements.openRoomStatus.textContent, MAP_RULE_TEXT.roads);
}

const saved = uiHarness(async () => ({ complete: true }));
await saved.save();
assert.equal(saved.saves.length, 1);
assert.equal(saved.prompts(), 1);
assert(saved.disabled());
const room = uiHarness(async () => ({ complete: true }), 'openroom');
await room.create();
assert.equal(room.sent.length, 1);
assert.equal(room.sent[0].battleConfig, room.app.favCfg);
console.log('PASS map preparation: in-flight and cached failure invalidation, clone isolation, relief gates, lane cache keys and UI selection races.');
