// ============ 建模版本註冊表(機體展示台唯一縫;dev-only)============
// 支援本專案 (steel_vs_swarm)、steel_v_swarm (Godot)、argon blender vfx (Blender 高精) 三版本比對。
//
// 版本收成**一張表**:一列 = 一個版本(標籤 + 能力旗標 + 怎麼建 + 結構欄怎麼印),
// 展示台只認下面這份「台上單位」契約,一行 `if (版本 === …)` 都沒有。
//
// **台上單位契約**(每個版本的 build() MUST 回這個形狀):
//   { group, rig, joints: Group[], spin: Object3D[], doll: index|null,
//     dolls: {ground, flight}|null, morph: 把手|null, playAction?: fn, update?: fn }
//   ・`dolls` 只有「一台兩格」的版本有:換型態時看板只把 `doll` 指到台上那一棵,
//     **不重鍛**(重鍛會把 locomotion 的型態狀態一起丟掉 = 變形演出變成瞬切)。
//   ・`joints` 是**陣列**:變形者兩棵樹各有一組樞軸點(單樹的版本就是一組)。
//   ・`morph` = locomotion.js `morphSwap` 認的那一格(`group.userData.morph`);
//
// 三條紀律:
//   ① **建構只有這裡一份**:viewer.js MUST NOT 直接呼叫 forgeMech / forgeMorphUnit /
//      buildLegacyUnit —— 那就是第二份「這個版本怎麼建」的規則。
//   ② **變形者一律建兩棵樹**(forgeMorphUnit):只建選中那一格的話,台上根本沒有另一個
//      型態可以變過去,而「看變形過程」就退化成「換一格重新鍛一台」。
//   ③ **能力旗標是宣告的不是問出來的**:編輯/武器頁/樞軸點能不能用寫在這張表上,
//      MUST NOT 由 viewer 去嗅探 `unit.doll == null` 之類的副作用推回來。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  forgeMech, forgeMorphUnit, mergeSpec, specOf,
} from '../../public/js/forge/forge.js';
import { entryKey } from '../../public/js/forge/roster.js';
import { dollFinish } from './dollfinish.js';
import { buildLegacyUnit, legacyKindOf } from './legacy/legacy_models.js';

/** 這一格的另一個型態(變形者才有;名冊鍵只有 `entryKey()` 一份,MUST NOT 自己拼 `id_form`) */
export const siblingSpec = (spec) => (spec.form
  ? specOf(entryKey(spec.ch, spec.form === 'flight' ? 'ground' : 'flight'))
  : null);

/** 新版:出廠規格 + 覆寫層 + (選中那一格的)未存檔草稿 → 合併規格 */
const mergeFor = (s, spec, ctx) => {
  const m = mergeSpec(s, ctx.ovrOf(s.id));
  if (s.id === spec.id && ctx.draft) m.doll = ctx.draft;
  return m;
};

function forgeBuild(spec, ctx) {
  const sib = siblingSpec(spec);
  if (spec.form && sib) {
    const G = spec.form === 'ground' ? spec : sib;
    const A = spec.form === 'flight' ? spec : sib;
    const u = forgeMorphUnit(mergeFor(G, spec, ctx), mergeFor(A, spec, ctx), { finish: dollFinish });
    const dolls = { ground: u.ground.doll || null, flight: u.air.doll || null };
    return {
      group: u.group, rig: u.rig, joints: [u.ground.joints, u.air.joints],
      spin: u.spin || [], doll: dolls[spec.form] || null, dolls,
      morph: u.group.userData.morph || null,
    };
  }
  const u = forgeMech(mergeFor(spec, spec, ctx), { finish: dollFinish });
  return {
    group: u.group, rig: u.rig, joints: [u.joints],
    spin: u.spin || u.group.userData.spin || [], doll: u.doll || null, dolls: null, morph: null,
  };
}

const gltfLoader = new GLTFLoader();

