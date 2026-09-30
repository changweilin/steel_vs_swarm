// ============ Mipmapped texture & VRAM streaming seam (presentation only) ============
// Single settlement point for CanvasTexture mipmap generation and camera-view
// texture streaming (Virtual Texturing / Mip Streaming). Only textures inside
// the camera view (frustum, unoccluded, and within the sniper scope circle when
// zoomed) keep their distance-matched resolution tier in VRAM; distant or
// off-screen / culled textures drop their top mip levels (`chain.slice(lvl)`)
// and re-allocate a low-resolution pyramid in VRAM.
//
// Boundaries:
//   - Pure presentation: server MUST NOT import. No authority state.
//   - Zero imports (same reason as lod.js / cull.js): Node offline audits import
//     and test this module directly without DOM or Three.js in node_modules.
//   - Zero shared-RNG consumption: downsampling is a deterministic box filter.
//   - WebGL2 `texStorage2D` allocates immutable dimensions per WebGLTexture;
//     `applyTexLevel` disposes the old GPU handle before slicing `tex.mipmaps`
//     so Three.js frees the old VRAM pyramid and uploads only the target tier.

// Three.js r160 numeric/string constants (avoids bare `'three'` import in Node).
const SRGB_COLOR_SPACE = 'srgb';
const LINEAR_FILTER = 1006;
const LINEAR_MIPMAP_LINEAR_FILTER = 1008;

// Single anisotropy truth (replaces scattered `= 4` literals).
// 4 is the portable floor: grazing-angle facades/terrain stop shimmering,
// higher values are bandwidth cost on tile GPUs for no visible gain here.
export const MIP_ANISO = 4;
export const MIP_MIN_SIZE = 1;

/**
 * Texture streaming thresholds (presentation only; anchored to LOD / CULL bands).
 * NEAR_M / MID_M / FAR_M mirror `LOD` in `lod.js` (150 / 300 / 600m);
 * ZOOM_F and HYST mirror `GEO` in `lod.js` (1.0 / 0.9).
 */
export const TEX_STREAM = {
  NEAR_M: 150,          // Level 0 (full resolution) inside NEAR_M
  MID_M: 300,           // Level 1 (1/2 width, 1/4 VRAM) inside MID_M
  FAR_M: 600,           // Level 2 (1/4 width, 1/16 VRAM) inside FAR_M
  MAX_DROP: 3,          // Level 3 (1/8 width, 1/64 VRAM) beyond FAR_M or invisible/culled
  MIN_RES_PX: 16,       // Resident base-mip floor (px) so UV borders never collapse
  HYST: 0.9,            // Promotion hysteresis: must enter band * HYST to upgrade
  ZOOM_F: 1.0,          // Sniper aimBlend extension: band * (1 + ZOOM_F * aimBlend)
  STRIDE: 4,            // Staggered evaluation cadence (frames; via lod.js lodDue)
  BUDGET_PER_TICK: 8,   // Max GPU texture re-allocations per frame (prevents upload spikes)
  CELL_M: 32,           // Spatial grid cell size (m) for wide static / instanced meshes
  VIRTUAL_GRID: 4,      // Default virtual-texture tile grid per axis (4x4 = 16 pages)
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v || 0);

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

/** Estimated RGBA8 VRAM bytes for mip chain starting at `topLevel` down to 1x1 (pure). */
export function vramBytesOfChain(w, h, topLevel = 0) {
  const total = mipLevels(w, h);
  const start = Math.max(0, Math.min(total - 1, topLevel | 0));
  let bytes = 0;
  for (let l = start; l < total; l++) {
    const [mw, mh] = mipExtent(w, h, l);
    bytes += mw * mh * 4;
  }
  return bytes;
}

/** Cap a requested anisotropy against renderer max (pure). */
export function capAniso(requested, max) {
  const r = Math.max(1, requested || 0);
  return max > 0 ? Math.min(r, max) : r;
}

/** One halving step via Canvas2D box filter (deterministic, no RNG; Node-safe stub). */
export function downsampleOnce(src, w, h) {
  const mw = Math.max(1, w | 0);
  const mh = Math.max(1, h | 0);
  if (typeof document === 'undefined') return { width: mw, height: mh };
  const cv = document.createElement('canvas');
  cv.width = mw;
  cv.height = mh;
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, mw, mh);
  }
  return cv;
}

