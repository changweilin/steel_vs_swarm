// ============ 機體鍛造(特徵 → 多面體零件樹;遊戲本體與機體台同吃這一份)============
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
// 2026-08-12 使用者指示(第四輪):「機體展示台從人形機體擴充到所有機體,根據不同的原型
// 切換管理頁面,飛機/無人機這類有現實機體原型的歸在同一類。」⇒ 名冊的單位從「機體」改成
// **(機體, 型態)**(變形者的地面型與飛行型是兩個原型、兩張定案圖、兩個管理頁),
// 分類**推導**自 roster.js(zero 手寫清單),鍛造鷹架因此有三支:
//   forgeMech() 依 D.kind 分流 biped / quad / air(變形者另有 forgeMorphUnit,見下)
// 航空鷹架的 rig 契約鏡射 legacy_models.js buildDrone / buildFixedWing / buildAvianDrone,
// 由真品 locomotion.js `stepAerial` 驅動(壓坡/浮沉/撲翼/噴焰/甩尾)。
//
// 名冊 = 遊戲真名冊 32 台 × 型態 = 40 格(人形 8 / 仿生 12 / 航空 20):
//   機甲 4:t01 bastion / t02 seraph / t10 aegis / t12 colossus
//   變形者人形地面型 4(data.js MORPH_HUMANOID):t06 monkey / t11 atlas / m01 vampire / m05 wolf
//   仿生四足 4(D.kind 'quad';rig 鏡射 legacy_models.js buildBeastMech):
//     s06 centaur 半人馬 / s07 cthulhu 頭足類 / t04 hound 獵犬 / m06 stego 劍龍
//   仿生雙足 4(既有 biped 鷹架 + 獸型旗標,rig 鏡射 legacy_models.js buildBipedBeast):
//     s09 roo 袋鼠 / t03 gorilla 大猩猩 / t05 ostrich 鴕鳥 / m02 trex 暴龍
// 每台的關節「機構語彙」刻意互異(這正是獨特細節的骨幹):
//   t01 外露液壓缸+缸頭環 / t02 雙件式肌腱缸 / t10 全包覆+彈匣筒 / t12 疊板+節端軸環 /
//   t06 裸缸+亮桿芯 / t11 工業液壓+鉚釘 / m01 烤漆蓋板細縫 / m05 圓盤螺栓+外露腱桿。
//
// 單一真相縫:出廠規格 = 本檔 MECH_SPECS;機體台的使用者調整 = tools/humanoid_forge/specs.json
// **覆寫層**(只存差異;機體台 /api/forge 寫、兩座檢視台讀),合併只有 mergeSpec() 一份。
//
// 產物是本專案 rig 契約的具名 Group 零件樹,**刻意不用 SkinnedMesh**
// (docs/ai3d_runbook.md §0 定案)—— 真品 locomotion.js 一行不改直接驅動;
// 掌行(t06 knuckle)/ 趾行(m05 legBase+關節 base)/ 尾配重(tailSegs)全走既有 rig 旗標。
//
// ---- 2026-08-14 正式整合(新版建模全面替換舊版)----------------------------------
// 本檔自 `tools/humanoid_forge/` 搬進 `public/js/forge/`,成為**遊戲本體唯一的英雄機體
// 建構器**(`models.js makeUnit` 的 hero 分支);機體台從此與遊戲吃同一份零件樹。
// 整合時收掉的三筆原型期欠帳:
//   ① geo.js 的 matF/bxF/cylF/segLimbF/outlineWF 鏡射 models.js 內部函式 ⇒ 收進
//      `public/js/geo3d.js`,兩邊同吃一份(geo.js 只留別名 re-export)。
//   ② MOVE_SIG/CAST_SIG 抄自 models.js ⇒ 逐機檔的那兩格是**建模台預覽用的預設值**,
//      戰場一律由 `makeUnit` 以 models.js 的表覆寫(唯一真相仍在 models.js)。
//   ③ 槍口焰(attachMuzzleFlames)由 `makeUnit` 統一掛(rig.muzzles 已登記)。
//
// **紙娃娃覆寫層是機體台自己的東西**:收尾經選用的 `opts.finish` 注入(機體台傳
// dollapply 的套用器,遊戲不傳)—— 遊戲出貨包因此不帶編輯器那四支模組,而
// 「兩座看板同形」的保證仍是同一支收尾。

import * as THREE from 'three';
import { outlinify } from '../toon.js';
import { heroPalette, paintUnit } from '../paint.js';
import { segLimbF, outlineWF } from './geo.js';
import { MECH_DETAIL } from './mechs/index.js';
import { rosterEntries } from './roster.js';
import { tagBuilders, collectTagged, pairTagged, fadeTargets, restNodes, anchorPair } from '../morphrig.js';

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
    // 紙娃娃覆寫層(拖曳調整的骨架/零件/彩繪):**整份取代**而不是逐欄合併 ——
    // 它自己內部就是「只存差異」的文件(doll.js sanitizeDoll),再合併一次 = 兩層差異疊差異。
    doll: ovr?.doll ?? base.doll ?? null,
  };
}

