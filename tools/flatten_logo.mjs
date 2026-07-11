// logo.png → logo_flat.png:去背 + 邊緣抗鋸齒,**保留原圖配色**。
// 純 Node(zlib 內建),不引入任何 npm 依賴。改完 logo.png 重跑即可。
//
// 三個關鍵決策(踩過坑):
// 1. alpha 由「與底色的色差」決定,不是亮度。機甲面片是暗藍(46,71,91),亮度低但離底色
//    (28,32,35)很遠 —— 用亮度門檻會把整片裝甲判成背景,鋼鐵三角就空掉了。
// 2. 色差走 smoothstep 平滑斜坡,不能硬切;硬切會削掉原圖的抗鋸齒邊 = 鋸齒。
//    另外整套在 2× 超取樣空間算,最後以 alpha 加權 box filter 降回原尺寸。
// 3. 邊緣像素 MUST 解除與底色的混合(un-premultiply):原圖的抗鋸齒邊是
//    「圖形色 × a + 底色 × (1−a)」,直接照抄會沿著每個圖形留一圈暗灰鑲邊。
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const SRC = 'C:/Users/user/Documents/app/steel_vs_swarm/public/assets/logo.png';
const DST = 'C:/Users/user/Documents/app/steel_vs_swarm/public/assets/logo_flat.png';
const SS = 2;                 // 超取樣倍率
const BG = [28, 32, 35];      // 原圖底色(取自四角)
const D0 = 10, D1 = 34;       // 色差斜坡:< D0 全透明,> D1 全不透明
const MARGIN = 14;            // 裁掉原圖那圈圓角外框(比底色稍亮,否則會留一條淡邊線)

// ---- 解碼 PNG ----
const buf = readFileSync(SRC);
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
const at = (x, y) => { const i = (y * w + x) * bpp; return [px[i], px[i + 1], px[i + 2]]; };

// ---- 2× 超取樣:算 alpha + 解除底色混合(保留原色)----
const W = w * SS, H = h * SS;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = Math.min(w - 1, x / SS), fy = Math.min(h - 1, y / SS);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const p00 = at(x0, y0), p10 = at(x1, y0), p01 = at(x0, y1), p11 = at(x1, y1);
  const c = [0, 1, 2].map((k) =>
    p00[k] * (1 - tx) * (1 - ty) + p10[k] * tx * (1 - ty) + p01[k] * (1 - tx) * ty + p11[k] * tx * ty);

  const d = Math.max(Math.abs(c[0] - BG[0]), Math.abs(c[1] - BG[1]), Math.abs(c[2] - BG[2]));
  let a = d <= D0 ? 0 : d >= D1 ? 1 : smooth((d - D0) / (D1 - D0));
  const m = MARGIN * SS;
  if (x < m || y < m || x >= W - m || y >= H - m) a = 0;

  const o = (y * W + x) * 4;
  if (a > 0.004) for (let k = 0; k < 3; k++) rgba[o + k] = clamp((c[k] - BG[k] * (1 - a)) / a);
  rgba[o + 3] = Math.round(a * 255);
}

// ---- 降取樣回原尺寸(alpha 加權 box filter → 邊緣平滑無鋸齒)----
const out = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  let ar = 0, ag = 0, ab = 0, aa = 0;
  for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
    const i = ((y * SS + dy) * W + x * SS + dx) * 4;
    const a = rgba[i + 3] / 255;
    ar += rgba[i] * a; ag += rgba[i + 1] * a; ab += rgba[i + 2] * a; aa += a;
  }
  const o = (y * w + x) * 4, n = SS * SS;
  if (aa > 0) { out[o] = Math.round(ar / aa); out[o + 1] = Math.round(ag / aa); out[o + 2] = Math.round(ab / aa); }
  out[o + 3] = Math.round((aa / n) * 255);
}

// ---- 編碼 PNG ----
const rawOut = Buffer.alloc(h * (w * 4 + 1));
for (let y = 0; y < h; y++) {
  rawOut[y * (w * 4 + 1)] = 0;
  out.copy(rawOut, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
}
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
ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
writeFileSync(DST, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ih),
  chunk('IDAT', deflateSync(rawOut, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log(`ok ${w}x${h} (SS=${SS}, 原色保留) -> logo_flat.png`);
