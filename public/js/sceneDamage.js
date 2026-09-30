// Presentation-only damage: deform generated geometry without changing collision or shared RNG.
import * as THREE from 'three';
import { sceneIsPhysical, UNITS } from './data.js';
import { mulberry32 } from './rng.js';
import { cloneVisualMaterial } from './toon.js';
import { DMG_FX, debrisBurst, shockRing } from './vfx.js';

export function sceneDamageStage(hp, max, collapsed = false) {
  if (collapsed) return 3;
  if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return 0;
  if (hp <= 0) return 3;
  if (hp <= max * DMG_FX.HEAVY_F) return 2;
  return hp <= max * DMG_FX.LIGHT_F ? 1 : 0;
}

export function sceneDamageProfile(kind) {
  if (['tower', 'base', 'bunker', 'mapbuilding'].includes(kind)) return { color: 0x69645c, fire: kind !== 'mapbuilding', dent: kind === 'mapbuilding' ? 0 : 0.16 };
  if (['tree','moon','slab'].includes(kind)) return { color: kind==='tree' ? 0x765033 : 0x686575, fire: kind==='tree', dent: 0.12 };
  if (UNITS[kind] || ['decoy','kami','hyper','decoy_beacon','missile'].includes(kind)) {
    const organic=['soldier','rocketeer','howitzer','veteran_squad','civilian'].includes(kind);
    return { color: organic ? 0x625448 : 0x4a4240, fire: !organic, dent: 0, mobile: true };
  }
  if (!sceneIsPhysical(kind) && kind !== 'aasite') return null;
  if (['rockfall', 'boulder', 'landslide'].includes(kind)) return { color: 0x817565, fire: false, dent: 0.22 };
  if (['fallentree', 'sacredtree'].includes(kind)) return { color: 0x765033, fire: true, dent: 0.3 };
  return { color: 0x57616a, fire: true, dent: 0.36 };
}

/** Cache only on first damage; shells sharing body geometry must be deformed exactly once. */
export function applySceneDamage(ent, stage) {
  const profile = sceneDamageProfile(ent.kind);
  if (!profile || stage === ent.sceneStage) return;
  ent.sceneStage = stage;
  if (!ent.sceneDamageNodes) {
    ent.sceneDamageNodes = [];
    ent.mesh.traverse((node) => { if (node.isMesh && !node.userData.teamRing && !node.userData.weatherScorch) ent.sceneDamageNodes.push(node); });
  }
  if (!stage && !ent.sceneDamageParts && !ent.mobileDamage) return;
  if (profile.mobile) { applyMobileDamage(ent,stage,profile); return; }
  const root = ent.mesh;
  if (!ent.sceneDamageParts) {
    if (!ent.neutral) {
      const geometries = new Map(), materials = new Map();
      for (const node of ent.sceneDamageNodes) {
        if (!geometries.has(node.geometry)) geometries.set(node.geometry, node.geometry.clone());
        node.geometry = geometries.get(node.geometry);
        const clone = (m) => { if (!materials.has(m)) materials.set(m, cloneVisualMaterial(m)); return materials.get(m); };
        node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
      }
    }
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert(), seen = new Set();
    ent.sceneDamageParts = [];
    ent.sceneDamageColors = new Map();
    for (const node of ent.sceneDamageNodes) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material?.color && !ent.sceneDamageColors.has(material)) {
          ent.sceneDamageColors.set(material, material.color.clone());
        }
      }
      const geometry = node.geometry;
      if (!geometry?.attributes.position || seen.has(geometry)) continue;
      seen.add(geometry);
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld);
      ent.sceneDamageParts.push({ geometry, matrix, inverse: matrix.clone().invert(),
        outline: !!node.userData.isOutline, positions: geometry.attributes.position.array.slice() });
    }
  }
  const point = new THREE.Vector3();
  const strength = stage === 0 ? 0 : stage === 1 ? 0.45 : 1;
  for (const [material, color] of ent.sceneDamageColors) {
    material.color.copy(color).lerp(new THREE.Color(profile.color), strength * 0.55).multiplyScalar(1 - strength * 0.22);
  }
  const radius = Math.max(1, ent.dimR), height = Math.max(1, ent.dimH);
  const seed = damageSeed(ent.id);
  for (const part of ent.sceneDamageParts) {
    const position = part.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromArray(part.positions, i * 3).applyMatrix4(part.matrix);
      const upper = Math.max(0, Math.min(1, point.y / height));
      const fold = Math.max(0, Math.sin(point.x / radius * 5 + point.z / radius * 4 + seed));
      const dent = strength * profile.dent * fold * upper;
      point.x *= 1 - dent;
      point.z *= 1 - dent * 0.7;
      point.y *= 1 - dent;
      point.applyMatrix4(part.inverse);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    if (!part.outline) part.geometry.computeVertexNormals();
    part.geometry.computeBoundingSphere();
    part.geometry.computeBoundingBox();
  }
  // Scars lie inside actual surface triangles, so irregular rocks and thin panels share one path.
  if (!ent.sceneDamageCracks) {
    const cracks = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x211b18, transparent: true, opacity: 0.9, depthWrite: false }));
    cracks.userData.noOutline = true;
    root.add(cracks);
    ent.sceneDamageCracks = cracks;
  }
  const cracks = ent.sceneDamageCracks;
  cracks.visible = stage > 0;
  if (!stage) return;
  const faces = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const part of ent.sceneDamageParts) {
    if (part.outline) continue;
    const geometry = part.geometry, positions = geometry.attributes.position, index = geometry.index;
    const count = index ? index.count : positions.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(part.matrix);
      b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1).applyMatrix4(part.matrix);
      c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2).applyMatrix4(part.matrix);
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      const area = normal.length();
      if (area < 0.08 || normal.normalize().y < -0.4) continue;
      faces.push({ a: a.clone(), b: b.clone(), c: c.clone(), normal, area });
    }
  }
  faces.sort((a, b) => b.area - a.area);
  const lines = [];
  for (const face of faces.slice(0, stage === 1 ? 14 : 32)) {
    const points = [[0.7,0.2],[0.42,0.34],[0.36,0.19],[0.12,0.33]].map(([u,v]) =>
      face.a.clone().multiplyScalar(u).addScaledVector(face.b,v).addScaledVector(face.c,1-u-v)
        .addScaledVector(face.normal, 0.015));
    for (let i = 1; i < points.length; i++) lines.push(...points[i-1].toArray(), ...points[i].toArray());
  }
  cracks.geometry.dispose();
  cracks.geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  cracks.geometry.computeBoundingSphere();
}

