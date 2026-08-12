// ============ 人形特徵 → 機器人零件鍛造(dev-only 原型;不進遊戲)============
// 研究來源:AniCompanion(three-vrm)的 VRM 人形角色技術 —— 「任何模型即插即用、動作可
// 重定向」建立在**所有角色共用同一組標準化人形特徵**(VRM 1.0 必要骨)之上。本原型把同一
// 思路移植到機體制:HUMANOID 特徵表(拓撲固定、比例逐機可調)+ 逐機「特徵 → 零件」轉換。
//
// 2026-08-12 使用者指示(第二輪):每個機型要有獨特細節(關節/胸口/頭部/武器),參考原型
// 資料(mecha.js 原型層 + gen 六欄)與 2D 定案圖(public/assets/cyberpunk_art/mechs/)。
// 2026-08-12 使用者指示(第三輪):**不要只使用簡單的立方體** —— 參考各機體的 2D 圖像,
// 針對身體/四肢/頭部/翅膀/羽毛/尾巴/觸手等生物部位設計各自的多面體/多邊形零件組合,
// 羽毛/尾巴/觸手一律多零件;武器同一套邏輯。分工從此三層:
//   geo.js         多面體零件語彙(楔台/稜柱/旋成體/薄刃鰭片/羽扇/節鏈/纜束)
//   mechs/<id>.js  逐機「特徵 → 零件」檔(一台一檔,對照各自的 2D 定案圖)
//   forge.js       特徵表 + 規格合併 + 鍛造鷹架(本檔;不含任何逐機幾何)
//
// 名冊 = 遊戲真名冊的人形子集(8 台):
//   機甲 4:t01 bastion / t02 seraph / t10 aegis / t12 colossus
//   變形者人形地面型 4(data.js MORPH_HUMANOID):t06 monkey / t11 atlas / m01 vampire / m05 wolf
// 每台的關節「機構語彙」刻意互異(這正是獨特細節的骨幹):
//   t01 外露液壓缸+缸頭環 / t02 雙件式肌腱缸 / t10 全包覆+彈匣筒 / t12 疊板+節端軸環 /
//   t06 裸缸+亮桿芯 / t11 工業液壓+鉚釘 / m01 烤漆蓋板細縫 / m05 圓盤螺栓+外露腱桿。
//
// 單一真相縫:出廠規格 = 本檔 MECH_SPECS;使用者調整 = tools/humanoid_forge/specs.json
// **覆寫層**(只存差異;機體台 /api/forge 寫、兩座檢視台讀),合併只有 mergeSpec() 一份。
//
// 產物仍是本專案 rig 契約的具名 Group 零件樹(kind 'biped'),**刻意不用 SkinnedMesh**
// (docs/ai3d_runbook.md §0 定案)—— 真品 locomotion.js 一行不改直接驅動;
// 掌行(t06 knuckle)/ 趾行(m05 legBase+關節 base)/ 尾配重(tailSegs)全走既有 rig 旗標。
//
// ⚠ 正式整合前的已知欠帳(原型階段刻意容忍,入 public/js 前 MUST 收掉):
//   - geo.js 的 matF/bxF/cylF/segLimbF/outlineWF 鏡射 models.js 未匯出內部函式
//     (models.js:5076/:122/:128/:112/:119)—— 正式整合應改 export 共用,MUST NOT 留兩份。
//   - MOVE_SIG/CAST_SIG 的值抄自 models.js:7544/:7587(未匯出)—— 同上。
//   - 槍口焰(attachMuzzleFlames)未掛;開火演出以 lightGlow / heavy.glow 閃光代替。

import * as THREE from 'three';
import { outlinify } from '/public/js/toon.js';
import { heroPalette } from '/public/js/paint.js';
import { segLimbF, outlineWF } from './geo.js';
import { MECH_DETAIL } from './mechs/index.js';

// ══════════ ① 標準化人形特徵表(對齊 VRM 1.0 必要骨)══════════
// 比例以身高 1.0 正規化;def = 預設值,逐機規格(spec.prop)只覆寫想改的格子,
// 使用者調整(specs.json)再覆寫一層 —— 三層合併只有 mergeSpec()/resolveProp() 一條路。
export const HUMANOID = {
  hips:      { vrm: 'hips',                        def: 0.52 },
  legSplay:  { vrm: 'leftUpperLeg/rightUpperLeg',  def: 0.085 },
  thigh:     { vrm: 'lowerLeg 樞軸(膝)',          def: 0.48 },
  shin:      { vrm: 'foot 樞軸(踝)',              def: 0.44 },
  shoulderY: { vrm: 'upperArm(肩線高)',           def: 0.80 },
  shoulderX: { vrm: 'leftUpperArm/rightUpperArm',  def: 0.16 },
  upperArm:  { vrm: 'lowerArm 樞軸(肘)',          def: 0.155 },
  foreArm:   { vrm: 'hand 樞軸(腕)',              def: 0.14 },
  head:      { vrm: 'head',                        def: 0.875 },
  girth:     { vrm: '(網格量體;VRM 交給模型)',    def: 1.0 },
};

