// ============ 在地文字招牌(建築招牌 / 廣告看板 / 道路路標 / 佈告欄 / 風景解說牌)============
//
// **純表現層**:招牌不登記碰撞柱、不進 blockers、不動任何權威幾何(全域原則 4)⇒
// `npm test` / `npm run bal` 天然不受影響。玩家看得到字,打不到也撞不到牌子。
//
// 分工(MUST NOT 混):
//   vernacular.js  寫什麼 —— 語料 / 分類 / 挑字 / 去重 / 容量篩(純字串,零 import)
//   本檔           畫什麼、擺哪裡 —— canvas 圖集 + InstancedMesh + 逐實例 UV + 落位
//
// 為什麼是**圖集**而不是一塊牌一張貼圖:招牌上的字每一塊都不同,而 InstancedMesh 只有
// 一張 map。沒有圖集就只剩兩條路 —— 一塊牌一個 mesh(整座城數百個 draw call),或者
// 整座城的招牌寫同一行字。逐實例 UV 的著色器補丁住 `toon.js`(`atlas` 選項,同 ramp 的
// 單一縫紀律),本檔只負責把 `aTexRect` 這個屬性餵進去。
//
// **長寬比是硬約束**(SKILL §三第一條):圖集儲存格的長寬比 = 牌面的長寬比。牌面尺寸
// MUST 由 `signAspect()` 推導(`h = w / ar`),MUST NOT 各自亂數 —— 比例不合不會報錯,
// 只會渲染成一條糊掉的污漬,看起來像美術選擇。
import * as THREE from 'three';
import { envMat } from './toon.js';
import { llToWorld } from './terrain.js';
import { signCopy } from './vernacular.js';

// CJK 字體堆疊:招牌大半是漢字/假名/諺文,拉丁字體先命中會退成方框
const FONT = `'Noto Sans TC','Microsoft JhengHei','PingFang TC','Hiragino Sans','Yu Gothic UI','Meiryo','Malgun Gothic','Segoe UI',sans-serif`;

/**
 * 五類版面規格。
 *   cw/ch  圖集儲存格像素(**cw/ch 就是牌面長寬比**,呼叫端一律經 `signAspect` 取用)
 *   max    圖集最多幾格(= 全世界這一類最多幾種不同的字;超過的實例輪用)
 *   pal    這一類的配色(每格依 index 取一組 ⇒ 同一條街不會整排同色)
 * 儲存格解析度刻意壓低:招牌是**遠看**的東西,而圖集是整張常駐 VRAM 的貼圖。
 */
const SPEC = {
  wallsign: { cw: 96, ch: 480, max: 24, pal: [[0xe8734a, '#fff6ee'], [0x2f6fb8, '#eef5ff'], [0xc4372f, '#fff0ea'], [0x3f8c5a, '#f0fbf2'], [0x8a5ec4, '#f6f0ff'], [0xd9a03c, '#fffaf0']] },
  billboard: { cw: 384, ch: 144, max: 20, pal: [[0xf2f0e8, '#c4372f'], [0xeef4fb, '#20509e'], [0xfdf3e0, '#a3531c'], [0xf1f8ef, '#2f6b40'], [0xf7eef4, '#8a3a62']] },
  roadsign: { cw: 384, ch: 120, max: 20, pal: [[0x2f6b40, '#ffffff'], [0x1e4f96, '#ffffff']] },
  notice: { cw: 256, ch: 192, max: 16, pal: [[0xf6f2e4, '#4a4438']] },
  scenic: { cw: 320, ch: 184, max: 16, pal: [[0xefe6cf, '#5a4630']] },
};

/**
 * 牌面長寬比(w/h)。**呼叫端 MUST 用它推導牌面尺寸**,見檔頭「長寬比是硬約束」。
 * 宣告成頂層 `function`(而非 `export function`)是為了讓離線稽核能用 `grabFn` 抽原文直測 ——
 * signage.js 走 CDN importmap 的 three,Node 端 import 不進來。
 */
function signAspect(cls) {
  const s = SPEC[cls];
  return s ? s.cw / s.ch : 1;
}

