// logo.png → 四個區塊各自獨立圖檔(去背、透明底,沿用 flatten 的同一條管線):
//   logo_steel_tri.png    鋼鐵三角(機甲)   — 保留金屬光澤
//   logo_gear.png         上方齒輪弧        — 保留金屬光澤
//   logo_swarm_tri.png    蜂群倒三角(含雙翼/蜂巢)— 純色平塗
//   logo_swarm_trail.png  下方蜂群軌跡(含蜂點)  — 純色平塗
//
// 分區靠「材質色相(鋼鐵/蜂群)× 連通元件」自動判定,不用手畫遮罩 —— 原圖微調也不會壞。
// 同材質內再以元件的垂直位置分家:鋼鐵取上方的齒輪弧 vs 下方的三角;蜂群取下方的軌跡
// vs 上方的倒三角。
//   node tools/split_logo.mjs [--probe]
import { writeFileSync } from 'node:fs';
import { buildLogo, writeCropped, CLS, OUT_DIR } from './logo_lib.mjs';

const PROBE = process.argv.includes('--probe');
const logo = buildLogo();
const { w, h, rgba, cls } = logo;
const solid = (i) => rgba[i * 4 + 3] >= 32;

// ---- 連通元件(4-連通,同材質才連)----
const comp = new Int32Array(w * h).fill(-1);
const comps = [];
const stack = [];
for (let s = 0; s < w * h; s++) {
  if (comp[s] >= 0 || !solid(s) || cls[s] === CLS.NONE) continue;
  const id = comps.length;
  const c = { id, cls: cls[s], n: 0, minX: w, minY: h, maxX: 0, maxY: 0, sumY: 0 };
  comps.push(c);
  stack.push(s);
  comp[s] = id;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p / w) | 0;
    c.n++; c.sumY += y;
    if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
    if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || comp[q] >= 0 || !solid(q) || cls[q] !== c.cls) continue;
      comp[q] = id;
      stack.push(q);
    }
  }
}

if (PROBE) {
  for (const c of comps.filter((c) => c.n > 60).sort((a, b) => b.n - a.n)) {
    console.log(`#${c.id} ${c.cls === CLS.STEEL ? 'STEEL' : 'SWARM'} n=${c.n} `
      + `bbox=(${c.minX},${c.minY})-(${c.maxX},${c.maxY}) cy=${Math.round(c.sumY / c.n)}`);
  }
  process.exit(0);
}

// ---- 分區:同材質內以元件重心的高度分家 ----
// 齒輪弧整段都在鋼鐵三角頂點之上;蜂群軌跡整段都在倒三角下緣之下。
// 實測邊界(--probe):齒輪元件重心 y=102/117,三角最上面的元件重心 y=183 → 140 分得開;
// 蜂群三角最下緣 y=304(SWARM 字樣),軌跡最上緣 y=313 → 308 分得開。
const GEAR_MAX_Y = 140;    // 鋼鐵元件重心高於此 = 齒輪弧
const TRAIL_MIN_Y = 308;   // 蜂群元件上緣低於此 = 下方軌跡
const region = new Uint8Array(w * h);   // 1 鋼鐵三角 / 2 齒輪 / 3 蜂群三角 / 4 蜂群軌跡
for (const c of comps) {
  const cy = c.sumY / c.n;
  const r = c.cls === CLS.STEEL
    ? (cy < GEAR_MAX_Y ? 2 : 1)
    : (c.minY > TRAIL_MIN_Y ? 4 : 3);
  for (let i = 0; i < w * h; i++) if (comp[i] === c.id) region[i] = r;
}
// 邊緣的半透明像素沒被歸到任何元件(cls=NONE)→ 貼回最近的區塊,否則輪廓會缺一圈
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = y * w + x;
  if (region[i] || rgba[i * 4 + 3] < 8) continue;
  for (let d = 1; d <= 2 && !region[i]; d++) {
    for (let dy = -d; dy <= d && !region[i]; dy++) for (let dx = -d; dx <= d; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const r = region[yy * w + xx];
      if (r) { region[i] = r; break; }
    }
  }
}

const FILES = [
  ['logo_gear.png', 2, '上方齒輪弧(金屬光澤)'],
  ['logo_steel_tri.png', 1, '鋼鐵三角(金屬光澤)'],
  ['logo_swarm_tri.png', 3, '蜂群倒三角(純色平塗)'],
  ['logo_swarm_trail.png', 4, '下方蜂群軌跡(純色平塗)'],
];
// manifest 記下每塊在**原圖 512² 座標系**的左上角 —— 這是把四塊拼回整枚徽記的唯一依據。
// 單獨修改任何一塊後,跑 `node tools/compose_logo.mjs` 就能還原成 logo_flat.png。
// 修圖時 MUST 維持該塊的畫布尺寸(w×h)不變;要移動位置就改這裡的 x/y,不要裁掉透明邊。
const parts = [];
for (const [file, r, desc] of FILES) {
  const { cw, ch, x, y } = writeCropped(file, logo, (px, py) => region[py * w + px] === r);
  parts.push({ file, x, y, w: cw, h: ch, desc });
  console.log(`ok ${file}  ${cw}x${ch} @ (${x},${y})  ${desc}`);
}
writeFileSync(`${OUT_DIR}/logo_parts.json`, JSON.stringify({
  note: '四區塊的拼合座標(原圖 512² 座標系)。改完任一塊後跑 node tools/compose_logo.mjs 還原 logo_flat.png。',
  canvas: { w, h },
  order: '由後往前依序 src-over 合成(陣列順序即繪製順序)',
  parts,
}, null, 2));
console.log('ok logo_parts.json(拼合座標)');
