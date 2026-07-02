import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Localized, volumetric 3D weather phenomena anchored in world space at each
// weather point. Unlike a flat animated icon, every point grows a genuine 3D
// rig the camera can orbit around and fly through:
//   • drifting low-poly, faceted cloud banks (Quaternius-style stylised blobs)
//   • falling 3D rain shafts / swirling snow columns
//   • ground-hugging fog puffs
//   • a pulsing 3D sun with rotating rays (clear sky)
//   • forked lightning bolts with a synced light flash (thunderstorms)
//
// Entirely procedural — no external model assets to download — so it works
// offline and adds no bundle weight, and is driven per frame from the terrain
// viewer's render loop. Distant rigs are culled so a long route with many
// weather points stays cheap.
// ---------------------------------------------------------------------------

const TWO_PI = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// Soft radial-gradient sprite texture (glow / snowflake / fog puff).
function softTexture(inner, outer) {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class WeatherFx3D {
  // scale    — marker scale (≈ worldSpan / 300); sizes the rigs to the terrain.
  // worldSpan — terrain span in world units; sets the distance-cull radius.
  constructor(scene, { scale = 1, worldSpan = 2000 } = {}) {
    this.scene = scene;
    this.U = Math.max(0.5, scale);
    this.worldSpan = worldSpan || 2000;
    this.group = new THREE.Group();
    this.group.renderOrder = 4;
    scene.add(this.group);

    this._rigs = [];
    this._visible = true;
    this._time = 0;
    // Only rigs beyond this radius of the camera sleep. Kept generous so weather
    // stays visible when the user zooms out to frame the whole route — it only
    // trims genuinely far-off rigs on very large multi-day routes.
    this._cullDist = Math.max(this.worldSpan * 8, 50000);

    // Shared GPU resources, disposed together with the instance.
    this._glowTex = softTexture('rgba(255,240,190,0.95)', 'rgba(255,200,90,0)');
    this._flakeTex = softTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
    this._fogTex = softTexture('rgba(226,232,240,0.8)', 'rgba(226,232,240,0)');
    this._cloudGeo = new THREE.IcosahedronGeometry(1, 1);
    this._sunGeo = new THREE.IcosahedronGeometry(1, 1);
    this._rayGeo = new THREE.ConeGeometry(0.18, 1, 5);
    this._disposables = [this._glowTex, this._flakeTex, this._fogTex, this._cloudGeo, this._sunGeo, this._rayGeo];
  }

  // points: [{ pos: THREE.Vector3, cat: string }]. cat is the coarse weather
  // category ('clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder').
  build(points) {
    for (const p of points || []) {
      if (!p || !p.pos) continue;
      const rig = this._buildRig(p.cat || 'clear');
      if (!rig) continue;
      rig.group.position.copy(p.pos);
      rig.group.rotation.y = Math.random() * TWO_PI;
      this.group.add(rig.group);
      this._rigs.push(rig);
    }
    this.group.visible = this._visible;
  }

  hasRigs() {
    return this._rigs.length > 0;
  }

  setVisible(v) {
    this._visible = !!v;
    if (this.group) this.group.visible = this._visible;
  }

  update(dt, camera) {
    if (!this._visible || !this._rigs.length || !this.group) return;
    this._time += dt;
    const t = this._time;
    const camPos = camera ? camera.position : null;
    for (const rig of this._rigs) {
      if (camPos) {
        const vis = rig.group.position.distanceTo(camPos) < this._cullDist;
        if (rig.group.visible !== vis) rig.group.visible = vis;
        if (!vis) continue;
      }
      rig.update(dt, t);
    }
  }

  dispose() {
    if (this.group) {
      if (this.group.parent) this.group.parent.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    for (const d of this._disposables) { try { d.dispose(); } catch { /* noop */ } }
    this._disposables = [];
    this._rigs = [];
    this.group = null;
  }

  // ---- rig factory ----------------------------------------------------------

  _buildRig(cat) {
    switch (cat) {
      case 'clear':   return this._makeSun();
      case 'cloudy':  return this._makeCloudy();
      case 'fog':     return this._makeFog();
      case 'snow':    return this._makeSnow();
      case 'drizzle':
      case 'rain':
      case 'thunder': return this._makePrecip(cat);
      default:        return this._makeCloudy();
    }
  }

  // A drifting cluster of faceted low-poly cloud blobs. Returns { obj, update }
  // so precipitation rigs can mount it as their storm cloud.
  _makeClouds(count, color, opacity, baseY, spread, blobR) {
    const g = new THREE.Group();
    g.position.y = baseY;
    const base = new THREE.Color(color);
    const mat = new THREE.MeshStandardMaterial({
      color: base,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity,
      emissive: base.clone().multiplyScalar(0.22),
    });
    this._disposables.push(mat);

    const blobs = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this._cloudGeo, mat);
      const a = (i / count) * TWO_PI + Math.random() * 0.6;
      const rr = spread * (0.15 + Math.random() * 0.85);
      const y0 = (Math.random() - 0.5) * spread * 0.28;
      m.position.set(Math.cos(a) * rr, y0, Math.sin(a) * rr * 0.7);
      const s = blobR * (0.7 + Math.random() * 0.7);
      m.scale.set(s * 1.35, s * 0.8, s);
      m.rotation.set(Math.random() * TWO_PI, Math.random() * TWO_PI, Math.random() * TWO_PI);
      g.add(m);
      blobs.push({ m, y0, ph: Math.random() * TWO_PI, bob: 0.4 + Math.random() * 0.6 });
    }

    const driftR = spread * 0.14;
    const dphase = Math.random() * TWO_PI;
    const update = (dt, t) => {
      g.rotation.y += dt * 0.04;
      g.position.x = Math.cos(t * 0.06 + dphase) * driftR;
      g.position.z = Math.sin(t * 0.05 + dphase) * driftR;
      for (const b of blobs) b.m.position.y = b.y0 + Math.sin(t * b.bob + b.ph) * blobR * 0.12;
    };
    return { obj: g, update };
  }

  _makeCloudy() {
    const U = this.U;
    const g = new THREE.Group();
    const clouds = this._makeClouds(6, 0xeef2f8, 0.95, 40 * U, 22 * U, 10 * U);
    g.add(clouds.obj);
    return { group: g, update: (dt, t) => clouds.update(dt, t) };
  }

  // Storm cloud + falling rain shaft (line segments in a cylindrical volume).
  // Thunder additionally forks a bolt to ground and pops a light flash.
  _makePrecip(cat) {
    const U = this.U;
    const g = new THREE.Group();
    const isThunder = cat === 'thunder';
    const isDrizzle = cat === 'drizzle';

    const cloudBaseY = 40 * U;
    const cloudColor = isThunder ? 0x565e70 : (isDrizzle ? 0xa6b4c6 : 0x8b98ad);
    const clouds = this._makeClouds(isThunder ? 7 : 6, cloudColor, 0.96, cloudBaseY, 22 * U, isThunder ? 11 * U : 10 * U);
    g.add(clouds.obj);

    const drops = isDrizzle ? 60 : 110;
    const colH = cloudBaseY - 3 * U;
    const radius = 13 * U;
    const len = (isDrizzle ? 3 : 6) * U;
    const positions = new Float32Array(drops * 2 * 3);
    const bx = new Float32Array(drops);
    const bz = new Float32Array(drops);
    const ys = new Float32Array(drops);
    const sp = new Float32Array(drops);
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * TWO_PI;
      const rr = Math.sqrt(Math.random()) * radius;
      bx[i] = Math.cos(a) * rr;
      bz[i] = Math.sin(a) * rr;
      ys[i] = Math.random() * colH;
      sp[i] = (isDrizzle ? 18 : 34) * U * (0.8 + Math.random() * 0.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: isDrizzle ? 0xbcd0e8 : 0x9fc4ff,
      transparent: true,
      opacity: isDrizzle ? 0.35 : 0.5,
      depthWrite: false,
    });
    this._disposables.push(mat);
    const rain = new THREE.LineSegments(geo, mat);
    rain.frustumCulled = false;
    g.add(rain);

    const writeDrops = () => {
      const p = positions;
      for (let i = 0; i < drops; i++) {
        const y = ys[i];
        const o = i * 6;
        p[o] = bx[i];            p[o + 1] = y + len; p[o + 2] = bz[i];
        p[o + 3] = bx[i] - 0.15 * len; p[o + 4] = y; p[o + 5] = bz[i];
      }
      geo.attributes.position.needsUpdate = true;
    };
    writeDrops();

    // Thunder extras: a forked bolt (regenerated each strike) + a flash light.
    let boltGeo = null;
    let bolt = null;
    let flashLight = null;
    let nextStrike = 0;
    let flash = 0;
    const BOLT_PTS = 11;
    if (isThunder) {
      boltGeo = new THREE.BufferGeometry();
      boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_PTS * 3), 3));
      const bmat = new THREE.LineBasicMaterial({
        color: 0xcfe4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._disposables.push(bmat);
      bolt = new THREE.Line(boltGeo, bmat);
      bolt.frustumCulled = false;
      bolt.visible = false;
      g.add(bolt);
      flashLight = new THREE.PointLight(0xbfd4ff, 0, 140 * U, 2);
      flashLight.position.y = cloudBaseY * 0.7;
      g.add(flashLight);
      nextStrike = 1 + Math.random() * 4;
    }
    const strike = () => {
      const arr = boltGeo.attributes.position.array;
      const topY = cloudBaseY - 2 * U;
      const botY = 2 * U;
      const ex = (Math.random() - 0.5) * radius;
      const ez = (Math.random() - 0.5) * radius;
      for (let i = 0; i < BOLT_PTS; i++) {
        const f = i / (BOLT_PTS - 1);
        const jit = (1 - f) * 6 * U;
        arr[i * 3] = ex * f + (Math.random() - 0.5) * jit;
        arr[i * 3 + 1] = topY + (botY - topY) * f;
        arr[i * 3 + 2] = ez * f + (Math.random() - 0.5) * jit;
      }
      boltGeo.attributes.position.needsUpdate = true;
      flash = 1;
    };

    const update = (dt, t) => {
      clouds.update(dt, t);
      for (let i = 0; i < drops; i++) {
        ys[i] -= sp[i] * dt;
        if (ys[i] < 0) ys[i] += colH;
      }
      writeDrops();
      if (isThunder) {
        nextStrike -= dt;
        if (nextStrike <= 0) { strike(); nextStrike = 2.5 + Math.random() * 5; }
        if (flash > 0) flash = Math.max(0, flash - dt / 0.16);
        bolt.material.opacity = flash;
        bolt.visible = flash > 0;
        flashLight.intensity = flash * 2.4;
      }
    };
    return { group: g, update };
  }

  // Snow cloud + a column of drifting flake sprites.
  _makeSnow() {
    const U = this.U;
    const g = new THREE.Group();
    const cloudBaseY = 40 * U;
    const clouds = this._makeClouds(6, 0xdfe7f2, 0.96, cloudBaseY, 22 * U, 10 * U);
    g.add(clouds.obj);

    const n = 90;
    const colH = cloudBaseY - 2 * U;
    const radius = 15 * U;
    const pos = new Float32Array(n * 3);
    const bx = new Float32Array(n);
    const bz = new Float32Array(n);
    const ys = new Float32Array(n);
    const ph = new Float32Array(n);
    const sp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const rr = Math.sqrt(Math.random()) * radius;
      bx[i] = Math.cos(a) * rr;
      bz[i] = Math.sin(a) * rr;
      ys[i] = Math.random() * colH;
      ph[i] = Math.random() * TWO_PI;
      sp[i] = (3 + Math.random() * 3) * U;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: this._flakeTex, color: 0xffffff, size: 2.6 * U, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false,
    });
    this._disposables.push(mat);
    const snow = new THREE.Points(geo, mat);
    snow.frustumCulled = false;
    g.add(snow);

    const write = (t) => {
      for (let i = 0; i < n; i++) {
        pos[i * 3] = bx[i] + Math.sin(t * 0.8 + ph[i]) * 2 * U;
        pos[i * 3 + 1] = ys[i];
        pos[i * 3 + 2] = bz[i] + Math.cos(t * 0.7 + ph[i]) * 2 * U;
      }
      geo.attributes.position.needsUpdate = true;
    };
    write(0);
    const update = (dt, t) => {
      clouds.update(dt, t);
      for (let i = 0; i < n; i++) { ys[i] -= sp[i] * dt; if (ys[i] < 0) ys[i] += colH; }
      write(t);
    };
    return { group: g, update };
  }

  // A bank of ground-hugging fog puffs that slowly swirl and breathe.
  _makeFog() {
    const U = this.U;
    const g = new THREE.Group();
    const n = 7;
    const radius = 24 * U;
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._fogTex, color: 0xd6dde6, transparent: true, opacity: 0, depthWrite: false,
      });
      this._disposables.push(mat);
      const s = new THREE.Sprite(mat);
      const a = (i / n) * TWO_PI;
      const rr = radius * (0.25 + Math.random() * 0.75);
      const size = (22 + Math.random() * 18) * U;
      s.scale.set(size * 1.7, size, 1);
      s.position.set(Math.cos(a) * rr, (3 + Math.random() * 6) * U, Math.sin(a) * rr);
      g.add(s);
      puffs.push({ s, a, rr, base: 0.28 + Math.random() * 0.22, ph: Math.random() * TWO_PI, spin: 0.04 + Math.random() * 0.05 });
    }
    const update = (dt, t) => {
      for (const p of puffs) {
        p.a += dt * p.spin;
        p.s.position.x = Math.cos(p.a) * p.rr;
        p.s.position.z = Math.sin(p.a) * p.rr;
        p.s.material.opacity = p.base * (0.6 + 0.4 * Math.sin(t * 0.5 + p.ph));
      }
    };
    return { group: g, update };
  }

  // A pulsing 3D sun: faceted emissive core, additive glow billboard and a ring
  // of rotating cone rays.
  _makeSun() {
    const U = this.U;
    // Outer group is anchored at the surface by build(); the sun lives in an inner
    // group lifted into the sky (setting the outer group's y would be clobbered by
    // build()'s position.copy).
    const g = new THREE.Group();
    const sky = new THREE.Group();
    sky.position.y = 48 * U;
    g.add(sky);

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 1.1, roughness: 0.5, metalness: 0, flatShading: true,
    });
    this._disposables.push(coreMat);
    const core = new THREE.Mesh(this._sunGeo, coreMat);
    core.scale.setScalar(8 * U);
    sky.add(core);

    const glowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0xffd257, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._disposables.push(glowMat);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(34 * U);
    sky.add(glow);

    const rays = new THREE.Group();
    const rayMat = new THREE.MeshStandardMaterial({
      color: 0xffcf3d, emissive: 0xffb020, emissiveIntensity: 0.9, transparent: true, opacity: 0.85, flatShading: true,
    });
    this._disposables.push(rayMat);
    const rayCount = 8;
    for (let i = 0; i < rayCount; i++) {
      const m = new THREE.Mesh(this._rayGeo, rayMat);
      const a = (i / rayCount) * TWO_PI;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      m.scale.set(3 * U, 9 * U, 3 * U);              // local Y is the cone axis → its length
      m.quaternion.setFromUnitVectors(UP, dir);       // aim the axis radially outward
      m.position.copy(dir).multiplyScalar(15 * U);
      rays.add(m);
    }
    sky.add(rays);

    const update = (dt, t) => {
      core.rotation.y += dt * 0.3;
      core.rotation.x += dt * 0.15;
      rays.rotation.y += dt * 0.5;
      const pulse = 1 + 0.08 * Math.sin(t * 2);
      glow.scale.setScalar(34 * U * pulse);
      glow.material.opacity = 0.7 + 0.15 * Math.sin(t * 2);
    };
    return { group: g, update };
  }
}
