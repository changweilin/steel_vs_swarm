// ============ m01@flight 逐機零件檔(航空機體;dev-only)============
// m01「渡鴉」可變式突襲機甲 —— **飛行型**(三角滑翔翼)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m01_flight_static.png / m01_ground_static.png
//
// 2026-08-13 使用者定案:「吸血鬼:**移除旋翼,改成三角滑翔翼**;地面模式收起滑翔翼變成
// 披風;飛行模式時腿向後伸直,展開滑翔翼。」
//   ⇒ 舊制那三具旋翼(機首桅 ×1 + 腿末 ×2 的正三角)整組退場,連帶 `spin` 名冊清空;
//     mecha.js gen.sil 的「雙腿當機臂的 Y 字 + 三具旋翼等距正三角」是 2D 圖的描述,
//     使用者這一輪改了升力形式(**滑翔**),雙腿因此改成向後打直的配平面。
//   ⇒ 翼是 `m01.glider`(唯一縫):地面型垂下貼背 = 披風、飛行型轉成水平三角翼,同一片零件。
// 加上總則「盡量用相同零件變形」⇒ 本檔的機體幾何全部來自 `m01.js` 的建構器。
import * as THREE from 'three';
import m01 from './m01.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

const PITCH = 1.16;           // 軀幹前傾(滑翔姿態:貴族式挺立被壓成滑翔者的俯衝線)
const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準
// 2026-08-14 使用者:「三角滑翔翼**放大一倍**」⇒ 展開態的翼**整片等比 ×2**。
// 放大只住這一端(飛行型),MUST NOT 改 `m01.glider` 本身 —— 那一片同時是地面態的披風,
// 在那裡放大就是一件拖在地上 5.7m 的斗篷。等比縮放不是「另一片零件」:形狀、翼樑數、
// 前緣滾邊、翼尖燈逐項同一份,只是展開後的尺寸(這正是「兩態同一片零件」允許的變換)。
const GW = 2.0;

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '渡鴉・飛行型(m01 三角滑翔翼)', kind: 'air', height: HG,
  air: { tiltY: 3.0, bob: 0.05, top: 30, level: true, span: 10.4 },   // span ∝ 翼:GW ×2 ⇒ 5.2 → 10.4
  moveSig: { hover: 0.20, hoverF: 0.8, hoverA: 0.10, surge: 0.85, flare: 0.55, bank: 0.78 },
  castSig: { omni: 'spin', dir: 'swing' },
  doc: [
    ['修長軀幹', '地面型切面楔胸 + 腹甲 + 金滾邊(m01.chest)整組前傾成滑翔線'],
    ['頭 + 高立領', '地面型頭部(m01.head)+ 反傾中介 Group —— 立領是剪影識別點,兩態同一顆'],
    ['三角滑翔翼 ×2(放大一倍)', 'm01.glider 展開後整片等比 ×2:膜面 + 翼樑 ×3 + 前緣金滾邊 + 翼尖燈(地面態 = 披風,不放大)'],
    ['雙腿後伸打直', '同一組腿件(m01.thigh/shin/foot)向後打直當配平面 + 小腿導流鰭'],
    ['雙臂筆直前伸', '同一組臂件沿航向前伸端武器(m01.armUp/armFore);臂三節相加 = −π/2 − PITCH ⇒ 前臂朝航向,腕與槍架再補 π ⇒ 槍口朝航向'],
    ['武裝', '同一具 M134 六管速射艙(右)+ 地獄火雙聯發射管(左),由手直接端著'],
  ],

  body(c, t) {
    const dim = bipedDims(m01, HG);
    groundCtx(c, dim);
    const hull = new THREE.Group();
    hull.position.set(0, 0.1, -0.45);
    hull.rotation.x = PITCH;
    t.add(hull);

    const hips = new THREE.Group();
    hull.add(hips);
    m01.pelvis(c, hips, { shoulderX: dim.shoulderX });
    const chest = new THREE.Group();
    hips.add(chest);
    m01.chest(c, chest, { shoulderX: dim.shoulderX, shoulderY: dim.shoulderYl, waistY: dim.waistYl });
    m01.head(c, upright(chest, PITCH - 0.30, 0, dim.headYl, 0.04));   // 微抬頭看航向

    // ---- 雙臂沿航向前伸(端著武器的飛行姿態)----
    // 2026-08-14 使用者:「**手持武器筆直朝前**」⇒ 前臂(= 武器掛點)的世界指向 MUST 恰為 −π/2
    // (肢體鏈沿局部 −y 長 ⇒ Rx(−π/2) 把它送到世界 +z = 航向)。
    // ⚠ **臂角只擺得了臂,擺不了槍**:槍身沿掛架的 **+y**(m01.mount 的 `fwd:'y'`)而肢體沿 −y
    //   ⇒ 「前臂朝航向」與「槍口朝航向」的世界角相差恰 π,那一份差由**腕 + 槍架**補(下方
    //   mount 之後那一段)。少補的話槍口停在世界 −π/2 + REST —— 實測 dot(+z) = −0.13,
    //   而臂確實筆直朝前、每一條斷言也都正常(2026-08-15 由 audit_muzzle 改讀 rigAir 後才浮現)。
    // ⚠ 純 x 旋轉在 hull 之下是**加法**:世界角 = PITCH + Σ 本地角。因此三節的本地角**加起來**
    //   MUST = −π/2 − PITCH,肩抬多少肘就折回多少;寫成 −PITCH−0.16 的話世界角只有 −0.16
    //   = 幾乎垂下。舊值 (+0.30, −0.22, +0.30) 加起來是 +0.38 ⇒ 槍口朝斜上方 22°。
    // ⚠ 肩的 z 外撇同樣會把槍口帶開(Rz 之後 Rx 的軸已不是世界 x):**外撇一律歸零**,
    //   兩臂的橫向間距只由肩寬 shoulderX 給 —— 那才是「筆直朝前」。
    const ELB = 0.14;                             // 肩抬 / 肘折(等量互抵 ⇒ 手部淨角恆為 0)
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const arm = new THREE.Group();
      arm.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      arm.rotation.set(-Math.PI / 2 - PITCH + ELB, 0, 0);
      chest.add(arm);
      m01.armUp(cx, arm, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      fore.rotation.x = -ELB;
      arm.add(fore);
      m01.armFore(cx, fore, { len: dim.foreArmL });
      const hand = new THREE.Group();
      hand.position.y = -dim.foreArmL;
      fore.add(hand);                             // 腕角在 mount 之後由 AIMA 反解(見下)
      hands[sx] = hand;
    }

    // ---- 雙腿向後打直(使用者定案的滑翔姿態;小腿導流鰭在後成為配平面)----
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const root = new THREE.Group();
      root.position.set(sx * dim.legX, 0, 0);
      root.rotation.set(Math.PI / 2 - PITCH + 0.16, 0, -sx * 0.10);  // 世界角 ≈ +π/2 = 水平後伸
      hull.add(root);
      m01.thigh(cx, root, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.x = 0.05;                          // 幾乎不屈膝 = 「腿向後伸直」
      root.add(shin);
      m01.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.x = -0.30;                         // 腳背繃直
      shin.add(foot);
      m01.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- 三角滑翔翼:**地面型那兩片就地展開**(2026-08-15 使用者:「不要用透明顯現,
    //      要與地面形態的左右半翼整合,大小以飛行形態為主,地面時兩半收起,飛行時展開組合」)----
    // `m01.chest` 已經生了兩片(披風態)並交在 `c.gliders` 上 ⇒ 這裡**只改擺位**,MUST NOT 再叫
    // 一次 `m01.glider`。舊制多叫的那兩片標籤是 `glider#2/#3`、地面型沒有對手 ⇒ 18 件走淡入,
    // 而披風那兩片照樣垂著 = 飛行型身上其實有**四**片半翼。
    // ⚠ 角度改成**相對 chest**:舊制掛在反傾錨(`upright`)上算的是世界角,而零件現在住在
    //   chest 底下 ⇒ 同一個世界朝向的本地角 MUST 自己扣掉軀幹前傾(純 x 旋轉在此是加法,
    //   Rx(PITCH)·Rx(rx)·Rz(rz) = Rx(PITCH+rx)·Rz(rz) ⇒ 只有 x 那一項要扣)。
    //   不扣就是被前傾再轉一次 —— 兩片翼變成朝上的 V 字(舊註解實測 21° 上反)。
    // 伸縮是使用者列的四個變形通道之一 ⇒ 「收起 / 展開」就用 scale 表達:飛行態 GW(大小以
    // 飛行形態為主),地面態留在 1 = 收攏成穿得住的斗篷(整片放大會變成拖在地上 5.7m 的斗篷)。
    for (const sx of [-1, 1]) {
      const w = c.gliders[sx];
      w.position.y = dim.shoulderYl * 0.98;
      w.rotation.set(-Math.PI / 2 + 0.14 - PITCH, 0, sx * 1.95);
      w.scale.setScalar(GW);                       // 展開態放大一倍(GW 檔頭)
    }

    c._W = m01.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });

    // ---- 槍口對回航向:腕 + 槍架分擔臂與槍身之間那 π ----
    // 槍架的兩個角都**由地面型導出、MUST NOT 手寫**:`gunR.aim`(= AIMA)是這把槍在手裡
    // 「據槍」時的架角(地面型交戰就是這個相對關係,連握把與供彈匣的朝向一起沿用),
    // 腕角補剩下的 `π − AIMA` ⇒ 槍身世界角 = −π/2 + (π − AIMA) + AIMA = +π/2 = 槍口朝航向,
    // 而臂仍逐位元停在「筆直前伸」的 −π/2 上(使用者那句話的兩半都成立)。
    // 掛在**靜態擺位**上而不是靠 locomotion 據槍:飛行型的 gunR/gunL 是 null(見 mount),
    // 巡航中沒有人會去驅動那兩個樞軸 ⇒ 只在開火時才對得上的話,平飛時槍口是歪的。
    const AIMA = c._W.gunR.aim;
    for (const sx of [-1, 1]) hands[sx].rotation.x = Math.PI - AIMA;
    for (const gp of [c._W.gunR, c._W.gunL]) gp.g.rotation.x = AIMA;
  },

  // 升力全部來自滑翔翼(無旋翼、無噴口)⇒ 沒有 spin / jets / wings 名冊
  lift() { return {}; },

  mount(c) { return { ...c._W, gunR: null, gunL: null, aimPose: null }; },
};
