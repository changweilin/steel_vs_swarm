// Import-free presentation preferences shared by the game, previews and offline audits.
// Presets commit atomically so every consumer sees the same art direction in one notification.
// Renderer controls remain internal; player settings expose curated styles only.

const KEY = 'svs_visual';

/**
 * 旋鈕表(單一真相)。
 *   def   預設值 —— **MUST 等於交付定案值**(見紀律①)
 *   min/max/step  拉桿範圍;`unit` 只影響顯示
 *   sample 樣品畫面要示範哪一種材質(matsample.js 用;null = 全部)
 */
export const VISUAL_KNOBS = {
  renderStyle: {
    label: '渲染風格', def: 'messenger',
    choices: ['cel', 'realistic', 'impasto', 'inkwash', 'watercolor', 'oil', 'messenger', 'sakura'],
    choiceLabels: {
      cel: '賽璐璐',
      realistic: '寫實',
      impasto: '厚塗',
      inkwash: '彩色水墨',
      watercolor: '水彩',
      oil: '油畫',
      messenger: '信使手繪',
      sakura: '櫻町動畫',
    },
    hint: '切換全場與展示台的繪畫渲染風格：**信使手繪**為預設低彩度色塊、紙感顆粒與石墨細線；**櫻町動畫**為冷紫陰影、暖白亮部與乾淨墨線；**賽璐璐**為硬邊色階與墨線；**寫實**為連續光影與微表面高光；**厚塗**為塊面筆觸與濃厚色彩過渡；**彩色水墨**為飛白濃淡墨韻與宣紙留白暈染；**水彩**為紙紋與柔化色塊；**油畫**為厚重筆觸與畫布肌理。即時切換，不影響任何戰鬥判定。',
  },
  // 兩根偏色拉桿的 `max` MUST 與 `toon.js TINT_MAX_A` 相同(稽核 Ⅱ 逐值比對)。
  // 上限 > 1 的理由住在 toon.js 那個常數旁邊:偏色只乘得到暗階的**直接光**那一項,
  // 100% 在真瀏覽器上量到的峰值只有 +5/255,拉了跟沒拉一樣。
  shadowMech: {
    label: '機體陰影偏色', def: 0, min: 0, max: 3, step: 0.05, unit: '%',
    hint: '機甲 / 英雄 / 武器的暗面往天光藍偏移。0% = 只變暗(舊制);100% = 天光藍本身的濃度,再往上是同一個色相拉更遠(亮度全程不變)。',
  },
  shadowEnv: {
    label: '環境陰影偏色', def: 0, min: 0, max: 3, step: 0.05, unit: '%',
    hint: '地形 / 建物 / 岩石的暗面偏移量,疊在既有的環境冷色之上。',
  },
  ink: {
    label: '勾線強度', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '螢幕空間描邊的墨色濃度。0% = 沒有線,100% = 現行調校值。',
  },
  weather: {
    label: '風化密度', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '苔蘚 / 水漬跟著「這一區比較老」的屬性場起伏的幅度。0% = 全場均勻(舊制)。',
  },
  // 這一項的 0% 與其他拉桿有一點不同:它讓**整個 pass 退出鏈**而不只是乘 0(postfx.js 組
  // chain 那一段)—— 景深是這批唯一「加成本」的效果,關掉就該真的不跑。同理它也**只在
  // 狙擊模式**掛上去(2026-08-09 使用者補充),一般視角逐位元不付這一 pass 的錢。
  dof: {
    label: '景深模糊', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '**狙擊模式限定**:進鏡後遠處的地面物件隨距離散焦(約 456m 起糊、608m 全糊),強度跟著拉近動畫淡入。兩個距離由**全場最遠交戰距離**推導 ⇒ 打得到的東西恆為全清晰,糊掉的一律是打不到也瞄不到的遠景。一般視角完全不套用。0% = 關掉這一層(那一個全螢幕 pass 連進鏡時都不跑 —— 這是這幾根拉桿裡唯一會增加繪圖負擔的)。',
  },
  // 空氣透視(雙色霧)。定案值 **0 = 逐位元同舊制** —— 近霧的色相是紀律①講的那種
  // 「需要美術方向確認」:它由 TIMES/SEASONS/WEATHERS 推導(environment.js `nearFogColor`,
  // 不是第四張色表),但「要偏多少」是口味。0% 時整段在 shader 裡分支跳過,連深度都不取樣。
  air: {
    label: '空氣透視', def: 0, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '霧從**兩個顏色**過渡:近處帶著當下的陽光色、遠處收斂到地平線色(遠景融進天空那條恆等式一格未動)。0% = 單色霧(舊制)。夜戰與雨霧天會被亮度封頂自動壓回接近 0 —— 那是刻意的(夜空不可以把場地照亮)。',
  },
  // 3D LUT 強度。**預設 1**:它與其他拉桿不同 —— 拉桿本身不會改變任何東西,真正的開關是
  // 下面那個來源(預設「不使用」⇒ 管線根本沒有 LUT ⇒ 逐位元同舊制)。若這一項也預設 0,
  // 使用者選了來源之後畫面不會動,那就是「拉桿拉了沒反應」的老坑。
  lut: {
    label: 'LUT 強度', def: 1, min: 0, max: 1, step: 0.05, unit: '%',
    hint: '查表調色的套用比例。0% = 只有內建的 split-tone(舊制),100% = 完全由 LUT 決定成像。**LUT 是取代內建調色不是疊上去**,所以中間值是兩者的交叉淡入。',
  },
  // 互斥選項(非拉桿):`choices` 一出現就是分段按鈕,消費端 MUST 由這一欄推導控件型別,
  // MUST NOT 在 UI 端寫「這一項是選單、那一項是拉桿」的名單(兩份名單遲早分家)。
  // 勾線資訊緩衝(2026-08-12 使用者定案「A 在設定加上開關」)。
  // 預設**開**:群組剪影依賴這張法線與面 id 緩衝。WebGL1 無 MRT 時仍安全退回深度勾線。
  inkMrt: {
    label: '折邊勾線', def: 'on', choices: ['off', 'on'],
    choiceLabels: { off: '關', on: '開' },
    hint: '深度只看得見「前後有落差」的邊,**同深度相接的同色面**(牆腳與地面、退縮平台的轉折、機體零件的接縫)永遠畫不出線。開啟後多畫一張帶法線與面 id 的緩衝,那些線就出得來 —— 實測墨線量約 2.2 倍。代價:多一張全螢幕緩衝 + 勾線每像素多五次取樣。WebGL1 裝置上這個開關沒有作用。',
  },
  // LUT 來源(2026-08-12 使用者定案「可設定 2 或 3」= 程序生成與外部檔**兩條都要**)。
  // 預設「不使用」⇒ 出貨版逐位元同舊制;`assets/lut.png` 不存在時「檔案」一樣不生效。
  lutSrc: {
    label: 'LUT 來源', def: 'none', choices: ['none', 'baked', 'file'],
    choiceLabels: { none: '不使用', baked: '內建(程序生成)', file: '檔案' },
    hint: '**不使用** = 只跑內建的 split-tone(現況)。**內建** = 把那一段數學程序生成成一張查表圖,畫面幾乎不變 —— 它的用途是「與現況等價的起點」,另存下來拿去外部工具調完再換成檔案。**檔案** = 讀 `assets/lut.png`(標準條狀 LUT,寬 = 邊長²、高 = 邊長);檔案不存在就靜靜地不套。',
  },
  // 太陽/月亮投影(2026-08-14 使用者「加入太陽/月亮與影子」)。
  // **預設開**(紀律①:def = 交付定案值,而這一項就是這一輪要交的東西);做成開關是因為
  // 它與景深同類 —— 唯一會增加繪圖負擔的一項(多一趟陰影圖 render pass)。
  shadow: {
    label: '日照投影', def: 'on', choices: ['off', 'on'],
    choiceLabels: { off: '關', on: '開' },
    hint: '機體 / 建築單位在地面投下影子,方向與長度跟著當下的太陽(夜裡是月亮)走。關掉後畫面與這批改動之前相同 —— 天色與日夜循環照常,只是沒有影子。低功耗與觸控裝置自動走半解析度的陰影圖。',
  },
  // ============ 2026-08-16 日系動漫計畫(序 3~13)一次加完的旋鈕 ============
  // **這張表由 lane-ink 單一擁有**:別的道要旋鈕一律開票給它一次加完,MUST NOT 自己塞一列
  // (兩份清單遲早分家,而症狀是「設定頁有這一項但它誰都沒接上」)。
  inkBreak: {
    label: '墨線斷筆', def: 1, min: 0, max: 1, step: 0.05, unit: '%',
    hint: '沿著線的方向以低頻噪聲把墨線斷開,讓它讀起來像**畫**出來的而不是**算**出來的。0% = 連續實線(舊制)。',
  },
  inkGroup: {
    label: '群組剪影', def: 'on', choices: ['off', 'on'],
    choiceLabels: { off: '關', on: '開' },
    hint: '整株樹 / 整顆巨岩 / 一堆石頭當成**一個東西**看:群組內部的折邊線收掉,只留剪影。關掉就是逐塊零件各自描邊(舊制)。WebGL1 裝置上這個開關沒有作用。',
  },
  leafCard: {
    label: '葉片卡冠層', def: 'auto', choices: ['off', 'auto', 'all'],
    choiceLabels: { off: '關', auto: '自動', all: '全部' },
    hint: '樹冠改用一叢朝向鏡頭的葉片卡,而不是一顆多面體團塊。**自動** = 只換解析不到零件庫節點的那幾列。⚠ 沒有「群組剪影」時卡片會被逐張描邊(比舊制更糟),故此項在群組剪影關著或 WebGL1 上自動退回「關」。',
  },
  foam: {
    label: '岸邊泡沫', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '水深淺到一定程度時畫出白色硬邊的泡沫帶,並跟著浪沖上岸。0% = 沒有泡沫。**沒有烤過深度場的場地(沒有水域)恆無泡沫**,與這根拉桿無關。',
  },
  reflect: {
    label: '水面倒影', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '岸邊高物件在水面上拉出斷口倒影塊(不是真的鏡面反射:那要多跑一趟全場)。0% = 不畫。',
  },
  // ⚠ 這一格的 def 是 **§0-b 的使用者定案**(2026-08-15「改 —— 走 School B」)。翻成
  // 'b' 的前提有兩個,兩個都已經成立:
  //   ① 裸 `MeshToonMaterial` 的凍結名冊清空(`audit_cel_pipeline` Ⅺ⑧ 硬閘,名冊非空就翻不了);
  //   ② 改制前後的定場照都拍過(`docs/_pending/shots-baseline.md`,78 + 65 + 26 + 65 張的 md5 全表)。
  // **切回舊制是這一行改回 'a'**,27 條 ramp 斷言與 `RAMPS`/`toonGradient` 全部原封不動留著。
  // 2026-08-19 調校定案(不是學派切換):`CEL_CUT.HUE_MIN_A = 1.5`;
  // bands=4 維持單一硬切的兩色結果,不補第二刀。School B 仍是交付預設。
  celSchool: {
    label: '賽璐璐學派', def: 'b', choices: ['a', 'b'],
    choiceLabels: { a: 'A(ramp 查表)', b: 'B(硬切 + 色相位移)' },
    hint: '**B**(交付定案值)= 單一硬切明暗界 + 陰影往色相位移,日系動畫背景的畫法。**A** = 改制前的三階 ramp 查表,整套仍在,選它即逐位元回到舊制。兩派會改掉每一台機體與整片地形的上色。',
  },
  wipe: {
    label: '轉場刷屏', def: 1, min: 0, max: 1, step: 0.05, unit: '%',
    hint: '開場 / 陣亡 / 結算的畫面切換改走動畫式的刷屏與溶解。0% = 現行的淡入淡出。',
  },
  landInk: {
    label: '地貌分界墨線', def: 1, min: 0, max: 1, step: 0.05, unit: '%',
    hint: '草↔岩、乾↔濕這一類**跨地貌**的界線也畫出墨線。⚠ 與 2026-08-13「不要看出地貌拼圖接縫」那條定案是同一個旋鈕的兩端 —— 現制的地貌換手發生在拼圖格界上而不是真實界線上,拉上去會把拼圖接縫一起描出來。預設 0% = 不畫。',
  },
  birds: {
    label: '鳥群', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '水域岸線 / 神木林 / 地標上空的鳥群密度。**純表現層**:不進碰撞、不進 LOS、不擋任何一發子彈。0% = 沒有鳥。',
  },
  fish: {
    label: '魚群', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '水體與水下沿岸的魚群密度。**純表現層**:水下游弋與擺尾游動。0% = 沒有魚。',
  },
  cats: {
    label: '貓咪', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '聚落、屋頂與巷弄的貓咪活動密度。**純表現層**:踱步巡遊與停歇。0% = 沒有貓。',
  },
  dogs: {
    label: '狗狗', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '街道、人行道與綠地的狗狗活動密度。**純表現層**:小跑巡邏與搖尾。0% = 沒有狗。',
  },
  wildlife: {
    label: '小動物', def: 1, min: 0, max: 1.5, step: 0.05, unit: '%',
    hint: '林緣的兔子、松鼠、蝴蝶，以及水岸的鴨子、青蛙、烏龜。0% = 關閉這些小動物。',
  },
  worldTextLang: {
    label: '世界文字語言', def: 'local', choices: ['local', 'zh', 'en'],
    choiceLabels: { local: '當地', zh: '中文', en: '英文' },
    hint: '洞口匾額 / 橋名牌 / 招牌上顯示哪一版名字。**當地** = 圖資的原文(真實感的來源,但可能看不懂);中文 / 英文取圖資的對應譯名,沒有譯名時退回原文。',
  },
};

