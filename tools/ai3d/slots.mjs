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
import { visualUses, SHOT_POSE_KEYS } from '../../public/js/codex.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..');
export const ART_DIR = join(REPO, 'public', 'assets', 'cyberpunk_art', 'mechs');
/** 本管線剛畫、**尚未驗收**的那一層(與 `tools/codex_review.mjs SOURCES` 的 `ai` 同一個目錄;
 *  這裡只用來排除「本輪已經畫好、正在等人覆核」的那幾張,免得續跑時重畫一次) */
export const NEW_MASTERS = join(REPO, 'tools', 'ai3d', 'masters');

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
    // `visualUses` 這一道不可省:擬態翼無人機(buildAvianDrone)的 rig **沒有 `spin` 節點**,
    // 但它的 `visual.frame` 仍留著換機種前的 'coax'/'hexa' 殘值 ⇒ 舊制會替 t07/t08/m04
    // 各排一張「旋翼臂」切圖,而那個零件**沒有任何 rig 節點掛得上去**。
    // (`auditCoverage` 驗的是「每個 rig 節點都有槽位涵蓋」,反方向不驗 ⇒ 它抓不到這個。)
    { slot: 'rotor_arm',   nodes: ['spin'],                 desc: 'one rotor arm with its propeller and motor nacelle', when: v => visualUses(v, 'frame') && v.frame && v.frame !== 'wing' },
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

// ── 覆核回饋:哪些設定稿被人退回了 ──────────────────────────────────────
// 2026-08-05 使用者定案:「根據生圖對照台的覆核,優先把 2D 生成圖無通過的機體補齊,
// 再來通過數最少的開始補圖;都優先補滿一張、讓所有機體至少有一張通過。」
//
// 舊制 `--masters` **只看檔案在不在**:設定稿一旦畫出來就永遠算數,覆核台把它判成
// 「重下 prompt」也沒有用 —— 生成端根本讀不到那份判決,`--redo` 也救不了(那條路要先
// 進得了 `missingMasters()` 的清單才輪得到)。覆核台與生成端之間因此是斷的:
// 人按了「⟳ 重下 prompt」,然後沒有任何工具會去重畫它。
//
// 優先序 MUST 是**推導**的,MUST NOT 手抄一份角色清單:名單會過期,而過期的名單不會報錯,
// 只會讓某一台永遠排不進來。單位 = 角色 × 型態(變形者的飛行型態是獨立的交付物 ——
// 它與地面型是兩張圖、兩個判決;併成一台來數,飛行型全軍覆沒也會被地面型的通過數蓋掉)。
const REVIEW_STATE = join(REPO, 'tools', 'codex_review', 'state.json');
const REDRAW = new Set(['redraw', 'reprompt']);

function reviewItems() {
  try { return JSON.parse(readFileSync(REVIEW_STATE, 'utf8')).items || {}; }
  catch { return {}; }        // 還沒覆核過 = 沒有判決可讀(原則 6:少一份輸入不是錯)
}

/** 這台機體要哪幾張圖(型態 × 動作)。命名與覆核台的 slot 同一條規則 `<id>[_<型態>]_<姿態>`;
 *  姿態清單走 `codex.SHOT_POSES` 單一縫(MUST NOT 在這裡再列一份 —— 兩份就是覆核台數得出
 *  「缺 38 張」而出圖端生不出來的那個病灶)。 */
export function shotsOf(ch) {
  const forms = CHARACTERS[ch].kind === 'morph' ? ['ground', 'flight'] : [null];
  const out = [];
  for (const form of forms) {
    for (const pose of SHOT_POSE_KEYS) {
      out.push({ ch, form, pose, slot: [ch, form, pose].filter(Boolean).join('_') });
    }
  }
  return out;
}

/** 逐單位的覆核帳:`{ ch, form, ok, shots }`。`shots[].need` = 這一張要不要(重)畫。 */
export function reviewUnits() {
  const items = reviewItems();
  const have = new Set(readdirSync(ART_DIR)
    .filter((f) => MASTER_EXT.includes(f.slice(f.lastIndexOf('.')).toLowerCase()))
    .map((f) => f.slice(0, f.lastIndexOf('.'))));
  const drawn = new Set(existsSync(NEW_MASTERS)
    ? readdirSync(NEW_MASTERS).map((f) => f.slice(0, f.lastIndexOf('.'))) : []);
  const out = [];
  for (const ch of Object.keys(CHARACTERS)) {
    const byForm = new Map();
    for (const s of shotsOf(ch)) {
      if (!byForm.has(s.form)) byForm.set(s.form, []);
      byForm.get(s.form).push(s);
    }
    for (const [form, shots] of byForm) {
      const ok = shots.filter((s) => items[s.slot]?.status === 'ok').length;
      out.push({
        ch, form, ok,
        shots: shots.map((s) => ({
          ...s,
          ok: items[s.slot]?.status === 'ok',
          // 要(重)畫的條件恰兩條:根本沒有這張圖,或人明確判了「局部重繪 / 重下 prompt」。
          // **未覆核不算退回** —— 那只是還沒輪到人看,重畫它等於把額度花在沒人抱怨的圖上。
          // 本輪已經畫出來(masters/ 有了)也不再排 —— 那張正在等人覆核,不是還沒畫。
          need: !drawn.has(s.slot) && (!have.has(s.slot) || REDRAW.has(items[s.slot]?.status)),
          // 參考圖只認**通過**的那張:覆核意見「機體仿照移動那張的外觀重繪此動作」要的正是它。
          // 指向被否決的那張 = 把錯誤原樣複製一遍。
          ref: items[s.slot]?.status === 'ok' && have.has(s.slot),
        })),
      });
    }
  }
  return out;
}

