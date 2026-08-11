/**
 * 2D 提示詞唯一縫(docs/ai3d_runbook.md §0.5 的九條規則 + 逐槽位 /edit 樣板)
 *
 * 兩種產出、兩套規格,MUST NOT 混用:
 *
 *   master(設定稿)  = 設計參考,要跟現有 46 張 cyberpunk_art/mechs/*.png **同一種畫風**
 *                      (綠幕、粗黑描邊、賽璐璐上色、全身 3/4 視角)。它不進 image→3D,
 *                      它是切圖的 {REF}。
 *   split(切圖)     = image→3D 的**輸入**,吃九條規則(灰底、全不透明、平光、無描邊)。
 *                      畫成漂亮插畫反而會在 3D 階段付代價(計畫 §5.2 開頭)。
 *
 * 設計敘述 MUST 取 `codex.js` 的機體檔案原文(`protoOf()` 原型層 + `mechaCodex().gen` 生成段)
 * —— 那是機體設計的權威敘述(A40 ⑤:值一律到原處取)。這裡**不轉譯**:轉譯就是第二份設計描述,
 * 而漂移只會表現成「新畫的這隻跟設定不太一樣」,沒有錯誤訊息。
 *
 * ⚠ 舊制取的是 `loreOf(ch)` 的自由字串,而那個欄位在 2026-08-04 的 A40 結構化改制裡已整組
 *   退場 ⇒ 條件恆為 falsy,整條「Design brief」一次都沒有送出去過,而且沒有任何錯誤訊息
 *   (提示詞看起來仍然很長:九條規則 + 底盤代碼詞表都還在)。修法見 9ede197。
 *   2026-08-05 覆核意見裡的「非人型,克蘇魯外型」「非人形,外觀以袋鼠為主」「非人形、犬型」
 *   「非人形、鴕鳥外觀」四條,逐字都寫在 mecha.js 的 `gen.sil`/`gen.note` 裡 —— 使用者是在
 *   手抄一份提示詞**本來就該自己帶上**的東西。故生成段(剪影/量體/材質/分件/生成注意)
 *   一併送出,`gen.note`(這一台最容易被畫錯的那件事)排在最後、最靠近輸出。
 */

import { CHARACTERS, MORPH_HUMANOID } from '../../public/js/data.js';
import {
  FORM_POSE, SHOT_POSES, formPose, shotFraming, mechaCodex, protoOf, protoLayers, visualUses,
} from '../../public/js/codex.js';
import { slotsOf } from './slots.mjs';

/** 九條規則(§5.2)—— 逐字一份,兩個消費端同吃。 */
export const NINE_RULES = [
  'exactly one object, isolated, complete, nothing else in frame',
  'full object visible, filling about 85% of the frame, even margin on all sides, not cropped',
  'three-quarter view, about 35 degrees yaw and 20 degrees elevation, long-lens (100mm) flattened perspective',
  'flat even ambient lighting, no cast shadow, no rim light, no blown highlights',
  'flat single-colour neutral background #808080, no gradient, no vignette, no ground plane',
  'fully opaque materials, no glass, no transparency, no glow, no emissive',
  'crisp panel lines, bolts and greebles, matte surface',
  'no text, no logos, no arrows, no dimensions, no watermark, no multi-view turntable sheet',
  '1024x1024, square',
].join(';\n');

// 陣營語彙:只講**戰術教條與工藝質感**,MUST NOT 講體型/生物形態。
// 體型的真相住 LEX 的 creature/flight/ground/proto —— 陣營這一行再插一句形態暗示,
// 兩個訊號就會打架。前科:SWARM 原本寫 "insectile",而 SWARM 底下有機械巨象、
// 人馬、克蘇魯,結果 s10 的飛鯨被那個字拉成了昆蟲(使用者回報 2026-08-04)。
const FACTION = {
  SWARM: 'SWARM alliance (蜂群同盟) — distributed swarm tactics: lightweight, numerous, cheap-to-replace hardware, thin panels and exposed wiring looms',
  STEEL: 'STEEL pact (鋼鐵協約) — heavy industrial armour doctrine: thick cast plate, blocky mass, welded seams and rivet lines',
  MERC: 'independent mercenary (傭兵) — mixed-provenance hardware, field-modified, mismatched panels and improvised brackets',
};

