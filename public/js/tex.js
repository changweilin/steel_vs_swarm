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
  CELL_M: 64,           // Spatial grid cell size (m) for wide static / instanced meshes
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
  if (tex.userData.texStream) return tex;
  const src = tex.image;
  if (!src || !(src.width > 0) || !(src.height > 0)) return tex;
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
    chain,
    baseW,
    baseH,
    level: 0,
    maxDrop,
    minD2: Infinity,
    visible: false,
    stamp: -1,
    switches: 0,
    vramBytes: fullBytes,
    fullVramBytes: fullBytes,
  };
  Object.defineProperty(tex.userData, 'texStream', {
    value: state,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  attachMipChain(tex, chain);
  return tex;
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
 * Finish a THREE texture with the project mip defaults and register for streaming.
 * opts: { srgb, wrapS, wrapT, mag, min, aniso, maxAniso,
 *         generateMipmaps, needsUpdate, stream }.
 * Callers needing cel hard edges pass mag: THREE.NearestFilter;
 * everything else stays on the trilinear + aniso path.
 */
export function finishTex(tex, opts = {}) {
  if (!tex) return tex;
  if (opts.srgb) tex.colorSpace = SRGB_COLOR_SPACE;
  if (opts.wrapS !== undefined) tex.wrapS = opts.wrapS;
  if (opts.wrapT !== undefined) tex.wrapT = opts.wrapT;
  tex.magFilter = opts.mag !== undefined ? opts.mag : LINEAR_FILTER;
  tex.minFilter = opts.min !== undefined ? opts.min : LINEAR_MIPMAP_LINEAR_FILTER;
  tex.anisotropy = capAniso(opts.aniso !== undefined ? opts.aniso : MIP_ANISO, opts.maxAniso);
  tex.generateMipmaps = opts.generateMipmaps !== undefined ? !!opts.generateMipmaps : true;
  if (opts.stream !== false) registerStreamTex(tex, opts);
  if (opts.needsUpdate !== false) tex.needsUpdate = true;
  return tex;
}

/** One-call construction seam for CanvasTexture call sites. */
export function canvasTexture(cv, opts = {}) {
  const Ctor = opts.Ctor || globalThis.THREE?.CanvasTexture;
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
  const bucketPoints = (pts, baseR = 2) => {
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
    if (pts.length > 0) return bucketPoints(pts, 4);
  }

  const pos = mesh.geometry?.attributes?.position;
  if (pos && pos.count > 0) {
    const n = pos.count | 0;
    const step = Math.max(1, Math.floor(n / 512));
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
      if (span <= cs) {
        return [{
          x: (minX + maxX) * 0.5,
          y: (minY + maxY) * 0.5,
          z: (minZ + maxZ) * 0.5,
          r: Math.max(2, span),
        }];
      }
      return bucketPoints(pts, 4);
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
 * Evaluate registered textures for `frame` and apply resident mip switches.
 * - `opts.isDue`: stagger predicate `(frame, id, stride) => bool` (caller passes `lodDue`).
 * - `opts.forceAll`: bypass stagger and budget (used on frame 0 before first render
 *   so distant/off-screen textures never upload their full-res pyramid to VRAM).
 */
export function flushTexStream(textures, frame, aimBlend = 0, opts = {}) {
  const stride = opts.stride !== undefined ? opts.stride : TEX_STREAM.STRIDE;
  const budget = opts.budget !== undefined ? opts.budget : TEX_STREAM.BUDGET_PER_TICK;
  const forceAll = !!opts.forceAll;
  const isDue = opts.isDue;
  const pending = [];

  for (const tex of textures || []) {
    const st = tex?.userData?.texStream;
    if (!st) continue;
    if (!forceAll && stride > 1 && typeof isDue === 'function' && !isDue(frame, st.id, stride)) {
      continue;
    }
    const vis = st.stamp === frame ? st.visible : false;
    const d2 = vis ? st.minD2 : Infinity;
    const target = streamTargetLevel(d2, vis, aimBlend, st.level, st.maxDrop);
    if (target !== st.level) {
      pending.push({ tex, st, target, d2 });
    }
  }

  if (pending.length > 1 && !forceAll) {
    // Urgent close promotions first (lowest d2), then largest-VRAM demotions.
    pending.sort((a, b) => {
      const aUp = a.target < a.st.level ? 0 : 1;
      const bUp = b.target < b.st.level ? 0 : 1;
      if (aUp !== bUp) return aUp - bUp;
      if (aUp === 0) return a.d2 - b.d2;
      return b.st.vramBytes - a.st.vramBytes;
    });
  }

  const limit = forceAll ? pending.length : Math.max(0, budget | 0);
  let switched = 0;
  for (let i = 0; i < pending.length && switched < limit; i++) {
    if (applyTexLevel(pending[i].tex, pending[i].target)) switched++;
  }

  let total = 0, activeVramBytes = 0, fullVramBytes = 0;
  const counts = [0, 0, 0, 0];
  for (const tex of textures || []) {
    const st = tex?.userData?.texStream;
    if (!st) continue;
    total++;
    activeVramBytes += st.vramBytes;
    fullVramBytes += st.fullVramBytes;
    const bucket = Math.min(3, Math.max(0, st.level | 0));
    counts[bucket]++;
  }

  return {
    total,
    switched,
    activeVramBytes,
    fullVramBytes,
    savedVramBytes: Math.max(0, fullVramBytes - activeVramBytes),
    counts,
  };
}

