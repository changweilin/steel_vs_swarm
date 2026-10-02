import asset from '../assets/m05.js';

export default {
  label: 'm05 reference reconstruction', kind: 'biped', height: asset.height, asset,
  gait: {}, moveSig: {"poise":0.82,"idleF":0.85,"idleA":0.42,"launch":0.86,"spool":0.22,"brake":0.32,"settle":1.2},
  castSig: {"omni":"roar","dir":"swing"},
  doc: asset.components.map(component => [component.id, component.intent]),
};
