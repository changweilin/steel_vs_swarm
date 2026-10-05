import { VENUE_LANES } from './venueLanes.js';
import { VENUE_ROAD_EVIDENCE } from './venueRoadEvidence.js';
import { validRoadEvidence, laneFingerprint, validTerrainAssessment } from './roadEvidence.js';
import { validRandomMap } from './randomMapRules.js';
import { MAP_RULE_VERSION } from './mapRules.js';

/** Checks source replay consistency; service receipts and checksums are not authenticity signatures. */
export function validMapSources(cfg) {
  try {
    if (cfg?.mapRuleVersion !== MAP_RULE_VERSION) return false;
    const lanes = cfg.motherLanes || cfg.lanes, sources = cfg.roadSources;
    if (!Array.isArray(sources) || sources.length !== lanes.length) return false;
    if (cfg.gen?.mode === 'random') return cfg.roadMode === 'procedural' && validRandomMap(cfg)
      && sources.every((p, i) => p.kind === 'synthetic' && validRoadEvidence(p, lanes[i]));
    if (cfg.roadMode === 'story-baked' && ['SWARM', 'STEEL'].includes(cfg.defSide)) {
      const raw = VENUE_LANES[cfg.venue?.id]?.m1?.lanes;
      return raw?.length === 1 && lanes.length === 1 && laneFingerprint(raw[0]) === laneFingerprint(lanes[0]);
    }
    if (cfg.roadMode !== 'real' || cfg.synthetic !== false) return false;
    if (!validTerrainAssessment(cfg)) return false;
    const id = cfg.gen?.mode === 'mixed' ? cfg.gen.layers?.surface?.id : cfg.venue?.id;
    const bundled = VENUE_ROAD_EVIDENCE[id]?.[3] || VENUE_LANES[id]?.[3]?.roadSources || [];
    return sources.every((proof, i) => {
      if (!validRoadEvidence(proof, lanes[i]) || proof.kind === 'synthetic') return false;
      if (proof.kind === 'osm-baked') return bundled.some(expected => JSON.stringify(expected) === JSON.stringify(proof));
      return proof.kind === 'osrm' && proof.source.routing?.provider === 'https://router.project-osrm.org'
        && proof.source.routing.version === 'v1/driving' && Array.isArray(proof.source.routing.nodes)
        && proof.source.routing.nodes.length >= 2 && proof.source.routing.nodes.length <= 12000
        && proof.source.routing.nodes.every(n => Number.isSafeInteger(n) && n > 0);
    });
  } catch { return false; }
}
