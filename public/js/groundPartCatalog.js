import { VENUES } from './groundVenues.js';
import { LANDSCAPES } from './groundLandscapes.js';
import { VISITOR_SITES } from './groundVisitorSites.js';
// Nominal envelopes in metres; procedural builders vary joints, panels and silhouettes.
export const GROUND_PARTS = {
  tuft: ['blade', .7, 1, .7, 'grass'], rice: ['blade', .38, .95, .38, 'grass'],
  reed: ['blade', .45, 1.7, .45, 'grass'], miscanthus: ['blade', .8, 1.9, .8, 'grass'],
  weed: ['blade', .5, .7, .5, 'grass'], flower: ['flower', .4, .6, .4, 'palette'],
  bush: ['crown', 1.5, 1.2, 1.5, 'foliage'], drybush: ['crown', 1.3, .9, 1.3, 0xa08c58],
  cabbage: ['crown', .65, .5, .65, 'foliage'], sapling: ['tree', 1.6, 2.4, 1.6, 'foliage'],
  bamboo: ['tree', .75, 2.9, .75, 'foliage'], snag: ['snag', .6, 3, .6, 0x89735a],
  charsnag: ['snag', .55, 2.6, .55, 0x443b36],
  pebble: ['rock', .7, .35, .6, 0x9e9889], boulder: ['rock', 2, 1.5, 1.8, 0x89877b],
  rockflat: ['rock', 1.3, .4, 1.1, 0x999082], iceshard: ['rock', .85, 1, .7, 0xc9e5eb],
  saltmound: ['rock', 1.3, .8, 1.1, 0xe7e8df], spoil: ['rock', 2.3, 1, 2, 0xa08b6e],
  slab: ['rock', 1.8, .6, 1.2, 0x9a9b96],
  log: ['log', 3.2, .65, .65, 0x96734b], logpile: ['logs', 3.1, 1.2, 1.3, 0xa17c50],
  stump: ['stump', .9, .6, .9, 0x8e704b], hay: ['log', 1.6, 1.5, 1.5, 0xc2a35a],
  plank: ['crate', 2.1, .6, .9, 0xbc9c69], crate: ['crate', .95, .85, .95, 0xb99862],
  cabin: ['hut', 3.4, 2.4, 2.8, 0x88704f], ghouse: ['hut', 3.5, 1.8, 2.2, 0xc7d4cb],
  vinerow: ['trellis', 3.1, 1.5, .7, 'foliage'], fencepost: ['post', .15, 1.2, .15, 0x8c704c],
  pipe: ['pipe', 2.7, .9, .9, 0xa7b0b2], drum: ['drum', .68, .95, .68, 'palette'],
  barrier: ['crate', 1.7, .75, .38, 0xd7d4bf], canopy: ['canopy', 4.6, 3.4, 3.2, 0xd2d7d2],
  pump: ['pump', .6, 1.3, .45, 'palette'], container: ['container', 6.058, 2.591, 2.438, 'palette'],
  carwreck: ['car', 4.8, 1.45, 1.9, 'palette'], solarpanel: ['solar', 2.5, 1.1, 1.5, 0x345879],
  bench: ['bench', 1.7, .95, .65, 0x9e774c], headstone: ['stone', .6, .9, .25, 0xb2b4aa],
  billboard: ['sign', 3.8, 3.8, .3, 'palette'], planter: ['planter', 1.1, 1.4, 1.1, 0xb47a50],
  hoop: ['hoop', 1.8, 3.65, .8, 0xe9ece5],
  lotuspad: ['leaf', 1.1, .12, 1, 'foliage'], fish: ['fish', 1, .22, .3, 0xd1a065],
  shell: ['shell', .4, .15, .32, 0xe5d9ba], mushroom: ['mushroom', .4, .4, .4, 0xb17a50],
};
export const PART_VARIATION = { count: 3, size: [.88, 1.08], segments: [5, 9], branches: [3, 6], blades: [5, 9] };
Object.assign(GROUND_PARTS, {
  picnictable: ['picnic', 2.1, .85, 1.7, 0xa8875d],
  tent: ['tent', 2.6, 1.7, 2.8, 0xb49157], litterbin: ['bin', .55, .9, .55, 0x63776d],
  tennisnet: ['net', 12.8, 1.07, .12, 0xe6e2cf], badmintonnet: ['net', 6.3, 1.55, .12, 0xe6e2cf],
  picklenet: ['net', 6.3, .914, .12, 0xe6e2cf], volleynet: ['net', 10, 2.43, .12, 0xe6e2cf],
  beachnet: ['net', 9, 2.43, .12, 0xe6e2cf], takrawnet: ['net', 6.3, 1.55, .12, 0xe6e2cf],
  soccergoal: ['goal', 7.32, 2.44, 1.5, 0xe9e8dd], smallgoal: ['goal', 3, 2, 1, 0xe9e8dd],
  hockeygoal: ['goal', 3.66, 2.14, 1.2, 0xe9e8dd], rugbypost: ['uprights', 5.6, 8, .2, 0xe9e8dd],
  footballpost: ['uprights', 5.64, 9, .2, 0xeec65d], netballpost: ['netball', .4, 3.05, .4, 0xe9e8dd],
  wicket: ['wicket', .229, .711, .06, 0xc5ab77], gate: ['goal', .22, .2, .04, 0xe9e8dd],
  target: ['target', 1.22, 1.8, .3, 0xe9e8dd], incenseurn: ['urn', 1.4, 1.3, 1.4, 0x8c7455],
  fountain: ['fountain', 3, 1.8, 3, 0xb4aa94], stonelantern: ['lantern', .8, 1.7, .8, 0x999b91],
  lantern: ['lantern', .6, 2.4, .6, 0xb94739], marketstall: ['stall', 3, 2.5, 2, 0xbf9366],
});

