// 純規劃：不依賴 Three.js、不消耗場景共享亂數。
import { ARCHITECTURE_STYLES, ARCHITECTURE_PROFILES, ARCHITECTURE_SITE } from './architectureStyles.js';
import { buildContainmentIndex } from './osmAreas.js';

export function architectureHash(value, salt = '') {
  const text = `${value}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return h >>> 0;
}

export function architectureWeights(context = {}) {
  const profile = context.slope >= ARCHITECTURE_SITE.slopeDeg ? 'hillside'
    : context.urban ? 'urban' : context.rural ? 'rural' : 'plain';
  const weights = { ...ARCHITECTURE_PROFILES[profile] };
  if (context.courtyard) weights.courtyard *= 2;
  if (context.elongated) { weights.machiya *= 1.5; weights.industrial *= 1.5; }
  return { profile, weights };
}

export function chooseArchitecture(seed, identity, context = {}) {
  const { profile, weights } = architectureWeights(context);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let pick = architectureHash(identity, seed) / 4294967296 * total;
  let id = Object.keys(weights).at(-1);
  for (const [key, weight] of Object.entries(weights)) {
    pick -= weight;
    if (pick < 0) { id = key; break; }
  }
  return { ...ARCHITECTURE_STYLES[id], id, profile, variant: architectureHash(identity, `${seed}:variant`) % 3 };
}

/** 用地採最小包含面；密度用空間格，坡度量裸地，不讀建物屋頂。 */
export function createArchitecturePlanner({ areas = [], terrain, seed = 0, mix = null } = {}) {
  const land = buildContainmentIndex(areas);
  const cells = new Map();
  const cell = ARCHITECTURE_SITE.densityCellM;
  for (const area of areas) {
    if (!(area.tags?.building || area.tags?.['building:part']) || !area.centroid) continue;
    const key = `${Math.floor(area.centroid.x / cell)},${Math.floor(area.centroid.z / cell)}`;
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  return (building, poly = null, settlement = false) => {
    const center = building.centroid || { x: building.x || 0, z: building.z || 0 };
    const x = center.x, z = center.z;
    const parent = land.parentOf({ centroid: center });
    const use = parent?.tags?.landuse || building.tags?.landuse || '';
    let density = 0;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) density += cells.get(`${cx + i},${cz + j}`) || 0;
    const d = ARCHITECTURE_SITE.probeM;
    const heights = [[x - d, z], [x + d, z], [x, z - d], [x, z + d]]
      .map(([px, pz]) => terrain?.heightAt?.(px, pz));
    const slope = heights.every(Number.isFinite)
      ? Math.atan(Math.hypot(heights[1] - heights[0], heights[3] - heights[2]) / (2 * d)) * 180 / Math.PI : 0;
    const rural = /farmland|farmyard|orchard|vineyard|meadow|allotments/.test(use) || building.tags?.building === 'farm'
      || (use === 'residential' && density < ARCHITECTURE_SITE.urbanNeighbors && !settlement);
    const urban = !rural && (/commercial|retail|industrial/.test(use)
      || settlement || density >= ARCHITECTURE_SITE.urbanNeighbors || (!areas.length && (mix?.urban || 0) > 0.4));
    // 輪廓直接進 seed：同地址的多個 outer 各有變體，輸入順序不改選款。
    const identity = `${building.sourceId || `${x},${z}`}|${JSON.stringify(poly?.outer || [])}`;
    const points = poly?.outer || [];
    const width = points.length ? Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) : building.w;
    const depth = points.length ? Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) : building.d;
    const elongated = Math.max(width, depth) / Math.max(0.001, Math.min(width, depth)) > 2.5;
    return chooseArchitecture(seed, identity, { slope, urban, rural, courtyard: !!poly?.holes?.length, elongated });
  };
}

/** 保留所有通過尺度防線的候選；文化匹配與變形代價共同決定機率。 */
export function pickArchitectureModel(ranked, style, seed) {
  if (!ranked.length) return null;
  const affinity = new RegExp(style.affinity);
  const weighted = ranked.map(row => ({ row, weight: Math.exp(-row.score * 2)
    * (affinity.test(`${row.entry.subpart} ${row.entry.style}`) ? 4 : 1) }));
  let pick = architectureHash(seed, style.id) / 4294967296 * weighted.reduce((sum, row) => sum + row.weight, 0);
  for (const row of weighted) { pick -= row.weight; if (pick < 0) return row.row; }
  return weighted.at(-1).row;
}
