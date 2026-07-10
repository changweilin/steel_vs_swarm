// ============ 戰鬥客戶端:第一人稱 無人機 vs 機甲 + DOTA 兵線 ============
// 伺服器權威(HP/傷害/波次),客戶端負責:
//  - 3D 渲染(地形 + 單位 + 特效)
//  - 第一人稱操控(蜂群=飛行無人機、鋼鐵=地面機甲)
//  - 射擊 raycast 命中回報、範圍技落點回報
//  - 2D 戰術地圖(minimap,繼承 mapping_elf 的 2D 地圖概念)
import * as THREE from 'three';
import {
  SIDES, UNITS, GAME, ECON, HAZARDS, FIELD, AFFIXES,
  CHARACTERS, heroWeapon, heroAbility, PROG, BALLISTIC, vsMult, MORPH,
} from './data.js';
import { llToWorld } from './terrain.js';
import { makeUnit } from './models.js';
import { applyEnvironment } from './environment.js';
import { buildHazard, buildMineBump, buildLoot } from './hazards.js';
import { toonMat, outlinify, updateCelLight } from './toon.js';
import { stepLocomotion } from './locomotion.js';
import { comicPop, starburst, shockRing, damageNumber, debrisBurst, makeShield } from './vfx.js';
import { CutIn } from './cutin.js';

