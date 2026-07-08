// ============ 戰鬥客戶端:第一人稱 無人機 vs 機甲 + DOTA 兵線 ============
// 伺服器權威(HP/傷害/波次),客戶端負責:
//  - 3D 渲染(地形 + 單位 + 特效)
//  - 第一人稱操控(蜂群=飛行無人機、鋼鐵=地面機甲)
//  - 射擊 raycast 命中回報、範圍技落點回報
//  - 2D 戰術地圖(minimap,繼承 mapping_elf 的 2D 地圖概念)
import * as THREE from 'three';
import { SIDES, UNITS, GAME, WEAPONS, ECON, HAZARDS, vsMult } from './data.js';
import { llToWorld } from './terrain.js';
import { makeUnit } from './models.js';
import { applyEnvironment } from './environment.js';
import { buildHazard, buildMineBump, buildLoot } from './hazards.js';
import { toonMat, outlinify, updateCelLight } from './toon.js';
import { comicPop, starburst, shockRing, damageNumber, debrisBurst, makeShield } from './vfx.js';

const KIND_KEY = {
  soldier: 'creep:soldier', apc: 'creep:apc', tank: 'creep:tank',
  rocketeer: 'creep:rocketeer', howitzer: 'creep:howitzer', heli: 'creep:heli',
  tower: 'tower', drone: 'hero:drone', robot: 'hero:robot',
};
const LANE_COLORS = [0xe6c34a, 0xe05c4a, 0x4ac3e6];

export class BattleClient {
  /**
   * opts: { canvas, minimapCanvas, cfg, side(可 null=觀戰), youId, net, terrain, hud }
   * youId:自己的連線 id;快照裡英雄帶 pid,用來認出自己的座機(同陣營可多人)。
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
    this.shields = new Set();        // 塔/主堡能量護盾(hex shader,受擊閃亮)
    this.disposed = false;
    this._snapQueue = null;
    // 物理:後座力(視角踢)、鏡頭震動(trauma)、FPV 側傾
    this.recoil = { p: 0, y: 0 };
    this.trauma = 0;
    this.roll = 0;
    this.weaponKick = 0;
    this.samMeshes = new Map();      // 防空飛彈(伺服器權威,快照 sm 同步)
    this.lootMeshes = new Map();     // 戰場物資(快照 lt 同步)
    this.mineMeshes = new Map();     // 地雷微凸起(field 訊息一次同步)
    this.flamers = new Set();        // 火場(火舌閃爍動畫)
    this.floods = [];                // 淹水區(機甲減速判定)
    this._mineCheckAt = 0;
    this._floodWarnAt = 0;

    this.isDrone = this.side && SIDES[this.side].hero === 'drone';
    this.heroKind = this.side ? SIDES[this.side].hero : null;

    // 武器狀態(彈夾/填彈本地模擬,伺服器另行把關;快照 it 同步已購武器)
    this.loadout = this.heroKind ? [...UNITS[this.heroKind].loadout] : [];
    this.wi = 0;                      // 目前武器索引(1/2/3 切換)
    this.wstate = {};                 // id -> { ammo, reloadEnd }
    for (const id of this.loadout) this.wstate[id] = { ammo: WEAPONS[id].mag, reloadEnd: 0 };
    if (this.heroKind === 'robot') {  // 右鍵肩射火箭也有彈數
      const r = WEAPONS[UNITS.robot.burst];
      this.wstate.rocket = { ammo: r.mag, reloadEnd: 0 };
    }
    this.money = 0;
    this.items = [];
    this.upg = { dmg: 0, hull: 0 };
    this.shopOpen = false;
    this._crashSent = false;          // 撞擊引爆去重
    this.aiming = false;              // 按住右鍵瞄準(拉近視角、解鎖熱兵器)

    this._initScene();
    this._initLanes();
    this._initInput();
    this._initMinimap();
    this._buildCockpit();

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
    const span = Math.max(this.terrain.worldW, this.terrain.worldH);
    // 無人機視野廣(fov 100),機甲座艙視野窄(fov 72)
    const fov = this.heroKind ? UNITS[this.heroKind].fov : 72;
    this.baseFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, this.canvas.clientWidth / this.canvas.clientHeight, 0.5, span * 2);

    // 季節/日夜/天氣(開房時定案,全房一致)
    this.envFx = applyEnvironment(this.scene, this.terrain, this.cfg.env);

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

  // ---------------- FPV 座艙(駕駛情境:看得到自己的武器與部分機身)----------------
  _buildCockpit() {
    if (!this.side) return;
    this.scene.add(this.camera);   // 相機要在場景樹裡,座艙子物件才會渲染
    const mk = (geo, color, opts = {}) => {
      // 座艙同樣走賽璐璐;高金屬度 → 漫畫硬邊高光帶
      const { metalness, roughness, ...rest } = opts;
      return new THREE.Mesh(geo, toonMat(color, { ...rest, celMetal: (metalness ?? 0) >= 0.5 }));
    };
    const accent = new THREE.Color(SIDES[this.side].color);
    const g = new THREE.Group();
    this.cockpitSpin = [];
    this.gunGroup = new THREE.Group();

    if (this.isDrone) {
      // 四旋翼 FPV:前二臂 + 旋翼在畫面上緣、機砲吊艙在下緣
      // (賽璐璐:座艙用中灰藍軍武色,暗部才不會塌成純黑剪影)
      const nose = mk(new THREE.BoxGeometry(0.5, 0.16, 0.5), 0x4b545e);
      nose.position.set(0, -0.42, -0.78);
      g.add(nose);
      for (const sx of [-1, 1]) {
        const arm = mk(new THREE.BoxGeometry(0.75, 0.05, 0.08), 0x5b6772);
        arm.position.set(sx * 0.48, 0.30, -0.72);
        arm.rotation.y = sx * -0.6;
        g.add(arm);
        const hub = mk(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 8), 0x39414a);
        hub.position.set(sx * 0.72, 0.33, -0.92);
        g.add(hub);
        const prop = mk(new THREE.BoxGeometry(0.62, 0.015, 0.055), 0x9aa4ad, { transparent: true, opacity: 0.55 });
        prop.position.set(sx * 0.72, 0.38, -0.92);
        g.add(prop);
        this.cockpitSpin.push(prop);
      }
      const pod = mk(new THREE.BoxGeometry(0.16, 0.14, 0.4), 0x3d454e);
      pod.position.set(0.2, -0.34, -0.7);
      this.gunGroup.add(pod);
      const barrel = mk(new THREE.CylinderGeometry(0.03, 0.035, 0.75, 8), 0x30373f, { metalness: 0.85 });
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0.2, -0.32, -1.15);
      this.gunGroup.add(barrel);
      this._muzzle = new THREE.Vector3(0.2, -0.32, -1.55);
    } else {
      // 機甲駕駛艙:座艙框 + 儀表台 + 右側重機槍 + 左肩護甲(中灰藍,避免暗部全黑)
      const dash = mk(new THREE.BoxGeometry(1.7, 0.28, 0.5), 0x46505b);
      dash.position.set(0, -0.52, -0.85);
      dash.rotation.x = 0.5;
      g.add(dash);
      const topStrut = mk(new THREE.BoxGeometry(1.6, 0.1, 0.3), 0x4d5865);
      topStrut.position.set(0, 0.52, -0.8);
      g.add(topStrut);
      for (const sx of [-1, 1]) {
        const pillar = mk(new THREE.BoxGeometry(0.09, 1.15, 0.2), 0x4d5865);
        pillar.position.set(sx * 0.78, 0, -0.78);
        pillar.rotation.z = sx * -0.12;
        g.add(pillar);
      }
      const light = mk(new THREE.BoxGeometry(0.5, 0.04, 0.05), accent, { emissive: accent, emissiveIntensity: 0.9 });
      light.position.set(0, -0.4, -0.72);
      g.add(light);
      const shoulder = mk(new THREE.BoxGeometry(0.5, 0.28, 0.7), 0x5a6673);
      shoulder.position.set(-0.72, -0.34, -1.0);
      shoulder.rotation.z = 0.28;
      g.add(shoulder);
      const recv = mk(new THREE.BoxGeometry(0.24, 0.26, 0.85), 0x3c444d);
      recv.position.set(0.5, -0.36, -1.0);
      this.gunGroup.add(recv);
      const barrel = mk(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 10), 0x30373f, { metalness: 0.85 });
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0.5, -0.32, -1.85);
      this.gunGroup.add(barrel);
      const brake = mk(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 10), 0x272c31);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(0.5, -0.32, -2.35);
      this.gunGroup.add(brake);
      this._muzzle = new THREE.Vector3(0.5, -0.32, -2.45);
    }
    // 槍口焰(開火瞬間顯示)
    this.flash = mk(new THREE.SphereGeometry(0.09, 6, 5), 0xffd27a,
      { emissive: 0xffb347, emissiveIntensity: 3, transparent: true, opacity: 0.95 });
    this.flash.position.copy(this._muzzle);
    this.flash.visible = false;
    this.gunGroup.add(this.flash);
    this._gunBaseZ = this.gunGroup.position.z;

    g.add(this.gunGroup);
    outlinify(g, 0.012);   // 座艙近距離,細描邊即可(≈2px)
    this.cockpit = g;
    this.camera.add(g);
  }

  // ---------------- 物理:爆炸衝擊 / 碰撞 ----------------
  /** 爆炸衝擊波:把自己(座機)往外推 + 鏡頭震動,強度隨距離衰減 */
  _applyBlast(x, y, z, r) {
    if (!this.side || this.dead) return;
    const eye = this.camera.position;
    const d = Math.hypot(eye.x - x, eye.y - y, eye.z - z);
    const R = Math.max(20, r * 3);
    if (d > R) return;
    const k = 1 - d / R;
    const dir = new THREE.Vector3(eye.x - x, eye.y - y, eye.z - z);
    if (dir.lengthSq() < 0.01) dir.set(0, 1, 0);
    dir.normalize();
    const power = k * (this.isDrone ? 55 : 26);
    this.vel.addScaledVector(dir, power);
    if (!this.isDrone) this.vy = (this.vy ?? 0) + k * 10;   // 機甲被掀離地
    this.trauma = Math.min(1, this.trauma + k * 0.8);
  }