export const VISUAL_COPY = Object.freeze({
  title: '畫面與線條風格',
  intro: '選一款喜歡的手繪或動畫風格，即時套用整個世界。',
  group: '畫面風格',
  recommended: '推薦',
  reset: '↺ 回到信使手繪',
  preview: '即時預覽',
  previewCurrent: '當前場景',
  previewEnvironment: '預覽情境',
});

const presetDefaults = Object.fromEntries(Object.entries(VISUAL_KNOBS).map(([k, d]) => [k, d.def]));
function preset(id, label, description, palette, values, surface, grade) {
  return Object.freeze({
    id, label, description, palette: Object.freeze(palette),
    values: Object.freeze({ ...presetDefaults, renderStyle: 'cel', air: 0.55, landInk: 0, ...values }),
    surface: Object.freeze({ outlineColor: 0x0a0b12, ...surface }),
    grade: Object.freeze({ nightLift: 0.3, ...grade, shadow: Object.freeze(grade.shadow), high: Object.freeze(grade.high) }),
  });
}

// Grade and surface coefficients multiply the existing renderer's single-source baselines.
export const VISUAL_PRESETS = Object.freeze([
  preset('messenger', '信使手繪', '參考 Messenger：低彩度色塊、紙感顆粒與石墨細線，像畫在紙上的小世界。',
    ['#65b9b3', '#b2ba9d', '#eee7cc'],
    { renderStyle: 'messenger', ink: 0.82, inkBreak: 0.45, shadowMech: 1.5, shadowEnv: 1.5, weather: 0.55, air: 0.65 },
    { cutWidth: 0.65, shadowValue: 1.12, rim: 0.45, outline: 0.58, outlineColor: 0x373f42 },
    { shadow: [0.96, 1.07, 1.06], high: [1.08, 1.04, 0.92], saturation: 0.86, exposure: 1.3, lift: 1.15, contrast: 0.06 }),
  preset('sakura', '櫻町動畫', '參考 Sakura Crossing：冷紫陰影、暖白亮部與乾淨細墨線，呈現日系動畫背景。',
    ['#9abfe8', '#e8bccf', '#fff1d8'],
    { renderStyle: 'sakura', ink: 0.7, inkBreak: 0.12, shadowMech: 1.7, shadowEnv: 1.8, weather: 0.5, air: 0.8, dof: 0 },
    { cutWidth: 0.9, shadowValue: 1.16, rim: 0.6, outline: 0.48, outlineColor: 0x39324f },
    { shadow: [1.06, 0.98, 1.16], high: [1.08, 1.03, 0.96], saturation: 1.08, exposure: 1.4, lift: 1.35, contrast: 0.08 }),
  preset('classic', '經典動畫', '俐落色塊與清晰輪廓，冒險與戰鬥都耐看。',
    ['#6a91cb', '#8ccdcc', '#f3d19b'],
    { ink: 0.78, inkBreak: 0.35, weather: 0.8 },
    { cutWidth: 0.8, shadowValue: 1, rim: 1, outline: 0.7 },
    { shadow: [1, 1.04, 1.06], high: [1, 1, 1], saturation: 1.12, exposure: 1.25, lift: 1, contrast: 0.12 }),
  preset('sky', '晴空物語', '通透藍綠與明亮暖光，讓山海與城市更有層次。',
    ['#4894de', '#63c6b6', '#ffe1a3'],
    { ink: 0.52, inkBreak: 0.3, shadowMech: 1.7, shadowEnv: 1.8, weather: 0.65, air: 0.9 },
    { cutWidth: 1.1, shadowValue: 1.08, rim: 1.15, outline: 0.45 },
    { shadow: [0.94, 1.12, 1.16], high: [1.04, 1.04, 0.96], saturation: 1.2, exposure: 1.45, lift: 1.1, contrast: 0.08 }),
  preset('soft', '柔光日常', '粉彩暖白與輕盈細線，柔和保留角色與景物細節。',
    ['#aaa4d4', '#e4b7c8', '#f4e4c4'],
    { ink: 0.32, inkBreak: 0.2, weather: 0.5, air: 0.7 },
    { cutWidth: 1.65, shadowValue: 1.18, rim: 0.65, outline: 0.28 },
    { shadow: [1.16, 1.06, 1.12], high: [1.06, 1.02, 1.08], saturation: 0.74, exposure: 1.6, lift: 1.6, contrast: -0.3 }),
  preset('bold', '熱血漫畫', '強烈明暗與鮮明墨線，機甲與交戰場面更有張力。',
    ['#455596', '#d96b61', '#ffd072'],
    { ink: 1.05, inkBreak: 0.6, shadowMech: 2, shadowEnv: 1.7, weather: 0.9, air: 0.35 },
    { cutWidth: 0.5, shadowValue: 0.9, rim: 1.2, outline: 0.9 },
    { shadow: [1.04, 0.96, 1.08], high: [1.08, 1.02, 0.92], saturation: 1.28, exposure: 1.16, lift: 0.85, contrast: 0.45 }),
  preset('cinema', '黃昏電影', '琥珀亮部與青紫暗面，日夜都有電影般的冷暖層次。',
    ['#6779a4', '#c78797', '#f0bc79'],
    { ink: 0.48, inkBreak: 0.4, shadowMech: 1.9, shadowEnv: 2, weather: 0.7, air: 0.8 },
    { cutWidth: 0.95, shadowValue: 1.02, rim: 1.1, outline: 0.4 },
    { shadow: [1.1, 1.02, 1.18], high: [1.18, 1.06, 0.84], saturation: 1, exposure: 1.3, lift: 1, contrast: 0.22 }),
  preset('neon', '霓虹夜色', '青藍陰影與洋紅亮色，雨夜、窗光與能量特效更耀眼。',
    ['#4883cf', '#52ced5', '#e285c8'],
    { ink: 0.62, inkBreak: 0.25, shadowMech: 2.5, shadowEnv: 2.3, weather: 0.7, air: 0.65 },
    { cutWidth: 0.7, shadowValue: 0.95, rim: 1.3, outline: 0.5 },
    { shadow: [0.84, 1.1, 1.28], high: [1.16, 0.92, 1.2], saturation: 1.25, exposure: 1.25, lift: 0.8, contrast: 0.25 }),
]);
export const DEFAULT_VISUAL_PRESET = VISUAL_PRESETS[0].id;
export const VISUAL_PREVIEW_ENVIRONMENTS = Object.freeze([
  { id: 'day', label: '晴日', time: 'day', weather: 'clear' },
  { id: 'dusk', label: '黃昏', time: 'dusk', weather: 'clear' },
  { id: 'night', label: '夜景', time: 'night', weather: 'clear' },
  { id: 'rain', label: '雨景', time: 'day', weather: 'heavy_rain' },
  { id: 'snow', label: '雪景', season: 'winter', time: 'day', weather: 'snow' },
  { id: 'fog', label: '霧景', time: 'day', weather: 'fog' },
].map(Object.freeze));
const presetById = (id) => VISUAL_PRESETS.find((p) => p.id === id) || VISUAL_PRESETS[0];
let _presetId = DEFAULT_VISUAL_PRESET;
const _vals = {};
const _subs = new Set();

