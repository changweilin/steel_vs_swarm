import asset from '../assets/t10.js';

export default {
  label: 'T10 reference reconstruction',
  kind: 'biped', height: asset.height, asset,
  gait: { bob: asset.rig.bob, sway: asset.rig.sway, top: asset.rig.top, armBase: asset.rig.armBase }, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
