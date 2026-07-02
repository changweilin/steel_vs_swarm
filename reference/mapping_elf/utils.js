/**
 * Mapping Elf — Utility Functions
 */

const EARTH_RADIUS = 6371000.785;

export function haversineDistance(p1, p2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(p2[0] - p1[0]);
  const dLng = toRad(p2[1] - p1[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1[0])) * Math.cos(toRad(p2[0])) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function totalDistance(points) {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    dist += haversineDistance(points[i - 1], points[i]);
  }
  return dist;
}

export function cumulativeDistances(points) {
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    dists.push(dists[i - 1] + haversineDistance(points[i - 1], points[i]));
  }
  return dists;
}

/**
 * Project a single [lat, lng] point onto a polyline (array of [lat, lng])
 * and return both the mileage (metres from polyline start) and the distance
 * (metres from the point to the projected location on the track).
 *
 * `startMileage` constrains the result to be ≥ that value — segments entirely
 * before it are skipped, and segments straddling it clamp `t` so the projected
 * mileage can't regress. When the waypoint's real projection is behind
 * `startMileage`, the constrained mileage is clamped and `distance` becomes
 * large; callers use `distance` as the "did we find a good forward match"
 * signal.
 */
export function projectMileage(polyline, point, startMileage = 0) {
  if (!Array.isArray(polyline) || polyline.length < 2) {
    return { mileage: startMileage, distance: Infinity };
  }
  const toRad = Math.PI / 180;
  const [plat, plng] = point;
  let cum = 0;
  let bestSq = Infinity;
  let bestMileage = startMileage;
  let bestProjected = null;
  let found = false;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segLen = haversineDistance(a, b);
    if (cum + segLen <= startMileage) { cum += segLen; continue; }
    const cosLat = Math.cos(a[0] * toRad);
    const bx = (b[1] - a[1]) * cosLat;
    const by = b[0] - a[0];
    const px = (plng - a[1]) * cosLat;
    const py = plat - a[0];
    const segLen2 = bx * bx + by * by;
    let t = 0;
    if (segLen2 > 0) {
      t = Math.max(0, Math.min(1, (px * bx + py * by) / segLen2));
    }
    if (segLen > 0 && cum + t * segLen < startMileage) {
      t = (startMileage - cum) / segLen;
    }
    const dx = px - t * bx;
    const dy = py - t * by;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      bestMileage = cum + t * segLen;
      bestProjected = [a[0] + t * by, a[1] + t * (b[1] - a[1])];
      found = true;
    }
    cum += segLen;
  }
  const distance = found && bestProjected ? haversineDistance(bestProjected, point) : Infinity;
  return { mileage: found ? bestMileage : startMileage, distance };
}

/**
 * Place each waypoint at a mileage along the track using a multi-pass
 * forward walk.
 *
 * Pass 1: visit waypoints in input order, searching forward from the
 *   previous waypoint's mileage. If the forward projection is close
 *   enough to the waypoint (≤ `threshold` metres), place it and advance
 *   the cursor; otherwise defer. This preserves file order for
 *   out-and-back tracks (the return-leg waypoints land at later mileages).
 *
 * Pass 2+: repeat the same algorithm on the deferred set, starting from
 *   cursor = 0. Waypoints placed in pass ≥ 2 are flagged `inserted: true`
 *   so callers can mark their labels (e.g. with a trailing `*`).
 *
 * If a pass makes no progress, remaining waypoints are force-placed by
 * unconstrained best projection (also flagged `inserted`).
 *
 * Returns `[{ index, mileage, inserted }, ...]` sorted by mileage (stable),
 * so pass-2 insertions fall between their neighbouring pass-1 entries.
 */
