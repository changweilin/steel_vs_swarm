// Weather history is simulation state; geometry and collision remain unchanged.
import { dayHourRate } from './data.js';

const clamp = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
export const WEATHER_SURFACE = Object.freeze({ rainS: 90, snowS: 150, sandS: 180,
  drainS: 120, meltS: 240, disperseS: 180, delay: .08, strikeR: 5, flatGrade: .18 });

export function stepWeatherSurface(previous = {}, dyn = {}, dt = 0) {
  const seconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const rain = clamp(dyn.effectiveRain), snow = clamp(dyn.effectiveSnow), sand = clamp(dyn.effectiveSand);
  const wind = clamp((dyn.wind || 0) / 100), cfg = WEATHER_SURFACE;
  const step = (key, input, fillS, dryS, capacity = input) => {
    const old = clamp(previous[key]);
    // Approach an intensity-dependent capacity; doubling the frame rate preserves history.
    const rate = input > 0 ? input / fillS : 1 / dryS;
    return clamp(capacity + (old - capacity) * Math.exp(-seconds * rate));
  };
  return { water: step('water', rain, cfg.rainS, cfg.drainS),
    snow: step('snow', snow, cfg.snowS, cfg.meltS, snow > 0 ? 1 : 0),
    sand: step('sand', sand, cfg.sandS, cfg.disperseS / (1 + wind * 4)) };
}

export function weatherSurfaceCover(value) {
  return clamp((clamp(value) - WEATHER_SURFACE.delay) / (1 - WEATHER_SURFACE.delay));
}

export function weatherSurfaceCoverMax(surface = {}) {
  const water = weatherSurfaceCover(surface?.water ?? surface?.puddle);
  const snow = weatherSurfaceCover(surface?.snow);
  return Math.max(water, snow);
}

export function weatherGroundSlowFactor(surface = {}) {
  return 1.0 - 0.25 * weatherSurfaceCoverMax(surface);
}

export function weatherJumpHeightFactor(surface = {}) {
  return 1.0 - 0.25 * weatherSurfaceCoverMax(surface);
}

export function weatherJumpVelocityFactor(surface = {}) {
  return Math.sqrt(weatherJumpHeightFactor(surface));
}

export function weatherGroundAttackRateFactor(surface = {}) {
  const sand = weatherSurfaceCover(surface?.sand ?? surface?.dune);
  return 1.0 - 0.25 * sand;
}

export const lightningFireSeconds = () => 24 / dayHourRate();
export const lightningFireWet = dyn => (dyn?.effectiveRain || 0) > 0 || (dyn?.effectiveSnow || 0) > 0;

// Absolute expiries detect both new statuses and refreshes without countdown noise.
export function lightningStatus(entity, now) {
  const values = [];
  for (const key of ['empUntil', 'blindUntil', 'stunUntil', 'slowUntil', 'confUntil', 'supUntil', 'markUntil', 'unbalUntil',
    'stealthUntil', 'invUntil', 'phaseUntil', 'reflectUntil', 'rootedUntil', 'shieldExpandUntil', 'shieldDefBoostUntil',
    'shieldBashUntil', 'noReloadUntil', 'noLightReloadUntil', 'noHeavyReloadUntil', 'clonesUntil', 'defJumpUntil']) {
    if (entity[key] > now) values.push(`${key}:${entity[key]}`);
  }
  if (entity.bleed?.until > now) values.push(`bleed:${entity.bleed.until}`);
  for (const [key, until] of Object.entries(entity.buffs || {})) if (until > now) values.push(`${key}:${until}`);
  for (const mod of entity.mods || []) if (mod.until > now) values.push(`${mod.k}:${mod.m}:${mod.until}`);
  return values;
}

export function clearLightningScorch(entity, now) {
  const burn = entity.lightningScorch;
  if (!burn) return;
  const states = lightningStatus(entity, now);
  if (entity.dead || entity.hp >= entity.maxHp || entity.hp > burn.hp || states.some(s => !burn.states.includes(s))) {
    delete entity.lightningScorch;
  } else burn.hp = entity.hp;
}