const hex = n => '#' + n.toString(16).padStart(6, '0');

/**
 * 描述子代碼 → 設計語義。**來源 = `models.js` 各 builder 的檔頭註解** —— 那是這些代碼
 * 唯一的權威定義(`buildMorphMech` / `buildAvianDrone` / `buildFixedWing` /
 * `buildBeastMech` / `buildBipedBeast` / `buildRobotMech` / `charPod` 上方那幾段)。
 *
 * 為什麼一定要翻出來:不翻的話模型看到的是 `"levi"` 這種三個字母,它會自己補一個。
 * 首烤 s10 就補成了昆蟲 —— 透明脈翅、六條腿(使用者回報:巨象該變巨鯨,不該混昆蟲特徵)。
 * 而那張圖是該隻約 10 張切圖的參考來源 ⇒ 一個沒解釋的代碼會污染整隻機體。
 *
 * 新增角色用到沒收錄的代碼 ⇒ `auditLexicon()` 紅字,MUST NOT 讓原始代碼漏進提示詞。
 */
const LEX = {
  // 變形者飛行型態(buildMorphMech 檔頭 B 類/A 類)
  flight: {
    jet: 'canard jet fighter (鴨翼戰機) — the legs fold together into a centre-mounted twin-engine nacelle; swept twin vertical tails deploy from the rear edge of the pelvis',
    uav: 'long straight-wing UAV (長直翼無人機) — the legs splay outward into twin tail booms with large V-tails at the boom ends',
    // 2026-08-05 修正:舊詞條寫「單旋翼 + 尾桁自背後展開」,但 models.js 的 2026-07-11
    // 「渡鴉三旋翼」重構**把披風翼/短翼掛架/尾桁全數移除**了(見 buildMorphMech 的 `F === 'heli'`
    // 區塊與 mkLeg 的 heli 分支)。詞表是餵給生圖模型的唯一機體描述 ⇒ 它一停留在舊版,
    // 收回來的就會是一架普通直升機,而遊戲裡跑的是 Y 字三旋翼 —— 兩者不會有任何錯誤訊息,
    // 只會在拿切圖去掛 rig 時才發現對不上(m01 覆核意見逐字描述的正是現行模型)。
    heli: 'TRICOPTER assault gunship (三旋翼突擊機) — it has NO tail boom and NO wings. '
      + 'The legs swing back and outward and lock out dead straight, so the torso and the two legs together form a letter "Y"; '
      + 'a rotor disc sits at the end of each leg (at the heel) and a third on a mast that unfolds from the back and stands above the nose — three rotors in all, arranged as an equilateral triangle. '
      + 'Both arms stay extended forward along the flight direction, hands holding the gun',
    tilt: 'tiltrotor carrier (傾轉旋翼母艦) — on the ground the rotor discs stow beside the fists as round shields; in flight the arms spread into wings and the discs tilt horizontal at the wingtips',
    // 使用者定案 2026-08-04:巨象變巨鯨,MUST NOT 混昆蟲特徵
    levi: 'LEVIATHAN FLYING WHALE (利維坦飛鯨) — a colossal whale-bodied flier: smooth streamlined cetacean hull, a blunt rounded head, broad slow-beating whale/manta-like flippers, and a horizontal fluked tail fin. It is a WHALE and MUST NOT have any insect traits: no membranous veined insect wings, no compound eyes, no chitin shell, no antennae, no mandibles, no extra pairs of limbs',
    archo: 'archaeopteryx (始祖鳥) — feathered bird wings with clawed wing-fingers and a long feathered tail',
    beetle: 'rhinoceros beetle (犀金龜) — shield-like elytra swing outward to release the membranous flight wings underneath',
    owl: 'owl (夜梟) — broad feathered wings with serrated silencing combs along the leading edge',
  },
  // 變形者地面型態(同檔頭;MORPH_HUMANOID 之外者為四足獸型)
  ground: {
    elephant: 'mechanical giant elephant (機械巨象) — a heavy quadruped with columnar legs, large ears and a trunk; the trunk folds flat to become the prow ram of the flight form',
    raptor: 'velociraptor (迅猛龍) — running posture, front claws tucked',
    beetle: 'rhinoceros beetle walking form (犀金龜) — low hard-limbed hexapod stance',
    panther: 'panther (夜豹) — sprung quadruped limbs, low prowling stance',
    biped: 'humanoid bipedal mech',
    wolf: 'wolf-motif humanoid bipedal mech (人形雙足,狼系意象)',
    vampire: 'vampire-motif humanoid bipedal mech (人形雙足,吸血鬼意象)',
    monkey: 'Sun-Wukong monkey-motif humanoid bipedal mech (人形雙足,悟空意象) — palmigrade stance, walks on its palms',
    atlas: 'atlas/porter-motif heavy humanoid bipedal mech (人形雙足,扛負重的力士意象)',
  },
  // 擬態翼無人機(buildAvianDrone 檔頭)+ 四足獸/雙足獸機甲(buildBeastMech / buildBipedBeast 檔頭)
  creature: {
    bee: 'mechanical bee (蜜蜂) — two pairs of insect wings, tail sting doubles as the gun barrel',
    eagle: 'mechanical eagle (機械鷹) — bladed feather wings with missile pylons under the wings, twin barrels under the chin',
    ptero: 'pterosaur (翼龍) — membrane wings, two clawed feet each gripping a weapon pod',
    dragon: 'mechanical dragon (機械龍) — membrane wings with a span far larger than the body, jaws open to reveal a missile nest',
    hound: 'mechanical war hound (機械獵犬) — quadruped, long-barrelled anti-materiel cannon carried on the back',
    centaur: 'centaur (人馬) — quadruped chassis carrying a humanoid upper torso that wields a long lance in both hands',
    stego: 'stegosaurus (劍龍) — the dorsal plate row is a bank of quad missile rails, the tail ends in a spiked mace',
    cthulhu: 'cthulhu (克蘇魯) — walks on four tentacles and wields weapons with four more; compound eye cluster and facial tendrils',
    gorilla: 'gorilla (猩猩) — knuckle-walking, right shoulder three-tube shotgun / left shoulder plasma vent, cast-iron pot shield on the left forearm',
    ostrich: 'ostrich / bionic crane (鴕鳥) — right wing hides missile tubes, left wing hides a coilgun rifle',
    trex: 'tyrannosaurus (暴龍) — forward-leaning trunk counterbalanced by a heavy tail, recoilless cannon hidden in the massive jaw, tiny forelimbs',
    roo: 'kangaroo (袋鼠) — powerful hind legs plus a ground-touching balance tail, fist-cannons on the forearms',
  },
  // 人型機甲原型(buildRobotMech 檔頭 —— 剪影/比例/裝備/站姿全部不同)
  proto: {
    bastion: 'BASTION over-armoured brawler (過裝甲重拳) — rounded huge shoulders, forearms thicker than the upper arms, head sunk between the shoulders, short thick legs with big feet; right hand carries an axe-cannon: a 152mm howitzer barrel with a revolver magazine and a large axe blade mounted on the side of the fore section',
    seraph: 'SERAPH inverted-triangle torso (倒三角上胸,EVA 式) — the whole upper chest is a triangle pointing down: its base is the shoulder line and its two upper corners are the shoulders, with binder pods standing on top; slender elongated limbs, exposed tendon cylinders, single horn and single eye; right hand carries a synchronised sniper cannon — an anti-materiel long rifle slightly taller than the mech, with a spike bayonet at the muzzle',
    aegis: 'AEGIS tower-shield interceptor (塔盾攔截機) — a square tower shield on the LEFT arm that can be planted on the ground, a rapid-fire cannon on the RIGHT forearm, and vertical launch cells on both shoulders whose muzzles always point straight up',
    colossus: 'COLOSSUS gentle giant (巨兵) — body and head are all rounded rectangles (flattened capsules); the limbs are built from rounded rectangular plates stacked end to end along their long edge (a centipede-segment feel: hip-knee-ankle-toe / shoulder-elbow-wrist-finger) with exposed joint axles between segments; two round eyes; a pulse cannon between the brows',
  },
  // 定翼無人機翼型(buildFixedWing 檔頭 + FIXED 表)
  wing: {
    twinboom: 'twin-boom layout (雙尾桁) — propeller driven',
    vtail: 'V-tail pusher layout (V 尾推進) — propeller driven',
    canard: 'canard layout (鴨式) — jet powered: draw tail nozzles, no propeller',
    delta: 'delta stealth flying wing (三角隱形飛翼) — jet powered: draw tail nozzles, no propeller',
    zero: 'Zero-fighter homage (零式 A6M) — radial engine with a tractor propeller, elliptical low-mounted wing, bubble canopy, single vertical tail',
  },
  // 多旋翼骨架 / 機身(buildDrone 檔頭)
  frame: {
    quad: 'quadrotor frame (四旋翼)', hexa: 'hexarotor frame (六旋翼)',
    coax: 'coaxial twin-rotor frame (共軸雙旋翼)', wing: 'fixed-wing frame (定翼)',
  },
  body: {
    box: 'boxy hull', wedge: 'wedge hull', sphere: 'spherical hull',
    slab: 'flat slab hull', frame: 'open skeletal frame hull',
  },
  // 機甲掛件(charPod 檔頭)
  pod: {
    antenna: 'a mast of sensor antennae on the back', cannon: 'a shoulder cannon',
    dish: 'a parabolic dish on the back', shield: 'a shield plate on the back',
    rack: 'a missile/launch rack on the back', blade: 'a stowed blade on the back',
    twin: 'twin pods on the back',
  },
  form: {
    beast: 'quadruped beast body plan', biped: 'bipedal beast body plan',
    avian: 'biomimetic flapping-wing body plan', fixed: 'fixed-wing body plan',
  },
};