/**
 * Place each waypoint at a mileage along the track.
 *
 * This version is track-aware: it detects return-leg waypoints by checking for
 * turnaround symbols (↩, ↺, ↻, (回程)) in labels.
 *
 * Algorithm:
 * 1. Identify "return" waypoints via symbols.
 * 2. Find "turnaround" point (last outbound waypoint before first return point).
 * 3. Split track into "outbound" and "return" segments at the turnaround point.
 * 4. Project outbound waypoints only on outbound track; return waypoints on return track.
 * 5. Ensure monotonic mileage (mileage[i] >= mileage[i-1]) to preserve file order.
 */
export function orderWaypointsAlongTrack(waypoints, trackCoords, options = {}) {
  const n = waypoints.length;
  if (n === 0) return [];
  if (!Array.isArray(trackCoords) || trackCoords.length < 2) {
    return waypoints.map((_, i) => ({ index: i, mileage: 0, inserted: false }));
  }

  const isReturnFlags = waypoints.map((wp, i) => {
    // waypoint param might be [lat,lng] or a metadata object with label
    const label = wp.label || (options.labels && options.labels[i]) || "";
    return /\s*[↺↻↩]$|\s*\(回程\)$/.test(label);
  });

  // Find turnaround point: last waypoint that is NOT marked as return, 
  // before the first waypoint that IS marked as return.
  let firstReturnIdx = isReturnFlags.indexOf(true);
  let turnaroundIdx = firstReturnIdx > 0 ? firstReturnIdx - 1 : n - 1;

  // Projection logic
  const trackDists = cumulativeDistances(trackCoords);
  const fullDist = trackDists[trackDists.length - 1];

  // Map turnaround index to track mileage
  // we pass waypoints[turnaroundIdx] which is usually [lat,lng]
  const snapTurnaround = projectMileage(trackCoords, waypoints[turnaroundIdx], 0);
  const splitMileage = snapTurnaround.mileage;
  
  // Find the exact index in trackCoords where splitMileage lands roughly
  let splitIdx = 0;
  for (let i = 0; i < trackDists.length; i++) {
    if (trackDists[i] >= splitMileage) { splitIdx = i; break; }
  }

  const results = [];
  let prevMileage = 0;

  for (let i = 0; i < n; i++) {
    const isRet = isReturnFlags[i];
    let mileage = 0;

    if (firstReturnIdx === -1) {
      // One-way fallback: use existing forward-walk logic
      const snap = projectMileage(trackCoords, waypoints[i], prevMileage);
      mileage = snap.mileage;
    } else {
      // Split mode
      if (i <= turnaroundIdx) {
        // Outbound: search from prevMileage up to splitMileage
        // We use a slice of trackCoords to limit the search space
        const slice = trackCoords.slice(0, splitIdx + 1);
        const snap = projectMileage(slice, waypoints[i], prevMileage);
        mileage = snap.mileage;
      } else {
        // Return: search from wherever we are (at least splitMileage) to end
        const startSearchAt = Math.max(prevMileage, splitMileage);
        const snap = projectMileage(trackCoords, waypoints[i], startSearchAt);
        mileage = snap.mileage;
      }
    }

    // Force monotonic to preserve file order even if GPS noise suggests regression
    if (mileage < prevMileage) mileage = prevMileage;
    
    results.push({ index: i, mileage, inserted: false });
    prevMileage = mileage;
  }

  return results;
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatElevation(meters) {
  return `${Math.round(meters)} m`;
}

export function formatCoords(lat, lng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function copyToClipboard(text, onDone) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => onDone(true), () => onDone(false));
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      onDone(true);
    } catch (e) {
      onDone(false);
    }
  }
}

