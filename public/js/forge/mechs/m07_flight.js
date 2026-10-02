import m07 from './m07.js';

export default {
  ...m07, label: 'm07 reference flight', kind: 'air', height: m07.height,
  air: { top: 18 }, moveSig: {"hover":0.42,"hoverF":0.7,"hoverA":1.35,"surge":0.15,"flare":0.6,"bank":0.2},
};
