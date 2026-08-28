// 招式粒子 GPU 環形緩衝：每個 Three.js scene 共用兩個 InstancedMesh / ShaderMaterial。
// CPU 只在施放時寫入 spawn/data/color 欄位；生命週期、位移、尺寸與淡出由 GPU 計算。
import * as THREE from 'three';
import { lowPower } from './mobile.js';
import { markShared, INK_INFO_DECL, INK_INFO_NONE } from './toon.js';

export const PARTICLE_CAPACITY_NORMAL = 1024;
export const PARTICLE_CAPACITY_LOW = 512;
// 舊呼叫端若需要常數，這是 backing allocation；實際 instanceCount 由 getParticleCapacity() 即時決定。
export const PARTICLE_CAPACITY = PARTICLE_CAPACITY_NORMAL;
export const PARTICLE_SYSTEM_COUNT = 2;
const SYSTEM_CAPACITY_NORMAL = PARTICLE_CAPACITY_NORMAL / PARTICLE_SYSTEM_COUNT;
export const PARTICLE_COUNT_MIN = 64;
export const PARTICLE_COUNT_MAX = 128;
export const CAST_PARTICLE_DRAW_LAYERS = 2;
export const CAST_FIXED_DRAW_LAYERS_MIN = 4;
export const CAST_FIXED_DRAW_LAYERS_MAX = 6;
const ROOT_POOL_SIZE = 32;
// 一份共享 unit quad；每個系統只 clone 頂點索引，讓 instance attributes 不互相覆寫。
const UNIT_QUAD = markShared(new THREE.PlaneGeometry(2, 2));

const VS = `
  attribute vec4 aSpawn;
  attribute vec4 aData;
  attribute vec4 aVelocity;
  attribute vec4 aColor;
  attribute vec4 aStyle;
  uniform float uNow;
  uniform float uSystem;
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    float age = uNow - aData.x;
    float live = step(0.0, age) * step(age, aData.y);
    float p = clamp(age / max(aData.y, 0.001), 0.0, 1.0);
    float shape = aStyle.x;
    float motion = aStyle.y;
    float contact = aStyle.z;
    float layout = aStyle.w;
    float arc = sin(p * 3.14159265);
    vec3 drift = aVelocity.xyz * age;
    if (motion < 0.5) drift.xz *= 1.0 + p * 1.5;
    else if (motion < 1.5) drift.y += arc * aVelocity.w;
    else if (motion < 2.5) drift.xz += vec2(-aVelocity.z, aVelocity.x) * arc * aVelocity.w;
    else if (motion < 3.5) drift.y += (1.0 - p) * aVelocity.w;
    else if (motion < 4.5) drift.y -= p * aVelocity.w;
    else if (motion < 5.5) drift.xz *= 1.0 - p * 0.72;
    else if (motion < 6.5) drift.xz *= 1.0 + p * 2.4;
    else drift.xz += vec2(sin(p * 6.2831), cos(p * 6.2831)) * aVelocity.w * 0.35;
    vec3 world = aSpawn.xyz + drift;
    float fade = min(smoothstep(0.0, 0.12, p), 1.0 - smoothstep(0.72, 1.0, p));
    if (contact < 1.5) fade *= smoothstep(0.04, 0.22, p);
    else if (contact < 2.5) fade *= 0.72 + 0.28 * sin(p * 12.5663);
    else if (contact < 3.5) fade *= smoothstep(0.82, 0.58, p);
    else if (contact < 4.5) fade *= 0.75 + 0.25 * (1.0 - p);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vec2 local = position.xy;
    if (layout < 1.5) local *= vec2(1.6, 0.58);
    else if (layout < 2.5) local = local.yx;
    else if (layout < 3.5) local *= vec2(0.52, 1.65);
    else if (layout < 4.5) local = vec2(local.x - local.y * 0.42, local.y);
    else if (layout < 5.5) local = vec2(local.x + local.y * 0.42, local.y);
    else local *= vec2(1.18, 1.18);
    if (uSystem > 0.5) { local = local.yx; fade *= 0.78 + 0.22 * arc; }
    mv.xy += local * aData.z * (0.65 + arc * 0.35);
    gl_Position = projectionMatrix * mv;
    vColor = vec4(aColor.rgb, aColor.a * fade * live);
    vUv = uv;
  }
`;
const FS = `
  ${INK_INFO_DECL}
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    float edge = 1.0 - smoothstep(0.28, 1.0, length(vUv - 0.5) * 2.0);
    gl_FragColor = vec4(vColor.rgb, vColor.a * edge);
    ${INK_INFO_NONE}
  }
`;

