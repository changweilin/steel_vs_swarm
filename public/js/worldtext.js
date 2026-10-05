// ============ 世界文字(把圖資上的名字放回世界;**唯一**的文字圖層)============
// 這個世界原本**一個字都沒有** —— `vfx.js` 的傷害數字與除錯標籤之外,唯一像字的東西是
// `ground.js` 的廣告看板,而它畫的是假的標語筆畫。但真實地點的名字其實早就在記憶體裡:
// Overpass 的 `out geom` / `out center tags` 預設就帶 tags,而 `biomes.js` 一路都把整包
// `tags` 留著。所以這不是「加招牌」,是「把世界本來就有的名字放回去」。
//
// ---- 分工(2026-08-03 併入「在地日常文字」之後)----
//   `vernacular.js`  **寫什麼** —— 八類語料、取名規則(`pickName`)、日常副行、一鎮一家
//                    去重、容量篩。純字串、零 import ⇒ 離線烘焙與稽核吃得到真品。
//   本檔             **怎麼畫、畫在哪一格** —— 圖集、版面、缺字、幾何。
//   `biomes.js`      **掛在哪裡** —— 位置與朝向一律取自各構件已經定案的幾何。
// 三者各一份,MUST NOT 有第二套。舊 `signage.js`(第二份圖集 + 第二套逐實例 UV 規則)
// 已整支併入本檔 —— 一個世界兩套文字圖層就是「第二份實作即是 bug」(原則 2)。
//
// ---- 為什麼所有文字擠在**一張** atlas、**一個** mesh ----
// 每塊招牌各自一張 canvas = 各自一個材質 = 各自一個 draw call,而本渲染器是 draw call 瓶頸
// (`postfx.js` 檔頭那條「用外殼包住整個世界不可行」是同一個理由)。故全場的字烤進同一張
// atlas、合併成同一個 mesh ⇒ **不論掛幾塊牌子都只有一個 draw call**。
// 額度是特性不是限制:寧可只有最該有名字的那幾座洞口掛牌,也不要整片街廓浮著一堆看不清
// 的字(原則 6 寧缺勿錯)。
//
// ---- 五個會出事的地方(全部寫進實作,不是註解而已)----
//   ① **缺字**:A2 不准加字型檔 ⇒ 只能靠系統字型堆疊。CJK / 西里爾 / 阿拉伯文在缺字裝置上
//      會變成一排豆腐框,那比沒有招牌更糟。`canRenderText()` 以「私用區字元的量測寬度」當
//      基準偵測缺字,缺太多就**不掛牌**;三層文字**整塊一起驗**(副行也會變豆腐框)。
//   ② **鏡像**:雙面板的背面會變鏡像字(程序貼圖的經典坑)。故一律發**兩片背對背的單面
//      四邊形**共用同一格 UV,而不是一片 DoubleSide。
//   ③ **壓扁**:牌面的世界長寬比 MUST 與 atlas 格子一致。故牌寬一律由 `signAspect(style)`
//      **推導**(`w = h × ar`),字長不同就自動縮字級 —— 而不是把牌子拉長。
//   ④ **不透明**:牌面是實心板不是貼花。透明件會在勾線 pass 的深度緩衝上留下斑點
//      (計畫書 P0-C 那條「寫深度的透明件會變成 speckle」),而且賽璐璐的線正好該描出牌框。
//   ⑤ **混合長寬比的排版**:直式招牌是 1:5、路標是 16:5,固定格網塞不下 ⇒ 走**貨架式**
//      裝箱(`packCells`,純算術)。裝不下的**明講**(`signDropped`),MUST NOT 靜默截斷 ——
//      靜默截斷會讓「為什麼那塊牌沒出現」永遠查不出來。
//
// 純表現層(原則 4):牌子貼在既有幾何表面上,MUST NOT 新增碰撞柱、MUST NOT 動通行寬。
// 亂數紀律(§2.3):要掛哪些由圖資推導、零共享 `rnd()` 消耗;語料庫挑字走**專屬 seed**。
import * as THREE from 'three';
import { envMat } from './toon.js';
import { visualPref } from './visualPrefs.js';
import { pickName, pickRef } from './vernacular.js';
import { MIP_ANISO, registerStreamTex, registerVirtualPages } from './tex.js';

// ---- atlas ----
const ATLAS_MAX = 2048;            // 單張畫布上限(行動裝置的實務底線)
const FILL = 0.8;                  // 貨架裝箱的有效填充率(保守估;`full` 據此估額度)
export const SIGN_MAX = 96;        // 格數硬上限(額度另受面積限制,兩者取先到者)
const MAX_CHARS = 14;              // 超過就不是招牌是公告欄;OSM 偶有超長 name

