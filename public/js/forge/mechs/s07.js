import asset from '../assets/s07.js';

export default {
  label: 's07 reference reconstruction', kind: 'quad',
  height: asset.height, asset, gait: {}, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
