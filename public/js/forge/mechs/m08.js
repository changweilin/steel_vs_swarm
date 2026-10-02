import asset from '../assets/m08.js';

export default {
  label: 'm08 reference reconstruction', kind: 'quad', height: asset.height, asset,
  gait: {}, moveSig: {"poise":0.86,"idleF":0.7,"idleA":0.35,"launch":0.9,"spool":0.12,"brake":0.9,"settle":0.38},
  castSig: {"omni":"flare","dir":"lunge"},
  doc: asset.components.map(component => [component.id, component.intent]),
};
