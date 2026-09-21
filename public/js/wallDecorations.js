import { architectureHash } from './buildingDiversity.js';
import { WALL_DECORATIONS, WALL_COVERAGE, WALL_DECORATION_PLACEMENT } from './wallDecorationCatalog.js';

// 高樓爬藤門檻（m）：達此樓高即視為高樓，植物系飾件僅 5% 保留（見 wallDecorationParts）。
const TALL_VINE_LIMIT = 24;
// Local wall coordinates: X along the wall, Y above its base, +Z outdoors.
// Claims are conservative rectangles of existing attachments, including doors.
export function wallDecorationParts({ seed, width, height, category, contemporary, claims = [], budget = 80 }) {
  const placement = WALL_DECORATION_PLACEMENT;
  if (![width, height, budget].every(Number.isFinite) || width < placement.minLength || height < placement.minHeight || budget < 24) return [];
  const rnd = tag => architectureHash(seed, tag) / 4294967296;
  // 高樓外牆不爬藤：樓高 ≥ 24m 時植物系（ivy / flowering_trellis / hanging_vines）
  // 僅 5% 保留，其餘整面牆不候選。只吃座標雜湊，不消耗共享 rnd（§2.3）。
  const tall = height >= TALL_VINE_LIMIT;
  const vineKeep = !tall || architectureHash(seed, 'vine_keep') % 100 < 5;
  const choices = Object.entries(WALL_DECORATIONS).filter(([, rule]) =>
    rule.categories.includes(category) && (!rule.modern || contemporary) && (!rule.plant || !tall || vineKeep));
  if (!choices.length || rnd('presence') > placement.prob) return [];
  const parts = [], occupied = [...claims];
  const scopes = Object.entries(WALL_COVERAGE);
  for (let slot = 0; slot < placement.maxCount; slot++) {
    const [kind, rule] = choices[Math.floor(rnd(`${slot}:type`) * choices.length)];
    const [scope, [wf, hf]] = scopes[Math.floor(rnd(`${slot}:scope`) * scopes.length)];
    const w = Math.min(8, (width - 0.8) * wf * (0.8 + rnd(`${slot}:w`) * 0.4));
    const h = Math.min(6, (height - 0.8) * hf * (0.8 + rnd(`${slot}:h`) * 0.4));
    if (w < 0.75 || h < 0.7) continue;
    let site = null;
    // 高樓僅存的 5% 爬藤箝制在底部 8m（底層綠化）：飾件頂部不超過 8m，不飄到高空。
    const ySpan = (tall && rule.plant)
      ? Math.max(0.5, Math.min(8, height - h - 0.8) - h - 0.4) : height - h - 0.8;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = (rnd(`${slot}:${attempt}:x`) - 0.5) * (width - w - 0.8);
      const y = 0.4 + h / 2 + rnd(`${slot}:${attempt}:y`) * ySpan;
      if (occupied.some(r => Math.abs(x - r.x) < (w + r.w) / 2 + 0.15 &&
        Math.abs(y - r.y) < (h + r.h) / 2 + 0.15)) continue;
      site = { x, y, w, h }; break;
    }
    if (!site) continue;
    const motif = [];
    const box = (bw, bh, x, y, color, depth = 0.04, z = 0.12) => motif.push({
      g: ['box', bw, bh, depth], p: [site.x + x, site.y + y, z], c: color,
      role: `wall-${kind}`, scope,
    });
    if (rule.plant) {
      if (kind === 'flowering_trellis') {
        for (let i = 0; i < 4; i++) box(0.045, h, (i / 3 - 0.5) * w * 0.9, 0, 0x87745b);
        for (let i = 0; i < 3; i++) box(w, 0.045, 0, (i - 1) * h * 0.42, 0x87745b);
      }
      if (kind === 'hanging_vines') box(w, 0.22, 0, h / 2 - 0.11, 0x986b50, 0.32, 0.24);
      for (let vine = 0; vine < 3; vine++) {
        const x = (vine - 1) * w * 0.29;
        const reach = h * (0.55 + rnd(`${slot}:${vine}:reach`) * 0.4);
        const center = kind === 'hanging_vines' ? (h - reach) / 2 : (reach - h) / 2;
        box(0.035, reach, x, center, 0x5c6740, 0.035, 0.17);
        for (let leaf = 0; leaf < 5; leaf++) {
          const lx = x + (leaf % 2 ? 1 : -1) * w * 0.055;
          const ly = center + (leaf / 4 - 0.5) * reach * 0.8;
          // Faceted diamond leaves: no textures, alpha sorting, or extra material buckets.
          motif.push({ g: ['cyl', w * 0.1, w * 0.06, 0.07, 4],
            p: [site.x + lx, site.y + ly, 0.22], r: [Math.PI / 2, leaf * 0.8, 0],
            s: [1, 1, Math.min(1, h / w)], c: leaf % 3 ? rule.color : rule.accent,
            role: `wall-${kind}`, scope });
        }
      }
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
      for (let i = 0; i < 6; i++) {
        const x = (i - 2.5) * w * 0.145;
        const y = (rnd(`${slot}:${i}:stroke`) - 0.5) * h * 0.25;
        for (let layer = 0; layer < 2; layer++) motif.push({
          g: ['cyl', w * (layer ? 0.083 : 0.105), w * (layer ? 0.083 : 0.105), 0.016, 8],
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
