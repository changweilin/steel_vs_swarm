// Render-free facade shared by polygon buildings and environment objects.
import { FACADE_GEOMETRY_LIMIT } from './regionalArchitecture.js';
import { resolveWindowScheme } from './architectureStyles.js';
import { mat3FromEulerXYZ, mat3Multiply, eulerXYZFromMat3 } from './partTransform.js';

function placeFacadePart(g, edge, u, y, z, color, style, rotation = [0, 0, 0], role = 'facade-detail') {
  const c = Math.cos(edge.ry), s = Math.sin(edge.ry);
  return { g, p: [edge.x + u * c - z * s, edge.y + y, edge.z + u * s + z * c],
    r: eulerXYZFromMat3(mat3Multiply(mat3FromEulerXYZ([0, -edge.ry, 0]), mat3FromEulerXYZ(rotation))),
    c: color, role, colorVariant: style.variant, ...(role === 'window' ? { mat: 'glass' } : {}) };
}

function archMesh(radius, tube) {
  const vertices = [], faces = [];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 3; j++) {
    const a = i * Math.PI / 8, b = j * Math.PI * 2 / 3;
    vertices.push((radius + tube * Math.cos(b)) * Math.cos(a),
      (radius + tube * Math.cos(b)) * Math.sin(a) - (radius + tube) / 2, tube * Math.sin(b));
  }
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) {
    const a = i * 4 + j, b = a + 4;
    faces.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return ['mesh', { vertices, faces }, [2 * (radius + tube), radius + tube, 2 * tube]];
}

// 已有逐窗重裝飾的風格不再疊規則窗框（避免擁擠，窗框留給素面風格展現多樣性）。
const BUSY_FACADE_DETAIL = new Set([
  'jali', 'louvers', 'shutters', 'half_timber', 'board_batten',
  'recess_bands', 'carved_frame', 'brise_soleil',
]);

/** 飾件雜湊（FNV-1a）：窗間飾／外推結構的「插或不插」只吃雜湊，零共享 rnd 消耗、
 * 跨幀跨端同值；只決定飾件有無，不影響玻璃存在性（玻璃恆鋪滿、不留破洞）。 */
function ornamentHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return h >>> 0;
}

/** 沿真實外環／中庭牆段配置窗格、立柱與橫梁，零件數有上限。
 * 採階層式深度分層（Glass < Mullion/Frame < Trim/Header < Column/Pier），
 * 杜絕同平面共面 (Coplanar) 導致的 WebGL Z-fighting 閃爍。
 * 三階段管線：先把每層每開間的玻璃鋪滿（陣列保證完整、不留隨機缺洞；
 * 高樓不再因額度耗盡而頂層缺窗），再用「均攤額度 − 已用玻璃數」的剩餘額度
 * 疊窗框與文化裝飾，全棟總量恆受 FACADE_GEOMETRY_LIMIT 夾制；玻璃形狀／尺寸／
 * 窗框由 resolveWindowScheme 按建築功能類型給定同棟唯一的一份參數（部分類型
 * 如停車場 rate=0 全棟不渲染玻璃）。
 * 同棟同窗：同一呼叫（同一棟）內所有窗共用 scheme，僅棋盤／蜂巢混排依
 * (floor, bay) 交錯取款；MUST NOT 在此逐窗重抽形狀尺寸窗框，也 MUST NOT
 * 逐窗隨機跳過（缺洞只能是整棟無窗 rate=0，不可是陣列中的隨機破洞）。
 * 飾件型（scheme.layout === 'punctuated'）：每面牆每層窗數固定（約 6m 一窗、
 * 全層共用），玻璃同樣鋪滿；窗間隙逐層雜湊擲「插或不插」（各半）補浮雕／花磚／
 * 掛飾，開間夠寬（bayW ≥ 3.2m）再逐窗雜湊擲半數補陽台／雨遮外推。飾件與外推
 * 全走剩餘額度，耗盡即停、不動玻璃。
 */