export async function loadGlbUnit(verKey, spec) {
  const id = spec.ch || spec.id.split('@')[0];
  const url = `/api/compare/glb?ver=${verKey}&id=${id}`;
  const gltf = await gltfLoader.loadAsync(url);
  const model = gltf.scene;
  const group = new THREE.Group();
  group.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const targetH = spec.height || 6.0;
  const scale = size.y > 0 ? (targetH / size.y) : 1;
  model.scale.setScalar(scale);

  const center = new THREE.Vector3();
  box.getCenter(center);
  model.position.x = -center.x * scale;
  model.position.z = -center.z * scale;
  model.position.y = -box.min.y * scale;

  const mixer = new THREE.AnimationMixer(model);
  const clipsMap = new Map();
  for (const c of gltf.animations || []) {
    clipsMap.set(c.name, c);
  }

  let currentAction = null;
  let activeSlot = 'idle';

  function playAction(slot, { form = spec.form || 'ground', loop = true } = {}) {
    activeSlot = slot;
    let clipName = slot;
    if (form === 'flight') {
      if (clipsMap.has(`flight_${slot}`)) clipName = `flight_${slot}`;
    }
    if (!clipsMap.has(clipName)) {
      if (slot === 'walk' && clipsMap.has('run')) clipName = 'run';
      else if (slot === 'skill' && clipsMap.has('def')) clipName = 'def';
      else if (slot === 'ult' && clipsMap.has('atk')) clipName = 'atk';
    }
    const clip = clipsMap.get(clipName) || clipsMap.get('idle');
    if (!clip) return null;

    const next = mixer.clipAction(clip);
    if (currentAction && currentAction !== next) {
      currentAction.fadeOut(0.12);
    }
    next.reset();
    const isOneShot = !loop || slot === 'heavy' || slot === 'skill' || slot === 'ult' || slot === 'to_flight' || slot === 'to_ground';
    if (isOneShot) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.timeScale = slot === 'walk' ? 0.6 : 1;
    next.fadeIn(0.12).play();
    currentAction = next;
    return next;
  }

  mixer.addEventListener('finished', () => {
    if (['heavy', 'skill', 'ult', 'to_flight', 'to_ground'].includes(activeSlot)) {
      playAction('idle', { form: spec.form, loop: true });
    }
  });

  playAction('idle', { form: spec.form, loop: true });

  const joints = new THREE.Group();
  joints.visible = false;
  group.add(joints);

  return {
    group,
    rig: null,
    joints: [joints],
    spin: [],
    doll: null,
    dolls: null,
    morph: null,
    mixer,
    playAction,
    update: (dt) => mixer.update(dt),
    clips: Array.from(clipsMap.keys()),
    meta: {
      verKey,
      animCount: gltf.animations?.length || 0,
      animations: Array.from(clipsMap.keys()),
    },
  };
}

function makeBannerSprite(text, x, y) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(18, 22, 30, 0.88)';
  ctx.strokeStyle = '#41526b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(4, 4, 376, 64, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7fd8ff';
  ctx.font = 'bold 24px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 192, 36);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, 0);
  sprite.scale.set(4.0, 0.75, 1);
  return sprite;
}

