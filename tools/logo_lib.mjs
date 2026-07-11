// logo 影像處理共用核心(純 Node,zlib 內建,無 npm 依賴)。
// flatten_logo.mjs(整枚徽記)與 split_logo.mjs(四區塊分檔)共用同一份去背/銳化管線。
//
// 四個關鍵決策(踩過坑):
// 1. alpha 由「與底色的色差」決定,不是亮度。機甲面片是暗藍(46,71,91),亮度低但離底色
//    (28,32,35)很遠 —— 用亮度門檻會把整片裝甲判成背景,鋼鐵三角就空掉了。
// 2. 覆蓋率用**硬遮罩**(d ≥ CUT),不用漸進斜坡。原圖每個圖形外圍都有一圈柔光暈,
//    斜坡會把光暈整片留下來 → 背景霧霧的、邊緣糊掉。硬切才乾淨。
// 3. 硬切會鋸齒 → 整套在 SS× 超取樣空間做,最後以 alpha 加權 box filter 降回原尺寸,
//    邊緣柔和度只來自降取樣(≈1px),既銳利又無鋸齒。
// 4. 取色 MUST 解除與底色的混合(un-premultiply):原圖抗鋸齒邊是「圖形色 × a + 底色 ×
//    (1−a)」,直接照抄會沿著輪廓鑲一圈暗灰邊。解混用的是**平滑** alpha(不是硬遮罩)。
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

export const SRC = 'C:/Users/user/Documents/app/steel_vs_swarm/public/assets/logo.png';
export const OUT_DIR = 'C:/Users/user/Documents/app/steel_vs_swarm/public/assets';
export const SS = 4;                 // 超取樣倍率
export const BG = [28, 32, 35];      // 原圖底色(取自四角)
export const CUT = 26;               // 硬遮罩門檻:色差 ≥ 此值才算圖形(低於此 = 光暈)
export const D0 = 8, D1 = 30;        // 解混用的平滑 alpha 斜坡(只影響取色,不影響覆蓋率)
export const SWARM_FLAT = [255, 198, 26];  // 蜂群純色(平塗,無漸層)
export const MARGIN = 14;            // 裁掉原圖那圈圓角外框
export const TEXT_Y = 378;           // 這條線以下是「STEEL VS SWARM」字樣 → 整段裁掉
export const CLS = { NONE: 0, STEEL: 1, SWARM: 2 };

export function decodePNG(path) {
  const buf = readFileSync(path);
  let off = 8, ihdr = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9] };
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const { w, h, depth, color } = ihdr;
  if (depth !== 8 || (color !== 2 && color !== 6)) throw new Error(`unsupported PNG depth=${depth} color=${color}`);
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= bpp ? px[i - bpp] : 0, b = y > 0 ? px[i - stride] : 0, c = y > 0 && x >= bpp ? px[i - stride - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
        v += da <= db && da <= dc ? a : db <= dc ? b : c;
      }
      px[i] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

