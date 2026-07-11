// 四區塊 → logo_flat.png:把 split_logo.mjs 切出來的四塊依 manifest 座標拼回整枚徽記。
//
//   node tools/split_logo.mjs      # 切:logo.png → 四塊 PNG + logo_parts.json(座標)
//   (單獨修改任何一塊 PNG,例如重畫蜂群三角)
//   node tools/compose_logo.mjs    # 合:四塊 PNG + logo_parts.json → logo_flat.png
//
// 規則(改圖時 MUST 遵守,否則拼回去會錯位):
// - 每塊 PNG 的**畫布尺寸 w×h 不可變**,透明邊不要裁掉 —— 對齊完全靠畫布左上角。
// - 要移動某塊的位置,改 logo_parts.json 的 x/y(原圖 512² 座標系),不要平移圖內容。
// - 換掉某塊(重畫/換風格)也不需重跑 split;直接覆蓋該 PNG 再 compose 即可。
// - compose 不會回頭讀 logo.png;四塊 PNG 就是唯一真相。
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
  // src-over 合成(四塊本來不重疊,但照樣走標準合成,日後重疊也不會爆)
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

// 自動裁切到不透明邊界(與 flatten_logo.mjs 同一套,輸出可直接替換 logo_flat.png)
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
