// The selected point anchors the search, while both bases follow nearby roads.
// Rank the complete bounded scan before retaining the best battle frames.
import { MAPGEO, battleRect, llToXZ, xzToLL, targetDistFor, sideMFor, overlapCellM, laneTacticsXZ, tacticalScore, laneCssColor, MOTHER_LANES, laneSubsetFor } from './data.js';
import { MAP_SELECT_TEXT as TEXT, mapCandidateLabel } from './mapSelectContent.js';
import { MAP_RULE_VERSION, mapGeometryAudit } from './mapRules.js';
import { MAP_RULE_TEXT } from './mapRulesContent.js';
import { traceRoadEvidence, roadFingerprint, laneFingerprint, makeTerrainAssessment, validTerrainAssessment } from './roadEvidence.js';
import { validMapSources } from './mapSourceValidation.js';
import { OSM_ROAD_QUERY_VERSION } from './osmQuery.js';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const R_EARTH = 6371000;
const PLACE_NAME_TIMEOUT_MS = 5000;

// ---- 幾何工具(equirectangular,5km 內誤差可忽略)----
function toMeters(p, origin) {
  const [x, z] = llToXZ(...p, { lat: origin[0], lng: origin[1], rot: 0 });
  return [x * MAPGEO.REAL_SCALE, -z * MAPGEO.REAL_SCALE];
}
function distM(a, b) {
  const [x, z] = toMeters(b, a);
  return Math.hypot(x, z);
}
function destPoint(origin, bearingDeg, d) {
  const br = bearingDeg * Math.PI / 180;
  return xzToLL(Math.sin(br) * d / MAPGEO.REAL_SCALE, -Math.cos(br) * d / MAPGEO.REAL_SCALE,
    { lat: origin[0], lng: origin[1], rot: 0 });
}
function midPoint(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
/** 戰場方框四角(經緯度,含地圖主方位旋轉);預覽框 MUST 與 terrain/sim 同吃 `battleRect`。 */
function battleFrameLL(cfg) {
  const r = battleRect(cfg);
  return [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]]
    .map(([x, z]) => xzToLL(x, z, cfg.center));
}

/** 路徑戰術指標(座標序列 [lat,lng] → 遊戲世界公尺後交給共用判定)。
 *  ÷REAL_SCALE:與伺服器 sim._laneTurns(遊戲世界公尺)同尺度,轉角密度一致。 */
function laneTactics(coords, origin) {
  const s = 1 / MAPGEO.REAL_SCALE;
  return laneTacticsXZ(coords.map((c) => { const [x, z] = toMeters(c, origin); return [x * s, z * s]; }));
}

/** 一組兵線的綜合戰術評分 + 摘要(彎曲度/轉角密度取各線平均) */
function lanesTactics(lanes, origin, maxOverlap) {
  let sinu = 0, tpk = 0;
  for (const lane of lanes) {
    const t = laneTactics(lane, origin);
    sinu += t.sinuosity; tpk += t.turnsPerKm;
  }
  sinu /= lanes.length; tpk /= lanes.length;
  return { sinuosity: sinu, turnsPerKm: tpk, score: tacticalScore(sinu, tpk, maxOverlap) };
}

