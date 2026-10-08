import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { VENUES, venueConfig, venueAvailability } from '../public/js/venues.js';
import { VENUE_LANES } from '../public/js/venueLanes.js';
import { roadSourceSummary } from '../public/js/roadEvidence.js';
import { validateBattleConfig, RoomHub } from '../server/rooms.js';

const rows = [];
let admitted = 0, rejected = 0;
for (const venue of VENUES) for (const mode of [false, 'SWARM', 'STEEL']) for (const teamSize of [1, 2, 3, 4, 5]) for (const swap of [false, true]) {
  const cfg = venueConfig(venue, teamSize, mode), before = structuredClone(cfg);
  const expected = mode ? !!VENUE_LANES[venue.id]?.m1 : venueAvailability(venue).available;
  const validation = validateBattleConfig(cfg, teamSize);
  assert.equal(validation === null, expected, `${venue.id}/${mode || 'full'}/${teamSize}`);
  const hostMessages = [], guestMessages = [];
  const hub = new RoomHub({ urls: () => [] });
  try {
    const host = hub.attach(m => hostMessages.push(m));
    const savedRandom = Math.random;
    Math.random = () => swap ? .1 : .9;
    try { host.recv({ t: 'createRoom', name: 'Catalogue host', teamSize, battleConfig: cfg }); }
    finally { Math.random = savedRandom; }
    if (!expected) {
      assert.equal(hub.rooms.size, 0, 'unsupported frames cannot create rooms');
      assert(hostMessages.some(m => m.t === 'error'));
      rejected++;
    } else {
      const room = [...hub.rooms.values()][0];
      assert(room, 'admitted frames create a room');
      assert.equal(validateBattleConfig(room.battleConfig, teamSize), null, `${venue.id}/${mode || 'full'}/${teamSize}: settled room`);
      assert.deepEqual(room.battleConfig.roadSources, before.roadSources);
      assert.deepEqual(room.battleConfig.roadTerrain, before.roadTerrain);
      const sameSide = JSON.stringify(room.battleConfig.bases.SWARM) === JSON.stringify(before.bases.SWARM);
      assert.equal(sameSide, !swap, 'both ownership outcomes execute');
      const settledLanes = lanes => lanes?.map(lane => sameSide ? lane : [...lane].reverse());
      assert.deepEqual(room.battleConfig.motherLanes, settledLanes(before.motherLanes));
      assert.deepEqual(room.battleConfig.lanes, settledLanes(before.lanes));
      const guest = hub.attach(m => guestMessages.push(m));
      guest.recv({ t: 'joinRoom', pin: room.pin, name: 'Catalogue guest' });
      const joined = guestMessages.find(m => m.t === 'sync')?.lobby?.battleConfig;
      assert(joined, 'joining clients receive the same settled recipe');
      assert.deepEqual(joined, room.battleConfig);
      assert.deepEqual(cfg, before, 'room admission never mutates the caller recipe');
      cfg.roadSources[0].kind = 'unverified';
      cfg.lanes[0][0][0] += .005;
      assert.equal(validateBattleConfig(room.battleConfig, teamSize), null, 'later caller edits cannot change an admitted room');
      admitted++;
    }
    if (!expected) assert.deepEqual(cfg, before, 'rejection never mutates the caller recipe');
    const source = roadSourceSummary(before);
    rows.push({ id: venue.id, name: venue.name, mode: mode || 'full', teamSize, swap,
      status: expected ? 'admitted' : 'unavailable', roadMode: before.roadMode,
      realMotherLanes: source.real, motherLanes: source.total, validation });
  } finally { hub.shutdown(); }
}
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice('--report='.length);
if (reportPath) writeFileSync(reportPath, JSON.stringify({ version: 1, frames: rows.length, admitted, rejected, rows }, null, 2) + '\n');
console.log(`PASS catalogue rooms: ${rows.length} frames, ${admitted} create/join replays, ${rejected} unavailable-frame rejections, immutable sources and caller isolation.`);
