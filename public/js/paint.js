// ============ 機體塗裝(角色色系 + 性格花紋)============
// 兩件事:
//  1. heroPalette() — 由角色 visual.hue 推導整套機體色版(亮面/主裝甲/次裝甲/深件/關節)。
//     舊制每具機體硬編碼灰色裝甲 + 主色識別條;改制後裝甲本身就是角色色系,
//     識別條(emissive)不變 —— 遠看剪影分機種,近看配色分角色。
//  2. paintUnit() — 依角色性格花紋(visual.paint)生成一張程序 canvas 貼圖,
//     以「靜止姿勢的機體局部座標」做三平面投影(triplanar)貼上裝甲。
//     用靜止姿勢矩陣(建模當下、動畫前)= 花紋鎖在裝甲板上,關節怎麼動都不會游移;
//     用世界座標則會整片流動(機體一走就穿過花紋),MUST NOT 改。
// 花紋純程序生成:無外部貼圖檔、單張 256² 快取(同 pattern × 同 hue 只生一次)。
import * as THREE from 'three';
import { SIDES } from './data.js';
import { applyPaint } from './toon.js';

// ---- 色版階梯(亮度 / 飽和倍率;由亮到深)----
// light = 人形機甲/雙足獸(亮面裝甲);dark = 無人機/獸型/變形機甲(碳纖深色機體)
const LADDER = {
  light: { l: [0.70, 0.62, 0.50, 0.26, 0.17], s: [0.42, 0.52, 0.62, 0.55, 0.45] },
  dark: { l: [0.33, 0.25, 0.20, 0.15, 0.11], s: [0.48, 0.58, 0.66, 0.58, 0.50] },
};
const TIER = ['lite', 'main', 'mid', 'dark', 'deep'];

const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };

/**
 * 角色機體色版:hue 定色相,亮度/飽和走階梯 → 同一角色的所有裝甲件同色系不同明度
 * (賽璐璐面板分割的來源)。無彩度主色(白/灰角色)自然退化成灰階機體,符合其人設。
 * @param tone 'light' | 'dark'(機種既有的明暗基調,改制不動它)
 */
export function heroPalette(vis, side, tone = 'light') {
  _c.set(vis?.hue ?? SIDES[side]?.color ?? 0x99a3ad).getHSL(_hsl);
  const L = LADDER[tone] || LADDER.light;
  const light = tone !== 'dark';
  const hex = (s, l) => new THREE.Color().setHSL(_hsl.h, Math.min(0.72, s), l).getHex();
  const out = { accent: new THREE.Color(vis?.hue ?? SIDES[side]?.color ?? 0xffffff) };
  TIER.forEach((k, i) => { out[k] = hex(_hsl.s * L.s[i], L.l[i]); });
  // 花紋墨色:與裝甲基調「取反」才有對比 —— 亮機體用深墨、深機體用亮墨。
  // 直接沿用裝甲階梯會讓淡色角色(近白/近灰)的花紋整片糊掉。
  out.ink = light ? hex(_hsl.s * 0.5, 0.16) : hex(_hsl.s * 0.3, 0.68);
  out.ink2 = light ? hex(_hsl.s * 0.5, 0.42) : hex(_hsl.s * 0.4, 0.45);
  out.paper = light ? hex(_hsl.s * 0.25, 0.82) : hex(_hsl.s * 0.2, 0.10);
  // 鮮色:主色的高彩度版(花紋的主角)。無彩度角色(純白/純灰)保持墨色 —— 白機不該冒出紅條紋。
  out.hot = _hsl.s < 0.08 ? out.ink : hex(Math.max(0.62, _hsl.s), light ? 0.46 : 0.56);
  return out;
}

// ---- 程序花紋 ----
const TEX = 256;                      // 花紋貼圖邊長(賽璐璐花紋是大色塊,256² 足夠)
const cache = new Map();              // `${pattern}:${hue}:${tone}` -> CanvasTexture

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const css = (hex) => `#${new THREE.Color(hex).getHexString()}`;

