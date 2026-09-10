// 地質生成器與陸地／水下場景共用：選址語彙 → 固定比例組成 → 狀態表面與設施。
import { selectAncientStone, ancientStoneGeometry, stoneBuilder, ANCIENT_RUINS } from './ancientStone.js';
import { mulberry32 } from './rng.js';

export const HERITAGE_STATES = Object.freeze(['tourism', 'abandoned', 'underwater']);
export const LEGACY_HERITAGE = Object.freeze({
  ruins: 'temple', obelisk: 'obelisk', spire: 'bell_tower', titan: 'statue',
  shrineTorii: 'torii', stupaRuin: 'tomb', pyramidZiggurat: 'altar',
  sunkenSlateRuin: 'slate_house', sunkenEgyptianPylon: 'egyptian_gate', sunkenTongkonan: 'boat_roof_frame', inuksukSite: 'inuksuk',
});

export function heritageStateOf(tags = {}) {
  if (tags.submerged === 'yes' || tags.location === 'underwater') return 'underwater';
  if (tags.abandoned === 'yes' || tags.disused === 'yes' || tags.access === 'no' || tags.access === 'private'
    || Object.keys(tags).some(key => key.startsWith('abandoned:'))) return 'abandoned';
  return 'tourism';
}

export function heritageRuinType(tags = {}) {
  const type = tags.archaeological_site || tags.ruins;
  if (Object.hasOwn(ANCIENT_RUINS, type)) return type;
  const aliases = { settlement: 'village', fortification: 'castle', tumulus: 'tomb', necropolis: 'cemetery', megalith: 'altar' };
  return Object.hasOwn(aliases, type) ? aliases[type] : 'auto';
}

export function generateHeritageSite(seed = 0, input = {}) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('Heritage seed must be a safe integer');
  const state = input.state || 'abandoned';
  if (!HERITAGE_STATES.includes(state)) throw new RangeError('Unknown heritage state');
  const selection = input.selection || selectAncientStone(seed, input, input.ruinType && input.ruinType !== 'auto' ? 'ruins' : 'auto');
  const source = ancientStoneGeometry(selection, seed, { clearDebris: state === 'tourism' });
  const triangles = source.triangles.map(triangle => ({ ...triangle }));
  const [w,h,d] = source.bounds.size;
  const centerX = (source.bounds.min[0] + source.bounds.max[0]) / 2;
  const centerZ = (source.bounds.min[2] + source.bounds.max[2]) / 2;
  const additions = stoneBuilder(state === 'tourism' ? 0x8b969b : 0x80775d);
  const rnd = mulberry32(seed ^ 0x53495445);
  if (state === 'tourism') {
    // 現代設施置於遺構包絡之外；保留原有開口與殘缺，不虛構完整復原建築。
    const z = source.bounds.max[2] + 2.2;
    additions.box(centerX,0,z,w+5,.18,2.2,0,0xb3aa94);
    for (let i=0;i<=6;i++) additions.box(centerX-w/2+i*w/6,.18,z-1,.09,1,.09,0,0x535f64);
    additions.box(centerX,1.05,z-1,w,.07,.07,0,0x535f64);
    additions.box(centerX,.18,z+.3,.12,.8,.12,0,0x535f64);
    additions.box(centerX,.98,z+.3,1.2,.5,.12,0,0x356575);
    for (const x of [source.bounds.min[0]-1,source.bounds.max[0]+1]) {
      additions.box(x,.18,z,1.6,.45,.55,0,0x84684c);
    }
  }
  // 像地質覆蓋一樣，以空間格雜湊形成連續斑塊，不逐頂點抖動遺構。
  for (const triangle of triangles) {
    const cx=(triangle.a[0]+triangle.b[0]+triangle.c[0])/3;
    const cy=(triangle.a[1]+triangle.b[1]+triangle.c[1])/3;
    const cz=(triangle.a[2]+triangle.b[2]+triangle.c[2])/3;
    const patch=mulberry32(seed ^ Math.imul(Math.floor(cx/2),73856093) ^ Math.imul(Math.floor(cz/2),19349663))();
    if (state==='underwater') triangle.color = cy < h*.18 ? 0x8c907a : patch < .48 ? 0x527c73 : 0x788d8c;
    else if (state==='abandoned' && patch < .28) triangle.color = 0x697452;
  }
  if (state==='underwater') {
    for(let i=0;i<14;i++) {
      const angle=rnd()*Math.PI*2, radius=.6+rnd()*.5;
      additions.box(centerX+Math.cos(angle)*(w/2+1),0,centerZ+Math.sin(angle)*(d/2+1),radius,.15+rnd()*.3,radius,rnd()*Math.PI);
    }
  }
  triangles.push(...additions.triangles);
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for(const triangle of triangles) for(const point of [triangle.a,triangle.b,triangle.c]) for(let axis=0;axis<3;axis++) {
    min[axis]=Math.min(min[axis],point[axis]); max[axis]=Math.max(max[axis],point[axis]);
  }
  return { state, selection, triangles, bounds:{min,max,size:max.map((value,i)=>value-min[i])}, facilities:state==='tourism' };
}
