import asset from '../assets/s09.js';

export default {
  label: 's09 reference reconstruction', kind: 'biped',
  height: asset.height, asset, gait: {}, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
