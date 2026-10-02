import asset from '../assets/t05.js';

export default {
  label: 't05 reference reconstruction', kind: 'biped',
  height: asset.height, asset, gait: {}, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
