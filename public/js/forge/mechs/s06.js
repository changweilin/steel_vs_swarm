import asset from '../assets/s06.js';

export default {
  label: 's06 reference reconstruction', kind: 'quad',
  height: asset.height, asset, gait: {}, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