// 去背 + 銳化 + 蜂群純化。回傳原尺寸的 RGBA 與逐像素材質分類(cls)。
export function buildLogo() {
  const { w, h, bpp, px } = decodePNG(SRC);
  const at = (x, y) => { const i = (y * w + x) * bpp; return [px[i], px[i + 1], px[i + 2]]; };
  const W = w * SS, H = h * SS;
  const smooth = (t) => t * t * (3 - 2 * t);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

  const hi = Buffer.alloc(W * H * 4);
  const hiCls = new Uint8Array(W * H);
  const tone = new Uint8Array(W * H * 3);   // 解混後的本色(鋼鐵要用它保留金屬漸層)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(w - 1, x / SS), fy = Math.min(h - 1, y / SS);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const p00 = at(x0, y0), p10 = at(x1, y0), p01 = at(x0, y1), p11 = at(x1, y1);
    const c = [0, 1, 2].map((k) =>
      p00[k] * (1 - tx) * (1 - ty) + p10[k] * tx * (1 - ty) + p01[k] * (1 - tx) * ty + p11[k] * tx * ty);

    const d = Math.max(Math.abs(c[0] - BG[0]), Math.abs(c[1] - BG[1]), Math.abs(c[2] - BG[2]));
    const i = y * W + x, o = i * 4;
    const m = MARGIN * SS;
    const inFrame = x >= m && y >= m && x < W - m && y < H - m && y < TEXT_Y * SS;
    if (!inFrame || d < CUT) continue;                       // 光暈 / 外框 / 底部文字 → 丟掉

    const a = Math.max(0.05, d <= D0 ? 0 : d >= D1 ? 1 : smooth((d - D0) / (D1 - D0)));
    const t = [0, 1, 2].map((k) => clamp((c[k] - BG[k] * (1 - a)) / a));
    tone[i * 3] = t[0]; tone[i * 3 + 1] = t[1]; tone[i * 3 + 2] = t[2];
    hi[o + 3] = 255;
    // 材質分類**只在高彩度處**下判斷。圖形內部的暗色描邊彩度低、色相不可信,硬判會讓黃色
    // 形狀的描邊被歸成鋼鐵 → 連通元件碎成上百塊、分區全亂。低信心的一律留白待傳播。
    if (t[0] > t[2] + 60 && t[0] > 90) hiCls[i] = CLS.SWARM;
    else if (t[2] > t[0] + 25 && t[2] > 70) hiCls[i] = CLS.STEEL;
  }

  // 低信心像素(暗描邊)以 BFS 從最近的高信心像素取材質 → 描邊歸屬它所包圍的形狀
  const queue = [];
  for (let i = 0; i < W * H; i++) if (hiCls[i]) queue.push(i);
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi], x = p % W, y = (p / W) | 0;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
      if (q < 0 || hiCls[q] || hi[q * 4 + 3] === 0) continue;
      hiCls[q] = hiCls[p];
      queue.push(q);
    }
  }

  // 上色:蜂群純化為單一色(平塗);鋼鐵保留解混後的原色(金屬漸層/光澤)
  for (let i = 0; i < W * H; i++) {
    if (!hi[i * 4 + 3]) continue;
    const col = hiCls[i] === CLS.SWARM ? SWARM_FLAT : [tone[i * 3], tone[i * 3 + 1], tone[i * 3 + 2]];
    hi[i * 4] = col[0]; hi[i * 4 + 1] = col[1]; hi[i * 4 + 2] = col[2];
  }

  // 降取樣:alpha 加權 box filter(邊緣銳利但無鋸齒);cls 取多數決
  const rgba = Buffer.alloc(w * h * 4);
  const cls = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ar = 0, ag = 0, ab = 0, aa = 0, nSteel = 0, nSwarm = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const j = (y * SS + dy) * W + x * SS + dx, i = j * 4;
      const a = hi[i + 3] / 255;
      ar += hi[i] * a; ag += hi[i + 1] * a; ab += hi[i + 2] * a; aa += a;
      if (hiCls[j] === CLS.STEEL) nSteel++; else if (hiCls[j] === CLS.SWARM) nSwarm++;
    }
    const k = y * w + x, o = k * 4, n = SS * SS;
    if (aa > 0) { rgba[o] = Math.round(ar / aa); rgba[o + 1] = Math.round(ag / aa); rgba[o + 2] = Math.round(ab / aa); }
    rgba[o + 3] = Math.round((aa / n) * 255);
    cls[k] = nSwarm > nSteel ? CLS.SWARM : nSteel > 0 ? CLS.STEEL : CLS.NONE;
  }
  return { w, h, rgba, cls };
}

// 通用 PNG 編碼(RGBA8)
export function encodePNG(file, cw, ch, rgbaRows) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cr]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(cw, 0); ih.writeUInt32BE(ch, 4); ih[8] = 8; ih[9] = 6;
  writeFileSync(`${OUT_DIR}/${file}`, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih),
    chunk('IDAT', deflateSync(rgbaRows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// 自動裁切到不透明邊界後編碼輸出(keep:回傳該像素是否保留,可用來只導出某個區塊)
// 回傳的 x/y 是這塊在**原圖 512² 座標系**的左上角 —— 拼回去全靠它(見 compose_logo.mjs)。
export function writeCropped(file, { w, h, rgba }, keep = () => true, pad = 6) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] < 8 || !keep(x, y)) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) throw new Error(`${file}: 沒有任何像素被保留`);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;

  const rawOut = Buffer.alloc(ch * (cw * 4 + 1));
  for (let y = 0; y < ch; y++) {
    const row = y * (cw * 4 + 1);
    rawOut[row] = 0;
    for (let x = 0; x < cw; x++) {
      const sx = x + minX, sy = y + minY, s = (sy * w + sx) * 4, dst = row + 1 + x * 4;
      if (!keep(sx, sy)) continue;
      rawOut[dst] = rgba[s]; rawOut[dst + 1] = rgba[s + 1]; rawOut[dst + 2] = rgba[s + 2]; rawOut[dst + 3] = rgba[s + 3];
    }
  }
  encodePNG(file, cw, ch, rawOut);
  return { cw, ch, x: minX, y: minY };
}
