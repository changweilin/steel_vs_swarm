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
import { registerStreamTex } from './tex.js';

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
};

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
  cv.width = cv.height = 8;
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
    if (ctx.measureText(ch).width === tofu) miss++;
  }
  return n > 0 && miss / n <= 0.2;
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
    if (x + c.w > maxW) { shelfY += shelfH; x = 0; shelfH = 0; }    // 換一層貨架
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
  constructor(lowPower = false) {
    this.scale = lowPower ? 0.5 : 1;      // 低功耗:atlas 解析度砍半(格數不變,字略糊)
    this.items = [];
    this.area = 0;                        // 已佔像素面積(額度以面積估,見 `full`)
  }

  /**
   * 還有沒有額度(呼叫端據此決定要不要繼續算位置)。
   * 混合長寬比之後「格數」不再等於「裝得下」⇒ 額度以**面積**估,再加一道格數硬上限。
   */
  get full() {
    return this.items.length >= SIGN_MAX
      || this.area >= ATLAS_MAX * ATLAS_MAX * FILL * this.scale * this.scale;
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
    const pos = [], nrm = [], uv = [], idx = [];
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
      const cos = Math.cos(it.ry), sin = Math.sin(it.ry);
      // 牌面在水平面上的「右」向量(法線 = (sin, 0, cos) 的水平垂直)
      const rx = cos, rz = -sin;
      const emit = (flip) => {
        const b = pos.length / 3;
        const s = flip ? -1 : 1;
        for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          pos.push(it.x + rx * (w / 2) * du * s, it.y + (it.h / 2) * dv, it.z + rz * (w / 2) * du * s);
          nrm.push(sin * s, 0, cos * s);
          // 背面共用同一格 UV,但幾何左右翻 ⇒ 從背面讀到的字是**正的**(見檔頭 ②)
          uv.push(du < 0 ? u0 : u1, dv < 0 ? v0 : v1);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      };
      emit(false);
      if (it.both) emit(true);
    });

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    // 圖集**絕不可** Repeat:取樣溢出格緣會抓到隔壁那塊牌的字(半像素內縮是第二道防線)
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    registerStreamTex(tex);
    tex.needsUpdate = true;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    // 牌面是**實心板**不是貼花:不透明 ⇒ 勾線 pass 的深度正確,而且線正好描出牌框(檔頭 ④)。
    // `rim: 0` —— 掠射角把牌面洗白會讓字直接消失(與貼地平面同一條)。
    const mesh = new THREE.Mesh(geo, envMat(0xffffff, { map: tex, rim: 0, wash: 0.15, cool: 0.3, bands: 'soft' }));
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

/**
 * 逐語域的版面。**一個版面服務整類的全部語料**(skill §一.5)——
 * 新增一種招牌 = 加一列 `SIGN_STYLES` + 加一個版面,MUST NOT 每塊牌一個繪製函式。
 */
const PAINT = {
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