/**
 * 牌面樣式 = **語域**(skill `local-vernacular-signage` §一.3:一塊牌讀起來是什麼機構,
 * 由**欄位結構**決定,不是由字體決定)。
 *   cw/ch  圖集儲存格像素 —— **cw/ch 就是牌面長寬比**,呼叫端一律經 `signAspect()` 取用
 *   paint  版面(一個版面服務整類的全部語料:one layout, N tenants)
 * 前四種是**構件自己的名字**(取自該構件的 tags);後五種是**語料庫挑字**(帶日常副行)。
 */
export const SIGN_STYLES = {
  // — 構件名牌:單行,字就是那座洞 / 那座橋 / 那個地名 —
  stone: { cw: 512, ch: 128, bg: '#cfc8b8', fg: '#2b2a26', edge: '#8d8577', weight: '600', paint: 'plain' },
  enamel: { cw: 512, ch: 128, bg: '#1d4b2a', fg: '#f2f0e6', edge: '#e8e4d6', weight: '700', paint: 'plain' },
  guide: { cw: 512, ch: 128, bg: '#123a6b', fg: '#f4f6fa', edge: '#dfe6f0', weight: '700', paint: 'plain' },
  lightbox: { cw: 512, ch: 128, bg: '#e8e4d8', fg: '#1f2733', edge: '#9aa2ad', weight: '700', paint: 'plain' },
  // — 語料庫招牌:三層文字(主名 / 日常副行 / 拉丁副名)—
  wallsign: { cw: 96, ch: 480, bg: '#e8734a', fg: '#fff6ee', edge: '#e8734a', weight: '700', paint: 'vertical' },
  billboard: { cw: 384, ch: 144, bg: '#f2f0e8', fg: '#c4372f', edge: '#c4372f', weight: '700', paint: 'fascia' },
  roadsign: { cw: 384, ch: 120, bg: '#2f6b40', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'road' },
  notice: { cw: 256, ch: 192, bg: '#f6f2e4', fg: '#4a4438', edge: '#4a4438', weight: '700', paint: 'notice' },
  scenic: { cw: 320, ch: 184, bg: '#efe6cf', fg: '#5a4630', edge: '#5a4630', weight: '700', paint: 'scenic' },
  street: { cw: 512, ch: 128, bg: '#245f49', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'direction' },
  destination: { cw: 512, ch: 160, bg: '#245c86', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'direction' },
  tourist: { cw: 512, ch: 160, bg: '#754b2e', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'direction' },
  civic: { cw: 512, ch: 160, bg: '#235a87', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'direction' },
  lane: { cw: 512, ch: 128, bg: '#332344', fg: '#fff8e6', edge: '#ffbd50', weight: '700', paint: 'direction' },
  speed: { cw: 192, ch: 192, bg: '#fffdf4', fg: '#202327', edge: '#ce302c', weight: '700', paint: 'traffic', shape: 'circle' },
  stop: { cw: 192, ch: 192, bg: '#c52e29', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'traffic', shape: 'octagon' },
  yield: { cw: 192, ch: 192, bg: '#fffdf4', fg: '#202327', edge: '#ce302c', weight: '700', paint: 'traffic', shape: 'yield' },
  warning: { cw: 192, ch: 192, bg: '#fffdf4', fg: '#202327', edge: '#ce302c', weight: '700', paint: 'traffic', shape: 'triangle' },
  mandatory: { cw: 192, ch: 192, bg: '#236bb6', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'traffic', shape: 'circle' },
  oneway: { cw: 192, ch: 192, bg: '#236bb6', fg: '#ffffff', edge: '#ffffff', weight: '700', paint: 'traffic' },
  prohibition: { cw: 192, ch: 192, bg: '#fffdf4', fg: '#202327', edge: '#ce302c', weight: '700', paint: 'traffic', shape: 'circle' },
};

export function signShape(shape) {
  if (shape === 'triangle') return [[-1, -1], [1, -1], [0, 1]];
  if (shape === 'yield') return [[-1, 1], [0, -1], [1, 1]];
  const n = shape === 'octagon' ? 8 : 32, angle = shape === 'octagon' ? Math.PI / 8 : 0;
  return Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2 + angle), Math.sin(i / n * Math.PI * 2 + angle)]);
}

/**
 * 同一種語域的配色輪替(同一條街不會整排同色)。
 * **只換配色不換版面** —— 版面換了就是第二個語域(skill §一.5)。
 */