/** 沒收錄的代碼 MUST 紅字 —— 原始代碼漏進提示詞 = 模型自己編一個(見 LEX 檔頭)。 */
export function auditLexicon() {
  const bad = [];
  for (const [ch, c] of Object.entries(CHARACTERS)) {
    for (const key of Object.keys(LEX)) {
      const code = (c.visual || {})[key];
      if (code && code !== 'none' && !LEX[key][code]) bad.push(`${ch}: visual.${key} = '${code}' 不在詞表內`);
    }
  }
  return bad;
}

/** visual 描述子 → 英文機體規格(經詞表展開,MUST NOT 送出原始代碼)。 */
function chassisSpec(v) {
  const bits = [];
  const put = (key, label) => {
    const code = v[key];
    // `visualUses`:這台機體用不到的欄位是換機種留下的殘值,送出去等於憑空多一條設計要求
    // (擬態翼無人機的 frame/body ⇒ 翼龍被寫成「共軸雙旋翼、球形艙」,見 codex.js 同一支)
    if (!code || code === 'none' || !visualUses(v, key)) return;
    bits.push(`${label}: ${LEX[key][code] || `"${code}"`}`);
  };
  put('proto', 'Prototype line');
  put('form', 'Body plan');
  put('creature', 'Biomimetic base');
  put('ground', 'GROUND form');
  put('flight', 'FLIGHT form');
  put('frame', 'Airframe');
  put('body', 'Hull');
  put('wing', 'Wing plan');
  put('pod', 'Dorsal pod');
  return bits.join('\n  · ');
}