/**
 * Pre-build the halved downsample chain for a source canvas.
 * Returns [src, half, quarter, ...] so it maps 1:1 onto
 * `tex.mipmaps` (three uploads mipmaps[0] as the base level).
 */
export function buildMipChain(src, minSize = MIP_MIN_SIZE) {
  if (!src || !(src.width > 0) || !(src.height > 0)) return [];
  const out = [src];
  let w = src.width | 0, h = src.height | 0;
  const floor = Math.max(1, minSize | 0 || 1);
  while (w > floor || h > floor) {
    w = Math.max(floor, Math.floor(w / 2));
    h = Math.max(floor, Math.floor(h / 2));
    out.push(downsampleOnce(out[out.length - 1], w, h));
    if (w <= floor && h <= floor) break;
  }
  return out;
}

/** Attach a prebuilt chain (from buildMipChain) as manual mipmaps. */
export function attachMipChain(tex, chain) {
  if (!tex || !chain || chain.length === 0) return tex;
  tex.mipmaps = chain;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Effective distance band (m) extended by continuous sniper zoom blend (pure). */
export function streamBandM(baseM, aimBlend = 0) {
  return Math.max(0, baseM || 0) * (1 + TEX_STREAM.ZOOM_F * clamp01(aimBlend));
}

/** Max mip levels a `(w, h)` texture may drop without shrinking below `minPx` (pure). */
export function streamMaxDrop(w, h, maxDrop = TEX_STREAM.MAX_DROP, minPx = TEX_STREAM.MIN_RES_PX) {
  const cap = Math.max(0, maxDrop | 0);
  const floor = Math.max(1, minPx | 0);
  let drop = 0;
  let cw = Math.max(1, w | 0), ch = Math.max(1, h | 0);
  while (drop < cap && cw >= floor * 2 && ch >= floor * 2) {
    cw = Math.floor(cw / 2);
    ch = Math.floor(ch / 2);
    drop++;
  }
  return drop;
}

/**
 * Resolve target mip level `0 .. maxDrop` from camera distance and visibility (pure).
 * - Invisible / culled (`!visible`, outside frustum, occluded, or outside sniper scope
 *   circle) immediately resolves to `maxDrop` (lowest resolution tier in VRAM).
 * - Visible surfaces resolve to level 0 (`<= NEAR_M`), level 1 (`<= MID_M`),
 *   level 2 (`<= FAR_M`), or `maxDrop` (`> FAR_M`), scaled by sniper `aimBlend`.
 * - Hysteresis (`TEX_STREAM.HYST`): promoting to a sharper level `<= k` from a
 *   coarser `prevLevel > k` requires entering `bandM * HYST`, preventing boundary flap.
 */
export function streamTargetLevel(
  d2,
  visible,
  aimBlend = 0,
  prevLevel = undefined,
  maxDrop = TEX_STREAM.MAX_DROP,
) {
  const cap = Math.max(0, maxDrop | 0);
  if (cap === 0) return 0;
  if (!visible || !(d2 >= 0) || !Number.isFinite(d2)) return cap;
  const nM = streamBandM(TEX_STREAM.NEAR_M, aimBlend);
  const mM = streamBandM(TEX_STREAM.MID_M, aimBlend);
  const fM = streamBandM(TEX_STREAM.FAR_M, aimBlend);
  const h = TEX_STREAM.HYST;
  const nLim = (prevLevel !== undefined && prevLevel > 0) ? nM * h : nM;
  if (d2 <= nLim * nLim) return 0;
  if (cap <= 1) return 1;
  const mLim = (prevLevel !== undefined && prevLevel > 1) ? mM * h : mM;
  if (d2 <= mLim * mLim) return 1;
  if (cap <= 2) return 2;
  const fLim = (prevLevel !== undefined && prevLevel > 2) ? fM * h : fM;
  if (d2 <= fLim * fLim) return 2;
  return cap;
}

let _nextStreamId = 1;

function _applyTexDefaults(tex, opts = {}) {
  if (opts.srgb) tex.colorSpace = SRGB_COLOR_SPACE;
  if (opts.wrapS !== undefined) tex.wrapS = opts.wrapS;
  if (opts.wrapT !== undefined) tex.wrapT = opts.wrapT;
  if (opts.mag !== undefined) tex.magFilter = opts.mag;
  else if (!tex.magFilter) tex.magFilter = LINEAR_FILTER;
  tex.minFilter = opts.min !== undefined ? opts.min : LINEAR_MIPMAP_LINEAR_FILTER;
  tex.anisotropy = capAniso(
    opts.aniso !== undefined ? opts.aniso : (tex.anisotropy > 1 ? tex.anisotropy : MIP_ANISO),
    opts.maxAniso,
  );
}

/**
 * Register a CanvasTexture for camera-view mip streaming.
 * Stores state on non-enumerable `tex.userData.texStream` so `JSON.stringify(tex.userData)`
 * inside `Texture.prototype.copy` never serializes DOM canvas nodes.
 */
export function registerStreamTex(tex, opts = {}) {
  if (!tex || tex.isDataTexture || tex.isRenderTargetTexture || tex.isDepthTexture || tex.isCompressedTexture) {
    return tex;
  }
  if (!tex.userData) tex.userData = {};
  if (tex.userData.texStream) {
    if (Array.isArray(opts.pages) && opts.pages.length > 0) registerVirtualPages(tex, opts.pages);
    return tex;
  }
  const src = tex.image;
  if (!src || !(src.width > 0) || !(src.height > 0)) return tex;
  _applyTexDefaults(tex, opts);
  const chain = (Array.isArray(opts.chain) && opts.chain.length > 0)
    ? opts.chain
    : buildMipChain(src, MIP_MIN_SIZE);
  if (chain.length === 0) return tex;
  const baseW = src.width | 0;
  const baseH = src.height | 0;
  const maxDrop = Math.min(
    streamMaxDrop(
      baseW,
      baseH,
      opts.maxDrop !== undefined ? opts.maxDrop : TEX_STREAM.MAX_DROP,
      opts.minPx !== undefined ? opts.minPx : TEX_STREAM.MIN_RES_PX,
    ),
    Math.max(0, chain.length - 1),
  );
  const id = opts.id !== undefined ? opts.id : `tex_${_nextStreamId++}`;
  const fullBytes = vramBytesOfChain(baseW, baseH, 0);
  const state = {
    id,
    sourceImage: src,
    chain,
    baseW,
    baseH,
    level: 0,
    maxDrop,
    minD2: Infinity,
    visible: false,
    stamp: -1,
    init: false,
    switches: 0,
    vramBytes: fullBytes,
    fullVramBytes: fullBytes,
    pages: null,
    pageCanvas: null,
    pageActiveVramBytes: fullBytes,
    pageFullVramBytes: fullBytes,
    refresh: () => refreshStreamTex(tex),
  };
  Object.defineProperty(tex.userData, 'texStream', {
    value: state,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  attachMipChain(tex, chain);
  if (Array.isArray(opts.pages) && opts.pages.length > 0) {
    registerVirtualPages(tex, opts.pages);
  }
  return tex;
}

/**
 * Rebuild a registered texture's mip chain after its source canvas is painted in place
 * (e.g. `terrain.js` `carveTunnels` painting corridor strokes onto `imagery.canvas`).
 */
export function refreshStreamTex(tex) {
  const st = tex?.userData?.texStream;
  if (!st || !st.sourceImage) return false;
  const chain = buildMipChain(st.sourceImage, MIP_MIN_SIZE);
  if (chain.length === 0) return false;
  st.chain = chain;
  const curLvl = Math.max(0, Math.min(st.maxDrop, st.level | 0));
  st.level = -1;
  applyTexLevel(tex, curLvl);
  return true;
}

/**
 * Partition a world-mapped texture `(baseW, baseH)` over `bounds = { minX, maxX, minZ, maxZ }`
 * into a `gridN x gridN` virtual page table (pure; deterministic, zero RNG).
 */
export function buildGridVirtualPages(
  baseW,
  baseH,
  bounds,
  gridN = TEX_STREAM.VIRTUAL_GRID,
  opts = {},
) {
  const W = Math.max(1, baseW | 0), H = Math.max(1, baseH | 0);
  const n = Math.max(1, gridN | 0);
  const minX = +bounds?.minX || 0, maxX = +bounds?.maxX || 0;
  const minZ = +bounds?.minZ || 0, maxZ = +bounds?.maxZ || 0;
  const spanX = maxX - minX, spanZ = maxZ - minZ;
  if (!(spanX > 0) || !(spanZ > 0)) return [];
  const hAt = typeof opts.heightAt === 'function' ? opts.heightAt : null;
  const projUV = typeof opts.projectUV === 'function'
    ? opts.projectUV
    : (x, z) => [(x - minX) / spanX, 1 - (z - minZ) / spanZ];
  const pages = [];
  for (let iz = 0; iz < n; iz++) {
    const z0 = minZ + (spanZ * iz) / n;
    const z1 = minZ + (spanZ * (iz + 1)) / n;
    const cz = (z0 + z1) * 0.5;
    for (let ix = 0; ix < n; ix++) {
      const x0 = minX + (spanX * ix) / n;
      const x1 = minX + (spanX * (ix + 1)) / n;
      const cx = (x0 + x1) * 0.5;
      const samples = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, cz]];
      let uLo = 1, uHi = 0, vLo = 1, vHi = 0;
      let yLo = Infinity, yHi = -Infinity;
      for (const [sx, sz] of samples) {
        const uv = projUV(sx, sz);
        const u = clamp01(uv ? uv[0] : 0);
        const v = clamp01(uv ? uv[1] : 0);
        if (u < uLo) uLo = u;
        if (u > uHi) uHi = u;
        if (v < vLo) vLo = v;
        if (v > vHi) vHi = v;
        const sy = hAt ? (+hAt(sx, sz) || 0) : 0;
        if (sy < yLo) yLo = sy;
        if (sy > yHi) yHi = sy;
      }
      if (!Number.isFinite(yLo)) { yLo = 0; yHi = 0; }
      const cy = (yLo + yHi) * 0.5;
      const r = Math.max(4, Math.hypot((x1 - x0) * 0.5, (yHi - yLo) * 0.5, (z1 - z0) * 0.5) + 2);
      const px0 = Math.max(0, Math.min(W - 1, Math.floor(uLo * W)));
      const px1 = Math.max(px0 + 1, Math.min(W, Math.ceil(uHi * W)));
      const py0 = Math.max(0, Math.min(H - 1, Math.floor((1 - vHi) * H)));
      const py1 = Math.max(py0 + 1, Math.min(H, Math.ceil((1 - vLo) * H)));
      pages.push({
        id: `tile_${ix}_${iz}`,
        px: px0,
        py: py0,
        pw: px1 - px0,
        ph: py1 - py0,
        u0: uLo,
        v0: vLo,
        u1: uHi,
        v1: vHi,
        x: cx,
        y: cy,
        z: cz,
        r,
      });
    }
  }
  return pages;
}

/**
 * Attach virtual texture pages `[{ px, py, pw, ph, u0, v0, u1, v1, x, y, z, r }]`
 * to a stream-registered texture so each UV / world region streams at its own
 * camera-view and distance resolution tier.
 */
export function registerVirtualPages(tex, pages) {
  const st = tex?.userData?.texStream;
  if (!st || !Array.isArray(pages) || pages.length === 0) return tex;
  const W = st.baseW, H = st.baseH;
  const list = [];
  let sumFull = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p) continue;
    let px = p.px, py = p.py, pw = p.pw, ph = p.ph;
    if (!(pw > 0 && ph > 0)) {
      const u0 = clamp01(Math.min(p.u0 ?? 0, p.u1 ?? 1));
      const u1 = clamp01(Math.max(p.u0 ?? 0, p.u1 ?? 1));
      const v0 = clamp01(Math.min(p.v0 ?? 0, p.v1 ?? 1));
      const v1 = clamp01(Math.max(p.v0 ?? 0, p.v1 ?? 1));
      px = Math.max(0, Math.min(W - 1, Math.floor(u0 * W)));
      py = Math.max(0, Math.min(H - 1, Math.floor((1 - v1) * H)));
      pw = Math.max(1, Math.min(W - px, Math.ceil((u1 - u0) * W)));
      ph = Math.max(1, Math.min(H - py, Math.ceil((v1 - v0) * H)));
    } else {
      px = Math.max(0, Math.min(W - 1, px | 0));
      py = Math.max(0, Math.min(H - 1, py | 0));
      pw = Math.max(1, Math.min(W - px, pw | 0));
      ph = Math.max(1, Math.min(H - py, ph | 0));
    }
    const minTilePx = Math.min(TEX_STREAM.MIN_RES_PX, Math.max(2, Math.min(pw, ph) >> st.maxDrop));
    const pageMaxDrop = Math.min(st.maxDrop, streamMaxDrop(pw, ph, st.maxDrop, minTilePx));
    const fullBytes = vramBytesOfChain(pw, ph, 0);
    sumFull += fullBytes;
    list.push({
      id: p.id !== undefined ? p.id : `${st.id}_p${list.length}`,
      index: list.length,
      px,
      py,
      pw,
      ph,
      u0: px / W,
      v0: 1 - (py + ph) / H,
      u1: (px + pw) / W,
      v1: 1 - py / H,
      x: +p.x || 0,
      y: +p.y || 0,
      z: +p.z || 0,
      r: Math.max(2, +p.r || 4),
      level: 0,
      maxDrop: pageMaxDrop,
      minD2: Infinity,
      visible: false,
      stamp: -1,
      switches: 0,
      vramBytes: fullBytes,
      fullVramBytes: fullBytes,
    });
  }
  if (list.length > 0) {
    st.pages = list;
    st.pageFullVramBytes = sumFull || st.fullVramBytes;
    st.pageActiveVramBytes = st.pageFullVramBytes;
  }
  return tex;
}

