import * as THREE from 'three';

// Unit envelopes match vesselLayout cells, including booms/barrels/rotors.
// Materials belong to the enclosing vessel and are released with disposeTree.
export function buildVesselEquipment(item, materials) {
  const root=new THREE.Group(); root.name=`equipment_${item.kind}`;root.userData.equipment=item;
  const {metal,dark,light,orange,glass,cargo}=materials, paint=cargo[item.variant%cargo.length];
  const mesh=(name,geometry,material,x,y,z)=>{
    const m=new THREE.Mesh(geometry,material);m.name=name;m.position.set(x,y,z);root.add(m);return m;
  };
  const box=(name,w,h,d,x=0,y=h/2,z=0,mat=metal)=>mesh(name,new THREE.BoxGeometry(w,h,d),mat,x,y,z);
  const cylinder=(name,r,h,x=0,y=h/2,z=0,mat=metal)=>mesh(name,new THREE.CylinderGeometry(r,r,h,10),mat,x,y,z);
  const sphere=(name,rx,ry,rz,x,y,z,mat=light)=>{
    const m=mesh(name,new THREE.SphereGeometry(1,12,8),mat,x,y,z);m.scale.set(rx,ry,rz);return m;
  };
  const k=item.kind;
  if(['cannon','autocannon','ciws'].includes(k)) {
    cylinder('turret_base',0.27,0.22,0,0.11,-0.16);
    sphere('turret_shield',0.28,0.26,0.25,0,0.4,-0.16,metal);
    const n=k==='ciws'?3:k==='autocannon'?2:1;
    for(let j=0;j<n;j++)box('barrel',0.035,0.04,0.65,(j-(n-1)/2)*0.06,0.49,0.13,dark);
    if(k==='ciws')sphere('tracking_radar',0.16,0.19,0.16,0,0.8,-0.17,light);
  } else if(k==='vls') {
    box('launcher_plinth',0.94,0.18,0.94);
    for(let j=0;j<item.units;j++)box('vls_cell',0.2,0.035,0.85/(item.units/4),((j%4)-1.5)*0.23,0.2,(Math.floor(j/4)-(item.units/4-1)/2)*(0.9/(item.units/4)),dark);
  } else if(['missile','sam','torpedo','decoy'].includes(k)) {
    box('launcher_mount',0.7,0.25,0.65);
    const n=k==='decoy'?4:3;
    for(let j=0;j<n;j++) {
      const tube=box('launcher_tube',0.7/n,0.18,0.74,(j-(n-1)/2)*0.8/n,0.52,0,dark);
      tube.rotation.x=k==='torpedo'?0:-0.35;
    }
  } else if(['container','reefer','tank_container'].includes(k)) {
    if(k==='tank_container') {
      const tank=cylinder('iso_tank',0.38,0.92,0,0.5,0,light);tank.rotation.x=Math.PI/2;
      for(const x of [-0.46,0.46])for(const z of [-0.46,0.46])box('iso_frame',0.05,1,0.05,x,0.5,z,paint);
    } else {
      box('container',1,1,1,0,0.5,0,paint);
      if(k==='reefer')box('refrigeration',0.76,0.67,0.02,0,0.54,0.49,light);
      else box('container_doors',0.9,0.85,0.012,0,0.5,0.494,metal);
    }
  } else if(['lng_sphere','lng_membrane'].includes(k)) {
    if(k==='lng_sphere') {
      cylinder('tank_skirt',0.43,0.22,0,0.11,0,light);
      sphere('moss_tank',0.48,0.46,0.48,0,0.52,0,light);
    } else {
      const roof=cylinder('membrane_cover',0.5,0.94,0,0.38,0,light);roof.rotation.x=Math.PI/2;roof.scale.x=0.95;roof.scale.z=0.65;
      box('tank_coaming',0.94,0.24,0.94,0,0.12,0,light);
    }
    cylinder('tank_dome',0.07,0.1,0,0.95,0,orange);
  } else if(['coal','ore','grain','hatch'].includes(k)) {
    box('hold_floor',0.95,0.12,0.95,0,0.06,0,dark);
    for(const x of [-0.46,0.46])box('hold_coaming',0.06,0.32,0.98,x,0.16,0);
    for(const z of [-0.46,0.46])box('hold_coaming',0.92,0.32,0.06,0,0.16,z);
    if(k==='hatch')box('hatch_cover',0.94,0.07,0.94,0,0.36,0,paint);
    else for(let j=0;j<3;j++)sphere('bulk_mound',0.4,0.28,0.2,0,0.3,-0.24+j*0.24,k==='coal'?dark:k==='ore'?orange:light);
  } else if(k==='oil_manifold') {
    for(const x of [-0.25,0,0.25]) {
      box('oil_pipe',0.05,0.05,0.96,x,0.12,0,light);
      cylinder('valve',0.09,0.16,x,0.21,0,orange);
    }
    box('cross_manifold',0.86,0.07,0.07,0,0.16,0,light);
  } else if(k==='sonar') {
    box('sonar_cradle',0.64,0.12,0.7,0,0.06,0,dark);
    sphere('towfish',0.2,0.25,0.46,0,0.38,0,orange);
    box('sonar_fins',0.86,0.03,0.15,0,0.4,-0.25,metal);
  } else if(['logs','pipes','coils','cable_drum','winch','tow_winch','net_drum'].includes(k)) {
    box('cradle',0.95,0.14,0.9,0,0.07,0,dark);
    if(k==='logs'||k==='pipes') {
      for(let j=0;j<3;j++) {
        const tube=cylinder('bundled_stock',0.14,0.88,(j-1)*0.29,0.31,0,k==='logs'?orange:metal);tube.rotation.x=Math.PI/2;
      }
      for(const z of [-0.28,0.28])box('cargo_strap',0.93,0.025,0.035,0,0.455,z,dark);
    } else {
      const spool=cylinder('drum',0.32,0.62,0,0.46,0,k==='net_drum'?dark:metal);spool.rotation.z=Math.PI/2;
      for(const x of [-0.34,0.34]) {
        const flange=cylinder('drum_flange',0.4,0.05,x,0.46,0,paint);flange.rotation.z=Math.PI/2;
      }
    }
  } else if(k==='lifeboat') {
    sphere('lifeboat_shell',0.4,0.22,0.46,0,0.48,0,orange);
    sphere('lifeboat_cover',0.32,0.18,0.34,0,0.66,0,orange);
    for(const z of [-0.28,0.28]) {
      box('davit_column',0.04,0.95,0.04,-0.45,0.475,z,metal);
      box('davit_arm',0.48,0.04,0.04,-0.22,0.94,z,metal);
      box('suspension',0.014,0.28,0.014,0,0.8,z,dark);
    }
  } else if(['crates','fish_crates','rescue_kit'].includes(k)) {
    for(const x of [-0.23,0.23]) {
      box('stowed_case',0.43,0.58,0.85,x,0.29,0,k==='crates'?orange:light);
      box('case_strap',0.06,0.59,0.86,x,0.295,0,dark);
    }
  } else if(['car','truck','machinery'].includes(k)) {
    box('chassis',0.65,0.22,0.9,0,0.3,0,paint);
    box('vehicle_cab',0.6,0.3,0.3,0,0.54,0.25,paint);
    box('windshield',0.5,0.18,0.012,0,0.57,0.407,glass);
    if(k==='truck')box('truck_load',0.7,0.55,0.5,0,0.62,-0.18,light);
    for(const x of [-0.37,0.37])for(const z of [-0.3,0.3])sphere('tyre',0.08,0.15,0.13,x,0.17,z,dark);
  } else if(['radar','satcom','phased_array'].includes(k)) {
    cylinder('sensor_mast',0.045,0.66);
    if(k==='satcom')sphere('satcom_dome',0.3,0.3,0.3,0,0.68,0,light);
    else if(k==='phased_array') {
      for(const z of [-0.13,0.13])box('radar_panel',0.7,0.48,0.04,0,0.65,z,dark);
    } else box('radar_scanner',0.94,0.15,0.18,0,0.76,0,light);
  } else if(k==='ctd') {
    cylinder('sampling_frame',0.4,0.06,0,0.07,0,dark);
    for(let j=0;j<8;j++){const a=j*Math.PI/4;cylinder('water_bottle',0.075,0.65,Math.cos(a)*0.27,0.4,Math.sin(a)*0.27,orange);}
    cylinder('frame_top',0.4,0.04,0,0.77,0,dark);
  } else if(k==='rov') {
    for(const x of [-0.4,0.4])for(const z of [-0.4,0.4])box('rov_frame',0.055,0.72,0.055,x,0.4,z,orange);
    box('rov_float',0.88,0.2,0.88,0,0.82,0,orange);
    box('pressure_case',0.6,0.3,0.56,0,0.4,0,metal);
    sphere('rov_camera',0.12,0.12,0.09,0,0.4,0.35,glass);
  } else if(k==='buoy') {
    sphere('float',0.35,0.24,0.35,0,0.24,0,orange);
    cylinder('buoy_mast',0.03,0.6,0,0.64,0,light);
  } else if(k==='lab') {
    box('lab_module',0.94,0.7,0.94,0,0.35,0,light);
    box('lab_window',0.48,0.24,0.02,0,0.45,0.475,glass);
    cylinder('vent',0.08,0.18,0.2,0.79,0);
  } else if(['a_frame','crane','dredge'].includes(k)) {
    for(const x of [-0.42,0.42])box('handling_leg',0.07,0.88,0.12,x,0.44,0,orange);
    box('handling_beam',0.92,0.08,0.12,0,0.88,0,orange);
    box('hoist_cable',0.015,0.64,0.015,0,0.52,0,dark);
    if(k==='dredge')box('suction_pipe',0.16,0.18,0.88,0,0.15,0,metal);
  } else if(['fighter','helicopter'].includes(k)) {
    sphere('airframe',0.12,0.16,0.43,0,0.29,0,metal);
    box('landing_gear',0.35,0.1,0.45,0,0.05,0,dark);
    sphere('canopy',0.08,0.12,0.15,0,0.43,0.12,glass);
    if(k==='fighter') {
      const shape=new THREE.Shape();shape.moveTo(-0.47,-0.2);shape.lineTo(0,0.18);shape.lineTo(0.47,-0.2);shape.lineTo(0.15,-0.22);shape.lineTo(0,-0.05);shape.lineTo(-0.15,-0.22);shape.closePath();
      const wing=mesh('folded_wing_plan',new THREE.ShapeGeometry(shape),metal,0,0.3,0);wing.rotation.x=-Math.PI/2;
      box('tailplane',0.4,0.035,0.17,0,0.3,-0.32);
      box('tailfin',0.03,0.3,0.17,0,0.48,-0.3);
    } else {
      cylinder('rotor_mast',0.025,0.23,0,0.59,0);
      box('rotor',0.94,0.02,0.04,0,0.72,0,dark);
      box('rotor',0.04,0.02,0.94,0,0.72,0,dark);
      box('tail_boom',0.05,0.05,0.4,0,0.3,-0.27);
    }
  } else throw new Error(`Unrendered vessel equipment: ${k}`);
  const sideways=Math.abs(Math.sin(item.heading||0))>0.5;
  root.position.set(item.x,item.y,item.z);root.rotation.y=item.heading||0;
  root.scale.set(sideways?item.d:item.w,item.h,sideways?item.w:item.d);
  return root;
}
