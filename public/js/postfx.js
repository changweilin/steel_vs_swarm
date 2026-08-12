// ============ 賽璐璐後製管線(螢幕空間勾線 → 調色 → FXAA)============
// 2026-08-03。在此之前畫面上的描邊**只有反轉外殼**,而 `biomes.js` 一次都沒有呼叫
// `outlinify` ⇒ 機體有黑線、世界沒有,機體看起來像貼在照片上的貼紙。
// 用外殼把整個世界包起來不可行:那是幾百個額外 draw call,而本渲染器已經是 draw call 瓶頸。
// 螢幕空間勾線是**一個 pass 蓋全場**,成本與場景複雜度無關。
//
// ---- 勾線為什麼是深度的「二階差分」而不是一階 ----
// 一階差分(相鄰深度相減)在**掠射面**上恆為大值 —— 地面往遠處延伸時每個像素的深度都在
// 快速變化,結果整片地面刷滿線。二階差分量的是深度的**曲率**:平面(不論多斜)恆為 0,
// 只有真正的折邊才有值。這是「地面不該有線、屋角該有線」唯一分得開的判據。
// 凸邊(物體輪廓)給全強度、凹邊(牆角內側)乘 CONCAVE_F —— 手繪的內角線本來就比外輪廓輕。
//
// ---- 三個一定要有的細節 ----
//   ① 墨色 MUST 與底色相混而不是塗黑:純黑線疊在暗部上會糊成一塊。
//   ② 遠處淡出:遠景的線密到一定程度就變成雜訊(而且會蓋掉霧)。
//   ③ 天空早退:天空的深度是 far,不early-out 的話整條天際線會被畫成一條粗黑邊。
//
// ---- 軟性物質的細線(2026-08-04;契約寫在 `toon.js` 的「軟性物質」段)----
// 使用者定案「雲朵/芒草/草原/花園/樹葉/旗幟這些軟性的物質的線條會細得多,其他堅硬的
// 物體則依據設定的數值」。本 pass 是**螢幕空間**的,天生不認識「這個像素是什麼東西」⇒
// 逐像素的通道只有一條:**場景 RT 的 alpha ≡ 這一格的勾線門檻倍率**(1 = 硬性 = 舊制)。
// 材質端怎麼寫進去、為什麼那個通道是空的,全部住 toon.js;本檔只負責讀它、乘進門檻。
// 「細」= 抬高門檻而不是縮小取樣半徑:半徑已經是 1 像素(`INK.THICK`,再小就斷線),
// 而 `|e|` 從邊緣往外遞減 ⇒ 門檻抬高,越過門檻的像素帶真的變窄(不是只變淡)。
//
// ---- 景深模糊(2026-08-09;距離與不變式住 `data.js DOF`)----
// 使用者定案「加入遠的物件隨距離景深模糊的效果」。四件事先講清楚,因為每一件寫反了都不報錯:
//   ① **這一 pass 是加成本的**。它不省效能(同日已向使用者說明);採用理由是畫面。
//      代價收在兩處:拉桿 0% 時**整個 pass 退出鏈**(不是跑一個乘 0 的 pass),
//      以及焦內像素在第一行就早退(只留 1 次深度 + 1 次顏色取樣)。
//   ② **順序 MUST 排在勾線之後**。勾線讀的是**深度**、畫的是線;先糊後勾 = 深度仍然銳利
//      ⇒ 在已經糊掉的色塊上畫出銳利的黑線(「糊掉的物件卻有清楚的輪廓」)。反過來排,
//      線本身跟著一起糊,遠景才真的退到背景去。
//   ③ **鄰居取樣 MUST 過焦外閘**(`step(coc*0.5, ct)`):不擋的話近處清晰物件的顏色會被抹進
//      遠景 = 前景剪影外一圈光暈,而剪影正是玩家在看的東西(FPV 的座艙/武器占畫面很大一塊)。
//   ④ 取樣點是**黃金角螺旋**(填滿圓盤)不是單一圓環:圓環在低取樣數下會糊成甜甜圈邊。
//
// ---- A25 GPU 生命週期 ----
// 這支持有 3 個 RenderTarget + 1 張 depthTexture + 4 個 FullScreenQuad 材質,
// **全部** MUST 在 `dispose()` 釋放。`audit_gpu_lifecycle.mjs` ⑦ 逐項釘住。
//
// ---- RES_GOV 交互(最容易靜默壞掉的一條)----
// RT 尺寸 MUST 由 `renderer.getDrawingBufferSize()` 取得 —— 那已經是
// `_dpr() × _resScale` 的結果。管線自己算像素比 = 調節器降階時 RT 尺寸不動 =
// **調節器整個變成 no-op**,而畫面上只表現成「手機還是一樣卡」,不會有任何錯誤。
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { visualPref, onVisualChange } from './visualPrefs.js';
import { DOF } from './data.js';