  // 單位碰撞半徑 / 高度(公尺):玩家座機不能穿過單位與建築
  static COLLIDER = {
    base: { r: 20, h: 46 }, tower: { r: 7, h: 26 },
    tank: { r: 4.2, h: 5.5 }, apc: { r: 3.4, h: 5 }, soldier: { r: 1.0, h: 3.2 },
    drone: { r: 2.4, h: 3.5 }, robot: { r: 2.6, h: 6.5 },
  };

  /** 玩家 vs 單位/建築:水平圓柱推擠(考慮飛行高度,飛過塔頂不碰撞) */
  _collide() {
    const myR = this.isDrone ? 1.6 : 1.9;
    const myBot = this.pos.y - (this.isDrone ? 0.8 : 0);
    const myTop = this.pos.y + (this.isDrone ? 1.2 : 4.2);
    for (const ent of this.ents.values()) {
      if (ent.isSelf || !ent.mesh.visible) continue;
      let c = BattleClient.COLLIDER[ent.kind];
      if (!c && ent.colR) c = { r: ent.colR, h: ent.colH || 6 };   // 阻擋型障礙物
      if (!c) continue;
      const p = ent.mesh.position;
      if (myBot > p.y + c.h || myTop < p.y) continue;     // 垂直不重疊
      const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = myR + c.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d, nz = dz / d;
      const push = min - d;
      this.pos.x += nx * push;
      this.pos.z += nz * push;
      // 吃掉衝向障礙物的速度分量(不回彈)
      const into = this.vel.x * nx + this.vel.z * nz;
      if (into < 0) {
        // 飛行單位高速撞擊 → 重型炸彈引爆(FPV 神風)
        if (this.isDrone && -into > 16) this._detonate();
        this.vel.x -= into * nx; this.vel.z -= into * nz;
      }
    }
  }

