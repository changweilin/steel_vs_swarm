import m01 from './m01.js';

export default {
  ...m01, label: 'm01 delta glider', kind: 'air', height: m01.height,
  air: { bob: .04, top: 30, level: true },
  moveSig: { hover: .2, surge: .85, flare: .55, bank: .78 },
};
