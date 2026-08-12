// ============ t05 逐機零件檔(dev-only;獸型雙足 biped + grounded/tuckArms)============
// ── t05「仿生鶴」原型機(ostrich 鴕鳥/鶴):長腿貼地跑、分節長頸、右翼藏飛彈管、左翼藏線圈步槍 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t05_{static,moving,heavy}.png(★ = t05_moving)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(照 ★ 圖逐部位):
//   頭 = prismF 楔形顱殼(後掠冠稜一體)+ 鉤喙楔台;頸 = 貝茲曲線取樣 8 節 latheF 裝甲袖套
//   (基粗梢細、節間束環 —— 鶴頸分節,索引遞變零亂數);軀幹 = prismF 側剖面鳥身主殼
//   + 側甲板 ×2 + 背鞍板 + 腹部波紋內構鼓 + 尾下雙噴口;收翼 = 覆羽板 + finF 長刃初級
//   飛羽一片一件;腿 = 收分股殼 + latheF 髖盤螺栓 + 細長脛 + 二趾分節爪;尾羽 = fanF 六片。
// 白鶴美學:素色 solid(PAL 白銀階)+ 局部冷焰藍(ICE)發光;塗裝圖紋歸 paint 層。
// 2026-08-12 姿態/比例修補(照鴕鳥全身照 ref_Common_ostrich.jpg;機械外觀仍以 ★ 為準):
//   軀幹改水平長橢圓(長 2.6m × 深 1.36m ≈ 全高 23%)並整體前移 ⇒ 腿錨(z=0)落在軀幹
//   中央偏後;大腿縮短藏進體側(hips .52 / thigh .225 / shin .67 ⇒ 踝關節 = 鷹架膝 40% 全高、
//   蹠 2.09m 長於脛可見段);頸更細、自軀幹前上方(neckAt z 0.62)立起帶淺 S;
//   尾羽收小改向後下垂;喙縮短放平、頭縮小。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:冷焰藍(★ 圖的眼/噴口/線圈輝光)
const ICE = 0x66d8ff;

// 二次貝茲(長頸取樣;純索引決定性,零亂數)
const bz = (p0, c1, p1, t) => p0.map((v, k) => (1 - t) * (1 - t) * v + 2 * (1 - t) * t * c1[k] + t * t * p1[k]);
const bzT = (p0, c1, p1, t) => p0.map((v, k) => 2 * (1 - t) * (c1[k] - v) + 2 * t * (p1[k] - c1[k]));
// 頸曲線:neckG 原點(胸腔 [0,0,0.62] = 軀幹前上方;neckAt y MUST 取 0 —— locomotion :481 以
// chest 框的 headY0 直接覆寫 head.position.y,neckAt 抬高多少頭就懸空多少)→ 頭樞軸
// (neck 框 [0, headYl=2.66, 0.04-0.62=-0.58];頭世界 z 被鷹架釘在 chest+0.04 ⇒ 頸近垂直微後掠)
const NK0 = [0, 0.50, 0.10], NKC = [0, 1.72, 0.30], NK1 = [0, 2.66, -0.58];

