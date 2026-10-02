import asset from '../assets/s03.js';

export default {
  label: 's03 reference reconstruction', kind: 'quad', height: asset.height, asset,
  gait: {}, moveSig: {"poise":0.2,"idleF":0.4,"idleA":1,"launch":0.05,"spool":0.95,"brake":0.06,"settle":2},
  castSig: {"omni":"roar","dir":"swing"},
  doc: asset.components.map(component => [component.id, component.intent]),
};
