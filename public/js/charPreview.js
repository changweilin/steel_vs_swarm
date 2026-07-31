// ============ 選角畫面:機體展示台(3D 預覽 + 招式演出)============
// 房間選角時在角色詳情卡裡跑一個獨立的小 Three.js 場景:
//   - 拖曳旋轉機體(idle 時自動慢轉)、滾輪推拉鏡頭
//   - 點武器/招式區塊 → 播放對應的施展動畫(後座/蓄力/衝擊環)
//
// 純展示層:不連伺服器、不碰 sim 狀態,數值一律經 heroWeapon()/heroAbility() 讀取。
// 機體與戰場共用 models.js makeUnit(),所以體型/掛件/剪影與實戰完全一致。
//
// 生命週期:整個 app 只建一個 renderer(WebGL context 稀缺資源),
// setChar() 換機體、start()/stop() 隨 charSection 顯隱開關 rAF。

import * as THREE from 'three';
import { CHARACTERS, UNITS, charKind, heroWeapon, heroAbility } from './data.js';
import { makeUnit, heroTargetH } from './models.js';
import { stepLocomotion, stepCombatFx } from './locomotion.js';
import { updateCelLight } from './toon.js';
import { starburst, shockRing, beamLine, projectileMesh } from './vfx.js';
import { spawnCastFx } from './castfx.js';

const SUN = new THREE.Vector3(0.4, 0.8, 0.4);
const AUTO_SPIN = 0.35;      // idle 自轉角速度 (rad/s)
const IDLE_DELAY = 1.6;      // 放開滑鼠後多久恢復自轉 (s)
// 移動演示(雙擊機體切換):0 → 巡航 / 巡航 → 0 的秒數。
// 機體固定在原點,靠地面網格反向捲動製造跑步機;骨架仍由 locomotion.js 依「實際速度」驅動,
// 所以加速前傾/煞車點頭/步頻耦合與戰場完全同一套演算。
const MOVE = { ACC_S: 1.6, DEC_S: 0.9 };