/**
 * 圖集版面(**純算術,不碰 canvas**):格數 → 幾行幾列、畫布多大、每格的 UV 矩形。
 * 抽成單一縫的理由是它是**唯一會靜默壞掉**的一段:
 *   ① UV 原點在左下、canvas 原點在左上 ⇒ v 要翻。翻錯不報錯,整批招牌上下顛倒。
 *   ② 畫布上限 2048 是行動裝置的實務底線;超過在部分裝置上直接回空白貼圖。
 */
function atlasLayout(cls, cells) {
  const s = SPEC[cls];
  const cols = Math.max(1, Math.min(cells, Math.floor(2048 / s.cw)));
  const rows = Math.ceil(cells / cols);
  const W = cols * s.cw, H = Math.min(2048, rows * s.ch);
  const rect = new Float32Array(cells * 4);
  for (let i = 0; i < cells; i++) {
    const cx = (i % cols) * s.cw, cy = Math.floor(i / cols) * s.ch;
    rect[i * 4] = cx / W;
    rect[i * 4 + 1] = 1 - (cy + s.ch) / H;
    rect[i * 4 + 2] = s.cw / W;
    rect[i * 4 + 3] = s.ch / H;
  }
  return { cols, rows, W, H, cw: s.cw, ch: s.ch, rect };
}

export { signAspect, atlasLayout };

/* ------------------------------- canvas 版面 ------------------------------- */

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** 縮到寫得下為止(與 sakura `fitText` 同法):回傳實際用的字級 */
function fitFont(c, text, maxW, size, weight = 'bold') {
  let s = size;
  do {
    c.font = `${weight} ${s}px ${FONT}`;
    if (c.measureText(text).width <= maxW) break;
    s -= 1;
  } while (s > 7);
  return s;
}

/** 置中橫排(spacing = 字距,漢字招牌拉開字距才像招牌) */
function centerText(c, text, x, y, maxW, size, color, weight = 'bold', spacing = 0) {
  fitFont(c, text, Math.max(8, maxW - spacing * Math.max(0, [...text].length - 1)), size, weight);
  c.fillStyle = color;
  c.textBaseline = 'middle';
  if (!spacing) { c.textAlign = 'center'; c.fillText(text, x, y); return; }
  c.textAlign = 'left';
  const chars = [...text];
  const total = chars.reduce((a, ch) => a + c.measureText(ch).width + spacing, -spacing);
  let cx = x - total / 2;
  for (const ch of chars) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + spacing; }
}

/** 直排(亞洲直式招牌):逐字往下,字級由「幾個字塞進這麼高」反推 */
function verticalText(c, text, x, y0, y1, maxW, color) {
  const chars = [...text];
  const step = (y1 - y0) / Math.max(1, chars.length);
  const size = Math.min(maxW, step * 0.86);
  c.font = `bold ${size}px ${FONT}`;
  c.fillStyle = color;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  chars.forEach((ch, i) => c.fillText(ch, x, y0 + step * (i + 0.5)));
}

const rule = (c, x, y, w, h, color) => { c.fillStyle = color; c.fillRect(x, y, w, h); };

/**
 * 逐語域的版面(SKILL §一.3:一塊牌讀起來是什麼機構,由**欄位結構**決定)。
 * 一個版面函式服務整類的全部語料(§一.5:one layout, N tenants)——
 * 新增一種招牌 = 加一列 SPEC + 加一個版面,MUST NOT 每塊牌一個繪製函式。
 */
