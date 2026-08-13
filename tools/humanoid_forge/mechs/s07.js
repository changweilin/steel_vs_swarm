// ============ s07 逐機零件檔(dev-only;仿生四足 D.kind 'quad' + soft 觸手腿)============
// ── s07「證明完畢」八臂防空機甲(cthulhu 頭足類):四觸手步行 + 四觸手持武、複眼群 ──
// 2D 定案圖:public/assets/cyberpunk_art/mechs/s07_{static,moving,heavy}.jpg(★ = s07_heavy)
// 幾何語彙一律取自 ../geo.js;MUST NOT 在本檔自建 BufferGeometry。
// 2026-08-12 多面體改寫(照 ★ 圖逐部位):
//   外套膜 = latheF 橢殼(scale.z 前後拉長)+ torusF 腹縫肋環 + tboxF 三片深色背甲罩;
//   背頂 = tboxF 艙盒(前通風柵)+ latheF 雷達碟(桅杆 + 饋源三桿,★ 圖頂部招牌件);
//   臉 = prismF 蒼白臉板 + 雙大複眼(torusF 眶環 + sphF 玻璃頂)+ 小眼列 ×6 + torusF 弧眉
//        + 口部通風柵;面鬚 = chainF 三節收分 ×5(垂墜前捲)+ cablesF 側細鬚;
//   持武觸手 ×4 = chainF 六節環節(節間 IRON 關節環 + 腹面吸盤列),生根點方位 = 對應
//        步行腿 (±legX, fz/hz) 的方位(章魚八臂環狀輻射、上下成對;_tentAt 同一份推導),
//        自錨點向外上弧起再回捲;前對持 25mm 空爆機砲 / 諧振器 orb、後對各托一枚攔截彈;
//   腹下 = chainF 虹吸管 + 發射軌條;全機纜束 = cablesF(罩下垂落,★ 圖前肩明顯)。
// 2026-08-13 使用者:「下四隻觸手連接點不變,但零件組成與連接要跟上四隻觸手一樣,
//   差在功能是移動,不拿武器」—— 步行腿由「tboxF 甲殼楔台 + latheF 關節盤 + hydCyl 活塞 +
//   爪蹄」的**機械腿**改成與持武觸手同一種生物:節身/關節環/吸盤全部改吃同一份 `TENT`
//   參數源與同一支 `chainF`(見 `_tentLeg` 檔頭的軸向轉換推導)。三件事一格未動:
//   ① 生根座標(frame.legX/fz/hz/hipY 與逐節 len);② 鏈契約(仍回傳 segLimbF 的 segs ⇒
//   進 rig.chFL… 由 locomotion softLeg 逐節驅動,MUST NOT 換成 chainF —— 那是 rig.tents
//   的另一套結構,換過去四條腿當場不動而靜止那一幀還是對的);③ 持武觸手那四隻的幾何。
//   差別只有:粗細 ×LEG_F(承重)+ 末端是著地的觸手梢(密集吸盤、微捲)而不是爪蹄/槍口。
// 2026-08-13 使用者手繪稿 + 原句:「克蘇魯的下觸手不要垂直地面,而是外延且呈現 S 型曲線,
//   上觸手角度 OK 但也 S 曲線」——上一輪的四條腿 base(0.16/−0.1)累積下來幾乎是直柱,
//   上四隻的 rot0/rotD 是**單調同號**遞增 ⇒ 只彎得出 C 弧,兩者都不是 S。本輪兩組同時改,
//   而且用**同一種語言**:S = 逐節相對角**在鏈中途變號**,而整條 S 落在「該觸手自己的
//   徑向鉛直面」內(上四隻本來就有 `_tentAt.yaw`,下四隻本輪補上同一份方位角)。
//   ⇒ 八隻觸手都是「自體側向外弧起 → 中段回勾 → 梢端再翻」的同一條曲線,只差朝上/朝下。
//
//   兩個驅動器的既成事實(改動前逐字核對 public/js/locomotion.js 原文):
//     softLeg(:311) / flexChain(:92) / tentGuard(:328) 全部寫 `j.g.rotation.x = j.base + …`
//     stepQuad(:730) 對腿根寫 `rig.legFL.rotation.x = …`;jump/cast 那幾處是 `rotation.x +=`。
//   ⇒ ① 逐節 `base`(靜態 x 角)被保留,行進波疊在它上面;② **沒有任何一處寫 y/z**,
//      故建構期設在樞軸 Group 上的 rotation.y(方位)/ rotation.z(外撇 + S)恆存活。
//   尤拉序:樞軸 Group 用 three 預設 'XYZ' ⇒ R = Rx·Ry·Rz(Rz 先作用於向量、Rx 最後)。
//      腿根:Rz(外撇) → Ry(徑向方位) → Rx(步態擺動,繞**身體** x 軸 ⇒ 前後擺一格未動)。
//      彎曲軸恆為 Ry(ψ)·(0,0,1) = (sinψ, 0, cosψ) —— 與徑向 (cosψ, 0, −sinψ) 正交且水平
//      ⇒ 逐節的 Rz 全部繞同一根水平軸 ⇒ S 形嚴格落在同一個鉛直面內,不會被扭成螺旋。
import * as THREE from 'three';
import {
  matF, dimF, bxF, cylF, sphF, coneF, torusF, tboxF, prismF, latheF, finF, fanF, chainF, cablesF,
  hydCyl, sinew, seg2, IRON, GUNMETAL, COAL, INK, BONE, BRASS,
} from '../geo.js';

