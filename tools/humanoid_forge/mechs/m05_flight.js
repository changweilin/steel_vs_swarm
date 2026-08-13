// ============ m05@flight 逐機零件檔(航空機體;dev-only)============
// m05「鎖喉」電戰可變機甲 —— **飛行型**(飛鼠滑翔態)。
// 2D 定案圖:public/assets/cyberpunk_art/mechs/m05_ground_static.jpg(地面型 = 建模主體)
//
// 2026-08-13 使用者定案:「狼人+飛鼠:**重製為狼人為主體,移除羽翼**,飛行型態狼頭朝前,
// 四肢飛鼠一樣打開,飛膜由透明轉實體,爪子更顯眼,尾巴控制方向。」
//   ⇒ 舊制那台「噴射戰機」(壓平機身 + wingF 後掠翼 + 進氣口 + 干擾吊艙 + 尾焰)整組退場:
//     mecha.js gen.sil 的「機身壓平、肩部進氣口、翼下干擾吊艙」是 2D 圖的描述,使用者這一輪
//     把飛行原型從噴射機改成**飛鼠**,升力面因此是**飛膜**不是翼。
//   ⇒ 零件比例:狼人(地面型)75% / 飛鼠 25% —— 飛鼠那 25% 就是「四肢張開的姿態 + 實體飛膜」,
//     其餘(頭/胸/鬃冠/四肢/爪/尾/武器)全部是 m05.js 的同一批零件。
//   ⇒ **尾巴進 rig.tailSegs**:locomotion whipTail 依轉向角速度把尾甩向反側 = 使用者說的
//     「尾巴控制方向」(這一台與 t06 相反 —— t06 的尾是武器瞄準架,刻意不掛)。
import * as THREE from 'three';
import m05 from './m05.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

const PITCH = 1.44;           // 軀幹幾乎水平(滑翔;狼頭朝航向)
const HG = 6.0;               // 地面型的取景高 = 兩態共用的骨架尺度基準

export default {
  // 色相 MUST = 地面型(同一台機的同一批塗裝)
  label: '鎖喉・飛行型(m05 飛鼠滑翔)', hue: m05.hue, kind: 'air', height: HG,
  air: { tiltY: 3.0, bob: 0.05, top: 30, span: 6.0 },
  moveSig: { hover: 0.22, hoverF: 0.8, hoverA: 0.12, surge: 0.80, flare: 0.70, bank: 0.75 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['狼首朝航向', '地面型楔形狼首(m05.head:錯咬齒列/犬齒/怒眉稜/三角耳殼)+ 反傾中介 Group'],
    ['軀幹 + 鬃冠', '地面型主甲/胸毛疊瓦板/電戰背包/頸背鬃冠(m05.chest)整組壓平成滑翔線'],
    ['四肢張開', '同一組臂件/腿件(m05.armUp/armFore/thigh/shin/foot)向四角張開 = 飛鼠姿態'],
    ['飛膜 ×2(實體)', 'm05.patagium 展開:膜面 + 膜骨 ×4 + 前緣識別稜(地面態 = 半透明皮褶)'],
    ['爪 ×2 + 足爪 ×6', '加大的彎爪錐(兩態同一組;張開時是全機最顯眼的一批零件)'],
    ['方向舵尾', '三節狼尾節鏈(m05.extra)進 rig.tailSegs ⇒ whipTail 依轉向甩尾控向'],
    ['武裝', '同一具六管電磁旋砲(右)+ 追債者 2×2 制導彈箱(左),由爪直接握著'],
  ],

  body(c, t) {
    const dim = bipedDims(m05, HG);
    groundCtx(c, dim);
    const hull = new THREE.Group();
    hull.position.set(0, 0.1, -0.35);
    hull.rotation.x = PITCH;
    t.add(hull);

    const hips = new THREE.Group();
    hull.add(hips);
    m05.pelvis(c, hips, { shoulderX: dim.shoulderX });
    const chest = new THREE.Group();
    hips.add(chest);
    m05.chest(c, chest, { shoulderX: dim.shoulderX, shoulderY: dim.shoulderYl, waistY: dim.waistYl });
    m05.head(c, upright(chest, PITCH - 0.34, 0, dim.headYl, 0.04));   // 狼頭抬起朝航向

    // ---- 四肢像飛鼠一樣張開(前肢朝前外、後肢朝後外;膜就撐在這四點之間)----
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const arm = new THREE.Group();
      arm.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      // 繞 z 轉 ≈90° 把肢體(朝 −y)甩到 ±x = 翼展方向;再繞 x 微前擺(前肢在膜的前緣)
      arm.rotation.set(-0.42, 0, sx * (Math.PI / 2 - 0.16));
      chest.add(arm);
      m05.armUp(cx, arm, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      fore.rotation.x = -0.20;
      arm.add(fore);
      m05.armFore(cx, fore, { len: dim.foreArmL });
      const hand = new THREE.Group();
      hand.position.y = -dim.foreArmL;
      fore.add(hand);
      hands[sx] = hand;
    }
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const root = new THREE.Group();
      root.position.set(sx * dim.legX, 0, 0);
      root.rotation.set(0.44, 0, sx * (Math.PI / 2 - 0.28));   // 後肢朝後外(膜的後緣)
      hull.add(root);
      m05.thigh(cx, root, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.x = 0.18;
      root.add(shin);
      m05.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.x = -0.30;
      shin.add(foot);
      m05.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- 飛膜:同一片零件轉成水平實體膜 ----
    // **MUST 掛在反傾錨上**:−π/2 是相對世界算的;掛 chest 會被軀幹前傾再轉一次 ⇒ 膜立起來
    // 變成兩片側板(而每一條斷言都正常)。
    for (const sx of [-1, 1]) {
      const anch = upright(chest, PITCH, sx * (dim.shoulderX * 0.66), dim.shoulderYl * 0.30, -0.05);
      const w = m05.patagium(c, anch, sx, true);
      w.rotation.set(-Math.PI / 2, 0, 0);
    }

    // ---- 方向舵尾(m05.extra 的同一條三節狼尾)----
    // **MUST 掛在反傾錨上**:節鏈沿局部 −z 往後長,直接掛 hips 會被軀幹前傾 1.44 轉成朝天
    // 的一根立桿(實測第一版就是這樣),而 whipTail 只覆寫節樞軸、不會把它轉回來。
    const stub = { muzzles: {}, heavy: { glow: [] }, wpn: {} };
    m05.extra(c, { hips: upright(hips, PITCH) }, stub);
    c._tail = stub.tailSegs;

    c._W = m05.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });
  },

  // 升力全部來自飛膜滑翔(無翼、無旋翼、無噴口)
  lift() { return {}; },

  // 尾巴 = 方向舵:掛進 rig.tailSegs ⇒ whipTail 依 yawRate 甩向反側(使用者「尾巴控制方向」)
  tail(c) { return c._tail || null; },

  mount(c) { return { ...c._W, gunR: null, gunL: null, aimPose: null }; },
};
