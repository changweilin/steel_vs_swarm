import { INDUSTRY_PART_NAMES } from './vehicleIndustry.js';

/** 工作設備共用幾何語彙，尺寸取自母車的載貨平台，不另做一套底盤。 */
export function buildIndustryEquipment(part, v, {box,cyl,beam,frustum}) {
  if (!Object.hasOwn(INDUSTRY_PART_NAMES,part)) return false;
  const {length:L,width:W,height:H,fadedPaint:paint}=v;
  const trailer=['railWagon','semiTrailer'].includes(v.form);
  const x=trailer?0:-L*.16, span=L*(trailer?.83:.57), floor=H*.34;
  const dark=0x28313a,steel=0x97a3a5,light=0xe2e3d7;
  const enclosure=(name,color=paint)=>box(name,x,floor+H*.27,0,span,H*.54,W*.87,color);
  const railings=()=>{for(const side of [-1,1])box('bed_side',x,floor+H*.13,side*W*.43,span,H*.26,W*.045);};
  const hopper=(closed=false)=>{
    box('hopper_floor',x,floor,0,span,H*.08,W*.78,dark);
    for(const side of [-1,1])box('sloped_hopper',x,floor+H*.2,side*W*.32,span,H*.37,W*.065,paint,[side*.28,0,0]);
    for(const end of [-1,1])box('hopper_end',x+end*span*.48,floor+H*.2,0,span*.035,H*.4,W*.84);
    for(const dx of [-.27,.27])box('bottom_discharge',x+span*dx,floor-H*.065,0,span*.17,H*.12,W*.33,dark);
    if(closed)box('sealed_hopper_roof',x,floor+H*.42,0,span,H*.07,W*.85,light);
    else for(const dx of [-.3,0,.3].slice(0,v.cargo?.type==='aggregate'?v.cargo.count:3))box('aggregate_load',x+span*dx,floor+H*.26,0,span*.29,H*.16,W*.62,0x67615a);
  };
  if(['fuelTank','cryogenicTank','potableTank','sanitaryTank','chemicalTank','waterTank','vacuumTank'].includes(part)) {
    const radius=Math.min(W*.41,H*.28), y=floor+radius;
    const color=part==='fuelTank'?0xc6c7b6:part==='waterTank'||part==='potableTank'?0xc0dce3:part==='vacuumTank'?paint:light;
    cyl(part,x,y,0,radius,span,color,[0,0,Math.PI/2]);
    for(const end of [-1,1])cyl('tank_endcap',x+end*span*.5,y,0,radius*.91,span*.018,steel,[0,0,Math.PI/2]);
    for(const dx of [-.32,.32])box('tank_saddle',x+span*dx,floor,0,span*.09,H*.12,W*.73,dark);
    if(part==='cryogenicTank') {
      box('insulated_valve_cabinet',x-span*.44,floor+.04,0,span*.16,H*.23,W*.65,steel);
      for(const s of [-1,1])cyl('filling_valve',x-span*.47,floor+H*.05,s*W*.24,W*.04,W*.12,0x31759c);
    } else {
      for(const dx of [-.28,0,.28])cyl('tank_manway',x+span*dx,y+radius,0,W*.095,H*.05,steel,[0,0,0]);
      if(part==='chemicalTank')box('valve_protection',x,y+radius+H*.055,0,span*.2,H*.12,W*.35,dark);
    }
    if(part==='fuelTank'||part==='chemicalTank')for(const s of [-1,1])box('cargo_warning_panel',x,y,s*radius,span*.15,H*.09,W*.008,0xe5a434);
    if(part==='fuelTank')for(let i=0;i<3;i++) {
      box('fuel_outlet_manifold',x+span*(-.23+i*.23),floor+H*.04,W*.38,span*.13,H*.1,W*.1,steel);
      cyl('fuel_outlet_cap',x+span*(-.23+i*.23),floor+H*.04,W*.46,W*.045,W*.09,dark);
    }
    if(part==='sanitaryTank')box('sanitary_rear_valve_cover',x-span*.49,y-radius*.38,0,span*.08,H*.22,W*.45,steel);
    if(part==='potableTank') {
      box('drinking_water_tap_rail',x-span*.25,floor+H*.13,W*.4,span*.3,H*.045,W*.1,steel);
      for(const dx of [-.35,-.25,-.15])cyl('water_delivery_tap',x+span*dx,floor+H*.1,W*.45,W*.026,H*.09,0x407daa,[0,0,0]);
    }
    if(part==='vacuumTank') {
      cyl('vacuum_rear_door',x-span*.515,y,0,radius*.96,span*.035,steel,[0,0,Math.PI/2]);
      for(const s of [-1,1])box('vacuum_door_clamp',x-span*.54,y,s*radius*.85,span*.04,H*.17,W*.08,dark);
    }
  } else if(['enclosedBox','containerLoad','refrigeratedBox','sealedWaste','animalBox','curtainBox'].includes(part)) {
    enclosure(part);
    for(let i=0;i<12;i++)for(const s of [-1,1])box('body_rib',x+span*(-.46+i*.084),floor+H*.27,s*W*.438,span*.012,H*.5,W*.018,steel);
    if(part==='refrigeratedBox')box('refrigeration_unit',x+span*.48,floor+H*.42,0,span*.12,H*.2,W*.53,light);
    if(part==='animalBox')for(let i=0;i<3;i++)for(const s of [-1,1])box('animal_vent',x,floor+H*(.17+i*.12),s*W*.45,span*.9,H*.04,W*.015,dark);
    if(part==='containerLoad')for(const end of [-1,1])for(const s of [-1,1])box('twistlock',x+end*span*.49,floor-H*.015,s*W*.43,span*.03,H*.06,W*.09,dark);
    if(part==='curtainBox')for(let i=0;i<10;i++)for(const s of [-1,1])box('curtain_buckle',x+span*(-.43+i*.095),floor+H*.04,s*W*.439,span*.018,H*.06,W*.015,dark);
    if(part==='enclosedBox')for(const s of [-1,1]) {
      box('boxcar_sliding_door',x,floor+H*.26,s*W*.447,span*.32,H*.47,W*.025,steel);
      box('sliding_door_track',x,floor+H*.51,s*W*.46,span*.61,H*.025,W*.04,dark);
    }
    if(part==='sealedWaste')for(const dx of [-.27,.27]) {
      box('waste_sealed_lid',x+span*dx,floor+H*.56,0,span*.42,H*.035,W*.8,steel);
      box('lid_lifting_eye',x+span*dx,floor+H*.59,0,span*.07,H*.04,W*.18,dark);
    }
    if(part==='containerLoad'||part==='refrigeratedBox'||part==='curtainBox') {
      for(const s of [-1,1]) {
        box('rear_cargo_door',x-span*.504,floor+H*.27,s*W*.215,span*.012,H*.49,W*.41,light);
        box('door_lock_bar',x-span*.516,floor+H*.27,s*W*.22,span*.014,H*.44,W*.018,steel);
      }
    }
  } else if(part==='dumpBed') {
    box('tipper_floor',x,floor,0,span,H*.08,W*.85,steel);
    for(const s of [-1,1]) {
      box('tipper_side',x,floor+H*.2,s*W*.43,span,H*.4,W*.055);
      for(let i=0;i<5;i++)box('tipper_side_stiffener',x+span*(-.4+i*.2),floor+H*.2,s*W*.46,span*.025,H*.39,W*.045,steel);
    }
    for(const end of [-1,1])box(end<0?'hinged_tailgate':'tipper_headboard',x+end*span*.48,floor+H*.2,0,span*.035,H*.4,W*.89);
    cyl('tailgate_hinge',x-span*.48,floor+H*.38,0,W*.035,W*.92,steel);
    beam('tipper_lift_ram',[x+span*.26,H*.28,0],[x+span*.3,floor+H*.1,0],W*.12,steel);
    for(const dx of [-.3,0,.3].slice(0,v.cargo.count))box('aggregate_load',x+span*dx,floor+H*.11,0,span*.29,H*.2,W*.72,0x756d62);
  } else if(part==='paverHopper') {
    box('asphalt_feed_floor',L*.28,H*.4,0,L*.35,H*.08,W*.94,dark);
    for(const s of [-1,1])box('folding_hopper_wing',L*.28,H*.52,s*W*.43,L*.36,H*.24,W*.08,paint,[s*.3,0,0]);
    box('feed_conveyor',0,H*.43,0,L*.65,H*.065,W*.36,dark);
    cyl('rear_spreading_auger',-L*.39,H*.3,0,W*.07,W*.87,steel);
  } else if(['oreHopper','grainHopper','ballastHopper','saltHopper'].includes(part)) {
    hopper(part==='grainHopper');
    if(part==='grainHopper')for(const dx of [-.3,0,.3])box('grain_loading_hatch',x+span*dx,floor+H*.47,0,span*.17,H*.045,W*.4,steel);
    if(part==='ballastHopper')for(const s of [-1,1])box('ballast_side_chute',x,H*.28,s*W*.39,span*.3,H*.15,W*.22,steel);
    if(part==='saltHopper') {
      box('salt_delivery_conveyor',x-span*.42,H*.32,0,span*.13,H*.25,W*.23,dark);
      cyl('salt_spreader_disc',x-span*.42,H*.2,0,W*.24,H*.055,steel,[0,0,0]);
    }
  } else if(part==='logLoad') {
    for(const dx of [-.4,0,.4])box('log_bunk_crossbar',x+span*dx,floor+W*.015,0,span*.04,W*.045,W*.89,steel);
    for(let i=0;i<v.cargo.count;i++)cyl('secured_log',x,floor+W*(.14+Math.floor(i/3)*.23),(i%3-1)*W*.27,W*.13,span,0x846140,[0,0,Math.PI/2]);
    for(const dx of [-.4,0,.4])for(const s of [-1,1])box('log_bunk',x+span*dx,floor+H*.25,s*W*.43,span*.025,H*.55,W*.055,steel);
  } else if(['militaryLoad','machineLoad'].includes(part)) {
    box('secured_equipment_hull',x,floor+H*.22,0,span*.65,H*.23,W*.6,part==='militaryLoad'?0x667050:0xd6a03a);
    for(const s of [-1,1])box('equipment_track',x,floor+H*.09,s*W*.3,span*.71,H*.17,W*.16,dark);
    if(part==='militaryLoad') {
      box('equipment_turret',x,floor+H*.4,0,span*.29,H*.18,W*.39,0x667050);
      box('stowed_barrel',x+span*.26,floor+H*.41,0,span*.36,H*.035,W*.045,dark);
    } else {
      box('equipment_cab',x-span*.1,floor+H*.4,0,span*.2,H*.26,W*.38,0xd6a03a);
      beam('folded_digger_arm',[x,floor+H*.38,0],[x+span*.3,floor+H*.48,0],W*.09,0xd6a03a);
    }
    for(const dx of [-.35,.35])for(const s of [-1,1])box('tie_down',x+span*dx,floor+H*.03,s*W*.35,span*.05,H*.03,W*.22,steel);
  } else if(part==='autoDeck') {
    for(const level of [0,1]) {
      const y=floor+H*level*.34;
      box('car_deck',x,y,0,span,H*.04,W*.85,steel);
      for(const [slot,dx] of [-.28,.28].entries()){
        if(level*2+slot>=v.cargo.count)continue;
        for(const axle of [-.12,.12])for(const s of [-1,1])cyl('transported_car_wheel',x+span*(dx+axle),y+H*.065,s*W*.28,H*.05,W*.09,dark);
        box('transported_car',x+span*dx,y+H*.13,0,span*.38,H*.13,W*.62,level?0xa55b45:0x4e7188);
        box('transported_car_glass',x+span*dx,y+H*.22,0,span*.17,H*.08,W*.5,dark);
      }
    }
    for(const dx of [-.47,0,.47])for(const s of [-1,1])box('deck_post',x+span*dx,floor+H*.3,s*W*.43,span*.025,H*.65,W*.045,steel);
  } else if(['ladder','pumpBoom','craneBoom','bucketLift'].includes(part)) {
    const y=H*1.06;
    box('boom_equipment_deck',x,H*.44,0,span,H*.22,W*.85);
    box('boom_turntable',x-span*.27,H*.65,0,span*.22,H*.22,W*.57,dark);
    box('boom_pivot_pedestal',x-span*.27,H*.86,0,span*.13,H*.3,W*.43,steel);
    box('boom_transport_rest',x+span*.4,H*.8,0,span*.07,H*.5,W*.58,dark);
    if(part==='ladder') {
      for(const s of [-1,1]) {
        for(const level of [0,1])box('ladder_rail',x,y+level*H*.16,s*W*.25,span*1.2,H*.045,W*.055,steel);
        for(let i=0;i<10;i++)beam('ladder_truss',[x+span*(-.57+i*.114),y,s*W*.25],[x+span*(-.456+i*.114),y+H*.16,s*W*.25],W*.035,steel);
        box('nested_ladder',x+span*.02,y+H*.035,s*W*.19,span*1.08,H*.065,W*.05,steel);
      }
      for(let i=0;i<13;i++)box('ladder_rung',x+span*(-.56+i*.094),y,0,span*.018,H*.035,W*.55,steel);
      box('ladder_basket_floor',x+span*.53,y,0,span*.16,H*.055,W*.64,light);
      for(const s of [-1,1])box('ladder_basket_rail',x+span*.53,y+H*.1,s*W*.3,span*.16,H*.21,W*.04,light);
      box('ladder_basket_front',x+span*.6,y+H*.1,0,span*.02,H*.21,W*.64,light);
    } else if(part==='pumpBoom') {
      for(let i=0;i<3;i++) {
        const by=y+i*H*.12;
        box('pump_articulated_section',x,by,0,span*(1-i*.1),H*.09,W*.2,i===1?light:paint);
        const hingeX=x+(i%2?1:-1)*span*(.45-i*.05);
        cyl('pump_elbow_pin',hingeX,by+H*.055,0,W*.065,W*.28,steel);
        box('concrete_delivery_line',x,by,W*.13,span*(1-i*.1),H*.045,W*.065,dark);
      }
      box('concrete_receiving_hopper',x-span*.4,H*.62,0,span*.19,H*.25,W*.66,steel);
    } else if(part==='bucketLift') {
      beam('bucket_lower_arm',[x-span*.27,y,0],[x+span*.34,y+H*.13,0],W*.18,paint);
      beam('bucket_return_arm',[x+span*.34,y+H*.13,0],[x-span*.1,y+H*.24,0],W*.14,light);
      cyl('bucket_elbow',x+span*.34,y+H*.13,0,W*.095,W*.3,steel);
      box('insulated_work_bucket',x-span*.1,y+H*.14,0,span*.19,H*.27,W*.5,light);
      box('bucket_open_top',x-span*.1,y+H*.278,0,span*.15,H*.008,W*.38,dark);
    } else {
      for(let i=0;i<3;i++)box('folded_boom',x+span*i*.14,y,0,span*(1-i*.18),H*(.18-i*.035),W*(.32-i*.06),i===1?light:paint);
      if(part==='craneBoom') {box('hoist_wire',x+span*.44,y-H*.1,0,W*.012,H*.24,W*.012,dark);box('hook',x+span*.44,y-H*.23,0,W*.09,H*.055,W*.04,steel);}
      cyl('hoist_drum',x-span*.3,y-H*.16,0,W*.13,W*.48,steel);
      box('crane_counterweight',x-span*.44,H*.72,0,span*.16,H*.22,W*.67,dark);
    }
  } else if(part==='outriggers') {
    for(const dx of [-.38,.38])for(const s of [-1,1])box('stowed_outrigger',x+span*dx,H*.26,s*W*.4,span*.06,H*.1,W*.17,steel);
  } else if(['hose','cableReel','winch'].includes(part)) {
    const y=floor+H*.15;
    cyl(part,x-span*.32,y,W*.34,W*.16,W*.16,part==='hose'?0x344a52:dark);
    for(const s of [-1,1])cyl('reel_flange',x-span*.32,y,W*(.34+s*.095),W*.18,W*.025,steel);
    if(part==='winch') {
      box('winch_motor',x-span*.32,y,W*.15,span*.11,H*.11,W*.22,steel);
      box('winch_fairlead',x-span*.4,y,W*.34,span*.045,H*.1,W*.19,steel);
    } else if(part==='cableReel')box('cable_connector_box',x-span*.32,y-H*.1,W*.35,span*.13,H*.12,W*.2,0x416884);
  } else if(part==='sprayBar') {
    box('spray_bar',-L*.47,H*.22,0,L*.025,H*.025,W*.94,steel);
    for(const s of [-1,1])cyl('water_nozzle',-L*.48,H*.21,s*W*.35,W*.03,H*.07,dark,[0,0,0]);
  } else if(part==='mixerDrum') {
    // 軸向由低前端 (+X) 指向高後端 (-X)；後方縮口供進料與卸料。
    const tilt=.22, center=[x,H*.7,0], radius=W*.4;
    const point=t=>[center[0]-Math.cos(tilt)*t,center[1]+Math.sin(tilt)*t,0];
    const sections=[[-.4,-.22,.2,1],[-.22,.09,1,1],[.09,.4,1,.38]];
    for(const [a,b,ra,rb] of sections){const p=point(span*(a+b)/2);frustum('mixer_drum_section',...p,radius*rb,radius*ra,span*(b-a),light,[0,0,Math.PI/2-tilt]);}
    for(const t of [-.22,.09]) {
      const p=point(span*t);
      cyl('drum_running_ring',...p,radius*1.015,span*.028,steel,[0,0,Math.PI/2-tilt]);
      const base=p[1]-radius*.88;
      box('mixer_support',p[0],(floor+base)/2,0,span*.09,Math.max(H*.06,base-floor),W*.65,dark);
      for(const s of [-1,1])cyl('drum_support_roller',p[0],base,s*W*.22,W*.075,span*.09,dark,[0,0,Math.PI/2]);
    }
    const rear=point(span*.41);
    cyl('mixer_opening',...rear,radius*.34,span*.02,dark,[0,0,Math.PI/2-tilt]);
    box('feed_hopper',rear[0],rear[1]+H*.1,0,span*.13,H*.19,W*.33,steel);
    beam('discharge_chute',[rear[0],rear[1]-radius*.3,0],[rear[0]-span*.1,H*.4,0],W*.13,steel);
    for(const s of [-1,1])box('rear_hopper_support',rear[0],(floor+rear[1])/2,s*W*.23,span*.025,rear[1]-floor,W*.035,steel);
  } else if(part==='drillMast'||part==='telecomMast') {
    const mastX=part==='drillMast'?L*.32:x;
    box(part,mastX,H*.76,0,W*.13,H*.85,W*.13,steel);
    if(part==='drillMast')cyl('drill_rod',mastX+W*.1,H*.55,0,W*.035,H*.95,dark,[0,0,0]);
    else for(const s of [-1,1]) {box('sector_antenna',mastX,H*1.09,s*W*.2,W*.13,H*.22,W*.08,light);box('antenna_bracket',mastX,H*.99,0,W*.04,H*.04,W*.45,steel);}
  } else if(['dozerBlade','snowBlade','graderBlade','screed'].includes(part)) {
    const bx=part==='graderBlade'?0:part==='screed'?-L*.42:L*.43;
    box(part,bx,H*.2,0,L*.08,H*.26,W*.94,steel,[0,part==='graderBlade'?.23:0,.1]);
    if(part==='screed') {
      for(const s of [-1,1])box('screed_extension',bx,H*.17,s*W*.42,L*.15,H*.15,W*.32,dark);
      beam('screed_tow_arm',[-L*.12,H*.37,0],[bx,H*.27,0],W*.12,steel);
    } else {
      box('blade_cutting_edge',bx+L*.035,H*.08,0,L*.04,H*.045,W*.97,dark);
      for(const s of [-1,1])beam('blade_hydraulic', [bx-L*.19,H*.4,s*W*.27],[bx,H*.22,s*W*.27],W*.065,paint);
      if(part==='snowBlade')for(const s of [-1,1])box('snow_deflector',bx,H*.23,s*W*.43,L*.16,H*.3,W*.15,paint,[0,-s*.35,0]);
      if(part==='graderBlade')cyl('grader_rotation_circle',bx,H*.39,0,W*.28,H*.075,dark,[0,0,0]);
    }
  } else if(part==='trenchChain') {
    beam('chain_arm',[L*.1,H*.55,0],[L*.43,H*.12,0],W*.13,dark);
    for(let i=0;i<7;i++)box('chain_tooth',L*(.1+i*.055),H*(.55-i*.071),0,L*.045,H*.04,W*.19,steel);
  } else if(['generator','firePump','pumpUnit','toolCabinet'].includes(part)) {
    box('equipment_skid',x,H*.345,0,span*.76,H*.04,W*.72,steel);
    box(part,x,H*.55,0,span*.75,H*.4,W*.7,part==='generator'?0x6b7975:paint);
    for(let i=0;i<6;i++)for(const s of [-1,1])box('equipment_louver',x-span*.23+i*span*.09,H*.57,s*W*.355,span*.025,H*.22,W*.01,dark);
    if(part==='pumpUnit'||part==='firePump')for(const s of [-1,1])cyl('hose_coupling',x,H*.42,s*W*.37,W*.075,W*.09,steel);
    if(part==='firePump') {
      for(const s of [-1,1]) {
        box('pump_control_panel',x,H*.57,s*W*.357,span*.46,H*.25,W*.018,steel);
        for(const dx of [-.12,0,.12])cyl('pressure_gauge',x+span*dx,H*.61,s*W*.375,W*.042,W*.02,light);
      }
    } else if(part==='pumpUnit') {
      cyl('centrifugal_pump_housing',x-span*.24,H*.51,W*.4,W*.18,W*.21,0x527c91);
      cyl('suction_flange',x-span*.24,H*.51,W*.54,W*.11,W*.12,steel);
    } else if(part==='generator') {
      box('generator_access_door',x,H*.53,W*.36,span*.34,H*.3,W*.025,light);
      box('power_socket_panel',x-span*.24,H*.49,W*.37,span*.12,H*.16,W*.03,dark);
    } else for(const s of [-1,1])for(let i=0;i<4;i++)box('tool_drawer_handle',x,H*(.43+i*.07),s*W*.365,span*.48,H*.015,W*.025,steel);
  } else if(part==='compactor') {
    box('compression_chamber',x+span*.06,H*.6,0,span*.78,H*.49,W*.86);
    box('compactor_roof',x+span*.06,H*.86,0,span*.78,H*.07,W*.68);
    for(const s of [-1,1]) {
      box('chamber_roof_shoulder',x+span*.06,H*.825,s*W*.375,span*.78,H*.12,W*.15,paint,[s*.5,0,0]);
      box('rear_loader_cheek',x-span*.41,H*.57,s*W*.38,span*.23,H*.56,W*.12,paint,[0,0,-.15]);
      beam('tailgate_hydraulic',[x-span*.27,H*.83,s*W*.46],[x-span*.46,H*.44,s*W*.46],W*.055,steel);
      box('bin_lifter',x-span*.53,H*.3,s*W*.25,span*.05,H*.18,W*.06,steel);
    }
    box('tailgate_header',x-span*.39,H*.84,0,span*.24,H*.13,W*.84);
    box('loading_mouth',x-span*.49,H*.46,0,span*.04,H*.25,W*.66,dark);
    box('hopper_loading_sill',x-span*.48,H*.33,0,span*.19,H*.075,W*.8,steel);
  } else if(part==='recyclingBins') {
    for(let i=0;i<3;i++)box('sorted_bin',x+span*(-.32+i*.32),H*.54,0,span*.29,H*.42,W*.85,[0x528c79,0x5785a5,0xceab51][i]);
  } else if(part==='openBed'||part==='recoveryBed') {
    box(part,x,floor,0,span,H*.055,W*.88,steel);
    if(part==='openBed')railings();
    else for(const s of [-1,1])box('loading_ramp',x-span*.48,H*.27,s*W*.3,span*.18,H*.035,W*.19,dark,[0,0,.22]);
  } else if(part==='awning') {
    box('stowed_awning',x,H*.94,W*.45,span,H*.035,W*.07,0xd8bf75);
  } else if(part==='kitchenVent') {
    box('kitchen_hood',x,H*.96,0,span*.3,H*.09,W*.4,steel);
  } else if(part==='servingHatch') {
    box('service_window',x,H*.65,W*.445,span*.69,H*.23,W*.018,dark);
    box('serving_shelf',x,H*.52,W*.49,span*.73,H*.025,W*.13,steel);
  } else if(part==='policeStripe') {
    for(const s of [-1,1])box('police_livery',0,H*.5,s*W*.458,L*.72,H*.1,W*.012,0xc9dbe9);
  } else if(['vanWindows','secureCabin','commandCabin','medicalCabin','camperCabin','bookShelves'].includes(part)) {
    const skin=v.form==='utility'?.402:.445;
    for(const s of [-1,1])for(const dx of [-.32,0]){
      box(part,x+span*dx,H*.68,s*W*skin,span*.23,H*.19,W*.015,part==='bookShelves'?0xba9b67:dark);
      if(part==='secureCabin')for(let i=0;i<4;i++)box('security_grille',x+span*(dx-.09+i*.06),H*.68,s*W*.458,span*.009,H*.2,W*.012,steel);
    }
    if(part==='medicalCabin')for(const s of [-1,1]) {box('medical_mark',x,H*.46,s*W*(skin+.005),span*.18,H*.04,W*.01,0x3c976c);box('medical_mark',x,H*.46,s*W*(skin+.008),span*.045,H*.14,W*.01,0x3c976c);}
    if(part==='camperCabin')box('roof_vent',x,H*.935,0,span*.2,H*.045,W*.36,light);
    if(part==='commandCabin') {
      cyl('satellite_pedestal',x,H*.96,0,W*.09,H*.1,steel,[0,0,0]);
      cyl('stowed_satellite_dish',x,H*1.02,0,W*.24,H*.035,light,[0,0,0]);
    }
    if(part==='secureCabin') {
      box('secure_rear_door',-L*.452,H*.58,0,L*.012,H*.49,W*.68,steel);
      box('secure_door_latch',-L*.462,H*.54,W*.19,L*.015,H*.06,W*.16,dark);
    }
    if(part==='medicalCabin')for(const s of [-1,1]) {
      const rear=v.form==='utility'?-L*.432:-L*.452;
      box('ambulance_rear_door',rear,H*.6,s*W*.19,L*.014,H*.45,W*.36,light);
      box('ambulance_rear_glass',rear-L*.008,H*.72,s*W*.19,L*.005,H*.13,W*.26,dark);
      box('rear_medical_handle',rear-L*.011,H*.53,s*W*.075,L*.008,H*.08,W*.035,steel);
    }
    if(part==='camperCabin') {
      box('camper_entry_door',-L*.29,H*.59,W*.447,L*.12,H*.5,W*.022,light);
      box('camper_entry_window',-L*.29,H*.73,W*.46,L*.085,H*.15,W*.009,dark);
      box('camper_folded_step',-L*.29,H*.35,W*.46,L*.14,H*.055,W*.13,steel);
    }
    if(part==='bookShelves')for(const s of [-1,1]) {
      for(let level=0;level<3;level++) {
        box('library_shelf',x,H*(.52+level*.1),s*W*.475,span*.75,H*.018,W*.09,steel);
        for(let i=0;i<7;i++)box('book_spine',x+span*(-.32+i*.1),H*(.56+level*.1),s*W*.475,span*.065,H*.07,W*.05,[0x885747,0x497e77,0xb39a54][i%3]);
      }
    }
  } else if(part==='fifthWheel') {
    box('fifth_wheel_mount',-L*.23,(1.2+H*.34)/2,0,L*.17,Math.abs(1.2-H*.34)+H*.035,W*.52,steel);
    cyl('fifth_wheel',-L*.23,1.2,0,W*.24,H*.035,dark,[0,0,0]);
  } else throw new RangeError(`專用車設備尚未建模:${part}`);
  return true;
}
