// OSM owns walkway geometry and explicit tags; coordinate streams choose plausible appearance only.
import { isPedestrianWay, isUndergroundPedestrian } from './pedestrian.js';
import { WALKWAY_SURFACES, WALKWAY_SURFACE_ALIASES, WALKWAY_PALETTES, WALKWAY_DETAIL } from './walkwayCatalog.js';

export const isWalkway = tags => isPedestrianWay(tags) || tags?.highway === 'track';

/** pre: tags belong to the forward OSM way. post: -1 is left and +1 right in the south-positive XZ projection. */
export function walkwaySides(tags = {}, habitat) {
  if (isWalkway(tags) || /^(motorway|trunk)(_link)?$/.test(tags.highway || '')
    || tags.bridge && tags.bridge !== 'no' || tags.tunnel && tags.tunnel !== 'no'
    || tags.indoor && tags.indoor !== 'no' || tags.foot === 'no' || tags.access === 'no') return [];
  const sides = [];
  for (const [side, name] of [[-1, 'left'], [1, 'right']]) {
    const value = tags['sidewalk:' + name] ?? tags['sidewalk:both'] ?? tags.sidewalk;
    if (['no', 'none', 'separate', 'lane'].includes(value)) continue;
    if (value === 'left' || value === 'right') { if (value === name) sides.push(side); continue; }
    if (value === 'both' || value === 'yes') { sides.push(side); continue; }
    if (value != null) continue;
    if (habitat?.key === 'built' && habitat.observed) sides.push(side);
  }
  return sides;
}

/** pre: widths are real metres; realScale is real metres per world metre. Invalid explicit widths omit the side. */
export function walkwayWidth(tags = {}, side, fallback, realScale) {
  const name = side === -1 ? 'left' : 'right';
  const value = tags[`sidewalk:${name}:width`] ?? tags['sidewalk:both:width'] ?? tags['sidewalk:width'];
  if (value == null) return fallback;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:\s*m)?$/.test(value.trim()) || !(realScale > 0)) return null;
  const width = parseFloat(value) / realScale;
  return width >= WALKWAY_DETAIL.MIN_WIDTH_M && width <= WALKWAY_DETAIL.MAX_WIDTH_M ? width : null;
}

/** post: source distinguishes mapped surface tags from inferred game appearance. No RGB material identification. */
export function walkwaySurface(tags = {}, habitat, seed = 0, side = null, theme = null) {
  const name = side === -1 ? 'left' : 'right';
  const raw = side == null ? tags.surface : tags[`sidewalk:${name}:surface`]
    ?? tags['sidewalk:both:surface'] ?? tags['sidewalk:surface'];
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase(), key = WALKWAY_SURFACE_ALIASES[value] || value;
    if (value === 'paved' || value === 'unpaved') {
      const palette = value === 'paved' ? WALKWAY_PALETTES.sidewalk : WALKWAY_PALETTES.natural;
      return { key: palette[(seed >>> 0) % palette.length], source: 'osm-surface-class' };
    }
    if (Object.hasOwn(WALKWAY_SURFACES, key)) return { key, source: 'osm-surface' };
  }
  if (side == null && (tags.man_made === 'boardwalk' || tags.bridge === 'boardwalk')) return { key: 'wood', source: 'osm-boardwalk' };
  const palette = side != null ? WALKWAY_PALETTES.sidewalk : tags.highway === 'steps' ? ['concrete']
    : tags.highway === 'cycleway' || theme === 'cycleway' || tags.footway === 'crossing' ? ['asphalt']
      : WALKWAY_PALETTES[theme] || (habitat?.key === 'built' ? WALKWAY_PALETTES.built
        : habitat?.key === 'sand' ? WALKWAY_PALETTES.coast
          : ['meadow', 'pasture', 'orchard'].includes(habitat?.key) ? WALKWAY_PALETTES.park : WALKWAY_PALETTES.natural);
  return { key: palette[(seed >>> 0) % palette.length], source: 'inferred-appearance' };
}

/** post: dry ground corridors only; bridges, underground entries and stair authority remain with their existing owners. */
export function groundWalkway(tags = {}) {
  return isWalkway(tags) && !isUndergroundPedestrian(tags) && (!tags.bridge || tags.bridge === 'no')
    && tags.highway !== 'steps' && tags.foot !== 'no' && tags.access !== 'no';
}

export function mappedWalkwayFurniture(tags = {}) {
  return ({ bench: 'bench', waste_basket: 'wastebasket', bicycle_parking: 'bicycle_rack',
    drinking_water: 'drinking_fountain', shelter: 'shelter' })[tags.amenity]
    || (tags.leisure === 'picnic_table' ? 'picnic_table' : null)
    || (tags.tourism === 'information' ? tags.information === 'guidepost' ? 'trail_marker' : 'information_board' : null)
    || (tags.barrier === 'bollard' ? 'bollard' : null);
}
