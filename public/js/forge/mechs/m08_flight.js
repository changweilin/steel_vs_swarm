import m08 from './m08.js';

export default {
  ...m08, label: 'm08 reference flight', kind: 'air', height: m08.height,
  air: { top: 24 }, moveSig: {"hover":0.1,"hoverF":0.5,"hoverA":0.9,"surge":0.25,"flare":0.92,"bank":0.42},
};
