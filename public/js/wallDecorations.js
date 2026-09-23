import { architectureHash } from './buildingDiversity.js';
import { WALL_DECORATIONS, WALL_COVERAGE, WALL_DECORATION_PLACEMENT } from './wallDecorationCatalog.js';

// 低樓層門檻（m）：達此樓高以上視為高樓，牆面裝飾/渲染全面停用（陽台/雨遮/冷氣等規律配件除外）。
export const LOW_RISE_LIMIT = 24;

/**
 * 建築牆面爬藤植物無重複連續拼接生成器。
 * 支援多塊連續網格拼接（cols × rows）：
 * 1. 跨塊共享接縫（vseam / hseam）端點座標與切線確定性完全相符（連續拼接）。
 * 2. 各塊內部藤幹、葉片與花芽以塊坐標雜湊獨立隨機生長（完全不重複）。
 */
export function generateSeamlessVinePattern({
  seed, slot = 0, site, w, h, kind = 'ivy', rule, scope = 'field',
  cols = null, rows = null, budget = 60,
}) {
  const cCount = cols || Math.max(1, Math.min(4, Math.round(w / 1.6)));
  const rCount = rows || Math.max(1, Math.min(3, Math.round(h / 1.8)));
  const tileW = w / cCount, tileH = h / rCount;
  const motif = [];

  const box = (bw, bh, x, y, color, depth = 0.035, z = 0.16, rz = 0, blockKey = null) => {
    if (motif.length >= budget) return;
    motif.push({
      g: ['box', bw, bh, depth],
      p: [site.x + x, site.y + y, z],
      r: [0, 0, rz],
      c: color,
      role: `wall-${kind}`, scope,
      ...(blockKey ? { block: blockKey } : {}),
    });
  };

  const leafPart = (x, y, z, angle, sizeW, sizeH, col, blockKey = null) => {
    if (motif.length >= budget) return;
    motif.push({
      g: ['cyl', sizeW, sizeH, 0.06, 4],
      p: [site.x + x, site.y + y, z],
      r: [Math.PI / 2, angle, 0],
      s: [1, 1, Math.min(1, h / w)],
      c: col,
      role: `wall-${kind}`, scope,
      ...(blockKey ? { block: blockKey } : {}),
    });
  };

  // 1. 架體或花槽 (Trellis / Planter Box)
  if (kind === 'flowering_trellis') {
    const barsX = cCount * 2 + 1;
    for (let i = 0; i < barsX && motif.length < budget; i++) {
      box(0.04, h, -w / 2 + (i / (barsX - 1)) * w, 0, 0x87745b, 0.03, 0.13);
    }
    const barsY = rCount * 2 + 1;
    for (let j = 0; j < barsY && motif.length < budget; j++) {
      box(w, 0.04, 0, -h / 2 + (j / (barsY - 1)) * h, 0x87745b, 0.03, 0.13);
    }
  } else if (kind === 'hanging_vines') {
    box(w, 0.2, 0, h / 2 - 0.1, 0x986b50, 0.3, 0.22);
  }

  // 2. 決定跨塊邊界接點 (Deterministic Seam Connectors)
  // 相鄰兩塊在接縫上的端點 (y, dy) 僅依賴該接縫的確定性雜湊，保證連續對接
  const getVSeam = (c, r) => {
    const key = architectureHash(seed, `${slot}:vseam:${c}:${r}`);
    const yRel = ((key % 1000) / 1000 - 0.5) * (tileH * 0.55);
    const dy = (((key >>> 12) % 1000) / 1000 - 0.5) * 0.4;
    return { y: -h / 2 + (r + 0.5) * tileH + yRel, dy };
  };

  const getHSeam = (c, r) => {
    const key = architectureHash(seed, `${slot}:hseam:${c}:${r}`);
    const xRel = ((key % 1000) / 1000 - 0.5) * (tileW * 0.55);
    return { x: -w / 2 + (c + 0.5) * tileW + xRel };
  };

  // 3. 逐塊生成完全不重複之藤蔓與枝葉
  for (let r = 0; r < rCount && motif.length < budget; r++) {
    for (let c = 0; c < cCount && motif.length < budget; c++) {
      const blockSeed = architectureHash(seed, `${slot}:blk:${c}:${r}`);
      const blockKey = `${c}:${r}`;
      const x0 = -w / 2 + c * tileW;
      const x1 = x0 + tileW;
      const cy = -h / 2 + (r + 0.5) * tileH;

      const left = c > 0
        ? getVSeam(c, r)
        : { y: cy + (((blockSeed % 100) / 100) - 0.5) * tileH * 0.4, dy: 0 };
      const right = c < cCount - 1
        ? getVSeam(c + 1, r)
        : { y: cy + ((((blockSeed >>> 8) % 100) / 100) - 0.5) * tileH * 0.4, dy: 0 };

      // 主幹 3 段折線平滑連接左右端點
      const segs = Math.max(2, Math.min(4, Math.floor(tileW / 0.6)));
      for (let s = 0; s < segs && motif.length < budget; s++) {
        const tA = s / segs, tB = (s + 1) / segs;
        const xA = x0 + tA * tileW, xB = x0 + tB * tileW;
        const midY = (left.y + right.y) / 2 + (((blockSeed >>> (14 + s * 3)) % 100) / 100 - 0.5) * tileH * 0.28;
        const yA = tA < 0.5 ? left.y + (midY - left.y) * (tA * 2) : midY + (right.y - midY) * ((tA - 0.5) * 2);
        const yB = tB < 0.5 ? left.y + (midY - left.y) * (tB * 2) : midY + (right.y - midY) * ((tB - 0.5) * 2);

        const segDx = xB - xA, segDy = yB - yA;
        const segLen = Math.hypot(segDx, segDy);
        const segAng = Math.atan2(segDy, segDx);

        box(segLen + 0.02, 0.035, (xA + xB) / 2, (yA + yB) / 2, 0x5c6740, 0.032, 0.165, segAng, blockKey);

        // 塊內獨特葉片
        const leafSeed = architectureHash(blockSeed, `leaf:${s}`);
        const lx = (xA + xB) / 2 + (((leafSeed % 100) / 100) - 0.5) * 0.14;
        const ly = (yA + yB) / 2 + ((((leafSeed >>> 8) % 100) / 100) - 0.5) * 0.14;
        const leafAngle = (((leafSeed >>> 16) % 100) / 100) * Math.PI;
        const leafW = Math.min(tileW, tileH) * 0.11;
        const leafH = Math.min(tileW, tileH) * 0.065;
        const leafColor = (leafSeed % 3) ? rule.color : rule.accent;
        leafPart(lx, ly, 0.20, leafAngle, leafW, leafH, leafColor, blockKey);

        // 花架花朵 / 攀藤側芽
        if (kind === 'flowering_trellis' && (leafSeed % 2 === 0)) {
          leafPart(lx + 0.05, ly + 0.05, 0.22, leafAngle + 0.4, leafW * 0.6, leafH * 0.6, rule.accent, blockKey);
        }
      }

      // 垂直上下塊相接 (跨層藤蔓 runner)
      if (r < rCount - 1 && motif.length < budget) {
        const hConn = getHSeam(c, r + 1);
        const vy0 = cy, vy1 = -h / 2 + (r + 1) * tileH;
        const vx = hConn.x;
        const vLen = Math.abs(vy1 - vy0);
        box(0.03, vLen, vx, (vy0 + vy1) / 2, 0x566d3b, 0.03, 0.17, 0, blockKey);
        const vLeafSeed = architectureHash(blockSeed, 'vleaf');
        leafPart(vx + 0.04, (vy0 + vy1) / 2, 0.21, 0.6, 0.09, 0.055, rule.color, blockKey);
      }
    }
  }
  return motif;
}