/** 無縫平鋪:同一筆畫在 3×3 個位移上各畫一次(跨邊界的圖案自動接回另一側) */
function tiled(ctx, draw) {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    ctx.save();
    ctx.translate(i * TEX, j * TEX);
    draw();
    ctx.restore();
  }
}

/**
 * 不規則色塊(迷彩/塗鴉共用:邊緣硬 = 賽璐璐色塊)。
 * 頂點 MUST 先抽樣完再交給 tiled():在 tiled 的回呼內抽樣 = 九個複本各自不同 = 平鋪接縫。
 */
function blobPts(rnd, cx, cy, r, n = 7) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.6 + rnd() * 0.65);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}
function fillPts(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

// pattern → { tile(每個機體身高的重複次數), draw(ctx, palette, rnd) }
const PATTERNS = {
  // 極簡:大面留白,只有乾淨的分色帶與細分割線(制式塗裝)
  minimal: {
    tile: 1.0,
    draw(ctx, P) {
      ctx.fillStyle = css(P.ink);
      ctx.fillRect(0, 150, TEX, 26);                       // 主分色帶
      ctx.fillStyle = css(P.hot);
      ctx.fillRect(0, 176, TEX, 6);                        // 主色細邊
      ctx.fillStyle = css(P.ink2);
      for (const y of [46, 210]) ctx.fillRect(0, y, TEX, 4);  // 面板分割線
    },
  },
  // 迷彩:三階不規則斑塊(近似 flecktarn 的疏密分佈)
  camo: {
    tile: 2.4,
    draw(ctx, P, rnd) {
      const layers = [[P.ink2, 30, 34], [P.ink, 22, 26], [P.hot, 10, 14]];
      for (const [c, n, r] of layers) {
        ctx.fillStyle = css(c);
        for (let i = 0; i < n; i++) {
          const pts = blobPts(rnd, rnd() * TEX, rnd() * TEX, r * (0.5 + rnd() * 0.8), 6);
          tiled(ctx, () => fillPts(ctx, pts));
        }
      }
    },
  },
  // 塗鴉:主色噴漆潑塊 + 白色亂筆 tag + 噴點(街頭/自行補漆的機體)
  graffiti: {
    tile: 1.7,
    draw(ctx, P, rnd) {
      ctx.fillStyle = css(P.hot);
      for (let i = 0; i < 5; i++) {
        const pts = blobPts(rnd, rnd() * TEX, rnd() * TEX, 26 + rnd() * 30, 9);
        tiled(ctx, () => fillPts(ctx, pts));
      }
      ctx.strokeStyle = css(P.paper);                      // 反差色亂筆(亮機用深墨、深機用亮墨)
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x0 = rnd() * TEX, y0 = rnd() * TEX;
        const c = [x0 + 60 - rnd() * 120, y0 - 50, x0 + 70, y0 + 60 - rnd() * 40, x0 + 40 - rnd() * 90, y0 + 70];
        tiled(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.bezierCurveTo(c[0], c[1], c[2], c[3], c[4], c[5]);
          ctx.stroke();
        });
      }
      ctx.fillStyle = css(P.ink);
      for (let i = 0; i < 90; i++) {                       // 噴罐飛沫
        const x = rnd() * TEX, y = rnd() * TEX, r = 1 + rnd() * 3;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  // 紋身:細線描的流動曲線(刺青/手抄詩/電路走線的共同語彙)
  tattoo: {
    tile: 1.9,
    draw(ctx, P, rnd) {
      ctx.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const y0 = rnd() * TEX, amp = 20 + rnd() * 40, f = 1 + Math.floor(rnd() * 3);
        ctx.strokeStyle = css(k % 3 === 0 ? P.hot : P.ink);
        ctx.lineWidth = k % 3 === 0 ? 4 : 6;
        tiled(ctx, () => {
          ctx.beginPath();
          for (let x = 0; x <= TEX; x += 8) {
            const y = y0 + Math.sin((x / TEX) * Math.PI * 2 * f + k) * amp;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
      }
      ctx.fillStyle = css(P.ink);                           // 線間的小點(針刺感)
      for (let i = 0; i < 40; i++) {
        const x = rnd() * TEX, y = rnd() * TEX;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  // 圖騰:幾何帶狀紋(三角齒列 + 菱形 + 同心圓眼)—— 民族紋樣/部隊徽記
  totem: {
    tile: 1.5,
    draw(ctx, P) {
      ctx.fillStyle = css(P.ink);
      ctx.fillRect(0, 96, TEX, 64);                         // 主紋帶底
      ctx.fillStyle = css(P.hot);
      for (let i = 0; i < 8; i++) {                         // 三角齒列(上下對咬)
        const x = i * 32;
        ctx.beginPath();
        ctx.moveTo(x, 100); ctx.lineTo(x + 16, 126); ctx.lineTo(x + 32, 100);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 16, 156); ctx.lineTo(x + 32, 130); ctx.lineTo(x + 48, 156);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = css(P.ink2);
      ctx.lineWidth = 7;
      for (const cy of [34, 222]) for (let i = 0; i < 4; i++) {   // 同心圓眼
        const cx = 32 + i * 64;
        for (const r of [10, 20]) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    },
  },
  // 旗幟:大面橫帶 + 星徽(國旗/家徽/軍旗)
  flag: {
    tile: 0.95,
    draw(ctx, P) {
      ctx.fillStyle = css(P.hot);
      ctx.fillRect(0, 0, TEX, 92);
      ctx.fillStyle = css(P.ink);
      ctx.fillRect(0, 92, TEX, 26);
      ctx.fillStyle = css(P.paper);
      ctx.fillRect(0, 118, TEX, 60);
      ctx.fillStyle = css(P.ink);                           // 星徽(五芒)
      const cx = TEX / 2, cy = 148, R = 24;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const r = i % 2 ? R * 0.42 : R;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    },
  },
};

export const PAINT_PATTERNS = Object.keys(PATTERNS);

/** 生成(或取快取)花紋貼圖;seed 取 hue → 同角色每次開局圖樣一致(不用 Math.random) */
function paintTexture(pattern, pal, hue, tone) {
  const key = `${pattern}:${hue}:${tone}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const ctx = cv.getContext('2d');
  PATTERNS[pattern].draw(ctx, pal, mulberry32((hue >>> 0) ^ 0x9e3779b9));
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/**
 * 把角色花紋塗到已建好的機體上(fitToHeight / outlinify 之前呼叫)。
 * 跳過:描邊外殼、透明件(旋翼/膜翼)、發光件(識別燈/推進器/砲口)—— 花紋不吃掉辨識訊號。
 * @param root  builder 回傳的 Group(尚未進場景;matrixWorld = 自身局部座標)
 * @param tone  'light' | 'dark'(需與 builder 取色版時同一個值)
 */
export function paintUnit(root, vis, side, tone = 'light') {
  const pattern = PATTERNS[vis?.paint] ? vis.paint : 'minimal';
  const pal = heroPalette(vis, side, tone);
  const hue = vis?.hue ?? SIDES[side]?.color ?? 0xffffff;
  const tex = paintTexture(pattern, pal, hue, tone);
  root.updateMatrixWorld(true);
  const h = _box.setFromObject(root).getSize(_size).y || 1;
  const scale = PATTERNS[pattern].tile / h;   // 花紋重複頻率以機體身高為單位 → 大小機體看起來一樣密
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || o.userData.noPaint) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m?.isMeshToonMaterial || m.transparent) return;
    if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05 && (m.emissiveIntensity ?? 1) >= 0.5) return;
    // 靜止姿勢下「這個 mesh 的局部座標 → 機體根座標」的固定矩陣:
    // 花紋因此烤死在裝甲板上(關節旋轉不改變它),而不是投影在世界空間。
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    applyPaint(m, { tex, matrix: M, scale });
  });
  return root;
}
