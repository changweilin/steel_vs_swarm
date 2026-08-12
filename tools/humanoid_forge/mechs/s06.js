// ============ s06 逐機零件檔(dev-only;仿生四足 D.kind 'quad' + rider)============
// ── s06「輓歌」凱隆式護衛機甲(centaur 半人馬):四足底盤 + 人形上身雙手據長槍 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s06_{static,moving,heavy}.png(★ = s06_moving)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(照 ★ 圖逐部位):
//   騎士 = 方稜盔(紅色橫縫視窗)+ 背包塔雙天線 + 疊節腹甲;雙手真的扶在槍身上 ——
//   armBase 靜姿角由兩節鏈 IK 反解(肩 rot x/y/z + 肘 rot x;y 是靜態自由度,
//   stepQuad rider 分支只寫 x/z),右手扣握把、左手前伸托護木。
//   步槍 = 反器材軌道狙擊槍:tboxF 機匣/槍托/箱型制退器 + latheF 瞄準鏡(物鏡發光)
//   + 開槽護木(INK 嵌條)+ latheF 長管 + 摺疊腳架 + 下插彈匣。
//   馬軀 = prismF 前胸六角擋甲 + 鞍側彈袋 + 胸腹接合環 + 側裙甲 + 腹下纜束;
//   臀部照 s06_heavy 補:背脊鋸齒鰭列(finF 一片一件)+ 煙幕發射管束 + 排氣塔。
//   馬腿 ×4 = prismF 大六角股甲(latheF 圓盤徽 + INK 槽線)+ 楔台股 + 細楔台管骨
//   + latheF 球節圓盤 + 楔台蹄(COAL);尾 = chainF 五節收分短尾。
//   迷彩塗裝是 paint 層不是幾何(已知偏差)。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:視窗紅(★ 圖頭部紅色橫縫;武器發光仍走 c.accent)
const RED = 0xff2f3c;

