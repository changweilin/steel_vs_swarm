import { TREE_SPECIES, treeDistribution } from './forest.js';
import { mulberry32 } from './rng.js';

export function forestCatalog(filters = {}) {
  return Object.keys(TREE_SPECIES).filter(type => {
    const spec = TREE_SPECIES[type];
    return (!filters.region || filters.region === 'all' || spec.regions.includes(filters.region))
      && (!filters.climate || filters.climate === 'all' || spec.climates.includes(filters.climate))
      && (!filters.form || filters.form === 'all' || spec.form === filters.form);
  });
}

// Renormalize after filtering; an empty habitat must never produce an unrelated tree.
export function sampleForestCatalog(filters, seed, latitude, altitude, environment) {
  const allowed = new Set(forestCatalog(filters));
  const rows = treeDistribution(latitude, altitude, .5, environment).filter(row => allowed.has(row.type));
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (!(total > 0)) return null;
  let roll = mulberry32(seed >>> 0)() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) return row.type;
  }
  return rows[rows.length - 1].type;
}
