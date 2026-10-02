import t06 from './t06.js';

export default {
  ...t06, label: 't06 reference flight', kind: 'air', height: t06.height,
  air: { top: 30 }, moveSig: {"hover":0.3,"hoverF":0.7,"hoverA":0.15,"surge":0.7,"flare":0.85,"bank":0.62},
};
