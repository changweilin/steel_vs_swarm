import { loftMeshData, hullRing, vesselHullSections } from './vesselGeometry.js';
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { toonMat, toonPlain } from './toon.js';
import { buildVesselEquipment } from './vesselEquipmentModels.js';

export function buildShipWakeGroup() {
  const g = new THREE.Group();
  g.name = 'ship_wake';

  const foamMat = toonPlain({
    color: 0xf0f8ff,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const washMat = toonPlain({
    color: 0xffffff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // 1. 船尾開展 V 型尾浪 (Kelvin Wake - Expanding V-Shape Wings)
  // 由船尾 z = -5.8 (寬 3.2m) 展開至 z = -24.0 (寬 10.5m)
  const wakeGeo = new THREE.BufferGeometry();
  const wakeVertices = new Float32Array([
    // 左翼展開面
    -1.6, -0.05, -5.8,
    -5.2, -0.05, -24.0,
     0.0, -0.05, -5.8,

     0.0, -0.05, -5.8,
    -5.2, -0.05, -24.0,
     0.0, -0.05, -24.0,

    // 右翼展開面
     0.0, -0.05, -5.8,
     5.2, -0.05, -24.0,
     1.6, -0.05, -5.8,

     0.0, -0.05, -5.8,
     0.0, -0.05, -24.0,
     5.2, -0.05, -24.0,
  ]);
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(wakeVertices, 3));
  wakeGeo.computeVertexNormals();
  const vWake = new THREE.Mesh(wakeGeo, foamMat);
  g.add(vWake);

  // 2. 螺旋槳中心高密度白沫浪湧帶 (Propeller Wash Strip)
  const washGeo = new THREE.PlaneGeometry(2.4, 12.0);
  washGeo.rotateX(-Math.PI / 2);
  washGeo.translate(0, -0.03, -12.0); // 從 z = -6.0 延伸至 -18.0
  const washMesh = new THREE.Mesh(washGeo, washMat);
  g.add(washMesh);

  // 3. 船首劈波浪花 (Bow Spray Flairs)
  const bowGeo = new THREE.BufferGeometry();
  const bowVertices = new Float32Array([
    // 左舷破浪
    -0.2, -0.02,  6.8,
    -2.2, -0.02,  3.5,
    -0.8, -0.02,  3.5,

    // 右舷破浪
     0.2, -0.02,  6.8,
     0.8, -0.02,  3.5,
     2.2, -0.02,  3.5,
  ]);
  bowGeo.setAttribute('position', new THREE.BufferAttribute(bowVertices, 3));
  bowGeo.computeVertexNormals();
  const bowSpray = new THREE.Mesh(bowGeo, washMat);
  g.add(bowSpray);

  return g;
}

// Closed equal-size cross-sections; shared rings keep the bow watertight.
export function loftGeometry(sections) {
  const { vertices: pos, faces: idx } = loftMeshData(sections);
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  indexed.setIndex(idx);
  const geo = indexed.toNonIndexed();
  indexed.dispose();
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export { hullRing } from './vesselGeometry.js';

/** Catalog geometry and load plan use the same metre-space envelopes. */
export function buildGeneratedVesselMesh(v, { wake = true } = {}) {
  if (!v?.layout || ![v.length,v.beam,v.draft].every(n=>Number.isFinite(n)&&n>0)) throw new TypeError('Invalid vessel dimensions or layout');
  const g=new THREE.Group();g.name='vessel_'+v.type;g.userData.vessel=v;
  const r=mulberry32(v.decorationSeed), L=v.length, B=v.beam, D=v.draft, F=v.freeboard;
  const layout=v.layout, hull=layout.hull, sub=hull==='sub';
  const open=['kayak','canoe','open','inflatable','rib'].includes(hull);
  const soft=['rubber','composite'].includes(v.material);
  const hullMat=toonMat(new THREE.Color(v.hullColor).lerp(new THREE.Color(0xa5a495),v.wear*0.2),{celMetal:!soft&&v.material!=='wood',rim:0.08});
  const trim=toonMat(v.purpose==='rescue'?0xf07c23:v.trimColor), dark=toonMat(0x24343c), light=toonMat(0xe6e6d8), glass=toonMat(0x173e50);
  const deck=toonMat(v.material==='wood'?0xa88053:v.purpose==='military'?0x59686c:0x899395);
  const orange=toonMat(0xc8843b), cargo=[0xa84334,0x397982,0xd7d8c7,0x4b6374].map(c=>toonMat(c));
  const materials={metal:hullMat,dark,light,orange,glass,cargo};
  const add=(name,geo,mat,x=0,y=0,z=0)=>{const m=new THREE.Mesh(geo,mat);m.name=name;m.position.set(x,y,z);g.add(m);return m;};
  const box=(name,w,h,d,x,y,z,mat=trim)=>add(name,new THREE.BoxGeometry(w,h,d),mat,x,y,z);
  const pole=(name,h,x,y,z,rad=B*0.015,mat=trim)=>add(name,new THREE.CylinderGeometry(rad,rad,h,8),mat,x,y+h/2,z);
  const ellipsoid=(name,w,h,d,x,y,z,mat=hullMat)=>{const m=add(name,new THREE.SphereGeometry(1,16,8),mat,x,y,z);m.scale.set(w/2,h/2,d/2);return m;};
  function shellRing(w,y,d) {
    if(hull==='inflatable'||hull==='rib')y*=0.15;
    const wall=Math.min(B*0.035,0.12);
    return [[-w,y],[-w*0.8,-d*0.65],[0,-d],[w*0.8,-d*0.65],[w,y],
      [Math.max(0,w-wall),y],[w*0.7,-d*0.55],[0,-d+wall],[-w*0.7,-d*0.55],[-Math.max(0,w-wall),y]];
  }
  if(sub) {
    ellipsoid('pressure_hull',B,B,L,0,-D+B*0.4,0);
    box('dive_planes',B*1.35,B*0.055,L*0.1,0,-D+B*0.4,-L*0.3,hullMat);
    if(layout.cabinStyle==='sail') {
      ellipsoid('submarine_sail',B*0.3,B*0.75,L*0.15,0,-D+B*1.02,-L*0.06);
      pole('periscope',B*0.3,0,-D+B*1.37,-L*0.06,B*0.015,dark);
    } else {
      ellipsoid('observation_dome',B*0.62,B*0.62,B*0.38,0,-D+B*0.4,L*0.46,glass);
      box('sample_arm',B*0.08,B*0.08,L*0.23,B*0.4,-D,L*0.35);
      box('sample_arm_mount',B*0.08,B*0.4,B*0.08,B*0.4,-D+B*0.18,L*0.25);
    }
  } else {
    const fine=['kayak','canoe','sail'].includes(hull), flat=hull==='barge';
    const ring=(w,y,d)=>open?shellRing(w,y,d):flat?[[-w,y],[-w,-d],[w,-d],[w,y]]:hullRing(w,hull==='carrier'?y-B*0.04:y,-d*0.65,-d);
    add('hull',loftGeometry(vesselHullSections(v,ring,fine,flat)),hullMat);
    if(open) {
      box('recessed_floor',B*0.55,B*0.025,L*0.57,0,layout.deckY-B*0.0125,0,hull==='kayak'?dark:deck);
      if(hull==='kayak') {
        // Sealed fore/aft decks leave a real open cockpit, not a painted black oval.
        for(const [z0,z1,z2,w0,w1,w2] of [[-0.49,-0.31,-0.1,0.015,0.47,0.45],[0.1,0.3,0.49,0.45,0.42,0.015]]) {
          add('sealed_deck',loftGeometry([[z0,w0],[z1,w1],[z2,w2]].map(([z,w])=>({z:L*z,ring:[[0,F-B*0.025],[B*w,F],[0,F+B*0.09],[-B*w,F]]}))),hullMat);
        }
        const rim=add('cockpit_coaming',new THREE.TorusGeometry(1,0.07,6,24),dark,0,F+B*0.025,0);rim.rotation.x=Math.PI/2;rim.scale.set(B*0.31,L*0.105,B*0.15);
        box('seat',B*0.45,B*0.055,L*0.06,0,layout.deckY+B*0.0275,-L*0.01,dark);
        box('seat_back',B*0.38,B*0.18,L*0.025,0,layout.deckY+B*0.12,-L*0.045,dark);
      } else if(hull==='inflatable'||hull==='rib') {
        for(const side of [-1,1]) {
          ellipsoid('inflatable_tube',B*0.25,B*0.25,L*0.8,side*B*0.38,F*0.7,-L*0.025,trim);
          for(let j=0;j<4;j++)box('tube_grab_handle',B*0.09,B*0.025,L*0.03,side*B*0.38,F*0.7+B*0.13,L*(-0.28+j*0.16),dark);
        }
        ellipsoid('bow_float',B*0.8,B*0.24,L*0.14,0,F*0.7,L*0.34,trim);
        box('jockey_seat',B*0.2,B*0.18,L*0.17,0,layout.deckY+B*0.09,-L*0.12,dark);
      } else {
        for(const z of [-0.19,0.17])box('thwart',B*0.81,B*0.045,L*0.055,0,F*0.72,L*z,deck);
        for(const z of [-0.28,-0.06,0.16])for(const side of [-1,1])box('hull_rib',B*0.04,F+D*0.4,L*0.015,side*B*0.4,F*0.3,L*z,deck);
      }
    } else if(hull==='carrier') {
      add('flight_deck',loftGeometry([[-0.475,-0.5,0.55],[-0.39,-0.725,0.725],[0.39,-0.725,0.725],[0.475,-0.45,0.57]].map(([z,left,right])=>({z:z*L,ring:[[left*B,F],[left*B,F-B*0.025],[right*B,F-B*0.025],[right*B,F]]}))),deck);
    }
    // Profile-specific, raked and stepped superstructures; no stacked building boxes.
    for(const c of layout.cabins) {
      if(c.style==='capsule') {
        ellipsoid('enclosed_survival_capsule',c.w,c.h*2,c.d,c.x,c.y,c.z,trim);
        ellipsoid('survival_windows',c.w*0.74,c.h*0.9,c.d*0.78,c.x,c.y+c.h*0.38,c.z,glass);
        ellipsoid('survival_roof',c.w*0.73,c.h*0.8,c.d*0.75,c.x,c.y+c.h*0.58,c.z,trim);
        continue;
      }
      const floors=c.levels, levelH=c.h/floors;
      for(let floor=0;floor<floors;floor++) {
        const w=c.w*(1-floor*0.055),d=c.d*(1-floor*0.045),y=c.y+floor*levelH;
        const stations=[[-0.5,0.9],[-0.26,1],[0.3,0.94],[0.5,0.65]];
        const shape=(bottom,top,offset=0)=>stations.map(([z,f])=>({z:c.z+z*d,ring:[
          [c.x-w*f*(0.5-0.12*bottom)-offset,y+levelH*bottom],
          [c.x-w*f*(0.5-0.12*top)-offset,y+levelH*top],
          [c.x+w*f*(0.5-0.12*top)+offset,y+levelH*top],
          [c.x+w*f*(0.5-0.12*bottom)+offset,y+levelH*bottom],
        ].reverse()}));
        add('raked_'+c.style,loftGeometry(shape(0,1)),['combat','island','roro'].includes(c.style)?hullMat:c.style==='wood'?deck:c.style==='rescue'?trim:light);
        const military=c.style==='combat'||c.style==='island';
        const panoramic=['yacht','passenger','liner','coachroof','console','rescue','cockpit'].includes(c.style);
        if(c.style==='wood'||c.style==='heritage') {
          box('traditional_bridge_window',w*0.27,levelH*0.24,0.025,c.x,y+levelH*0.64,c.z+d*0.5+0.012,glass);
        } else if(panoramic||floor===floors-1)add('wraparound_glazing',loftGeometry(shape(0.62,0.77,0.008)),glass);
        // Roof overhangs only within the reserved cabin footprint.
        box('cabin_roof',w*0.69,B*0.012,d*0.76,c.x,y+levelH,c.z,military?hullMat:c.style==='wood'?deck:light);
      }
    }
    for(const area of layout.reserved) {
      if(area.name==='runway') {
        box('landing_strip',area.w,B*0.004,area.d,area.x,F+B*0.01,area.z,dark);
        for(const side of [-1,1])box('flightdeck_edge_line',B*0.009,B*0.005,area.d*0.94,area.x+side*area.w*0.43,F+B*0.014,0,light);
        for(let j=0;j<12;j++)box('runway_centerline',B*0.012,B*0.005,L*0.025,area.x,F+B*0.014,L*(-0.4+j*0.07),light);
        for(let j=0;j<3;j++)box('arresting_wire',area.w*0.92,B*0.005,L*0.003,area.x,F+B*0.02,L*(-0.25+j*0.03),light);
      }
      if(area.name==='helipad') {
        box('helipad',area.w,B*0.005,area.d,0,F+B*0.012,area.z,dark);
        for(const x of [-B*0.12,B*0.12])box('helipad_H',B*0.018,B*0.006,area.d*0.5,x,F+B*0.018,area.z,light);
        box('helipad_H',B*0.25,B*0.006,L*0.009,0,F+B*0.018,area.z,light);
      }
    }
    if(v.power==='wind') {
      const mastZ=L*0.1, mastH=L*(v.type==='junk'?0.5:0.7);
      pole('mast',mastH,0,F,mastZ,B*0.018,deck);
      const sail=new THREE.BufferGeometry();sail.setAttribute('position',new THREE.Float32BufferAttribute([0,F+mastH*0.12,mastZ,0,F+mastH,mastZ,0,F+mastH*0.12,mastZ+L*0.34],3));sail.computeVertexNormals();
      add('sail',sail,toonMat(v.trimColor,{side:THREE.DoubleSide}));
      box('boom',B*0.03,B*0.03,L*0.34,0,F+mastH*0.12,mastZ+L*0.17,deck);
    }
    if(v.power==='human') {
      const paddle=box('paddle_shaft',B*1.5,B*0.025,B*0.035,0,F+B*0.08,-L*0.13,deck);
      for(const side of hull==='kayak'?[-1,1]:[1])box('paddle_blade',B*0.25,B*0.035,B*0.13,side*B*0.65,paddle.position.y,-L*0.13,dark);
    }
    if(['inflatable','rib'].includes(hull)||(v.type==='skiff'&&v.power==='petrol')) {
      box('outboard_cowling',B*0.19,B*0.27,L*0.07,0,F+B*0.09,-L*0.43,dark);
      box('outboard_leg',B*0.065,D+B*0.2,L*0.025,0,-D*0.35,-L*0.44,dark);
    }
    if(v.power==='steam') {
      const c=layout.cabins[0];pole('funnel',B*0.48,0,c.y+c.h,0,B*0.065,dark);
      for(const side of [-1,1]) {
        const wheel=add('paddle_wheel',new THREE.CylinderGeometry(B*0.26,B*0.26,B*0.13,12),orange,side*B*0.5,F,0);wheel.rotation.z=Math.PI/2;
      }
    }
    if(v.type==='roro')box('stern_loading_ramp',B*0.5,B*0.04,L*0.08,0,F,-L*0.45,dark);
    if(layout.mission==='oil')for(const x of [-B*0.35,B*0.35])box('oil_deck_pipeline',B*0.015,B*0.015,L*0.52,x,F+B*0.03,L*0.04,light);
    if(layout.mission==='lng'||layout.mission==='membrane')box('gas_service_walkway',B*0.035,B*0.025,L*0.54,-B*0.405,F+B*0.04,L*0.04,light);
    if(v.parts.includes('fenders')&&L>10&&!['carrier','speed'].includes(hull))for(const side of [-1,1])for(let j=0;j<3;j++)
      add('fender',new THREE.TorusGeometry(B*0.04,B*0.015,5,10),dark,side*B*0.5,F*0.6,L*(-0.2+j*0.18)).rotation.y=Math.PI/2;
    if(!open&&hull!=='capsule') {
      const flagY=F+B*0.3;pole('flagpole',B*0.5,0,F,-L*0.46,B*0.009);
      const flagBase=toonMat(v.flag.colors[0]), flagInk=toonMat(v.flag.colors[1]);
      box('flag',B*0.2,B*0.11,B*0.005,B*0.1,flagY,-L*0.46,flagBase);
      const stripe=box('flag_stripe',B*0.2,B*0.03,B*0.007,B*0.1,flagY,-L*0.46,flagInk);
      if(v.flag.pattern==='cross')box('flag_cross',B*0.025,B*0.11,B*0.008,B*0.07,flagY,-L*0.46,flagInk);
      if(v.flag.pattern==='diagonal'){stripe.scale.x=0.87;stripe.rotation.z=0.4;}
    }
    if(!open&&v.material==='steel')for(let j=0;j<Math.floor(v.wear*8);j++)for(const side of [-1,1])
      box('paint_wear',B*0.006,F*(0.1+r()*0.2),L*0.007,side*B*0.501,F*0.6,L*(-0.22+r()*0.4),orange);
  }
  for(const item of layout.equipment)g.add(buildVesselEquipment(item,materials));
  if(typeof document!=='undefined'&&!open) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');
    if(ctx) {
      ctx.fillStyle='#f4eee0';ctx.font='bold 36px sans-serif';ctx.textAlign='center';ctx.fillText(v.vesselName+' '+v.registry,256,46);
      ctx.font='italic 30px sans-serif';ctx.fillText(v.graffiti,256,95);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const mat=toonPlain({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide});mat.addEventListener('dispose',()=>texture.dispose());
      for(const side of [-1,1]) {const label=add('hull_lettering',new THREE.PlaneGeometry(L*0.34,F*0.65),mat,side*B*0.505,F*0.55,0);label.rotation.y=side*Math.PI/2;}
    }
  }
  if(wake&&!sub) {const animated=new THREE.Group(),foam=buildShipWakeGroup();foam.scale.set(B/3.6,1,L/13);animated.add(foam);g.add(animated);g.userData.wake=animated;}
  // Unused palette entries have never reached the GPU; dispose their material objects too.
  const used=new Set();g.traverse(o=>{if(o.material)used.add(o.material);});
  for(const m of [hullMat,trim,dark,light,glass,deck,orange,...cargo])if(!used.has(m))m.dispose();
  return g;
}
