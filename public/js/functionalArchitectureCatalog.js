// 用途語彙與變體資料；不改寫圖資用途、建築外環或權威碰撞。
export const FUNCTIONAL_VARIANTS = Object.freeze({
  temple: [
    { id: 'east_asian_hall', regions: ['east_asia', 'korea'], era: 'historic', roofForm: 'xieshan', motif: 'temple', palette: 'lacquer' },
    { id: 'japanese_hall', regions: ['japan'], era: 'historic', roofForm: 'yingshan', motif: 'temple', palette: 'timber' },
    { id: 'theravada_hall', regions: ['southeast_asia', 'south_asia'], era: 'historic', roofForm: 'tiered', motif: 'temple', palette: 'gold' },
    { id: 'modern_dharma_hall', era: 'modern', roofForm: 'xieshan', motif: 'temple', palette: 'pale' },
  ],
  mosque: [
    { id: 'domed_mosque', era: 'historic', roofForm: 'dome', motif: 'mosque', palette: 'pale' },
    { id: 'maghreb_mosque', regions: ['maghreb', 'sahel'], era: 'historic', roofForm: 'flat', motif: 'square_minaret', palette: 'earth' },
    { id: 'persian_mosque', regions: ['iran', 'middle_east'], era: 'historic', roofForm: 'dome', motif: 'mosque', palette: 'turquoise' },
    { id: 'modern_mosque', era: 'modern', roofForm: 'dome', motif: 'mosque', palette: 'concrete' },
  ],
  church: [
    { id: 'gothic_church', aliases: ['gothic', 'neo-gothic'], era: 'historic', roofForm: 'steep_gable', motif: 'church', palette: 'stone' },
    { id: 'orthodox_church', denominations: ['orthodox', 'eastern_orthodox', 'russian_orthodox', 'greek_orthodox'], era: 'historic', roofForm: 'dome', motif: 'orthodox', palette: 'gold' },
    { id: 'modern_church', era: 'modern', roofForm: 'gable', motif: 'church', palette: 'pale' },
  ],
  shrine: [{ id: 'shinto_hall', roofForm: 'yingshan', motif: 'shrine', palette: 'lacquer', era: 'historic' }],
  mandir: [{ id: 'shikhara_temple', roofForm: 'spire', motif: 'mandir', palette: 'sandstone', era: 'historic' }],
  synagogue: [{ id: 'synagogue_hall', roofForm: 'vault', motif: 'synagogue', palette: 'stone', era: 'historic' }],
  gurdwara: [{ id: 'gurdwara_hall', roofForm: 'dome', motif: 'gurdwara', palette: 'pale', era: 'historic' }],
  stupa: [{ id: 'stupa_shrine', roofForm: 'dome', motif: 'stupa', palette: 'gold', era: 'historic' }],
  pagoda: [{ id: 'tiered_pagoda', roofForm: 'tiered', motif: 'pagoda', palette: 'lacquer', era: 'historic' }],
  education: [
    { id: 'brick_campus', era: 'historic', roofForm: 'gable', motif: 'school', palette: 'brick' },
    { id: 'courtyard_school', regions: ['east_asia', 'japan', 'korea', 'southeast_asia'], era: 'modern', roofForm: 'flat', motif: 'school', palette: 'pale' },
    { id: 'modern_campus', era: 'modern', roofForm: 'flat', motif: 'school', palette: 'concrete' },
    { id: 'nordic_school', regions: ['nordic'], roofForm: 'gable', motif: 'school', palette: 'timber' },
    { id: 'tropical_school', climates: ['tropical'], roofForm: 'flat', motif: 'school', palette: 'clinical' },
  ],
  station: [
    { id: 'railway_hall', era: 'historic', roofForm: 'vault', motif: 'station', palette: 'brick' },
    { id: 'modern_interchange', era: 'modern', roofForm: 'flat', motif: 'station', palette: 'metal' },
    { id: 'east_asian_station', regions: ['east_asia', 'japan', 'korea'], era: 'historic', roofForm: 'xieshan', motif: 'station', palette: 'timber' },
  ],
  medical: [
    { id: 'pavilion_hospital', era: 'historic', roofForm: 'gable', motif: 'hospital', palette: 'brick' },
    { id: 'clinical_hospital', era: 'modern', roofForm: 'flat', motif: 'hospital', palette: 'clinical' },
    { id: 'tropical_hospital', climates: ['tropical', 'hot'], era: 'modern', roofForm: 'flat', motif: 'hospital', palette: 'pale' },
  ],
  civic: [
    { id: 'neoclassical_civic', aliases: ['neoclassical', 'classical'], era: 'historic', roofForm: 'gable', motif: 'civic', palette: 'stone' },
    { id: 'modern_civic', era: 'modern', roofForm: 'flat', motif: 'civic', palette: 'concrete' },
    { id: 'east_asian_civic', regions: ['east_asia', 'japan', 'korea'], era: 'historic', roofForm: 'xieshan', motif: 'civic', palette: 'lacquer' },
    { id: 'arid_civic', climates: ['arid'], roofForm: 'flat', motif: 'civic', palette: 'sandstone' },
  ],
  library: [
    { id: 'classical_library', era: 'historic', roofForm: 'vault', motif: 'library', palette: 'stone' },
    { id: 'glass_library', era: 'modern', roofForm: 'flat', motif: 'library', palette: 'timber' },
    { id: 'east_asian_library', regions: ['east_asia', 'japan', 'korea'], era: 'historic', roofForm: 'yingshan', motif: 'library', palette: 'lacquer' },
  ],
  museum: [
    { id: 'classical_museum', era: 'historic', roofForm: 'gable', motif: 'museum', palette: 'stone' },
    { id: 'sculptural_museum', era: 'modern', roofForm: 'stepped', motif: 'museum', palette: 'concrete' },
    { id: 'regional_museum', regions: ['middle_east', 'iran', 'maghreb'], era: 'historic', roofForm: 'dome', motif: 'museum', palette: 'sandstone' },
  ],
  factory: [
    { id: 'brick_mill', era: 'historic', roofForm: 'sawtooth', motif: 'factory', palette: 'brick' },
    { id: 'metal_factory', era: 'modern', roofForm: 'sawtooth', motif: 'factory', palette: 'metal' },
    { id: 'warm_climate_factory', climates: ['arid', 'tropical', 'hot'], era: 'modern', roofForm: 'sawtooth', motif: 'factory', palette: 'pale' },
  ],
  warehouse: [
    { id: 'brick_depot', era: 'historic', roofForm: 'gable', motif: 'warehouse', palette: 'brick' },
    { id: 'logistics_shed', era: 'modern', roofForm: 'shed', motif: 'warehouse', palette: 'metal' },
    { id: 'arid_storehouse', climates: ['arid'], roofForm: 'flat', motif: 'warehouse', palette: 'earth' },
  ],
  energy: [
    { id: 'utility_hall', roofForm: 'flat', motif: 'energy', palette: 'metal' },
    { id: 'thermal_plant', sources: ['coal', 'gas', 'oil', 'biomass', 'waste'], roofForm: 'flat', motif: 'thermal', palette: 'concrete' },
    { id: 'solar_plant', sources: ['solar'], roofForm: 'flat', motif: 'solar', palette: 'metal' },
    { id: 'hydro_plant', sources: ['hydro'], roofForm: 'flat', motif: 'hydro', palette: 'concrete' },
    { id: 'wind_plant', sources: ['wind'], roofForm: 'flat', motif: 'wind', palette: 'pale' },
    { id: 'nuclear_plant', sources: ['nuclear'], roofForm: 'flat', motif: 'nuclear', palette: 'concrete' },
  ],
  substation: [{ id: 'substation_hall', roofForm: 'flat', motif: 'substation', palette: 'metal' }],
  water: [{ id: 'water_treatment', roofForm: 'flat', motif: 'water', palette: 'clinical' }],
});