// 本機專用色:攔截彈淺鋼灰(★ 圖的白灰飛彈)/ 複眼玻璃深藍
const STEEL2 = 0xcfd8e0, GLASS = 0x16222e;

// ── 八隻觸手的**唯一一份輪廓參數**(上四隻持武 / 下四隻步行同吃)──────────────
// 持武觸手直接把它餵給 chainF;步行觸手逐節餵同一支 chainF(n:1),取同一條收分曲線
// ⇒ 節身粗細比、節間關節環、腹面吸盤的尺寸規則只有這一份,改一次兩邊一起動。
const TENT = { n: 6, len0: 0.7, len1: 0.36, r0: 0.16, r1: 0.055, seg: 8 };
const tentR = (u) => TENT.r0 + (TENT.r1 - TENT.r0) * u;   // = chainF 內建的收分同式
const LEG_F = 1.3;   // 步行觸手承重 ⇒ 比持武觸手粗;粗細是使用者許可的唯一形狀差異

// ── 八隻觸手共用的 **S 形語彙**(逐節相對角;正 = 朝外弧起,負 = 回勾)────────────
// 判準只有一條:序列**中途變號** ⇒ 曲率換邊 ⇒ 側視是 S 而不是 C。單調同號(上一輪的
// rot0 + i·rotD)不管累積多大都只彎得出 C —— 這是本輪兩組一起要收掉的那件事。
// 下四隻(步行):寫進逐節 rotation.z(徑向鉛直面內);上四隻(持武):寫進逐節
// rotation.x(chainF 本來的彎曲軸,root 已由 _tentAt.yaw 轉到同一個徑向面)。
// d1 實測:累積 [0.58,0.88,0.66,0.26,0.08] 拍出來讀成「斜插的直棍」——S 要看得出來,
// 靠的不是「有沒有變號」而是**兩段的傾角落差**。d1b 把上段推到 60°、下段壓到近 0°:
const LEG_S = [0.72, 0.33, -0.45, -0.46, -0.16];   // 累積 0.72 / 1.05 / 0.60 / 0.14 / −0.02
const LEG_TIP_Z = 1.05;                            // 觸手梢再外翻(續在同一個徑向面內)
// 上四隻:前對 / 後對只差整體 ×0.98(維持既有前後細微差),角度與生根點一格未動。
// d1 的 [0.64,0.68,0.56,0.18,−0.28,−0.38] 在第 4 關節一次轉 0.46 rad ⇒ 正面看是個折角。
// d1b 把**逐節差**壓在 0.36 以內(0/−0.12/−0.28/−0.36/−0.24)= 曲率連續變號 = 平滑的 S。
// d1c 再整組 +0.06(逐節差逐位元不變 ⇒ S 的形狀不動,只是整條多捲一點):d1b 的梢端翻得
// 太開,頂端頂出 distF 0.75 的取景框;峰值 2.20 讓中段捲回舊制那個高度再往外上翹。
const TENT_S = [0.68, 0.68, 0.56, 0.28, -0.08, -0.32];   // 累積峰 2.20 → 回勾到 1.80
// 腿長:S 形把鉛直落差換成水平外延 ⇒ 節長 MUST 補回去,否則四隻腳一起離地。
// 逐節 cos(累積角) 加權和 = 2.292(直柱版 2.737)⇒ 節長 ×1.06;最低點 −0.420
// (直柱版 −0.665)—— 刻意只補一半:補滿(d1 的 ×1.14)整台撐出 distF 0.75 的取景框,
// 而少補的那 0.25m 表現成「機體更趴」= 章魚該有的樣子,不是缺陷。
// sin 加權和 = 1.448 + 梢端 0.220 = 單邊外延 1.67m 就是換來的東西。
const LEG_LEN = [0.74, 0.65, 0.59, 0.51, 0.42];

