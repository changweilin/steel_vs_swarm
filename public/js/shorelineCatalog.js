// Shore facilities are appearance recipes; water identity and placement settle in shoreline.js.
export const SHORELINE = Object.freeze({
  STEP_M: 12, MAX_SIDE: 192, MAX_ANCHORS: 4096, MAX_SOURCE_PROBES: 8192,
  TYPE_REACH_M: 24, MAX_WIDTH_M: 240, NORMAL_PROBE_M: 1, WET_PROBE_M: .1,
  FIT_STEP_M: .6, MAX_FIT_PROBES: 4096, MAX_GROUND_DELTA_M: .32,
  INDEX_CELL_M: 64, MAX_INDEX_CELLS: 65536,
  GAP_M: 1, LIMIT: 480, LOW_LIMIT: 120, VARIANTS: 2,
});

export const SHORE_WATER_TAGS = Object.freeze({
  sea: 'sea', ocean: 'sea', lake: 'lake', reservoir: 'reservoir', pond: 'pond',
  lagoon: 'lagoon', river: 'river', stream: 'stream', canal: 'canal',
  drain: 'drain', ditch: 'ditch', basin: 'basin', dock: 'canal', tidal_channel: 'tidal',
});

const inland = ['lake', 'reservoir', 'pond', 'river', 'stream', 'canal', 'drain', 'ditch', 'basin'];
const navigable = ['sea', 'lagoon', 'lake', 'reservoir', 'river', 'canal', 'tidal'];
const all = [...inland, 'sea', 'lagoon', 'tidal', 'unknown'];
const spec = (size, types, contexts, extra = {}) => ({ size, types, contexts,
  proceduralContexts: extra.mapped ? ['built'] : contexts, ...extra });

export const SHORE_FACILITIES = Object.freeze({
  rock_bank: spec([2.8, .65, 1.3], all, ['rock']),
  reed_bank: spec([2.4, 1.5, 1.1], inland, ['vegetated']),
  dune_fence: spec([3.4, 1.15, .35], ['sea', 'lagoon'], ['sand']),
  timber_rail: spec([3, 1.1, .25], navigable, ['built']),
  steel_rail: spec([3, 1.1, .25], [...inland, 'sea', 'lagoon'], ['built']),
  quay_edge: spec([3.6, .3, .55], navigable, ['built']),
  riprap: spec([3, .7, 1.4], [...navigable, 'stream', 'drain'], [], { mapped: [['man_made', 'embankment']] }),
  gabion: spec([2.8, .85, 1], [...inland, 'sea'], [], { mapped: [['barrier', 'retaining_wall']] }),
  steps: spec([2, .8, 1.8], navigable, [], { mapped: [['highway', 'steps']] }),
  life_ring: spec([.85, 1.8, .45], navigable, [], { mapped: [['emergency', 'life_ring']] }),
  mooring_bollard: spec([.7, .75, .65], navigable, [], { mapped: [['mooring', 'bollard']] }),
  mooring_ring: spec([.6, .45, .5], navigable, [], { mapped: [['mooring', 'ring']] }),
  ladder: spec([.8, 1.8, .45], navigable, [], { mapped: [['man_made', 'ladder']] }),
  jetty: spec([2.4, 1.15, 3.2], navigable, [], { mapped: [['man_made', 'pier']], proceduralContexts: ['built', 'vegetated'] }),
  floating_dock: spec([3, .6, 2.8], navigable, [], { mapped: [['man_made', 'pier'], ['floating', 'yes']], allTags: true }),
  fishing_deck: spec([3.2, 1.15, 2.8], ['lake', 'reservoir', 'pond', 'river', 'canal'], [], { mapped: [['leisure', 'fishing']], proceduralContexts: ['built', 'vegetated'] }),
  kayak_rack: spec([2.8, 1.9, 1.6], navigable, [], { mapped: [['canoe', 'put_in']], proceduralContexts: ['built', 'vegetated'] }),
  boat_ramp: spec([3, .65, 3.2], navigable, [], { mapped: [['leisure', 'slipway']] }),
  sluice: spec([2.4, 2.4, 1.4], inland, [], { mapped: [['waterway', 'sluice_gate']] }),
  trash_screen: spec([2.2, 1.2, 1.2], ['canal', 'drain', 'ditch', 'basin'], [], { mapped: [['waterway', 'debris_screen']] }),
  pump: spec([1.8, 1.7, 1.4], inland, [], { mapped: [['man_made', 'pumping_station']] }),
  outfall: spec([2.1, 1.45, 1.4], all, [], { mapped: [['man_made', 'outfall']] }),
  culvert_head: spec([2.4, 1.5, .85], ['stream', 'canal', 'drain', 'ditch'], [], { mapped: [['tunnel', 'culvert']] }),
  gauge: spec([.45, 1.8, .35], inland, [], { mapped: [['man_made', 'monitoring_station'], ['monitoring:water_level', 'yes']], allTags: true }),
  groyne: spec([3, 1.05, 1.4], ['sea', 'lagoon', 'river', 'tidal'], [], { mapped: [['man_made', 'groyne']] }),
  breakwater: spec([3.4, 1.3, 1.6], ['sea', 'lagoon'], [], { mapped: [['man_made', 'breakwater']] }),
  beach_shower: spec([.9, 2.2, .9], ['sea', 'lagoon', 'lake'], [], { mapped: [['amenity', 'shower']] }),
  rescue_tower: spec([2.4, 3.5, 2.2], ['sea', 'lagoon', 'lake'], [], { mapped: [['emergency', 'lifeguard_tower']] }),
});