  // ---------------- 輸入 ----------------
  _initInput() {
    this._onKey = (e) => {
      if (e.type === 'keydown' && e.code === 'KeyM') this.minimapBig = !this.minimapBig;
      if (e.type === 'keydown' && this.side && !this.dead) {
        // 1/2/3 切換武器(自帶 + 已購)
        const n = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
        if (n != null && n < this.loadout.length && n !== this.wi) {
          this.wi = n;
          this.hud.feed?.(`🔫 切換:${WEAPONS[this.loadout[n]].name}`);
        }
        if (e.code === 'KeyR') this._startReload();
        if (e.code === 'KeyB') this._toggleShop();
        if (e.code === 'KeyF' && this.isDrone) this._detonate();   // 無人機自爆(右鍵已改為瞄準)
        if (e.code === 'Escape' && this.shopOpen) this._toggleShop(false);
      }
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
      if (!this.side || this.shopOpen) return;
      if (document.pointerLockElement !== this.canvas) { this.canvas.requestPointerLock(); return; }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) {
        // 右鍵雙功能:彈藥空了 → 換彈夾;有彈時 → 按住瞄準(拉近視角、解鎖熱兵器)
        const { id, st } = this._curWeapon();
        if (st && st.ammo <= 0 && st.reloadEnd <= 0) {
          this._rmbReloaded = true;
          this._startReload(id);
        } else {
          this._rmbReloaded = false;
          this._setAiming(true);
        }
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) { if (!this._rmbReloaded) this._setAiming(false); this._rmbReloaded = false; }
    };
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
      // 護盾受擊回饋:hp 下降的那個快照閃亮 + 波紋
      if (ent.shield && e.hp < ent.hp) ent.shield.userData.hit();
      ent.hp = e.hp; ent.max = e.m;
      ent.tgt.set(e.x, 0, -e.z);           // 模擬 z=北 → three z=南
      if (e.k === 'heli') ent.heroY = e.y ?? 0;   // 攻擊直升機巡航高度(共用英雄的高度渲染欄位)
      if (e.k === 'drone' || e.k === 'robot') {
        ent.heroY = e.y ?? 0;
        ent.ry = e.ry ?? 0;
        const wasDead = ent.dead;
        ent.dead = !!e.dead;
        if (wasDead && !e.dead && !ent.isSelf) ent._snapPos = true;
        ent.mesh.visible = !e.dead && !ent.isSelf;
        if (ent.isSelf) {
          this.hp = e.hp; this.maxHp = e.m;
          this.money = e.$ ?? this.money;
          this.upg = e.up || this.upg;
          // 已購武器同步進 loadout(伺服器權威)
          for (const id of e.it || []) {
            if (!this.loadout.includes(id)) {
              this.loadout.push(id);
              this.wstate[id] = { ammo: WEAPONS[id].mag, reloadEnd: 0 };
              this.hud.feed?.(`🛒 已購入 ${WEAPONS[id].name}(按 ${this.loadout.length} 使用)`);
            }
          }
          this.items = e.it || this.items;
          if (e.dead && !this.dead) this._onSelfDeath();
          if (!e.dead && this.dead) this._onSelfRespawn();
          this.hud.dead?.(e.dead ? e.rs : null);
          if (this.shopOpen) this.hud.shop?.(true, this._shopState());
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
    // 防空飛彈(伺服器權威 3D 追蹤)
    this._syncMissiles(m.sm || []);
    // 戰場物資(擊毀障礙物掉落,靠近拾取)
    this._syncLoot(m.lt || []);

    // HUD
    const bases = {};
    for (const ent of this.ents.values()) {
      if (ent.kind === 'base') bases[ent.side] = { hp: ent.hp, max: ent.max };
    }
    this.hud.bases?.(bases, m.stats);
    this.hud.wave?.(m.wave, m.nextWave);
    this.hud.self?.(this.hp, this.maxHp, this._burstCdLeft(), this._weaponHud());
    if (m.over) this.hud.over?.(m.winner, m.stats);
  }

  _spawnEnt(e) {
    // 中立危險區實體(障礙物 / 防空陣地):程序生成低多邊形,不吃 makeUnit
    const hazDef = HAZARDS[e.k];
    if (hazDef || e.k === 'aasite') {
      const r = (hazDef?.r ?? 6) * (e.sc || 1);
      const group = buildHazard(e.k, e.id, r);
      this.scene.add(group);
      const ent = {
        id: e.id, kind: e.k, side: null, mesh: group,
        tgt: new THREE.Vector3(e.x, 0, -e.z), hp: e.hp, max: e.m,
        neutral: true, isStatic: true, hero: false,
        // 阻擋型障礙:限制行動但不完全封鎖(縫隙由伺服器佈局保證,無人機可飛越)
        colR: hazDef?.block ? r : (e.k === 'aasite' ? 3.2 : 0),
        colH: e.k === 'aasite' ? 3.5 : 6,
      };
      group.position.set(e.x, this.terrain.heightAt(e.x, -e.z), -e.z);
      if (group.userData.flames) this.flamers.add(group);
      if (e.k === 'flood') this.floods.push({ x: e.x, z: -e.z, r, slow: hazDef.slow });
      this.ents.set(e.id, ent);
      return ent;
    }
    const key = e.k === 'base' ? `base:${e.s}` : KIND_KEY[e.k];
    const { group, mixer } = makeUnit(key, e.s);
    const hero = e.k === 'drone' || e.k === 'robot';
    const isSelf = hero && e.pid != null && e.pid === this.youId;
    if (isSelf) group.visible = false;
    this.scene.add(group);
    if (mixer) this.mixers.add(mixer);
    if (group.userData.spin) this.spinners.add(group);
    const ent = {
      id: e.id, kind: e.k, side: e.s, mesh: group, mixer,
      tgt: new THREE.Vector3(e.x, 0, -e.z), hp: e.hp, max: e.m,
      isSelf, hero, heroY: 0, ry: 0, flies: e.k === 'heli',
      isStatic: e.k === 'tower' || e.k === 'base',
    };
    // 防禦塔 / 主堡:動漫能量護盾(平時近透明,受擊亮起 hex 格紋)
    if (e.k === 'tower' || e.k === 'base') {
      const shield = makeShield(e.k === 'base' ? 30 : 11, SIDES[e.s].color, e.k === 'base' ? 1.5 : 2.3);
      group.add(shield);
      ent.shield = shield;
      this.shields.add(shield);
    }
    group.position.set(e.x, this.terrain.heightAt(e.x, -e.z), -e.z);
    this.ents.set(e.id, ent);
    return ent;
  }

  _removeEnt(id, ent) {
    this.scene.remove(ent.mesh);
    if (ent.mixer) this.mixers.delete(ent.mixer);
    if (ent.shield) this.shields.delete(ent.shield);
    this.spinners.delete(ent.mesh);
    this.flamers.delete(ent.mesh);
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
        new THREE.MeshBasicMaterial({
          color: ent.neutral ? 0xb8bfc4 : ent.side === 'SWARM' ? 0xffb300 : 0x4fc3f7,
          depthTest: false,
        }));
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

  /** 快照裡的飛彈同步:建/移/更新目標點(渲染時再插值) */
  _syncMissiles(sm) {
    const seen = new Set();
    for (const s of sm) {
      seen.add(s.id);
      let ms = this.samMeshes.get(s.id);
      if (!ms) {
        const mesh = new THREE.Mesh(
          new THREE.ConeGeometry(0.35, 2.2, 6),
          toonMat(0xd8dde2, { emissive: 0xff6633, emissiveIntensity: 0.7, celMetal: true }),
        );
        outlinify(mesh, 0.05);
        this.scene.add(mesh);
        ms = { mesh, tgt: new THREE.Vector3(), prev: new THREE.Vector3() };
        const y0 = this.terrain.heightAt(s.x, -s.z) + s.y;
        mesh.position.set(s.x, y0, -s.z);
        ms.tgt.copy(mesh.position);
        this.samMeshes.set(s.id, ms);
      }
      ms.prev.copy(ms.tgt);
      // 飛彈 y 是離地高度(以目標地面為準做近似)
      ms.tgt.set(s.x, this.terrain.heightAt(s.x, -s.z) + s.y, -s.z);
    }
    for (const [id, ms] of this.samMeshes) {
      if (!seen.has(id)) { this.scene.remove(ms.mesh); this.samMeshes.delete(id); }
    }
  }

  // ---------------- 危險區:地雷 / 物資 / 火場 / 淹水 ----------------
  /** 開戰時伺服器發一次的靜態危險區資料(地雷位置;雙方都要用眼睛掃雷) */
  onField(m) {
    for (const mesh of this.mineMeshes.values()) this.scene.remove(mesh);
    this.mineMeshes.clear();
    for (const [x, z, id] of m.mines || []) {
      const wz = -z;   // 模擬 z=北 → three z=南
      const bump = buildMineBump(this.terrain.sampleColor?.(x, wz));
      bump.position.set(x, this.terrain.heightAt(x, wz) + 0.05, wz);
      this.scene.add(bump);
      this.mineMeshes.set(id, bump);
    }
  }

  /** 地雷突起:靠近才浮現(SEE_M 內漸顯、CLEAR_M 內全顯);節流 8Hz */
  _updateMines(now) {
    if (now - this._mineCheckAt < 0.12) return;
    this._mineCheckAt = now;
    const M = GAME.MINES;
    const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    for (const bump of this.mineMeshes.values()) {
      const p = bump.position;
      const d = Math.hypot(px - p.x, py - p.y, pz - p.z);
      if (d > M.SEE_M) { bump.visible = false; continue; }
      bump.visible = true;
      bump.material.opacity = Math.min(1, (M.SEE_M - d) / Math.max(1, M.SEE_M - M.CLEAR_M));
    }
  }

  _syncLoot(lt) {
    const seen = new Set();
    for (const l of lt) {
      seen.add(l.id);
      if (this.lootMeshes.has(l.id)) continue;
      const g = buildLoot(!!l.a);
      g.position.set(l.x, this.terrain.heightAt(l.x, -l.z), -l.z);
      this.scene.add(g);
      this.lootMeshes.set(l.id, g);
    }
    for (const [id, g] of this.lootMeshes) {
      if (!seen.has(id)) { this.scene.remove(g); this.lootMeshes.delete(id); }
    }
  }

  _updateLoot(dt, now) {
    for (const g of this.lootMeshes.values()) {
      g.rotation.y += dt * 1.6;
      g.children[0].position.y = 1.0 + Math.sin(now * 2.2 + g.position.x) * 0.18;
    }
    // 火場火舌閃爍
    for (const grp of this.flamers) {
      for (const f of grp.userData.flames) {
        const k = 0.75 + 0.35 * Math.sin(now * 9 + f.userData.ph) + 0.12 * Math.sin(now * 23 + f.userData.ph * 2);
        f.scale.set(1, k, 1);
        f.position.y = f.userData.h0 * k / 2;
      }
    }
  }

  /** 淹水區:機甲深水行進大幅減速(限制但不封鎖) */
  _zoneSlow() {
    if (this.isDrone) return 1;
    for (const f of this.floods) {
      if (Math.hypot(this.pos.x - f.x, this.pos.z - f.z) <= f.r) {
        const now = performance.now() / 1000;
        if (now - this._floodWarnAt > 8) {
          this._floodWarnAt = now;
          this.hud.feed?.('🌊 淹水區:機甲涉水速度大減!');
        }
        return f.slow;
      }
    }
    return 1;
  }

  _updateMissiles(dt) {
    for (const ms of this.samMeshes.values()) {
      const p = ms.mesh.position;
      p.lerp(ms.tgt, Math.min(1, dt * 10));
      // 朝飛行方向 + 煙尾
      const dir = ms.tgt.clone().sub(ms.prev);
      if (dir.lengthSq() > 0.5) {
        ms.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      ms.smoke = (ms.smoke || 0) + dt;
      if (ms.smoke > 0.06) {
        ms.smoke = 0;
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 5, 4),
          new THREE.MeshBasicMaterial({ color: 0xcfd6da, transparent: true, opacity: 0.5 }),
        );
        puff.position.copy(p);
        this.scene.add(puff);
        this.effects.push({ obj: puff, ttl: 0.7, fade: (o, f) => { o.material.opacity = 0.5 * f; o.scale.setScalar(1 + (1 - f) * 3); } });
      }
    }
  }