// ---- 勾線資訊緩衝(2026-08-12;材質端的契約住 `toon.js` 的同名段)----
// 第二張附件帶著**視空間法線與 surfaceId**,補上深度看不見的那些線(牆腳與地面、退縮平台的
// 轉折、機體零件的接縫)。實測(shibuya 實景 640×360):上墨像素 7173 → 16243,**2.26 倍**。
//
// 三條:
//   ① **哨兵**:`.a = 0` 代表這一格沒有法線資訊(天空穹頂、護盾殼、粒子、招牌都不寫)。
//      把 0 當法線用就是沿天際線與每一團特效畫粗黑邊。
//   ② 哨兵靠**把第二張單獨清成 0** 成立:`renderer.clear()` 拿 renderer 的 clearColor 清
//      **每一張**附件,而那個顏色不是 0 ⇒ MUST 另外 `clearBufferfv(COLOR, 1, [0,0,0,0])`。
//   ③ 拿不到 MRT(WebGL1)或開關關著 ⇒ 整組退回深度那一份,**逐位元**同這批改動之前。
const INK_MRT = {
  NRM0: 0.05,        // 法線折邊起畫(相鄰兩格視空間法線 xy 的中央差分長度)
  NRM1: 0.42,        // 全強度。實測:同一塊平板 < 0.02、90° 折邊 ≈ 1.0
  ID: 0.55,          // id 不同(不同材質相接)給的強度 —— 比折邊輕,它只是「不同東西」
};
// ---- 勾線參數 ----
const INK = {
  THICK: 1.0,        // 取樣半徑(像素);> 1 會讓細線斷開
  // 門檻的兩項係數與起畫/全強度全部是 **2026-08-03 用 `tools/shot_scene.mjs` 逐輪實測**出來的
  // (定場照 + 除錯輸出把 e 直接畫成紅色通道),不是猜的;調校紀錄見下方 shader 內註解。
  K_D: 0.020,        // 門檻的「距離項」係數(× 該像素深度)—— 遠近一致的那一半
  K_S: 3.0,          // 門檻的「掠射項」係數(× 一階差分)—— 壓掉高度場的網格折邊
  EDGE0: 0.14,       // 起畫(實測:地形網格折邊 e ≈ 0.1、建物輪廓 e ≈ 0.4~1.2)
  EDGE1: 0.36,       // 全強度
  CONCAVE_F: 0.42,   // 凹邊強度倍率(手繪內角線比外輪廓輕)
  DARK: 0.14,        // 墨色(與底色相混的目標值,不是純黑)
  FADE0: 0.55,       // 開始淡出的深度(相機 far 的比例)
  FADE1: 0.95,       // 完全不畫線
};
// ---- 調色(split-tone + 陰影抬升)----
// 賽璐璐的陰影 MUST 是**有顏色的**,不是壓黑的。`uLift` 把最暗的部分抬離 0,
// split-tone 讓暗部偏冷、亮部偏暖 —— 這與 toon.js 的 `CEL_COOL` 是同一個需求的兩個尺度
// (那個逐材質、這個逐畫面),兩者相加才是完整的「陰影是天光反射」。
const GRADE = {
  LIFT: 0.0055,
  SHADOW: [0.86, 0.94, 1.10],
  HIGH: [1.05, 1.01, 0.94],
  SAT: 1.06,
};
// ---- 空氣透視(雙色霧)----
// three 的 `Fog` 只有**一個**顏色:近處與地平線同色 ⇒ 霧讀起來像一層均勻的灰玻璃。
// 兩色霧 = 近端帶當下的日照色、遠端收斂到地平線色(顏色的推導住 `environment.js
// nearFogColor`,強度是 visualPrefs 的 `air` 拉桿)。
//
// **為什麼做在後製而不是材質**:兩色霧要改的是 three 的 `fog_fragment` chunk,而那需要每個
// 材質多一個 uniform —— 內建材質的 uniform 是逐 program 從 `ShaderLib` **clone** 出來的,
// 沒有任何入口能餵一份共享的顏色進去。把它挪到後製之後,材質端一行都不用動。
//
// **這是恆等式不是近似**。材質端已經算完 `out0 = mix(色, 遠端色, f)`,而我們要的是
// `mix(色, mix(近端色, 遠端色, s), f)`,兩者相減 ⇒ `out = out0 + f·(1−s)·(近端色 − 遠端色)`。
// 後製只要用**同一份** near/far 重算 f 就能精確補回那個差額。
// 兩個推論(都是這一段成立的前提,不是巧合):
//   ① f → 1 時 s → 1 ⇒ 補正歸零 ⇒ **「地平線 = 霧色」那條恆等式一格未動**(environment.js
//      的 skyStops 靠它讓遠景融進天空)。
//   ② 天空穹頂 `fog: false` 且深度在遠平面 ⇒ f = 1 ⇒ 一樣補 0,天空不會被染色。
//      (仍留著遠平面早退:那是省一次取樣,不是靠它才對。)
const AIR = {
  // 交接點:像素霧到這個程度時,近端色已經完全讓位給地平線色。abeto 那支叫 `uFogDistance`,
  // 同一個形狀(`smoothstep(0, KNEE, f)`)。太大 ⇒ 近端色一路撐到地平線,與 ① 打架。
  KNEE: 0.65,
};
// ---- 3D LUT 調色(2026-08-12)----
// `GRADE` 那四個常數是**寫死在 commit 裡的美術方向**:改一次就換掉所有人的畫面,而且只能
// 用「乘一個係數」表達得出來的東西。LUT 把整條色彩映射變成一張圖 —— 分區調色、色相旋轉、
// 膠片曲線這些用常數寫不出來的東西,都變成美術可以在外部工具裡調完丟進來的資產。
//
// **兩個來源**(2026-08-12 使用者定案「可設定 2 或 3」):
//   ㋐ `baked` —— 由現行 `GRADE` 的數學**程序生成**一張條狀圖。它不是為了改變畫面(那一段
//      數學一模一樣),而是給美術一個「與現況等價的起點」可以匯出去改。
//   ㋑ `file` —— 讀 `assets/lut.png`(標準條狀 LUT:寬 = size²、高 = size)。**檔案不存在
//      就靜靜地不套**(原則 6):出貨版沒有這張圖 ⇒ 畫面逐位元同今天。
//
// **格式刻意是 2D 條狀而不是 `sampler3D`**:①外部工具(Photoshop / Resolve / Lightroom)
// 匯出的就是這個格式,`Data3DTexture` 還得先在瀏覽器裡拆一次;②GLSL1 就寫得出來,不必為了
// 它把整支 shader 綁上 WebGL2 —— 而「綁上 WebGL2」正是同一輪 MRT 勾線踩到的那顆地雷。
const LUT = {
  // 程序生成的邊長(條狀圖 1024×32)。**2026-08-12 兩種都量過**:`none` vs `baked` 的
  // 逐像素差 32³ 是 mean 1.28 / max 29(滿分 765)、64³ 是 mean 1.16 / max 29 ——
  // 也就是說**加大格子救不了那個 max**(它來自勾線邊緣那種一格之差的取樣跳動,不是格子太粗),
  // 而貼圖會變成 4096×64(4 倍記憶體)。取 32。
  SIZE: 32,
  // 相鄰兩片之間 MUST 手動內插:硬體只在**片內**做雙線性,片與片之間是不連續的
  // ⇒ 不內插的話漸層上會出現與片數等距的橫向色帶(32 條),而那看起來像「LUT 做壞了」。
};

const QUAD_VS = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/**
 * 圓盤取樣點(黃金角螺旋 = 向日葵排列):`a = i × 137.5°`、`r = √((i+0.5)/n)`。
 * √ 是**面積均勻**的來源(不開根號會全部擠在圓心);單一圓環則在低取樣數下糊成甜甜圈邊。
 * 展開成一串具名運算式而不是 GLSL 迴圈 + const 陣列:WebGL1 的 GLSL ES 1.00 沒有陣列
 * 建構式,而這一層本來就該完全展開。
 */