/**
 * Record one virtual page's camera visibility and squared distance for `frame`.
 * Also forwards demand to the parent texture so its base mip ceiling tracks the
 * sharpest visible page.
 */
export function notePageDemand(tex, pageIndex, d2, visible, frame) {
  const st = tex?.userData?.texStream;
  const p = st?.pages?.[pageIndex | 0];
  if (!p) return;
  if (p.stamp !== frame) {
    p.stamp = frame;
    p.visible = !!visible;
    p.minD2 = visible && d2 >= 0 ? d2 : Infinity;
  } else if (visible) {
    p.visible = true;
    if (d2 >= 0 && d2 < p.minD2) p.minD2 = d2;
  }
  noteTexDemand(tex, d2, visible, frame);
}

/**
 * Switch a registered texture's resident VRAM mip pyramid to `targetLevel`.
 * Calls `tex.dispose()` prior to replacing `tex.image` and `tex.mipmaps` because
 * WebGL2 `texStorage2D` dimensions are immutable per `WebGLTexture` handle:
 * disposing deletes the previous GPU texture and forces Three.js to allocate a
 * new `WebGLTexture` sized to `chain[lvl]` (`baseW >> lvl`, `baseH >> lvl`).
 */
export function applyTexLevel(tex, targetLevel) {
  const st = tex?.userData?.texStream;
  if (!st || !Array.isArray(st.chain) || st.chain.length === 0) return false;
  const lvl = Math.max(0, Math.min(st.maxDrop, targetLevel | 0));
  if (lvl === st.level && Array.isArray(tex.mipmaps) && tex.mipmaps[0] === st.chain[lvl]) {
    return false;
  }
  const sub = st.chain.slice(lvl);
  if (sub.length === 0) return false;
  if (typeof tex.dispose === 'function') tex.dispose();
  tex.image = sub[0];
  attachMipChain(tex, sub);
  st.level = lvl;
  st.switches++;
  st.vramBytes = vramBytesOfChain(st.baseW, st.baseH, lvl);
  return true;
}