// ══════════ ② 名冊與規格解析(逐機幾何住 mechs/<key>.js)══════════
// 2026-08-12 第四輪起,名冊的單位是 **(機體, 型態)** 而不是機體 —— 鍵 = roster.js 的
// `entryKey()`(`t01` / `t06@ground` / `t06@flight`),分類由 roster.js **推導**。
// 本檔 MUST NOT 再出現任何手寫的機體清單(舊 FORGE_IDS 就是那份清單,已退場):
// 名冊 = 「roster 有這一格 ∩ mechs/ 有這一檔」,少寫一個檔就是那一格不出現,而不是分類錯位。

/** 已建模的名冊格(roster key 陣列;缺檔的格子由看板另列「未建模」) */
export const FORGE_KEYS = rosterEntries().filter((e) => MECH_DETAIL[e.key]).map((e) => e.key);

/** 出廠規格(單一真相;specs.json 只放覆寫)
 *  id    = roster key(覆寫層 / 截圖檔名 / URL 片段同吃這一個字串)
 *  ch    = 駕駛員 id(2D 定案圖、原型參考圖、圖鑑跳轉一律用它)
 *  pilot = 駕駛員關係(姓名/呼號/陣營/機種/全高/羈絆;**整組推導自 roster.pilotOf**)
 *  label = 建模註記(mechs/*.js 手寫;**不是機體名** —— 機體名恆取 pilot.machine)
 *  cat   = 管理頁分類(humanoid / bionic / airframe;推導自 roster.js)
 *  kind  = 鍛造鷹架('biped' / 'quad' / 'air') */
export const MECH_SPECS = rosterEntries().filter((e) => MECH_DETAIL[e.key]).map((e) => {
  const d = MECH_DETAIL[e.key];
  return {
    id: e.key, ch: e.id, form: e.form, cat: e.cat, pilot: e.pilot,
    // 塗裝三格(主色/陣營/色版階)MUST 到原處取 —— 機體檔 MUST NOT 宣告 `hue`(roster.paintOf)
    label: d.label, hue: e.paint.hue, side: e.paint.side, tier: e.paint.tier, paintVis: e.paint.vis,
    kind: d.kind || 'biped',
    height: d.height ?? 6.0,           // 建模基準高(機體台取景高);戰場另由 makeUnit 的 fitToHeight 縮到 heroTargetH
    prop: d.prop || {}, gait: d.gait || {}, air: d.air || null,
    knobs: { barrelF: 1, accentF: 1 },
    moveSig: d.moveSig, castSig: d.castSig,
  };
});
// 舊介面相容(檢視台/機體台都以 SPECS 列名冊)
export const SPECS = MECH_SPECS;
export const specOf = (key) => MECH_SPECS.find((s) => s.id === key) || null;

/** 特徵 → 零件轉換表(逐機;檢視台/機體台顯示用) */
export function conversionDoc(spec) {
  return (MECH_DETAIL[spec.id]?.doc || []).map(([feat, part]) => ({ feat, part }));
}

// ---- 兩座鷹架共用的收尾(關節點標記 / 發光登記 / 描邊)----------------------
const jointDotF = (joints) => (x, y, z) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, depthTest: false }));
  m.userData.noOutline = true;
  m.renderOrder = 5;
  m.position.set(x, y, z);
  joints.add(m);
};
/**
 * 陀螺穩定名冊(`W.stab`)—— 逐幀把這些節點的**世界**姿態鎖回「機體航向 × 出廠當下的偏航」,
 * 消費端只有 `locomotion.stepStab` 一支。用途是「掛在會動的骨頭上、但**必須**保持水平朝前」
 * 的機構(t11 的肩甲武器台:2026-08-15 使用者「武器一律掛在肩甲上方,**始終**轉向前方」)。
 *
 * 偏航基準 `q0` 在**這裡**量一次,不是逐機檔手寫:
 *   ㋐ 量的是節點自己出廠當下的世界 +z 在水平面上的方位角 ⇒ 地面型(擺正)恆 0、
 *      飛行型(t11_flight 已把樞軸反解成純偏航 sx·Λ)恆 Λ —— **兩態各自對**,而逐機檔
 *      一格參數都不必傳。手寫一個角度的話,改後掠角之後地面型與飛行型會有一個開始歪。
 *   ㋑ 只取偏航:出廠姿態裡的俯仰/滾轉就是要被穩定掉的東西(留著 = 沒有穩定)。
 * 參考框取單位根 `g`(只帶機體航向;`tilt`/`hips` 的俯仰壓坡都在它**之下**)⇒ 穩定節點
 * 因此也不吃壓坡與懸停抖動 = 使用者的「肩甲平面保持平行地面」。
 */
function stabList(g, nodes) {
  if (!nodes || !nodes.length) return null;
  g.updateMatrixWorld(true);
  const q = new THREE.Quaternion(), z = new THREE.Vector3();
  const AY = new THREE.Vector3(0, 1, 0);
  return nodes.map((n) => {
    n.getWorldQuaternion(q);
    z.set(0, 0, 1).applyQuaternion(q);
    return {
      g: n, ref: g,
      q0: new THREE.Quaternion().setFromAxisAngle(AY, Math.atan2(z.x, z.z)),
      // 逐幀暫存(locomotion.js 不 import three ⇒ 四元數由這一端配;逐節點各一組 = 逐幀零配置)
      qa: new THREE.Quaternion(), qb: new THREE.Quaternion(),
    };
  });
}