const dofTaps = (n) => Array.from({ length: n }, (_, i) => {
  const a = i * 2.39996323, r = Math.sqrt((i + 0.5) / n);
  return `TAP( ${(Math.cos(a) * r).toFixed(4)}, ${(Math.sin(a) * r).toFixed(4)} )`;
}).join('\n          ');

/** 線性 → sRGB(RT 是 NoColorSpace,最後一 pass 自己轉;three 只對預設 framebuffer 轉) */
const SRGB_GLSL = `
  vec3 toSRGB( vec3 c ) {
    c = clamp( c, 0.0, 1.0 );
    return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) );
  }`;

/**
 * 把現行 `GRADE` 那一段數學**程序生成**成一張條狀 LUT(寬 = size²、高 = size)。
 * 用途不是改變畫面(數學一模一樣),而是給美術「與現況等價的起點」—— 在設定頁切到
 * 「內建(程序生成)」看到的就該與「不使用」幾乎一樣,差的只有量化;把它另存下來丟進
 * Photoshop / Resolve 調完再換成 `assets/lut.png`,就是完整的第 ㋑ 條路。
 *
 * **表是 sRGB 進 sRGB 出**(與 shader 的索引空間同一套,見 `lutApply` ①)。
 * 這裡的數學 MUST 與 shader 那一段逐項相同 —— 兩份會分家,而症狀是「切到內建之後畫面
 * 微妙地不一樣」,沒有人查得出來為什麼。故兩邊都只寫一次 `GRADE` 的四個常數。
 */