function makeMaterial(system) {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: { uNow: { value: 0 }, uSystem: { value: system } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function activeCapacity() { return lowPower() ? PARTICLE_CAPACITY_LOW : PARTICLE_CAPACITY_NORMAL; }
export function getParticleCapacity() { return activeCapacity(); }

function createEngine() {
  const systems = Array.from({ length: PARTICLE_SYSTEM_COUNT }, (_, system) => {
  const geometry = UNIT_QUAD.clone();
  const mesh = new THREE.InstancedMesh(geometry, makeMaterial(system), SYSTEM_CAPACITY_NORMAL);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const attr = (size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(SYSTEM_CAPACITY_NORMAL * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const spawn = attr(4), data = attr(4), velocity = attr(4), color = attr(4);
  const style = attr(4);
  mesh.geometry.setAttribute('aSpawn', spawn);
  mesh.geometry.setAttribute('aData', data);
  mesh.geometry.setAttribute('aVelocity', velocity);
  mesh.geometry.setAttribute('aColor', color);
  mesh.geometry.setAttribute('aStyle', style);
  return { mesh, spawn, data, velocity, color, style, attrs: [spawn, data, velocity, color, style], dirty: [Infinity, -1] };
  });
  const roots = Array.from({ length: ROOT_POOL_SIZE }, () => ({ obj: new THREE.Group(), handle: null, age: 0 }));
  const slots = new Array(PARTICLE_CAPACITY_NORMAL);
  return { systems, roots, slots, cursor: 0, capacity: PARTICLE_CAPACITY_NORMAL };
}
const ENGINES = new WeakMap();
function engineFor(scene) {
  let engine = ENGINES.get(scene);
  if (!engine) { engine = createEngine(); ENGINES.set(scene, engine); }
  const capacity = activeCapacity();
  if (engine.capacity !== capacity) {
    if (capacity < engine.capacity) {
      for (let i = capacity; i < PARTICLE_CAPACITY_NORMAL; i++) engine.slots[i] = null;
      for (const sys of engine.systems) {
        const start = (capacity / PARTICLE_SYSTEM_COUNT) * 4;
        const count = ((PARTICLE_CAPACITY_NORMAL - capacity) / PARTICLE_SYSTEM_COUNT) * 4;
        sys.data.array.fill(0, start, start + count); sys.color.array.fill(0, start, start + count);
        sys.data.clearUpdateRanges(); sys.data.addUpdateRange(start, count); sys.data.needsUpdate = true;
        sys.color.clearUpdateRanges(); sys.color.addUpdateRange(start, count); sys.color.needsUpdate = true;
      }
    }
    engine.capacity = capacity;
    for (const sys of engine.systems) sys.mesh.count = capacity / PARTICLE_SYSTEM_COUNT;
  }
  return engine;
}

function nowS() { return typeof performance !== 'undefined' ? performance.now() * 0.001 : 0; }
function touch(sys, index) { sys.dirty[0] = Math.min(sys.dirty[0], index); sys.dirty[1] = Math.max(sys.dirty[1], index); }
function write(sys, index, px, py, pz, start, life, size, shape, motion, contact, layout,
  vx, vy, vz, burst, cr, cg, cb, ca) {
  const s = index * 4;
  sys.spawn.array[s] = px; sys.spawn.array[s + 1] = py; sys.spawn.array[s + 2] = pz; sys.spawn.array[s + 3] = 0;
  sys.data.array[s] = start; sys.data.array[s + 1] = life; sys.data.array[s + 2] = size; sys.data.array[s + 3] = shape;
  sys.velocity.array[s] = vx; sys.velocity.array[s + 1] = vy; sys.velocity.array[s + 2] = vz; sys.velocity.array[s + 3] = burst;
  sys.color.array[s] = cr; sys.color.array[s + 1] = cg; sys.color.array[s + 2] = cb; sys.color.array[s + 3] = ca;
  sys.style.array[s] = shape; sys.style.array[s + 1] = motion; sys.style.array[s + 2] = contact; sys.style.array[s + 3] = layout;
  touch(sys, index);
}
function flush(sys) {
  if (sys.dirty[1] < 0) return;
  const start = sys.dirty[0] * 4, count = (sys.dirty[1] - sys.dirty[0] + 1) * 4;
  for (const a of sys.attrs) {
    a.clearUpdateRanges(); a.addUpdateRange(start, count); a.needsUpdate = true;
  }
  sys.dirty[0] = Infinity; sys.dirty[1] = -1;
}
function acquireRoot(engine, scene) {
  const roots = engine.roots;
  let root = roots.find((r) => !r.handle);
  if (!root) { root = roots.reduce((a, b) => a.age < b.age ? a : b); root.handle?.release(); }
  root.obj.visible = true; if (root.obj.parent !== scene) scene.add(root.obj); return root;
}
function recipeKind(name) {
  let h = 2166136261; for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 6;
}
function namedMode(name, table) {
  if (table[name] !== undefined) return table[name];
  let h = 2166136261; for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 8;
}
const MOTION_MODE = Object.freeze({
  advance: 0, forward: 0, march: 0, charge: 0, chase: 1, lift: 1, rise: 1, repair: 1,
  orbit: 2, threebeat: 2, resonate: 2, pulse: 2, dive: 3, drop: 3, fall: 3, descend: 3,
  erase: 4, cool: 4, shrink: 4, cover: 4, inward: 5, close: 5, converge: 5, rewind: 5,
  outward: 6, cross: 6, flow: 6, guide: 6, search: 7, scan: 7, blink: 7,
});
const CONTACT_MODE = Object.freeze({ impact: 0, stab: 0, pierce: 0, ram: 0, break: 1, crack: 1, blackout: 1, silence: 1,
  spark: 2, noise: 2, multi: 2, crawl: 2, lock: 3, seal: 3, confirm: 3, mark: 3,
  scatter: 4, steam: 4, avalanche: 4, dust: 4, return: 5, renew: 5, restore: 5, reveal: 5,
  delete: 6, cut: 6, extinguish: 6, fade: 6, advance: 7, deploy: 7, fan: 7,
});
const LAYOUT_MODE = Object.freeze({ spiral: 0, airline: 0, thrust: 0, arrowline: 0, needle: 0, track: 0,
  ears: 1, ribs: 1, rows: 1, bars: 1, columns: 1, bands: 1, chord: 1,
  weld: 2, streams: 2, waterfall: 2, cloud: 2, contour: 2, wind: 2, sweep: 2,
  frame: 3, dome: 3, phalanx: 3, gates: 3, grid: 3, compass: 3, octant: 3,
  chain: 4, nodes: 4, rings: 4, rose: 4, net: 4, gear: 4, switches: 4,
  funnel: 5, vortex: 5, cone: 5, membrane: 5, throat: 5, negative: 5, mirror: 5,
  pillar: 6, assembly: 6, joints: 6, flightdeck: 6, walls: 6, pillars: 6, feast: 6,
});
const ACCENT_MODE = Object.freeze({ whale: 0, spectrum: 1, anvil: 2, bell: 3, artillery: 4, thunder: 5, border: 6, coin: 7 });

/** 共用粒子施放縫；recipe.count 只允許 64..128，低功耗自動折半。 */
export function spawnParticleCast(scene, effects, P, recipe) {
  if (!recipe) return;
  const engine = engineFor(scene);
  const systems = engine.systems;
  for (const sys of systems) if (sys.mesh.parent !== scene) scene.add(sys.mesh);
  const root = acquireRoot(engine, scene);
  const count = Math.max(PARTICLE_COUNT_MIN, Math.min(PARTICLE_COUNT_MAX, recipe.count | 0)) >> (lowPower() ? 1 : 0);
  const start = nowS();
  const rand = P.rand;
  const handle = { release() {} };
  const slotsForCast = [];
  const color = P.col;
  const accent = P.col2 || color;
  const shape = recipeKind(recipe.shape);
  const accentMode = namedMode(recipe.accentMotif || '', ACCENT_MODE);
  const motion = namedMode(recipe.motion || '', MOTION_MODE);
  const contact = namedMode(recipe.contact || '', CONTACT_MODE);
  const layout = namedMode(recipe.layout || '', LAYOUT_MODE);
  const ttl = Math.max(0.3, P.dur || 1);
  for (let i = 0; i < count; i++) {
    const slot = engine.cursor++ % engine.capacity;
    const old = engine.slots[slot]; old?.release?.();
    // 全域 slot 固定映射到一個 layer；覆寫時不會在另一層留下仍存活的幽靈粒子。
    const sys = systems[slot % PARTICLE_SYSTEM_COUNT];
    const index = Math.floor(slot / PARTICLE_SYSTEM_COUNT);
    const a = rand() * Math.PI * 2 + (recipe.phase || 0), rr = Math.sqrt(rand()) * Math.max(P.r || P.scale, P.scale);
    let lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
    if (layout === 1) { lx = (rand() - 0.5) * P.scale * 1.8; lz = (rand() - 0.5) * P.scale * 0.3; }
    else if (layout === 2) { lx = (rand() - 0.5) * P.scale * 0.35; lz = (rand() - 0.5) * P.scale * 1.8; }
    else if (layout === 3) { lx = (rand() - 0.5) * P.scale * 1.5; lz = (i % 4 - 1.5) * P.scale * 0.24; }
    else if (layout === 4) { lx = Math.cos(a) * rr; lz = Math.sin(a) * rr * 0.45; }
    else if (layout === 5) { lx = (rand() - 0.5) * P.scale * 0.45; lz = (rand() - 0.5) * P.scale * 0.45; }
    else if (layout === 6) { lx = (i % 7 - 3) * P.scale * 0.18; lz = (Math.floor(i / 7) - 3) * P.scale * 0.18; }
    const px = P.at.x + lx, py = P.at.y + 0.3 + rand() * P.scale, pz = P.at.z + lz;
    const life = Math.min(ttl, 0.65 + rand() * 0.75);
    engine.slots[slot] = handle; slotsForCast.push(slot);
    const particleColor = (i % 4 === accentMode % 4) ? accent : color;
    write(sys, index, px, py, pz, start, life,
      P.scale * (0.08 + rand() * 0.12) * (0.88 + (recipe.tempo || 1) * 0.14), shape, motion, contact, layout,
      (rand() - 0.5) * 1.2, (rand() - 0.25) * 1.8, (rand() - 0.5) * 1.2,
      P.scale * (0.4 + rand() * 0.6) * (0.8 + (recipe.tempo || 1) * 0.2),
      particleColor.r, particleColor.g, particleColor.b, 0.78);
  }
  flush(systems[0]); flush(systems[1]);
  const release = () => {
    for (const slot of slotsForCast) if (engine.slots[slot] === handle) engine.slots[slot] = null;
    root.handle = null; root.age = 0; root.obj.visible = false;
  };
  handle.release = release; root.handle = handle; root.age = start;
  effects.push({ obj: root.obj, ttl, fade: () => {
    const n = nowS(); systems[0].mesh.material.uniforms.uNow.value = n; systems[1].mesh.material.uniforms.uNow.value = n;
  }, dispose: release });
}

export function attachParticleSystems(scene) {
  const engine = engineFor(scene);
  for (const sys of engine.systems) if (sys.mesh.parent !== scene) scene.add(sys.mesh);
}
