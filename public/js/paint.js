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
// light = 人形機甲/雙足獸(亮面裝甲);dark = 無人機/獸型/變形者(碳纖深色機體)
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

// ---- 花紋分類(2026-07-24 塗裝改制)----
// 使用者定案:除迷彩外全部改掉。三種取向:
//  A. 徽記(map:'single', front:true)—— 圖騰/刺青/旗幟只在機體正面顯眼處貼「一枚完整徽記」,
//     其餘裝甲純色(靠透明底 + ClampToEdge:徽記外一律無貼花 → 露出角色純色裝甲)。
//  B. 國旗塗裝(map:'single', front:false)—— 體色貼近該國國旗者,以國旗配色橫帶纏滿全機。
//     色帶取自 data.js 各角色 visual.flag(單一真相;此處不硬編國旗)。
//  C. 覆蓋型(map:'tile')—— 迷彩(camo)與淡櫻吹雪(sakura)整機平鋪。
// pattern → { map, tile?(tile), frac?/yOff?/front?(single), draw(ctx, P, rnd, opts) }
//   純單色(solid)不進本表:paintUnit 直接 early-return 不掛任何貼花。

// 五芒星(徽記共用)
function star(ctx, cx, cy, R, ratio = 0.42) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? R * ratio : R;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const PATTERNS = {
  // 雙色:大面純色 + 一條乾淨分色帶與細分割線(制式塗裝;「單色或雙色」的雙色版)
  minimal: {
    map: 'tile', tile: 1.0,
    draw(ctx, P) {
      ctx.fillStyle = css(P.ink);
      ctx.fillRect(0, 150, TEX, 26);                       // 主分色帶
      ctx.fillStyle = css(P.hot);
      ctx.fillRect(0, 176, TEX, 6);                        // 主色細邊
      ctx.fillStyle = css(P.ink2);
      for (const y of [46, 210]) ctx.fillRect(0, y, TEX, 4);  // 面板分割線
    },
  },
  // 迷彩:三階不規則斑塊(近似 flecktarn 的疏密分佈)—— 唯一維持整機平鋪的花紋
  camo: {
    map: 'tile', tile: 2.4,
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
  // 圖騰(單一主徽):民族紋樣圓盤徽章 —— 對比底盤 + 墨色三角齒圈 + 同心圓眼 + 色心菱形。
  // 徽記全走 paper↔ink 的明暗對(色版天生的高對比對),確保單色機身上仍一眼可辨(顯眼)。
  totem: {
    map: 'single', front: true, frac: 0.5, yOff: 0.1,
    draw(ctx, P) {
      const cx = 128, cy = 128;
      ctx.fillStyle = css(P.paper);                         // 對比底盤(與裝甲取反的明暗)
      ctx.beginPath(); ctx.arc(cx, cy, 96, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 10; ctx.strokeStyle = css(P.ink);     // 外環
      ctx.beginPath(); ctx.arc(cx, cy, 88, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = css(P.ink);                           // 三角齒圈(朝內,墨色高對比)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const a2 = ((i + 0.5) / 16) * Math.PI * 2;
        const p = (r, ang) => [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
        const [x0, y0] = p(80, a), [x1, y1] = p(80, ((i + 1) / 16) * Math.PI * 2), [x2, y2] = p(56, a2);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.closePath(); ctx.fill();
      }
      ctx.lineWidth = 7; ctx.strokeStyle = css(P.ink);      // 同心圓眼
      for (const r of [30, 44]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = css(P.hot);                           // 中央菱形(角色色 pop)
      ctx.beginPath();
      ctx.moveTo(cx, cy - 22); ctx.lineTo(cx + 16, cy); ctx.lineTo(cx, cy + 22); ctx.lineTo(cx - 16, cy);
      ctx.closePath(); ctx.fill();
    },
  },
  // 刺青(單一主徽):對稱線描羽紋徽章 —— 對比橢圓底 + 墨色羽線 + 色心寶石
  tattoo: {
    map: 'single', front: true, frac: 0.52, yOff: 0.08,
    draw(ctx, P) {
      const cx = 128, cy = 128;
      ctx.fillStyle = css(P.paper);                         // 對比橢圓底盤
      ctx.beginPath(); ctx.ellipse(cx, cy, 56, 80, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = css(P.ink);
      ctx.beginPath(); ctx.ellipse(cx, cy, 50, 74, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of [-1, 1]) {                            // 左右對稱羽線(墨色)
        ctx.strokeStyle = css(P.ink); ctx.lineWidth = 9;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.moveTo(cx, 100 + k * 18);
          ctx.bezierCurveTo(cx + s * 40, 80 + k * 16, cx + s * (66 - k * 8), 108 + k * 14, cx + s * (40 - k * 12), 160 + k * 6);
          ctx.stroke();
        }
      }
      ctx.fillStyle = css(P.hot);                           // 中軸寶石(菱形,角色色)
      ctx.beginPath();
      ctx.moveTo(cx, 82); ctx.lineTo(cx + 18, 118); ctx.lineTo(cx, 154); ctx.lineTo(cx - 18, 118);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = css(P.ink);                           // 中軸針點
      for (const y of [74, 162, 176]) { ctx.beginPath(); ctx.arc(cx, y, 4, 0, Math.PI * 2); ctx.fill(); }
    },
  },
  // 旗幟(單一主徽):盾形軍徽 —— 墨色盾面 + 對比橫帶 + 色心星 + 對比盾框
  flag: {
    map: 'single', front: true, frac: 0.5, yOff: 0.06,
    draw(ctx, P) {
      const cx = 128;
      const shield = () => {
        ctx.beginPath();
        ctx.moveTo(cx - 70, 62); ctx.lineTo(cx + 70, 62); ctx.lineTo(cx + 70, 150);
        ctx.quadraticCurveTo(cx + 70, 196, cx, 214);
        ctx.quadraticCurveTo(cx - 70, 196, cx - 70, 150);
        ctx.closePath();
      };
      shield(); ctx.fillStyle = css(P.ink); ctx.fill();     // 盾面(墨色,高對比)
      ctx.save(); shield(); ctx.clip();                     // 橫帶(裁進盾內,對比色)
      ctx.fillStyle = css(P.paper); ctx.fillRect(cx - 70, 116, 140, 28);
      ctx.restore();
      ctx.fillStyle = css(P.hot); star(ctx, cx, 94, 28); ctx.fill();  // 星(角色色 pop)
      shield(); ctx.lineWidth = 9; ctx.strokeStyle = css(P.paper); ctx.stroke();  // 盾框(對比色,深底也跳出)
    },
  },
  // 淡櫻吹雪:整機平鋪、疏落的五瓣櫻 + 飄落單瓣(淡色近裝甲 → 低對比「淡淡」)
  sakura: {
    map: 'tile', tile: 1.9,
    draw(ctx, P, rnd) {
      const petal = (x, y, r, rot, col) => {                // 單片花瓣(缺口淚滴)
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.fillStyle = css(col);
        ctx.beginPath();
        ctx.moveTo(0, r);
        ctx.quadraticCurveTo(r * 0.72, r * 0.3, r * 0.34, -r * 0.7);
        ctx.quadraticCurveTo(0, -r * 0.5, -r * 0.34, -r * 0.7);
        ctx.quadraticCurveTo(-r * 0.72, r * 0.3, 0, r);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      };
      const blossom = (x, y, r, col) => {                   // 五瓣櫻
        for (let i = 0; i < 5; i++) petal(x, y, r, (i / 5) * Math.PI * 2, col);
      };
      for (let i = 0; i < 5; i++) {                         // 幾朵完整櫻花(淡)
        const c = i % 2 ? P.ink2 : P.ink;
        tiled(ctx, () => blossom(rnd() * TEX, rnd() * TEX, 12 + rnd() * 8, c));
      }
      for (let i = 0; i < 14; i++) {                        // 飄落單瓣(吹雪)
        const x = rnd() * TEX, y = rnd() * TEX, r = 6 + rnd() * 6, rot = rnd() * Math.PI * 2;
        tiled(ctx, () => petal(x, y, r, rot, P.ink));
      }
    },
  },
  // 國旗塗裝(natflag)不進本表:走 paintUnit 的 paintNationalLivery() 逐件實色重染,
  // 非三平面貼圖 —— 每個物件單一顏色、依體積 80/20 分主色/配色(使用者定案)。
};

export const PAINT_PATTERNS = Object.keys(PATTERNS);

/**
 * 生成(或取快取)花紋貼圖;seed 取 hue → 同角色每次開局圖樣一致(不用 Math.random)。
 * single 徽記/國旗塗裝用 ClampToEdge:貼花窗外一律取透明邊 → 不重複、露出純色裝甲。
 */
function paintTexture(pattern, pal, hue, tone, opts) {
  const single = PATTERNS[pattern].map === 'single';
  const flagKey = opts && opts.flag ? opts.flag.join('-') : '';
  const key = `${pattern}:${hue}:${tone}:${flagKey}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const ctx = cv.getContext('2d');
  PATTERNS[pattern].draw(ctx, pal, mulberry32((hue >>> 0) ^ 0x9e3779b9), opts);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = single ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ctr = new THREE.Vector3();
const _mb = new THREE.Box3();
const _msz = new THREE.Vector3();
const _mc = new THREE.Vector3();

/** 可上漆件:排除描邊殼、透明件(旋翼/膜翼)、發光件(識別燈/推進器/砲口)、noPaint 徽章。 */
function paintMat(o) {
  if (!o.isMesh || o.userData.isOutline || o.userData.noPaint) return null;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m?.isMeshToonMaterial || m.transparent) return null;
  if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05 && (m.emissiveIntensity ?? 1) >= 0.5) return null;
  return m;
}

/**
 * 國旗塗裝:逐件實色重染(非貼圖)。使用者定案「體積佔比 80% 的物件染主色、其餘 20% 染配色,
 * 每個物件單一顏色」。做法:可上漆件依 root 空間包圍盒體積由大到小排序,累積體積達總量 80%
 * 之前的(即最大的一批件)全染 flag[0] 主色;其餘小件輪替 flag[1..] 配色。發光識別條照舊跳過。
 */
function paintNationalLivery(root, inv, flag, pal) {
  const cols = (flag && flag.length) ? flag : [pal.main, pal.lite];
  const items = [];
  let total = 0;
  root.traverse((o) => {
    const m = paintMat(o);
    if (!m) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _mb.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    _mb.getSize(_msz);
    const vol = Math.max(1e-4, _msz.x * _msz.y * _msz.z);
    items.push({ m, vol });
    total += vol;
  });
  items.sort((a, b) => b.vol - a.vol);
  const accents = cols.length > 1 ? cols.slice(1) : cols;
  let acc = 0, ai = 0;
  for (const it of items) {
    const col = acc < 0.8 * total ? cols[0] : accents[ai++ % accents.length];  // 前 80% 體積 → 主色
    acc += it.vol;
    it.m.color.set(col);
  }
  return root;
}

/**
 * 徽記(單一主徽):在「完整平面、無配件插入」的裝甲板上貼一枚徽章。
 * 做法:於指定顯眼面(直立機甲 +Z / 橫置機種 +Y)挑一片「面積大且薄(= 平板)」的外緣件,
 * 只把徽記貼到那一片 mesh 上(其餘件完全不上漆)—— 徽記因此不會被相鄰配件戳破/分割。
 * @param axis 面軸:1 = +Y 頂面、2 = +Z 正面
 */
function paintEmblemPlate(root, inv, tex, axis) {
  let best = null, bestScore = -1;
  root.traverse((o) => {
    const m = paintMat(o);
    if (!m) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const Ml = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    _mb.copy(o.geometry.boundingBox).applyMatrix4(Ml);
    _mb.getSize(_msz); _mb.getCenter(_mc);
    const inPlane = axis === 2 ? _msz.x * _msz.y : _msz.x * _msz.z;   // 板面面積(垂直於面軸)
    const thick = axis === 2 ? _msz.z : _msz.y;                       // 沿面軸厚度(越薄越像平板)
    const outer = axis === 2 ? _mc.z : _mc.y;                         // 越外(前/上)越優先
    if (inPlane < 0.03) return;
    // 面積大 + 薄 + 靠外;`* Ml` 使 outer 與 inPlane 同在 root 空間可比較
    const score = (inPlane / (1 + 2.4 * thick)) * (1 + 0.6 * Math.max(0, outer));
    if (score > bestScore) {
      bestScore = score;
      const ipB = axis === 2 ? _msz.y : _msz.z;                        // 面內另一軸(x 為共通軸)
      best = { m, mat: Ml, cx: _mc.x, cy: _mc.y, cz: _mc.z, ews: 0.82 * Math.min(_msz.x, ipB) };
    }
  });
  if (!best) return root;
  const scale = 1 / best.ews;
  const pre = new THREE.Matrix4().makeTranslation(
    0.5 * best.ews - best.cx, 0.5 * best.ews - best.cy, 0.5 * best.ews - best.cz);
  const M = new THREE.Matrix4().multiplyMatrices(pre, best.mat);
  const face = axis === 2 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  applyPaint(best.m, { tex, matrix: M, scale, face });
  return root;
}

/**
 * 空間兩色分(split):同色系,逐頂點染「亮/暗」兩階,走頂點色(material.color = 白 × 頂點色)。
 * ⇒ 分界不受 mesh 邊界限制、跨件一刀切;跨界三角形由頂點色內插成柔和接縫。發光識別條/透明件不動。
 * 兩種判準:
 *   位置分 split:'x'|'y'|'z' —— 依頂點在該軸的絕對位置切亮/暗(狼人左右、人馬上下)。
 *   反蔭   split:'shade'    —— 依「面朝上/下」(頂點法線 y),朝上→暗、朝下→亮、側面→中間調。
 *                             整機每個面(含薄翼的翼頂/翼底)各自 countershade,不看絕對高度。
 * @param vis.splitAt 0..1(位置分:分界在該軸 bbox 的比例,預設 0.5);vis.splitFlip 反轉亮暗側。
 */
function paintAxisSplit(root, inv, vis) {
  const shade = vis?.split === 'shade';
  const ax = vis?.split === 'x' ? 0 : vis?.split === 'z' ? 2 : 1;
  const key = ['x', 'y', 'z'][ax];
  const frac = vis?.splitAt ?? 0.5;
  const flip = !!vis?.splitFlip;
  _c.set(vis?.hue ?? 0x9aa3ad).getHSL(_hsl);
  const hi = new THREE.Color().setHSL(_hsl.h, Math.min(0.72, _hsl.s), 0.6);          // 亮階(同色系)
  const lo = new THREE.Color().setHSL(_hsl.h, Math.min(0.85, _hsl.s * 1.15), 0.09);  // 暗階(同色系)
  let plane = 0;
  if (!shade) { _box.setFromObject(root); plane = _box.min[key] + frac * (_box.max[key] - _box.min[key]); }
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  root.traverse((o) => {
    const m = paintMat(o);
    if (!m) return;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);   // mesh 局部 → 機體根
    const pos = o.geometry.attributes.position;
    let na = o.geometry.attributes.normal;
    if (shade && !na) { o.geometry.computeVertexNormals(); na = o.geometry.attributes.normal; }
    if (shade) nm.getNormalMatrix(M);
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      let t;   // 0 → 亮(hi);1 → 暗(lo)
      if (shade) {
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
        const up = flip ? -v.y : v.y;                        // 面朝上量([-1,1])
        t = Math.min(1, Math.max(0, (up + 0.4) / 0.8));      // 朝上→暗、朝下→亮、側面→中間調
      } else {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        t = ((v.getComponent(ax) >= plane) !== flip) ? 0 : 1;
      }
      col[i * 3] = hi.r + (lo.r - hi.r) * t;
      col[i * 3 + 1] = hi.g + (lo.g - hi.g) * t;
      col[i * 3 + 2] = hi.b + (lo.b - hi.b) * t;
    }
    o.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.color.set(0xffffff);                                   // 白底 × 頂點色 = 純亮/暗色(cel 明暗照舊疊)
    m.vertexColors = true;
    m.needsUpdate = true;
  });
  return root;
}

// 日之丸貼花(紅日:白邊 + 紅心;白邊確保任何機色上都讀得出)。單張快取。
let _roundelTex = null;
function roundelTexture() {
  if (_roundelTex) return _roundelTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f5f7fa';
  ctx.beginPath(); ctx.arc(128, 128, 92, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8102e';
  ctx.beginPath(); ctx.arc(128, 128, 80, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;         // 圓外透明 → 露機身色、不重複
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return (_roundelTex = tex);
}

/**
 * 零式:機身純色 + 於標記機翼(userData.hinomaru)各蓋一枚紅日。
 * 每片翼各自置中投影(沿 Y 三平面 → 頂/底面都現)⇒ 雙翼正反面共四枚。face:null 不閘半球。
 */
function paintWingRoundel(root, inv) {
  const tex = roundelTexture();
  root.traverse((o) => {
    if (!o.userData?.hinomaru) return;
    const m = paintMat(o);
    if (!m) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const Ml = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    _mb.copy(o.geometry.boundingBox).applyMatrix4(Ml);
    _mb.getSize(_msz); _mb.getCenter(_mc);
    const ews = 0.9 * Math.min(_msz.x, _msz.z);              // 圓形不變形:x/z 同 scale,取窄邊(翼弦)當日徑基準
    const scale = 1 / ews;
    const pre = new THREE.Matrix4().makeTranslation(
      0.5 * ews - _mc.x, 0.5 * ews - _mc.y, 0.5 * ews - _mc.z);
    const M = new THREE.Matrix4().multiplyMatrices(pre, Ml);
    // flat = +Y:只在翼頂/翼底(與 Y 軸平行的面)顯現,側緣不溢色 → 正反面各一枚、機腹不沾紅。
    applyPaint(m, { tex, matrix: M, scale, flat: new THREE.Vector3(0, 1, 0) });
  });
  return root;
}

/**
 * 把角色花紋塗到已建好的機體上(fitToHeight / outlinify 之前呼叫)。
 * 三條路徑(以 vis.paint 決定):
 *   solid    —— 不上漆,露出角色裝甲色。
 *   natflag  —— 逐件實色重染(paintNationalLivery,80/20 體積分主色/配色)。
 *   split    —— 同色系空間兩色分(頂點色:人馬上下 / 狼人左右 / 獵鷹前後)。
 *   hinomaru —— 純色機身 + 標記機翼頂/底各一枚紅日(零式)。
 *   徽記      —— 只貼一片最平的外緣板(paintEmblemPlate),其餘純色。
 *   覆蓋型    —— 迷彩/雙色/櫻吹雪整機三平面平鋪。
 * @param root  builder 回傳的 Group(尚未進場景;matrixWorld = 自身局部座標)
 * @param tone  'light' | 'dark'(需與 builder 取色版時同一個值)
 */
export function paintUnit(root, vis, side, tone = 'light') {
  const want = vis?.paint;
  if (want === 'solid') return root;                        // 純單色:不掛任何貼花
  const pal = heroPalette(vis, side, tone);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  if (want === 'natflag') return paintNationalLivery(root, inv, vis?.flag, pal);
  if (want === 'split') return paintAxisSplit(root, inv, vis);
  if (want === 'hinomaru') return paintWingRoundel(root, inv);

  const pattern = PATTERNS[want] ? want : 'minimal';
  const P = PATTERNS[pattern];
  const hue = vis?.hue ?? SIDES[side]?.color ?? 0xffffff;
  const tex = paintTexture(pattern, pal, hue, tone, { flag: vis?.flag });
  _box.setFromObject(root);
  const h = _box.getSize(_size).y || 1;

  if (P.map === 'single') {                                 // 徽記:貼單一平板
    // 直立機甲(高度為最大軸)取 +Z 胸甲;橫置飛行器/獸型取 +Y 頂面/背脊。
    const axis = h < 0.9 * Math.max(_size.x, _size.z) ? 1 : 2;
    return paintEmblemPlate(root, inv, tex, axis);
  }

  const scale = P.tile / h;                                 // 覆蓋型:整機平鋪(重複頻率以身高為單位)
  root.traverse((o) => {
    const m = paintMat(o);
    if (!m) return;
    // 靜止姿勢下「這個 mesh 的局部座標 → 機體根座標」的固定矩陣:
    // 花紋因此烤死在裝甲板上(關節旋轉不改變它),而不是投影在世界空間。
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    applyPaint(m, { tex, matrix: M, scale, face: null });
  });
  return root;
}