export default {
  label: '仿生鶴(t05 機甲・鴕鳥)', hue: 0xf2f2f2, height: 6.0,
  prop: { hips: 0.52, legSplay: 0.045, thigh: 0.225, shin: 0.67, shoulderY: 0.62, shoulderX: 0.09, upperArm: 0.05, foreArm: 0.1, head: 0.96, girth: 0.8 },
  gait: { strideF: 1.5, bob: 0.1, sway: 0.06, top: 7, legBase: -0.16, armBase: 0.35 },
  pose: { knee: { base: 0.26, k: 0.72, d: 0.15 }, ankle: { base: -0.28, k: -0.44, d: 0.55 }, elbow: { base: -1.1, k: -0.1, d: 0.3 } },
  neckAt: [0, 0, 0.62],                                          // 長頸樞軸(y=0:見上方 NK0 註)
  moveSig: { poise: 0.50, idleF: 1.42, idleA: 0.60, launch: 0.16, spool: 0.18, brake: 0.22, settle: 1.55 },
  castSig: { omni: 'dance', dir: 'kick' },
  doc: [
    ['楔形小頭 + 冠稜', 'prismF 側剖顱殼縮小(後掠冠稜一體)+ tboxF 短平喙(照鴕鳥:短、近水平、微鉤)+ 冷焰藍眼 ×2 + latheF 感測圓盤/torusF 亮環 ×2'],
    ['分節細長鶴頸', '貝茲曲線取樣 8 節 latheF 裝甲袖套(更細:r 0.105→0.07)自軀幹前上方近垂直立起帶淺 S + 節間束環 ×3 + 頸根出殼領環'],
    ['鳥形軀幹', 'prismF 水平長橢圓主殼(長 2.6m > 深 1.36m;前移使腿錨落中央偏後)+ prismF 側甲 ×2 + tboxF 背鞍板 + latheF 腹下波紋內構鼓 + 尾下 latheF 噴口 ×2(ICE 光碟)'],
    ['收翼(tuckArms)', 'armUp:prismF 覆羽長刃板 + fanF 覆羽 ×3;armFore:finF 長刃初級飛羽一片一件 ×5(索引遞減長/遞增後掠外展,近水平沿體側後披)'],
    ['翼下武裝', '左翼線圈步槍(tboxF 電容匣 + 加速管 + ICE 線圈環 ×3 + 槍口環)/右翼 latheF 飛彈管 ×3 + 彈尖 + 掛架'],
    ['長腿 ×2(貼地跑)', '短股殼藏進體側(照鴕鳥:大腿幾乎看不見)+ latheF 髖盤/輪轂/螺栓 ×4 + hydCyl 亮腱 + 膝噴口;細長蹠(鷹架 shin 2.09m,踝關節 = 反向膝在 40% 全高)+ 前稜 + 亮腱桿雙套環 + 踝噴口'],
    ['二趾足', '踝座 + 斜蹠節 + 二趾各 2 節楔台 + coneF 爪尖 + 後距爪'],
    ['尾羽(fanF)', 'fanF 六片一片一件(edgeF 遞減)收小、自軀幹後端向後下垂 + latheF 尾根環'],
  ],
  head(c, h) {
    const { PAL } = c;
    // 楔形顱殼:側剖面稜柱(鉤喙基→眉→後掠冠稜一體;rotation.y=-π/2 使剖面 +x → +z 前向)
    const skull = [
      [0.04, -0.10], [0.19, -0.05], [0.165, 0.06], [0.04, 0.12],
      [-0.40, 0.28], [-0.20, 0.025], [-0.10, -0.06],
    ];
    const sk = prismF(h, skull, 0.20, 0, 0.015, 0.0, PAL.main, { metalness: 0.5 });
    sk.rotation.y = -Math.PI / 2;
    // 顱頂中稜(冠稜的立體補強:窄薄稜柱疊在顱中線)
    const ridge = [[0.10, 0.08], [-0.055, 0.135], [-0.36, 0.29], [-0.175, 0.10], [0.0, 0.045]];
    const rg = prismF(h, ridge, 0.05, 0, 0.025, 0.0, PAL.lite, { metalness: 0.55 });
    rg.rotation.y = -Math.PI / 2;
    // 短平喙(照鴕鳥:短、近水平;sz>0 微鉤)+ 深色喙尖
    const beak = tboxF(h, { w0: 0.10, d0: 0.085, w1: 0.026, d1: 0.024, h: 0.30, sz: 0.04 }, 0, -0.01, 0.33, PAL.lite, { metalness: 0.55 });
    beak.rotation.x = Math.PI / 2 + 0.03;
    const tip = tboxF(h, { w0: 0.028, d0: 0.026, w1: 0.012, d1: 0.012, h: 0.07, sz: 0.02 }, 0, -0.035, 0.49, INK, { metalness: 0.4 });
    tip.rotation.x = Math.PI / 2 + 0.14;
    for (const sx of [-1, 1]) {
      // 冷焰藍眼(★ 圖圓形鏡頭眼)
      sphF(h, 0.05, sx * 0.10, 0.04, 0.14, ICE, { emissive: ICE, emissiveIntensity: 1.6 });
      // 頰側感測圓盤(latheF 側向盤)+ 藍亮環(細環掛 noOutline)
      const puck = latheF(h, [[0.02, -0.022], [0.062, -0.017], [0.072, 0], [0.062, 0.017], [0.02, 0.022]], 10, sx * 0.12, 0.01, -0.03, PAL.mid, { metalness: 0.7 });
      puck.rotation.z = Math.PI / 2;
      const ring = torusF(h, 0.05, 0.012, sx * 0.14, 0.01, -0.03, ICE, { emissive: ICE, emissiveIntensity: 1.0 });
      ring.rotation.y = Math.PI / 2;
      ring.userData.noOutline = true;
    }
  },
  neck(c, nk) {
    const { PAL } = c;
    // 分節鶴頸:貝茲曲線取樣 8 節 latheF 裝甲袖套(基粗梢細;逐節沿切線定向)
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const [px, py, pz] = bz(NK0, NKC, NK1, t);
      const [, ty, tz] = bzT(NK0, NKC, NK1, t);
      const th = Math.atan2(tz, ty);
      const r = 0.105 - 0.035 * t;
      const seg = latheF(nk, [[r * 0.84, -0.17], [r, -0.05], [r * 0.97, 0.06], [r * 0.80, 0.17]], 8, px, py, pz, PAL.main, { metalness: 0.5 });
      seg.rotation.x = th;
    }
    // 節間束環(每兩節一圈;深色 = ★ 圖的節縫陰影)
    for (const i of [2, 4, 6]) {
      const t = i / N;
      const [px, py, pz] = bz(NK0, NKC, NK1, t);
      const [, ty, tz] = bzT(NK0, NKC, NK1, t);
      const r = 0.105 - 0.035 * t;
      const ring = latheF(nk, [[r * 0.86, -0.032], [r * 1.05, 0], [r * 0.86, 0.032]], 8, px, py, pz, PAL.deep, { metalness: 0.7 });
      ring.rotation.x = Math.atan2(tz, ty);
    }
    // 頸根出殼領環(頸自軀幹殼鑽出處)
    const tc = 0.3;
    const [cx, cy, cz] = bz(NK0, NKC, NK1, tc);
    const [, cty, ctz] = bzT(NK0, NKC, NK1, tc);
    const col = latheF(nk, [[0.115, -0.05], [0.145, -0.01], [0.135, 0.05], [0.105, 0.09]], 10, cx, cy, cz, PAL.mid, { metalness: 0.6 });
    col.rotation.x = Math.atan2(ctz, cty);
  },
  chest(c, ch, d) {
    const { PAL, G } = c;
    // 鳥形軀幹主殼:水平長橢圓側剖面稜柱(長 2.6 > 深 1.36,長軸水平;rotation.y=-π/2 → +x 前向)
    // 整體前移 z+0.25 ⇒ 腿錨(世界 z=0)落在軀幹中央偏後(照鴕鳥:腿自體中央偏後下方接出)
    const hullP = [
      [-1.30, 0.22], [-1.18, -0.16], [-0.75, -0.52], [-0.15, -0.66],
      [0.55, -0.60], [1.10, -0.36], [1.30, 0.10], [1.05, 0.40],
      [0.55, 0.64], [-0.25, 0.68], [-0.95, 0.52],
    ];
    const hull = prismF(ch, hullP, 1.1, 0, 0.10, 0.25, PAL.main, { metalness: 0.5 });
    hull.rotation.y = -Math.PI / 2;
    // 大側甲面 ×2(★ 圖側腹的大稜面甲板)
    const flankP = [[-0.72, 0.02], [-0.38, -0.30], [0.22, -0.36], [0.66, -0.04], [0.40, 0.24], [-0.22, 0.30]];
    for (const sx of [-1, 1]) {
      const fl = prismF(ch, flankP, 0.07, sx * 0.57, 0.10, 0.28, PAL.lite, { metalness: 0.5 });
      fl.rotation.y = -Math.PI / 2;
    }
    // 背鞍板(tboxF 收分;頂面後移 = 後掠)+ 前肩領板(頸根出殼處)
    tboxF(ch, { w0: 0.52, d0: 1.05, w1: 0.34, d1: 0.66, h: 0.18, sz: -0.12 }, 0, 0.72, -0.15, PAL.mid, { metalness: 0.55 });
    const cl2 = tboxF(ch, { w0: 0.36, d0: 0.42, w1: 0.26, d1: 0.30, h: 0.14 }, 0, 0.66, 0.78, PAL.mid, { metalness: 0.55 });
    cl2.rotation.x = 0.35;
    // 腹下波紋內構鼓(latheF 交替半徑肋;沿腹線外露一條深色機構 = 照片裸腹)
    const rib = [];
    for (let k = 0; k <= 8; k++) rib.push([k % 2 ? 0.24 : 0.20, -0.36 + k * 0.09]);
    const drum = latheF(ch, rib, 10, 0, -0.40, -0.10, GUNMETAL, { metalness: 0.75 });
    drum.rotation.x = Math.PI / 2;
    // 胸前冷焰藍識別燈(前上斜面)
    const lamp = bxF(ch, 0.18, 0.06, 0.04, 0, 0.42, 1.38, ICE, { emissive: ICE, emissiveIntensity: 1.0 });
    lamp.rotation.x = -0.5;
    // 尾下雙噴口(latheF 喇叭口朝後下 + ICE 光碟;★ 圖尾下藍焰的源頭)
    for (const sx of [-1, 1]) {
      const noz = latheF(ch, [[0.055, 0], [0.10, 0.06], [0.082, 0.15], [0.115, 0.24]], 10, sx * 0.20, -0.30, -0.92, COAL, { metalness: 0.8 });
      noz.rotation.x = -1.95;
      const gl = cylF(ch, 0.06, 0.06, 0.02, 8, sx * 0.20, -0.39, -1.14, ICE, { emissive: ICE, emissiveIntensity: 1.4 });
      gl.rotation.x = -1.95;
    }
  },
  pelvis(c, hips) {
    const { PAL, G } = c;
    // 骨盆束腰(收進主殼內的腰甲)+ 腹下冷焰藍帶(貼殼底外露)
    tboxF(hips, { w0: 0.46 * G, d0: 0.52 * G, w1: 0.42 * G, d1: 0.46 * G, h: 0.26 }, 0, -0.02, 0, PAL.mid, { metalness: 0.55 });
    bxF(hips, 0.2, 0.05, 0.3, 0, -0.57, 0.08, dimF(ICE, 0.8), { emissive: ICE, emissiveIntensity: 0.6 });
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    // 短收分股殼(照鴕鳥:大腿短、幾乎整段藏進體側殼內,只露膝端一截)
    tboxF(l, { w0: 0.16, d0: 0.24, w1: 0.34, d1: 0.50, h: d.len * 0.92, sz: 0.03 }, 0, -d.len * 0.44, 0.04, PAL.main, { metalness: 0.5 });
    // 髖側大圓盤(★ 圖髖部的大圓輪轂;貼體側殼外露)+ 轂心 + 螺栓 ×4(索引均分)
    const hd = latheF(l, [[0.03, -0.05], [0.20, -0.04], [0.24, 0], [0.20, 0.04], [0.03, 0.05]], 12, c.sx * 0.31, -0.10, 0.05, PAL.lite, { metalness: 0.6 });
    hd.rotation.z = Math.PI / 2;
    const hub = cylF(l, 0.075, 0.075, 0.05, 10, c.sx * 0.37, -0.10, 0.05, PAL.deep, { metalness: 0.8 });
    hub.rotation.z = Math.PI / 2;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const bolt = cylF(l, 0.022, 0.022, 0.045, 6, c.sx * 0.35, -0.10 + Math.cos(a) * 0.15, 0.05 + Math.sin(a) * 0.15, IRON, { metalness: 0.85 });
      bolt.rotation.z = Math.PI / 2;
    }
    // 膝前護板 + 後側亮腱缸(hydCyl ICE 芯)
    tboxF(l, { w0: 0.13, d0: 0.06, w1: 0.16, d1: 0.08, h: 0.22 }, 0, -d.len * 0.86, 0.14, PAL.lite, { metalness: 0.55 });
    hydCyl(l, 0.028, d.len * 0.5, -c.sx * 0.08, -d.len * 0.55, -0.18, 0.08, ICE);
    // 膝後噴口(★ 圖膝部藍焰)+ ICE 光碟
    const kn = latheF(l, [[0.035, 0], [0.06, 0.05], [0.05, 0.10], [0.07, 0.16]], 8, 0, -d.len * 0.92, -0.18, COAL, { metalness: 0.8 });
    kn.rotation.x = -1.75;
    const kg = cylF(l, 0.038, 0.038, 0.015, 8, 0, -d.len * 0.92 - 0.03, -0.33, ICE, { emissive: ICE, emissiveIntensity: 1.2 });
    kg.rotation.x = -1.75;
  },
  shin(c, l, d) {
    const { PAL, G } = c;
    // 踝球關節(照鴕鳥:此處其實是踝 = 反向膝,位於 40% 全高)+ 側小圓盤
    sphF(l, 0.11, 0, 0.02, -0.02, PAL.deep, { metalness: 0.7 });
    const kd = latheF(l, [[0.02, -0.026], [0.085, -0.02], [0.095, 0], [0.085, 0.02], [0.02, 0.026]], 10, c.sx * 0.11, 0.0, -0.02, PAL.lite, { metalness: 0.6 });
    kd.rotation.z = Math.PI / 2;
    // 細長蹠(踝端更細的窄楔台 = 鴕鳥腿招牌;比脛可見段更長)+ 前緣稜條
    tboxF(l, { w0: 0.065, d0: 0.10, w1: 0.115, d1: 0.17, h: d.len }, 0, -d.len * 0.5, 0, PAL.mid, { metalness: 0.6 });
    tboxF(l, { w0: 0.045, d0: 0.055, w1: 0.022, d1: 0.045, h: d.len * 0.68 }, 0, -d.len * 0.46, 0.085, PAL.lite, { metalness: 0.55 });
    // 後緣儲能腱桿(亮桿 + 上下端套環;models.js 鴕鳥腱的多面體版)
    cylF(l, 0.02, 0.02, d.len * 0.7, 6, 0, -d.len * 0.44, -0.13, 0xd8dde2, { metalness: 0.9 });
    for (const oy of [-d.len * 0.10, -d.len * 0.78])
      cylF(l, 0.042, 0.042, 0.05, 6, 0, oy, -0.13, COAL, { metalness: 0.8 });
    // 踝後噴口(★ 圖踝部藍焰)+ ICE 光碟
    const an = latheF(l, [[0.03, 0], [0.052, 0.045], [0.044, 0.09], [0.06, 0.14]], 8, 0, -d.len * 0.80, -0.15, COAL, { metalness: 0.8 });
    an.rotation.x = -1.7;
    const ag = cylF(l, 0.033, 0.033, 0.015, 8, 0, -d.len * 0.80 - 0.02, -0.28, ICE, { emissive: ICE, emissiveIntensity: 1.2 });
    ag.rotation.x = -1.7;
  },
  foot(c, l, d) {
    const { PAL } = c;
    // 踝座 + 斜蹠節(短跗蹠向前下斜)
    tboxF(l, { w0: 0.14, d0: 0.16, w1: 0.10, d1: 0.12, h: 0.14 }, 0, -0.10, 0.0, PAL.deep, { metalness: 0.6 });
    const mt = tboxF(l, { w0: 0.08, d0: 0.08, w1: 0.12, d1: 0.10, h: 0.30 }, 0, -0.17, 0.12, PAL.mid, { metalness: 0.6 });
    mt.rotation.x = 1.15;
    // 二趾(鴕鳥腳):每趾 2 節楔台 + coneF 爪尖(rotation.z 外撇)
    for (const [ox, rz] of [[-0.055, 0.12], [0.06, -0.16]]) {
      const s1 = tboxF(l, { w0: 0.065, d0: 0.07, w1: 0.05, d1: 0.055, h: 0.22 }, ox, -0.235, 0.30, PAL.lite, { metalness: 0.6 });
      s1.rotation.x = Math.PI / 2 + 0.10;
      s1.rotation.z = rz;
      const s2 = tboxF(l, { w0: 0.048, d0: 0.05, w1: 0.034, d1: 0.04, h: 0.16, sz: 0.03 }, ox + rz * -0.35, -0.27, 0.48, PAL.lite, { metalness: 0.6 });
      s2.rotation.x = Math.PI / 2 + 0.42;
      s2.rotation.z = rz;
      const cw = coneF(l, 0.034, 0.14, 6, ox + rz * -0.55, -0.285, 0.60, 0xd8dde2, { metalness: 0.75 });
      cw.rotation.x = Math.PI / 2 + 0.62;
      cw.rotation.z = rz;
    }
    // 後距爪(向後下的短爪)
    const sp = coneF(l, 0.035, 0.13, 6, 0, -0.24, -0.13, 0xd8dde2, { metalness: 0.75 });
    sp.rotation.x = -(Math.PI / 2 + 0.5);
  },
  armUp(c, a, d) {
    const { PAL } = c;
    // 肩節圓頂(latheF)
    latheF(a, [[0.14, -0.02], [0.17, 0.03], [0.13, 0.10], [0.0001, 0.15]], 12, 0, 0.02, 0, PAL.main, { metalness: 0.5 });
    // 覆羽主板(prismF 側剖長刃板:自肩沿體側向後掠過軀幹 = ★ 圖疊在背上那片大翼板)
    // 前端截短壓低(前尖翹過背線會像頸側豎耳 —— fix1 實測)
    const covP = [[0.22, -0.09], [0.30, 0.04], [0.05, 0.12], [-0.85, 0.26], [-1.15, 0.14], [-0.55, 0.02]];
    const pl = prismF(a, covP, 0.07, c.sx * 0.05, -d.len * 0.55, -0.05, PAL.main, { metalness: 0.5 });
    pl.rotation.y = -Math.PI / 2;
    pl.rotation.z = c.sx * 0.14;                                  // 板面外傾貼體側
    // 反傾:locomotion 靜姿把 armUp 前旋 armBase 0.35 ⇒ 板尾翹過背線成兩根「豎耳」
    // (fix2 實測);Euler XYZ 的 x 最外層 = 對 armUp 框俯仰,預扣回世界水平
    pl.rotation.x = -0.35;
    // 覆羽小扇(fanF 三片一片一件;沿覆羽板下緣指向後下)
    const cov = fanF(a, { n: 3, arc: 0.45, len: 0.6, edgeF: 0.7, gap: 0.022, fin: { w0: 0.15, w1: 0.06, t: 0.03, sweep: 0.10, camber: 0.03 } }, c.sx * 0.06, -d.len * 0.8, -0.35, PAL.lite, { metalness: 0.5 });
    cov.g.rotation.x = -2.35;
  },
  armFore(c, a, d) {
    const { PAL } = c;
    // 肘節環(latheF 側向盤)+ 腕背小甲
    const el = latheF(a, [[0.02, -0.024], [0.075, -0.018], [0.085, 0], [0.075, 0.018], [0.02, 0.024]], 10, c.sx * 0.06, 0.0, 0, PAL.lite, { metalness: 0.6 });
    el.rotation.z = Math.PI / 2;
    tboxF(a, { w0: 0.07, d0: 0.24, w1: 0.09, d1: 0.30, h: d.len * 0.8 }, c.sx * 0.01, -d.len * 0.45, -0.04, PAL.mid, { metalness: 0.55 });
    // 長刃初級飛羽 ×5(finF 一片一件;索引遞減長度、遞增後掠/橫展 = ★ 圖收翼疊列長刃;
    // 照鴕鳥收翼沿體側後披 ⇒ rotation.x 加深到 -1.05 起 ≈ 世界近水平微下,梢端垂向尾)
    for (let i = 0; i < 5; i++) {
      const f = finF(a, { len: 1.55 - 0.15 * i, w0: 0.20, w1: 0.055, t: 0.038, sweep: 0.20 + 0.04 * i, camber: 0.03 },
        c.sx * (0.02 + 0.02 * i), -0.10 - 0.10 * i, -0.02 - 0.02 * i, i % 2 ? PAL.main : PAL.lite, { metalness: 0.5 });
      f.rotation.z = -c.sx * (0.06 + 0.09 * i);                  // 負號:+y 經 Rz(+θ) 倒向 −x ⇒ 外展要取 −sx
      f.rotation.x = -1.05 - 0.06 * i;
    }
  },
  mount(c, F) {
    const { PAL } = c;
    // 翼下武裝各包一個反傾 Group:armFore 靜姿世界傾角 ≈ -0.75(armBase 0.35 + 肘 -1.1)
    // ⇒ group.rotation.x = +0.75 把砲管扳回世界水平指前(+z)
    const mkWg = (parent, x) => {
      const wg = new THREE.Group();
      wg.position.set(x, -0.30, 0);
      wg.rotation.x = 0.75;
      parent.add(wg);
      return wg;
    };
    // 左翼線圈步槍(輕):電容匣 + 加速管 + ICE 線圈環 ×3 + 槍口環(藏覆羽下)
    const wgL = mkWg(F.foreL, -0.05);
    const box = tboxF(wgL, { w0: 0.16, d0: 0.44, w1: 0.13, d1: 0.36, h: 0.20 }, 0, -0.02, -0.15, GUNMETAL, { metalness: 0.8 });
    const rail = cylF(wgL, 0.030, 0.037, 1.20, 6, 0, -0.10, 0.40, 0x111418, { metalness: 0.85 });
    rail.rotation.x = Math.PI / 2;
    const lN = [box, rail];
    for (let k = 0; k < 3; k++) {
      const cr = cylF(wgL, 0.068, 0.068, 0.05, 8, 0, -0.10, 0.12 + 0.24 * k, ICE, { emissive: ICE, emissiveIntensity: 0.7 });
      cr.rotation.x = Math.PI / 2;
      lN.push(cr);
    }
    const lMuz = cylF(wgL, 0.05, 0.05, 0.05, 8, 0, -0.10, 1.02, ICE, { emissive: ICE, emissiveIntensity: 1.2 });
    lMuz.rotation.x = Math.PI / 2;
    lN.push(lMuz);
    // 右翼飛彈管 ×3(重):latheF 管身(前唇內收)+ 彈尖 ICE + 掛架(斜列藏覆羽下)
    const wgR = mkWg(F.foreR, 0.05);
    const rack = bxF(wgR, 0.06, 0.36, 0.30, 0.04, -0.10, -0.20, IRON, { metalness: 0.8 });
    const hN = [rack];
    const tips = [];
    for (let k = 0; k < 3; k++) {
      const tube = latheF(wgR, [[0.050, -0.26], [0.058, -0.22], [0.058, 0.20], [0.046, 0.26]], 8,
        0.02 + 0.015 * k, 0.02 - 0.12 * k, -0.04 + 0.05 * k, PAL.deep, { metalness: 0.7 });
      tube.rotation.x = Math.PI / 2;
      const tp = cylF(wgR, 0.042, 0.042, 0.04, 8, 0.02 + 0.015 * k, 0.02 - 0.12 * k, 0.23 + 0.05 * k, ICE, { emissive: ICE, emissiveIntensity: 1.3 });
      tp.rotation.x = Math.PI / 2;
      hN.push(tube, tp);
      tips.push(tp);
    }
    const hMuz = tips[0];
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.05 }, heavy: { n: hMuz, r: 0.06 } },
      lightGlowM: [lMuz], heavyGlowM: tips, heavyPivot: [],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.04 },
      aimPose: null,
      wpn: { light: { nodes: lN, ref: wgL, muz: lMuz, fwd: 'z' }, heavy: { nodes: hN, ref: wgR, muz: hMuz, fwd: 'z' } },
    };
  },
  extra(c, F, rig) {
    const { PAL } = c;
    // 尾羽扇(fanF 六片一片一件;照鴕鳥:短蓬羽簇收小、自軀幹後端向後下垂)+ 尾根環
    const fan = fanF(F.chest, { n: 6, arc: 0.8, len: 0.62, edgeF: 0.6, gap: 0.024, fin: { w0: 0.14, w1: 0.05, t: 0.035, sweep: 0.10, camber: 0.03 } }, 0, 0.28, -1.10, PAL.lite, { metalness: 0.45 });
    fan.g.rotation.x = -2.05;
    const root = latheF(F.chest, [[0.10, -0.06], [0.14, 0], [0.11, 0.07]], 10, 0, 0.32, -1.02, PAL.mid, { metalness: 0.6 });
    root.rotation.x = -2.05;
    rig.grounded = 1;      // 貼地跑:沒有騰空相、高速浮沉收斂
    rig.tuckArms = 1;      // 收翼蓄勢:前肢不擺大臂
    rig.leanF = 0.35;      // 水平體軸:加速改抬尾配平
    rig.tailUp = 0.16;
  },
};
