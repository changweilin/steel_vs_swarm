// ============ 戰鬥客戶端:第一人稱 無人機 vs 機甲 + DOTA 兵線 ============
// 伺服器權威(HP/傷害/波次),客戶端負責:
//  - 3D 渲染(地形 + 單位 + 特效)
//  - 第一人稱操控(蜂群=飛行無人機、鋼鐵=地面機甲)
//  - 射擊 raycast 命中回報、範圍技落點回報
//  - 2D 戰術地圖(minimap,繼承 mapping_elf 的 2D 地圖概念)
import * as THREE from 'three';
import { SIDES, UNITS, GAME } from './data.js';
import { llToWorld } from './terrain.js';
import { makeUnit } from './models.js';

const KIND_KEY = {
  soldier: 'creep:soldier', apc: 'creep:apc', tank: 'creep:tank',
  tower: 'tower', drone: 'hero:drone', robot: 'hero:robot',
};
const LANE_COLORS = [0xe6c34a, 0xe05c4a, 0x4ac3e6];

export class BattleClient {
  /**
   * opts: { canvas, minimapCanvas, cfg, side(可 null=觀戰), net, terrain, hud }
   * hud: { self, bases, wave, feed, dead, over, cooldown, hitmark }
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.center = this.cfg.center;
    this.ents = new Map();
    this.effects = [];
    this.projectiles = [];
    this.keys = {};
    this.yaw = 0; this.pitch = -0.1;
    this.vel = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.hp = 0; this.maxHp = 1;
    this.dead = false;
    this.lastFire = 0; this.lastBurst = -99;
    this.lastPosSend = 0;
    this.mixers = new Set();
    this.spinners = new Set();
    this.disposed = false;
    this._snapQueue = null;

    this.isDrone = this.side && SIDES[this.side].hero === 'drone';
    this.heroKind = this.side ? SIDES[this.side].hero : null;

    this._initScene();
    this._initLanes();
    this._initInput();
    this._initMinimap();

    // 出生點:己方主堡朝敵方主堡方向外推 100m(避免卡在主堡模型裡),面向敵方
    this._spawnAt();
    if (!this.side) {
      const [cx, cz] = llToWorld(this.center.lat, this.center.lng, this.center);
      this.pos.set(cx, this.terrain.heightAt(cx, cz) + 400, cz); // 觀戰:高空俯瞰
      this.pitch = -0.9;
    }

    this.clock = new THREE.Clock();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  // ---------------- 場景 ----------------
  _initScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e141b);
    const span = Math.max(this.terrain.worldW, this.terrain.worldH);
    this.scene.fog = new THREE.Fog(0x101820, span * 0.25, span * 1.2);
    this.camera = new THREE.PerspectiveCamera(72, this.canvas.clientWidth / this.canvas.clientHeight, 0.5, span * 2);

    this.scene.add(new THREE.HemisphereLight(0x9fb4c8, 0x2a2620, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.25);
    sun.position.set(span * 0.4, span * 0.5, span * 0.2);
    this.scene.add(sun);

    this.scene.add(this.terrain.group);

    this._onResize = () => {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);

    this.raycaster = new THREE.Raycaster();
  }

  /** 三條兵線畫在地形上(發光折線) */
  _initLanes() {
    this.lanePts = this.cfg.lanes.map((lane) => lane.map(([lat, lng]) => {
      const [x, z] = llToWorld(lat, lng, this.center);
      return new THREE.Vector3(x, this.terrain.heightAt(x, z) + 2, z);
    }));
    this.lanePts.forEach((pts, i) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: LANE_COLORS[i], transparent: true, opacity: 0.65,
      }));
      this.scene.add(line);
    });
  }

  // ---------------- 輸入 ----------------
  _initInput() {
    this._onKey = (e) => {
      if (e.type === 'keydown' && e.code === 'KeyM') this.minimapBig = !this.minimapBig;
      this.keys[e.code] = e.type === 'keydown';
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);

    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0023));
    };
    document.addEventListener('mousemove', this._onMouseMove);

    this._onMouseDown = (e) => {
      if (!this.side) return;
      if (document.pointerLockElement !== this.canvas) { this.canvas.requestPointerLock(); return; }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this._fireBurst();
    };
    this._onMouseUp = (e) => { if (e.button === 0) this.firing = false; };
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this._onCtx = (e) => e.preventDefault();
    this.canvas.addEventListener('contextmenu', this._onCtx);
  }

  // ---------------- 快照同步 ----------------
  onSnap(m) { this._snapQueue = m; }

  _applySnap(m) {
    const seen = new Set();
    for (const e of m.ents) {
      seen.add(e.id);
      let ent = this.ents.get(e.id);
      if (!ent) ent = this._spawnEnt(e);
      ent.hp = e.hp; ent.max = e.m;
      ent.tgt.set(e.x, 0, -e.z);           // 模擬 z=北 → three z=南
      if (e.k === 'drone' || e.k === 'robot') {
        ent.heroY = e.y ?? 0;
        ent.ry = e.ry ?? 0;
        ent.dead = !!e.dead;
        ent.mesh.visible = !e.dead && !ent.isSelf;
        if (ent.isSelf) {
          this.hp = e.hp; this.maxHp = e.m;
          if (e.dead && !this.dead) this._onSelfDeath();
          if (!e.dead && this.dead) this._onSelfRespawn();
          this.hud.dead?.(e.dead ? e.rs : null);
        }
      }
      this._updateHpBar(ent);
    }
    // 移除消失的單位
    for (const [id, ent] of this.ents) {
      if (!seen.has(id)) { this._removeEnt(id, ent); }
    }
    // 事件
    for (const ev of m.ev || []) this._onEvent(ev);

    // HUD
    const bases = {};
    for (const ent of this.ents.values()) {
      if (ent.kind === 'base') bases[ent.side] = { hp: ent.hp, max: ent.max };
    }
    this.hud.bases?.(bases, m.stats);
    this.hud.wave?.(m.wave, m.nextWave);
    this.hud.self?.(this.hp, this.maxHp, this._burstCdLeft());
    if (m.over) this.hud.over?.(m.winner, m.stats);
  }

  _spawnEnt(e) {
    const key = e.k === 'base' ? `base:${e.s}` : KIND_KEY[e.k];
    const { group, mixer } = makeUnit(key, e.s);
    const isSelf = this.side === e.s && (e.k === 'drone' || e.k === 'robot');
    if (isSelf) group.visible = false;
    this.scene.add(group);
    if (mixer) this.mixers.add(mixer);
    if (group.userData.spin) this.spinners.add(group);
    const ent = {
      id: e.id, kind: e.k, side: e.s, mesh: group, mixer,
      tgt: new THREE.Vector3(e.x, 0, -e.z), hp: e.hp, max: e.m,
      isSelf, hero: e.k === 'drone' || e.k === 'robot', heroY: 0, ry: 0,
      isStatic: e.k === 'tower' || e.k === 'base',
    };
    group.position.set(e.x, this.terrain.heightAt(e.x, -e.z), -e.z);
    this.ents.set(e.id, ent);
    return ent;
  }

  _removeEnt(id, ent) {
    this.scene.remove(ent.mesh);
    if (ent.mixer) this.mixers.delete(ent.mixer);
    this.spinners.delete(ent.mesh);
    this.ents.delete(id);
  }

  // 血條:受損單位頭上的雙色板
  _updateHpBar(ent) {
    if (ent.isSelf) return;
    const frac = Math.max(0, ent.hp / ent.max);
    if (frac >= 1 && !ent.bar) return;
    if (!ent.bar) {
      const w = ent.isStatic ? 18 : 5;
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.09),
        new THREE.MeshBasicMaterial({ color: 0x111417, transparent: true, opacity: 0.8, depthTest: false }));
      const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.09),
        new THREE.MeshBasicMaterial({ color: ent.side === 'SWARM' ? 0xffb300 : 0x4fc3f7, depthTest: false }));
      fg.position.z = 0.02;
      const grp = new THREE.Group();
      grp.add(bg); grp.add(fg);
      const box = new THREE.Box3().setFromObject(ent.mesh);
      grp.position.y = (box.max.y - box.min.y) + (ent.isStatic ? 6 : 2.2);
      grp.renderOrder = 999;
      ent.mesh.add(grp);
      ent.bar = grp; ent.barFg = fg; ent.barW = w;
    }
    ent.barFg.scale.x = Math.max(0.001, frac);
    ent.barFg.position.x = -(1 - frac) * ent.barW / 2;
  }

  _onEvent(ev) {
    if (ev.e === 'die') {
      const [x, z] = [ev.x, -ev.z];
      const big = ev.kind === 'tower' || ev.kind === 'base' || ev.kind === 'tank';
      this._explosion(x, this.terrain.heightAt(x, z) + 3, z, big ? 14 : 5, big ? 0xff8844 : 0xffcc66);
      if (ev.kind === 'drone' || ev.kind === 'robot') {
        this.hud.feed?.(`💥 ${SIDES[ev.side].name}的${UNITS[ev.kind].name}被擊毀!`);
      } else if (ev.kind === 'tower') {
        this.hud.feed?.(`🏗️ ${SIDES[ev.side].name}的防禦塔倒了!`);
      } else if (ev.kind === 'base') {
        this.hud.feed?.(`🏰 ${SIDES[ev.side].name}主堡被摧毀!`);
      }
    } else if (ev.e === 'boom') {
      const [x, z] = [ev.x, -ev.z];
      this._explosion(x, this.terrain.heightAt(x, z) + 2, z, ev.r * 0.8, 0xffaa33);
    } else if (ev.e === 'shot') {
      const [fx, fz] = [ev.from[0], -ev.from[1]];
      const [tx, tz] = [ev.to[0], -ev.to[1]];
      this._tracer(
        new THREE.Vector3(fx, this.terrain.heightAt(fx, fz) + 16, fz),
        new THREE.Vector3(tx, this.terrain.heightAt(tx, tz) + 3, tz),
        ev.side === 'SWARM' ? 0xffb300 : 0x4fc3f7,
      );
    } else if (ev.e === 'wave') {
      this.hud.feed?.(`⚔️ 第 ${ev.n} 波兵線出擊${ev.tank ? '(含坦克!)' : ''}`);
    } else if (ev.e === 'respawn') {
      if (this.side === ev.side) this.hud.feed?.('🔁 你已重生,守住防線!');
    }
  }

  onTracer(m) {
    this._tracer(
      new THREE.Vector3(m.from[0], m.from[1], m.from[2]),
      new THREE.Vector3(m.to[0], m.to[1], m.to[2]),
      m.side === 'SWARM' ? 0xffb300 : 0x4fc3f7,
    );
  }

  // ---------------- 自身死亡 / 重生 ----------------
  _onSelfDeath() {
    this.dead = true;
    this.firing = false;
    document.exitPointerLock?.();
  }
  _onSelfRespawn() {
    this.dead = false;
    this._spawnAt();
    this.vel.set(0, 0, 0);
  }

  /** 己方主堡往敵方方向 100m、面向敵方主堡 */
  _spawnAt() {
    const mySide = this.side || 'SWARM';
    const other = mySide === 'SWARM' ? 'STEEL' : 'SWARM';
    const [bx, bz] = llToWorld(this.cfg.bases[mySide][0], this.cfg.bases[mySide][1], this.center);
    const [ex, ez] = llToWorld(this.cfg.bases[other][0], this.cfg.bases[other][1], this.center);
    const dx = ex - bx, dz = ez - bz;
    const len = Math.hypot(dx, dz) || 1;
    const sx = bx + dx / len * 100, sz = bz + dz / len * 100;
    const gy = this.terrain.heightAt(sx, sz);
    this.pos.set(sx, gy + (this.isDrone ? 40 : 0), sz);
    this.yaw = Math.atan2(-dx, -dz);   // three:-z 前方
    this.pitch = -0.05;
  }

  // ---------------- 射擊 ----------------
  _tryFire(now) {
    if (!this.side || this.dead || !this.firing) return;
    const gun = UNITS[this.heroKind].gun;
    if (now - this.lastFire < 1 / gun.rate) return;
    this.lastFire = now;

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = gun.range;
    const targets = [];
    for (const ent of this.ents.values()) {
      if (ent.side !== this.side && ent.mesh.visible) targets.push(ent.mesh);
    }
    const hits = this.raycaster.intersectObjects([...targets, this.terrain.group], true);
    let hitPoint = null, hitEnt = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.kind && o.parent) o = o.parent;
      if (o && o.userData.kind) {
        hitEnt = [...this.ents.values()].find((en) => en.mesh === o);
        hitPoint = h.point;
        break;
      }
      hitPoint = h.point; // 地形
      break;
    }
    if (!hitPoint) {
      hitPoint = this.raycaster.ray.at(gun.range, new THREE.Vector3());
    }
    // 槍口:相機下前方
    const muzzle = this.camera.position.clone()
      .add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2))
      .add(new THREE.Vector3(0, -0.6, 0));
    this._tracer(muzzle, hitPoint, this.side === 'SWARM' ? 0xffd24a : 0x7fd8ff);
    this.net.send({ t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z], to: [hitPoint.x, hitPoint.y, hitPoint.z] });
    if (hitEnt) {
      this.net.send({ t: 'hit', id: hitEnt.id });
      this.hud.hitmark?.();
    }
  }

  _burstCdLeft() {
    if (!this.side) return 0;
    const cd = UNITS[this.heroKind].burst.cd;
    return Math.max(0, cd - (performance.now() / 1000 - this.lastBurst));
  }

  _fireBurst() {
    if (this.dead || this._burstCdLeft() > 0) return;
    this.lastBurst = performance.now() / 1000;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    if (this.isDrone) {
      // 空投炸彈:自由落體
      this.projectiles.push({
        pos: this.pos.clone().add(new THREE.Vector3(0, -1, 0)),
        vel: dir.clone().multiplyScalar(14).add(this.vel.clone().multiplyScalar(0.5)),
        grav: true,
        mesh: this._bombMesh(0x2b2f34),
      });
    } else {
      // 肩射火箭:直線
      this.projectiles.push({
        pos: this.camera.position.clone().add(dir.clone().multiplyScalar(3)),
        vel: dir.clone().multiplyScalar(95),
        grav: false,
        mesh: this._bombMesh(0x50585f),
      });
    }
  }

  _bombMesh(color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshStandardMaterial({ color, emissive: 0xff5522, emissiveIntensity: 0.4 }),
    );
    this.scene.add(m);
    return m;
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.grav) p.vel.y -= 25 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      const gy = this.terrain.heightAt(p.pos.x, p.pos.z);
      let boom = p.pos.y <= gy + 0.5;
      if (!boom) {
        for (const ent of this.ents.values()) {
          if (ent.side === this.side || !ent.mesh.visible) continue;
          if (p.pos.distanceTo(ent.mesh.position) < (ent.isStatic ? 10 : 4)) { boom = true; break; }
        }
      }
      if (boom || p.pos.y < gy - 50) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        const r = UNITS[this.heroKind].burst.r;
        this._explosion(p.pos.x, Math.max(p.pos.y, gy + 1), p.pos.z, r * 0.8, 0xffaa33);
        this.net.send({ t: 'burst', x: p.pos.x, z: -p.pos.z }); // three z 南 → 模擬 z 北
      }
    }
  }

  // ---------------- 特效 ----------------
  _tracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.effects.push({ obj: line, ttl: 0.1, fade: (o, f) => { o.material.opacity = 0.9 * f; } });
  }

  _explosion(x, y, z, r, color) {
    const n = 26;
    const pos = new Float32Array(n * 3);
    const vels = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
      const sp = r * (1.2 + Math.random() * 2.5);
      vels.push(new THREE.Vector3(Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp, Math.sin(ph) * Math.sin(th) * sp));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: Math.max(1.4, r * 0.22), transparent: true, opacity: 1 }));
    this.scene.add(pts);
    this.effects.push({
      obj: pts, ttl: 0.8, vels,
      fade: (o, f, dt) => {
        const p = o.geometry.attributes.position;
        for (let i = 0; i < n; i++) {
          p.array[i * 3] += vels[i].x * dt;
          p.array[i * 3 + 1] += vels[i].y * dt;
          p.array[i * 3 + 2] += vels[i].z * dt;
          vels[i].y -= 18 * dt;
        }
        p.needsUpdate = true;
        o.material.opacity = f;
      },
    });
  }

  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.ttl -= dt;
      e.age = (e.age || 0) + dt;
      const f = Math.max(0, e.ttl / (e.ttl + e.age));
      e.fade?.(e.obj, f, dt);
      if (e.ttl <= 0) {
        this.scene.remove(e.obj);
        this.effects.splice(i, 1);
      }
    }
  }

  // ---------------- 玩家移動 ----------------
  _updatePlayer(dt, now) {
    if (!this.side) { this._updateSpectator(dt); return; }
    if (this.dead) return;
    const u = UNITS[this.heroKind];
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const boost = this.keys.ShiftLeft || this.keys.ShiftRight ? 1.35 : 1;
    const move = new THREE.Vector3();
    if (this.keys.KeyW) move.add(fwd);
    if (this.keys.KeyS) move.sub(fwd);
    if (this.keys.KeyD) move.add(right);
    if (this.keys.KeyA) move.sub(right);
    if (move.lengthSq() > 0) move.normalize();

    if (this.isDrone) {
      const target = move.multiplyScalar(u.speed * boost);
      let vy = 0;
      if (this.keys.Space) vy = u.vspeed;
      if (this.keys.KeyC || this.keys.ControlLeft) vy = -u.vspeed;
      this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * 4);
      this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * 4);
      this.vel.y += (vy - this.vel.y) * Math.min(1, dt * 5);
      this.pos.addScaledVector(this.vel, dt);
      const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.pos.y = Math.max(gy + 2.5, Math.min(gy + 320, this.pos.y));
    } else {
      // 機甲:貼地 + 跳躍
      this.pos.addScaledVector(move, u.speed * boost * dt);
      const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.vy = this.vy ?? 0;
      const onGround = this.pos.y <= gy + 0.05;
      if (onGround && this.keys.Space) this.vy = u.jump;
      this.vy -= 24 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < gy) { this.pos.y = gy; this.vy = 0; }
    }

    // 邊界(地形範圍內縮 40m)
    this.pos.x = Math.max(this.terrain.minX + 40, Math.min(this.terrain.maxX - 40, this.pos.x));
    this.pos.z = Math.max(this.terrain.minZ + 40, Math.min(this.terrain.maxZ - 40, this.pos.z));

    const eye = this.isDrone ? 0 : 3.4;
    this.camera.position.copy(this.pos).add(new THREE.Vector3(0, eye, 0));
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    // 位置回報(10Hz;模擬 z=北)
    if (now - this.lastPosSend > 0.1) {
      this.lastPosSend = now;
      this.net.send({
        t: 'pos',
        x: Math.round(this.pos.x * 10) / 10,
        y: Math.round((this.pos.y - this.terrain.heightAt(this.pos.x, this.pos.z)) * 10) / 10,
        z: Math.round(-this.pos.z * 10) / 10,
        ry: Math.round(this.yaw * 100) / 100,
      });
    }
    this._tryFire(now);
  }

  _updateSpectator(dt) {
    // 觀戰:自由飛行
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const sp = 120 * (this.keys.ShiftLeft ? 3 : 1);
    if (this.keys.KeyW) this.pos.addScaledVector(fwd, sp * dt);
    if (this.keys.KeyS) this.pos.addScaledVector(fwd, -sp * dt);
    if (this.keys.KeyD) this.pos.addScaledVector(right, sp * dt);
    if (this.keys.KeyA) this.pos.addScaledVector(right, -sp * dt);
    if (this.keys.Space) this.pos.y += sp * dt;
    if (this.keys.KeyC) this.pos.y -= sp * dt;
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  // ---------------- 單位插值 ----------------
  _updateEnts(dt) {
    for (const ent of this.ents.values()) {
      if (ent.isSelf) { ent.mesh.position.copy(this.pos); continue; }
      if (ent.isStatic) {
        const y = this.terrain.heightAt(ent.tgt.x, ent.tgt.z);
        ent.mesh.position.set(ent.tgt.x, y, ent.tgt.z);
        continue;
      }
      const cur = ent.mesh.position;
      const k = Math.min(1, dt * 9);
      const nx = cur.x + (ent.tgt.x - cur.x) * k;
      const nz = cur.z + (ent.tgt.z - cur.z) * k;
      const gy = this.terrain.heightAt(nx, nz);
      const ny = ent.hero ? gy + ent.heroY : gy;
      // 朝向移動方向(英雄用伺服器回報的 ry)
      if (ent.hero) {
        ent.mesh.rotation.y = ent.ry;
      } else {
        const dx = ent.tgt.x - cur.x, dz = ent.tgt.z - cur.z;
        if (dx * dx + dz * dz > 0.5) ent.mesh.rotation.y = Math.atan2(dx, dz);
      }
      cur.set(nx, ny, nz);
      // 血條面向相機
      if (ent.bar) ent.bar.lookAt(this.camera.position);
    }
  }

  // ---------------- 2D 戰術地圖 ----------------
  _initMinimap() {
    this.mmCtx = this.minimapCanvas.getContext('2d');
    this._mmLast = 0;
  }

  _world2mm(x, z, w, h) {
    const fx = (x - this.terrain.minX) / (this.terrain.maxX - this.terrain.minX);
    const fz = (z - this.terrain.minZ) / (this.terrain.maxZ - this.terrain.minZ);
    return [fx * w, fz * h];
  }

  _drawMinimap(now) {
    if (now - this._mmLast < 0.2) return;
    this._mmLast = now;
    const ctx = this.mmCtx;
    const w = this.minimapCanvas.width, h = this.minimapCanvas.height;
    ctx.fillStyle = 'rgba(8,12,16,0.92)';
    ctx.fillRect(0, 0, w, h);
    // 兵線
    const cols = ['#e6c34a', '#e05c4a', '#4ac3e6'];
    this.lanePts.forEach((pts, i) => {
      ctx.strokeStyle = cols[i];
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      pts.forEach((p, k) => {
        const [mx, my] = this._world2mm(p.x, p.z, w, h);
        k === 0 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
      });
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // 單位
    for (const ent of this.ents.values()) {
      const [mx, my] = this._world2mm(ent.mesh.position.x, ent.mesh.position.z, w, h);
      const c = ent.side === 'SWARM' ? '#ffb300' : '#4fc3f7';
      ctx.fillStyle = c;
      if (ent.kind === 'base') {
        ctx.fillRect(mx - 5, my - 5, 10, 10);
        ctx.strokeStyle = c; ctx.strokeRect(mx - 7, my - 7, 14, 14);
      } else if (ent.kind === 'tower') {
        ctx.fillRect(mx - 3, my - 3, 6, 6);
      } else if (ent.hero) {
        if (!ent.isSelf) {
          ctx.beginPath(); ctx.arc(mx, my, 4, 0, 7); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      } else {
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }
    // 自己(視角箭頭)
    if (this.side) {
      const [mx, my] = this._world2mm(this.pos.x, this.pos.z, w, h);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(-this.yaw + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---------------- 主迴圈 ----------------
  _loop() {
    if (this.disposed) return;
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.1, this.clock.getDelta());
    const now = performance.now() / 1000;

    if (this._snapQueue) { this._applySnap(this._snapQueue); this._snapQueue = null; }

    this._updatePlayer(dt, now);
    this._updateEnts(dt);
    this._updateProjectiles(dt);
    this._updateEffects(dt);
    for (const m of this.mixers) m.update(dt);
    for (const g of this.spinners) {
      for (const p of g.userData.spin) p.rotation.y += dt * 40;
    }
    this._drawMinimap(now);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('keyup', this._onKey);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('contextmenu', this._onCtx);
    document.exitPointerLock?.();
    this.renderer.dispose();
  }
}