/**
 * 肢體數目 —— **由槽位表推導**,MUST NOT 讓模型自己猜。
 *
 * 首批實測:s10(象)畫成六條腿、t06(猿)畫成六肢 —— 而 rig 只有 legL/legR + armL/armR
 * 四肢(犀金龜另加 midLegs 共六肢)。多出來的腿沒有對應的 rig 節點,拿這張當 {REF}
 * 去切「左腿」時就會切到一條**不存在的腿**,而那要到組裝完才看得出來。
 * 肢體數目是這張圖唯一有硬性答案的部分,所以它 MUST 寫進 prompt。
 */
function limbLine(ch) {
  const c = CHARACTERS[ch], v = c.visual || {};
  const slots = slotsOf(ch).map(s => s.slot);
  const has = k => slots.includes(k);          // 鏡射槽位 = 一對
  const parts = [];
  // 獸型變形者的 armL/armR 是**前腳**不是手臂(models.js:beast = !MORPH_HUMANOID.has(ground))
  const beastMorph = c.kind === 'morph' && !MORPH_HUMANOID.has(v.ground);
  if (beastMorph && has('leg') && has('arm')) {
    // **總數 MUST 把中足算進去**(2026-08-05 修):舊制固定寫死「exactly 4 limbs in total …
    // a quadruped body plan」,後面再補一句「exactly 2 middle legs (the third pair)」,
    // 最後還蓋一句「and no other limbs」—— 同一段話自相矛盾,模型只會照第一句畫。
    // 症狀就是 m07 犀金龜兩個型態收回來永遠是四隻腳(2026-08-04 覆核:「昆蟲有 6 隻腳」),
    // 而 mecha.js 早就寫著「六足定樁 ×6」—— 資料是對的,是這一行把它蓋掉了。
    const pairs = 2 + (has('mid_leg') ? 1 : 0);
    parts.push(`exactly ${pairs * 2} walking limbs in total, in ${pairs} pairs `
      + `(${pairs === 3 ? 'front, middle and rear — a HEXAPOD (six-legged) insect body plan'
        : 'one front pair and one rear pair — a quadruped body plan'}; the front pair are legs, not hands)`);
  } else {
    if (has('leg')) parts.push('exactly 2 legs');
    if (has('arm')) parts.push('exactly 2 arms');
    if (has('mid_leg')) parts.push('exactly 2 middle legs (the third pair)');
  }
  if (has('leg_front')) parts.push('exactly 2 front legs');
  if (has('leg_hind')) parts.push('exactly 2 hind legs');
  if (has('rider_arm')) parts.push('exactly 2 rider arms');
  if (has('tentacle')) parts.push('4 tentacle limbs');
  if (has('wing')) parts.push('exactly 2 wings (one mirrored pair, no extra wing pairs)');
  if (has('rotor')) parts.push('rotor discs instead of wings');
  if (!parts.length) return '';
  return `Limb count is fixed and MUST be obeyed: ${parts.join('; ')} — and no other limbs. Do not add extra legs, arms, wings or appendages.`;
}

