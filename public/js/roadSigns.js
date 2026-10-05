import { pickName, pickRef, classifyOsm } from './vernacular.js';

const SIGN_BUDGET = Object.freeze({ traffic: 24, street: 12, destination: 4, tourist: 3, civic: 3, place: 2 });
export const ROAD_SIGN_LIMIT = Object.values(SIGN_BUDGET).reduce((total, count) => total + count, 0);
const ROAD_TRAFFIC = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service)(?:_link)?$/;
const SYMBOLS = new Set(['stop', 'yield', 'no_entry', 'no_parking', 'no_overtaking', 'roundabout',
  'keep_right', 'keep_left', 'oneway', 'crossing', 'rail_crossing', 'narrowing', 'curve', 'bump', 'signals']);
// Only documented, unambiguous codes are recognized; unknown national codes are omitted.
const CODES = { 'DE:206': 'stop', 'DE:205': 'yield', 'DE:267': 'no_entry', 'DE:222-20': 'keep_right',
  'DE:222-10': 'keep_left', 'DE:215': 'roundabout', 'DE:274': 'speed', 'DE:286': 'no_parking',
  'DE:276': 'no_overtaking' };

export function speedSign(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?\s*$/i.exec(value);
  if (!match || +match[1] <= 0 || +match[1] > 300) return null;
  return { t: String(+match[1]), s: match[2]?.toLowerCase() === 'mph' ? 'mph' : null, symbol: 'speed' };
}

export function trafficSignCopies(tags = {}) {
  const copies = [], seen = new Set();
  const add = symbol => {
    if (!SYMBOLS.has(symbol) || seen.has(symbol)) return;
    seen.add(symbol); copies.push({ t: symbol === 'stop' ? (tags.inscription || 'STOP') : symbol, symbol });
  };
  if (tags.highway === 'stop') add('stop');
  if (tags.highway === 'give_way') add('yield');
  if (tags.highway === 'crossing') add('crossing');
  if (tags.highway === 'traffic_signals') add('signals');
  if (['bump', 'hump', 'table'].includes(tags.traffic_calming)) add('bump');
  if (tags.highway === 'mini_roundabout') add('roundabout');
  if (tags.railway === 'level_crossing') add('rail_crossing');
  for (const token of String(tags.traffic_sign || '').split(/[;,]/)) {
    const text = token.trim(), code = /^([A-Z]{2}:\d+(?:-\d+)?)(?:\[(\d+)\])?$/.exec(text);
    const symbol = CODES[code?.[1]] || (text === 'give_way' ? 'yield' : text);
    if (symbol === 'speed' || text === 'maxspeed') {
      const speed = speedSign(code?.[2] || tags.maxspeed);
      if (speed && !seen.has('speed')) { copies.push(speed); seen.add('speed'); }
    } else add(symbol);
  }
  return copies;
}

export function trafficSignStyle(copy) {
  if (copy.symbol === 'speed') return 'speed';
  if (copy.symbol === 'stop') return 'stop';
  if (copy.symbol === 'yield') return 'yield';
  if (copy.symbol === 'oneway') return 'oneway';
  if (['crossing', 'rail_crossing', 'narrowing', 'curve', 'bump', 'signals'].includes(copy.symbol)) return 'warning';
  if (['keep_left', 'keep_right', 'roundabout', 'oneway'].includes(copy.symbol)) return 'mandatory';
  return 'prohibition';
}

export function roadDestination(tags, direction) {
  const suffix = direction < 0 ? ':backward' : ':forward';
  const raw = tags['destination' + suffix] || (direction > 0 ? tags.destination : null);
  if (typeof raw !== 'string') return null;
  const names = raw.split(';').map(name => pickName({ name }, 'local', 64)).filter(Boolean).slice(0, 3);
  if (!names.length) return null;
  return { t: names[0], s: names.slice(1).join(' · ') || null,
    ref: pickRef({ ref: tags['destination:ref' + suffix] || tags['destination:ref'] }), arrow: 'straight' };
}

export function guideSignKind(tags = {}) {
  if (tags.tourism === 'information' && tags.information === 'guidepost') return 'destination';
  if (['attraction', 'viewpoint', 'museum', 'gallery', 'zoo', 'theme_park'].includes(tags.tourism)
    || ['park', 'garden', 'nature_reserve'].includes(tags.leisure) || tags.historic || tags.natural === 'peak') return 'tourist';
  if (classifyOsm(tags) === 'gov') return 'civic';
  if (tags.place) return 'place';
  return null;
}

