import * as THREE from 'three';
import { vehicleBackgroundObject, CONSIST_PREFIX, vehicleConsistBackgroundObject } from './vehicleCatalog.js';
import { makeRuntimePartModel } from './runtimePartModel.js';
import { SignSheet, signAspect } from './worldtext.js';

/** Use the official part compiler and text atlas; caller keeps collision boxes and siting rights. */
export function makeProceduralVehicle(key, seed = 0, options = {}) {
  if (options.fit) for (const axis of ['L','W','H']) {
    if (!Number.isFinite(options.fit[axis]) || options.fit[axis] <= 0) throw new RangeError('車輛 fit 必須是正有限尺寸');
  }
  const entry = key.startsWith(CONSIST_PREFIX)
    ? vehicleConsistBackgroundObject(key.slice(CONSIST_PREFIX.length),seed,options) : vehicleBackgroundObject(key, seed, options);
  const group = new THREE.Group();
  group.add(makeRuntimePartModel(entry));
  const v = entry.generation;
  if (typeof document !== 'undefined' && (entry.markings || entry.markingSurface || entry.plates?.length)) {
    const sheet = new SignSheet(true);
    for(const {surface,vehicle:marked} of entry.markings||(entry.markingSurface?[{surface:entry.markingSurface,vehicle:v}]:[])) {
    if(['cycle','motor','trike','cart'].includes(marked.form))continue;
    const text = [marked.lettering, marked.type==='rail'?marked.number:'', marked.graffiti].filter(Boolean).join(' ');
    const h = Math.min(surface.height * .18, surface.length * .5 / signAspect('lightbox'));
    for (const side of [-1, 1]) sheet.add({text, x:surface.x, y:surface.y-surface.height*.34, z:side*(surface.z+.002),
      ry: side > 0 ? 0 : Math.PI, h, style:'lightbox'});
    }
    for(const plate of entry.plates||[])sheet.add({...plate,style:'lightbox'});
    const lettering = sheet.build();
    if (lettering) {
      lettering.material.addEventListener('dispose',()=>lettering.userData.signTex.dispose());
      group.add(lettering);
    }
  }
  // Fit to actual geometric envelope; accessories MUST NOT poke outside the host collision box.
  const {min,max,size} = entry.bounds;
  const origin = new THREE.Group();
  group.position.set(-(min[0]+max[0])/2,-min[1],-(min[2]+max[2])/2);
  origin.add(group);
  if(options.fit) {
    const fit = options.fit;
    origin.scale.set(fit.L/size[0],fit.H/size[1],fit.W/size[2]);
  }
  origin.rotation.y = options.ry || 0;
  origin.position.fromArray(options.at || [0,0,0]);
  origin.name = entry.key;
  origin.userData.vehicle = v;
  origin.userData.runtimePart = {key:entry.key,version:entry.version,family:'vehicle'};
  return origin;
}
