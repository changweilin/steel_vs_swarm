import { paintVenue, paintTrack, paintBasketball } from './groundMarkings.js';
import { LANDSCAPES, paintLandscape } from './groundLandscapes.js';
import { VISITOR_SITES, paintVisitorSite } from './groundVisitorSites.js';
import { mulberry32 } from './rng.js';
import { forestEnvironment, forestSeed } from './forest.js';
import { DEFS, SURFACES, SURFACE_LIMITS } from './groundCatalog.js';
export { forestSeed as groundSeed } from './forest.js';

const sample = (r, [a, b]) => a + r() * (b - a);
const within = (v, [a, b]) => v >= a && v <= b;
export function surfaceEnvironment(input = {}) {
  const latitude = Number.isFinite(input.latitude) ? Math.max(-90, Math.min(90, input.latitude)) : 25;
  const altitude = Number.isFinite(input.altitude) ? input.altitude : 0;
  const season = SURFACE_LIMITS.seasons.includes(input.season) ? input.season : 'summer';
  const env = forestEnvironment(latitude, altitude, input);
  const temperature = env.temperature + { spring: 0, summer: 6, autumn: -3, winter: -12 }[season];
  return { ...env, latitude, altitude, temperature, season,
    climate: input.climate || (temperature < 0 ? 'alpine' : Math.abs(latitude) > 55 ? 'boreal' : temperature > 22 ? 'tropical' : 'temperate'),
    weather: SURFACE_LIMITS.weather.includes(input.weather) ? input.weather : 'clear',
    geology: SURFACE_LIMITS.geology.includes(input.geology) ? input.geology : 'unknown' };
}

export function surfaceAllowed(id, env) {
  const spec = SURFACES[id];
  return !!spec && within(env.latitude, spec.latitude) && within(env.altitude, spec.altitude)
    && within(env.temperature, spec.temperature);
}

export function surfaceParameters(id, seed, x, z) {
  const spec = SURFACES[id];
  if (!spec) throw new RangeError(`Unknown surface ${id}`);
  const rnd = mulberry32(forestSeed(x, z, seed));
  return { widthScale: sample(rnd, SURFACE_LIMITS.widthScale),
    aspect: (DEFS[id].aspect || .7) * (spec.locked ? 1 : sample(rnd, SURFACE_LIMITS.aspectScale)),
    density: sample(rnd, SURFACE_LIMITS.detailDensity),
    lightness: sample(rnd, SURFACE_LIMITS.colorLightness) };
}

// Probe the rotated footprint, including corners and interior; never flatten authority terrain.
export function probeSurface(heightAt, x, z, r, rot, def, spec, gridM = 2) {
  if (![x, z, r, rot].every(Number.isFinite) || r <= 0) return false;
  const hw = r, hd = def.shape === 'rect' ? r * (def.aspect || .7) : r;
  const step = Math.min(2, Number.isFinite(gridM) && gridM > 0 ? gridM : 2);
  const nx = Math.ceil(hw * 2 / step), nz = Math.ceil(hd * 2 / step);
  const ca = Math.cos(rot), sa = Math.sin(rot);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const lx = -hw + 2 * hw * i / nx, lz = -hd + 2 * hd * j / nz;
    const h = heightAt(x + ca * lx - sa * lz, z + sa * lx + ca * lz);
    if (!Number.isFinite(h) || (!def.aq && h < .45)) return false;
    min = Math.min(min, h); max = Math.max(max, h);
    if (max - min > Math.min(spec.flat ?? Infinity, r * def.slope)) return false;
  }
  return true;
}