/**
 * 非人形宣告 —— 有仿生原型或獸型地面型態的機體 MUST **明講**「這不是人形機甲」。
 *
 * 2026-08-04 覆核:s07(克蘇魯)/ s09(袋鼠)/ t04(犬型)/ t05(鴕鳥)四台收回來全是人形機甲,
 * 使用者逐台留下「非人型/非人形」四則意見。底盤規格那一行其實已經寫了 cthulhu/kangaroo/hound/
 * ostrich —— 但整份提示詞從頭到尾**沒有任何一句說「不要畫人形」**,而 "mecha unit"、"machine"
 * 這些字本身就把模型往人形機甲拉(訓練分布裡的 mecha 幾乎都是人形)。仿生原型只是一個
 * 「像什麼」的形容詞,壓不過那個先驗。
 *
 * 判定 MUST 推導、MUST NOT 手寫名單:人形 = 有**人形機甲原型層**(`protoLayers` 的 `frame`,
 * 由 `visual.proto` 推導)或地面型態在 `MORPH_HUMANOID` 裡;其餘凡有生物原型的一律非人形。
 * 這樣新增角色會自己落到對的那一邊。走 `protoLayers` 而非直接讀 `visual` 是 A40 ⑤ 的同一條
 * (值到原處取),也讓本檔維持「不出現任何 `.proto` 欄位讀取」——那正是稽核釘住的那一點。
 */
