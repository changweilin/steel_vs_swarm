import assert from 'node:assert/strict';
import { MapSelect } from '../public/js/mapSelect.js';
import { MAPGEO, llToXZ, MOTHER_LANES } from '../public/js/data.js';
import { synthLane } from '../public/js/venues.js';
import { MAP_SELECT_TEXT } from '../public/js/mapSelectContent.js';
import { validateBattleConfig } from '../server/rooms.js';
import { mockSearchRoads, mockRouteData } from './mapRoadFixtures.mjs';

const saved = { fetch: globalThis.fetch, Image: globalThis.Image, document: globalThis.document,
  L: globalThis.L, gap: MAPGEO.CUSTOM_SEARCH.REQUEST_GAP_MS, timeout: MAPGEO.CUSTOM_SEARCH.REQUEST_TIMEOUT_MS,
  sourceTimeout: MAPGEO.CUSTOM_SEARCH.SOURCE_TIMEOUT_MS };
const layer = () => ({ bindTooltip() { return this; }, addTo() { return this; }, on() { return this; } });
globalThis.L = { circleMarker: layer, polyline: layer, polygon: layer,
  latLngBounds: () => ({ pad() { return this; } }), DomEvent: { stopPropagation() {} } };
globalThis.Image = class { set src(value) { queueMicrotask(() => this.onerror?.()); } };
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
MAPGEO.CUSTOM_SEARCH.REQUEST_GAP_MS = 0;
MAPGEO.CUSTOM_SEARCH.REQUEST_TIMEOUT_MS = 100;
MAPGEO.CUSTOM_SEARCH.SOURCE_TIMEOUT_MS = 100;

const makeSelector = () => {
  const selector = Object.create(MapSelect.prototype);
  const events = { ready: [], statuses: [], lists: [] };
  Object.assign(selector, { anchor: null, candidates: [], chosen: null, venue: null, _layers: [],
    map: { removeLayer() {}, fitBounds() {} }, h: {
      roads: async () => mockSearchRoads(selector.anchor), elevation: async () => () => 0,
      confirmReady: cfg => events.ready.push(cfg), status: text => events.statuses.push(text),
      candidates: (list, index) => events.lists.push({ list, index }),
    } });
  return { selector, events };
};
const endpoints = url => new URL(url).pathname.split('/').at(-1).split(';')
  .map(p => p.split(',').map(Number).reverse());
const response = data => ({ ok: true, json: async () => data });
const routeResponse = (points, shape = 0) => {
  return response(mockRouteData(points, shape));
};
const origin = [25.033, 121.565];