export function makeGradeLut(size = LUT.SIZE) {
  const cv = document.createElement('canvas');
  cv.width = size * size; cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: false });
  const img = ctx.createImageData(cv.width, cv.height);
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toS = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const c = [toLin(r / (size - 1)), toLin(g / (size - 1)), toLin(b / (size - 1))];
        const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        const t = smooth(0.18, 0.72, l);
        for (let i = 0; i < 3; i++) {
          c[i] *= GRADE.SHADOW[i] + (GRADE.HIGH[i] - GRADE.SHADOW[i]) * t;
          c[i] = l + (c[i] - l) * GRADE.SAT;
          c[i] = c[i] * (1 - GRADE.LIFT) + GRADE.LIFT;
        }
        const px = ((g * cv.width) + b * size + r) * 4;
        img.data[px] = Math.round(Math.min(1, Math.max(0, toS(c[0]))) * 255);
        img.data[px + 1] = Math.round(Math.min(1, Math.max(0, toS(c[1]))) * 255);
        img.data[px + 2] = Math.round(Math.min(1, Math.max(0, toS(c[2]))) * 255);
        img.data[px + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class Pipeline {
  /**
   * @param renderer three 的 WebGLRenderer(像素比由呼叫端管,見檔頭 RES_GOV 註解)
   * @param opts { ink, grade, fxaa, lowPower } —— 全部可關;lowPower 走 8bit RT
   */
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = {
      ink: opts.ink !== false, dof: opts.dof !== false,
      grade: opts.grade !== false, fxaa: opts.fxaa !== false,
    };
    // 半浮點 RT 在 tile GPU 上是**頻寬**成本(與 game.js 關 MSAA 同一個瓶頸)⇒ 低功耗走 8bit。
    // 8bit 線性緩衝在暗部會有輕微色帶,但那遠比掉幀好。
    this._rtType = opts.lowPower ? THREE.UnsignedByteType : THREE.HalfFloatType;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this._size = size.clone();
    // 勾線資訊緩衝的能力閘:three 0.160 的 MRT 是 `WebGLMultipleRenderTargets`
    //(`WebGLRenderTarget({ count })` 是 r162 之後才有的),而它只在 WebGL2 上成立。
    // **能力與開關分開記**:開關可以即時切,能力不會變。
    this._mrtCap = renderer.capabilities.isWebGL2 === true
      && typeof THREE.WebGLMultipleRenderTargets === 'function';
    this._mrt = this._mrtCap && visualPref('inkMrt') === 'on';
    this.rtScene = this._mkRT(true);
    this.rtA = this._mkRT(false);
    this.rtB = this._mkRT(false);

    this.inkQuad = new FullScreenQuad(this._inkMaterial());
    // 取樣數折半走與 8bit RT 同一條降級規則(tile GPU 的瓶頸是頻寬,而這一 pass 對焦外
    // 的每個像素都是 1 + n 次取樣)。展開在 shader 原始碼裡 ⇒ 兩者是不同的程式,不是分支。
    this.dofQuad = new FullScreenQuad(this._dofMaterial(opts.lowPower ? Math.max(2, DOF.TAPS >> 1) : DOF.TAPS));
    this.gradeQuad = new FullScreenQuad(this._gradeMaterial());
    this.fxaaQuad = new FullScreenQuad(this._fxaaMaterial());
    this._quads = { ink: this.inkQuad, dof: this.dofQuad, grade: this.gradeQuad, fxaa: this.fxaaQuad };
    // 景深的兩個轉折點由呼叫端餵(`setDof`)。**沒餵過就不掛這一 pass** —— 猜一個距離的話
    // 就是「某個消費端的遠景莫名其妙糊掉」,而預設不生效才是寧缺勿錯(原則 6)。
    this._dofRange = null;
    // 進鏡程度(0~1)。**預設 1 = 不做狙擊閘**:那是戰場才有的概念,設定頁樣品與定場鏡頭組
    // 沒有「瞄準」這回事,預設 0 的話它們會靜靜地什麼都不糊 = 拉桿與定場照都看不到這一層。
    this._dofBlend = 1;
    // 空氣透視:同 `_dofRange` 的寧缺勿錯 —— 呼叫端沒餵過顏色與距離就恆不生效
    this._airOn = false;
    this._airA = 0;
    // 3D LUT:同樣的寧缺勿錯 —— 呼叫端沒餵過就恆不生效
    this._lutOn = false;
    this._lutA = 0;
    this._lutOwned = null;   // 由本管線生成的那一張(程序生成路徑),dispose() 要收

    // 勾線強度拉桿(visualPrefs.js):線的濃淡是**口味**,不同螢幕看起來差很多 ——
    // 給一個 uniform 讓玩家自己定案,而不是把某一台螢幕上調出來的數字寫死給所有人。
    // 拉到 0 = 沒有線(等同 `?ink=0`,但不必重開);預設 1 = 定場照調校出來的現值。
    // MUST 是 uniform 不是重建材質:重建會在拉桿拖動時每一格丟一次 shader 編譯。
    this._syncPrefs = () => {
      this.inkQuad.material.uniforms.uInk.value = visualPref('ink');
      // 景深強度同理走 uniform;但**拉到 0 時整個 pass 退出鏈**(見 render 組 chain 那一段)
      // —— 這一 pass 與勾線不同,它是後加的成本,0% MUST 是「不跑」而不是「跑一個乘 0 的」。
      this._dofA = DOF.MAX_R * visualPref('dof');
      this._pushDofA();
      // 空氣透視走一般 uniform(不退出鏈):它與勾線同層 —— grade pass 本來就每幀跑,
      // 0% 只是讓 shader 裡那一段分支跳過,沒有「省一個 pass」可言。
      this._airA = visualPref('air');
      this._pushAirA();
      this._lutA = visualPref('lut');
      this._pushLutA();
      this._syncLutSrc();
      this._syncMrt();
    };
    this._syncPrefs();
    this._offPrefs = onVisualChange(this._syncPrefs);
  }

  /**
   * RenderTarget 的**唯一建構點**(A25:三張 RT + depthTexture 都要能被 dispose 找到)。
   * `depth` 那一張在開關打開時是**兩張附件**(第 1 張 = 勾線資訊緩衝)。
   */
  _mkRT(depth) {
    const w = Math.max(1, this._size.x), h = Math.max(1, this._size.y);
    const opt = {
      type: this._rtType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    };
    const rt = depth && this._mrt
      ? new THREE.WebGLMultipleRenderTargets(w, h, 2, opt)
      : new THREE.WebGLRenderTarget(w, h, opt);
    if (depth) {
      rt.depthTexture = new THREE.DepthTexture(w, h);
      rt.depthTexture.type = THREE.UnsignedIntType;
    }
    return rt;
  }

  /**
   * 勾線資訊緩衝開關的**即時切換**(設定頁 `inkMrt`)。
   * **場景材質恆寫第二張**(見 toon.js 的材質契約:宣告在單附件上也合法)⇒ 切開關只需要
   * 重建場景 RT 與勾線材質,**不必重編譯任何場景材質** —— 那正是「無條件宣告」換來的東西。
   */
  _syncMrt() {
    const want = this._mrtCap && visualPref('inkMrt') === 'on';
    if (want === this._mrt) return;
    this._mrt = want;
    this.rtScene.depthTexture?.dispose();
    this.rtScene.dispose();
    this.rtScene = this._mkRT(true);
    this.inkQuad.material.dispose();          // 著色器把 mrt 編進去了,MUST 重建
    this.inkQuad.material = this._inkMaterial();
  }

  /**
   * 景深的兩個轉折點(公尺;`near` = 開始糊、`far` = 全糊)。**唯一寫入點** ——
   * 戰場與定場鏡頭組餵 `data.js dofNearM()/dofFarM()`(由全場最遠交戰距離推導,456 / 608m)、
   * 設定頁樣品餵它自己那個 24m 場景的尺度 —— **兩軌同 `toon.js _rampTint` 的 mech/env:
   * 同一套規則、兩組尺度**。沒有這一支的話樣品那 24m 全部落在 456m 的焦內帶裡 = 拉桿拉了
   * 看不出差異,而那正是陰影偏色與風化密度各踩過一次的同一個坑。
   */
  setDof(near, far) {
    if (!(near >= 0) || !(far > near)) { this._dofRange = null; return; }
    this._dofRange = [near, far];
    const u = this.dofQuad.material.uniforms;
    u.uDofNear.value = near;
    u.uDofFar.value = far;
  }

  /**
   * 進鏡程度 0~1(2026-08-09 使用者補充「遠景景深模糊只有在狙擊模式」)。**逐幀呼叫** ——
   * 值由 `data.js dofAimBlend` 自當下 fov 反解,本檔 MUST NOT 自己判 `aiming` 或自己跑淡入
   * (那就是第二條時間曲線,模糊會比鏡頭慢半拍)。0 ⇒ 整個 pass 退出鏈 ⇒ 一般視角的成本
   * 逐位元回到這批改動之前,而這也是這一層真正便宜的地方:它只在進鏡那幾秒跑。
   */
  setDofBlend(f) {
    const v = Math.max(0, Math.min(1, f || 0));
    if (v === this._dofBlend) return;      // 逐幀呼叫 ⇒ 沒變就不要碰 uniform
    this._dofBlend = v;
    this._pushDofA();
  }

  /** `uDofA` 的**唯一寫入點**:拉桿強度 × 進鏡程度。兩個來源各寫一次 = 後寫的把前一個蓋掉 */
  _pushDofA() {
    this.dofQuad.material.uniforms.uDofA.value = this._dofA * this._dofBlend;
  }

  /**
   * 空氣透視的兩個顏色與 `scene.fog` 的兩段距離(檔頭 AIR)。**唯一寫入點** ——
   * 戰場餵 `environment.js` 回傳的 `air`(顏色由 TIMES/SEASONS/WEATHERS 推導),
   * 樣品餵它自己那個場景的尺度。**沒餵過就不生效**(同 `setDof` 的寧缺勿錯):
   * 猜一組距離的結果是「某個消費端的遠景莫名其妙變色」。
   *
   * `fogNear`/`fogFar` MUST 與 `scene.fog` 逐位元相同 —— 那是恆等式成立的前提(檔頭)。
   */
  setAirFog(nearC, farC, fogNear, fogFar) {
    if (!nearC || !farC || !(fogFar > fogNear)) { this._airOn = false; this._pushAirA(); return; }
    const u = this.gradeQuad.material.uniforms;
    u.uAirNear.value.copy(nearC);
    u.uAirFar.value.copy(farC);
    u.uFogN.value = fogNear;
    u.uFogF.value = fogFar;
    this._airOn = true;
    this._pushAirA();
  }

  /** `uAirA` 的**唯一寫入點**:拉桿強度 × 有沒有餵過距離 */
  _pushAirA() {
    this.gradeQuad.material.uniforms.uAirA.value = this._airOn ? this._airA : 0;
  }

  /**
   * 3D LUT(檔頭 LUT)。**唯一寫入點**;`tex = null` ⇒ 不套(拉桿再怎麼拉都不生效)。
   * `size` 是立方體邊長,**MUST 與圖寬相符**(寬 = size² × 高 = size)—— 對不上的話取樣會
   * 整片位移,而畫面上表現成「顏色怪怪的」而不是任何錯誤。
   * 貼圖狀態三條,每一條寫錯都不報錯:
   *   ① **`flipY = false`**。three 對貼圖預設 `flipY = true`(那是給照片的慣例),而 LUT 的
   *      第 g 列就是綠色索引 g —— 翻過來等於**綠色軸整條反過來查**,畫面會整片變色而
   *      看起來像「這張 LUT 做壞了」。2026-08-12 實測:漏掉它 mean Δ = 173/765。
   *   ② **LinearFilter**:R/G 兩軸的內插交給硬體(藍軸由 `lutApply` 手動做)。半個 texel 的
   *      內縮保證取樣點不會越過每一片最外側的 texel 中心 ⇒ 不會吃到鄰片。
   *   ③ **NoColorSpace**:這是查表資料不是照片,three MUST NOT 再幫它做一次 sRGB → linear
   *      (`lutApply` 自己在 sRGB 空間索引、出來才轉線性)。
   */
  setLut(tex, size = LUT.SIZE) {
    const u = this.gradeQuad.material.uniforms;
    if (this._lutOwned && this._lutOwned !== tex) { this._lutOwned.dispose(); this._lutOwned = null; }
    if (tex) {
      tex.flipY = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      u.uLutSize.value.set(size, 1 / size);
    }
    u.tLut.value = tex || null;
    this._lutOn = !!tex;
    this._pushLutA();
  }

  /** `uLutA` 的**唯一寫入點**:拉桿強度 × 有沒有餵過 LUT */
  _pushLutA() {
    this.gradeQuad.material.uniforms.uLutA.value = this._lutOn ? this._lutA : 0;
  }

  /**
   * LUT 來源(設定頁的三選一;2026-08-12 使用者定案「可設定 2 或 3」)。
   * `none` = 不套(預設,逐位元同舊制)/ `baked` = 程序生成 / `file` = `assets/lut.png`。
   * 讀檔失敗一律**靜靜地退回不套**(原則 6):出貨版本來就沒有那張圖。
   */
  _syncLutSrc() {
    const src = visualPref('lutSrc');
    if (src === this._lutSrc) return;      // 拉桿廣播是整份送的,沒換來源就不要重建貼圖
    this._lutSrc = src;
    if (src === 'baked') {
      const tex = makeGradeLut(LUT.SIZE);
      this._lutOwned = tex;
      this.setLut(tex, LUT.SIZE);
    } else if (src === 'file') {
      new THREE.TextureLoader().load(
        `${document.baseURI.replace(/[^/]*$/, '')}assets/lut.png`,
        (tex) => {
          // 非同步:回來時來源可能已經被切走(或整支已 dispose)⇒ 回來再確認一次
          if (this._lutSrc !== 'file' || !this.gradeQuad) { tex.dispose(); return; }
          this._lutOwned = tex;
          this.setLut(tex, tex.image?.height || LUT.SIZE);
        },
        undefined,
        () => { if (this._lutSrc === 'file') this.setLut(null); },
      );
      this.setLut(null);                   // 載入完成前先不套
    } else {
      this.setLut(null);
    }
  }

  _inkMaterial() {
    const mrt = this._mrt;
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tInfo: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 }, uFar: { value: 1000 }, uInk: { value: 1 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uInk;
        varying vec2 vUv;
        ${mrt ? 'uniform sampler2D tInfo;' : ''}
        float lin( vec2 uv ) {                     // 非線性深度 → 視線距離(公尺)
          float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
          return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
        }
        void main() {
          vec4 base = texture2D( tColor, vUv );
          float d = lin( vUv );
          // ③ 天空早退:天空的深度就是 far,不擋掉會沿整條天際線畫出一條粗黑邊
          if ( d >= uFar * 0.995 ) { gl_FragColor = base; return; }
          vec2 t = uTexel * ${INK.THICK.toFixed(2)};
          float l = lin( vUv - vec2( t.x, 0.0 ) ), r = lin( vUv + vec2( t.x, 0.0 ) );
          float u = lin( vUv + vec2( 0.0, t.y ) ), b = lin( vUv - vec2( 0.0, t.y ) );
          // 二階差分(拉普拉斯):平面恆 0 —— 掠射的地面不會刷滿線(見檔頭)
          float lap = ( l + r + u + b ) - 4.0 * d;
          // 門檻 = **距離項 + 掠射項**,兩項缺一不可(2026-08-03 定場照四輪實測):
          //   ・只有距離項(lap/d):地形是高度場、由 193² 個平三角面拼成,每一條網格折邊
          //     都是**真的**折邊 ⇒ 整片山坡畫滿等高線一樣的細線;把門檻拉高到山坡乾淨時,
          //     300m 外的建物輪廓(深度跳變只有 20m)也一起不見了 —— 兩者在 lap/d 上重疊。
          //   ・只有掠射項(lap 除以一階差分,相對曲率):重疊在 0.3~0.7,同樣是「山坡乾淨了、
          //     建物的線也沒了」(第二版實測,整個世界回到沒有描邊)。
          //   ・兩項相加才分得開:掠射的地面**一階差分極大**(每像素跑好幾公尺)⇒ 門檻自動抬高;
          //     建物輪廓的一階差分只有那一格跳變 ⇒ 門檻仍低,線畫得出來。
          float slope = abs( l - r ) + abs( u - b );
          float e = lap / max( 0.001, d * ${INK.K_D.toFixed(3)} + slope * ${INK.K_S.toFixed(1)} );
          // 門檻 MUST 吃 **|e| 本身**,凸/凹的強度差要**乘在 smoothstep 之後**。
          // 反過來寫(先乘 CONCAVE_F 再進 smoothstep)= 把凹邊的門檻整個往上推 1/0.42 倍 ——
          // 而建物輪廓在這個 stencil 下大多算凹邊(近景像素旁邊是更遠的背景)⇒ 整批被吃掉:
          // 2026-08-03 定場照的除錯輸出裡,建物邊的 e 明明有 2 以上,ink 卻是 0。
          float ae = abs( e );
          ${mrt ? `
          // ---- 法線折邊 + 面 id(勾線資訊緩衝;見檔頭 INK_MRT)----
          // 五次取樣**排在早退之前**:這一項存在的理由就是「深度看不見的那些邊」,
          // 拿深度來決定要不要看它等於把它關掉。這是開關打開時要付的錢。
          vec4 i0 = texture2D( tInfo, vUv );
          vec4 il = texture2D( tInfo, vUv - vec2( t.x, 0.0 ) ), ir = texture2D( tInfo, vUv + vec2( t.x, 0.0 ) );
          vec4 iu = texture2D( tInfo, vUv + vec2( 0.0, t.y ) ), ib = texture2D( tInfo, vUv - vec2( 0.0, t.y ) );
          float mrtEdge = 0.0;
          // 五格都要有資訊(哨兵)。缺一格就當這裡沒有第二訊號 —— 交界那一圈交給深度那一份,
          // 而天空/特效/招牌整片都沒有資訊 ⇒ 它們一條新線都不會多出來。
          if ( min( min( i0.a, min( il.a, ir.a ) ), min( iu.a, ib.a ) ) > 0.5 ) {
            // 中央差分:與深度那一項用**同一組偏移**,兩種線才會落在同一排像素上
            float nrm = length( vec2( length( il.rg - ir.rg ), length( iu.rg - ib.rg ) ) );
            float idv = max( abs( il.b - ir.b ), abs( iu.b - ib.b ) );
            mrtEdge = max(
              smoothstep( ${INK_MRT.NRM0.toFixed(3)}, ${INK_MRT.NRM1.toFixed(3)}, nrm ),
              step( 0.004, idv ) * ${INK_MRT.ID.toFixed(2)} );
          }
          // 兩個訊號都跨不過門檻才早退
          if ( ae <= ${INK.EDGE0.toFixed(3)} && mrtEdge <= 0.0 ) { gl_FragColor = base; return; }` : `
          // 早退:軟性倍率 ∈ (0,1] ⇒ ae × soft ≤ ae,硬性門檻都跨不過的一定也跨不過。
          // 絕大多數像素在這裡離開(邊緣偵測本來就只有少數像素有值)⇒ 下面那四個 alpha
          // 取樣只發生在「真的要畫線」的像素上,平均成本接近零。
          if ( ae <= ${INK.EDGE0.toFixed(3)} ) { gl_FragColor = base; return; }`}
          // 軟性倍率取**這一格與四鄰的最小值**:一條輪廓線同時落在物件側與背景側的像素上,
          // 只看中心的話背景側那半條仍是硬性粗細 ⇒ 葉叢邊緣會一半粗一半細。
          // 四鄰用的是與深度取樣**同一組偏移**(同一條線的兩側必定在其中)。
          float soft = min( min( base.a, texture2D( tColor, vUv - vec2( t.x, 0.0 ) ).a ),
                       min( min( texture2D( tColor, vUv + vec2( t.x, 0.0 ) ).a,
                                 texture2D( tColor, vUv + vec2( 0.0, t.y ) ).a ),
                                 texture2D( tColor, vUv - vec2( 0.0, t.y ) ).a ) );
          soft = clamp( soft, 0.0, 1.0 );   // 硬性恆 1 ⇒ 這一行以下逐位元同舊制
          float ink = smoothstep( ${INK.EDGE0.toFixed(3)}, ${INK.EDGE1.toFixed(3)}, ae * soft );
          if ( e > 0.0 ) ink *= ${INK.CONCAVE_F.toFixed(2)};   // 凹邊(牆角內側)比外輪廓輕
          ${mrt ? `
          // 折邊/id 那一份**取 max 不是相加**:同一條輪廓線兩個訊號常常同時有值,相加會把
          // 建物邊界推成兩倍濃的實線。它一樣吃軟性倍率(葉叢的折邊也該是細線)。
          // 凹凸權重刻意**不套**在它身上:法線差分沒有凹凸的方向資訊,乘上去只是把折邊
          // 整批打 ${INK.CONCAVE_F.toFixed(2)} 折。
          ink = max( ink, mrtEdge * soft );` : ''}
          // ② 遠處淡出:遠景線密到變雜訊,而且會蓋掉霧
          ink *= 1.0 - smoothstep( uFar * ${INK.FADE0.toFixed(2)}, uFar * ${INK.FADE1.toFixed(2)}, d );
          // 強度拉桿:夾在 [0,1] —— 拉桿最大到 150% 是為了讓「線更濃」有得調,
          // 但覆蓋率本身是機率意義的權重,超過 1 只會把半透明的線推成實線,不會更黑。
          ink = clamp( ink * uInk, 0.0, 1.0 );
          // ① 墨色與底色相混,不是塗黑
          gl_FragColor = vec4( mix( base.rgb, base.rgb * ${INK.DARK.toFixed(2)}, ink ), base.a );
        }`,
    });
  }

  /**
   * 景深模糊(檔頭「景深模糊」那一段)。距離一律吃 `uDofNear`/`uDofFar`(公尺,由 `setDof`
   * 餵入)—— 本檔 MUST NOT 手寫任何公尺數:那兩個轉折點是 `data.js dofNearM/dofFarM` 由
   * 狙擊模式可視範圍推導的,寫死在著色器裡就與「這台機體看得多遠」分家了。
   * @param taps 圓盤取樣數(低功耗折半)
   */
  _dofMaterial(taps) {
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.5 }, uFar: { value: 1000 },
        uDofNear: { value: 1e9 }, uDofFar: { value: 2e9 }, uDofA: { value: 0 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar;
        uniform float uDofNear; uniform float uDofFar; uniform float uDofA;
        varying vec2 vUv;
        float lin( vec2 uv ) {                     // 非線性深度 → 視線距離(公尺),與勾線同式
          float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
          return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
        }
        void main() {
          vec4 base = texture2D( tColor, vUv );
          // 焦外程度 0~1。天空的深度就是 far ⇒ coc 恆為 1,**刻意不早退**:天空本來就在全糊帶
          // 裡,而它是平滑漸層 ⇒ 糊它看不出差別也幾乎沒有成本,特判反而會在天際線切出一條
          // 「糊的地面 / 清晰的天空」的硬邊(勾線那邊要早退是因為它畫的是**線**,不是同一件事)。
          float coc = smoothstep( uDofNear, uDofFar, lin( vUv ) );
          float rp = coc * uDofA / uTexel.y;       // 半徑(像素)= 焦外程度 × 螢幕高度比例
          // 焦內早退:半徑不到半個像素就沒有任何取樣意義。絕大多數交戰畫面落在這裡 ⇒
          // 這一 pass 的平均成本 = 一次深度 + 一次顏色取樣。
          if ( rp < 0.5 ) { gl_FragColor = base; return; }
          vec3 sum = base.rgb; float wsum = 1.0;
          // 焦外閘:只收「自己也在糊帶裡」的鄰居。不擋的話近處清晰物件會被抹進遠景 =
          // 前景剪影外一圈光暈(見檔頭 ③)。門檻取中心的一半 = 容許糊帶內的漸層互相混合。
          #define TAP(dx,dy) { vec2 o = vec2( dx, dy ) * rp * uTexel; \
            float w = step( coc * 0.5, smoothstep( uDofNear, uDofFar, lin( vUv + o ) ) ); \
            sum += texture2D( tColor, vUv + o ).rgb * w; wsum += w; }
          ${dofTaps(taps)}
          #undef TAP
          gl_FragColor = vec4( sum / wsum, base.a );
        }`,
    });
  }

  _gradeMaterial() {
    const g = GRADE;
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        // tDepth / uNear / uFar 由 render() 的共用接線自動餵(與勾線、景深同一段)
        tDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 1000 },
        uAirNear: { value: new THREE.Color(0, 0, 0) }, uAirFar: { value: new THREE.Color(0, 0, 0) },
        uFogN: { value: 0 }, uFogF: { value: 1 }, uAirA: { value: 0 },
        tLut: { value: null }, uLutA: { value: 0 }, uLutSize: { value: new THREE.Vector2(LUT.SIZE, 1 / LUT.SIZE) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform float uNear; uniform float uFar;
        uniform vec3 uAirNear; uniform vec3 uAirFar;
        uniform float uFogN; uniform float uFogF; uniform float uAirA;
        uniform sampler2D tLut; uniform float uLutA; uniform vec2 uLutSize;   // x = 邊長, y = 1/邊長
        varying vec2 vUv;
        ${SRGB_GLSL}
        vec3 toLinear( vec3 c ) {
          return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
        }
        /**
         * 條狀 LUT 取樣(寬 = size²、高 = size;第 i 片放在 [i·size, (i+1)·size) 那一段)。
         * 三條缺一不可:
         *   ① **索引在 sRGB 空間**。RT 是線性的,而 32³ 的格子攤在線性軸上 ⇒ 暗部只分到
         *      兩三格(人眼最敏感的那一段),漸層會出現色階;外部工具匯出的 LUT 也一律是
         *      顯示空間的表,直接拿線性值去查等於查錯地方。
         *   ② **兩片手動內插**:硬體只在片內做雙線性,片與片之間是不連續的 ⇒ 不內插的話
         *      漸層上會出現與片數等距的橫向色帶,而那看起來像「LUT 做壞了」。
         *   ③ **半個 texel 的內縮**不可省:少了它每一片的邊界會把鄰片的顏色吃進來。
         */
        vec3 lutApply( vec3 linC ) {
          vec3 c = toSRGB( clamp( linC, 0.0, 1.0 ) );
          float n = uLutSize.x, inv = uLutSize.y;
          float b = c.b * ( n - 1.0 );
          float b0 = floor( b ), b1 = min( b0 + 1.0, n - 1.0 );
          vec2 uv = vec2( ( c.r * ( n - 1.0 ) + 0.5 ) * inv * inv, ( c.g * ( n - 1.0 ) + 0.5 ) * inv );
          vec3 s0 = texture2D( tLut, vec2( uv.x + b0 * inv, uv.y ) ).rgb;
          vec3 s1 = texture2D( tLut, vec2( uv.x + b1 * inv, uv.y ) ).rgb;
          return toLinear( mix( s0, s1, b - b0 ) );
        }
        void main() {
          vec3 c = texture2D( tColor, vUv ).rgb;
          // 空氣透視:MUST 排在 split-tone **之前**(霧是場景裡的東西,調色是鏡頭上的東西;
          // 反過來排就變成「霧不吃調色」= 遠景的色偏與近景走兩套)。
          // uAirA = 0(拉桿預設)⇒ 整段跳過,連深度都不取樣 ⇒ 逐位元同舊制。
          if ( uAirA > 0.0 ) {
            float z = texture2D( tDepth, vUv ).x * 2.0 - 1.0;
            float d = ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
            // 遠平面(天空穹頂)早退:那裡 f = 1 ⇒ 補正本來就是 0,只是省一次算
            if ( d < uFar * 0.999 ) {
              float f = smoothstep( uFogN, uFogF, d );          // 與 three 的 linear fog 同式
              float s = smoothstep( 0.0, ${AIR.KNEE.toFixed(3)}, f );
              c += f * ( 1.0 - s ) * ( uAirNear - uAirFar ) * uAirA;
            }
          }
          // ---- 內建調色(split-tone + 抬升)----
          // **LUT 是取代它而不是疊在它上面**:兩者是同一件事的兩種寫法(一個用四個常數、
          // 一個用一張表),疊起來就是調兩次色 —— 而美術在外部工具裡調的時候看到的是原圖,
          // 不是已經被 split-tone 動過的圖,疊出來的結果與他在工具裡看到的不一樣。
          // 故 LUT 查的是 **調色前**的顏色,最後在兩者之間交叉淡入。
          vec3 pre = c;
          float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
          // split-tone:暗部偏冷、亮部偏暖(賽璐璐的陰影是有顏色的,不是壓黑的)
          vec3 sh = vec3( ${g.SHADOW.map((v) => v.toFixed(3)).join(', ')} );
          vec3 hi = vec3( ${g.HIGH.map((v) => v.toFixed(3)).join(', ')} );
          c *= mix( sh, hi, smoothstep( 0.18, 0.72, l ) );
          c = mix( vec3( l ), c, ${g.SAT.toFixed(3)} );      // 微幅提彩度
          // 陰影抬升:最暗不落到 0。**數值是線性空間的**,而畫面是 sRGB ——
          // 線性 0.045 經 sRGB 轉換會變成 0.23(整片暗部一口氣被洗成灰),2026-08-03 定場照實測。
          // 現值 0.0055 ≈ sRGB 0.06,才是「抬離全黑」而不是「把陰影拿掉」。
          c = c * ( 1.0 - ${g.LIFT.toFixed(4)} ) + ${g.LIFT.toFixed(4)};
          // uLutA = 0(沒餵過 LUT / 來源是 none / 拉桿歸零)⇒ 整段跳過,連取樣都不做
          // ⇒ 逐位元同舊制。
          if ( uLutA > 0.0 ) c = mix( c, lutApply( pre ), uLutA );
          gl_FragColor = vec4( c, 1.0 );
        }`,
    });
  }

  /**
   * FXAA。**MSAA 對 pass 畫出來的線一點用都沒有**(那些線不是幾何邊),所以勾線上線之後
   * 抗鋸齒的責任整個落在這裡;也因此觸控裝置第一次有了抗鋸齒(舊制 `antialias: !isTouchUI()`)。
   * 這一 pass 同時負責**線性 → sRGB**(RT 是 NoColorSpace,見 SRGB_GLSL)。
   */
  _fxaaMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uAA: { value: 1 } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor; uniform vec2 uTexel; uniform float uAA;
        varying vec2 vUv;
        ${SRGB_GLSL}
        float lum( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }
        void main() {
          vec3 m  = texture2D( tColor, vUv ).rgb;
          if ( uAA < 0.5 ) { gl_FragColor = vec4( toSRGB( m ), 1.0 ); return; }
          vec3 nw = texture2D( tColor, vUv + vec2( -uTexel.x, -uTexel.y ) ).rgb;
          vec3 ne = texture2D( tColor, vUv + vec2(  uTexel.x, -uTexel.y ) ).rgb;
          vec3 sw = texture2D( tColor, vUv + vec2( -uTexel.x,  uTexel.y ) ).rgb;
          vec3 se = texture2D( tColor, vUv + vec2(  uTexel.x,  uTexel.y ) ).rgb;
          float lm = lum( m ), lnw = lum( nw ), lne = lum( ne ), lsw = lum( sw ), lse = lum( se );
          float lo = min( lm, min( min( lnw, lne ), min( lsw, lse ) ) );
          float hi = max( lm, max( max( lnw, lne ), max( lsw, lse ) ) );
          if ( hi - lo < max( 0.03, hi * 0.125 ) ) { gl_FragColor = vec4( toSRGB( m ), 1.0 ); return; }
          vec2 dir = normalize( vec2( -( ( lnw + lne ) - ( lsw + lse ) ), ( lnw + lsw ) - ( lne + lse ) ) + 1e-6 );
          dir = clamp( dir, -8.0, 8.0 ) * uTexel;
          vec3 a = 0.5 * ( texture2D( tColor, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb
                         + texture2D( tColor, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
          vec3 b = a * 0.5 + 0.25 * ( texture2D( tColor, vUv - dir * 0.5 ).rgb
                                    + texture2D( tColor, vUv + dir * 0.5 ).rgb );
          float lb = lum( b );
          gl_FragColor = vec4( toSRGB( ( lb < lo || lb > hi ) ? a : b ), 1.0 );
        }`,
    });
  }

  /** 畫布尺寸或 `_resScale` 改變時呼叫;尺寸一律由 drawing buffer 取得(見檔頭) */
  setSize() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (s.x === this._size.x && s.y === this._size.y) return;
    this._size.copy(s);
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.setSize(Math.max(1, s.x), Math.max(1, s.y));
  }

  /** 取代 `renderer.render(scene, camera)`;結束時 render target 一律歸零(PiP 隨後直接畫在畫布上) */
  render() {
    const r = this.renderer;
    this.setSize();
    const texel = new THREE.Vector2(1 / this._size.x, 1 / this._size.y);
    const chain = [];
    if (this.enabled.ink) chain.push('ink');
    // 景深 MUST 排在勾線**之後**(檔頭 ②:先糊後勾 = 糊掉的色塊配上銳利的黑線)。
    // 四個關法任一成立就整個 pass 退出鏈,而不是跑一個沒有作用的 pass:`?dof=0` /
    // 呼叫端沒餵距離 / 拉桿 0% / **不在狙擊模式**(`_dofBlend = 0`,逐幀由呼叫端餵)。
    // 退出時輸出**逐位元**同這一批改動之前 —— 一般視角因此完全不付這一 pass 的錢。
    if (this.enabled.dof && this._dofRange && this._dofA * this._dofBlend > 0) chain.push('dof');
    if (this.enabled.grade) chain.push('grade');
    // 最後一 pass **一定要跑**:它同時負責線性 → sRGB。`?fxaa=0` 只是把邊緣混合關掉
    // (`uAA = 0`),MUST NOT 整個 pass 跳過 —— 跳過的話畫面會整片變暗變濁(少了色彩空間轉換),
    // 而那看起來像「調色把畫面弄壞了」,查半天查不到。
    chain.push('fxaa');
    this.fxaaQuad.material.uniforms.uAA.value = this.enabled.fxaa ? 1 : 0;

    r.setRenderTarget(this.rtScene);
    r.clear();
    if (this._mrt) {
      // 哨兵成立的**唯一**方法(檔頭 INK_MRT ②):`clear()` 拿 renderer 的 clearColor 清了
      // 每一張附件,而那個顏色不是 0 ⇒ 第二張要單獨清成 0,否則「沒有寫的一格」看起來像
      // 一組合法的法線,天際線與每一團特效外面都會多一圈粗黑邊。
      const gl = r.getContext();
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    }
    r.render(this.scene, this.camera);

    let src = this.rtScene;
    for (let i = 0; i < chain.length; i++) {
      const last = i === chain.length - 1;
      const dst = last ? null : (src === this.rtA ? this.rtB : this.rtA);
      const quad = this._quads[chain[i]];
      const u = quad.material.uniforms;
      // MRT 的 `.texture` 是**陣列**(第 0 張才是顏色)—— 直接餵整個陣列的話 three 會把它
      // 當成一張沒有 image 的貼圖丟給 sampler,畫面整片黑而沒有任何錯誤訊息。
      u.tColor.value = Array.isArray(src.texture) ? src.texture[0] : src.texture;
      if (u.uTexel) u.uTexel.value.copy(texel);
      if (u.tInfo) u.tInfo.value = this.rtScene.texture[1] || null;
      if (u.tDepth) {
        u.tDepth.value = this.rtScene.depthTexture;
        u.uNear.value = this.camera.near;
        u.uFar.value = this.camera.far;
      }
      r.setRenderTarget(dst);
      quad.render(r);
      src = dst || src;
    }
    r.setRenderTarget(null);
  }

  /** A25:3 個 RT + depthTexture + 4 個全螢幕材質,一個都不能漏(拉桿訂閱也要退掉) */
  dispose() {
    this._offPrefs?.();   // 不解訂閱 = 已 dispose 的材質被拉桿的 closure 抓著不放
    this._offPrefs = null;
    for (const rt of [this.rtScene, this.rtA, this.rtB]) {
      rt.depthTexture?.dispose();
      rt.dispose();
    }
    // 程序生成/載入進來的 LUT 由本管線持有(A25:一顆 canvas 貼圖也是 GPU 資源)
    this._lutOwned?.dispose();
    this._lutOwned = null;
    for (const q of [this.inkQuad, this.dofQuad, this.gradeQuad, this.fxaaQuad]) {
      q.material.dispose();
      q.dispose();
    }
  }
}