export async function compareBuild(spec, ctx) {
  const uForge = forgeBuild(spec, ctx);
  const uSteel = await loadGlbUnit('steel_v_swarm', spec, ctx);
  const uArgon = await loadGlbUnit('argon_vfx', spec, ctx);

  const group = new THREE.Group();
  const H = spec.height || 6.0;
  const spacing = Math.max(4.8, H * 0.95);

  uForge.group.position.x = -spacing;
  uSteel.group.position.x = 0;
  uArgon.group.position.x = spacing;

  group.add(uForge.group);
  group.add(uSteel.group);
  group.add(uArgon.group);

  group.add(makeBannerSprite('1. 本專案 (程序零件)', -spacing, H * 1.05));
  group.add(makeBannerSprite('2. steel_v_swarm (Godot)', 0, H * 1.05));
  group.add(makeBannerSprite('3. argon blender vfx (高精)', spacing, H * 1.05));

  function playAction(slot, opts = {}) {
    uSteel.playAction?.(slot, opts);
    uArgon.playAction?.(slot, opts);
  }

  function update(dt) {
    uSteel.update?.(dt);
    uArgon.update?.(dt);
  }

  playAction('idle', { form: spec.form, loop: true });

  return {
    group,
    rig: uForge.rig,
    joints: uForge.joints,
    spin: uForge.spin,
    doll: uForge.doll,
    dolls: uForge.dolls,
    morph: uForge.morph,
    playAction,
    update,
    subUnits: [uForge, uSteel, uArgon],
  };
}

function legacyBuild(spec) {
  const lu = buildLegacyUnit(spec.ch, { height: spec.height });
  const joints = new THREE.Group();
  joints.visible = false;
  const group = lu ? lu.group : new THREE.Group();
  group.add(joints);
  return { group, rig: lu?.rig || null, joints: [joints], spin: lu?.spin || [],
    doll: null, dolls: null, morph: null };
}

/** rig 契約欄:每個版本印自己的契約 */
function forgeRigLines(unit, spec) {
  const rig = unit.rig;
  if (!rig) return [['查無 rig(這一格沒建成)', false]];
  if (spec.kind === 'air') return [
    ['tilt(壓坡樞軸)+ tiltY0/bob/top', !!(rig.tilt && rig.tiltY0 != null && rig.top)],
    ['升力系統(旋翼 / 撲翼 / 噴焰)', !!(unit.spin?.length || rig.wings?.length || rig.jets?.length)],
    ['level(定翼巡航不低頭)', rig.level ? true : !rig.level],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ];
  if (spec.kind === 'quad') return [
    ['spine/chest/neck/head', !!(rig.spine && rig.chest && rig.neck && rig.head)],
    ['legFL/FR/HL/HR + ch ×4', !!(rig.legFL && rig.legFR && rig.legHL && rig.legHR
      && rig.chFL?.length && rig.chFR?.length && rig.chHL?.length && rig.chHR?.length)],
    ['tailSegs(尾鞭)', !!(rig.tailSegs && rig.tailSegs.length >= 2)],
    ['gait 參數(stride/top/bob)', !!(rig.stride && rig.top && rig.bob != null)],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ];
  return [
    ['hips/chest/head', !!(rig.hips && rig.chest && rig.head)],
    ['legL/R + legChain ×2', !!(rig.legL && rig.legChainL.length === 2 && rig.legChainR.length === 2)],
    ['armL/R + armChain ×2', !!(rig.armL && rig.armChainL.length === 2 && rig.armChainR.length === 2)],
    ['aimPose(據槍)', !!rig.aimPose],
    ['gunR/gunL(俯仰)', !!(rig.gunR && rig.gunL)],
    ['weap/hvy/kickAmp(後座)', !!(rig.weap && rig.hvy && rig.kickAmp)],
    ['muzzles + wpn(槍口/FPV 同源)', !!(rig.muzzles?.light && rig.muzzles?.heavy && rig.wpn?.light && rig.wpn?.heavy)],
    ['moveSig / castSig(性格層)', !!(rig.moveSig && rig.castSig)],
  ];
}

function glbRigLines(unit, spec, verKey) {
  const name = verKey === 'argon_vfx' ? 'argon blender vfx (高精)' : 'steel_v_swarm (Godot)';
  const clips = unit?.clips || [];
  return [
    [`模型來源: ${name}`, true],
    [`內嵌動作數量: ${clips.length} 個`, clips.length > 0],
    [`基礎步態動作: idle, run`, clips.includes('idle') && clips.includes('run')],
    [`輕/重武器動作: light, heavy`, clips.includes('light') && clips.includes('heavy')],
    [`防守/攻擊招式: skill, ult (atk/def)`, clips.includes('skill') || clips.includes('def')],
    [`護盾收發動作: shield_deploy / retract`, clips.includes('shield_deploy')],
    ...(spec.form ? [[`飛行型態動作: flight_idle / light / heavy`, clips.some((c) => c.startsWith('flight'))]] : []),
  ];
}

