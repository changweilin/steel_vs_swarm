/**
 * 2D 切圖工作清單(docs/ai3d_asset_plan.md §5.0.1 / §5.0.2 的唯一縫)
 *
 * 這一支回答兩個問題,兩個都 MUST 推導、MUST NOT 手寫:
 *   ① 哪些 master 還沒畫  ← 掃 public/assets/cyberpunk_art/mechs/ 實際檔案
 *   ② 每一隻要切幾張圖    ← 掃 public/js/models.js 的 rig 登記區塊
 *
 * 為什麼要掃原文而不是抄一份槽位表:槽位的真相住 models.js(skill mech-part-forge §1
 * 「models.js source is authoritative」)。抄一份的話,models.js 新增一個 rig 節點時
 * 這裡不會報錯 —— 只會少畫一張圖,而症狀要到組裝完才看得出來「這隻少一個零件」。
 * 故 DRAW_SLOTS 是「rig 節點 → 繪圖單位」的分組表,並由 auditCoverage() 反查
 * 每一個幾何節點都恰好被一個繪圖槽位涵蓋;models.js 一動就紅字。
 *
 * 鏡射收斂(§5.0.2 規則 1):legL/legR 這種左右對稱件只畫一張,右件在 Blender 鏡射
 * ⇒ mirror:true 的槽位只產生 L 那一張。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CHARACTERS } from '../../public/js/data.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..');
export const ART_DIR = join(REPO, 'public', 'assets', 'cyberpunk_art', 'mechs');

// ── rig 登記區塊在 models.js 的位置(以 'g.userData.rig = {' / 'const rig = {' 起算)──
// 行號會漂,故只當搜尋起點提示;實際靠 findRigBlock() 以函式名往下找第一個 rig 登記。
const BUILDERS = {
  buildDrone:      { kind: 'aerial', form: 'multirotor' },
  buildFixedWing:  { kind: 'aerial', form: 'fixed' },
  buildAvianDrone: { kind: 'aerial', form: 'avian' },
  buildBeastMech:  { kind: 'quad',   form: 'beast' },
  buildBipedBeast: { kind: 'biped',  form: 'biped' },
  buildRobotMech:  { kind: 'biped',  form: 'proto' },
  buildMorphMech:  { kind: 'morph',  form: 'morph' },
};

// rig 上「不是幾何節點」的鍵:純量參數、步態設定、指向既有節點的指標。
// 新增鍵沒列進來 ⇒ auditCoverage() 紅字,是刻意的(逼人分類,而不是靜默漏掉)。
const NON_GEOM = new Set([
  'kind', 'tiltY0', 'bob', 'top', 'topAir', 'level', 'insect', 'beast', 'rider',
  'hipsY0', 'headY0', 'neckY0', 'headArm', 'headArmN', 'stride', 'sway', 'gunArm',
  'leanF', 'tailUp', 'armBase', 'legBase', 'bound', 'hop', 'hopLean', 'hopH',
  'knuckle', 'grounded', 'tuckArms', 'tinyArms', 'gait', 'gallopType', 'rollSway',
  'pitchAmp', 'legAmp', 'flapF', 'airBob', 'swingArm', 'flexF', 'qphase', 'tuck',
  'palmi', 'hoverUp', 'cruise', 's', 'soft',
  // 指標/設定(指向下面已列為幾何的節點,或純戰鬥動畫設定)
  'weap', 'hvy', 'heavy', 'aimPose', 'lightGlow', 'muzzles', 'gunR', 'gunL',
  'pose', 'tailPose', 'tailAimComp', 'trunkAim', 'aimM',
  'kneeL', 'kneeR', 'ankleL', 'ankleR', 'elbowL', 'elbowR', 'wristL', 'wristR',
  'chFL', 'chFR', 'chHL', 'chHR', 'legChainL', 'legChainR', 'armChainL', 'armChainR',
  'tail', 'tail2',
]);

/**
 * 繪圖槽位表:rig 幾何節點 → 一張切圖。
 * `nodes` = 這張圖涵蓋哪些 rig 節點(auditCoverage 用)。
 * `mirror` = 左右對稱件,只畫 L(§5.0.2 規則 1)。
 * `desc`   = 進 prompt 的部位描述(§5.2 的 {SLOT})。
 */
