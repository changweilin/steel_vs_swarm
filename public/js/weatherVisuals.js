// Presentation profiles consume resolved dynamics; gameplay thresholds stay in data.js.
export const WEATHER_FX = Object.freeze({
  cloudTypes: Object.freeze(['cirrus', 'cumulus', 'stratus', 'cumulonimbus']),
  cloudClusters: 12, cloudsPerCluster: 6,
  box: 180, height: 120, lowPowerScale: .5,
  particles: Object.freeze({ rain: 1600, snow: 1200, sand: 1400 }),
  snowFineParticles: 1800,
  fogGrid: 8, fogTileM: 22,
  lightningSegments: 24, lightningBranches: 5, lightningBranchSegments: 7,
});

const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const mix = (a, b, t) => a + (b - a) * t;
const ramp = (a, b, t) => { const x = unit((t - a) / (b - a)); return x * x * (3 - 2 * x); };

export function resolveWeatherVisuals(dyn = {}, out = {}) {
  const rain = unit(dyn.effectiveRain), snow = unit(dyn.effectiveSnow), sand = unit(dyn.effectiveSand);
  const thunder = unit(dyn.effectiveThunder), clouds = unit(dyn.clouds / 100), fog = unit(dyn.fog / 100);
  const wind = unit(dyn.wind / 100);
  const storm = ramp(.25, .85, Math.max(rain, snow, thunder));
  const overcast = ramp(.35, .9, clouds);
  const c = out.clouds ||= {};
  c.coverage = clouds;
  c.cirrus = (1 - overcast) * (1 - storm) * clouds;
  c.cumulus = clouds * (1 - storm * .8) * (1 - overcast * .6);
  c.stratus = clouds * overcast * (1 - storm * .45);
  c.cumulonimbus = clouds * storm;
  c.scale = mix(.8, 2.8, clouds);
  c.altitude = mix(.3, .08, fog);
  c.darkness = unit(dyn.cloudDarkness);
  c.storm = storm;

  const f = out.fog ||= {};
  f.strength = unit(dyn.effectiveFog);
  f.density = Math.pow(f.strength, .7);
  f.opacity = .24 * Math.sqrt(f.strength);
  f.height = mix(2, 14, ramp(.15, 1, f.strength));
  f.size = mix(24, 42, f.strength);
  f.drift = mix(.15, 4, wind);
  f.turbulence = mix(.15, 1.4, wind) * f.strength;

  const w = out.wind ||= {};
  w.strength = wind;
  w.lean = ramp(.25, .9, wind) * .85;
  w.flutter = ramp(.45, 1, wind) * .16;
  w.gust = mix(.18, 1, wind);
  w.gustSpeed = mix(.55, 1.7, wind);

  const water = out.water ||= {};
  water.crest = ramp(.3, 1, wind) * .65;
  water.cross = mix(.08, .3, wind);
  water.chop = ramp(.35, .95, wind);

  for (const [kind, strength] of Object.entries({ rain, snow, sand })) {
    const p = out[kind] ||= {};
    p.strength = strength;
    p.density = Math.pow(strength, .8);
    p.opacity = strength === 0 ? 0 : mix(.18, .78, Math.sqrt(strength));
    p.gust = ramp(.35, 1, strength) * wind;
    if (kind === 'rain') {
      p.speed = mix(38, 95, strength);
      p.width = mix(.025, .065, strength);
      p.size = mix(.5, 2.8, strength);
      p.drift = mix(3, 30, wind);
      p.turbulence = p.gust * 1.8;
      p.veil = ramp(.4, 1, strength) * .23;
    } else if (kind === 'snow') {
      p.speed = mix(2.5, 8, strength);
      p.width = 1;
      p.size = mix(.22, .65, strength) * (1 - p.gust * .45);
      p.drift = mix(.5, 18, wind) * mix(.5, 1.4, strength);
      p.turbulence = mix(1, 5, strength) + p.gust * 4;
      p.veil = ramp(.45, 1, strength) * .3;
      p.fine = ramp(.35, 1, strength);
    } else {
      p.speed = mix(1.5, 4, strength);
      p.width = mix(1, 2.8, p.gust);
      p.size = mix(.09, .28, strength);
      p.drift = mix(5, 35, strength) * mix(.6, 1.4, wind);
      p.turbulence = mix(1, 8, strength);
      p.veil = ramp(.2, 1, strength) * .22;
    }
  }
  const l = out.lightning ||= {};
  l.strength = thunder;
  l.segments = Math.round(mix(10, WEATHER_FX.lightningSegments, thunder));
  l.branches = Math.round(mix(1, WEATHER_FX.lightningBranches, thunder));
  l.duration = mix(.18, .42, thunder);
  l.width = mix(.12, .45, thunder);
  l.glow = mix(6, 18, thunder);
  return out;
}