try {
  let scans = 0;
  globalThis.fetch = async url => {
    const points = endpoints(url);
    if (points.length === 2) scans++;
    return routeResponse(points);
  };
  const { selector, events } = makeSelector();
  await selector._onClick(origin);
  assert.equal(scans, MAPGEO.CANDIDATE_BEARINGS / 2 * 5, 'scan continues after the first four matches');
  assert.equal(selector.candidates.length, MAPGEO.MAX_CANDIDATES);
  assert.equal(selector.chosen, selector.candidates[0]);
  assert(events.ready.at(-1), 'the best map is immediately usable');
  for (const candidate of selector.candidates) {
    assert.notDeepEqual(candidate.bases.SWARM, origin, 'a search center is not a fixed faction base');
    assert.equal(candidate.lanes.length, MOTHER_LANES);
    for (const lane of candidate.lanes) {
      assert.deepEqual(lane[0], candidate.bases.SWARM);
      assert.deepEqual(lane.at(-1), candidate.bases.STEEL);
    }
    assert(candidate.match.score >= 0 && candidate.match.score <= 1);
  }
  for (let i = 1; i < selector.candidates.length; i++) {
    assert(selector.candidates[i - 1].match.score >= selector.candidates[i].match.score);
  }
  assert.equal(validateBattleConfig(selector.buildConfig(), 5), null);
  selector.selectCandidate(2);
  assert.equal(selector.chosen, selector.candidates[2]);
  assert.deepEqual(selector.buildConfig().bases, selector.candidates[2].bases);
  assert.equal(selector.selectNextCandidate(), 3);
  assert.equal(selector.selectNextCandidate(), 0);
  selector.selectCandidate(NaN);
  assert.equal(selector.chosen, selector.candidates[0]);

  // Nearby centers remain eligible when the selected center has no route.
  scans = 0;
  let late = false;
  globalThis.fetch = async url => {
    const points = endpoints(url);
    if (points.length === 2) late = ++scans > MAPGEO.CANDIDATE_BEARINGS / 2;
    return late ? routeResponse(points) : response({ code: 'NoRoute' });
  };
  const shifted = makeSelector().selector;
  await shifted._onClick(origin);
  assert(shifted.candidates.length > 0);
  assert(shifted.candidates.some(c => c.match.distanceM > 100), 'ranking scans other nearby centers and accounts for proximity');

  globalThis.fetch = async () => response({ code: 'NoRoute' });
  const empty = makeSelector();
  await empty.selector._onClick(origin);
  assert.equal(empty.selector.candidates.length, 0, 'valid NoRoute replies do not create an offline map');
  assert.equal(empty.events.statuses.at(-1), MAP_SELECT_TEXT.noMatch);
  assert.equal(empty.events.ready.at(-1), null);

  globalThis.fetch = async () => { throw new Error('offline'); };
  const offline = makeSelector().selector;
  await offline._onClick(origin);
  assert.equal(offline.candidates.length, 0, 'true-road mode never fabricates offline lanes');
  assert.equal(offline.buildConfig(), null);

  let timedOut = 0;
  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { timedOut++; reject(new Error('timeout')); }, { once: true });
  });
  const timeout = makeSelector().selector;
  await timeout._onClick(origin);
  assert.equal(timedOut, MAPGEO.CUSTOM_SEARCH.OFFLINE_FAILURE_LIMIT, 'stalled services have bounded retries');
  assert.equal(timeout.candidates.length, 0);
  assert.equal(timeout._searching, false);

  globalThis.fetch = async () => response({ code: 'Ok', routes: [{ distance: NaN, geometry: { coordinates: [] } }] });
  const invalid = makeSelector().selector;
  await invalid._onClick(origin);
  assert.equal(invalid.candidates.length, 0, 'malformed routes are omitted');

  globalThis.fetch = async url => {
    const points = endpoints(url).map(([lat, lng]) => [lat + 0.01, lng]);
    return routeResponse(points);
  };
  const distant = makeSelector().selector;
  await distant._onClick(origin);
  assert.equal(distant.candidates.length, 0, 'road snapping cannot move the search far from the requested area');

  globalThis.fetch = async url => {
    const points = endpoints(url);
    return points.length === 3 ? response({ code: 'NoRoute' }) : routeResponse(points);
  };
  const missingFlank = makeSelector().selector;
  await missingFlank._onClick(origin);
  assert.equal(missingFlank.candidates.length, 0, 'a missing flank cannot become a synthetic road');

  globalThis.fetch = async url => {
    const data = mockRouteData(endpoints(url)), good = structuredClone(data.routes[0]);
    data.routes[0].geometry.coordinates[1][0] += .01;
    data.routes[0].distance *= 100;
    data.routes.push(good);
    return response(data);
  };
  const alternatives = makeSelector().selector;
  await alternatives._onClick(origin);
  assert(alternatives.candidates.length > 0, 'verified alternatives survive an off-road primary route');

  const noElevation = makeSelector(); noElevation.selector.h.elevation = async () => null;
  await noElevation.selector._onClick(origin);
  assert.equal(noElevation.events.statuses.at(-1), MAP_SELECT_TEXT.missingElevation);
  let elevationStarted, releaseElevation;
  const elevationReady = new Promise(resolve => { elevationStarted = resolve; });
  const cancelledElevation = makeSelector();
  cancelledElevation.selector.h.elevation = () => new Promise(resolve => { releaseElevation = resolve; elevationStarted(); });
  const pendingElevation = cancelledElevation.selector._onClick(origin);
  await elevationReady;
  cancelledElevation.selector.reset();
  await pendingElevation;
  releaseElevation(() => 0);
  assert.equal(cancelledElevation.events.statuses.at(-1), MAP_SELECT_TEXT.idle, 'cancelled source sampling cannot overwrite the reset status');
  const stalledSource = makeSelector(); stalledSource.selector.h.roads = () => new Promise(() => {});
  await stalledSource.selector._onClick(origin);
  assert.equal(stalledSource.events.statuses.at(-1), MAP_SELECT_TEXT.missingSources);

  let started;
  const inFlight = new Promise(resolve => { started = resolve; });
  let release;
  globalThis.fetch = url => new Promise(resolve => { release = () => resolve(routeResponse(endpoints(url))); started(); });
  const cancelled = makeSelector();
  const oldSearch = cancelled.selector._onClick(origin);
  await inFlight;
  globalThis.fetch = async url => routeResponse(endpoints(url));
  const newOrigin = [35.6595, 139.7004];
  const newSearch = cancelled.selector._onClick(newOrigin);
  release();
  await Promise.all([oldSearch, newSearch]);
  assert.deepEqual(cancelled.selector.anchor, newOrigin);
  assert(cancelled.selector.buildConfig().center.lat > 35, 'late responses cannot overwrite a new search');
  assert.equal(cancelled.selector._searching, false);
  cancelled.selector.reset();
  assert.equal(cancelled.selector.buildConfig(), null);
  assert.equal(cancelled.events.lists.at(-1).list.length, 0);
  console.log('PASS: verified three-road search, complete-scan ranking, authority validation, selection, NoRoute, offline omission, bounded timeouts, invalid data, distant snapping and cancellation.');
} finally {
  globalThis.fetch = saved.fetch;
  globalThis.Image = saved.Image;
  globalThis.document = saved.document;
  globalThis.L = saved.L;
  MAPGEO.CUSTOM_SEARCH.REQUEST_GAP_MS = saved.gap;
  MAPGEO.CUSTOM_SEARCH.REQUEST_TIMEOUT_MS = saved.timeout;
  MAPGEO.CUSTOM_SEARCH.SOURCE_TIMEOUT_MS = saved.sourceTimeout;
}