/** OSRM 路線(座標序列 [lat,lng]);失敗回 null */
async function osrmRoute(waypoints, signal, { hints = null, availability = null } = {}) {
  const coordStr = waypoints.map(w => w[1].toFixed(6) + ',' + w[0].toFixed(6)).join(';');
  const radiuses = waypoints.map(() => MAPGEO.CUSTOM_SEARCH.MAX_SNAP_FRAC * targetDistFor(MOTHER_LANES) * MAPGEO.REAL_SCALE).join(';');
  const url = OSRM_BASE + '/' + coordStr + '?overview=full&geometries=geojson&steps=false&alternatives=2&annotations=nodes,distance,duration'
    + '&radiuses=' + radiuses + (hints ? '&hints=' + hints.join(';') : '');
  const ctrl = new AbortController(), abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) ctrl.abort();
  const timer = setTimeout(abort, MAPGEO.CUSTOM_SEARCH.REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    const data = await resp.json();
    if (['NoRoute', 'NoSegment'].includes(data.code)) { if (availability) availability.replies++; return null; }
    if (!resp.ok) throw new Error('route service');
    if (availability) availability.replies++;
    if (data.code !== 'Ok' || !Array.isArray(data.routes)) return null;
    const routes = data.routes.map(r => {
      const raw = r.geometry?.coordinates, nodes = r.legs?.flatMap(leg => leg.annotation?.nodes || []);
      if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12000 || !Number.isFinite(r.distance) || r.distance <= 0
        || raw.some(c => !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) >= 85)
        || !Array.isArray(nodes) || nodes.length < 2 || nodes.some(n => !Number.isSafeInteger(n) || n <= 0)) return null;
      return { coords: raw.map(c => [c[1], c[0]]), dist: r.distance, nodes,
        hints: data.waypoints?.map(p => p.hint || '') || [], dataVersion: data.data_version || 'unknown' };
    }).filter(Boolean);
    return routes.length ? { ...routes[0], alternatives: routes.slice(1) } : null;
  } catch {
    if (availability && !signal?.aborted) availability.failures++;
    return null;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sourceTask(factory, signal) {
  return new Promise(resolve => {
    let finished = false, timer;
    const finish = value => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value);
    };
    const abort = () => finish(null);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { finish(null); return; }
    timer = setTimeout(abort, MAPGEO.CUSTOM_SEARCH.SOURCE_TIMEOUT_MS);
    Promise.resolve().then(factory).then(finish, () => finish(null));
  });
}

// ---- 高程取樣(terrarium 磚):兵線選路避開陡坡(Part 3)。輕量、不依賴 THREE ----
const TERRARIUM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
function loadImg(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const finish = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      img.onload = img.onerror = null;
      error ? reject(error) : resolve(img);
    };
    const abort = () => finish(new Error('elev tile timeout or abort'));
    const timer = setTimeout(abort, MAPGEO.CUSTOM_SEARCH.REQUEST_TIMEOUT_MS);
    img.crossOrigin = 'anonymous';
    img.onload = () => finish(null);
    img.onerror = () => finish(new Error('elev tile'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    img.src = url;
  });
}
/** Incomplete relief omits the candidate rather than bypassing its grade gate. */
async function fetchElevSampler(bbox, signal) {
  const z = 12;
  const tx0 = Math.floor(lon2tx(bbox.minLng, z)), tx1 = Math.floor(lon2tx(bbox.maxLng, z));
  const ty0 = Math.floor(lat2ty(bbox.maxLat, z)), ty1 = Math.floor(lat2ty(bbox.minLat, z));
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
  if (cols < 1 || rows < 1 || cols * rows > 12) return null;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256; canvas.height = rows * 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    await Promise.all(Array.from({ length: cols * rows }, (_, i) => {
      const cx = i % cols, cy = (i / cols) | 0;
      return loadImg(TERRARIUM(z, tx0 + cx, ty0 + cy), signal).then((img) => ctx.drawImage(img, cx * 256, cy * 256));
    }));
  } catch { return null; }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const W = canvas.width, H = canvas.height;
  return (lat, lng) => {
    const px = Math.round((lon2tx(lng, z) - tx0) * 256), py = Math.round((lat2ty(lat, z) - ty0) * 256);
    if (px < 0 || py < 0 || px >= W || py >= H) return null;
    const k = (py * W + px) * 4;
    return data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
  };
}
// 側翼兵線的候選側移距離(兩堡距離的倍率):由近到遠試,
// 太近會被幹道「吸走」與中路重合,太遠繞路過長。
const OFFSET_FRACS = [MAPGEO.LANE_OFFSET_FRAC, 0.45, 0.62];