const PAINT = {
  // 建築招牌:直式長條,主名直排 + 底端一格副行。街景裡最窄的一塊牌 ⇒ 只放得下名字
  wallsign(c, w, h, copy, pal) {
    const [bg, fg] = pal;
    c.fillStyle = hex(bg); c.fillRect(0, 0, w, h);
    rule(c, 0, 0, w, 6, '#00000022');
    c.fillStyle = fg; c.globalAlpha = 0.18; c.fillRect(5, 5, w - 10, h - 10); c.globalAlpha = 1;
    const foot = copy.s ? h * 0.16 : 0;
    verticalText(c, copy.t, w / 2, h * 0.06, h - foot - h * 0.05, w * 0.74, fg);
    if (copy.s) {
      rule(c, w * 0.2, h - foot - 4, w * 0.6, 2, fg);
      centerText(c, copy.s, w / 2, h - foot / 2, w * 0.84, foot * 0.42, fg, '600');
    }
  },
  // 廣告看板:遠看的東西 —— 左三分之二是名字,右邊一條放副行與拉丁副名
  billboard(c, w, h, copy, pal) {
    const [bg, fg] = pal;
    c.fillStyle = hex(bg); c.fillRect(0, 0, w, h);
    rule(c, 0, h - 9, w, 9, fg);
    rule(c, 0, 0, w, 5, fg);
    const split = copy.s || copy.en ? 0.66 : 1;
    centerText(c, copy.t, w * split * 0.5, h * 0.5, w * split - 24, h * 0.5, fg, 'bold', h * 0.05);
    if (split < 1) {
      rule(c, w * split, h * 0.18, 2, h * 0.62, fg);
      c.globalAlpha = 0.8;
      if (copy.s) centerText(c, copy.s, w * (split + 1) / 2, h * (copy.en ? 0.38 : 0.5), w * (1 - split) - 16, h * 0.2, fg, '600');
      if (copy.en) centerText(c, copy.en, w * (split + 1) / 2, h * (copy.s ? 0.66 : 0.5), w * (1 - split) - 16, h * 0.15, fg, '500');
      c.globalAlpha = 1;
    }
  },
  // 道路路標:綠/藍底白字 + 白框 + 一個方向箭頭。路牌的語域是「往哪裡、還有多遠」
  roadsign(c, w, h, copy, pal) {
    const [bg, fg] = pal;
    c.fillStyle = hex(bg); c.fillRect(0, 0, w, h);
    c.strokeStyle = fg; c.lineWidth = 5; c.strokeRect(9, 9, w - 18, h - 18);
    const ax = w - h * 0.5;                                   // 箭頭佔右端一個正方
    centerText(c, copy.t, (w - h * 0.75) / 2 + 8, h * (copy.s ? 0.42 : 0.5), w - h - 26, h * 0.42, fg, 'bold', 3);
    if (copy.s) centerText(c, copy.s, (w - h * 0.75) / 2 + 8, h * 0.74, w - h - 30, h * 0.2, fg, '500');
    c.fillStyle = fg;                                          // 箭頭:桿 + 三角
    c.fillRect(ax - h * 0.24, h * 0.47, h * 0.26, h * 0.06);
    c.beginPath();
    c.moveTo(ax + h * 0.18, h * 0.5); c.lineTo(ax - h * 0.02, h * 0.32); c.lineTo(ax - h * 0.02, h * 0.68);
    c.closePath(); c.fill();
  },
  // 佈告欄:紙面 —— 抬頭條 + 一則公告 + 幾條「已經貼在上面的別的紙」
  notice(c, w, h, copy, pal) {
    const [bg, fg] = pal;
    c.fillStyle = hex(bg); c.fillRect(0, 0, w, h);
    rule(c, 0, 0, w, h * 0.2, fg);
    centerText(c, copy.t, w / 2, h * 0.1, w - 20, h * 0.13, hex(bg), 'bold', 2);
    if (copy.s) centerText(c, copy.s, w / 2, h * 0.34, w - 24, h * 0.11, fg, '600');
    c.globalAlpha = 0.5;                                       // 公告欄上永遠有別人先貼的紙
    for (let i = 0; i < 3; i++) {
      const y = h * (0.5 + i * 0.14);
      rule(c, w * 0.1, y, w * (0.5 + (i % 2) * 0.28), 3, fg);
      rule(c, w * 0.1, y + 7, w * (0.34 + (i % 3) * 0.16), 3, fg);
    }
    c.globalAlpha = 1;
    rule(c, w * 0.1, h * 0.44, w * 0.8, 2, fg);
  },
  // 風景解說牌:標題 + 分隔線 + 標高/來歷 + 一條抽象稜線(解說牌上一定有一張圖)
  scenic(c, w, h, copy, pal) {
    const [bg, fg] = pal;
    c.fillStyle = hex(bg); c.fillRect(0, 0, w, h);
    c.strokeStyle = fg; c.lineWidth = 3; c.strokeRect(8, 8, w - 16, h - 16);
    centerText(c, copy.t, w / 2, h * 0.22, w - 40, h * 0.24, fg, 'bold', 4);
    rule(c, w * 0.18, h * 0.38, w * 0.64, 2, fg);
    if (copy.s) centerText(c, copy.s, w / 2, h * 0.5, w - 44, h * 0.13, fg, '600');
    c.globalAlpha = 0.55;                                      // 抽象稜線剖面
    c.beginPath();
    c.moveTo(w * 0.14, h * 0.84);
    c.lineTo(w * 0.34, h * 0.66); c.lineTo(w * 0.46, h * 0.74);
    c.lineTo(w * 0.62, h * 0.6); c.lineTo(w * 0.86, h * 0.84);
    c.strokeStyle = fg; c.lineWidth = 3; c.stroke();
    c.globalAlpha = 1;
  },
};