/** Local scars follow articulated parts; shared vertices and skinning stay untouched. */
function applyMobileDamage(ent,stage,profile) {
  if (!ent.mobileDamage) {
    const materials=new Map(), colors=new Map(), scars=[], bindings=[];
    for (const node of ent.sceneDamageNodes) {
      if (node.userData.noPaint || node.userData.isOutline) continue;
      const clone=m=>{
        if (!m.color || m.transparent) return m;
        if (!materials.has(m)) {
          const copy=cloneVisualMaterial(m); materials.set(m,copy);
          if (copy.color && !m.transparent) colors.set(copy,m.color.clone());
        }
        return materials.get(m);
      };
      bindings.push([node,node.material]);
      node.material=Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
    }
    for (const node of ent.sceneDamageNodes.filter(n=>!n.isSkinnedMesh && !n.userData.isOutline
      && !n.userData.noPaint && !Array.isArray(n.material) && !n.material.transparent).slice(0,12)) {
      const pos=node.geometry?.attributes.position, idx=node.geometry?.index;
      if (!pos) continue;
      const count=idx?.count || pos.count, lines=[];
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
      const stride=Math.max(3,Math.floor(count/36/3)*3);
      for(let i=0;i+2<count;i+=stride) {
        a.fromBufferAttribute(pos,idx ? idx.getX(i) : i);
        b.fromBufferAttribute(pos,idx ? idx.getX(i+1) : i+1);
        c.fromBufferAttribute(pos,idx ? idx.getX(i+2) : i+2);
        normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize().multiplyScalar(.003);
        const points=[[.7,.2],[.4,.4],[.2,.3]].map(([u,v])=>a.clone().multiplyScalar(u).addScaledVector(b,v).addScaledVector(c,1-u-v).add(normal));
        for(let j=1;j<points.length;j++) lines.push(...points[j-1].toArray(),...points[j].toArray());
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
      const scar=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x211b18,transparent:true,depthWrite:false}));
      scar.userData.noOutline=true; node.add(scar); scars.push(scar);
    }
    ent.mobileDamage={colors,scars,materials,bindings};
  }
  const strength=stage===0 ? 0 : stage===1 ? .45 : stage===2 ? .8 : 1;
  for(const [material,color] of ent.mobileDamage.colors) material.color.copy(color).lerp(new THREE.Color(profile.color),strength*.65).multiplyScalar(1-strength*.25);
  for(const scar of ent.mobileDamage.scars) {
    scar.visible=stage>0; scar.material.opacity=strength;
    scar.geometry.setDrawRange(0,stage===1 ? Math.floor(scar.geometry.attributes.position.count/4)*2 : Infinity);
  }
}

export function releaseMobileDamage(ent) {
  const damage=ent.mobileDamage;
  if (!damage) return;
  for (const scar of damage.scars) { scar.removeFromParent(); scar.geometry.dispose(); scar.material.dispose(); }
  for (const material of damage.materials.values()) material.dispose();
  for (const [node,material] of damage.bindings) node.material=material;
  ent.mobileDamage=null; ent.sceneStage=undefined;
}

/** One burst for the observed destination, including snapshots that skip intermediate bands. */
export function sceneDamageBurst(scene, effects, ent, stage) {
  const profile = sceneDamageProfile(ent.kind);
  if (!profile) return;
  const p = ent.mesh.position;
  debrisBurst(scene, effects, p.x, p.y + ent.dimH * 0.45, p.z,
    { big: stage >= 2, accent: profile.color, random: mulberry32((damageSeed(ent.id) * 2654435761 + stage) >>> 0) });
  shockRing(scene, effects, p.x, p.y + 0.2, p.z,
    Math.max(2, ent.dimR) * (stage === 3 ? 1.4 : 0.8), profile.color);
}

function damageSeed(id) {
  if (typeof id === 'number') return id;
  let seed = 0;
  for (const char of String(id)) seed = (Math.imul(seed,31) + char.charCodeAt(0)) >>> 0;
  return seed;
}