/** Uses the road builder's settled dry runs, widths and terrain probes; never consumes layout RNG. */
export function roadSignSegments(runs, includeStructures = false) {
  const segments = [];
  for (const run of runs) {
    if ((!includeStructures && run.kind !== 'road') || !ROAD_TRAFFIC.test(run.tags?.highway || '')) continue;
    let distance = 0;
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1], b = run.points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!Number.isFinite(len) || len < .01) continue;
      const segment = { run, a, b, len, distance, hwA: run.widths?.[i - 1] ?? run.hw, hwB: run.widths?.[i] ?? run.hw,
        yA: run.floors?.[i - 1], yB: run.floors?.[i] };
      segments.push(segment);
      distance += len;
    }
  }
  return segments;
}

export function nearestSignRoad(segments, x, z, heading = null, y = null) {
  let hit = null;
  for (const seg of segments) {
    const dx = (seg.b[0] - seg.a[0]) / seg.len, dz = (seg.b[1] - seg.a[1]) / seg.len;
    if (heading && Math.abs(dx * heading[0] + dz * heading[1]) < .8) continue;
    const t = Math.max(0, Math.min(seg.len, (x - seg.a[0]) * dx + (z - seg.a[1]) * dz));
    const floor = seg.yA != null && seg.yB != null ? seg.yA + (seg.yB - seg.yA) * t / seg.len : null;
    if (y != null && floor != null && Math.abs(y - floor) > 1.2) continue;
    const px = seg.a[0] + dx * t, pz = seg.a[1] + dz * t, d = Math.hypot(x - px, z - pz);
    if (d > 150 || (hit && d >= hit.d)) continue;
    hit = { seg, x: px, z: pz, dx, dz, d, hw: seg.hwA + (seg.hwB - seg.hwA) * t / seg.len };
  }
  return hit;
}

