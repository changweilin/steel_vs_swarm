// Fixed-proportion visual archetypes, not archaeological reconstructions or collision hulls.
import { mulberry32 } from './rng.js';
import { REGIONAL_STONE_BUILDERS } from './ancientStoneSites.js';
import { ACTIVITY_RUINS } from './ancientRuins.js';

const monument = (name, region, location, radiusKm, color, ageMa) =>
  ({ name, region, location, radiusKm, color, ageMa, uniformScale: [.5, 1.5] });
export const ANCIENT_MONUMENTS = {
  egypt_pyramid: monument('埃及金字塔', 'egypt', [29.98, 31.13], 450, 0xcbb284, .0046),
  maya_pyramid: monument('瑪雅金字塔', 'maya', [20.68, -88.57], 800, 0xb2aa8e, .001),
  parthenon: monument('帕德嫩神殿', 'greece', [37.97, 23.73], 400, 0xd8cfb9, .0025),
  colosseum: monument('羅馬競技場', 'rome', [41.89, 12.49], 250, 0xb9a48b, .00195),
  stonehenge: monument('巨石陣', 'britain', [51.18, -1.83], 450, 0x929388, .0045),
  machu_picchu: monument('馬丘比丘', 'andes', [-13.16, -72.55], 500, 0x999786, .0006),
  moai: monument('摩艾像', 'rapa_nui', [-27.12, -109.35], 150, 0x81776a, .0007),
  angkor_wat: monument('吳哥窟', 'khmer', [13.41, 103.87], 400, 0x9c9279, .0009),
  qin_mausoleum: monument('秦皇陵', 'qin', [34.38, 109.25], 400, 0x988769, .00225),
  great_zimbabwe: monument('大辛巴威', 'zimbabwe', [-20.27,30.93], 400, 0x9b9588, .0007),
  lalibela: monument('拉利貝拉岩鑿教堂', 'ethiopia_highlands', [12.03,39.04], 250, 0xa87962, .0008),
  petra: monument('佩特拉岩鑿墓殿', 'jordan', [30.33,35.44], 180, 0xc18b76, .002),
  hegra: monument('黑格拉岩墓', 'hejaz', [26.79,37.95], 300, 0xc4a17e, .002),
  persepolis: monument('波斯波利斯', 'persia', [29.94,52.89], 400, 0xaaa18e, .0025),
  gobekli_tepe: monument('哥貝克力石陣', 'upper_mesopotamia', [37.22,38.92], 200, 0xc3b596, .011),
  geghard: monument('格加爾德修道院', 'armenia', [40.14,44.82], 180, 0x827e79, .0008),
  sanchi: monument('桑奇佛塔', 'central_india', [23.48,77.74], 350, 0xb6a185, .0022),
  chola: monument('朱羅大神廟', 'tamil', [10.78,79.13], 300, 0xb19b7e, .001),
  borobudur: monument('婆羅浮屠', 'java', [-7.61,110.2], 300, 0x777b76, .0012),
  seokguram: monument('石窟庵', 'silla', [35.79,129.35], 220, 0xb3b3a8, .0013),
  gusuku: monument('琉球石造城跡', 'ryukyu', [26.28,127.8], 250, 0xbcb49b, .0006),
  malta_temples: monument('馬爾他巨石神廟', 'malta', [35.83,14.44], 80, 0xcbb994, .0055),
  nuraghe: monument('巴魯米尼努拉吉', 'sardinia', [39.71,8.99], 180, 0x8e897b, .0035),
  tiwanaku: monument('蒂瓦納庫太陽門', 'altiplano', [-16.55,-68.67], 250, 0x999084, .0015),
  chaco: monument('查科石造大屋', 'four_corners', [36.06,-107.96], 350, 0xb09575, .001),
  nan_madol: monument('南馬都爾', 'pohnpei', [6.84,158.33], 100, 0x65716c, .0007),
};
export const ANCIENT_RUINS = {
  wall: '廢棄城牆', gate: '廢棄城門', bunker: '廢棄碉堡', castle: '廢棄城堡',
  temple: '廢棄寺廟', statue: '殘缺神像', village: '廢棄村落', tomb: '廢棄陵寢', quarry: '廢棄採石場',
  ...Object.fromEntries(Object.entries(ACTIVITY_RUINS).map(([id,row])=>[id,row.name])),
};
export const RUIN_ACTIVITIES = { wall:'防禦',gate:'防禦',bunker:'防禦',castle:'防禦',temple:'祭祀',
  statue:'祭祀',village:'居住',tomb:'喪葬',quarry:'生產',
  ...Object.fromEntries(Object.entries(ACTIVITY_RUINS).map(([id,row])=>[id,row.activity])) };
