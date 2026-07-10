// ============ 戰場選址:真實世界地圖選點 + 主堡推薦演算法 ============
// 2D 地圖(Leaflet)與路線計算(OSRM)手法改自 mapping_elf 的
// mapManager.js / routeEngine.js。
//
// 規則:
//  1. 房主在真實地圖點一個點 → 作為「蜂群」主堡候選錨點 A。
//  2. 演算法在 A 周圍(方位角 0~330° 掃描)找出多個推薦點 B:
//     - |AB| ≥ 地圖對角線 × 80%(地圖 = 以 AB 中點為中心的正方形戰場,
//       邊長由 |AB| 反推;真實邊長綁定人數 = 0.45 + 0.15×L km)
//     - A、B 之間能建出 L 條路徑(真實道路,OSRM;L = ⌈N/2⌉),
//       且任兩條路徑重合率 < 20%(= 80% 不重合)
//  3. 房主點選推薦點 → 預覽兵線 → 確認後鎖定戰場。
import { MAPGEO, lanesFor, targetDistFor, overlapCellM, TEAM, laneTacticsXZ, tacticalScore } from './data.js';
import { synthLane } from './venues.js';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const R_EARTH = 6371000;

// ---- 幾何工具(equirectangular,5km 內誤差可忽略)----
function toMeters(p, origin) {
  const x = (p[1] - origin[1]) * Math.PI / 180 * R_EARTH * Math.cos(origin[0] * Math.PI / 180);
  const z = (p[0] - origin[0]) * Math.PI / 180 * R_EARTH;
  return [x, z];
}
function distM(a, b) {
  const [x, z] = toMeters(b, a);
  return Math.hypot(x, z);
}
function destPoint(origin, bearingDeg, d) {
  const br = bearingDeg * Math.PI / 180;
  const dLat = d * Math.cos(br) / R_EARTH * 180 / Math.PI;
  const dLng = d * Math.sin(br) / (R_EARTH * Math.cos(origin[0] * Math.PI / 180)) * 180 / Math.PI;
  return [origin[0] + dLat, origin[1] + dLng];
}
function midPoint(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

/** 折線重合率:網格佔用率(相對較短一條)。cell 由 overlapCellM(L) 依地圖尺度給定 */
function overlapRatio(laneA, laneB, origin, cell) {
  const gridOf = (lane) => {
    const set = new Set();
    for (let i = 1; i < lane.length; i++) {
      const [x1, z1] = toMeters(lane[i - 1], origin);
      const [x2, z2] = toMeters(lane[i], origin);
      const seg = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.max(1, Math.ceil(seg / (cell / 2)));
      for (let k = 0; k <= n; k++) {
        const x = x1 + (x2 - x1) * k / n, z = z1 + (z2 - z1) * k / n;
        set.add(`${Math.round(x / cell)},${Math.round(z / cell)}`);
      }
    }
    return set;
  };
  const ga = gridOf(laneA), gb = gridOf(laneB);
  let shared = 0;
  for (const c of ga) if (gb.has(c)) shared++;
  return shared / Math.min(ga.size, gb.size);
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
async function osrmRoute(waypoints, signal) {
  const coordStr = waypoints.map((w) => `${w[1].toFixed(6)},${w[0].toFixed(6)}`).join(';');
  const url = `${OSRM_BASE}/${coordStr}?overview=full&geometries=geojson&steps=false`;
  try {
    const resp = await fetch(url, { signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    const r = data.routes[0];
    const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
    // 端點錨回原始位置(OSRM 會吸附到道路)— 手法同 routeEngine.js
    coords[0] = [...waypoints[0]];
    coords[coords.length - 1] = [...waypoints[waypoints.length - 1]];
    return { coords, dist: r.distance };
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 高程取樣(terrarium 磚):兵線選路避開陡坡(Part 3)。輕量、不依賴 THREE ----
const TERRARIUM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
function loadImg(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('elev tile'));
    signal?.addEventListener('abort', () => reject(new Error('abort')));
    img.src = url;
  });
}
/** 抓 terrarium 高程磚拼成取樣器:(lat,lng)→公尺;失敗/範圍過大回 null(則跳過坡度濾網) */
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
/** 一組兵線沿線最大坡度(tan θ):沿折線每 STEP 真實公尺取樣高程,取相鄰樣點的 |Δh|/run */
function maxLaneGrade(lanes, sampleElev) {
  const STEP = 40;
  let mx = 0;
  for (const lane of lanes) {
    let prev = null, prevH = null;
    for (let i = 1; i < lane.length; i++) {
      const n = Math.max(1, Math.round(distM(lane[i - 1], lane[i]) / STEP));
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        const pt = [lane[i - 1][0] + (lane[i][0] - lane[i - 1][0]) * f, lane[i - 1][1] + (lane[i][1] - lane[i - 1][1]) * f];
        const h = sampleElev(pt[0], pt[1]);
        if (h == null) { prev = null; continue; }
        if (prev) { const run = distM(prev, pt); if (run > 5) mx = Math.max(mx, Math.abs(h - prevH) / run); }
        prev = pt; prevH = h;
      }
    }
  }
  return mx;
}

// 側翼兵線的候選側移距離(兩堡距離的倍率):由近到遠試,
// 太近會被幹道「吸走」與中路重合,太遠繞路過長。
const OFFSET_FRACS = [MAPGEO.LANE_OFFSET_FRAC, 0.45, 0.62];

/**
 * 為 A→B 建 L 條兵線(L=1 中路;L=2 上/下路;L=3 上/中/下路):
 * 中路 = 直達路線;側翼 = 經側向中繼點,與中路重合率過高就加大側移重試;
 * via 全失敗才補合成弧線(synthetic 標記)。
 * 直達路線失敗(海面/無路網)回傳 null,由呼叫端淘汰該方位。
 */
async function buildLanes(A, B, signal, directRoute = null, L = 3) {
  const cell = overlapCellM(L);
  const d = distM(A, B);
  const [vx, vz] = toMeters(B, A);
  const len = Math.hypot(vx, vz) || 1;
  const px = -vz / len, pz = vx / len;   // 垂直單位向量(公尺系)
  const viaOf = (side, frac) => {
    const [mLat, mLng] = midPoint(A, B);
    const off = d * frac * side;
    const dLat = off * pz / R_EARTH * 180 / Math.PI;
    const dLng = off * px / (R_EARTH * Math.cos(A[0] * Math.PI / 180)) * 180 / Math.PI;
    return [mLat + dLat, mLng + dLng];
  };

  const mid = directRoute || (await osrmRoute([A, B], signal));
  if (!mid) return null;

  // 側翼:逐一加大側移。分離達標(重合 ≤ 上限)者取戰術評分最高(越彎越好);
  // 全不達標退而取重合最低 — 分離是硬門檻,非直線是偏好。
  const flank = async (side) => {
    let best = null;
    for (const frac of OFFSET_FRACS) {
      await sleep(130);
      const r = await osrmRoute([A, viaOf(side, frac), B], signal);
      if (!r) continue;
      const ov = overlapRatio(r.coords, mid.coords, A, cell);
      const tac = laneTactics(r.coords, A);
      const sep = ov <= MAPGEO.MAX_OVERLAP;
      const score = tacticalScore(tac.sinuosity, tac.turnsPerKm, ov);
      const better = !best
        || (sep && !best.sep) || (sep === best.sep && (sep ? score > best.score : ov < best.ov));
      if (better) best = { ...r, ov, sep, score };
      // 夠分離又夠彎才提前收手,否則試完剩餘側移找更彎的路
      if (sep && ov <= MAPGEO.MAX_OVERLAP * 0.9 && tac.sinuosity >= MAPGEO.TACTICS.MIN_SINUOSITY) break;
    }
    return best || { coords: synthLane(A, B, side), dist: d * 1.2, synth: true };
  };

  let lanes, synthetic = false;
  if (L === 1) {
    lanes = [mid.coords];
  } else if (L === 2) {
    const top = await flank(1);
    const bot = await flank(-1);
    synthetic = !!(top.synth || bot.synth);
    lanes = [top.coords, bot.coords];
  } else {
    const top = await flank(1);
    const bot = await flank(-1);
    synthetic = !!(top.synth || bot.synth);
    lanes = [top.coords, mid.coords, bot.coords];
  }
  // 任兩條重合率
  const ov = [0];
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) ov.push(overlapRatio(lanes[i], lanes[j], A, cell));
  }
  return { lanes, maxOverlap: Math.max(...ov), overlaps: ov, synthetic, roadDist: mid.dist };
}