export function architecturalFacadeParts(edges, style, thickness) {
  const geos = [];
  const facade = style.facade || style.wallType || 'ribbon';
  const glassColor = style.glass || 0x68a5c2;
  const trimColor = style.trim || 0x546575;
  // 同棟識別：sourceId＋variant＋首段牆位置，跨幀穩定；同地址多外環視為同棟同窗。
  const firstEdge = edges[0];
  const buildingKey = `${firstEdge?.sourceId ?? ''}|${style.variant ?? 0}|${style.id ?? ''}|${style.functionInfo?.type ?? ''}|${style.functionInfo?.key ?? ''}|${firstEdge ? `${firstEdge.x.toFixed(1)},${firstEdge.z.toFixed(1)}` : ''}`;
  const scheme = resolveWindowScheme(style, buildingKey);
  const shapeAt = (floor, bay) => {
    if (scheme.mode === 'checker') return scheme.shapes[(floor + bay) & 1] || 'rect';
    if (scheme.mode === 'honeycomb') return scheme.shapes[((bay % 3) + (floor & 1 ? 1 : 0)) % 3] || 'rect';
    return scheme.shapes[0] || 'rect';
  };
  const plainFrame = !BUSY_FACADE_DETAIL.has(style.detail);

  for (let ei = 0; ei < edges.length; ei++) {
    const edge = edges[ei];
    const length = edge.hw2 * 2;
    if (!(length > 1e-5) || !(edge.h > 0.5)) continue;
    const limit = style.detail ? FACADE_GEOMETRY_LIMIT.regional : FACADE_GEOMETRY_LIMIT.base;
    // 樓層按真實高度推導（層高 3.2m），不再鉗制 8 層：高層缺玻璃的主因即此截斷
    // 疊加舊管線把低樓層裝飾先花光額度、高樓層玻璃輪不到。
    const floors = Math.max(1, Math.min(36, Math.round(edge.h / (style.functionalWindows?.storeyH || 3.2))));
    const isCurtain = facade === 'ribbon' || facade === 'glass_curtain';
    // 開間步距由同棟窗方案給定（高層密、傳統疏），不再逐牆重算。
    // 飾件型：每面牆每層窗數固定（約 6m 一窗、上限 4、全層共用），窗間留隙補飾件。
    const punctuated = (scheme.layout || 'curtain') === 'punctuated';
    let bays = punctuated
      ? Math.max(1, Math.min(4, Math.round(length / 6)))
      : Math.max(1, Math.min(10, Math.floor(length / scheme.bayStep)));
    if (floors * bays > 140) bays = Math.max(1, Math.floor(140 / floors));
    const bayW = length / bays, floorH = edge.h / floors;
    let budget = Math.floor(limit / Math.max(1, edges.length));
    // 已渲染窗表：後續階段沿用，不重算位置（牛眼／老虎窗不疊格柵）。
    const wins = [];
    const edgeStart = geos.length;

    // Helper: 在特定額外厚度階層上生成幾何，避免 Z-fighting。
    // 第一階段呼叫時不扣額度（free=true）；第二階段裝飾扣額度，耗盡回 false。
    const add = (w, h, u, y, color, extraDepth = 0.05, angle = 0, free = false) => {
      if (!free && budget-- <= 0) return false;
      geos.push(placeFacadePart(['box', w, h, thickness + extraDepth], edge, u, y, 0,
        color, style, [0, 0, angle], color === glassColor ? 'window' : 'facade-detail'));
      return true;
    };
    const addDisc = (r, u, y, color, extraDepth, free = false) => {
      if (!free && budget-- <= 0) return false;
      geos.push(placeFacadePart(['cyl', r, r, thickness + extraDepth, 12], edge, u, y, 0,
        color, style, [Math.PI / 2, 0, 0], color === glassColor ? 'window' : 'facade-detail'));
      return true;
    };
    // 帶 +Z 外移量的體積件（陽台底板／欄杆／雨遮）：一律扣額度，role 恆為 facade-detail。
    const addZ = (w, h, d, u, y, z, color, pitch = 0) => {
      if (budget-- <= 0) return false;
      geos.push(placeFacadePart(['box', w, h, d], edge, u, y, z,
        color, style, [pitch, 0, 0], 'facade-detail'));
      return true;
    };

    // ---- 第一階段：玻璃鋪滿，全層全開間保證覆蓋（不扣額度，事後計數扣除） ----
    // 同棟同窗：形狀／尺寸／位置全棟固定，僅混排模式依 (floor, bay) 交錯取款；
    // rate=0 的類型整面牆不鋪玻璃（全棟無窗），rate>0 一律鋪滿、不逐窗跳過。
    for (let floor = 0; floor < floors; floor++) {
      const topFloor = floor === floors - 1;
      const yBase = (floor + 0.5) * floorH;
      for (let bay = 0; bay < bays; bay++) {
        if (!(scheme.rate > 0)) continue;
        let shape = shapeAt(floor, bay);
        if (shape === 'oculus' && !topFloor) shape = 'rect';
        let w = Math.min(bayW * 0.96, Math.max(0.3, bayW * scheme.w));
        const h = Math.min(floorH * 0.9, Math.max(0.3, floorH * scheme.h));
        // A round arch is bounded by storey height as well as bay width.
        if (shape === 'arch') w = Math.min(w, Math.max(.1, floorH * (.96 - 2 * Math.abs(scheme.lift || 0)) - h * .44));
        const u = -length / 2 + (bay + 0.5) * bayW;
        const y = yBase + (scheme.lift || 0) * floorH;
        // 老虎窗（dormer）：整棟頂層統一有無，外凸窗體＋小斜蓋，取代平面玻璃。
        if (topFloor && scheme.dormer) {
          add(w * 0.8, h * 0.7, u, y, glassColor, 0.42, 0, true);
          add(w * 0.94, 0.09, u, y + h * 0.42, trimColor, 0.55, 0, true);
          geos.push(placeFacadePart(['box', w * .94, .07, .55], edge, u, y + h * .52, 0,
            style.roof ?? trimColor, style, [.35, 0, 0], 'dormer-roof'));
          wins.push({ floor, bay, u, y, w, h, shape: 'dormer' });
          continue;
        }
        // Tier 1: 玻璃窗面（深度 +0.05m，突出於牆面 2.5cm，徹底脫離牆面 Z-fighting）
        if (shape === 'oculus') {
          // 牛眼窗：圓窗＋外圈飾環（飾環 Tier 2 深度，玻璃 Tier 1 深度）
          const r = Math.min(w, h) / 2;
          addDisc(r + 0.09, u, y, trimColor, 0.09, true);
          addDisc(r, u, y, glassColor, 0.05, true);
        } else if (shape === 'arch') {
          // 拱窗：方體＋頂部圓頭（同玻璃色，同 Tier 1 深度）
          add(w, h * 0.72, u, y - h * 0.14, glassColor, 0.05, 0, true);
          addDisc(w / 2, u, y + h * 0.22, glassColor, 0.05, true);
        } else {
          add(w, h, u, y, glassColor, 0.05, 0, true);
        }
        wins.push({ floor, bay, u, y, w, h, shape });
      }
    }
    // 玻璃已鋪數量從本面牆均攤額度扣除：全棟總量恆 ≤ LIMIT（短棟裝飾豐富、
    // 高棟玻璃優先，裝飾讓路），額度耗盡則後續窗框裝飾逐窗跳過。
    budget -= (geos.length - edgeStart);

    // ---- 第一階段之二（飾件型專用）：窗間飾＋外推結構（扣額度；耗盡即停，不動玻璃） ----
    // 窗間隙逐層雜湊擲「插或不插」（各半）；陽台／雨遮只落在夠寬的開間
    // （bayW ≥ 3.2m），逐窗雜湊同樣各半。牛眼窗與老虎窗不加外推結構。
    if (punctuated && wins.length > 0) {
      const wallTag = `${ei}:${edge.x.toFixed(1)},${edge.z.toFixed(1)}`;
      const roll = (floor, gap, tag) =>
        ornamentHash(`${buildingKey}|${wallTag}|${floor}|${gap}|${tag}`) / 4294967296;
      // wins 按 (floor, bay) 層主序逐格恰好一筆（玻璃恆鋪滿），可直取鄰窗。
      const at = (floor, bay) => wins[floor * bays + bay];
      const accent = style.roof ?? trimColor;
      for (let floor = 0; floor < floors && budget > 0; floor++) {
        for (let gap = 0; gap < bays - 1 && budget > 0; gap++) {
          const left = at(floor, gap), right = at(floor, gap + 1);
          if (!left || !right) continue;
          const gapW = (right.u - right.w / 2) - (left.u + left.w / 2);
          if (gapW < 0.9) continue;
          if (roll(floor, gap, 'insert') >= 0.5) continue;
          const u = (left.u + left.w / 2 + right.u - right.w / 2) / 2;
          const y = (floor + 0.5) * floorH;
          const kind = scheme.ornament || 'relief';
          if (kind === 'tile') {
            // 花磚：底板＋上下兩色橫帶（Tier 2 深度，不與玻璃共面）。
            add(Math.min(0.55, gapW * 0.34), floorH * 0.62, u, y, trimColor, 0.10);
            add(Math.min(0.45, gapW * 0.28), 0.09, u, y + floorH * 0.18, accent, 0.13);
            add(Math.min(0.45, gapW * 0.28), 0.09, u, y - floorH * 0.18, accent, 0.13);
          } else if (kind === 'hanging') {
            // 掛飾：窄直幡＋上下飾頭。
            add(0.30, floorH * 0.78, u, y, trimColor, 0.10);
            add(0.40, 0.10, u, y + floorH * 0.39, accent, 0.13);
            add(0.40, 0.10, u, y - floorH * 0.39, accent, 0.13);
          } else {
            // 浮雕壁柱：通層淺柱＋頂飾帶。
            add(Math.min(0.55, gapW * 0.34), floorH * 0.92, u, y, trimColor, 0.10);
            add(Math.min(0.65, gapW * 0.40), 0.10, u, y + floorH * 0.40, accent, 0.13);
          }
        }
      }
      if (bayW >= 3.2) {
        for (const win of wins) {
          if (budget <= 0) break;
          if (win.shape === 'dormer' || win.shape === 'oculus') continue;
          if (roll(win.floor, win.bay, 'protrude') >= 0.5) continue;
          const { u, y, w, h } = win;
          if ((scheme.protrudeKind || 'balcony') === 'canopy') {
            // 雨遮：窗上前傾斜蓋＋兩側短托（突出牆面，不壓窗）。
            if (!addZ(w + 0.5, 0.07, 0.95, u, y + h / 2 + 0.30, 0.35, accent, 0.28)) break;
            for (const side of [-1, 1]) {
              if (!addZ(0.08, 0.30, 0.50, u + side * (w / 2 + 0.10), y + h / 2 + 0.05, 0.25, trimColor)) break;
            }
          } else {
            if (win.floor < 1) continue; // 陽台不落地
            // 陽台：窗檻外底板＋外緣欄杆（欄杆頂低於窗心，不擋窗）。
            const wb = Math.min(w + 0.4, bayW * 0.7);
            const sill = y - h / 2;
            if (!addZ(wb, 0.12, 1.0, u, sill - 0.10, 0.45, trimColor)) break;
            addZ(wb, 0.65, 0.06, u, sill + 0.285, 0.90, trimColor);
          }
        }
      }
    }

    // ---- 第二階段：窗框／窗梃／窗花（Tier 2 深度 +0.09m，扣額度） ----
    for (const win of wins) {
      if (budget <= 0) break;
      if (win.shape === 'dormer') continue;
      const { u, y, w, h, shape } = win;
      if (shape === 'oculus') {
        if (scheme.oculusCross) {
          const r = Math.min(w, h) / 2;
          add(0.06, r * 2, u, y, trimColor, 0.09);
          add(r * 2, 0.06, u, y, trimColor, 0.09);
        }
        continue;
      }
      if (shape === 'arch') continue;
      // 同棟同窗：窗框全棟同一款（lattice/french/slit 仍走其天生框型）。
      let frame = scheme.frame || 'none';
      if (shape === 'lattice') frame = 'grid';
      else if (shape === 'french') frame = 'cross';
      else if (shape === 'slit') frame = 'none';
      if (!plainFrame) frame = 'none';
      if (frame === 'edge' || isCurtain) {
        add(w, 0.06, u, y - h / 2 + 0.03, trimColor, 0.09);
      } else if (frame === 'cross') {
        add(0.07, h, u, y, trimColor, 0.09);
        add(w, 0.07, u, y, trimColor, 0.09);
      } else if (frame === 'grid') {
        add(0.07, h, u, y, trimColor, 0.09);
        add(w, 0.07, u, y - h / 6, trimColor, 0.09);
        add(w, 0.07, u, y + h / 6, trimColor, 0.09);
      } else if (frame === 'bars') {
        add(w, 0.06, u, y - h / 6, trimColor, 0.09);
        add(w, 0.06, u, y + h / 6, trimColor, 0.09);
      } else if (frame === 'lintel') {
        add(w + 0.16, 0.1, u, y + h / 2 + 0.05, trimColor, 0.09);
      }
      if (facade === 'lattice' || facade === 'timber') {
        add(0.08, h, u, y, trimColor, 0.09);
        add(w, 0.08, u, y, trimColor, 0.09);
      }
    }

    // ---- 第三階段：文化裝飾（扣額度，額度耗盡即停，不影響已鋪好的玻璃） ----
    if (style.detail === 'stone_base') {
      add(length, Math.min(0.8, edge.h * 0.12), 0, Math.min(0.8, edge.h * 0.12) / 2, trimColor, 0.2);
    }
    if (style.detail === 'toron' || style.detail === 'eave_brackets') {
      const count = Math.min(8, Math.max(1, Math.floor(length / 2)));
      for (let i = 0; i < count; i++) {
        const u = -length / 2 + (i + 0.5) * length / count;
        if (style.detail === 'toron') {
          if (!add(0.3, edge.h * 0.95, u, edge.h * 0.475, style.wall, 0.45)) break;
          for (let j = 1; j <= 3; j++) add(0.14, 0.14, u, edge.h * j / 4, trimColor, 0.75);
        } else {
          if (!add(0.15, 0.3, u, edge.h - 0.22, trimColor, 0.45)) break;
          add(0.55, 0.12, u, edge.h - 0.12, style.roof, 0.55);
        }
      }
    }
    for (const win of wins) {
      if (budget <= 0) break;
      if (win.shape === 'oculus' || win.shape === 'dormer') continue;
      const { u, y, w, h, floor } = win;
      const detail = style.detail;
      if (detail === 'jali' || detail === 'louvers') {
        for (let n = 1; n <= 3; n++) {
          add(w, 0.055, u, y - h / 2 + h * n / 4, trimColor, 0.16);
          if (detail === 'jali') add(0.055, h, u - w / 2 + w * n / 4, y, trimColor, 0.16);
        }
      } else if (detail === 'shutters') {
        const shutterW = Math.min(0.45, (bayW - w) * 0.4);
        for (const side of [-1, 1]) add(shutterW, h, u + side * (w + shutterW) / 2, y, trimColor, 0.14);
      } else if (detail === 'half_timber') {
        const rise = Math.min(0.5, (floorH - h) * 0.35), run = w / 2;
        for (const side of [-1, 1]) add(Math.hypot(run, rise), 0.09,
          u + side * run / 2, y - h / 2 - rise / 2 - 0.08, trimColor, 0.16, side * Math.atan2(rise, run));
      } else if (detail === 'board_batten') {
        for (const side of [-1, 1]) add(0.065, floorH * 0.92, u + side * bayW * 0.44,
          (floor + 0.5) * floorH, trimColor, 0.12);
      } else if (detail === 'recess_bands' || detail === 'carved_frame') {
        for (const side of [-1, 1]) add(0.10, h + 0.20, u + side * (w / 2 + 0.08), y, trimColor, 0.15);
        add(w + 0.26, 0.1, u, y + h / 2 + 0.08, trimColor, 0.15);
        if (detail === 'carved_frame') add(w + 0.26, 0.1, u, y - h / 2 - 0.08, trimColor, 0.15);
      } else if (detail === 'brise_soleil') {
        add(w + 0.18, 0.1, u, y + h / 2 + 0.15, trimColor, 0.7);
        for (const side of [-1, 1]) add(0.08, h, u + side * w / 2, y, trimColor, 0.55);
      }

      // Tier 3: 磚石窗楣 / 綠化花槽 / 拱圈（深度 +0.13m ~ +0.14m）
      if (facade === 'brick') {
        add(w + 0.08, 0.09, u, y + h / 2 + 0.045, trimColor, 0.13);
      }
      if (facade === 'green') {
        add(w + 0.06, 0.16, u, y - h / 2 - 0.08, 0x3d6e4a, 0.14);
      }
      if (facade === 'arches') {
        for (const side of [-1, 1]) {
          if (budget-- <= 0) break;
          geos.push(placeFacadePart(archMesh(w / 2, Math.min(.12, w * .07)), edge,
            u, y + h / 2 + (w / 2 + Math.min(.12, w * .07)) / 2, side * (thickness / 2 + .055), trimColor, style));
        }
      }
    }

    // Tier 4: 水平樓層腰帶 (Stringcourse / Cornice)（深度 +0.15m）
    if (facade !== 'recess' && facade !== 'concrete') {
      for (let floor = 0; floor < floors; floor++) {
        if (!add(length, 0.14, 0, floor * floorH + 0.10, trimColor, 0.15)) break;
      }
    }
    if (style.detail === 'tile_band') {
      for (let floor = 0; floor < floors; floor++) {
        const tiles = Math.min(10, Math.max(1, Math.floor(length / 1.1)));
        for (let i = 0; i < tiles; i++) {
          if (!add(length / tiles * 0.9, 0.18,
            -length / 2 + (i + 0.5) * length / tiles, floor * floorH + 0.3,
            i % 2 ? trimColor : style.roof, 0.17)) break;
        }
      }
    }

    // Tier 5: 垂直立柱 / 壁柱 (Piers / Columns)（深度 +0.18m）
    if (['columns', 'piers', 'timber', 'industrial', 'stone'].includes(facade)) {
      for (let bay = 1; bay < bays && budget > 0; bay++) {
        add(0.18, edge.h, -length / 2 + bay * bayW, edge.h / 2, trimColor, 0.18);
      }
    }
  }
  return geos;
}