export const ANCIENT_REGIONS = {
  egypt: '埃及', maya: '瑪雅地區', greece: '希臘', rome: '羅馬地區', britain: '不列顛',
  andes: '安地斯／庫斯科', rapa_nui: '拉帕努伊', khmer: '高棉／吳哥', qin: '關中／秦陵',
  zimbabwe: '辛巴威高原', ethiopia_highlands: '衣索比亞高地', jordan: '約旦／佩特拉', hejaz: '漢志／黑格拉',
  persia: '波斯／法爾斯', upper_mesopotamia: '上美索不達米亞', armenia: '亞美尼亞',
  central_india: '印度中部', tamil: '泰米爾', java: '爪哇', silla: '新羅／慶州', ryukyu: '琉球',
  malta: '馬爾他', sardinia: '薩丁尼亞', altiplano: '玻利維亞高原', four_corners: '北美四角地區', pohnpei: '波納佩',
};

/** Explicit region wins. Coordinate windows are art-direction zones, not national borders. */
export function ancientCandidates(input = {}) {
  if (input.region != null && typeof input.region !== 'string') throw new TypeError('Ancient region must be a string');
  const region = input.region?.trim().toLowerCase();
  if (region && region !== 'auto') {
    return Object.keys(ANCIENT_MONUMENTS).filter(key => ANCIENT_MONUMENTS[key].region === region);
  }
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) return [];
  if (Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) return [];
  const radians = Math.PI / 180;
  return Object.keys(ANCIENT_MONUMENTS).filter(key => {
    const { location: [lat, lon], radiusKm } = ANCIENT_MONUMENTS[key];
    const a = Math.sin((input.latitude - lat) * radians / 2) ** 2
      + Math.cos(lat * radians) * Math.cos(input.latitude * radians)
      * Math.sin((input.longitude - lon) * radians / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) <= radiusKm;
  });
}

/** Conditional probabilities within human stone objects, independent of catalog size. */
export function ancientStoneDistribution(input = {}) {
  return ancientCandidates(input).length
    ? [{type:'monument',weight:.5},{type:'ruins',weight:.5}]
    : [{type:'ruins',weight:1}];
}

export function selectAncientStone(seed, input = {}, mode = 'auto') {
  if (!Number.isSafeInteger(seed)) throw new TypeError('Ancient stone seed must be a safe integer');
  if (input.scale !== undefined) throw new TypeError('Use scalar uniformScale; per-axis scale is not supported');
  if (input.uniformScale !== undefined && (!Number.isFinite(input.uniformScale) || input.uniformScale < .01 || input.uniformScale > 10)) {
    throw new RangeError('uniformScale must be a number from 0.01 to 10');
  }
  if(!['auto','monument','ruins'].includes(mode)) throw new RangeError('Unknown ancient stone mode');
  const rnd = mulberry32(seed ^ 0x414e4349), candidates = ancientCandidates(input);
  let kind = mode;
  if(mode==='auto') {
    let roll=mulberry32(seed ^ 0x4b494e44)();
    for(const row of ancientStoneDistribution(input)) { roll-=row.weight;if(roll<0){kind=row.type;break;} }
  }
  if(!candidates.length) kind='ruins';
  const fallback = !candidates.length;
  const choices = kind==='ruins' ? Object.keys(ANCIENT_RUINS) : candidates;
  const requested = mode==='ruins' && input.ruinType && input.ruinType!=='auto' ? input.ruinType : null;
  if(requested && !Object.hasOwn(ANCIENT_RUINS,requested)) throw new RangeError('Unknown ruin type');
  const id = requested || choices[Math.floor(rnd() * choices.length)];
  const row = kind==='ruins' ? { name: ANCIENT_RUINS[id], region: input.region || 'unmatched',
    color: 0x999080, ageMa: .001, uniformScale: [.5, 1.5] } : ANCIENT_MONUMENTS[id];
  const uniformScale = input.uniformScale ?? row.uniformScale[0] + rnd() * (row.uniformScale[1] - row.uniformScale[0]);
  return { id, kind, activity: kind==='ruins'?RUIN_ACTIVITIES[id]:null, name: row.name, region: row.region, fallback, uniformScale,
    color: row.color, ageMa: row.ageMa, scaleRange: row.uniformScale };
}

