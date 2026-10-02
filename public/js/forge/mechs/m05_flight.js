import m05 from './m05.js';

export default {
  ...m05, label: 'm05 reference flight', kind: 'air', height: m05.height,
  air: { top: 30 }, moveSig: {"hover":0.22,"hoverF":0.8,"hoverA":0.12,"surge":0.8,"flare":0.7,"bank":0.75},
};
