// ============================================================
// Temporal Anti-Aliasing & Dynamic Resolution Scaling (TAA / DRS)
// Pure zero-import single seam for Halton sub-pixel camera jitter,
// temporal history blend/sharpen weights, and scene-complexity-aware
// dynamic resolution scaling governance.
// ============================================================

export const TAA = Object.freeze({
  SAMPLES: 8,           // 8-phase Halton(2, 3) sub-pixel jitter cycle
  JITTER_SCALE: 0.75,   // Baseline sub-pixel jitter amplitude in pixels
  JITTER_DRS_GAIN: 0.35,// Extra jitter coverage when DRS lowers render scale (< 1.0)
  BASE_ALPHA: 0.86,     // Stationary history accumulation weight
  DRS_ALPHA_BOOST: 0.06,// Extra temporal accumulation under reduced resolution
  MIN_ALPHA: 0.55,      // Minimum history weight under fast camera/depth motion
  MAX_ALPHA: 0.93,      // Upper bound to prevent stale-frame lock-in
  MOTION_SCALE: 18.0,   // UV velocity attenuation factor for history confidence
  GAMMA_STATIC: 1.25,   // YCoCg variance clip box width (stationary)
  GAMMA_MOTION: 0.75,   // Tighter YCoCg variance clip box under motion
  SHARP_BASE: 0.14,     // Baseline post-TAA micro-contrast restoration
  SHARP_DRS_GAIN: 0.38, // Additional sharpening as _resScale drops toward MIN
});

export const DRS = Object.freeze({
  MIN: 0.7,             // Minimum dynamic render scale (乘在 _dpr() 天花板上)
  MAX: 1.0,             // Native render scale ceiling
  STEP: 0.1,            // Baseline resolution step quantum
  MAX_DOWN_STEP: 0.2,   // Accelerated down-step under severe complexity + frame drop
  HI_MS: 20,            // Down-scale trigger (< 50 fps)
  LO_MS: 17.2,          // Up-scale recovery threshold (60Hz vsync 滿速有餘裕)
  EMA: 0.1,             // Frame-time exponential moving average weight
  HOLD_S: 0.8,          // Baseline hold duration before stepping
  FAST_HOLD_S: 0.45,    // Shortened hold duration when complexity & frame time spike
  COOL_S: 3,            // Initial cooldown (s) before stepping up
  FAIL_S: 6,            // Window (s) after raise within which a drop doubles cooldown
  COOL_MAX: 24,         // Exponential backoff ceiling (s)
  FLIP_MAX: 4,          // Direction reversals before locking scale for the match
  SPIKE_MS: 80,         // Ignore tab-switch / GC stalls above this ms
  // Scene complexity normalization budgets
  CALLS_REF: 160,       // Draw calls reference budget
  TRIS_REF: 90000,      // Triangle count reference budget
  ENTS_REF: 45,         // Active units/buildings reference budget
  FX_REF: 60,           // Active projectiles/VFX particles reference budget
  COMPLEXITY_MS_GAIN: 0.24, // Max frame-time pressure amplification at complexity=1
  RECOVER_MARGIN_MS: 2.2,   // Tighter recovery margin when scene complexity stays high
});

/**
 * Radical inverse in the given integer base for low-discrepancy Halton sequence.
 * Pure deterministic function; index is 1-based (index <= 0 returns 0).
 */
export function halton(index, base) {
  let i = index | 0;
  const b = base | 0;
  if (i <= 0 || b < 2) return 0;
  let result = 0;
  let f = 1 / b;
  while (i > 0) {
    result += f * (i % b);
    i = (i / b) | 0;
    f /= b;
  }
  return result;
}

/**
 * Compute sub-pixel camera jitter in pixel units `[-0.5, 0.5] * scale` for a given frame index.
 * Increases sub-pixel sampling coverage slightly when DRS scales resolution below 1.0
 * so temporal accumulation reconstructs sub-pixel edges across historical frames.
 */
export function taaJitterPx(frameIndex, resScale = 1.0) {
  const idx = (((frameIndex | 0) % TAA.SAMPLES) + TAA.SAMPLES) % TAA.SAMPLES + 1;
  const s = Number.isFinite(resScale) ? Math.max(DRS.MIN, Math.min(1, resScale)) : 1;
  const amp = TAA.JITTER_SCALE + (1 - s) * TAA.JITTER_DRS_GAIN;
  const jx = (halton(idx, 2) - 0.5) * amp;
  const jy = (halton(idx, 3) - 0.5) * amp;
  return [jx, jy];
}

/**
 * Convert pixel-space camera jitter `(jxPx, jyPx)` into NDC projection matrix offsets
 * for `projectionMatrix.elements[8]` and `projectionMatrix.elements[9]`.
 */
export function taaProjectionOffset(jxPx, jyPx, width, height) {
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const jx = Number.isFinite(jxPx) ? jxPx : 0;
  const jy = Number.isFinite(jyPx) ? jyPx : 0;
  return [(2 * jx) / w, (2 * jy) / h];
}

/**
 * Compute temporal history blend factor `alpha` in `[TAA.MIN_ALPHA, TAA.MAX_ALPHA]`.
 * Lower `resScale` increases history accumulation to recover sub-pixel detail;
 * screen-space motion (`uvSpeed` in UV units/frame) attenuates `alpha` to suppress ghosting.
 */
