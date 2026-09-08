// Stylized event snapshots. These meshes never settle terrain motion, heat or damage.
export const PHENOMENA = {
  debris_flow: ['土石流', 'unconsolidated', 'debris-flow', [20,80], [4,20], [0,.01], [.12,.3], 0x80664e, '不穩定地質'],
  landslide: ['崩塌地', 'unconsolidated', 'slope-collapse', [20,90], [10,45], [0,.1], [.15,.35], 0x9d8870, '不穩定地質'],
  landslide_lake: ['偃塞湖', 'unconsolidated', 'landslide-dam', [30,100], [8,30], [0,.01], [.08,.2], 0x8a8270, '不穩定地質'],
  slope_creep: ['走山／滑動山體', 'mixed', 'slope-deformation', [25,90], [12,40], [0,.1], [.04,.12], 0x93846d, '不穩定地質'],
  eruption: ['火山噴發', 'igneous', 'active-eruption', [25,80], [12,40], [0,.01], [.05,.15], 0x4c4541, '不穩定地質'],
  badlands: ['惡地', 'sedimentary', 'gully-erosion', [15,70], [6,28], [.01,60], [.04,.12], 0xb69a7c, '特殊地質'],
  geothermal: ['地熱／噴氣孔', 'hydrothermal', 'steam-vent', [8,30], [1,5], [0,.1], [.05,.16], 0xada48a, '特殊地質'],
  mud_volcano: ['泥火山', 'unconsolidated', 'gas-driven-mud-extrusion', [8,35], [2,10], [0,.1], [.02,.1], 0x8a8379, '特殊地質'],
  hot_spring: ['溫泉／礦物沉積池', 'hydrothermal', 'thermal-spring', [8,30], [1,5], [0,.1], [.02,.08], 0xd6c7a3, '特殊地質'],
  fountain: ['天然噴泉／承壓湧泉', 'hydrologic', 'pressurized-spring', [6,20], [.6,3], [0,.01], [.02,.08], 0x9d9c88, '特殊地質'],
  geyser: ['間歇泉', 'hydrothermal', 'geyser-eruption', [6,22], [1,4], [0,.1], [.02,.08], 0xc4b994, '特殊地質'],
  impact_crater: ['隕石坑', 'impact', 'meteorite-impact', [25,100], [5,22], [.001,200], [.08,.2], 0x958679, '特殊地質'],
};

export function phenomenaWeights(e) {
  const slope=e.slope/90, trigger=Math.max(e.rainfall,e.fault,e.instability);
  const movement=slope*trigger, river=['stream','river'].includes(e.water);
  if(e.depth>0) return {};
  return {
    debris_flow:movement*e.rainfall*e.sediment*3,
    landslide:movement*2, landslide_lake:river?movement*1.5:0,
    slope_creep:slope*e.instability*2, eruption:e.volcanic*e.activity,
    badlands:(1-e.vegetation)*e.sediment*(.2+e.exposure),
    geothermal:e.geothermal*(1-e.moisture),
    mud_volcano:e.gasPressure*e.sediment,
    hot_spring:e.geothermal*e.moisture,
    fountain:e.springPressure*e.moisture,
    geyser:e.geothermal*e.springPressure*e.moisture,
    impact_crater:e.impact,
  };
}