/**
 * Evaluate and apply per-page resolution tiers for a virtual-paged texture.
 * Pages inside the camera view load their distance-matched tier (`0 / 1 / 2`),
 * while distant (`> FAR_M`) or invisible/culled/occluded pages drop to `maxDrop`.
 */
export function applyPageLevels(tex, aimBlend = 0, frame = -1) {
  const st = tex?.userData?.texStream;
  const pages = st?.pages;
  if (!st || !Array.isArray(pages) || pages.length === 0) return 0;
  let pageSwitched = 0;
  let minLvl = st.maxDrop;
  let maxLvl = 0;
  let activePageBytes = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const vis = p.stamp === frame ? p.visible : false;
    const d2 = vis ? p.minD2 : Infinity;
    const target = streamTargetLevel(d2, vis, aimBlend, p.level, p.maxDrop);
    if (target !== p.level) {
      p.level = target;
      p.vramBytes = vramBytesOfChain(p.pw, p.ph, target);
      p.switches++;
      pageSwitched++;
    }
    if (p.level < minLvl) minLvl = p.level;
    if (p.level > maxLvl) maxLvl = p.level;
    activePageBytes += p.vramBytes;
  }
  minLvl = Math.max(0, Math.min(st.maxDrop, minLvl));
  st.pageActiveVramBytes = activePageBytes;
  const lvlChanged = minLvl !== st.level;
  if (!pageSwitched && !lvlChanged) return 0;

  if (minLvl === maxLvl || typeof document === 'undefined') {
    applyTexLevel(tex, minLvl);
  } else {
    const [rw, rh] = mipExtent(st.baseW, st.baseH, minLvl);
    let cv = st.pageCanvas;
    if (!cv || cv.width !== rw || cv.height !== rh) {
      cv = document.createElement('canvas');
      cv.width = rw;
      cv.height = rh;
      st.pageCanvas = cv;
    }
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      const bg = st.chain[Math.min(st.chain.length - 1, maxLvl)];
      if (bg) ctx.drawImage(bg, 0, 0, rw, rh);
      for (let lvl = maxLvl; lvl >= minLvl; lvl--) {
        const srcImg = st.chain[Math.min(st.chain.length - 1, lvl)];
        if (!srcImg) continue;
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          if (p.level !== lvl) continue;
          const sx = Math.floor(p.px / (2 ** lvl));
          const sy = Math.floor(p.py / (2 ** lvl));
          const sw = Math.max(1, Math.floor(p.pw / (2 ** lvl)));
          const sh = Math.max(1, Math.floor(p.ph / (2 ** lvl)));
          const dx = Math.floor(p.px / (2 ** minLvl));
          const dy = Math.floor(p.py / (2 ** minLvl));
          const dw = Math.max(1, Math.floor(p.pw / (2 ** minLvl)));
          const dh = Math.max(1, Math.floor(p.ph / (2 ** minLvl)));
          ctx.drawImage(srcImg, sx, sy, sw, sh, dx, dy, dw, dh);
        }
      }
    }
    const sub = buildMipChain(cv, MIP_MIN_SIZE);
    if (lvlChanged && typeof tex.dispose === 'function') tex.dispose();
    tex.image = sub[0];
    attachMipChain(tex, sub);
    st.level = minLvl;
    st.switches++;
  }
  const ratio = st.pageFullVramBytes > 0 ? activePageBytes / st.pageFullVramBytes : 1;
  st.vramBytes = Math.min(
    vramBytesOfChain(st.baseW, st.baseH, minLvl),
    Math.max(vramBytesOfChain(st.baseW, st.baseH, st.maxDrop), Math.round(st.fullVramBytes * ratio)),
  );
  return pageSwitched || (lvlChanged ? 1 : 0);
}