/**
 * 開火槍軸名冊：從 `wpn.*.{nodes,ref,fwd}` 推導，不寫逐機例外。
 * 每個發射節點的宣告軸都得到一個「對準機體 +z」的局部四元數；
 * locomotion 在所有步態/飛行/跳躍/變形 post-pass 之後再換回父框架。
 */
function weaponAimList(g, wpn) {
  if (!wpn) return null;
  const depth = (n) => {
    let d = 0;
    for (let p = n; p && p !== g; p = p.parent) d++;
    return d;
  };
  const axis = (name) => {
    const s = name?.startsWith('-') ? -1 : 1;
    const k = (name || 'z').replace('-', '');
    return new THREE.Vector3(k === 'x' ? s : 0, k === 'y' ? s : 0, k === 'z' ? s : 0);
  };
  const Z = new THREE.Vector3(0, 0, 1);
  const entries = new Map();
  for (const slot of ['light', 'heavy']) {
    const set = wpn[slot];
    if (!set?.ref) continue;
    const raw = [...new Set([...(set.nodes || []), set.ref])];
    // 父子節點也各自入冊：父先校正、子再依更新後的父框架求解，最終每根發射軸都是正前。
    // 只校最上層會讓帶獨立俯仰的子槍管仍殘留偏角。
    const nodes = raw.filter((n) => n?.parent && n !== g).sort((a, b) => depth(a) - depth(b));
    for (const n of nodes) {
      let e = entries.get(n);
      if (!e) {
        e = {
          g: n, ref: g, slots: [],
          qf: new THREE.Quaternion().setFromUnitVectors(axis(set.fwd), Z),
          qa: new THREE.Quaternion(), qb: new THREE.Quaternion(),
        };
        entries.set(n, e);
      }
      if (!e.slots.includes(slot)) e.slots.push(slot);
    }
  }
  return entries.size ? [...entries.values()] : null;
}

function finishRig(g, rig, W, K, H, D, ctx, F, spec) {
  rig.stab = stabList(g, W.stab);
  if (D.extra) D.extra(ctx, F, Object.assign(rig, { heavy: { glow: [], pivot: [] } }));
  rig.aimForward = weaponAimList(g, rig.wpn);
  // 發光強度旋鈕:整棵樹的 emissiveIntensity ×accentF(在記錄 glow base 之前套用)
  if (K.accentF !== 1) g.traverse((o) => {
    if (o.isMesh && o.material?.emissiveIntensity) o.material.emissiveIntensity *= K.accentF;
  });
  rig.lightGlow = (W.lightGlowM || []).map((m) => ({ mesh: m, base: m.material.emissiveIntensity }));
  const hg = (W.heavyGlowM || []).map((m) => ({ mesh: m, base: m.material.emissiveIntensity }));
  rig.heavy = rig.heavy && rig.heavy.glow.length
    ? { glow: [...rig.heavy.glow, ...hg], pivot: W.heavyPivot || [] }
    : { glow: hg, pivot: W.heavyPivot || [] };
  // 徽記 / 國旗 / 迷彩 / 貼花 —— 2026-08-14 使用者:「徽記/塗鴉/紋路等特徵也要渲染,
  // 例如零式的雙翼上下都要印紅日」。轉呼遊戲本體的 `paintUnit`(唯一實作),
  // 三條紀律照抄它的契約:①MUST 排在 `outlinify` **之前**(描邊殼是之後才掛的,
  // 提早上漆才不會把外殼也染上去);②`tone` MUST 與取色版時同一個值(spec.tier);
  // ③MUST 在 `applyDoll`(使用者彩繪覆寫層)之前 —— 覆寫層的語意是「蓋在出廠塗裝上」。
  // ④`hue` MUST 取 spec 的(= 覆寫層生效後的那一個),MUST NOT 直接餵 paintVis ——
  //   機體台的主色滑桿改了色,貼花卻還照出廠色版畫 = 徽記與裝甲對不上。
  if (spec?.paintVis) {
    paintUnit(g, { ...spec.paintVis, hue: spec.hue }, spec.side || 'STEEL', spec.tier || 'light');
  }
  outlinify(g, outlineWF(H));
}

/**
 * 收尾:把單位交給呼叫端注入的**紙娃娃覆寫層**(機體台的拖曳調整:骨架角度/長度/位置、
 * 零件變換/形狀/邊緣/配色、黏貼件、塗鴉/圖騰/烙印)。三支鷹架的最後一行都經這裡
 * ⇒ 兩座看板同形,且編輯器拿到的索引(unit.doll)與檢視台看到的是**同一份**。
 *
 * `opts.finish` 缺席(= 遊戲本體)⇒ 逐位元同出廠規格,而編輯器那四支模組
 * (doll/shapes/mark/dollapply)不進出貨包 —— 它們是機體台的工具,不是機體的一部分。
 */
function finishUnit(unit, spec, H, opts) {
  return opts?.finish ? (opts.finish(unit, spec, outlineWF(H)) || unit) : unit;
}