function bodyPlanLine(ch) {
  const c = CHARACTERS[ch], v = c.visual || {};
  if (protoLayers(ch).includes('frame')) return '';                   // 人形機甲原型 = 本來就是人形
  if (c.kind === 'morph' && MORPH_HUMANOID.has(v.ground)) return '';  // 人形變形者(狼/吸血鬼/悟空/力士)
  if (!LEX.creature[v.creature] && !LEX.ground[v.ground]) return '';  // 純載具(多旋翼/定翼)—— 不會被畫成人形
  return 'CRITICAL — this machine is NOT humanoid: no human head, no human face, no human torso, '
    + 'no upright two-legged human stance, no human shoulder-and-hip proportions, it does not stand like a person. '
    + 'Its skeleton IS the animal named above, rebuilt as a machine — take the biomimetic base literally, '
    + 'not as a decorative motif bolted onto a humanoid mech.';
}

/**
 * 機體設計敘述 —— 取 `codex.js` 組裝好的機體檔案原文(原型層 + 生成段)。
 * 這是**權威敘述**,MUST NOT 在這裡改寫或摘要(見檔頭)。
 *
 * 分隔用 ` ▸ `(同 `codex.js fmtField` 與 9ede197):原型名稱本身就含「」與 ——,
 * 64 層裡有 13 層的 `note` 自帶 —— ⇒ 拿那兩種符號當分隔會讀不出邊界。`label` 也 MUST 保住:
 * 拆層後丟掉標籤,等於把 A40 ③ 好不容易分開的兩個型態又揉回同一句話裡。
 *
 * **變形者的兩層一律都送**(不依型態濾掉另一層):`label` 已經把「飛行型原型 / 地面型原型」
 * 分得清清楚楚,而兩型本來就共用同一組零件(§5.0.1 MUST 1)—— 只送一層等於把
 * 「這是一台會變形的機器」這件事藏起來,而 `chassisSpec` 那邊本來也是兩型都列。
 * 真正指定「這一張畫哪一型」的是 `FORM_POSE`,不是這裡。
 * (`imagePrompt` 那條**關鍵詞**串則相反,會濾掉另一型 —— 那邊沒有 label,詞會打架。)
 */
function designBrief(ch) {
  const d = mechaCodex(ch);
  if (!d) return [];
  const proto = protoOf(ch).map((L) => `${L.label} ▸ ${L.src}:${L.note}`).join('\n  · ');
  const g = d.gen || {};
  return [
    proto && `Design brief (authoritative, Traditional Chinese):\n  · ${proto}`,
    g.sil && `Silhouette (authoritative, Traditional Chinese): ${g.sil}`,
    g.mass && `Mass proportions: ${g.mass}`,
    g.mat && `Surface and materials: ${g.mat}`,
    g.parts?.length && `Separable volumes (draw all of them, they become the 3D parts): ${g.parts.join(' / ')}`,
    // `gen.note` = 「這一台最容易被畫錯的那一件事」。它就是覆核意見的預防針 ⇒ 放最後(最靠近輸出)
    g.note && `MOST COMMON MISTAKE — do not make it: ${g.note}`,
  ].filter(Boolean);
}

/**
 * 設定稿 prompt。form = null | 'ground' | 'flight'(變形者雙型態)。
 * 畫風 MUST 對齊現有 master:綠幕 + 粗黑描邊 + 賽璐璐上色。
 * 型態姿態語(含取景)取 `codex.FORM_POSE` 單一縫 —— 覆核台的「重下 prompt」吃同一份。
 */
