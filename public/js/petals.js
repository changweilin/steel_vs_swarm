// ============ 落花 / 落葉粒子(規則層;anime_style_plan ⑤-4)============
// 2026-08-16。這一支只回答三個問題:**下不下**(季節)、**下什麼顏色**(色調)、
// **每一片怎麼動**(兩頻率 + 自轉 + 沿中心線環繞)。掛在哪、用什麼幾何畫、逐幀寫進哪一顆
// InstancedMesh 是 `biomes.js` 的事 —— 與 `edgewall.js → buildEdgeWall`、
// `flags.js → placeBaseFlags`、`wallpanel.js → biomes.alignedGeo` 同一條分工。
//
// ---- 四條邊界 ----
// ① **零 THREE、只 import `rng.js`**。粒子的狀態是一疊純量,運動是純函式 ⇒
//    「兩個頻率不可通約嗎」「自轉軸真的逐粒不同嗎」「跑一小時之後這叢花還蓋在那叢樹上嗎」
//    在 Node 端就量得到,不必開瀏覽器。這是本項唯一能離線驗的一半(稽核 `audit_ambient_motion`)。
// ② **零共享 `rnd()` 消耗**(§2.3 / A4)。呼叫端交進來的 `rnd` MUST 是專屬 `mulberry32`
//    (`biomes.js` 用 `gseed ^ 0x5E7A1`)—— 從共享序列多抽一枚,後面每一株植被、每一棟建物的
//    佈局就整條推移,而畫面上只表現成「整張圖變了」,沒有任何錯誤訊息。
//    逐粒消耗**固定** `RND_PER_PETAL` 枚;場的挑選與地貌閘**零消耗且完全決定性**
//    (分群 → 依棵數與座標定序 → 取前 K),所以「淘汰檢查排在抽樣之後」在這裡是恆真的。
// ③ **落點不自己發明**:場一律由呼叫端交進來的**最終植被實例名冊**(`biomes.js` 的 `items`,
//    建物過濾之後那一份)推導。另開一張「哪幾種樹會落葉」的名單遲早與季節換色那一份分家 ——
//    判據 MUST 是既有欄位(`VEG_DEFS[type].parts` 有沒有 `key: 'foliage'`),同 `SOFT_BY_VEG_KEY`。
// ④ **純表現層**:`data.js` / `sim.js` / `server/**` 一行不動;`ENV.seasons[].accent` 只被讀取。
//
// ---- 為什麼是 CPU 步進而不是頂點著色器 ----
// `toon.js` 的 `CEL_SWAY` 是「零件黏在株上、只是彎一下」;落花是**離開母體之後自己走**的,
// 位置沒有母體可錨。做成 GLSL 就要為它開第三個 `sin(`,而 `audit_soft_stroke` Ⅲ 的 sway
// 正規式會一路吃過 `CEL_WAVE` 區塊、`count(/sin\(/g) === 2` 是全域計數 ⇒ 多一個就紅,
// 而紅字的理由(「兩個不可通約的正弦」)與落花完全無關。CPU 這條路連帶讓上面 ① 成立。
//
// ---- 幾個會靜默壞掉的地方 ----
// ・**dt 沒夾**:切回背景分頁那一幀的 dt 是好幾秒 ⇒ 整場落花瞬移到地面或飛出體積外。
//   `DT_MAX` 與 `toon.stepCelWind` 的 0.25 是**同一個理由**(見那一支的註解),故取同值。
// ・**只有一個頻率**:單一正弦讀起來是「機械擺動」不是空氣。慢波給「這陣風」、快顫給
//   「葉片自己在翻」,兩個頻率不可通約才看不出重複點(同 `SOFT_KINDS` 的 `freq`/`BEAT`)。
// ・**自轉軸全部繞 +Y**:一地的硬幣。軸 MUST 逐粒取球面均勻分布。
// ・**環繞取模改用世界軸**:整片花會慢慢飄離它該蓋住的那叢樹,而畫面上只表現成
//   「樹下沒有花、旁邊的空地有」。位置一律**相對場的中心線**表達(`ox`/`oz`/`oy`),
//   環繞因此是構造保證而不是靠參數調得剛好。
import { mulberry32 } from './rng.js';