/* -------------------------------- 圖集組裝 -------------------------------- */

/**
 * 一批招牌的圖集。
 * @param cls  `SPEC` 的鍵
 * @param n    這一類有幾個實例(格數 = min(n, SPEC.max);**超過就輪用**,不是靜默截斷:
 *             全世界最多 `max` 種不同的字,回傳值帶 `cells` 供稽核/報表核對)
 * @returns { tex, rect: Float32Array(cells*4), cells, copies } —— 一則文案都挑不到回 null
 *          (零字場地 ⇒ 呼叫端退回原本的純色牌,全域原則 6)
 */
export function signAtlas(cls, n, { corpus, rnd, used }) {
  const s = SPEC[cls];
  if (!s || n <= 0) return null;
  const want = Math.min(n, s.max);
  const copies = [];
  for (let i = 0; i < want; i++) {
    const cp = signCopy(cls, corpus, rnd, used);
    if (cp) copies.push(cp);
  }
  if (!copies.length) return null;
  const cells = copies.length;
  const lay = atlasLayout(cls, cells);   // 版面/UV 只有這一份實作(見 atlasLayout)
  const cv = document.createElement('canvas');
  cv.width = lay.W;
  cv.height = lay.H;
  const c = cv.getContext('2d');
  const rect = lay.rect;
  copies.forEach((cp, i) => {
    const cx = (i % lay.cols) * s.cw, cy = Math.floor(i / lay.cols) * s.ch;
    c.save();
    c.translate(cx, cy);
    c.beginPath(); c.rect(0, 0, s.cw, s.ch); c.clip();
    PAINT[cls](c, s.cw, s.ch, cp, s.pal[i % s.pal.length]);
    c.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // 圖集**絕不可** RepeatWrapping:UV 被重映到某一格之後,取樣溢出邊界會抓到隔壁那塊牌的字
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, rect, cells, copies };
}

/**
 * 招牌材質:白底相乘(圖集自帶配色 ⇒ 呼叫端的 instance tint MUST 設白,
 * 否則等於在已經上好色的招牌上再乘一次色)。夜間走 emissive 背光,同既有看板。
 */
export function signMaterial(atlas, night, glow = 0.45) {
  return envMat(0xffffff, {
    map: atlas.tex, atlas: true, wash: 0.15, cool: 0.25, rim: 0.1,
    emissive: new THREE.Color(night ? 0xfff2cc : 0x000000), emissiveIntensity: night ? glow : 0,
  });
}

/**
 * 把圖集格號綁到實例上(逐實例 UV)。實例 i 用第 `i % cells` 格 —— 實例數超過格數就輪用。
 * @param geo 這個 InstancedMesh **自己的** geometry。MUST NOT 是跨場共用的那一份:
 *            `aTexRect` 掛在 geometry 上,共用一份 = 上一場的招牌 UV 蓋掉這一場的。
 */
export function applySignAtlas(geo, count, atlas) {
  const arr = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const k = (i % atlas.cells) * 4;
    arr[i * 4] = atlas.rect[k];
    arr[i * 4 + 1] = atlas.rect[k + 1];
    arr[i * 4 + 2] = atlas.rect[k + 2];
    arr[i * 4 + 3] = atlas.rect[k + 3];
  }
  geo.setAttribute('aTexRect', new THREE.InstancedBufferAttribute(arr, 4));
  return geo;
}

