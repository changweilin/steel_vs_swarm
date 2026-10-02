import asset from '../assets/t04.js';

export default {
  label: 't04 reference reconstruction', kind: 'quad',
  height: asset.height, asset, gait: {}, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
