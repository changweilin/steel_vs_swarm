// Metres, years, knots; displacement is metric tonnes, never GT or DWT.
import { mulberry32 } from './rng.js';
import { planVesselLayout } from './vesselLayout.js';

export const VESSEL_MATERIALS = {steel:'船用鋼',wood:'木材',composite:'纖維複合材',rubber:'充氣橡膠／織物',aluminium:'鋁合金'};

export const VESSEL_AXES = {
  purpose: { fishing: '漁業', industry: '工業', transport: '運輸', private: '私人', tourism: '觀光', science: '科學', military: '軍事', sport: '運動競技', rescue: '救援', heritage: '歷史文化' },
  waters: { lake: '湖泊', river: '河川', inlandSea: '內海', ocean: '遠洋', coastal: '淺海', seabed: '海底', ice: '冰區' },
  power: { human: '人力', animal: '岸上畜力拖曳', wind: '風帆', steam: '蒸氣', diesel: '柴油', petrol: '汽油', nuclear: '核動力', electric: '電池電力', hybrid: '柴油電力混合', tow: '拖船牽引' },
};

// Each archetype owns its compatible axes, proportions and equipment.
// Ranges are broad game-design envelopes, not certified naval specifications.
const rows = [
  ['skiff','沿岸漁艇','fishing','lake river coastal','human petrol', [4,10],[3,4],[0.035,0.06],[0,35],[2,12], 'nets', 'wood'],
  ['trawler','拖網漁船','fishing','coastal inlandSea ocean','diesel', [18,65],[3,4.5],[0.06,0.09],[0,45],[6,14], 'nets crane', 'steel'],
  ['tug','港勤拖船','industry','river inlandSea coastal','diesel hybrid', [15,35],[2.5,3.5],[0.09,0.13],[0,45],[5,13], 'fenders tow', 'steel'],
  ['dredger','疏浚工程船','industry','river coastal','diesel', [25,90],[3,5],[0.035,0.065],[0,50],[3,10], 'crane pipe', 'steel'],
  ['barge','平底駁船','transport','river lake inlandSea','tow', [20,95],[3,6],[0.025,0.045],[0,50],[2,7], 'cargo', 'steel'],
  ['container','貨櫃輪','transport','inlandSea ocean','diesel', [65,300],[5,7],[0.04,0.06],[0,35],[12,24], 'containers', 'steel'],
  ['tanker','液貨輪','transport','inlandSea ocean','diesel', [70,280],[5,6.5],[0.045,0.065],[0,35],[10,17], 'tanks pipe', 'steel'],
  ['ferry','渡輪','transport','lake river inlandSea coastal','diesel electric hybrid', [12,70],[3,5],[0.035,0.065],[0,40],[7,22], 'passengers', 'steel'],
  ['yacht','私人遊艇','private','lake coastal inlandSea','petrol diesel', [8,35],[3,4.5],[0.04,0.065],[0,35],[8,28], 'lounge', 'composite'],
  ['sloop','單桅帆船','private','lake coastal ocean','wind', [6,22],[3,4.5],[0.08,0.14],[0,50],[3,10], 'sail', 'composite'],
  ['excursion','觀光遊船','tourism','lake river inlandSea coastal','electric diesel', [12,50],[3,4.5],[0.035,0.06],[0,40],[5,15], 'passengers canopy', 'steel'],
  ['liner','遠洋郵輪','tourism','ocean inlandSea','diesel hybrid', [100,320],[5,7],[0.03,0.045],[0,40],[14,23], 'passengers lifeboats', 'steel'],
  ['research','海洋調查船','science','coastal ocean','diesel hybrid', [25,85],[3.8,5.5],[0.055,0.085],[0,45],[7,15], 'crane radar lab', 'steel'],
  ['submersible','海底研究潛器','science','seabed','electric', [3,9],[1.8,3],[0.1,0.16],[0,25],[1,4], 'sub lamp manipulator', 'steel'],
  ['patrol','巡邏艇','military','river coastal inlandSea','diesel', [12,45],[3.5,5],[0.045,0.075],[0,35],[12,32], 'radar gun', 'steel'],
  ['frigate','巡防艦','military','ocean inlandSea','diesel hybrid', [85,150],[7,9],[0.035,0.05],[0,40],[15,30], 'radar gun helipad', 'steel'],
  ['submarine','核動力潛艦','military','ocean seabed','nuclear', [75,150],[8,11],[0.05,0.075],[0,40],[8,25], 'sub tower', 'steel'],
  ['kayak','競技獨木舟','sport','lake river coastal','human', [3,6],[6,9],[0.025,0.04],[0,15],[2,7], 'oars', 'composite'],
  ['racing','競速快艇','sport','lake coastal inlandSea','petrol', [5,13],[3,5],[0.03,0.05],[0,20],[20,55], 'racing', 'composite'],
  ['rescue','全天候救援艇','rescue','coastal inlandSea','diesel', [10,20],[3,4],[0.045,0.07],[0,30],[12,28], 'radar', 'composite'],
  ['paddlesteamer','明輪蒸汽遊船','heritage','lake river','steam', [18,65],[4,6],[0.025,0.04],[10,110],[4,10], 'passengers paddle', 'wood'],
  ['towboat','畜力運河船','heritage','river','animal', [8,22],[4,7],[0.025,0.04],[5,80],[1,3], 'tow cargo', 'wood'],
  ['junk','傳統帆船','heritage','coastal inlandSea','wind', [12,35],[3,4],[0.045,0.07],[5,90],[3,9], 'sail cargo', 'wood'],
  ['icebreaker','極地破冰船','science','ice ocean','diesel nuclear', [70,160],[4,5],[0.055,0.08],[0,50],[5,18], 'radar lab', 'steel'],
  ['inflatable','充氣救生艇','rescue','lake river coastal','petrol',[4,6],[2.2,2.8],[0.025,0.04],[0,12],[8,22],'outboard','rubber'],
  ['rib','硬底充氣救援艇','rescue','coastal inlandSea','petrol',[6,10],[2.8,3.5],[0.035,0.05],[0,20],[15,35],'outboard','rubber'],
  ['lifeboat','封閉式逃生艇','rescue','coastal ocean','diesel',[6,12],[2.5,3.4],[0.04,0.06],[0,25],[4,8],'enclosed','composite'],
  ['canoe','開放式獨木舟','private','lake river','human',[3.5,6],[4.5,6.5],[0.025,0.04],[0,35],[2,5],'oars','wood'],
  ['rowboat','鋁製划艇','private','lake river','human',[3,5],[2.5,3.5],[0.025,0.045],[0,30],[2,5],'oars','aluminium'],
  ['lng','球罐 LNG 運輸船','transport','ocean inlandSea','diesel hybrid',[180,300],[5,6.5],[0.035,0.055],[0,35],[12,20],'gas','steel'],
  ['lng_membrane','薄膜式 LNG 運輸船','transport','ocean inlandSea','diesel hybrid',[180,300],[5,6.5],[0.035,0.055],[0,35],[12,20],'gas','steel'],
  ['bulk','散裝貨輪','transport','ocean inlandSea','diesel',[80,280],[5,7],[0.04,0.065],[0,35],[10,16],'bulk','steel'],
  ['general_cargo','雜貨船','transport','coastal ocean','diesel',[35,150],[4,6],[0.035,0.06],[0,40],[8,17],'cargo','steel'],
  ['roro','滾裝貨輪','transport','coastal ocean','diesel',[80,220],[4.5,6],[0.035,0.055],[0,35],[12,22],'vehicles','steel'],
  ['cable','海底電纜船','industry','ocean coastal','diesel hybrid',[60,140],[4,6],[0.045,0.065],[0,40],[8,16],'cable','steel'],
  ['corvette','護衛艦','military','coastal inlandSea ocean','diesel',[55,100],[6,8],[0.035,0.055],[0,35],[15,28],'radar helipad','steel'],
  ['destroyer','飛彈驅逐艦','military','ocean inlandSea','diesel hybrid',[140,190],[7,9],[0.035,0.05],[0,40],[16,32],'radar helipad','steel'],
  ['cruiser','飛彈巡洋艦','military','ocean','diesel',[170,230],[7,9],[0.035,0.05],[0,40],[16,32],'radar helipad','steel'],
  ['carrier','大型航空母艦','military','ocean','nuclear',[260,330],[6.5,8],[0.03,0.045],[0,50],[18,30],'radar flightdeck','steel'],
  ['light_carrier','輕型航空母艦','military','ocean inlandSea','diesel hybrid',[170,250],[6,8],[0.03,0.045],[0,40],[15,28],'radar flightdeck','steel'],
  ['amphibious','兩棲突擊艦','military','ocean coastal','diesel',[160,250],[5.5,7],[0.03,0.045],[0,40],[12,24],'radar flightdeck','steel'],
  ['missile_boat','飛彈快艇','military','coastal inlandSea','diesel',[30,55],[5,7],[0.035,0.055],[0,30],[18,36],'radar','aluminium'],
  ['minesweeper','獵雷艦','military','coastal inlandSea','diesel',[35,65],[5,7],[0.04,0.06],[0,35],[8,16],'radar','composite'],
];
const displacement = (length,beam,draft,coefficient) => length*beam*draft*coefficient*1.025;
export const VESSEL_TYPES = rows.map(([id,name,purpose,waters,power,length,slenderness,draftRatio,age,speed,parts,material]) => {
  const coefficient = parts.split(' ').includes('sub') ? 0.65
    : ['skiff','kayak','sloop','junk','racing'].includes(id) ? 0.2
    : ['barge','towboat'].includes(id) ? 0.8
    : ['container','tanker'].includes(id) ? 0.7 : 0.48;
  return {
    id,name,purpose,waters:waters.split(' '),power:power.split(' '),length,slenderness,draftRatio,age,speed,parts:parts.split(' '),material,coefficient,
    displacementRange:[
      displacement(length[0],length[0]/slenderness[1],length[0]*draftRatio[0],coefficient),
      displacement(length[1],length[1]/slenderness[0],length[1]*draftRatio[1],coefficient),
    ],
  };
});
const palettes = {
  steel: [0x254c65,0x38796f,0xa64232,0xd7d9cc,0xd29d38],
  wood: [0x79503b,0xa77949,0x466e70,0x843f32],
  composite: [0xf2eee0,0x248ca3,0xdd493a,0xedbd34],
  rubber: [0xe76f21,0xe99a26,0x313b40],
  aluminium: [0xaebfc1,0x889eaa,0xd1d7cd],
};
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const range = (r, [a,b]) => a + r() * (b-a);