export const FUNCTIONAL_FAMILIES = Object.freeze({
  school: 'education', university: 'education', kindergarten: 'education',
  hospital: 'medical', clinic: 'medical', bus_station: 'station', terminal: 'station',
  emergency: 'civic', theatre: 'museum', hangar: 'warehouse', plant: 'energy', generator: 'energy',
});

export const FUNCTIONAL_PALETTES = Object.freeze({
  lacquer: [0xe4d1af, 0x52695a, 0x963b2b], timber: [0xe6dfca, 0x4e514c, 0x725037],
  gold: [0xf0e4c8, 0xbe963e, 0x903d2f], pale: [0xe8e5da, 0x778d91, 0x8f938d],
  earth: [0xc7a17c, 0xa98460, 0x825d44], turquoise: [0xe5d8b9, 0x328a92, 0x305b80],
  stone: [0xbebcb2, 0x53606a, 0x92968c], sandstone: [0xd6b08b, 0xb47850, 0x936044],
  brick: [0xad6650, 0x565c60, 0xdfd2b7], concrete: [0xb8bec0, 0x65757c, 0x75838b],
  metal: [0xadb9bf, 0x526973, 0xdeaa55], clinical: [0xe5ece5, 0x6d9296, 0x328485],
});

export const FUNCTIONAL_MATERIALS = Object.freeze({
  granite: 0xaaa7a0, basalt: 0x626970, sandstone: 0xc9a477, limestone: 0xd9d1b7,
  marble: 0xe5e1d6, brick: 0xb06c51, wood: 0xa17b55, concrete: 0xb8bec0,
});