export function showNotification(message, type = 'info', duration = 3500) {
  const container = document.getElementById('notifications');
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

export function samplePoints(points, maxSamples = 100) {
  if (points.length <= maxSamples) return [...points];
  const sampled = [points[0]];
  const step = (points.length - 1) / (maxSamples - 1);
  for (let i = 1; i < maxSamples - 1; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  sampled.push(points[points.length - 1]);
  return sampled;
}

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Reorder `points` (array of [lat, lng]) to approximately minimize total
 * straight-line Haversine distance, keeping index 0 as a fixed start.
 *
 * Nearest-neighbor greedy construction, then 2-opt local improvement.
 * Intended for ≲ a few hundred points; 2-opt is O(n²) per pass.
 *
 * Returns a new array with the same elements in a new order (by reference).
 */
export function tspOptimize(points) {
  const n = points.length;
  if (n <= 2) return [...points];

  const dist = (a, b) => haversineDistance(a, b);

  // --- 1. Nearest-neighbor greedy from fixed start (index 0) ---
  const visited = new Array(n).fill(false);
  const order = [0];
  visited[0] = true;
  for (let step = 1; step < n; step++) {
    const last = points[order[order.length - 1]];
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = dist(last, points[i]);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    order.push(bestIdx);
    visited[bestIdx] = true;
  }

  // --- 2. 2-opt improvement (start fixed; never reverse segment starting at 0) ---
  let improved = true;
  let guard = 0;
  const MAX_PASSES = 50;
  while (improved && guard++ < MAX_PASSES) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = points[order[i - 1]];
        const b = points[order[i]];
        const c = points[order[k]];
        const d = k + 1 < n ? points[order[k + 1]] : null;
        const before = dist(a, b) + (d ? dist(c, d) : 0);
        const after = dist(a, c) + (d ? dist(b, d) : 0);
        if (after + 1e-9 < before) {
          // reverse order[i..k]
          let lo = i, hi = k;
          while (lo < hi) { const t = order[lo]; order[lo] = order[hi]; order[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }
  }

  return order.map((idx) => points[idx]);
}

/**
 * Interpolate the route gradient color at fraction t (0 = start, 1 = end).
 * Returns { r, g, b } integers.
 */
export function interpolateRouteColorRgb(t) {
  const stops = [
    { t: 0,    r: 0,   g: 255, b: 127 }, // #00FF7F spring-green
    { t: 0.25, r: 255, g: 191, b: 0   }, // #FFBF00 amber
    { t: 0.50, r: 255, g: 69,  b: 0   }, // #FF4500 orange-red
    { t: 0.75, r: 216, g: 27,  b: 96  }, // #D81B60 magenta
    { t: 1,    r: 111, g: 66,  b: 193 }, // #6F42C1 purple
  ];
  const tc = Math.max(0, Math.min(1, t));
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (tc <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = hi.t - lo.t;
  const f = span > 0 ? (tc - lo.t) / span : 0;
  return {
    r: Math.round(lo.r + (hi.r - lo.r) * f),
    g: Math.round(lo.g + (hi.g - lo.g) * f),
    b: Math.round(lo.b + (hi.b - lo.b) * f),
  };
}

/** Returns `rgb(r,g,b)` string for gradient at fraction t. */
export function interpolateRouteColor(t) {
  const { r, g, b } = interpolateRouteColorRgb(t);
  return `rgb(${r},${g},${b})`;
}

/**
 * Return-leg gradient: red → purple → deep-sea blue → sky blue
 * (used on round-trip / O-loop return).
 */
export function interpolateReturnColorRgb(t) {
  const stops = [
    { t: 0,    r: 111, g: 66,  b: 193 }, // #6F42C1 purple (matches outbound end)
    { t: 0.33, r: 0,   g: 123, b: 255 }, // #007BFF deep-sea blue
    { t: 0.66, r: 0,   g: 191, b: 255 }, // #00BFFF sky blue
    { t: 1,    r: 0,   g: 255, b: 255 }, // #00FFFF aqua/cyan
  ];
  const tc = Math.max(0, Math.min(1, t));
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (tc <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = hi.t - lo.t;
  const f = span > 0 ? (tc - lo.t) / span : 0;
  return {
    r: Math.round(lo.r + (hi.r - lo.r) * f),
    g: Math.round(lo.g + (hi.g - lo.g) * f),
    b: Math.round(lo.b + (hi.b - lo.b) * f),
  };
}

export function interpolateReturnColor(t) {
  const { r, g, b } = interpolateReturnColorRgb(t);
  return `rgb(${r},${g},${b})`;
}
