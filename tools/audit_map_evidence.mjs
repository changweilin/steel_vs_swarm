// Guards: numeric ESA provenance and coverage for every venue/mode/team frame;
// deterministic unknown/partial/conflict handling, OSM holes, raw-height slopes;
// bounded detached host-only room relay, late joins, reconnects, and preparation order.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ROOT, readSrc } from './audit_src.mjs';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { TEAM, xzToLL } from '../public/js/data.js';
import { RoomHub } from '../server/rooms.js';
import { MAP_EVIDENCE, evidenceFrame, evidenceFrameKey, evidenceInputs, buildEvidence,
  evidenceAt, evidenceDryBiome, evidenceLandVariant, evidenceChecksum, validateEvidence,
  validateWorldCover, worldCoverAt } from '../public/js/mapEvidence.js';
import { encodeEvidenceRelay, decodeEvidenceRelay, sanitizeEvidenceRelay } from '../public/js/mapEvidenceRelay.js';

const dir = join(ROOT, 'public/assets/map-evidence');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
assert.deepEqual(Object.keys(manifest.venues).sort(), VENUES.map(v => v.id).sort());
let frames = 0;
for (const venue of VENUES) {
  const entry = manifest.venues[venue.id], pack = JSON.parse(readFileSync(join(dir, entry.file), 'utf8'));
  pack.pixels = Uint8Array.from(Buffer.from(pack.data, 'base64'));
  assert(validateWorldCover(pack));
  assert.equal(pack.digest, createHash('sha256').update(pack.pixels).digest('hex'));
  assert.equal(entry.digest, pack.digest);
  assert.equal(entry.checksum, evidenceChecksum(pack.pixels));
  assert.equal(pack.source.license, 'CC-BY-4.0');
  assert(pack.source.attribution && pack.source.items.every(s => s.url.startsWith('https://esa-worldcover.s3.eu-central-1.amazonaws.com/') && s.blocks.length));
  for (const mode of [false, 'SWARM', 'STEEL']) for (const team of [TEAM.MIN, TEAM.MAX]) {
    const cfg = venueConfig(venue, team, mode), frame = evidenceFrame(cfg), b = frame.bounds;
    assert(frame.cols <= MAP_EVIDENCE.MAX_SIDE && frame.rows <= MAP_EVIDENCE.MAX_SIDE);
    for (const fx of [0.01, 0.5, 0.99]) for (const fz of [0.01, 0.5, 0.99]) {
      const [lat, lng] = xzToLL(b.minX + fx * (b.maxX - b.minX), b.minZ + fz * (b.maxZ - b.minZ), frame.center);
      assert(worldCoverAt(pack, lat, lng) > 0, `${venue.id}/${mode}/${team}: uncovered frame`);
    }
    frames++;
  }
  assert.equal(worldCoverAt(pack, 0, 0), 0);
}

const frame = { center: { lat: 25, lng: 121, rot: 0 }, bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }, cols: 3, rows: 3 };
const input = () => ({ frame: structuredClone(frame), colors: new Uint8Array(36), heights: new Float32Array(9).fill(NaN),
  prior: new Uint8Array(9), osm: new Uint8Array(9), coupled: new Uint8Array(9), inputId: 'fixture', priorDigest: null, complete: false });
const empty = buildEvidence(input());
assert(validateEvidence(empty));
assert.equal(evidenceAt(empty, 0, 0).cover, 'unknown');
assert.equal(evidenceAt(empty, 0, 0).landform, 0);
assert.equal(evidenceAt(empty, 0, 0).geology, 'unknown');
assert.equal(evidenceAt(empty, NaN, 0), null);
assert.equal(evidenceAt(empty, 61, 0), null);
assert(evidenceAt(empty, 60, 60));
const gray = input();
for (let k = 0; k < 9; k++) gray.colors.set([110, 110, 110, 255], k * 4);
assert.equal(evidenceAt(buildEvidence(gray), 0, 0).cover, 'unknown', 'Gray rock/shadow cannot manufacture urban evidence');
const striped = input(); striped.prior.fill(50);
for (let k = 0; k < 9; k++) { const v = 40 + (k % 3) * 80; striped.colors.set([v, v, v, 255], k * 4); }
assert.equal(evidenceAt(buildEvidence(striped), 0, 0).confidence, 2, 'Texture/directional agreement corroborates a built prior');
striped.prior.fill(0);
assert.equal(evidenceAt(buildEvidence(striped), 0, 0).code, 0, 'The same texture cannot manufacture a building class');
const green = input();
for (let k = 0; k < 9; k++) green.colors.set([30, 130, 30, 255], k * 4);
const colored = buildEvidence(green);
assert.equal(evidenceAt(colored, 0, 0).code, 30);
green.prior.fill(10);
assert.equal(evidenceAt(buildEvidence(green), 0, 0).confidence, 2);
green.osm.fill(60); green.coupled.fill(255);
const conflict = evidenceAt(buildEvidence(green), 0, 0);
assert.equal(conflict.cover, 'bare'); assert.equal(conflict.confidence, 3); assert(conflict.sources & 16);
green.coupled.fill(51);
assert.equal(evidenceAt(buildEvidence(green), 0, 0).confidence, 2, 'Partial footprint agreement lowers semantic confidence');
for (let k = 0; k < 9; k++) green.heights[k] = (k % 3) * 5;
assert.equal(evidenceAt(buildEvidence(green), 0, 0).slope, 14, 'Slopes use real metres, before terrain amplification');
assert.deepEqual(buildEvidence(green), buildEvidence(green));
assert.equal(evidenceDryBiome({ code: 80, confidence: 3 }), null);
assert.equal(evidenceDryBiome({ code: 50, confidence: 3 }), 'urban');
assert.equal(evidenceLandVariant({ code: 10, confidence: 1 }, 'green'), 2);
assert.equal(evidenceLandVariant({ code: 10, confidence: 1 }, 'water'), null);
assert.throws(() => buildEvidence({ ...input(), colors: new Uint8Array(1) }));