// ============ Leaflet 選址畫面 ============
export class MapSelect {
  /**
   * handlers: { status(text, frac), candidates(list), confirmReady(cfg|null) }
   */
  constructor(containerId, handlers) {
    this.h = handlers;
    this.anchor = null;          // A 點 [lat,lng]
    this.candidates = [];        // {latlng, lanes, maxOverlap, distM, sizeM, diagM, synthetic}
    this.chosen = null;
    this.venue = null;           // 使用中的預設場地(含 mix),自訂點為 null
    this.teamSize = TEAM.DEFAULT;
    this._layers = [];
    this._searchAbort = null;

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

  /** 兵線數(隨隊伍規模)與兩堡目標距離(遊戲世界公尺) */
  get laneCount() { return lanesFor(this.teamSize); }
  get targetDist() { return targetDistFor(this.laneCount); }

  /** 改隊伍規模:幾何條件全變,重置目前選點 */
  setTeamSize(n) {
    n = Math.max(TEAM.MIN, Math.min(TEAM.MAX, n | 0));
    if (n === this.teamSize) return;
    this.teamSize = n;
    if (this.anchor) this.reset();
  }

  /** 純預覽已存好的戰場設定(我的最愛):畫主堡/兵線/邊界,不重新搜尋 */
  showConfig(cfg) {
    this.reset();
    this._addLayer(L.circleMarker(cfg.bases.SWARM, {
      radius: 10, color: '#ffb300', fillColor: '#ffb300', fillOpacity: 0.9, weight: 3,
    }).bindTooltip('🐝 蜂群主堡', { permanent: true, direction: 'top' }), 'fav');
    this._addLayer(L.circleMarker(cfg.bases.STEEL, {
      radius: 10, color: '#4fc3f7', fillColor: '#4fc3f7', fillOpacity: 0.9, weight: 3,
    }).bindTooltip('🤖 鋼鐵主堡', { permanent: true, direction: 'top' }), 'fav');
    const colors = ['#e6c34a', '#e05c4a', '#4ac3e6'];
    cfg.lanes.forEach((lane, i) => {
      this._addLayer(L.polyline(lane, { color: colors[i % 3], weight: 4, opacity: 0.85 }), 'fav');
    });
    const half = cfg.sizeM / 2 * MAPGEO.REAL_SCALE;   // 遊戲邊長 → 真實半徑
    const dLat = half / R_EARTH * 180 / Math.PI;
    const dLng = half / (R_EARTH * Math.cos(cfg.center.lat * Math.PI / 180)) * 180 / Math.PI;
    this._addLayer(L.rectangle([
      [cfg.center.lat - dLat, cfg.center.lng - dLng],
      [cfg.center.lat + dLat, cfg.center.lng + dLng],
    ], { color: '#8899aa', weight: 2, dashArray: '8 6', fill: false }), 'fav');
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
    if (this._searching) return;
    if (this.chosen) return; // 已選定,先按「重新選點」
    this.anchor = latlng;
    this.venue = this._pendingVenue || null;   // 手動點圖 = 自訂場地(無 mix)
    this._pendingVenue = null;
    this._clearLayers();
    this.h.confirmReady?.(null);
    this._addLayer(L.circleMarker(latlng, {
      radius: 10, color: '#ffb300', fillColor: '#ffb300', fillOpacity: 0.9, weight: 3,
    }).bindTooltip('🐝 蜂群主堡(錨點)', { permanent: true, direction: 'top' }), 'anchor');
    await this._search();
  }

  /** 掃描方位角,找出符合條件的推薦主堡點 */
  async _search() {
    this._searching = true;
    this._searchAbort = new AbortController();
    const signal = this._searchAbort.signal;
    const A = this.anchor;
    const L = this.laneCount;
    const D = this.targetDist;                            // 兩堡目標距離(遊戲世界公尺)
    const realD = D * MAPGEO.REAL_SCALE;                  // 真實地理距離(範圍縮小 → 地形更密)
    const sizeM = D / (MAPGEO.BASE_DIST_FRAC * Math.SQRT2); // 反推地圖邊長(遊戲世界)
    const diagM = sizeM * Math.SQRT2;
    this.candidates = [];

    // Part 3:抓搜尋範圍高程,供坡度濾網(best-effort;失敗/離線則不濾)
    let elev = null;
    const rLat = realD / R_EARTH * 180 / Math.PI;
    const rLng = realD / (R_EARTH * Math.cos(A[0] * Math.PI / 180)) * 180 / Math.PI;
    try {
      elev = await fetchElevSampler(
        { minLat: A[0] - rLat, maxLat: A[0] + rLat, minLng: A[1] - rLng, maxLng: A[1] + rLng }, signal);
    } catch { elev = null; }
    const gradeCap = Math.tan(MAPGEO.MAX_ROAD_GRADE_DEG * Math.PI / 180);

    const nB = MAPGEO.CANDIDATE_BEARINGS;
    let osrmDead = 0;                                     // 直達全掛 = 離線,啟用模擬模式
    for (let i = 0; i < nB; i++) {
      if (signal.aborted) break;
      const bearing = i * (360 / nB);
      this.h.status?.(`掃描方位 ${Math.round(bearing)}° …(已找到 ${this.candidates.length} 個推薦點)`, i / nB);

      const B = destPoint(A, bearing, realD);
      // 直達路線:失敗(海面/無路網)或繞路過遠 → 淘汰此方位
      const direct = await osrmRoute([A, B], signal);
      await sleep(130);
      if (!direct) { osrmDead++; continue; }
      if (direct.dist / realD > 2.2) continue;
      const result = await buildLanes(A, B, signal, direct, L);
      if (!result) continue;
      const { lanes, maxOverlap, overlaps, synthetic, roadDist } = result;
      const dist = distM(A, B) / MAPGEO.REAL_SCALE;   // 真實 → 遊戲世界公尺
      const ok = dist >= diagM * MAPGEO.MIN_DIST_FRAC && maxOverlap <= MAPGEO.MAX_OVERLAP;
      if (!ok) continue;
      // Part 3:沿線有高程資料且坡度超標 → 淘汰(避開現實陡坡道路)
      if (elev && maxLaneGrade(lanes, elev) > gradeCap) continue;

      const cand = { latlng: B, lanes, maxOverlap, overlaps, distM: dist, sizeM, diagM, synthetic, roadDist: roadDist / MAPGEO.REAL_SCALE, bearing };
      cand.tactics = lanesTactics(lanes, A, maxOverlap);
      this.candidates.push(cand);
      this._drawCandidate(cand, this.candidates.length - 1);
      if (this.candidates.length >= MAPGEO.MAX_CANDIDATES) break;
    }
    // 依戰術評分排序(彎曲走廊 + 轉角伏擊點優先)並依名次重繪
    if (this.candidates.length > 1) {
      this.candidates.sort((a, b) => (b.tactics?.score || 0) - (a.tactics?.score || 0));
      this._clearLayers('cand');
      this.candidates.forEach((c, i) => this._drawCandidate(c, i));
    }

    // 完全連不上 OSRM(離線)→ 全合成兵線,遊戲照樣能開
    if (this.candidates.length === 0 && osrmDead === nB && !signal.aborted) {
      const sides = L === 1 ? [0] : L === 2 ? [1, -1] : [1, 0, -1];
      for (const bearing of [0, 90, 180, 270]) {
        const B = destPoint(A, bearing, realD);
        const lanes = sides.map((s) => synthLane(A, B, s));
        let maxOverlap = 0;
        for (let i = 0; i < lanes.length; i++) {
          for (let j = i + 1; j < lanes.length; j++) maxOverlap = Math.max(maxOverlap, overlapRatio(lanes[i], lanes[j], A, overlapCellM(L)));
        }
        const cand = { latlng: B, lanes, distM: distM(A, B) / MAPGEO.REAL_SCALE, sizeM, diagM, bearing, maxOverlap, synthetic: true, roadDist: D };
        cand.tactics = lanesTactics(lanes, A, maxOverlap);
        this.candidates.push(cand);
        this._drawCandidate(cand, this.candidates.length - 1);
      }
      this.h.status?.('⚠️ 路線伺服器無回應,已改用離線模擬兵線。', 1);
    }

    this._searching = false;
    if (this.candidates.length === 0) {
      this.h.status?.('❌ 此區域找不到符合條件的對點(道路太少或被水域阻隔),請換個位置再點一次。', 1);
    } else {
      const synth = this.candidates.some((c) => c.synthetic);
      this.h.status?.(
        `✅ 找到 ${this.candidates.length} 個推薦主堡點,點選其一預覽三條兵線` + (synth ? '(部分為離線模擬路徑)' : ''),
        1,
      );
      // 視野涵蓋所有候選點
      const all = [this.anchor, ...this.candidates.map((c) => c.latlng)];
      this.map.fitBounds(L.latLngBounds(all).pad(0.2));
    }
    this.h.candidates?.(this.candidates);
  }

  _drawCandidate(cand, idx) {
    const mk = this._addLayer(L.circleMarker(cand.latlng, {
      radius: 12, color: '#4fc3f7', fillColor: '#0d2d3d', fillOpacity: 0.85, weight: 3, className: 'cand-pulse',
    }).bindTooltip(
      `⚙ 推薦點 ${idx + 1} — 距離 ${(cand.distM / 1000).toFixed(2)}km / 重合 ${(cand.maxOverlap * 100).toFixed(0)}%`
      + (cand.tactics ? ` / 彎折 ×${cand.tactics.sinuosity.toFixed(2)}・轉角 ${cand.tactics.turnsPerKm.toFixed(1)}/km` : ''),
      { direction: 'top' },
    ), 'cand');
    mk.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev);
      this._choose(cand);
    });
  }

  _choose(cand) {
    this.chosen = cand;
    this._clearLayers('lanes');
    this._clearLayers('cand');
    // 重畫其他候選為淡色
    for (const [i, c] of this.candidates.entries()) {
      if (c !== cand) {
        this._addLayer(L.circleMarker(c.latlng, {
          radius: 8, color: '#3a4a55', fillColor: '#22303a', fillOpacity: 0.5, weight: 2,
        }), 'cand').on('click', () => { this.chosen = null; this._choose(c); });
      }
    }
    this._addLayer(L.circleMarker(cand.latlng, {
      radius: 12, color: '#4fc3f7', fillColor: '#4fc3f7', fillOpacity: 0.9, weight: 3,
    }).bindTooltip('🤖 鋼鐵主堡', { permanent: true, direction: 'top' }), 'cand');

    const colors = ['#e6c34a', '#e05c4a', '#4ac3e6'];
    const names = cand.lanes.length === 1 ? ['中路']
      : cand.lanes.length === 2 ? ['上路', '下路'] : ['上路', '中路', '下路'];
    cand.lanes.forEach((lane, i) => {
      this._addLayer(L.polyline(lane, { color: colors[i], weight: 4, opacity: 0.85 })
        .bindTooltip(`${names[i]} 兵線`), 'lanes');
    });
    // 戰場邊界(以 AB 中點為中心的正方形)
    const c = midPoint(this.anchor, cand.latlng);
    const half = cand.sizeM / 2 * MAPGEO.REAL_SCALE;   // 遊戲邊長 → 真實半徑
    const dLat = half / R_EARTH * 180 / Math.PI;
    const dLng = half / (R_EARTH * Math.cos(c[0] * Math.PI / 180)) * 180 / Math.PI;
    this._addLayer(L.rectangle([[c[0] - dLat, c[1] - dLng], [c[0] + dLat, c[1] + dLng]], {
      color: '#8899aa', weight: 2, dashArray: '8 6', fill: false,
    }), 'lanes');
    this.map.fitBounds(L.latLngBounds([this.anchor, cand.latlng]).pad(0.25));

    this.h.confirmReady?.(this.buildConfig());
  }

  reset() {
    this._searchAbort?.abort();
    this._searching = false;
    this.anchor = null;
    this.chosen = null;
    this.venue = null;
    this.candidates = [];
    this._clearLayers();
    this.h.confirmReady?.(null);
    this.h.status?.('選一個預設場地,或在地圖上點選蜂群主堡位置。', 0);
  }

  /** 組出送給伺服器的戰場設定 */
  buildConfig() {
    if (!this.anchor || !this.chosen) return null;
    const c = midPoint(this.anchor, this.chosen.latlng);
    return {
      center: { lat: c[0], lng: c[1] },
      bases: { SWARM: this.anchor, STEEL: this.chosen.latlng },
      lanes: this.chosen.lanes,          // 方向:SWARM → STEEL
      laneCount: this.chosen.lanes.length,
      sizeM: this.chosen.sizeM,
      diagM: this.chosen.diagM,
      distM: this.chosen.distM,
      geoScaleVer: MAPGEO.GEO_SCALE_VER,
      maxOverlap: this.chosen.maxOverlap,
      tactics: this.chosen.tactics || null,
      synthetic: this.chosen.synthetic,
      venue: this.venue ? { id: this.venue.id, name: this.venue.name, mix: this.venue.mix } : null,
      placeName: this.venue?.name || `${c[0].toFixed(4)}, ${c[1].toFixed(4)}`,
    };
  }

  /** 反查地名(非必要,失敗就用座標;預設場地已有名稱直接用) */
  async fetchPlaceName(cfg) {
    if (cfg.venue?.name) return cfg;
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${cfg.center.lat}&lon=${cfg.center.lng}&format=json&zoom=12&accept-language=zh-TW`,
        { headers: { Accept: 'application/json' } },
      );
      const data = await resp.json();
      const a = data.address || {};
      cfg.placeName = [a.county || a.city || a.town, a.suburb || a.village || a.state]
        .filter(Boolean).join(' ') || data.display_name?.split(',')[0] || cfg.placeName;
    } catch { /* 保留座標字串 */ }
    return cfg;
  }
}