const bump=(v,center,span)=>Math.exp(-(((v-center)/span)**2));
export function phenomenaProfile(type,x,z,p) {
  const r=Math.hypot(x,z), env=Math.max(0,1-r*r), vent=p.ventRadius;
  if(type==='debris_flow') {
    const path=x-.12*Math.sin(z*5), fan=.15+(z+1)*.22;
    return env*(.12+.55*(1-z)/2)*bump(path,0,fan)
      +env*.12*bump(Math.abs(path),fan,.07);
  }
  if(type==='landslide') return env*(.15+.8*bump(z,-.5,.28)*(Math.abs(x)>.35?1:.35)
    +.35*bump(z,.4,.3)*bump(x,0,.65));
  if(type==='landslide_lake') {
    if(Math.abs(x)<.36 && z>-.65 && z<.1) return .2;
    return env*(.12+.75*bump(Math.abs(x),.65,.23)+.48*bump(z,.32,.16));
  }
  if(type==='slope_creep') {
    const bench=Math.floor((1-z)*3)/6;
    const crack=bump(Math.sin(z*12+x*2),0,.12);
    return env*(.18+.65*bench)*(1-.65*crack);
  }
  if(type==='badlands') return env*(.2+.65*Math.abs(Math.sin(x*14+Math.sin(z*6)))**.7)*(.6+.4*(1-z)/2);
  if(type==='impact_crater') return env*(.09+.85*bump(r,.62,.14)+.12*bump(r,0,.1));
  if(type==='eruption') return env*(.18+.8*bump(r,vent+.16,.2));
  if(type==='mud_volcano') return r<vent?.65:env*.95*Math.exp(-r*.8);
  if(['hot_spring','fountain','geyser'].includes(type)) {
    if(r<.48) return .18;
    return env*(.2+.38*bump(r,.56,.09)+.15*Math.floor(r*8)/8);
  }
  if(type==='geothermal') return env*(.12+.32*bump(r,.26,.15)+.14*Math.abs(Math.sin(x*9)*Math.cos(z*8)));
  return null;
}

// Feature materials are spatially constrained; hot vents and water cannot grow grass.
export function phenomenaSurface(type,x,z,p) {
  const r=Math.hypot(x,z);
  if(type==='landslide_lake' && Math.abs(x)<.36 && z>-.65 && z<.1) return 'water';
  if(['hot_spring','fountain','geyser'].includes(type)) {
    if(r<.48) return 'water';
    if(r<.7) return 'mineral';
  }
  if(type==='eruption') {
    if(r<p.ventRadius || (z>0 && Math.abs(x-.1*Math.sin(z*8))<p.channelWidth*.45 && r<.92)) return p.activity>0?'lava':'ash';
    if(r<.85) return 'ash';
  }
  if(type==='mud_volcano' && (r<p.ventRadius || (z>0 && Math.abs(x)<p.channelWidth))) return 'mud';
  if(type==='geothermal' && r<.72) return 'mineral';
  if(type==='debris_flow' && Math.abs(x-.12*Math.sin(z*5))<.15+(z+1)*.22 && r<.9) return 'mud';
  if(type==='landslide' && Math.abs(x)<.4 && r<.8) return 'bare';
  return null;
}

// Local coordinates in metres; closed faceted columns are a static plume/jet snapshot.
export function phenomenaEffects(type,p,terrainHeight,rnd) {
  const effects=[];
  if(p.activity<=0) return effects;
  const add=(kind,x,z,height,radius,color)=>effects.push({kind,x,z,y:terrainHeight(x,z),height,radius,color});
  if(type==='eruption') {
    add('ash-plume',0,0,p.height*(2+p.jetHeight)*p.activity,p.width*.04,0xa3a6a5);
    for(let i=0;i<5;i++) {
      const a=i/5*Math.PI*2;
      add('lava-spatter',Math.cos(a)*p.width*.055,Math.sin(a)*p.width*.055,p.height*(.9+rnd()*.5)*p.activity,p.width*.012,0xff7330);
    }
  }
  if(['geothermal','hot_spring','geyser'].includes(type)) {
    for(let i=0;i<3;i++) add('steam',(i-1)*p.width*.16,0,p.width*(.08+rnd()*.1)*p.activity,p.width*.025,0xc1c9c7);
  }
  if(['fountain','geyser'].includes(type)) add('water-jet',0,0,p.width*p.jetHeight*p.activity,p.width*.018,0x90d9df);
  if(type==='mud_volcano') add('mud-spatter',0,0,p.height*.4*p.activity,p.width*.025,0x726b61);
  return effects;
}
