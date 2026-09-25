// ============ m05@flight Mech Part Specification (Airframe, dev-only) ============
// m05 "Chokehold" EW Variable Mech -- Flight Mode (Flying Squirrel Glider).
// Reference 2D static art: public/assets/cyberpunk_art/mechs/m05_ground_static.jpg (ground mode is primary design basis).
//
// Werewolf + flying squirrel design rework:
// - Werewolf remains primary body; wings removed. Wolf head points forward in flight; limbs spread in flying squirrel glide.
// - Patagium membrane converts from transparent to opaque solid; claws prominent; tail steers flight.
// - Retires jet fighter elements (swept wings, intakes, EW pods, jet exhaust). Lift surface is patagium membrane.
// - Component ratio: 75% werewolf (ground mode) / 25% flying squirrel (spread posture + solid patagium).
// - Tail registered in rig.tailSegs: locomotion whipTail swings tail inversely to yaw rate for aerodynamic steering.
import * as THREE from 'three';
import m05 from './m05.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

const PITCH = 1.44;           // Torso near-horizontal (glide stance; wolf head facing flight path)
const HG = 6.0;               // Ground framing height = shared skeletal scale reference

export default {
  // Palette hue matches ground mode for consistent paint scheme across forms.
  label: '鎖喉・飛行型(m05 飛鼠滑翔)', kind: 'air', height: HG,
  air: { tiltY: 3.0, bob: 0.05, top: 30, span: 6.0 },
  moveSig: { hover: 0.22, hoverF: 0.8, hoverA: 0.12, surge: 0.80, flare: 0.70, bank: 0.75 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['狼首朝航向', '地面型楔形狼首(m05.head:錯咬齒列/犬齒/怒眉稜/三角耳殼)+ 反傾中介 Group'],
    ['軀幹 + 鬃冠', '地面型犬科比例軀幹(鬐甲/胸廓/腰段/肩胛板)/胸毛疊瓦板/電戰背包/頸背鬃冠(m05.chest)壓平成滑翔線'],
    ['四肢張開成 X', '同一組臂件/腿件(m05.armUp/armFore/thigh/shin/foot):前肢前外、後肢後外,與體軸各 45°(m05.GLIDE,量自飛鼠解剖圖)'],
    ['飛膜 ×2(實體)', 'm05.patagium 展開:四附著點 = 頸/腕/踝/尾根(解剖圖),輪廓自四肢關節座標推導 + 膜骨 ×3 + 外緣識別稜(地面態 = 收攏成貼體側的半透明皮褶,同一片)'],
    ['爪 ×2 + 足爪 ×6', '加大的彎爪錐(兩態同一組;張開時是全機最顯眼的一批零件)'],
    ['方向舵尾', '三節狼尾節鏈 + 逐節橫向舵羽(扁尾;m05.extra)進 rig.tailSegs ⇒ whipTail 依轉向甩尾控向'],
    ['武裝', '同一具六管電磁旋砲(右)+ 追債者 2×2 制導彈箱(左),由爪直接握著;滑翔時**順著航向收成翼端砲艙**(槍管軸 = 機首方向,不垂下來)'],
  ],

  body(c, t) {
    const dim = bipedDims(m05, HG);
    groundCtx(c, dim);
    c._glide = true;      // Signals m05.chest that patagium unfolds here to skip folded skin fold.
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
    m05.head(c, upright(chest, PITCH - 0.34, 0, dim.headYl, 0.04));   // Wolf head tilted up facing flight heading

    // ---- Limbs splayed into X-form (forelimbs forward-out, hindlimbs rear-out; membrane spans between all 4 points) ----
    // Angles derived from m05.GLIDE (shared with patagium outline).
    // Each limb uses two Groups: 1) Sweep Rz, 2) Roll Ry along limb axis.
    // Roll rotates elbow/knee flexion into the glide plane.
    const GL = m05.GLIDE;
    const hands = {};
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const piv = new THREE.Group();
      piv.position.set(sx * dim.shoulderX, dim.shoulderYl, 0);
      piv.rotation.z = sx * (Math.PI / 2 + GL.armSweep);        // Forelimb: lateral -> swept toward nose
      chest.add(piv);
      const arm = new THREE.Group();
      arm.rotation.y = -sx * Math.PI / 2;                       // Roll: rotates elbow flexion into glide plane
      piv.add(arm);
      m05.armUp(cx, arm, { len: dim.upperArmL });
      const fore = new THREE.Group();
      fore.position.y = -dim.upperArmL;
      fore.rotation.x = GL.elbow;
      arm.add(fore);
      m05.armFore(cx, fore, { len: dim.foreArmL });
      const hand = new THREE.Group();
      hand.position.y = -dim.foreArmL;
      hand.rotation.y = sx * Math.PI / 2;                       // Roll inverted: weapon orientation matches ground form
      hand.name = `wrist${sx}`;                                 // Probe anchor: forward patagium corner MUST land here
      fore.add(hand);
      hands[sx] = hand;
    }
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const piv = new THREE.Group();
      piv.position.set(sx * dim.legX, 0, 0);
      piv.rotation.z = sx * (Math.PI / 2 - GL.legSweep);        // Hindlimb: lateral -> swept toward tail
      hull.add(piv);
      const leg = new THREE.Group();
      leg.rotation.y = -sx * Math.PI / 2;
      piv.add(leg);
      m05.thigh(cx, leg, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.x = -GL.knee;
      leg.add(shin);
      m05.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.x = GL.toe;                                 // Claws trail rearward (feet tucked during squirrel glide)
      foot.name = `ankle${sx}`;                                 // Probe anchor: rear patagium corner MUST land here
      shin.add(foot);
      m05.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- Patagium: Deployed as solid membrane ----
    // Mounted on chest with zero rotation: membrane and limbs remain coplanar in torso local XY.
    const out = m05.patagiumOutline(HG, dim.G, dim.shoulderX, dim.shoulderYl);
    for (const sx of [-1, 1]) {
      const w = m05.patagium(c, chest, sx, true, out);
      w.position.z = -0.03;
      w.name = `pata${sx}`;
    }

    // ---- Rudder tail (three-segment wolf tail from m05.extra) ----
    // Mounted on upright anchor: prevents torso pitch from turning tail upward.
    // In flight mode, baseline posture extends straight back as an aerodynamic rudder.
    c.tailCurl = { rot0: 0, rotD: 0 };
    const stub = { muzzles: {}, heavy: { glow: [] }, wpn: {} };
    m05.extra(c, { hips: upright(hips, PITCH) }, stub);
    c._tail = stub.tailSegs;

    c._W = m05.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });
    // ---- Weapons aligned with flight heading ----
    // Forelimb sweep and roll transform hand orientation to Rz(phi) where phi = sx * (PI/2 + armSweep + elbow).
    // Compensate with Rz(-phi) so weapon local +y returns to flight heading.
    // Derived strictly from m05.GLIDE single seam.
    const GPHI = Math.PI / 2 + GL.armSweep + GL.elbow;
    for (const [w, sx] of [[c._W.gunR, 1], [c._W.gunL, -1]]) {
      if (!w?.g) continue;
      w.g.rotation.set(0, 0, -sx * GPHI);
      w.g.position.set(sx * 0.06, -0.10, 0.02);   // Tucked against palm; z represents height above glide plane -> close to zero
    }
  },

  // Lift generated entirely by patagium gliding (no wings, rotors, or thruster nozzles).
  lift() { return {}; },

  // Tail rudder: registered in rig.tailSegs; whipTail swings tail against yawRate for flight steering.
  tail(c) { return c._tail || null; },

  mount(c) { return { ...c._W, gunR: null, gunL: null, aimPose: null }; },
};