function compareRigLines() {
  return [
    ['【1】本專案: public/js/forge/ 程序零件樹 (locomotion.js 步態驅動)', true],
    ['【2】steel_v_swarm: app/steel_v_swarm 戰鬥 GLB (Godot 動作驅動)', true],
    ['【3】argon blender vfx: tools/ai3d 高精 VFX GLB (Blender 動作驅動)', true],
    ['動作同步連動: 點擊巡航/全速/射擊/招式按鈕，三版本機體同步演出', true],
    ['全角度比對: 可按住滑鼠旋轉軌道鏡頭，零死角觀察動態細節差異', true],
  ];
}

/**
 * 版本表。**加一個版本 = 加一列**,展示台一行都不用改。
 *   caps.edit   紙娃娃編輯(要有 doll 索引)
 *   caps.wpn    武器獨立檢視(要有 rig.wpn 同源登記)
 *   caps.joints 樞軸點顯示
 *   pair        變形者建的是兩棵樹(⇒ 換型態不必重鍛;單樹版本靠 rig.pose 自己插值)
 */
export const STAGE_VERSIONS = [
  {
    key: 'forge', label: '本專案', icon: 'verNew',
    tip: '本專案當前實裝 (public/js/forge/ 逐機零件檔)',
    caps: { edit: true, wpn: true, joints: true }, pair: true,
    build: forgeBuild,
    rigLines: forgeRigLines,
  },
  {
    key: 'steel_v_swarm', label: 'steel_v_swarm', icon: 'verSteelV',
    tip: 'C:\\Users\\user\\Documents\\app\\steel_v_swarm (Godot 戰鬥模型)',
    caps: { edit: false, wpn: false, joints: false }, pair: false,
    build: (spec, ctx) => loadGlbUnit('steel_v_swarm', spec, ctx),
    rigLines: (unit, spec) => glbRigLines(unit, spec, 'steel_v_swarm'),
  },
  {
    key: 'argon_vfx', label: 'argon blender vfx', icon: 'verArgon',
    tip: 'C:\\Users\\user\\Documents\\steel_vs_swarm\\tools\\ai3d\\argon blender vfx (Blender 高精 VFX 模型)',
    caps: { edit: false, wpn: false, joints: false }, pair: false,
    build: (spec, ctx) => loadGlbUnit('argon_vfx', spec, ctx),
    rigLines: (unit, spec) => glbRigLines(unit, spec, 'argon_vfx'),
  },
  {
    key: 'compare', label: '三版並排', icon: 'verCompare',
    tip: '本專案 / steel_v_swarm / argon blender vfx 三版本並排同步對照每個動作',
    caps: { edit: false, wpn: false, joints: false }, pair: false,
    build: compareBuild,
    rigLines: compareRigLines,
  },
  {
    key: 'legacy', label: '舊版備援', icon: 'verOld',
    tip: '2026-08-14 退役的舊建模(只在本台看得到;遊戲已全面換成新版)',
    caps: { edit: false, wpn: false, joints: false }, pair: false,
    build: legacyBuild,
    rigLines: (unit, spec) => [
      [`舊版建構器:${legacyKindOf(spec.ch) || '(無)'}`, !!unit.rig],
      [`rig.kind:${unit.rig?.kind || '—'}(舊制變形者 = 單樹 rig.pose)`, !!unit.rig?.kind],
      ['已退役,只在本台對照 —— 遊戲已全面換成新版建模', true],
    ],
  },
];

export const versionOf = (key) => STAGE_VERSIONS.find((v) => v.key === key) || STAGE_VERSIONS[0];