/**
 * 鍛造一台機體:規格 → 具名 Group 零件樹 + 完整 rig 契約。
 * 回傳 { group, rig, joints }。knobs:barrelF 武器長度倍率 / accentF 發光強度倍率。
 * D.kind 'quad' 分流到四足獸鷹架(forgeQuadMech);其餘走人形/獸型雙足 biped 鷹架 ——
 * 獸型雙足(roo/gorilla/ostrich/trex)沿用本鷹架,獸型旗標(hop/bound/knuckle/grounded/
 * tuckArms/tinyArms/leanF/tailUp/tailSegs)由 D.extra 直接掛回 rig(t06 先例)。
 */
export function forgeMech(spec, opts = {}) {
  const D = MECH_DETAIL[spec.id];
  if (!D) throw new Error(`未知機型:${spec.id}`);
  if (D.kind === 'quad') return forgeQuadMech(spec, D, opts);
  if (D.kind === 'air') return forgeAirMech(spec, D, opts);
  const P = resolveProp(spec);
  const H = spec.height;
  const PAL = heroPalette({ hue: spec.hue }, spec.side || 'STEEL', spec.tier || 'light');
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
  const jointDot = jointDotF(joints);

  const baseCtx = { PAL, accent, G, H, K, dark: PAL.dark, binderPivots: [], vlsPorts: [], dims: { shoulderYl, waistYl, shoulderX, headYl } };
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
  // 選用頸樞軸(D.neckAt = 胸腔局部 [x,y,z]):插在 chest 與 head 之間,世界位置不變 ——
  // 長頸獸型雙足(鴕鳥/暴龍)的凝視穩定走兩段分攤(locomotion stabilizeHead 的 neck 分支)。
  const head = new THREE.Group();
  let neckG = null;
  if (D.neckAt) {
    neckG = new THREE.Group();
    neckG.position.set(D.neckAt[0], D.neckAt[1], D.neckAt[2]);
    chest.add(neckG);
    head.position.set(-D.neckAt[0], headYl - D.neckAt[1], 0.04 - D.neckAt[2]);
    neckG.add(head);
    if (D.neck) D.neck(baseCtx, neckG);
  } else {
    head.position.set(0, headYl, 0.04);
    chest.add(head);
  }
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
    hips, chest, head, neck: neckG, legL, legR, armL, armR,
    legChainL, legChainR, armChainL, armChainR,
    hipsY0: hipY, headY0: headYl,
    stride, bob: spec.gait.bob, sway: spec.gait.sway, top: spec.gait.top,
    legBase: spec.gait.legBase || 0, armBase: spec.gait.armBase,
    limb: spec.gait.limb || null,   // 站姿型(人形預設蹠行,見 gaitcurve.js;獸型雙足逐機覆寫)
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
  finishRig(g, rig, W, K, H, D, baseCtx, F, spec);
  return finishUnit({ group: g, rig, joints }, spec, H, opts);
}

/**
 * 鍛造一台四足獸型機體(D.kind === 'quad')—— rig 契約鏡射 legacy_models.js buildBeastMech,
 * 真品 locomotion.js stepQuad 一行不改直接驅動。逐機幾何仍全住 mechs/<id>.js:
 *   D.frame = { hipY, chest:[x,y,z], neck:[x,y,z], head:[x,y,z], legX, fz, hz,
 *               tailY, tailZ, tail2Z }(公尺;chest 掛 spine、neck 掛 chest、head 掛 neck)
 *   D.gait  = { gait:'trot'|'walk'|'crawl', gallopType?, stride, top, bob,
 *               rollSway?, pitchAmp?, legAmp?, soft?, gallop? }(語意同 models.js BEAST 表)
 *   D.body(c, spine, chest)                      軀幹殼(前半掛 chest、後半掛 spine)
 *   D.neckHead(c, neck, head)                    頸+頭(非騎乘);騎乘改給 D.rider
 *   D.rider(c, neck)                             人馬:neck = 騎士腰樞軸,回傳
 *     { humChest, humNeck, head, armSh:[L,R], armEl:[L,R], armBase:[{shX,shZ,elX}×2], gunR? }
 *   D.legF(c)/D.legH(c) → segLimbF segs          前/後腿分節(c.sx 分邊;soft 腿 = 多節小 k)
 *   D.tail(c, tail, tail2) → tailSegs?           尾(回傳多節鏈則整條進 whipTail;省略 = [tail, tail2])
 *   D.mount(c, F) / D.extra(c, F, rig)           武裝/加掛(契約同人形;克蘇魯 rig.tents 在 extra 掛)
 */
