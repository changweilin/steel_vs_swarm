// Blender-baked furniture consumes fitted plans; low kerbs remain outside movement authority.
import * as THREE from 'three';
import { envMat } from './hazards.js';
import { mergeGeos } from './beacons.js';
import { roadStructureGeo } from './roadStructureRender.js';
import { clipPolygonWithLine, pointInProjectedArea } from './osmAreas.js';
import { drapeHabitatPanel } from './habitat.js';

function crossingSlices(island, crossings) {
  let rings = [island.points];
  for (const c of crossings) {
    if (!c.marked || !pointInProjectedArea(c.x, c.z, { outer: island.points, holes: [] })) continue;
    const distance = c.x * c.dx + c.z * c.dz;
    rings = rings.flatMap(ring => {
      const a = clipPolygonWithLine(ring, [c.dx, c.dz], distance - 1.9);
      const b = clipPolygonWithLine(ring, [c.dx, c.dz], distance + 1.9);
      return [...(a?.sideA || []), ...(b?.sideB || [])];
    });
  }
  return rings;
}

/** pre: validated plan and settled terrain. post: caller owns all disposable geometry; no blockers are added. */
export function buildRoadFurniture(group, plan, terrain, roadLift) {
  const buckets = new Map(), islandSurfaceKeys = new Set(), matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
  const add = (kind, color, w, h, d, x, y, z, ry = 0, emission = 0) => {
    const key = `${color}/${emission}`, rows = buckets.get(key) || [];
    const geometry = roadStructureGeo(kind, w, h, d);
    geometry.rotateY(ry); geometry.translate(x, y, z); rows.push(geometry); buckets.set(key, rows);
  };
  for (const island of plan.islands) for (const points of crossingSlices(island, plan.crossings)) {
    const faces = THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(...p)), []);
    const vertices = faces.flatMap(face => drapeHabitatPanel({ corners: face.toReversed().map(i =>
      [points[i][0], 0, points[i][1]]) }, terrain, roadLift + .16));
    if (!vertices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const color = island.green ? 0x657b47 : 0xb8b4a8, key = `${color}/0`, rows = buckets.get(key) || [];
    islandSurfaceKeys.add(key);
    rows.push(geometry); buckets.set(key, rows);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < .01) continue;
      // Subdivision follows the settled road height, so a long island cannot float over a grade change.
      const count = Math.ceil(length / 2);
      for (let k = 0; k < count; k++) {
        const p = a.map((v, axis) => v + (b[axis] - v) * k / count);
        const r = a.map((v, axis) => v + (b[axis] - v) * (k + 1) / count);
        const y0 = terrain.heightAt(...p) + roadLift + .12, y1 = terrain.heightAt(...r) + roadLift + .12;
        const tangent = new THREE.Vector3(r[0] - p[0], y1 - y0, r[1] - p[1]);
        const kerb = roadStructureGeo('median_kerb', .24, .24, tangent.length() + .015);
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.normalize());
        matrix.compose(new THREE.Vector3((p[0] + r[0]) / 2, (y0 + y1) / 2, (p[1] + r[1]) / 2),
          q, new THREE.Vector3(1, 1, 1)); kerb.applyMatrix4(matrix);
        const key = `${0xc9c3b5}/0`, rows = buckets.get(key) || []; rows.push(kerb); buckets.set(key, rows);
      }
    }
  }
  for (const s of plan.signals) {
    add('sign_post', 0x576267, .16, 4.5, .16, s.x, s.y + 2.25, s.z);
    add('signal_head', 0x293238, .64, 1.5, .35, s.x, s.y + 4.25, s.z, s.ry);
    const forward = [Math.sin(s.ry), Math.cos(s.ry)];
    for (let i = 0; i < 3; i++) {
      const y = s.y + 4.7 - i * .45;
      const active = i === (s.aspect === 'red' ? 0 : 2);
      const color = (active ? [0xe44b3e, 0xd8a747, 0x57b879] : [0x3e1815, 0x493615, 0x153b25])[i];
      add('signal_lens', color, .34, .34, .055,
        s.x + forward[0] * .195, y, s.z + forward[1] * .195, s.ry, active ? .7 : 0);
      add('signal_hood', 0x293238, .45, .38, .28, s.x + forward[0] * .29,
        y + .08, s.z + forward[1] * .29, s.ry);
    }
  }
  for (const [key, geometries] of buckets) {
    const [color, emission] = key.split('/').map(Number), options = { wash: .25, cool: .4, side: THREE.DoubleSide };
    if (emission) { options.emissive = new THREE.Color(color); options.emissiveIntensity = emission; }
    const mesh = new THREE.Mesh(mergeGeos(geometries), envMat(color, options));
    mesh.userData.roadIslandSurface = islandSurfaceKeys.has(key);
    mesh.name = `road-furniture/${key}`; mesh.userData.noOutline = true; mesh.frustumCulled = false; group.add(mesh);
  }
}
