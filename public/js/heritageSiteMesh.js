import * as THREE from 'three';
import { toonMat } from './toon.js';
import { generateHeritageSite, LEGACY_HERITAGE } from './heritageSites.js';
import { architectureHash } from './buildingDiversity.js';
import { ANCIENT_MONUMENTS } from './ancientStone.js';

export function buildHeritageSite(kind, parent, x, y, z, options = {}) {
  if (![x,y,z].every(Number.isFinite)) throw new TypeError('Heritage position must be finite');
  if (options.radius !== undefined && (!Number.isFinite(options.radius) || options.radius <= 0)) throw new RangeError('Heritage radius must be positive');
  if (options.maxHeight !== undefined && (!Number.isFinite(options.maxHeight) || options.maxHeight <= 0)) throw new RangeError('Heritage height budget must be positive');
  const seed = options.seed ?? architectureHash(`${x},${y},${z}`,kind);
  const state = options.state || (options.isLand ? 'abandoned' : 'underwater');
  const fixed = { stupaRuin: 'sanchi', pyramidZiggurat: 'maya_pyramid' }[kind];
  const model = generateHeritageSite(seed, {
    ...options, state,
    ...(fixed && !options.ruinType ? { selection: { ...ANCIENT_MONUMENTS[fixed], id: fixed, kind: 'monument', uniformScale: 1 } } : {}),
    // 一般 ruins 可抽全部活動遺跡；舊特定款仍限制在相近組成語彙。
    ruinType: options.ruinType || (kind === 'ruins' ? 'auto' : LEGACY_HERITAGE[kind]),
  });
  const radius = options.radius ?? 10;
  const [w,h,d] = model.bounds.size;
  const scale = Math.min(model.selection.uniformScale, radius * 2 / Math.hypot(w,d),
    Number.isFinite(options.maxHeight) ? options.maxHeight / Math.max(h,.1) : Infinity);
  const positions=[], colors=[], color=new THREE.Color();
  const cx=(model.bounds.min[0]+model.bounds.max[0])/2, cz=(model.bounds.min[2]+model.bounds.max[2])/2;
  for(const triangle of model.triangles) {
    color.setHex(triangle.color);
    for(const point of [triangle.a,triangle.b,triangle.c]) {
      positions.push((point[0]-cx)*scale,(point[1]-model.bounds.min[1])*scale,(point[2]-cz)*scale);
      colors.push(color.r,color.g,color.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry,toonMat(0xffffff,{vertexColors:true})));
  group.position.set(x,y,z);
  group.userData.heritage = { state, id:model.selection.id, kind:model.selection.kind, facilities:model.facilities, seed };
  parent.add(group);
  return group;
}