function forgeQuadMech(spec, D, opts = {}) {
  const FR = D.frame, GA = D.gait;
  const H = spec.height;
  const PAL = heroPalette({ hue: spec.hue }, spec.side || 'STEEL', spec.tier || 'light');
  const accent = new THREE.Color(spec.hue);
  const K = { barrelF: spec.knobs?.barrelF ?? 1, accentF: spec.knobs?.accentF ?? 1 };

  const g = new THREE.Group();
  const joints = new THREE.Group();
  joints.visible = false;
  g.add(joints);
  const jointDot = jointDotF(joints);
  const baseCtx = { PAL, accent, G: 1, H, K, dark: PAL.dark, binderPivots: [], vlsPorts: [], dims: { ...FR } };

  // 骨架:spine(hipY)→ chest → neck → head;tail → tail2;四腿掛根節點(脊椎浮沉不帶腳底)
  const spine = new THREE.Group();
  spine.position.y = FR.hipY;
  g.add(spine);
  const chest = new THREE.Group();
  chest.position.set(...(FR.chest || [0, 0.1, 0.55]));
  spine.add(chest);
  const neck = new THREE.Group();
  neck.position.set(...(FR.neck || [0, 0.2, 0.8]));
  chest.add(neck);
  const head = new THREE.Group();
  head.position.set(...(FR.head || [0, 0.15, 0.45]));
  neck.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, FR.tailY ?? 0, FR.tailZ ?? -0.9);
  spine.add(tail);
  const tail2 = new THREE.Group();
  tail2.position.set(0, 0, -(FR.tail2Z ?? 1.0));
  tail.add(tail2);

  D.body(baseCtx, spine, chest);
  // 騎乘(人馬):neck = 騎士腰樞軸,上身分節鏈(腰→胸→頸→頭)反向吸收馬軀起伏;
  // 非騎乘:靈活長頸主動反屈 + 頭部畫弧補償(headArm 由骨架水平力臂推導)
  let humChest = null, humNeck = null, armSh = null, armEl = null, armBase = null, riderHead = null, riderGunR = null;
  if (D.rider) {
    const R = D.rider(baseCtx, neck);
    humChest = R.humChest; humNeck = R.humNeck; riderHead = R.head;
    armSh = R.armSh; armEl = R.armEl; armBase = R.armBase; riderGunR = R.gunR || null;
  } else {
    D.neckHead(baseCtx, neck, head);
  }

  // 四腿(建腿順序 = chains 順序 FL, FR, HL, HR;前肢肘朝後折、後肢跗朝前折 —— 符號住逐機 k 值)
  const legChains = [[], [], [], []];
  const mkLeg = (sx, z, front, ci) => {
    const ctx = { ...baseCtx, sx, front };
    // 方法呼叫(不解構)—— 逐機檔的 legF/legH 可用 this 共用同一支 _leg
    return segLimbF(g, [sx * FR.legX, FR.hipY, z], front ? D.legF(ctx) : D.legH(ctx), legChains[ci]);
  };
  const legFL = mkLeg(-1, FR.fz, true, 0), legFR = mkLeg(1, FR.fz, true, 1);
  const legHL = mkLeg(-1, FR.hz, false, 2), legHR = mkLeg(1, FR.hz, false, 3);
  for (const [sx, z] of [[-1, FR.fz], [1, FR.fz], [-1, FR.hz], [1, FR.hz]]) jointDot(sx * FR.legX, FR.hipY, z);
  jointDot(0, FR.hipY, 0);
  jointDot(0, FR.hipY + (FR.chest?.[1] ?? 0.1), (FR.chest?.[2] ?? 0.55));
  jointDot(0, FR.hipY + (FR.tailY ?? 0), FR.tailZ ?? -0.9);

  const tailSegs = (D.tail && D.tail(baseCtx, tail, tail2)) || [tail, tail2];

  // ---- 武裝(逐機掛法;契約同人形 mount)----
  const F = { g, spine, chest, neck, head: riderHead || head, tail, tail2, tailSegs, humChest, humNeck };
  const W = D.mount(baseCtx, F);

  const rig = g.userData.rig = {
    kind: 'quad', spine, chest, neck, head: riderHead || head, tail, tail2,
    tailSegs,
    neckY0: neck.position.y,
    headArm: (FR.chest?.[2] ?? 0.55) + (FR.neck?.[2] ?? 0.8) + (FR.head?.[2] ?? 0.45),
    headArmN: FR.head?.[2] ?? 0.45,
    rider: !!D.rider,
    legFL, legFR, legHL, legHR,
    chFL: legChains[0], chFR: legChains[1], chHL: legChains[2], chHR: legChains[3],
    tents: null,                        // 持武觸手(克蘇魯):D.extra 掛 [{g,base,k,d}…] 鏈列
    humChest, humNeck, armSh, armEl, armBase,
    gunR: W.gunR || riderGunR, gunL: W.gunL || null,
    aimPose: W.aimPose || null,
    weap: W.weap, hvy: W.hvy,
    muzzles: W.muzzles,
    wpn: W.wpn,
    kickAmp: { light: 1, heavy: 1.3 },
    hipsY0: FR.hipY, stride: GA.stride, top: GA.top ?? 10,
    gait: GA.gait, gallopType: GA.gallopType, bob: GA.bob ?? 0.09, rollSway: GA.rollSway,
    pitchAmp: GA.pitchAmp, legAmp: GA.legAmp, soft: GA.soft, gallop: GA.gallop,
    // 解剖學步態差異化(gaitcurve.js limbProfile):前/後肢各自的站姿型與行程。
    // 省略 ⇒ 前後皆趾行(獸型的多數)⇒ 這一台不必寫也有正確的前後肢拓樸分家。
    limb: GA.limb || null,
    moveSig: spec.moveSig, castSig: spec.castSig,
    s: 1,
  };
  finishRig(g, rig, W, K, H, D, baseCtx, F, spec);
  return finishUnit({ group: g, rig, joints }, spec, H, opts);
}