// Local wall coordinates: X along the wall, Y above its base, +Z outdoors.
// Claims are conservative rectangles of existing attachments, including doors.
export function wallDecorationParts({ seed, width, height, category, contemporary, claims = [], budget = 80 }) {
  const placement = WALL_DECORATION_PLACEMENT;
  if (![width, height, budget].every(Number.isFinite) || width < placement.minLength || height < placement.minHeight || budget < 24) return [];
  // 限定建築牆面的渲染/零件只有低樓層建築才使用（高樓層全面禁用牆飾）。
  if (height > LOW_RISE_LIMIT) return [];
  const rnd = tag => architectureHash(seed, tag) / 4294967296;
  const choices = Object.entries(WALL_DECORATIONS).filter(([, rule]) =>
    rule.categories.includes(category) && (!rule.modern || contemporary));
  if (!choices.length || rnd('presence') > placement.prob) return [];
  const parts = [], occupied = [...claims];
  const scopes = Object.entries(WALL_COVERAGE);
  for (let slot = 0; slot < placement.maxCount; slot++) {
    const [kind, rule] = choices[Math.floor(rnd(`${slot}:type`) * choices.length)];
    const [scope, [wf, hf]] = scopes[Math.floor(rnd(`${slot}:scope`) * scopes.length)];
    if (rule.plant) {
      // 藤蔓走窗間垂直空隙：找一條無佔位的窄柱，以 1×N 無縫疊塊向上攀爬。
      // 每塊圖案單元長寬比恆 ≤1.5（塊高取 ceil 均分，恆 ≤1.5×柱寬、恆 ≥0.7m），
      // 塊與塊共用接縫座標（generateSeamlessVinePattern 的 hseam 保證連續），
      // 整柱不壓窗不壓外掛。密窗牆上方能有整幅攀藤，而非只剩縮小的碎塊。
      const vw = 1.0 + rnd(`${slot}:vinew`) * 0.6;
      let strip = null;
      if (width - vw - 0.8 > 0) {
        for (let attempt = 0; attempt < 24 && !strip; attempt++) {
          const x = (rnd(`${slot}:vine:${attempt}:x`) - 0.5) * (width - vw - 0.8);
          const cuts = [];
          for (const r of occupied) {
            if (Math.abs(x - r.x) < (vw + r.w) / 2 + 0.15) {
              cuts.push([r.y - r.h / 2 - 0.15, r.y + r.h / 2 + 0.15]);
            }
          }
          cuts.sort((a, b) => a[0] - b[0]);
          let cur = 0.4, best = null;
          const consider = (a, b) => {
            if (b - a >= 2.0 && (!best || b - a > best[1] - best[0])) best = [a, b];
          };
          for (const [a, b] of cuts) {
            if (a > cur) consider(cur, Math.min(a, height - 0.4));
            cur = Math.max(cur, b);
            if (cur >= height - 0.4) break;
          }
          if (cur < height - 0.4) consider(cur, height - 0.4);
          if (!best) continue;
          const segH = best[1] - best[0];
          const rows = Math.max(1, Math.ceil(segH / Math.min(vw * 1.5, 3.0)));
          const tileH = segH / rows;
          if (tileH < 0.7 || tileH > vw * 1.5 + 1e-6) continue;
          strip = { site: { x, y: (best[0] + best[1]) / 2, w: vw, h: segH }, rows };
        }
      }
      if (!strip) continue;
      const motif = generateSeamlessVinePattern({
        seed, slot, site: strip.site, w: strip.site.w, h: strip.site.h,
        kind, rule, scope, cols: 1, rows: strip.rows, budget: budget - parts.length,
      });
      // Keep motifs complete when the building-wide budget runs out.
      if (parts.length + motif.length > budget) continue;
      parts.push(...motif); occupied.push(strip.site);
      continue;
    }
    let w = Math.min(8, (width - 0.8) * wf * (0.8 + rnd(`${slot}:w`) * 0.4));
    let h = Math.min(6, (height - 0.8) * hf * (0.8 + rnd(`${slot}:h`) * 0.4));
    // 渲染圖案長寬差距不可超過 50%（不可太細）：收斂長邊至 1.5× 短邊。
    if (w > h * 1.5) w = h * 1.5;
    else if (h > w * 1.5) h = w * 1.5;
    if (w < 0.75 || h < 0.7) continue;
    // 選址收斂至空位：以中心試探後向 claims（含窗玻璃與外掛佔位）收縮半徑，
    // 仍 ≥0.75×0.7 且長寬比 ≤1.5 才接受 —— 密窗牆上壁飾縮小存活，不硬壓窗。
    const fitSite = (x, y) => {
      let hw = w / 2, hh = h / 2;
      hw = Math.min(hw, width / 2 - 0.4 - Math.abs(x));
      hh = Math.min(hh, y - 0.4, height - 0.4 - y);
      if (!(hw >= 0.375) || !(hh >= 0.35)) return null;
      for (const r of occupied) {
        const needX = hw + r.w / 2 + 0.15 - Math.abs(x - r.x);
        const needY = hh + r.h / 2 + 0.15 - Math.abs(y - r.y);
        if (needX > 0 && needY > 0) {
          if (needX < needY) hw -= needX;
          else hh -= needY;
          if (!(hw >= 0.375) || !(hh >= 0.35)) return null;
        }
      }
      let w2 = hw * 2, h2 = hh * 2;
      if (w2 > h2 * 1.5) w2 = h2 * 1.5;
      else if (h2 > w2 * 1.5) h2 = w2 * 1.5;
      if (w2 < 0.75 || h2 < 0.7) return null;
      return { x, y, w: w2, h: h2 };
    };
    let site = null;
    const ySpan = height - h - 0.8;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = (rnd(`${slot}:${attempt}:x`) - 0.5) * (width - w - 0.8);
      const y = 0.4 + h / 2 + rnd(`${slot}:${attempt}:y`) * ySpan;
      const fitted = fitSite(x, y);
      if (!fitted) continue;
      site = fitted; break;
    }
    if (!site) continue;
    // 收斂後的實際尺寸驅動圖案生成（圖案恆落在空位內，不擴回期望尺寸）。
    w = site.w; h = site.h;
    const motif = [];
    const box = (bw, bh, x, y, color, depth = 0.04, z = 0.12) => motif.push({
      g: ['box', bw, bh, depth], p: [site.x + x, site.y + y, z], c: color,
      role: `wall-${kind}`, scope,
    });
    if (rule.plant) {
      motif.push(...generateSeamlessVinePattern({
        seed, slot, site, w, h, kind, rule, scope, budget: budget - parts.length,
      }));
    } else if (kind === 'posters') {
      for (let i = 0; i < 4; i++) {
        const pw = w * 0.21, ph = h * (0.58 + rnd(`${slot}:${i}:paper`) * 0.35);
        const x = (i - 1.5) * w * 0.245;
        box(pw, ph, x, 0, i % 2 ? rule.color : 0xd3af84);
        box(pw * 0.74, ph * 0.35, x, ph * 0.15, rule.accent, 0.012, 0.15);
        for (let line = 0; line < 2; line++) box(pw * (0.7 - line * 0.15), ph * 0.045,
          x, -ph * (0.16 + line * 0.12), 0x5c5550, 0.012, 0.15);
      }
    } else if (kind === 'graffiti') {
      // Overlapping outlined letter bubbles and paint drips, directly on masonry.
      // 相鄰泡泡間距 w*0.145：外圈半徑 MUST ≤ 間距一半，否則泡泡互疊（不可重疊）。
      for (let i = 0; i < 6; i++) {
        const x = (i - 2.5) * w * 0.145;
        const y = (rnd(`${slot}:${i}:stroke`) - 0.5) * h * 0.25;
        for (let layer = 0; layer < 2; layer++) motif.push({
          g: ['cyl', w * (layer ? 0.058 : 0.07), w * (layer ? 0.058 : 0.07), 0.016, 8],
          p: [site.x + x, site.y + y, 0.12 + layer * 0.025], r: [Math.PI / 2, 0, 0],
          s: [1, 1, h / w * 2.6], c: layer ? (i % 2 ? rule.accent : 0x8cb0a4) : 0x393d49,
          role: `wall-${kind}`, scope,
        });
        box(w * 0.045, h * 0.09, x, y, 0x393d49, 0.014, 0.175);
        if (i % 2) box(w * 0.018, h * 0.2, x, y - h * 0.23, rule.accent, 0.016, 0.14);
      }
    } else {
      box(w, h, 0, 0, 0x343c40, 0.09);
      box(w * 0.95, h * 0.92, 0, 0, rule.color, 0.035, 0.19);
      if (kind === 'video') {
        // Stylized broadcast skyline and ticker distinguish displays from tile walls.
        box(w * 0.83, h * 0.075, 0, h * 0.32, rule.accent, 0.012, 0.22);
        for (let col = 0; col < 6; col++) {
          const bh = h * (0.18 + rnd(`${slot}:${col}:skyline`) * 0.3);
          box(w * 0.105, bh, (col - 2.5) * w * 0.14, -h * 0.22 + bh / 2,
            col % 2 ? 0x48769a : rule.accent, 0.012, 0.22);
        }
        box(w * 0.83, h * 0.035, 0, -h * 0.34, 0xe7c47e, 0.012, 0.22);
      } else if (kind === 'mosaic') {
        for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
          const color = rnd(`${slot}:${row}:${col}:pixel`) > 0.45 ? rule.accent : 0xd9a75a;
          box(w * 0.16, h * 0.23, (col - 2) * w * 0.18, (row - 1) * h * 0.27, color, 0.012, 0.22);
        }
      } else {
        box(w * 0.32, h * 0.63, -w * 0.25, 0, rule.accent, 0.012, 0.22);
        for (let line = 0; line < 4; line++) box(w * (0.38 - line * 0.04), h * 0.065,
          w * 0.2, h * (0.26 - line * 0.17), line ? 0x556166 : rule.accent, 0.012, 0.22);
      }
    }
    // Keep motifs complete when the building-wide budget runs out.
    if (parts.length + motif.length > budget) continue;
    parts.push(...motif); occupied.push(site);
  }
  return parts;
}

