import asset from '../assets/s10.js';

export default {
  label: 's10 reference reconstruction', kind: 'quad', height: asset.height, asset,
  gait: {}, moveSig: {"poise":0.6,"idleF":1.4,"idleA":0.6,"launch":0.95,"spool":0.1,"brake":0.8,"settle":0.4},
  castSig: {"omni":"roar","dir":"kick"},
  doc: asset.components.map(component => [component.id, component.intent]),
};