export const DRAW_SLOTS = {
  aerial: [
    { slot: 'hull',        nodes: ['tilt'],                 desc: 'main fuselage / hull body (the central chassis only, no rotors, no wings, no weapon pods)' },
    { slot: 'rotor_arm',   nodes: ['spin'],                 desc: 'one rotor arm with its propeller and motor nacelle', when: v => v.frame && v.frame !== 'wing' },
    { slot: 'wing',        nodes: ['wings'],                desc: 'one wing panel (left side), detached at the wing root', mirror: true, when: v => v.form === 'fixed' || v.form === 'avian' },
    { slot: 'tail',        nodes: ['tailSegs'],             desc: 'tail boom / tail segment assembly' , when: v => v.form === 'avian' },
    { slot: 'engine',      nodes: ['jets'],                 desc: 'one engine nacelle / thruster pod', when: v => v.form === 'fixed' },
    { slot: 'wpn_light',   nodes: ['wpn'],                  desc: 'light weapon pod as a separate object (barrel forward, muzzle end clearly visible)' },
    { slot: 'wpn_heavy',   nodes: [],                       desc: 'heavy weapon pod as a separate object (barrel forward, muzzle end clearly visible)' },
  ],
  biped: [
    { slot: 'hips',        nodes: ['hips'],                 desc: 'pelvis / hip block (the waist chassis only, legs detached)' },
    { slot: 'chest',       nodes: ['chest'],                desc: 'torso / chest armour block (no head, no arms)' },
    { slot: 'head',        nodes: ['head', 'neck'],         desc: 'head and neck assembly' },
    { slot: 'leg',         nodes: ['legL', 'legR'],         desc: 'left leg assembly: thigh, shin and foot, detached at the hip', mirror: true },
    { slot: 'arm',         nodes: ['armL', 'armR'],         desc: 'left arm assembly: upper arm, forearm and hand, detached at the shoulder', mirror: true },
    { slot: 'tail',        nodes: ['tailSegs'],             desc: 'three-segment counterweight tail assembly', when: (v, m) => m.hasTail },
    { slot: 'wpn_light',   nodes: ['wpn'],                  desc: 'light weapon as a separate object (barrel forward, muzzle end clearly visible)' },
    { slot: 'wpn_heavy',   nodes: [],                       desc: 'heavy weapon as a separate object (barrel forward, muzzle end clearly visible)' },
  ],
  quad: [
    { slot: 'spine',       nodes: ['spine'],                desc: 'spine / lower hull segment (the load-bearing spine block only)' },
    { slot: 'chest',       nodes: ['chest'],                desc: 'chest / shoulder girdle block' },
    { slot: 'head',        nodes: ['head', 'neck'],         desc: 'head and neck assembly' },
    { slot: 'leg_front',   nodes: ['legFL', 'legFR'],       desc: 'left FRONT leg assembly: upper limb, lower limb and foot, detached at the hip', mirror: true },
    { slot: 'leg_hind',    nodes: ['legHL', 'legHR'],       desc: 'left HIND leg assembly: upper limb, lower limb and foot, detached at the hip', mirror: true },
    { slot: 'tail',        nodes: ['tailSegs'],             desc: 'two-segment tail assembly' },
    { slot: 'tentacle',    nodes: ['tents'],                desc: 'one tentacle limb, full length', when: v => v.creature === 'cthulhu' },
    { slot: 'rider_torso', nodes: ['humChest', 'humNeck'],  desc: 'the humanoid upper torso that rides on the quadruped chassis', when: v => v.creature === 'centaur' },
    { slot: 'rider_arm',   nodes: ['armSh', 'armEl'],       desc: 'the rider left arm assembly: shoulder, upper arm, forearm and hand', mirror: true, when: v => v.creature === 'centaur' },
    { slot: 'wpn_light',   nodes: ['wpn'],                  desc: 'light weapon as a separate object (barrel forward, muzzle end clearly visible)' },
    { slot: 'wpn_heavy',   nodes: [],                       desc: 'heavy weapon as a separate object (barrel forward, muzzle end clearly visible)' },
  ],
  morph: [
    { slot: 'torso',       nodes: ['torso'],                desc: 'central torso / fuselage core block (this part becomes the fuselage in flight form, so keep it a clean prismatic volume)' },
    { slot: 'head',        nodes: ['head'],                 desc: 'head / nose assembly' },
    { slot: 'leg',         nodes: ['legL', 'legR'],         desc: 'left leg assembly: thigh, shin, ankle and foot, detached at the hip (this limb folds into the airframe in flight form)', mirror: true },
    { slot: 'arm',         nodes: ['armL', 'armR'],         desc: 'left arm assembly: upper arm, forearm, wrist and hand, detached at the shoulder', mirror: true },
    { slot: 'mid_leg',     nodes: ['midLegs', 'midKnees', 'midTarsi'], desc: 'one middle leg assembly (the third limb pair)', mirror: true, when: v => v.ground === 'beetle' },
    { slot: 'vent',        nodes: ['vents'],                desc: 'one transformation vent / louvre panel module' },
    { slot: 'thruster',    nodes: ['thrusters'],            desc: 'one thruster nozzle module' },
    { slot: 'rotor',       nodes: ['rotors'],               desc: 'one rotor head with blades', when: v => v.flight === 'heli' || v.flight === 'tilt' },
    // 翼:models.js 只在 `F !== 'tilt' && F !== 'heli'` 時建(旋翼機那兩型是 rotors 不是翼)。
    // 沒有這個條件就會替 t11/m01 各畫一張**沒有對應 rig 節點**的翼 —— 畫得再好也掛不上去。
    // 「wing」在變形者身上依飛行型態可能是羽翼/膜翼/鞘翅/**鯨鰭** —— 描述保持中性,
    // 由 prompt.mjs 的詞表(FLIGHT form 那一行)決定它到底長什麼樣,兩邊 MUST NOT 打架。
    { slot: 'wing',        nodes: ['flapWings', 'lightWings', 'lightWingRoots'], desc: 'one wing or flipper panel (left side), detached at its root — match whatever the flight form calls for', mirror: true, when: v => v.flight !== 'tilt' && v.flight !== 'heli' },
    { slot: 'jet',         nodes: ['jets'],                 desc: 'one jet engine nacelle', when: v => v.flight === 'jet' },
    { slot: 'tail',        nodes: ['tailSegs'],             desc: 'tail segment assembly', when: (v, m) => m.hasTail },
    { slot: 'trunk',       nodes: ['trunk', 'trunkTip'],    desc: 'articulated trunk / proboscis assembly', when: v => v.ground === 'elephant' },
    { slot: 'wpn_light',   nodes: ['wpn'],                  desc: 'light weapon as a separate object (barrel forward, muzzle end clearly visible)' },
    { slot: 'wpn_heavy',   nodes: [],                       desc: 'heavy weapon as a separate object (barrel forward, muzzle end clearly visible)' },
  ],
};

