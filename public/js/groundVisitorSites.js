import { LANDSCAPES } from './groundLandscapes.js';

// Each recent natural addition has exactly one authored visitor/service counterpart.
// Equipment anchors and their access paths share normalized patch coordinates.
const site = (naturalCounterpart, label, layout, equipment) => ({ naturalCounterpart, label, layout, equipment });
export const VISITOR_SITES = {
  mossGarden: site('mossbed', '苔庭休憩區', 'garden', [['rockflat', -.22, -.2], ['stonelantern', .28, -.24], ['bench', .22, .25]]),
  picnicLawn: site('cloverfield', '草坪野餐區', 'picnic', [['picnictable', -.23, -.22], ['picnictable', .23, -.22], ['litterbin', .3, .28]]),
  forestLearning: site('fernfloor', '林下自然教室', 'classroom', [['billboard', 0, -.28], ['bench', -.23, .06], ['bench', .23, .06], ['bench', 0, .28]]),
  heatherGarden: site('heathland', '石楠花園步道', 'garden', [['planter', -.24, -.24], ['planter', .24, -.24], ['bench', .25, .26]]),
  grasslandCamp: site('prairie', '草原露營區', 'camp', [['tent', -.23, -.2], ['tent', .23, -.2], ['picnictable', 0, .24]]),
  safariRest: site('savannagrass', '草原導覽休息站', 'shade', [['marketstall', 0, -.2], ['billboard', -.3, .2], ['bench', .28, .24]]),
  alpineRest: site('alpineflowers', '高山步道休憩點', 'lookout', [['bench', -.22, -.22], ['billboard', .28, -.22], ['fencepost', -.3, .28], ['fencepost', .3, .28]]),
  wetlandLearning: site('wetmeadow', '濕地解說廣場', 'classroom', [['billboard', 0, -.25], ['bench', -.25, .18], ['bench', .25, .18]]),
  riversidePicnic: site('riparianbrush', '河岸野餐休憩地', 'picnic', [['picnictable', -.22, -.2], ['bench', .24, -.2], ['litterbin', .3, .25]]),
  coastalRest: site('coastalgrass', '海岸步道休息站', 'lookout', [['bench', -.24, -.2], ['bench', .24, -.2], ['billboard', .28, .28]]),
  basaltExhibit: site('basaltfield', '玄武岩戶外展示場', 'exhibit', [['boulder', -.24, -.2], ['rockflat', .24, -.2], ['billboard', 0, .26]]),
  volcanoVisitor: site('volcanicash', '火山地質導覽站', 'shade', [['marketstall', 0, -.23], ['billboard', -.28, .22], ['bench', .27, .22]]),
  chalkTrailhead: site('chalkground', '白堊地步道入口', 'trailhead', [['billboard', -.27, -.22], ['bench', .27, -.22], ['litterbin', .3, .25]]),
  desertCamp: site('sanddunes', '沙地營地', 'camp', [['tent', -.23, -.2], ['tent', .23, -.2], ['picnictable', 0, .24]]),
  beachRest: site('shinglebank', '礫灘休憩廣場', 'picnic', [['picnictable', -.24, -.2], ['marketstall', .24, -.2], ['litterbin', .3, .26]]),
  saltInterpretation: site('saltcrust', '鹽地文化解說場', 'exhibit', [['saltmound', -.24, -.2], ['saltmound', .24, -.2], ['billboard', 0, .26]]),
  stargazingSite: site('drylakebed', '乾湖觀星集合地', 'circle', [['bench', -.27, -.22], ['bench', .27, -.22], ['billboard', .3, .26]]),
  clayWorkshop: site('erodedclay', '陶土戶外體驗場', 'workshop', [['marketstall', 0, -.25], ['picnictable', -.23, .2], ['crate', .26, .22]]),
  moraineLookout: site('glacialtill', '冰磧地觀景休息點', 'lookout', [['bench', 0, -.24], ['billboard', .28, .24], ['rockflat', -.27, .24]]),
  miningHeritage: site('ironstone', '礦業遺產展示地', 'exhibit', [['boulder', -.25, -.22], ['crate', .25, -.22], ['billboard', 0, .26]]),
};
for (const value of Object.values(VISITOR_SITES)) {
  const natural = LANDSCAPES[value.naturalCounterpart];
  Object.assign(value, { zone: natural.zone, length: 28, width: 22,
    color: natural.color, temperature: natural.temperature, altitude: natural.altitude });
}

export function paintVisitorSite(g, site) {
  g.save();
  const green = site.zone === 'green';
  g.strokeStyle = green ? '#c6b995' : '#c4b39c';
  g.lineWidth = .075; g.lineCap = 'round';
  // One access route with branches to each facility, never a decorative grid.
  g.beginPath(); g.moveTo(.5, .94); g.lineTo(.5, .5); g.stroke();
  for (const [, x, z] of site.equipment) {
    g.beginPath(); g.moveTo(.5, .5); g.lineTo(x + .5, z + .5); g.stroke();
  }
  const pads = ['camp', 'picnic', 'workshop', 'exhibit'];
  if (pads.includes(site.layout)) {
    g.fillStyle = site.layout === 'camp' ? '#b2a17d' : '#a8a391';
    for (const [, x, z] of site.equipment) g.fillRect(x + .41, z + .42, .18, .16);
  } else if (site.layout === 'garden') {
    for (const side of [-1, 1]) {
      g.fillStyle = '#799154'; g.beginPath(); g.ellipse(.5 + side * .22, .48, .11, .1, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#b69c76'; g.lineWidth = .012; g.stroke();
    }
  } else if (site.layout === 'circle' || site.layout === 'classroom') {
    g.fillStyle = '#b4ad98'; g.beginPath(); g.arc(.5, .5, .2, 0, Math.PI * 2); g.fill();
  } else if (site.layout === 'lookout') {
    g.fillStyle = '#b4aa94'; g.fillRect(.13, .16, .74, .19);
  }
  g.restore();
}