/** Compare bounded routing alternatives against the connected source graph and shared rules. */
async function buildLanes(A, B, signal, directRoute, roads) {
  if (!directRoute || !roads?.length) return [];
  const d = distM(A, B), [vx, vz] = toMeters(B, A), len = Math.hypot(vx, vz) || 1;
  const viaOf = (side, frac) => {
    const midpoint = midPoint(A, B), off = d * frac * side;
    return [midpoint[0] + off * vx / len / R_EARTH * 180 / Math.PI,
      midpoint[1] - off * vz / len / (R_EARTH * Math.cos(A[0] * Math.PI / 180)) * 180 / Math.PI];
  };
  const source = { provider: 'overpass', version: 'road-query-' + OSM_ROAD_QUERY_VERSION,
    fingerprint: roadFingerprint(roads), checkedAt: new Date().toISOString() };
  const proofFor = route => traceRoadEvidence(route.coords, roads, { kind: 'osrm', source: {
    ...source, routing: { provider: 'https://router.project-osrm.org', version: 'v1/driving',
      dataVersion: route.dataVersion, nodes: route.nodes },
  } });
  const middle = [directRoute, ...directRoute.alternatives].map(route => ({ route, proof: proofFor(route) })).filter(r => r.proof);
  const flank = async side => {
    const options = [];
    for (const frac of OFFSET_FRACS) {
      if (signal.aborted) return [];
      await sleep(MAPGEO.CUSTOM_SEARCH.REQUEST_GAP_MS);
      const r = await osrmRoute([A, viaOf(side, frac), B], signal,
        { hints: [directRoute.hints[0] || '', '', directRoute.hints.at(-1) || ''] });
      if (!r) continue;
      for (const route of [r, ...r.alternatives]) {
        if (options.some(o => laneFingerprint(o.route.coords) === laneFingerprint(route.coords))) continue;
        const proof = proofFor(route);
        if (proof) options.push({ route, proof });
      }
    }
    return options;
  };
  const top = await flank(1), bottom = await flank(-1);
  const results = [];
  for (const t of top) for (const m of middle) for (const b of bottom) {
    const all3 = [t.route.coords, m.route.coords, b.route.coords], center = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2, rot: 0 };
    const cfg = { center, bases: { SWARM: A, STEEL: B }, lanes: all3, motherLanes: all3,
      laneIds: [0, 1, 2], laneCount: MOTHER_LANES, sizeM: sideMFor(MOTHER_LANES) };
    const audit = mapGeometryAudit(cfg, 5);
    if (!audit.ok) continue;
    results.push({ all3, lanes: all3, roadSources: [t.proof, m.proof, b.proof], roadDist: m.route.dist,
      ...audit.metrics, synthetic: false, syntheticCount: 0 });
  }
  return results;
}