/**
 * 鍛造一台航空機體(D.kind === 'air')—— rig 契約鏡射 legacy_models.js buildDrone/
 * buildFixedWing/buildAvianDrone,真品 locomotion.js `stepAerial` 一行不改驅動。
 * 2026-08-12 使用者第四輪:「飛機/無人機這類有現實機體原型的歸在同一類」—— 12 台純無人機
 * 與 8 個變形者飛行型共用本鷹架與同一個管理頁。
 *
 * 逐機幾何仍全住 mechs/<key>.js:
 *   D.air = { tiltY, bob, top, level?, insect?, span?, pitchTop? }(公尺/弧度;語意同 models.js 那三支)
 *     tiltY 壓坡樞軸離地高(= rig.tiltY0,浮沉基準)/ level 定翼機(巡航不低頭,MUST 見
 *     stepAerial 的 rig.level 分支)/ insect 昆蟲震翅(高頻 8 字軌跡,與鳥類撲翼不同支)/
 *     pitchTop 滿速前傾角(省略 = 0.2;「靜止直立、移動前傾」MUST 走這一格,MUST NOT 把
 *     前傾角寫死在逐機檔的機身群組上 —— 那樣靜止時也一直低著頭)
 *   D.body(c, tilt)                     機身/艙體(必填)
 *   D.lift(c, tilt) → {                 升力系統(擇一或混用)
 *     rotors: [Group…]                    自轉槳盤(展示台/戰場同吃 userData.spin)
 *     wings:  [{ w, outer, sgn, pair? }]  撲翼(sgn = ±1 分邊;pair 標後翅 → 相位落後)
 *     jets:   [{ g, m1, m2 }]             噴射尾焰(geo.jetF 的回傳)
 *     thrusters: [], vents: []            推進器/排氣口(輝度由變形驅動;純無人機留空)
 *   }
 *   D.tail(c, tilt) → tailSegs?         長重尾配重舵面(機械龍;whipTail 吃)
 *   D.mount(c, F) / D.extra(c, F, rig)  武裝/加掛(契約同人形 mount)
 *
 * ⚠ 旋翼自轉**不在 locomotion 裡**(那支只管 kind 'morph' 的 rig.rotors):
 * 戰場走 game.js 的 spinners 吃 `g.userData.spin`,展示台由 viewer 推進同一份名冊 ——
 * 兩端同一份清單,MUST NOT 在展示台另抓一次場景裡的槳葉。
 */
function forgeAirMech(spec, D, opts = {}) {
  const A = D.air || {};
  const H = spec.height;
  const PAL = heroPalette({ hue: spec.hue }, spec.side || 'STEEL', spec.tier || 'light');
  const accent = new THREE.Color(spec.hue);
  const K = { barrelF: spec.knobs?.barrelF ?? 1, accentF: spec.knobs?.accentF ?? 1 };

  const g = new THREE.Group();
  const joints = new THREE.Group();
  joints.visible = false;
  g.add(joints);
  const jointDot = jointDotF(joints);

  // 壓坡樞軸:所有部件掛 tilt 之下(橫移壓坡/前傾/懸停浮沉都轉這一個 Group,
  // 不動根節點 —— 定位與描邊不受影響;同 buildDrone 的慣例)
  const tilt = new THREE.Group();
  tilt.position.y = A.tiltY ?? 1.3;
  g.add(tilt);

  const baseCtx = { PAL, accent, G: 1, H, K, dark: PAL.dark, binderPivots: [], vlsPorts: [], dims: { ...A } };
  D.body(baseCtx, tilt);
  const L = (D.lift && D.lift(baseCtx, tilt)) || {};
  const tailSegs = (D.tail && D.tail(baseCtx, tilt)) || null;
  jointDot(0, A.tiltY ?? 1.3, 0);
  if (A.span) { jointDot(-A.span / 2, A.tiltY ?? 1.3, 0); jointDot(A.span / 2, A.tiltY ?? 1.3, 0); }

  const F = { g, tilt, chest: tilt, head: tilt, tailSegs };
  const W = D.mount(baseCtx, F);

  const rig = g.userData.rig = {
    kind: 'aerial', tilt, tiltY0: A.tiltY ?? 1.3,
    bob: A.bob ?? 0.06, top: A.top ?? 30,
    level: A.level ? 1 : 0, insect: A.insect ? 1 : 0,
    pitchTop: A.pitchTop,          // 滿速前傾角(rad;省略 ⇒ stepAerial 的 0.2 = 逐位元同舊制)
    wings: L.wings || null, jets: L.jets || null, rotors: L.rotors || null,
    thrusters: L.thrusters || [], vents: L.vents || [],
    tailSegs: tailSegs || null,
    weap: W.weap, hvy: W.hvy,
    gunR: W.gunR || null, gunL: W.gunL || null, aimPose: W.aimPose || null,
    muzzles: W.muzzles, wpn: W.wpn,
    kickAmp: { light: 1, heavy: 1.3 },
    moveSig: spec.moveSig, castSig: spec.castSig,
    s: 1,
  };
  // 自轉名冊(戰場 game.js spinners / 展示台 viewer 同吃這一份)
  g.userData.spin = (L.spin || []).slice();
  finishRig(g, rig, W, K, H, D, baseCtx, F, spec);
  return finishUnit({ group: g, rig, joints, spin: g.userData.spin }, spec, H, opts);
}