export function resolveProp(spec) {
  const p = {};
  for (const k of Object.keys(HUMANOID)) p[k] = spec.prop?.[k] ?? HUMANOID[k].def;
  return p;
}

/** 覆寫層合併(唯一縫):base = MECH_SPECS 出廠值,ovr = specs.json 那一格。
 *  MUST 恆回**新物件**(含無覆寫時)—— 回傳 base 參照的話,機體台滑桿改的是出廠規格本體,
 *  「與出廠值比對」永遠相等 ⇒ 儲存永遠存成 null(2026-08-12 實測踩過)。 */
export function mergeSpec(base, ovr) {
  return {
    ...base,
    hue: ovr?.hue ?? base.hue,
    prop: { ...base.prop, ...(ovr?.prop || {}) },
    knobs: { ...(base.knobs || {}), ...(ovr?.knobs || {}) },
  };
}

// ══════════ ② 名冊與規格解析(逐機幾何住 mechs/<id>.js)══════════
export const FORGE_IDS = ['t01', 't02', 't10', 't12', 't06', 't11', 'm01', 'm05'];

/** 出廠規格(單一真相;specs.json 只放覆寫) */
export const MECH_SPECS = FORGE_IDS.map((id) => {
  const d = MECH_DETAIL[id];
  return {
    id, label: d.label, hue: d.hue,
    height: 6.0,                       // 展示台統一取景高;正式整合走 heroTargetH
    prop: d.prop, gait: d.gait, knobs: { barrelF: 1, accentF: 1 },
    moveSig: d.moveSig, castSig: d.castSig,
  };
});
// 舊介面相容(檢視台/機體台都以 SPECS 列名冊)
export const SPECS = MECH_SPECS;

/** 特徵 → 零件轉換表(逐機;檢視台/機體台顯示用) */
export function conversionDoc(spec) {
  return (MECH_DETAIL[spec.id]?.doc || []).map(([feat, part]) => ({ feat, part }));
}

/**
 * 鍛造一台人形機體:規格 → 具名 Group 零件樹 + 完整 rig 契約。
 * 回傳 { group, rig, joints }。knobs:barrelF 武器長度倍率 / accentF 發光強度倍率。
 */
