// ============ t11 逐機零件檔(自 forge.js MECH_DETAIL 拆出;dev-only)============
// // ── t11「老兵」可變式戰術指導機(atlas):貨運掛架、指揮塔頭、旋翼盾、鉚接工業甲 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/t11_ground_static.jpg / t11_flight_static.jpg
// 幾何語彙一律取自 ../geo.js(多面體字母表);MUST NOT 在本檔自建 BufferGeometry。
// 語彙基調 = 「鉚接工業」:梯形楔台(tboxF)+ 鉚釘列 + 圓筒鼓(latheF)—— 2D 圖的每一塊
// 裝甲都是上寬下收(或上收下寬)的梯形斜面體,主殼一律楔台,圓件一律旋成體。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

export default {
  label: '老兵(t11 變形者・地面型)',
  prop: { hips: 0.5, legSplay: 0.115, thigh: 0.46, shin: 0.42, shoulderY: 0.78, shoulderX: 0.2, upperArm: 0.175, foreArm: 0.16, head: 0.9, girth: 1.15 },
  gait: { strideF: 1.35, bob: 0.13, sway: 0.1, top: 7, armBase: 0.1 },
  moveSig: { poise: 0.42, idleF: 0.68, idleA: 1.4, launch: 0.08, spool: 0.8, brake: 0.18, settle: 1.7 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [['head', '**等腰直角三角形**塔身(稜柱;尖端朝機首 = 飛行型的 B-2 機鼻)+兩腰上的並排雙觀察窗(一格裂痕貼膠帶)+帶簷頂圓塔(旋成體)+環列觀察鏡+鞭天線'], ['chest', '梯形鉚接大胸甲(楔台上寬下收)+六角面胸前板(稜柱斜切)+鉚釘列+豎直進氣柵+防滾籠'], ['肩甲(貨運掛架)×2', '**使用者說的肩甲就是這一片**:大平板托盤(頂面內舷端 = 武器硬點 wMt±)+欄杆+帆布捆(旋成體圓捆×2)+麻袋+油桶(帶箍環)+備胎(圓環體)+吊掛貨櫃+蜂群發射巢+無線電'], ['hips', '寬扁楔台骨盆+五角前擋板(稜柱)+後腰雙配重塊(警示條+圓環吊環)'], ['leg ×2', '短粗鉚接腿:楔台疊板(下段外擴)+圓筒膝鼓(旋成體)+六角螺栓蓋+大平足(楔台+趾板)'], ['arm ×2', '圓筒肩關節護甲(旋成體鼓+緣列鉚釘;**不是肩甲**,不掛武器)+臂側主翼板(薄刃鰭片+前緣識別條)+外露液壓'], ['hand ×2', '梯形拳+旋翼盤圓盾:碟形盤面(旋成體)+輪緣環(圓環體)+槳轂圓頂+中心孔環+四徑肋(一肋一件)'], ['武裝', '**兩具都坐在肩甲板面上、恆朝航向**:右架雙聯機槍莢(旋成體砲管帶膛口套)+左架集束布撒器(楔台斜切箱+2×3 發光膛口+尾纜束);轉向層與武器本體分兩層(重武器樞軸每幀回 rest)']],
  head(c, h) {
    const { PAL, accent, G } = c;
    // ── 塔身 = **等腰直角三角形**的垂直稜柱(2026-08-14 使用者:「頭部改成等腰直角三角形」)──
    // 三角形寫在**平面圖**上(局部 x = 橫向、z = 前後),尖端朝 +z:頂點 (0, TRI_A)、
    // 底角 (±TRI_A, 0) ⇒ 兩腰等長、頂角恰 90°(向量 (±A, −A) 內積 = 0)。
    // ⚠ 這一顆是**兩態共用**的同一個零件:地面型讀成「前面收成尖的車長指揮塔」(舊制那個
    //   梯形塔身本來就是「頂面後移 ⇒ 前面成斜面」,收到極限就是這個尖),飛行型的機身
    //   攤平之後它落在**機首**,平面圖上那個 90° 尖角就是 B-2 的機鼻(t11_flight 檔頭)。
    //   ⇒ 改這裡 MUST 兩座看板都看一次:一顆零件、兩張圖。
    // prismF 的多邊形在 XY、沿 z 擠出 ⇒ rotation.x = +π/2 把多邊形 +y 送到世界 +z(機首)、
    // 擠出軸送到 −y(塔高;擠出本就對中,方向不影響外廓)。
    const TRI_A = 0.26 * G;
    prismF(h, [[0, TRI_A], [TRI_A, 0], [-TRI_A, 0]], 0.42, 0, 0.06, -0.02, PAL.main, { metalness: 0.6 })
      .rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {
      // 並排雙觀察窗:**貼在兩片斜腰上**(舊制那兩片貼的是已經不存在的前斜面 ⇒ 會戳出尖角外)。
      // 腰的法線在平面圖上是 (±1, 1)/√2 ⇒ 繞 y 轉 ∓45° 才貼得平。
      const win = bxF(h, 0.13, 0.11, 0.025, sx * 0.115 * G, 0.14, 0.10, 0x8fa8b8, { metalness: 0.3 });
      win.rotation.set(0, -sx * Math.PI / 4, 0);
    }
    const tape = bxF(h, 0.055, 0.016, 0.03, 0.128 * G, 0.14, 0.115, 0x3a3f45);   // 裂痕貼膠帶(斜條)
    tape.rotation.set(0, -Math.PI / 4, 0.6);
    // ⚠ 頂上那一批件的 z **一律吃三角形的形心帶(≈ +0.06)而不是舊方盒的中心(−0.04)**:
    //   三角形的底邊在 z = −0.02、尖端在 +0.28 ⇒ 沿用舊 z 的話圓塔/艙蓋/天線有一半懸在
    //   塔身後面的空氣裡(靜態正視圖剛好看不出來,俯視與飛行型機首特寫一眼就是)。
    latheF(h, [[0.21, 0], [0.22, 0.02], [0.175, 0.05], [0.175, 0.16], [0.13, 0.2], [0.0001, 0.23]],
      12, 0, 0.28, 0.06, PAL.mid, { metalness: 0.6 });                           // 帶簷頂圓塔(旋成體)
    for (let i = 0; i < 5; i++) {
      const th = i / 5 * Math.PI * 2 + 0.4;
      bxF(h, 0.035, 0.03, 0.02, Math.cos(th) * 0.16, 0.4, 0.06 + Math.sin(th) * 0.16, 0x8fa8b8, { metalness: 0.3 });  // 環列觀察鏡
    }
    const hatch = tboxF(h, { w0: 0.14, d0: 0.13, w1: 0.12, d1: 0.11, h: 0.025 }, 0.04, 0.52, 0.02, PAL.deep);
    hatch.rotation.x = -0.35;                                                    // 半開小艙蓋
    const whip = cylF(h, 0.008, 0.015, 0.85, 5, -0.16 * G, 0.7, 0.02, IRON, { metalness: 0.8 });
    whip.rotation.z = -0.08;                                                     // 鞭狀長天線(全機最高)
    sphF(h, 0.02, -0.195 * G, 1.12, 0.02, 0xd8d4c8, { metalness: 0.4 });         // 天線球端
    for (let i = 0; i < 4; i++)
      bxF(h, 0.03, 0.03, 0.02, -0.17 * G + i * 0.11 * G, -0.12, -0.035, PAL.deep, { metalness: 0.7 });  // 塔身下緣鉚釘列(改貼**後**底邊)
    this.helmet(c, h);
  },

  /**
   * 三角型頭盔(2026-08-14 使用者:「旋翼艦**戴上三角型頭盔**,飛行時與雙臂角度一致,
   * 讓上視圖輪廓像 B2 轟炸機」)—— **兩態同一顆零件**,地面型是尖頭盔、飛行型是機鼻。
   *
   * 「與雙臂角度一致」不是一句形容,是**一條幾何約束**,而且要兩邊各出一半:
   *   ㋐ 盔是等腰直角三角形(頂角 90°)⇒ 兩腰各與中線夾 45°;
   *   ㋑ 飛行型的雙臂後掠角因此 MUST = π/2 − 90°/2 = π/4(t11_flight `ARM_SWEEP` 就是這樣導的)
   *      ⇒ 臂與腰**平行**。
   *   ㋒ 再讓兩條線**共線**:盔尖 MUST 擺在「兩腰延長線恰好穿過翼根(肩樞軸)」的位置 ——
   *      腰自盔尖以 45° 往後外走,走到 x = 肩寬時的 z MUST = 肩樞軸的 z
   *      ⇒ apex = shoulderX − (headYl − shoulderYl)。三個量全部由骨架尺寸推導,
   *        MUST NOT 手寫:改 prop 的頭高/肩高/肩寬之後,手寫的盔尖會靜默錯位,
   *        而正視圖與側視圖都看不出來 —— 只有俯視的那條前緣會斷成兩截。
   * 盔**不遮頂圓塔與天線**(它們自盔頂穿出 = B-2 鼻背的座艙鼓包),三層錐台收分。
   *
   * ── 戴法有兩種(2026-08-14 使用者:「地面型態時,**臉要露出來**,頭盔三角形**頂角朝上**,
   *    類似日本武士頭盔的戴法」)──
   *   地面 = 兜(kabuto):整片繞 x 轉到**近垂直**,尖端朝上後方成前立/鍬形,三層由前往後疊
   *     (最寬的下簷在前 = 眉庇/吹返、冠頂在後 = 缽體),而塔身兩片斜腰上的觀察窗全露在盔沿
   *     之下 = 臉;
   *   飛行 = 機鼻:整片放平、尖端朝航向(上一輪那個姿態,逐位元不動)。
   * ⚠ 兩種戴法**共用同一組零件**,差的只有這個 pivot 的一組角度與位置(同 rotorDisc 的作法);
   *   為地面另畫一頂盔的話,飛行型的機鼻與地面型的盔會各自演化,而兩張圖分開看都正常。
   * ⚠ 尖朝上要的是 **|rotation.x| > π/2**:Rx(a)·(0,0,1) = (0, −sin a, cos a),z 分量要為負
   *   (尖端往**後**仰)才戴得住;寫成 −1.23(< π/2)是尖端朝上**前**方 = 一支往前戳的角。
   */
  helmet(c, h) {
    const { PAL, accent } = c;
    const D = c.dims || {};
    const HX = D.shoulderX ?? 1.24, GAP = (D.headYl ?? 2.4) - (D.shoulderYl ?? 1.68);
    const APEX = HX - GAP;                        // 盔尖(盔自己的框);兩腰延長線恰過翼根
    const hg = new THREE.Group();                 // 戴法 pivot(兩態同一組零件,只換這一組角度)
    h.add(hg);
    const tri = (hw, depth, y, col, opts) => {    // 等腰直角:底半寬 hw ⇒ 尖端在底邊前方 hw 處
      const base = APEX - hw;
      // 多邊形寫在 XY、沿 z 擠出 ⇒ rotation.x = +π/2 把多邊形 +y 送到盔的尖端方向、擠出軸送到層厚
      prismF(hg, [[0, APEX], [hw, base], [-hw, base]], depth, 0, y, 0, col, opts).rotation.x = Math.PI / 2;
    };
    // 下層半寬取**肩寬的八成**:再小的話盔的兩腰與雙臂之間會空出一截機身側緣(那條步階正是
    // 「上視輪廓不像 B-2」的來源),再大就變成一頂比肩還寬的帽子(地面型讀不出是頭盔)。
    const HW = HX * 0.8;
    // 三層收分的錐台盔:下簷是**俯視那條前緣**(飛行型看的就是它),中段與冠頂讓**側視**
    // 讀得出是一頂盔而不是一片板(地面型看的是這個)—— 一層平板兩張圖只滿足得了一張。
    tri(HW, 0.20, 0.10, PAL.mid, { metalness: 0.62 });                       // 下簷
    tri(HW * 0.72, 0.22, 0.29, PAL.main, { metalness: 0.6 });                // 中段
    tri(HW * 0.42, 0.24, 0.50, PAL.mid, { metalness: 0.66 });                // 冠頂(頂圓塔自此穿出)
    // 前緣識別條(貼兩腰):腰的方向是「底角 → 盔尖」= (−sx, +1)/√2 ⇒ Ry(−sx·π/4)
    // (寫成 +sx 的話條子會落在另一條對角線上 —— 兩腰對稱,靜態正視圖看不出差別)
    for (const sx of [-1, 1]) {
      const st = bxF(hg, 0.05, 0.06, HW * Math.SQRT2 * 0.92, sx * HW * 0.5, 0.14, APEX - HW * 0.5,
        dimF(accent, 0.85), { emissive: accent, emissiveIntensity: 0.55 });
      st.rotation.y = -sx * Math.PI / 4;
    }
    // ── 戴法(檔頭)──
    if (c.noseHelm) hg.position.set(0, 0.04, 0);  // 飛行:放平朝航向 = 機鼻(y 只把盔壓回塔身高度)
    else {
      // 地面:兜。轉軸 −1.92 ⇒ 尖端 (0, 0.94, −0.34) 朝上後方、層厚方向 (0, −0.34, −0.94) 往後疊
      // ⇒ 下簷在**前上**、冠頂在**後**。位置往上後方讓開塔身正面 —— 觀察窗(z 0.10、y 0.14)
      // 落在盔沿之下 ⇒ 臉露出來。
      hg.position.set(0, 0.30, -0.20);
      hg.rotation.x = -1.92;
    }
  },
  chest(c, ch, d) {
    const { PAL, accent, G } = c;
    const top = d.shoulderY, bot = d.waistY;
    // 主胸殼:上寬下收的梯形楔台(2D 胸甲肩線最寬、往腰收),頂面微前傾
    tboxF(ch, { w0: d.shoulderX * 1.18, d0: 0.72 * G, w1: d.shoulderX * 1.55, d1: 0.95 * G, h: top - bot + 0.3, sz: 0.04 },
      0, (top + bot) / 2 + 0.1, 0, PAL.main, { metalness: 0.6 });
    // 六角面胸前板(稜柱 + 斜切邊):2D 正面那塊有板縫的迷彩大甲板
    prismF(ch, [[-0.74, 0.5], [0.74, 0.5], [0.62, -0.1], [0.3, -0.52], [-0.3, -0.52], [-0.62, -0.1]],
      0.13, 0, (top + bot) / 2 + 0.15, 0.44 * G, PAL.mid, { metalness: 0.6, bevel: { t: 0.03, s: 0.03 } });
    bxF(ch, d.shoulderX * 1.1, 0.1, 0.05, 0, bot + 0.18, 0.44 * G, accent, { emissive: accent, emissiveIntensity: 1.0 });  // 胸前識別燈
    bxF(ch, d.shoulderX * 1.3, 0.03, 0.02, 0, (top + bot) / 2 - 0.28, 0.42 * G, PAL.deep);  // 橫向板縫
    for (const sx of [-1, 1])
      for (let i = 0; i < 4; i++)
        bxF(ch, 0.04, 0.04, 0.035, sx * 0.6, (top + bot) / 2 - 0.18 + i * 0.24, 0.44 * G + 0.075, PAL.deep, { metalness: 0.7 });  // 板縫鉚釘列(左右豎列)
    for (let i = 0; i < 4; i++)
      bxF(ch, 0.04, 0.04, 0.035, -0.45 + i * 0.3, (top + bot) / 2 + 0.58, 0.44 * G + 0.06, PAL.deep, { metalness: 0.7 });  // 胸板頂緣鉚釘橫列
    for (const sx of [-1, 1]) {                                                  // 豎直進氣柵(格框 + 三豎柵)
      tboxF(ch, { w0: 0.15, d0: 0.06, w1: 0.13, d1: 0.05, h: 0.44 }, sx * (d.shoulderX * 0.62), (top + bot) / 2 + 0.12, 0.46 * G, PAL.deep, { metalness: 0.5 });
      for (let i = 0; i < 3; i++)
        bxF(ch, 0.022, 0.38, 0.02, sx * (d.shoulderX * 0.62) + (i - 1) * 0.042, (top + bot) / 2 + 0.12, 0.48 * G, PAL.mid);
    }
    for (const sx of [-1, 1]) {                                                  // 防滾籠(駕駛位頂,斜撐)
      const bar = cylF(ch, 0.03, 0.03, 0.5, 6, sx * 0.18, top + 0.2, 0.1, IRON, { metalness: 0.8 });
      bar.rotation.x = 0.5;
      cylF(ch, 0.028, 0.028, 0.18, 6, sx * 0.18, top + 0.28, -0.12, IRON, { metalness: 0.8 });  // 後立柱
    }
    cylF(ch, 0.03, 0.03, 0.4, 6, 0, top + 0.3, 0.02, IRON, { metalness: 0.8 }).rotation.z = Math.PI / 2;  // 頂樑
    for (let i = 0; i < 3; i++)
      sphF(ch, 0.028, -0.12 + i * 0.12, top + 0.31, 0.05, 0xfff2b8, { emissive: 0xfff2b8, emissiveIntensity: 0.9 });  // 工作燈
    // 腰腹段(補上胸殼與骨盆之間的斷面;2D 的分段腰甲)
    tboxF(ch, { w0: 0.6 * G, d0: 0.46 * G, w1: 0.78 * G, d1: 0.58 * G, h: 0.52, sz: 0.02 }, 0, 0.44, 0, PAL.deep, { metalness: 0.6 });
    tboxF(ch, { w0: 0.52, d0: 0.5 * G, w1: 0.46, d1: 0.44 * G, h: 0.32 }, 0.08, top + 0.1, -0.4 * G, 0x6a6f5a, { metalness: 0.3 });  // 背馱貨箱
    const bk2 = tboxF(ch, { w0: 0.42, d0: 0.4 * G, w1: 0.36, d1: 0.34 * G, h: 0.26 }, -0.14, top + 0.04, -0.55 * G, 0x7a7360, { metalness: 0.3 });
    bk2.rotation.y = 0.12;                                                       // 第二箱(略歪)
    bxF(ch, 0.54, 0.03, 0.05, 0.08, top + 0.12, -0.4 * G, 0x3a3f45);             // 貨箱綁帶
    for (const sx of [-1, 1]) {                                                  // 雙側貨運掛架(滿載;長軸朝外 = 2D 的側伸托盤)
      // ── 肩甲 = 這一片(2026-08-15 使用者附圖:圈的就是它)──
      // 程式裡的歷史名字是「貨運掛架」,但使用者看到的是**肩上那塊大平板**,三條要求全落在它身上:
      //   ①「武器一律掛在肩甲**上方**」⇒ 兩具武器的硬點 `wMt±` 坐在托盤**頂面**(下方那一段);
      //   ②「變形時肩甲**平面保持平行地面**」+「**水平旋轉至平行雙臂**」⇒ 飛行型把整個 rack
      //      反解成**純偏航**(t11_flight;地面型本來就是水平的,一格不動);
      //   ③「**始終**轉向前方」⇒ 武器層登記進 `rig.stab` 逐幀鎖回機體航向(mount 那一段)。
      // ⚠ 肩關節上那顆圓筒鼓**不是**肩甲(2026-08-15 標色圖裁決)—— 它只是關節護甲。
      const rack = new THREE.Group();
      rack.name = sx > 0 ? 'rackR' : 'rackL';                                    // 取件錨(飛行型反解 + mount 取硬點)
      rack.position.set(sx * (d.shoulderX * 1.35), top + 0.16, 0);
      rack.rotation.z = sx * 0.06;
      ch.add(rack);
      if (sx > 0) c.rackR = rack; else c.rackL = rack;                           // mount 消費(不靠 children 掃描)
      const TRAY_H = 0.13;
      // 托盤另存一份參照:飛行型後掠之後要拿**它**(不是整個 rack)量離翼面多高 ——
      // 整個 rack 的包圍盒含吊掛貨櫃,底面在托盤下方 0.5m,拿它算會把肩甲抬到半空中。
      rack.userData.tray = tboxF(rack, { w0: 1.3, d0: 0.6 * G, w1: 1.24, d1: 0.55 * G, h: TRAY_H }, sx * 0.28, 0, 0, PAL.mid, { metalness: 0.6 });  // 肩甲托盤(楔台,往外伸)
      // 武器硬點:托盤**頂面**、擺在**內舷端**(那一段整條沒有貨物 ⇒ 武器真的坐在板上,
      // 不必為了閃開帆布捆而架在半空中)。高度由托盤自己的厚度推導(頂面 = h/2),MUST NOT 手寫。
      const wmt = new THREE.Group();
      wmt.name = sx > 0 ? 'wMtR' : 'wMtL';
      wmt.position.set(sx * -0.20, TRAY_H / 2, 0);
      rack.add(wmt);
      for (const oz of [-0.32, 0.32]) {
        const rail = cylF(rack, 0.015, 0.015, 1.26, 6, sx * 0.28, 0.17, oz, IRON, { metalness: 0.8 });
        rail.rotation.z = Math.PI / 2;                                           // 前後長欄杆
        cylF(rack, 0.012, 0.012, 0.15, 5, sx * 0.86, 0.1, oz, IRON, { metalness: 0.8 });  // 外端立柱
      }
      const rl2 = cylF(rack, 0.014, 0.014, 0.62, 5, sx * 0.9, 0.17, 0, IRON, { metalness: 0.8 });
      rl2.rotation.x = Math.PI / 2;                                              // 外端橫欄
      bxF(rack, 0.1, 0.05, 0.55, sx * 0.9, 0.03, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 臂端警示條
      const roll = latheF(rack, [[0.0001, -0.21], [0.11, -0.18], [0.14, -0.11], [0.14, 0.11], [0.11, 0.18], [0.0001, 0.21]],
        10, sx * 0.12, 0.2, 0.13, 0x7a7360, { metalness: 0.25 });
      roll.rotation.z = Math.PI / 2;                                             // 帆布大圓捆(旋成體,軸沿托盤)
      const sack = sphF(rack, 0.11, sx * (sx > 0 ? 0.38 : 0.26), 0.15, sx > 0 ? 0.17 : -0.24, 0x6f6753, { metalness: 0.2 });
      sack.scale.set(1.25, 0.72, 1.05);                                          // 麻袋(壓扁;左架讓位給布撒器移後)
      for (const ox of [0.04, 0.26])
        bxF(rack, 0.035, 0.02, 0.56, sx * ox, 0.34, 0.1, 0x3a3f45);              // 綁帶 ×2 跨捆
      if (sx > 0) {
        const roll2 = latheF(rack, [[0.0001, -0.15], [0.09, -0.12], [0.11, -0.07], [0.11, 0.07], [0.09, 0.12], [0.0001, 0.15]],
          10, sx * 0.5, 0.18, -0.16, 0x8a8168, { metalness: 0.25 });
        roll2.rotation.z = Math.PI / 2;                                          // 第二捆(小)
        latheF(rack, [[0.0001, 0], [0.12, 0.01], [0.13, 0.05], [0.13, 0.21], [0.12, 0.25], [0.0001, 0.26]],
          10, sx * 0.62, 0.07, 0.16, 0x4a4f42, { metalness: 0.5 });              // 油桶(直立,旋成體)
        for (const oy of [0.12, 0.2])
          torusF(rack, 0.135, 0.012, sx * 0.62, 0.07 + oy, 0.16, 0x3a3f45, { metalness: 0.7 }, Math.PI * 2).rotation.x = Math.PI / 2;  // 箍環 ×2
        const tire = torusF(rack, 0.17, 0.065, sx * 0.86, 0.28, -0.06, 0x2e3138, { metalness: 0.3 });
        tire.rotation.y = Math.PI / 2;                                           // 備胎(圓環體,直立面朝外)
        cylF(rack, 0.075, 0.075, 0.14, 8, sx * 0.86, 0.28, -0.06, 0x4a4f52, { metalness: 0.6 }).rotation.z = Math.PI / 2;  // 輪轂
        const nest = tboxF(rack, { w0: 0.27, d0: 0.21, w1: 0.24, d1: 0.18, h: 0.24 }, sx * 0.62, 0.1, -0.22, PAL.deep, { metalness: 0.6 });  // 蜂群發射巢(管口朝後,右架限定)
        for (const oy of [-0.05, 0.05]) for (const ox of [-0.06, 0.06])
          cylF(nest, 0.04, 0.04, 0.06, 8, ox, oy, -0.12, COAL, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      } else {
        const crate = tboxF(rack, { w0: 0.32, d0: 0.42, w1: 0.28, d1: 0.38, h: 0.26 }, sx * 0.55, -0.36, 0.08, 0x8f7f4a, { metalness: 0.3 });
        crate.rotation.y = -0.06;                                                // 吊掛瓦楞貨櫃(懸空縫)
        for (const ox of [0.46, 0.66]) bxF(rack, 0.02, 0.24, 0.02, sx * ox, -0.14, 0.08, IRON, { metalness: 0.8 });  // 吊桿
        bxF(rack, 0.1, 0.16, 0.06, sx * 0.14, 0.17, -0.2, 0x2e3236, { metalness: 0.4 });  // 無線電機盒
        cylF(rack, 0.006, 0.006, 0.3, 5, sx * 0.14, 0.38, -0.22, IRON, { metalness: 0.8 });  // 無線電短天線
      }
    }
  },
  pelvis(c, hips, d) {
    const { PAL, accent, G } = c;
    // 寬扁楔台骨盆:頂寬底收(2D 腰甲往下收的梯形)
    tboxF(hips, { w0: 0.72 * G, d0: 0.52 * G, w1: 0.92 * G, d1: 0.66 * G, h: 0.4 }, 0, 0.02, 0, PAL.deep, { metalness: 0.6 });
    prismF(hips, [[-0.26, 0.13], [0.26, 0.13], [0.2, -0.08], [0, -0.17], [-0.2, -0.08]],
      0.08, 0, -0.06, 0.33 * G, PAL.mid, { metalness: 0.55 });                   // 五角前擋板(稜柱)
    for (const sx of [-1, 1]) {                                                  // 後腰雙配重塊
      const w = tboxF(hips, { w0: 0.26 * G, d0: 0.22, w1: 0.22 * G, d1: 0.18, h: 0.28 }, sx * 0.3 * G, 0.0, -0.34 * G, PAL.mid, { metalness: 0.6 });
      bxF(w, 0.2 * G, 0.04, 0.15, 0, 0.16, 0, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 頂面警示條
      torusF(w, 0.035, 0.012, 0, -0.17, 0, IRON, { metalness: 0.8 });            // 下緣吊環(圓環體)
    }
  },
  thigh(c, l, d) {
    const { PAL, G } = c;
    const drum = latheF(l, [[0.0001, -0.09], [0.1 * G, -0.09], [0.14 * G, -0.055], [0.14 * G, 0.055], [0.1 * G, 0.09], [0.0001, 0.09]],
      10, 0, -0.08, 0, PAL.mid, { metalness: 0.65 });
    drum.rotation.z = Math.PI / 2;                                               // 髖部圓筒鼓(旋成體)
    tboxF(l, { w0: 0.5 * G, d0: 0.56 * G, w1: 0.42 * G, d1: 0.48 * G, h: d.len * 1.0, sz: 0.03 },
      0, -d.len * 0.52, 0.02, PAL.main, { metalness: 0.6 });                     // 大腿主殼(楔台,下端外擴)
    tboxF(l, { w0: 0.34 * G, d0: 0.07, w1: 0.38 * G, d1: 0.05, h: d.len * 0.5 }, 0, -d.len * 0.45, 0.28 * G, PAL.mid, { metalness: 0.6 });  // 前疊板
    for (let i = 0; i < 3; i++)
      bxF(l, 0.035, 0.035, 0.035, 0.1 * G, -d.len * (0.28 + i * 0.18), 0.32 * G, PAL.deep, { metalness: 0.7 });  // 鉚釘列
  },
  shin(c, l, d) {
    const { PAL, G, sx } = c;
    const knee = latheF(l, [[0.0001, -0.18], [0.11 * G, -0.18], [0.17 * G, -0.14], [0.17 * G, -0.05], [0.185 * G, -0.04], [0.185 * G, 0.04], [0.17 * G, 0.05], [0.17 * G, 0.14], [0.11 * G, 0.18], [0.0001, 0.18]],
      12, 0, -0.02, 0, PAL.mid, { metalness: 0.65 });
    knee.rotation.z = Math.PI / 2;                                               // 圓筒膝關節鼓(旋成體,帶中箍)
    for (const s of [-1, 1])
      cylF(l, 0.06, 0.06, 0.035, 6, s * 0.2 * G, -0.02, 0, COAL, { metalness: 0.85 }).rotation.z = Math.PI / 2;  // 六角螺栓蓋 ×2
    tboxF(l, { w0: 0.4 * G, d0: 0.46 * G, w1: 0.44 * G, d1: 0.5 * G, h: d.len * 0.5, sz: -0.02 },
      0, -d.len * 0.34, 0, PAL.main, { metalness: 0.6 });                        // 鉚接疊板(上,貼膝收窄)
    tboxF(l, { w0: 0.52 * G, d0: 0.54 * G, w1: 0.42 * G, d1: 0.46 * G, h: d.len * 0.5, sz: 0.02 },
      0, -d.len * 0.74, 0.01, PAL.mid, { metalness: 0.6 });                      // 疊板(下,往踝外擴)
    for (const s of [-1, 1])
      bxF(l, 0.035, 0.035, 0.035, s * 0.12 * G, -d.len * 0.8, 0.27 * G, PAL.deep, { metalness: 0.7 });  // 下板鉚釘
    hydCyl(l, 0.035, d.len * 0.4, 0, -d.len * 0.3, -0.22 * G, -0.15, PAL.lite);  // 小腿後液壓撐桿
  },
  foot(c, l, d) {
    const { PAL } = c;
    tboxF(l, { w0: 0.58, d0: d.footL * 1.15, w1: 0.46, d1: d.footL * 0.85, h: 0.2, sz: 0.06 },
      0, -d.clear * 0.5, d.footL * 0.12, PAL.deep);                              // 大平足掌(楔台,前傾)
    tboxF(l, { w0: 0.58, d0: 0.26, w1: 0.5, d1: 0.14, h: 0.11, sz: 0.1 }, 0, -d.clear * 0.44, d.footL * 0.62, PAL.mid);  // 趾板(斜切)
    tboxF(l, { w0: 0.48, d0: 0.2, w1: 0.4, d1: 0.13, h: 0.12, sz: -0.06 }, 0, -d.clear * 0.46, -d.footL * 0.28, PAL.mid);  // 踵板
  },
  armUp(c, a, d) {
    const { PAL, accent, G } = c;
    // 肩關節護甲(2026-08-15 使用者附圖裁決:**這顆鼓不是「肩甲」** —— 使用者說的肩甲是
    // 雙側那兩片大平板,見 chest() 的 `rackR/rackL`。這一顆退回單純的肩關節護甲,不帶樞軸、
    // 不掛武器,逐位元同 2026-08-14 的版本)。
    const pau = latheF(a, [[0.0001, -0.18 * G], [0.2 * G, -0.18 * G], [0.27 * G, -0.14 * G], [0.27 * G, -0.04], [0.29 * G, -0.03], [0.29 * G, 0.03], [0.27 * G, 0.04], [0.27 * G, 0.14 * G], [0.2 * G, 0.18 * G], [0.0001, 0.18 * G]],
      12, 0, 0.08, 0, PAL.main, { metalness: 0.6 });
    pau.rotation.z = Math.PI / 2;                                                // 圓筒肩關節護甲(旋成體鼓,帶中箍)
    for (let i = 0; i < 3; i++) {
      const th = 0.5 + i * 2.1;
      bxF(a, 0.03, 0.03, 0.03, c.sx * 0.19 * G, 0.08 + Math.cos(th) * 0.18, Math.sin(th) * 0.18, PAL.deep, { metalness: 0.7 });  // 護甲外緣鉚釘
    }
    cylF(a, 0.05, 0.05, 0.05, 8, 0, 0.4, -0.1, COAL, { metalness: 0.7 });        // 肩頂排氣口
    tboxF(a, { w0: 0.26 * G, d0: 0.3 * G, w1: 0.29 * G, d1: 0.33 * G, h: d.len * 1.0, sz: 0.02 },
      0, -d.len * 0.5, 0, PAL.main, { metalness: 0.6 });                         // 上臂主殼(楔台)
    // 臂側主翼板(薄刃鰭片;寬面朝外、長軸沿臂)—— **飛行型的主翼就是這一片**:
    // 雙臂側伸之後片面法線轉成垂直 = 水平翼面,弦長 = 這裡的 w0/w1。
    // 弦太窄(舊制 0.36/0.5)在飛行型上讀不出翼,只剩兩根細手臂 ⇒ 加寬到接近 2D 圖的翼弦比例。
    const wing = finF(a, { len: d.len * 1.0, w0: 0.62, w1: 0.86, t: 0.08, sweep: 0 },
      c.sx * 0.18 * G, 0.0, -0.06, PAL.mid, { metalness: 0.6 });
    wing.rotation.set(0, Math.PI / 2, Math.PI);
    bxF(a, 0.03, d.len * 0.85, 0.05, c.sx * 0.18 * G, -d.len * 0.5, 0.33, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 翼前緣識別條
    hydCyl(a, 0.03, d.len * 0.42, c.sx * 0.04, -d.len * 0.3, 0.19 * G, -0.22, PAL.lite);  // 肩前液壓撐桿
  },
  armFore(c, a, d) {
    const { PAL, G } = c;
    hydCyl(a, 0.035, d.len * 0.5, 0, -d.len * 0.2, -0.16 * G, -0.25, PAL.lite);  // 肘內側液壓撐桿
    tboxF(a, { w0: 0.29 * G, d0: 0.33 * G, w1: 0.24 * G, d1: 0.27 * G, h: d.len * 1.0, sz: 0.02 },
      0, -d.len * 0.5, 0.02, PAL.main, { metalness: 0.6 });                      // 前臂殼(楔台,往腕外擴)
    const wing = finF(a, { len: d.len * 0.92, w0: 0.8, w1: 0.5, t: 0.06, sweep: 0 },
      c.sx * 0.17 * G, -d.len * 0.06, -0.08, PAL.mid, { metalness: 0.6 });
    wing.rotation.set(0, Math.PI / 2, Math.PI);                                  // 前臂翼板段(外翼;弦往梢端收分)
    torusF(a, 0.16 * G, 0.028, 0, -d.len * 0.92, 0.02, PAL.mid, { metalness: 0.7 }).rotation.x = Math.PI / 2;  // 腕部束環
  },
  // 旋翼盤圓盾 —— **兩個型態的同一顆零件**:地面型握在拳側當圓盾、飛行型掛在翼端艙上當槳盤。
  // 盤面法線 = 回傳 g 的局部 +y(定向交給呼叫端:地面 Rz(∓90°) 朝外、飛行由反傾 Group 轉成水平)。
  // 自轉層 spin 另立:飛行檔把它登記進 userData.spin(viewer/game 同一份名冊推進 rotation.y)——
  // 直接轉 g 的話會與定向用的 rotation.z 在尤拉序 'XYZ' 下互相轉走(geo.js rotorF 檔頭同一個坑)。
  rotorDisc(c, parent, x, y, z) {
    const { PAL, accent } = c;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    torusF(g, 0.57, 0.04, 0, -0.005, 0, dimF(accent, 0.85), { emissive: accent, emissiveIntensity: 0.6 }).rotation.x = Math.PI / 2;  // accent 輪緣環(不轉:飛行型的槳環護框)
    const spin = new THREE.Group();
    g.add(spin);
    latheF(spin, [[0.55, -0.03], [0.57, -0.005], [0.55, 0.015], [0.37, 0.032], [0.18, 0.052], [0.0001, 0.07]],
      12, 0, 0, 0, PAL.mid, { metalness: 0.65 });                                // 碟形盤面(旋成體,外緣→中心微拱)
    cylF(spin, 0.53, 0.53, 0.03, 12, 0, -0.03, 0, PAL.deep, { metalness: 0.6 }); // 盤背板
    latheF(spin, [[0.13, 0], [0.12, 0.045], [0.075, 0.085], [0.0001, 0.105]], 10, 0, 0.05, 0, PAL.deep, { metalness: 0.8 });  // 槳轂圓頂
    torusF(spin, 0.16, 0.02, 0, 0.055, 0, COAL, { metalness: 0.8 }).rotation.x = Math.PI / 2;  // 中心孔環(2D 的中心圓)
    // 四條徑肋 = **收在盾內的槳葉**(一肋一件)。地面型剛好收在盤緣之內(全長 1.07 < 盤徑 1.14)
    // ⇒ 讀成圓盾的徑向加強肋;飛行型由 `c.rotorBlade` 把同一批肋**伸出盤外**(2026-08-14
    // 使用者:「圓盾內部會延伸出前臂長的大旋翼」)。伸出量是**前臂長**,由飛行檔自骨架尺寸
    // 推導後放進 c —— 在這裡寫死一個長度的話,兩態就只能二選一。
    const B = c.rotorBlade || { len: 1.07, w: 0.05 };
    for (let i = 0; i < 4; i++) {
      const rib = bxF(spin, B.w, 0.025, B.len, 0, 0.022, 0, PAL.deep, { metalness: 0.7 });
      rib.rotation.y = i * Math.PI / 4;
    }
    return { g, spin };
  },
  mount(c, F) {
    const { PAL, accent, G, K } = c;
    // 雙拳 + 拳側旋翼盤圓盾(地面是盾、飛行旋轉)—— 2D:圓形迷彩盾、中心孔、徑向肋
    for (const [g, sx] of [[F.handL, -1], [F.handR, 1]]) {
      tboxF(g, { w0: 0.34, d0: 0.3, w1: 0.27, d1: 0.34, h: 0.32, sz: 0.04 }, 0, -0.15, 0.02, c.dark);  // 梯形拳
      bxF(g, 0.26, 0.1, 0.08, 0, -0.1, 0.19, PAL.mid, { metalness: 0.6 });       // 指節板
      const d = this.rotorDisc(c, g, sx * 0.26 * G, -0.14, 0.02);
      d.g.rotation.z = -sx * Math.PI / 2;                                        // 局部 +y = 朝外
      (c.discs || (c.discs = [])).push({ ...d, sx, hand: g });                   // 飛行型改定向成水平槳盤(t11_flight)
    }
    // 武裝硬點 = **肩甲(那片大平板)頂面**(chest 的 wMtR/wMtL)。轉向層 `sw` 與武器本體
    // **分開兩層**:重武器的 `heavyPivot` 每幀把 `piv.rotation` 阻尼回 rest,朝向寫在 piv 上
    // 會被它抹掉(症狀是飛行型的布撒器慢慢自己轉回朝下,而蓄力展開仍然正常)。
    const swivel = (nm) => {
      const sw = new THREE.Group();
      (F.chest.getObjectByName(nm) || F.chest).add(sw);
      (c.wpnSwivels || (c.wpnSwivels = [])).push(sw);   // 飛行型反解成「朝航向」(t11_flight)
      return sw;
    };
    const swR = swivel('wMtR'), swL = swivel('wMtL');
    // 「**始終**轉向前方」(2026-08-15 使用者)= 轉向層登記成陀螺穩定節點 ⇒ 逐幀把世界姿態
    // 鎖回機體航向(鷹架 stabList / locomotion stepStab)。飛行型的靜態反解只保證**站著**那一刻:
    //   ①肩甲跟著胸腔走,而步態每幀在扭腰擺胸;②飛行型還有壓坡/俯仰/懸停抖動。
    // 兩者都會把槍口帶偏,而畫面上只表現成「武器有點歪」。
    // ⚠ 穩定的是**轉向層**不是肩甲本身:板該跟著變形走(它要維持 B-2 三角形),
    //   只有坐在它上面的武器恆定朝前。
    const stab = [swR, swL];
    // 右肩雙聯機槍莢(輕武器)
    const pod = new THREE.Group();
    pod.position.set(0, 0.12, 0);              // 機匣半高 ⇒ 底面恰坐在肩甲板面上
    swR.add(pod);
    const ML = 0.85 * K.barrelF;
    tboxF(pod, { w0: 0.32, d0: 0.54, w1: 0.26, d1: 0.46, h: 0.24, sz: -0.05 }, 0, 0, 0, PAL.deep, { metalness: 0.65 });  // 共構機匣(楔台後收)
    for (const ox of [-0.07, 0.07]) {
      const bar = latheF(pod, [[0.0001, 0], [0.03, 0], [0.03, ML * 0.5], [0.026, ML * 0.55], [0.026, ML * 0.8], [0.045, ML * 0.82], [0.045, ML * 0.96], [0.032, ML * 0.98], [0.0001, ML]],
        8, ox, 0, 0.2, GUNMETAL, { metalness: 0.85 });
      bar.rotation.x = Math.PI / 2;                                              // 砲管(旋成體:縮徑段+膛口套)
    }
    bxF(pod, 0.24, 0.1, 0.07, 0, 0, 0.2 + ML * 0.45, PAL.mid, { metalness: 0.7 });  // 雙管夾箍
    const lMuz = bxF(pod, 0.2, 0.06, 0.05, 0, 0, 0.24 + ML, accent, { emissive: accent, emissiveIntensity: 0.9 });  // 槍口環燈
    for (const ox of [-0.07, 0.07])
      tboxF(pod, { w0: 0.09, d0: 0.14, w1: 0.07, d1: 0.1, h: 0.18, sz: 0.03 }, ox, -0.2, 0.05, PAL.mid);  // 下垂雙彈匣(楔台)
    // 左肩集束布撒器(重武器):楔台斜切箱 + 2×3 發光膛口 + 俯仰樞軸(蓄力上仰)
    const piv = new THREE.Group();
    piv.position.set(0, 0.15, 0);              // 布撒箱半高 ⇒ 底面恰坐在肩甲板面上
    swL.add(piv);
    tboxF(piv, { w0: 0.44, d0: 0.66, w1: 0.36, d1: 0.54, h: 0.3, sz: 0.06 }, 0, 0, 0, PAL.mid, { metalness: 0.6 });  // 布撒箱(楔台,前緣斜切)
    bxF(piv, 0.34, 0.05, 0.5, 0, 0.17, 0.02, accent, { emissive: accent, emissiveIntensity: 0.7 });  // 頂蓋識別條
    tboxF(piv, { w0: 0.36, d0: 0.05, w1: 0.32, d1: 0.04, h: 0.24 }, 0, 0, 0.32, PAL.deep, { metalness: 0.6 });  // 膛口面板
    for (const s of [-1, 1]) {
      const pl = prismF(piv, [[-0.28, 0.12], [0.28, 0.12], [0.22, -0.14], [-0.28, -0.14]], 0.05,
        s * 0.23, 0, 0, PAL.deep, { metalness: 0.6 });
      pl.rotation.y = Math.PI / 2;                                               // 側裝甲板(稜柱)×2
    }
    cablesF(piv, { p0: [0.12, -0.08, -0.3], p1: [0.2, -0.36, -0.42], k: 3, r: 0.012, sag: 0.05, spread: 0.02 }, COAL, { metalness: 0.6 });  // 尾部纜束(供彈/訊號)
    const ports = [];
    for (let i = 0; i < 6; i++) {
      const px = (i % 3 - 1) * 0.11, py2 = (i < 3 ? 0.06 : -0.06);
      const p = cylF(piv, 0.045, 0.045, 0.05, 8, px, py2, 0.36, accent, { emissive: accent, emissiveIntensity: 0.9 });
      p.rotation.x = Math.PI / 2;
      ports.push(p);                                                             // 2×3 發光膛口
    }
    return {
      gunR: null, gunL: null, stab,
      muzzles: { light: { n: lMuz, r: 0.08 }, heavy: { n: ports[1], r: 0.05 } },
      lightGlowM: [lMuz], heavyGlowM: ports,
      heavyPivot: [{ obj: piv, rest: { x: 0, y: 0, z: 0 }, deploy: { x: -0.18, y: 0, z: 0 } }],  // 蓄力上仰、擊發反坐
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.06 },
      aimPose: null,
      wpn: { light: { nodes: [pod], ref: pod, muz: lMuz, fwd: 'z' }, heavy: { nodes: [piv], ref: piv, muz: ports[1], fwd: 'z' } },
    };
  },
};
