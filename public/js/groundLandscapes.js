// Feature patches supplement the continuous carpet. No new shared random stream.
const green = (label, pattern, color, parts, limits = {}) => ({
  label, pattern, color, landscape: 'grassland', zone: 'green', parts, ...limits,
});
const bare = (label, pattern, color, parts, limits = {}) => ({
  label, pattern, color, landscape: 'exposed', zone: 'bare', parts, ...limits,
});
export const LANDSCAPES = {
  mossbed: green('苔蘚地', 'moss', 0x70865b, ['rockflat', 'mushroom'], { temperature: [-10, 28] }),
  cloverfield: green('三葉草地', 'clover', 0x73945e, ['flower', 'tuft']),
  fernfloor: green('蕨類林下地', 'fern', 0x61794e, ['bush', 'mushroom', 'log'], { landscape: 'woodland', temperature: [0, 35] }),
  heathland: green('石楠灌叢地', 'heath', 0x877782, ['bush', 'flower', 'pebble'], { temperature: [-15, 28] }),
  prairie: green('高草草原', 'prairie', 0x9b9f64, ['miscanthus', 'flower', 'tuft']),
  savannagrass: green('稀樹草地', 'savanna', 0xb2a36a, ['drybush', 'sapling', 'tuft'], { temperature: [15, 50] }),
  alpineflowers: green('高山花甸', 'heath', 0x849774, ['flower', 'rockflat', 'tuft'], { altitude: [1200, 5000], temperature: [-20, 20], zones: ['green', 'alpine'] }),
  wetmeadow: green('濕草甸', 'moss', 0x6e906b, ['reed', 'tuft', 'flower']),
  riparianbrush: green('河岸灌叢', 'fern', 0x6c8462, ['reed', 'bush', 'log'], { zones: ['green', 'wet'] }),
  coastalgrass: green('海岸草叢', 'prairie', 0xa0aa77, ['miscanthus', 'shell', 'tuft'], { altitude: [-20, 180] }),
  basaltfield: bare('玄武岩碎地', 'angular', 0x636568, ['boulder', 'rockflat', 'pebble']),
  volcanicash: bare('火山灰地', 'ash', 0x827d78, ['pebble', 'boulder']),
  chalkground: bare('白堊裸地', 'chalk', 0xc9c5b0, ['rockflat', 'pebble', 'drybush']),
  sanddunes: bare('風紋沙地', 'dunes', 0xd0b486, ['shell', 'drybush']),
  shinglebank: bare('礫石灘', 'shingle', 0xaaa292, ['pebble', 'rockflat', 'shell']),
  saltcrust: bare('鹽殼地', 'crust', 0xdad5c4, ['saltmound', 'pebble']),
  drylakebed: bare('乾湖床', 'cracks', 0xb3a58c, ['pebble', 'drybush']),
  erodedclay: bare('侵蝕黏土地', 'gullies', 0xb17f61, ['spoil', 'pebble', 'drybush']),
  glacialtill: bare('冰磧裸地', 'shingle', 0xaaa99e, ['boulder', 'pebble', 'rockflat'], { zones: ['bare', 'alpine'], temperature: [-50, 15] }),
  ironstone: bare('鐵質碎石地', 'angular', 0x9b6650, ['rockflat', 'pebble', 'boulder']),
};
export function paintLandscape(g, spec, rnd) {
  const p = spec.pattern;
  g.save(); g.lineWidth = .003; g.globalAlpha = .3;
  g.strokeStyle = spec.landscape === 'exposed' ? '#655e54' : '#3d6348';
  if (['dunes', 'gullies'].includes(p)) {
    const phase = rnd() * 6;
    for (let row = -1; row < 12; row++) {
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const x = i / 24, y = row / 10 + .025 * Math.sin(x * 11 + phase + row * .4);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (['cracks', 'crust'].includes(p)) {
    for (let i = 0; i < 32; i++) {
      const x = rnd(), y = rnd(), a = rnd() * Math.PI * 2;
      for (let branch = 0; branch < 3; branch++) {
        const angle = a + branch * 2.1, len = .025 + rnd() * .06;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len); g.stroke();
      }
    }
  } else {
    for (let i = 0; i < 90; i++) {
      const x = rnd(), y = rnd(), r = .006 + rnd() * .018;
      g.fillStyle = p === 'heath' ? (i % 3 ? '#7b8a58' : '#d5a1b5')
        : spec.landscape === 'exposed' ? (i % 2 ? '#ded7c4' : '#6f685e') : (i % 2 ? '#acc58a' : '#476643');
      g.beginPath();
      if (p === 'angular' || p === 'chalk') {
        g.moveTo(x - r, y); g.lineTo(x, y - r); g.lineTo(x + r, y + r * .5); g.closePath();
      } else if (p === 'fern' || p === 'prairie' || p === 'savanna') {
        g.moveTo(x, y); g.lineTo(x + r, y - r * 3); g.lineTo(x + r * .5, y); g.closePath();
      } else if (p === 'clover') {
        for (let leaf = 0; leaf < 3; leaf++) {
          const a = leaf * Math.PI * 2 / 3;
          g.moveTo(x, y); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r, 0, Math.PI * 2);
        }
      } else g.ellipse(x, y, r, r * .6, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}
