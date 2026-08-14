// ============ s09 逐機零件檔(dev-only;獸型雙足 biped + hop 袋鼠跳)============
// ── s09「獵場看守人」躍步防空機甲(roo 袋鼠):跟腱儲能雙腿、著地平衡尾、雙管防空霰彈 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s09_{static,moving,heavy}.jpg(★ = s09_static)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體重建(照 ★ 圖逐部位):
//   頭 = 楔形長吻 + finF 雙刃長耳;頸 = latheF 分節頸椎環;胸 = 收分胸艙 + 背架
//   (四管防空飛彈莢艙 + 尖彈匣);腿 = 巨腿殼 + latheF 髖圓盤螺槽 + 外露儲能簧
//   (torusF 簧圈 × 亮桿 = 跟腱儲能);腳 = 長蹠三趾 + BRASS 爪帽;
//   武器 = 右手泵動雙管防空霰彈(重)+ 左拳同款短雙管拳砲(輕);
//   尾 = 六節「位置編碼下垂」節鏈(locomotion whipTail 每幀覆寫尾節 rotation ⇒
//   下垂 MUST 住位置與節身傾角,不能住 chainF 的 rot0/rotD)+ 尾根氣簧 + 著地墊。
// ★ 圖色是飽和鏽橙(heroPalette 對這個 hue 洗成粉膚色)⇒ 主殼走本機專用鏽橙四階。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:鏽橙四階(照 ★ 圖取色)+ 尾/內構暖鋼灰、磨損銀護膝、莢艙橄欖、
// 彈頭紅、感測青、暗銅護木、簧圈黑、亮桿鋼
const RUST = 0xb5552b, RUSTD = 0x8f3e20, RUSTL = 0xc9793f, RDEEP = 0x5a2f1b;
const TSTEEL = 0x8f8c86, SILVER = 0xcac4b6, OLIVE = 0x7a7448, OLIVED = 0x5f5a38;
const REDT = 0xc23b2e, TEAL = 0x35c8d4, DBRASS = 0xb8892e, SPRING = 0x2b2e33, ROD = 0xd8dde2;