export function taaBlendAlpha(resScale = 1.0, uvSpeed = 0.0) {
  const s = Number.isFinite(resScale) ? Math.max(DRS.MIN, Math.min(1, resScale)) : 1;
  const v = Number.isFinite(uvSpeed) && uvSpeed > 0 ? uvSpeed : 0;
  const base = TAA.BASE_ALPHA + (1 - s) * TAA.DRS_ALPHA_BOOST;
  const atten = 1 / (1 + v * TAA.MOTION_SCALE);
  const a = base * atten;
  return Math.max(TAA.MIN_ALPHA, Math.min(TAA.MAX_ALPHA, a));
}

/**
 * Compute post-TAA contrast-adaptive sharpening strength.
 * Compensates for temporal filter softness and upscaling blur when DRS lowers `_resScale`.
 */
export function taaSharpenWeight(resScale = 1.0) {
  const s = Number.isFinite(resScale) ? Math.max(DRS.MIN, Math.min(1, resScale)) : 1;
  const deficit = (1 - s) / Math.max(0.01, 1 - DRS.MIN);
  return TAA.SHARP_BASE + Math.max(0, Math.min(1, deficit)) * TAA.SHARP_DRS_GAIN;
}

/**
 * Compute normalized scene complexity `[0, 1]` from render info and active simulation counts.
 */
export function drsComplexity(stats = {}, cfg = DRS) {
  if (!stats || typeof stats !== 'object') return 0;
  const calls = stats.calls > 0 ? stats.calls : 0;
  const tris = stats.triangles > 0 ? stats.triangles : 0;
  const ents = stats.entities > 0 ? stats.entities : 0;
  const fx = stats.effects > 0 ? stats.effects : 0;

  const cScore = Math.min(1, calls / (cfg.CALLS_REF || DRS.CALLS_REF));
  const tScore = Math.min(1, tris / (cfg.TRIS_REF || DRS.TRIS_REF));
  const eScore = Math.min(1, ents / (cfg.ENTS_REF || DRS.ENTS_REF));
  const fScore = Math.min(1, fx / (cfg.FX_REF || DRS.FX_REF));

  const raw = cScore * 0.35 + tScore * 0.30 + eScore * 0.20 + fScore * 0.15;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Compute complexity-weighted effective frame time (ms).
 * Only amplifies frame times above `LO_MS` so high-complexity scenes that are already
 * running comfortably above 70 fps never falsely trigger down-scaling, while borderline
 * or dropping frame rates react faster when scene load spikes.
 */
export function drsEffectiveMs(ms, complexity = 0, cfg = DRS) {
  if (!(ms > 0) || !Number.isFinite(ms)) return 0;
  const c = Number.isFinite(complexity) ? Math.max(0, Math.min(1, complexity)) : 0;
  const lo = cfg.LO_MS || DRS.LO_MS;
  if (ms <= lo) return ms;
  const gain = cfg.COMPLEXITY_MS_GAIN ?? DRS.COMPLEXITY_MS_GAIN;
  const excess = ms - lo;
  return lo + excess * (1 + c * gain);
}

/**
 * Compute adaptive down-scale step size (`[STEP, MAX_DOWN_STEP]`).
 * Scales down by a double quantum (`0.2`) when both frame-time pressure and scene
 * complexity are simultaneously severe, stabilizing FPS in fewer steps.
 */
export function drsStepDown(emaMs, complexity = 0, cfg = DRS) {
  const base = cfg.STEP || DRS.STEP;
  const maxStep = cfg.MAX_DOWN_STEP || DRS.MAX_DOWN_STEP;
  const hi = cfg.HI_MS || DRS.HI_MS;
  const c = Number.isFinite(complexity) ? Math.max(0, Math.min(1, complexity)) : 0;
  if (!(emaMs > hi)) return base;
  const overload = Math.min(1, (emaMs - hi) / Math.max(1, hi * 0.45));
  if (overload * 0.65 + c * 0.35 >= 0.72) return maxStep;
  return base;
}

/**
 * Compute required hold duration (seconds) before triggering a down-scale step.
 * High scene complexity paired with elevated frame time shortens the hold window
 * (`FAST_HOLD_S` vs `HOLD_S`) so DRS sheds pixel load before stutter compounds.
 */
export function drsHoldS(emaMs, complexity = 0, cfg = DRS) {
  const baseHold = cfg.HOLD_S || DRS.HOLD_S;
  const fastHold = cfg.FAST_HOLD_S || DRS.FAST_HOLD_S;
  const hi = cfg.HI_MS || DRS.HI_MS;
  const c = Number.isFinite(complexity) ? Math.max(0, Math.min(1, complexity)) : 0;
  if (!(emaMs > hi)) return baseHold;
  const severity = Math.min(1, ((emaMs - hi) / Math.max(1, hi * 0.5)) * 0.5 + c * 0.5);
  return baseHold - severity * (baseHold - fastHold);
}

/**
 * Compute complexity-guarded recovery threshold (ms) for stepping resolution back up.
 * While scene complexity remains high, requires slightly more frame-time headroom
 * before restoring resolution to avoid immediate oscillation during combat waves.
 */
export function drsRecoverLoMs(complexity = 0, cfg = DRS) {
  const lo = cfg.LO_MS || DRS.LO_MS;
  const margin = cfg.RECOVER_MARGIN_MS ?? DRS.RECOVER_MARGIN_MS;
  const c = Number.isFinite(complexity) ? Math.max(0, Math.min(1, complexity)) : 0;
  return lo - c * margin;
}
