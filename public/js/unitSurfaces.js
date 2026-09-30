import * as THREE from 'three';
import { prismF } from './forge/geo.js';
import { equipVehicleMotion } from './unitRig.js';

/** Faceted shells keep the original part envelope, mounting frame and material ownership. */
export function finishUnitSurfaces(root) {
  root.traverse(node => {
    const old = node.geometry, p = old?.parameters, material = node.material;
    if (!node.isMesh || old.type !== 'BoxGeometry' || Array.isArray(material)
      || material.transparent || node.userData.noPaint || node.userData.noOutline) return;
    const { width: w, height: h, depth: d } = p;
    const cut = Math.min(w, h, d) * 0.12;
    if (cut < 0.015) return;
    const x = w / 2 - cut, y = h / 2 - cut;
    const shell = prismF(new THREE.Group(), [
      [-x + cut, -y], [x - cut, -y], [x, -y + cut], [x, y - cut],
      [x - cut, y], [-x + cut, y], [-x, y - cut], [-x, -y + cut],
    ], Math.max(0.001, d - cut * 2), 0, 0, 0, material.color,
    { bevel: { t: cut, s: cut } });
    shell.geometry.computeBoundingBox();
    const size = shell.geometry.boundingBox.getSize(new THREE.Vector3());
    shell.geometry.scale(w / size.x, h / size.y, d / size.z);
    node.geometry = shell.geometry;
    shell.material.dispose();
    old.dispose();
  });
  equipVehicleMotion(root.userData.rig);
  return root;
}
