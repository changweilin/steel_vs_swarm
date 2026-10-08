// Four quadrants to logo_flat.png: reassemble the four tiles cut by split_logo.mjs at manifest coordinates into the full emblem.
//
//   node tools/split_logo.mjs      # cut: logo.png to four PNGs plus logo_parts.json (coordinates)
//   (edit any single tile alone, for example repainting the swarm triangle)
//   node tools/compose_logo.mjs    # join: four PNGs plus logo_parts.json to logo_flat.png
//
// Rules (MUST hold when editing art, else reassembly misaligns):
// - Each tile canvas size w by h is immutable, keep transparent margins -- alignment relies solely on canvas top-left.
// - To move a tile, edit x/y in logo_parts.json (source 512 square coordinate frame), never shift pixels inside the art.
// - Replacing a tile (repaint or restyle) needs no split rerun; overwrite that PNG then compose.
// - compose never reads logo.png back; the four PNGs are the sole source of truth.
import { readFileSync } from 'node:fs';
import { decodePNG, encodePNG, OUT_DIR } from './logo_lib.mjs';

const PAD = 6;
const man = JSON.parse(readFileSync(`${OUT_DIR}/logo_parts.json`, 'utf8'));
const { w, h } = man.canvas;
const canvas = Buffer.alloc(w * h * 4);

for (const p of man.parts) {
  const img = decodePNG(`${OUT_DIR}/${p.file}`);
  if (img.bpp !== 4) throw new Error(`${p.file}:必須是 RGBA(帶 alpha)PNG`);
  if (img.w !== p.w || img.h !== p.h) {
    throw new Error(`${p.file}:畫布尺寸 ${img.w}x${img.h} ≠ manifest 的 ${p.w}x${p.h}。`
      + '修圖 MUST 維持畫布尺寸;要移動請改 logo_parts.json 的 x/y。');
  }
  // src-over composite (tiles are disjoint today, but standard blending stays safe if they ever overlap)
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const cx = x + p.x, cy = y + p.y;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const s = (y * img.w + x) * 4, d = (cy * w + cx) * 4;
    const sa = img.px[s + 3] / 255;
    if (sa === 0) continue;
    const da = canvas[d + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) {
      canvas[d + k] = Math.round((img.px[s + k] * sa + canvas[d + k] * da * (1 - sa)) / oa);
    }
    canvas[d + 3] = Math.round(oa * 255);
  }
}

// Auto-crop to opaque bounds (same routine as flatten_logo.mjs, output directly replaces logo_flat.png)
let minX = w, minY = h, maxX = -1, maxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (canvas[(y * w + x) * 4 + 3] < 8) continue;
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
}
minX = Math.max(0, minX - PAD); minY = Math.max(0, minY - PAD);
maxX = Math.min(w - 1, maxX + PAD); maxY = Math.min(h - 1, maxY + PAD);
const cw = maxX - minX + 1, ch = maxY - minY + 1;

const rows = Buffer.alloc(ch * (cw * 4 + 1));
for (let y = 0; y < ch; y++) {
  const row = y * (cw * 4 + 1);
  rows[row] = 0;
  canvas.copy(rows, row + 1, ((y + minY) * w + minX) * 4, ((y + minY) * w + minX + cw) * 4);
}
encodePNG('logo_flat.png', cw, ch, rows);
console.log(`ok 合成 ${man.parts.length} 塊 -> logo_flat.png (${cw}x${ch})`);