/** 要(重)畫的角色,依使用者定案的優先序:通過數少的先(0 通過的最前面)。
 *  變形者兩型共用一段對話 ⇒ 以角色為單位排,排序鍵取該角色**最慘的那一型**。 */
export function masterQueue() {
  const byCh = new Map();
  for (const u of reviewUnits()) {
    const need = u.shots.filter((s) => s.need);
    if (!need.length) continue;
    const cur = byCh.get(u.ch);
    if (!cur) byCh.set(u.ch, { ch: u.ch, ok: u.ok, forms: [u.form], need });
    else { cur.ok = Math.min(cur.ok, u.ok); cur.forms.push(u.form); cur.need.push(...need); }
  }
  // 同分時按機種順序(§5.0.1 機甲 → 無人機 → 變形者),再按宣告序 —— 逐次執行結果一致
  const ids = Object.keys(CHARACTERS);
  return [...byCh.values()].sort((a, b) => a.ok - b.ok
    || KIND_ORDER.indexOf(CHARACTERS[a.ch].kind) - KIND_ORDER.indexOf(CHARACTERS[b.ch].kind)
    || ids.indexOf(a.ch) - ids.indexOf(b.ch));
}

/**
 * 這台機體可以拿來當設計參考的那一張,回 `{ slot, path, tier }`;找不到回 null
 * (⇒ 呼叫端改用同一段對話串接,由第一張定案設計)。
 *
 * 優先序**分兩級,不可混為一談**:
 *   ① 已通過且在入庫層  —— 覆核意見「機體仿照移動那張的外觀重繪此動作」指的就是它。
 *   ② 本輪剛畫、尚未覆核 —— 比沒有錨好得多:同一台機體的三張姿態稿若各畫各的,收回來就是
 *      三台不同的機器(那正是那幾則覆核意見的成因)。它與①的差別 MUST 記在帳本裡。
 * **被判退的那張永遠不當錨**(指向它 = 把錯誤原樣複製一遍)—— 這是 ① 要求 `ok` 的理由,
 * 而 ② 取的是 masters/ 那一層,判退的舊圖不在那裡。
 * 同型態優先於別的型態(變形者的地面稿是飛行稿的剪影錨)。
 */
export function refShotOf(ch, form) {
  const units = reviewUnits().filter((u) => u.ch === ch);
  const drawn = existsSync(NEW_MASTERS)
    ? new Set(readdirSync(NEW_MASTERS).map((f) => f.slice(0, f.lastIndexOf('.')))) : new Set();
  const cand = (us, tier) => {
    const all = us.flatMap((u) => u.shots).filter((s) => tier === 1 ? s.ref : drawn.has(s.slot));
    const hit = all.find((s) => s.pose === 'static') ?? all[0];
    if (!hit) return null;
    const path = tier === 1 ? masterPath(hit.slot) : join(NEW_MASTERS, `${hit.slot}.jpg`);
    return { slot: hit.slot, path, tier };
  };
  const same = units.filter((u) => u.form === form);
  return cand(same, 1) ?? cand(units, 1) ?? cand(same, 2) ?? cand(units, 2) ?? null;
}

/** 優先序壞掉 MUST 紅字 —— 排序是使用者定案的規則,而排錯了不會報錯,只會讓某一台
 *  一直排在後面(額度先花在別人身上),而畫面上完全看不出來。 */
export function auditQueue() {
  const bad = [];
  const q = masterQueue();
  for (let i = 1; i < q.length; i++) {
    if (q[i].ok < q[i - 1].ok) bad.push(`優先序不是「通過數少的先」:${q[i - 1].ch}(${q[i - 1].ok})排在 ${q[i].ch}(${q[i].ok})之前`);
  }
  const inQ = new Set(q.map((x) => x.ch));
  for (const u of reviewUnits()) {
    if (u.need && !inQ.has(u.ch)) bad.push(`${u.ch}${u.form ? `/${u.form}` : ''} 的設定稿要重畫卻不在佇列裡`);
    if (!u.need && u.ok === 0 && !inQ.has(u.ch)) {
      // 0 通過但設定稿沒被判退 = 還沒覆核到那一格;這不是錯,但**要看得見**(原則 6 的「不藏」)
      bad.push(`⚠ ${u.ch}${u.form ? `/${u.form}` : ''} 0 通過但設定稿未被判退(還沒覆核?)`);
    }
  }
  return bad;
}

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