// ══════════ ④ 變形過程:兩態骨架 → 逐零件運動(2026-08-15)══════════
// 規則面全住 `../morphrig.js`(零 import、離線可驗);這裡只做兩件 three 才做得到的事:
//   ㋐ 鍛造時把逐機檔的建構器包成會戳標籤的版本(對應的構造保證);
//   ㋑ 鍛造後把兩態的**靜止**變換反推成一組「A → B 的局部變換」表。
// 逐幀那一端(locomotion.morphPose)因此只剩三個 lerp,零矩陣求逆。

const _mm = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _mp = new THREE.Vector3(), _mq = new THREE.Quaternion(), _ms = new THREE.Vector3();

const trsOf = (n) => ({
  p: [n.position.x, n.position.y, n.position.z],
  q: [n.quaternion.x, n.quaternion.y, n.quaternion.z, n.quaternion.w],
  s: [n.scale.x, n.scale.y, n.scale.z],
});

/**
 * 反推(接縫零件用):把**對面那一棵**的 `to` 量在**共同錨** `ancTo` 的框裡,再搬進
 * 這一棵的 `ancFrom` 框、換算成掛在 `from` 底下的等價局部變換。
 *   inv(from) · ancFrom · inv(ancTo) · to
 * 錨為什麼 MUST 是「共同的**已對應**祖先」而不是「我自己的父」見 `morphrig.anchorPair`。
 */
function relTRS(from, ancFrom, ancTo, to) {
  _mm.copy(from.matrixWorld).invert().multiply(ancFrom.matrixWorld)
    .multiply(_m2.copy(ancTo.matrixWorld).invert()).multiply(to.matrixWorld)
    .decompose(_mp, _mq, _ms);
  return { p: [_mp.x, _mp.y, _mp.z], q: [_mq.x, _mq.y, _mq.z, _mq.w], s: [_ms.x, _ms.y, _ms.z] };
}

/** 淡出/淡入的一格:材質 MUST 連**描邊外殼**一起收(只收本體 = 淡掉的零件留下一圈黑輪廓) */
function fadeEntry(n) {
  const mats = [];
  const push = (m) => { if (m) mats.push({ m, t0: m.transparent, o0: m.opacity, d0: m.depthWrite }); };
  const own = Array.isArray(n.material) ? n.material : [n.material];
  own.forEach(push);
  for (const c of n.children) if (c.userData?.isOutline) (Array.isArray(c.material) ? c.material : [c.material]).forEach(push);
  return { n, s0: [n.scale.x, n.scale.y, n.scale.z], v0: n.visible, mats, a: -1 };
}

/** 鍛造一棵樹,期間把 `D` 的建構器包成會戳標籤的版本(還原一律走 finally:拋錯留著包裝
 *  = 這台機體之後每一次鍛造都在累加呼叫序號,而畫面上只表現成「變形亂飛」) */
function forgeTagged(D, spec, opts) {
  const untag = D ? tagBuilders(D) : null;
  try { return forgeMech(spec, opts); } finally { untag?.(); }
}

/**
 * 兩態骨架 → 變形運動表。
 * 逐對零件記兩組局部變換:`A` = 這一棵自己的靜止姿態、`B` = 對面那一棵的等價姿態。
 * 父節點也對應上 ⇒ 直接拿對方的局部變換(父自己也會被內插);父沒對應上(接縫:地面型掛
 * 在 chest 骨、飛行型掛在 hull 群組)⇒ 反推等價局部變換。
 */
function captureMorphPlan(root, gg, ag) {
  root.updateMatrixWorld(true);
  const P = pairTagged(collectTagged(gg), collectTagged(ag));
  const tags = new Set(P.pairs.map((x) => x.g.tag));
  const gSet = new Set(P.pairs.map((x) => x.g.node));
  const aSet = new Set(P.pairs.map((x) => x.a.node));
  const gPairs = [], aPairs = [];
  const pairOf = new Map(P.pairs.map((x) => [x.g.node, x.a.node]));
  for (const { g, a } of P.pairs) {
    // 共同錨:兩棵樹上都被推到同一個地方的那一顆祖先(沒有 ⇒ 用兩棵樹的根,它們同框)
    const anc = anchorPair(g.node, a.node, pairOf);
    const PG = anc ? anc[0] : gg, PA = anc ? anc[1] : ag;
    // 錨恰好就是雙方的父 ⇒ 局部變換直接可比(父自己也會被內插;這一支只是精確版的 relTRS)
    const kin = g.node.parent === PG && a.node.parent === PA;
    gPairs.push({ n: g.node, A: trsOf(g.node), B: kin ? trsOf(a.node) : relTRS(g.node.parent, PG, PA, a.node) });
    aPairs.push({ n: a.node, A: kin ? trsOf(g.node) : relTRS(a.node.parent, PA, PG, g.node), B: trsOf(a.node) });
  }
  const side = (r, pairs, set) => ({
    pairs,
    rest: restNodes(set, r).map((n) => ({ n, r: trsOf(n) })),
    fade: fadeTargets(r, tags).map(fadeEntry),
  });
  return {
    g: side(gg, gPairs, gSet),
    a: side(ag, aPairs, aSet),
    // 對應率:兩態到底共用了多少零件(機體台/稽核印它 —— 掉下去就是某一支飛行檔開始自己畫幾何)
    n: { pair: P.pairs.length, soft: P.pairs.filter((x) => x.soft).length,
      gOnly: P.gOnly.length, aOnly: P.aOnly.length },
  };
}

