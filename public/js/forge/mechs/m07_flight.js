// ============ m07@flight Mech Component (Flight Variant; dev-only) ============
// m07 "Portcullis" area-denial variable mech -- Flight Variant (rhinoceros beetle: elytra open + flapping hindwings).
// Contains zero local geometry primitives; entirely composed from m07.js ground model generators.
// Elytra act as rigid armor shields (raised and stationary during flight, MUST NOT enter rig.wings).
// Membranous hindwings act as the sole propulsion surface and are registered in rig.wings.
// air.insect = true directs stepAerial to insect stroke solver (high-frequency figure-8 stroke plane + half-stroke inversion).
import * as THREE from 'three';
import m07 from './m07.js';
import { staticLimb } from './_morph.js';

const FR = m07.frame;

export default {
  // Hue MUST match ground variant (same vehicle livery).
  label: '落閘・飛行型(m07 犀金龜)', kind: 'air', height: m07.height,
  air: { tiltY: 2.6, bob: 0.1, top: 18, insect: true, span: 6.0 },
  moveSig: { hover: 0.42, hoverF: 0.7, hoverA: 1.35, surge: 0.15, flare: 0.60, bank: 0.20 },
  castSig: { omni: 'stomp', dir: 'jab' },
  doc: [
    ['甲殼軀幹', '陣地態的甲殼腹部 + 前胸背板 + 腹節環(m07.body)整組沿用'],
    ['犀角(加大)', 'm07.horn:上挑主角 finF len 1.6 + 側叉 ×2 + 角根鎧環 + 複眼'],
    ['鞘翅 ×2(掀起)', 'm07.elytron 同一片殼:繞前後軸滾轉掀到體側 —— **不進 rig.wings**'],
    ['膜翅 ×2(展開)', 'm07.memWing 同一對膜:內/外兩段樞軸展平 ⇒ 唯一的動力面'],
    ['六足(收折)', '同一組足件(m07.legF/legH/_leg)向後收折成起落姿'],
    ['背部防空砲塔', 'm07.turret 同一具雙管砲塔 + 頭下短莢'],
  ],

  body(c, t) {
    const { PAL } = c;
    // Carapace body: leverages quadruped rig attachment points (spine / chest) as fuselage fore/aft sections.
    const spine = new THREE.Group();
    t.add(spine);
    const chest = new THREE.Group();
    chest.position.set(...FR.chest);
    spine.add(chest);
    // m07.body constructs elytra, hindwings, and mid-legs, caching pivots into c.elytra and c.memWings.
    // Flight variant MUST only mutate rotations on existing pivots to avoid duplicating wing meshes.
    m07.body(c, spine, chest);
    const neck = new THREE.Group();
    neck.position.set(...FR.neck);
    chest.add(neck);
    const head = new THREE.Group();
    head.position.set(...FR.head);
    neck.add(head);
    m07.neckHead(c, neck, head);
    c._spine = spine; c._head = head;

    // ---- Raise elytra (armor shields fold open and remain stationary) ----
    c.elytra.forEach((eg, i) => {
      const sx = i === 0 ? -1 : 1;
      eg.rotation.set(-0.10, -sx * 0.28, sx * 1.22);   // Roll along longitudinal axis: outer edges tilt outward with splayed aft tips.
    });
    // ---- Deploy membranous hindwings (sole propulsion surface; segments unfold flat) ----
    for (const mw of c.memWings) {
      mw.w.rotation.set(0, 0, mw.sgn * 0.10);
      mw.outer.rotation.set(0, 0, 0);
    }

    // ---- Limbs folded aft into landing gear position (shared leg assembly via staticLimb) ----
    for (const [sx, z, front] of [[-1, FR.fz, true], [1, FR.fz, true], [-1, FR.hz, false], [1, FR.hz, false]]) {
      const cx = { ...c, sx, front };
      staticLimb(spine, front ? m07.legF(cx) : m07.legH(cx),
        [0, front ? 1.15 : -1.25, front ? -0.7 : 0.8],
        [sx * FR.legX, -0.1, z], [0.35, 0, sx * 0.78]);
    }
  },

  lift(c) { return { wings: c.memWings.map(({ w, outer, sgn }) => ({ w, outer, sgn })) }; },

  mount(c) { return m07.mount(c, { spine: c._spine, head: c._head }); },
};
