import asset from '../assets/s04.js';

export default {
  label: 's04 reference reconstruction', kind: 'air',
  height: asset.height, asset, gait: {}, air: { bob: asset.rig.bob, top: asset.rig.top },
  moveSig: {}, castSig: { omni: 'flare', dir: 'lunge' },
  doc: asset.components.map(component => [component.id, component.intent]),
};
