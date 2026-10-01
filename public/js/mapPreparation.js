import { buildTerrain, llToWorld } from './terrain.js';
import { warmOsm } from './biomes.js';
import { battleBBox } from './data.js';
import { projectAreaRecord, catalogAreas, subdivideLargeZones } from './osmAreas.js';
import { prepareMapEvidence } from './mapEvidenceLoader.js';
import { MAP_EVIDENCE_COPY } from './help.js';

// Explicit creation only. Venue browsing must not spend the public Overpass quota.
export async function prepareMapCreation(cfg, onProgress = () => {}) {
  await onProgress(MAP_EVIDENCE_COPY.preparing);
  const [terrain, [features, roads]] = await Promise.all([
    buildTerrain(cfg, (f, label) => onProgress(label), { sourceOnly: true }), warmOsm(battleBBox(cfg)),
  ]);
  await onProgress(MAP_EVIDENCE_COPY.analyzing);
  const projected = features?.areas?.map(a => projectAreaRecord(a, llToWorld, cfg.center)).filter(Boolean) || [];
  const areas = features == null ? null : catalogAreas(subdivideLargeZones(catalogAreas(projected).areas, roads, {
    toWorld: (lat, lon) => llToWorld(lat, lon, cfg.center),
  })).areas;
  const pack = await prepareMapEvidence(cfg, terrain, areas);
  cfg.mapEvidence = { version: pack.version, checksum: pack.checksum, complete: pack.complete,
    priorDigest: pack.priorDigest };
  return pack;
}