// Small pure polygon builder: emits real openings, columns and lintels; no height-field stretching.
export function stoneBuilder(color) {
  const triangles = [];
  const tri = (a, b, c, tint = color) => triangles.push({ a, b, c, color: tint });
  const quad = (a, b, c, d, tint) => { tri(a, b, c, tint); tri(a, c, d, tint); };
  function frustum(x, y, z, w, h, d, topW = w, topD = d, angle = 0, tint = color) {
    const point = (px, py, pz) => [x + px * Math.cos(angle) - pz * Math.sin(angle), y + py,
      z + px * Math.sin(angle) + pz * Math.cos(angle)];
    const lo = [[-w/2, -d/2], [w/2, -d/2], [w/2, d/2], [-w/2, d/2]].map(([a,b]) => point(a, 0, b));
    const hi = [[-topW/2, -topD/2], [topW/2, -topD/2], [topW/2, topD/2], [-topW/2, topD/2]].map(([a,b]) => point(a, h, b));
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(lo[i], hi[i], hi[j], lo[j], tint); }
    if (topW > 0 && topD > 0) quad(hi[3], hi[2], hi[1], hi[0], tint);
    quad(lo[0], lo[1], lo[2], lo[3], tint);
  }
  const box = (x,y,z,w,h,d,angle = 0,tint = color) => frustum(x,y,z,w,h,d,w,d,angle,tint);
  function column(x, y, z, radius, height, sides = 12) {
    for (let i = 0; i < sides; i++) {
      const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2;
      const lo = [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius];
      const next = [x + Math.cos(b) * radius, y, z + Math.sin(b) * radius];
      const hi = [lo[0], y + height, lo[2]], hiNext = [next[0], y + height, next[2]];
      quad(lo, hi, hiNext, next);
      tri([x,y + height,z], hiNext, hi);
    }
  }
  function stairs(x, y, z, width, height, run, count = 12, angle = 0) {
    for (let i = 0; i < count; i++) {
      const along = run * (i + .5) / count;
      box(x - along * Math.sin(angle), y, z + along * Math.cos(angle), width,
        height * (i + 1) / count, run / count, angle);
    }
  }
  // Voussoir ring with a genuinely empty opening below, rather than a painted black arch.
  function arch(x, y, z, radius, thickness, depth, angle = 0) {
    const point = (r, a, dz) => [x + r * Math.cos(a) * Math.cos(angle) - dz * Math.sin(angle),
      y + r * Math.sin(a), z + r * Math.cos(a) * Math.sin(angle) + dz * Math.cos(angle)];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 8, b = (i + 1) * Math.PI / 8;
      const fi = point(radius,a,depth/2), fj = point(radius,b,depth/2);
      const fo = point(radius+thickness,a,depth/2), fp = point(radius+thickness,b,depth/2);
      const bi = point(radius,a,-depth/2), bj = point(radius,b,-depth/2);
      const bo = point(radius+thickness,a,-depth/2), bp = point(radius+thickness,b,-depth/2);
      quad(fi,fo,fp,fj); quad(bi,bj,bp,bo); quad(fi,fj,bj,bi); quad(fo,bo,bp,fp);
      quad(fi,bi,bo,fo); quad(fj,fp,bp,bj);
    }
  }
  function house(x,y,z,w = 5,d = 7,h = 3) {
    box(x-w/2,y,z,.5,h,d); box(x+w/2,y,z,.5,h,d); box(x,y,z-d/2,w,h,.5);
    // The door and lost roof stay open.
    box(x-w*.35,y,z+d/2,w*.3,h,.5); box(x+w*.35,y,z+d/2,w*.3,h,.5);
    box(x,y+h*.75,z+d/2,w*.4,h*.25,.5);
  }
  return { triangles, tri, quad, box, frustum, column, stairs, arch, house };
}