/* -------------------------------- 立牌道具 -------------------------------- */

const POST_C = 0x8f959c;
const WOOD_C = 0x7a5c3e;

/** 牌面幾何:BoxGeometry 的群組序 +x,-x,+y,-y,+z,-z ⇒ 材質陣列第 4/5 格 = 前後兩面帶字。
 *  雙面牌**不做鏡像**:BoxGeometry 在每個軸的負向面已經自己反轉 udir,再翻一次才會出現
 *  鏡像字(sakura 曾對全世界每一塊雙面牌做過這個「修正」)。 */
function plateGeo(w, h, t, tilt = 0) {
  const g = new THREE.BoxGeometry(w, h, t);
  if (tilt) g.rotateX(tilt);
  return g;
}

/**
 * 三種立牌道具(道路路標 / 佈告欄 / 風景解說牌)。
 * 落位一律**在路肩、不在通道上**(SKILL §三:走道正中央的立牌是畫面上的一個洞),
 * 且一律避開兵線淨空走廊(`isBlocked`)—— 招牌是表現層,絕不擋路。
 *
 * @returns { count, atlases } 圖集陣列供呼叫端納入資源生命週期
 */
export function buildSignage(group, ctx) {
  const { terrain, roads, buildings, features, center, isBlocked, corpus, rnd, night, used } = ctx;
  const atlases = [];
  let count = 0;
  const inB = (x, z) => x > terrain.minX + 12 && x < terrain.maxX - 12 && z > terrain.minZ + 12 && z < terrain.maxZ - 12;
  const free = (x, z) => inB(x, z) && !isBlocked(x, z);

  // ---- ① 道路路標:主要道路每 ~130m 一支,擺在路肩外 ----
  const roadSites = [];
  for (const way of roads || []) {
    const tg = way.tags || {};
    // 橋上/洞內不立牌:柱腳會浮在橋面下或穿進山體(牌子是貼地道具,沒有結構落腳邏輯)
    if (tg.bridge || tg.tunnel || !MAIN_HW.test(tg.highway || '')) continue;
    const pts = (way.geometry || []).map((p) => llToWorld(p.lat, p.lon, center));
    let acc = 1e9;
    for (let i = 1; i < pts.length; i++) {
      const [x1, z1] = pts[i - 1], [x2, z2] = pts[i];
      const seg = Math.hypot(x2 - x1, z2 - z1);
      acc += seg;
      if (acc < 130 || seg < 1) continue;
      acc = 0;
      const ux = (x2 - x1) / seg, uz = (z2 - z1) / seg;
      // 路肩:法向退開一個車道半寬 + 3m。兩側都試,先取空的那一側
      for (const sgn of [1, -1]) {
        const x = x2 - ux * seg * 0.5 + -uz * sgn * 9, z = z2 - uz * seg * 0.5 + ux * sgn * 9;
        if (!free(x, z)) continue;
        // 牌面法線朝路(讀牌的人站在路上),故 ry 由路的方向轉 90°
        roadSites.push({ x, z, ry: Math.atan2(ux, uz) + (sgn > 0 ? 0 : Math.PI) });
        break;
      }
      if (roadSites.length >= 26) break;
    }
    if (roadSites.length >= 26) break;
  }
  count += emit(group, 'roadsign', roadSites, atlases, { terrain, corpus, rnd, used, night },
    { w: 3.6, y: 2.6, post: 2, postR: 0.075, postC: POST_C });

  // ---- ② 佈告欄:住宅棟的臨路側牆邊 ----
  const noticeSites = [];
  for (const b of buildings || []) {
    if (b.commercial || noticeSites.length >= 18) continue;
    if (rnd() > 0.12) continue;                       // 每棟固定擲一枚(確定性:淘汰排在抽樣之後)
    const half = Math.hypot(b.w, b.d) / 2 * 0.8;
    // 「外側」是這一類道具最貴的錯誤(整組道具埋進牆裡)⇒ 朝**最近的路**擺,不猜
    const near = nearestRoadDir(roadSites, b.x, b.z);
    const x = b.x + near.dx * (half + 1.4), z = b.z + near.dz * (half + 1.4);
    if (!free(x, z)) continue;
    noticeSites.push({ x, z, ry: Math.atan2(near.dx, near.dz) });
  }
  count += emit(group, 'notice', noticeSites, atlases, { terrain, corpus, rnd, used, night },
    { w: 1.9, y: 2.1, post: 2, postR: 0.07, postC: WOOD_C, glow: 0.15 });

  // ---- ③ 風景解說牌:地標 / 瀑布 / 全圖最高點 ----
  const scenicSites = [];
  for (const f of features || []) {
    if (scenicSites.length >= 14) continue;
    const a = rnd() * Math.PI * 2;                    // 每個特徵固定一枚:繞著它挑一個方位
    const r = (f.r || 10) + 7;
    const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
    if (!free(x, z)) continue;
    // 牌面**背對**特徵:走上來讀牌,抬頭那座山就在牌子後面(這才是解說牌的用法)
    scenicSites.push({ x, z, ry: Math.atan2(x - f.x, z - f.z) });
  }
  count += emit(group, 'scenic', scenicSites, atlases, { terrain, corpus, rnd, used, night },
    { w: 2.2, y: 1.35, post: 2, postR: 0.06, postC: POST_C, tilt: -0.42, glow: 0.12 });

  return { count, atlases };
}
const MAIN_HW = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$/;

