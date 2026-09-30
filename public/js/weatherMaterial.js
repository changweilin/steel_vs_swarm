import * as THREE from 'three';
import { weatherSurfaceCover, WEATHER_SURFACE } from './weatherState.js';
import { objHeightMax } from './data.js';

const empty = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
empty.needsUpdate = true;
export const weatherUniforms = {
  uSurfaceCover: { value: new THREE.Vector3() },
  uScorchAtlas: { value: empty },
  uScorchGround: { value: empty },
  uScorchGroundRange: { value: new THREE.Vector2(0, 1) },
  uScorchMin: { value: new THREE.Vector3() },
  uScorchSpan: { value: new THREE.Vector3(1, 1, 1) },
  uScorchGrid: { value: new THREE.Vector2(1, 1) },
};

export function setSurfaceWeather(state = {}) {
  weatherUniforms.uSurfaceCover.value.set(...['water', 'snow', 'sand'].map(k => weatherSurfaceCover(state[k])));
}

// A height-sliced atlas preserves every strike for the battle with bounded GPU storage.
// It also works on batched buildings and instanced trees without detaching their geometry.
export function makeScorchAtlas(terrain) {
  const nx = 256, nz = 256, ny = 64, columns = 4;
  const width = nx * columns, height = nz * (ny / 4 / columns);
  const data = new Uint8Array(width * height * 4);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const min = new THREE.Vector3(terrain.minX, -WEATHER_SURFACE.strikeR * 2, terrain.minZ);
  const span = new THREE.Vector3(terrain.worldW, objHeightMax() + WEATHER_SURFACE.strikeR * 4, terrain.worldH);
  // Terrain-relative slices keep mountain elevation from stretching a local scar over a whole building.
  const groundData = new Uint8Array(nx * nz * 4), groundHeights = new Float32Array(nx * nz);
  let groundMin = Infinity, groundMax = -Infinity;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const index = iz * nx + ix;
    const h = terrain.heightAt(min.x + (ix + .5) / nx * span.x, min.z + (iz + .5) / nz * span.z);
    groundHeights[index] = h;
    groundMin = Math.min(groundMin, h); groundMax = Math.max(groundMax, h);
  }
  const groundRange = Math.max(1, groundMax - groundMin);
  for (let index = 0; index < groundHeights.length; index++) {
    const packed = Math.round(Math.max(0, Math.min(1, (groundHeights[index] - groundMin) / groundRange)) * 65535);
    groundData[index * 4] = packed >> 8; groundData[index * 4 + 1] = packed & 255;
  }
  const groundTexture = new THREE.DataTexture(groundData, nx, nz, THREE.RGBAFormat);
  groundTexture.minFilter = groundTexture.magFilter = THREE.LinearFilter;
  groundTexture.needsUpdate = true;
  weatherUniforms.uScorchAtlas.value = texture;
  weatherUniforms.uScorchGround.value = groundTexture;
  weatherUniforms.uScorchGroundRange.value.set(groundMin, groundRange);
  weatherUniforms.uScorchMin.value.copy(min);
  weatherUniforms.uScorchSpan.value.copy(span);
  weatherUniforms.uScorchGrid.value.set(nx, nz);
  let seen = 0;
  return {
    sync(marks) {
      if (!Array.isArray(marks) || seen >= marks.length) return;
      for (; seen < marks.length; seen++) {
        const { x, y, z, r } = marks[seen];
        if (![x, y, z, r].every(Number.isFinite) || r <= 0) continue;
        const p = [x - min.x, y - min.y, -z - min.z];
        const dims = [nx, ny, nz], sizes = [span.x, span.y, span.z];
        const lo = p.map((v, i) => Math.max(0, Math.floor((v - r) / sizes[i] * dims[i]) - 1));
        const hi = p.map((v, i) => Math.min(dims[i] - 1, Math.ceil((v + r) / sizes[i] * dims[i]) + 1));
        lo[1] = 0; hi[1] = ny - 1;
        for (let iy = lo[1]; iy <= hi[1]; iy++) for (let iz = lo[2]; iz <= hi[2]; iz++) for (let ix = lo[0]; ix <= hi[0]; ix++) {
          // Account for voxel width so a strike never falls between height slices.
          const q = [ix, iy, iz].map((v, i) => Math.max(0, Math.abs((v + .5) / dims[i] * sizes[i]
            + (i === 1 ? groundHeights[iz * nx + ix] : 0) - p[i]) - sizes[i] / dims[i] * .5));
          const amount = Math.max(0, 1 - Math.hypot(...q) / r);
          const tile = Math.floor(iy / 4);
          const index = ((Math.floor(tile / columns) * nz + iz) * width + (tile % columns) * nx + ix) * 4 + iy % 4;
          data[index] = Math.max(data[index], Math.round(amount * 255));
        }
      }
      texture.needsUpdate = true;
    },
    dispose() {
      if (weatherUniforms.uScorchAtlas.value === texture) {
        weatherUniforms.uScorchAtlas.value = empty;
        weatherUniforms.uScorchGround.value = empty;
      }
      texture.dispose(); groundTexture.dispose();
    },
  };
}