/**
 * Finish a THREE texture with the project mip defaults and register for streaming.
 * opts: { srgb, wrapS, wrapT, mag, min, aniso, maxAniso,
 *         generateMipmaps, needsUpdate, stream }.
 * Callers needing cel hard edges pass mag: THREE.NearestFilter;
 * everything else stays on the trilinear + aniso path.
 */
export function finishTex(tex, opts = {}) {
  if (!tex) return tex;
  _applyTexDefaults(tex, opts);
  tex.generateMipmaps = opts.generateMipmaps !== undefined ? !!opts.generateMipmaps : true;
  if (opts.stream !== false) registerStreamTex(tex, opts);
  if (opts.needsUpdate !== false) tex.needsUpdate = true;
  return tex;
}

/** One-call construction seam for CanvasTexture call sites. */
export function canvasTexture(cv, CtorOrOpts = {}, maybeOpts = undefined) {
  const isFn = typeof CtorOrOpts === 'function';
  const opts = (isFn ? maybeOpts : CtorOrOpts) || {};
  const Ctor = (isFn ? CtorOrOpts : opts.Ctor) || globalThis.THREE?.CanvasTexture;
  const tex = Ctor ? new Ctor(cv) : { image: cv, isTexture: true, isCanvasTexture: true, mipmaps: [], userData: {} };
  return finishTex(tex, opts);
}