export function forgeHumanoidMech(spec) {
  const D = MECH_DETAIL[spec.id];
  if (!D) throw new Error(`未知機型:${spec.id}`);
  const P = resolveProp(spec);
  const H = spec.height;
  const PAL = heroPalette({ hue: spec.hue }, 'STEEL', 'light');
  const accent = new THREE.Color(spec.hue);
  const G = P.girth;
  const K = { barrelF: spec.knobs?.barrelF ?? 1, accentF: spec.knobs?.accentF ?? 1 };

  // 人形特徵 → 世界尺寸(公尺)
  const hipY = P.hips * H;
  const thighL = P.thigh * hipY, shinL = P.shin * hipY;
  const clear = Math.max(0.1, hipY - thighL - shinL);
  const legX = P.legSplay * H * Math.max(1, G * 0.9);
  const shoulderY = P.shoulderY * H, shoulderX = P.shoulderX * H * Math.max(1, G * 0.9);
  const upperArmL = P.upperArm * H, foreArmL = P.foreArm * H;
  const headY = P.head * H;
  const waistYl = 0.12 * H, shoulderYl = shoulderY - hipY, headYl = headY - hipY;

  const g = new THREE.Group();
  const legChainL = [], legChainR = [], armChainL = [], armChainR = [];
  const joints = new THREE.Group();
  joints.visible = false;
  g.add(joints);
  const jointDot = (x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, depthTest: false }));
    m.userData.noOutline = true;
    m.renderOrder = 5;
    m.position.set(x, y, z);
    joints.add(m);
  };

  const baseCtx = { PAL, accent, G, H, K, dark: PAL.dark, binderPivots: [], vlsPorts: [], dims: { shoulderYl, waistYl, shoulderX } };
  const pose = D.pose || {};
  const knee = pose.knee || { base: 0.06, k: 0.62, d: 0.15 };
  const ankle = pose.ankle || { base: 0.02, k: -0.3, d: 0.55 };
  const elbow = pose.elbow || { base: -0.18, k: -0.5, d: 0.3 };
  const wrist = pose.wrist || { base: 0, k: 0.22, d: 0.65 };

  // ---- 下肢(腿掛 g 不掛 hips:骨盆浮沉不帶腿 = 不滑步)----
  const footL = 0.3 + 0.22 * G;
  const mkLeg = (sx) => segLimbF(g, [sx * legX, hipY, 0], [
    { len: thighL, draw: (l) => D.thigh({ ...baseCtx, sx }, l, { len: thighL }) },
    { len: shinL, base: knee.base, k: knee.k, d: knee.d, draw: (l) => D.shin({ ...baseCtx, sx }, l, { len: shinL }) },
    { len: 0, base: ankle.base, k: ankle.k, d: ankle.d, draw: (l) => D.foot({ ...baseCtx, sx }, l, { clear, footL }) },
  ], sx < 0 ? legChainL : legChainR);
  const legL = mkLeg(-1), legR = mkLeg(1);
  jointDot(-legX, hipY, 0); jointDot(legX, hipY, 0);
  jointDot(-legX, hipY - thighL, 0); jointDot(legX, hipY - thighL, 0);
  jointDot(-legX, hipY - thighL - shinL, 0); jointDot(legX, hipY - thighL - shinL, 0);

  // ---- 軀幹三節:hips → chest → head ----
  const hips = new THREE.Group();
  hips.position.y = hipY;
  g.add(hips);
  D.pelvis(baseCtx, hips, { shoulderX });
  const chest = new THREE.Group();
  hips.add(chest);
  D.chest(baseCtx, chest, { shoulderX, shoulderY: shoulderYl, waistY: waistYl });
  const head = new THREE.Group();
  head.position.set(0, headYl, 0.04);
  chest.add(head);
  D.head(baseCtx, head);
  jointDot(0, hipY, 0); jointDot(0, shoulderY, 0); jointDot(0, headY, 0.04);

  // ---- 上肢 ----
  let handL = null, handR = null, foreL = null, foreR = null;
  const mkArm = (sx) => segLimbF(chest, [sx * shoulderX, shoulderYl, 0], [
    { len: upperArmL, draw: (a) => D.armUp({ ...baseCtx, sx }, a, { len: upperArmL }) },
    { len: foreArmL, base: elbow.base, k: elbow.k, d: elbow.d, draw: (a) => { D.armFore({ ...baseCtx, sx }, a, { len: foreArmL }); if (sx < 0) foreL = a; else foreR = a; } },
    { len: 0, base: wrist.base, k: wrist.k, d: wrist.d, draw: (a) => { if (sx < 0) handL = a; else handR = a; } },
  ], sx < 0 ? armChainL : armChainR);
  const armL = mkArm(-1), armR = mkArm(1);
  jointDot(-shoulderX, shoulderY, 0); jointDot(shoulderX, shoulderY, 0);
  jointDot(-shoulderX, shoulderY - upperArmL, 0); jointDot(shoulderX, shoulderY - upperArmL, 0);
  jointDot(-shoulderX, shoulderY - upperArmL - foreArmL, 0); jointDot(shoulderX, shoulderY - upperArmL - foreArmL, 0);

  // ---- 武裝(逐機掛法)----
  const F = { g, hips, chest, head, handL, handR, foreL, foreR };
  const W = D.mount(baseCtx, F);

  // ---- rig 契約 ----
  const stride = (thighL + shinL) * spec.gait.strideF * 2;
  const rig = g.userData.rig = {
    kind: 'biped',
    hips, chest, head, legL, legR, armL, armR,
    legChainL, legChainR, armChainL, armChainR,
    hipsY0: hipY, headY0: headYl,
    stride, bob: spec.gait.bob, sway: spec.gait.sway, top: spec.gait.top,
    legBase: spec.gait.legBase || 0, armBase: spec.gait.armBase,
    gunArm: W.gunR ? 1 : 0,
    knuckle: D.knuckle ? 1 : 0,
    aimPose: W.aimPose,
    weap: W.weap, hvy: W.hvy,
    gunR: W.gunR, gunL: W.gunL,
    muzzles: W.muzzles,
    wpn: W.wpn,
    kickAmp: { light: 1, heavy: 1.3 },
    moveSig: spec.moveSig, castSig: spec.castSig,
    s: 1,
  };
  if (D.extra) D.extra(baseCtx, F, Object.assign(rig, { heavy: { glow: [], pivot: [] } }));

  // 發光強度旋鈕:整棵樹的 emissiveIntensity ×accentF(在記錄 glow base 之前套用)
  if (K.accentF !== 1) g.traverse((o) => {
    if (o.isMesh && o.material?.emissiveIntensity) o.material.emissiveIntensity *= K.accentF;
  });
  rig.lightGlow = (W.lightGlowM || []).map((m) => ({ mesh: m, base: m.material.emissiveIntensity }));
  const hg = (W.heavyGlowM || []).map((m) => ({ mesh: m, base: m.material.emissiveIntensity }));
  rig.heavy = rig.heavy && rig.heavy.glow.length
    ? { glow: [...rig.heavy.glow, ...hg], pivot: W.heavyPivot || [] }
    : { glow: hg, pivot: W.heavyPivot || [] };

  outlinify(g, outlineWF(H));
  return { group: g, rig, joints };
}