const KIND_KEY = {
  soldier: 'creep:soldier', apc: 'creep:apc', tank: 'creep:tank',
  rocketeer: 'creep:rocketeer', howitzer: 'creep:howitzer', heli: 'creep:heli',
  tower: 'tower', drone: 'hero:drone', robot: 'hero:robot', morph: 'hero:morph',
};
const HERO_KINDS = new Set(['drone', 'robot', 'morph']);
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
    this.keys = {};
    this.yaw = 0; this.pitch = -0.1;
    this.vel = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.hp = 0; this.maxHp = 1;
    this.dead = false;
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
    this.cutin = new CutIn(document.getElementById('cutinLayer'));

    // 機體種類綁角色(傭兵 kind 自帶,不隨陣營);未選角/觀戰退回陣營預設
    this.heroKind = this.side ? (CHARACTERS[this.ch]?.kind || SIDES[this.side].hero) : null;
    this.isDrone = this.heroKind === 'drone';
    this.isMorph = this.heroKind === 'morph';   // 傭兵變形機甲(飛行 ↔ 地面雙型態)
    this.flight = false;                        // morph:目前是否飛行型態
    this.charge = 0;                            // morph:蓄力跳進度 0~1(按住 Space)

    // 角色(專屬機體 + 輕/重武器 + 小招/大招);開房廣播帶 ch,快照亦會同步
    this.abil = { light: 1, heavy: 1, skill: 0, ult: 0 };
    this.wdef = {};                   // slot -> 解析後武器數值(含英雄倍率與階級)
    this.wstate = {};                 // slot -> { ammo, reloadEnd }(本地 HUD;伺服器另行把關)
    this.lastFireAt = { light: 0, heavy: 0 };
    this.bullets = [];                // 彈道學子彈(初速 mv + 重力,射程上限)
    this._setChar(this.ch || null);
    this.money = 0;
    this.upg = { dmg: 0, hull: 0 };
    this.sp = 0; this.maxSp = 1;      // 護盾(雙層 HP 第一層,脫戰自然回復)
    this.mp = 0; this.maxMp = 1;      // 電力(招式資源)
    this.kn = 0;                      // 擊殺數(招式解鎖門檻)
    this.cds = [0, 0];                // [小招, 大招] 冷卻(伺服器倒數)
    this.empLeft = 0;                 // 遭電磁癱瘓剩餘秒數(武器/招式離線)
    this.stealthLeft = 0;
    this.shopOpen = false;
    this._crashSent = false;          // 撞擊引爆去重
    this.aiming = false;              // 按住右鍵瞄準(拉近視角、切換重武器)

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

  /** 設定/更新角色與武器解析(升階時重算;伺服器已重置彈藥 → 本地同步滿彈夾) */
  _setChar(ch, refill = false) {
    if (ch && CHARACTERS[ch]) {
      const changed = ch !== this.ch;
      this.ch = ch;
      // 角色由快照晚到(隨機指派):機體種類與座艙跟著角色重建
      if (changed && this.side) {
        this.heroKind = CHARACTERS[ch].kind || SIDES[this.side].hero;
        this.isDrone = this.heroKind === 'drone';
        this.isMorph = this.heroKind === 'morph';
        this.flight = false;
        this.charge = 0;
        this.baseFov = UNITS[this.heroKind].fov;
        if (this.cockpit) { this.camera.remove(this.cockpit); this._buildCockpit(); }
      }
    }
    if (!this.ch || !this.side) return;
    for (const slot of ['light', 'heavy']) {
      const def = heroWeapon(this.ch, slot, this.abil[slot] || 1, true);
      this.wdef[slot] = def;
      if (!this.wstate[slot] || refill) this.wstate[slot] = { ammo: def.mag, reloadEnd: 0 };
    }
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

  // ---------------- FPV 座艙(角色專屬:依 CHARACTERS[ch].visual 差異化,3D 賽璐璐)----------------
  // 與世界模型(models.js buildDrone/charPod)同一套視覺語彙:
  // 無人機 = frame(quad/hexa/coax/wing)× body 機鼻剪影;機甲 = pod 肩部掛件;
  // 輕武器外觀依機構分類(gun/launcher/beam),主色 = 角色識別色。
  _buildCockpit() {
    if (!this.side) return;
    this.scene.add(this.camera);   // 相機要在場景樹裡,座艙子物件才會渲染
    const mk = (geo, color, opts = {}) => {
      // 座艙同樣走賽璐璐;高金屬度 → 漫畫硬邊高光帶
      const { metalness, roughness, ...rest } = opts;
      return new THREE.Mesh(geo, toonMat(color, { ...rest, celMetal: (metalness ?? 0) >= 0.5 }));
    };
    const c = this.ch && CHARACTERS[this.ch];
    const vis = c?.visual || {};
    const accent = new THREE.Color(vis.hue ?? SIDES[this.side].color);
    const g = new THREE.Group();
    this.cockpitSpin = [];
    this.gunGroup = new THREE.Group();

    if (this.isDrone) this._buildDroneCockpit(g, mk, accent, vis);
    else this._buildMechCockpit(g, mk, accent, vis);
    this._buildCockpitGun(mk, accent, c?.light?.type || 'gun');

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

  /** 無人機座艙:機鼻(body 剪影)+ 機架/旋翼(frame)在畫面上緣;中灰藍避免暗部塌黑 */
  _buildDroneCockpit(g, mk, accent, vis) {
    const body = vis.body || 'box';
    let nose;
    if (body === 'wedge') {
      nose = mk(new THREE.CylinderGeometry(0.05, 0.36, 0.7, 4), 0x4b545e);
      nose.rotation.set(-Math.PI / 2, Math.PI / 4, 0);   // 尖端朝前的楔形
    } else if (body === 'sphere') {
      nose = mk(new THREE.SphereGeometry(0.3, 10, 8), 0x4b545e);
    } else if (body === 'slab') {
      nose = mk(new THREE.BoxGeometry(0.8, 0.12, 0.5), 0x4b545e);
    } else if (body === 'frame') {
      nose = mk(new THREE.BoxGeometry(0.5, 0.08, 0.5), 0x4b545e);
      for (const sx of [-1, 1]) {
        const rail = mk(new THREE.BoxGeometry(0.06, 0.14, 0.55), 0x5b6772);
        rail.position.set(sx * 0.24, 0.05, 0);
        nose.add(rail);
      }
    } else {
      nose = mk(new THREE.BoxGeometry(0.5, 0.16, 0.5), 0x4b545e);
    }
    nose.position.set(0, -0.42, -0.78);
    g.add(nose);
    const lamp = mk(new THREE.BoxGeometry(0.34, 0.03, 0.04), accent, { emissive: accent, emissiveIntensity: 1.2 });
    lamp.position.set(0, -0.33, -0.6);
    g.add(lamp);

    const prop = (x, y, z, len = 0.62) => {
      const hub = mk(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 8), 0x39414a);
      hub.position.set(x, y - 0.05, z);
      g.add(hub);
      const p = mk(new THREE.BoxGeometry(len, 0.015, 0.055), 0x9aa4ad, { transparent: true, opacity: 0.55 });
      p.position.set(x, y, z);
      g.add(p);
      this.cockpitSpin.push(p);
    };
    const arm = (x, y, z, ry, len = 0.75) => {
      const a = mk(new THREE.BoxGeometry(len, 0.05, 0.08), 0x5b6772);
      a.position.set(x, y, z);
      a.rotation.y = ry;
      g.add(a);
    };
    const frame = vis.frame || 'quad';
    if (frame === 'hexa') {
      // 六旋翼:左右二臂 + 正前中臂
      for (const sx of [-1, 1]) { arm(sx * 0.5, 0.28, -0.7, sx * -0.55, 0.62); prop(sx * 0.72, 0.36, -0.9, 0.5); }
      arm(0, 0.34, -0.8, Math.PI / 2, 0.5);
      prop(0, 0.42, -1.0, 0.5);
    } else if (frame === 'coax') {
      // 同軸雙槳:中央桅桿 + 上下兩層大旋翼
      const mast = mk(new THREE.CylinderGeometry(0.035, 0.05, 0.5, 8), 0x39414a);
      mast.position.set(0, 0.42, -0.85);
      g.add(mast);
      prop(0, 0.5, -0.85, 0.9);
      prop(0, 0.62, -0.85, 0.9);
    } else if (frame === 'wing') {
      // 固定翼混合:翼樑橫貫視野上緣 + 翼尖旋翼
      const wing = mk(new THREE.BoxGeometry(2.0, 0.04, 0.3), 0x5b6772);
      wing.position.set(0, 0.42, -0.9);
      g.add(wing);
      for (const sx of [-1, 1]) prop(sx * 0.95, 0.5, -0.9, 0.55);
    } else {
      // 四旋翼:前二臂 + 旋翼
      for (const sx of [-1, 1]) { arm(sx * 0.48, 0.30, -0.72, sx * -0.6); prop(sx * 0.72, 0.38, -0.92); }
    }
  }

  /** 機甲座艙:共通艙框(儀表台/頂樑/A 柱)+ 左肩角色掛件(與 models.js charPod 同語彙) */
  _buildMechCockpit(g, mk, accent, vis) {
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
    const pod = vis.pod || 'none';
    if (pod === 'antenna') {
      const mast = mk(new THREE.CylinderGeometry(0.02, 0.03, 0.6, 6), 0x39424b);
      mast.position.set(-0.78, 0.12, -1.0);
      g.add(mast);
      const tip = mk(new THREE.SphereGeometry(0.045, 8, 6), accent, { emissive: accent, emissiveIntensity: 1.4 });
      tip.position.set(-0.78, 0.44, -1.0);
      g.add(tip);
    } else if (pod === 'blade') {
      const fin = mk(new THREE.BoxGeometry(0.04, 0.42, 0.16), 0x39424b, { metalness: 0.7 });
      fin.rotation.z = 0.3;
      fin.position.set(-0.8, 0.05, -1.0);
      g.add(fin);
    } else if (pod === 'shield') {
      const plate = mk(new THREE.BoxGeometry(0.1, 0.5, 0.42), 0x39424b, { metalness: 0.6 });
      plate.rotation.z = 0.14;
      plate.position.set(-0.85, -0.18, -0.95);
      g.add(plate);
    } else if (pod === 'rack') {
      const rack = mk(new THREE.BoxGeometry(0.26, 0.18, 0.3), 0x39424b);
      rack.position.set(-0.74, -0.08, -1.0);
      g.add(rack);
      for (const [ox, oy] of [[-0.06, -0.04], [0.06, -0.04], [-0.06, 0.04], [0.06, 0.04]]) {
        const cell = mk(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 6), 0x14171a);
        cell.rotation.x = Math.PI / 2;
        cell.position.set(-0.74 + ox, -0.08 + oy, -1.02);
        g.add(cell);
      }
    } else if (pod === 'dish') {
      const dish = mk(new THREE.CylinderGeometry(0.16, 0.05, 0.05, 10), 0xaab4bd);
      dish.rotation.z = Math.PI / 3;
      dish.position.set(-0.78, 0.1, -1.0);
      g.add(dish);
    } else if (pod === 'twin') {
      for (const oy of [-0.05, 0.05]) {
        const tube = mk(new THREE.CylinderGeometry(0.035, 0.04, 0.5, 8), 0x2b3239, { metalness: 0.8 });
        tube.rotation.x = Math.PI / 2;
        tube.position.set(-0.76, -0.05 + oy, -1.1);
        g.add(tube);
      }
    }
  }

  /** 輕武器外觀(gunGroup):依武器機構分類;掛點無人機吊艙較小、機甲右臂較大口徑 */
  _buildCockpitGun(mk, accent, type) {
    const d = this.isDrone;
    const x = d ? 0.2 : 0.5, y = d ? -0.34 : -0.36, s = d ? 1 : 1.4;
    const recv = mk(new THREE.BoxGeometry(0.16 * s, 0.14 * s, d ? 0.4 : 0.85), d ? 0x3d454e : 0x3c444d);
    recv.position.set(x, y, d ? -0.7 : -1.0);
    this.gunGroup.add(recv);
    if (type === 'beam') {
      // 能量武器:粗短炮管 + 主色發光聚焦環
      const tube = mk(new THREE.CylinderGeometry(0.05 * s, 0.06 * s, 0.6 * s, 8), 0x30373f, { metalness: 0.85 });
      tube.rotation.x = Math.PI / 2;
      tube.position.set(x, y + 0.02, -1.05 - 0.25 * s);
      this.gunGroup.add(tube);
      const coil = mk(new THREE.TorusGeometry(0.07 * s, 0.018, 6, 12), accent, { emissive: accent, emissiveIntensity: 1.6 });
      coil.position.set(x, y + 0.02, -1.2 - 0.3 * s);
      this.gunGroup.add(coil);
      this._muzzle = new THREE.Vector3(x, y + 0.02, -1.35 - 0.35 * s);
    } else if (type === 'launcher') {
      // 發射器:大口徑短筒(火箭/榴彈/飛彈)
      const tube = mk(new THREE.CylinderGeometry(0.075 * s, 0.08 * s, 0.7 * s, 10), 0x2b3239, { metalness: 0.7 });
      tube.rotation.x = Math.PI / 2;
      tube.position.set(x, y + 0.02, -1.05 - 0.3 * s);
      this.gunGroup.add(tube);
      const lip = mk(new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 0.08, 10), 0x272c31);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(x, y + 0.02, -1.4 - 0.35 * s);
      this.gunGroup.add(lip);
      this._muzzle = new THREE.Vector3(x, y + 0.02, -1.5 - 0.35 * s);
    } else {
      // 槍械:細長槍管 + 制退器
      const barrel = mk(new THREE.CylinderGeometry(0.03 * s, 0.035 * s, 0.8 * s, 8), 0x30373f, { metalness: 0.85 });
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(x, y + 0.02, -1.1 - 0.3 * s);
      this.gunGroup.add(barrel);
      const brake = mk(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.12, 8), 0x272c31);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(x, y + 0.02, -1.5 - 0.35 * s);
      this.gunGroup.add(brake);
      this._muzzle = new THREE.Vector3(x, y + 0.02, -1.6 - 0.35 * s);
    }
  }

  // ---------------- 物理:爆炸衝擊 / 碰撞 ----------------
  /** 爆炸衝擊波:把自己(座機)往外推 + 鏡頭震動。強度隨距離平方衰減、隨爆炸半徑(能量)遞增 —
   *  近炸猛烈、遠處迅速歸零;同距離下大爆炸比小爆炸更晃(符合爆壓物理直覺)。 */
  _applyBlast(x, y, z, r) {
    if (!this.side || this.dead) return;
    const eye = this.camera.position;
    const d = Math.hypot(eye.x - x, eye.y - y, eye.z - z);
    const R = Math.max(20, r * 3);   // 影響半徑正比於爆炸半徑:越大的爆炸波及越遠
    if (d > R) return;
    const f = 1 - d / R;
    const k = f * f;                 // 平方衰減(距離越遠震動掉得越快)
    const eScale = Math.min(1.6, Math.max(0.4, r / 12));   // 爆炸半徑代表能量:小彈少晃、重砲/主堡更晃
    const dir = new THREE.Vector3(eye.x - x, eye.y - y, eye.z - z);
    if (dir.lengthSq() < 0.01) dir.set(0, 1, 0);
    dir.normalize();
    const power = k * eScale * (this._flying() ? 55 : 26);
    this.vel.addScaledVector(dir, power);
    if (!this._flying()) this.vy = (this.vy ?? 0) + k * eScale * 10;   // 機甲被掀離地
    this.trauma = Math.min(1, this.trauma + k * eScale * 0.8);
  }

  // 單位碰撞半徑 / 高度(公尺):玩家座機不能穿過單位與建築
  static COLLIDER = {
    base: { r: 20, h: 46 }, tower: { r: 7, h: 26 },
    tank: { r: 4.2, h: 5.5 }, apc: { r: 3.4, h: 5 }, soldier: { r: 1.0, h: 3.2 },
    drone: { r: 2.4, h: 3.5 }, robot: { r: 2.6, h: 6.5 }, morph: { r: 2.6, h: 6 },
  };

  /** 目前是否為飛行機體(無人機恆飛;變形機甲僅飛行型態) */
  _flying() { return this.isDrone || (this.isMorph && this.flight); }

  /** 玩家 vs 單位/建築:水平圓柱推擠(考慮飛行高度,飛過塔頂不碰撞) */
  _collide() {
    const fly = this._flying();
    const myR = fly ? 1.6 : 1.9;
    const myBot = this.pos.y - (fly ? 0.8 : 0);
    const myTop = this.pos.y + (fly ? 1.2 : 4.2);
    for (const ent of this.ents.values()) {
      if (ent.isSelf || !ent.mesh.visible) continue;
      // 自己的僚機不碰撞:歸隊時牠們以 50m/s 貼上來,會誤觸下面的高速撞擊自爆
      if (ent.hero && ent.pid != null && ent.pid === this.youId) continue;
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
    // 圖資建物(biomes 客戶端幾何,全房間同一 OSM 來源 → 各端一致):
    // 純推擠不結算傷害,伺服器權威不受影響;無人機可飛越屋頂
    for (const b of this.terrain.blockers || []) {
      if (myBot > b.y + b.h || myTop < b.y) continue;
      const dx = this.pos.x - b.x, dz = this.pos.z - b.z;
      const d = Math.hypot(dx, dz);
      const min = myR + b.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d, nz = dz / d;
      this.pos.x += nx * (min - d);
      this.pos.z += nz * (min - d);
      const into = this.vel.x * nx + this.vel.z * nz;
      if (into < 0) {
        if (this.isDrone && -into > 16) this._detonate();
        this.vel.x -= into * nx; this.vel.z -= into * nz;
      }
    }
  }

  // ---------------- 輸入 ----------------
  _initInput() {
    this._onKey = (e) => {
      if (e.type === 'keydown' && e.code === 'KeyM') this.minimapBig = !this.minimapBig;
      if (e.type === 'keydown' && this.side) {
        // 商店不受死亡限制:陣亡等待重生也能買升級(DOTA 慣例)
        if (e.code === 'KeyB') this._toggleShop();
        if (e.code === 'Escape' && this.shopOpen) this._toggleShop(false);
        if (!this.dead) {
          if (e.code === 'KeyQ') this._castAbility('skill');   // 小招
          if (e.code === 'KeyE') this._castAbility('ult');     // 大招
          if (e.code === 'KeyR') this._startReload();
          if (e.code === 'KeyF' && this.isDrone) this._detonate();   // 無人機自爆(右鍵已改為瞄準)
        }
        // 三機小隊:V 循環切換主視野、1~3 直選(陣亡中也能切到存活的僚機)
        if (this.isDrone) {
          if (e.code === 'KeyV') this._swapDrone(null);
          const n = /^Digit([123])$/.exec(e.code);
          if (n) this._swapDrone(Number(n[1]) - 1);
        }
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
      if (HERO_KINDS.has(e.k)) {
        ent.heroY = e.y ?? 0;
        ent.ry = e.ry ?? 0;
        const wasDead = ent.dead;
        ent.dead = !!e.dead;
        // 三機小隊:主視野由伺服器指定(e.act);換機時整個座機狀態接管過去
        if (e.pid === this.youId && !!e.act !== ent.isSelf) this._takeOver(ent, e);
        if (wasDead && !e.dead && !ent.isSelf) ent._snapPos = true;
        ent.mesh.visible = !e.dead && !ent.isSelf;
        if (ent.isSelf) {
          this.hp = e.hp; this.maxHp = e.m;
          this.sp = e.sp ?? this.sp; this.maxSp = e.msp ?? this.maxSp;
          this.mp = e.mp ?? this.mp; this.maxMp = e.mm ?? this.maxMp;
          this.money = e.$ ?? this.money;
          this.upg = e.up || this.upg;
          this.kn = e.kn ?? this.kn;
          this.cds = e.cds || this.cds;
          this.empLeft = e.emp || 0;
          this.stealthLeft = e.st || 0;
          // 角色 / 招式階級同步(伺服器權威;升階 → 重算武器數值並滿彈夾)
          if (e.ch && e.ch !== this.ch) this._setChar(e.ch);
          if (e.ab) {
            const changed = ['light', 'heavy'].some((s) => e.ab[s] !== this.abil[s]);
            this.abil = { ...e.ab };
            if (changed) this._setChar(this.ch, true);
          }
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
    // 三機小隊狀態列(各機 HP / 陣亡倒數 / 誰是主視野)
    if (this.isDrone) {
      this.hud.squad?.(m.ents
        .filter((e) => e.pid === this.youId)
        .sort((a, b) => (a.si || 0) - (b.si || 0))
        .map((e) => ({ si: e.si || 0, hp: e.hp, max: e.m, dead: !!e.dead, rs: e.rs || 0, act: !!e.act })));
    }
    this.hud.bases?.(bases, m.stats);
    this.hud.wave?.(m.wave, m.nextWave);
    this.hud.self?.(this.hp, this.maxHp, this._burstCdLeft(), this._weaponHud());
    if (m.over) this.hud.over?.(m.winner, m.stats);
  }

  _spawnEnt(e) {
    // 中立危險區實體(障礙物 / 防空陣地 / 偵察中繼站):程序生成低多邊形,不吃 makeUnit
    const hazDef = HAZARDS[e.k];
    if (hazDef || e.k === 'aasite' || e.k === 'relay') {
      const r = (hazDef?.r ?? 6) * (e.sc || 1);
      const group = buildHazard(e.k, e.id, r);
      this.scene.add(group);
      const ent = {
        id: e.id, kind: e.k, side: null, mesh: group,
        tgt: new THREE.Vector3(e.x, 0, -e.z), hp: e.hp, max: e.m,
        neutral: true, isStatic: true, hero: false,
        // 阻擋型障礙:限制行動但不完全封鎖(縫隙由伺服器佈局保證,無人機可飛越)
        colR: hazDef?.block ? r : (e.k === 'aasite' ? 3.2 : e.k === 'relay' ? 1.6 : 0),
        colH: e.k === 'aasite' ? 3.5 : e.k === 'relay' ? 8 : (hazDef?.hgt || 6),
      };
      group.position.set(e.x, this.terrain.heightAt(e.x, -e.z), -e.z);
      if (group.userData.flames) this.flamers.add(group);
      if (e.k === 'flood') this.floods.push({ x: e.x, z: -e.z, r, slow: hazDef.slow });
      this.ents.set(e.id, ent);
      return ent;
    }
    const key = e.k === 'base' ? `base:${e.s}` : KIND_KEY[e.k];
    const { group, mixer } = makeUnit(key, e.s, { ch: e.ch });   // 英雄:角色專屬機體外觀
    const hero = HERO_KINDS.has(e.k);
    // 三機小隊:只有主視野那架(e.act)才是「自己」,另外兩架當一般友軍渲染
    const isSelf = hero && e.pid != null && e.pid === this.youId && !!e.act;
    if (isSelf) group.visible = false;
    this.scene.add(group);
    if (mixer) this.mixers.add(mixer);
    if (group.userData.spin) this.spinners.add(group);
    const ent = {
      id: e.id, kind: e.k, side: e.s, mesh: group, mixer, ch: e.ch, pid: e.pid ?? null,
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
      const g = buildLoot(!!l.a, !!l.f);
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

  /** 淹水區:地面機體深水行進大幅減速(限制但不封鎖;飛行型態不受影響) */
  _zoneSlow() {
    if (this._flying()) return 1;
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
      const hero = HERO_KINDS.has(ev.kind);
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
      } else if (hero) {
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
          // 稀有掉落:全武器彈藥即刻補滿、重武器 CD 清空(本地 HUD 同步)
          for (const [id, st] of Object.entries(this.wstate)) { st.ammo = this.wdef[id]?.mag ?? st.ammo; st.reloadEnd = 0; }
          this.hud.feed?.('🔋 拾獲彈藥補給:全武器裝滿!');
        } else if (ev.af) {
          const a = AFFIXES[ev.af];
          this.hud.feed?.(`✨ 拾獲詞綴強化【${a?.name || ev.af}】${a?.desc || ''}(${a?.dur || 0} 秒)`);
        } else {
          this.hud.feed?.(`💰 拾獲戰場物資 +$${ev.v}`);
        }
      }
    } else if (ev.e === 'relay') {
      this.hud.feed?.(ev.side === this.side
        ? `📡 我方啟動偵察中繼站:全隊 ${FIELD.RELAY.VISION_S} 秒無霧視野!`
        : `⚠️ ${SIDES[ev.side].name}啟動了偵察中繼站,我方位置全數曝光!`);
      starburst(this.scene, this.effects, ev.x, this.terrain.heightAt(ev.x, -ev.z) + 9, -ev.z,
        8, ev.side ? SIDES[ev.side].color : 0x66ffe0);
    } else if (ev.e === 'sam') {
      if (ev.tpid === this.youId) {
        this.hud.feed?.(ev.ambush
          ? '🚨 匿蹤防空陣地開火!命中即墜毀,快擊落飛彈或回兵線走廊!'
          : '🚨 防空飛彈鎖定你了,快規避!');
      }
    } else if (ev.e === 'cast') {
      // 招式施放:特效 + 播報(敵我口徑不同)
      const c = CHARACTERS[ev.ch];
      const a = c?.[ev.slot];
      const wx = ev.x, wz = -ev.z;
      const gy = this.terrain.heightAt(wx, wz);
      const col = ev.side ? SIDES[ev.side].color : 0xffffff;
      if (ev.fx === 'emp') {
        shockRing(this.scene, this.effects, wx, gy, wz, ev.r || 40, 0xb78aff);
        starburst(this.scene, this.effects, wx, gy + 8, wz, 10, 0xb78aff);
      } else if (ev.fx === 'buff' || ev.fx === 'heal') {
        shockRing(this.scene, this.effects, wx, gy, wz, ev.r || 20, ev.fx === 'heal' ? 0x8affa0 : col);
        starburst(this.scene, this.effects, wx, gy + 6, wz, 6, ev.fx === 'heal' ? 0x8affa0 : 0xfff2b8);
      } else if (ev.fx === 'intercept') {
        shockRing(this.scene, this.effects, wx, gy, wz, ev.r || 150, 0x9adfff);
      } else if (ev.fx === 'summon' || ev.fx === 'dash' || ev.fx === 'stealth' || ev.fx === 'vision') {
        starburst(this.scene, this.effects, wx, gy + 6, wz, 7, col);
      }
      if (a) {
        this.hud.feed?.(ev.side === this.side
          ? `✨ ${c.code}【${a.name}】`
          : `⚠️ 敵方 ${c.code} 施放【${a.name}】!`);
        // 立繪演出:自己的招式一律演;敵方只演大招(小招太頻繁會蓋住視野)
        const self = ev.pid === this.youId;
        this.cutin.show(ev, self, ev.side ? SIDES[ev.side].color : '#ffffff');
        if (ev.slot === 'ult') this.trauma = Math.min(1, this.trauma + (self ? 0.45 : 0.25));
      }
    } else if (ev.e === 'crit') {
      // 爆擊(伺服器擲骰):自己打出 → 橘色大字回饋
      if (ev.pid === this.youId) {
        const wx = ev.x, wz = -ev.z;
        const y = this.terrain.heightAt(wx, wz) + (ev.y || 0) + 3;
        damageNumber(this.scene, this.effects, new THREE.Vector3(wx, y, wz), ev.v, { big: true });
        comicPop(this.scene, this.effects, wx, y + 2, wz, { big: false, hue: 28 });
        this.hud.hitmark?.();
      }
    } else if (ev.e === 'buy') {
      if (ev.pid === this.youId && ev.lvl != null) {
        const abName = ev.item?.startsWith?.('ab:') && this.ch
          ? heroAbility(this.ch, ev.item.slice(3), ev.lvl)?.name || heroWeapon(this.ch, ev.item.slice(3), ev.lvl)?.name
          : null;
        this.hud.feed?.(`⬆️ ${abName || ECON.UPGRADES[ev.item]?.name || ev.item} Lv.${ev.lvl}`);
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

  // ---------------- 三機小隊:主視野接管 ----------------
  /**
   * 伺服器是主視野的唯一決定者(死亡自動讓位 / V 鍵手動切換)。
   * 接管 = 座艙瞬移到新座機的伺服器座標(e.y 是離地高度),舊座機交還給僚機 AI 渲染。
   */
  _takeOver(ent, e) {
    if (!e.act) { ent.isSelf = false; ent._snapPos = true; return; }
    for (const o of this.ents.values()) {
      if (o.hero && o.isSelf && o !== ent) { o.isSelf = false; o._snapPos = true; }
    }
    ent.isSelf = true;
    const wx = e.x, wz = -e.z;
    this.pos.set(wx, this.terrain.heightAt(wx, wz) + (e.y ?? 0), wz);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.yaw = e.ry ?? this.yaw;
    this.firing = false;
    this._crashSent = false;
    this.trauma = 0.35;
    this.hud.feed?.(`🔀 主視野切換至 ${(e.si ?? 0) + 1} 號機`);
  }

  /** 切換主視野(V 循環 / 1~3 直選);實際換機由伺服器裁決 */
  _swapDrone(i) {
    if (!this.isDrone || !this.side) return;
    this.net.send(i == null ? { t: 'swap' } : { t: 'swap', i });
  }

  /**
   * 準星鎖定:瞄準中把準星掃到的敵方單位回報伺服器(自爆衝刺的目標)。
   * 只送變化與心跳,避免每幀灌訊息。
   */
  _tickLock(now) {
    if (!this.isDrone || this.dead || !this.aiming || this.shopOpen) return;
    if (now - (this._lockAt || 0) < 0.25) return;
    this._lockAt = now;
    const { ent } = this._resolveAim(600);
    if (!ent || ent.side === this.side || ent.neutral) return;
    this.net.send({ t: 'lock', id: ent.id });
    if (this._lockId !== ent.id) {
      this._lockId = ent.id;
      this.hud.feed?.(`🎯 鎖定 ${UNITS[ent.kind]?.name || ent.kind}(F 自爆 → 僚機衝刺)`);
    }
  }

  // ---------------- 自身死亡 / 重生 ----------------
  _onSelfDeath() {
    this.dead = true;
    this.firing = false;
    this.aiming = false;
    // 商店保持開啟(陣亡購物):死亡畫面疊在商店下層,B/ESC 仍可開關
    document.exitPointerLock?.();
  }
  _onSelfRespawn() {
    this.dead = false;
    this._spawnAt();
    this.vel.set(0, 0, 0);
    // 重生滿彈、重武器 CD 清空
    for (const [id, st] of Object.entries(this.wstate)) { st.ammo = this.wdef[id]?.mag ?? st.ammo; st.reloadEnd = 0; }
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
      money: this.money, upg: this.upg,
      ch: this.ch, ab: { ...this.abil }, kn: this.kn,
      kind: this.heroKind, atBase: this._atBase(),
      buy: (item) => this.net.send({ t: 'buy', item }),
    };
  }

  _toggleShop(force) {
    if (!this.side) return;   // 死亡不擋:重生等待也能購買
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
    // 變形機甲:重生一律地面型態
    if (this.isMorph) {
      this.flight = false;
      this.charge = 0;
      this.baseFov = UNITS.morph.fov;
    }
  }

  // ---------------- 變形機甲:型態切換(蓄力彈射 ↔ 觸地變形)----------------
  /** 地面型 → 飛行型:蓄力彈射(初速 ∝ 蓄力比例),FOV 拉廣 */
  _morphLaunch(gy) {
    this.flight = true;
    this.vel.y = MORPH.JUMP_V * this.charge;
    this.vy = 0;
    this.pos.y = gy + 1.0;   // 抬離地表,避免下一幀立即觸發觸地變形
    this.charge = 0;
    this.baseFov = UNITS.morph.fovAir;
    this.trauma = Math.min(1, this.trauma + 0.4);
    shockRing(this.scene, this.effects, this.pos.x, gy, this.pos.z, 7, 0xffd27a);
    this.hud.feed?.('🛫 蓄力彈射:變形為飛行型態!(觸地變形回地面型)');
  }

  /** 飛行型 → 地面型:觸地變形 */
  _morphLand(gy) {
    this.flight = false;
    this.pos.y = gy;
    this.vy = 0;
    this.vel.y = 0;
    this.baseFov = UNITS.morph.fov;
    this.trauma = Math.min(1, this.trauma + 0.3);
    shockRing(this.scene, this.effects, this.pos.x, gy, this.pos.z, 5, 0x9adfff);
    this.hud.feed?.('🦿 觸地變形:地面型態!(按住 Space 蓄力跳返回飛行)');
  }

  // ---------------- 射擊(彈道學:初速 mv + 重力 9.81,射程上限)----------------
  /** 目前武器:平時 = 輕武器,按住右鍵瞄準 = 重武器(CD 型) */
  _curWeapon() {
    const id = this.aiming && this.wdef.heavy ? 'heavy' : 'light';
    return { id, def: this.wdef[id], st: this.wstate[id] };
  }

  /** 填彈:R 鍵手動 / 打空自動(重武器的「填彈」= CD);完成在 _tickWeapons 補滿 */
  _startReload(id) {
    const wid = id || this._curWeapon().id;
    const def = this.wdef[wid], st = this.wstate[wid];
    if (!def || !st || st.reloadEnd > 0 || st.ammo >= def.mag) return;
    st.ammo = 0;
    st.reloadEnd = performance.now() / 1000 + def.reload;
    if (this.net) this.net.send({ t: 'reload', w: wid });
    this.hud.feed?.(wid === 'heavy' ? `⏳ ${def.name} 冷卻中…` : `🔄 ${def.name} 填彈中…`);
  }

  /**
   * 換彈夾動作(疊加在 gunGroup 上,無獨立手臂模型,用現有槍身/槍管代理呈現):
   * p 為填彈進度 0→1,依武器機構分類給不同動作曲線。
   */
  _reloadAnimOffset(def, p) {
    const swing = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI); // 0→1→0,填彈完歸零
    if (def?.type === 'beam') return { dz: swing * 0.4, dy: 0, rx: 0 };        // 能量武器:整管後拉充能
    if (def?.type === 'launcher') return { dz: 0, dy: 0, rx: -swing * 0.5 };   // 發射器:上掀開膛裝填
    return { dz: 0, dy: -swing * 0.22, rx: swing * 0.12 };                     // 槍械:退彈匣再扣回
  }

  _tickWeapons(now) {
    for (const [id, st] of Object.entries(this.wstate)) {
      if (st.reloadEnd > 0 && now >= st.reloadEnd) {
        st.ammo = this.wdef[id]?.mag ?? st.ammo;
        st.reloadEnd = 0;
      }
    }
  }

  /** 準星射線命中解析:回傳 { point, ent, missileId }(共用:beam 直擊 / 招式落點) */
  _resolveAim(far) {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = far;
    const targets = [];
    for (const ent of this.ents.values()) {
      if (ent.side !== this.side && ent.mesh.visible) targets.push(ent.mesh);
    }
    const missileMeshes = [];
    for (const [mid, ms] of this.samMeshes) { ms.mesh.userData.missileId = mid; missileMeshes.push(ms.mesh); }
    // 只對單位/飛彈與地形網格做 raycast(地貌植被是純視覺,不擋子彈也不吃效能)
    const hits = this.raycaster.intersectObjects([...targets, ...missileMeshes, this.terrain.mesh], true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.kind && o.userData.missileId == null && o.parent) o = o.parent;
      if (o && o.userData.missileId != null) return { point: h.point, ent: null, missileId: o.userData.missileId };
      if (o && o.userData.kind) return { point: h.point, ent: [...this.ents.values()].find((en) => en.mesh === o), missileId: null };
      return { point: h.point, ent: null, missileId: null };   // 地形
    }
    return { point: this.raycaster.ray.at(far, new THREE.Vector3()), ent: null, missileId: null };
  }

  /** 命中回饋:星爆 + 準星標記 + 本地估算傷害數字(伺服器仍是權威) */
  _hitFeedback(def, ent, point) {
    this.hud.hitmark?.();
    starburst(this.scene, this.effects, point.x, point.y, point.z, 2.6, 0xfff2b8);
    if (ent) {
      const mult = vsMult(def, ent.kind);
      const est = Math.round(def.dmg * mult * (1 + (this.upg.dmg || 0) * ECON.UPGRADES.dmg.step));
      damageNumber(this.scene, this.effects,
        point.clone().add(new THREE.Vector3(0, 1.2, 0)), est, { big: mult >= 1.5 });
    }
  }

  _tryFire(now) {
    if (!this.side || this.dead || !this.firing || this.shopOpen || !this.ch) return;
    if (this.empLeft > 0) {
      if (now - (this._empWarnAt || 0) > 1.5) { this._empWarnAt = now; this.hud.feed?.('⚡ 武器離線(遭電磁癱瘓)!'); }
      return;
    }
    const { id, def, st } = this._curWeapon();
    if (!def || !st) return;
    if (now - (this.lastFireAt[id] || 0) < 1 / def.rate) return;
    if (st.reloadEnd > 0) return;                       // 填彈 / 冷卻中
    if (st.ammo <= 0) { this._startReload(id); return; } // 打空自動填彈
    this.lastFireAt[id] = now;
    st.ammo--;
    if (st.ammo <= 0) this._startReload(id);

    // 槍口與射向(座艙槍管末端,世界座標)
    this.camera.updateMatrixWorld();
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const muzzle = this.gunGroup
      ? this.gunGroup.localToWorld(this._muzzle.clone())
      : this.camera.position.clone().add(dir.clone().multiplyScalar(2));

    // 後座力:視角上踢 + 隨機偏擺 + 槍身後坐 + 槍口焰;重武器踢更大;無人機吃反作用力後推
    const heavyKick = id === 'heavy' ? 3 : 1;
    const fly = this._flying();
    this.recoil.p += (fly ? 0.0075 : 0.011) * heavyKick;
    this.recoil.y += (Math.random() - 0.5) * 0.006 * heavyKick;
    this.trauma = Math.min(1, this.trauma + 0.06 * heavyKick);
    this.weaponKick = 1;
    this.flash.visible = true;
    this._flashTtl = 0.045;
    if (fly) this.vel.addScaledVector(dir, -0.9 * heavyKick);
    else if (id === 'heavy') this.vel.addScaledVector(dir, -6);

    if (def.type === 'beam') {
      // 定向能:光速直擊(無彈道下墜),仍受射程限制
      const { point, ent, missileId } = this._resolveAim(def.range);
      this._tracer(muzzle, point, this.side === 'SWARM' ? 0xa8fff2 : 0xd2b8ff);
      this.net.send({ t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z], to: [point.x, point.y, point.z] });
      if (missileId != null) { this.net.send({ t: 'hitMissile', id: missileId, w: id }); this._hitFeedback(def, null, point); }
      else if (ent) { this.net.send({ t: 'hit', id: ent.id, w: id }); this._hitFeedback(def, ent, point); }
      return;
    }

    // 彈道學子彈:初速 mv(真實參數)+ 重力下墜;超出射程即失效(FPS/DOTA 射程上限)
    const aoe = def.type === 'launcher';
    const mesh = aoe
      ? this._bombMesh(0x50585f)
      : new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 1.4),
        new THREE.MeshBasicMaterial({ color: this.side === 'SWARM' ? 0xffd24a : 0x7fd8ff }),
      );
    if (!aoe) this.scene.add(mesh);
    mesh.position.copy(muzzle);
    this.bullets.push({
      slot: id, aoe, r: def.r || 0,
      pos: muzzle.clone(), vel: dir.clone().multiplyScalar(def.mv || 600),
      dist: 0, max: def.range, mesh,
    });
    // 其他客戶端的槍口視覺(對方不模擬我的彈道,給一條短曳光示意射向)
    this.net.send({
      t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z],
      to: [muzzle.x + dir.x * 60, muzzle.y + dir.y * 60, muzzle.z + dir.z * 60],
    });
  }

  /** 彈道模擬:逐幀積分 + 線段 raycast(高初速子彈一幀飛 10m+,用線段補內插) */
  _updateBullets(dt) {
    if (!this.bullets.length) return;
    const targets = [];
    for (const ent of this.ents.values()) {
      if (ent.side !== this.side && ent.mesh.visible) targets.push(ent.mesh);
    }
    for (const [mid, ms] of this.samMeshes) { ms.mesh.userData.missileId = mid; targets.push(ms.mesh); }
    targets.push(this.terrain.mesh);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const prev = b.pos.clone();
      b.vel.y -= BALLISTIC.G * dt;                    // 重力下墜(拋物線彈道)
      b.pos.addScaledVector(b.vel, dt);
      const seg = b.pos.clone().sub(prev);
      const len = seg.length();
      b.dist += len;
      let hit = null;
      if (len > 0.01) {
        this.raycaster.set(prev, seg.clone().normalize());
        this.raycaster.far = len + 0.3;
        const hits = this.raycaster.intersectObjects(targets, true);
        for (const h of hits) {
          let o = h.object;
          while (o && !o.userData.kind && o.userData.missileId == null && o.parent) o = o.parent;
          if (o && o.userData.missileId != null) { hit = { point: h.point, missileId: o.userData.missileId }; break; }
          if (o && o.userData.kind) { hit = { point: h.point, ent: [...this.ents.values()].find((en) => en.mesh === o) }; break; }
          hit = { point: h.point, terrain: true };
          break;
        }
      }
      const done = hit || b.dist >= b.max;
      if (!done) {
        b.mesh.position.copy(b.pos);
        if (!b.aoe) b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), seg.normalize());
        continue;
      }
      this.scene.remove(b.mesh);
      this.bullets.splice(i, 1);
      const p = hit?.point || b.pos;
      const def = this.wdef[b.slot];
      if (b.aoe) {
        // 發射器:著彈點回報伺服器結算範圍傷害(直擊/落地/射程終點皆引爆)
        const gy = this.terrain.heightAt(p.x, p.z);
        const by = Math.max(p.y, gy + 1);
        this._explosion(p.x, by, p.z, (b.r || 12) * 0.8, 0xffaa33);
        this._applyBlast(p.x, by, p.z, b.r || 12);   // 太近開砲,自己也會被衝擊波掀飛
        this.net.send({ t: 'burst', x: p.x, z: -p.z });   // three z 南 → 模擬 z 北
      } else if (hit?.missileId != null) {
        this.net.send({ t: 'hitMissile', id: hit.missileId, w: b.slot });
        this._hitFeedback(def, null, p);
      } else if (hit?.ent) {
        this.net.send({ t: 'hit', id: hit.ent.id, w: b.slot });
        this._hitFeedback(def, hit.ent, p);
      } else if (hit?.terrain) {
        starburst(this.scene, this.effects, p.x, p.y, p.z, 1.2, 0xcfc4a8);   // 打土塵
      }
    }
  }

  // ---------------- 招式(Q 小招 / E 大招:解鎖 + CD + 電力,伺服器結算)----------------
  _castAbility(slot) {
    if (!this.side || this.dead || this.shopOpen || !this.ch) return;
    const lvl = this.abil[slot] || 0;
    const A = lvl ? heroAbility(this.ch, slot, lvl) : heroAbility(this.ch, slot, 1);
    if (!lvl) { this.hud.feed?.(`🔒【${A.name}】尚未解鎖(B 商店:${PROG[slot].kills[0]} 擊殺 + $${PROG[slot].cost[0]})`); return; }
    const cdLeft = this.cds[slot === 'skill' ? 0 : 1] || 0;
    if (cdLeft > 0) { this.hud.feed?.(`⏳【${A.name}】冷卻中(${cdLeft.toFixed(0)}s)`); return; }
    if (this.mp < A.mp) { this.hud.feed?.(`🔋 電力不足(【${A.name}】需 ${A.mp} MP)`); return; }
    if (this.empLeft > 0) { this.hud.feed?.('⚡ 系統離線(遭電磁癱瘓),無法施放!'); return; }
    // 指向型招式:準星與地形/單位交點為目標落點(超程由伺服器夾回射程)
    let x = this.pos.x, z = this.pos.z;
    if (A.range) {
      const { point } = this._resolveAim(Math.max(A.range * 1.4, 200));
      x = point.x; z = point.z;
    }
    this.net.send({ t: 'cast', slot, x: Math.round(x * 10) / 10, z: Math.round(-z * 10) / 10 });
    // 突進:位移本就客戶端權威,樂觀立即生效(CD/MP 伺服器把關)
    if (A.fx === 'dash') {
      const look = this.camera.getWorldDirection(new THREE.Vector3());
      if (!this._flying()) { look.y = 0; look.normalize(); this.vy = (this.vy ?? 0) + 5; }
      this.vel.addScaledVector(look, A.imp || 30);
      this.trauma = Math.min(1, this.trauma + 0.3);
    }
  }

  /** 重武器冷卻(HUD 顯示) */
  _burstCdLeft() {
    if (!this.side) return 0;
    const st = this.wstate.heavy;
    if (!st || st.reloadEnd <= 0) return 0;
    return Math.max(0, st.reloadEnd - performance.now() / 1000);
  }

  /** 瞄準模式(按住右鍵):拉近視角、切換重武器(伺服器另行把關開火權限) */
  _setAiming(on) {
    if (!this.side || this.aiming === on) return;
    this.aiming = on;
    this.net.send({ t: 'aim', on });
  }

  /** 無人機自爆(F 鍵原地 / 高速撞擊):伺服器結算傷害並擊毀座機 */
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

  /** HUD 資料:輕/重武器 / 招式 / 資源(彈藥為本地 HUD,與伺服器小幅漂移是 by design) */
  _weaponHud() {
    if (!this.side || !this.ch) return null;
    const now = performance.now() / 1000;
    const c = CHARACTERS[this.ch];
    const slotHud = (id) => {
      const def = this.wdef[id], st = this.wstate[id];
      if (!def || !st) return null;
      return {
        name: def.name, lvl: this.abil[id], ammo: st.ammo, mag: def.mag,
        reload: st.reloadEnd > 0 ? Math.max(0, st.reloadEnd - now) : 0,
      };
    };
    const abHud = (slot, idx) => {
      const lvl = this.abil[slot] || 0;
      const A = heroAbility(this.ch, slot, lvl || 1);
      return { name: A.name, lvl, cd: this.cds[idx] || 0, mp: A.mp, ready: lvl > 0 && (this.cds[idx] || 0) <= 0 && this.mp >= A.mp };
    };
    return {
      money: this.money, atBase: this._atBase(),
      code: c.code, machine: c.machine, aiming: this.aiming,
      light: slotHud('light'), heavy: slotHud('heavy'),
      skill: abHud('skill', 0), ult: abHud('ult', 1),
      sp: this.sp, msp: this.maxSp, mp: this.mp, mm: this.maxMp,
      kn: this.kn, emp: this.empLeft, stealth: this.stealthLeft,
      bomb: this.isDrone,
      morph: this.isMorph ? { flight: this.flight, charge: this.charge } : null,
    };
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

    if (this._flying()) {
      // FPV 3D 操作:2D 按鍵(W/S)沿「視線方向」飛 — 抬頭爬升、低頭俯衝;
      // A/D 水平橫移;Space/C 純垂直(懸停微調)。變形機甲飛行型態用 fly 巡航速度。
      const spd = this.isMorph ? u.fly : u.speed;
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
      if (target.lengthSq() > 0) target.normalize().multiplyScalar(spd * boost);
      if (this.keys.Space) target.y += u.vspeed;
      if (this.keys.KeyC || this.keys.ControlLeft) target.y -= u.vspeed;
      this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * 4);
      this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * 4);
      this.vel.y += (target.y - this.vel.y) * Math.min(1, dt * 4);
      this.pos.addScaledVector(this.vel, dt);
      const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
      // 無人機不貼地(下限 +2.5);變形機甲允許降到地表 → 觸地即變形回地面型
      this.pos.y = Math.max(gy + (this.isMorph ? 0 : 2.5), Math.min(gy + 320, this.pos.y));
      if (this.isMorph && this.pos.y <= gy + MORPH.LAND_M) this._morphLand(gy);
      // FPV 側傾:橫移/轉向時機身壓坡度
      const lat = this.vel.x * right.x + this.vel.z * right.z;
      this.roll += (-lat / spd * 0.16 - this.roll) * Math.min(1, dt * 5);
    } else {
      // 機甲:貼地 + 跳躍;this.vel 是爆炸/後座的擊退速度(地面摩擦快速衰減)
      // 變形機甲蓄力中重心下沉、移動減速(起跳預備動作,mobility_plan Task 2.1)
      const slowK = this.isMorph ? 1 - 0.6 * this.charge : 1;
      this.pos.addScaledVector(move, u.speed * boost * this._zoneSlow() * slowK * dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      const fr = Math.exp(-dt * 6);
      this.vel.x *= fr; this.vel.z *= fr; this.vel.y = 0;
      const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.vy = this.vy ?? 0;
      const onGround = this.pos.y <= gy + 0.05;
      if (this.isMorph) {
        // 蓄力跳:按住 Space 蓄力 → 放開時蓄力足夠即彈射變形為飛行型,不足只是小跳
        if (onGround && this.keys.Space) {
          this.charge = Math.min(1, this.charge + dt / MORPH.CHARGE_S);
        } else if (this.charge > 0) {
          if (onGround && this.charge >= MORPH.JUMP_MIN) this._morphLaunch(gy);
          else if (onGround) { this.vy = u.jump; this.charge = 0; }
          else this.charge = 0;
        }
      } else if (onGround && this.keys.Space) {
        this.vy = u.jump;
      }
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

    // 蓄力中重心下沉(起跳預備:鏡頭跟著蹲)
    const eye = this._flying() ? 0 : 3.4 - (this.isMorph ? this.charge * MORPH.CROUCH_M : 0);
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
    this._tickLock(now);
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
   * 最近的可見敵方單位(0.25s 快取)。純視覺:只用來轉砲塔 / 讓 NPC 面向交戰方向,
   * 命中與鎖定一律以伺服器為準(見 CLAUDE.md:server-authoritative)。
   */
  _nearestEnemy(ent, now, range, structs = false) {
    if (!ent._aimNext || now >= ent._aimNext) {
      ent._aimNext = now + 0.25;
      let best = null, bestD = range;
      const tp = ent.mesh.position;
      for (const o of this.ents.values()) {
        if (!o.side || o.side === ent.side || o.neutral || o.dead) continue;
        if (o.isStatic && !structs) continue;   // 塔:只追單位;小兵:也會打建築
        if (!o.mesh.visible && !o.isSelf) continue;
        const p = o.mesh.position;
        const d = Math.hypot(p.x - tp.x, p.z - tp.z);
        if (d < bestD) { bestD = d; best = o; }
      }
      ent._aimTarget = best;
    }
    const t = ent._aimTarget;
    return t && this.ents.has(t.id) ? t : null;
  }

  /**
   * 防禦塔砲塔追蹤(計畫 Task 2.2):0.25s 挑一次最近敵目標,
   * 每幀平滑轉向(不瞬移),俯仰夾在 -30°~+60° 機械極限;無目標慢速掃描。
   */
  _aimTurret(ent, dt, now) {
    const tur = ent.mesh.userData.turret;
    if (!tur) return;
    const t = this._nearestEnemy(ent, now, UNITS.tower.sam.range);   // 追蹤半徑同防空飛彈射程
    let wantYaw, wantPitch;
    if (t) {
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
      const px = cur.x, pz = cur.z, pyaw = ent.mesh.rotation.y;
      let nx, nz, snapped = false;
      if (ent._snapPos) {
        nx = ent.tgt.x; nz = ent.tgt.z;
        ent._snapPos = false;
        snapped = true;
        ent.loco = null;   // 重生瞬移:骨架動畫狀態歸零,不殘留舊速度
      } else {
        const k = Math.min(1, dt * 9);
        nx = cur.x + (ent.tgt.x - cur.x) * k;
        nz = cur.z + (ent.tgt.z - cur.z) * k;
      }
      const gy = this.terrain.heightAt(nx, nz);
      const ny = (ent.hero || ent.flies) ? gy + ent.heroY : gy;
      // 朝向:平滑轉向(mobility_plan:8Hz 快照的方位跳變不直接進畫面)
      let wantYaw = null;
      if (ent.hero) {
        // ry 是「相機朝向」慣例(前方 = -z),機體模型一律朝 +z(見 buildRobotMech 腳尖/駕駛艙)
        // → 直接套用會讓所有英雄(含 bot)倒著走。差 π。
        wantYaw = ent.ry + Math.PI;
      } else {
        // NPC 沒有伺服器方位,靠插值殘差推朝向。殘差 ≈ 速度/插值增益(小兵 6 m/s → 僅 0.7m),
        // 門檻設 0.5(距離平方)等於永遠不轉向 — 全場小兵一律朝 +z。改用 0.2m 門檻。
        const dx = ent.tgt.x - cur.x, dz = ent.tgt.z - cur.z;
        if (dx * dx + dz * dz > 0.04) wantYaw = Math.atan2(dx, dz);
        else {
          // 停止 = 交戰中(sim:有目標就不前進):面向最近的敵人
          const t = this._nearestEnemy(ent, now, UNITS[ent.kind]?.range || 0, true);
          if (t) {
            const p = t.isSelf ? this.pos : t.mesh.position;
            wantYaw = Math.atan2(p.x - cur.x, p.z - cur.z);
          }
        }
      }
      if (wantYaw != null) {
        if (snapped) ent.mesh.rotation.y = wantYaw;
        else {
          const dy = Math.atan2(Math.sin(wantYaw - pyaw), Math.cos(wantYaw - pyaw));
          ent.mesh.rotation.y = pyaw + dy * Math.min(1, dt * 8);
        }
      }
      cur.set(nx, ny, nz);
      // 程序化骨架動畫:實際位移驅動步態/輪速/壓坡(locomotion.js)
      stepLocomotion(ent, dt, now, px, pz, pyaw);
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
    this._updateBullets(dt);
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
      if (cur.def && cur.st && cur.st.reloadEnd > 0) {
        const p = 1 - Math.max(0, cur.st.reloadEnd - now) / cur.def.reload;
        reloadOff = this._reloadAnimOffset(cur.def, p);
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
    this.cutin?.dispose();
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
