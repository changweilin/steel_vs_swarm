import asset from '../assets/m06.js';

export default {
  label: 'm06 reference reconstruction', kind: 'quad',
  height: asset.height, asset, gait: {}, air: null,
  moveSig: {}, castSig: { omni: 'brace', dir: 'jab' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
