import { buildTerrain, llToWorld } from './terrain.js';
import { warmOsm } from './biomes.js';
import { battleBBox } from './data.js';
import { projectAreaRecord, catalogAreas, subdivideLargeZones } from './osmAreas.js';
import { prepareMapEvidence } from './mapEvidenceLoader.js';
import { MAP_EVIDENCE } from './mapEvidence.js';
import { MAP_EVIDENCE_COPY } from './help.js';

const _prepCache = new Map();
const _inFlight = new Map();

export function mapPrepKey(cfg) {
  if (!cfg?.center) return null;
  const c = cfg.center;
  const lat = Math.round((c.lat || 0) * 1e5) / 1e5;
  const lng = Math.round((c.lng || 0) * 1e5) / 1e5;
  const rot = Math.round((c.rot || 0) * 1e4) / 1e4;
  const size = Math.round(cfg.sizeM || 0);
  const lanes = cfg.lanes?.length || 0;
  return `${lat},${lng},${rot},${size},${lanes}`;
}

export function isMapPrepared(cfg) {
  if (!cfg) return false;
  if (cfg.mapEvidence?.complete) return true;
  const k = mapPrepKey(cfg);
  return k ? _prepCache.has(k) : false;
}

// Explicit creation only. Venue browsing must not spend the public Overpass quota.
export async function prepareMapCreation(cfg, onProgress = () => {}) {
  const key = mapPrepKey(cfg);
  if (key && _prepCache.has(key)) {
    const pack = _prepCache.get(key);
    cfg.mapEvidence = { version: pack.version, checksum: pack.checksum, complete: pack.complete,
      priorDigest: pack.priorDigest };
    await onProgress(MAP_EVIDENCE_COPY.analyzing);
    return pack;
  }
  if (key && _inFlight.has(key)) {
    const task = _inFlight.get(key);
    task.listeners.add(onProgress);
    try {
      const pack = await task.promise;
      cfg.mapEvidence = { version: pack.version, checksum: pack.checksum, complete: pack.complete,
        priorDigest: pack.priorDigest };
      return pack;
    } finally {
      task.listeners.delete(onProgress);
    }
  }

  const listeners = new Set([onProgress]);
  const notify = async (label) => {
    for (const cb of [...listeners]) {
      try { await cb(label); } catch {}
    }
  };

  const promise = (async () => {
    try {
      await notify(MAP_EVIDENCE_COPY.preparing);
      const [terrain, [features, roads]] = await Promise.all([
        buildTerrain(cfg, (f, label) => notify(label), { sourceOnly: true }), warmOsm(battleBBox(cfg)),
      ]);
      await notify(MAP_EVIDENCE_COPY.analyzing);
      const projected = features?.areas?.map(a => projectAreaRecord(a, llToWorld, cfg.center)).filter(Boolean) || [];
      const areas = features == null ? null : catalogAreas(subdivideLargeZones(catalogAreas(projected).areas, roads, {
        toWorld: (lat, lon) => llToWorld(lat, lon, cfg.center),
      })).areas;
      const pack = await prepareMapEvidence(cfg, terrain, areas);
      cfg.mapEvidence = { version: pack.version, checksum: pack.checksum, complete: pack.complete,
        priorDigest: pack.priorDigest };
      if (key && pack.complete) _prepCache.set(key, pack);
      return pack;
    } catch (err) {
      console.warn('Map evidence preparation degraded:', err);
      cfg.mapEvidence = null;
      return { version: MAP_EVIDENCE.VERSION, checksum: 0, complete: false, priorDigest: null };
    } finally {
      if (key) _inFlight.delete(key);
    }
  })();

  if (key) _inFlight.set(key, { promise, listeners });
  return promise;
}