if (process.argv.includes('--browser')) {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { ROOT, readSrc, grabFn } = await import('../tools/audit_src.mjs');
  const { chromiumOrNull, chromePath } = await import('../tools/pw.mjs');
  const chromium = await chromiumOrNull();
  assert(chromium, 'browser verification requires the existing development Playwright runtime');
  const main = readSrc('public', 'js', 'main.js');
  // Execute production UI callbacks with rendering and external services isolated.
  const entry = `
    import { MapSelect } from './mapSelect.js';
    import { MAP_SELECT_TEXT, mapCandidateLabel, mapCandidateSource } from './mapSelectContent.js';
    import { MAPGEO, TEAM, llToXZ, xzToLL, targetDistFor, MOTHER_LANES } from './data.js';
    import { VENUES, synthLane, venueAvailability, VENUE_BASES, VARIANT_DEFS, PRESET_VENUES, STORY_VENUES, venueTip } from './venues.js';
    import { MAP_RULE_TEXT } from './mapRulesContent.js';
    import { GEN_BIOMES, MAX_WATER_WET, describeGen, biomeName, randomMapConfig } from './mapgen.js';
    import { generateMixedMap } from './mixedMap.js';
    import { MIXED_LAYERS } from './mapLayerSources.js';
    import { MIXED_MAP_TEXT } from './mixedMapContent.js';
    import { isRandomMap, RANDOM_MAP_RANGES, randomRangeStep } from './randomMapRules.js';
    import { RANDOM_MAP_TEXT } from './randomMapContent.js';
    import { drawRandomMapPreview } from './randomMapPreview.js';
    const app = window.mapReview = { mapGenMode: 'preset', mapSel: null };
    const $ = id => document.getElementById(id);
    const MAP_BUILD_TEAMSIZE = TEAM.MAX;
    const show = id => {
      app.phaseShown = id; document.body.dataset.screen = id;
      document.querySelectorAll('.screen').forEach(e => e.style.display = e.id === id ? '' : 'none');
    };
    const ensureLeaflet = async () => { window.mapReviewLeafletCalls = (window.mapReviewLeafletCalls || 0) + 1; };
    const triggerBackgroundMapSetup = () => {};
    const syncVenueTips = () => {};
    const warmModels = () => {};
    const toast = () => {};
    const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    ${grabFn(readSrc('test', 'mapRoadFixtures.mjs'), 'mockSearchRoads')}
    ${grabFn(readSrc('test', 'mapRoadFixtures.mjs'), 'mockRouteData')}
    const fetchOsmRoads = async (b, options = {}) => {
      if (options.evidence) return mockSearchRoads(app.mapSel.anchor);
      const roads = [{ tags: { highway: 'residential' }, geometry: [{ lat: b.minLat, lon: b.minLng }, { lat: b.maxLat, lon: b.maxLng }] }];
      return window.mapReviewHold ? new Promise(resolve => { window.mapReviewRelease = () => resolve(roads); }) : roads;
    };
    let _mixedGeneration = null;
    const attachTip = (e, text) => e.setAttribute('data-review-tip', text);
    const fitVenueMarquee = () => {};
    ${grabFn(main, 'venueBtn')}
    ${grabFn(main, 'renderVenueGroups')}
    ${grabFn(main, 'renderVenues')}
    const layer = () => ({ bindTooltip() { return this; }, addTo() { return this; }, on() { return this; } });
    window.L = { circleMarker: layer, polyline: layer, polygon: layer, tileLayer: layer,
      map: () => ({ setView() { return this; }, on() {}, removeLayer() {}, fitBounds() {}, invalidateSize() {} }),
      latLngBounds: () => ({ pad() { return this; } }), control: { layers: layer }, DomEvent: { stopPropagation() {} } };
    window.Image = class { set src(value) { queueMicrotask(() => this.onerror?.()); } };
    MAPGEO.CUSTOM_SEARCH.REQUEST_GAP_MS = 0;
    window.fetch = async url => {
      const points = new URL(url).pathname.split('/').at(-1).split(';').map(p => p.split(',').map(Number).reverse());
      return new Response(JSON.stringify(mockRouteData(points)));
    };
    ${grabFn(main, 'setFavBtnDisabled')}
    ${grabFn(main, 'cancelMixedGeneration')}
    ${grabFn(main, 'renderMixedSrcGrid')}
    ${grabFn(main, 'renderMixedMixRows')}
    ${grabFn(main, 'readMixedSliders')}
    ${grabFn(main, 'genMixedFromUI')}
    ${grabFn(main, 'genRandomFromUI')}
    ${grabFn(main, 'readRandomRanges')}
    ${grabFn(main, 'acceptGenCfg')}
    ${grabFn(main, 'initMapGenUI')}
    ${grabFn(main, 'syncMapGenModeRow')}
    ${grabFn(main, 'enterMapBuilder')}
    document.documentElement.classList.add('app-ready');
    await enterMapBuilder('random');
    genRandomFromUI();
    window.mapReviewRandomFirst = !app.mapSel && !window.mapReviewLeafletCalls && app.favCfg?.gen?.mode === 'random';
    await enterMapBuilder();
    app.mapSel.h.elevation = async () => () => 0;
    await app.mapSel._onClick([25.033, 121.565]);
    window.mapReviewReady = true;
  `;
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', error => console.error('Browser runtime error:', error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'map-review.local') { await route.abort(); return; }
        const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        if (path === '/js/main.js') {
          await route.fulfill({ contentType: 'text/javascript', body: entry });
          return;
        }
        const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        try { await route.fulfill({ contentType, body: await readFile(join(ROOT, 'public', path)) }); }
        catch { await route.abort(); }
      });
      await page.goto('http://map-review.local/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.mapReviewReady);
      assert(await page.evaluate(() => window.mapReviewRandomFirst), 'first-use random mode generates without loading Leaflet or a geographic selector');
      assert.equal(await page.locator('#venueGrid [data-vid="madrid"]').isDisabled(), true);
      assert.equal(await page.locator('#venueGrid [data-vid="berlin"]').isDisabled(), false);
      assert.match(await page.locator('#venueGrid [data-vid="madrid"]').textContent(), /待驗證/);
      if (viewport.width < 600) {
        await page.evaluate(() => document.body.classList.add('touch-ui', 'ori-portrait'));
      }
      const items = page.locator('#mapCandidates button');
      assert.equal(await items.count(), MAPGEO.MAX_CANDIDATES);
      assert.match(await items.first().textContent(), /第 1 名.*吻合/);
      await items.nth(2).click();
      assert.equal(await items.nth(2).getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#mapStatus').textContent(), /已選定第 3\/4 名/);
      assert.equal(await page.locator('#saveFavBtn').isDisabled(), false);
      const fits = await page.evaluate(() => [...document.querySelectorAll('#mapCandidates button')].every(e => {
        const r = e.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth;
      }));
      assert(fits, 'candidate labels fit the viewport without horizontal overflow');
      await page.evaluate(() => document.querySelector('#mapCandidates').scrollIntoView());
      const shotArg = process.argv.indexOf('--screenshot');
      if (shotArg >= 0 && viewport.width > 600) await page.screenshot({ path: process.argv[shotArg + 1] });
      await page.evaluate(() => window.mapReview.mapSel.reset());
      assert.equal(await items.count(), 0);
      assert.equal(await page.locator('#mapCandidates').isVisible(), false);
      assert.equal(await page.locator('#saveFavBtn').isDisabled(), true);

      await page.locator('[data-gmode="mixed"]').click();
      assert.equal(await page.locator('#mixedPanel').isVisible(), true);
      await page.locator('#mixedGenBtn').click();
      await page.waitForFunction(() => window.mapReview.favCfg?.gen?.mode === 'mixed');
      assert.equal(await page.locator('#mixedSrcGrid > div').count(), 3);
      const sourceRows = await page.locator('#mixedSrcGrid').textContent();
      assert.match(sourceRows, /等高線地形.*條道路/);
      assert.match(sourceRows, /衛星／OSM 道路建物.*條道路/);
      assert.match(sourceRows, /氣候植被文化／地質外觀.*條道路/);
      assert.equal(await page.locator('#mixedSaveFavBtn').isDisabled(), false);
      const sourceFits = await page.evaluate(() => {
        const e = document.querySelector('#mixedSrcGrid');
        return e.scrollWidth <= e.clientWidth;
      });
      assert(sourceFits, 'mixed-source rows fit desktop and mobile panels');
      if (shotArg >= 0 && viewport.width > 600) {
        await page.screenshot({ path: process.argv[shotArg + 1].replace(/\.png$/, '-mixed.png') });
      }
      await page.locator('#mixedClearBtn').click();
      assert.equal(await page.locator('#mixedSaveFavBtn').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.mapReview.favCfg), null);
      assert(!/條道路/.test(await page.locator('#mixedSrcGrid').textContent()));
      await page.evaluate(() => { window.mapReviewHold = true; });
      await page.locator('#mixedGenBtn').click();
      await page.waitForFunction(() => window.mapReviewRelease);
      await page.locator('#mixedClearBtn').click();
      await page.evaluate(async () => { window.mapReviewRelease(); await new Promise(resolve => setTimeout(resolve, 0)); });
      assert.equal(await page.evaluate(() => window.mapReview.favCfg), null, 'late road verification cannot restore a cleared map');
      assert.equal(await page.locator('#mixedSaveFavBtn').isDisabled(), true);
      await page.locator('[data-gmode="random"]').click();
      // CDP insertText can discard replacement text at maxlength; clear before entering the next seed.
      await page.locator('#randomSeedInput').fill('');
      await page.locator('#randomSeedInput').fill('12345');
      assert.equal(await page.locator('#randomSeedInput').inputValue(), '12345');
      await page.locator('#randomGenBtn').click();
      assert.equal(await page.evaluate(() => window.mapReview.favCfg?.gen?.seed), 12345, JSON.stringify(viewport));
      assert.equal(await page.locator('#randomMapPreview canvas').count(), 1);
      assert.equal(await page.locator('#leafletMap').isVisible(), false);
      assert.equal(await page.locator('#randomSaveFavBtn').isDisabled(), false);
      assert.equal(await page.locator('#randomRanges > details').count(), 3);
      assert.match(await page.locator('#mapRules').textContent(), /連通道路網/);
      const seedFits = await page.locator('#randomSeedInput').evaluate(e => {
        const r = e.getBoundingClientRect(); return r.width >= 100 && r.left >= 0 && r.right <= innerWidth;
      });
      assert(seedFits, 'the seed field stays readable beside the reroll button');
      assert.match(await page.locator('#randomHint').textContent(), /種子 12345/);
      assert.deepEqual(await page.evaluate(() => window.mapReview.favCfg.center), { lat: 0, lng: 0, rot: 0 });
      await page.locator('#randomRanges summary').first().click();
      await page.locator('#randomRanges input[data-key="amplitudeM"][data-edge="max"]').fill('8');
      await page.locator('#randomGenBtn').click();
      assert.equal(await page.evaluate(() => window.mapReview.favCfg.gen.layers.elevation.amplitudeM), 8);
      const rangesFit = await page.evaluate(() => [...document.querySelectorAll('#randomRanges input')].every(e => {
        const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
      }));
      assert(rangesFit, 'editable random ranges remain inside desktop and mobile panels');
      if (shotArg >= 0 && viewport.width > 600) await page.screenshot({ path: process.argv[shotArg + 1].replace(/\.png$/, '-random.png') });
      await page.locator('#randomRanges input[data-key="amplitudeM"][data-edge="max"]').fill('7');
      await page.locator('#randomGenBtn').click();
      assert.match(await page.locator('#mapStatus').textContent(), /參數範圍無效/);
      assert.equal(await page.locator('#randomSaveFavBtn').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.mapReview.favCfg), null);
      assert.equal(await page.locator('#randomMapPreview canvas').count(), 0);
      await page.close();
    }
    console.log('PASS browser: production ranking, mixed and random builder callbacks, candidate selection, source rows, stale clear/reset, first-use random without Leaflet, canvas preview, bounded editable ranges, invalid range rejection and desktop/mobile bounds.');
  } finally { await browser.close(); }
}
