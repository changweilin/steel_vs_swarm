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

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '渡鴉・飛行型(m01 三角滑翔翼)', hue: m01.hue, kind: 'air', height: HG,
  air: { tiltY: 3.0, bob: 0.05, top: 30, level: true, span: 5.2 },
  moveSig: { hover: 0.20, hoverF: 0.8, hoverA: 0.10, surge: 0.85, flare: 0.55, bank: 0.78 },
  castSig: { omni: 'spin', dir: 'swing' },
  doc: [
    ['修長軀幹', '地面型切面楔胸 + 腹甲 + 金滾邊(m01.chest)整組前傾成滑翔線'],
    ['頭 + 高立領', '地面型頭部(m01.head)+ 反傾中介 Group —— 立領是剪影識別點,兩態同一顆'],
    ['三角滑翔翼 ×2', 'm01.glider 展開:膜面 + 翼樑 ×3 + 前緣金滾邊 + 翼尖燈(地面態 = 披風)'],
    ['雙腿後伸打直', '同一組腿件(m01.thigh/shin/foot)向後打直當配平面 + 小腿導流鰭'],
    ['雙臂前伸', '同一組臂件沿航向前伸端武器(m01.armUp/armFore)'],
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
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const arm = new THREE.Group();
      arm.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      // ⚠ 純 x 旋轉在 hull 之下是**加法**:世界角 = PITCH + 本地角。要世界水平前伸(−y → +z)
      // 得世界角 −π/2 ⇒ 本地 = −π/2 − PITCH。寫成 −PITCH−0.16 的話世界角只有 −0.16 = 幾乎垂下。
      arm.rotation.set(-Math.PI / 2 - PITCH + 0.30, 0, sx * 0.16);
      chest.add(arm);
      m01.armUp(cx, arm, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      fore.rotation.x = -0.22;
      arm.add(fore);
      m01.armFore(cx, fore, { len: dim.foreArmL });
      const hand = new THREE.Group();
      hand.position.y = -dim.foreArmL;
      hand.rotation.x = 0.30;
      fore.add(hand);
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

    // ---- 三角滑翔翼:同一片零件展開成水平翼 ----
    // Rz(sx·1.95) 把翼面主軸(局部 −y)甩到外後方;Rx(≈−π/2) 把面法線(局部 +z)立成 +y。
    // **MUST 掛在反傾錨上**:這一組角度是相對世界算的,直接掛 chest 的話會被軀幹前傾再轉一次
    // ⇒ 兩片翼變成朝上的 V 字(實測 21° 上反),而每一條斷言都正常。
    for (const sx of [-1, 1]) {
      const anch = upright(chest, PITCH, sx * 0.24, dim.shoulderYl * 0.98, -0.44);
      const w = m01.glider(c, anch, sx, 0, 0, 0);
      w.rotation.set(-Math.PI / 2 + 0.14, 0, sx * 1.95);
    }

    c._W = m01.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });
  },

  // 升力全部來自滑翔翼(無旋翼、無噴口)⇒ 沒有 spin / jets / wings 名冊
  lift() { return {}; },

  mount(c) { return { ...c._W, gunR: null, gunL: null, aimPose: null }; },
};