export class CharPreview {
  /** @param {HTMLCanvasElement} canvas 展示台畫布(尺寸由 CSS 決定) */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);

    const dir = new THREE.DirectionalLight(0xffffff, 2.1);
    dir.position.copy(SUN).multiplyScalar(50);
    this.scene.add(dir, new THREE.HemisphereLight(0xdff1ff, 0x2b2f38, 1.1));

    this.effects = [];
    this.holder = new THREE.Group();     // 招式演出的後座/浮沉都作用在這層,不動 makeUnit 內部骨架
    this.scene.add(this.holder);

    this.unit = null;
    this.charId = null;
    this.height = 6;
    this.fitR = 6;          // 機體包圍球半徑(取景基準)
    this.viewR = 6;         // 目前取景半徑(緩動;施展招式時暫時放大以框住特效)
    this.wantR = 6;         // 目標取景半徑
    this.targetY = 3;
    this.size = new THREE.Vector3(4, 6, 4);

    // 變形者:0=地面型,1=飛行型(直接驅動 rig.pose,略過高度判定)
    this.morphRig = null;
    this.morphM = 0;
    this.morphTarget = 0;

    // 移動演示:speed = 目前地速(m/s);_ent 是餵給 locomotion.js 的假實體(mesh 恆在原點)
    // runMode = 跑步演示三態:'idle' 靜止 / 'slow' 慢速跑 / 'normal' 正常跑(展示台按鍵切換)
    this.moving = false;
    this.runMode = 'idle';
    this.speed = 0;
    this.topSpeed = 0;
    this.travel = 0;
    this.ground = null;
    this.groundCell = 1;
    this._ent = null;
    this.onMove = null;      // (moving, speed) → 外部 HUD(main.js 的狀態徽章)

    // 軌道鏡頭
    this.yaw = Math.PI;      // models.js 機體一律面朝 +z,初始鏡頭擺正面
    this.pitch = 0.18;
    this.dist = 1;
    this.idle = 0;
    this.drag = null;

    this.anim = null;
    this._auto = true;       // 自動取景中(施展招式拉遠 / 待命特寫);手動滾輪後關閉
    this.clock = new THREE.Clock();
    this.running = false;
    this._loop = this._loop.bind(this);

    // 慢速播放:action 走自累加的模擬時鐘(慢速時走得慢),鏡頭/自轉仍吃真實 dt(操作手感不拖慢)
    this.timeScale = 1;
    this.clockT = 0;
    // 鏡頭聚焦點:預設看機體中心,可暫時追蹤移動的砲彈(重武器演出)
    this.focus = new THREE.Vector3(0, this.targetY, 0);
    this.trackObj = null;
    // 虛擬目標(有目標招式 / 重武器 / NPC 攻擊演出對準用);NPC 路徑旗標;跳躍演示狀態
    this.isUnit = false;
    this._jump = null;
    this._buildTargetMarker();

    this._bindInput();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);
  }

  // ---- 機體 ----
  /** @param {string} id 角色 id;@param {string} side 檢視陣營(傭兵隨雇主換色) */
  setChar(id, side) {
    if (this.charId === id && this.unit?.userData.side === side) return;
    this._clearUnit();
    this.charId = id;
    if (!id || !CHARACTERS[id]) return;

    const kind = charKind(id);
    const { group, mixer } = makeUnit(`hero:${kind}`, side, { ring: true, ch: id });
    this.unit = group;
    this.mixer = mixer;
    this.height = heroTargetH(kind, id);
    this.holder.add(group);

    // 變形者:抓 rig(kind==='morph' 才有 pose);兩型態剪影差很大,取景要涵蓋較大者
    const rig = group.userData.rig;
    this.morphRig = rig?.kind === 'morph' ? rig : null;
    this.morphM = 0;
    this.morphTarget = 0;

    // 取景一律用包圍球:無人機「寬 >> 高」,只按身高擺鏡頭會讓旋翼滿出畫面
    if (this.morphRig) this.morphRig.pose(0);
    let box = this._measure();
    if (this.morphRig) {
      this.morphRig.pose(1);
      box = box.union(this._measure());
      this.morphRig.pose(0);   // 回到地面型待命
    }
    this.size = box.getSize(new THREE.Vector3());
    this.targetY = box.getCenter(new THREE.Vector3()).y;
    this.fitR = Math.max(1, this.size.length() / 2);
    this.viewR = this.wantR = this.fitR;
    this.dist = this._fitDist(this.fitR);
    this.holder.position.set(0, 0, 0);
    this.holder.rotation.set(0, 0, 0);

    // 移動演示:巡航速 = 戰場實速(UNITS × 角色 mods),骨架演出才與實戰一致
    this._ent = { id, mesh: group, heroY: 0 };
    this.topSpeed = (UNITS[kind]?.speed || 10) * (CHARACTERS[id].mods?.speed ?? 1);
    this.moving = false;
    this.speed = 0;
    this.travel = 0;
    this.isUnit = false;
    this._resetDemo();
    this._buildGround();
    this.onMove?.(false, 0);
    this._resize();
  }

  /** NPC / 攻擊建築展示台(非英雄:無招式,武器走 WEAPONS/UNITS)。共用同一具 renderer/holder。 */
  setUnit(kind, side, prof = 0) {
    this._clearUnit();
    this.charId = null;
    this.isUnit = true;
    if (!UNITS[kind]) return;
    const mapKind = kind === 'tower' ? 'tower' : kind === 'base' ? `base:${side}`
      : kind === 'bunker' ? 'bunker' : kind === 'civilian' ? 'civ' : `creep:${kind}`;   // 平民 = civ builder(ch=職業)
    const { group, mixer } = makeUnit(mapKind, side, { ch: kind === 'civilian' ? prof : null });
    this.unit = group;
    this.unit.userData.side = side;
    this.mixer = mixer;
    this.morphRig = null; this.morphM = 0; this.morphTarget = 0;
    this.holder.add(group);

    const box = this._measure();
    this.size = box.getSize(new THREE.Vector3());
    this.targetY = box.getCenter(new THREE.Vector3()).y;
    this.height = this.size.y;
    this.fitR = Math.max(1, this.size.length() / 2);
    this.viewR = this.wantR = this.fitR;
    this.dist = this._fitDist(this.fitR);
    this.holder.position.set(0, 0, 0);
    this.holder.rotation.set(0, 0, 0);

    // 單位不做移動演示(徽章隱藏),但保留假實體讓 stepCombatFx/後座在有 rig 時仍作用
    this._ent = { id: kind, mesh: group, heroY: 0 };
    this.topSpeed = 0; this.moving = false; this.speed = 0; this.travel = 0;
    this._resetDemo();
    this._buildGround();
    this.onMove?.(false, 0);
    this._resize();
  }

  /** 換展示對象時清乾淨演出狀態(追蹤運鏡 / 虛擬目標 / 跳躍 / 聚焦點 / 慢速) */
  _resetDemo() {
    this.anim = null;
    this.trackObj = null;
    this._jump = null;
    this.timeScale = 1;
    this.runMode = 'idle';
    this._hideTarget();
    this.focus.set(0, this.targetY, 0);
  }

  /** 地面參考網格:機體不動,網格反向捲動 = 跑步機(唯一的速度視覺線索) */
  _buildGround() {
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
    }
    const cell = Math.max(1, this.fitR * 0.4);
    const n = 28;
    const g = new THREE.GridHelper(cell * n, n, 0x3d7f96, 0x22505f);
    g.material.transparent = true;
    g.material.opacity = 0.55;
    g.material.depthWrite = false;
    this.ground = g;
    this.groundCell = cell;
    this.scene.add(g);
  }

  /** 慢速一致的時間基準:play/_fireCue/castFx 的 t0 一律讀這裡,慢速時 fireFx/heavyFx 才不會漂 */
  _now() { return this.clockT; }

  /** 虛擬目標標記:地面警戒環 + 浮空菱形(敵方紅);預設隱藏,施放有目標招式/攻擊時亮起 */
  _buildTargetMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1.0, 28),
      new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const dia = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42),
      new THREE.MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.65, depthWrite: false }));
    dia.position.y = 1.8;
    g.add(ring, dia);
    g.visible = false;
    g.userData = { dia, ring };
    this.targetMarker = g;
    this.scene.add(g);
  }

  /** 在機體正前方 dist(世界公尺)顯示虛擬目標;回傳其世界座標(供 castFx 的 at) */
  _showTarget(dist) {
    const s = Math.max(1, this.fitR * 0.6);
    const p = this._fwd().multiplyScalar(dist);   // 沿槍口前向(機體實際朝向)
    this.targetMarker.position.set(p.x, 0, p.z);
    this.targetMarker.scale.setScalar(s);
    this.targetMarker.visible = true;
    return this.targetMarker.position.clone();
  }

  _hideTarget() { if (this.targetMarker) this.targetMarker.visible = false; }

  _measure() { this.unit.updateMatrixWorld(true); return new THREE.Box3().setFromObject(this.unit); }

  /** 半徑 r 的包圍球剛好內接於視錐(留邊給浮空/衝擊環) */
  _fitDist(r) {
    const half = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    return r / Math.sin(half) * 1.12;
  }

  /** 變形者:切換地面↔飛行,回傳切換後是否為飛行型(給按鈕更新標籤) */
  toggleMorph() {
    if (!this.morphRig) return false;
    this.morphTarget = this.morphTarget > 0.5 ? 0 : 1;
    this.idle = 0;
    return this.morphTarget > 0.5;
  }

  _clearUnit() {
    this.anim = null;
    if (this.unit) {
      this.holder.remove(this.unit);
      this.unit.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.geometry?.dispose();
          const m = o.material;
          (Array.isArray(m) ? m : [m]).forEach((x) => x?.dispose());
        }
      });
      this.unit = null;
      this.mixer = null;
      this._ent = null;   // loco 狀態綁 mesh,換機體一律重建
    }
    for (const e of this.effects) { this.scene.remove(e.obj); e.dispose?.(); }
    this.effects.length = 0;
  }

  // ---- 招式演出 ----
  /** @param {'light'|'heavy'|'skill'|'ult'} slot */
  play(slot) {
    if (!this.charId) return;
    const id = this.charId;
    const R = this.fitR;
    if (slot === 'light' || slot === 'heavy') {
      const w = heroWeapon(id, slot, 1);
      // 輕武器連射一個彈匣的頭幾發;重武器演出依機制型別分家(_stepHeavy)
      const gap = slot === 'light' ? Math.max(0.09, 1 / (w.rate || 4)) : 0;
      const shots = slot === 'light' ? Math.min(6, w.mag || 6) : 1;
      // 2026-07-18:重武器已取消蓄力,rail 改「短暫線圈旋轉起跳」(RAIL_SPIN 0.5s),不再讀已移除的 w.charge
      const durH = { rail: 1.6, beam: 1.9, plasma: 1.7, missile: 2.2, launcher: 2.2 }[w.type] ?? 1.5;
      this.anim = {
        slot, t: 0, next: 0, fired: 0, shots, gap, w,
        dur: slot === 'light' ? shots * gap + 0.5 : durH,
      };
      // 重武器:進蓄力(rig 的掛點展開/發光 + 據槍蓄力姿,stepCombatFx 與戰場同一條);
      // 各機制在 _stepHeavy 的擊發瞬間切到 fire(反向後座)
      if (slot === 'heavy' && this._ent) this._ent.heavyFx = { phase: 'charge', t0: this._now() };
      // 鏡頭:重武器蓄力/開火期間先定住看機體(wantR=R),砲彈射出後 _stepHeavy 才把鏡頭
      // 交給砲彈(trackObj)並拉遠;輕武器全程維持機體特寫。虛擬目標在正前方供彈道對準。
      this.wantR = R;
      if (slot === 'heavy') { this.anim.aimAt = this._showTarget(this._aimDist(w)); this.anim.wide = { rail: 2.6, missile: 2.4, launcher: 2.4, plasma: 2.0, beam: 1.8 }[w.type] ?? 1.6; }
    } else {
      const a = heroAbility(id, slot, 1);
      // dur 蓋住「蓄勢半拍 + 最長特效壽命 ~2.8s」:取景在演出結束前不縮回
      this.anim = { slot, t: 0, a, fired: 0, dur: slot === 'ult' ? 3.4 : 3.0 };
      // 有目標招式(strike / 有施放距離)→ 前方立虛擬目標,特效落在目標上;自身型(增益/治療/視野)不立標記
      const targeted = (a.range || 0) > 0 || a.fx === 'strike';
      this.anim.at = targeted ? this._showTarget(Math.min(this.fitR * 1.8, this.fitR * 3)) : new THREE.Vector3(0, 0, 0);
      // 施法動作(locomotion stepCastPose;與戰場 'cast' 事件同語意):
      // 指向型(strike/dash/遠端 emp)= 定向動作,其餘 = 全向動作
      if (this._ent) {
        const dir = a.fx === 'strike' || a.fx === 'dash' || (a.fx === 'emp' && a.range > 0) ? 1 : 0;
        this._ent.castFx = { t0: this._now(), slot, dir };
      }
      // 大招法陣/劍氣最大到 ~2.2R + 浮空,取景放大以完整入鏡
      this.wantR = slot === 'ult' ? R * 2.2 : R * 1.5;
    }
    this._auto = true;
    this.idle = 0;
  }

  /** 擊發提示 → rig 戰鬥動畫(stepCombatFx 消費;與戰場 onTracer/onHeavyFire 同語意):
   *  設 fireFx(後座脈衝 + 射姿保持);重武器同時把 heavyFx 從 charge 切到 fire(蓄力反向釋放) */
  _fireCue(heavy) {
    if (!this._ent) return;
    const t0 = this._now();
    this._ent.fireFx = { t0, slot: heavy ? 'heavy' : 'light' };
    if (heavy) this._ent.heavyFx = { phase: 'fire', t0 };
  }

  /** 槍口世界座標(slot 'light'|'heavy'):優先讀 rig.muzzles 錨(models.js 各 builder
   *  登記的實際槍口)—— 光束/焰舌從手上/背上的槍管射出;查無錨退回概略點(機體正前腰高) */
  _muzzle(slot = 'light') {
    const mz = this.unit?.userData?.rig?.muzzles?.[slot];
    // 飛行型態錨照用(與戰場 _entMuzzle 同語意,2026-07-22 對齊):手持機種雙臂前伸、
    // 肩扛機種轉背部,槍口在飛行中一樣朝航向;fxOnly 後向錨才退概略點
    if (mz?.n && !mz.fxOnly) return mz.n.getWorldPosition(new THREE.Vector3());
    const v = new THREE.Vector3(0, this.targetY * 1.15, this.size.z * 0.55);
    return this.holder.localToWorld(v);
  }

  /** 槍口射向(世界座標;機體面朝 +z —— 取 holder 前向,與槍口錨位置無關) */
  _fwd() {
    const a = this.holder.localToWorld(new THREE.Vector3(0, 0, 0));
    return this.holder.localToWorld(new THREE.Vector3(0, 0, 1)).sub(a).normalize();
  }

  /** 目標下彈道距離(世界公尺):虛擬目標擺這、砲彈也飛向這 —— 夾在取景框得住的範圍 */
  _aimDist(w) { return Math.min(Math.max(this.fitR * 2.6, (w?.r || 0) * 2), this.fitR * 3.4); }

  /** 擊發瞬間把鏡頭交給砲彈:trackObj 追蹤點 from→to,鏡頭跟著拉遠;結束緩回機體特寫。
   *  瞬擊武器(rail/beam/plasma/gun)無實體彈 → 建一顆隱形追蹤點模擬「砲彈飛出去」。 */
  _followShell(from, to, dur) {
    const o = new THREE.Object3D();
    o.position.copy(from);
    this.scene.add(o);
    this.trackObj = o;
    this.wantR = this.fitR * (this.anim?.wide || 2.0);
    this.effects.push({
      obj: o, ttl: dur,
      fade: (obj, f) => { obj.position.copy(from).lerp(to, 1 - f); },
      dispose: () => { if (this.trackObj === o) { this.trackObj = null; this.wantR = this.fitR; } },
    });
    return o;
  }

  /**
   * 重武器演出:每種機制一套動作(與實戰同口徑)—
   * rail 蓄力電光→極速光束重後座 / beam 持續穩定光束(emp 附帶控場漣漪)/
   * plasma 扇形焰舌 / missile S 形追蹤俯衝 / launcher 雷射標定 + 上拋俯衝 / gun 蓄力單發。
   * 擊發後鏡頭交給砲彈追遠(_followShell);砲彈落點/光束端點一律對準虛擬目標 A.aimAt。
   */
  _stepHeavy(A, R) {
    const w = A.w;
    const hue = CHARACTERS[this.charId]?.visual?.hue ?? 0xffd27a;
    const m = this._muzzle('heavy');
    const fwd = this._fwd();
    const up = new THREE.Vector3(0, 1, 0);
    const aim = A.aimAt || m.clone().addScaledVector(fwd, this._aimDist(w));

    if (w.type === 'rail') {
      if (A.fired) return;
      const chg = Math.min(1, A.t / 0.5);                            // 線圈旋轉起跳(0.5s;非舊蓄力,已取消)
      this.holder.position.y = -R * 0.03 * chg;                       // 起跳重心下沉
      if (A.t >= (A.spark || 0)) {                                    // 軌道電光聚集
        starburst(this.scene, this.effects, m.x, m.y, m.z, R * (0.06 + chg * 0.14), 0xaef4ff);
        A.spark = A.t + 0.12;
      }
      if (chg >= 1) {
        const end = m.clone().addScaledVector(fwd, R * 7);
        beamLine(this.scene, this.effects, m, end, 0xaef4ff, { ttl: 0.5, w: R * 0.035 });
        starburst(this.scene, this.effects, aim.x, aim.y, aim.z, R * 0.35, 0xffffff);
        this.holder.position.z -= R * 0.2;                            // 極速彈的重後座
        this.holder.rotation.x -= 0.14;
        this._fireCue(true);
        this._followShell(m, aim, 0.55);                              // 鏡頭追極速彈
        A.fired = 1;
      }
    } else if (w.type === 'beam') {
      // 0.25s 起持續 1 秒的穩定輸出:短壽命光束連續刷新 = 駐留光束
      if (A.t >= 0.25 && A.t <= 1.35 && A.t >= (A.tick || 0)) {
        if (!A.tick) { this._fireCue(true); this._followShell(m, aim, 1.1); }   // 首拍 = 擊發
        const end = m.clone().addScaledVector(fwd, R * 5);
        beamLine(this.scene, this.effects, m, end, hue, { ttl: 0.18, w: R * 0.02 });
        starburst(this.scene, this.effects, aim.x, aim.y, aim.z, R * 0.12, hue);
        this.holder.position.z -= R * 0.004;                          // 持續微反壓
        A.tick = A.t + 0.11;
      }
      if (w.emp && !A.fired && A.t >= 0.7) {                          // EMP 附帶:控場癱瘓漣漪
        shockRing(this.scene, this.effects, aim.x, 0, aim.z, R * 1.3, 0xb78aff);
        A.fired = 1;
      }
    } else if (w.type === 'plasma') {
      if (A.fired === 0 && A.t < 0.45) {
        this.holder.position.y = -R * 0.02 * Math.sin(A.t / 0.45 * Math.PI);   // 蓄壓下蹲
      } else if (A.fired === 0) {
        const arc = (w.arc || 15) * Math.PI / 180;                    // 扇形大面積焰舌
        for (let k = -2; k <= 2; k++) {
          const dk = fwd.clone().applyAxisAngle(up, arc * k / 2);
          const end = m.clone().addScaledVector(dk, R * 3.5);
          beamLine(this.scene, this.effects, m, end, 0x7fe8ff, { ttl: 0.35, w: R * 0.05 });
          starburst(this.scene, this.effects, end.x, end.y, end.z, R * 0.2, 0x7fe8ff);
        }
        shockRing(this.scene, this.effects, aim.x, 0, aim.z, R * 2.0, 0x7fe8ff);
        this.holder.position.z -= R * 0.1;
        this._fireCue(true);
        this._followShell(m, aim, 0.5);
        A.fired = 1;
      }
    } else if (w.type === 'missile' || w.type === 'launcher') {
      if (A.fired === 0 && A.t >= 0.4) {
        // 彈體離架:missile = 橫向 S 形獵殺;guided launcher = 上拋再俯衝(雷射標定線)。落點對準 aim。
        const boomPos = aim.clone();
        const T = 1.2;
        const v = boomPos.clone().sub(m);
        const side = fwd.clone().cross(up).normalize();
        // 彈藥同源(2026-07-22):與戰場 FPV/第三人稱同一顆 projectileMesh(+z 朝前),依包圍球定尺
        const proj = projectileMesh(w, { col: hue, hue });
        proj.scale.setScalar(R * 0.09);
        proj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
        proj.position.copy(m);
        this.scene.add(proj);
        const weaving = w.type === 'missile';
        this.trackObj = proj;                                         // 鏡頭跟著飛彈
        this.wantR = R * (A.wide || 2.4);
        this.effects.push({
          obj: proj, ttl: T,
          fade: (o, f, dt2) => {
            const u = 1 - f;                                          // 0→1 沿彈道
            const env = Math.sin(Math.min(1, u) * Math.PI);          // 頭尾貼合直線的擺動包絡
            o.position.copy(m).addScaledVector(v, u)
              .addScaledVector(weaving ? side : up, (weaving ? Math.sin(u * 6 * Math.PI) * 0.5 : 0.45) * R * env);
            starburst(this.scene, this.effects, o.position.x, o.position.y, o.position.z, R * 0.05, 0xd8d8d8);
          },
          dispose: () => { if (this.trackObj === proj) { this.trackObj = null; this.wantR = this.fitR; } },
        });
        if (w.guide) beamLine(this.scene, this.effects, m, boomPos, 0xff5a5a, { ttl: 0.9, w: R * 0.008 });
        this.holder.position.z -= R * 0.06;
        this._fireCue(true);
        // 拋物線槍管仰角(2026-07-22 規則 1 展示台閉環):launcher 出膛切線角回寫 gunPitch
        // (與戰場 game._aimHeavyBarrel 同號約定:仰角向上 = rotation.x 減小;missile 導引不回寫)
        if (!weaving) {
          const rig = this.unit?.userData?.rig;
          const gp = rig?.weap?.heavy === 'L' ? rig?.gunL : rig?.gunR;
          if (gp) {
            gp.aim0 ??= gp.aim;
            gp.aim = gp.aim0 - Math.atan2(v.y + 0.45 * R * Math.PI, Math.hypot(v.x, v.z) || 1);
          }
        }
        A.boomAt = A.t + T;
        A.boomPos = boomPos;
        A.fired = 1;
      } else if (A.fired === 1 && A.t >= A.boomAt) {
        const p = A.boomPos;
        starburst(this.scene, this.effects, p.x, p.y, p.z, Math.max(R * 0.5, (w.r || 0) * 0.5), 0xffaa33);
        shockRing(this.scene, this.effects, p.x, 0, p.z, Math.max(R * 0.9, w.r || 0), 0xffaa33);
        A.fired = 2;
      }
    } else if (A.fired === 0 && A.t >= 0.55) {
      // 動能重砲(gun):蓄力後單發重擊 + 象徵性衝擊環
      starburst(this.scene, this.effects, m.x, m.y, m.z, R * 0.30, 0xffd27a);
      shockRing(this.scene, this.effects, aim.x, 0, aim.z, Math.max(R * 0.9, w.r || 0), 0xffd27a);
      this.holder.position.z -= R * 0.12;
      this.holder.rotation.x -= 0.10;
      this._fireCue(true);
      this._followShell(m, aim, 0.5);
      A.fired = 1;
    } else if (A.fired === 0) {
      this.holder.position.y = -R * 0.02 * Math.sin(A.t / 0.55 * Math.PI);   // 蓄力下蹲
    }
  }

  _stepAnim(dt) {
    const A = this.anim;
    if (!A) return;
    A.t += dt;
    const R = this.fitR;   // 演出尺度綁包圍球:機甲與無人機體型差 3 倍,同一組常數才讀得出來

    if (A.slot === 'light' || A.slot === 'heavy') {
      if (A.slot === 'light') {
        while (A.fired < A.shots && A.t >= A.next) {
          const m = this._muzzle();
          starburst(this.scene, this.effects, m.x, m.y, m.z, R * 0.10, 0xfff2b8);
          // NPC 連射:朝虛擬目標拉曳光(帶輕微散布);英雄輕武器維持原本純槍口焰(不設 aimAt)
          if (A.aimAt) {
            const j = R * 0.12;
            const end = A.aimAt.clone().add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, 0));
            beamLine(this.scene, this.effects, m, end, 0xfff2b8, { ttl: 0.09, w: R * 0.014 });
          }
          this.holder.position.z -= R * 0.02;          // 後座:每發往後推,下面阻尼拉回
          this._fireCue(false);
          A.fired++; A.next += A.gap;
        }
      } else {
        this._stepHeavy(A, R);                          // 重武器:依機制型別分家演出
      }
    } else {
      const isUlt = A.slot === 'ult';
      // 角色專屬演出(castfx.js;與戰場 cast 事件同一套):蓄勢半拍後施放
      if (A.fired === 0 && A.t >= (isUlt ? 0.45 : 0.25)) {
        spawnCastFx(this.scene, this.effects, {
          ch: this.charId, slot: A.slot, lvl: 1, fx: A.a.fx, side: this.unit.userData.side,
          at: A.at || new THREE.Vector3(0, 0, 0),   // 有目標招式 → 落在虛擬目標上
          casterPos: () => new THREE.Vector3(
            this.holder.position.x, this.holder.position.y + this.targetY, this.holder.position.z),
          groundY: () => 0,
          // 展示台的範圍演出夾在取景可框住的尺度內(戰場才用真實半徑);
          // rvCap 連帶夾住 gate/zone/snipe 的「絕對世界公尺下限」
          r: Math.min(A.a.r || R * 1.2, R * (isUlt ? 2.2 : 1.5)),
          rvCap: R * (isUlt ? 2.2 : 1.5),
          dur: A.a.dur, scale: Math.max(this.height, R * 0.8),
        });
        A.fired = 1;
      }
      // 施放姿態:大招浮空 + 慢旋,小招輕彈跳
      const f = Math.min(1, A.t / A.dur);
      const rise = Math.sin(f * Math.PI);
      this.holder.position.y = rise * R * (isUlt ? 0.25 : 0.08);
      if (isUlt) this.holder.rotation.y += dt * 2.4 * rise;
    }

    if (A.t >= A.dur) {
      // 演出結束:未釋放的蓄力態清掉(掛點展開/發光交還阻尼歸位)、收起虛擬目標
      if (this._ent?.heavyFx?.phase === 'charge') this._ent.heavyFx = null;
      this._hideTarget();
      this.anim = null;
    }
  }

  /** 跑步演示三態(展示台按鍵切換):'idle' 靜止 / 'slow' 慢速跑(0.3×)/ 'normal' 正常跑。
   *  慢速沿用 timeScale = action 時鐘減速(骨架步態放慢看細節);回傳設定後的 mode。 */
  setRun(mode) {
    if (mode !== 'idle' && mode !== 'slow' && mode !== 'normal') return this.runMode;
    const prev = this.runMode;
    this.runMode = mode;
    this.moving = mode !== 'idle';
    // 慢速→靜止(反向循環):沿用慢速時鐘 0.3× ⇒「動作也反向」= 慢慢停,而非快速煞停。
    // 停穩後 _stepLoco 立即把時鐘還原 1×(慢速只作用於減速過程本身,不滲進待機/招式演出)。
    this.timeScale = (mode === 'slow' || (mode === 'idle' && prev === 'slow')) ? 0.3 : 1;
    this.idle = 0;
    this.onMove?.(this.moving, this.speed);
    return mode;
  }

  /** 展示台循環三態:dir=+1 正向(靜止→慢速→正常→靜止),dir=-1 反向(靜止→正常→慢速→靜止);
   *  沿用 setRun 這一個縫。點一下正向、點兩下反向。回傳切換後的 mode。 */
  cycleRun(dir = 1) {
    const nxt = dir < 0
      ? { idle: 'normal', normal: 'slow', slow: 'idle' }
      : { idle: 'slow', slow: 'normal', normal: 'idle' };
    return this.setRun(nxt[this.runMode] || 'slow');
  }

  /** 移動演示開關(雙擊機體 / W 鍵便捷鍵):靜止 ↔ 上次的跑速(預設正常);回傳切換後是否在移動 */
  toggleMove() {
    this.setRun(this.moving ? 'idle' : (this.runMode === 'slow' ? 'slow' : 'normal'));
    return this.moving;
  }

  /** 慢速播放切換(0.3×);回傳切換後是否為慢速 —— 保留相容,展示台改走 setRun 三態 */
  toggleSlow() { this.timeScale = this.timeScale < 1 ? 1 : 0.3; return this.timeScale < 1; }

  /** 跳躍演示(仿遊戲 Space):robot/drone 拋物線起跳(驅動 heroY → locomotion stepJumpPose);
   *  變形者 = 蓄力跳彈射變形(對應遊戲的 Space)。 */
  jump() {
    if (this.isUnit) return false;   // NPC/建築不跳
    if (this.morphRig) return this.toggleMorph();
    if (!this._ent || this._jump) return false;
    this._jump = { t: 0, dur: 0.95, peak: this.fitR * 0.7 };
    this.idle = 0;
    return true;
  }

  /** NPC / 攻擊建築武器演出:w = 整形後武器 {name,type,dmg,r,rate,mag,range}。
   *  gun → 連射曳光;launcher/missile/rail → 單發彈道 + 落點爆風,鏡頭追砲彈。一律對準前方虛擬目標。 */
  playUnitWeapon(w) {
    if (!this.unit) return;
    const R = this.fitR;
    const aimPos = this._showTarget(this._aimDist(w));
    if (w.type === 'gun') {
      const rate = w.rate || 4;
      const gap = Math.max(0.08, 1 / rate);
      const shots = Math.min(6, w.mag || 6);
      this.anim = { slot: 'light', t: 0, next: 0, fired: 0, shots, gap, w, dur: shots * gap + 0.6, aimAt: aimPos };
      this.wantR = R;
    } else {
      const durH = { missile: 2.2, launcher: 2.2, rail: 2.2 }[w.type] ?? 1.6;
      this.anim = { slot: 'heavy', t: 0, fired: 0, w, dur: durH, aimAt: aimPos, wide: 2.4 };
      if (this._ent) this._ent.heavyFx = { phase: 'charge', t0: this._now() };
      this.wantR = R;
    }
    this._auto = true;
    this.idle = 0;
  }

  /**
   * 移動演示 + 骨架驅動:速度以不同的加速/減速斜率逼近巡航速(前傾/煞車點頭因此讀得出來),
   * 再把「這一幀走了多遠」餵給 locomotion.js —— 機體其實停在原點,靠假的前一幀座標 pz 造出速度,
   * 所以步頻/輪速/壓坡/變形推進器全部沿用戰場那一套(不另寫一份預覽專用動畫)。
   */
  _stepLoco(dt, now) {
    if (!this._ent) return;
    const top = this.topSpeed;
    const want = this.moving ? top : 0;
    this.speed = want > this.speed
      ? Math.min(want, this.speed + top / MOVE.ACC_S * dt)
      : Math.max(want, this.speed - top / MOVE.DEC_S * dt);
    // 慢速→靜止收尾:停穩(speed 歸零)後把時鐘還原 1×,慢慢停只作用於減速過程本身
    if (!this.moving && this.speed <= 0 && this.timeScale < 1) this.timeScale = 1;
    this.travel += this.speed * dt;
    if (this.ground) this.ground.position.z = -(this.travel % this.groundCell);   // 機體朝 +z → 地面往 -z 捲

    // 變形者:locomotion.js 以「回報高度」推導型態(> 1.2 = 飛行型),與戰場同一條判定
    let hy = this.morphTarget > 0.5 ? 5 : 0;
    // 跳躍演示(robot/drone;morph 走變形不走此路):heroY 拋物線 → stepJumpPose 蹬伸/收腿/落地
    if (this._jump) {
      this._jump.t += dt;
      const f = this._jump.t / this._jump.dur;
      if (f >= 1) { this._jump = null; }
      else {
        hy = Math.max(hy, Math.sin(f * Math.PI) * this._jump.peak);
        if (!this.anim) this.holder.position.y = hy;   // 機體實際離地(無招式時由此主導 y)
      }
    }
    this._ent.heroY = hy;
    // 戰鬥開火/蓄力動畫(與戰場共用 stepCombatFx;fireFx/heavyFx 由招式演出寫入)——
    // MUST 在 stepLocomotion 之前,本幀步態才吃得到射姿/後座/蓄力驅動場
    stepCombatFx(this._ent, now, dt);
    stepLocomotion(this._ent, dt, now, 0, -this.speed * dt, 0);
    if (this.morphRig) {
      this.morphM = this._ent.loco?.morph ?? 0;
      // 飛行型離地懸停(不與招式浮空衝突:招式時 holder.y 由 _stepAnim 主導)
      if (!this.anim) {
        this.holder.position.y = this.morphM * this.fitR * (0.22 + Math.sin(now * 2.4) * 0.04);
      }
    }
    // 旋翼/螺旋槳(game.js spinners 同口徑)
    const spin = this.unit.userData.spin;
    if (spin) for (const p of spin) p.rotation.y += dt * 40;
    this.onMove?.(this.moving, this.speed);
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
        e.dispose?.();
        this.effects.splice(i, 1);
      }
    }
  }

  // ---- 輸入 ----
  _bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
      c.classList.add('grabbing');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.01;
      this.pitch = clamp(this.pitch + (e.clientY - this.drag.y) * 0.006, -0.35, 0.95);
      this.drag = { x: e.clientX, y: e.clientY };
      this.idle = 0;
    });
    const end = (e) => {
      if (!this.drag) return;
      this.drag = null;
      c.releasePointerCapture?.(e.pointerId);
      c.classList.remove('grabbing');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => { this.cycleRun(-1); });   // 雙擊機體 = 反向循環(setRun 內部已觸發 onMove)
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._auto = false;   // 手動縮放後不再自動取景,直到下次施展招式
      this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.12), this.fitR * 0.6, this.fitR * 5);
      this.idle = 0;
    }, { passive: false });
  }

  _resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- 主迴圈 ----
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();   // 丟掉暫停期間累積的時間
    requestAnimationFrame(this._loop);
  }

  stop() { this.running = false; }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const adt = dt * this.timeScale;   // 慢速:action 走 adt、模擬時鐘自累加;鏡頭/自轉仍吃真實 dt
    this.clockT += adt;

    if (this.unit) {
      this.idle += dt;
      if (!this.drag && !this.anim && this.idle > IDLE_DELAY) this.yaw += AUTO_SPIN * dt;

      const wasAnim = !!this.anim;
      this._stepAnim(adt);
      // 招式結束 → 取景回機體特寫;但砲彈仍在追蹤時不搶回(讓 _followShell 的 dispose 收尾)
      if (wasAnim && !this.anim && !this.trackObj) this.wantR = this.fitR;
      // 後座/姿態阻尼回正(招式結束後自然歸位)
      if (!this.anim) {
        this.holder.rotation.y = 0;
        this.holder.rotation.x += (0 - this.holder.rotation.x) * Math.min(1, 8 * adt);
      }
      this.holder.position.z += (0 - this.holder.position.z) * Math.min(1, 9 * adt);
      if (!this.anim && !this._jump) this.holder.position.y += (0 - this.holder.position.y) * Math.min(1, 9 * adt);

      this._stepLoco(adt, this.clockT);

      // 動態取景:施展招式/砲彈飛行時鏡頭拉遠框住,結束緩回;手動滾輪後讓位給玩家
      if (this._auto) {
        this.viewR += (this.wantR - this.viewR) * Math.min(1, 5 * dt);
        this.dist += (this._fitDist(this.viewR) - this.dist) * Math.min(1, 6 * dt);
        if (!this.anim && !this.trackObj && Math.abs(this.viewR - this.fitR) < this.fitR * 0.02) this._auto = false;
      }

      this.mixer?.update(adt);
      this._updateEffects(adt);

      const ty = this.targetY;
      // 聚焦點:預設看機體中心;重武器擊發後暫時追蹤砲彈(_followShell / 飛彈本體)→ 鏡頭跟彈拉遠
      const wf = this.trackObj ? this.trackObj.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, ty, 0);
      this.focus.lerp(wf, Math.min(1, (this.trackObj ? 5 : 4) * dt));
      const cp = Math.cos(this.pitch);
      this.camera.position.set(
        this.focus.x + Math.sin(this.yaw) * cp * this.dist,
        this.focus.y + Math.sin(this.pitch) * this.dist,
        this.focus.z + Math.cos(this.yaw) * cp * this.dist,
      );
      this.camera.lookAt(this.focus);
      this.camera.updateMatrixWorld();
      updateCelLight(this.camera);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    this._ro.disconnect();
    this._clearUnit();
    this.renderer.dispose();
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