function clamp(k, v) {
  const d = VISUAL_KNOBS[k];
  if (!Object.hasOwn(VISUAL_KNOBS, k)) return 0;
  // 互斥選項:名單外的值一律退回預設(手改 localStorage / 舊版遺留的鍵不得穿過去)
  if (d.choices) return d.choices.includes(v) ? v : d.def;
  const n = Number(v);
  if (!Number.isFinite(n)) return d.def;
  return Math.min(d.max, Math.max(d.min, n));
}

// 載入:整份讀進來後逐項夾制。壞掉的鍵/超界的值一律退回預設(原則 6 寧缺勿錯)——
// 手改 localStorage 或舊版遺留的鍵不該讓畫面變成無法解釋的樣子。
{
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* 私密模式 / 壞字串 */ }
  const savedPreset = raw && typeof raw === 'object' && VISUAL_PRESETS.some((p) => p.id === raw.preset);
  _presetId = savedPreset ? raw.preset : DEFAULT_VISUAL_PRESET;
  const selected = presetById(_presetId);
  for (const k in VISUAL_KNOBS) {
    // Derive render values from the catalog on every load so preset tuning reaches existing players.
    const v = k === 'worldTextLang' && raw && typeof raw === 'object' ? raw[k] : undefined;
    _vals[k] = v === undefined ? selected.values[k] : clamp(k, v);
  }
}