// ============ Leaflet 選址畫面 ============
export class MapSelect {
  /**
   * handlers: { status(text, frac), candidates(list), confirmReady(cfg|null) }
   */
  constructor(containerId, handlers) {
    this.h = handlers;
    this.anchor = null;          // Search center [lat, lng], independent of either base.
    this.candidates = [];
    this.chosen = null;
    this.venue = null;           // 使用中的預設場地(含 mix),自訂點為 null
    this._layers = [];
    this._searchAbort = null;
    this.placeNameSkips = 0;
    this.placeNameLastSkipped = false;

    // 圖層來源沿用 mapping_elf mapManager 的 TILE_LAYERS 設定
    this.map = L.map(containerId, { zoomControl: true, attributionControl: true })
      .setView([25.033, 121.565], 13);
    const layers = {
      '街道圖 OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }),
      '地形圖 OpenTopo': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)',
      }),
      '衛星影像 Esri': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Tiles © Esri',
      }),
    };
    layers['街道圖 OSM'].addTo(this.map);
    L.control.layers(layers, {}, { position: 'topright' }).addTo(this.map);

    this.map.on('click', (e) => this._onClick([e.latlng.lat, e.latlng.lng]));

    // 嘗試定位到使用者附近
    navigator.geolocation?.getCurrentPosition(
      (pos) => this.map.setView([pos.coords.latitude, pos.coords.longitude], 13),
      () => {}, { timeout: 3000 },
    );
  }

  destroy() {
    this._searchAbort?.abort();
    this.map.stop();          // 中止進行中的 pan/zoom 動畫,避免 remove 後回呼摸到已拆的 DOM
    this.map.remove();
  }

  resetPlaceNameStats() {
    this.placeNameSkips = 0;
    this.placeNameLastSkipped = false;
  }

  /** 兵線數(固定三線母體,與人數無關) */
  get laneCount() { return MOTHER_LANES; }
  /** 兩堡目標距離:母體框架恆取三線(與人數無關) */
  get targetDist() { return targetDistFor(MOTHER_LANES); }

  /** 純預覽已存好的戰場設定(我的最愛):畫主堡/兵線/邊界,不重新搜尋 */
  showConfig(cfg) {
    this.reset();
    this._addLayer(L.circleMarker(cfg.bases.SWARM, {
      radius: 10, color: '#ffb300', fillColor: '#ffb300', fillOpacity: 0.9, weight: 3,
    }).bindTooltip('◆ 蜂群主堡', { permanent: true, direction: 'top' }), 'fav');
    this._addLayer(L.circleMarker(cfg.bases.STEEL, {
      radius: 10, color: '#4fc3f7', fillColor: '#4fc3f7', fillOpacity: 0.9, weight: 3,
    }).bindTooltip('◆ 鋼鐵主堡', { permanent: true, direction: 'top' }), 'fav');
    cfg.lanes.forEach((lane, i) => {
      this._addLayer(L.polyline(lane, { color: laneCssColor(cfg.laneIds?.[i] ?? i), weight: 4, opacity: 0.85 }), 'fav');
    });
    this._addLayer(L.polygon(battleFrameLL(cfg), { color: '#8899aa', weight: 2, dashArray: '8 6', fill: false }), 'fav');
    this.map.fitBounds(L.latLngBounds([cfg.bases.SWARM, cfg.bases.STEEL]).pad(0.25), { animate: false });
  }

  /** 預設場地:跳到該地標並自動落錨開始搜尋 */
  placeAnchor(venue) {
    this.reset();
    this._pendingVenue = venue || null;
    this.map.setView(venue.ll, 13);
    this._onClick([venue.ll[0], venue.ll[1]]);
  }

  _clearLayers(tag) {
    this._layers = this._layers.filter((l) => {
      if (!tag || l._svsTag === tag) { this.map.removeLayer(l); return false; }
      return true;
    });
  }
  _addLayer(layer, tag) {
    layer._svsTag = tag;
    layer.addTo(this.map);
    this._layers.push(layer);
    return layer;
  }

  async _onClick(latlng) {
    this._searchAbort?.abort();
    this.anchor = latlng;
    this.chosen = null;
    this.candidates = [];
    this.venue = this._pendingVenue || null;   // 手動點圖 = 自訂場地(無 mix)
    this._pendingVenue = null;
    this._clearLayers();
    this.h.confirmReady?.(null);
    this.h.candidates?.([], -1);
    this._addLayer(L.circleMarker(latlng, {
      radius: 7, color: '#ffffff', fillColor: '#8899aa', fillOpacity: 0.6, weight: 2,
    }).bindTooltip(TEXT.center, { permanent: true, direction: 'top' }), 'anchor');
    await this._search();
  }

  // Verified connected sources precede geometry, terrain and preference scoring.
  _candidate(A, B, result, elev, bearing, anchor, offline = false) {
    const { all3: mother, roadSources } = result;
    const sizeM = sideMFor(MOTHER_LANES);
    const center = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2, rot: 0 };
    const cfg = { center, bases: { SWARM: A, STEEL: B }, lanes: mother, motherLanes: mother,
      laneIds: [0, 1, 2], laneCount: MOTHER_LANES, sizeM, roadSources, roadMode: 'real', synthetic: false,
      mapRuleVersion: MAP_RULE_VERSION };
    const audit = mapGeometryAudit(cfg, 5);
    if (!audit.ok || !elev) return null;
    cfg.roadTerrain = makeTerrainAssessment(cfg, (x, z) => elev(...xzToLL(x, z, center)));
    if (!validTerrainAssessment(cfg) || !validMapSources(cfg)) return null;
    const { distM: dist, diagM, maxOverlap, overlaps, balance } = audit.metrics;
    const synthetic = false, syntheticCount = 0;

    const S = MAPGEO.CUSTOM_SEARCH;
    const clamp = v => Math.max(0, Math.min(1, v));
    const distanceFit = clamp(1 - Math.abs(dist - this.targetDist) / this.targetDist);
    const separationFit = clamp(1 - Math.max(maxOverlap / MAPGEO.MAX_OVERLAP,
      balance.maxOverlap / MAPGEO.LANE_BALANCE_OV_MAX));
    const balanceFit = clamp(1 - balance.lenErr / MAPGEO.LANE_BALANCE_LEN_TOL);
    const detourFit = clamp(1 - Math.max(0, balance.outerRatio - 1) / (MAPGEO.LANE_BALANCE_OUTER_MAX - 1));
    const distanceM = distM(anchor, midPoint(A, B));
    const proximityFit = clamp(1 - distanceM / (this.targetDist * MAPGEO.REAL_SCALE * (S.CENTER_OFFSET_FRAC + S.MAX_SNAP_FRAC)));
    const times = cfg.roadTerrain.times;
    const timeFit = clamp(1 - Math.abs(times[0] - times[2]) / ((times[0] + times[2]) / 2) / MAPGEO.LANE_BALANCE_LEN_TOL);
    const gradeFit = clamp(1 - cfg.roadTerrain.maxGrade / Math.tan(MAPGEO.MAX_ROAD_GRADE_DEG * Math.PI / 180));
    const sub = laneSubsetFor(MOTHER_LANES);
    const lanes = sub.map(i => mother[i]);
    return {
      bases: { SWARM: A, STEEL: B }, lanes, motherLanes: mother, laneIds: [...sub],
      distM: dist, sizeM, diagM, maxOverlap, overlaps, synthetic, syntheticCount, offline, bearing,
      roadDist: audit.metrics.lengths[1], tactics: lanesTactics(lanes, A, maxOverlap),
      roadSources, roadTerrain: cfg.roadTerrain,
      match: {
        score: (S.W_DISTANCE * distanceFit + S.W_SEPARATION * separationFit
          + S.W_BALANCE * balanceFit + S.W_DETOUR * detourFit + S.W_PROXIMITY * proximityFit
          + S.W_TRAVEL * timeFit + S.W_GRADE * gradeFit),
        distanceM, travelTimes: times, gradeDeg: Math.atan(cfg.roadTerrain.maxGrade) * 180 / Math.PI,
      },
    };
  }

  async _search() {
    this._searching = true;
    const ctrl = this._searchAbort = new AbortController();
    const { signal } = ctrl;
    const anchor = [...this.anchor];
    const realD = this.targetDist * MAPGEO.REAL_SCALE;
    const S = MAPGEO.CUSTOM_SEARCH;
    const centers = [anchor, ...[0, 90, 180, 270].map(b => destPoint(anchor, b, realD * S.CENTER_OFFSET_FRAC))];
    const pairs = centers.flatMap(center => Array.from({ length: MAPGEO.CANDIDATE_BEARINGS / 2 }, (_, i) => {
      const bearing = i * 360 / MAPGEO.CANDIDATE_BEARINGS;
      return { bearing, A: destPoint(center, bearing + 180, realD / 2), B: destPoint(center, bearing, realD / 2) };
    }));
    const candidates = [];
    const availability = { replies: 0, failures: 0 };
    this.h.status?.(TEXT.scanning(0, pairs.length, 0), 0);
    try {
      const radius = realD * (1 + S.CENTER_OFFSET_FRAC + S.MAX_SNAP_FRAC);
      const rLat = radius / R_EARTH * 180 / Math.PI;
      const rLng = rLat / Math.cos(anchor[0] * Math.PI / 180);
      const bbox = { minLat: anchor[0] - rLat, maxLat: anchor[0] + rLat,
        minLng: anchor[1] - rLng, maxLng: anchor[1] + rLng };
      this.h.status?.(TEXT.verifying, 0);
      let roads = null;
      roads = await sourceTask(() => this.h.roads?.(bbox, signal), signal);
      if (signal.aborted || this._searchAbort !== ctrl) return;
      if (!roads?.length) { this.h.status?.(TEXT.missingSources, 1); return; }
      let elev = null;
      try {
        elev = await sourceTask(() => (this.h.elevation || fetchElevSampler)(bbox, signal), signal);
      } catch { elev = null; }
      if (signal.aborted || this._searchAbort !== ctrl) return;
      if (!elev) { this.h.status?.(TEXT.missingElevation, 1); return; }

      for (const [i, pair] of pairs.entries()) {
        if (signal.aborted) return;
        this.h.status?.(TEXT.scanning(i + 1, pairs.length, candidates.length), i / pairs.length);
        const direct = await osrmRoute([pair.A, pair.B], signal, { availability });
        await sleep(S.REQUEST_GAP_MS);
        if (signal.aborted) return;
        // NoRoute is a valid service reply, never evidence of an offline service.
        if (!availability.replies && availability.failures >= S.OFFLINE_FAILURE_LIMIT) break;
        if (!direct) continue;
        const A = direct.coords[0], B = direct.coords[direct.coords.length - 1];
        if (distM(A, pair.A) > realD * S.MAX_SNAP_FRAC || distM(B, pair.B) > realD * S.MAX_SNAP_FRAC) continue;
        const cell = overlapCellM(MOTHER_LANES);
        if (candidates.some(c => (distM(A, c.bases.SWARM) < cell && distM(B, c.bases.STEEL) < cell)
          || (distM(A, c.bases.STEEL) < cell && distM(B, c.bases.SWARM) < cell))) continue;
        const results = await buildLanes(A, B, signal, direct, roads);
        if (signal.aborted) return;
        const candidate = results.map(result => this._candidate(A, B, result, elev, pair.bearing, anchor))
          .filter(Boolean).sort((a, b) => b.match.score - a.match.score)[0];
        if (candidate) candidates.push(candidate);
      }

      if (signal.aborted || this._searchAbort !== ctrl) return;
      candidates.sort((a, b) => b.match.score - a.match.score || a.syntheticCount - b.syntheticCount
        || a.match.distanceM - b.match.distanceM || b.tactics.score - a.tactics.score);
      this.candidates = candidates.slice(0, MAPGEO.MAX_CANDIDATES);
      this.h.status?.(this.candidates.length ? TEXT.ranked : !availability.replies && availability.failures ? TEXT.offlineUnavailable : TEXT.noMatch, 1);
      if (this.candidates.length) this._choose(this.candidates[0]);
      else this.h.candidates?.([], -1);
    } catch (error) {
      if (!signal.aborted && this._searchAbort === ctrl) {
        console.error('Map search failed', error);
        this.h.status?.(TEXT.failed, 1);
      }
    } finally {
      if (this._searchAbort === ctrl) this._searching = false;
    }
  }

  _drawCandidate(cand, idx) {
    const mk = this._addLayer(L.circleMarker(midPoint(cand.bases.SWARM, cand.bases.STEEL), {
      radius: 8, color: '#4fc3f7', fillColor: '#22303a', fillOpacity: 0.5, weight: 2,
    }).bindTooltip(mapCandidateLabel(cand, idx), { direction: 'top' }), 'cand');
    mk.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      this._choose(cand);
    });
  }

  /** 選定候選的框架繪製(主堡標記 + 兵線 + 邊界;色號吃母體下標) */
  _drawChosenFrame(cand) {
    this._addLayer(L.circleMarker(cand.bases.SWARM, {
      radius: 10, color: '#ffb300', fillColor: '#ffb300', fillOpacity: 0.9, weight: 3,
    }).bindTooltip(TEXT.swarmBase, { permanent: true, direction: 'top' }), 'cand');
    this._addLayer(L.circleMarker(cand.bases.STEEL, {
      radius: 12, color: '#4fc3f7', fillColor: '#4fc3f7', fillOpacity: 0.9, weight: 3,
    }).bindTooltip(TEXT.steelBase, { permanent: true, direction: 'top' }), 'cand');

    cand.lanes.forEach((lane, i) => {
      this._addLayer(L.polyline(lane, { color: laneCssColor(cand.laneIds?.[i] ?? i), weight: 4, opacity: 0.85 })
        .bindTooltip(TEXT.lanes[cand.laneIds?.[i] ?? i] + ' · ' + MAP_RULE_TEXT.sourceKinds[cand.roadSources?.[i]?.kind || 'unverified']), 'lanes');
    });
    // 戰場邊界 = `battleRect` 唯一縫(含兵線包絡外擴與放大),與地形/伺服器同一個方框
    this._addLayer(L.polygon(battleFrameLL(this.buildConfig()), {
      color: '#8899aa', weight: 2, dashArray: '8 6', fill: false,
    }), 'lanes');
    this.map.fitBounds(L.latLngBounds([this.anchor, ...battleFrameLL(this.buildConfig())]).pad(0.1));
  }

  _choose(cand) {
    this.chosen = cand;
    this._clearLayers('lanes');
    this._clearLayers('cand');
    // 重畫其他候選為淡色
    for (const [i, c] of this.candidates.entries()) {
      if (c !== cand) this._drawCandidate(c, i);
    }
    this._drawChosenFrame(cand);

    const curIdx = this.candidates.indexOf(cand);
    this.h.candidates?.(this.candidates, curIdx);
    this.h.confirmReady?.(this.buildConfig());
  }

  selectNextCandidate() {
    if (!this.candidates || this.candidates.length <= 1) return null;
    const curIdx = Math.max(0, this.candidates.indexOf(this.chosen));
    const nextIdx = (curIdx + 1) % this.candidates.length;
    this._choose(this.candidates[nextIdx]);
    return nextIdx;
  }

  selectCandidate(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.candidates.length) return;
    this._choose(this.candidates[index]);
  }

  reset() {
    this._searchAbort?.abort();
    this._searchAbort = null;
    this._searching = false;
    this.anchor = null;
    this.chosen = null;
    this.venue = null;
    this.candidates = [];
    this._clearLayers();
    this.h.confirmReady?.(null);
    this.h.candidates?.([], -1);
    this.h.status?.(TEXT.idle, 0);
  }

  /** 組出送給伺服器的戰場設定 */
  buildConfig() {
    if (!this.anchor || !this.chosen) return null;
    const bases = this.chosen.bases;
    const c = midPoint(bases.SWARM, bases.STEEL);
    return {
      center: { lat: c[0], lng: c[1] },
      bases: { SWARM: [...bases.SWARM], STEEL: [...bases.STEEL] },
      lanes: this.chosen.lanes,          // 方向:SWARM → STEEL;三線母體固定全開
      laneCount: this.chosen.lanes.length,
      laneIds: [...(this.chosen.laneIds || this.chosen.lanes.map((_, i) => i))],
      motherLanes: (this.chosen.motherLanes || this.chosen.lanes).map((l) => l.map((p) => [...p])),
      sizeM: this.chosen.sizeM,
      diagM: this.chosen.diagM,
      distM: this.chosen.distM,
      geoScaleVer: MAPGEO.GEO_SCALE_VER,
      maxOverlap: this.chosen.maxOverlap,
      tactics: this.chosen.tactics || null,
      synthetic: this.chosen.synthetic,
      mapRuleVersion: MAP_RULE_VERSION, roadMode: 'real',
      roadSources: structuredClone(this.chosen.roadSources), roadTerrain: structuredClone(this.chosen.roadTerrain),
      venue: this.venue ? { id: this.venue.id, name: this.venue.name, mix: this.venue.mix } : null,
      placeName: this.venue?.name || `${c[0].toFixed(4)}, ${c[1].toFixed(4)}`,
    };
  }

  /** 反查地名(非必要,失敗就用座標;預設場地已有名稱直接用) */
  async fetchPlaceName(cfg) {
    if (cfg.venue?.name) {
      this.placeNameLastSkipped = false;
      return cfg;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PLACE_NAME_TIMEOUT_MS);
    let skipped = false;
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${cfg.center.lat}&lon=${cfg.center.lng}&format=json&zoom=12&accept-language=zh-TW`,
        { headers: { Accept: 'application/json' }, signal: ctrl.signal },
      );
      if (!resp.ok) skipped = true;
      else {
        const data = await resp.json();
        const a = data.address || {};
        const placeName = [a.county || a.city || a.town, a.suburb || a.village || a.state]
          .filter(Boolean).join(' ') || data.display_name?.split(',')[0];
        if (placeName) cfg.placeName = placeName;
        else skipped = true;
      }
    } catch { skipped = true; /* 保留座標字串 */ }
    finally {
      clearTimeout(timer);
      this.placeNameLastSkipped = skipped;
      if (skipped) this.placeNameSkips++;
    }
    return cfg;
  }
}