// ── models.js 原文抽取 ────────────────────────────────────────────────
function modelsSrc() {
  // CRLF 正規化:逐行剝註解的正則在 CRLF 工作區會靜默失效(CLAUDE.md §5 ㋑)
  return readFileSync(join(REPO, 'public', 'js', 'models.js'), 'utf8').replace(/\r\n/g, '\n');
}

/** 抓某個 builder 函式體內第一個 rig 登記區塊的頂層鍵。 */
export function rigKeysOf(builder) {
  const src = modelsSrc();
  const fnAt = src.indexOf(`function ${builder}(`);
  if (fnAt < 0) throw new Error(`models.js 找不到 ${builder}`);
  const rigAt = Math.min(
    ...[`g.userData.rig = {`, `const rig = {`]
      .map(t => { const i = src.indexOf(t, fnAt); return i < 0 ? Infinity : i; }),
  );
  if (!isFinite(rigAt)) throw new Error(`${builder} 找不到 rig 登記區塊`);

  let i = src.indexOf('{', rigAt), depth = 0, end = i;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') { depth--; if (depth === 0) { end++; break; } }
  }
  const body = src.slice(i + 1, end - 1).replace(/\/\/[^\n]*/g, '');

  // 只取頂層**鍵**:`名稱:` 或 shorthand `名稱,`。
  // inValue 這個狀態不可省 —— 少了它 `bob: 0.06,` 的 `06` 與 `heavy: heavyRig,` 的
  // `heavyRig` 都會被當成 shorthand 鍵收進來(實測一次抓出 58 個假節點)。
  const keys = [];
  let d = 0, tok = '', inValue = false;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === '{' || c === '[' || c === '(') { d++; tok = ''; continue; }
    if (c === '}' || c === ']' || c === ')') { d--; tok = ''; continue; }
    if (d !== 0) continue;
    if (/[A-Za-z0-9_$]/.test(c)) { tok += c; continue; }
    if (c === ':') { if (tok && !inValue) keys.push(tok); inValue = true; tok = ''; continue; }
    if (c === ',') { if (tok && !inValue) keys.push(tok); inValue = false; tok = ''; continue; }
    if (c !== ' ' && c !== '\t' && c !== '\n') tok = '';   // 允許 `key :` 與換行後續接
  }
  if (tok && !inValue) keys.push(tok);
  return [...new Set(keys)];
}