/**
 * 鍛造一台**變形者**(地面型 + 飛行型兩棵樹)—— 2026-08-14 新版建模整合。
 *
 * 舊制 `legacy_models.js buildMorphMech` 是**一棵樹**:同一批零件掛在 `rig.pose(m)` 的分段姿勢
 * 插值上,`locomotion.stepMorph` 整支吃那個契約。新版建模的兩個型態是**兩個原型、兩張
 * 2D 定案圖、兩支逐機檔**(`s03.js` / `s03_flight.js`),彼此沒有可以互相插值的對應零件
 * —— 硬要塞回單樹契約只能二選一,而那正是使用者這一輪要換掉的東西。
 *
 * 兩棵樹並存的三條紀律:
 *   ① **兩態同尺度**:飛行檔的 `height` 一律 === 地面檔的(mechs/*_flight.js 直接引用,
 *      不是各寫一個數字)⇒ 兩棵樹在同一個公尺框裡,`fitToHeight` 量地面型那一棵就夠。
 *   ② **rig 不合併,用換的**:`mesh.userData.rig` 每幀由 `locomotion.stepLocomotion` 開頭的
 *      型態切換改指到當下那一棵(地面 'biped'/'quad'、飛行 'aerial')⇒ 既有四支步態驅動器、
 *      `stepCombatFx`、`stepCastPose`、`stepJumpPose` **一行不改**就吃得到正確的骨架。
 *      合併成一個代理 rig 的話,每一支消費端都要多一條「現在算哪一邊」的分支。
 *   ③ **變形演出住 locomotion**(`morphSwap` 換樹 + `morphPose` 逐零件姿態),但**運動本身
 *      是建構期反推出來的**(2026-08-15 使用者:「建立兩個形態的骨架後,反推變形時骨架應該
 *      如何移動/旋轉/伸縮/透明化」)—— 兩態同零件已經是 mechs/_morph.js 的紀律,
 *      那組運動因此是**兩態靜態骨架的推論**而不是另外編一套動畫:`captureMorphPlan` 把
 *      逐零件的 A → B 局部變換算完交給逐幀端內插。手寫演出的下場是加一台變形者要再編一次,
 *      而且改了飛行型的擺位之後演出還停在舊姿態(畫面上只表現成「變形變到一半歪掉」)。
 *
 * `ground`/`air` 交出**兩棵子單位本身**(不只是 rig):機體台的紙娃娃索引 `unit.doll` 是
 * 逐棵各一份(`dollFinish` 掛在各自的 `forgeMech` 收尾上),而名冊的單位是 (機體, 型態)
 * ⇒ 看板要拿得到「選中那一格那一棵」的索引與樞軸點。遊戲端不讀這兩格。
 *
 * @returns { group, rig(地面), rigAir, fit(fitToHeight MUST 量這一棵), joints, spin, ground, air }
 */
export function forgeMorphUnit(specGround, specAir, opts = {}) {
  // 兩態同零件是**建構期**的紀律(mechs/_morph.js);把「哪一顆對哪一顆」也在建構期釘死,
  // 變形演出才有東西可以反推(morphrig.js ①)。兩棵樹**各包一次** —— 呼叫序號要各自從 0 起算,
  // 共用一份計數器的話飛行型的每一支建構器都會接在地面型的序號後面 = 全部對不上。
  const DG = MECH_DETAIL[specGround.id];
  const G = forgeTagged(DG, specGround, opts);
  const A = forgeTagged(DG, specAir, opts);
  const g = new THREE.Group();
  g.add(G.group);
  g.add(A.group);
  // 變形把手:locomotion 開頭的 `morphSwap` 認這一格(缺席 = 這台不是變形者);
  // `plan` = 反推出來的逐零件運動(缺席 ⇒ 退回 2026-08-14 的根節點收摺演出)
  const plan = captureMorphPlan(g, G.group, A.group);
  A.group.visible = false;             // 出廠 = 地面型(伺服器的 heroY 起始也在地面)
  g.userData.morph = { ground: G.rig, air: A.rig, gg: G.group, ag: A.group, m: 0, air0: false, k: 0, act: false, plan };
  g.userData.rig = G.rig;
  // 自轉名冊兩態合併(隱藏那一棵的槳葉照轉也看不見;分兩份 = 換型態要重掛一次 spinners)
  g.userData.spin = [...(G.group.userData.spin || []), ...(A.group.userData.spin || [])];
  const joints = new THREE.Group();
  joints.visible = false;
  return { group: g, rig: G.rig, rigAir: A.rig, fit: G.group, joints, spin: g.userData.spin,
    ground: G, air: A };
}
