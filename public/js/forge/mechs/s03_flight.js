// ============ s03@flight Mech Component (Flight Variant; dev-only) ============
// s03 "Leviathan" variable-geometry signal mech -- Flight Variant (sky-whale airship).
// Geometry primitives MUST come from ../geo.js; MUST NOT construct BufferGeometry here.
//
// Dual-state shared geometry:
// Ground and flight variants share the exact same component tree (spindle envelope,
// whale rostrum, belly cradle, conning tower, ear flippers, tusks, trunk, tail fluke, dorsal fin).
// Flight stance configuration:
//   1. Quadruped limbs fold into belly bay (+y / +z flush);
//   2. Cheek ear-flippers lay flat (ry = +-PI/2, rz = +-0.15) into swept pectoral flippers;
//   3. Tusks retract flush (rx = 0) along rostrum flanks;
//   4. 9-segment trunk straightens forward into a narwhal horn / sensor probe (rx = 0);
//   5. Flukes deploy horizontally (rx = 0, ry = 0).
// Stance transform matrices are derived via _morph.js computeMorphFrame; this file defines static flight overrides.
import * as THREE from 'three';
import { cylF, rotorF } from '../geo.js';
import s03 from './s03.js';
import { staticLimb } from './_morph.js';

const FR = s03.frame;

export default {
  // Hue MUST match ground variant (same vehicle livery).
  label: '利維坦・飛行型(s03 飛鯨浮空艦)', kind: 'air', height: s03.height,
  air: { tiltY: 3.0, bob: 0.11, top: 12, span: 3.6 },
  moveSig: { hover: 0.15, hoverF: 0.5, hoverA: 0.25, surge: 0.05, flare: 0.05, bank: 0.05 },
  castSig: { omni: 'roar', dir: 'swing' },
  doc: [
    ['鯨體 + 艦橋', 's03.envelope 同一條收分鯨體(隔艙稜線 ×16 + 繫留帶 ×3 + 桅桿雷達)'],
    ['鯨首(無脖子)', 's03.whaleHead 同一顆頭殼 —— 它是鯨體往前的外套續接,兩態都沒有頸'],
    ['胸鰭 ×2(移到體側)', 's03.earFin 同一片板:earOut 0 ⇒ 位置由頰側移到**體側**、板面放平(後掠 + 微下反)'],
    ['象牙(內縮)', 's03.tusk 同一對月牙:tuskOut 0 ⇒ 弧翻進頰囊'],
    ['獨角(象鼻挺直)', 's03.trunk 同一條九節軟鼻:trunkDown false ⇒ 挺成獨角鯨的角 + 螺旋稜'],
    ['象腿 ×4(上收)', '同一組柱狀象腿(s03.legF/legH,2.66 m)收進囊內:前腿進鼻艙(z 0.52~1.86)、後腿大腿斜前上抬過鰭根高度再落回中段 —— 兩者都完全避開胸鰭埋在囊內的那一段(z ±0.45、min|x| 0.39),膝轂改朝內'],
    ['鯨尾 + 背鰭', 's03.tail 同一組尾柄(側扁 0.86)+ 水平尾鰭(後掠 0.78 + 上反 17.2°);背鰭改長在軀幹上(s03.envelope)'],
    ['矢量推進器 ×2', '涵道低速螺槳(浮力機的唯一動力;無旋翼升力、無噴口)'],
  ],

  body(c, t) {
    // Morph knobs: switches ground colossus to flight whale form without replacing parts.
    c.earOut = 0; c.tuskOut = 0; c.trunkDown = false;

    const spine = new THREE.Group();
    t.add(spine);
    s03.body(c, spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    s03.neckHead(c, neck, head);
    c._spine = spine;

    // ---- Legs retracted into belly bay (static assembly via staticLimb) ----
    // Flipper root avoidance constraint:
    // The pectoral flipper roots embed deeply into envelope interior:
    //   z in [-0.3, 0.3] has min|x| = 0.39 (y in [-0.31, 0.06]),
    //   z >= 0.4 and z <= -0.5 have min|x| >= 0.80.
    // The ventral corridor (|x| < 0.39) cannot accommodate a 0.56-wide thigh without clipping.
    // Retracted limbs MUST bypass z in [-0.45, 0.45]:
    //   Forelegs tuck into rostrum bay (z 0.52 - 1.86).
    //   Hindleg thighs elevate forward-upward above flipper root upper edge (+0.06)
    //   before lower legs/feet drop back into mid-envelope.
    // Pose angles:
    //   Foreleg phi: +90 deg -> -137.5 deg -> 0 deg (thigh aft flush, shank folded up-forward, foot down)
    //   Hindleg phi: -120.3 deg -> -88.8 deg -> 0 deg (thigh forward-up, shank forward, foot down)
    // Knee hubs inward:
    //   _leg mounts knee hubs at c.sx * 0.28. Outward hubs clip flipper inner boundary at |x| = 0.65.
    //   Passing inverted sx turns hubs inward into belly void without altering part geometry.
    // Hull clipping clearance:
    //   Envelope is opaque; internal overlap between folded limbs is intentional and harmless.
    //   Placement balances upper-thigh dorsal breach against flipper-root lower penetration.
    //   px/py/pz/r0 parameters guarantee 0 triangle-plane intersections against flippers.
    for (const [sx, front, px, py, pz, r0, p1, p2] of [
      [-1, true, 0.30, -0.30, 1.78, 1.5708, -3.9708, 2.40],
      [1, true, 0.30, -0.30, 1.78, 1.5708, -3.9708, 2.40],
      [-1, false, 0.22, -0.02, -0.90, -2.10, 0.55, 1.55],
      [1, false, 0.22, -0.02, -0.90, -2.10, 0.55, 1.55],
    ]) {
      const cx = { ...c, sx: -sx, front };            // Invert sx so knee hubs face inward (see above).
      staticLimb(spine, front ? s03.legF(cx) : s03.legH(cx),
        [0, p1, p2], [sx * px, py, pz], [r0, 0, 0]);
    }
    // ---- Whale tail (shares ground form assets; mounted at envelope stern) ----
    const tail = new THREE.Group();
    tail.position.set(0, FR.tailY, FR.tailZ);
    spine.add(tail);
    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, -FR.tail2Z);
    tail.add(tail2);
    s03.tail(c, tail, tail2);
  },

  lift(c) {
    const { PAL, K } = c;
    const spin = [];
    for (const sx of [-1, 1]) {                      // Vectored thrusters (ducted low-speed props).
      cylF(c._spine, 0.3, 0.3, 0.34, 12, sx * 1.0, -0.5, -1.5, PAL.deep, { metalness: 0.7 }).rotation.x = Math.PI / 2;
      const r = rotorF(c._spine, { r: 0.26 * K.barrelF, blades: 4, pitch: 0.28, thick: 0.026, tilt: [Math.PI / 2, 0] },
        sx * 1.0, -0.5, -1.5, PAL.lite, { metalness: 0.5, transparent: true, opacity: 0.85 });
      spin.push(r.prop);
    }
    return { spin };
  },

  mount(c) { return s03.mount(c, { spine: c._spine }); },
};