export const WEATHER_MATERIAL_DECL = /* glsl */`
uniform vec3 uSurfaceCover;
uniform sampler2D uScorchAtlas;
uniform sampler2D uScorchGround;
uniform vec2 uScorchGroundRange;
uniform vec3 uScorchMin;
uniform vec3 uScorchSpan;
uniform vec2 uScorchGrid;
float weatherScorchSlice(vec2 uv, float slice) {
  float index = floor(slice / 4.0), channel = mod(slice, 4.0);
  vec2 tile = vec2(mod(index, 4.0), floor(index / 4.0));
  uv = clamp(uv, 0.5 / uScorchGrid, 1.0 - 0.5 / uScorchGrid);
  vec4 sampleValue = texture2D(uScorchAtlas, (tile + uv) / 4.0);
  return channel < 0.5 ? sampleValue.r : channel < 1.5 ? sampleValue.g : channel < 2.5 ? sampleValue.b : sampleValue.a;
}
float weatherScorch(vec3 world) {
  vec3 uv = (world - uScorchMin) / uScorchSpan;
  vec2 groundCode = texture2D(uScorchGround, clamp(uv.xz, 0.5 / uScorchGrid, 1.0 - 0.5 / uScorchGrid)).rg;
  float ground = uScorchGroundRange.x + dot(groundCode, vec2(65280.0, 255.0)) / 65535.0 * uScorchGroundRange.y;
  uv.y -= ground / uScorchSpan.y;
  if (any(lessThan(uv, vec3(0.0))) || any(greaterThan(uv, vec3(1.0)))) return 0.0;
  float y = clamp(uv.y * 64.0 - 0.5, 0.0, 63.0);
  return mix(weatherScorchSlice(uv.xz, floor(y)), weatherScorchSlice(uv.xz, min(63.0, floor(y) + 1.0)), fract(y));
}
`;

export const WEATHER_MATERIAL_COLOR = /* glsl */`
#ifdef CEL_WEATHER_SURFACE
{
  vec3 wn = normalize(inverseTransformDirection(normal, viewMatrix));
  float flatSurface = smoothstep(0.96, 0.995, wn.y);
  float up = smoothstep(0.25, 0.85, wn.y);
  float patchNoise = celNoise(vCelWP.xz * 0.12) * 0.7 + celNoise(vCelWP.xz * 0.037) * 0.3;
  float wet = smoothstep(patchNoise - 0.025, patchNoise + 0.025, uSurfaceCover.x) * flatSurface * min(1.0, uSurfaceCover.x * 8.0);
  float sand = smoothstep(patchNoise - 0.12, patchNoise + 0.12, uSurfaceCover.z) * up * min(1.0, uSurfaceCover.z * 8.0);
  float snow = smoothstep(patchNoise - 0.16, patchNoise + 0.16, uSurfaceCover.y) * up * min(1.0, uSurfaceCover.y * 8.0);
  diffuseColor.rgb *= 1.0 - uSurfaceCover.x * 0.2;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.19, 0.24), wet * 0.65);
  vec2 rippleUv = vCelWP.xz * 0.3;
  float rippleSeed = celNoise(floor(rippleUv) + 31.7);
  float rippleAge = fract(uSurfaceTime * 0.7 + rippleSeed * 8.0);
  float rippleDistance = abs(length(fract(rippleUv) - 0.5) - rippleAge * 0.6);
  float ripple = (1.0 - smoothstep(0.01, 0.03, rippleDistance)) * (1.0 - rippleAge) * step(0.65, rippleSeed);
  diffuseColor.rgb += wet * (0.05 + ripple * 0.035);
  float ridge = 0.92 + 0.08 * sin(vCelWP.x * 2.0 + sin(vCelWP.z * 0.5) * 3.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.57, 0.39, 0.19) * ridge, sand * 0.93);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.89, 0.95), snow * 0.97);
  diffuseColor.rgb *= 1.0 - weatherScorch(vCelWP) * 0.92;
}
#endif
`;
