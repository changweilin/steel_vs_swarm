import { FUNCTIONAL_VARIANTS, FUNCTIONAL_FAMILIES, FUNCTIONAL_PALETTES, FUNCTIONAL_MATERIALS, FUNCTIONAL_FACADES } from './functionalArchitectureCatalog.js';

const normalized = value => String(value || '').trim().toLowerCase();
const own = (table, key) => Object.hasOwn(table, key) ? table[key] : null;

// Unknown climate/geology stay unknown. Geographic style is a visual prior, never a religion inference.
export function functionalArchitecture(functionInfo, context = {}, seed = 0) {
  if (!functionInfo?.locked) return null;
  const family = own(FUNCTIONAL_FAMILIES, functionInfo.type) || functionInfo.type;
  const variants = own(FUNCTIONAL_VARIANTS, family);
  if (!variants) return null;
  const tags = context.building?.tags || {};
  const denomination = normalized(tags.denomination);
  const source = normalized(tags['plant:source'] || tags['generator:source']);
  const architecture = normalized(tags['building:architecture'] || tags.architecture);
  const climate = normalized(tags.climate || context.climate || context.location?.venue?.climate);
  const yearMatch = /^(?:c\.?\s*)?(\d{4})(?:$|[-;/])/.exec(normalized(tags.start_date || tags['building:start_date']));
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const era = year === null ? null : year < 1945 ? 'historic' : 'modern';
  let candidates = variants.filter(row => (!row.denominations || row.denominations.includes(denomination))
    && (!row.sources || row.sources.includes(source)));
  const sourced = candidates.filter(row => row.sources?.includes(source));
  const denominated = candidates.filter(row => row.denominations?.includes(denomination));
  if (sourced.length) candidates = sourced;
  if (denominated.length) candidates = denominated;
  const explicit = candidates.filter(row => row.id === architecture || row.aliases?.includes(architecture));
  if (explicit.length) candidates = explicit;
  else if (era && candidates.some(row => row.era === era)) candidates = candidates.filter(row => row.era === era);
  if (!explicit.length) {
    const adapted = candidates.filter(row => row.climates?.includes(climate));
    if (adapted.length) candidates = adapted;
    else candidates = candidates.filter(row => !row.climates);
  }
  const regional = candidates.filter(row => row.regions?.includes(context.region));
  if (regional.length) candidates = regional;
  else {
    const generic = candidates.filter(row => !row.regions);
    if (generic.length) candidates = generic;
  }
  const selected = candidates[(seed >>> 0) % candidates.length];
  if (!selected) return null;
  const [wall, roof, trim] = FUNCTIONAL_PALETTES[selected.palette];
  const material = normalized(tags['building:material']);
  const geology = normalized(context.geology || context.location?.venue?.geology);
  const masonry = ['stone', 'sandstone', 'earth'].includes(selected.palette);
  const localStone = masonry ? own(FUNCTIONAL_MATERIALS, geology) : null;
  const warm = ['tropical', 'arid', 'hot', 'mediterranean'].includes(climate);
  const cold = ['cold', 'polar', 'alpine', 'continental'].includes(climate);
  const roofForm = cold && ['flat', 'shed'].includes(selected.roofForm)
    && !['energy', 'substation', 'water'].includes(family) ? 'gable' : selected.roofForm;
  const facade = FUNCTIONAL_FACADES[selected.motif];
  return {
    wall: own(FUNCTIONAL_MATERIALS, material) ?? localStone ?? wall, roof, trim,
    roofForm, era: era || selected.era || 'modern',
    ...(facade ? { facade: facade.facade, glass: facade.glass, functionalWindows: facade } : {}),
    ...(warm ? { detail: 'brise_soleil' } : {}),
    functionalDesign: {
      id: selected.id, family, motif: selected.motif, region: context.region || null,
      denomination: denomination || null, year, climate: climate || null,
      material: material || (localStone ? geology : null), shade: warm, snowRoof: cold,
    },
  };
}