// scatter: [minimum count, maximum count, minimum scale, maximum scale, probability].
// rows: [X spacing, Z spacing, cap, missing fraction, minimum scale, maximum scale].
// fixed: [type, local X / width, local Z / depth, heading in radians, scale].
export const GROUND_ATTACHMENTS = {
  turf: { scatter: { tuft: [3, 7, .7, 1.3], weed: [2, 6, .7, 1.2], flower: [2, 5, .7, 1.1, .7] } },
  lawn: { scatter: { tuft: [3, 6, .7, 1.2], weed: [1, 3, .6, 1], flower: [1, 3, .7, 1.1, .4] } },
  meadow: { scatter: { miscanthus: [9, 16, .9, 1.6], tuft: [3, 5, 1, 1.7], weed: [3, 5, .7, 1.2] } },
  bushfield: { scatter: { bush: [5, 9, .8, 1.7], tuft: [2, 4, .7, 1.2], weed: [2, 4, .7, 1.1] } },
  flowerfield: { scatter: { flower: [12, 20, .8, 1.4], tuft: [3, 5, .6, 1], weed: [2, 4, .6, 1] } },
  orchard: { rows: { sapling: [5, 5, 14, .2, .9, 1.4] } },
  paddy: { rows: { rice: [2.8, 2.6, 34, .15, .8, 1.2] } },
  dryfield: { scatter: { hay: [1, 2, .8, 1.3, .6], pebble: [2, 4, .5, 1] } },
  teafield: { rows: { bush: [2.6, 3.4, 28, .12, .45, .7] }, scatter: { tuft: [2, 4, .5, .8] } },
  veggiefield: { rows: { cabbage: [1.7, 2.4, 36, .15, .8, 1.3] }, scatter: { fencepost: [3, 6, .9, 1.2, .5] } },
  pasture: { scatter: { fencepost: [6, 10, 1, 1.3], tuft: [7, 12, .8, 1.4], weed: [2, 4, .6, 1], hay: [1, 3, .9, 1.3, .55] } },
  wild: { scatter: { pebble: [3, 6, .5, 1.3], tuft: [3, 5, .6, 1], drybush: [2, 4, .7, 1.2], boulder: [1, 3, .7, 1.2, .35], weed: [2, 4, .7, 1.1], miscanthus: [1, 3, .8, 1.3], flower: [1, 2, .6, .9, .15] } },
  gravel: { scatter: { pebble: [6, 12, .5, 1.4], boulder: [2, 4, .8, 1.5, .3], rockflat: [2, 4, .7, 1.2, .3], weed: [1, 3, .6, 1] } },
  sand: { scatter: { pebble: [4, 7, .7, 1.8], shell: [3, 6, .8, 1.4], drybush: [1, 2, .6, 1, .5] } },
  mud: { scatter: { pebble: [2, 4, .5, .9], weed: [2, 4, .6, .9], reed: [2, 4, .6, 1] } },
  crackedearth: { scatter: { pebble: [2, 4, .5, .9], weed: [2, 4, .6, .9], drybush: [1, 3, .6, 1] } },
  redsoil: { scatter: { pebble: [2, 4, .5, .9], tuft: [1, 3, .5, .8], weed: [1, 3, .6, .9] } },
  marsh: { scatter: { reed: [8, 14, .8, 1.4], tuft: [3, 5, .6, 1.1], log: [1, 2, .7, 1, .4], fish: [2, 4, .7, 1.1] } },
  lotus: { scatter: { lotuspad: [12, 20, .8, 1.6], reed: [4, 6, .7, 1.2], fish: [3, 6, .8, 1.3] } },
  watertile: { scatter: { reed: [1, 3, .7, 1.1], fish: [3, 7, .8, 1.4] },
    contexts: { pond: { lotuspad: [5, 9, .8, 1.3] }, lake: { reed: [5, 9, .8, 1.4] }, spring: { reed: [1, 2, .6, 1] } } },
  deepwater: { scatter: { fish: [4, 8, 1, 1.8], lotuspad: [1, 2, .7, 1, .15] } },
  arrowbamboo: { scatter: { bamboo: [6, 12, .8, 1.4], tuft: [3, 6, .6, 1], mushroom: [2, 4, .8, 1.2] } },
  deadwood: { scatter: { snag: [3, 6, .7, 1.2], log: [2, 4, .8, 1.2], mushroom: [2, 5, .8, 1.3] } },
  fallenlogs: { scatter: { log: [4, 7, .7, 1.4], stump: [2, 4, .7, 1.2], mushroom: [2, 5, .8, 1.3], tuft: [2, 4, .6, 1] } },
  deadforest: { scatter: { charsnag: [3, 7, .7, 1.3], log: [2, 4, .8, 1.2], mushroom: [1, 3, .7, 1.1] } },
  clearcut: { scatter: { stump: [4, 8, .7, 1.3], log: [2, 4, .8, 1.2], weed: [3, 6, .6, 1] } },
  lumberyard: { rows: { logpile: [4, 2.4, 12, .25, .8, 1.2] }, scatter: { plank: [2, 4, .8, 1.2] } },
  rottencabin: { scatter: { cabin: [1, 2, .8, 1.2], plank: [2, 4, .7, 1.1], weed: [4, 7, .6, 1] } },
  vineyard: { rows: { vinerow: [4, 3, 24, .15, .8, 1.2] } },
  greenhouse: { rows: { ghouse: [4.5, 3.2, 12, .15, .9, 1.1] } },
  abandonedfarm: { scatter: { weed: [6, 12, .7, 1.2], hay: [1, 3, .8, 1.2], fencepost: [3, 6, .8, 1.2] } },
  slabruin: { scatter: { slab: [3, 6, .8, 1.4], pebble: [3, 6, .6, 1.2], weed: [2, 4, .6, 1] } },
  steppe: { scatter: { tuft: [5, 9, .6, 1], drybush: [2, 4, .7, 1.2], pebble: [3, 6, .5, 1] } },
  saltpan: { scatter: { saltmound: [3, 6, .7, 1.3], pebble: [2, 4, .5, .9] } },
  quarry: { scatter: { rockflat: [4, 7, .9, 1.7], spoil: [1, 3, .8, 1.4], boulder: [1, 3, .7, 1.2] } },
  plateau: { scatter: { rockflat: [3, 6, .8, 1.4], boulder: [1, 3, .7, 1.2], tuft: [3, 6, .6, 1] } },
  icefield: { scatter: { iceshard: [6, 11, .7, 1.5], pebble: [1, 3, .4, .8], boulder: [1, 2, .6, 1, .5] } },
  scree: { scatter: { pebble: [9, 16, .5, 1.4], rockflat: [3, 5, .7, 1.3], boulder: [1, 3, .6, 1.1] } },
  construction: { scatter: { pipe: [1, 3, .9, 1.3], spoil: [1, 3, .8, 1.3], barrier: [3, 5, .9, 1.2], plank: [1, 3, .8, 1.1], drum: [2, 4, .9, 1.1], crate: [1, 3, .9, 1.2] } },
  gasstation: { fixed: [['canopy', 0, 0, 0, 1.1]], scatter: { drum: [2, 4, .9, 1.1] } },
  park: { scatter: { sapling: [4, 7, .9, 1.4], bench: [1, 3, .9, 1.1], flower: [8, 12, .7, 1.2], tuft: [3, 5, .6, 1], planter: [1, 3, .9, 1.1, .5] } },
  plaza: { scatter: { bench: [2, 4, .9, 1.1], planter: [2, 4, .9, 1.1], billboard: [1, 2, .9, 1.05, .4] } },
  concrete: { scatter: { bench: [1, 2, .9, 1.1, .4], drum: [1, 2, .9, 1.1, .3], crate: [1, 2, .9, 1.2, .3], planter: [1, 3, .9, 1.1, .35], bush: [1, 3, .7, 1.1, .3], sapling: [1, 2, .9, 1.2, .25], billboard: [1, 2, .9, 1.05, .22], flower: [2, 4, .7, 1, .3], weed: [3, 5, .6, .9], container: [1, 2, .9, 1.1, .15], solarpanel: [1, 2, .9, 1.1, .12] } },
  pavement: { scatter: { bench: [1, 2, .9, 1.1, .4], planter: [1, 2, .9, 1.1, .35], flower: [2, 4, .7, 1], weed: [2, 4, .6, .9] } },
  brick: { scatter: { planter: [1, 2, .9, 1.1, .35], flower: [2, 4, .7, 1], weed: [2, 4, .6, .9] } },
  parking: { scatter: { billboard: [1, 2, .9, 1.1, .5], planter: [1, 3, .9, 1.1], weed: [2, 4, .6, .9] } },
  court: { fixed: [['hoop', -.42, 0, Math.PI / 2, 1], ['hoop', .42, 0, -Math.PI / 2, 1], ['bench', 0, -.44, 0, .75], ['bench', 0, .44, Math.PI, .75]] },
  track: { fixed: [['bench', 0, -.44, 0, .75], ['bench', 0, .44, Math.PI, .75]] },
  helipad: {},
  scrapyard: { scatter: { carwreck: [4, 7, .9, 1.3], drum: [2, 4, .9, 1.1], crate: [1, 3, .9, 1.2], pipe: [1, 3, .7, 1], pebble: [2, 4, .5, .9], weed: [3, 6, .6, 1] } },
  containeryard: { rows: { container: [7.4, 3.4, 26, .15, .9, 1.1] }, scatter: { crate: [2, 4, .8, 1.1] } },
  cemetery: { rows: { headstone: [2.2, 2.6, 24, .25, .9, 1.2] }, scatter: { sapling: [1, 3, .9, 1.2] } },
  solarfarm: { rows: { solarpanel: [3.2, 2.8, 32, .08, .9, 1.1] } },
  fishpond: { scatter: { reed: [6, 10, .7, 1.1], lotuspad: [3, 6, .7, 1.1, .4], fish: [3, 7, .8, 1.3] } },
};
export const GROUND_PART_PALETTES = {
  flower: [0xe88bb0, 0xf2d24a, 0xf5f5f5, 0xc77ddb, 0xe8734a],
  container: [0xd94f3d, 0x3d7ad9, 0x4f9a55, 0xe8a03d, 0x8a8f96],
  carwreck: [0x9a4a3a, 0x5a6a7a, 0x7a6a3a, 0x4a5a4a, 0x8a3a2a],
  pump: [0xd94f3d, 0x3d6ed9, 0xf2d24a], drum: [0x3d6ed9, 0xd94f3d, 0x4f9a55, 0xd9b23d, 0x8a8f96],
  billboard: [0xe8734a, 0x3d7ad9, 0xf2d24a, 0x4f9a55, 0xc77ddb],
};

for (const [id, venue] of Object.entries(VENUES)) {
  GROUND_ATTACHMENTS[id] = { fixed: venue.equipment.map(([type, x, z, heading]) =>
    [type, x, z, heading, 1]), referenceWidth: venue.length / .8 };
}
for (const [id, landscape] of Object.entries(LANDSCAPES)) {
  GROUND_ATTACHMENTS[id] = { scatter: Object.fromEntries(landscape.parts.map(type =>
    [type, ['boulder', 'log', 'sapling', 'spoil'].includes(type) ? [1, 3, .6, 1.1] : [4, 9, .5, 1.2]])) };
}
for (const [id, site] of Object.entries(VISITOR_SITES)) {
  GROUND_ATTACHMENTS[id] = { fixed: site.equipment.map(([type, x, z]) => [type, x, z, 0, 1]) };
}
