import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { battleBBox, TEAM } from '../public/js/data.js';
import { captureWorldCover, ROOT, CACHE } from './venue_field.mjs';
import { evidenceChecksum } from '../public/js/mapEvidence.js';

const output = join(ROOT, 'public', 'assets', 'map-evidence');
mkdirSync(output, { recursive: true });
const selected = process.argv.find(a => a.startsWith('--venue='))?.slice(8).split(',');
if (selected?.some(id => !VENUES.some(v => v.id === id))) throw new Error('Unknown venue selection');
const entries = {};
for (const venue of VENUES.filter(v => !selected || selected.includes(v.id))) {
  const boxes = [false, 'SWARM', 'STEEL'].flatMap(mode => [TEAM.MIN, TEAM.MAX].map(n => battleBBox(venueConfig(venue, n, mode))));
  const bbox = {
    minLat: Math.min(...boxes.map(b => b.minLat)) - 0.002,
    maxLat: Math.max(...boxes.map(b => b.maxLat)) + 0.002,
    minLng: Math.min(...boxes.map(b => b.minLng)) - 0.003,
    maxLng: Math.max(...boxes.map(b => b.maxLng)) + 0.003,
  };
  console.log(`Preparing ${venue.id}`);
  const pack = await captureWorldCover(bbox, join(CACHE, 'worldcover'));
  pack.venueId = venue.id;
  pack.checksum = evidenceChecksum(Buffer.from(pack.data, 'base64'));
  writeFileSync(join(output, venue.id + '.json'), JSON.stringify(pack) + '\n');
  entries[venue.id] = { file: venue.id + '.json', digest: pack.digest, checksum: pack.checksum, grid: pack.grid, product: pack.source.product };
  console.log(`${venue.id}: ${pack.grid.cols}×${pack.grid.rows}, ${pack.source.items.length} source tiles`);
}
const manifestPath = join(output, 'manifest.json');
const previous = selected && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).venues : {};
writeFileSync(manifestPath, JSON.stringify({ schema: 1, venues: { ...previous, ...entries } }, null, 2) + '\n');