export default {
  label: '證明完畢(s07 機甲・頭足類)', hue: 0x7fd8ff, kind: 'quad', height: 4.8,
  frame: {
    hipY: 2.1, legX: 0.95, fz: 0.8, hz: -1.1,
    chest: [0, 0.15, 0.4], neck: [0, 0.35, 0.5], head: [0, 0.25, 0.3],
    tailY: 0, tailZ: -0.9, tail2Z: 0.6,     // 尾已退場語意(遊戲同款):tail/tail2 留空樞軸
  },
  gait: { gait: 'crawl', stride: 1.7, top: 7, bob: 0.05, legAmp: 0.8, pitchAmp: 0.04, soft: 1 },
  moveSig: { poise: 0.08, idleF: 0.70, idleA: 1.72, launch: 0.05, spool: 0.14, brake: 0.05, settle: 1.65 },
  castSig: { omni: 'dance', dir: 'swing' },
  doc: [
    ['外套膜(囊狀主體)', 'latheF 橢殼(前後拉長)+ torusF 腹縫肋環 + tboxF 三片深色背甲罩 + 罩下 cablesF 纜束 ×2'],
    ['背頂(艙盒 + 雷達碟)', 'tboxF 艙盒(bxF 通風柵 ×3)+ latheF 雷達碟(cylF 桅杆/饋源三桿 + sphF 饋源燈)'],
    ['頭(複眼群 + 面鬚)', 'prismF 蒼白臉板 + 雙大複眼(torusF 眶環 + sphF 玻璃頂)+ 小眼列 ×6 + torusF 弧眉 + 口柵;面鬚 = chainF 三節收分 ×5 + cablesF 側細鬚'],
    ['觸手步行腿 ×4(五節行進波 + S 形外延)', '零件組成同持武觸手(共用 TENT 參數源與同一支 chainF):收分環節身 + IRON 節間關節環 + 腹面吸盤(朝徑向內側,逐節一顆、節越遠越小)+ sphF 根部球窩罩;末端 = 兩節回勾的著地觸手梢(吸盤加密)。腿根 rotation.y 轉到該腿徑向方位、逐節 rotation.z 走 LEG_S(+ + − − −,中途變號 = S 形;上段外撇 60°、下段回到近鉛直)⇒ 自體側向外弧起 → 中段回勾 → 梢端外翻躺地,單邊外延 1.67m;節長 ×1.06 把 S 吃掉的鉛直落差補回一半,機體因此比直柱版低伏 0.245m。粗細 ×1.3(承重)'],
    ['持武觸手 ×4(rig.tents)', 'chainF 六節環節(IRON 關節環 + 腹面吸盤列)+ sphF 球窩罩;生根點與根部三角 = 對應步行腿方位貼殼收斂(右前/左前/右後/左後上下成對),一格未動;逐節彎度改吃 TENT_S(+ + + + − −)⇒ 向外上弧起、中段捲到頂再回勾把梢端往外上翻 = 與步行腿同一種 S 形語言;末端世界對齊樞軸(槍口恆朝前)'],
    ['武裝(25mm 空爆機砲 / 諧振器 / 攔截彈 ×2)', '機砲 = tboxF 機匣 + latheF 階狀砲身 + 彈鼓;諧振器 = latheF 托座 + sphF 諧振球 + torusF 環 ×2;攔截彈 = latheF 彈體 + coneF 彈頭 + finF 尾翼 ×4'],
    ['腹部(虹吸管 + 發射軌)', 'chainF 三節下垂虹吸管 + bxF 發射軌條 ×2'],
  ],
  body(c, spine, chest) {
    const { PAL, accent } = c;
    // 外套膜:橢圓旋成殼(scale.z 前後拉長 = ★ 圖的囊狀剖面)
    const mant = latheF(spine, [
      [0.55, -0.85], [0.95, -0.55], [1.12, -0.05], [0.95, 0.5], [0.55, 0.85], [0.0001, 1.0],
    ], 12, 0, 0.05, -0.1, PAL.main, { metalness: 0.45 });
    mant.scale.z = 1.28;
    // 腹縫肋環(★ 圖下殼那一圈水平接縫)
    const seam = torusF(spine, 1.12, 0.05, 0, -0.32, -0.1, dimF(PAL.main, 0.8), { metalness: 0.55 });
    seam.scale.y = 1.28;                     // 先縮後轉:local y → world z 的橢圓拉長
    seam.rotation.x = Math.PI / 2;
    // 深色背甲頂蓋(latheF 上半殼 + 三片角面甲板)—— ★ 圖:上半整片深色碳殼、下半淺色囊殼
    const cap = latheF(spine, [[1.03, 0.28], [0.97, 0.55], [0.66, 0.84], [0.0001, 1.0]], 12, 0, 0.05, -0.1, dimF(PAL.deep, 0.72), { metalness: 0.6 });
    cap.scale.z = 1.28;
    const hood = tboxF(spine, { w0: 1.3, d0: 1.0, w1: 0.95, d1: 0.7, h: 0.34, sz: 0.12 }, 0, 0.78, 0.5, PAL.deep, { metalness: 0.6 });
    hood.rotation.x = 0.45;
    tboxF(spine, { w0: 1.5, d0: 1.35, w1: 1.1, d1: 1.05, h: 0.36 }, 0, 0.88, -0.25, dimF(PAL.deep, 0.85), { metalness: 0.6 }).rotation.x = 0.06;
    const back = tboxF(spine, { w0: 1.25, d0: 1.0, w1: 0.85, d1: 0.6, h: 0.3, sz: -0.15 }, 0, 0.68, -0.95, dimF(PAL.deep, 0.85), { metalness: 0.6 });
    back.rotation.x = -0.42;
    // 鞍部檢修口 + 識別燈縫(★ 圖背甲上的小方格細節)
    bxF(spine, 0.26, 0.05, 0.18, 0.32, 1.1, -0.15, dimF(PAL.deep, 0.75), { metalness: 0.7 });
    bxF(spine, 0.4, 0.03, 0.05, -0.28, 1.08, 0.1, accent, { emissive: accent, emissiveIntensity: 0.7 });
    // 背頂艙盒(★ 圖正中的深色方艙;前面通風柵 ×3)
    tboxF(spine, { w0: 0.95, d0: 0.85, w1: 0.82, d1: 0.72, h: 0.44 }, 0, 1.22, -0.32, GUNMETAL, { metalness: 0.65 });
    for (let i = 0; i < 3; i++)
      bxF(spine, 0.5, 0.045, 0.03, 0, 1.1 + i * 0.09, 0.11, COAL, { metalness: 0.5 });
    bxF(spine, 0.3, 0.06, 0.22, 0.16, 1.46, -0.5, dimF(GUNMETAL, 0.8), { metalness: 0.7 });
    // 雷達碟(★ 圖頂部招牌件:桅杆 + 淺拋物碟 + 饋源三桿 + 饋源燈)—— 碟口朝前上(正面看得到凹面)
    const dishG = new THREE.Group();
    dishG.position.set(0.06, 1.42, -0.18);
    spine.add(dishG);
    cylF(dishG, 0.05, 0.07, 0.32, 8, 0, 0.16, 0, IRON, { metalness: 0.8 });
    const dish = latheF(dishG, [[0.02, 0], [0.29, 0.055], [0.49, 0.13], [0.56, 0.19], [0.56, 0.22]], 12, 0, 0.34, 0, dimF(STEEL2, 0.85), { metalness: 0.6 });
    dish.rotation.set(0.5, 0, 0.25);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.094;
      const st = cylF(dish, 0.012, 0.012, 0.36, 5, Math.cos(a) * 0.24, 0.3, Math.sin(a) * 0.24, COAL, { metalness: 0.8 });
      st.rotation.z = Math.cos(a) * 0.5;
      st.rotation.x = -Math.sin(a) * 0.5;
      st.userData.noOutline = true;
    }
    sphF(dish, 0.05, 0, 0.46, 0, accent, { emissive: accent, emissiveIntensity: 1.2 });
    // 罩下纜束 ×2(★ 圖前肩垂落的管線;一條一零件)—— 細管掛 noOutline(描邊殼比管粗會整條變黑)
    for (const sx of [-1, 1])
      cablesF(spine, { p0: [sx * 0.3, 0.8, 0.6], p1: [sx * 0.85, 0.0, 0.8], k: 4, r: 0.026, sag: 0.16, spread: 0.09 }, GUNMETAL, { metalness: 0.6 })
        .forEach((m) => { m.userData.noOutline = true; });
    // 腹下:虹吸管(chainF 三節下垂)+ 發射軌條 ×2
    chainF(spine, {
      n: 3, y: -0.55, z: -0.72, len0: 0.42, len1: 0.26, r0: 0.13, r1: 0.07,
      rot0: -1.62, rotD: -0.14, ring: true, ringColor: COAL, seg: 8,
    }, GUNMETAL, { metalness: 0.5 });
    for (const sx of [-1, 1])
      bxF(spine, 0.09, 0.07, 1.5, sx * 0.22, -0.72, 0.05, COAL, { metalness: 0.6 });
    // 持武觸手根部球窩罩 ×4(觸手在罩內轉動;生根點 = mount 同一份 _tentAt 推導)
    for (const [sx, front] of [[-1, true], [1, true], [-1, false], [1, false]]) {
      const sock = sphF(chest, 0.24, ...this._tentAt(c, sx, front).p, dimF(PAL.deep, 0.8), { metalness: 0.6 });
      sock.scale.y = 0.75;
    }
  },
  // 持武觸手生根點(body 球窩罩與 mount 共用的唯一推導):
  // 方位 = 對應步行腿 —— 腿掛世界根 (±legX, fz/hz)、外套膜中心在 chest 座標是 (0, ·, -chest.z)
  // ⇒ 自中心看的腿方位向量恰為 (±legX, fz/hz);沿它貼殼收斂(半徑 rad)、y 取外套膜上側翼。
  // yaw = 讓 chain 初始 -z 指向該方位(root 'YXZ':先仰後轉方位,弧線恆落在腿的鉛直方位面)。
  _tentAt(c, sx, front) {
    const d = c.dims, zLeg = front ? d.fz : d.hz, rad = front ? 0.85 : 0.9;
    const n = Math.hypot(d.legX, zLeg);
    return {
      p: [sx * (d.legX / n) * rad, 0.5, -d.chest[2] + (zLeg / n) * rad],
      yaw: Math.atan2(-sx * d.legX, -zLeg),
    };
  },
  neckHead(c, neck, head) {
    const { PAL, accent } = c;
    // 蒼白臉板(prismF 圓角盾形;★ 圖淺青白的正面大臉)
    const face = prismF(head, [
      [-0.16, -0.62], [0.16, -0.62], [0.44, -0.3], [0.58, 0.1], [0.5, 0.42],
      [0.26, 0.56], [-0.26, 0.56], [-0.5, 0.42], [-0.58, 0.1], [-0.44, -0.3],
    ], 0.12, 0, -0.05, 0.1, PAL.lite, { metalness: 0.35 });
    face.rotation.x = -0.1;
    for (const sx of [-1, 1]) {
      // 雙大複眼:torusF 眶環(蒼白)+ sphF 玻璃頂(深藍微光)
      const rim = torusF(head, 0.24, 0.04, sx * 0.34, 0.08, 0.2, PAL.lite, { metalness: 0.4 });
      const eye = sphF(head, 0.24, sx * 0.34, 0.08, 0.16, GLASS, { metalness: 0.3, emissive: accent, emissiveIntensity: 0.35 });
      eye.scale.z = 0.7;
      // 弧眉稜(torusF 弧段拱在眼上)
      const brow = torusF(head, 0.3, 0.03, sx * 0.34, 0.12, 0.22, PAL.mid, { metalness: 0.5 }, 1.9);
      brow.rotation.z = Math.PI / 2 - 0.95;
      // 小眼列 ×3(★ 圖每眼上方的三顆小圓點,沿眉外斜排)
      for (let i = 0; i < 3; i++)
        sphF(head, 0.035, sx * (0.16 + i * 0.11), 0.46 - i * 0.025, 0.17, accent, { emissive: accent, emissiveIntensity: 1.0 });
    }
    // 中央鼻盾(prismF 小三角)+ 口部通風柵(tboxF 框 + bxF 柵條 ×3)
    prismF(head, [[0, -0.16], [0.08, 0.02], [-0.08, 0.02]], 0.05, 0, 0.0, 0.19, PAL.mid, { metalness: 0.5 });
    tboxF(head, { w0: 0.3, d0: 0.07, w1: 0.26, d1: 0.07, h: 0.28 }, 0, -0.33, 0.16, INK, { metalness: 0.4 });
    for (let i = 0; i < 3; i++)
      bxF(head, 0.2, 0.035, 0.02, 0, -0.24 - i * 0.08, 0.21, GUNMETAL, { metalness: 0.6 });
    // 面鬚 ×5(chainF 三節收分;中央最長、垂墜後前捲 —— 片間差異 = 索引遞變)。
    // 垂墜角住 wrapper Group:chainF 的 rot0 是逐關節相對角,塞大角會逐節捲成死結
    for (let i = -2; i <= 2; i++) {
      const s = 1 - 0.14 * Math.abs(i);
      const dg = new THREE.Group();
      dg.position.set(i * 0.15, -0.5, 0.14);
      dg.rotation.x = -1.8 + Math.abs(i) * 0.12;
      head.add(dg);
      chainF(dg, {
        n: 3, len0: 0.4 * s, len1: 0.24 * s, r0: 0.065 * s, r1: 0.02,
        rot0: -0.06, rotD: -0.14, ring: false, seg: 6,
      }, PAL.lite, { metalness: 0.3 });
      dg.traverse((o) => { if (o.isMesh) o.userData.noOutline = true; });   // 細鬚吞不下描邊殼
    }
    // 側細鬚(cablesF;★ moving 圖往兩側甩開的細鬚)
    for (const sx of [-1, 1])
      cablesF(head, { p0: [sx * 0.4, -0.38, 0.08], p1: [sx * 0.95, -0.85, 0.3], k: 2, r: 0.014, sag: 0.26, spread: 0.05 }, GUNMETAL, { metalness: 0.6 })
        .forEach((m) => { m.userData.noOutline = true; });
  },
  legF(c) { return this._tentLeg(c, 1); },
  legH(c) { return this._tentLeg(c, -1); },
  // 腹面吸盤(上下八隻**同一支**):一盤一零件,盤徑 ∝ 該節半徑 ⇒ 節越遠盤越小;
  // 位置 = 節身內彎面(+y_local,離軸 r×0.9)× 節身中段(−len×u)。細件吞不下描邊殼。
  _suck(c, t, r, len, u = 0.45) {
    const pad = cylF(t, r * 0.28, r * 0.24, 0.035, 6, 0, r * 0.9, -len * u, c.PAL.lite, { metalness: 0.3 });
    pad.userData.noOutline = true;
    return pad;
  },
  // ── 步行觸手 ×4:零件組成 = 持武觸手,功能 = 移動(2026-08-13 使用者定案)──────
  // **鏈契約一格未動**:回傳的仍是 segLimbF 的 segs(root + 四節,base/k/d 逐位元同舊制)
  // ⇒ 進 rig.chFL/chFR/chHL/chHR,由 locomotion softLeg 逐節驅動(行進波 + 擺動相 S 形)。
  // 換掉的只有「每一節長什麼樣」:改用建持武觸手的同一支 chainF(n:1)= 收分節身 +
  // IRON 節間關節環 + 腹面吸盤,係數與收分曲線全部取自 TENT/tentR。
  //
  // 軸向轉換(本檔唯一一處,推導寫在這裡免得日後靠記憶重建):
  //   chainF 的節身沿 **−z**(尾巴慣例),segLimbF 的節沿 **−y**(肢體慣例)⇒ 每節掛一顆
  //   中介 Group,rotation.order='YXZ' ⇒ R = Ry·Rx(先繞 x 再繞 y):
  //     Rx(−π/2)·(0,0,−1) = (0,−1,0)   節身轉成朝下(y′ = −z·sin(−π/2))
  //     Rx(−π/2)·(0, 1,0) = (0,0,−1)   吸盤面(+y_local)落到 −z;再由 Ry(φ) 轉到要的方位
  //   ⚠ 用 three 預設的 'XYZ'(R = Rx·Ry·Rz)會讓 Ry 先作用 —— 節身被轉到 +y,整條腿朝天上長。
  //   Ry(φ) 只繞節身自己的軸轉(y 分量不變)⇒ 只換吸盤朝哪一面,節身方向一格不動:
  //     Ry(φ)·(0,0,−1) = (−sinφ, 0, −cosφ) ⇒ φ = +π/2 → (−1,0,0) = 樞軸 −x。
  // 吸盤朝哪一面(2026-08-13 改):主彎曲自 base(x,前後)搬到 rotation.z(徑向)之後,
  //   內凹面不再是前/後而是**徑向內側**;而 root 的 Ry(ψ) 已把樞軸 +x 定義成該腿的外側
  //   ⇒ 吸盤面 = −x = 朝身體中心,四隻腿**同一個 φ = π/2**(章魚八臂的吸盤一律在口側)。
  //   舊制那個「前腿 π / 後腿 0」的分流隨主彎曲軸一起退場。
  //
  // 徑向方位 ψ(本輪新增;與持武觸手 _tentAt.yaw 是同一個方位、只差初始軸不同):
  //   要 Ry(ψ)·(1,0,0) = 外側單位向量 (ox,0,oz)。Ry(ψ)·(1,0,0) = (cosψ, 0, −sinψ)
  //   ⇒ ψ = atan2(−oz, ox) = atan2(−zLeg, sx·legX)(長度是正的、不影響 atan2)。
  //   實算:FR(+0.95,+0.8) → −0.699,Ry 出 (0.766,0,0.645) = (0.95,0,0.8)/1.242 ✓
  //         HL(−0.95,−1.1) → +2.283,Ry 出 (−0.654,0,−0.757) = (−0.95,0,−1.1)/1.453 ✓
  //   持武那邊初始軸是 −z ⇒ ψ' = atan2(−ox,−oz) —— 兩式的差恰是 90°,同一個方位。
  _tentLeg(c, S) {
    const { PAL } = c;
    const d = c.dims, zLeg = c.front ? d.fz : d.hz;
    const yaw = Math.atan2(-zLeg, c.sx * d.legX);       // 樞軸 +x → 該腿的徑向外側
    const R = (i) => tentR(i / 4) * LEG_F;              // 五節共用 TENT 的收分曲線(u = i/4)
    const lens = LEG_LEN;
    const seg = (l, i, len, ring = true) => {
      const w = new THREE.Group();
      w.rotation.order = 'YXZ';
      w.rotation.x = -Math.PI / 2;
      w.rotation.y = Math.PI / 2;                       // 吸盤面 → 樞軸 −x = 徑向內側
      l.add(w);
      chainF(w, {
        n: 1, len0: len, len1: len, r0: R(i), r1: R(i),
        rot0: 0, rotD: 0, ring, ringColor: IRON, seg: TENT.seg,
        drawSeg: (t, k, d2) => { if (i >= 1) this._suck(c, t, d2.r, d2.len); },  // 根節不放(同持武)
      }, PAL.dark, { metalness: 0.55 });
    };
    const segs = [{
      len: lens[0],
      draw: (l) => {
        // 腿根:先把整條腿轉到自己的徑向面(y),再給第一段外撇(z)。
        // locomotion stepQuad 對 legFL… 只寫 rotation.x ⇒ 這兩個角建構期設一次就恆存活。
        l.rotation.y = yaw;
        l.rotation.z = LEG_S[0];
        // 根部球窩罩:與持武觸手根部同一件。倍率 1.2 而非持武的 1.5 —— 持武那顆有一半埋在
        // 外套膜裡,腿根整顆露在外面;照抄 1.5×0.75 拍出來是一頂寬過腿身的**扁蘑菇帽**
        // (c1 實測),讀成獨立的護肩甲而不是觸手鑽進身體的那個窩。絕對尺寸因此回到 ≈0.25
        // (持武那顆 0.24)= 同一種生物的同一顆關節。
        const sock = sphF(l, R(0) * 1.2, 0, 0, 0, dimF(PAL.deep, 0.8), { metalness: 0.6 });
        sock.scale.y = 0.85;
        seg(l, 0, lens[0], false);      // 根關節環整顆藏在球窩罩內 ⇒ 省一顆(250 顆預算)
      },
    }];
    for (let i = 1; i <= 4; i++) {
      segs.push({
        len: lens[i], base: (i === 1 ? 0.16 : -0.1) * S, k: 0.16 * S, d: i * 0.55,
        draw: (l) => {
          // 逐節外撇/回勾:softLeg 只寫這顆樞軸的 rotation.x(base + 行進波)⇒ z 存活,
          // 而且 z 先作用(XYZ)⇒ 靜態 S 與行進波互不轉走、兩者疊加。
          l.rotation.z = LEG_S[i];
          seg(l, i, lens[i]);
          if (i === 4) this._tentTip(c, l, lens[i], R(i));
        },
      });
    }
    return segs;
  },
  // 著地的觸手梢(步行觸手專屬;持武觸手那一端掛的是武器):兩節收分小節 + 加密吸盤。
  // 2026-08-13:續彎自「中介 Group 的 x」搬到**外掛一顆 tw 的 rotation.z** —— 這樣梢端的
  // 外翻與整條腿的 S 落在同一個徑向鉛直面內(同一種語言);tw 用 three 預設 'XYZ' 且只有 z。
  // 之後才掛純軸向轉換的 w(x = −π/2、y = π/2),吸盤朝向規則因此與上面五節逐字相同。
  // 角度帳(節長 LEG_LEN 就是照這本帳反解的,改任一項 MUST 重算):
  //   末節樞軸累積外撇 = ΣLEG_S = −0.02;+ LEG_TIP_Z 1.05 ⇒ 梢身軸 1.03 rad(59°)。
  //   chainF 的 rot0/rotD 為正 = 往樞軸 −x(徑向內側)回勾 ⇒ 兩小節軸 = 1.03−0.14 / 1.03−0.44。
  //   垂直:0.19·cos(0.89) + 0.13·cos(0.59) = 0.120 + 0.108 = 0.228(舊制爪端只有 0.028)。
  //   五節本身 Σ len·cos(累積) = 2.292 ⇒ 最低點 = 2.1 − 2.292 − 0.228 = −0.420,
  //   舊制 = 2.1 − 2.737 − 0.028 = −0.665 ⇒ 機體離地面高 0.245m(更趴,章魚該有的樣子)。
  //   水平:五節 Σ len·sin = 1.448,梢再 +0.220 ⇒ 單邊外延 1.67(舊制近 0)。
  _tentTip(c, l, len, r) {
    const tw = new THREE.Group();
    tw.position.y = -len;
    tw.rotation.z = LEG_TIP_Z;
    l.add(tw);
    const w = new THREE.Group();
    w.rotation.order = 'YXZ';
    w.rotation.x = -Math.PI / 2;
    w.rotation.y = Math.PI / 2;
    tw.add(w);
    chainF(w, {
      n: 2, len0: 0.19, len1: 0.13, r0: r * 0.88, r1: r * 0.42,
      rot0: 0.14, rotD: 0.30, ring: false, seg: TENT.seg,
      drawSeg: (t, i, d) => {
        this._suck(c, t, d.r, d.len, 0.62);
        if (i === 0) this._suck(c, t, d.r, d.len, 0.24);
      },
    }, c.PAL.dark, { metalness: 0.55 });
  },
  mount(c, F) {
    const { PAL, accent } = c;
    // ── 持武觸手 ×4(★ 圖:環節 + 腹面吸盤列;章魚式自外套膜側翼向外上弧起再回捲)──
    // 生根點方位 = 對應步行腿(_tentAt 唯一推導;右前/左前/右後/左後一一對應、上下成對):
    // 前對:右 = 25mm 空爆機砲、左 = 諧振器 orb;後對:各托一枚攔截彈。
    // 末端掛「世界對齊樞軸」(models.js 同款單一保證縫):槍口恆朝機體正前,蠕動波不歪槍口。
    const mkTent = (sx, front, def) => {
      // 抬升角住根部 wrapper(chainF 的 rot0 是逐關節相對角 —— 塞大角 = 整條捲死結);
      // 'YXZ' = 先仰(x)再轉到腿方位(y):初始指向「方位 × 仰角」,curl(+x)續在同一鉛直方位面內
      const at = this._tentAt(c, sx, front);
      const root = new THREE.Group();
      root.position.set(...at.p);
      root.rotation.order = 'YXZ';
      root.rotation.set(def.pitch, at.yaw, sx * -def.roll);
      F.chest.add(root);
      const { segs, tip } = chainF(root, {
        n: TENT.n, len0: TENT.len0, len1: TENT.len1, r0: TENT.r0, r1: TENT.r1,
        rot0: 0, rotD: 0, ring: true, ringColor: IRON, seg: TENT.seg,
        // 腹面吸盤列(內彎面;i=0 靠根不放,梢節太細不放)—— 與步行觸手同一支 _suck
        drawSeg: (t, i, { r, len }) => { if (i >= 1 && i <= 4) this._suck(c, t, r, len); },
      }, PAL.dark, { metalness: 0.55 });
      // S 形:chainF 的 rot0 + i·rotD 是**單調同號**的等差級數 ⇒ 曲率恆同號 = 只彎得出 C。
      // 逐節覆寫成中途變號的序列才是 S(TENT_S:+ + + + − −;累積 0.64/1.32/1.88/2.06/1.78/1.40
      // —— 中段捲到與舊制 2.01 同高度,再由最後兩節回勾 0.66 rad 把梢端往外上翻)。
      // 生根點與根部三個角(pitch/roll/yaw)一格未動(使用者:上觸手角度 OK)。
      // 覆寫 MUST 排在下面 updateMatrixWorld 之前 —— tipP 是拿**當下**世界四元數反解的,
      // 晚一步就等於用舊姿勢對齊,槍口會歪掉整條 S 的量。
      // extra() 之後讀 t.rotation.x 當 base,tentGuard 寫 `j.base + …` ⇒ S 與蠕動波共存。
      segs.forEach((t, i) => { t.rotation.x = def.s[i]; });
      const tipP = new THREE.Group();
      tipP.position.set(0, 0, -0.4);
      tip.add(tipP);
      F.g.updateMatrixWorld(true);
      tipP.quaternion.copy(tip.getWorldQuaternion(new THREE.Quaternion()).invert());
      return { segs, tip, tipP };
    };
    // 彎度逐節給(TENT_S:中段捲到與舊制同高、末兩節回勾 ⇒ S 形而不是 C 弧);
    // roll 把捲曲面往外傾(★ 圖的側向迴圈外倒,梢端收在外上角不擠向中線)。
    // 後對整體 ×0.98 = 沿用舊制那一點點前後差(舊:0.26/0.03 對 0.24/0.028)。
    const front = { pitch: 0.95, roll: 0.75, s: TENT_S };
    const rear = { pitch: 0.9, roll: 0.75, s: TENT_S.map((v) => v * 0.98) };
    const tGun = mkTent(1, true, front), tOrb = mkTent(-1, true, front);
    const tPodL = mkTent(-1, false, rear), tPodR = mkTent(1, false, rear);
    // 25mm 空爆機砲(右上觸手梢):tboxF 機匣 + latheF 階狀砲身 + 側彈鼓 + 砲口充能環
    const gp = tGun.tipP;
    tboxF(gp, { w0: 0.2, d0: 0.44, w1: 0.17, d1: 0.36, h: 0.2 }, 0, 0, 0, GUNMETAL, { metalness: 0.75 });
    const brl = latheF(gp, [[0.052, -0.05], [0.052, 0.3], [0.04, 0.33], [0.04, 0.72]], 10, 0, 0, 0.2, COAL, { metalness: 0.85 });
    brl.rotation.x = Math.PI / 2;
    const drum = cylF(gp, 0.09, 0.09, 0.12, 10, 0.16, -0.04, 0.02, IRON, { metalness: 0.7 });
    drum.rotation.z = Math.PI / 2;
    const lMuz = latheF(gp, [[0.045, -0.025], [0.065, -0.01], [0.065, 0.01], [0.045, 0.025]], 8, 0, 0, 0.95, accent, { emissive: accent, emissiveIntensity: 1.2 });
    lMuz.rotation.x = Math.PI / 2;
    // 諧振器(左上觸手梢):latheF 托座 + 諧振球 + 斜交 torusF 環 ×2
    const op = tOrb.tipP;
    const cup = latheF(op, [[0.05, 0], [0.16, 0.06], [0.2, 0.17]], 10, 0, 0, 0.12, GUNMETAL, { metalness: 0.75 });
    cup.rotation.x = Math.PI / 2;
    const orb = sphF(op, 0.17, 0, 0, 0.36, accent, { emissive: accent, emissiveIntensity: 1.5 });
    for (const ry of [-0.7, 0.7]) {
      const ring = torusF(op, 0.23, 0.018, 0, 0, 0.36, PAL.lite, { metalness: 0.6 });
      ring.rotation.y = ry;
      ring.userData.noOutline = true;
    }
    // 攔截彈 ×2(下對觸手各托一枚;★ 圖的白灰飛彈):托架 + latheF 彈體 + coneF 彈頭 + finF 尾翼 ×4
    const mkPod = (tipP) => {
      tboxF(tipP, { w0: 0.14, d0: 0.55, w1: 0.18, d1: 0.65, h: 0.1 }, 0, -0.14, 0, GUNMETAL, { metalness: 0.7 });
      const rk = new THREE.Group();
      rk.rotation.x = -0.08;
      tipP.add(rk);
      const bd = latheF(rk, [[0.07, -0.55], [0.075, -0.3], [0.075, 0.42], [0.06, 0.5]], 10, 0, 0, 0, STEEL2, { metalness: 0.6 });
      bd.rotation.x = Math.PI / 2;
      const nose = coneF(rk, 0.062, 0.3, 10, 0, 0, 0.64, STEEL2, { metalness: 0.6 });
      nose.rotation.x = Math.PI / 2;
      for (let k = 0; k < 4; k++) {
        const fn = finF(rk, { len: 0.2, w0: 0.03, w1: 0.018, t: 0.16, sweep: -0.06 }, 0, 0, -0.44, STEEL2, { metalness: 0.7 });
        fn.rotation.z = Math.PI / 4 + k * Math.PI / 2;
      }
    };
    mkPod(tPodL.tipP);
    mkPod(tPodR.tipP);
    c._tents = [tGun.segs, tOrb.segs, tPodL.segs, tPodR.segs];
    return {
      gunR: null, gunL: null,
      muzzles: { light: { n: lMuz, r: 0.06 }, heavy: { n: orb, r: 0.14 } },
      lightGlowM: [lMuz], heavyGlowM: [orb],
      heavyPivot: [{
        obj: op,
        rest: { x: op.rotation.x, y: op.rotation.y, z: op.rotation.z },
        deploy: { x: op.rotation.x - 0.3, y: op.rotation.y, z: op.rotation.z },
      }],
      weap: { light: 'N', heavy: 'N' },
      hvy: { chest: 0.04 },
      aimPose: null,
      wpn: { light: { nodes: [gp], ref: gp, muz: lMuz, fwd: 'z' }, heavy: { nodes: [op], ref: op, muz: orb, fwd: 'z' } },
    };
  },
  extra(c, F, rig) {
    // 持武觸手進 tentGuard(蓄勢 S 形 + 節節延遲蠕動):chain 條目 {g, base, k, d};
    // 梢節 k 收小 —— 武器要穩得住(models.js 同語意)
    rig.tents = c._tents.map((segs) => segs.map((t, i) => ({
      g: t, base: t.rotation.x, k: i === segs.length - 1 ? 0.1 : 0.26, d: i * 0.55,
    })));
  },
};