const PALETTE = {
  wallsign: [['#e8734a', '#fff6ee'], ['#2f6fb8', '#eef5ff'], ['#c4372f', '#fff0ea'],
    ['#3f8c5a', '#f0fbf2'], ['#8a5ec4', '#f6f0ff'], ['#d9a03c', '#fffaf0']],
  billboard: [['#f2f0e8', '#c4372f'], ['#eef4fb', '#20509e'], ['#fdf3e0', '#a3531c'],
    ['#f1f8ef', '#2f6b40'], ['#f7eef4', '#8a3a62']],
  roadsign: [['#2f6b40', '#ffffff'], ['#1e4f96', '#ffffff']],
};

/**
 * 牌面長寬比(w/h)。**呼叫端 MUST 用它推導牌面尺寸**,見檔頭 ③。
 * 與 `packCells` 一樣宣告成頂層 `function`(而非 `export function`)—— 兩支都是純算術,
 * 離線稽核用 `audit_src grabFn` 抽原文就能直測(worldtext 走 three,Node 端 import 不進來)。
 */
function signAspect(style) {
  const s = SIGN_STYLES[style] || SIGN_STYLES.stone;
  return s.cw / s.ch;
}

// 字型堆疊:一律系統字型(A2 不准加字型檔)。CJK 在中文系統上命中 Noto/微軟正黑/蘋方,
// 命不中就由 ① 的缺字偵測擋下來。
const FONT_STACK = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Hiragino Sans", "Noto Sans", sans-serif';
// 缺字偵測基準:私用區字元幾乎不會在任何字型裡,它的量測寬度就是「這個字型畫不出來」的寬度。
const PUA = '';

/**
 * 圖資 tags → 要顯示的名字。
 * **規則本身住 `vernacular.js pickName`**(該檔零 import ⇒ 離線烘焙與稽核吃得到真品);
 * 本支只負責補上「設定頁選的語言」這個預設值 —— 語言是**口味不是推導**:27 個場地跨國,
 * `name` 是當地語言(真實感的來源),但看不懂也是事實。
 * @returns 清理後的字串,或 null(沒有名字 / 太長)——
 *          **null 一律代表「不要掛牌」,MUST NOT 拿假名填充**(原則 6)。
 */
export function resolveName(tags, lang = visualPref('worldTextLang')) {
  return pickName(tags, lang, MAX_CHARS);
}

/** 道路編號(`ref`)—— 交流道/公路盾牌用;與 name 分開,兩者常常都要 */
export function resolveRef(tags) {
  return pickRef(tags);
}

let _probe = null;
function probeCtx() {
  if (_probe) return _probe;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 72;
  const ctx = cv.getContext('2d');
  ctx.font = `48px ${FONT_STACK}`;
  _probe = ctx;
  return _probe;
}

/**
 * 這串字這台裝置畫不畫得出來(缺字偵測;見檔頭 ①)。
 * 判準:字元的量測寬度等於私用區字元的寬度 = 字型沒有這個字 = 畫出來是豆腐框。
 * 超過兩成缺字就整串放棄 —— 半排豆腐框比沒有招牌難看得多。
 */
export function canRenderText(text) {
  if (!text) return false;
  let ctx;
  try { ctx = probeCtx(); } catch { return false; }   // 無 canvas 環境(離線稽核)一律不掛牌
  const tofu = ctx.measureText(PUA).width;
  let miss = 0, n = 0;
  for (const ch of text) {
    if (ch === ' ') continue;
    n++;
    if (ctx.measureText(ch).width === tofu && missingGlyph(ctx, ch)) miss++;
  }
  return n > 0 && miss / n <= 0.2;
}

const glyphCache = new Map();
let tofuMask = null;
function missingGlyph(ctx, ch) {
  if (glyphCache.has(ch)) return glyphCache.get(ch);
  const mask = glyph => {
    ctx.clearRect(0, 0, 72, 72); ctx.fillStyle = '#000';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(glyph, 4, 54);
    const pixels = ctx.getImageData(0, 0, 72, 72).data;
    return Uint8Array.from({ length: 72 * 72 }, (_, i) => pixels[i * 4 + 3]);
  };
  // CJK glyphs and a missing-glyph square often have the same advance; width alone rejects real names.
  tofuMask ||= mask(PUA);
  const pixels = mask(ch), missing = pixels.every((value, i) => value === tofuMask[i]);
  if (glyphCache.size >= 1024) glyphCache.clear();
  glyphCache.set(ch, missing);
  return missing;
}

/**
 * 貨架式裝箱(檔頭 ⑤):混合長寬比的格子塞進**一張**畫布。
 * **純算術、不碰 canvas** ⇒ 離線稽核抽原文就能直測(越界/重疊/裝不下全在這裡定案)。
 * 高的先排 —— 貨架高度由該層第一個決定,先高後矮浪費最小。
 * @returns { W, H, rects: [{ i, x, y, w, h }], dropped }
 */
