import asset from '../assets/m07.js';

export default {
  label: 'm07 reference reconstruction', kind: 'quad', height: asset.height, asset,
  gait: {}, moveSig: {"poise":0.3,"idleF":0.55,"idleA":0.9,"launch":0.1,"spool":0.9,"brake":0.12,"settle":1.9},
  castSig: {"omni":"stomp","dir":"jab"},
  doc: asset.components.map(component => [component.id, component.intent]),
};