export default {
  label: '獵場看守人(s09 機甲・袋鼠)', height: 6.0,
  prop: { hips: 0.48, legSplay: 0.1, thigh: 0.4, shin: 0.46, shoulderY: 0.75, shoulderX: 0.12, upperArm: 0.17, foreArm: 0.17, head: 0.85, girth: 0.95 },
  gait: { strideF: 1.6, bob: 0.15, sway: 0.07, top: 7, legBase: 0.08, armBase: 0.25 },
  pose: { knee: { base: 0.35, k: 0.7, d: 0.15 }, ankle: { base: -0.3, k: -0.42, d: 0.55 }, elbow: { base: -1.5, k: -0.2, d: 0.3 } },
  moveSig: { poise: 0.18, idleF: 1.62, idleA: 0.90, launch: 0.96, spool: 0.14, brake: 0.62, settle: 0.42 },
  castSig: { omni: 'stomp', dir: 'kick' },
  doc: [
    ['頭(袋鼠楔吻長耳)', 'tboxF 顱+收分長吻+prismF 頰板 ×2+finF 雙耳(外耳+內襯一片一件,索引遞變傾角)+青綠感測眼'],
    ['頸(分節脊椎)', 'latheF 頸椎環 ×3 遞減+cylF 頸芯+hydCyl 頸後缸+BRASS 領環'],
    ['胸+背架', 'tboxF 收分胸艙+prismF 胸甲 ×2+BRASS 胸徽;背架 = 四管防空飛彈莢艙(latheF 管 ×4+紅彈頭)+尖彈匣(coneF 彈尖 ×5)'],
    ['腰腹(裸內構)', 'tboxF 窄腰核+cablesF 腹側管束+BRASS 骨盆帶'],
    ['腿 ×2(跟腱儲能)', 'tboxF 巨腿殼+latheF 髖圓盤(斜螺槽)+磨損銀護膝+外露儲能簧(torusF 簧圈 ×6+亮桿)+腿後纜束'],
    ['長蹠大腳 ×2', 'tboxF 斜蹠殼+prismF 踝托架+三趾(兩節+BRASS 爪帽)+跟腱桿'],
    ['臂+拳砲', 'latheF 球肩+hydCyl 金腱+細楔臂殼;右手 = 泵動雙管防空霰彈(重:BRASS 機匣+雙管+肋紋護木+槍口環)、左拳 = 同款短雙管拳砲(輕)'],
    ['著地平衡尾(六節)', '位置編碼下垂節鏈(whipTail 只寫旋轉)+逐節收分節身+節環+尾背鱗甲 ×3+尾根氣簧+著地墊'],
  ],
  head(c, h) {
    // 顱(楔台收分)+ 眉稜
    tboxF(h, { w0: 0.3, d0: 0.34, w1: 0.24, d1: 0.28, h: 0.26, sz: 0.03 }, 0, 0.1, 0.02, RUST, { metalness: 0.5 });
    tboxF(h, { w0: 0.3, d0: 0.1, w1: 0.26, d1: 0.07, h: 0.06 }, 0, 0.16, 0.18, RDEEP, { metalness: 0.6 });
    // 收分長吻(前傾)+ 鼻端帽 + 淺色下顎
    tboxF(h, { w0: 0.2, d0: 0.15, w1: 0.12, d1: 0.09, h: 0.5, sz: -0.02 }, 0, 0.02, 0.32, RUST, { metalness: 0.5 }).rotation.x = Math.PI / 2 + 0.1;
    tboxF(h, { w0: 0.11, d0: 0.08, w1: 0.09, d1: 0.06, h: 0.07 }, 0, 0.005, 0.58, INK, { metalness: 0.4 }).rotation.x = Math.PI / 2 + 0.1;
    tboxF(h, { w0: 0.16, d0: 0.1, w1: 0.11, d1: 0.07, h: 0.32 }, 0, -0.1, 0.24, RUSTL, { metalness: 0.45 }).rotation.x = Math.PI / 2 + 0.18;
    // 側頰板(prismF 角面)+ 感測眼(青綠;袋鼠側置眼)
    const cheek = [[-0.12, -0.06], [0.02, -0.11], [0.13, -0.02], [0.1, 0.09], [-0.05, 0.11]];
    for (const sx of [-1, 1]) {
      const cp = prismF(h, cheek.map(([x, y]) => [sx * x, y]), 0.05, sx * 0.16, 0.02, 0.1, RUSTD, { metalness: 0.55 });
      cp.rotation.y = sx * Math.PI / 2;
      sphF(h, 0.04, sx * 0.13, 0.1, 0.18, TEAL, { emissive: TEAL, emissiveIntensity: 1.5 });
    }
    // 雙刃長耳(外耳 + 內襯各一片一件;後掠角索引遞變 = 活體不對稱)
    [-1, 1].forEach((sx, i) => {
      const ear = finF(h, { len: 0.72, w0: 0.18, w1: 0.06, t: 0.06, sweep: 0.1, camber: 0.05 }, sx * 0.11, 0.2, -0.06, RUST, { metalness: 0.5 });
      ear.rotation.z = -sx * 0.16;
      ear.rotation.x = -(0.24 + i * 0.1);
      const inner = finF(h, { len: 0.52, w0: 0.1, w1: 0.035, t: 0.032, sweep: 0.08, camber: 0.04 }, sx * 0.11, 0.21, -0.02, RDEEP, { metalness: 0.4 });
      inner.rotation.z = -sx * 0.16;
      inner.rotation.x = -(0.24 + i * 0.1);
    });
  },
  chest(c, ch, d) {
    const { accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // 收分胸艙(肩寬腰窄、頂面前移 = 微前傾剪影)+ 背板
    tboxF(ch, { w0: d.shoulderX * 0.92, d0: 0.52 * G, w1: d.shoulderX * 1.62, d1: 0.74 * G, h: 0.85, sz: 0.12 }, 0, top - 0.44, 0.05, RUST, { metalness: 0.5 });
    tboxF(ch, { w0: 0.76, d0: 0.14, w1: 0.82, d1: 0.12, h: 0.72 }, 0, top - 0.34, -0.34, RUSTD, { metalness: 0.6 });
    // 左右胸甲(prismF 六角淺色)+ BRASS 胸徽 + 識別燈
    const pec = [[-0.14, -0.18], [0.14, -0.18], [0.21, -0.02], [0.16, 0.14], [-0.09, 0.16], [-0.19, 0]];
    for (const sx of [-1, 1]) {
      const p = prismF(ch, pec.map(([x, y]) => [sx * x, y]), 0.07, sx * 0.24, top - 0.34, 0.4, RUSTL, { metalness: 0.5 });
      p.rotation.x = -0.08;
    }
    tboxF(ch, { w0: 0.3, d0: 0.06, w1: 0.22, d1: 0.06, h: 0.18 }, 0, top - 0.12, 0.4, BRASS, { metalness: 0.85, emissive: BRASS, emissiveIntensity: 0.2 });
    bxF(ch, 0.26, 0.05, 0.05, 0, top - 0.62, 0.44, accent, { emissive: accent, emissiveIntensity: 0.9 });
    // 裸腰內構(窄腰核 + 腹側管束;2D 腰腹可見深色軟管)
    tboxF(ch, { w0: 0.3, d0: 0.28, w1: 0.4, d1: 0.34, h: 0.8 }, 0, bot - 0.05, 0.02, GUNMETAL, { metalness: 0.7 });
    cablesF(ch, { p0: [0, top - 0.62, 0.24], p1: [0, bot - 0.45, 0.18], k: 4, r: 0.026, sag: 0.03, spread: 0.09 }, GUNMETAL, { metalness: 0.6 });
    // 分節頸椎(latheF 環 ×3 遞減 + 頸芯 + 頸後缸 + BRASS 領環)
    const col = latheF(ch, [[0.17, -0.04], [0.21, -0.01], [0.21, 0.01], [0.17, 0.04]], 10, 0, top + 0.02, 0.1, DBRASS, { metalness: 0.85 });
    col.rotation.x = -0.12;
    for (let i = 0; i < 3; i++) {
      const vr = latheF(ch, [[0.12 - i * 0.012, -0.045], [0.16 - i * 0.015, -0.01], [0.16 - i * 0.015, 0.015], [0.12 - i * 0.012, 0.05]], 10, 0, top + 0.13 + i * 0.16, 0.12 + i * 0.02, TSTEEL, { metalness: 0.8 });
      vr.rotation.x = -0.12;
    }
    const core = cylF(ch, 0.085, 0.095, 0.55, 8, 0, top + 0.3, 0.13, INK, { metalness: 0.7 });
    core.rotation.x = -0.1;
    hydCyl(ch, 0.022, 0.4, 0.1, top + 0.28, -0.05, 0.18, DBRASS);
    // 背架:四管防空飛彈莢艙(左肩外上方、管口朝後上 = 2D 待發角)
    bxF(ch, 0.1, 0.5, 0.1, -0.52, top + 0.04, -0.36, IRON, { metalness: 0.8 });
    const strut = cylF(ch, 0.03, 0.03, 0.5, 6, -0.44, top - 0.1, -0.44, IRON, { metalness: 0.8 });
    strut.rotation.x = 0.5;
    const bp = new THREE.Group();
    bp.position.set(-0.56, top + 0.34, -0.46);
    bp.rotation.x = -1.7;                                                       // +z 轉朝後上(待發仰角)
    bp.rotation.z = 0.22;                                                       // 管口外傾(紅彈頭自前側可見)
    ch.add(bp);
    tboxF(bp, { w0: 0.48, d0: 0.48, w1: 0.44, d1: 0.44, h: 0.58 }, 0, 0, 0.06, OLIVE, { metalness: 0.5 }).rotation.x = Math.PI / 2;
    for (const ox of [-1, 1]) for (const oy of [-1, 1]) {
      const tube = latheF(bp, [[0.08, -0.1], [0.094, -0.06], [0.094, 0.06], [0.08, 0.1]], 10, ox * 0.11, oy * 0.11, 0.36, OLIVED, { metalness: 0.6 });
      tube.rotation.x = Math.PI / 2;
      const tip = cylF(bp, 0.06, 0.06, 0.05, 8, ox * 0.11, oy * 0.11, 0.4, REDT, { emissive: REDT, emissiveIntensity: 0.35 });
      tip.rotation.x = Math.PI / 2;
    }
    // 背架:尖彈匣(橄欖匣體 + 一排彈尖;2D 背後的鋸齒彈架)
    tboxF(ch, { w0: 0.55, d0: 0.25, w1: 0.5, d1: 0.22, h: 0.42 }, 0.02, top - 0.42, -0.54, OLIVE, { metalness: 0.5 }).rotation.x = -0.08;
    for (let i = 0; i < 5; i++)
      coneF(ch, 0.042, 0.16, 6, -0.2 + i * 0.11, top - 0.16, -0.57, 0x6b6f75, { metalness: 0.8 });
  },
  pelvis(c, hips) {
    const { G } = c;
    // 骨盆(tboxF)+ BRASS 骨盆帶 + 胯甲 + 尾根環座
    tboxF(hips, { w0: 0.68 * G, d0: 0.54 * G, w1: 0.72 * G, d1: 0.58 * G, h: 0.36 }, 0, 0.02, 0, RUSTD, { metalness: 0.55 });
    tboxF(hips, { w0: 0.74 * G, d0: 0.6 * G, w1: 0.68 * G, d1: 0.56 * G, h: 0.1 }, 0, 0.21, 0, BRASS, { metalness: 0.85 });
    tboxF(hips, { w0: 0.24, d0: 0.3, w1: 0.2, d1: 0.24, h: 0.22, sz: 0.03 }, 0, -0.2, 0.12, RDEEP, { metalness: 0.55 });
    const tc = latheF(hips, [[0.12, -0.04], [0.18, -0.015], [0.18, 0.015], [0.12, 0.04]], 10, 0, -0.1, -0.32, IRON, { metalness: 0.8 });
    tc.rotation.x = Math.PI / 2 + 0.35;
  },
  thigh(c, l, d) {
    const { G } = c;
    // 巨腿殼(髖寬深、膝端收分;袋鼠動力段的量感)
    tboxF(l, { w0: 0.34 * G, d0: 0.42 * G, w1: 0.5 * G, d1: 0.78 * G, h: d.len * 0.98, sz: -0.06 }, 0, -d.len * 0.47, 0.05, RUST, { metalness: 0.5 });
    // 髖側大圓盤(latheF 實面鼓 + 斜螺槽桿;2D 的招牌髖關節)
    const disc = latheF(l, [[0.0001, -0.028], [0.26, -0.028], [0.3, -0.008], [0.3, 0.008], [0.26, 0.028], [0.0001, 0.028]], 12, c.sx * 0.27 * G, -0.18, 0.03, RDEEP, { metalness: 0.7 });
    disc.rotation.z = -c.sx * Math.PI / 2;
    const slot = bxF(l, 0.02, 0.06, 0.42, c.sx * 0.3 * G, -0.18, 0.03, DBRASS, { metalness: 0.85 });
    slot.rotation.x = 0.6;
    // 外側腿甲(prismF 五角)+ 腿後纜束 + 髖前缸(BRASS 亮芯)
    const panel = [[-0.13, -0.34], [0.13, -0.34], [0.19, -0.02], [0.11, 0.26], [-0.17, 0.19]];
    const pp = prismF(l, panel, 0.05, c.sx * 0.25 * G, -d.len * 0.62, 0.06, RUSTD, { metalness: 0.5 });
    pp.rotation.y = c.sx * Math.PI / 2;
    cablesF(l, { p0: [-c.sx * 0.08, -0.2, -0.3], p1: [-c.sx * 0.05, -d.len * 0.88, -0.16], k: 3, r: 0.028, sag: 0.05, spread: 0.04 }, GUNMETAL, { metalness: 0.6 });
    hydCyl(l, 0.032, d.len * 0.45, c.sx * 0.12 * G, -d.len * 0.4, 0.32, -0.14, BRASS);
  },
  shin(c, l, d) {
    const { G } = c;
    // 膝軸盤(BRASS)+ 磨損銀護膝(prismF 八角;落地刮痕歸 paint 層)
    const kd = latheF(l, [[0.03, -0.03], [0.11, -0.024], [0.125, 0], [0.11, 0.024], [0.03, 0.03]], 10, c.sx * 0.15 * G, -0.02, 0, BRASS, { metalness: 0.85 });
    kd.rotation.z = Math.PI / 2;
    const pad = [[-0.17, -0.15], [-0.07, -0.2], [0.07, -0.2], [0.17, -0.15], [0.2, 0.02], [0.12, 0.17], [-0.12, 0.17], [-0.2, 0.02]];
    const kp = prismF(l, pad, 0.06, 0, -0.08, 0.2, SILVER, { metalness: 0.25 });
    kp.rotation.x = -0.15;
    // 細脛殼(踝端收分)
    tboxF(l, { w0: 0.15 * G, d0: 0.17 * G, w1: 0.21 * G, d1: 0.24 * G, h: d.len * 0.9 }, 0, -d.len * 0.48, -0.04, RUSTD, { metalness: 0.6 });
    // 外露儲能簧(跟腱儲能本體:芯桿 + torusF 簧圈 ×8 密繞索引遞變)—— 2D 脛前的大簧
    cylF(l, 0.02, 0.02, d.len * 0.78, 6, 0, -d.len * 0.5, 0.13, 0x9aa0a8, { metalness: 0.9 });
    for (let i = 0; i < 8; i++) {
      const coil = torusF(l, 0.06 - i * 0.0015, 0.021, 0, -d.len * 0.15 - i * d.len * 0.088, 0.13, 0x3a3e44, { metalness: 0.8 });
      coil.rotation.x = Math.PI / 2;
    }
    // 脛後跟腱桿 + 錨環
    const ht = cylF(l, 0.02, 0.02, d.len * 0.5, 6, 0, -d.len * 0.6, -0.15 * G, 0x9aa0a8, { metalness: 0.9 });
    ht.rotation.x = 0.08;
    cylF(l, 0.04, 0.04, 0.05, 6, 0, -d.len * 0.36, -0.14 * G, SPRING, { metalness: 0.8 });
  },
  foot(c, l, d) {
    // 站姿實高:踝關節靜置在 hipY − thighL·cos(legBase) − shinL·cos(legBase+knee.base)
    // ≈ 0.53(d.clear 是直鏈假設,取它會讓趾尖懸空)
    const DROP = 0.5;
    // 踝軸盤 + 踝後托架(prismF 角面;2D 踝部的深色角撐)
    const ad = latheF(l, [[0.03, -0.028], [0.09, -0.02], [0.105, 0], [0.09, 0.02], [0.03, 0.028]], 10, c.sx * 0.14, 0, 0, BRASS, { metalness: 0.85 });
    ad.rotation.z = Math.PI / 2;
    const brk = [[-0.06, -0.02], [0.16, 0.02], [0.2, 0.14], [0.08, 0.2], [-0.02, 0.12]];
    const bk = prismF(l, brk, 0.05, c.sx * 0.1, -0.1, -0.12, COAL, { metalness: 0.7 });
    bk.rotation.y = c.sx * Math.PI / 2;
    // 長蹠殼(自踝斜下前伸至趾根;袋鼠大腳的槓桿)
    const slope = Math.atan2(DROP - 0.1, 0.85);
    const mt = tboxF(l, { w0: 0.26, d0: 0.2, w1: 0.2, d1: 0.13, h: 0.92 }, 0, -(DROP - 0.1) * 0.5, 0.42, RUST, { metalness: 0.5 });
    mt.rotation.x = Math.PI / 2 + slope;
    // 跟腱桿(蹠跟斜上指向脛)+ 後距
    const hb = cylF(l, 0.018, 0.018, 0.4, 6, 0, -0.04, -0.18, 0x9aa0a8, { metalness: 0.9 });
    hb.rotation.x = 0.5;
    tboxF(l, { w0: 0.14, d0: 0.12, w1: 0.09, d1: 0.08, h: 0.16 }, 0, -DROP * 0.35, -0.22, RDEEP, { metalness: 0.6 }).rotation.x = -0.5;
    // 三趾(兩節收分 + BRASS 爪帽;中趾略長 = 索引遞變)
    [-0.1, 0, 0.1].forEach((ox, i) => {
      const ext = i === 1 ? 0.05 : 0;
      tboxF(l, { w0: 0.075, d0: 0.075, w1: 0.06, d1: 0.06, h: 0.22 }, ox, -DROP + 0.12, 0.95 + ext, BONE, { metalness: 0.6 }).rotation.x = Math.PI / 2 + 0.12;
      tboxF(l, { w0: 0.06, d0: 0.06, w1: 0.04, d1: 0.045, h: 0.16, sz: 0.03 }, ox, -DROP + 0.08, 1.12 + ext, BONE, { metalness: 0.6 }).rotation.x = Math.PI / 2 + 0.35;
      coneF(l, 0.034, 0.1, 6, ox, -DROP + 0.05, 1.22 + ext, BRASS, { metalness: 0.85 }).rotation.x = Math.PI / 2 + 0.55;
    });
  },
  armUp(c, a, d) {
    const { G } = c;
    // 球肩(latheF)+ 方肩墊 + 細楔臂殼 + BRASS 肩腱缸 + 肘軸盤
    latheF(a, [[0.13 * G, -0.02], [0.16 * G, 0.03], [0.13 * G, 0.09], [0.0001, 0.13]], 10, 0, 0.02, 0, RUSTD, { metalness: 0.6 });
    tboxF(a, { w0: 0.28, d0: 0.32, w1: 0.34, d1: 0.36, h: 0.16, sz: -0.02 }, c.sx * 0.03, 0.12, 0, RUST, { metalness: 0.5 });
    tboxF(a, { w0: 0.13 * G, d0: 0.15 * G, w1: 0.17 * G, d1: 0.19 * G, h: d.len * 0.9 }, 0, -d.len * 0.5, 0, RUST, { metalness: 0.5 });
    hydCyl(a, 0.026, d.len * 0.5, c.sx * 0.09 * G, -d.len * 0.45, 0.1 * G, -0.1, BRASS);
    const ed = latheF(a, [[0.025, -0.026], [0.085, -0.02], [0.095, 0], [0.085, 0.02], [0.025, 0.026]], 10, c.sx * 0.1 * G, -d.len * 0.97, 0, BRASS, { metalness: 0.85 });
    ed.rotation.z = Math.PI / 2;
  },
  armFore(c, a, d) {
    const { G } = c;
    // 前臂細楔殼 + 外側護板 + 腕環
    tboxF(a, { w0: 0.11 * G, d0: 0.13 * G, w1: 0.15 * G, d1: 0.17 * G, h: d.len * 0.92 }, 0, -d.len * 0.5, 0, RUSTD, { metalness: 0.6 });
    const gd = [[-0.06, -0.18], [0.06, -0.18], [0.09, 0], [0.05, 0.16], [-0.08, 0.13]];
    const gp = prismF(a, gd, 0.04, c.sx * 0.09 * G, -d.len * 0.5, 0.02, RUST, { metalness: 0.5 });
    gp.rotation.y = c.sx * Math.PI / 2;
    cylF(a, 0.085, 0.09, 0.06, 8, 0, -d.len * 0.94, 0, IRON, { metalness: 0.8 });
  },
  mount(c, F) {
    const { accent, K } = c;
    // 手掌基板(兩腕同型)
    for (const [hand] of [[F.handL], [F.handR]])
      tboxF(hand, { w0: 0.16, d0: 0.18, w1: 0.13, d1: 0.15, h: 0.14 }, 0, -0.04, 0, RDEEP, { metalness: 0.6 });
    // 臂鏈靜置合角 ≈ armBase 0.25 + 肘 −1.5 = −1.25 ⇒ 槍組樞軸補 +1.25 回水平;
    // gunPitch 驅動 rest(行軍微壓)↔ aim(據槍水平)+ 每發槍口上跳
    const mkFingers = (g, py, pz) => {
      for (let i = 0; i < 4; i++)
        bxF(g, 0.11, 0.026, 0.09, 0, py - i * 0.034, pz + (i % 2) * 0.006, BRASS, { metalness: 0.8 });
      bxF(g, 0.03, 0.026, 0.08, -0.07, py - 0.05, pz - 0.06, BRASS, { metalness: 0.8 });
    };
    // ── 重武器:右手泵動雙管防空霰彈(2D 定案的金機匣長槍)──
    const sgP = new THREE.Group();
    sgP.position.set(0, -0.14, 0.08);
    sgP.rotation.x = 1.25;
    F.handR.add(sgP);
    const BL = 1.35 * K.barrelF;
    tboxF(sgP, { w0: 0.2, d0: 0.26, w1: 0.17, d1: 0.21, h: 0.62 }, 0, 0.02, 0.31, DBRASS, { metalness: 0.8 }).rotation.x = Math.PI / 2;   // 機匣(BRASS 泵動槍身)
    bxF(sgP, 0.06, 0.035, 0.55, 0, 0.15, 0.31, INK, { metalness: 0.7 });         // 頂軌
    bxF(sgP, 0.02, 0.07, 0.18, 0.11, 0.02, 0.33, INK, { metalness: 0.6 });       // 退殼口
    for (const ox of [-0.06, 0.06]) {
      const b = cylF(sgP, 0.052, 0.052, BL, 8, ox, 0.05, 0.62 + BL / 2, GUNMETAL, { metalness: 0.85 });
      b.rotation.x = Math.PI / 2;                                                // 並列雙管
      const tip = latheF(sgP, [[0.046, -0.04], [0.06, -0.022], [0.06, 0.022], [0.046, 0.04]], 10, ox, 0.05, 0.62 + BL, BRASS, { metalness: 0.85 });
      tip.rotation.x = Math.PI / 2;                                              // 黃銅砲口
    }
    bxF(sgP, 0.21, 0.11, 0.06, 0, 0.05, 0.62 + BL * 0.55, COAL, { metalness: 0.7 });   // 管間束帶
    const umt = cylF(sgP, 0.036, 0.036, BL * 0.75, 8, 0, -0.055, 0.56 + BL * 0.38, 0x2f3338, { metalness: 0.8 });
    umt.rotation.x = Math.PI / 2;                                                // 下置彈倉管
    tboxF(sgP, { w0: 0.17, d0: 0.17, w1: 0.15, d1: 0.15, h: 0.36 }, 0, -0.055, 0.98, DBRASS, { metalness: 0.6 }).rotation.x = Math.PI / 2;   // 泵動護木
    for (const oz of [0.9, 1.07])
      torusF(sgP, 0.1, 0.015, 0, -0.055, oz, INK, { metalness: 0.7 });           // 護木肋紋
    const hMuz = latheF(sgP, [[0.065, -0.02], [0.12, -0.008], [0.12, 0.008], [0.065, 0.02]], 10, 0, 0.05, 0.64 + BL, accent, { emissive: accent, emissiveIntensity: 1.5 });
    hMuz.rotation.x = Math.PI / 2;                                               // 槍口充能環(跨雙管)
    tboxF(sgP, { w0: 0.1, d0: 0.12, w1: 0.09, d1: 0.11, h: 0.22 }, 0, -0.13, -0.02, RDEEP, { metalness: 0.55 }).rotation.x = 0.3;   // 握把
    const tg = torusF(sgP, 0.05, 0.012, 0, -0.11, 0.12, INK, { metalness: 0.7 });
    tg.rotation.y = Math.PI / 2;                                                 // 扳機護弓
    tg.userData.noOutline = true;
    tboxF(sgP, { w0: 0.09, d0: 0.18, w1: 0.11, d1: 0.22, h: 0.3 }, 0, 0.02, -0.15, RDEEP, { metalness: 0.55 }).rotation.x = Math.PI / 2 + 0.15;   // 短托抵肘
    mkFingers(sgP, -0.06, 0.03);
    // ── 輕武器:左拳同款短雙管拳砲(前臂雙管防空霰彈拳砲)──
    const podP = new THREE.Group();
    podP.position.set(0, -0.14, 0.08);
    podP.rotation.x = 1.25;
    F.handL.add(podP);
    tboxF(podP, { w0: 0.2, d0: 0.22, w1: 0.17, d1: 0.19, h: 0.26 }, 0, 0, 0.04, RDEEP, { metalness: 0.6 });   // 拳套座
    for (const ox of [-0.055, 0.055]) {
      const b = cylF(podP, 0.045, 0.045, 0.55, 8, ox, 0.05, 0.34, GUNMETAL, { metalness: 0.85 });
      b.rotation.x = Math.PI / 2;                                                // 短雙管
      const tip = latheF(podP, [[0.04, -0.025], [0.052, -0.012], [0.052, 0.012], [0.04, 0.025]], 10, ox, 0.05, 0.6, BRASS, { metalness: 0.85 });
      tip.rotation.x = Math.PI / 2;
    }
    const lMuz = latheF(podP, [[0.055, -0.016], [0.095, -0.007], [0.095, 0.007], [0.055, 0.016]], 10, 0, 0.05, 0.62, accent, { emissive: accent, emissiveIntensity: 1.0 });
    lMuz.rotation.x = Math.PI / 2;                                               // 槍口環
    tboxF(podP, { w0: 0.09, d0: 0.16, w1: 0.08, d1: 0.14, h: 0.14 }, 0, -0.15, 0.16, COAL, { metalness: 0.7 });   // 下插彈匣
    bxF(podP, 0.1, 0.05, 0.15, 0, -0.22, 0.16, dimF(accent, 0.8), { metalness: 0.5 });   // 匣底識別
    mkFingers(podP, -0.05, 0.06);
    return {
      gunR: { g: sgP, rest: 1.4, aim: 1.25 },                                    // 據槍水平 = 補回臂鏈合角
      gunL: { g: podP, rest: 1.4, aim: 1.25 },
      muzzles: { light: { n: lMuz, r: 0.07 }, heavy: { n: hMuz, r: 0.12 } },
      lightGlowM: [lMuz], heavyGlowM: [hMuz], heavyPivot: [],
      weap: { light: 'L', heavy: 'R' },
      hvy: { armR: 0.8, armL: 0.15, chest: -0.12 },
      aimPose: null,
      wpn: { light: { nodes: [podP], ref: podP, muz: lMuz, fwd: 'z' }, heavy: { nodes: [sgP], ref: sgP, muz: hMuz, fwd: 'z' } },
    };
  },
  extra(c, F, rig) {
    // 著地平衡尾(第三條腿):六節「位置編碼下垂」節鏈 —— locomotion whipTail 每幀
    // 覆寫尾節 rotation.x/y ⇒ 下垂曲線 MUST 住「節與節的位置差 + 節身自帶傾角」
    // (models.js roo mkTail 同款),chainF 的 rot0/rotD 在這裡會被抹平(語彙缺口已回報)。
    const TL = [0.8, 0.74, 0.67, 0.6, 0.52, 0.45];                               // 節長收分
    const TT = [0.32, 0.62, 0.98, 1.28, 1.12, 0.6];                              // 逐節下傾角(後掠 → 俯衝 → 貼地)
    const TR = [0.27, 0.235, 0.205, 0.175, 0.148, 0.12];                         // 節徑收分
    const segs = [];
    let cur = F.hips;
    for (let i = 0; i < 6; i++) {
      const grp = new THREE.Group();
      if (i === 0) grp.position.set(0, -0.16, -0.5);
      else grp.position.set(0, -TL[i - 1] * Math.sin(TT[i - 1]), -TL[i - 1] * Math.cos(TT[i - 1]));
      cur.add(grp);
      const dy = TL[i] * Math.sin(TT[i]), dz = TL[i] * Math.cos(TT[i]);
      const body = cylF(grp, TR[i] * 0.85, TR[i], TL[i], 9, 0, -dy / 2, -dz / 2, TSTEEL, { metalness: 0.55 });
      body.rotation.x = -(Math.PI / 2 + TT[i]);                                  // 節身沿本節弦向
      const ring = cylF(grp, TR[i] * 1.14, TR[i] * 1.14, 0.09, 9, 0, 0, 0, IRON, { metalness: 0.8 });
      ring.rotation.x = -(Math.PI / 2 + TT[i]);                                  // 節間關節環
      if (i < 3) {
        // 尾背鱗甲(前三節上緣的鏽橙甲片;法向 = 弦的上垂直)
        const nx = TR[i] + 0.03;
        const sc = tboxF(grp, { w0: TR[i] * 2.2, d0: TL[i] * 0.7, w1: TR[i] * 1.7, d1: TL[i] * 0.52, h: 0.09 },
          0, -dy / 2 + Math.cos(TT[i]) * nx, -dz / 2 - Math.sin(TT[i]) * nx, RUST, { metalness: 0.5 });
        sc.rotation.x = -TT[i];
      }
      if (i === 0) {
        // 尾根氣簧(第三條腿的緩衝機構:深色缸體 + 亮活塞桿,沿尾軸上緣)
        const n0 = TR[0] + 0.06, u = TT[0];
        const dk = cylF(grp, 0.03, 0.03, 0.38, 6, 0, Math.cos(u) * n0 - Math.sin(u) * 0.2, -Math.sin(u) * n0 - Math.cos(u) * 0.2, SPRING, { metalness: 0.85 });
        dk.rotation.x = -(Math.PI / 2 + u);
        const rd = cylF(grp, 0.016, 0.016, 0.38, 6, 0, Math.cos(u) * n0 - Math.sin(u) * 0.54, -Math.sin(u) * n0 - Math.cos(u) * 0.54, ROD, { metalness: 0.9 });
        rd.rotation.x = -(Math.PI / 2 + u);
      }
      if (i === 5) {
        // 尾端:收圓尾帽 + 著地墊(2D 尾梢貼地的圓端)
        const cap = latheF(grp, [[0.11, 0], [0.105, 0.07], [0.07, 0.14], [0.0001, 0.18]], 10, 0, -dy, -dz, TSTEEL, { metalness: 0.55 });
        cap.rotation.x = -(Math.PI / 2 + TT[i]);
        cylF(grp, 0.17, 0.14, 0.13, 9, 0, -dy - 0.11, -dz - 0.07, 0x3f444a, { metalness: 0.6 });
      }
      segs.push(grp);
      cur = grp;
    }
    rig.tailSegs = segs;
    rig.tailUp = 0.22;
    rig.hop = 1;           // 袋鼠跳:stepBiped 整套改走 stepHop
    rig.hopLean = 0.85;
    rig.hopH = 0.75;
    rig.leanF = 0.5;
  },
};
