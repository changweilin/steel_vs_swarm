// ============ Mipmapped texture seam (presentation only) ============
// Single settlement point for CanvasTexture mipmap decisions. GPU sampling
// already picks a smaller prefiltered level per fragment at distance; this
// file only centralizes how those levels are requested so scattered
// `anisotropy = 4` literals do not rot into a second mip system.
//
// Boundaries:
//   - Pure presentation: server MUST NOT import. No authority state.
//   - Zero shared-RNG consumption: downsampling is a fixed box filter.
//   - WebGL2 path (three r160 default) supports NPOT mipmaps; WebGL1
//     fallback is left to three (NPOT + mipmap = clamp/linear there).
import * as THREE from 'three';

// Single anisotropy truth (replaces scattered `= 4` literals).
// 4 is the portable floor: grazing-angle facades/terrain stop shimmering,
// higher values are bandwidth cost on tile GPUs for no visible gain here.
export const MIP_ANISO = 4;
export const MIP_MIN_SIZE = 1;

/** Level count down to 1x1 inclusive (pure; Node-safe for offline audits). */
export function mipLevels(w, h) {
  const m = Math.max(1, Math.max(w | 0, h | 0));
  return Math.floor(Math.log2(m)) + 1;
}

/** Extent of a mip level (pure; floor-halve so NPOT chains stay exact). */
export function mipExtent(w, h, level) {
  const d = 2 ** Math.max(0, level | 0);
  return [Math.max(1, Math.floor(w / d)), Math.max(1, Math.floor(h / d))];
}

/** Cap a requested anisotropy against renderer max (pure). */
export function capAniso(requested, max) {
  const r = Math.max(1, requested || 0);
  return max > 0 ? Math.min(r, max) : r;
}

/** One halving step via Canvas2D box filter (deterministic, no RNG). */
export function downsampleOnce(src, w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = Math.max(1, h);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

/**
 * Pre-build the halved downsample chain for a source canvas.
 * Returns [src, half, quarter, ...] so it maps 1:1 onto
 * `tex.mipmaps` (three uploads mipmaps[0] as the base level).
 * Node (no DOM) returns [] so offline audits stay import-safe.
 */
export function buildMipChain(src, minSize = MIP_MIN_SIZE) {
  if (typeof document === 'undefined' || !src) return [];
  const out = [src];
  let w = src.width, h = src.height;
  const floor = Math.max(1, minSize | 0 || 1);
  while (w > floor || h > floor) {
    w = Math.max(floor, Math.floor(w / 2));
    h = Math.max(floor, Math.floor(h / 2));
    out.push(downsampleOnce(out[out.length - 1], w, h));
    if (w <= floor && h <= floor) break;
  }
  return out;
}

/**
 * Finish a THREE texture with the project mip defaults.
 * opts: { srgb, wrapS, wrapT, mag, min, aniso, maxAniso,
 *         generateMipmaps, needsUpdate }.
 * Callers needing cel hard edges pass mag: THREE.NearestFilter;
 * everything else stays on the trilinear + aniso path.
 */
export function finishTex(tex, opts = {}) {
  if (opts.srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.wrapS !== undefined) tex.wrapS = opts.wrapS;
  if (opts.wrapT !== undefined) tex.wrapT = opts.wrapT;
  tex.magFilter = opts.mag !== undefined ? opts.mag : THREE.LinearFilter;
  tex.minFilter = opts.min !== undefined ? opts.min : THREE.LinearMipmapLinearFilter;
  tex.anisotropy = capAniso(opts.aniso !== undefined ? opts.aniso : MIP_ANISO, opts.maxAniso);
  tex.generateMipmaps = opts.generateMipmaps !== undefined ? !!opts.generateMipmaps : true;
  if (opts.needsUpdate !== false) tex.needsUpdate = true;
  return tex;
}

/** Attach a prebuilt chain (from buildMipChain) as manual mipmaps. */
export function attachMipChain(tex, chain) {
  if (!chain || chain.length === 0) return tex;
  tex.mipmaps = chain;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** One-call construction seam for future call sites. */
export function canvasTexture(cv, opts = {}) {
  return finishTex(new THREE.CanvasTexture(cv), opts);
}
