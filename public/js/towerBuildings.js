import * as THREE from 'three';

// 尺寸同時供生成、占位與碰撞使用；造型不讀場景共用 RNG。
export const TOWER_BUILDINGS = Object.freeze({
  bell_tower: { r: 5, h: 28 },
  clock_tower: { r: 5, h: 30 },
  control_tower: { r: 6, h: 32 },
  watchtower: { r: 5, h: 24 },
  beacon_tower: { r: 6, h: 20 },
  gun_tower: { r: 6, h: 18 },
  iron_tower: { r: 7, h: 40 },
  observation_tower: { r: 7, h: 36 },
  radio_tower: { r: 5, h: 44 },
});

export function towerSides(tags = {}, seed = 0) {
  const shape = String(tags['tower:shape'] || tags['building:shape'] || '').trim().toLowerCase();
  const sides = { round: 24, circular: 24, square: 4, rectangular: 4, hexagonal: 6, octagonal: 8 };
  return Object.hasOwn(sides, shape) ? sides[shape] : [4, 6, 8, 24][(seed >>> 0) % 4];
}

export function buildTowerBuilding(group, type, { seed = 0, tags = {} } = {}) {
  if (!Object.hasOwn(TOWER_BUILDINGS, type)) return false;
  const spec = TOWER_BUILDINGS[type];
  const { r, h } = spec, sides = towerSides(tags, seed);
  const stone = 0xb3aa96, metal = 0x697781, dark = 0x303b44, glass = 0x699ca8;
  const materials = new Map();
  const add = (geometry, color, x, y, z) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    const mesh = new THREE.Mesh(geometry, materials.get(color));
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  const prism = (radius, height, y, color, top = radius) => {
    const geometry = new THREE.CylinderGeometry(top, radius, height, sides);
    if (sides === 4) { geometry.rotateY(Math.PI / 4); geometry.scale(1, 1, 0.78); }
    return add(geometry, color, 0, y + height / 2, 0);
  };
  const box = (w, height, d, x, y, z, color) => add(new THREE.BoxGeometry(w, height, d), color, x, y + height / 2, z);
  const beam = (a, b, width = 0.2) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const mesh = add(new THREE.CylinderGeometry(width, width, delta.length(), 5), metal, ...start.clone().add(end).multiplyScalar(0.5).toArray());
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  };
  prism(r, 0.8, 0, stone);
  if (type === 'iron_tower' || type === 'radio_tower') {
    const levels = 6, legs = sides === 24 ? 8 : sides;
    const point = (i, level) => {
      const angle = i * Math.PI * 2 / legs, radius = r * (0.85 - level / levels * 0.7);
      return [Math.cos(angle) * radius, 0.8 + level / levels * (h - 5), Math.sin(angle) * radius];
    };
    for (let level = 0; level < levels; level++) for (let i = 0; i < legs; i++) {
      beam(point(i, level), point(i, level + 1));
      beam(point(i, level), point(i + 1, level + 1), 0.12);
      beam(point(i + 1, level), point(i, level + 1), 0.12);
      beam(point(i, level + 1), point(i + 1, level + 1), 0.12);
    }
    prism(r * 0.28, 0.5, h - 4.2, metal);
    beam([0, h - 4, 0], [0, h, 0], 0.14);
    if (type === 'radio_tower') for (const sign of [-1, 1]) {
      box(0.45, 4, 0.8, sign * r * 0.24, h - 8, 0, 0xe5e0d6);
      beam([0, h - 6, 0], [sign * r * 0.24, h - 6, 0]);
    }
  } else {
    const deck = h * 0.72;
    prism(r * 0.64, deck - 0.8, 0.8, stone, r * 0.48);
    prism(r * 0.9, 0.7, deck, metal);
    if (type === 'control_tower' || type === 'observation_tower') {
      prism(r * 0.8, h * 0.16, deck + 0.7, glass, r * 0.9);
      prism(r * 0.95, 0.6, deck + 0.7 + h * 0.16, metal);
      beam([0, h * 0.91, 0], [0, h, 0], 0.12);
    } else if (type === 'beacon_tower' || type === 'gun_tower') {
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        box(1, 1.5, 1, Math.cos(a) * r * 0.74, deck + 0.7, Math.sin(a) * r * 0.74, stone);
      }
      if (type === 'gun_tower') {
        prism(r * 0.43, 1.8, deck + 0.7, dark);
        const barrel = add(new THREE.CylinderGeometry(0.3, 0.4, r * 0.85, 8), dark, 0, deck + 1.8, r * 0.42);
        barrel.rotation.x = Math.PI / 2;
      } else prism(r * 0.35, 1, deck + 0.7, dark, r * 0.46);
    } else {
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        box(0.45, h * 0.17, 0.45, Math.cos(a) * r * 0.65, deck + 0.7, Math.sin(a) * r * 0.65, stone);
      }
      if (type === 'bell_tower') {
        const bell = add(new THREE.CylinderGeometry(r * 0.12, r * 0.32, 2.6, 12), 0xb09548, 0, deck + 2.4, 0);
        bell.name = 'bell';
        beam([0, deck + 3.7, 0], [0, deck + 0.7 + h * 0.17, 0], 0.1);
      }
      if (type === 'clock_tower') {
        box(r, 3.2, r, 0, deck - 3.6, 0, stone);
        for (let i = 0; i < 4; i++) {
          const face = new THREE.Group(), a = i * Math.PI / 2;
          const dial = add(new THREE.CylinderGeometry(1.3, 1.3, 0.12, 24), 0xf0e8cc, 0, 0, 0);
          dial.rotation.x = Math.PI / 2; face.add(dial);
          const hour = box(0.13, 0.8, 0.14, 0, 0, 0.1, dark), minute = box(0.9, 0.13, 0.14, 0.4, 0, 0.1, dark);
          face.add(hour, minute); face.position.set(Math.sin(a) * r * 0.5, deck - 2, Math.cos(a) * r * 0.5);
          face.rotation.y = a; group.add(face);
        }
      }
      const roofY = deck + 0.7 + h * 0.17;
      prism(r * 0.94, h - roofY, roofY, metal, 0);
    }
  }
  group.userData.towerShape = sides;
  return true;
}