  _onEvent(ev) {
    if (ev.e === 'die') {
      const [x, z] = [ev.x, -ev.z];
      const big = ev.kind === 'tower' || ev.kind === 'base' || ev.kind === 'tank' || ev.kind === 'howitzer' || ev.kind === 'heli';
      const hero = ev.kind === 'drone' || ev.kind === 'robot';
      const ey = this.terrain.heightAt(x, z) + 3;
      this._explosion(x, ey, z, big ? 14 : 5, big ? 0xff8844 : 0xffcc66);
      this._applyBlast(x, ey, z, big ? 16 : 6);   // 近距離看拆塔/坦克殉爆會被衝擊波推開
      // 漫畫式破壞回饋:機械碎片噴散 + BOOM 字卡 + hitstop(頓點強調重量感)
      debrisBurst(this.scene, this.effects, x, ey + (big ? 6 : 1), z,
        { big, accent: ev.side ? SIDES[ev.side].color : 0xd8b04a });
      if (big || hero) {
        comicPop(this.scene, this.effects, x, ey + (ev.kind === 'base' ? 30 : ev.kind === 'tower' ? 20 : 8), z,
          { big: true, hue: hero ? 2 : 18 });
        this._hitstop = Math.max(this._hitstop || 0,
          ev.kind === 'base' ? 0.12 : ev.kind === 'tower' ? 0.08 : 0.05);
      }
      if (ev.kind === 'aasite') {
        this.hud.feed?.('🎯 匿蹤防空陣地被摧毀,該片空域安全了!');
      } else if (HAZARDS[ev.kind]) {
        this.hud.feed?.(`🧹 ${HAZARDS[ev.kind].name}被清除,通道打開了!`);
      } else if (ev.kind === 'drone' || ev.kind === 'robot') {
        this.hud.feed?.(`💥 ${SIDES[ev.side].name}的${UNITS[ev.kind].name}被擊毀!`);
      } else if (ev.kind === 'tower') {
        this.hud.feed?.(`🏗️ ${SIDES[ev.side].name}的防禦塔倒了!`);
      } else if (ev.kind === 'base') {
        this.hud.feed?.(`🏰 ${SIDES[ev.side].name}主堡被摧毀!`);
      }
    } else if (ev.e === 'boom') {
      const [x, z] = [ev.x, -ev.z];
      const y = this.terrain.heightAt(x, z) + (ev.y != null ? ev.y : 2);   // 防空飛彈在空中炸
      this._explosion(x, y, z, ev.r * 0.8, ev.sam ? 0xff7744 : 0xffaa33);
      // AoE:放射衝擊環擴張到傷害半徑邊界(貼地),空中炸點只留星爆
      if ((ev.y ?? 0) < 12) shockRing(this.scene, this.effects, x, this.terrain.heightAt(x, z), z, ev.r, 0xffd27a);
      this._applyBlast(x, y, z, ev.r);
      if (ev.mine && ev.tpid === this.youId) this.hud.feed?.('💣 你踩到地雷了!非正規路線佈有雷區!');
      if (ev.mid != null) {   // 觸發的地雷:移除微凸起
        const bump = this.mineMeshes.get(ev.mid);
        if (bump) { this.scene.remove(bump); this.mineMeshes.delete(ev.mid); }
      }
    } else if (ev.e === 'burn') {
      if (ev.pid === this.youId) {
        this.trauma = Math.min(1, this.trauma + 0.25);
        this.hud.feed?.('🔥 你在火場中持續受創,快離開!');
      }
    } else if (ev.e === 'loot') {
      if (ev.pid === this.youId) {
        if (ev.ammo) {
          // 稀有掉落:全武器彈藥即刻補滿(本地 HUD 同步)
          for (const [id, st] of Object.entries(this.wstate)) { st.ammo = WEAPONS[id].mag; st.reloadEnd = 0; }
          this.hud.feed?.('🔋 拾獲彈藥補給:全武器裝滿!');
        } else {
          this.hud.feed?.(`💰 拾獲戰場物資 +$${ev.v}`);
        }
      }
    } else if (ev.e === 'sam') {
      if (ev.tpid === this.youId) {
        this.hud.feed?.(ev.ambush
          ? '🚨 匿蹤防空陣地開火!命中即墜毀,快擊落飛彈或回兵線走廊!'
          : '🚨 防空飛彈鎖定你了,快規避!');
      }
    } else if (ev.e === 'buy') {
      if (ev.pid === this.youId && ev.lvl != null) {
        this.hud.feed?.(`⬆️ ${ECON.UPGRADES[ev.item]?.name || ev.item} Lv.${ev.lvl}`);
      }
    } else if (ev.e === 'shot') {
      const [fx, fz] = [ev.from[0], -ev.from[1]];
      const [tx, tz] = [ev.to[0], -ev.to[1]];
      this._tracer(
        new THREE.Vector3(fx, this.terrain.heightAt(fx, fz) + 16, fz),
        new THREE.Vector3(tx, this.terrain.heightAt(tx, tz) + 3, tz),
        ev.side === 'SWARM' ? 0xffb300 : 0x4fc3f7,
      );
    } else if (ev.e === 'wave') {
      this.hud.feed?.(`⚔️ 第 ${ev.n} 波兵線出擊(含攻擊直升機)`);
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
    this.aiming = false;
    if (this.shopOpen) { this.shopOpen = false; this.hud.shop?.(false, null); }
    document.exitPointerLock?.();
  }
  _onSelfRespawn() {
    this.dead = false;
    this._spawnAt();
    this.vel.set(0, 0, 0);
    // 重生滿彈
    for (const [id, st] of Object.entries(this.wstate)) { st.ammo = WEAPONS[id].mag; st.reloadEnd = 0; }
    this._crashSent = false;
  }

  // ---------------- 主堡軍械庫(B 鍵)----------------
  _atBase() {
    if (!this.side) return false;
    const [bx, bz] = llToWorld(this.cfg.bases[this.side][0], this.cfg.bases[this.side][1], this.center);
    return Math.hypot(this.pos.x - bx, this.pos.z - bz) <= GAME.HERO_HEAL_RADIUS;
  }

  _shopState() {
    return {
      money: this.money, items: this.items, upg: this.upg,
      kind: this.heroKind, slots: UNITS[this.heroKind].slots, atBase: this._atBase(),
      buy: (item) => this.net.send({ t: 'buy', item }),
    };
  }

  _toggleShop(force) {
    if (!this.side || this.dead) return;
    const want = force != null ? force : !this.shopOpen;
    if (want === this.shopOpen) return;
    this.shopOpen = want;
    this.firing = false;
    this.hud.shop?.(want, want ? this._shopState() : null);
    if (want) document.exitPointerLock?.();
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

  // ---------------- 射擊(彈夾/填彈)----------------
  /** 目前主武器 id 與狀態 */
  _curWeapon() {
    const id = this.loadout[this.wi] || this.loadout[0];
    return { id, def: WEAPONS[id], st: this.wstate[id] };
  }

  /** 填彈:R 鍵手動 / 打空自動;填彈完成在 _tickWeapons 補滿 */
  _startReload(id) {
    const wid = id || this._curWeapon().id;
    const def = WEAPONS[wid], st = this.wstate[wid];
    if (!st || st.reloadEnd > 0 || st.ammo >= def.mag) return;
    st.ammo = 0;
    st.reloadEnd = performance.now() / 1000 + def.reload;
    if (this.net) this.net.send({ t: 'reload', w: wid });
    this.hud.feed?.(`🔄 ${def.name} 填彈中…`);
  }

  /**
   * 換彈夾動作(疊加在 gunGroup 上,無獨立手臂模型,用現有槍身/槍管代理呈現):
   * p 為填彈進度 0→1,依武器機構分類給不同動作曲線。
   */
  _reloadAnimOffset(id, p) {
    const swing = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI); // 0→1→0,填彈完歸零
    if (id === 'railgun') return { dz: swing * 0.4, dy: 0, rx: 0 };            // 磁軌砲:整管後拉再歸位
    if (id === 'siege') return { dz: 0, dy: 0, rx: -swing * 0.5 };             // 攻城砲:槍口上掀開膛裝填
    if (id === 'flak') {                                                       // 防空霰彈:逐發上膛頓挫感
      const bump = Math.abs(Math.sin(p * Math.PI * 5)) * (1 - p);
      return { dz: bump * 0.16, dy: -bump * 0.05, rx: 0 };
    }
    return { dz: 0, dy: -swing * 0.22, rx: swing * 0.12 };                     // dgun/rgun/ripper:彈匣下沉退彈匣再扣回
  }

  _tickWeapons(now) {
    for (const [id, st] of Object.entries(this.wstate)) {
      if (st.reloadEnd > 0 && now >= st.reloadEnd) {
        st.ammo = WEAPONS[id].mag;
        st.reloadEnd = 0;
      }
    }
  }

  _tryFire(now) {
    if (!this.side || this.dead || !this.firing || this.shopOpen) return;
    const { id, def, st } = this._curWeapon();
    if (now - this.lastFire < 1 / def.rate) return;
    if (st.reloadEnd > 0) return;                       // 填彈中
    if (st.ammo <= 0) { this._startReload(id); return; } // 打空自動填彈
    this.lastFire = now;
    st.ammo--;
    if (st.ammo <= 0) this._startReload(id);

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = def.range;
    const targets = [];
    for (const ent of this.ents.values()) {
      if (ent.side !== this.side && ent.mesh.visible) targets.push(ent.mesh);
    }
    // 來襲防空飛彈也可被擊毀
    const missileMeshes = [];
    for (const [mid, ms] of this.samMeshes) { ms.mesh.userData.missileId = mid; missileMeshes.push(ms.mesh); }
    // 只對單位/飛彈與地形網格做 raycast(地貌植被是純視覺,不擋子彈也不吃效能)
    const hits = this.raycaster.intersectObjects([...targets, ...missileMeshes, this.terrain.mesh], true);
    let hitPoint = null, hitEnt = null, hitMissile = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.kind && o.userData.missileId == null && o.parent) o = o.parent;
      if (o && o.userData.missileId != null) {
        hitMissile = o.userData.missileId;
        hitPoint = h.point;
        break;
      }
      if (o && o.userData.kind) {
        hitEnt = [...this.ents.values()].find((en) => en.mesh === o);
        hitPoint = h.point;
        break;
      }
      hitPoint = h.point; // 地形
      break;
    }
    if (!hitPoint) {
      hitPoint = this.raycaster.ray.at(def.range, new THREE.Vector3());
    }
    // 槍口:座艙槍管末端(世界座標)
    this.camera.updateMatrixWorld();
    const muzzle = this.gunGroup
      ? this.gunGroup.localToWorld(this._muzzle.clone())
      : this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
    // 後座力:視角上踢 + 隨機偏擺 + 槍身後坐 + 槍口焰;無人機還吃反作用力後推
    this.recoil.p += this.isDrone ? 0.0075 : 0.011;
    this.recoil.y += (Math.random() - 0.5) * 0.006;
    this.trauma = Math.min(1, this.trauma + 0.06);
    this.weaponKick = 1;
    this.flash.visible = true;
    this._flashTtl = 0.045;
    if (this.isDrone) {
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      this.vel.addScaledVector(dir, -0.9);
    }
    this._tracer(muzzle, hitPoint, this.side === 'SWARM' ? 0xffd24a : 0x7fd8ff);
    this.net.send({ t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z], to: [hitPoint.x, hitPoint.y, hitPoint.z] });
    if (hitMissile != null) {
      this.net.send({ t: 'hitMissile', id: hitMissile, w: id });
      this.hud.hitmark?.();
      starburst(this.scene, this.effects, hitPoint.x, hitPoint.y, hitPoint.z, 3, 0xfff2b8);
    } else if (hitEnt) {
      this.net.send({ t: 'hit', id: hitEnt.id, w: id });
      this.hud.hitmark?.();
      // 命中回饋:星爆火花 + 浮動傷害數字(本地估算:武器 × 克制 × 升級;伺服器仍是權威)
      starburst(this.scene, this.effects, hitPoint.x, hitPoint.y, hitPoint.z, 2.6, 0xfff2b8);
      const mult = vsMult(def, hitEnt.kind);
      const est = Math.round(def.dmg * mult * (1 + (this.upg.dmg || 0) * ECON.UPGRADES.dmg.step));
      damageNumber(this.scene, this.effects,
        hitPoint.clone().add(new THREE.Vector3(0, 1.2, 0)), est, { big: mult >= 1.5 });
    }
  }

  /** HUD 資料:目前武器 / 彈藥 / 填彈 / 右鍵武器 / 金錢 */
  _weaponHud() {
    if (!this.side) return null;
    const now = performance.now() / 1000;
    const { id, def, st } = this._curWeapon();
    const rocket = this.wstate.rocket;
    return {
      money: this.money,
      slot: this.wi + 1, slots: this.loadout.length,
      name: def.name, ammo: st.ammo, mag: def.mag,
      reload: st.reloadEnd > 0 ? Math.max(0, st.reloadEnd - now) : 0,
      alt: this.isDrone
        ? { name: WEAPONS[UNITS.drone.bomb].name, label: '自爆' }
        : { name: WEAPONS.rocket.name, ammo: rocket.ammo, mag: WEAPONS.rocket.mag, reload: rocket.reloadEnd > 0 ? Math.max(0, rocket.reloadEnd - now) : 0 },
      atBase: this._atBase(),
    };
  }

  /** 右鍵冷卻(機甲火箭 = 1/rate;無人機自爆無冷卻) */
  _burstCdLeft() {
    if (!this.side || this.isDrone) return 0;
    const cd = 1 / WEAPONS[UNITS.robot.burst].rate;
    return Math.max(0, cd - (performance.now() / 1000 - this.lastBurst));
  }

  /** 瞄準模式(按住右鍵):拉近視角、解鎖熱兵器(伺服器另行把關開火權限) */
  _setAiming(on) {
    if (!this.side || this.aiming === on) return;
    this.aiming = on;
    this.net.send({ t: 'aim', on });
  }

  /** 機甲肩射火箭:需瞄準模式 + 冷卻 + 彈數(打空自動填彈) */
  _fireBurst() {
    if (this.dead || this.shopOpen || this.isDrone) return;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    if (this._burstCdLeft() > 0) return;
    const st = this.wstate.rocket;
    const now = performance.now() / 1000;
    if (st.reloadEnd > 0) { if (now >= st.reloadEnd) { st.ammo = WEAPONS.rocket.mag; st.reloadEnd = 0; } else return; }
    if (st.ammo <= 0) return;
    st.ammo--;
    if (st.ammo <= 0) { st.reloadEnd = now + WEAPONS.rocket.reload; this.hud.feed?.('🔄 肩射火箭 填彈中…'); }
    this.lastBurst = now;
    // 大後座:整台機甲被推退
    this.vel.addScaledVector(dir, -7);
    this.recoil.p += 0.035;
    this.trauma = Math.min(1, this.trauma + 0.35);
    this.weaponKick = 1;
    this.projectiles.push({
      pos: this.camera.position.clone().add(dir.clone().multiplyScalar(3)),
      vel: dir.clone().multiplyScalar(95),
      grav: false,
      mesh: this._bombMesh(0x50585f),
    });
  }

  /** 無人機自爆(右鍵原地 / 高速撞擊):伺服器結算傷害並擊毀座機 */
  _detonate() {
    if (!this.isDrone || this.dead || this._crashSent) return;
    this._crashSent = true;
    this.trauma = 1;
    this.net.send({ t: 'detonate' });
  }

  _bombMesh(color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      toonMat(color, { emissive: 0xff5522, emissiveIntensity: 0.4, celMetal: true }),
    );
    outlinify(m, 0.05);
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
        const r = WEAPONS[UNITS.robot.burst].r;
        const by = Math.max(p.pos.y, gy + 1);
        this._explosion(p.pos.x, by, p.pos.z, r * 0.8, 0xffaa33);
        this._applyBlast(p.pos.x, by, p.pos.z, r);   // 太近丟炸彈,自己也會被衝擊波掀飛
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
    // 漫畫星爆閃光:150ms 硬邊放大淡出(所有爆炸共通的第一拍)
    starburst(this.scene, this.effects, x, y, z, r * 1.7, color);
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
        e.dispose?.();   // 一次性 canvas 貼圖(傷害數字)釋放 GPU 資源
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
      // FPV 3D 操作:2D 按鍵(W/S)沿「視線方向」飛 — 抬頭爬升、低頭俯衝;
      // A/D 水平橫移;Space/C 純垂直(懸停微調)。
      const look = new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      const target = new THREE.Vector3();
      if (this.keys.KeyW) target.add(look);
      if (this.keys.KeyS) target.sub(look);
      if (this.keys.KeyD) target.add(right);
      if (this.keys.KeyA) target.sub(right);
      if (target.lengthSq() > 0) target.normalize().multiplyScalar(u.speed * boost);
      if (this.keys.Space) target.y += u.vspeed;
      if (this.keys.KeyC || this.keys.ControlLeft) target.y -= u.vspeed;
      this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * 4);
      this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * 4);
      this.vel.y += (target.y - this.vel.y) * Math.min(1, dt * 4);
      this.pos.addScaledVector(this.vel, dt);
      const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.pos.y = Math.max(gy + 2.5, Math.min(gy + 320, this.pos.y));
      // FPV 側傾:橫移/轉向時機身壓坡度
      const lat = this.vel.x * right.x + this.vel.z * right.z;
      this.roll += (-lat / u.speed * 0.16 - this.roll) * Math.min(1, dt * 5);
    } else {
      // 機甲:貼地 + 跳躍;this.vel 是爆炸/後座的擊退速度(地面摩擦快速衰減)
      this.pos.addScaledVector(move, u.speed * boost * this._zoneSlow() * dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      const fr = Math.exp(-dt * 6);
      this.vel.x *= fr; this.vel.z *= fr; this.vel.y = 0;
      const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.vy = this.vy ?? 0;
      const onGround = this.pos.y <= gy + 0.05;
      if (onGround && this.keys.Space) this.vy = u.jump;
      this.vy -= 24 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < gy) { this.pos.y = gy; this.vy = 0; }
      this.roll += (0 - this.roll) * Math.min(1, dt * 6);
    }

    // 碰撞:不能穿過單位 / 塔 / 主堡
    this._collide();

    // 邊界(地形範圍內縮 40m)
    this.pos.x = Math.max(this.terrain.minX + 40, Math.min(this.terrain.maxX - 40, this.pos.x));
    this.pos.z = Math.max(this.terrain.minZ + 40, Math.min(this.terrain.maxZ - 40, this.pos.z));

    // 後座力回復 + 鏡頭震動(trauma² 噪聲)
    const rk = Math.exp(-dt * 7);
    this.recoil.p *= rk; this.recoil.y *= rk;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const n = this.trauma * this.trauma;
    const shP = (Math.random() * 2 - 1) * n * 0.045;
    const shY = (Math.random() * 2 - 1) * n * 0.045;
    const shR = (Math.random() * 2 - 1) * n * 0.05;

    const eye = this.isDrone ? 0 : 3.4;
    this.camera.position.copy(this.pos).add(new THREE.Vector3(0, eye, 0));
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + this.recoil.y + shY);
    this.camera.rotateX(this.pitch + this.recoil.p + shP);
    this.camera.rotateZ(this.roll + shR);

    // 瞄準縮放:按住右鍵拉近視角(FOV 越小越像瞄準鏡)
    const wantFov = this.aiming ? (UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : this.baseFov;
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
    // 瞄準時左鍵改發射肩射火箭(取代舊右鍵瞬發)
    if (!this.isDrone && this.aiming && this.firing) this._fireBurst();

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
  /**
   * 防禦塔砲塔追蹤(計畫 Task 2.2):0.25s 挑一次最近敵目標,
   * 每幀平滑轉向(不瞬移),俯仰夾在 -30°~+60° 機械極限;無目標慢速掃描。
   */
  _aimTurret(ent, dt, now) {
    const tur = ent.mesh.userData.turret;
    if (!tur) return;
    if (!ent._aimNext || now >= ent._aimNext) {
      ent._aimNext = now + 0.25;
      let best = null, bestD = UNITS.tower.sam.range;   // 追蹤半徑同防空飛彈射程
      const tp = ent.mesh.position;
      for (const o of this.ents.values()) {
        if (!o.side || o.side === ent.side || o.neutral || o.isStatic || o.dead) continue;
        if (!o.mesh.visible && !o.isSelf) continue;
        const p = o.mesh.position;
        const d = Math.hypot(p.x - tp.x, p.z - tp.z);
        if (d < bestD) { bestD = d; best = o; }
      }
      ent._aimTarget = best;
    }
    const t = ent._aimTarget;
    let wantYaw, wantPitch;
    if (t && this.ents.has(t.id)) {
      const p = t.isSelf ? this.pos : t.mesh.position;
      const dx = p.x - ent.mesh.position.x, dz = p.z - ent.mesh.position.z;
      wantYaw = Math.atan2(dx, dz);
      const turY = ent.mesh.position.y + tur.position.y;
      wantPitch = Math.atan2((p.y + 2) - turY, Math.hypot(dx, dz));
    } else {
      wantYaw = tur.rotation.y + dt * 2;   // 警戒掃描
      wantPitch = 0;
    }
    wantPitch = Math.max(-Math.PI / 6, Math.min(Math.PI / 3, wantPitch));
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    tur.rotation.y += wrap(wantYaw - tur.rotation.y) * Math.min(1, dt * 4);
    const pit = tur.userData.pitch;
    pit.rotation.x += (-wantPitch - pit.rotation.x) * Math.min(1, dt * 4);
  }

  _updateEnts(dt, now) {
    for (const ent of this.ents.values()) {
      if (ent.isSelf) { ent.mesh.position.copy(this.pos); continue; }
      if (ent.isStatic) {
        const y = this.terrain.heightAt(ent.tgt.x, ent.tgt.z);
        ent.mesh.position.set(ent.tgt.x, y, ent.tgt.z);
        if (ent.kind === 'tower') this._aimTurret(ent, dt, now);
        if (ent.bar) ent.bar.lookAt(this.camera.position);
        continue;
      }
      const cur = ent.mesh.position;
      let nx, nz;
      if (ent._snapPos) {
        nx = ent.tgt.x; nz = ent.tgt.z;
        ent._snapPos = false;
      } else {
        const k = Math.min(1, dt * 9);
        nx = cur.x + (ent.tgt.x - cur.x) * k;
        nz = cur.z + (ent.tgt.z - cur.z) * k;
      }
      const gy = this.terrain.heightAt(nx, nz);
      const ny = (ent.hero || ent.flies) ? gy + ent.heroY : gy;
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
    // 單位(中立障礙不上圖:偵察情報要親眼看)
    for (const ent of this.ents.values()) {
      if (ent.neutral) continue;
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
    // 防空飛彈(紅點)
    ctx.fillStyle = '#ff5533';
    for (const ms of this.samMeshes.values()) {
      const [mx, my] = this._world2mm(ms.mesh.position.x, ms.mesh.position.z, w, h);
      ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
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
    let dt = Math.min(0.1, this.clock.getDelta());
    const now = performance.now() / 1000;

    // Hitstop(頓點):拆塔/擊殺瞬間全域凍結 50~120ms 強調打擊重量,期間照常渲染
    if (this._hitstop > 0) { this._hitstop -= dt; dt = 0; }

    if (this._snapQueue) { this._applySnap(this._snapQueue); this._snapQueue = null; }

    this._tickWeapons(now);
    this._updatePlayer(dt, now);
    this._updateEnts(dt, now);
    this._updateProjectiles(dt);
    this._updateMissiles(dt);
    this._updateMines(now);
    this._updateLoot(dt, now);
    this._updateEffects(dt);
    for (const s of this.shields) s.userData.update(dt);
    this.envFx?.update(dt, this.camera);
    this.terrain.biomesUpdate?.(dt);   // 地貌動態物件(火車 / 瀑布)
    for (const m of this.mixers) m.update(dt);
    for (const g of this.spinners) {
      for (const p of g.userData.spin) p.rotation.y += dt * 40;
    }
    // 座艙:旋翼恆轉、槍身後坐回彈、槍口焰熄滅
    if (this.cockpit) {
      for (const p of this.cockpitSpin) p.rotation.y += dt * 55;
      this.weaponKick = Math.max(0, this.weaponKick - dt * 9);
      const cur = this._curWeapon();
      let reloadOff = { dz: 0, dy: 0, rx: 0 };
      if (cur.st && cur.st.reloadEnd > 0) {
        const p = 1 - Math.max(0, cur.st.reloadEnd - now) / cur.def.reload;
        reloadOff = this._reloadAnimOffset(cur.id, p);
      }
      this.gunGroup.position.z = this._gunBaseZ + this.weaponKick * 0.11 + reloadOff.dz;
      this.gunGroup.position.y = reloadOff.dy;
      this.gunGroup.rotation.x = reloadOff.rx;
      if (this._flashTtl != null) {
        this._flashTtl -= dt;
        if (this._flashTtl <= 0) { this.flash.visible = false; this._flashTtl = null; }
        else this.flash.scale.setScalar(0.7 + Math.random() * 0.7);
      }
      this.cockpit.visible = !this.dead;
    }
    this._drawMinimap(now);
    updateCelLight(this.camera);   // 硬邊金屬高光帶的 view-space 光向
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.envFx?.dispose();
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
