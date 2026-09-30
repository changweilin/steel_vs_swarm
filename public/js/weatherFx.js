import * as THREE from 'three';
import { WEATHER_DEBUFFS } from './data.js';
import { WEATHER_FX } from './weatherVisuals.js';
import { mulberry32 } from './rng.js';
import { WIND, INK_INFO_DECL, INK_INFO_NONE } from './toon.js';

function cloudTexture(type, seed, lowPower) {
  const canvas = document.createElement('canvas');
  canvas.width = lowPower ? 256 : 512; canvas.height = canvas.width / 2;
  const ctx = canvas.getContext('2d'), rnd = mulberry32(seed);
  ctx.scale(canvas.width / 256, canvas.width / 256);
  const wispy = type === 'cirrus', flat = type === 'stratus';
  const puffs = wispy ? 12 : flat ? 10 : 8;
  for (let i = 0; i < puffs; i++) {
    const x = 36 + i / (puffs - 1) * 184;
    const crown = Math.sin(i / (puffs - 1) * Math.PI);
    const y = wispy ? 72 - i * 3 : flat ? 66 + rnd() * 8 : 82 - crown * 37;
    const rx = wispy ? 20 + crown * 4 : flat ? 26 + crown * 8 : 18 + crown * (10 + rnd() * 12);
    const ry = wispy ? 4 + rnd() * 5 : flat ? 18 + rnd() * 7 : 18 + crown * 14;
    const shade = ctx.createLinearGradient(0, y - ry, 0, y + ry);
    shade.addColorStop(0, '#ffffff');
    shade.addColorStop(.55, '#edf2f6');
    shade.addColorStop(1, '#8192a6');
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, wispy ? -.12 : 0, 0, Math.PI * 2); ctx.fill();
  }
  if (type === 'cumulonimbus') {
    ctx.fillStyle = '#e1e7ee';
    ctx.beginPath(); ctx.ellipse(138, 25, 87, 17, 0, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeClouds(span, seed, { lowPower = false } = {}) {
  const rnd = mulberry32((seed ^ 0x93B7C1) >>> 0), obj = new THREE.Group();
  obj.name = 'weather-clouds'; obj.renderOrder = -9;
  const textures = WEATHER_FX.cloudTypes.map((type, i) => cloudTexture(type, seed ^ (i * 997), lowPower));
  const items = [], total = WEATHER_FX.cloudClusters * WEATHER_FX.cloudsPerCluster;
  const count = lowPower ? total / 2 : total;
  for (let i = 0; i < count; i++) {
    const family = i % textures.length, type = WEATHER_FX.cloudTypes[family];
    const material = new THREE.SpriteMaterial({ map: textures[family], transparent: true, opacity: 0, depthWrite: false, fog: false });
    const sprite = new THREE.Sprite(material); sprite.name = type; obj.add(sprite);
    const angle = rnd() * Math.PI * 2, radius = span * (.16 + rnd() * 1.05);
    items.push({ sprite, type, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
      y: span * rnd() * .14, size: span * (.12 + rnd() * .14), phase: rnd() * Math.PI * 2,
      rank: (Math.floor(i / textures.length) + .5) / (count / textures.length), speed: .7 + rnd() * .6 });
  }
  const tint = new THREE.Color(), dark = new THREE.Color(0x27303f);
  let travelX = 0, travelZ = 0;
  const wrap = span * 3.2;
  return {
    obj,
    step(t, dt, sky, dyn, profile) {
      const dir = dyn.windDir || [1, 0], amp = dyn.windAmp ?? 1;
      travelX += dir[0] * WIND.CLOUD_MPS * amp * dt;
      travelZ += dir[1] * WIND.CLOUD_MPS * amp * dt;
      tint.copy(sky).lerp(newWhite, .7).lerp(dark, profile.darkness * .85);
      for (const item of items) {
        const { sprite, type, phase } = item;
        const weight = profile[type], fade = THREE.MathUtils.smoothstep(weight - item.rank * .65, -.16, .16);
        const life = .82 + Math.sin(t * .035 * Math.max(.4, amp) + phase) * .18;
        const target = fade * Math.min(1, weight * 2.2) * life * .92;
        sprite.material.opacity += (target - sprite.material.opacity) * (1 - Math.exp(-dt * 2));
        sprite.visible = sprite.material.opacity > .003;
        if (!sprite.visible) continue;
        const pulse = Math.sin(t * .075 * amp + phase);
        const x = ((item.x + travelX * item.speed + wrap / 2) % wrap + wrap) % wrap - wrap / 2;
        const z = ((item.z + travelZ * item.speed + wrap / 2) % wrap + wrap) % wrap - wrap / 2;
        const high = type === 'cirrus' ? .24 : type === 'cumulonimbus' ? .02 : type === 'cumulus' ? .09 : 0;
        sprite.position.set(x + pulse * span * .012, span * (profile.altitude + high) + item.y, z);
        const size = item.size * profile.scale * (1 + pulse * .06);
        const aspect = type === 'cirrus' ? 4.2 : type === 'stratus' ? 3.4 : type === 'cumulonimbus' ? 1.6 : 2;
        sprite.scale.set(size * aspect, size * (type === 'cumulonimbus' ? 1.3 : .8), 1);
        sprite.material.rotation = type === 'cirrus' ? -.08 : pulse * .025;
        sprite.material.color.copy(tint);
        if (type === 'cirrus') sprite.material.color.lerp(newWhite, .35);
        if (type === 'cumulonimbus') sprite.material.color.lerp(dark, profile.storm * .4);
      }
    },
    dispose() { for (const item of items) item.sprite.material.dispose(); for (const texture of textures) texture.dispose(); },
  };
}
const newWhite = new THREE.Color(0xffffff);

// Instanced quads avoid square point-size limits and project rain along its actual velocity.
const PARTICLE_VERTEX = `
  attribute vec3 aOrigin;
  attribute vec3 aSeed;
  uniform vec3 uCamera;
  uniform vec3 uTravel;
  uniform vec3 uVelocity;
  uniform vec3 uBox;
  uniform float uTime;
  uniform float uDensity;
  uniform float uSize;
  uniform float uWidth;
  uniform float uTurbulence;
  uniform float uKind;
  uniform float uVeil;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vec3 p = aOrigin + uTravel * aSeed.z - uCamera;
    p.x += sin(uTime * 1.4 + aSeed.x) * uTurbulence;
    p.z += cos(uTime * 1.1 + aSeed.x * 1.7) * uTurbulence;
    p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    vec2 quad = position.xy;
    if (uKind < 0.5 && uVeil < 0.5) {
      vec2 fall = (modelViewMatrix * vec4(uVelocity, 0.0)).xy;
      float projected = length(fall);
      vec2 along = projected > 0.001 ? fall / projected : vec2(0.0, -1.0);
      quad = vec2(-along.y, along.x) * quad.x * uWidth + along * quad.y * uSize;
    } else {
      float angle = aSeed.x + uTime * (uKind < 1.5 ? 0.5 : 1.2);
      quad = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * quad;
      quad *= vec2(uWidth, 1.0) * uSize;
    }
    view.xy += quad * aSeed.y;
    gl_Position = projectionMatrix * view;
    vUv = uv;
    vec3 edge = abs(p) / (uBox * 0.5);
    vFade = (1.0 - smoothstep(0.78, 1.0, max(edge.x, max(edge.y, edge.z))))
      * (1.0 - smoothstep(uDensity - 0.025, uDensity, aSeed.x / 6.2831853));
  }
`;
const PARTICLE_FRAGMENT = `
  ${INK_INFO_DECL}
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uKind;
  uniform float uVeil;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float radius = length(p);
    float alpha;
    if (uVeil > 0.5) alpha = exp(-radius * radius * 4.5) * (1.0 - smoothstep(0.6, 1.0, radius));
    else if (uKind < 0.5) alpha = (1.0 - smoothstep(0.35, 1.0, abs(p.x))) * (1.0 - abs(p.y));
    else if (uKind < 1.5) {
      float arms = abs(sin(atan(p.y, p.x) * 3.0));
      alpha = (1.0 - smoothstep(0.4, 1.0, radius)) * (0.55 + 0.45 * (1.0 - arms));
    } else alpha = 1.0 - smoothstep(0.25, 1.0, radius);
    alpha *= uOpacity * vFade;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uColor, alpha);
    ${INK_INFO_NONE}
  }
`;

export function makeParticles(seed, { lowPower = false } = {}) {
  const obj = new THREE.Group(); obj.name = 'weather-particles';
  const layers = [];
  for (const [kind, capacity] of Object.entries(WEATHER_FX.particles)) {
    for (const detail of kind === 'snow' ? ['particles', 'veil', 'fine'] : ['particles', 'veil']) {
      const veil = detail === 'veil', fine = detail === 'fine';
      const budget = fine ? WEATHER_FX.snowFineParticles : capacity * (veil ? .12 : 1);
      const count = Math.round(budget * (lowPower ? WEATHER_FX.lowPowerScale : 1));
      const rnd = mulberry32((seed ^ (kind.charCodeAt(0) * 1997) ^ (veil ? 0x76A3 : fine ? 0x91B5 : 0)) >>> 0);
      const plane = new THREE.PlaneGeometry(1, 1), geometry = new THREE.InstancedBufferGeometry();
      geometry.setIndex(plane.index.clone());
      for (const [key, attr] of Object.entries(plane.attributes)) geometry.setAttribute(key, attr.clone());
      plane.dispose();
      const origins = new Float32Array(count * 3), seeds = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        origins.set([(rnd() - .5) * WEATHER_FX.box, (rnd() - .5) * WEATHER_FX.height, (rnd() - .5) * WEATHER_FX.box], i * 3);
        // Sorted ranks keep reduced density spatially uniform and avoid reseeding during transitions.
        seeds.set([(i + .5) / count * Math.PI * 2, .65 + rnd() * .7, .7 + rnd() * .6], i * 3);
      }
      geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
      geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
      geometry.instanceCount = count;
      const uniforms = {
        uCamera: { value: new THREE.Vector3() }, uTravel: { value: new THREE.Vector3() },
        uVelocity: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(WEATHER_FX.box, WEATHER_FX.height, WEATHER_FX.box) },
        uTime: { value: 0 }, uDensity: { value: 0 }, uSize: { value: 1 }, uWidth: { value: 1 },
        uTurbulence: { value: 0 }, uOpacity: { value: 0 }, uVeil: { value: veil ? 1 : 0 },
        uKind: { value: kind === 'rain' ? 0 : kind === 'snow' ? 1 : 2 },
        uColor: { value: new THREE.Color(kind === 'sand' ? 0xc7a16a : kind === 'rain' ? 0xb6d7ed : 0xe7f3ff) },
      };
      const material = new THREE.ShaderMaterial({ uniforms, vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
        transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.visible = false;
      mesh.name = `${kind}-${detail}`; obj.add(mesh);
      layers.push({ kind, veil, fine, mesh, uniforms });
    }
  }
  let time = 0;
  return {
    obj,
    update(dt, camera, dyn, profiles) {
      time += dt; obj.position.copy(camera.position);
      const dir = dyn.windDir || [1, 0];
      for (const layer of layers) {
        const p = profiles[layer.kind], u = layer.uniforms;
        const target = layer.veil ? p.veil : layer.fine ? p.opacity * p.fine : p.opacity;
        u.uOpacity.value += (target - u.uOpacity.value) * (1 - Math.exp(-dt * 4));
        layer.mesh.visible = u.uOpacity.value > .003;
        u.uTime.value = time; u.uCamera.value.copy(camera.position);
        u.uDensity.value += (p.density - u.uDensity.value) * (1 - Math.exp(-dt * 4));
        layer.mesh.geometry.instanceCount = Math.ceil(layer.mesh.geometry.attributes.aSeed.count * u.uDensity.value);
        u.uSize.value = layer.veil ? (layer.kind === 'sand' ? 32 : 14) : layer.fine ? .16 : p.size;
        u.uWidth.value = layer.veil ? 2.2 : p.width;
        u.uTurbulence.value = p.turbulence;
        u.uVelocity.value.set(dir[0] * p.drift, -p.speed, dir[1] * p.drift);
        u.uTravel.value.addScaledVector(u.uVelocity.value, dt);
      }
    },
    dispose() { for (const { mesh } of layers) { mesh.geometry.dispose(); mesh.material.dispose(); } },
  };
}

// Each authoritative strike gets a pooled slot, so simultaneous targets keep their own arcs.
export function makeLightningSystem(seed) {
  const obj = new THREE.Group(); obj.name = 'weather-lightning';
  const slots = [], rnd = mulberry32((seed ^ 0x5B791) >>> 0);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
  const ctx = glowCanvas.getContext('2d'), gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.25, '#a7dfff'); gradient.addColorStop(1, 'rgba(90,160,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(glowCanvas); texture.colorSpace = THREE.SRGBColorSpace;
  const capacity = WEATHER_FX.lightningSegments + WEATHER_FX.lightningBranches * WEATHER_FX.lightningBranchSegments;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const center = new THREE.Vector3(), direction = new THREE.Vector3(), axis = new THREE.Vector3(0, 1, 0);
  const normalized = new THREE.Vector3(), facing = new THREE.Vector3();
  const inverse = new THREE.Quaternion(), twist = new THREE.Quaternion();
  // The same server tick can strike every unit target plus one world surface.
  for (let i = 0; i < WEATHER_DEBUFFS.LIGHTNING.MAX_TARGETS + 1; i++) {
    const group = new THREE.Group(); group.visible = false; obj.add(group);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xecfaff, transparent: true, depthWrite: false, fog: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x63b4ff, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const core = new THREE.InstancedMesh(geometry, coreMat, capacity);
    const halo = new THREE.InstancedMesh(geometry, haloMat, capacity);
    core.frustumCulled = halo.frustumCulled = false;
    const glowMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Sprite(glowMat); group.add(halo, core, glow);
    slots.push({ group, core, halo, glow, timer: 0, duration: 0, strength: 0, segments: [] });
  }
  const append = (slot, a, b, width) => slot.segments.push({ a: a.clone(), b: b.clone(), width });
  return {
    obj,
    strike(start, end, profile) {
      if (![start.x, start.y, start.z, end.x, end.y, end.z].every(Number.isFinite)) return false;
      if (start.distanceToSquared(end) < .001) return false;
      const slot = slots.find(s => s.timer <= 0) || slots.reduce((a, b) => a.timer < b.timer ? a : b);
      slot.segments.length = 0;
      slot.timer = slot.duration = profile.duration; slot.strength = profile.strength;
      slot.group.visible = true;
      const length = start.distanceTo(end), delta = end.clone().sub(start);
      let current = start.clone();
      for (let i = 0; i < profile.segments; i++) {
        const next = start.clone().addScaledVector(delta, (i + 1) / profile.segments);
        if (i < profile.segments - 1) {
          const jitter = length * (.025 + profile.strength * .035) * Math.sin((i + 1) / profile.segments * Math.PI);
          next.x += (rnd() - .5) * jitter; next.z += (rnd() - .5) * jitter;
        }
        append(slot, current, next, profile.width);
        current = next;
      }
      for (let i = 0; i < profile.branches; i++) {
        let branch = slot.segments[Math.floor((i + 1) / (profile.branches + 1) * profile.segments)].a.clone();
        const heading = new THREE.Vector3(rnd() - .5, -.6, rnd() - .5).normalize();
        for (let j = 0; j < WEATHER_FX.lightningBranchSegments; j++) {
          const next = branch.clone().addScaledVector(heading, length * .018);
          next.x += (rnd() - .5) * length * .02; next.z += (rnd() - .5) * length * .02;
          append(slot, branch, next, profile.width * (1 - j / WEATHER_FX.lightningBranchSegments) * .5);
          branch = next;
        }
      }
      slot.core.count = slot.halo.count = slot.segments.length;
      slot.glow.position.copy(end); slot.glow.scale.setScalar(profile.glow);
      return true;
    },
    update(dt, camera) {
      let flash = 0;
      for (const slot of slots) {
        slot.timer = Math.max(0, slot.timer - dt); slot.group.visible = slot.timer > 0;
        if (!slot.group.visible) continue;
        const age = slot.duration - slot.timer, fade = slot.timer / slot.duration;
        const pulse = age < .055 ? 1 : .24 + Math.max(0, Math.cos(age * (45 + slot.strength * 28))) * .76;
        const opacity = fade * pulse;
        slot.core.material.opacity = opacity; slot.halo.material.opacity = opacity * .32;
        slot.glow.material.opacity = opacity * .65;
        flash = Math.max(flash, opacity * (.25 + slot.strength * .75));
        for (let i = 0; i < slot.segments.length; i++) {
          const segment = slot.segments[i];
          center.copy(segment.a).add(segment.b).multiplyScalar(.5);
          direction.copy(segment.b).sub(segment.a);
          rotation.setFromUnitVectors(axis, normalized.copy(direction).normalize());
          // Cylindrical billboarding keeps bolt thickness visible from every camera bearing.
          facing.copy(camera.position).sub(center).applyQuaternion(inverse.copy(rotation).invert());
          rotation.multiply(twist.setFromAxisAngle(axis, Math.atan2(facing.x, facing.z)));
          scale.set(segment.width, direction.length(), 1); matrix.compose(center, rotation, scale);
          slot.core.setMatrixAt(i, matrix);
          scale.x *= 5; matrix.compose(center, rotation, scale); slot.halo.setMatrixAt(i, matrix);
        }
        slot.core.instanceMatrix.needsUpdate = slot.halo.instanceMatrix.needsUpdate = true;
      }
      return flash;
    },
    dispose() {
      for (const slot of slots) {
        slot.core.dispose(); slot.halo.dispose(); slot.core.material.dispose(); slot.halo.material.dispose(); slot.glow.material.dispose();
      }
      geometry.dispose(); texture.dispose();
    },
  };
}