/**
 * 參數表。四類:分群 / 密度 / 運動 / 外觀。
 * ⚠ 尺寸(`SIZE`)是**授權值不是量測值** —— 真實花瓣 2~4cm 在這個尺度上是看不見的一個像素,
 * 日系動漫背景一律誇張成「看得出是一片花瓣」。校準面是定裝照(㋓),不是任何一條斷言。
 */
export const PETAL = {
  // ---- 分群(哪幾叢樹會下)----
  // 格寬取「一叢林子」的尺度:與 `buildVegMeshes` 的區域色相家族(110m ≈ 一個群落)同量級,
  // 讓「這片林子在下花」與「這片林子偏黃」講的是同一片林子。
  CELL_M: 110,
  MIN_CROWNS: 4,        // 一叢至少幾棵才成場 —— 孤木飄花讀起來像特效不像天氣
  MAX_FIELDS: 6,
  MAX_FIELDS_LOW: 3,    // 低功耗階梯(逐幀 setMatrixAt 的上傳量,RES_GOV 調不掉它)

  // ---- 密度(每一場幾片)----
  // 總量對齊既有的雨雪粒子(1600 / 1100 顆逐幀寫 position)那一個量級 —— 那是這台機器上
  // 已知跑得動的基準;落花另外便宜在「逐幀只寫 InstancedMesh 的矩陣」而不是重建幾何。
  DENSITY: 1 / 60,      // 每平方公尺幾片(以場的水平投影面積計)
  MAX_PER_FIELD: 260,
  MAX_TOTAL: 1200,
  MAX_TOTAL_LOW: 480,

  // ---- 運動 ----
  FALL_MIN: 0.45, FALL_MAX: 0.95,     // 落速帶(m/s);帶寬本身就是「有的飄有的墜」
  ORBIT_MIN: 0.05, ORBIT_MAX: 0.22,   // 繞場中心線的角速度(rad/s;正負各半 = 有順有逆)
  // 兩個**不可通約**的頻率(rad/s):慢波 = 這陣風、快顫 = 葉片自己在翻。兩條:
  //   ① MUST 維持 `SWAY_FAST × F_FAST > SWAY_SLOW × F_SLOW`(快顫在**速度**上要壓得過慢波),
  //      否則「兩頻率」只剩下註解 —— 軌跡上量到的極值數會塌回慢波那一支。
  //   ② 比值 MUST 離每一個小分母有理數都夠遠(稽核以 q ≤ 6 量,= 重複週期超過一分鐘)。
  //      現值 3.54 / 0.6 = 5.9,離最近的 35/6 有 0.067。取整數比(4×、6×)看得出重複點。
  F_SLOW: 0.6, F_FAST: 3.54,
  SWAY_SLOW: 0.22, SWAY_FAST: 0.085, // 相對擺幅(佔軌道半徑);兩者相加 MUST < 1(半徑不得翻負)
  BOB: 0.12,                          // 快顫的垂直分量(m)
  SPIN_MIN: 0.8, SPIN_MAX: 2.6,       // 逐粒自轉角速度(rad/s)
  DT_MAX: 0.25,                       // 與 toon.stepCelWind 同值同理由(背景分頁那一幀)

  // ---- 預跑(建構期把系統推到穩態)----
  // 首幀 MUST 已經是「一直在下」的樣子:全部擠在樹冠那一層 = 開場看到一批花同時開始掉。
  // 步長固定 0.1s(計畫原文的粒度),**步數推導**:慢的那一片要走完整條高度帶。
  // 手寫 40 步在 20m 高的帶上只走得了 9m ⇒ 首幀下半場是空的,而每一條斷言都會過。
  PREWARM_STEP: 0.1,
  PREWARM_TURNS: 1.15,   // 走完 1.15 趟(留一點餘裕讓相位也散開)

  // ---- 外觀 ----
  SIZE: { bloom: 0.22, leaf: 0.34 },  // 授權值(見檔頭)
  SIZE_JIT: 0.35,                     // 逐粒尺寸抖動(±)
  ASPECT: 0.62,                       // 花瓣/葉片的寬:長
  OPACITY: 0.92,
  TONE_W: [0.55, 0.28, 0.17],         // 三色調的比重
  BRIGHT_F: 1.14,                     // 第二色調 = 主色調提亮
  MIX_F: { bloom: 0.18, leaf: 0.5 },  // 第三色調 = 主色調往同季 foliage 混多少
  RND_PER_PETAL: 11,                  // 逐粒**固定**枚數(見檔頭 ②)
};