function packCells(cells, maxW = ATLAS_MAX, maxH = ATLAS_MAX) {
  const order = cells.map((c, i) => ({ i, w: c.cw, h: c.ch }))
    .sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
  const rects = [];
  let shelfY = 0, shelfH = 0, x = 0, W = 0, dropped = 0;
  for (const c of order) {
    if (c.w > maxW || c.h > maxH) { dropped++; continue; }          // 單格就超出畫布
    if (x + c.w > maxW) {
      if (shelfY + shelfH + c.h > maxH) { dropped++; continue; }
      shelfY += shelfH; x = 0; shelfH = 0;
    }
    if (!shelfH) shelfH = c.h;                                      // 貨架高 = 該層第一個(已排序 ⇒ 最高)
    if (shelfY + c.h > maxH) { dropped++; continue; }               // 畫布滿了
    rects.push({ i: c.i, x, y: shelfY, w: c.w, h: c.h });
    x += c.w;
    W = Math.max(W, x);
  }
  rects.sort((a, b) => a.i - b.i);                                  // 還原成呼叫端的順序
  return { W: Math.max(1, W), H: Math.max(1, shelfY + shelfH), rects, dropped };
}

/**
 * 世界文字圖層:收集牌面 → 烤一張 atlas → 產出**一個** mesh。
 * 用法:`const sheet = new SignSheet(); sheet.add({...}); const mesh = sheet.build();`
 */
export class SignSheet {
  constructor(lowPower = false, reserved = 0) {
    this.reserved = reserved;
    this.scale = lowPower ? 0.5 : 1;      // 低功耗:atlas 解析度砍半(格數不變,字略糊)
    this.items = [];
    this.area = 0;                        // 已佔像素面積(額度以面積估,見 `full`)
  }

  /**
   * 還有沒有額度(呼叫端據此決定要不要繼續算位置)。
   * 混合長寬比之後「格數」不再等於「裝得下」⇒ 額度以**面積**估,再加一道格數硬上限。
   */
  get full() {
    return this.items.length >= SIGN_MAX - this.reserved
      || this.area >= ATLAS_MAX * ATLAS_MAX * FILL * this.scale * this.scale
        - this.reserved * SIGN_STYLES.lane.cw * SIGN_STYLES.lane.ch * this.scale * this.scale;
  }

  /**
   * 掛一塊牌。**位置與朝向由呼叫端從真幾何給**(洞口門樑、橋頭端柱、建物立面…),
   * 本支不猜任何位置 —— 猜的話就是第二份幾何(§2.1)。
   * @param text  單行牌面的字(已過 `resolveName`);與 `copy` 二擇一
   * @param copy  語料庫文案 `{ t, s, en }`(三層文字);與 `text` 二擇一
   * @param x,y,z 牌面**中心**世界座標
   * @param ry    牌面法線的水平朝向(牌正面朝 +ry 方向)
   * @param h     牌面高(公尺);寬恆為 `h × signAspect(style)`(見檔頭 ③)
   * @param style SIGN_STYLES 的鍵
   * @param both  是否兩面都看得到(獨立標牌 = true;貼牆的匾額/招牌 = false)
   * @returns 有沒有掛上去(額度滿 / 缺字 / 無名 一律 false)
   */
  add({ text, copy, x, y, z, ry, h = 1.6, style = 'stone', both = false }) {
    const cp = copy || (text ? { t: text } : null);
    const all = cp ? [cp.t, cp.s, cp.en].filter(Boolean).join(' ') : '';
    // 三道閘與舊制同語意:額度滿 / 無字 / 缺字。缺字驗**整塊牌**(副行也會變豆腐框)
    if (this.full || !cp?.t || !canRenderText(all)) return false;
    const st = SIGN_STYLES[style] || SIGN_STYLES.stone;
    this.items.push({ copy: cp, x, y, z, ry, h, style, both });
    this.area += Math.round(st.cw * this.scale) * Math.round(st.ch * this.scale);
    return true;
  }