/** Collect stream-registered textures from a single Material (`map`, `emissiveMap`, `paint.tex`). */
export function collectMatStreamTexs(mat, out = []) {
  if (!mat) return out;
  const slots = [
    mat.map,
    mat.emissiveMap,
    mat.userData?.celOpts?.paint?.tex,
  ];
  for (const t of slots) {
    if (t?.userData?.texStream && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Traverse an Object3D subtree and collect all unique stream-registered textures. */
export function collectTreeStreamTexs(root, out = []) {
  if (!root || typeof root.traverse !== 'function') return out;
  root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) {
      for (const sub of m) collectMatStreamTexs(sub, out);
    } else {
      collectMatStreamTexs(m, out);
    }
    const st = o.userData?.signTex;
    if (st?.userData?.texStream && !out.includes(st)) out.push(st);
  });
  return out;
}

/**
 * Build world-space bounding-sphere anchors `[{ x, y, z, r }]` for a mesh.
 * Localized meshes produce one sphere; wide / instanced meshes are bucketed into
 * `cellM` grid cells so off-screen or distant regions do not pin a shared texture
 * at level 0 when the camera is looking elsewhere.
 */
export function meshStreamAnchors(mesh, cellM = TEX_STREAM.CELL_M) {
  if (!mesh) return [];
  const cs = Math.max(8, cellM || TEX_STREAM.CELL_M);
  const me = mesh.matrixWorld?.elements;
  const transformPt = (lx, ly, lz) => {
    if (!me) {
      const p = mesh.position || { x: 0, y: 0, z: 0 };
      return [lx + (p.x || 0), ly + (p.y || 0), lz + (p.z || 0)];
    }
    return [
      me[0] * lx + me[4] * ly + me[8] * lz + me[12],
      me[1] * lx + me[5] * ly + me[9] * lz + me[13],
      me[2] * lx + me[6] * ly + me[10] * lz + me[14],
    ];
  };
  const bucketPoints = (pts, baseR = 1.5) => {
    const cells = new Map();
    for (let i = 0; i < pts.length; i += 3) {
      const wx = pts[i], wy = pts[i + 1], wz = pts[i + 2];
      if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) continue;
      const kx = Math.floor(wx / cs), kz = Math.floor(wz / cs);
      const key = `${kx},${kz}`;
      let c = cells.get(key);
      if (!c) {
        c = { minX: wx, maxX: wx, minY: wy, maxY: wy, minZ: wz, maxZ: wz };
        cells.set(key, c);
      } else {
        if (wx < c.minX) c.minX = wx;
        if (wx > c.maxX) c.maxX = wx;
        if (wy < c.minY) c.minY = wy;
        if (wy > c.maxY) c.maxY = wy;
        if (wz < c.minZ) c.minZ = wz;
        if (wz > c.maxZ) c.maxZ = wz;
      }
    }
    const out = [];
    for (const c of cells.values()) {
      const cx = (c.minX + c.maxX) * 0.5;
      const cy = (c.minY + c.maxY) * 0.5;
      const cz = (c.minZ + c.maxZ) * 0.5;
      const dx = (c.maxX - c.minX) * 0.5;
      const dy = (c.maxY - c.minY) * 0.5;
      const dz = (c.maxZ - c.minZ) * 0.5;
      const r = Math.max(baseR, Math.hypot(dx, dy, dz) + baseR);
      out.push({ x: cx, y: cy, z: cz, r });
    }
    return out;
  };

  if (mesh.isInstancedMesh && mesh.instanceMatrix?.array && mesh.count > 0) {
    const arr = mesh.instanceMatrix.array;
    const n = mesh.count | 0;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const base = i * 16;
      const [wx, wy, wz] = transformPt(arr[base + 12], arr[base + 13], arr[base + 14]);
      pts.push(wx, wy, wz);
    }
    if (pts.length > 0) return bucketPoints(pts, 2.5);
  }

  const pos = mesh.geometry?.attributes?.position;
  if (pos && pos.count > 0) {
    const n = pos.count | 0;
    const step = Math.max(1, Math.floor(n / 4096));
    const pts = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i += step) {
      const lx = pos.getX ? pos.getX(i) : pos.array[i * 3];
      const ly = pos.getY ? pos.getY(i) : pos.array[i * 3 + 1];
      const lz = pos.getZ ? pos.getZ(i) : pos.array[i * 3 + 2];
      const [wx, wy, wz] = transformPt(lx, ly, lz);
      if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) continue;
      pts.push(wx, wy, wz);
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
    }
    if (pts.length > 0) {
      const span = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5;
      if (span <= cs * 0.5) {
        return [{
          x: (minX + maxX) * 0.5,
          y: (minY + maxY) * 0.5,
          z: (minZ + maxZ) * 0.5,
          r: Math.max(1.5, span),
        }];
      }
      return bucketPoints(pts, 2);
    }
  }

  const [wx, wy, wz] = transformPt(0, 0, 0);
  const r = Math.max(2, mesh.geometry?.boundingSphere?.radius || 4);
  return [{ x: wx, y: wy, z: wz, r }];
}