const cfg = venueConfig(VENUES[0], TEAM.MIN), b = evidenceFrame(cfg).bounds;
const outer = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]];
const hole = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
const area = { sourceId: 'way/1', classification: { surface: 'green', priority: 1 }, worldPolygons: [{ outer, holes: [hole] }] };
const terrain = { bbox: {}, sampleColor: () => null, elevationAt: () => NaN };
const capture = evidenceInputs(cfg, terrain, [area]);
const holes = buildEvidence(capture);
assert.equal(evidenceAt(holes, 0, 0).code, 0);
assert.equal(evidenceAt(holes, (b.minX + b.maxX) / 2, b.minZ + 200).code, 30);
assert(!capture.complete);
assert.notEqual(capture.inputId, evidenceInputs({ ...cfg, center: { ...cfg.center, rot: cfg.center.rot + 0.1 } }, terrain, [area]).inputId);
const bad = structuredClone(colored); bad.data[0] ^= 1;
assert(!validateEvidence(bad));
const envelope = encodeEvidenceRelay(colored), decoded = decodeEvidenceRelay(envelope);
assert.deepEqual(decoded.data, colored.data);
assert.deepEqual(sanitizeEvidenceRelay(envelope), envelope);
assert.notEqual(decoded.frame, colored.frame);
assert.equal(decodeEvidenceRelay({ ...envelope, data: '!invalid!' }), null);
assert.equal(decodeEvidenceRelay({ ...envelope, data: 'A'.repeat(600000) }), null);
assert.equal(decodeEvidenceRelay({ ...envelope, key: 'another-frame' }), null);

const hub = new RoomHub(), hIn = [], host = hub.attach(m => hIn.push(m));
try {
  host.recv({ t: 'createRoom', name: 'Host', teamSize: TEAM.MIN, battleConfig: cfg });
  const room = [...hub.rooms.values()][0]; assert(room);
  const guestIn = [], guest = hub.attach(m => guestIn.push(m));
  guest.recv({ t: 'joinRoom', pin: room.pin, name: 'Guest', mode: 'spectator' });
  const observations = buildEvidence(evidenceInputs(room.battleConfig, terrain, []));
  const message = encodeEvidenceRelay(observations), configBefore = JSON.stringify(room.battleConfig);
  guest.recv(message); assert(!room.mapEvidence, 'Only host may commit');
  host.recv(envelope); assert(!room.mapEvidence, 'Wrong frame must be rejected');
  host.recv(message); assert(room.mapEvidence);
  assert.equal(guestIn.filter(m => m.t === 'mapEvidence').length, 1);
  message.frame.center.lat = 0;
  assert.notEqual(room.mapEvidence.frame.center.lat, 0, 'Solo sessions cannot share mutable input references');
  host.recv(encodeEvidenceRelay(observations));
  assert.equal(guestIn.filter(m => m.t === 'mapEvidence').length, 1, 'A committed room field is immutable');
  const lateIn = [], late = hub.attach(m => lateIn.push(m));
  late.recv({ t: 'joinRoom', pin: room.pin, name: 'Late', mode: 'spectator' });
  assert.deepEqual(lateIn.find(m => m.t === 'mapEvidence'), room.mapEvidence);
  const token = room.clients.get(late.id).token, again = [], reconnect = hub.attach(m => again.push(m));
  reconnect.recv({ t: 'reattach', token });
  assert(again.some(m => m.t === 'mapEvidence'));
  assert.equal(JSON.stringify(room.battleConfig), configBefore);
  assert(!lateIn.filter(m => m.t === 'sync').some(m => JSON.stringify(m).includes('mapEvidence')));
} finally { hub.shutdown(); }

const main = readSrc('public/js/main.js'), biomes = readSrc('public/js/biomes.js');
const saving = main.slice(main.indexOf("$('saveFavBtn')?.addEventListener"), main.indexOf("$('resetSiteBtn')?.addEventListener"));
assert(saving.indexOf('await prepareMapCreation') >= 0 && saving.indexOf('await prepareMapCreation') < saving.indexOf('saveFavorite('));
const creation = main.slice(main.indexOf("$('createRoomBtn')?.addEventListener"), main.indexOf("$('backFromOpenRoomBtn')?.addEventListener"));
assert(creation.indexOf('await prepareMapCreation') >= 0 && creation.indexOf('await prepareMapCreation') < creation.indexOf("t: 'createRoom'"));
assert(biomes.indexOf('await prepareEvidence(') >= 0 && biomes.indexOf('await prepareEvidence(') < biomes.indexOf('let architectureAt = createArchitecturePlanner('));
assert(readSrc('public/js/mapPreparation.js').includes('{ sourceOnly: true }'));
for (const fn of ['startStoryChapter', 'quickRestartGame']) {
  const start = main.indexOf('async function ' + fn), end = main.indexOf('\n}', start), body = main.slice(start, end);
  assert(body.indexOf('await prepareMapCreation') >= 0 && body.indexOf('await prepareMapCreation') < body.indexOf("t: 'createRoom'"));
}
assert(main.includes('prepareEvidence: (cfg, terrain, areas) => mapEvidenceGate'));
console.log(`PASS map evidence: ${VENUES.length} real numeric source packs, ${frames} frames, masks, deterministic features, detached room relay and creation gates`);
