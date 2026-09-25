// ============ m01@flight Mech Part Specification (Airframe, dev-only) ============
// m01 "Raven" Variable Assault Mech -- Flight Mode (Delta Glider).
// Reference 2D static art: public/assets/cyberpunk_art/mechs/m01_flight_static.png / m01_ground_static.png
//
// Replaces three rotors with delta glider wings:
// - Ground mode folds glider wings down into a cape; flight mode extends legs straight back and unfurls delta glider.
// - Rotor meshes retired and spin roster cleared. Lift model is gliding; legs extend rearward as trim surfaces.
// - Single seam: m01.glider is shared across modes. Ground hangs on back as cape; flight unfolds to horizontal delta wing.
// - Reuses identical component geometry constructed in m01.js.
import * as THREE from 'three';
import m01 from './m01.js';
import { bipedDims, groundCtx, upright } from './_morph.js';

const PITCH = 1.16;           // Torso forward pitch (glide stance: noble upright posture compressed into dive line)
const HG = 6.0;               // Ground framing height = shared skeletal scale reference
// Glider wings scaled up 2x in deployed flight configuration (GW = 2.0).
// Scale lives strictly on flight mode without altering m01.glider definition to avoid oversized ground cape.
// Uniform scaling retains identical spar counts, edge trims, and wingtip lights.
const GW = 2.0;

export default {
  // Palette hue matches ground mode for consistent paint scheme across forms.
  label: '渡鴉・飛行型(m01 三角滑翔翼)', kind: 'air', height: HG,
  air: { tiltY: 3.0, bob: 0.05, top: 30, level: true, span: 10.4 },   // span proportional to wing: GW x 2 -> 5.2 to 10.4
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
    m01.head(c, upright(chest, PITCH - 0.30, 0, dim.headYl, 0.04));   // Slight neck pitch up toward flight direction

    // ---- Arms extended forward along flight direction (holding weapons) ----
    // Forearms (= weapon mounts) must align to world -PI/2 (limbs extend along local -y -> Rx(-PI/2) maps to world +z forward).
    // Weapon body extends along mount +y (m01.mount fwd:'y') while limbs extend along -y:
    // Forearm forward vs muzzle forward differ by PI; difference is compensated by wrist + weapon mount.
    // Pure X rotations under hull are additive: world angle = PITCH + sum of local angles.
    // Sum of local angles across 3 joints MUST equal -PI/2 - PITCH.
    // Shoulder Z splay is zeroed to prevent steering muzzle off-axis; lateral separation comes strictly from shoulderX.
    const ELB = 0.14;                             // Shoulder lift / elbow flex (equal and opposite -> net hand angle stays zero)
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
      fore.add(hand);                             // Wrist angle solved after mount via AIMA
      hands[sx] = hand;
    }

    // ---- Legs extended straight back (trim plane with calf aerofoil fins) ----
    for (const sx of [-1, 1]) {
      const cx = { ...c, sx };
      const root = new THREE.Group();
      root.position.set(sx * dim.legX, 0, 0);
      root.rotation.set(Math.PI / 2 - PITCH + 0.16, 0, -sx * 0.10);  // World angle ≈ +PI/2 = horizontal rear extension
      hull.add(root);
      m01.thigh(cx, root, { len: dim.thighL });
      const shin = new THREE.Group();
      shin.position.y = -dim.thighL;
      shin.rotation.x = 0.05;                          // Near-zero knee flexion = straight leg extension
      root.add(shin);
      m01.shin(cx, shin, { len: dim.shinL });
      const foot = new THREE.Group();
      foot.position.y = -dim.shinL;
      foot.rotation.x = -0.30;                         // Pointed instep
      shin.add(foot);
      m01.foot(cx, foot, { clear: dim.clear, footL: dim.footL });
    }

    // ---- Delta Glider: Deployed directly from the two ground-mode panels ----
    // m01.chest instantiates two cape panels stored in c.gliders; adjust transforms in-place without re-instantiating.
    // Transform is relative to chest: local angle compensates for torso pitch (Rx(PITCH) * Rx(rx) * Rz(rz)).
    // Scale (GW) differentiates folded cape vs expanded flight wings.
    for (const sx of [-1, 1]) {
      const w = c.gliders[sx];
      w.position.y = dim.shoulderYl * 0.98;
      w.rotation.set(-Math.PI / 2 + 0.14 - PITCH, 0, sx * 1.95);
      w.scale.setScalar(GW);                       // Scaled 2x in deployed flight configuration
    }

    c._W = m01.mount(c, { chest, handL: hands[-1], handR: hands[1], hips });

    // ---- Realign muzzles to flight heading: wrist + gun mount split the PI offset ----
    // Mount angles are derived from ground mode: gunR.aim (AIMA) is the aimed weapon angle,
    // and wrist angle compensates the remainder (PI - AIMA).
    // Static placement ensures muzzles point forward during unpiloted cruise mode.
    const AIMA = c._W.gunR.aim;
    for (const sx of [-1, 1]) hands[sx].rotation.x = Math.PI - AIMA;
    for (const gp of [c._W.gunR, c._W.gunL]) gp.g.rotation.x = AIMA;
  },

  // Lift generated entirely by glider wings (no rotors or thruster nozzles) -> empty lift roster.
  lift() { return {}; },

  mount(c) { return { ...c._W, gunR: null, gunL: null, aimPose: null }; },
};
