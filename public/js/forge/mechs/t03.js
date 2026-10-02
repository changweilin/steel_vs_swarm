import asset from '../assets/t03.js';

export default {
  label: 't03 reference reconstruction', kind: 'biped',
  height: asset.height, asset, gait: {}, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