/** 離建物最近的路標方向(沒有路標就朝 +x —— 有一個確定的答案好過猜) */
function nearestRoadDir(sites, x, z) {
  let best = null, bd = Infinity;
  for (const s of sites) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || bd < 1) return { dx: 1, dz: 0 };
  const d = Math.sqrt(bd);
  return { dx: (best.x - x) / d, dz: (best.z - z) / d };
}

/**
 * 立牌成形:牌面(圖集材質)+ 柱子,各一個 InstancedMesh。
 * 牌面高度 MUST 由 `signAspect` 推導 —— 見檔頭「長寬比是硬約束」。
 */
function emit(group, cls, sites, atlases, { terrain, corpus, rnd, used, night }, geo) {
  if (!sites.length) return 0;
  const atlas = signAtlas(cls, sites.length, { corpus, rnd, used });
  if (!atlas) return 0;                                // 零字場地:整批不出場(寧缺勿錯)
  atlases.push(atlas.tex);
  const h = geo.w / signAspect(cls);
  const plate = plateGeo(geo.w, h, 0.14, geo.tilt || 0);
  applySignAtlas(plate, sites.length, atlas);
  const side = envMat(0xd8d4cc, { wash: 0.2, cool: 0.3 });
  const face = signMaterial(atlas, night, geo.glow ?? 0.45);
  const pm = new THREE.InstancedMesh(plate, [side, side, side, side, face, face], sites.length);
  const postGeo = new THREE.CylinderGeometry(geo.postR, geo.postR * 1.25, geo.y + h / 2, 6)
    .translate(0, (geo.y + h / 2) / 2, 0);
  const postM = new THREE.InstancedMesh(postGeo, envMat(geo.postC, { wash: 0.25, cool: 0.35 }), sites.length * geo.post);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
  const white = new THREE.Color(0xffffff);
  sites.forEach((st, i) => {
    const gy = terrain.heightAt(st.x, st.z);
    E.set(0, st.ry, 0); Q.setFromEuler(E);
    P.set(st.x, gy + geo.y + h / 2, st.z);
    M.compose(P, Q, S);
    pm.setMatrixAt(i, M);
    pm.setColorAt(i, white);                           // 圖集自帶配色 ⇒ tint MUST 是白
    for (let k = 0; k < geo.post; k++) {
      const off = (k - (geo.post - 1) / 2) * geo.w * 0.62;
      P.set(st.x + Math.cos(st.ry) * off, gy, st.z - Math.sin(st.ry) * off);
      M.compose(P, Q, S);
      postM.setMatrixAt(i * geo.post + k, M);
    }
  });
  pm.instanceMatrix.needsUpdate = true;
  if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
  postM.instanceMatrix.needsUpdate = true;
  pm.frustumCulled = postM.frustumCulled = false;
  pm.castShadow = postM.castShadow = false;
  group.add(pm, postM);
  return sites.length;
}