  /**
   * 烤 atlas + 合併幾何。沒有任何牌子就回 null(MUST NOT 產生空 mesh —— 空的
   * BufferGeometry 一樣吃一次 draw call 與一份 GPU 緩衝)。
   */
  build() {
    if (!this.items.length) return null;
    const cells = this.items.map((it) => {
      const st = SIGN_STYLES[it.style] || SIGN_STYLES.stone;
      return { cw: Math.round(st.cw * this.scale), ch: Math.round(st.ch * this.scale) };
    });
    const lay = packCells(cells);
    const byItem = new Map(lay.rects.map((r) => [r.i, r]));
    const cv = document.createElement('canvas');
    cv.width = lay.W;
    cv.height = lay.H;
    const ctx = cv.getContext('2d');
    const pos = [], nrm = [], uv = [], idx = [], pages = [], glow = [];
    let drawn = 0;

    this.items.forEach((it, i) => {
      const r = byItem.get(i);
      if (!r) return;                       // 裝不下(數量記在 signDropped,不靜默)
      drawn++;
      this._paintCell(ctx, it, r, i);
      // UV 內縮半個像素:atlas 相鄰格在 LinearFilter 下會互相滲色(牌框邊出現隔壁格的字)
      const u0 = (r.x + 0.5) / cv.width, u1 = (r.x + r.w - 0.5) / cv.width;
      const v1 = 1 - (r.y + 0.5) / cv.height, v0 = 1 - (r.y + r.h - 0.5) / cv.height;
      const w = it.h * signAspect(it.style);
      pages.push({
        px: r.x, py: r.y, pw: r.w, ph: r.h,
        x: it.x, y: it.y, z: it.z,
        r: Math.max(2, Math.hypot(w, it.h) * 0.5),
      });
      const cos = Math.cos(it.ry), sin = Math.sin(it.ry);
      // 牌面在水平面上的「右」向量(法線 = (sin, 0, cos) 的水平垂直)
      const rx = cos, rz = -sin;
      const emit = (flip) => {
        const b = pos.length / 3;
        const s = flip ? -1 : 1;
        const shape = SIGN_STYLES[it.style]?.shape;
        if (shape) {
          pos.push(it.x, it.y, it.z); nrm.push(sin * s, 0, cos * s);
          uv.push((u0 + u1) / 2, (v0 + v1) / 2);
          const outline = signShape(shape);
          for (const [du, dv] of outline) {
            pos.push(it.x + rx * w / 2 * du * s, it.y + it.h / 2 * dv, it.z + rz * w / 2 * du * s);
            nrm.push(sin * s, 0, cos * s);
            uv.push(u0 + (du + 1) / 2 * (u1 - u0), v0 + (dv + 1) / 2 * (v1 - v0));
          }
          for (let k = 0; k < outline.length; k++) idx.push(b, b + 1 + k, b + 1 + (k + 1) % outline.length);
          return;
        }
        for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          pos.push(it.x + rx * (w / 2) * du * s, it.y + (it.h / 2) * dv, it.z + rz * (w / 2) * du * s);
          nrm.push(sin * s, 0, cos * s);
          // 背面共用同一格 UV,但幾何左右翻 ⇒ 從背面讀到的字是**正的**(見檔頭 ②)
          uv.push(du < 0 ? u0 : u1, dv < 0 ? v0 : v1);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      };
      const first = pos.length / 3;
      emit(false);
      if (it.both) emit(true);
      for (let k = first; k < pos.length / 3; k++) glow.push(it.style === 'lane' ? .65 : 0);
    });

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = MIP_ANISO;
    // 圖集**絕不可** Repeat:取樣溢出格緣會抓到隔壁那塊牌的字(半像素內縮是第二道防線)
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    registerStreamTex(tex);
    registerVirtualPages(tex, pages);
    tex.needsUpdate = true;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('signGlow', new THREE.Float32BufferAttribute(glow, 1));
    geo.setIndex(idx);
    // 牌面是**實心板**不是貼花:不透明 ⇒ 勾線 pass 的深度正確,而且線正好描出牌框(檔頭 ④)。
    // `rim: 0` —— 掠射角把牌面洗白會讓字直接消失(與貼地平面同一條)。
    const mesh = new THREE.Mesh(geo, envMat(0xffffff, { map: tex, rim: 0, wash: 0.15, cool: 0.3, bands: 'soft' }));
    if (glow.some(v => v > 0)) applySignGlow(mesh.material, tex);
    mesh.frustumCulled = false;   // 牌子散布全圖,包圍球不可靠(同植被 InstancedMesh)
    mesh.userData.signCount = drawn;
    mesh.userData.signDropped = this.items.length - drawn;   // 裝不下的**明講**(檔頭 ⑤)
    mesh.userData.signTex = tex;                             // A25:CanvasTexture 的釋放入口
    return mesh;
  }

  /** 畫一格:依語域選版面(`SIGN_STYLES[].paint`),同語域的配色依序輪替 */
  _paintCell(ctx, it, r, i) {
    const st = SIGN_STYLES[it.style] || SIGN_STYLES.stone;
    const pal = PALETTE[it.style];
    const k = pal ? pal[i % pal.length] : null;
    const sk = k ? { ...st, bg: k[0], fg: k[1], edge: k[1] } : st;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();                       // 版面畫超出格子就會蓋到隔壁那塊牌
    (PAINT[st.paint] || PAINT.plain)(ctx, r.w, r.h, it.copy, sk);
    ctx.restore();
  }
}

