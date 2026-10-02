import t11 from './t11.js';

export default {
  ...t11, label: 't11 reference flight', kind: 'air', height: t11.height,
  air: { top: 22 }, moveSig: {"hover":0.3,"hoverF":0.7,"hoverA":0.1,"surge":0.55,"flare":0.2,"bank":0.6},
};