export const FUNCTIONAL_DETAIL_LIMIT = 160;

export const FUNCTIONAL_FACADES = Object.freeze({
  temple: { facade: 'columns', shape: 'lattice', storeyH: 10, bayStep: 5, glass: 0x5c5541 },
  shrine: { facade: 'timber', shape: 'lattice', storeyH: 10, bayStep: 5, glass: 0x5c5541 },
  pagoda: { facade: 'columns', shape: 'lattice', storeyH: 4, bayStep: 4, glass: 0x5c5541 },
  mosque: { facade: 'arches', shape: 'arch', storeyH: 10, bayStep: 5, glass: 0x457b82 },
  square_minaret: { facade: 'arches', shape: 'arch', storeyH: 10, bayStep: 5, glass: 0x457b82 },
  church: { facade: 'stone', shape: 'arch', storeyH: 12, bayStep: 5, glass: 0x596b92 },
  orthodox: { facade: 'stone', shape: 'arch', storeyH: 10, bayStep: 5, glass: 0x596b92 },
  synagogue: { facade: 'arches', shape: 'arch', storeyH: 8, bayStep: 5, glass: 0x587785 },
  mandir: { facade: 'columns', shape: 'lattice', storeyH: 8, bayStep: 4, glass: 0x6e5941 },
  gurdwara: { facade: 'arches', shape: 'arch', storeyH: 8, bayStep: 5, glass: 0x70898d },
  stupa: { facade: 'recess', shape: 'rect', storeyH: 10, bayStep: 7, glass: 0x756445 },
  school: { facade: 'ribbon', shape: 'wide', storeyH: 3.4, bayStep: 3.5, glass: 0x76979e },
  station: { facade: 'piers', shape: 'arch', storeyH: 8, bayStep: 5, glass: 0x6d8b9a },
  hospital: { facade: 'ribbon', shape: 'wide', storeyH: 3.4, bayStep: 3.2, glass: 0x76a4b0 },
  civic: { facade: 'columns', shape: 'rect', storeyH: 6, bayStep: 5, glass: 0x657f8c },
  library: { facade: 'piers', shape: 'wide', storeyH: 5, bayStep: 4, glass: 0x709691 },
  museum: { facade: 'stone', shape: 'rect', storeyH: 6, bayStep: 6, glass: 0x6d8490 },
});