export function generateVessel(seed, filters = {}) {
  if (!Number.isFinite(seed)) throw new TypeError('Vessel seed must be finite');
  const r = mulberry32((seed ^ 0x53a971b7) >>> 0);
  const choices = VESSEL_TYPES.filter(t => (!filters.id || t.id === filters.id)
    && (!filters.purpose || t.purpose === filters.purpose)
    && (!filters.water || t.waters.includes(filters.water))
    && (!filters.power || t.power.includes(filters.power))
    && (!filters.maxLength || t.length[1] <= filters.maxLength)
    && (!filters.selfPropelled || !t.power.every(p => ['animal','tow'].includes(p)))
    && (!filters.surface || !t.parts.includes('sub')));
  if (!choices.length) return null;
  const t = pick(r, choices), length = range(r,t.length), beam = length / range(r,t.slenderness);
  const draft = length * range(r,t.draftRatio), age = Math.floor(range(r,t.age));
  const power = filters.power || pick(r,t.power);
  const wear = Math.min(0.85, age / 100 + r() * 0.2);
  const parts = [...t.parts];
  if (length > 10 && !parts.includes('sub') && r() < 0.45 && !parts.includes('fenders')) parts.push('fenders');
  if (t.purpose === 'private' && power !== 'wind' && r() < 0.5) parts.push('radar');
  const vessel = {
    type:t.id, name:t.name, purpose:t.purpose, waters:[...t.waters], power, material:t.material,
    length, beam, draft, freeboard: Math.max(0.18, beam * 0.22),
    displacementTonnes: displacement(length,beam,draft,t.coefficient),
    age, wear, speedKnots:Math.min(range(r,t.speed),power==='human'?7:power==='animal'?3:Infinity), parts,
    hullColor:t.purpose === 'military' ? pick(r,[0x68777a,0x505f63,0x384950]) : pick(r,palettes[t.material]),
    trimColor:pick(r,[0xeee7d2,0xf4ab32,0x3b7d97]),
    flag:{ kind:'fictional', pattern:pick(r,['bands','cross','diagonal']), colors:[pick(r,[0xdf4936,0x287596,0xe8b844]),0xf4eee0] },
    registry:`SV-${Math.floor(r()*90000+10000)}`,
    vesselName:pick(r,['AURORA','TIDEBIRD','HORIZON','CORAL','NORTH STAR','BLUE FIN']),
    graffiti: t.purpose !== 'military' && r() < 0.3 ? pick(r,['SEA YOU','KEEP SAILING','WAVE RIDER']) : '',
    decorationSeed:Math.floor(r()*0xffffffff),
  };
  vessel.layout = planVesselLayout(vessel);
  return vessel;
}

// Conservative swept circle: checks water, under-keel clearance and map bounds.
export function vesselFitsAt(v, terrain, x, z, isWater) {
  const radius = Math.hypot(v.length / 2, Math.max(v.beam,v.layout?.deckWidth??v.beam) / 2) + 1;
  const needed = v.draft + (v.parts.includes('sub') ? v.beam * 1.1 + 2.5 : 0.5);
  for (let ring = 0; ring <= 2; ring++) {
    const n = ring ? Math.max(16, Math.ceil(2 * Math.PI * radius * ring / 2 / 3)) : 1;
    for (let i = 0; i < n; i++) {
      const a = i/n*Math.PI*2, px=x+Math.cos(a)*radius*ring/2, pz=z+Math.sin(a)*radius*ring/2;
      if (px < terrain.minX || px > terrain.maxX || pz < terrain.minZ || pz > terrain.maxZ) return false;
      const depth = terrain.waterY-terrain.heightAt(px,pz);
      if (!Number.isFinite(depth) || depth < needed || !isWater(px,pz)) return false;
    }
  }
  return true;
}