// Per-plate backlighting shares the text atlas and draw call with unlit civic signs.
export function applySignGlow(material, texture) {
  material.emissive = new THREE.Color(0xffffff);
  material.emissiveMap = texture; material.emissiveIntensity = 1;
  material.userData.signGlow = true;
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float signGlow; varying float vSignGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSignGlow = signGlow;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vSignGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vSignGlow;');
  };
  material.customProgramCacheKey = () => key() + ':signGlow';
  material.needsUpdate = true;
  return material;
}

/* ------------------------------- 版面(語域)------------------------------- */

/** 縮到寫得下為止:字級由**量測**決定,不是猜的(把牌子拉長來容納長名字 = 檔頭 ③ 的壓扁) */
function fit(ctx, text, maxW, size, weight) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT_STACK}`;
  const tw = ctx.measureText(text).width;
  if (tw > maxW) {
    s = Math.max(8, s * maxW / tw);
    ctx.font = `${weight} ${s}px ${FONT_STACK}`;
  }
  return s;
}

/** 置中橫排(spacing = 字距;漢字招牌拉開字距才像招牌) */
function center(ctx, text, cx, cy, maxW, size, color, weight = '700', spacing = 0) {
  const chars = [...text];
  const s = fit(ctx, text, Math.max(8, maxW - spacing * Math.max(0, chars.length - 1)), size, weight);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  if (!spacing) { ctx.textAlign = 'center'; ctx.fillText(text, cx, cy); return s; }
  ctx.textAlign = 'left';
  const total = chars.reduce((a, ch) => a + ctx.measureText(ch).width + spacing, -spacing);
  let x = cx - total / 2;
  for (const ch of chars) { ctx.fillText(ch, x, cy); x += ctx.measureText(ch).width + spacing; }
  return s;
}

/** 直排(亞洲直式招牌):字級由「幾個字塞進這麼高」反推 */
function vertical(ctx, text, cx, y0, y1, maxW, color) {
  const chars = [...text];
  const step = (y1 - y0) / Math.max(1, chars.length);
  ctx.font = `700 ${Math.min(maxW, step * 0.86)}px ${FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  chars.forEach((ch, i) => ctx.fillText(ch, cx, y0 + step * (i + 0.5)));
}

const rule = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

function signArrow(ctx, x, y, size, direction, color) {
  ctx.save(); ctx.translate(x, y);
  ctx.rotate(direction === 'left' ? -Math.PI / 2 : direction === 'right' ? Math.PI / 2 : 0);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const [dx, dy] of [[0, -.5], [.36, -.1], [.12, -.1], [.12, .5], [-.12, .5], [-.12, -.1], [-.36, -.1]]) {
    ctx.lineTo(dx * size, dy * size);
  }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function trafficSymbol(ctx, w, h, copy, st) {
  const symbol = copy.symbol;
  if (symbol === 'speed' || symbol === 'stop') {
    center(ctx, copy.t, w / 2, h * (copy.s ? .45 : .51), w * .73, h * .43, st.fg);
    if (copy.s) center(ctx, copy.s, w / 2, h * .72, w * .6, h * .14, st.fg);
    return;
  }
  if (symbol === 'yield') return;
  if (symbol === 'no_entry') { rule(ctx, w * .2, h * .43, w * .6, h * .14, '#ffffff'); return; }
  if (['oneway', 'keep_left', 'keep_right'].includes(symbol)) {
    ctx.save(); ctx.translate(w / 2, h / 2);
    if (symbol !== 'oneway') ctx.rotate(symbol === 'keep_left' ? -Math.PI / 4 : Math.PI / 4);
    signArrow(ctx, 0, 0, h * .63, 'straight', st.fg); ctx.restore(); return;
  }
  if (symbol === 'roundabout') {
    ctx.strokeStyle = st.fg; ctx.lineWidth = h * .055;
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, h * .23, a, a + 1.55); ctx.stroke();
      ctx.save(); ctx.translate(w / 2 + Math.cos(a + 1.55) * h * .23, h / 2 + Math.sin(a + 1.55) * h * .23);
      ctx.rotate(a + 1.55 + Math.PI); signArrow(ctx, 0, 0, h * .18, 'straight', st.fg); ctx.restore();
    }
    return;
  }
  ctx.strokeStyle = st.fg; ctx.fillStyle = st.fg; ctx.lineWidth = h * .045;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = points => { ctx.beginPath(); points.forEach(([x, y]) => ctx.lineTo(w * x, h * y)); ctx.stroke(); };
  if (symbol === 'crossing') {
    ctx.beginPath(); ctx.arc(w * .5, h * .45, h * .045, 0, Math.PI * 2); ctx.fill();
    path([[.5, .51], [.46, .64], [.35, .75]]); path([[.46, .64], [.62, .76]]);
    path([[.38, .57], [.5, .54], [.62, .59]]);
    for (let i = 0; i < 4; i++) rule(ctx, w * (.28 + i * .12), h * .79, w * .075, h * .04);
  } else if (symbol === 'narrowing') {
    path([[.3, .8], [.3, .66], [.42, .52], [.42, .39]]);
    path([[.7, .8], [.7, .66], [.58, .52], [.58, .39]]);
  } else if (symbol === 'curve') path([[.45, .82], [.45, .68], [.61, .59], [.46, .48], [.46, .39]]);
  else if (symbol === 'bump') {
    ctx.beginPath(); ctx.moveTo(w * .25, h * .78); ctx.bezierCurveTo(w * .35, h * .78, w * .4, h * .56, w * .5, h * .56);
    ctx.bezierCurveTo(w * .6, h * .56, w * .65, h * .78, w * .75, h * .78); ctx.stroke();
  } else if (symbol === 'signals') {
    rule(ctx, w * .43, h * .4, w * .14, h * .4, st.fg);
    ['#d32d28', '#e4bb30', '#368d48'].forEach((c, i) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(w * .5, h * (.46 + i * .13), h * .042, 0, Math.PI * 2); ctx.fill();
    });
  } else if (symbol === 'rail_crossing') {
    for (const x of [.4, .6]) path([[x, .4], [x, .8]]);
    for (const y of [.5, .62, .74]) path([[.29, y], [.71, y]]);
  } else if (symbol === 'no_overtaking') {
    rule(ctx, w * .28, h * .33, w * .17, h * .35, '#ce302c');
    rule(ctx, w * .55, h * .33, w * .17, h * .35, st.fg);
  } else if (symbol === 'no_parking') {
    center(ctx, 'P', w / 2, h / 2, w * .6, h * .55, st.fg);
    ctx.strokeStyle = st.edge; ctx.lineWidth = h * .08; path([[.21, .79], [.79, .21]]);
  }
}