/**
 * Record one consumer's visibility and squared distance for `frame`.
 * Across multiple meshes sharing a texture, any visible consumer marks the
 * texture visible for `frame`, and the minimum visible `d2` wins.
 */
export function noteTexDemand(tex, d2, visible, frame) {
  const st = tex?.userData?.texStream;
  if (!st) return;
  if (st.stamp !== frame) {
    st.stamp = frame;
    st.visible = !!visible;
    st.minD2 = visible && d2 >= 0 ? d2 : Infinity;
    return;
  }
  if (visible) {
    st.visible = true;
    if (d2 >= 0 && d2 < st.minD2) st.minD2 = d2;
  }
}

/**
 * Evaluate registered textures for `frame` and apply resident mip / virtual-page switches.
 * - `opts.isDue`: stagger predicate `(frame, id, stride) => bool` (caller passes `lodDue`).
 * - `opts.forceAll`: bypass stagger and budget (used on frame 0 before first render).
 * - Newly registered textures (`!st.init`) also evaluate immediately without budget cap
 *   so mid-battle spawns never upload a full-res pyramid when distant or off-screen.
 */
export function flushTexStream(textures, frame, aimBlend = 0, opts = {}) {
  const stride = opts.stride !== undefined ? opts.stride : TEX_STREAM.STRIDE;
  const budget = opts.budget !== undefined ? opts.budget : TEX_STREAM.BUDGET_PER_TICK;
  const forceAll = !!opts.forceAll;
  const isDue = opts.isDue;
  const maxAniso = opts.maxAniso > 0 ? opts.maxAniso : 0;
  const pending = [];
  let switched = 0;
  let pageSwitched = 0;

  for (const tex of textures || []) {
    const st = tex?.userData?.texStream;
    if (!st) continue;
    if (maxAniso > 0 && tex.anisotropy > maxAniso) {
      tex.anisotropy = capAniso(tex.anisotropy, maxAniso);
    }
    const firstSight = !st.init;
    if (!forceAll && !firstSight && stride > 1 && typeof isDue === 'function' && !isDue(frame, st.id, stride)) {
      continue;
    }
    st.init = true;
    if (Array.isArray(st.pages) && st.pages.length > 0) {
      const ps = applyPageLevels(tex, aimBlend, frame);
      if (ps > 0) {
        pageSwitched += ps;
        switched++;
      }
      continue;
    }
    const vis = st.stamp === frame ? st.visible : false;
    const d2 = vis ? st.minD2 : Infinity;
    const target = streamTargetLevel(d2, vis, aimBlend, st.level, st.maxDrop);
    if (target !== st.level) {
      if (forceAll || firstSight) {
        if (applyTexLevel(tex, target)) switched++;
      } else {
        pending.push({ tex, st, target, d2 });
      }
    }
  }

  if (pending.length > 1) {
    // Urgent close promotions first (lowest d2), then largest-VRAM demotions.
    pending.sort((a, b) => {
      const aUp = a.target < a.st.level ? 0 : 1;
      const bUp = b.target < b.st.level ? 0 : 1;
      if (aUp !== bUp) return aUp - bUp;
      if (aUp === 0) return a.d2 - b.d2;
      return b.st.vramBytes - a.st.vramBytes;
    });
  }

  const limit = Math.max(0, budget | 0);
  let budgetedSwitched = 0;
  for (let i = 0; i < pending.length && budgetedSwitched < limit; i++) {
    if (applyTexLevel(pending[i].tex, pending[i].target)) {
      budgetedSwitched++;
      switched++;
    }
  }

  let total = 0, pageTotal = 0, activeVramBytes = 0, fullVramBytes = 0;
  const counts = [0, 0, 0, 0];
  const pageCounts = [0, 0, 0, 0];
  for (const tex of textures || []) {
    const st = tex?.userData?.texStream;
    if (!st) continue;
    total++;
    activeVramBytes += st.vramBytes;
    fullVramBytes += st.fullVramBytes;
    const bucket = Math.min(3, Math.max(0, st.level | 0));
    counts[bucket]++;
    if (Array.isArray(st.pages)) {
      for (let i = 0; i < st.pages.length; i++) {
        pageTotal++;
        const pb = Math.min(3, Math.max(0, st.pages[i].level | 0));
        pageCounts[pb]++;
      }
    }
  }

  return {
    total,
    switched,
    pageTotal,
    pageSwitched,
    activeVramBytes,
    fullVramBytes,
    savedVramBytes: Math.max(0, fullVramBytes - activeVramBytes),
    counts,
    pageCounts,
  };
}