/**
 * 這一季下不下、下什麼。
 * 春 = 落花(bloom)、秋 = 落葉(leaf)、夏冬不下(null)。
 * ⚠ 本專案的 `VEG_DEFS` **沒有櫻花樹種** ⇒ 「落花」在這個世界裡沒有對應的來源幾何,
 * 色調只能由既有的 `ENV.seasons[].accent` 推導(見 `petalTones`)。要不要真的加一款開花樹種
 * 是**內容決定**,不是實作決定 —— 留給使用者裁決(docs/_pending/lane-world.md 第 ⑤ 段)。
 */
export function petalSeason(season) {
  if (season === 'spring') return 'bloom';
  if (season === 'autumn') return 'leaf';
  return null;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const rgbOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const hexOf = (r, g, b) => (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);

/**
 * 三個色調(權重見 `PETAL.TONE_W`)。**MUST 由 `ENV.seasons[季]` 推導,MUST NOT 手寫色碼** ——
 * 手寫的那三個色會在調季節色盤時靜默過期,而畫面上只表現成「秋天的落葉顏色跟樹不一樣」。
 *   ① 主色調 = `accent`(春 = 粉、秋 = 橘紅;這一欄在 2026-08-16 之前沒有任何消費端)
 *   ② 提亮版 = 主色調 × `BRIGHT_F`(逆光那幾片)
 *   ③ 混色版 = 主色調往**同季** `foliage` 混 `MIX_F[mode]`
 *      —— 落葉混得多(葉子本來就帶著綠),落花只混一點點(粉混綠會變灰,那不是花)
 * @param {{foliage:number, accent:number}} row  `ENV.seasons[season]`
 * @param {'bloom'|'leaf'} mode
 * @returns {number[]} 三個 0xRRGGBB
 */
export function petalTones(row, mode) {
  const [ar, ag, ab] = rgbOf(row.accent);
  const [fr, fg, fb] = rgbOf(row.foliage);
  const k = PETAL.MIX_F[mode] ?? 0;
  return [
    hexOf(ar, ag, ab),
    hexOf(ar * PETAL.BRIGHT_F, ag * PETAL.BRIGHT_F, ab * PETAL.BRIGHT_F),
    hexOf(ar + (fr - ar) * k, ag + (fg - ag) * k, ab + (fb - ab) * k),
  ];
}

/**
 * 把樹冠名冊分群成「場」。**零亂數、完全決定性**:
 *   ① 逐冠丟進 `CELL_M` 的格 ② 棵數 < `MIN_CROWNS` 的格丟掉
 *   ③ 依「棵數降冪 → 格座標升冪」定序(棵數相同時由座標定序 ⇒ 跨客戶端逐位元同一組)
 *   ④ 取前 K 格,每格一個場:中心 = 該群樹冠的水平重心、半徑 = 重心到最遠冠緣、
 *      頂 = 群裡最高的冠頂(全部**由該群自己的外廓推導**,MUST NOT 手寫)
 * @param {{x:number,z:number,top:number,r:number}[]} crowns 樹冠(top = 冠頂絕對高;r = 冠幅半徑)
 * @param {number} maxFields
 */
export function groupCrowns(crowns, maxFields) {
  const cells = new Map();
  for (const c of crowns) {
    const gx = Math.floor(c.x / PETAL.CELL_M), gz = Math.floor(c.z / PETAL.CELL_M);
    const key = `${gx},${gz}`;
    let a = cells.get(key);
    if (!a) cells.set(key, a = { gx, gz, cs: [] });
    a.cs.push(c);
  }
  const groups = [...cells.values()].filter((a) => a.cs.length >= PETAL.MIN_CROWNS);
  groups.sort((a, b) => b.cs.length - a.cs.length || a.gx - b.gx || a.gz - b.gz);
  return groups.slice(0, Math.max(0, maxFields)).map((a) => {
    let sx = 0, sz = 0, top = -Infinity;
    for (const c of a.cs) { sx += c.x; sz += c.z; if (c.top > top) top = c.top; }
    const cx = sx / a.cs.length, cz = sz / a.cs.length;
    let r = 0;
    for (const c of a.cs) r = Math.max(r, Math.hypot(c.x - cx, c.z - cz) + c.r);
    return { cx, cz, r, top, n: a.cs.length };
  });
}

/**
 * 規劃落花場 + 逐粒初始狀態。
 * @param {{x,z,top,r}[]} crowns  由**最終**植被實例名冊推導的落葉樹冠(見檔頭 ③)
 * @param {object} opts
 *   @param {'bloom'|'leaf'} opts.mode
 *   @param {(x:number,z:number)=>number} opts.groundAt  地表高(逐粒取一次,之後不再取樣)
 *   @param {(x:number,z:number)=>boolean} opts.dryAt    地貌閘:水/沼上不下花(回 false = 淘汰)
 *   @param {boolean} [opts.low]  低功耗階梯
 * @param {()=>number} rnd  **專屬** mulberry32(見檔頭 ②)
 * @returns {{fields:object[], parts:object[]}}
 */
export function planPetalFields(crowns, opts, rnd) {
  const low = !!opts.low;
  const maxF = low ? PETAL.MAX_FIELDS_LOW : PETAL.MAX_FIELDS;
  const maxN = low ? PETAL.MAX_TOTAL_LOW : PETAL.MAX_TOTAL;
  // 地貌閘與分群都是**零消耗**的純幾何 ⇒ 排在抽樣之前不會推移任何序列(檔頭 ②)
  const fields = groupCrowns(crowns, maxF).filter((f) => opts.dryAt(f.cx, f.cz));
  const parts = [];
  const size = PETAL.SIZE[opts.mode] ?? PETAL.SIZE.leaf;
  let left = maxN;
  for (const f of fields) {
    const want = Math.round(Math.PI * f.r * f.r * PETAL.DENSITY);
    f.n = Math.max(0, Math.min(want, PETAL.MAX_PER_FIELD, left));
    left -= f.n;
    f.ps = [];
    for (let i = 0; i < f.n; i++) {
      // ---- 逐粒固定 RND_PER_PETAL 枚(順序即契約;插一枚就把後面每一片的初值整條推移)----
      const rad = f.r * Math.sqrt(rnd());                                   // 1 圓盤均勻
      const a0 = rnd() * Math.PI * 2;                                       // 2 起始方位
      const wS = rnd();                                                     // 3 角速度大小
      const wD = rnd() < 0.5 ? -1 : 1;                                      // 4 順逆
      const vy = PETAL.FALL_MIN + rnd() * (PETAL.FALL_MAX - PETAL.FALL_MIN);// 5 落速
      const p1 = rnd() * Math.PI * 2;                                       // 6 慢波相位
      const p2 = rnd() * Math.PI * 2;                                       // 7 快顫相位
      const az = rnd() * 2 - 1;                                             // 8 自轉軸(球面均勻)
      const at = rnd() * Math.PI * 2;                                       // 9 自轉軸方位
      const sp = PETAL.SPIN_MIN + rnd() * (PETAL.SPIN_MAX - PETAL.SPIN_MIN);// 10 自轉角速度
      const tu = rnd();                                                     // 11 色調
      const sr = Math.sqrt(Math.max(0, 1 - az * az));
      const px = f.cx + Math.cos(a0) * rad, pz = f.cz + Math.sin(a0) * rad;
      const gy = opts.groundAt(px, pz);
      const p = {
        cx: f.cx, cz: f.cz,          // 場的中心線(環繞的參考框;見檔頭「環繞取模」那一條)
        y0: gy,                      // 這一片自己腳下的地表高(逐粒取一次:軌道半徑遠小於地形起伏尺度)
        h: Math.max(1, f.top - gy),  // 這一片自己的高度帶
        r: rad, a: a0, w: (PETAL.ORBIT_MIN + wS * (PETAL.ORBIT_MAX - PETAL.ORBIT_MIN)) * wD,
        vy, p1, p2,
        ax: Math.cos(at) * sr, ay: az, az: Math.sin(at) * sr,
        sp, ang: p1,                 // 起始自轉角借用慢波相位(不另抽一枚)
        sz: size * (1 + (tu - 0.5) * PETAL.SIZE_JIT),
        tone: toneOf(tu),
        ox: 0, oz: 0, oy: 0, mi: 0,
      };
      p.y = p.h;                     // 都從冠頂出發 —— 散開是 prewarm 的事(見那一支)
      f.ps.push(p);
      parts.push(p);
    }
    prewarmField(f);
  }
  return { fields, parts };
}

/** 色調抽籤(權重 `PETAL.TONE_W`;吃已經抽好的那一枚 u,不另耗亂數) */
function toneOf(u) {
  let acc = 0;
  for (let i = 0; i < PETAL.TONE_W.length; i++) {
    acc += PETAL.TONE_W[i];
    if (u < acc) return i;
  }
  return PETAL.TONE_W.length - 1;
}

/**
 * 建構期預跑:把整場推到穩態,首幀就是「一直在下」的樣子。
 * 步數**推導**(見 `PETAL.PREWARM_*` 旁的理由):慢的那一片要走完 `PREWARM_TURNS` 趟高度帶。
 */
export function prewarmField(f) {
  if (!f.ps?.length) return;
  let h = 0;
  for (const p of f.ps) h = Math.max(h, p.h);
  const n = Math.ceil((h / PETAL.FALL_MIN) * PETAL.PREWARM_TURNS / PETAL.PREWARM_STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += PETAL.PREWARM_STEP;
    for (const p of f.ps) stepPetal(p, PETAL.PREWARM_STEP, t);
  }
}

/**
 * 推進一片。輸出恆是**相對場中心線**的偏移(`ox`/`oz`/`oy`)—— 呼叫端加上 `p.cx`/`p.cz`/`p.y0`
 * 就是世界座標。環繞因此是**構造保證**:水平恆在自己的軌道上、垂直恆在自己的高度帶內,
 * 一小時之後這叢花仍蓋在那叢樹上,不需要任何一個係數調得剛好。
 * 低空風力數值透過落花 / 落葉的落速、擺盪、角速度與微幅風向偏倚表現 (視季節與即時風力動態而定)。
 * @param {object} p 粒子(就地變更)
 * @param {number} dt 幀時(呼叫端 MUST 已夾 `PETAL.DT_MAX`;本函式再夾一次當保險)
 * @param {number} t  場的累計時鐘(秒)
 * @param {{ windAmp?:number, windDir?:number[] }} [dyn] 即時天氣風力動態
 */
export function stepPetal(p, dt, t, dyn) {
  const d = dt > PETAL.DT_MAX ? PETAL.DT_MAX : (dt > 0 ? dt : 0);
  const wScale = dyn ? Math.max(0.4, Math.min(2.5, dyn.windAmp ?? 1.0)) : 1.0;
  const windDir = dyn?.windDir ?? [1, 0];

  p.y -= p.vy * d * (0.85 + wScale * 0.15);
  while (p.y < 0) p.y += p.h;        // 落到地面 → 回到冠頂(場自己的高度帶)
  p.a += p.w * d * wScale;
  p.ang += p.sp * d * wScale;
  const s1 = Math.sin(t * PETAL.F_SLOW * wScale + p.p1);   // 慢波:這陣風
  const s2 = Math.sin(t * PETAL.F_FAST * wScale + p.p2);   // 快顫:葉片自己在翻
  const rad = p.r * (1 + PETAL.SWAY_SLOW * s1 + PETAL.SWAY_FAST * s2);
  p.ox = Math.cos(p.a) * rad;
  p.oz = Math.sin(p.a) * rad;
  if (dyn && (wScale > 1.05 || wScale < 0.95)) {
    const drift = (wScale - 1.0) * 1.8;
    p.ox += windDir[0] * drift * (1 + s1 * 0.25);
    p.oz += windDir[1] * drift * (1 + s1 * 0.25);
  }
  p.oy = p.y + PETAL.BOB * (1 + s2);  // (1 + s2) ⇒ 恆 ≥ 0,不會有一幀沉到地面以下
}

/** 專屬亂數的取得處(呼叫端 MUST 走這一支,MUST NOT 傳共享 rnd 進來;見檔頭 ②) */
export function petalRnd(gseed) { return mulberry32((gseed ^ 0x5E7A1) >>> 0); }