export function visualPreset() { return presetById(_presetId); }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ preset: _presetId, worldTextLang: _vals.worldTextLang })); } catch { /* Storage is optional. */ }
}

/** Keep non-art preferences independent of style selection. */
export function setVisualPreset(id) {
  const selected = presetById(id);
  let changed = _presetId !== selected.id;
  _presetId = selected.id;
  for (const [k, v] of Object.entries(selected.values)) {
    if (k === 'worldTextLang') continue;
    if (_vals[k] !== v) { _vals[k] = v; changed = true; }
  }
  if (changed) { save(); _emit(); }
  return selected.id;
}

/** 目前值(恆在 [min, max] 內) */
export function visualPref(k) {
  return Object.hasOwn(_vals, k) ? _vals[k] : 0;
}

/** 整份目前值(消費端一次套用用;回傳新物件,MUST NOT 就地改) */
export function visualPrefs() {
  return { ..._vals };
}

/** Internal renderer overrides last for this session; signage language remains persistent. */
export function setVisualPref(k, v) {
  if (!Object.hasOwn(VISUAL_KNOBS, k)) return 0;
  const nv = clamp(k, v);
  if (nv === _vals[k]) return nv;
  _vals[k] = nv;
  save();
  _emit();
  return nv;
}

/** 全部回到交付預設 */
export function resetVisualPrefs() {
  setVisualPreset(DEFAULT_VISUAL_PRESET);
}

/** The reset button reflects the curated default, excluding independent signage language. */
export function visualPrefsDefault() {
  return _presetId === DEFAULT_VISUAL_PRESET
    && Object.entries(VISUAL_PRESETS[0].values).every(([k, v]) => k === 'worldTextLang' || _vals[k] === v);
}

/** 訂閱變更;回傳解訂閱函式(消費端 dispose 時 MUST 呼叫,否則舊材質被舊 closure 抓著) */
export function onVisualChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function _emit() {
  const snapshot = Object.freeze(visualPrefs());
  for (const fn of [..._subs]) {
    // 一個消費端炸掉不可以讓其餘的收不到(拉桿只會表現成「有些東西沒跟著變」)
    try { fn(snapshot); } catch { /* 消費端自己的問題,不阻斷廣播 */ }
  }
}