export function paintGround(g, size, id, seed, env, baseColor) {
  const spec = SURFACES[id];
  if (!spec) throw new RangeError(`Unknown surface ${id}`);
  const rnd = mulberry32(seed), base = baseColor ?? spec.color;
  const wear = sample(rnd, SURFACE_LIMITS.wear);
  const wet = ['rain', 'storm'].includes(env.weather);
  const snow = env.temperature < 2 && env.weather === 'snow';
  const seasonal = spec.landscape === 'grassland' || spec.landscape === 'woodland' || spec.landscape === 'cultivated';
  const factor = (wet ? .8 : 1) * (seasonal && env.season === 'winter' ? .88 : 1);
  const rgb = [base >> 16 & 255, base >> 8 & 255, base & 255].map(v => Math.round(v * factor));
  if (seasonal && env.season === 'autumn') { rgb[0] = Math.min(255, rgb[0] + 26); rgb[1] = Math.max(0, rgb[1] - 12); }
  g.fillStyle = `rgb(${rgb})`; g.fillRect(0, 0, size, size);
  g.save(); g.scale(size, size);
  const line = (x, y, a, b) => { g.beginPath(); g.moveTo(x, y); g.lineTo(a, b); g.stroke(); };
  g.lineWidth = .005;
  // Low-frequency fragments, with sediment hue controlled by the known lithology.
  const mineral = { basalt: '#46545d', granite: '#a5a2a0', limestone: '#d1c4a0', sandstone: '#c29864', alluvium: '#887055' };
  for (let i = 0, n = Math.round(50 + wear * 300); i < n; i++) {
    g.globalAlpha = wear * (.4 + rnd() * .6) * (['venue', 'court', 'track'].includes(spec.pattern) ? .2 : 1);
    g.fillStyle = snow ? '#edf4f7' : mineral[env.geology] || (rnd() < .5 ? '#f2deb0' : '#36493d');
    const x = rnd(), y = rnd(), a = .008 + rnd() * .07;
    g.beginPath(); g.ellipse(x, y, a, a * (.15 + rnd() * .55), rnd() * 6.28, 0, 6.28); g.fill();
  }
  g.globalAlpha = 1;
  if (id === 'fishpond') {
    g.strokeStyle = { spring: '#95b6a3', summer: '#afc9b5', autumn: '#9bac96', winter: '#b9c9d4' }[env.season];
    for (let i = 0, n = { spring: 12, summer: 20, autumn: 9, winter: 4 }[env.season]; i < n; i++) {
      g.beginPath(); g.ellipse(rnd(), rnd(), .025 + rnd() * .035, .012, 0, 0, 6.28); g.stroke();
    }
  }
  if (seasonal) {
    const n = { spring: 32, summer: 48, autumn: 25, winter: 9 }[env.season];
    for (let i = 0; i < n; i++) {
      const x = rnd(), y = rnd();
      g.fillStyle = { spring: '#e9b6bf', summer: '#a7ba65', autumn: '#c7954e', winter: '#d4dbcb' }[env.season];
      g.beginPath(); g.ellipse(x, y, env.season === 'autumn' ? .018 : .007, .005, rnd() * 6.28, 0, 6.28); g.fill();
    }
  }
  g.strokeStyle = '#dce2c9';
  const pattern = spec.pattern;
  if (VISITOR_SITES[id]) {
    paintVisitorSite(g, VISITOR_SITES[id]);
  } else if (LANDSCAPES[id]) {
    paintLandscape(g, spec, rnd);
  } else if (pattern === 'venue') {
    paintVenue(g, id);
  } else if (pattern === 'rows' && !['pasture', 'greenhouse'].includes(id)) {
    g.globalAlpha = .25;
    for (let i = 1; i < 9; i++) line(.04, i / 9, .96, i / 9);
    g.globalAlpha = 1;
  } else if (id === 'parking') {
    // Two rows of stalls separated by an unmarked circulation aisle.
    for (let i = 0; i <= 8; i++) {
      const x = .08 + i * .105; line(x, .06, x, .32); line(x, .68, x, .94);
    }
    line(.08, .06, .92, .06); line(.08, .94, .92, .94);
  } else if (id === 'brick' || id === 'pavement') {
    g.strokeStyle = '#79766d'; g.lineWidth = .002;
    for (let row = 0; row < 12; row++) {
      line(0, row / 12, 1, row / 12);
      for (let col = 0; col < 8; col++) {
        const x = (col + (row % 2) / 2) / 8; line(x, row / 12, x, (row + 1) / 12);
      }
    }
  } else if (pattern === 'court') {
    paintBasketball(g);
  } else if (pattern === 'track') {
    paintTrack(g);
  } else if (pattern === 'helipad') {
    g.beginPath(); g.arc(.5, .5, .36, 0, 6.28); g.stroke();
  } else if (!['managed', 'built'].includes(spec.landscape)) {
    g.globalAlpha = .35;
    for (let i = 0; i < 55; i++) {
      const x = rnd(), y = rnd();
      line(x, y, x + .015 + rnd() * .045, y + (pattern === 'ripples' ? 0 : .025));
    }
    g.globalAlpha = 1;
  }
  // Functional text is kept inside the perimeter; natural surfaces never receive lettering.
  if (spec.text.length) {
    g.fillStyle = '#f2ebd8'; g.font = `bold ${pattern === 'helipad' ? .35 : .045}px sans-serif`;
    g.textAlign = 'center'; g.fillText(spec.text[Math.floor(rnd() * spec.text.length)], .5, pattern === 'helipad' ? .62 : .065);
  }
  if (['built', 'managed'].includes(spec.landscape) && !['visitor', 'venue', 'court', 'track', 'helipad'].includes(pattern)) {
    const count = Math.floor(sample(rnd, SURFACE_LIMITS.graffiti));
    g.lineWidth = .007; g.globalAlpha = .5;
    for (let i = 0; i < count; i++) {
      g.strokeStyle = ['#eea751', '#69c3c0', '#d485a8'][Math.floor(rnd() * 3)];
      const x = .1 + rnd() * .75;
      line(x, .96, x + .015, .93); line(x + .015, .93, x + .04, .96);
    }
  }
  g.restore();
}