export function planRoadSigns({ runs = [], points = [], targets = [], heightAt, free = () => true }) {
  if (typeof heightAt !== 'function') return [];
  const segments = roadSignSegments(runs), runSegments = new Map();
  for (const segment of segments) {
    const row = runSegments.get(segment.run) || { segments: [], length: 0 };
    row.segments.push(segment); row.length += segment.len; runSegments.set(segment.run, row);
  }
  const signs = [], used = new Set();
  const counts = Object.fromEntries(Object.keys(SIGN_BUDGET).map(key => [key, 0]));
  const nearest = (x, z) => nearestSignRoad(segments, x, z);
  const atDistance = (run, s) => {
    const seg = runSegments.get(run)?.segments.find(seg => seg.distance + seg.len >= s);
    if (!seg) return null;
    const t = Math.max(0, Math.min(seg.len, s - seg.distance));
    return { seg, x: seg.a[0] + (seg.b[0] - seg.a[0]) * t / seg.len,
      z: seg.a[1] + (seg.b[1] - seg.a[1]) * t / seg.len,
      dx: (seg.b[0] - seg.a[0]) / seg.len, dz: (seg.b[1] - seg.a[1]) / seg.len,
      hw: seg.hwA + (seg.hwB - seg.hwA) * t / seg.len };
  };
  const place = (hit, copy, style, key, direction = 1, h = 1.25, both = false,
    category = copy.symbol ? 'traffic' : style) => {
    if (!hit || used.has(key) || signs.length >= ROAD_SIGN_LIMIT || counts[category] >= SIGN_BUDGET[category]) return;
    let site = null;
    for (const shift of [0, -8, -16]) {
      const along = hit.seg.distance + Math.hypot(hit.x - hit.seg.a[0], hit.z - hit.seg.a[1]) + shift * direction;
      if (along < 0) continue;
      const candidate = atDistance(hit.seg.run, along);
      if (!candidate) continue;
      const x = candidate.x + candidate.dz * (candidate.hw + 2.8) * direction;
      const z = candidate.z - candidate.dx * (candidate.hw + 2.8) * direction;
      const occupied = segments.some(seg => {
        const dx = seg.b[0] - seg.a[0], dz = seg.b[1] - seg.a[1];
        const t = Math.max(0, Math.min(1, ((x - seg.a[0]) * dx + (z - seg.a[1]) * dz) / (seg.len * seg.len)));
        return Math.hypot(x - seg.a[0] - dx * t, z - seg.a[1] - dz * t) < Math.max(seg.hwA, seg.hwB) + .3;
      });
      if (!occupied && free(x, z, h, style)) { site = { ...candidate, x, z }; break; }
    }
    if (!site) return;
    const { x, z } = site;
    const y = heightAt(x, z);
    if (!Number.isFinite(y) || y < .4) return;
    // A traffic sign faces the approaching direction, while a street plate faces the carriageway.
    const ry = both ? Math.atan2(-site.dz * direction, site.dx * direction)
      : Math.atan2(-site.dx * direction, -site.dz * direction);
    const stack = signs.filter(s => Math.hypot(s.x - x, s.z - z) < 1.2);
    if (stack.length >= 3) return;
    const postHeight = stack.length ? Math.max(...stack.map(s => s.postHeight + s.h / 2)) + h / 2 + .15 : 2.8;
    signs.push({ x, y, z, ry, h, style, copy, both, postHeight, road: hit.seg.run.tags });
    counts[category]++;
    used.add(key);
  };
  // Explicit mapped regulations outrank inferred road labels in the bounded atlas budget.
  for (const point of points) {
    if (![point.x, point.z].every(Number.isFinite)) continue;
    const hit = nearest(point.x, point.z);
    if (!hit || hit.d > hit.hw + 20) continue;
    const direction = point.tags?.direction === 'backward' || point.tags?.['traffic_sign:direction'] === 'backward' ? -1 : 1;
    const copies = trafficSignCopies(point.tags);
    for (const copy of copies) place(hit, copy, trafficSignStyle(copy),
      `node:${point.x}:${point.z}:${copy.symbol}`, direction);
    const speed = speedSign(point.tags?.maxspeed);
    if (speed && !copies.some(c => c.symbol === 'speed')) place(hit, speed, 'speed', `speed:${point.x}:${point.z}`, direction);
  }
  for (const [run, { length }] of runSegments) {
    if (length < 16) continue;
    const tags = run.tags, one = /^(yes|1|true|-1)$/.test(tags.oneway || ''), reverse = tags.oneway === '-1';
    for (const direction of reverse ? [-1] : one ? [1] : [1, -1]) {
      const hit = atDistance(run, direction > 0 ? Math.min(12, length / 3) : length - Math.min(12, length / 3));
      const speed = speedSign(tags[direction > 0 ? 'maxspeed:forward' : 'maxspeed:backward'] || tags.maxspeed);
      if (speed) place(hit, speed, 'speed', `way:${tags.name}:${run.points[0]}:${direction}:speed`, direction);
      const destination = roadDestination(tags, direction);
      if (destination) place(atDistance(run, direction > 0 ? length * .35 : length * .65), destination,
        'destination', `dest:${destination.t}:${direction}`, direction, 1.6);
    }
    const name = pickName(tags, 'local', 64);
    if (name) place(atDistance(run, length / 2), { t: name, ref: pickRef(tags) }, 'street', `street:${name}`, 1, .85, true);
    for (const copy of trafficSignCopies(tags)) place(atDistance(run, length * .2), copy,
      trafficSignStyle(copy), `way:${run.points[0]}:${copy.symbol}`, reverse ? -1 : 1);
    if (one) place(atDistance(run, length * .8), { t: 'oneway', symbol: 'oneway' }, 'oneway',
      `oneway:${run.points[0]}`, reverse ? -1 : 1);
    if (run.widths?.some(w => w > run.hw + .6)) place(atDistance(run, length * .25),
      { t: 'narrowing', symbol: 'narrowing' }, 'warning', `narrowing:${run.points[0]}`, reverse ? -1 : 1);
  }
  for (const target of targets) {
    const kind = guideSignKind(target.tags), name = pickName(target.tags, 'local', 64);
    if (!kind || !name || ![target.x, target.z].every(Number.isFinite)) continue;
    const hit = nearest(target.x, target.z);
    if (!hit) continue;
    const lateral = (target.x - hit.x) * hit.dz - (target.z - hit.z) * hit.dx;
    const copy = { t: name, arrow: Math.abs(lateral) < 4 ? 'straight' : lateral > 0 ? 'right' : 'left' };
    place(hit, copy, kind === 'tourist' ? 'tourist' : kind === 'civic' ? 'civic' : 'destination',
      `target:${kind}:${name}`, 1, 1.3, false, kind);
  }
  return signs;
}
