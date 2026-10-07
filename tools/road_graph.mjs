// Deterministic offline road routing shared by full-road and natural-hybrid bakes.
import { structuralTunnel as strucTunnel } from '../public/js/roadSemantics.js';
const R = 6371000, d2r = Math.PI / 180;
const REUSE_PEN = 20;

export function buildGraph(ways, origin, tunPrefRe) {
  const idx = new Map();          // "lat,lng" -> i
  const X = [], Z = [], LA = [], LN = [], adj = [];
  const tunE = new Set();         // 隧道邊 "u:v"(雙向都記):規則 #5 選線判定用
  const tunPrefE = new Set();     // PREFER_TUNNEL 偏好專用:只收目標隧道的邊,tunE 本體不動
  const brgE = new Set();         // 橋樑邊(同上):PREFER_BRIDGE 場地的選線偏好用
  const portalN = new Set();      // 橋/隧 way 的端點節點 = 出入口(portal):規則「只能從出入口進出」
  const cosO = Math.cos(origin[0] * d2r);
  const nid = (la, ln) => {
    const k = `${la.toFixed(6)},${ln.toFixed(6)}`;
    let i = idx.get(k);
    if (i === undefined) {
      i = X.length;
      idx.set(k, i);
      X.push((ln - origin[1]) * d2r * R * cosO);
      Z.push((la - origin[0]) * d2r * R);
      LA.push(la); LN.push(ln); adj.push([]);
    }
    return i;
  };
  for (const w of ways) {
    if (!w.geometry) continue;
    const tun = strucTunnel(w.tags);          // 資格閘與引擎同一份(見檔頭 import 註解)
    const brg = !!w.tags?.bridge && !w.tags?.tunnel;
    for (let i = 1; i < w.geometry.length; i++) {
      const a = w.geometry[i - 1], b = w.geometry[i];
      const u = nid(a.lat, a.lon), v = nid(b.lat, b.lon);
      if (u === v) continue;
      const len = Math.hypot(X[u] - X[v], Z[u] - Z[v]);
      adj[u].push(v, len);        // 扁平化:[v0,len0, v1,len1, …]
      adj[v].push(u, len);
      if (tun) {
        tunE.add(`${u}:${v}`); tunE.add(`${v}:${u}`);
        if (!tunPrefRe || tunPrefRe.test(w.tags?.name || '')) {
          tunPrefE.add(`${u}:${v}`); tunPrefE.add(`${v}:${u}`);
        }
      }
      if (brg) { brgE.add(`${u}:${v}`); brgE.add(`${v}:${u}`); }
    }
    // 結構 way 的頭尾幾何節點 = 出入口(portal):真實匝道/洞口只接在結構兩端,
    // way 中間節點若被兵線側切上/下橋 = 「從側邊出入」(規則禁止,見 laneStructEntryAudit)。
    if (tun || brg) {
      const g0 = w.geometry[0], gN = w.geometry[w.geometry.length - 1];
      portalN.add(nid(g0.lat, g0.lon));
      portalN.add(nid(gN.lat, gN.lon));
    }
  }
  // 連通 component 只作 fixture target 候選的穩定優先序；不改 Dijkstra 或任何路線閘。
  // adjacency 的插入順序來自版本化 raw response，component id 只比較相等性，故不受 id 編號影響。
  const component = new Int32Array(X.length).fill(-1);
  let componentCount = 0;
  for (let s = 0; s < X.length; s++) {
    if (component[s] >= 0) continue;
    const q = [s]; component[s] = componentCount;
    for (let h = 0; h < q.length; h++) {
      const u = q[h], a = adj[u];
      for (let j = 0; j < a.length; j += 2) {
        const v = a[j];
        if (component[v] < 0) { component[v] = componentCount; q.push(v); }
      }
    }
    componentCount++;
  }
  const junction = adj.map((edges) => {
    const neighbors = new Set();
    for (let j = 0; j < edges.length; j += 2) neighbors.add(edges[j]);
    return neighbors.size >= 3;
  });
  return { X, Z, LA, LN, adj, n: X.length, tunE, tunPrefE, brgE, portalN, component, componentCount, junction, ways };
}

class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(k, v) {
    if (this.n === this.k.length) { const K = new Float64Array(this.n * 2), V = new Int32Array(this.n * 2); K.set(this.k); V.set(this.v); this.k = K; this.v = V; }
    let i = this.n++;
    this.k[i] = k; this.v[i] = v;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= this.k[i]) break; this._sw(p, i); i = p; }
  }
  pop() {
    const rk = this.k[0], rv = this.v[0];
    this.n--;
    if (this.n) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.n && this.k[l] < this.k[s]) s = l;
        if (r < this.n && this.k[r] < this.k[s]) s = r;
        if (s === i) break;
        this._sw(s, i); i = s;
      }
    }
    return [rk, rv];
  }
  _sw(a, b) { const k = this.k[a], v = this.v[a]; this.k[a] = this.k[b]; this.v[a] = this.v[b]; this.k[b] = k; this.v[b] = v; }
}

export function dijkstra(g, src, dst, used, wMul) {
  const { adj, n } = g;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[src] = 0;
  const h = new MinHeap(1024);
  h.push(0, src);
  while (h.n) {
    const [d, u] = h.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    const a = adj[u];
    for (let i = 0; i < a.length; i += 2) {
      const v = a[i];
      if (done[v]) continue;
      let w = a[i + 1] * (wMul ? wMul(u, v) : 1);
      if (used.has(u * n + v)) w *= REUSE_PEN;
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push(nd, v); }
    }
  }
  if (!done[dst]) return null;
  const path = [dst];
  while (path[0] !== src) { const p = prev[path[0]]; if (p < 0) return null; path.unshift(p); }
  return path;
}