export default {
  label: '輓歌・凱隆式(s06 機甲・半人馬)', hue: 0xb9c7ff, kind: 'quad', height: 5.2,
  frame: {
    hipY: 2.2, legX: 0.6, fz: 1.0, hz: -1.2,
    chest: [0, 0.1, 0.55],
    neck: [0, 0.62, 0.55],              // 騎士腰樞軸(馬肩正上方)
    head: [0, 0.3, 0],                  // rider 分支不用(head 由 D.rider 回傳)
    tailY: 0.05, tailZ: -1.62, tail2Z: 0.7,
  },
  gait: { gait: 'trot', gallopType: 'transverse', stride: 2.8, top: 7, bob: 0.09, pitchAmp: 0.08 },
  moveSig: { poise: 0.97, idleF: 0.58, idleA: 0.35, launch: 0.48, spool: 0.55, brake: 0.55, settle: 0.70 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['馬軀(四足底盤)', 'tboxF 前後兩段殼+prismF 前胸六角擋甲+latheF 胸腹接合環+鞍側彈袋 ×2+側裙甲+腹下 cablesF 管束'],
    ['馬臀(heavy 圖)', 'finF 背脊鋸齒鰭 ×6(一片一件,索引遞變)+煙幕發射管束 ×4+排氣塔+斜臀殼'],
    ['馬腿 ×4(股→管骨→球節→蹄)', 'prismF 大六角股甲(latheF 圓盤徽+INK 槽線)+楔台股+hydCyl 阻尼+細楔台管骨+latheF 膝/球節圓盤+楔台蹄(COAL)'],
    ['騎士上身(腰→胸→頸→頭)', 'latheF 腰迴轉環+彈袋+慣性艙;tboxF 收分胸艙+prismF 雙胸甲+疊節腹甲;方稜盔+RED 橫縫視窗+背包塔雙天線(noOutline)'],
    ['雙臂據槍(armSh/armEl)', 'armBase = IK 反解靜姿角:右手扣握把、左手前伸托護木;latheF 肘盤+楔台臂殼+掌/指塊'],
    ['武裝(精準軌道步槍)', 'tboxF 機匣/槍托/箱型制退器+latheF 瞄準鏡(物鏡=蓄力發光)+開槽護木+latheF 長管+摺疊腳架+下插彈匣;輕=管口環、重=制退器膛口'],
    ['尾', 'chainF 五節收分短尾(垂掛)+latheF 尾根環'],
  ],
  body(c, spine, chest) {
    const { PAL, accent } = c;
    // ── 後軀(spine):主殼 + 斜臀殼(★ 臀部往尾根斜收)──
    tboxF(spine, { w0: 0.92, d0: 1.55, w1: 0.78, d1: 1.25, h: 0.78, sz: -0.10 }, 0, 0.02, -0.72, PAL.mid, { metalness: 0.55 });
    const rump = tboxF(spine, { w0: 0.72, d0: 0.5, w1: 0.52, d1: 0.34, h: 0.44, sz: -0.08 }, 0, 0.16, -1.48, PAL.mid, { metalness: 0.55 });
    rump.rotation.x = -0.62;
    // 背脊鋸齒鰭列(s06_heavy:臀背一排小鰭;一片一件、長度索引遞變)
    for (let i = 0; i < 6; i++) {
      const fn = finF(spine, { len: 0.13 + 0.05 * Math.sin(Math.PI * (i + 0.5) / 6), w0: 0.09, w1: 0.022, t: 0.032, sweep: 0.05 },
        0, 0.36, -0.38 - i * 0.19, PAL.deep, { metalness: 0.6 });
      fn.rotation.x = -0.85 - i * 0.05;
    }
    // 鞍掛備彈箱 ×2(後腿髖甲外上方)+ 蓋板 + 識別條
    for (const sx of [-1, 1]) {
      tboxF(spine, { w0: 0.2, d0: 0.82, w1: 0.18, d1: 0.74, h: 0.4 }, sx * 0.56, 0.14, -0.62, PAL.dark, { metalness: 0.5 });
      tboxF(spine, { w0: 0.22, d0: 0.86, w1: 0.18, d1: 0.78, h: 0.08 }, sx * 0.56, 0.38, -0.62, PAL.deep, { metalness: 0.6 });
      bxF(spine, 0.03, 0.05, 0.5, sx * 0.66, 0.2, -0.62, dimF(accent, 0.8), { emissive: accent, emissiveIntensity: 0.4 });
    }
    // 煙幕發射管束 ×4(heavy 圖臀右後;2×2 束、朝後上)+ 座
    const lb = tboxF(spine, { w0: 0.2, d0: 0.24, w1: 0.18, d1: 0.2, h: 0.2 }, 0.3, 0.3, -1.32, PAL.deep, { metalness: 0.6 });
    lb.rotation.x = -0.95;
    for (const [ox, oy] of [[-0.055, -0.05], [0.055, -0.05], [-0.055, 0.05], [0.055, 0.05]]) {
      const tb = cylF(spine, 0.042, 0.045, 0.4, 8, 0.3 + ox, 0.38 + oy * 0.4, -1.42 + oy, INK, { metalness: 0.7 });
      tb.rotation.x = -0.95;
    }
    // 排氣塔(heavy 圖臀左後:直立煙囪 + 頸環)
    const ex = cylF(spine, 0.055, 0.07, 0.46, 8, -0.33, 0.5, -1.26, IRON, { metalness: 0.75 });
    ex.rotation.x = -0.22;
    const exr = torusF(spine, 0.075, 0.018, -0.33, 0.68, -1.30, COAL, { metalness: 0.7 });
    exr.rotation.x = Math.PI / 2 - 0.22;
    // ── 前軀(chest):主殼 + prismF 前胸六角擋甲 + 接合環 + 鞍座 ──
    tboxF(chest, { w0: 1.0, d0: 1.35, w1: 0.88, d1: 1.1, h: 0.82, sz: 0.05 }, 0, 0.02, 0.05, PAL.mid, { metalness: 0.55 });
    const bp = prismF(chest, [[-0.45, -0.32], [0.45, -0.32], [0.59, 0.06], [0.38, 0.41], [-0.38, 0.41], [-0.59, 0.06]],
      0.1, 0, 0.05, 0.72, PAL.main, { metalness: 0.5 });
    bp.rotation.x = -0.12;
    // 鞍座(騎士腰 ring 與馬背之間的接坡;★ 上身自馬肩「長出來」不是懸空)
    tboxF(chest, { w0: 0.72, d0: 0.72, w1: 0.58, d1: 0.56, h: 0.26 }, 0, 0.5, 0.55, PAL.mid, { metalness: 0.55 });
    bxF(chest, 0.5, 0.05, 0.03, 0, 0.32, 0.79, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 胸腹接合環(蓋住脊椎波張縫;latheF 軸轉 z)
    const col = latheF(chest, [[0.55, -0.26], [0.60, -0.16], [0.60, 0.16], [0.55, 0.26]], 12, 0, 0.02, -0.6, dimF(PAL.main, 0.85), { metalness: 0.6 });
    col.rotation.x = Math.PI / 2;
    // 鞍側彈袋 ×2(★ 騎士腰前的馬背彈袋)+ 蓋扣
    for (const sx of [-1, 1]) {
      tboxF(chest, { w0: 0.3, d0: 0.42, w1: 0.26, d1: 0.36, h: 0.3, sz: 0.02 }, sx * 0.5, 0.56, 0.3, PAL.dark, { metalness: 0.45 });
      tboxF(chest, { w0: 0.32, d0: 0.44, w1: 0.26, d1: 0.38, h: 0.09 }, sx * 0.5, 0.74, 0.3, PAL.deep, { metalness: 0.55 });
    }
    // 側裙甲 ×2/側(腹側垂板,微外傾)
    for (const sx of [-1, 1]) for (const [zz, g] of [[0.35, chest], [-0.15, chest]]) {
      const sk = tboxF(g, { w0: 0.07, d0: 0.55, w1: 0.07, d1: 0.46, h: 0.42 }, sx * 0.56, -0.38, zz, PAL.mid, { metalness: 0.55 });
      sk.rotation.z = sx * 0.12;
    }
    // 腹下機構(GUNMETAL)+ 液壓管束(cablesF 一條一件,垂向後軀)
    tboxF(chest, { w0: 0.6, d0: 0.95, w1: 0.68, d1: 1.05, h: 0.3 }, 0, -0.55, 0.0, GUNMETAL, { metalness: 0.7 });
    cablesF(chest, { p0: [0, -0.5, 0.5], p1: [0, -0.45, -1.15], k: 3, r: 0.024, sag: 0.09, spread: 0.06 }, GUNMETAL, { metalness: 0.6 });
    // 前胸識別燈 ×2
    for (const sx of [-1, 1]) bxF(chest, 0.05, 0.05, 0.03, sx * 0.34, -0.2, 0.76, accent, { emissive: accent, emissiveIntensity: 0.6 });
  },
  neckHead() { /* rider 分支:上身住 D.rider */ },
  rider(c, neck) {
    const { PAL, accent } = c;
    // ── 腰(neck = 腰樞軸):迴轉環 + 腰塊 + 彈袋 + 慣性艙 ──
    latheF(neck, [[0.40, -0.05], [0.45, 0.0], [0.40, 0.06]], 12, 0, -0.02, 0, PAL.deep, { metalness: 0.75 });
    tboxF(neck, { w0: 0.56, d0: 0.46, w1: 0.64, d1: 0.52, h: 0.34 }, 0, 0.16, 0, PAL.mid, { metalness: 0.55 });
    for (const sx of [-1, 1]) tboxF(neck, { w0: 0.16, d0: 0.1, w1: 0.14, d1: 0.09, h: 0.22 }, sx * 0.26, 0.16, 0.26, PAL.dark, { metalness: 0.5 });
    const gy = cylF(neck, 0.09, 0.09, 0.24, 10, 0, 0.1, 0.3, INK, { metalness: 0.85 });
    gy.rotation.x = Math.PI / 2;
    const gr = cylF(neck, 0.095, 0.095, 0.04, 10, 0, 0.1, 0.3, accent, { emissive: accent, emissiveIntensity: 0.7 });
    gr.rotation.x = Math.PI / 2;
    // ── 胸(humChest):收分胸艙 + prismF 雙胸甲 + 疊節腹甲 + 領環 ──
    const humChest = new THREE.Group();
    humChest.position.y = 0.45;
    neck.add(humChest);
    tboxF(humChest, { w0: 0.6, d0: 0.48, w1: 0.88, d1: 0.6, h: 0.66, sz: 0.04 }, 0, 0.3, 0, PAL.main, { metalness: 0.5 });
    for (const sx of [-1, 1])
      prismF(humChest, [[-0.14, -0.16], [0.14, -0.13], [0.20, 0.02], [0.13, 0.16], [-0.13, 0.18], [-0.19, 0.03]].map(([x, y]) => [sx * x, y]),
        0.07, sx * 0.17, 0.42, 0.30, PAL.lite, { metalness: 0.5 });
    tboxF(humChest, { w0: 0.5, d0: 0.12, w1: 0.42, d1: 0.1, h: 0.12 }, 0, -0.0, 0.2, PAL.mid, { metalness: 0.55 });
    tboxF(humChest, { w0: 0.44, d0: 0.11, w1: 0.38, d1: 0.09, h: 0.1 }, 0, -0.11, 0.18, PAL.deep, { metalness: 0.6 });
    const cl = torusF(humChest, 0.16, 0.03, 0, 0.66, 0.02, PAL.deep, { metalness: 0.7 });
    cl.rotation.x = Math.PI / 2;
    bxF(humChest, 0.3, 0.05, 0.03, 0, 0.5, 0.33, accent, { emissive: accent, emissiveIntensity: 0.8 });
    // 背包塔(★ 頭後方雙層背包 + 高低雙天線)+ 纜線垂到槍側(cablesF 一條一件)
    tboxF(humChest, { w0: 0.55, d0: 0.28, w1: 0.5, d1: 0.24, h: 0.55, sz: -0.04 }, 0, 0.38, -0.38, PAL.mid, { metalness: 0.55 });
    tboxF(humChest, { w0: 0.4, d0: 0.24, w1: 0.34, d1: 0.2, h: 0.26 }, 0, 0.78, -0.36, PAL.deep, { metalness: 0.6 });
    bxF(humChest, 0.3, 0.05, 0.02, 0, 0.5, -0.51, RED, { emissive: RED, emissiveIntensity: 0.5 });
    for (const [ax, h0, az] of [[0.14, 0.6, -0.34], [0.24, 0.4, -0.42]]) {
      const an = cylF(humChest, 0.008, 0.008, h0, 5, ax, 0.9 + h0 / 2, az, IRON, { metalness: 0.8 });
      an.userData.noOutline = true;
    }
    cablesF(humChest, { p0: [0.2, 0.5, -0.3], p1: [0.16, 0.2, 0.4], k: 2, r: 0.018, sag: 0.12, spread: 0.02 }, GUNMETAL, { metalness: 0.5 });
    // ── 頸 + 頭(方稜盔;★ 紅色橫縫視窗)──
    const humNeck = new THREE.Group();
    humNeck.position.y = 0.72;
    humChest.add(humNeck);
    cylF(humNeck, 0.1, 0.12, 0.14, 8, 0, 0.03, 0, PAL.deep, { metalness: 0.7 });
    cablesF(humNeck, { p0: [0, 0.1, -0.06], p1: [0, -0.06, -0.12], k: 3, r: 0.012, sag: 0.01, spread: 0.04 }, GUNMETAL, { metalness: 0.6 });
    const head = new THREE.Group();
    head.position.y = 0.2;
    humNeck.add(head);
    tboxF(head, { w0: 0.3, d0: 0.3, w1: 0.36, d1: 0.32, h: 0.26, sz: 0.02 }, 0, 0.08, 0, PAL.main, { metalness: 0.5 });
    tboxF(head, { w0: 0.36, d0: 0.14, w1: 0.3, d1: 0.1, h: 0.07, sz: 0.03 }, 0, 0.225, 0.1, PAL.mid, { metalness: 0.55 });
    prismF(head, [[-0.13, -0.10], [0.13, -0.10], [0.15, 0.06], [-0.15, 0.06]], 0.05, 0, 0.05, 0.16, INK, { metalness: 0.4 });
    bxF(head, 0.22, 0.035, 0.02, 0, 0.09, 0.19, RED, { emissive: RED, emissiveIntensity: 1.6 });
    bxF(head, 0.18, 0.025, 0.02, 0, 0.035, 0.19, RED, { emissive: RED, emissiveIntensity: 1.1 });
    tboxF(head, { w0: 0.2, d0: 0.1, w1: 0.24, d1: 0.12, h: 0.1 }, 0, -0.07, 0.12, PAL.deep, { metalness: 0.6 });
    for (const sx of [-1, 1]) {
      bxF(head, 0.05, 0.12, 0.16, sx * 0.17, 0.02, 0.06, PAL.deep, { metalness: 0.6 });
      bxF(head, 0.04, 0.04, 0.02, sx * 0.16, 0.16, 0.14, RED, { emissive: RED, emissiveIntensity: 0.7 });
    }
    tboxF(head, { w0: 0.1, d0: 0.14, w1: 0.09, d1: 0.12, h: 0.05 }, 0, 0.245, -0.02, PAL.deep, { metalness: 0.6 });
    // ── 雙臂(armSh/armEl;armBase = IK 反解的據槍靜姿角)──
    // 兩節鏈 IK(肩 rot x/y/z、肘 rot x;上臂 0.55、前臂 0.5):
    //   右手目標 = 握把 (0.10, 0.30, 0.20)、左手目標 = 護木 (0.06, 0.34, 0.82)(humChest 框)。
    //   rotation.y 是靜態自由度(stepQuad rider 分支只寫 x/z)⇒ 建構時寫死。
    const IK = [
      { shX: -1.485, shY: 0.873, shZ: 0.519, elX: -0.587 },   // sx −1:左手前伸托護木
      { shX: 0.211, shY: -1.249, shZ: 0.481, elX: -2.132 },   // sx +1:右手後收扣握把
    ];
    const armSh = [], armEl = [], armBase = [];
    for (const sx of [-1, 1]) {
      const k = IK[sx < 0 ? 0 : 1];
      // 墊肩掛 humChest(靜態;掛 armSh 會被 IK 靜姿角帶歪成翅膀 —— v1 實測)
      const pd = tboxF(humChest, { w0: 0.32, d0: 0.36, w1: 0.24, d1: 0.3, h: 0.2, sx: sx * 0.04 }, sx * 0.54, 0.7, 0, PAL.main, { metalness: 0.5 });
      pd.rotation.z = -sx * 0.15;
      const sh = new THREE.Group();
      sh.position.set(sx * 0.46, 0.6, 0);
      humChest.add(sh);
      tboxF(sh, { w0: 0.15, d0: 0.17, w1: 0.2, d1: 0.22, h: 0.5 }, 0, -0.28, 0, PAL.mid, { metalness: 0.55 });
      const el = new THREE.Group();
      el.position.y = -0.55;
      sh.add(el);
      const ed = latheF(el, [[0.02, -0.03], [0.08, -0.024], [0.09, 0], [0.08, 0.024], [0.02, 0.03]], 10, sx * 0.09, 0, 0, PAL.deep, { metalness: 0.8 });
      ed.rotation.z = Math.PI / 2;
      tboxF(el, { w0: 0.11, d0: 0.13, w1: 0.15, d1: 0.17, h: 0.42 }, 0, -0.24, 0, PAL.mid, { metalness: 0.55 });
      // 掌 + 指塊 + 拇指(前折包住槍身;細部由截圖迭代)
      tboxF(el, { w0: 0.11, d0: 0.13, w1: 0.1, d1: 0.14, h: 0.1 }, 0, -0.5, 0.01, PAL.deep, { metalness: 0.6 });
      const fg = tboxF(el, { w0: 0.1, d0: 0.05, w1: 0.09, d1: 0.04, h: 0.12 }, 0, -0.56, 0.06, PAL.deep, { metalness: 0.6 });
      fg.rotation.x = -1.1;
      const th = tboxF(el, { w0: 0.04, d0: 0.04, w1: 0.035, d1: 0.035, h: 0.09 }, sx * -0.05, -0.53, 0.05, PAL.deep, { metalness: 0.6 });
      th.rotation.z = sx * 0.7;
      sh.rotation.set(k.shX, k.shY, k.shZ);
      el.rotation.x = k.elX;
      armSh.push(sh); armEl.push(el); armBase.push({ shX: k.shX, shZ: k.shZ, elX: k.elX });
    }
    // ── 據槍(反器材軌道狙擊槍;槍身沿 +z,gunPitch 每幀寫 rotation.x:rest 微揚 ↔ aim 水平)──
    const gun = new THREE.Group();
    gun.position.set(0.10, 0.46, 0.25);
    humChest.add(gun);
    // 機匣 + 頂軌
    tboxF(gun, { w0: 0.16, d0: 1.1, w1: 0.14, d1: 1.05, h: 0.22 }, 0, 0, -0.05, GUNMETAL, { metalness: 0.8 });
    bxF(gun, 0.1, 0.05, 0.9, 0, 0.135, -0.1, INK, { metalness: 0.7 });
    // 槍托(托身 + 貼腮墊 + 托底板)
    tboxF(gun, { w0: 0.12, d0: 0.5, w1: 0.1, d1: 0.42, h: 0.18 }, 0, -0.02, -0.82, PAL.deep, { metalness: 0.6 });
    bxF(gun, 0.09, 0.07, 0.3, 0, 0.12, -0.75, PAL.dark, { metalness: 0.5 });
    tboxF(gun, { w0: 0.13, d0: 0.09, w1: 0.11, d1: 0.09, h: 0.26 }, 0, 0.0, -1.1, INK, { metalness: 0.6 });
    // 握把 + 護圈(薄件 noOutline)+ 下插彈匣
    const pg = tboxF(gun, { w0: 0.07, d0: 0.12, w1: 0.06, d1: 0.1, h: 0.16 }, 0, -0.17, -0.08, INK, { metalness: 0.5 });
    pg.rotation.x = 0.35;
    const tg = torusF(gun, 0.055, 0.012, 0, -0.13, 0.03, INK, { metalness: 0.5 });
    tg.rotation.y = Math.PI / 2;
    tg.userData.noOutline = true;
    const mg = tboxF(gun, { w0: 0.09, d0: 0.24, w1: 0.08, d1: 0.2, h: 0.24, sz: 0.05 }, 0, -0.2, 0.22, INK, { metalness: 0.6 });
    mg.rotation.x = 0.15;
    // 瞄準鏡(latheF 目鏡/鏡身/物鏡鐘;★ 圖鏡體粗大醒目)+ 環座 ×2 + 物鏡發光(= 蓄力發光)
    const sc = latheF(gun, [[0.068, 0], [0.068, 0.14], [0.052, 0.2], [0.052, 0.44], [0.082, 0.56], [0.082, 0.72]], 10, 0, 0.27, -0.15, INK, { metalness: 0.8 });
    sc.rotation.x = Math.PI / 2;
    for (const zz of [0.0, 0.28]) {
      const rg = torusF(gun, 0.06, 0.014, 0, 0.27, zz, GUNMETAL, { metalness: 0.8 });
      rg.userData.noOutline = true;
      bxF(gun, 0.045, 0.1, 0.06, 0, 0.2, zz, GUNMETAL, { metalness: 0.8 });
    }
    const sLens = cylF(gun, 0.072, 0.072, 0.02, 10, 0, 0.27, 0.58, accent, { emissive: accent, emissiveIntensity: 0.8 });
    sLens.rotation.x = Math.PI / 2;
    // 雷射測距儀(鏡右側小盒)
    bxF(gun, 0.06, 0.06, 0.14, 0.1, 0.2, 0.3, PAL.deep, { metalness: 0.7 });
    // 開槽護木(★ 長條散熱槽 = INK 嵌條 ×3/側)+ 摺疊腳架(收攏沿管前指)
    tboxF(gun, { w0: 0.13, d0: 0.85, w1: 0.11, d1: 0.8, h: 0.16 }, 0, 0.0, 0.95, GUNMETAL, { metalness: 0.75 });
    for (const sx of [-1, 1]) for (const zz of [0.72, 0.95, 1.18])
      bxF(gun, 0.015, 0.06, 0.17, sx * 0.062, 0.0, zz, INK, { metalness: 0.4 });
    for (const sx of [-1, 1]) {
      const bl = tboxF(gun, { w0: 0.035, d0: 0.035, w1: 0.03, d1: 0.03, h: 0.5 }, sx * 0.07, -0.09, 1.28, IRON, { metalness: 0.8 });
      bl.rotation.x = -1.35;
    }
    // 長管(latheF 兩階)→ 輕模式管口環 → 箱型制退器(側翼板 ×2)→ 重模式膛口環
    const br = latheF(gun, [[0.045, 0], [0.045, 0.55], [0.038, 0.6], [0.038, 1.15]], 10, 0, 0.02, 1.37, GUNMETAL, { metalness: 0.85 });
    br.rotation.x = Math.PI / 2;
    const lMuz = latheF(gun, [[0.036, -0.02], [0.05, -0.008], [0.05, 0.008], [0.036, 0.02]], 10, 0, 0.02, 2.54, accent, { emissive: accent, emissiveIntensity: 0.9 });
    lMuz.rotation.x = Math.PI / 2;
    tboxF(gun, { w0: 0.13, d0: 0.34, w1: 0.12, d1: 0.32, h: 0.16 }, 0, 0.02, 2.74, INK, { metalness: 0.8 });
    for (const zz of [2.63, 2.79]) bxF(gun, 0.21, 0.13, 0.05, 0, 0.02, zz, COAL, { metalness: 0.8 });
    const hMuz = latheF(gun, [[0.034, -0.018], [0.054, -0.006], [0.054, 0.006], [0.034, 0.018]], 10, 0, 0.02, 2.93, accent, { emissive: accent, emissiveIntensity: 1.4 });
    hMuz.rotation.x = Math.PI / 2;
    c._gun = gun; c._lMuz = lMuz; c._hMuz = hMuz; c._sLens = sLens;
    return { humChest, humNeck, head, armSh, armEl, armBase, gunR: { g: gun, rest: -0.12, aim: 0 } };
  },
  legF(c) { return this._leg(c, 1); },
  legH(c) { return this._leg(c, -1); },
  // 馬腿:股 → 管骨 → 球節 → 蹄(base/k/d 同 models.js centaur 分支;幾何照 ★ 圖:
  // 大六角股甲板 + 圓盤徽、細瘦深色管骨、圓盤球節、深色楔台蹄)
  _leg(c, S) {
    const { PAL, sx, front } = c;
    const ps = front ? 0.95 : 1.12;                                 // 後腿股甲更大(★ 臀甲)
    return [
      { len: 1.0, draw: (l) => {
        tboxF(l, { w0: 0.24, d0: 0.3, w1: 0.34, d1: 0.42, h: 0.95 }, 0, -0.48, front ? 0.02 : -0.04, PAL.mid, { metalness: 0.55 });
        const pl = prismF(l, [[-0.2, -0.36], [0.14, -0.4], [0.3, -0.1], [0.26, 0.24], [-0.06, 0.34], [-0.3, 0.14]].map(([x, y]) => [x * ps, y * ps]),
          0.07, sx * 0.26, -0.3, 0, PAL.main, { metalness: 0.5 });
        pl.rotation.y = sx * Math.PI / 2;
        const dk = latheF(l, [[0.02, -0.035], [0.11, -0.028], [0.125, 0], [0.11, 0.028], [0.02, 0.035]], 10, sx * 0.31, -0.28, 0.02, PAL.deep, { metalness: 0.8 });
        dk.rotation.z = Math.PI / 2;
        bxF(l, 0.012, 0.05, 0.16, sx * 0.345, -0.28, 0.02, INK, { metalness: 0.4 });
        hydCyl(l, 0.035, 0.5, -sx * 0.06, -0.62, front ? -0.17 : 0.17, front ? 0.3 : -0.3, BONE);
      } },
      { len: 0.66, base: S * 0.34, k: S * 0.5, d: 0.15, draw: (l) => {
        tboxF(l, { w0: 0.12, d0: 0.15, w1: 0.17, d1: 0.2, h: 0.62 }, 0, -0.33, front ? -0.02 : 0.03, GUNMETAL, { metalness: 0.7 });
        const kd = latheF(l, [[0.02, -0.03], [0.085, -0.024], [0.095, 0], [0.085, 0.024], [0.02, 0.03]], 10, sx * 0.1, -0.02, 0, PAL.deep, { metalness: 0.8 });
        kd.rotation.z = Math.PI / 2;
        const hy = cylF(l, 0.02, 0.02, 0.4, 6, -sx * 0.02, -0.3, front ? -0.1 : 0.1, IRON, { metalness: 0.85 });
        hy.rotation.x = front ? 0.25 : -0.25;
      } },
      { len: 0.2, base: -S * 0.22, k: -S * 0.34, d: 0.45, draw: (l) => {
        const fd = latheF(l, [[0.02, -0.03], [0.09, -0.025], [0.1, 0], [0.09, 0.025], [0.02, 0.03]], 10, sx * 0.02, -0.06, 0.01, PAL.mid, { metalness: 0.75 });
        fd.rotation.z = Math.PI / 2;
        cylF(l, 0.07, 0.085, 0.2, 8, 0, -0.1, 0.01, PAL.deep, { metalness: 0.6 });
      } },
      { len: 0, base: 0, k: S * 0.18, d: 0.66, draw: (l) => {
        const ar = latheF(l, [[0.085, -0.03], [0.1, -0.01], [0.1, 0.01], [0.085, 0.03]], 10, 0, -0.02, 0.02, IRON, { metalness: 0.8 });
        ar.rotation.x = 0;
        tboxF(l, { w0: 0.3, d0: 0.34, w1: 0.2, d1: 0.24, h: 0.3, sz: -0.05 }, 0, -0.18, 0.02, COAL, { metalness: 0.6 });
      } },
    ];
  },
  tail(c, tail) {
    const { PAL } = c;
    // 尾根環 + chainF 六節收分短尾。垂掛角住**靜態中介 Group**(root)——
    // whipTail 每幀覆寫 segs 的 rotation.x(rot0/rotD 會被吃掉),root 不在 segs 裡才留得住。
    const tc = latheF(tail, [[0.06, -0.04], [0.1, -0.015], [0.1, 0.015], [0.06, 0.04]], 10, 0, 0, 0.02, PAL.deep, { metalness: 0.8 });
    tc.rotation.x = Math.PI / 2;
    const root = new THREE.Group();
    root.rotation.x = -0.95;                                       // 垂掛:節鏈 −z 轉成下後方
    tail.add(root);
    const { segs } = chainF(root, {
      n: 6, len0: 0.24, len1: 0.14, r0: 0.06, r1: 0.028,
      rot0: 0, rotD: 0, ring: true, ringColor: IRON, seg: 8,
    }, PAL.deep, { metalness: 0.55 });
    return segs;
  },
  mount(c, F) {
    // 步槍(輕 = 管口環、重 = 制退器膛口)已在 rider() 隨雙臂建好 —— 一把雙模,
    // 槍身俯仰唯一寫入者 = gunPitch(rig.gunR)⇒ heavyPivot MUST 留空。
    return {
      gunR: null, gunL: null,                                        // rig.gunR 由 rider 的回傳接手
      muzzles: { light: { n: c._lMuz, r: 0.08 }, heavy: { n: c._hMuz, r: 0.1 } },
      lightGlowM: [c._lMuz],
      heavyGlowM: [c._sLens, c._hMuz],                               // 蓄力:物鏡 + 膛口
      heavyPivot: [],
      weap: { light: 'B', heavy: 'B' },                              // 雙手持同一把(models.js centaur 同款)
      hvy: { armR: 0.06, armL: 0.06, chest: 0.05, gun: 0.07 },
      aimPose: null,
      wpn: {
        light: { nodes: [c._gun], ref: c._gun, muz: c._lMuz, fwd: 'z' },
        heavy: { nodes: [c._gun], ref: c._gun, muz: c._hMuz, fwd: 'z' },
      },
    };
  },
};
