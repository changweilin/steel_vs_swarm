import asset from '../assets/m01.js';

export default {
  label: 'm01 reference reconstruction', kind: 'biped', height: asset.height, asset,
  gait: {}, moveSig: { poise: .85, launch: .9, brake: .7 },
  castSig: { omni: 'spin', dir: 'swing' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