/** models.js 一動就紅字:每個幾何節點 MUST 恰好被一個繪圖槽位涵蓋。 */
export function auditCoverage() {
  const problems = [];
  for (const [builder, meta] of Object.entries(BUILDERS)) {
    const rigKeys = rigKeysOf(builder).filter(k => !NON_GEOM.has(k));
    const covered = new Map();
    for (const s of DRAW_SLOTS[meta.kind]) for (const n of s.nodes) covered.set(n, s.slot);
    for (const k of rigKeys) {
      if (!covered.has(k)) problems.push(`${builder}: rig 節點 '${k}' 沒有任何繪圖槽位涵蓋`);
    }
  }
  return problems;
}

// ── 角色 → builder(鏡射 models.js 的派發判定,見該檔 makeUnit)────────
export function builderOf(ch) {
  const c = CHARACTERS[ch], v = c.visual || {};
  if (c.kind === 'morph') return 'buildMorphMech';
  if (c.kind === 'robot') {
    if (v.form === 'beast') return 'buildBeastMech';
    if (v.form === 'biped') return 'buildBipedBeast';
    return 'buildRobotMech';                 // proto:*
  }
  if (v.form === 'avian') return 'buildAvianDrone';
  if (v.form === 'fixed') return 'buildFixedWing';
  return 'buildDrone';                        // frame:* 多旋翼
}

// 有尾的機種(models.js 逐 creature 條件;缺一條只是多畫一張,漏一條才是少零件)
const TAILED = new Set(['roo', 'trex', 'ptero', 'dragon', 'stego', 'hound', 'centaur',
  'raptor', 'panther', 'wolf', 'vampire', 'monkey', 'elephant', 'ostrich']);

/** 某角色要畫哪些切圖(已收斂鏡射件)。 */
export function slotsOf(ch) {
  const v = CHARACTERS[ch].visual || {};
  const kind = BUILDERS[builderOf(ch)].kind;
  const meta = { hasTail: TAILED.has(v.creature) || TAILED.has(v.ground) };
  return DRAW_SLOTS[kind].filter(s => !s.when || s.when(v, meta));
}

// ── master 盤點 ──────────────────────────────────────────────────────
/** 某角色需要哪些 master;morph 是地面/飛行雙型態(§5.0.1)。 */
export function mastersOf(ch) {
  return CHARACTERS[ch].kind === 'morph'
    ? [`${ch}_ground_static`, `${ch}_flight_static`]
    : [`${ch}_static`];
}

/** 已入庫設定稿的副檔名。**兩種都收**:早期那 61 張是 .png,agy 產的一律是 .jpg
 *  (`generate_image` 只出 JPEG,轉成 .png 只是把壓縮雜訊包進無損容器 —— 見 README「已知限制 1」)。
 *  只認 .png 的話,已經入庫的那 18 張會被判成「還沒畫」而重畫一次,額度就這樣燒掉。 */
export const MASTER_EXT = ['.png', '.jpg'];

export function missingMasters() {
  const have = new Set(readdirSync(ART_DIR)
    .filter(f => MASTER_EXT.includes(f.slice(f.lastIndexOf('.')).toLowerCase()))
    .map(f => f.slice(0, f.lastIndexOf('.'))));
  const out = [];
  for (const ch of Object.keys(CHARACTERS)) {
    for (const m of mastersOf(ch)) if (!have.has(m)) out.push({ ch, master: m });
  }
  return out;
}

/** 繪製順序(§5.0.1):機甲 → 無人機 → 變形者。 */
export const KIND_ORDER = ['robot', 'drone', 'morph'];

export function workList() {
  const out = [];
  for (const kind of KIND_ORDER) {
    for (const [ch, c] of Object.entries(CHARACTERS)) {
      if (c.kind !== kind) continue;
      out.push({ ch, kind, builder: builderOf(ch), visual: c.visual || {},
        masters: mastersOf(ch), slots: slotsOf(ch) });
    }
  }
  return out;
}

/** 已入庫設定稿的路徑;找不到就回 .png 那個名字(呼叫端一律再 existsSync 一次) */
export function masterPath(name) {
  for (const ext of MASTER_EXT) {
    const p = join(ART_DIR, `${name}${ext}`);
    if (existsSync(p)) return p;
  }
  return join(ART_DIR, `${name}${MASTER_EXT[0]}`);
}
export function hasMaster(name) { return existsSync(masterPath(name)); }

// 稽核入口住 gen2d.mjs(`--audit`)—— prompt.mjs 已經 import 這一支,在這裡反向
// 動態 import 它會是循環相依:兩邊的 top-level await 互等,node 直接 exit 13。
