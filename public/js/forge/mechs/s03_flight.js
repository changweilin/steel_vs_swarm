import s03 from './s03.js';

export default {
  ...s03, label: 's03 reference flight', kind: 'air', height: s03.height,
  air: { top: 12 }, moveSig: {"hover":0.15,"hoverF":0.5,"hoverA":0.25,"surge":0.05,"flare":0.05,"bank":0.05},
};