export function masterPrompt(ch, form = null, pose = 'static', refPath = null) {
  const c = CHARACTERS[ch], v = c.visual || {};
  // 沒有型態(非變形者)一律沿用地面那組取景 ⇒ 與舊制逐字相同。
  // 舊的 `formLine` 三元式已收進 `codex.FORM_POSE` 單一縫(覆核台的重下 prompt 同吃)
  const fp = formPose(ch, form);
  const act = SHOT_POSES.find((p) => p.key === pose);

  return [
    // 參考圖 = 這台機體**已通過**的那一張。覆核意見反覆出現的「機體仿照移動那張的外觀重繪
    // 此動作」講的就是這件事:三張姿態稿必須是同一台機器,而唯一能當錨的是通過的那張。
    // 沒有通過的圖時呼叫端改用同一段對話串接(agy -c),同樣不讓三張各想像各的。
    refPath && `Read the image file ${refPath}. That is THIS SAME machine, already approved. `
      + 'Keep its silhouette, proportions, panel layout, colours and every design detail identical — '
      + 'you are only changing what the machine is doing, never what it is.',
    `Concept art sheet for a mecha unit in a near-future war game. Unit id ${ch}, faction: ${FACTION[c.side] || c.side}.`,
    `Chassis specification:\n  · ${chassisSpec(v)}`,
    `Primary livery colour ${hex(v.hue)}, paint scheme "${v.paint}".`,
    ...designBrief(ch),
    limbLine(ch),
    bodyPlanLine(ch),
    fp?.en,
    act?.en,
    'Style: bold cel-shaded comic illustration, thick black ink outlines, hard-edged cel shading with two or three tone bands, saturated colours, cyan accent rim on the silhouette edge.',
    `Framing: the complete machine, full body, ${shotFraming(ch, form, pose)}, filling about 85% of the frame, even margin on all sides, nothing cropped.`,
    'Background: flat pure chroma-key green #22B14C, completely uniform, no gradient, no ground plane, no shadow on the background.',
    'Exactly one machine in frame. No pilot figure, no text, no logos, no labels, no watermark, no multi-view sheet.',
    '1024x1024, square.',
  ].filter(Boolean).join('\n');
}

/**
 * 逐槽位切圖 prompt(§5.2 樣板)。
 * refPath = 設定稿路徑;agy 要有 read_file 權限才吃得到(見 tools/ai3d/README.md)。
 */
export function slotPrompt(ch, slot, refPath) {
  const c = CHARACTERS[ch], v = c.visual || {};
  return [
    `Read the image file ${refPath} and use it as the authoritative design reference.`,
    `Then generate ONE image: redraw ONLY the "${slot.desc}" of that machine, detached from the rest of the body and shown on its own.`,
    `Keep that part's shape, proportions and surface detail faithful to the reference. Chassis context: ${chassisSpec(v)}.`,
    'Output requirements:',
    NINE_RULES + ';',
    'no black ink outline stroke around the silhouette;',
    'neutral mid-grey machine colour is acceptable — colour is applied later, shape and panel detail are what matter.',
    'Do not run any shell command.',
  ].join('\n');
}

/** 沒有參考圖時的退路(agy 無 read_file 權限)—— 品質較差,MUST 在交付說明中標註。 */
export function slotPromptNoRef(ch, slot, brief) {
  const c = CHARACTERS[ch], v = c.visual || {};
  return [
    `Generate ONE image: a single detached mecha part — the "${slot.desc}" of a near-future war machine.`,
    `Machine context: ${FACTION[c.side] || c.side}. Chassis: ${chassisSpec(v)}.`,
    // 同 masterPrompt:設計敘述取機體檔案原文(舊制那個自由字串已退場,恆為空)
    ...designBrief(ch),
    brief && `Part detail: ${brief}`,
    'Output requirements:',
    NINE_RULES + ';',
    'no black ink outline stroke around the silhouette;',
    'neutral mid-grey machine colour is acceptable — colour is applied later, shape and panel detail are what matter.',
    'Do not run any shell command.',
  ].filter(Boolean).join('\n');
}
