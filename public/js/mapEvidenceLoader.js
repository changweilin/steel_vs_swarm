import { geoGet, geoPut, geoKey } from './geocache.js';
import { MAP_EVIDENCE, evidenceChecksum, validateWorldCover, evidenceInputs, buildEvidence, validateEvidence, evidenceAt } from './mapEvidence.js';

const manifestURL = new URL('../assets/map-evidence/manifest.json', import.meta.url);
let manifestPromise = null;
const priorJobs = new Map();
function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > 5400000) throw new Error('Invalid WorldCover encoding');
  const raw = atob(value), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function loadVenueEvidence(cfg) {
  const id = cfg.venue?.id;
  if (!/^[a-z0-9_-]+$/.test(id || '')) return null;
  if (!manifestPromise) manifestPromise = fetch(manifestURL, { signal: AbortSignal.timeout(10000) })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  const manifest = await manifestPromise, entry = manifest?.schema === 1 && manifest.venues?.[id];
  if (!manifest) manifestPromise = null;
  if (!entry || entry.file !== id + '.json') return null;
  const key = id + '|' + entry.digest;
  if (!priorJobs.has(key)) {
    const job = fetch(new URL(entry.file, manifestURL), { signal: AbortSignal.timeout(10000) }).then(async r => {
      if (!r.ok) return null;
      const pack = await r.json();
      if (pack.venueId !== id || pack.digest !== entry.digest) return null;
      pack.pixels = decodeBase64(pack.data);
      if (!validateWorldCover(pack) || evidenceChecksum(pack.pixels) !== entry.checksum) return null;
      delete pack.data;
      return pack;
    }).catch(() => null);
    priorJobs.set(key, job);
    job.then(pack => { if (!pack) priorJobs.delete(key); });
  }
  return priorJobs.get(key);
}

async function compute(input) {
  if (typeof Worker === 'undefined') return buildEvidence(input);
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./mapEvidenceWorker.js', import.meta.url), { type: 'module' });
      const finish = (error, pack) => { clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(pack); };
      const timer = setTimeout(() => finish(new Error('Map evidence worker timed out')), 15000);
      worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : null, event.data.pack);
      worker.onerror = event => finish(new Error(event.message || 'Map evidence worker failed'));
      worker.postMessage(input);
    });
  } catch { return buildEvidence(input); }
}

/** Only own-source complete results persist; room-relayed observations stay in memory. */
export async function prepareMapEvidence(cfg, terrain, areas = []) {
  const prior = await loadVenueEvidence(cfg), input = evidenceInputs(cfg, terrain, areas, prior);
  const key = geoKey('evidence', MAP_EVIDENCE.VERSION, terrain.bbox, input.inputId);
  const cached = await geoGet(key);
  if (validateEvidence(cached) && cached.inputId === input.inputId) return { ...cached, cacheHit: true };
  const pack = await compute(input);
  if (!validateEvidence(pack)) throw new Error('Invalid prepared map evidence');
  if (pack.complete) await geoPut(key, pack);
  return { ...pack, cacheHit: false };
}

export function installMapEvidence(terrain, pack) {
  if (!validateEvidence(pack)) throw new Error('Invalid installed map evidence');
  terrain.evidence = pack;
  terrain.evidenceAt = (x, z) => evidenceAt(pack, x, z);
}
