import asset from '../assets/t06.js';

export default {
  label: 't06 reference reconstruction', kind: 'biped', height: asset.height, asset,
  gait: {}, moveSig: {"poise":0.38,"idleF":1.92,"idleA":1.05,"launch":0.94,"spool":0.08,"brake":0.6,"settle":0.42},
  castSig: {"omni":"dance","dir":"swing"},
  doc: asset.components.map(component => [component.id, component.intent]),
};
