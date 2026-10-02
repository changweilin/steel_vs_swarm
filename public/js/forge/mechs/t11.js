import asset from '../assets/t11.js';

export default {
  label: 't11 reference reconstruction', kind: 'biped', height: asset.height, asset,
  gait: {}, moveSig: {"poise":0.42,"idleF":0.68,"idleA":1.4,"launch":0.08,"spool":0.8,"brake":0.18,"settle":1.7},
  castSig: {"omni":"stomp","dir":"jab"},
  doc: asset.components.map(component => [component.id, component.intent]),
};
