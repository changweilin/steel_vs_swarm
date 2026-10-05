import * as THREE from 'three';
import { envMat } from './hazards.js';
import { roadStructureGeo } from './roadStructureRender.js';
import { signAspect } from './worldtext.js';
import { LANE_GUIDANCE_SIZE, laneGuidanceHeights } from './laneGuidanceSize.js';

export function laneGuidePlates(plan) {
  const s = LANE_GUIDANCE_SIZE, face = s.panelDepth / 2 + .011;
  return plan.signs.map(p => ({ copy: p.copy, x: p.x + Math.sin(p.ry) * face,
    z: p.z + Math.cos(p.ry) * face, y: p.y + s.panelY, ry: p.ry, h: p.h, style: 'lane' }));
}

export function buildLaneGuidance(plan) {
  const group = new THREE.Group(); group.name = 'lane-road-guidance';
  const batches = new Map(), lights = [];
  const add = (kind, color, p, y, w, h, d, offset = 0, rz = 0, lit = false) => {
    const key = `${kind}:${color}:${lit}`;
    if (!batches.has(key)) batches.set(key, { kind, color, lit, rows: [] });
    const row = { x: p.x + Math.cos(p.ry) * offset, y: p.y + y,
      z: p.z - Math.sin(p.ry) * offset, ry: p.ry, rz, w, h, d };
    batches.get(key).rows.push(row);
  };
  for (const p of plan.markers) {
    add('crossing_base', 0x4d535a, p, .08, .44, .16, .42);
    add('lane_delineator', 0xe8e4d7, p, .69, .24, 1.22, .18);
    add('lane_panel', 0x22262e, p, 1.05, .27, .34, .21);
    add('lane_panel', p.color, p, 1.05, .20, .23, .225, 0, 0, true);
    add('lane_panel', 0xffbb45, p, .57, .265, .12, .21, 0, 0, true);
  }
  for (const p of plan.signs) {
    const s = LANE_GUIDANCE_SIZE, heights = laneGuidanceHeights(p.h);
    const w = p.h * signAspect('lane');
    const footH = .2, postH = heights.hoodY - footH;
    add('crossing_base', 0x666b70, p, footH / 2, .5, footH, .5);
    add('sign_post', 0x8c959d, p, footH + postH / 2, .16, postH, .16);
    add('lane_panel', 0x414951, p, s.panelY, w + .14, p.h + .14, s.panelDepth);
    add('lane_panel', p.color, p, heights.bandY, w + .14, s.bandH, .18, 0, 0, true);
    const brace = { ...p, x: p.x - Math.sin(p.ry) * .20, z: p.z - Math.cos(p.ry) * .20 };
    add('sign_bracket', 0x747e86, brace, s.panelY, .60, .08, .26);
    add('lane_panel', 0x242a31, p, heights.ledY, w + .14, s.ledH, .26);
    add('lane_hood', 0x404851, p, heights.hoodY, w + .30, s.hoodH, .44);
    const rz = p.arrow === 'straight' ? Math.PI / 2 : p.arrow === 'left' ? Math.PI : 0;
    for (let i = 0; i < 3; i++) {
      const q = { ...p, x: p.x + Math.sin(p.ry) * .16, z: p.z + Math.cos(p.ry) * .16 };
      add('lane_arrow', 0xffbd50, q, heights.ledY, .45, .45, .03, (i - 1) * Math.min(.9, (w - .65) / 2), rz, true);
      lights.push(i);
    }
  }
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), euler = new THREE.Euler();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  let arrows = null;
  for (const { kind, color, lit, rows } of batches.values()) {
    const material = lit ? new THREE.MeshBasicMaterial({ color }) : envMat(color, { wash: .15, cool: .3 });
    const mesh = new THREE.InstancedMesh(roadStructureGeo(kind), material, rows.length);
    mesh.name = `lane-${kind}`; mesh.userData.noOutline = true;
    rows.forEach((r, i) => {
      quat.setFromEuler(euler.set(0, r.ry, r.rz)); position.set(r.x, r.y, r.z); scale.set(r.w, r.h, r.d);
      mesh.setMatrixAt(i, matrix.compose(position, quat, scale));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh);
    if (kind === 'lane_arrow') arrows = mesh;
  }
  // Only the roadside LED panel changes. Dim LEDs retain the arrow silhouette.
  let lastPhase = -1;
  const bright = new THREE.Color(0xffffff), dim = new THREE.Color(0x686868);
  group.userData.update = now => {
    if (!arrows || !Number.isFinite(now)) return;
    const phase = Math.floor(now / .45) % 3;
    if (phase === lastPhase) return;
    lastPhase = phase;
    lights.forEach((slot, i) => arrows.setColorAt(i, slot === phase ? bright : dim));
    arrows.instanceColor.needsUpdate = true;
  };
  group.userData.update(0);
  return group;
}