/** Canonical metres. Historic silhouettes never draw random component proportions. */
export function ancientStoneGeometry(selection, seed = 0, options = {}) {
  const g = stoneBuilder(selection.color), { box, frustum, column, stairs, arch, house } = g;
  const id = selection.id;
  if (Object.hasOwn(REGIONAL_STONE_BUILDERS,id)) {
    REGIONAL_STONE_BUILDERS[id](g);
  } else if (id === 'egypt_pyramid') {
    // Square courses all lie on the same fixed pyramid slope.
    const width = 230, height = 146, courses = 32;
    for (let i = 0; i < courses; i++) {
      const a = 1 - i/courses, b = 1 - (i+1)/courses;
      frustum(0,height*i/courses,0,width*a,height/courses,width*a,width*b,width*b);
    }
  } else if (id === 'maya_pyramid') {
    for (let i = 0; i < 9; i++) box(0,i*2.6,0,55-i*4.5,2.6,55-i*4.5);
    house(0,23.4,0,10,10,6); box(0,29.4,0,11,1,11);
    for (let i = 0; i < 4; i++) {
      const a = i*Math.PI/2;
      stairs(Math.sin(a)*28,0,-Math.cos(a)*28,5,23.4,23,32,a);
    }
  } else if (id === 'parthenon') {
    for (let i = 0; i < 3; i++) box(0,i*.6,0,33-i, .6,72-i);
    for (let i = 0; i < 8; i++) for (const z of [-32,32]) {
      const x = -13+i*26/7; column(x,1.8,z,.9,10); box(x,11.8,z,2.3,.7,2.3);
    }
    for (let i = 1; i < 16; i++) for (const x of [-13,13]) {
      const z = -32+i*4; column(x,1.8,z,.9,10); box(x,11.8,z,2.3,.7,2.3);
    }
    box(-13,12.5,0,2,2,66); box(13,12.5,0,2,2,66);
    box(0,12.5,-32,28,2,2); box(0,12.5,32,28,2,2);
    house(0,1.8,0,16,42,10);
    // Triangular pediments on both end walls; central roof remains a ruin.
    for (const z of [-32,32]) {
      g.tri([-14,14.5,z+1],[14,14.5,z+1],[0,19,z+1]);
      g.tri([14,14.5,z-1],[-14,14.5,z-1],[0,19,z-1]);
      g.quad([-14,14.5,z-1],[-14,14.5,z+1],[0,19,z+1],[0,19,z-1]);
      g.quad([0,19,z-1],[0,19,z+1],[14,14.5,z+1],[14,14.5,z-1]);
    }
  } else if (id === 'colosseum') {
    const segments = 40, rx = 90, rz = 72;
    for (let i = 0; i < segments; i++) {
      const a = i/segments*Math.PI*2, b = (i+1)/segments*Math.PI*2;
      const x = rx*Math.cos(a), z = rz*Math.sin(a);
      const nx = rx*Math.cos(b), nz = rz*Math.sin(b), angle = Math.atan2(nz-z,nx-x);
      const span = Math.hypot(nx-x,nz-z);
      const levels = i > 23 && i < 34 ? 1 : i > 19 && i < 37 ? 2 : 3;
      for (let j = 0; j < levels; j++) {
        box(x,j*12,z,3,12,7,angle);
        arch((x+nx)/2,j*12+5,(z+nz)/2,(span-3)/2,1.3,7,angle);
        box((x+nx)/2,j*12+10.5,(z+nz)/2,span,1.5,7,angle);
      }
      for (let tier = 0; tier < 5; tier++) {
        const f = .58+tier*.06;
        box((x+nx)/2*f,tier*2,(z+nz)/2*f,span*f+1,2,5,angle);
      }
    }
  } else if (id === 'stonehenge') {
    const posts = 24, radius = 14;
    for (let i = 0; i < posts; i++) {
      const a = i/posts*Math.PI*2, x = Math.cos(a)*radius, z = Math.sin(a)*radius;
      if ([4,5,13,20].includes(i)) continue;
      box(x,0,z,1.8,4.5,1.2,a+Math.PI/2);
      if ([3,12,19].includes(i)) continue;
      const b = (i+1)/posts*Math.PI*2, nx = Math.cos(b)*radius, nz = Math.sin(b)*radius;
      box((x+nx)/2,4.5,(z+nz)/2,Math.hypot(nx-x,nz-z)+1,.65,1.4,Math.atan2(nz-z,nx-x));
    }
    for (let i = 0; i < 5; i++) {
      const a = (i/6+.08)*Math.PI*2, x = Math.cos(a)*7, z = Math.sin(a)*7;
      for (const dx of [-1.4,1.4]) box(x+dx*Math.cos(a),0,z+dx*Math.sin(a),1.6,6,1.3,a);
      box(x,6,z,4.6,.8,1.6,a);
    }
  } else if (id === 'machu_picchu') {
    for (let i = 0; i < 7; i++) box(0,i*2.3,-i*1.8,70-i*5,2.3,48-i*3.7);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) house(-14+i*9,16.1,-19+j*10,6,7,3);
    stairs(0,0,24,3,16.1,27,24,Math.PI);
    column(15,16.1,-7,3,3,12);
  } else if (id === 'moai') {
    box(0,0,0,5,.6,4);
    frustum(0,.6,0,2.8,4,2,1.9,1.4);
    frustum(0,4.6,.1,1.9,3.2,1.4,2,1.4);
    box(0,5.4,1,.38,1.7,.85); box(0,6.8,.9,1.9,.3,.5);
    box(0,4.9,.84,1.3,.35,.3);
    for (const x of [-1.08,1.08]) box(x,5,.1,.25,2,.55);
    for (const x of [-1.08,1.08]) frustum(x,1.3,.22,.32,2.8,.7,.25,.5);
  } else if (id === 'angkor_wat') {
    for (let i = 0; i < 3; i++) box(0,i*2,0,80-i*15,2,65-i*12);
    for (const x of [-31,31]) { box(x,2,0,3,6,53); frustum(x,8,0,5,3,55,1,51); }
    for (const z of [-25,25]) { box(0,2,z,64,6,3); frustum(0,8,z,66,3,5,62,1); }
    for (const [x,z,h] of [[0,0,26],[-16,-13,18],[16,-13,18],[-16,13,18],[16,13,18]]) {
      box(x,6,z,9,5,9);
      for (let i = 0; i < 7; i++) {
        const w = 10*(1-i/8);
        frustum(x,11+i*h/7,z,w,h/7,w,w*.78,w*.78);
      }
    }
    stairs(0,0,42,7,6,16,12,Math.PI);
  } else if (id === 'qin_mausoleum') {
    // Earthen tumulus and excavated precinct remains; no invented exposed underground palace.
    frustum(0,0,-8,80,24,70,40,32,0,0x8b805b);
    for (const x of [-48,48]) box(x,0,0,2,2,102);
    box(0,0,-50,96,2,2);
    for (const x of [-28,28]) box(x,0,50,40,2,2);
    for (const x of [-9,9]) box(x,0,48,7,5,7);
    // Archaeological pit outlines, not reconstructed terracotta sculptures.
    for (let i = 0; i < 3; i++) house(-26+i*24,0,35,16,14,1);
  } else if (selection.kind==='ruins' && Object.hasOwn(ANCIENT_RUINS,id)) {
    const rnd = mulberry32(seed ^ 0x5255494e);
    if(Object.hasOwn(ACTIVITY_RUINS,id)) ACTIVITY_RUINS[id].build(g,rnd);
    function ruinedWall(x,z,w,h,d,angle = 0) {
      const count = Math.ceil(w/2);
      for (let i = 0; i < count; i++) {
        const offset = (i+.5)*w/count-w/2;
        box(x+offset*Math.cos(angle),0,z+offset*Math.sin(angle),w/count,.5+Math.floor(rnd()*h),d,angle);
      }
    }
    if (id === 'wall') ruinedWall(0,0,28,7,2);
    if (id === 'gate') {
      box(-5,0,0,5,8,5); box(5,0,0,5,7,5); arch(0,4,0,2.5,1,3);
      ruinedWall(-13,0,10,5,2); ruinedWall(13,0,10,5,2);
    }
    if (id === 'bunker') {
      house(0,0,0,12,10,3); box(0,3,0,14,1.5,12);
      ruinedWall(-9,3,5,2,2); box(0,2,5.3,4,.2,.2,0,0x353832);
    }
    if (id === 'castle') {
      for (const x of [-12,12]) for (const z of [-10,10]) { column(x,0,z,3,9); box(x,9,z,6,1,6); }
      ruinedWall(0,-10,24,7,2); ruinedWall(-12,0,20,6,2,Math.PI/2); ruinedWall(12,0,20,6,2,Math.PI/2);
      house(0,0,0,8,9,10); arch(0,4,10,3,1,2);
    }
    if (id === 'temple') {
      box(0,0,0,20,1,25); house(0,1,0,12,16,5);
      for (const x of [-8,8]) for (let i = 0; i < 5; i++) column(x,1,-9+i*4.5,.6,2+rnd()*3);
      frustum(0,6,-3,13,3,10,3,5);
    }
    if (id === 'statue') {
      box(0,0,0,6,1,6); frustum(0,1,0,3,5,2,2,1.5);
      box(0,6,0,1.6,2,1.5); box(-2.1,3,0,1.6,1,1.6);
    }
    if (id === 'village') for (let i = 0; i < 7; i++) house((i%3-1)*9,0,(Math.floor(i/3)-1)*11,5,7,1.5+rnd()*2);
    if (id === 'tomb') {
      box(0,0,0,15,1,19); house(0,1,0,9,12,4); frustum(0,5,0,11,3,14,5,8);
      box(0,1,9,5,1,4);
    }
    if (id === 'quarry') {
      for (let i = 0; i < 4; i++) box(0,i*2,-i*3,30-i*3,2,22-i*4);
      for (let i = 0; i < 12; i++) box((rnd()-.5)*25,0,12+rnd()*6,1+rnd(),1+rnd()*2,1+rnd(),rnd());
    }
    // Scattered fallen masonry establishes abandonment, without distorting surviving components.
    for (let i = 0; i < (options.clearDebris ? 0 : 12); i++) {
      const a = rnd()*Math.PI*2, r = 5+rnd()*10;
      box(Math.cos(a)*r,0,Math.sin(a)*r,.6+rnd()*1.2,.3+rnd()*.5,.8+rnd(),rnd()*Math.PI);
    }
  } else throw new RangeError(`Unknown ancient stone template: ${id}`);
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (const { a,b,c } of g.triangles) for (const p of [a,b,c]) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis],p[axis]); max[axis] = Math.max(max[axis],p[axis]);
  }
  return { triangles: g.triangles, bounds: { min, max, size: max.map((v,i) => v-min[i]) } };
}