/**
 * 逐語域的版面。**一個版面服務整類的全部語料**(skill §一.5)——
 * 新增一種招牌 = 加一列 `SIGN_STYLES` + 加一個版面,MUST NOT 每塊牌一個繪製函式。
 */
const PAINT = {
  direction(ctx, w, h, copy, st) {
    ctx.fillStyle = st.bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = st.edge; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12);
    const left = copy.ref ? h * .65 : 14, right = copy.arrow ? h * .65 : 14;
    const space = w - left - right, cx = left + space / 2;
    center(ctx, copy.t, cx, h * (copy.s ? .36 : .5), space - 12, h * .4, st.fg);
    if (copy.s) center(ctx, copy.s, cx, h * .74, space - 12, h * .21, st.fg, '600');
    if (copy.ref) {
      ctx.strokeRect(12, h * .23, left - 18, h * .54);
      center(ctx, copy.ref, left / 2 + 3, h / 2, left - 24, h * .24, st.fg);
    }
    if (copy.arrow) signArrow(ctx, w - right / 2, h / 2, h * .58, copy.arrow, st.fg);
  },
  traffic(ctx, w, h, copy, st) {
    ctx.fillStyle = copy.symbol === 'no_entry' ? st.edge : st.bg; ctx.fillRect(0, 0, w, h);
    if (copy.symbol === 'oneway') {
      ctx.strokeStyle = st.edge; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12);
      trafficSymbol(ctx, w, h, copy, st); return;
    }
    const outline = signShape(st.shape);
    ctx.beginPath(); outline.forEach(([x, y]) => ctx.lineTo(w / 2 + x * w * .445, h / 2 - y * h * .445));
    ctx.closePath(); ctx.strokeStyle = st.edge; ctx.lineWidth = h * .075; ctx.stroke();
    trafficSymbol(ctx, w, h, copy, st);
  },
  // 構件名牌:底板 + 邊框 + 一行字(洞口匾額 / 橋名牌 / 地名標牌 / 建物立面招牌)
  plain(ctx, w, h, copy, st) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = Math.max(2, h * 0.045);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    const pad = h * 0.16;
    const size = fit(ctx, copy.t, w - pad * 2, h - pad * 2, st.weight);
    ctx.fillStyle = st.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(copy.t, w / 2, h / 2 + size * 0.04);
  },
  // 建築直式招牌:主名直排 + 底端一格日常副行。街景裡最窄的一塊牌 ⇒ 只放得下名字
  vertical(ctx, w, h, copy, st) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.18;
    rule(ctx, 5, 5, w - 10, h - 10, st.fg);
    ctx.globalAlpha = 1;
    const foot = copy.s ? h * 0.16 : 0;
    vertical(ctx, copy.t, w / 2, h * 0.06, h - foot - h * 0.05, w * 0.74, st.fg);
    if (copy.s) {
      rule(ctx, w * 0.2, h - foot - 4, w * 0.6, 2, st.fg);
      center(ctx, copy.s, w / 2, h - foot / 2, w * 0.84, foot * 0.42, st.fg, '600');
    }
  },
  // 廣告看板:左三分之二是名字,右邊一條放日常副行與拉丁副名(三層文字)
  fascia(ctx, w, h, copy, st) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    rule(ctx, 0, h - 9, w, 9, st.fg);
    rule(ctx, 0, 0, w, 5, st.fg);
    const split = copy.s || copy.en ? 0.66 : 1;
    center(ctx, copy.t, w * split * 0.5, h * 0.5, w * split - 24, h * 0.5, st.fg, '700', h * 0.05);
    if (split < 1) {
      rule(ctx, w * split, h * 0.18, 2, h * 0.62, st.fg);
      ctx.globalAlpha = 0.8;
      if (copy.s) center(ctx, copy.s, w * (split + 1) / 2, h * (copy.en ? 0.38 : 0.5), w * (1 - split) - 16, h * 0.2, st.fg, '600');
      if (copy.en) center(ctx, copy.en, w * (split + 1) / 2, h * (copy.s ? 0.66 : 0.5), w * (1 - split) - 16, h * 0.15, st.fg, '500');
      ctx.globalAlpha = 1;
    }
  },
  // 道路路標:白框 + 路名 + 方向箭頭。語域是「往哪裡、還有多遠」
  road(ctx, w, h, copy, st) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = st.fg;
    ctx.lineWidth = 5;
    ctx.strokeRect(9, 9, w - 18, h - 18);
    const ax = w - h * 0.5;
    center(ctx, copy.t, (w - h * 0.75) / 2 + 8, h * (copy.s ? 0.42 : 0.5), w - h - 26, h * 0.42, st.fg, '700', 3);
    if (copy.s) center(ctx, copy.s, (w - h * 0.75) / 2 + 8, h * 0.74, w - h - 30, h * 0.2, st.fg, '500');
    ctx.fillStyle = st.fg;
    ctx.fillRect(ax - h * 0.24, h * 0.47, h * 0.26, h * 0.06);
    ctx.beginPath();
    ctx.moveTo(ax + h * 0.18, h * 0.5);
    ctx.lineTo(ax - h * 0.02, h * 0.32);
    ctx.lineTo(ax - h * 0.02, h * 0.68);
    ctx.closePath();
    ctx.fill();
  },
  // 佈告欄:抬頭條 + 一則公告 + 幾條「已經貼在上面的別的紙」
  notice(ctx, w, h, copy, st) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    rule(ctx, 0, 0, w, h * 0.2, st.fg);
    center(ctx, copy.t, w / 2, h * 0.1, w - 20, h * 0.13, st.bg, '700', 2);
    if (copy.s) center(ctx, copy.s, w / 2, h * 0.34, w - 24, h * 0.11, st.fg, '600');
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
      const y = h * (0.5 + i * 0.14);
      rule(ctx, w * 0.1, y, w * (0.5 + (i % 2) * 0.28), 3, st.fg);
      rule(ctx, w * 0.1, y + 7, w * (0.34 + (i % 3) * 0.16), 3, st.fg);
    }
    ctx.globalAlpha = 1;
    rule(ctx, w * 0.1, h * 0.44, w * 0.8, 2, st.fg);
  },
  // 風景解說牌:標題 + 分隔線 + 標高/來歷 + 一條抽象稜線(解說牌上一定有一張圖)
  scenic(ctx, w, h, copy, st) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = st.fg;
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    center(ctx, copy.t, w / 2, h * 0.22, w - 40, h * 0.24, st.fg, '700', 4);
    rule(ctx, w * 0.18, h * 0.38, w * 0.64, 2, st.fg);
    if (copy.s) center(ctx, copy.s, w / 2, h * 0.5, w - 44, h * 0.13, st.fg, '600');
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(w * 0.14, h * 0.84);
    ctx.lineTo(w * 0.34, h * 0.66);
    ctx.lineTo(w * 0.46, h * 0.74);
    ctx.lineTo(w * 0.62, h * 0.6);
    ctx.lineTo(w * 0.86, h * 0.84);
    ctx.strokeStyle = st.fg;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
};
// 純算術的兩支另行匯出(宣告用頂層 function,供離線稽核 grabFn 抽原文直測)
export { signAspect, packCells };
