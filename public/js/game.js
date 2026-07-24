// ============ 戰鬥客戶端:第一人稱 無人機 vs 機甲 + DOTA 兵線 ============
// 伺服器權威(HP/傷害/波次),客戶端負責:
//  - 3D 渲染(地形 + 單位 + 特效)
//  - 第一人稱操控(蜂群=飛行無人機、鋼鐵=地面機甲)
//  - 射擊 raycast 命中回報、範圍技落點回報
//  - 2D 戰術地圖(minimap,繼承 mapping_elf 的 2D 地圖概念)
import * as THREE from 'three';
import {
  SIDES, UNITS, GAME, ECON, upgradePrice, HAZARDS, FIELD, AFFIXES,
  CHARACTERS, heroWeapon, heroAbility, heavyMpCost, BALLISTIC, vsMult, dmgFalloff, MORPH, LOCK, DECOY, DECOY_BOMB, BARRAGE, SQUAD, RECOIL,
  WATER, CJUMP, IFRAME, AIR, envTrigger, sideInfo, isThirdSide, THIRD, AIRDROP, CIVILIAN, CIVILIANS,
  ALTITUDE, altF, isGunnery, TERRAIN_FX, SHAKE, TARGET_CLASS,
  aoeClass, trajClass, lanceR, LANCE, ARMING, armingOf,
} from './data.js';
import { llToWorld } from './terrain.js';
import { terrainEnvCode } from './biomes.js';
import { makeUnit, heroTargetH, SOLDIER_H, MORPH_HUMANOID, podWeapon } from './models.js';
import { applyEnvironment } from './environment.js';
import { buildHazard, buildMineBump, buildLoot, buildAirdrop } from './hazards.js';
import { toonMat, outlinify, updateCelLight } from './toon.js';
import { heroPalette, paintUnit } from './paint.js';
import { stepLocomotion, stepCombatFx } from './locomotion.js';
import { comicPop, starburst, shockRing, damageNumber, debrisBurst, makeShield, lockGlow, beamLine, projectileMesh, decoyBombMesh, cycloneJet, gundamBeam, ionBreath } from './vfx.js';
import { spawnCastFx } from './castfx.js';
import { CutIn } from './cutin.js';

const KIND_KEY = {
  soldier: 'creep:soldier', apc: 'creep:apc', tank: 'creep:tank',
  rocketeer: 'creep:rocketeer', howitzer: 'creep:howitzer', heli: 'creep:heli',
  tower: 'tower', drone: 'hero:drone', robot: 'hero:robot', morph: 'hero:morph', decoy: 'decoy',
  bunker: 'bunker',   // 第三方碉堡(GUER/MILI)
  kami: 'hero:drone', // 自殺攻擊機:渲染成該角色的無人機(_spawnUnit 縮小 1/3)
};
const HERO_KINDS = new Set(['drone', 'robot', 'morph']);
// 英雄碰撞圓柱:半徑正比機體實高。係數沿用舊制觀感(robot 6m→r 2.6、drone 3m→r 2.4),
// 體型改綁角色護甲後,碰撞跟著等比走 —— 巨大機甲既難閃也難躲。
const HERO_COL_R = { robot: 0.43, morph: 0.43, drone: 0.80 };
const heroCollider = (kind, ch) => {
  const h = heroTargetH(kind, ch);
  return { r: h * (HERO_COL_R[kind] ?? 0.43), h: h * 1.08 };
};
// 自機碰撞/視點的身高比例(同樣校準自舊制:robot 6m→myR 1.9 / eye 3.4、drone 3m→myR 1.6)
const SELF_F = {
  groundR: 0.317, groundTop: 0.70, eye: 0.567,
  flyR: 0.533, flyBot: 0.267, flyTop: 0.40,
};
// FPV 視點 = 該機體「駕駛艙/頭艙」在自身幾何上的實際位置(2026-07-12):
//   e = 佔機體實高的比例(舊制全機種一律 0.567 = 人形胸腔,套到水平體軸的獸型就成了「從肚子看出去」)
//   f = 沿正面方向(-z)前移的比例 —— 水平體軸的獸首遠在身前,人形機甲的頭則幾乎在正上方。
// 鍵 = visual.proto / visual.creature / visual.ground(變形機甲地面體態);查無 → DEF。
const VIEW_SHAPE = {
  // 人形機甲(艙在胸腔上緣~頸根)
  bastion: { e: 0.72, f: 0.10 }, seraph: { e: 0.76, f: 0.08 },
  aegis: { e: 0.70, f: 0.10 }, colossus: { e: 0.80, f: 0.06 },
  // 頭部艙(直立體態):視點就在顱腔內
  gorilla: { e: 0.82, f: 0.18 }, roo: { e: 0.86, f: 0.14 }, cthulhu: { e: 0.74, f: 0.16 },
  // 頸部艙(水平體態):視點在頸根,頭顱在前下方 → 前移量小(頭本身佔前方視野)
  hound: { e: 0.74, f: 0.12 }, trex: { e: 0.80, f: 0.10 }, ostrich: { e: 0.84, f: 0.12 },
  stego: { e: 0.62, f: 0.14 }, centaur: { e: 0.88, f: 0.08 },
  // 變形機甲地面體態(人形 = 頭部艙 / 獸型 = 頸部艙)
  vampire: { e: 0.80, f: 0.08 }, monkey: { e: 0.76, f: 0.16 },
  wolf: { e: 0.78, f: 0.12 }, atlas: { e: 0.74, f: 0.16 },
  elephant: { e: 0.74, f: 0.12 }, raptor: { e: 0.78, f: 0.10 },
  beetle: { e: 0.66, f: 0.14 }, panther: { e: 0.72, f: 0.12 },
};
const VIEW_DEF = { e: SELF_F.eye, f: 0.10 };
// 駕駛艙座位(2026-07-12):仿生體的艙位由行進體態決定 ——
//   'head' 體軸偏直立(人形機甲 / 猩猩 / 袋鼠 / 章魚 / 狼 / 吸血鬼 / 悟空 / 亞特拉斯):
//          艙在頭部 → 看出去是自己的頭殼內壁(眉骨/頰骨/吻部/獠牙)
//   'neck' 體軸偏水平(獵犬 / 暴龍 / 鴕鳥 / 劍龍 / 人馬 / 迅猛龍 / 黑豹 / 巨象 / 犀金龜):
//          艙在頸根 → 看出去先看到自己的頭顱與頸背(嘴砲就從那顆頭的口中前伸)
const SEAT = {
  hound: 'neck', trex: 'neck', ostrich: 'neck', stego: 'neck', centaur: 'neck',
  raptor: 'neck', panther: 'neck', elephant: 'neck', beetle: 'neck',
};
const seatOf = (creature) => SEAT[creature] || 'head';
// 輕武器掛點(2026-07-12):武器長在機體哪裡由機體構造決定 ——
//   hand 手持 / tentacle 觸手持械 / mouth 嘴砲(龍·暴龍·電漿口)/ back 背載砲塔(無手仿生體)
//   / body 機身固定(旋翼無人機吊艙)/ wing 機翼固定(戰機硬點)/ claw 爪掛槍莢
const GUN_MOUNT = {
  // 人形機甲 + 有手的仿生體(2026-07-17:trex 輕武器移到手上、gorilla 改扛肩 = back 錨)
  bastion: 'hand', seraph: 'hand', aegis: 'hand', colossus: 'hand',
  gorilla: 'back', roo: 'hand', centaur: 'hand', cthulhu: 'tentacle',
  // 無手仿生體:嘴砲 or 背載 or 翼藏(ostrich 2026-07-17 輕武器藏左翼)
  trex: 'hand', hound: 'back', ostrich: 'wing', stego: 'back',
  // 變形機甲地面體態(2026-07-17:raptor 雙手托槍、monkey 如意棒砲扛肩 = back 錨)
  wolf: 'hand', vampire: 'hand', monkey: 'back', atlas: 'hand',
  raptor: 'hand', elephant: 'mouth', beetle: 'mouth', panther: 'back',
  // 擬態無人機 / 擬態飛行體態
  bee: 'mouth', eagle: 'mouth', dragon: 'mouth', ptero: 'claw',
  levi: 'mouth', archo: 'mouth', owl: 'mouth',
  // 機械飛行體態
  heli: 'body', tilt: 'body', jet: 'wing', uav: 'wing',
};
// 掛點錨的退路(座艙 builder 沒提供錨時):x = 右側掛點(wing/claw 鏡射成對)、s = 口徑倍率
const DEF_ANCHOR = {
  hand: { x: 0.5, y: -0.4, z: -1.0, s: 1.12 },
  tentacle: { x: 0.52, y: -0.5, z: -0.95, s: 1.2 },
  mouth: { x: 0, y: -0.6, z: -1.35, s: 1.05 },
  back: { x: 0.52, y: 0.48, z: -1.55, s: 0.85 },
  body: { x: 0.2, y: -0.34, z: -0.7, s: 1.0 },
  wing: { x: 0.9, y: -0.22, z: -1.0, s: 1.0 },
  claw: { x: 0.42, y: -0.72, z: -1.05, s: 0.9 },
};
// 重武器掛點(2026-07-22 FPV 武裝同源):FPV 重武器模型的掛點(輕武器沿用 GUN_MOUNT)。
// 手持機種(rig.weap 'L'/'R'/'B')優先走 hand 不查此表;查無 → 沿用該機體輕武器掛點。
// 對齊第三人稱建模位置:aegis 雙肩 VLS/colossus 眉心砲/stego 背鰭/elephant 背載加農/monkey 尾砲 = back,
// trex 口腔無後座砲/dragon 口腔飛彈巢/beetle 顎下電漿陣 = mouth,eagle/ostrich 翼掛 = wing。
const HEAVY_MOUNT = {
  aegis: 'back', colossus: 'back', trex: 'mouth', stego: 'back', hound: 'back',
  gorilla: 'back', ostrich: 'wing', cthulhu: 'tentacle',
  elephant: 'back', monkey: 'back', panther: 'back', beetle: 'mouth',
  bee: 'body', eagle: 'wing', dragon: 'mouth', ptero: 'claw',
};
/** gunMount 的鍵解析(morph 地面/飛行體態、drone 擬態獸;與 gunMount 內部同一條規則) */
function mountKey(vis, kind, air) {
  if (kind === 'morph') return air ? vis.flight : vis.ground;
  if (kind === 'drone') return vis.form === 'avian' ? vis.creature : null;
  return vis.proto || vis.creature;
}
// rig.wpn.fwd(武器在自身/參考框的前向軸)→ FPV 前向(-z)的修正旋轉
const WPN_FWD_ROT = {
  z: [0, Math.PI, 0], '-z': [0, 0, 0],
  y: [-Math.PI / 2, 0, 0], '-y': [Math.PI / 2, 0, 0],
  x: [0, Math.PI / 2, 0], '-x': [0, -Math.PI / 2, 0],
};
// 座艙武器目標長度(公尺,依掛點;× 錨點口徑倍率 s)—— 第三人稱武裝縮放進座艙的定尺基準
const COCK_WLEN = { hand: 1.25, tentacle: 1.05, mouth: 1.1, back: 1.25, body: 0.9, wing: 0.85, claw: 0.85 };
/**
 * FPV 取景規則(2026-07-24 使用者需求的**唯一真相**;稽核 = tools/audit_cockpit.mjs):
 * ① 視野不可妨礙視線 → 準星錐 SIGHT_DEG 半角內 MUST 淨空(座艙任何件的投影都不得侵入)
 * ② 各件頂緣 MUST ≤ TOP_NDC = HUD 下帶上緣 → 準星 的 **2/3 處**(不得高過此線靠近準星)
 * ③ 面積不可太大 → 座艙總遮擋 ≤ AREA_MAX、武裝 ≤ WPN_AREA_MAX;
 *    且**與武器/招式無關的裝置**每件面積 MUST ≤ 該座艙最大單一武器件(DEV_AREA;稽核硬性)
 * ④ 透視圖法、消失點在準星 → 武裝一律朝**視軸上 VP_Z 公尺處**(= 準星方向)收斂,
 *    近端寬、遠端窄的楔形剪影把視線導向準星;等同真實武器的校靶匯聚(boresight harmonisation)。
 * 幾何換算(fov 68 全機種,A8):畫面半高張角 34° → tan34 = 0.6745;
 * 深度 z 處的畫面半高 = 0.6745|z|、半寬 = 半高 × aspect。NDC 邊界 ±1。
 */
const HUD_BOTTOM_F = 0.22;                       // HUD 下帶佔畫面高比例(index.html .hud-bottom;實測 22%)
const HUD_TOP_NDC = -1 + 2 * HUD_BOTTOM_F;       // HUD 下帶上緣 NDC y(≈ −0.56)
export const COCKPIT = {
  SIGHT_DEG: 11,        // 準星錐半角(= 中央 1/3 視野,與焰球外推同一條界)。硬規則:錐內零遮擋
  AREA_MAX: 0.21,       // 座艙總遮擋上限(畫面比例)—— 至少 79% 畫面全清(最忙座艙 = 旋翼/進氣口/獸耳)
  WPN_AREA_MAX: 0.12,   // 武裝(gunGroup:手臂/砲座/武器本體)遮擋上限 —— 輕重同時可見 + 持槍手臂
  // 頂緣天花板:HUD 上緣 → 準星 的 2/3 處(= HUD_TOP_NDC/3 ≈ −0.187)。件的頂緣不得高過此線 ⇒
  // 準星周圍上方 1/3 恆淨空、所有座艙元素壓在畫面下段。武器與結構共用同一條線(**MUST NOT** 分家)。
  TOP_NDC: HUD_TOP_NDC / 3,
  WPN_BOX_MAX: 0.042,   // 單件武裝的 NDC 包圍盒佔畫面比例上限(輕/重各一件 ⇒ 合計 ≈ WPN_AREA_MAX)
  DEV_AREA_MAX: 0.035,  // 與武器/招式無關的裝置每件面積上限 —— **< WPN_BOX_MAX**(裝置恆比武器小)
  VP_Z: 25,             // 消失點距離(公尺):視軸上的匯聚點,螢幕上就是準星
  VP_TOL_DEG: 12,       // 武器軸線與「武器 → 消失點」的容許夾角
  TAN_V: 0.674443,      // tan(fov/2) @ fov 68
};
/** 深度 |z| 處、NDC 半徑 1 對應的世界半高(公尺):座艙件的貼邊/淨空換算唯一縫 */
const ndcH = (z) => Math.abs(z) * COCKPIT.TAN_V;
// 重武器 third-person 掛點動畫(2026-07-13;2026-07-15 移居 locomotion.js stepCombatFx):
// ent.heavyFx / ent.fireFx 事件驅動的蓄力/擊發/後座/射姿動畫全數住 stepCombatFx ——
// 戰場(這裡)與選角展示台(charPreview)共用同一條,MUST NOT 在 game.js 另寫一份。
/** 該機體(該型態)的輕武器掛點。電漿是口噴武器:無手仿生體的背載一律改嘴砲 */
function gunMount(vis, kind, air, wtype) {
  let m;
  if (kind === 'morph') m = GUN_MOUNT[air ? vis.flight : vis.ground] || (air ? 'body' : 'hand');
  else if (kind === 'drone') {
    m = vis.form === 'avian' ? (GUN_MOUNT[vis.creature] || 'mouth')
      : vis.form === 'fixed' ? 'wing' : 'body';
  } else m = GUN_MOUNT[vis.proto || vis.creature] || 'hand';
  if (wtype === 'plasma' && m === 'back') m = 'mouth';   // 電漿:從口中噴出,不是背上發射
  return m;
}
// 飛行型態:機體軸線水平,視點 = 機鼻(高度取機體中心 0,只沿正面前移)
const VIEW_FLY_F = { avian: 0.42, fixed: 0.55, rotor: 0.25, morph: 0.45 };
/** 該角色機體的 FPV 視點比例(依形狀,不是依機種)。flying = 飛行型態 */
const heroView = (kind, ch, flying) => {
  const vis = (ch && CHARACTERS[ch]?.visual) || {};
  if (flying) {
    const cls = kind === 'morph' ? 'morph' : (vis.form === 'avian' || vis.form === 'fixed' ? vis.form : 'rotor');
    return { e: 0, f: VIEW_FLY_F[cls] };
  }
  return VIEW_SHAPE[vis.proto || vis.creature || vis.ground] || VIEW_DEF;
};
const LANE_COLORS = [0xe6c34a, 0xe05c4a, 0x4ac3e6];

// ---- 敵方標示:走進視野的敵人頭上掛「對方陣營主視覺」的下指箭頭(spotted marker)----
// 主視覺 = 陣營識別色 + 徽記幾何(STEEL 鋼鐵三角 / SWARM 蜂群倒三角,同 logo 語彙)。
// 迷霧是伺服器過濾的:快照裡出現 = 已進入視野,所以「有 mesh 就該有標示」。
const _markTex = new Map();
function factionMarkTex(side) {
  if (_markTex.has(side)) return _markTex.get(side);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const col = sideInfo(side).color;                // 第三方(GUER/MILI)也有識別色
  const tri = (cx, cy, r, up) => {                 // 陣營徽記:鋼鐵正三角 / 蜂群倒三角
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (up ? -Math.PI / 2 : Math.PI / 2) + k * Math.PI * 2 / 3;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  };
  const diamond = (cx, cy, r) => {                 // 第三方徽記:菱形(與雙陣營三角分家)
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.72, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.72, cy);
    g.closePath();
  };
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(10,14,18,0.9)';
  g.fillStyle = col;
  g.lineWidth = 7;
  g.beginPath();                                   // 下指箭頭本體(V 形楔子)
  g.moveTo(20, 46); g.lineTo(64, 108); g.lineTo(108, 46);
  g.lineTo(86, 46); g.lineTo(64, 76); g.lineTo(42, 46);
  g.closePath();
  g.stroke(); g.fill();
  if (SIDES[side]) tri(64, 26, 22, side === 'STEEL');   // 徽記懸在箭頭上方
  else diamond(64, 26, 24);
  g.stroke(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';        // 內描白邊:暗底/亮底都讀得出來
  g.lineWidth = 2;
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  _markTex.set(side, t);
  return t;
}
// 副視窗(PiP):無人機僚機視角 / 機甲餌機視角
// 靠左上:右下角是 minimap、右上角是 kill-feed(兩者都是 DOM,永遠疊在 WebGL 畫布上方)
const PIP = { W_FRAC: 0.17, MAX_W: 250, ASPECT: 0.62, PAD: 12, TOP: 58, GAP: 8, FOV: 78 };

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
    this._deathSeq = null;   // 陣亡過場狀態機:null=未播(哨兵);物件=播放中。gate 皆 truthiness、teardown 皆 = null
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
    this._flashHeavy = false;       // 上一發是否重武器(槍口焰放大)
    // 後座力機制(見 data.js RECOIL):連射回穩 + 高後座重武器開火前穩定 + 開火中位移懲罰
    this._burstN = {};              // slot -> 連射計數(達 profile.burst 後強制回穩)
    this._settleUntil = {};         // slot -> 回穩解除時間戳(此間不能擊發)
    this._steadyAt = 0;             // 高後座重武器:開始「停穩」的時間戳(0 = 尚未穩定)
    this._recoilMove = null;        // 當前開火套用的位移懲罰 tier('slow'|'stop'|'back'|'free')
    this._recoilMoveUntil = 0;      // 位移懲罰有效到此時間
    this._recoilSlowF = 0.5;
    this.samMeshes = new Map();      // 防空飛彈(伺服器權威,快照 sm 同步)
    this._visShells = [];            // 他人重武器視覺彈體(2026-07-22 彈藥同源;純表現層)
    this._decoyBombs = [];           // 餌機投彈的「拋擲彈體」動畫(2026-07-22;落地才引爆演出,依類型上色)
    this._barragePids = new Map();   // 他人重砲(巨炮)開窗時戳:pid → until(氣旋噴射曳光轉播)
    this._wdefCache = new Map();     // 他人武器 def 快取(ch:slot → heroWeapon Lv1)
    this.lootMeshes = new Map();     // 戰場物資(快照 lt 同步)
    this.airdropMeshes = new Map();  // 空投物資補給箱(快照 ad 同步)
    this.mineMeshes = new Map();     // 地雷微凸起(field 訊息一次同步)
    this.flamers = new Set();        // 火場(火舌閃爍動畫)
    this.floods = [];                // 淹水區(機甲減速判定)
    this.fires = [];                 // 火場(滯留視野霧化判定;傷害由伺服器結算)
    this._fireDwell = 0;             // 火場滯留累計秒(離開後較快消散 → 視野漸清)
    this._swampDwell = 0;            // 沼澤滯留累計秒(越陷越深 → 移動漸慢至 1/8;離開即歸零)
    this._env = { code: 0, depth: 0, ground: 0, air: false }; // 領機當幀環境(每幀 _envAt 更新;見該函式)
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
    this.abil = { light: 1, heavy: 1, skill: 1, ult: 1 };   // 招式開場即 Lv1 可用(2026-07-20)
    this.wdef = {};                   // slot -> 解析後武器數值(含英雄倍率與階級)
    this.wstate = {};                 // slot -> { ammo, reloadEnd }(本地 HUD;伺服器另行把關)
    this.lastFireAt = { light: 0, heavy: 0 };
    this.bullets = [];                // 彈道學子彈(初速 mv + 重力,射程上限)
    this._setChar(this.ch || null);
    this.money = 0;
    this.upg = { lw: 0, hw: 0, sk: 0, ult: 0, hp: 0, ar: 0, sp: 0, ch: 0 };   // 八軌升級(快照 o.up 回寫)
    this.sp = 0; this.maxSp = 1;      // 護盾(雙層 HP 第一層,脫戰自然回復)
    this.mp = 0; this.maxMp = 1;      // 電力(招式資源)
    this.kn = 0;                      // 擊殺數(招式解鎖門檻)
    this.cds = [0, 0];                // [小招, 大招] 冷卻(伺服器倒數)
    this.empLeft = 0;                 // 遭電磁癱瘓剩餘秒數(武器/招式離線)
    this.stealthLeft = 0;
    this.shopOpen = false;
    this.paused = false;              // 戰場選單開啟中(凍結輸入)
    this._everLocked = false;         // 曾經取得過指標鎖定(未鎖定過不跳暫停選單)
    this._gameOver = false;           // 已分出勝負(over overlay 顯示中,不跳暫停選單)
    this._crashSent = false;          // 撞擊引爆去重
    this.aiming = false;              // 右鍵短按切換瞄準(拉近視角、切換重武器);長按 = 機種專屬招
    this._rmbDownAt = 0;              // 右鍵按下時刻(0 = 未按);達門檻 → 出招,短按放開 → 切換模式(見 _tickSnipeAbility / _onMouseUp)
    this._rmbAbilityFired = false;    // 本次按住右鍵是否已觸發專屬招(觸發後放開不再切換模式 → 切換/出招互不衝突)

    this._initScene();
    this._initLanes();
    this._initInput();
    this._initMinimap();
    this._buildCockpit();

    // 出生點:己方主堡朝敵方主堡方向外推 GAME.HERO_SPAWN_OFF(避免卡在主堡模型裡),面向敵方
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
    // FPV 一律 UNITS[kind].fov = 68(2026-07-12 起全機種相同):同距離目標的視覺大小雙陣營必須一致,
    // 廣角會把 NPC 畫小 —— 機體差異只表現在座艙造型與視點位置(heroView),不表現在 FOV。
    const fov = this.heroKind ? UNITS[this.heroKind].fov : 68;
    this.baseFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, this.canvas.clientWidth / this.canvas.clientHeight, 0.5, span * 2);
    // 副視窗共用相機(僚機 / 餌機視角;每幀重設位置後重複使用)
    this.pipCam = new THREE.PerspectiveCamera(PIP.FOV, 1 / PIP.ASPECT, 0.5, span * 2);

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
    // 障礙碰撞柱空間索引(建物/神木/巨岩/橋墩):彈道/準星射線的遮蔽判定用。
    // 障礙有物理碰撞就不可讓砲火穿越 —— 與 _collide 用同一份 terrain.blockers,牆與彈道一致。
    this._blockGrid = this._buildBlockGrid(this.terrain.blockers || []);
  }

  /** 障礙柱 → 64m 均勻網格(彈道線段只掃沿途格) */
  _buildBlockGrid(blockers) {
    const C = 64;
    const grid = new Map();
    blockers.forEach((b) => {
      const i0 = Math.floor((b.x - b.r) / C), i1 = Math.floor((b.x + b.r) / C);
      const j0 = Math.floor((b.z - b.r) / C), j1 = Math.floor((b.z + b.r) / C);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = `${i},${j}`;
          let a = grid.get(k);
          if (!a) grid.set(k, a = []);
          a.push(b);
        }
      }
    });
    return { C, grid };
  }

  /**
   * 線段 vs 障礙圓柱(建物/神木/巨岩/橋墩):回傳最近命中距離(沿線段),沒打到回 null。
   * 圓柱 = _collide 同一份碰撞柱(x, z, y 基座, r, h)—— 側面進入與自上而下打頂面都算。
   * 有物理障礙的物件不可讓砲火穿越;植被(無碰撞)照舊不擋彈。
   */
  _blockerHitT(ax, ay, az, bx, by, bz) {
    if (!this._blockGrid) return null;
    const { C, grid } = this._blockGrid;
    const i0 = Math.floor(Math.min(ax, bx) / C), i1 = Math.floor(Math.max(ax, bx) / C);
    const j0 = Math.floor(Math.min(az, bz) / C), j1 = Math.floor(Math.max(az, bz) / C);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    let bestT = null;
    const seen = new Set();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = grid.get(`${i},${j}`);
        if (!a) continue;
        for (const b of a) {
          if (seen.has(b)) continue;
          seen.add(b);
          // 2D 射線 × 圓:|A + t·D − O|² = r²
          const ox = ax - b.x, oz = az - b.z;
          const A2 = dx * dx + dz * dz;
          const B2 = 2 * (ox * dx + oz * dz);
          const C2 = ox * ox + oz * oz - b.r * b.r;
          let t0, t1;
          if (A2 < 1e-8) {                        // 垂直線段:XZ 不動,只看是否在圓內
            if (C2 > 0) continue;
            t0 = 0; t1 = 1;
          } else {
            const disc = B2 * B2 - 4 * A2 * C2;
            if (disc < 0) continue;
            const sq = Math.sqrt(disc);
            t0 = (-B2 - sq) / (2 * A2);
            t1 = (-B2 + sq) / (2 * A2);
            if (t1 < 0 || t0 > 1) continue;
          }
          const yTop = b.y + b.h;
          // 側面進入:入點高度落在柱身區間
          const tIn = Math.max(0, t0);
          const yIn = ay + dy * tIn;
          if (yIn > b.y - 0.5 && yIn < yTop) {
            if (bestT === null || tIn < bestT) bestT = tIn;
            continue;
          }
          // 頂面:自上而下跨越 yTop 且交點仍在圓內
          if (Math.abs(dy) > 1e-6) {
            const tTop = (yTop - ay) / dy;
            if (tTop >= Math.max(0, t0) && tTop <= Math.min(1, t1) && dy < 0) {
              if (bestT === null || tTop < bestT) bestT = tTop;
            }
          }
        }
      }
    }
    return bestT === null ? null : bestT * len;
  }

  /**
   * 線段 vs 水平薄板(橋面 / 隧道天花):回傳最近穿越距離(沿線段),沒穿回 null。
   * 橋墩等垂直障礙走 _blockerHitT(圓柱);這裡補「橋面/天花」這種水平薄板 —— 只走 surfaceAt/
   * ceilingAt 管移動碰撞、原本不擋彈道/LOS 的缺口(#1)。沿射線 ~SLAB_STEP 取樣查 deckY/tunnelAt
   * (絕對世界 y):橋面板體 = [deckY − deckUnder, deckY],此步 y 區間與板體重疊 = 穿越;隧道 = 射線
   * 跨越天花 cy(上方實體山體)。沿橋面走(全程高於頂面)/ 橋下走(全程低於底緣)不擋,唯穿越才擋。
   * 伺服器以 lev bit + ribbon 權威複驗(_losBlocked);此處是客戶端彈道本體。
   */
  _slabHitT(ax, ay, az, bx, by, bz) {
    const t = this.terrain;
    if (!t.deckY && !t.tunnelAt) return null;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return null;
    const n = Math.min(240, Math.max(1, Math.ceil(len / 2)));   // ~2m 取樣、上限 240(≈480m)
    const du = t.deckUnder || 1.2;
    let py = ay;
    for (let s = 1; s <= n; s++) {
      const f = s / n;
      const x = ax + dx * f, y = ay + dy * f, z = az + dz * f;
      const yLo = Math.min(py, y), yHi = Math.max(py, y);
      if (t.deckY) {
        const d = t.deckY(x, z);                                 // 站立 margin 不吃:用實際橋面 ribbon
        if (d != null && yLo <= d && yHi >= d - du) return (s - 0.5) / n * len;
      }
      if (t.tunnelAt) {
        const tn = t.tunnelAt(x, z);
        if (tn && yHi !== yLo && (py - tn.ceil) * (y - tn.ceil) <= 0) return (s - 0.5) / n * len;
      }
      py = y;
    }
    return null;
  }

  /** 彈道遮擋合併:垂直圓柱(_blockerHitT)∪ 水平薄板(_slabHitT),回較近命中距;皆無回 null。 */
  _obstHitT(ax, ay, az, bx, by, bz) {
    const a = this._blockerHitT(ax, ay, az, bx, by, bz);
    const b = this._slabHitT(ax, ay, az, bx, by, bz);
    return a == null ? b : b == null ? a : Math.min(a, b);
  }

  /**
   * 站得住的表面高度 = 地形 ∪ 高架橋面(main.js 掛上的 terrain.surfaceAt)。
   * curY = 該物體目前的高度:高過橋面一個台階內 → 站在橋上;更低 → 從橋下經過踩地形。
   * 玩家物理、位置回報、NPC/敵機貼地渲染全走這一個縫。
   */
  _surf(x, z, curY) {
    return this.terrain.surfaceAt ? this.terrain.surfaceAt(x, z, curY) : this.terrain.heightAt(x, z);
  }

  /**
   * 兵線指引:不畫連續線,改成沿線的「ㄑ 字形」推進箭頭(馬力歐賽車加速板語彙)。
   * 造型 —— 每支箭 = 兩根扁平橫桿在頂點交會的 chevron,**貼在地面上**(HOVER 只留 0.3m
   *   離地淨空防 z-fighting;桿身厚度 0.12m)—— 浮在空中的箭頭地面玩家看不到(視線被機體
   *   與地物擋掉),**MUST NOT** 再把它抬高成空中路標。
   * 佈點 —— 直線段每 ARROW_GAP 一支;航向變化 > TURN_RAD 的轉角「一定」有一支。
   * 動畫 —— 直線:原地沿前進方向前送 + 脹縮;**轉角:整支箭沿著兵線「走過那個彎」**
   *   (在轉角前後 TURN_RUN 公尺之間來回巡行,朝向恆為該點的切線)⇒ 玩家看到的是
   *   一支示範轉彎路徑的箭頭,不是一個靜止的折角。
   * 姿態 —— **貼地形坡度**:每根桿的傾角由自己兩端的地表高度決定(不是統一抬頭角)。
   */
  _initLanes() {
    const ARROW_GAP = 110, MIN_GAP = 52, TURN_RAD = 0.22;
    const BAR_L = 5.5, SPREAD = 0.62;   // 桿長 / chevron 的半張角(rad)
    const TURN_RUN = 60;                // 轉角箭頭的巡行長度(轉角前後各半)
    this.lanePts = this.cfg.lanes.map((lane) => lane.map(([lat, lng]) => {
      const [x, z] = llToWorld(lat, lng, this.center);
      return new THREE.Vector3(x, this.terrain.heightAt(x, z) + 2, z);
    }));
    // 前進方向 = 朝敵方主堡(觀戰者沿用圖資方向)
    const foe = this.side === 'SWARM' ? 'STEEL' : 'SWARM';
    const fb = this.cfg.bases?.[this.side ? foe : 'STEEL'];
    const foeW = fb ? llToWorld(fb[0], fb[1], this.center) : null;

    this.laneArrows = [];
    this.lanePts.forEach((raw, li) => {
      const pts = raw.map((p) => [p.x, p.z]);
      if (foeW && Math.hypot(pts[0][0] - foeW[0], pts[0][1] - foeW[1])
                < Math.hypot(pts[pts.length - 1][0] - foeW[0], pts[pts.length - 1][1] - foeW[1])) pts.reverse();
      const n = pts.length;
      if (n < 2) return;
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[n - 1];
      const at = (s) => {                       // 沿線取樣:回傳 [x, z, dx, dz]
        let i = 1;
        while (i < n - 1 && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        let dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
        const l = Math.hypot(dx, dz) || 1;
        return [pts[i - 1][0] + dx * f, pts[i - 1][1] + dz * f, dx / l, dz / l];
      };
      // ① 轉角(優先佔位):整支箭之後會沿線巡行走過這個彎
      const stations = [];
      for (let i = 1; i < n - 1; i++) {
        const a = Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const b = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
        if (turn < TURN_RAD) continue;
        if (stations.length && cum[i] - stations[stations.length - 1].s < TURN_RUN) continue;   // 連續彎共用一支巡行箭
        stations.push({ s: cum[i], turn: true });
      }
      // ② 直線段等距補點(離任何轉角箭頭太近就略過)
      const turns = stations.map((t) => t.s);
      for (let s = ARROW_GAP * 0.5; s < total - 8; s += ARROW_GAP) {
        if (turns.some((t) => Math.abs(t - s) < Math.max(MIN_GAP, TURN_RUN * 0.6))) continue;
        stations.push({ s, turn: false });
      }
      // ③ 己方主堡(反轉後 s≈0 端)=玩家重生點:在堡外(base R 22)沿主路線補兩支近距箭頭,
      //    重生後一眼看出往哪推。刻意較密(引導離開出生點),不受 ARROW_GAP 節流。
      for (const s of [26, 46]) {
        if (s < total - 8 && !stations.some((t) => Math.abs(t.s - s) < 18)) stations.push({ s, turn: false });
      }
      stations.sort((a, b) => a.s - b.s);
      if (!stations.length) return;

      const items = stations.map((st, k) => {
        const [x, z, dx, dz] = at(st.s);
        return { x, z, ry: Math.atan2(dx, dz), s: st.s, turn: st.turn, ph: k * 0.9 };
      });
      // 兵線表面剖面(行進式取樣):像小兵一樣從線頭沿線走一遍,帶著「上一步的高度」問
      // surfaceAt ⇒ 上橋段走橋面、穿隧道段走隧道路面。舊做法 _surf(x, z, Infinity) 會把
      // 穿隧道的箭頭放到上方山體、把從橋下經過的箭頭吸上別條路的橋面。
      const PROF_SEG = 4;
      const prof = [];
      let py = this.terrain.heightAt(pts[0][0], pts[0][1]);
      for (let s = 0; s <= total; s += PROF_SEG) {
        const [sx, sz] = at(s);
        py = this._surf(sx, sz, py + 1.2);
        prof.push(py);
      }
      const surfY = (s) => {
        const f = Math.max(0, Math.min(prof.length - 1, s / PROF_SEG));
        const i = Math.floor(f), j = Math.min(prof.length - 1, i + 1);
        return prof[i] + (prof[j] - prof[i]) * (f - i);
      };
      const color = LANE_COLORS[li % LANE_COLORS.length];
      // 扁平桿(幾何自頂點朝 −z 延伸):厚度 0.12 = 貼地薄片,不是空中的立體箭頭
      const bar = () => new THREE.BoxGeometry(1.6, 0.12, BAR_L).translate(0, 0, -BAR_L / 2);
      const mat = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
      const im = [new THREE.InstancedMesh(bar(), mat(), items.length),
                  new THREE.InstancedMesh(bar(), mat(), items.length)];
      for (const m of im) {
        m.frustumCulled = false;
        m.renderOrder = 3;
        m.userData.noOutline = true;
        this.scene.add(m);
      }
      this.laneArrows.push({ im, items, barL: BAR_L, at, total, run: TURN_RUN, spread: SPREAD, surfY });
    });
    this._arrowM = new THREE.Matrix4();
    this._arrowQ = new THREE.Quaternion();
    this._arrowE = new THREE.Euler(0, 0, 0, 'YXZ');   // 先轉向(Y)再依坡度俯仰(X)
    this._arrowP = new THREE.Vector3();
    this._arrowS = new THREE.Vector3(1, 1, 1);
  }

  /**
   * 兵線箭頭動畫(全部貼地):
   *   直線段 — ㄑ 字 chevron 原地沿前進方向前送 + 脹縮(加速板的流動感)。
   *   轉角   — 同一支 chevron **沿兵線巡行走過彎道**(轉角前後各 run/2),朝向恆取該點切線
   *            ⇒ 箭頭自己示範怎麼轉。
   * 姿態貼地形:每根桿以「頂點 → 桿尾」兩點的地表高度差定俯仰角 ⇒ 桿身平行坡面。
   */
  _updateLaneArrows(now) {
    if (!this.laneArrows?.length) return;
    const M = this._arrowM, Q = this._arrowQ, E = this._arrowE, P = this._arrowP, S = this._arrowS;
    // 離地淨空:_surf() 在一般路段回傳「裸地形」高度,但實際鋪面比地形抬高 ROAD_LIFT(biomes.js,0.45)
    // + 標線再抬高到 ~0.62 —— HOVER 若只有 0.3 會讓箭頭幾何埋進柏油下方,被路面 z-test 擋住。
    // 0.85 留出安全餘裕,同時仍遠低於視線高度,不會變成空中路標。
    const HOVER = 0.85;
    for (const la of this.laneArrows) {
      const L = la.barL, SP = la.spread;
      la.items.forEach((it, i) => {
        let ax, az, ry, sc, sPos;
        if (it.turn) {
          // 巡行:沿線 s 在 [s0 − run/2, s0 + run/2] 之間循環(14 m/s),朝向取切線
          const u = ((now * 14 + it.ph * 20) % la.run) - la.run / 2;
          sPos = Math.max(0, Math.min(la.total, it.s + u));
          const [px, pz, dx, dz] = la.at(sPos);
          ax = px; az = pz;
          ry = Math.atan2(dx, dz);
          const edge = 1 - Math.abs(u) / (la.run / 2);            // 兩端縮小 = 淡出淡入
          sc = 0.55 + 0.55 * Math.min(1, edge * 2.5);
        } else {
          const t = now * 1.7 + it.ph;
          const flow = (t % (Math.PI * 2)) / (Math.PI * 2) * 7;   // 原地前送 0~7m 後回捲
          sc = 0.75 + 0.35 * Math.sin(t);
          ry = it.ry;
          ax = it.x + Math.sin(ry) * flow;
          az = it.z + Math.cos(ry) * flow;
          sPos = Math.min(la.total, it.s + flow);
        }
        // 高度與坡度查「兵線表面剖面」(隧道內 = 隧道路面、橋上 = 橋面):
        // 桿尾在頂點後方 ≈ L·cos(SP),坡度 = 剖面前後高差
        const y0 = la.surfY(sPos);
        const dy = la.surfY(Math.max(0, sPos - L * 0.81)) - y0;
        // 兩根桿共用頂點、左右各張開 SP ⇒ 頂點朝前進方向的 ㄑ
        for (const [k, yaw] of [[0, ry + SP], [1, ry - SP]]) {
          E.set(Math.asin(Math.max(-0.9, Math.min(0.9, dy / L))), yaw, 0);  // 俯仰 = 沿線坡度
          Q.setFromEuler(E);
          P.set(ax, y0 + HOVER, az);
          S.setScalar(sc);
          M.compose(P, Q, S);
          la.im[k].setMatrixAt(i, M);
        }
      });
      la.im[0].instanceMatrix.needsUpdate = true;
      la.im[1].instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------- FPV 座艙(角色專屬:依 CHARACTERS[ch].visual 差異化,3D 賽璐璐)----------------
  // 與世界模型(models.js)同一套視覺語彙,座艙 = 從自己機體「頭/艙位」往正前方看出去的自身剪影:
  // 無人機 = 擬態獸(avian 撲翼)/ 定翼機(fixed 翼型)/ 旋翼機架;
  // 機甲 = 人形艙框(proto 專屬)或獸首視野(creature);變形機甲 = 地面+飛行雙組件隨變形切換。
  // 取景一律按 fov 68(全機種統一,z=-0.8 處畫面邊緣 y≈±0.54):周邊件貼邊、不擋準星。
  // 輕武器外觀依機構分類(gun/launcher/beam),主色 = 角色識別色。
  _buildCockpit() {
    if (!this.side) return;
    this.scene.add(this.camera);   // 相機要在場景樹裡,座艙子物件才會渲染
    const c = this.ch && CHARACTERS[this.ch];
    const vis = c?.visual || {};
    // 座艙塗裝 = 機體塗裝(唯一的縫仍是 paint.js):色版 heroPalette + 花紋 paintUnit,
    // tone 與 models.js 同一條規則(無人機/變形機甲/四足獸 = dark,人形機甲/雙足獸 = light)。
    const tone = (this.isDrone || this.isMorph || vis.form === 'beast') ? 'dark' : 'light';
    const PAL = heroPalette(vis, this.side, tone);
    // builder 內的結構灰階常數在此映射成角色色版階梯 —— 機體是什麼顏色,座艙就是什麼顏色。
    // 非裝甲件(牙/喙/亮金屬/膜翼/發光識別燈)不在表內 → 保留原色。
    const ARMOR = {
      0x4b545e: 'main', 0x5b6772: 'lite', 0x5a6673: 'lite', 0x515e6b: 'lite',
      0x46505b: 'mid', 0x4d5865: 'mid', 0x4a5560: 'mid',
      0x3f4852: 'dark', 0x39424b: 'dark', 0x39414a: 'dark',
      0x3d454e: 'deep', 0x3c444d: 'deep', 0x30373f: 'deep', 0x2b3239: 'deep',
      0x2f353c: 'deep', 0x272c31: 'deep',
    };
    const mk = (geo, color, opts = {}) => {
      // 座艙同樣走賽璐璐;高金屬度 → 漫畫硬邊高光帶
      const { metalness, roughness, noPaint, ...rest } = opts;
      const col = ARMOR[color] ? PAL[ARMOR[color]] : color;
      const m = new THREE.Mesh(geo, toonMat(col, { ...rest, celMetal: (metalness ?? 0) >= 0.5 }));
      if (noPaint) m.userData.noPaint = true;   // 牙/眼/羽:花紋不吃掉辨識訊號
      return m;
    };
    const accent = PAL.accent;
    const g = new THREE.Group();
    this.cockpitSpin = [];    // 旋翼(繞 y 自轉)
    this.cockpitSpinZ = [];   // 螺旋槳(繞 z 自轉,軸線朝前)
    this.cockpitFlap = [];    // 撲翼/觸手:每幀 rot[ax] = base + amp·sin(2π·hz·t + ph)
    this.cockGround = null;   // 變形機甲:地面型態組件
    this.cockAir = null;      // 變形機甲:飛行型態組件
    this._cockT = 0;
    this.gunGroup = new THREE.Group();

    // 人類駕駛艙罩:全機種共通(座艙裡坐的是人),機體自身結構一律在艙框之外
    this._cockCanopy(g, mk, accent, vis);

    // 座艙 builder 回傳「這具機體的武器掛點錨」—— 只有它知道自己的頭顱/機翼/手臂在哪
    let anchors;
    if (this.isDrone) anchors = this._buildDroneCockpit(g, mk, accent, vis);
    else if (this.isMorph) anchors = this._buildMorphCockpit(g, mk, accent, vis);
    else anchors = this._buildMechCockpit(g, mk, accent, vis);

    // 武裝(2026-07-22 同源改制):FPV 武器 = 複製第三人稱機體的武裝子樹(models.js rig.wpn 登記),
    // 輕/重兩把與第三人稱一樣「同時可見」;瞄準只切換作用中的槍口(_syncCockpitWeapon)。
    // 缺登記(GLB 覆蓋等)退回 podWeapon 依 def.type 重建 —— 同一條外觀語彙,不再有通用機槍。
    // 拋棄式參照機體:只取 rig(從未 render = 無 GPU 資源,交給 GC;複本共享其幾何/材質故 MUST NOT dispose)
    const unit3p = makeUnit(`hero:${this.heroKind}`, this.side, { ch: this.ch }).group;
    unit3p.updateMatrixWorld(true);
    const rig3p = unit3p.userData.rig || {};
    const wpn = rig3p.wpn || {};
    this._muzzles = { G: {}, A: {} };
    this._mountAudit = {};
    // 輕重同一具(同型雙模:hound/centaur/seraph/cthulhu/panther/raptor/同型機腹莢…)= 只建一次,兩槍口同複本
    const sameRoot = wpn.light?.nodes?.[0] && wpn.light.nodes[0] === wpn.heavy?.nodes?.[0];
    const jobs = sameRoot ? [['light', 'heavy']] : [['light'], ['heavy']];
    if (this.isMorph) {
      // 變形機甲:兩型態各一套武裝(地面手持/嘴砲 ↔ 飛行機翼硬點/機身吊艙),隨變形整組切換
      this._gunG = new THREE.Group();
      this._gunA = new THREE.Group();
      this.gunGroup.add(this._gunG, this._gunA);
      for (const slots of jobs) {
        Object.assign(this._muzzles.G, this._mountCockpitWeapon(mk, accent, PAL, vis, slots, wpn, rig3p, this._gunG, anchors.ground, false));
        Object.assign(this._muzzles.A, this._mountCockpitWeapon(mk, accent, PAL, vis, slots, wpn, rig3p, this._gunA, anchors.air, true));
      }
      this._gunA.visible = false;
    } else {
      for (const slots of jobs) {
        Object.assign(this._muzzles.G, this._mountCockpitWeapon(mk, accent, PAL, vis, slots, wpn, rig3p, this.gunGroup, anchors, this.isDrone));
      }
    }
    this._muzzle = this._muzzles.G.light || this._muzzles.G.heavy;

    // 槍口焰(開火瞬間顯示):與第三人稱焰球同語彙(加法混色暖白,attachMuzzleFlames 的 FPV 對應物);
    // 位置隨作用中槍口走(_syncCockpitWeapon)
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffe9b0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.flash.userData.noOutline = true;
    this.flash.userData.noPaint = true;
    this.flash.position.copy(this._muzzle);
    this.flash.visible = false;
    this.gunGroup.add(this.flash);
    this._gunBaseZ = this.gunGroup.position.z;

    g.add(this.gunGroup);
    g.userData.mount = `${this._mountAudit.light || '?'}/${this._mountAudit.heavy || '?'}`;   // 稽核用:輕/重武器掛點
    paintUnit(g, vis, this.side, tone);   // 性格花紋:與機體同一份程序貼圖(MUST 在 outlinify 之前)
    outlinify(g, 0.012);                  // 座艙近距離,細描邊即可(≈2px)
    // 取景夾制 MUST 在 outlinify **之後**:描邊殼掛在各 mesh 底下會外擴頂緣 ≈0.012m,
    // 夾制的包圍盒要含殼才量得準(否則頂緣夾在 −0.187 但描邊把它頂回 −0.14)。件平移/縮放時描邊子件同動。
    this._frameCockpitStruct(g);
    this.cockpit = g;
    this.camera.add(g);
  }

  /**
   * 座艙**結構件**取景夾制(2026-07-24 使用者三條追加規則;武器本體由 _mountCockpitWeapon 自帶求解器):
   *  ② 每個結構件頂緣 MUST ≤ TOP_NDC(HUD→準星 2/3 處)—— 高過就整件下移。
   *  ③ 與武器/招式無關的裝置每件面積 MUST ≤ 該座艙最大單一武器件 —— 超過就等比縮小。
   *  ① 下移後不得落進準星錐 —— 沿離軸方向(置中件則直接下沉)推到錐外。
   * 只處理「非武器」頂層件(cockpit.children 去掉 gunGroup;morph 另含 cockGround/cockAir 子件);
   * 武器與持槍手臂在 gunGroup 內、屬「武器相關」故豁免面積規則。件彼此獨立掛在容器上(非骨架鏈),
   * 逐件平移/縮放不會拆散關節 —— 唯一縫,MUST NOT 在各 builder 另寫夾制。
   */
  _frameCockpitStruct(g) {
    const ASPECT = 16 / 9;                       // 取景基準(與 framed() 同,不隨視窗漂)
    const capY = COCKPIT.TOP_NDC, tanV = COCKPIT.TAN_V;
    const tanS = Math.tan(COCKPIT.SIGHT_DEG * Math.PI / 180);
    const INFL_W = 0.016;                         // 描邊殼沿法線外推 ≈0.012m(著色器展開,不進幾何)+ 餘裕
    g.updateMatrixWorld(true);                    // g 尚未掛上 camera ⇒ 先把容器矩陣算出來(否則子件世界座標是舊的)
    const _v = new THREE.Vector3();
    const boxOf = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
    const frac = (bb) => {                        // 螢幕佔比(NDC 盒面積 / 全畫面)
      if (bb.isEmpty()) return 0;
      const zn = Math.max(0.05, Math.min(Math.abs(bb.min.z), Math.abs(bb.max.z)));
      return ((bb.max.x - bb.min.x) / (ndcH(zn) * ASPECT) / 2) * ((bb.max.y - bb.min.y) / ndcH(zn) / 2);
    };
    // 頂緣 MUST 逐頂點投影量(不是 AABB):傾斜件(EVA 肩莢/斜掛槍)的實渲染頂緣比軸對齊盒高
    // 出 ~0.05m,AABB 估計會漏。回傳最高 NDC 頂點的 {ndc,z,y}(y 已含描邊外推 INFL_W)。
    const topVert = (o) => {
      let best = null;
      o.updateWorldMatrix(true, true);
      o.traverse((m) => {
        const pos = m.isMesh && !m.userData.isOutline && m.geometry?.attributes?.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (_v.z >= -0.05) continue;
          const ndc = (_v.y + INFL_W) / (Math.abs(_v.z) * tanV);
          if (!best || ndc > best.ndc) best = { ndc, z: _v.z, y: _v.y };
        }
      });
      return best;
    };
    /** o:件根;areaCap:面積上限(Infinity=不縮);doCone:是否夾準星錐(武器 wrap 已由 framed 處理故 false) */
    const clamp = (o, areaCap, doCone) => {
      let bb = boxOf(o);
      if (bb.isEmpty()) return;
      if (areaCap < Infinity) {                   // ③ 裝置面積 ≤ DEV_AREA_MAX(< 單一武器)
        const f = frac(bb);
        if (f > areaCap && f > 1e-5) { o.scale.multiplyScalar(Math.sqrt(areaCap / f)); bb = boxOf(o); }
      }
      for (let it = 0; it < 4; it++) {            // ② 頂緣(逐頂點,含描邊外推)
        const tv = topVert(o);
        if (!tv || tv.ndc <= capY) break;
        o.position.y += capY * Math.abs(tv.z) * tanV - (tv.y + INFL_W);
        o.updateMatrixWorld(true);
      }
      if (!doCone) return;
      for (let it = 0; it < 5; it++) {            // ① 準星錐:遠面最嚴格,沿離軸方向推出
        bb = boxOf(o);
        const zf = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
        const cx = Math.min(Math.max(0, bb.min.x), bb.max.x);
        const cy = Math.min(Math.max(0, bb.min.y), bb.max.y);
        const r = Math.hypot(cx, cy), need = tanS * zf;
        if (r >= need) break;
        let dx = cx, dy = cy, dl = Math.hypot(dx, dy);
        if (dl < 1e-3) { dx = 0; dy = -1; dl = 1; }   // 置中件:直接下沉出錐(橫向推無意義)
        o.position.x += (dx / dl) * (need - r + 0.02);
        o.position.y += (dy / dl) * (need - r + 0.02);
      }
    };
    // 結構件(艙罩 + 機體剪影):裝置面積 + 頂緣 + 準星錐
    const skip = new Set([this.gunGroup, this.cockGround, this.cockAir]);
    for (const c of [...g.children]) if (!skip.has(c)) clamp(c, COCKPIT.DEV_AREA_MAX, true);
    if (this.isMorph) for (const cg of [this.cockGround, this.cockAir]) for (const c of [...cg.children]) clamp(c, COCKPIT.DEV_AREA_MAX, true);
    // 武器持槍機構(cockStruct:手臂/砲座/喉管)頂緣 + 準星錐,豁免面積(它是武器的一部分)。
    // 武器本體 wrap **MUST NOT** 在此平移 —— 頂緣/面積/準星錐/消失點全由 framed 二分解定案,
    // 事後平移會破壞 VP 對準(平移改變砲管軸線與消失點的夾角)。
    const guns = this.isMorph ? [this._gunG, this._gunA] : [this.gunGroup];
    for (const gun of guns) for (const c of [...gun.children]) if (c.userData.cockStruct) clamp(c, Infinity, true);
  }

  /**
   * 座艙武裝同步(2026-07-22 同源改制):
   * 變形機甲隨型態切換整組結構+武裝;所有機種隨瞄準狀態切換「作用中槍口」(輕⇄重)——
   * 輕/重武器與第三人稱一樣同時可見,只有彈道起點與槍口焰跟著當前武器走。
   */
  _syncCockpitWeapon() {
    const fly = !!this.flight;
    if (this.cockAir) {
      this.cockAir.visible = fly;
      this.cockGround.visible = !fly;
      this._gunA.visible = fly;
      this._gunG.visible = !fly;
    }
    const set = (this.isMorph && fly) ? this._muzzles?.A : this._muzzles?.G;
    if (!set) return;
    const id = this.aiming && this.wdef?.heavy ? 'heavy' : 'light';   // 與 _curWeapon 同一條選槽規則
    const mz = set[id] || set.light || set.heavy;
    if (mz && this._muzzle !== mz) { this._muzzle = mz; this.flash.position.copy(mz); }
  }

  /** 週期擺動件(撲翼/觸手/尾):註冊後由 tick 以正弦驅動 */
  _flap(o, ax, base, amp, hz, ph = 0) {
    o.rotation[ax] = base;
    this.cockpitFlap.push({ o, ax, base, amp, hz, ph });
    return o;
  }

  /** 無人機座艙:依 visual.form 分派 —— 擬態獸(撲翼)/ 定翼機(座艙罩)/ 旋翼機架。回傳武器掛點錨 */
  _buildDroneCockpit(g, mk, accent, vis) {
    if (vis.form === 'avian') return this._cockAvian(g, mk, accent, vis);
    if (vis.form === 'fixed') return this._cockFixed(g, mk, accent, vis);
    return this._cockRotor(g, mk, accent, vis);
  }

  /** 擬態獸無人機:自身頭部/口器在下緣、雙翼在畫面兩側拍動(creature 專屬,對應 models.js buildAvian) */
  _cockAvian(g, mk, accent, vis) {
    const C = vis.creature || 'eagle';
    const skin = 0x4b545e, hard = 0x5b6772;
    // ---- 翼:根樞軸在肩點,翼面向外伸出;繞 z 拍動(頻率/幅度依生物) ----
    const wingSpec = {
      bee: { hz: 7.5, amp: 0.42, len: 1.05, chord: 0.34, opacity: 0.42, pairs: 2 },
      ptero: { hz: 1.15, amp: 0.30, len: 1.35, chord: 0.62, opacity: 0.72, pairs: 1 },
      dragon: { hz: 0.9, amp: 0.26, len: 1.45, chord: 0.85, opacity: 0.78, pairs: 1 },
      eagle: { hz: 1.3, amp: 0.28, len: 1.30, chord: 0.55, opacity: 1, pairs: 1, feather: true },
    }[C];
    // 翼根落在視錐內才看得見,但 MUST 靠畫面側緣下方(2026-07-16 視野開闊化):
    // 根太靠中央(舊 x±0.34)翼面會蓋掉兩側中段視野;外推 + 下沉 + 加大後掠,
    // 只剩翼前緣沿畫面兩側下角掃出去(翼尖出畫 = 正確的鳥類 FPV)。
    for (const sx of [-1, 1]) {
      for (let p = 0; p < wingSpec.pairs; p++) {
        const root = new THREE.Group();
        // 翼根再外推/後退(2026-07-24 面積收斂):翼面大半掃出畫面外,只留前緣沿側下角掠過
        root.position.set(sx * 0.78, -0.42 - p * 0.16, -1.08 + p * 0.22);
        root.rotation.y = sx * 0.5;
        g.add(root);
        if (wingSpec.feather) {
          // 羽刃翼:羽片沿翼展放射(掠角逐片遞增),與 models.js feather() 同語彙
          for (let i = 0; i < 5; i++) {
            const t = i / 4;
            const f = mk(new THREE.BoxGeometry(wingSpec.len * (0.55 + 0.45 * t), 0.03, wingSpec.chord * (0.9 - 0.4 * t)), i % 2 ? 0x8f9aa5 : hard);
            f.position.set(sx * wingSpec.len * 0.5, -0.02 * i, 0.10 + t * 0.28);
            f.rotation.y = sx * -t * 0.34;
            root.add(f);
          }
        } else {
          const w = mk(new THREE.BoxGeometry(wingSpec.len, 0.035, wingSpec.chord), C === 'bee' ? 0xbfe6ff : 0x6d5f7a,
            { transparent: wingSpec.opacity < 1, opacity: wingSpec.opacity });
          w.position.set(sx * wingSpec.len * 0.5, 0, 0.05);
          root.add(w);
          if (C !== 'bee') {   // 膜翼指骨梁
            for (let i = 0; i < 3; i++) {
              const rib = mk(new THREE.CylinderGeometry(0.018, 0.012, wingSpec.len * (0.9 - i * 0.18), 5), hard);
              rib.rotation.z = Math.PI / 2;
              rib.rotation.y = -i * 0.24 * sx;
              rib.position.set(sx * wingSpec.len * 0.44, 0.01, -0.06 + i * 0.22);
              root.add(rib);
            }
          }
        }
        this._flap(root, 'z', sx * 0.10, sx * wingSpec.amp, wingSpec.hz, p * Math.PI);
      }
    }
    // ---- 頭/口器(正面 -z,畫面下緣)----
    if (C === 'bee') {
      const head = mk(new THREE.SphereGeometry(0.3, 10, 8), skin);
      head.scale.set(1.1, 0.85, 0.9);
      head.position.set(0, -0.52, -0.9);
      g.add(head);
      for (const sx of [-1, 1]) {
        const eye = mk(new THREE.SphereGeometry(0.11, 8, 6), accent, { emissive: accent, emissiveIntensity: 1.1 });
        eye.scale.set(0.85, 1.3, 0.7);
        eye.position.set(sx * 0.22, -0.44, -1.02);
        g.add(eye);
        const ant = mk(new THREE.CylinderGeometry(0.012, 0.02, 0.42, 5), 0x2f353c);
        ant.position.set(sx * 0.3, -0.44, -1.05);   // 觸角根外推下沉:舊值 ±0.12 讓觸角掃過準星(6.6°)
        ant.rotation.set(-0.5, 0, sx * 0.5);
        g.add(ant);
      }
      const sting = mk(new THREE.CylinderGeometry(0.01, 0.05, 0.5, 6), 0x2b3239, { metalness: 0.8 });
      sting.rotation.x = Math.PI / 2;
      sting.position.set(0, -0.58, -1.25);   // 螫針砲管沿視線前伸
      g.add(sting);
    } else if (C === 'eagle') {
      const skull = mk(new THREE.BoxGeometry(0.42, 0.26, 0.42), skin);
      skull.position.set(0, -0.5, -0.85);
      g.add(skull);
      const beak = mk(new THREE.ConeGeometry(0.13, 0.5, 6), 0xd8b45a);
      beak.rotation.x = -Math.PI / 2;
      beak.position.set(0, -0.52, -1.25);
      g.add(beak);
      for (const sx of [-1, 1]) {   // 頦下雙管
        const tube = mk(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 8), 0x2b3239, { metalness: 0.8 });
        tube.rotation.x = Math.PI / 2;
        tube.position.set(sx * 0.1, -0.66, -1.15);
        g.add(tube);
      }
    } else if (C === 'ptero') {
      const skull = mk(new THREE.BoxGeometry(0.34, 0.24, 0.5), skin);
      skull.position.set(0, -0.5, -0.9);
      g.add(skull);
      const crest = mk(new THREE.BoxGeometry(0.05, 0.3, 0.34), accent, { emissive: accent, emissiveIntensity: 0.5 });
      crest.position.set(0, -0.48, -0.82);   // 頭冠在視軸正上方 → MUST 沉在準星錐外(舊值 8.6°)
      g.add(crest);
      const jaw = mk(new THREE.ConeGeometry(0.1, 0.62, 4), 0xa9b2ba);
      jaw.rotation.x = -Math.PI / 2;
      jaw.position.set(0, -0.55, -1.3);
      g.add(jaw);
      for (const sx of [-1, 1]) {   // 吊掛雙爪抓槍莢
        const claw = mk(new THREE.CylinderGeometry(0.03, 0.05, 0.38, 5), hard);
        claw.position.set(sx * 0.4, -0.66, -0.7);
        claw.rotation.z = sx * 0.3;
        g.add(claw);
      }
    } else {   // dragon:張口露出口腔飛彈巢
      const skull = mk(new THREE.BoxGeometry(0.42, 0.26, 0.48), skin);
      skull.position.set(0, -0.58, -0.98);
      g.add(skull);
      const jaw = mk(new THREE.BoxGeometry(0.38, 0.1, 0.44), hard);
      jaw.position.set(0, -0.8, -1.12);
      jaw.rotation.x = 0.24;
      g.add(jaw);
      for (const sx of [-1, 1]) {   // 獠牙
        const fang = mk(new THREE.ConeGeometry(0.04, 0.18, 5), 0xe4e9ee);
        fang.rotation.x = Math.PI;
        fang.position.set(sx * 0.16, -0.56, -1.2);
        g.add(fang);
        const horn = mk(new THREE.ConeGeometry(0.05, 0.32, 5), 0x39424b);
        horn.position.set(sx * 0.2, -0.24, -0.78);
        horn.rotation.set(-0.6, 0, sx * 0.35);
        g.add(horn);
      }
      const cell = mk(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), 0x14171a, { emissive: accent, emissiveIntensity: 0.7 });
      cell.rotation.x = Math.PI / 2;
      cell.position.set(0, -0.6, -1.1);
      g.add(cell);
    }
    // 掛點:蜂/鷹/龍 = 口器砲(頭部前端);翼龍 = 雙爪吊掛槍莢
    return {
      mouth: { x: 0, y: C === 'dragon' ? -0.62 : -0.58, z: -1.35, s: 1.0 },
      claw: { x: 0.42, y: -0.72, z: -1.05, s: 0.9 },
      body: { x: 0.2, y: -0.5, z: -0.9, s: 0.95 },
    };
  }

  /** 定翼無人機座艙:氣泡罩框 + 機鼻 + 翼型專屬前緣(對應 models.js buildFixedWing) */
  _cockFixed(g, mk, accent, vis) {
    const W = vis.wing || 'twinboom';
    const hard = 0x5b6772, dark = 0x46505b;
    // 氣泡罩全視野(2026-07-16 視野開闊化):無頂樑/A 柱,只剩翼型剪影。
    // 2026-07-24 取景改制:本函式原本自建第二片儀表台(1.35×0.22,18.1% 遮擋)疊在
    // _cockCanopy 那片之上 —— 同一個「儀表台」有兩份實作 = 面積雙倍。刪除,一律用艙罩那一片。
    if (W === 'zero') {
      // 零式:機首星型引擎整流罩 + 牽引螺旋槳(隔著它看出去,半透明盤 + 三葉)。
      // 槳盤/整流罩 MUST 沉在準星錐之下 —— 舊值把 0.95 半徑的槳盤畫在視軸上(實測 0.2°),
      // 等於全程隔著一片旋轉盤瞄準;下沉後只剩上緣弧掃過畫面下方,識別度不變。
      const cowl = mk(new THREE.CylinderGeometry(0.42, 0.38, 0.5, 12), dark);
      cowl.rotation.x = Math.PI / 2;
      cowl.position.set(0, -1.0, -1.5);
      g.add(cowl);
      const disc = mk(new THREE.CircleGeometry(0.8, 20), 0xaeb8c2, { transparent: true, opacity: 0.13 });
      disc.position.set(0, -1.55, -2.0);
      g.add(disc);
      const prop = new THREE.Group();
      prop.position.set(0, -1.55, -1.95);
      for (let i = 0; i < 3; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = (i * Math.PI * 2) / 3;
        const blade = mk(new THREE.BoxGeometry(0.09, 0.8, 0.03), 0x2f353c, { transparent: true, opacity: 0.5 });
        blade.position.set(0, 0.4, 0);   // 槳長 MUST = 槳盤半徑(舊值 1.5 讓葉尖掃到準星,盤卻只有 0.8)
        arm.add(blade);
        prop.add(arm);
      }
      g.add(prop);
      this.cockpitSpinZ.push(prop);
    } else if (W === 'delta') {
      // 三角飛翼:後掠前緣只從畫面下側角落斜掠出去(退離近場,不再是側牆)
      for (const sx of [-1, 1]) {
        const le = mk(new THREE.BoxGeometry(1.3, 0.05, 0.3), hard);
        le.position.set(sx * 1.25, -0.4, -1.0);
        le.rotation.set(0, sx * 0.7, sx * -0.06);
        g.add(le);
      }
      const nose = mk(new THREE.ConeGeometry(0.22, 0.8, 4), dark);
      nose.rotation.x = -Math.PI / 2;
      nose.position.set(0, -0.6, -1.35);
      g.add(nose);
    } else if (W === 'canard') {
      // 鴨式:前置小翼在畫面前緣兩側(比主翼更靠前 = 看得見)
      for (const sx of [-1, 1]) {
        const cd = mk(new THREE.BoxGeometry(0.8, 0.05, 0.3), hard);
        cd.position.set(sx * 0.78, -0.2, -1.35);
        cd.rotation.z = sx * 0.16;
        g.add(cd);
      }
      const nose = mk(new THREE.ConeGeometry(0.2, 0.9, 4), dark);
      nose.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
      nose.position.set(0, -0.58, -1.5);
      g.add(nose);
    } else if (W === 'vtail') {
      // V 尾推進:長機鼻 + 頰側進氣口(尾在身後看不見)。機鼻沿視軸前伸 ⇒ 遠端張角最小,
      // 高度 MUST 由「最遠端」反推(舊值 −0.62 在 z −2.05 處只剩 9.5°,壓在準星下沿)
      const nose = mk(new THREE.CylinderGeometry(0.1, 0.28, 1.1, 8), dark);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, -0.76, -1.5);
      g.add(nose);
      for (const sx of [-1, 1]) {
        const inlet = mk(new THREE.BoxGeometry(0.18, 0.22, 0.5), 0x2b3239);
        inlet.position.set(sx * 0.55, -0.6, -1.0);
        g.add(inlet);
      }
    } else {
      // 雙尾桁:兩側尾桁前段沿視線延伸出去(z 後移到近端不穿近裁面 0.5)
      for (const sx of [-1, 1]) {
        const boom = mk(new THREE.CylinderGeometry(0.08, 0.09, 1.5, 8), hard);
        boom.rotation.x = Math.PI / 2;
        boom.position.set(sx * 0.78, -0.44, -1.35);
        g.add(boom);
      }
      const pod = mk(new THREE.BoxGeometry(0.5, 0.3, 0.7), dark);
      pod.position.set(0, -0.66, -1.05);
      g.add(pod);
    }
    // 掛點:戰機 = 機翼硬點(左右對稱掛架,壓到下側角落 —— 側帶中段不放武裝);零式翼根較靠內
    return { wing: { x: W === 'zero' ? 0.82 : 0.95, y: -0.45, z: -1.05, s: 0.95 } };
  }

  /** 旋翼無人機座艙:機鼻(body 剪影)+ 機架/旋翼(frame)在畫面上緣;中灰藍避免暗部塌黑 */
  _cockRotor(g, mk, accent, vis) {
    const body = vis.body || 'box';
    let nose;
    if (body === 'wedge') {
      nose = mk(new THREE.CylinderGeometry(0.05, 0.36, 0.7, 4), 0x4b545e);
      nose.rotation.set(-Math.PI / 2, Math.PI / 4, 0);   // 尖端朝前的楔形
    } else if (body === 'sphere') {
      nose = mk(new THREE.SphereGeometry(0.3, 10, 8), 0x4b545e);
    } else if (body === 'slab') {
      nose = mk(new THREE.BoxGeometry(0.62, 0.1, 0.42), 0x4b545e);
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
    // 機鼻沉到準星錐之下(2026-07-24):舊值 y −0.42 / z −0.78 的球形機鼻頂緣只離視軸 8.0°,
    // 且近端 z −0.48 穿進近裁面 0.5 —— 一併後移。
    nose.position.set(0, -0.58, -0.92);
    g.add(nose);
    const lamp = mk(new THREE.BoxGeometry(0.34, 0.03, 0.04), accent, { emissive: accent, emissiveIntensity: 1.2 });
    lamp.position.set(0, -0.47, -0.75);
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
    // 機臂一律退離近場(z ≤ -1.05)+ 貼頂緣(2026-07-16 視野開闊化):
    // 舊值 z -0.7 的臂內端旋到 z≈-0.5,在畫面上放大成巨樑,把上方視野吃掉一半。
    const arm = (x, y, z, ry, len = 0.75) => {
      const a = mk(new THREE.BoxGeometry(len, 0.035, 0.055), 0x5b6772);
      a.position.set(x, y, z);
      a.rotation.y = ry;
      g.add(a);
    };
    const frame = vis.frame || 'quad';
    if (frame === 'hexa') {
      // 六旋翼:左右二臂 + 正前中臂(全數縮上角/遠場)
      for (const sx of [-1, 1]) { arm(sx * 0.72, 0.42, -1.05, sx * -0.65, 0.45); prop(sx * 0.92, 0.52, -1.18, 0.42); }
      arm(0, 0.52, -1.15, Math.PI / 2, 0.4);
      prop(0, 0.6, -1.32, 0.42);
    } else if (frame === 'coax') {
      // 同軸雙槳:中央桅桿 + 上下兩層大旋翼(細桅 + 半透明槳盤,不擋視野)
      const mast = mk(new THREE.CylinderGeometry(0.03, 0.045, 0.44, 8), 0x39414a);
      mast.position.set(0, 0.56, -1.1);
      g.add(mast);
      prop(0, 0.64, -1.1, 0.85);
      prop(0, 0.74, -1.1, 0.85);
    } else if (frame === 'wing') {
      // 固定翼混合:細翼樑貼頂緣 + 翼尖旋翼
      const wing = mk(new THREE.BoxGeometry(2.0, 0.035, 0.24), 0x5b6772);
      wing.position.set(0, 0.56, -1.15);
      g.add(wing);
      for (const sx of [-1, 1]) prop(sx * 1.05, 0.64, -1.15, 0.5);
    } else {
      // 四旋翼:前二臂 + 旋翼(縮上角/遠場)
      for (const sx of [-1, 1]) { arm(sx * 0.7, 0.42, -1.05, sx * -0.7, 0.5); prop(sx * 0.9, 0.52, -1.18, 0.45); }
    }
    // 掛點:旋翼無人機 = 機身固定(機腹吊艙,不是手持)
    return { body: { x: 0.2, y: -0.34, z: -0.7, s: 1.0 } };
  }

  /** 機甲座艙(艙罩已由 _cockCanopy 建好):人形 = 原型專屬結構;獸型 = 依座位看到自己的頭。回傳掛點錨 */
  _buildMechCockpit(g, mk, accent, vis) {
    if (vis.proto || !vis.creature) {
      this._cockProto(g, mk, accent, vis.proto);
      return { hand: { x: 0.5, y: -0.36, z: -1.0, s: 1.12 } };   // 人形:右手持械(s 1.12:雙持時手臂+雙槍佔畫面過大)
    }
    return this._cockBeast(g, mk, accent, vis.creature);
  }

  /** 人形機甲原型專屬:與 models.js 的 visual.proto 同一套設計語彙 */
  _cockProto(g, mk, accent, proto) {
    if (proto === 'bastion') {
      // 過裝甲(2026-07-16 視野開闊化:側面防彈牆拆除)—— 只剩斧砲長柄斜掠過右上遠角
      const halberd = mk(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 8), 0x2f353c, { metalness: 0.8 });
      halberd.rotation.set(0.2, 0, 0.75);
      halberd.position.set(0.9, 0.72, -1.75);
      g.add(halberd);
      const blade = mk(new THREE.BoxGeometry(0.5, 0.22, 0.05), 0xb9c3cc, { metalness: 0.9 });
      blade.rotation.z = 0.75;
      blade.position.set(1.7, 1.24, -1.75);
      g.add(blade);
    } else if (proto === 'seraph') {
      // EVA 式倒三角上胸:肩上 binder 莢縮小、退到畫面上角外緣(只露內側一角)
      for (const sx of [-1, 1]) {
        const binder = mk(new THREE.BoxGeometry(0.12, 0.26, 0.36), 0x515e6b, { metalness: 0.5 });
        binder.position.set(sx * 1.2, 0.74, -1.05);
        binder.rotation.z = sx * -0.28;
        g.add(binder);
        const vent = mk(new THREE.BoxGeometry(0.05, 0.2, 0.05), accent, { emissive: accent, emissiveIntensity: 1.3 });
        vent.position.set(sx * 1.06, 0.72, -0.8);
        g.add(vent);
      }
      const lance = mk(new THREE.CylinderGeometry(0.045, 0.06, 2.6, 8), 0x39424b, { metalness: 0.85 });
      lance.rotation.set(Math.PI / 2 - 0.12, 0, 0.06);
      lance.position.set(0.85, -0.45, -1.7);
      g.add(lance);
      const rail = mk(new THREE.TorusGeometry(0.09, 0.02, 6, 12), accent, { emissive: accent, emissiveIntensity: 1.5 });
      rail.position.set(0.85, -0.41, -2.4);
      g.add(rail);
    } else if (proto === 'aegis') {
      // 塔盾攔截(2026-07-16 視野開闊化):巨盾降為「艙沿盾」—— 沉到左下角、只露盾緣,
      // 防禦感保留在盾徽識別燈,不再吃掉左半視野。
      const shield = mk(new THREE.BoxGeometry(0.1, 0.62, 0.5), 0x4a5560, { metalness: 0.6 });
      shield.rotation.set(0, 0.22, 0.08);
      shield.position.set(-1.18, -0.74, -1.2);
      g.add(shield);
      const boss = mk(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10), accent, { emissive: accent, emissiveIntensity: 1.0 });
      boss.rotation.z = Math.PI / 2;
      boss.position.set(-1.08, -0.64, -1.2);
      g.add(boss);
      for (const ox of [0, 0.28]) {   // 攔截器發射巢:沿下緣排列
        const cell = mk(new THREE.BoxGeometry(0.2, 0.14, 0.28), 0x39424b);
        cell.position.set(-0.78 + ox, -0.76, -1.0);
        g.add(cell);
      }
    } else if (proto === 'colossus') {
      // 巨兵:眉簷細化並貼頂緣、雙圓眼縮上角(識別剪影保留,不遮上方視野)
      const brow = mk(new THREE.CapsuleGeometry(0.06, 1.2, 4, 8), 0x5a6673);
      brow.rotation.z = Math.PI / 2;
      brow.position.set(0, 0.8, -1.15);   // 貼畫面上緣,只露簷底(不吃上方視野)
      g.add(brow);
      for (const sx of [-1, 1]) {
        const eye = mk(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12), accent, { emissive: accent, emissiveIntensity: 1.6 });
        eye.rotation.x = Math.PI / 2;
        eye.position.set(sx * 0.38, 0.5, -1.15);
        g.add(eye);
      }
      const pulse = mk(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 10), 0x39424b, { metalness: 0.8 });
      pulse.rotation.x = Math.PI / 2;
      pulse.position.set(0, 0.58, -1.35);
      g.add(pulse);
      const tip = mk(new THREE.SphereGeometry(0.05, 8, 6), accent, { emissive: accent, emissiveIntensity: 2 });
      tip.position.set(0, 0.58, -1.52);
      g.add(tip);
    }
  }

  /** 獸型座艙:座位(SEAT)決定看到什麼 —— 頭部艙 = 頭殼內壁;頸部艙 = 自己的頭顱在前下方 */
  _cockBeast(g, mk, accent, creature) {
    return seatOf(creature) === 'neck'
      ? this._cockNeck(g, mk, accent, creature)
      : this._cockSkull(g, mk, accent, creature);
  }

  /**
   * 頭部艙(體軸直立:猩猩/袋鼠/章魚):駕駛艙在顱腔,**隔著艙罩**看到自己的吻部/獠牙/觸手
   * 在前下方(艙框本身由 _cockCanopy 提供 —— 座艙裡坐的是人,不是獸的眼窩)。
   */
  _cockSkull(g, mk, accent, creature) {
    const bone = 0x4b545e, hard = 0x5b6772, tooth = 0xe4e9ee;
    const jaw = (w, h, len, z = -1.25, y = -0.62) => {
      const m = mk(new THREE.BoxGeometry(w, h, len), bone);
      m.position.set(0, y, z);
      g.add(m);
      return m;
    };
    const fangs = (sxSpread, y, z, n = 2) => {
      for (const sx of [-1, 1]) for (let i = 0; i < n; i++) {
        const f = mk(new THREE.ConeGeometry(0.045, 0.2, 5), tooth, { noPaint: true });
        f.rotation.x = Math.PI;
        f.position.set(sx * (sxSpread - i * 0.1), y, z + i * 0.16);
        g.add(f);
      }
    };
    if (creature === 'gorilla') {
      jaw(0.68, 0.24, 0.5, -1.2, -0.78);           // 寬吻(收窄下沉:近場寬吻單件吃掉 8% 畫面)
      fangs(0.2, -0.52, -1.15);
      for (const sx of [-1, 1]) {                  // 指節行走:前臂入畫下角
        const arm = mk(new THREE.CylinderGeometry(0.12, 0.15, 0.75, 8), hard);
        arm.rotation.set(0.5, 0, sx * 0.2);
        arm.position.set(sx * 0.95, -0.95, -1.0);
        g.add(arm);
      }
    } else if (creature === 'roo') {
      jaw(0.4, 0.22, 0.7, -1.2, -0.62);
      for (const sx of [-1, 1]) {                  // 大耳:細長、貼頂角外緣(只露耳尖入畫)
        const ear = mk(new THREE.CapsuleGeometry(0.065, 0.3, 4, 8), hard);
        ear.position.set(sx * 0.78, 0.84, -0.9);
        ear.rotation.z = sx * 0.3;
        g.add(ear);
      }
    } else if (creature === 'cthulhu') {
      // 觸手面部:四條觸手在視窗周圍蠕動(靜止也動);持械那條由 _cockMountStruct 另外長出來
      jaw(0.5, 0.2, 0.5, -1.05, -0.7);
      const spread = [[-0.42, -0.46], [0.42, -0.46], [-0.24, -0.62], [0.24, -0.62]];
      spread.forEach(([x, y], i) => {
        const root = new THREE.Group();
        root.position.set(x, y, -1.05);
        g.add(root);
        let parent = root;
        for (let s = 0; s < 3; s++) {
          const seg = new THREE.Group();
          seg.position.set(0, s === 0 ? 0 : -0.02, -0.24);
          const m = mk(new THREE.CylinderGeometry(0.05 - s * 0.012, 0.06 - s * 0.012, 0.26, 6), bone);
          m.rotation.x = Math.PI / 2;
          seg.add(m);
          parent.add(seg);
          this._flap(seg, 'x', 0.12, 0.22, 0.45, i * 1.1 + s * 0.8);
          parent = seg;
        }
      });
    } else {
      jaw(0.5, 0.26, 0.8);
      fangs(0.18, -0.5, -1.25);
    }
    return {
      hand: { x: 0.55, y: -0.42, z: -1.0, s: 1.1 },
      tentacle: { x: 0.52, y: -0.5, z: -0.95, s: 1.2 },
      mouth: { x: 0, y: -0.58, z: -1.35, s: 1.05 },   // 口部就在下緣正前
      back: { x: 0.5, y: 0.1, z: -1.45, s: 0.85 },    // 肩上砲座:退到側上角遠場(雙肩分扛 ×2 件,近場會吃掉 13% 畫面)
    };
  }

  /**
   * 頸部艙(體軸水平:獵犬/暴龍/鴕鳥/劍龍/人馬/迅猛龍/黑豹/巨象/犀金龜):
   * 視點在頸根 → 看出去先看到自己的頸背與頭顱(從後上方看那顆頭),嘴砲就從那顆頭的口中前伸。
   */
  _cockNeck(g, mk, accent, creature) {
    const bone = 0x4b545e, hard = 0x5b6772, tooth = 0xe4e9ee, dark = 0x39424b;
    // hy/hz = 頭顱中心;hw/hh/hd = 顱骨尺寸;nr = 頸半徑;snout/ear = 頭部特徵
    const S = {
      hound: { hy: -0.95, hz: -1.95, hw: 0.5, hh: 0.42, hd: 0.9, nr: 0.26, snout: 'muzzle', ear: 'prick' },
      trex: { hy: -0.88, hz: -2.05, hw: 0.72, hh: 0.62, hd: 1.35, nr: 0.36, snout: 'jaws', ear: 'crest' },
      raptor: { hy: -0.85, hz: -1.85, hw: 0.44, hh: 0.4, hd: 1.05, nr: 0.24, snout: 'jaws', ear: 'crest' },
      panther: { hy: -0.9, hz: -1.8, hw: 0.5, hh: 0.42, hd: 0.72, nr: 0.26, snout: 'muzzle', ear: 'round' },
      ostrich: { hy: -0.28, hz: -1.7, hw: 0.34, hh: 0.32, hd: 0.5, nr: 0.2, snout: 'beak', ear: null },
      stego: { hy: -1.05, hz: -1.9, hw: 0.36, hh: 0.32, hd: 0.78, nr: 0.24, snout: 'muzzle', ear: null, plates: true },
      centaur: { hy: -1.0, hz: -1.95, hw: 0.42, hh: 0.5, hd: 0.95, nr: 0.32, snout: 'muzzle', ear: 'prick', mane: true },
      elephant: { hy: -0.85, hz: -1.95, hw: 0.82, hh: 0.7, hd: 0.85, nr: 0.42, snout: 'trunk', ear: 'fan' },
      beetle: { hy: -0.95, hz: -1.8, hw: 0.7, hh: 0.4, hd: 0.8, nr: 0.34, snout: 'mand', ear: null, horn: true },
    }[creature] || { hy: -0.95, hz: -1.9, hw: 0.5, hh: 0.44, hd: 0.9, nr: 0.28, snout: 'muzzle', ear: 'prick' };

    // ---- 頸:自頸根(視點正下方)逐節前伸到顱底;節間加平端關節環(圓角量體不對接,見 CLAUDE.md)----
    // K:艙位就長在頸上 = 這些件離鏡頭不到 1m,原尺寸會糊成一根擋住準星的柱子 → 一律縮尺。
    // 座艙不是等比模型,是「從眼窩看出去的取景」;頭顱要小到能一眼認出輪廓,而不是一面牆。
    const K = 0.6, LIFT = 0.2;
    S.nr *= K; S.hw *= K; S.hh *= K; S.hd *= K;
    S.hy += LIFT;   // 頭顱抬進畫面下三分之一(不抬會低到貼著畫面下緣)
    // 抬完 MUST 夾回準星錐之外(2026-07-24 取景規則①,唯一縫 = COCKPIT.SIGHT_DEG):
    // 錐在深度 |hz| 的世界半徑 = tan(SIGHT_DEG)·|hz|;顱頂另含冠/耳/角 ⇒ 預留 1.35×hh。
    // 這條取代逐生物手寫高度 —— 鴕鳥 hy −0.28(眼高 ≈ 視軸,實測 0.2°:頭就擋在準星上)、
    // 暴龍 −0.88(6.9°)都由同一式壓下去,新增生物自動適用。
    const headClr = Math.tan(COCKPIT.SIGHT_DEG * Math.PI / 180) * Math.abs(S.hz);
    S.hy = Math.min(S.hy, -headClr - S.hh * 1.35);
    const N = 4;
    const root = new THREE.Vector3(0, -0.78, -0.45);   // 頸根在視點正下方(我們就坐在它上面)
    const nape = new THREE.Vector3(0, S.hy + S.hh * 0.45, S.hz + S.hd * 0.5);
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const a = root.clone().lerp(nape, t0), b = root.clone().lerp(nape, t1);
      const mid = a.clone().lerp(b, 0.5);
      const len = a.distanceTo(b);
      const r = S.nr * (1 - 0.18 * t1);
      const seg = mk(new THREE.CylinderGeometry(r, r * 1.06, len * 0.92, 10), bone);
      seg.position.copy(mid);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(seg);
      const ring = mk(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.05, 10), dark);
      ring.position.copy(b);
      ring.quaternion.copy(seg.quaternion);
      g.add(ring);
    }
    if (S.mane) {   // 人馬:騎士座下的馬鬃(識別色)
      const mane = mk(new THREE.BoxGeometry(0.08, 0.26, 1.5), accent, { emissive: accent, emissiveIntensity: 0.45 });
      mane.position.set(0, -0.62, -1.2);
      mane.rotation.x = -0.35;
      g.add(mane);
    }

    // ---- 頭顱(從後上方看)----
    const head = new THREE.Group();
    head.position.set(0, S.hy, S.hz);
    g.add(head);
    const skull = mk(new THREE.BoxGeometry(S.hw, S.hh, S.hd), bone);
    head.add(skull);
    for (const sx of [-1, 1]) {   // 眼:從我們的角度看是頭側的兩點識別光
      const eye = mk(new THREE.SphereGeometry(S.hw * 0.13, 8, 6), accent, { emissive: accent, emissiveIntensity: 1.3 });
      eye.position.set(sx * S.hw * 0.48, S.hh * 0.12, -S.hd * 0.12);
      head.add(eye);
    }
    if (S.snout === 'muzzle') {
      const mz = mk(new THREE.BoxGeometry(S.hw * 0.62, S.hh * 0.55, S.hd * 0.55), bone);
      mz.position.set(0, -S.hh * 0.2, -S.hd * 0.72);
      head.add(mz);
      const nose = mk(new THREE.SphereGeometry(S.hw * 0.16, 8, 6), 0x2b3239);
      nose.position.set(0, -S.hh * 0.16, -S.hd * 0.98);
      head.add(nose);
    } else if (S.snout === 'jaws') {
      const up = mk(new THREE.BoxGeometry(S.hw * 0.8, S.hh * 0.42, S.hd * 0.7), bone);
      up.position.set(0, S.hh * 0.05, -S.hd * 0.72);
      head.add(up);
      const low = mk(new THREE.BoxGeometry(S.hw * 0.68, S.hh * 0.24, S.hd * 0.66), bone);
      low.position.set(0, -S.hh * 0.34, -S.hd * 0.7);
      low.rotation.x = 0.12;
      head.add(low);
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {   // 上顎獠牙
        const f = mk(new THREE.ConeGeometry(S.hw * 0.07, S.hh * 0.34, 5), tooth, { noPaint: true });
        f.rotation.x = Math.PI;
        f.position.set(sx * S.hw * 0.3, -S.hh * 0.2, -S.hd * (0.5 + i * 0.18));
        head.add(f);
      }
    } else if (S.snout === 'beak') {
      const beak = mk(new THREE.ConeGeometry(S.hw * 0.42, S.hd * 1.2, 6), 0xd8b45a, { noPaint: true });
      beak.rotation.x = -Math.PI / 2;
      beak.position.set(0, -S.hh * 0.1, -S.hd * 0.9);
      head.add(beak);
    } else if (S.snout === 'trunk') {
      // 長鼻:分節垂下並前伸(會擺);嘴砲從鼻端射出
      let parent = head;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Group();
        seg.position.set(0, i === 0 ? -S.hh * 0.5 : -0.24, i === 0 ? -S.hd * 0.5 : -0.1);
        const m = mk(new THREE.CylinderGeometry(0.17 - i * 0.03, 0.2 - i * 0.03, 0.3, 8), bone);
        m.position.y = -0.15;
        seg.add(m);
        parent.add(seg);
        this._flap(seg, 'x', -0.25, 0.08, 0.4, i * 0.7);
        parent = seg;
      }
      for (const sx of [-1, 1]) {
        const tusk = mk(new THREE.CylinderGeometry(0.03, 0.07, 0.85, 6), tooth, { noPaint: true });
        tusk.rotation.set(1.25, 0, sx * 0.16);
        tusk.position.set(sx * S.hw * 0.42, -S.hh * 0.5, -S.hd * 0.75);
        head.add(tusk);
      }
    } else if (S.snout === 'mand') {
      for (const sx of [-1, 1]) {   // 大顎
        const mand = mk(new THREE.BoxGeometry(0.08, 0.07, 0.5), 0x2f353c);
        mand.position.set(sx * S.hw * 0.24, -S.hh * 0.4, -S.hd * 0.8);
        mand.rotation.y = sx * 0.18;
        head.add(mand);
      }
    }
    if (S.horn) {   // 犀金龜:頭角(招牌剪影)
      const horn = mk(new THREE.ConeGeometry(0.09, 0.8, 6), hard);
      horn.rotation.x = -1.25;   // 角尖前伸 ⇒ 根部 MUST 下移收短,否則掃進準星錐(實測 9.1°)
      horn.position.set(0, S.hh * 0.2, -S.hd * 0.5);
      head.add(horn);
    }
    if (S.ear === 'prick') {
      for (const sx of [-1, 1]) {
        const ear = mk(new THREE.ConeGeometry(S.hw * 0.26, S.hh * 1.0, 5), hard);
        ear.position.set(sx * S.hw * 0.34, S.hh * 0.7, S.hd * 0.18);
        ear.rotation.set(-0.2, 0, sx * 0.28);
        head.add(ear);
      }
    } else if (S.ear === 'round') {
      for (const sx of [-1, 1]) {
        const ear = mk(new THREE.ConeGeometry(S.hw * 0.24, S.hh * 0.5, 5), hard);
        ear.position.set(sx * S.hw * 0.38, S.hh * 0.6, S.hd * 0.1);
        ear.rotation.z = sx * 0.22;
        head.add(ear);
      }
    } else if (S.ear === 'crest') {
      const crest = mk(new THREE.BoxGeometry(0.06, S.hh * 0.5, S.hd * 0.5), accent, { emissive: accent, emissiveIntensity: 0.6 });
      crest.position.set(0, S.hh * 0.65, -S.hd * 0.1);
      head.add(crest);
    } else if (S.ear === 'fan') {
      for (const sx of [-1, 1]) {   // 巨象:大耳(側緣,會扇動)
        const ear = mk(new THREE.BoxGeometry(0.08, S.hh * 1.5, S.hd * 1.2), hard);
        ear.position.set(sx * (S.hw * 0.6), 0, S.hd * 0.15);
        this._flap(ear, 'y', sx * -0.35, sx * 0.12, 0.3);
        head.add(ear);
      }
    }
    if (S.plates) {   // 劍龍:背板列從頸背兩側往前排(自身剪影)
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
        const plate = mk(new THREE.BoxGeometry(0.06, 0.42 - i * 0.08, 0.3), accent,
          { emissive: accent, emissiveIntensity: 0.35 });
        plate.position.set(sx * 0.22, -0.42 - i * 0.1, -0.55 - i * 0.42);
        plate.rotation.z = sx * 0.28;
        g.add(plate);
      }
    }
    // 肩甲/翼根:貼畫面兩側下緣(頸根兩旁就是肩)
    for (const sx of [-1, 1]) {
      const shoulder = mk(new THREE.BoxGeometry(0.32, 0.24, 0.48), hard);
      shoulder.position.set(sx * 0.98, -0.82, -0.85);
      shoulder.rotation.z = sx * -0.22;
      g.add(shoulder);
    }
    return {
      // 嘴砲:砲口在頭顱前端(鼻/喙/顎之外),不是掛在相機前
      mouth: { x: 0, y: S.hy - S.hh * (S.snout === 'trunk' ? 1.5 : 0.25), z: S.hz - S.hd * 0.85, s: 1.15 },
      back: { x: 0.52, y: 0.48, z: -1.55, s: 0.85 },  // 背載砲塔:架在右肩上方,砲管越過頭顱側前方
      hand: { x: 0.55, y: -0.4, z: -1.0, s: 1.1 },   // 人馬騎士
      tentacle: { x: 0.52, y: -0.5, z: -0.95, s: 1.2 },
    };
  }

  /**
   * 變形機甲座艙:地面 / 飛行兩組件同時建好,依 this.flight 切換可見(伺服器不管型態)。
   * 型態一變,座艙結構與武裝掛點跟著整組換掉 —— 地面手持/嘴砲 ↔ 飛行機翼硬點/機身吊艙。
   * 回傳 { ground, air } 兩套掛點錨。
   */
  _buildMorphCockpit(g, mk, accent, vis) {
    const gr = new THREE.Group(), air = new THREE.Group();
    g.add(gr); g.add(air);
    this.cockGround = gr; this.cockAir = air;

    // ---- 地面型:人形(艙罩之外沒有多餘結構)or 獸型頭顱(依 visual.ground;MORPH_HUMANOID 是唯一真相)----
    const groundAnchors = MORPH_HUMANOID.has(vis.ground)
      ? { hand: { x: 0.5, y: -0.36, z: -1.0, s: 1.12 } }
      : this._cockBeast(gr, mk, accent, vis.ground);

    // ---- 飛行型:依 visual.flight ----
    const F = vis.flight, hard = 0x5b6772, dark = 0x46505b;
    if (F === 'heli' || F === 'tilt') {
      // 旋翼:頂上旋翼盤(heli 三旋翼 / tilt 兩具傾轉旋翼在兩側);
      // 2026-07-16 視野開闊化:頂部 canopy 橫樑拆除,機艙/旋翼縮上角遠場
      const xs = F === 'tilt' ? [-1.15, 1.15] : [-1.0, 1.0, 0];
      for (const x of xs) {
        const nac = mk(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8), dark);
        nac.position.set(x, x === 0 ? 0.74 : 0.56, x === 0 ? -1.6 : -1.45);
        air.add(nac);
        const rot = mk(new THREE.BoxGeometry(1.2, 0.02, 0.08), 0x9aa4ad, { transparent: true, opacity: 0.4 });
        rot.position.set(x, (x === 0 ? 0.74 : 0.56) + 0.18, x === 0 ? -1.6 : -1.45);
        air.add(rot);
        this.cockpitSpin.push(rot);
      }
    } else if (F === 'jet' || F === 'uav') {
      // 定翼噴射:兩側翼前緣退到下側角落遠場(不再是側牆)+ 機鼻(uav = 悟空光翼:光焰束)
      for (const sx of [-1, 1]) {
        const le = mk(new THREE.BoxGeometry(1.2, 0.05, 0.26), F === 'uav' ? accent : hard,
          F === 'uav' ? { emissive: accent, emissiveIntensity: 1.4, transparent: true, opacity: 0.6 } : {});
        le.position.set(sx * 1.15, -0.35, -0.95);
        le.rotation.set(0, sx * 0.6, sx * -0.1);
        air.add(le);
      }
      const nose = mk(new THREE.ConeGeometry(0.22, 0.9, 5), dark);
      nose.rotation.x = -Math.PI / 2;
      nose.position.set(0, -0.6, -1.45);
      air.add(nose);
      const hud = mk(new THREE.BoxGeometry(0.6, 0.03, 0.04), accent, { emissive: accent, emissiveIntensity: 1.2 });
      hud.position.set(0, -0.4, -0.8);
      air.add(hud);
    } else if (F === 'levi' || F === 'archo' || F === 'owl' || F === 'beetle') {
      // 擬態飛行(巨獸/始祖鳥/夜梟/犀金龜):撲翼/鞘翅在兩側拍動
      const spec = {
        levi: { hz: 0.7, amp: 0.22, len: 1.6, chord: 0.9, col: 0x6d5f7a, op: 0.8 },
        archo: { hz: 1.4, amp: 0.3, len: 1.3, chord: 0.55, col: 0x8f9aa5, op: 1 },
        owl: { hz: 1.1, amp: 0.26, len: 1.4, chord: 0.7, col: 0x7d8894, op: 1 },
        beetle: { hz: 5.5, amp: 0.4, len: 1.1, chord: 0.4, col: 0xbfe6ff, op: 0.45 },
      }[F];
      for (const sx of [-1, 1]) {
        const root = new THREE.Group();
        root.position.set(sx * 0.78, -0.42, -1.08);   // 同 _cockAvian:翼根貼側緣下方(視野開闊化 + 面積收斂)
        root.rotation.y = sx * 0.5;
        air.add(root);
        const w = mk(new THREE.BoxGeometry(spec.len, 0.04, spec.chord), spec.col,
          { transparent: spec.op < 1, opacity: spec.op });
        w.position.set(sx * spec.len * 0.5, 0, 0.08);
        root.add(w);
        this._flap(root, 'z', sx * 0.08, sx * spec.amp, spec.hz);
        if (F === 'beetle') {   // 鞘翅(不動的硬殼罩在膜翼上;縮小退到側緣,z 留在近場外)
          const elytra = mk(new THREE.BoxGeometry(0.5, 0.05, 0.36), hard);
          elytra.position.set(sx * 0.82, 0.1, -0.95);
          air.add(elytra);
        }
      }
      const snout = mk(new THREE.ConeGeometry(0.18, 0.7, 5), dark);
      snout.rotation.x = -Math.PI / 2;
      snout.position.set(0, -0.6, -1.3);
      air.add(snout);
    }
    air.visible = false;   // 重生一律地面型(_spawnAt)
    return {
      ground: groundAnchors,
      // 飛行武裝:機翼硬點(定翼)/ 機身吊艙(旋翼)/ 口砲(擬態獸型)
      air: {
        wing: { x: 0.95, y: -0.45, z: -1.05, s: 1.0 },
        body: { x: 0.28, y: -0.42, z: -1.0, s: 1.05 },
        mouth: { x: 0, y: -0.62, z: -1.55, s: 1.05 },
      },
    };
  }

  /**
   * 人類駕駛艙罩(**全機種共通**,2026-07-12;2026-07-16 拆除 A 柱/頂樑):儀表台 / HUD 燈條 + 左肩角色掛件。
   * 座艙裡坐的是人 —— 不論外面那具機體是人形、獸型還是無人機,看出去一律先隔著這面艙框,
   * 機體自身的結構(頭顱/吻部/翼/旋翼/武器)都在艙框之外。**MUST NOT** 退回「從獸的眼窩看出去」。
   * 上方與兩側視野全開放(無 A 柱/無頂樑)—— 艙外的機體特徵不被艙框遮擋。
   */
  _cockCanopy(g, mk, accent, vis) {
    // 儀表台(2026-07-24 取景改制):舊版 1.7×0.28 @ z −0.85 單件就吃掉 **26.4% 畫面**、
    // 頂緣爬到 NDC −0.40(高過 HUD 下帶上緣 −0.56)—— 全 32 角色共用,是「面積太大」的最大單一來源。
    // 收窄 + 下沉 + 後推到頂緣 ≈ NDC −0.60:整片壓在 HUD 下帶之內,遮擋降到 ~11%,座艙感不變。
    const dash = mk(new THREE.BoxGeometry(0.88, 0.16, 0.32), 0x46505b);
    dash.position.set(0, -0.72, -1.25);
    dash.rotation.x = 0.5;
    g.add(dash);
    const light = mk(new THREE.BoxGeometry(0.42, 0.04, 0.05), accent, { emissive: accent, emissiveIntensity: 0.9 });
    light.position.set(0, -0.64, -1.14);
    g.add(light);
    // 左肩掛件座:縮小並沉到左下角(2026-07-16 視野開闊化:側面不放大面積件)
    const shoulder = mk(new THREE.BoxGeometry(0.28, 0.16, 0.4), 0x5a6673);
    shoulder.position.set(-0.94, -0.62, -1.05);
    shoulder.rotation.z = 0.28;
    g.add(shoulder);
    const pod = vis.pod || 'none';
    if (pod === 'antenna') {
      const mast = mk(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6), 0x39424b);
      mast.position.set(-0.9, -0.16, -1.05);
      g.add(mast);
      const tip = mk(new THREE.SphereGeometry(0.045, 8, 6), accent, { emissive: accent, emissiveIntensity: 1.4 });
      tip.position.set(-0.9, 0.12, -1.05);
      g.add(tip);
    } else if (pod === 'blade') {
      const fin = mk(new THREE.BoxGeometry(0.04, 0.3, 0.12), 0x39424b, { metalness: 0.7 });
      fin.rotation.z = 0.3;
      fin.position.set(-0.98, -0.42, -1.05);
      g.add(fin);
    } else if (pod === 'shield') {
      const plate = mk(new THREE.BoxGeometry(0.07, 0.28, 0.24), 0x39424b, { metalness: 0.6 });
      plate.rotation.z = 0.14;
      plate.position.set(-1.02, -0.48, -1.0);
      g.add(plate);
    } else if (pod === 'rack') {
      const rack = mk(new THREE.BoxGeometry(0.22, 0.15, 0.26), 0x39424b);
      rack.position.set(-0.94, -0.44, -1.05);
      g.add(rack);
      for (const [ox, oy] of [[-0.05, -0.035], [0.05, -0.035], [-0.05, 0.035], [0.05, 0.035]]) {
        const cell = mk(new THREE.CylinderGeometry(0.026, 0.026, 0.22, 6), 0x14171a);
        cell.rotation.x = Math.PI / 2;
        cell.position.set(-0.94 + ox, -0.44 + oy, -1.07);
        g.add(cell);
      }
    } else if (pod === 'dish') {
      const dish = mk(new THREE.CylinderGeometry(0.14, 0.05, 0.05, 10), 0xaab4bd);
      dish.rotation.z = Math.PI / 3;
      dish.position.set(-0.98, -0.4, -1.05);
      g.add(dish);
    } else if (pod === 'twin') {
      for (const oy of [-0.045, 0.045]) {
        const tube = mk(new THREE.CylinderGeometry(0.03, 0.035, 0.42, 8), 0x2b3239, { metalness: 0.8 });
        tube.rotation.x = Math.PI / 2;
        tube.position.set(-0.96, -0.42 + oy, -1.12);
        g.add(tube);
      }
    }
  }

  /**
   * 輕/重武器座艙掛載(2026-07-22 同源改制):
   * **掛點(mount)決定長在機體哪裡;外觀直接複製第三人稱武裝子樹(models.js rig.wpn 登記)**,
   * 缺登記退回 podWeapon 依 def.type 建同語彙莢艙 —— 展示台/戰場/座艙三處武器同源。
   * 掛點錨由座艙 builder 提供(它才知道自己的頭顱/機翼/手臂在哪);缺錨時退回 DEF_ANCHOR。
   * 異型雙持(雙手/雙莢/雙翼)左右分掛(與第三人稱同約定:左輕右重;rig.weap 'L'/'R' 優先);
   * 同型雙模(slots 含輕+重)只建一次,回傳兩個槍口。
   * @returns {Object} 每 slot 的槍口局部座標(gunGroup 空間;彈道與槍口焰共用)
   */
  _mountCockpitWeapon(mk, accent, PAL, vis, slots, wpn, rig3p, parent, anchors, air) {
    const slot0 = slots[0];
    const both = slots.length > 1;
    const cdef = CHARACTERS[this.ch]?.[slot0] || {};   // 原始武器定義(只取 type/fan,不受 _setChar 內部順序影響)
    const wtype = cdef.type || 'gun';
    const kindArg = this.isMorph ? 'morph' : this.heroKind;
    const handSide = rig3p.weap?.[slot0];
    // 掛點:輕武器沿用 gunMount;地面重武器優先手持邊(rig.weap 'L'/'R'/'B'),否則查 HEAVY_MOUNT;
    // 飛行型態(morph 空中/無人機)輕重共用同族硬點,由左右分掛區分。
    // backPair = 輕重「雙肩分扛」(gorilla 2026-07-22):兩件都在 back 錨 → 左右鏡射分掛,
    // 且電漿破例不改口噴(第三人稱就長在左肩,FPV 同源)
    const hHand2 = ['L', 'R', 'B'].includes(rig3p.weap?.heavy);
    const heavyM = (!air && hHand2) ? 'hand'
      : (HEAVY_MOUNT[mountKey(vis, kindArg, air)] || gunMount(vis, kindArg, air, CHARACTERS[this.ch]?.heavy?.type || 'gun'));
    const backPair = !air && heavyM === 'back'
      && gunMount(vis, kindArg, air, CHARACTERS[this.ch]?.light?.type || 'gun') === 'back';
    let mount;
    if (slot0 === 'heavy' && !both && !air) {
      mount = heavyM;
      if (wtype === 'plasma' && mount === 'back' && !backPair) mount = 'mouth';   // 電漿口噴(雙肩分扛破例)
    } else {
      mount = gunMount(vis, kindArg, air, wtype);
    }
    // 左右分掛:hand/tentacle 依第三人稱持手邊;雙莢/翼/爪 = 左輕右重(buildDrone/buildFixedWing
    // 同約定);雙肩分扛 back 對 = 右輕左重(對齊 buildBipedBeast gorilla 第三人稱)
    let sideSign = 0;
    if (mount === 'hand' || mount === 'tentacle') sideSign = handSide === 'L' ? -1 : 1;
    else if (mount === 'back' && backPair && !both) sideSign = slot0 === 'light' ? 1 : -1;
    else if (mount === 'body' || mount === 'wing' || mount === 'claw') sideSign = both ? 0 : (slot0 === 'light' ? -1 : 1);
    const a = (anchors && anchors[mount]) || DEF_ANCHOR[mount] || DEF_ANCHOR.body;
    const s = a.s ?? 1.0;
    const ax0 = sideSign !== 0 ? Math.abs(a.x) * sideSign
      : (both && (mount === 'body' || mount === 'wing' || mount === 'claw')) ? 0 : a.x;
    // 輕重同掛點(dragon 頦下砲+口腔巢 / stego 背塔+背鰭):重武器沿**離心方向**錯開,重現上下疊放。
    // MUST NOT 一律上抬 —— 嘴砲錨在視軸正下方,上抬就是把砲管推進準星(2026-07-24 取景稽核打回)。
    let ax = ax0, ay = a.y, az = a.z;
    if (slot0 === 'heavy' && !both && sideSign === 0
      && mount === gunMount(vis, kindArg, air, CHARACTERS[this.ch]?.light?.type || 'gun')) {
      const rr = Math.hypot(ax, ay) || 1;
      ax += (ax / rr) * 0.26; ay += (ay / rr) * 0.26; az -= 0.1;
    }
    // ---- 取景夾制(2026-07-24 使用者四條規則;唯一縫 = COCKPIT)----
    // ① 錨點徑向外推到準星錐之外:錐在深度 |az| 的世界半徑 = tan(SIGHT_DEG)·|az|。
    //    「徑向」= 以準星(視軸)為圓心 —— 與規則④「消失點在準星」同一個圓心,推出去的方向天然離心。
    // ② 錨點高度夾在武裝頂緣線之下,留 0.2m 讓武器本體長得出來(背載砲塔原本高過畫面上緣)。
    // 取景環 = 準星錐 ×1.2 再加掛載機構自身的半尺寸(≈0.24s)—— 手臂/砲座/喉管與武器同進退,
    // 只推武器不推機構的話,砲座量體會自己坐進準星裡(gorilla 雙肩分扛實測 2.5°)。
    // 順序 MUST 是「先壓高度、再徑向外推」—— 反過來會用未夾制的高度算出「已在錐外」而放行,
    // 壓下來之後量體就坐進準星裡(gorilla 雙肩分扛實測 2.5°)。
    const clr = Math.tan(COCKPIT.SIGHT_DEG * Math.PI / 180) * Math.abs(az);
    const ring = clr * 1.2 + 0.24 * s;
    const topCap = COCKPIT.TOP_NDC * ndcH(az) - 0.2;
    ay = Math.min(ay, topCap);
    const rr0 = Math.hypot(ax, ay);
    if (rr0 > 1e-4 && rr0 < ring) { const f = ring / rr0; ax *= f; ay *= f; }
    // 量體離視軸的最小夾角(遠面最嚴格;x/y 各自夾到 0 取最近點)
    const coneDeg = (b) => Math.atan2(
      Math.hypot(Math.min(Math.max(0, b.min.x), b.max.x), Math.min(Math.max(0, b.min.y), b.max.y)),
      Math.max(Math.abs(b.min.z), Math.abs(b.max.z))) * 180 / Math.PI;
    // 掛載機構(臂/觸手/喉管/砲座支柱/翼下掛架/爪/吊莢座)。
    // 機構是剛體(手臂連著手、砲座連著支柱)⇒ 侵入準星錐時 MUST 整組沿徑向外推重建,
    // 不能只挪其中一件;各分支自身的偏移量(吊莢座 +0.1s、砲座 −0.1s…)也因此不必逐條算進 ring。
    let struct = null;
    for (let it = 0; it < 6; it++) {
      const flapN = this.cockpitFlap.length;   // tentacle 機構會 _flap 進 cockpitFlap;被駁回要一併回收
      struct = new THREE.Group();
      struct.userData.cockStruct = true;       // 標記:武器相關掛載機構(取景夾制吃頂緣/準星錐,但豁免裝置面積規則)
      parent.add(struct);
      this._cockMountStruct(mk, mount, { x: ax, y: ay, z: az, s }, sideSign || 1, struct);
      struct.updateMatrixWorld(true);
      const sb = new THREE.Box3().setFromObject(struct);
      if (sb.isEmpty() || coneDeg(sb) >= COCKPIT.SIGHT_DEG) break;
      parent.remove(struct);
      this.cockpitFlap.length = flapN;         // 丟棄本次機構的擺動註冊(否則指向已移除的孤兒節點)
      ax *= 1.12;
      ay = Math.min(ay * 1.12, topCap);
    }
    // 武器本體:複製第三人稱武裝子樹;缺登記退回 podWeapon(幾何 +z 朝前 → 轉 π 朝 -z)
    const set = wpn[slot0] || (both ? wpn[slots[1]] : null);
    const wrap = new THREE.Group();
    wrap.userData.cockWpn = slots.join('+');   // 稽核標記(tools/audit_cockpit.mjs 取景量測用)
    parent.add(wrap);
    const LEN = (COCK_WLEN[mount] ?? 1.0) * s;
    const muzNodes = {};
    let cloned = null;
    if (set?.nodes?.length && set.ref) cloned = this._cloneWpnSet(set);
    if (cloned) {
      const rot = WPN_FWD_ROT[set.fwd || 'z'] || WPN_FWD_ROT.z;
      const inner = new THREE.Group();
      inner.rotation.set(rot[0], rot[1], rot[2]);
      inner.add(cloned.grp);
      wrap.add(inner);
      for (const sl of slots) muzNodes[sl] = (wpn[sl]?.muz && cloned.pairs.get(wpn[sl].muz)) || null;
    } else {
      const inner = new THREE.Group();
      inner.rotation.y = Math.PI;
      wrap.add(inner);
      const pw = podWeapon(inner, cdef, accent, PAL, { L: LEN * 0.75, R: slot0 === 'heavy' ? 0.1 : 0.07 });
      for (const sl of slots) muzNodes[sl] = pw.muz;
    }
    // ---- ④ 消失點在準星:把實測**砲管軸線**轉到指向視軸上 VP_Z 公尺處(螢幕上就是準星)----
    // 軸線 = **視覺量體中心 → 離中心最遠的那個槍口**。
    //  ·起點取量體中心(不取 ref 框原點):散件武裝(口腔飛彈巢/背鰭/雙肩 VLS)的 ref 是軀幹節點,
    //   原點根本不在武器上,拿它當槍尾會把整組轉到奇怪的方向(實測 dragon 147.8°)。
    //  ·終點取最遠槍口:同型雙模的兩個膛口常一前一後(seraph 騎槍:輕模副槍口在 1/3 處、
    //   重模主砲膛口在槍尖),取近的那個會把整把槍轉反(實測 159°)。
    //  ·AABB 中心不隨旋轉共變 ⇒ 這是不動點迭代;直接套完整修正會在細長 L 形量體上震盪(實測殘留 16°),
    //   故每步只套 DAMP 比例的修正(阻尼迭代),收斂後殘留 <1°。
    wrap.updateMatrixWorld(true);
    const vpDir = new THREE.Vector3(-ax, -ay, -COCKPIT.VP_Z - az).normalize();
    const DAMP = 0.6;
    for (let it = 0; it < 16; it++) {
      const ctr = new THREE.Box3().setFromObject(wrap).getCenter(new THREE.Vector3());
      let axis = null, far = 1e-2;
      for (const sl of slots) {
        if (!muzNodes[sl]) continue;
        const v = muzNodes[sl].getWorldPosition(new THREE.Vector3()).sub(ctr);
        if (v.length() > far) { far = v.length(); axis = v; }
      }
      if (!axis) break;
      axis.normalize();
      if (axis.dot(vpDir) > 0.99985) break;                       // 已對準(<1°)
      const q = new THREE.Quaternion().setFromUnitVectors(axis, vpDir);
      wrap.quaternion.premultiply(new THREE.Quaternion().slerp(q, DAMP));
      wrap.updateMatrixWorld(true);
    }
    // 量測定尺 + 置位:前端朝 -z、包圍盒對齊錨點;近場保護(任何件不越過 z = -0.55,免糊滿畫面)
    const q0 = wrap.quaternion.clone();
    const bb = new THREE.Box3().setFromObject(wrap);
    const size = bb.getSize(new THREE.Vector3());
    // 背載散件對(雙肩 VLS/四背鰭)橫跨左右 → X 預算收緊,整組貼住砲座不外擴到畫面中央
    const xBudget = (mount === 'back' && cloned && set.nodes.length > 1 ? 0.55 : 0.9) * s;
    const sc0 = Math.min(
      LEN / Math.max(size.z, 0.05),
      (0.54 * s) / Math.max(size.y, 0.05),   // 高度預算收緊(手持長槍垂直佔畫面過高)
      xBudget / Math.max(size.x, 0.05),
    );
    // 依縮放 k 就位(z 吃近場保護 −0.7,與掛載機構同一條近端界;背載另坐上砲座頂)
    const place = (k) => {
      wrap.quaternion.copy(q0);
      wrap.scale.setScalar(k);
      const c0 = bb.getCenter(new THREE.Vector3()).multiplyScalar(k);
      wrap.position.set(ax - c0.x, ay - c0.y, Math.min(-0.7 - bb.max.z * k, az - c0.z));
      if (mount === 'back') wrap.position.y += (ay - 0.02) - (wrap.position.y + bb.min.y * k);
      return {
        lo: bb.min.clone().multiplyScalar(k).add(wrap.position),
        hi: bb.max.clone().multiplyScalar(k).add(wrap.position),
      };
    };
    // 頂緣逐頂點量(不是 AABB):VP 旋轉後的長槍(嘴砲喉管/騎槍)傾斜頂緣比軸對齊盒高出 ~0.05,
    // AABB 會漏 ⇒ 武器戳出 HUD 線上。+0.016 = 描邊殼外推(outlinify 尚未執行,先預留)。
    const _tv = new THREE.Vector3();
    const wrapTopNdc = () => {
      let best = -9;
      wrap.updateWorldMatrix(true, true);
      wrap.traverse((m) => {
        const pos = m.isMesh && !m.userData.isOutline && m.geometry?.attributes?.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          _tv.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (_tv.z >= -0.05) continue;
          const n = (_tv.y + 0.016) / (Math.abs(_tv.z) * COCKPIT.TAN_V);
          if (n > best) best = n;
        }
      });
      return best;
    };
    // 取景判定:①量體離視軸最小夾角 ≥ SIGHT_DEG(準星錐淨空)②頂緣 ≤ TOP_NDC(逐頂點)③盒 ≤ WPN_BOX_MAX
    const framed = (b) => {
      const cx = Math.min(Math.max(0, b.lo.x), b.hi.x);       // 量體上離視軸最近的點(x/y 各自夾到 0)
      const cy = Math.min(Math.max(0, b.lo.y), b.hi.y);
      const zf = Math.max(Math.abs(b.lo.z), Math.abs(b.hi.z));  // 遠面:同樣的橫向距離在此處張角最小
      const zn = Math.max(0.05, Math.min(Math.abs(b.lo.z), Math.abs(b.hi.z)));
      const deg = Math.atan2(Math.hypot(cx, cy), zf) * 180 / Math.PI;
      const nw = (b.hi.x - b.lo.x) / (ndcH(zn) * 1.7778) / 2;   // 螢幕佔比(16:9 基準)
      const nh = (b.hi.y - b.lo.y) / ndcH(zn) / 2;
      return deg >= COCKPIT.SIGHT_DEG && nw * nh <= COCKPIT.WPN_BOX_MAX;
    };
    const okAt = (k) => framed(place(k)) && wrapTopNdc() <= COCKPIT.TOP_NDC;   // place(k) 先就位,再逐頂點量頂緣
    // 二分取「合規的最大尺寸」:單調(縮小 → 離視軸更遠、頂緣更低),故無需迭代求解器
    let sc = sc0;
    if (!okAt(sc0)) {
      let lo = 0, hi = sc0;
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (okAt(mid)) lo = mid; else hi = mid; }
      sc = Math.max(lo, sc0 * 0.2);   // 下限:寧可留一項稽核紅字,也不要武器縮成看不見的點
    }
    place(sc);
    // 槍口(gunGroup 局部座標):複本槍口節點實位;查無節點退回包圍盒前緣中心
    this.gunGroup.updateMatrixWorld(true);
    const out = {};
    for (const sl of slots) {
      out[sl] = muzNodes[sl]
        ? muzNodes[sl].getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(ax, ay, wrap.position.z + bb.min.z * sc - 0.05);
      this._mountAudit[sl] = mount;
    }
    return out;
  }

  /**
   * 複製 rig.wpn 登記的武裝子樹:以 ref.matrixWorld⁻¹ × node.matrixWorld 烘相對變換 →
   * 散件武器(嘴砲/背鰭/翼掛)保持第三人稱排列。剔除描邊殼(寬度是機體尺度烤死的,
   * 座艙統一重描)與待機槍口焰(隱形死件);複本共享來源幾何/材質(已含 paintUnit 塗裝)
   * → 標 noPaint 避免座艙塗裝二次上色。來源機體從未 render,幾何/材質由複本續用,MUST NOT dispose。
   */
  _cloneWpnSet(set) {
    const grp = new THREE.Group();
    const pairs = new Map();   // 原節點 → 複本節點(槍口對應查找)
    const refInv = set.ref.matrixWorld.clone().invert();
    const walk = (o, cl) => {
      pairs.set(o, cl);
      for (let i = 0; i < o.children.length; i++) walk(o.children[i], cl.children[i]);
    };
    for (const node of set.nodes) {
      if (!node) continue;
      const cl = node.clone(true);
      walk(node, cl);
      const rel = new THREE.Matrix4().multiplyMatrices(refInv, node.matrixWorld);
      rel.decompose(cl.position, cl.quaternion, cl.scale);
      grp.add(cl);
    }
    if (!grp.children.length) return null;
    const dead = [];
    grp.traverse((o) => { if (o.userData.isOutline || (!o.visible && o.userData.noOutline)) dead.push(o); });
    for (const o of dead) o.parent?.remove(o);
    grp.traverse((o) => { if (o.isMesh) o.userData.noPaint = true; });
    return { grp, pairs };
  }

  /** 掛載機構(手臂/觸手/喉管/砲座支柱/翼下掛架/爪/吊莢座):只建結構,不建武器本體。
   *  a.x 已含左右符號;sx = 鏡射符號(額外偏移與傾角用)。
   *  近場的件會整片糊在畫面上(實測手臂/砲座曾佔掉半個螢幕),一律夾回 NEAR_Z。
   *  NEAR_Z 從 −0.55(= 相機近裁面 0.5 的貼面)退到 −0.75:貼著近裁面的 0.26m 吊莢座
   *  在畫面上有 39% 寬(2026-07-24 實測 6.9% 遮擋 ×2),而且會被近裁面切掉一半。 */
  _cockMountStruct(mk, mount, a, sx, parent) {
    const s = a.s ?? 1.0;
    // hd = 該件自身的半深度:夾的是**近端面**不是中心。只夾中心的話,一個 0.48 深的砲座
    // 中心停在 −0.75、近面就落到 −0.51(相機近裁面 0.5),在畫面上炸成 15.9%(gorilla 實測)。
    const zb = (v, hd = 0) => Math.min(v, -0.75 - hd);
    if (mount === 'hand') {
      // 手持:前臂 → 握把,武器在手上(人形機甲 / 有手的仿生體 / 騎士)。
      // 只留「前臂 + 手」暗示持握 —— 上臂原本從畫面外斜插進來,雙持時兩隻整臂佔掉兩個下角
      // (使用者回報「手部超出太多」);前臂縮細(0.08r)貼下緣即可,識別為「手持」不需整條手臂。
      const upper = mk(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.42 * s, 8), 0x5b6772);
      upper.rotation.set(0.9, 0, -0.25 * sx);
      upper.position.set(a.x + 0.22 * s * sx, a.y - 0.42 * s, zb(a.z + 0.5 * s, 0.21 * s));
      parent.add(upper);
      const fore = mk(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.5 * s, 8), 0x4b545e);
      fore.rotation.set(1.35, 0, -0.12 * sx);
      fore.position.set(a.x + 0.1 * s * sx, a.y - 0.24 * s, zb(a.z + 0.22 * s, 0.25 * s));
      parent.add(fore);
      const hand = mk(new THREE.BoxGeometry(0.16 * s, 0.16 * s, 0.2 * s), 0x39424b);
      hand.position.set(a.x, a.y - 0.1 * s, zb(a.z + 0.02, 0.1 * s));
      parent.add(hand);
      return;
    }
    if (mount === 'tentacle') {
      // 觸手持械:多節觸手從下側卷上來握住武器(靜止也蠕動)
      let node = parent;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Group();
        seg.position.set(i === 0 ? a.x + 0.34 * sx : 0, i === 0 ? a.y - 0.62 : 0.1, i === 0 ? zb(a.z + 0.45, 0.13) : -0.22);
        const m = mk(new THREE.CylinderGeometry(0.09 - i * 0.012, 0.11 - i * 0.012, 0.26, 7), 0x4b545e);
        m.rotation.x = Math.PI / 2;
        m.position.z = -0.1;
        seg.add(m);
        node.add(seg);
        this._flap(seg, 'x', -0.16, 0.09, 0.4, i * 0.9);   // 眼鏡蛇預備式的微蠕動
        node = seg;
      }
      return;
    }
    if (mount === 'mouth') {
      // 嘴砲:喉管從自己的口中/鼻端接出(無握把、無槍機 —— 武器就是機體的一部分)
      const throat = mk(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.3 * s, 8), 0x39424b);
      throat.rotation.x = Math.PI / 2;
      throat.position.set(a.x, a.y, a.z + 0.2 * s);
      parent.add(throat);
      return;
    }
    if (mount === 'back') {
      // 背載砲塔(無手仿生體/肩扛/背載加農):基座在頸背,支柱 MUST 連回畫面下緣的頸背
      // —— 否則砲塔看起來浮在空中(沒有機體接點)。
      const bz = zb(a.z + 0.4 * s, 0.17 * s);
      const base = mk(new THREE.BoxGeometry(0.28 * s, 0.2 * s, 0.34 * s), 0x46505b);
      base.position.set(a.x, a.y - 0.1 * s, bz);
      parent.add(base);
      const napeP = new THREE.Vector3(a.x * 0.8, -0.6, -0.7);            // 肩背接點(砲塔不是浮空的)
      const top = new THREE.Vector3(a.x, a.y - 0.25 * s, bz);
      const mid = napeP.clone().lerp(top, 0.5);
      const mast = mk(new THREE.CylinderGeometry(0.05 * s, 0.075 * s, napeP.distanceTo(top), 8), 0x39424b);
      mast.position.copy(mid);
      mast.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(napeP).normalize());
      parent.add(mast);
      return;
    }
    if (mount === 'wing') {
      // 機翼硬點掛架(該側單具;異型雙掛「左輕右重」由呼叫端分兩次建)
      const pylon = mk(new THREE.BoxGeometry(0.08 * s, 0.16 * s, 0.22 * s), 0x46505b);
      pylon.position.set(a.x, a.y + 0.14 * s, zb(a.z + 0.3 * s, 0.11 * s));
      parent.add(pylon);
      return;
    }
    if (mount === 'claw') {
      // 爪掛槍莢(該側單爪;翼龍雙爪 = 呼叫端左輕右重各建一次)
      const claw = mk(new THREE.CylinderGeometry(0.03 * s, 0.05 * s, 0.3 * s, 5), 0x5b6772);
      claw.rotation.z = sx * 0.35;
      claw.position.set(a.x, a.y + 0.2 * s, a.z + 0.25 * s);
      parent.add(claw);
      return;
    }
    // body:機身固定吊莢座(旋翼無人機吊艙 / 直升機短翼掛架)
    const pod = mk(new THREE.BoxGeometry(0.26 * s, 0.16 * s, 0.3 * s), 0x3d454e);
    pod.position.set(a.x, a.y + 0.1 * s, zb(a.z + 0.3 * s, 0.15 * s));
    parent.add(pod);
  }

  // ---------------- 物理:爆炸衝擊 / 碰撞 ----------------
  /** 爆炸衝擊波:把自己(座機)往外推 + 鏡頭震動。強度隨距離平方衰減、隨爆炸半徑(能量)遞增 —
   *  近炸猛烈、遠處迅速歸零;同距離下大爆炸比小爆炸更晃(符合爆壓物理直覺)。
   *  作用半徑 = 該武器攻擊半徑 r × SHAKE.BLAST_F(2026-07-23 使用者指示:震波不可無限遠傳遞),
   *  超出即完全無感 —— MUST NOT 加回固定下限或倍數放大。 */
  _applyBlast(x, y, z, r) {
    if (!this.side || this.dead) return;
    const eye = this.camera.position;
    const d = Math.hypot(eye.x - x, eye.y - y, eye.z - z);
    const R = r * SHAKE.BLAST_F;
    if (!(R > 0) || d > R) return;
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

  // 單位碰撞半徑 / 高度(公尺):玩家座機不能穿過單位與建築。
  // 人員/載具 = 真實世界尺寸(見 models.js TARGET_H);英雄機體體型綁角色護甲,
  // 故不查此表,改由 heroCollider() 依 heroTargetH 動態推導(見 _makeEnt 的 ent.heroCol)。
  static COLLIDER = {
    base: { r: 20, h: 46 }, tower: { r: 7, h: 26 },
    tank: { r: 1.9, h: 2.8 }, apc: { r: 1.6, h: 2.7 }, soldier: { r: 0.6, h: 1.8 },
  };

  /** 自機機體實高(公尺):碰撞圓柱與座艙視點高度一律由它推導 */
  get selfH() { return this.heroKind ? heroTargetH(this.heroKind, this.ch) : SOLDIER_H * 4; }

  /** 目前是否為飛行機體(無人機恆飛;變形機甲僅飛行型態) */
  _flying() { return this.isDrone || (this.isMorph && this.flight); }

  /** 玩家是否有移動輸入(高後座重武器的「停穩才能開火」判定) */
  _moveInput() {
    const k = this.keys;
    return !!(k.KeyW || k.KeyA || k.KeyS || k.KeyD || k.Space || k.KeyC || k.ControlLeft);
  }

  /** 開火中位移懲罰係數(stop=0 / slow=slowF / 其餘=1);飛行機體套 AIR_F 折扣(空中減半) */
  _recoilMoveF(now, fly) {
    if (!this._recoilMove || now >= (this._recoilMoveUntil || 0)) return 1;
    let f = this._recoilMove === 'stop' ? 0 : this._recoilMove === 'slow' ? this._recoilSlowF : 1;
    if (fly && f < 1) f = 1 - (1 - f) * RECOIL.AIR_F;
    return f;
  }

  /** 招式增益倍率(伺服器 mods 快照 [k, m, remS]):同鍵取最強;查無 = 1(speed 衝鋒 / jump 大跳躍) */
  _modF(k) {
    let v = 1;
    for (const md of this.selfMods || []) if (md[0] === k && md[1] > v) v = md[1];
    return v;
  }

  /** 控場移動係數(麻痺 = 0、緩速 ×slowF)—— 與伺服器 NPC(_advance)/bot(_speed)同一套規則 */
  _ccMoveF() {
    if ((this.stunLeft || 0) > 0) return 0;
    return (this.slowLeft || 0) > 0 ? (this.slowF || 0.6) : 1;
  }

  /** 控場/標記狀態的上升沿播報(比照 _empWarnAt 的自我節流模式;快照 8Hz 驅動) */
  _ccFeed() {
    const edge = (key, left, msg) => {
      const on = (left || 0) > 0;
      if (on && !this[key]) this.hud.feed?.(msg);
      this[key] = on;
    };
    edge('_stunOn', this.stunLeft, '⛓️ 機體麻痺:動力系統離線(武器仍可運作)!');
    edge('_slowOn', this.slowLeft, '🕸️ 機體緩速:行動遲滯!');
    edge('_confOn', this.confLeft, '💫 操縱混亂:控制訊號反轉!');
    edge('_bleedOn', this.bleedLeft, '🩸 裝甲破口:持續失血中!');
    edge('_markOn', this.markLeft, '🎯 定位完成:下一擊必中必爆!');
    edge('_invOn', this.invLeft, '🛡️ 相位護盾:1 秒無敵!');
  }

  /**
   * 扇形武器彈著演出(散彈 / 電漿):沿射向水平張開 def.arc 半角,佐以少量垂直散布 =
   * 真散彈的圓形彈著。散彈 = 動能彈丸(細短曳光、密);電漿 = 焰舌(粗長、稀)。命中判定在伺服器。
   */
  _fanBlast(muzzle, dir, def, barraging = false) {
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const half = (def.arc || 15) * Math.PI / 180;
    const plasma = def.type === 'plasma';
    const col = plasma
      ? (this.side === 'SWARM' ? 0xffcf7f : 0x7fe8ff)
      : (this.side === 'SWARM' ? 0xffe08a : 0xbfe6ff);
    const blades = (plasma ? 7 : 9) + (barraging ? 4 : 0);   // 巨炮:離子扇加葉數(更密更亮)
    const wF = barraging ? 1.9 : 1, rF = barraging ? BARRAGE.RANGE_F : 1;   // 巨炮:更寬 + 射程 +20%(對齊伺服器加程)
    this._muzzleBurst(muzzle, plasma, this.side);   // 電漿重武器槍口爆(明顯度)
    if (barraging) shockRing(this.scene, this.effects, muzzle.x, muzzle.y, muzzle.z, 3.8, col);
    // 離子吐息主噴流(哥吉拉式;使用者指定參考):錐狀噴口 + 螺旋纏繞能量帶。
    // 扇形的「越近越強」由伺服器 fanFalloff 結算 —— 噴口最粗、末端收束就是它的可視化。
    if (plasma) {
      const core = this._shotCols(this.side).hot;
      const clip = this._clipBeam(muzzle, muzzle.clone().addScaledVector(dir, def.range * this._altRangeMul(def) * rF * 0.82));
      ionBreath(this.scene, this.effects, muzzle, clip.to, col,
        { r: 2.2 * wF, ttl: 0.45 * (barraging ? 1.4 : 1), coil: barraging ? 4 : 3, core });
      shockRing(this.scene, this.effects, muzzle.x, muzzle.y, muzzle.z, 2.6 * wF, core);
    }
    for (let i = 0; i < blades; i++) {
      const f = blades === 1 ? 0 : (i / (blades - 1)) * 2 - 1;          // −1..1 橫向
      const dk = dir.clone()
        .applyAxisAngle(up, half * f)
        .applyAxisAngle(right, half * 0.5 * (Math.random() * 2 - 1));   // 垂直散布 = 圓形彈著
      const len = def.range * this._altRangeMul(def) * rF * (plasma ? 0.7 + Math.random() * 0.3 : 0.85 + Math.random() * 0.15);
      const end = muzzle.clone().addScaledVector(dk, len);
      const clip = this._clipBeam(muzzle, end);   // 自機扇形彈舌同樣止於障礙面(彈著花打在牆上)
      beamLine(this.scene, this.effects, muzzle, clip.to, col, plasma ? { ttl: 0.24 * (barraging ? 1.5 : 1), w: 0.16 * wF } : { ttl: 0.12, w: 0.07 * wF });
      starburst(this.scene, this.effects, clip.to.x, clip.to.y, clip.to.z, (plasma ? 3 : 1.5) * (barraging ? 1.7 : 1), col);
    }
  }

  /** 玩家 vs 單位/建築:水平圓柱推擠(考慮飛行高度,飛過塔頂不碰撞) */
  _collide(px0, pz0) {
    const fly = this._flying();
    const H = this.selfH;
    const myR = H * (fly ? SELF_F.flyR : SELF_F.groundR);
    const myBot = this.pos.y - (fly ? H * SELF_F.flyBot : 0);
    const myTop = this.pos.y + H * (fly ? SELF_F.flyTop : SELF_F.groundTop);
    for (const ent of this.ents.values()) {
      if (ent.isSelf || !ent.mesh.visible) continue;
      // 自己的僚機不碰撞:歸隊時牠們以 50m/s 貼上來,會誤觸下面的高速撞擊自爆
      if (ent.hero && ent.pid != null && ent.pid === this.youId) continue;
      let c = ent.heroCol || BattleClient.COLLIDER[ent.kind];
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
        this.vel.x -= into * nx; this.vel.z -= into * nz;   // 吃掉衝向單位的速度分量(單機不再撞擊自爆)
      }
    }
    // 圖資建物(biomes 客戶端幾何,全房間同一 OSM 來源 → 各端一致):
    // 純推擠不結算傷害,伺服器權威不受影響;無人機可飛越屋頂
    // 站在高架橋面上時,橋面「下方」街廓的建物(基座低於腳下一截)不推擠 —— 高架路飛越街廓,
    // 否則橋下高樓的碰撞柱垂直涵蓋橋面高度 → 走在橋上會被橋下建物側推撞下橋(#INC 高架橋掉橋)。
    const surfHere = this._surf(this.pos.x, this.pos.z, this.pos.y);
    // onDeck = 真的站在高架橋面(deck ribbon 上,查 deckY 對得上站立面),不是任何「高於地表
    // 的站立面」—— 站障礙物頂(建物/神木/巨岩,2026-07-22 起可站)時 MUST NOT 吃橋面豁免,
    // 否則「基座低於腳下 3m」的鄰樓(含更高的樓)全部不推擠 = 從屋頂側向走進鄰棟破圖
    const dkY = this.terrain.deckY?.(this.pos.x, this.pos.z, 3.0);
    const onDeck = surfHere > this.terrain.heightAt(this.pos.x, this.pos.z) + 1.0
      && dkY != null && Math.abs(surfHere - dkY) < 0.6;
    this._surfHere = surfHere; this._onDeck = onDeck;   // 供 _cameraDeClip 共用(免重算)

    // 掃掠防穿透(2026-07-23):高速擊退 / 掉幀大 dt 會讓本幀位移「終點」落在障礙另一側 —— push-out
    // 只查終點重疊,穿到另一側就偵測不到 → 破圖穿透。先沿位移 P0(px0,pz0)→P1(pos)掃掠,夾在「首個
    // 真正被橫越(P0/P1 皆在外、線段進入)障礙」的前緣;正常慢速貼牆(終點落在障礙內)不觸發,交由
    // 下方 push-out 沿牆滑。與 push-out 共用同一垂直閘 + onDeck 豁免。px0/pz0 缺(舊呼叫)則跳過。
    if (px0 != null) this._sweepBlockers(px0, pz0, surfHere, onDeck, myR, myBot, myTop);

    // push-out:密集街廓單趟推擠可能把機體從 A 推進 B(殘留重疊)→ 至多 3 趟收斂(穩定即止)
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of this.terrain.blockers || []) {
        if (onDeck && b.y < surfHere - 3) continue;   // 橋下街廓建物:玩家在橋面上,不推擠
        // myBot 貼在頂面(surfaceAt mount 站上頂)不側推 —— 與橋墩「柱頂封底緣」同一課(biomes 2668);
        // ε 0.1 併吞原嚴格不等式的 myBot > top 分支
        if (myBot >= b.y + b.h - 0.1 || myTop < b.y) continue;
        if (b.hw2 != null) {
          // 建物 = 有向盒推擠(圓柱內切於盒角 → 斜向進入會鑽進盒角破圖;改用真實盒面 + 機體半徑外擴)
          const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
          const rx = this.pos.x - b.x, rz = this.pos.z - b.z;
          const lx = rx * cs + rz * sn, lz = -rx * sn + rz * cs;   // world→local(繞 -ry)
          const ex = b.hw2 + myR, ez = b.hd2 + myR;                // Minkowski 近似:盒面外擴機體半徑
          if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;  // 盒外
          const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);    // 各軸穿透深度 → 沿最小穿透軸推出
          let dlx = 0, dlz = 0;
          if (px < pz) dlx = lx < 0 ? -px : px; else dlz = lz < 0 ? -pz : pz;
          const dwx = dlx * cs - dlz * sn, dwz = dlx * sn + dlz * cs;   // local→world(繞 +ry)
          this.pos.x += dwx; this.pos.z += dwz; moved = true;
          const nl = Math.hypot(dwx, dwz) || 1, nx = dwx / nl, nz = dwz / nl;
          const into = this.vel.x * nx + this.vel.z * nz;
          if (into < 0) { this.vel.x -= into * nx; this.vel.z -= into * nz; }
          continue;
        }
        const dx = this.pos.x - b.x, dz = this.pos.z - b.z;
        const d = Math.hypot(dx, dz);
        const min = myR + b.r;
        if (d >= min || d === 0) continue;
        const nx = dx / d, nz = dz / d;
        this.pos.x += nx * (min - d);
        this.pos.z += nz * (min - d);
        moved = true;
        const into = this.vel.x * nx + this.vel.z * nz;
        if (into < 0) { this.vel.x -= into * nx; this.vel.z -= into * nz; }   // 撞神木/巨岩/橋墩:吃掉速度分量
      }
      if (!moved) break;
    }
  }

  /**
   * 掃掠防穿透:沿本幀水平位移 P0(px0,pz0)→P1(this.pos)檢查機體圓盤(半徑 myR)是否「單幀橫越」
   * 任一障礙。push-out 只查終點重疊,故高速擊退 / 掉幀大 dt 穿到另一側時偵測不到 → 破圖。此處求「首個
   * 真正被橫越(P0 與 P1 皆在障礙外、進入參數 ∈(0,1])障礙」的進入點,夾住 pos 於其前緣(留 SKIN),
   * 吃掉沿位移方向的速度;隨後 push-out 解殘留 + 切向。終點落在障礙內(正常慢速貼牆)不觸發 → 手感不變。
   * 垂直閘 / onDeck 豁免與 push-out 同式;幾何式與 _blockerHitT / 盒推擠一致(圓柱 & 有向盒各一條)。
   */
  _sweepBlockers(px0, pz0, surfHere, onDeck, myR, myBot, myTop) {
    const dx = this.pos.x - px0, dz = this.pos.z - pz0;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-4) return;                          // 幾乎沒位移 → 交給 push-out
    const len = Math.sqrt(len2);
    const SKIN = 0.3;                                 // 停在前緣再退一截,免貼面
    let bestT = Infinity;
    for (const b of this.terrain.blockers || []) {
      if (onDeck && b.y < surfHere - 3) continue;
      if (myBot >= b.y + b.h - 0.1 || myTop < b.y) continue;
      let tEnter = null;
      // 終點在障礙「內」時的取捨(fwd = (P1−中心)·位移):近半(fwd≤0)push-out 沿中心→P1 反向推 =
      // 退回進入側 → 交給 push-out 沿牆滑(手感不變);遠半(fwd>0)push-out 會把機體推出「另一側」
      // = 半穿透,故此處夾在進入面。終點在外(fwd 恆 >0 的真穿越)一律夾。
      const fwd = (this.pos.x - b.x) * dx + (this.pos.z - b.z) * dz;
      if (b.hw2 != null) {
        const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
        const ex = b.hw2 + myR, ez = b.hd2 + myR;
        const o0x = (px0 - b.x) * cs + (pz0 - b.z) * sn, o0z = -(px0 - b.x) * sn + (pz0 - b.z) * cs;
        if (Math.abs(o0x) < ex && Math.abs(o0z) < ez) continue;    // P0 已在盒內 → push-out 脫出
        const p1x = (this.pos.x - b.x) * cs + (this.pos.z - b.z) * sn;
        const p1z = -(this.pos.x - b.x) * sn + (this.pos.z - b.z) * cs;
        if (Math.abs(p1x) < ex && Math.abs(p1z) < ez && fwd <= 0) continue;   // 終點在盒內近半 → push-out 沿牆滑
        const ux = dx * cs + dz * sn, uz = -dx * sn + dz * cs;     // 位移轉盒 local
        let tmin = -Infinity, tmax = Infinity, ok = true;
        for (const [o, u, e] of [[o0x, ux, ex], [o0z, uz, ez]]) {
          if (Math.abs(u) < 1e-9) { if (o < -e || o > e) { ok = false; break; } continue; }
          let t1 = (-e - o) / u, t2 = (e - o) / u; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        }
        if (ok && tmax >= tmin && tmin > 0 && tmin <= 1) tEnter = tmin;
      } else {
        const R = b.r + myR;                          // 圓柱:2D 射線 × 圓(半徑外擴機體)
        const ox = px0 - b.x, oz = pz0 - b.z;
        if (ox * ox + oz * oz <= R * R) continue;     // P0 已在圓內 → push-out 脫出
        const e1x = this.pos.x - b.x, e1z = this.pos.z - b.z;
        if (e1x * e1x + e1z * e1z <= R * R && fwd <= 0) continue;  // 終點在圓內近半 → push-out 沿牆滑
        const c = ox * ox + oz * oz - R * R;
        const B2 = 2 * (ox * dx + oz * dz);
        const disc = B2 * B2 - 4 * len2 * c;
        if (disc < 0) continue;
        const t0 = (-B2 - Math.sqrt(disc)) / (2 * len2);
        if (t0 > 0 && t0 <= 1) tEnter = t0;
      }
      if (tEnter != null && tEnter < bestT) bestT = tEnter;
    }
    if (bestT === Infinity) return;                    // 無穿越
    const t = Math.max(0, bestT - SKIN / len);         // 夾在前緣(留 skin,不越回 P0 之前)
    this.pos.x = px0 + dx * t;
    this.pos.z = pz0 + dz * t;
    const ux = dx / len, uz = dz / len;                // 吃掉沿位移方向(正面撞牆)的速度
    const into = this.vel.x * ux + this.vel.z * uz;
    if (into > 0) { this.vel.x -= into * ux; this.vel.z -= into * uz; }
  }

  /**
   * 相機防穿模(純視覺,不動 pos/vel/權威狀態):第一人稱鏡頭掛在機體「頭艙」= pos 前方 headF 處,
   * _collide 只把 pos 擋在障礙圓柱外,鏡頭仍會戳進建物/神木/巨岩等障礙內看穿牆面(破圖)。
   * 此處沿「pos→鏡頭」水平軸把鏡頭拉回柱體外緣(留 SKIN 餘裕,絕不拉到 pos 後方 → pos 已被 _collide
   * 擋在 myR 外,退回 pos 必在牆外)。與 _collide 用同一份 blockers/colliders,牆面判定一致。
   */
  _cameraDeClip() {
    const cam = this.camera.position;
    const ox = this.pos.x, oz = this.pos.z, camY = cam.y;
    const dx = cam.x - ox, dz = cam.z - oz;
    const dlen = Math.hypot(dx, dz);
    if (dlen < 1e-3) return;
    const ux = dx / dlen, uz = dz / dlen;
    const SKIN = 0.9;                       // near(0.5)+餘裕:障礙外緣再退一截,免貼面破圖
    let maxT = dlen;                        // 鏡頭相對 pos 的前伸量上限(不超過原本 headF 水平量)
    // 射線 P(t)=pos+t·u 進入圓柱(半徑 R,水平圓)的最小 t(較小根);pos 在柱內 → 縮回 pos(t=0)
    const clamp = (cx, cz, cr) => {
      const R = cr + SKIN;
      const ex = ox - cx, ez = oz - cz;
      const proj = ex * ux + ez * uz;
      const c = ex * ex + ez * ez - R * R;
      if (c <= 0) { maxT = 0; return; }      // pos 已在柱內(理論上不會)
      const disc = proj * proj - c;
      if (disc <= 0) return;                 // 射線不進柱體
      const t = -proj - Math.sqrt(disc);
      if (t > 0 && t < maxT) maxT = t;
    };
    // 有向盒版(建物):射線在盒 local frame 走 slab 求進入 t(盒外擴 SKIN);pos 已在盒內 → 縮回 pos
    const clampBox = (b) => {
      const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
      const olx = (ox - b.x) * cs + (oz - b.z) * sn, olz = -(ox - b.x) * sn + (oz - b.z) * cs;
      const ulx = ux * cs + uz * sn, ulz = -ux * sn + uz * cs;
      const ex = b.hw2 + SKIN, ez = b.hd2 + SKIN;
      if (Math.abs(olx) < ex && Math.abs(olz) < ez) { maxT = 0; return; }
      let tmin = -Infinity, tmax = Infinity;
      const axes = [[olx, ulx, ex], [olz, ulz, ez]];
      for (const [o, d, e] of axes) {
        if (Math.abs(d) < 1e-9) { if (o < -e || o > e) return; continue; }   // 平行且在板外 → 不相交
        let t1 = (-e - o) / d, t2 = (e - o) / d; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      }
      if (tmax < tmin || tmax < 0) return;   // 射線不進盒體(或盒在後方)
      const t = tmin > 0 ? tmin : 0;
      if (t < maxT) maxT = t;
    };
    const onDeck = this._onDeck, surfHere = this._surfHere ?? this._surf(ox, oz, this.pos.y);
    for (const b of this.terrain.blockers || []) {
      if (onDeck && b.y < surfHere - 3) continue;                       // 站橋面上:橋下街廓不處理(高架飛越)
      if (camY < b.y || camY > b.y + b.h) continue;                     // 垂直不重疊
      // broad-phase 半徑 MUST 用**外接**(對角 hypot)非 max(內切):貼牆角時 pos 在盒對角外緣,
      // 用 max 會誤判「太遠」而跳過 → 牆面過(pos 近盒面)但牆角漏(前科:撞牆角仍破圖)
      const rr = b.hw2 != null ? Math.hypot(b.hw2, b.hd2) : b.r;
      if (Math.hypot(ox - b.x, oz - b.z) > dlen + rr + SKIN + 1) continue;  // broad-phase:太遠不可能戳到
      if (b.hw2 != null) clampBox(b); else clamp(b.x, b.z, b.r);
      if (maxT <= 0) break;
    }
    if (maxT > 0) for (const ent of this.ents.values()) {
      if (!ent.colR || ent.isSelf) continue;                            // 阻擋型障礙(危險區/防空/中繼)
      const p = ent.mesh.position, ch = ent.colH || 6;
      if (camY < p.y || camY > p.y + ch) continue;
      if (Math.hypot(ox - p.x, oz - p.z) > dlen + ent.colR + SKIN + 1) continue;
      clamp(p.x, p.z, ent.colR);
      if (maxT <= 0) break;
    }
    if (maxT < dlen) { cam.x = ox + ux * maxT; cam.z = oz + uz * maxT; }
  }

  // ---------------- 輸入 ----------------
  _initInput() {
    this._onKey = (e) => {
      if (this.paused) return;   // 戰場選單開啟:凍結所有輸入(keys 已清空 ⇒ 機體停住)
      if (e.type === 'keydown' && e.code === 'KeyM') this.minimapBig = !this.minimapBig;
      if (e.type === 'keydown' && this.side) {
        // 商店不受死亡限制:陣亡等待重生也能買升級(DOTA 慣例)
        if (e.code === 'KeyB') this._toggleShop();
        if (e.code === 'Escape' && this.shopOpen) this._toggleShop(false);
        // 陣亡重生倒數中:ESC 叫出戰場選單(離開/繼續)。此時指標已解鎖 → pointerlockchange 不再觸發,
        // 故直接綁 keydown(正常交戰時 ESC 被指標鎖定吞掉,走 _onPlc;陣亡例外走這條)。
        else if (e.code === 'Escape' && this.dead && !this._gameOver) this._setPaused(true);
        if (!this.dead) {
          if (e.code === 'KeyQ') this._castAbility('skill');   // 小招
          if (e.code === 'KeyE') this._castAbility('ult');     // 大招
          if (e.code === 'KeyR') this._startReload();
          // 機種專屬能力(無人機護衛自殺機 / 非變形機甲重砲 / 變形機甲餌機)改「狙擊模式長按右鍵」觸發
          // (見 _tickSnipeAbility);F 鍵停用(2026-07-18)
          // 平民互動(靠近平民時 HUD 顯示提示):G 要求跟隨 / H 驅趕
          if (e.code === 'KeyG') this._civAct('follow');
          if (e.code === 'KeyH') this._civAct('away');
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
        // 右鍵按住起算:達門檻 → 狙擊模式專屬招(見 _tickSnipeAbility);短按放開 → 切換模式(見 _onMouseUp)。
        // 切換與出招以「按住時長」區分,互不衝突。
        this._rmbDownAt = performance.now() / 1000;
        this._rmbAbilityFired = false;
      }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) {
        const pressed = this._rmbDownAt > 0, fired = this._rmbAbilityFired;
        this._rmbDownAt = 0; this._rmbAbilityFired = false;
        if (!pressed || fired) return;   // 未真正按下(指標未鎖)或長按已出招 → 不切換模式
        // 短按放開 = 切換一般 ⇄ 狙擊模式(未瞄準且當前武器打空 → 改換彈夾,保留原快捷)
        const { id, st } = this._curWeapon();
        if (!this.aiming && st && st.ammo <= 0 && st.reloadEnd <= 0) this._startReload(id);
        else this._setAiming(!this.aiming);
      }
    };
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this._onCtx = (e) => e.preventDefault();
    this.canvas.addEventListener('contextmenu', this._onCtx);

    // 戰場選單:指標鎖定 = 交戰;解鎖(ESC / 切走視窗)= 跳出暫停選單(繼續 / 離開)。
    // 用 pointerlockchange 而非 ESC keydown —— 指標鎖定時瀏覽器會吃掉那顆 ESC 的 keydown。
    this._onPlc = () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) {
        this._everLocked = true;
        if (this.paused) this._setPaused(false);
      } else if (this._everLocked && !this.shopOpen && !this._gameOver && !this.paused && !this.dead) {
        // 陣亡不跳戰場選單(離開詢問):改顯示陣亡頁(重生倒數 + 砲塔視窗),見 _onSelfDeath
        this._setPaused(true);
      }
    };
    document.addEventListener('pointerlockchange', this._onPlc);
  }

  /** 戰場選單開關;伺服器持續模擬(多人不是真暫停),此處只凍結本機輸入 + 叫出選單 */
  _setPaused(on) {
    if (!this.side || this._gameOver) return;
    this.paused = on;
    if (on) {
      this.keys = {}; this.firing = false;
      this.hud.pause?.(true);
      document.exitPointerLock?.();
    } else {
      this.hud.pause?.(false);
      // 陣亡倒數中「繼續」= 回到陣亡頁(不需鎖定指標);存活時才重新鎖定進入交戰
      if (!this.dead) this.canvas?.requestPointerLock?.();
    }
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
      // 第三方步槍兵駐守碉堡:人在工事裡,機體隱藏(出堡的快照會把 gar 拿掉 → 復現)
      if (!ent.hero && !ent.decoy && !ent.isStatic) { ent.gar = !!e.gar; ent.mesh.visible = !e.gar; if (ent.aura) ent.aura.visible = ent.mesh.visible; }
      if (e.k === 'decoy') {
        ent.heroY = e.y ?? 0;
        ent.ry = e.ry ?? 0;
        ent.lost = !!e.lost;
      }
      if (e.k === 'kami') { ent.heroY = e.y ?? 0; ent.ry = e.ry ?? 0; }
      if (e.k === 'civilian') { ent.fo = !!e.fo; ent.fl = !!e.fl; }   // 跟隨/逃離旗標(頭頂提示)
      // 第三方碉堡進視野 = 情報永久留存:記位置(量化去重),小地圖離開視野後仍標示。
      // MUST 存 three 世界座標(z = −e.z);_world2mm 與其他標記(ent.mesh.position / this.pos)同框,
      // 舊版直接存 sim 的 e.z 未翻軸 → 標記畫在 Z 鏡像位置(看似「離開後就不見」)。
      if (e.k === 'bunker') { const bz = -e.z; this._seenBunkers.set(`${Math.round(e.x)},${Math.round(bz)}`, { x: e.x, z: bz, side: e.s }); }
      if (HERO_KINDS.has(e.k)) {
        ent.heroY = e.y ?? 0;
        ent.ry = e.ry ?? 0;
        ent.si = e.si || 0;
        ent.kcd = e.kcd;   // 無人機護衛自殺機冷卻(其他客戶端據此顯隱貼身護衛機;非無人機為 undefined)
        ent.sp = e.sp ?? 0; ent.maxSp = e.msp ?? 0;   // 護盾(血條玻璃藍段;所有英雄機體都送)
        const wasDead = ent.dead;
        ent.dead = !!e.dead;
        // 三機小隊:主視野由伺服器指定(e.act);換機時整個座機狀態接管過去
        if (e.pid === this.youId && !!e.act !== ent.isSelf) this._takeOver(ent, e);
        if (wasDead && !e.dead && !ent.isSelf) ent._snapPos = true;
        ent.mesh.visible = !e.dead && !ent.isSelf;
        if (e.dc != null) ent.dock = !!e.dc;   // 餌機掛點:已組合就緒(組合/分離動畫)
        if (ent.isSelf) {
          this.decoyCd = e.dcd ?? 0;
          this.decoyDocked = !!e.dc;
          this.kamiCd = e.kcd ?? 0;   // 無人機護衛自殺機冷卻(HUD;歸零 = 兩架重現)
          this.barrageCd = e.bcd ?? 0;   // 非變形機甲重砲模式冷卻(HUD)

          this.hp = e.hp; this.maxHp = e.m;
          this.sp = e.sp ?? this.sp; this.maxSp = e.msp ?? this.maxSp;
          // 受傷暈影:自機總量(裝甲+護盾)較上一快照下降 = 被擊 → 閃紅暈影;
          // 重生/補血的上升不觸發;換主視野(_takeOver 清 _prevVital)不誤觸
          const vital = this.hp + this.sp;
          if (this._prevVital != null && vital < this._prevVital - 0.5 && !e.dead) {
            this.hud.hurt?.();
            this._lastHurtAt = performance.now() / 1000;   // 被攻擊時戳(無人機完美迴避的戰鬥狀態判定)
          }
          this._prevVital = vital;
          this.mp = e.mp ?? this.mp; this.maxMp = e.mm ?? this.maxMp;
          this.money = e.$ ?? this.money;
          this.upg = e.up || this.upg;
          this.kn = e.kn ?? this.kn;
          this.cds = e.cds || this.cds;
          this.empLeft = e.emp || 0;
          this.stealthLeft = e.st || 0;
          // 控場/追加效果狀態(伺服器權威剩餘秒;條件欄位缺省 = 已結束)
          this.stunLeft = e.pz || 0;
          this.slowLeft = e.sl || 0;
          this.slowF = e.slf ?? 0.6;
          this.confLeft = e.cf || 0;
          this.markLeft = e.mk || 0;
          this.bleedLeft = e.bl || 0;
          this.invLeft = e.iv || 0;
          this.selfMods = e.md || [];   // 招式增益 [k, m, remS](speed/jump 由客戶端物理消費)
          this._ccFeed();
          // 角色 / 招式階級同步(伺服器權威;升階 → 重算武器數值並滿彈夾)
          if (e.ch && e.ch !== this.ch) this._setChar(e.ch);
          if (e.ab) {
            const changed = ['light', 'heavy'].some((s) => e.ab[s] !== this.abil[s]);
            this.abil = { ...e.ab };
            if (changed) this._setChar(this.ch, true);
          }
          if (e.dead && !this.dead) this._onSelfDeath();
          if (!e.dead && this.dead) this._onSelfRespawn();
          // 過場播放中壓住倒數頁(#deadOverlay/砲塔 PiP),過場結束(_deathSeq=null)下一快照才顯示;
          // 開著戰場選單(this.paused)時亦壓住倒數頁 → 讓離開/繼續選單獨佔畫面(ESC 開的離開頁)
          this.hud.dead?.(e.dead && !this._deathSeq && !this.paused ? e.rs : null);
          // 商店只在數值變動時重繪(2026-07-17):每 8Hz 全量重建 DOM 會在點擊瞬間銷毀按鈕 →
          // 掉點擊(「沒辦法馬上購買」)。以 money/擊殺/升級/角色/階級簽章 gate,idle 時完全不重繪。
          if (this.shopOpen) {
            const u = this.upg;
            const sig = `${Math.floor(this.money)}|${this.kn}|${this.ch}|${this.abil.light}.${this.abil.heavy}.${this.abil.skill}.${this.abil.ult}|`
              + ['lw', 'hw', 'sk', 'ult', 'hp', 'ar', 'sp', 'ch'].map((k) => u[k] || 0).join(',');
            if (sig !== this._shopSig) { this._shopSig = sig; this.hud.shop?.(true, this._shopState()); }
          }
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
    // 空投物資(非兵線隨機空投,降落傘飄降後靠近拾取)
    this._syncAirdrop(m.ad || []);

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
    if (m.over) { this._gameOver = true; this._deathSeq = null; this.hud.deathCine?.(false); this.hud.over?.(m.winner, m.stats); }
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
      const czw = -e.z, cyw = this._surf(e.x, czw, this.terrain.heightAt(e.x, czw));
      group.position.set(e.x, cyw, czw);
      // 淹水/坑洞:水面是寬平盤,單一中心高度會在斜坡上飄空、在橋面下沉 —— 逐頂點貼地
      if (e.k === 'flood' || e.k === 'pothole') this._conformWater(group, e.x, czw, cyw);
      if (group.userData.flames) this.flamers.add(group);
      if (e.k === 'flood') this.floods.push({ x: e.x, z: -e.z, r, slow: hazDef.slow });
      if (e.k === 'fire') this.fires.push({ x: e.x, z: -e.z, r });   // 火場滯留霧化判定
      this.ents.set(e.id, ent);
      return ent;
    }
    // 覆蓋:此處回退,續建一般單位
    return this._spawnUnit(e);
  }

  /**
   * 淹水/坑洞水面貼地:平放水盤 + 漂浮雜物本來全掛在「群心單一高度」,斜坡上整塊飄空、
   * 橋面下沉。改為:寬水盤重建成三角扇逐頂點貼地(緊貼地貌),漣漪圈/雜物各自依所在地表升降。
   * 一次性(危險區靜止),用 _surf 走橋面 ∪ 地形的統一貼地縫。
   */
  _conformWater(group, cx, cz, cy) {
    const surf = (x, z) => this._surf(x, z, this.terrain.heightAt(x, z));
    for (const o of group.children) {
      if (o.userData?.water && o.geometry?.parameters) {
        const p = o.geometry.parameters;
        const rad = p.radiusTop ?? p.radius ?? 6;
        const off = o.position.y || 0;   // 保留原水面相對地面的高差(flood +0.32 站水 / pothole −0.05 積水)
        const N = 28;
        const pos = [0, surf(cx, cz) - cy + off, 0], idx = [];
        for (let i = 0; i < N; i++) {
          const a = i / N * Math.PI * 2, dx = Math.cos(a) * rad, dz = Math.sin(a) * rad;
          pos.push(dx, surf(cx + dx, cz + dz) - cy + off, dz);
        }
        for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + (i + 1) % N);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        o.geometry.dispose();
        o.geometry = geo;
        o.position.set(0, 0, 0);
        o.rotation.set(0, 0, 0);
      } else {
        // 漣漪圈 / 漂浮雜物:依所在地表升降,跟著坡度走(不再全部平放在群心高度)
        o.position.y += surf(cx + o.position.x, cz + o.position.z) - cy;
      }
    }
  }

  _spawnUnit(e) {
    const civ = e.k === 'civilian';
    const key = e.k === 'base' ? `base:${e.s}` : civ ? 'civ' : KIND_KEY[e.k];
    // 平民:陣營看 cs(伺服器 side=null,讓兩陣營都能開槍),ch = 職業 index(選 buildCivilian 變體)
    // 餌機:不畫陣營光環(它是一枚飛行中的彈體,不是站在地上的單位)
    const { group, mixer } = makeUnit(key, civ ? e.cs : e.s, { ch: civ ? e.pf : e.ch, ring: e.k !== 'decoy' && e.k !== 'kami' });
    if (e.k === 'kami') group.scale.setScalar(SQUAD.KAMI.SIZE_F);   // 護衛自殺機衝出:SIZE_F(1/2)體型
    const hero = HERO_KINDS.has(e.k);
    // 三機小隊:只有主視野那架(e.act)才是「自己」,另外兩架當一般友軍渲染
    const isSelf = hero && e.pid != null && e.pid === this.youId && !!e.act;
    if (isSelf) group.visible = false;
    this.scene.add(group);
    if (mixer) this.mixers.add(mixer);
    if (group.userData.spin) this.spinners.add(group);
    // 基準包圍盒:MUST 在掛護盾殼/血條/敵方標記之前量(它們都是 mesh 子節點,事後 Box3 會被
    // 撐大 —— 塔的護盾殼半徑 11m,曾把鎖定光暈吹成 49m 巨球、血條抬到半空)。
    // 貼地陣營光環(teamRing,塔的圈 r≈14)同樣排除:光暈/血條要包的是機體本體。
    const bb = new THREE.Box3();
    const bbT = new THREE.Box3();
    group.updateWorldMatrix(true, true);
    group.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.userData.teamRing) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      bbT.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      bb.union(bbT);
    });
    const ent = {
      dimTop: bb.max.y, dimH: bb.max.y - bb.min.y,
      dimR: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2,
      id: e.id, kind: e.k, side: e.s, mesh: group, mixer, ch: e.ch, pid: e.pid ?? null,
      tgt: new THREE.Vector3(e.x, 0, -e.z), hp: e.hp, max: e.m,
      isSelf, hero, heroY: 0, ry: 0, flies: e.k === 'heli' || e.k === 'decoy' || e.k === 'kami',
      decoy: e.k === 'decoy', kami: e.k === 'kami', si: e.si || 0,
      isStatic: e.k === 'tower' || e.k === 'base' || e.k === 'bunker',
      // 英雄機體:碰撞圓柱綁角色體型(高防禦=巨大=難閃避),不吃 COLLIDER 表
      heroCol: hero ? heroCollider(e.k, e.ch) : null,
    };
    // 平民/間諜:side 保持 null(兩陣營皆可開槍),陣營記在 cs 供頭頂箭頭;neutral = 不進準星敵人推測
    if (e.k === 'civilian') { ent.civ = true; ent.cs = e.cs; ent.prof = e.pf; ent.neutral = true; ent.fo = !!e.fo; ent.fl = !!e.fl; }
    // 防禦塔 / 主堡:動漫能量護盾(平時近透明,受擊亮起 hex 格紋)
    if (e.k === 'tower' || e.k === 'base') {
      const shield = makeShield(e.k === 'base' ? 30 : 11, SIDES[e.s].color, e.k === 'base' ? 1.5 : 2.3);
      group.add(shield);
      ent.shield = shield;
      this.shields.add(shield);
    }
    // 橋上砲塔:蓋在橋面墩座台上(biomes buildTowerBridgePads 定案;查無 = 一般貼地塔)
    if (e.k === 'tower') ent.padY = this.terrain.towerPadY?.(e.x, -e.z) ?? null;
    group.position.set(e.x, ent.padY ?? this.terrain.heightAt(e.x, -e.z), -e.z);
    if (e.k === 'base') { this._addHealAura(ent, e); this._addBaseGuns(ent, e); }
    else if (isThirdSide(e.s)) this._addRangeRing(ent, e);   // 第三方(GUER/MILI)戰鬥單位與碉堡:貼地射程光暈
    if (e.k === 'bunker') this._clearAroundBunker(e);        // 碉堡淨空:移除重疊建物 + 清同區碰撞柱
    // 無人機:兩架常駐護衛自殺機(純外觀,貼身跟隨;觸發前不可鎖定/受傷 = 不進 sim)。自機 FPV 看不到自身,略過。
    if (e.k === 'drone' && !isSelf) this._buildDroneEscorts(ent);
    this.ents.set(e.id, ent);
    return ent;
  }

  /** 無人機兩架常駐護衛自殺機(純客戶端外觀:外觀同主機、SIZE_F 體型、貼身兩側)。
   *  觸發前不是 sim 實體(不可鎖定/受傷);狙擊長按右鍵衝出時交給 sim 的 kami 實體渲染,
   *  自爆後 kamiCd 歸零才重現(見 _updateEscorts 的顯隱判定)。 */
  _buildDroneEscorts(ent) {
    ent.escorts = [];
    for (let i = 0; i < SQUAD.KAMI.N; i++) {
      const { group } = makeUnit('hero:drone', ent.side, { ch: ent.ch, ring: false });
      group.scale.setScalar(SQUAD.KAMI.SIZE_F);
      group.visible = false;
      this.scene.add(group);
      if (group.userData.spin) this.spinners.add(group);
      ent.escorts.push({ mesh: group, s: i === 0 ? -1 : 1 });   // 左 / 右
    }
  }

  /** 每幀擺放護衛機於主機兩側(隨主機朝向);kami 冷卻中(已衝出/未重現)或主機不可見則隱藏 */
  _updateEscorts(ent) {
    const ready = ent.mesh.visible && (ent.kcd || 0) <= 0.05;
    const yaw = ent.mesh.rotation.y, cx = Math.cos(yaw), sx = Math.sin(yaw);
    const p = ent.mesh.position, off = 3.5, back = -1.0;
    for (const es of ent.escorts) {
      es.mesh.visible = ready;
      if (!ready) continue;
      es.mesh.position.set(p.x + cx * off * es.s + sx * back, p.y, p.z - sx * off * es.s + cx * back);
      es.mesh.rotation.y = yaw;
    }
  }

  // 碉堡淨空:碉堡進場時移除與其重疊的客戶端建物/地標(視覺 + 碰撞柱一併,由 clearAround 內部同判定處理,
  // 只動建物/地標、不動植被/巨岩/橋墩 —— A6 砲火/碰撞與視覺一致)。讓碉堡不半插樓體、周圍留出駐守/重生空間。
  // clearAround 有動碰撞柱時回 true → 重建 _blockGrid。以四捨五入位置去重,避免重進視野/重生時重複全掃。
  _clearAroundBunker(e) {
    const wx = e.x, wz = -e.z, R = THIRD.BLD_CLEAR_R;
    const key = `${Math.round(wx)},${Math.round(wz)}`;
    (this._bldCleared ??= new Set());
    if (this._bldCleared.has(key)) return;
    this._bldCleared.add(key);
    const removed = this.terrain.clearBuildingsAround?.(wx, wz, R);
    if (removed) {
      this._blockGrid = this._buildBlockGrid(this.terrain.blockers || []);   // 碰撞柱與視覺一致(A6)
      this.terrain.rebuildBlockerTops?.();   // 頂面站立索引同步重建(拆掉的樓不留幽靈站立面)
    }
  }

  // 主堡治癒光環:標出 HERO_HEAL_R 範圍(貼地環,陣營色,緩慢脈動)
  _addHealAura(ent, e) {
    const R = GAME.HERO_HEAL_R;
    const wx = e.x, wz = -e.z, y = this.terrain.heightAt(wx, wz) + 0.6;
    const col = SIDES[e.s].color;
    const g = new THREE.Group();
    g.position.set(wx, y, wz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    g.add(disc); g.add(ring);
    g.renderOrder = 2;
    this.scene.add(g);
    ent.aura = g; ent.auraRing = ring;
    (this._auras ??= []).push(ent);
  }

  // 第三方(GUER/MILI)射程範圍光暈:貼地環 + 極淡填色,陣營識別色,緩慢脈動(共用 base 補血光環的
  // ent.aura/_auras 機制 ⇒ 移除清理(_removeEnt)與脈動(update:_auras 迴圈)免額外接線)。
  // 半徑取自 data.js 射程唯一真相(MUST NOT 手寫/量 bbox):戰鬥單位 = UNITS[kind].range;
  // 碉堡本身 range 0 ⇒ 取駐守步槍兵實際火力半徑 = soldier.range × THIRD.GAR_RANGE_F。
  _addRangeRing(ent, e) {
    const R = e.k === 'bunker' ? UNITS.soldier.range * THIRD.GAR_RANGE_F : (UNITS[e.k]?.range || 0);
    if (R <= 0) return;   // 寧缺勿錯:無射程不畫(bunker.range=0 走上面 derive)
    const wx = e.x, wz = -e.z, y = this.terrain.heightAt(wx, wz) + 0.6;
    const col = sideInfo(e.s).color;   // GUER 綠 / MILI 橙紅;MUST NOT 用 SIDES[e.s](第三方不在表內 → undefined)
    const g = new THREE.Group();
    g.position.set(wx, y, wz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.96, R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 64),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    g.add(disc); g.add(ring);
    g.renderOrder = 2;
    this.scene.add(g);
    ent.aura = g; ent.auraRing = ring;
    (this._auras ??= []).push(ent);
  }

  // 主堡兩門大砲(視覺):砲管朝敵方主堡,伺服器 _tickBaseGuns 開火時走既有 shot 曳光
  _addBaseGuns(ent, e) {
    const wx = e.x, wz = -e.z;
    const box = new THREE.Box3().setFromObject(ent.mesh);
    const bh = box.max.y - box.min.y;
    const foe = e.s === 'SWARM' ? 'STEEL' : 'SWARM';
    const eb = this.cfg.bases?.[foe];
    let dirX = 0, dirZ = 1;
    if (eb) { const [ex, ez] = llToWorld(eb[0], eb[1], this.center); dirX = ex - wx; dirZ = ez - wz; }
    const g = new THREE.Group();
    g.position.set(wx, box.min.y + bh * 0.58, wz);
    g.rotation.y = Math.atan2(dirX, dirZ);   // 本地 +z = 朝敵方
    const barrelGeo = new THREE.CylinderGeometry(1.1, 1.4, 16, 12).rotateX(Math.PI / 2).translate(0, 0, 8);
    const mountGeo = new THREE.BoxGeometry(4, 4, 5);
    const barMat = toonMat(0x2e343c, { celMetal: true });
    const mntMat = toonMat(0x3a4048, { celMetal: true });
    ent.gunPivots = [];    // 每門砲的 yaw 樞軸(_aimBaseGuns 轉向攻擊目標)
    ent.gunMuzzles = [];   // 砲口節點(shot 事件曳光起點;gi 對應 sim _tickBaseGuns 的砲序)
    for (const sx of [10, -10]) {
      const c = new THREE.Group();
      c.position.set(sx, 0, 6);
      const mount = new THREE.Mesh(mountGeo, mntMat);
      const barrel = new THREE.Mesh(barrelGeo, barMat);
      barrel.rotation.x = -0.14;   // 略微仰角
      c.userData.barrel = barrel;  // 後座上撇用(_aimBaseGuns)
      const mz = new THREE.Group();
      mz.position.set(0, 0, 15.6);
      barrel.add(mz);
      c.add(mount); c.add(barrel);
      g.add(c);
      ent.gunPivots.push(c);
      ent.gunMuzzles.push(mz);
    }
    outlinify(g);
    this.scene.add(g);
    ent.guns = g;
  }

  _removeEnt(id, ent) {
    if (this._lockId === id) this._clearLockGlow();   // 光暈是目標 mesh 的子節點,別留下懸空參照
    this.scene.remove(ent.mesh);
    if (ent.aura) { this.scene.remove(ent.aura); this._auras = (this._auras || []).filter((x) => x !== ent); }
    if (ent.guns) this.scene.remove(ent.guns);
    if (ent.mixer) this.mixers.delete(ent.mixer);
    if (ent.shield) this.shields.delete(ent.shield);
    this.spinners.delete(ent.mesh);
    this.flamers.delete(ent.mesh);
    if (ent.escorts) for (const es of ent.escorts) { this.scene.remove(es.mesh); this.spinners.delete(es.mesh); }
    this.ents.delete(id);
  }

  // 血條:HP 用紅色標示現有值,護盾(英雄雙層 HP 第一層)用玻璃藍疊在上方一列
  _updateHpBar(ent) {
    if (ent.isSelf) return;
    const frac = Math.max(0, ent.hp / ent.max);
    const maxSp = ent.maxSp || 0;
    const sfrac = maxSp > 0 ? Math.max(0, (ent.sp || 0) / maxSp) : 0;
    if (frac >= 1 && (maxSp <= 0 || sfrac >= 1) && !ent.bar) return;   // 滿血且護盾滿(或無護盾)→ 不建條
    if (!ent.bar) {
      const w = ent.isStatic ? 18 : 5, hh = w * 0.09;
      const M = hh * 0.26;                      // 框邊寬
      const hasSp = maxSp > 0;
      const shY = hh * 1.55;                     // 護盾列的高度(與 HP 列間留間隔)
      // 全部走 transparent + 顯式 renderOrder(z 疊序直翻繪製順序):框→槽→填色→刻痕的
      // 分層不再賭 three 的排序細節,紅 HP / 玻璃藍護盾在任何角度都壓在框與底槽之上。
      const plane = (color, opacity, z, pw = w, ph = hh) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
        m.position.z = z;
        m.renderOrder = 990 + Math.round(z * 100);
        return m;
      };
      const grp = new THREE.Group();
      // 外框:雙層描邊(暗外緣 + 金屬灰內緣)罩住整組,擺脫舊版單調的裸長條
      const stackH = hasSp ? shY + hh : hh, cy = hasSp ? shY / 2 : 0;
      const frame = plane(0x05070a, 0.94, -0.03, w + M * 2.4, stackH + M * 2.4); frame.position.y = cy;
      const inner = plane(0x39424c, 0.95, -0.02, w + M, stackH + M);            inner.position.y = cy;
      grp.add(frame); grp.add(inner);
      grp.add(plane(0x111417, 1, 0));            // HP 底槽
      const fg = plane(0xe23b34, 1, 0.02);       // 現有 HP:紅
      grp.add(fg);
      // 分段刻痕(間隔):固定不隨血量縮放的暗線,把長條切成數格 → 一眼判讀血量段位
      const segN = ent.isStatic ? 10 : 5, tickW = Math.max(0.05, w * 0.014);
      const ticks = (y, col) => {
        for (let s = 1; s < segN; s++) {
          const tk = plane(col, 0.95, 0.05, tickW, hh);
          tk.position.set(-w / 2 + (w / segN) * s, y, 0); grp.add(tk);
        }
      };
      ticks(0, 0x111417);
      let sfg = null;
      if (hasSp) {                               // 護盾:玻璃藍,獨立一列並與 HP 列留間隔
        const sbg = plane(0x0a1723, 0.85, 0.01); sbg.position.y = shY;
        sfg = plane(0x7fd4ff, 0.95, 0.03);       sfg.position.y = shY;
        grp.add(sbg); grp.add(sfg);
        ticks(shY, 0x0a1723);
      }
      // 靜態建築(砲塔/主堡)的血條貼著頂端(剛好在上方,不再高高浮起);單位維持 2.2 抬高。
      // 高度用 spawn 時的基準包圍盒(dimTop)—— 事後的 Box3 會把護盾殼/敵方標記一起量進去。
      const top = ent.dimTop ?? (() => {
        const box = new THREE.Box3().setFromObject(ent.mesh);
        return box.max.y - box.min.y;
      })();
      grp.position.y = top + (ent.isStatic ? 1.4 : 2.2);
      ent.mesh.add(grp);
      ent.bar = grp; ent.barFg = fg; ent.barSfg = sfg; ent.barW = w;
    }
    ent.barFg.scale.x = Math.max(0.001, frac);
    ent.barFg.position.x = -(1 - frac) * ent.barW / 2;
    if (ent.barSfg) {
      ent.barSfg.scale.x = Math.max(0.001, sfrac);
      ent.barSfg.position.x = -(1 - sfrac) * ent.barW / 2;
      ent.barSfg.visible = sfrac > 0;
    }
  }

  /**
   * 敵方標示:目標一進視野(= 出現在快照裡)就在頭上掛陣營箭頭,淡入 + 上下浮沉。
   * depthTest 關掉 = 被掩體擋住仍看得到標記(標的已被己方偵知);離開視野時 ent 被移除,
   * 標記是 mesh 的子節點 → 自動消失。
   */
  _enemyMark(ent, dt, now) {
    if (!ent.mark) {
      // 基準包圍盒(排除護盾殼/血條):否則塔的標記會疊在護盾殼頂上再 +3.4
      const h = Math.max(2, ent.dimH ?? (() => {
        const box = new THREE.Box3().setFromObject(ent.mesh);
        return box.max.y - box.min.y;
      })());
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: factionMarkTex(ent.side), transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      }));
      sp.scale.setScalar(Math.max(3.6, h * 0.75));
      sp.renderOrder = 998;
      ent.markY = (ent.dimTop ?? h) + 3.4 + sp.scale.y * 0.5;   // 讓開血條(頂端 + 2.2)
      ent.mesh.add(sp);
      ent.mark = sp;
    }
    const m = ent.mark.material;
    m.opacity = Math.min(0.92, m.opacity + dt * 3.5);                 // 進入視野:淡入
    ent.mark.position.y = ent.markY + Math.sin(now * 2.6) * 0.45;     // 浮沉
  }

  /** 快照裡的飛彈同步:建/移/更新目標點(渲染時再插值) */
  _syncMissiles(sm) {
    const seen = new Set();
    for (const s of sm) {
      seen.add(s.id);
      let ms = this.samMeshes.get(s.id);
      if (!ms) {
        // 彈藥同源(2026-07-22):塔射防空飛彈與英雄飛彈同一顆 projectileMesh(放大 1.55 = 舊 SAM 長度)
        const mesh = projectileMesh({ type: 'missile' }, { hue: 0xff6633 });
        mesh.scale.setScalar(1.55);
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

  _syncAirdrop(ad) {
    const seen = new Set();
    for (const a of ad) {
      seen.add(a.id);
      if (this.airdropMeshes.has(a.id)) continue;
      const g = buildAirdrop(a.s || 'S');
      const gy = this.terrain.heightAt(a.x, -a.z);
      g.position.set(a.x, gy, -a.z);
      // 首見即起飄降:d=1(尚未落地)從 DROP_H 高處下降;無 d 表示中途進場,直接落地
      g.userData.groundY = gy;
      g.userData.bornT = performance.now() / 1000;   // 與 _updateAirdrop 的 now 同時基
      g.userData.landing = !!a.d;
      this.scene.add(g);
      this.airdropMeshes.set(a.id, g);
    }
    for (const [id, g] of this.airdropMeshes) {
      if (!seen.has(id)) { this.scene.remove(g); this.airdropMeshes.delete(id); }
    }
  }

  _updateAirdrop(dt, now) {
    for (const g of this.airdropMeshes.values()) {
      const u = g.userData;
      const age = now - (u.bornT || now);
      const t = AIRDROP.LAND_S > 0 ? Math.min(1, age / AIRDROP.LAND_S) : 1;
      const landed = !u.landing || t >= 1;
      // 飄降:從 DROP_H 高處等速下降到地面(ease-out 收尾),落地後空投傘收起、改顯示地面攤開傘
      g.position.y = u.groundY + (u.landing ? AIRDROP.DROP_H * (1 - t) * (1 - t) : 0);
      if (u.chute) u.chute.visible = !landed;
      if (u.groundChute) u.groundChute.visible = landed;
      if (u.halo) u.halo.visible = landed;
      if (landed) {
        // 攤開傘/光柱是偏置的 → 整體不再旋轉(否則傘會繞著箱子公轉);只讓木箱自轉+起伏當拾取提示
        if (u.crate) {
          u.crate.rotation.y += dt * 0.6;
          u.crate.position.y = Math.sin(now * 2.0 + g.position.x) * 0.14;
        }
      } else {
        g.rotation.y += dt * 0.3;   // 飄降中整傘微轉
      }
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

  /** 淹水區:地面機體深水行進大幅減速(限制但不封鎖;飛行型態/騰空不受影響) */
  _zoneSlow() {
    if (this._flying() || this._env?.air) return 1;
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

  /**
   * 座艙眼位離機體底的高度(公尺)。唯一縫:_updatePlayer 末段的相機 eye 與 _envAt 的
   * 「視線高度 vs 觸發水平面」共用同一式 —— 蓄力下蹲(CROUCH_M)一併計入,所以蓄力時
   * 眼位真的會沉進水面/沼面,狀態判定與畫面一致。
   */
  _eyeH() {
    const vw = heroView(this.heroKind, this.ch, this._flying());
    return this.selfH * vw.e
      - (!this._flying() ? this.charge * (this.isMorph ? MORPH.CROUCH_M : CJUMP.CROUCH_M) : 0);
  }

  /**
   * 領機當幀環境。回傳 { code, depth, ground, air }:
   *  - ground:腳下地表分類(0 乾 / 1 水 / 2 沼,biomes.terrainEnvCode 同規則 WYSIWYG)——
   *    驅動「涉水/陷沼」移動減速,只看有沒有踩在水沼裡。
   *  - code:**地形異常狀態**(0/1/2)= ground 再過 data.envTrigger 的視線高度制門檻 ——
   *    驅動 wet 回報(伺服器凍結/扣血)、水下帷幕、沼澤滯留。淺灘/沼澤邊緣眼位在水平面之上
   *    ⇒ code 0,不再「踩到就凍結」。
   *  - air:騰空(跳躍/蓄力跳躍離地)—— 一律當乾地零狀態,即「跳躍期間不吃地面傷害」。
   * 飛行型態、站在橋面/結構物上(表面高於地形 >1.2m)同樣視為乾地。
   * 每幀 _updatePlayer 開頭算一次存 this._env;移動減速、pos 回報、火場霧化皆讀它。
   */
  _envAt() {
    const DRY = { code: 0, depth: 0, ground: 0, air: false };
    if (this._flying()) return DRY;
    const x = this.pos.x, z = this.pos.z;
    const s = this._surf(x, z, this.pos.y);
    const wy = this.terrain.waterY;
    // 站立面(深水的有效地板 = 水面 − FULL_D,與 _updatePlayer 的 gy 同式):離地即騰空
    const floor = wy != null ? Math.max(s, wy - WATER.FULL_D) : s;
    if (this.pos.y - floor > AIR.OFF_GROUND) return { ...DRY, air: true };
    if (s - this.terrain.heightAt(x, z) > 1.2) return DRY;   // 橋面/結構物 = 乾
    const ground = terrainEnvCode(this.terrain, x, z);
    const depth = ground === 1 && wy != null ? Math.max(0, wy - s) : 0;
    return { code: envTrigger(ground, wy, floor, this._eyeH()), depth, ground, air: false };
  }

  /**
   * 地形環境移動減速(2026-07-19;取代舊 _waterSlowF)。水域:速度隨深度線性內插
   * 1.0(岸邊)→ SLOW_MIN(全滅頂 FULL_D);沼澤:固定 SWAMP_SLOW。飛行型態不受影響。
   * 讀 ground(腳下地表)而非 code(異常狀態):**淺灘照樣涉水變慢**,只是不再觸發電子失效;
   * 騰空(air)時 ground 已為 0 ⇒ 跳躍期間無涉水阻力(與低重力滑行一致)。
   */
  _terrainSlowF() {
    const e = this._env;
    if (!e || e.ground === 0) return 1;
    if (e.ground === 2) {
      // 沼澤越陷越深:進場 SWAMP_SLOW(1/4),滯留到 SWAMP_DRAIN_S(開始扣血)線性降到 SWAMP_SLOW_MIN(1/8)
      const { SWAMP_SLOW, SWAMP_SLOW_MIN, SWAMP_DRAIN_S } = TERRAIN_FX;
      const k = Math.min(1, (this._swampDwell || 0) / SWAMP_DRAIN_S);
      return SWAMP_SLOW + (SWAMP_SLOW_MIN - SWAMP_SLOW) * k;
    }
    // 水域:至少涉水基準 WATER.SLOW(含影像水色偵測、淺水/無海平面盤的內陸水,depth 可能為 0),
    // 深水再依深度插值到 SLOW_MIN(全滅頂)—— 確保任何水域都減速,不會出現「客戶端不減速但伺服器已凍結」的不一致。
    return Math.min(WATER.SLOW, 1 - (1 - WATER.SLOW_MIN) * Math.min(1, e.depth / WATER.FULL_D));
  }

  /** 火場滯留 → 視野漸霧化(feature 6;純客戶端表現,傷害由伺服器 _tickHazards 結算)。
   *  進火場累積、離場 2× 速消散;滯留超過 FIRE_FOG_S 起霧、FIRE_FOG_MAX_S 達最濃。 */
  _updateEnvFog(dt) {
    // 沼澤滯留計時(_env 已於本幀 _updatePlayer 開頭更新):陷沼(異常狀態)才累加、離開即歸零 → 移動漸慢
    this._swampDwell = (this._env?.code === 2) ? (this._swampDwell || 0) + dt : 0;
    // 騰空(跳躍/蓄力跳躍)不吃火場:與伺服器 _tickHazards 的離地豁免同一條規則
    let inFire = false;
    if (!this._flying() && !this._env?.air) {
      for (const f of this.fires) {
        if (Math.hypot(this.pos.x - f.x, this.pos.z - f.z) <= f.r) { inFire = true; break; }
      }
    }
    this._fireDwell = Math.max(0, this._fireDwell + (inFire ? dt : -dt * 2));
    const { FIRE_FOG_S, FIRE_FOG_MAX_S } = TERRAIN_FX;
    this.hud.envFog?.(Math.max(0, Math.min(1, (this._fireDwell - FIRE_FOG_S) / (FIRE_FOG_MAX_S - FIRE_FOG_S))));
  }

  /**
   * 水下/沼澤視野變色(2026-07-22,純表現層):鏡頭「眼位」沒入水面下 → 藍色帷幕,依沒入深度
   * 插值到近黑(FULL_D×2 ≈ 10m 滿檔);沒入點屬沼澤帶 → 混濁紫黑。判定用最終 camera.position
   * (非 _env.depth —— 那是腳下站立面深度,淺水站立眼在水上時會誤觸;2026-07-23 起 _envAt 的
   * 異常狀態改用同一把「眼位 vs 水平面」尺,見 data.envTrigger ⇒ 畫面變色與狀態生效同進同出),陣亡過場鏡頭墜水 /
   * 觀戰潛水同樣生效。沼澤本身無水面高(高程在水面之上),另以「站沼滯留」推混濁紫氣
   * (越陷越深越濁,與 _terrainSlowF 同一把 _swampDwell 尺)—— 沼澤的「混濁」隨深陷可見化。
   * 每幀重算、無狀態殘留(死亡/重生/離水自然歸零)。
   */
  _updateWaterVeil() {
    if (!this.hud.waterVeil) return;
    const t = this.terrain;
    let v = null;
    if (t) {
      const cam = this.camera.position;
      const wy = t.waterY;
      if (wy != null && cam.y < wy) {
        const code = terrainEnvCode(t, cam.x, cam.z);
        if (code) {
          const k = Math.min(1, (wy - cam.y) / (WATER.FULL_D * 2));
          const mixc = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
          v = code === 2
            ? { c: mixc([96, 66, 128], [22, 10, 34]), a: 0.55 + 0.42 * k }   // 沼澤水下:混濁紫 → 紫黑
            : { c: mixc([26, 92, 142], [3, 8, 14]), a: 0.42 + 0.53 * k };    // 水下:藍 → 黑
        }
      } else if (this._env?.code === 2 && !this._flying() && !this.dead) {
        const k = Math.min(1, (this._swampDwell || 0) / TERRAIN_FX.SWAMP_DRAIN_S);
        if (k > 0.02) v = { c: [98, 72, 124], a: 0.08 + 0.24 * k };   // 站沼:泥沼濁氣漸濃(淡紫)
      }
    }
    this.hud.waterVeil(v);
  }

  _updateMissiles(dt) {
    for (const ms of this.samMeshes.values()) {
      const p = ms.mesh.position;
      p.lerp(ms.tgt, Math.min(1, dt * 10));
      // 朝飛行方向 + 煙尾
      const dir = ms.tgt.clone().sub(ms.prev);
      if (dir.lengthSq() > 0.5) {
        // projectileMesh 幾何 +z 朝前(舊 SAM 錐是 +y;2026-07-22 彈藥同源後統一 +z)
        ms.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
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
      if (ev.kind === 'civilian') {   // 平民非機械:輕量倒地演出,不炸開(擊殺報酬走 civkill 事件)
        const [cx, cz] = [ev.x, -ev.z], cy = this.terrain.heightAt(cx, cz) + 1;
        comicPop(this.scene, this.effects, cx, cy + 1.6, cz, { hue: 0 });
        debrisBurst(this.scene, this.effects, cx, cy, cz, { accent: 0xb03030 });
        return;
      }
      const [x, z] = [ev.x, -ev.z];
      const big = ev.kind === 'tower' || ev.kind === 'base' || ev.kind === 'tank' || ev.kind === 'heli' || ev.kind === 'bunker';
      const hero = HERO_KINDS.has(ev.kind);
      const ey = this.terrain.heightAt(x, z) + 3;
      this._explosion(x, ey, z, big ? 14 : 5, big ? 0xff8844 : 0xffcc66);
      this._applyBlast(x, ey, z, big ? 16 : 6);   // 近距離看拆塔/坦克殉爆會被衝擊波推開
      // 漫畫式破壞回饋:機械碎片噴散 + BOOM 字卡 + hitstop(頓點強調重量感)
      debrisBurst(this.scene, this.effects, x, ey + (big ? 6 : 1), z,
        { big, accent: ev.side ? sideInfo(ev.side).color : 0xd8b04a });
      if (big || hero) {
        comicPop(this.scene, this.effects, x, ey + (ev.kind === 'base' ? 30 : ev.kind === 'tower' ? 20 : 8), z,
          { big: true, hue: hero ? 2 : 18 });
        this._hitstop = Math.max(this._hitstop || 0,
          ev.kind === 'base' ? 0.12 : ev.kind === 'tower' ? 0.08 : 0.05);
      }
      if (ev.kind === 'aasite') {
        this.hud.feed?.('🎯 匿蹤防空陣地被摧毀,該片空域安全了!');
      } else if (ev.kind === 'decoy') {
        // 餌機被攔截擊落:誘餌任務結束(PiP 隨實體消失一起收掉)
        if (ev.pid === this.youId) this.hud.feed?.('💥 餌機被擊落,回傳畫面終止');
      } else if (HAZARDS[ev.kind]) {
        this.hud.feed?.(`🧹 ${HAZARDS[ev.kind].name}被清除,通道打開了!`);
      } else if (ev.kind === 'bunker') {
        this.hud.feed?.(`🏚️ ${sideInfo(ev.side).name}的碉堡被摧毀!(${THIRD.BUNKER_RESPAWN_S / 60} 分鐘後原地重建)`);
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
      // 自殺攻擊機被擊毀的原地半爆(2026-07-22):熾橙火球 + 迸射火星,讀感 = 無人機殉爆
      const col = ev.kami ? 0xff7a2a : (ev.sam ? 0xff7744 : 0xffaa33);
      this._explosion(x, y, z, ev.r * 0.8, col);
      // AoE:放射衝擊環擴張到傷害半徑邊界(貼地),空中炸點只留星爆
      if ((ev.y ?? 0) < 12) shockRing(this.scene, this.effects, x, this.terrain.heightAt(x, z), z, ev.r, ev.kami ? 0xffb066 : 0xffd27a);
      if (ev.kami) this._emberBurst(x, y + 1, z, 12, 3);
      this._applyBlast(x, y, z, ev.r);
      if (ev.mine && ev.tpid === this.youId) this.hud.feed?.('💣 你踩到地雷了!非正規路線佈有雷區!');
      if (ev.mid != null) {   // 觸發的地雷:移除微凸起
        const bump = this.mineMeshes.get(ev.mid);
        if (bump) { this.scene.remove(bump); this.mineMeshes.delete(ev.mid); }
      }
    } else if (ev.e === 'decoyBomb') {
      // 變形機甲餌機投彈(沿途 / 被擊毀補投,2026-07-22):拋擲一枚依機體類型上色/造型的炸彈,
      // 翻滾墜落 + 拖尾 → 落地才引爆(依類型的地面演出)。伺服器傷害在事件當下即結算(純視覺延後)。
      this._spawnDecoyBomb(ev.x, -ev.z, ev.y != null ? ev.y : 8, ev.bomb || 'fire', ev.r || 14);
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
    } else if (ev.e === 'airfall') {
      this.hud.feed?.(`🪂 偵測到 ${ev.n} 批空投物資落入戰場,搶先取得補給!`);
    } else if (ev.e === 'airdrop') {
      // 開箱星爆(稀有色由箱型決定;所有人可見「補給被拿走了」)
      const tone = ev.sz === 'L' ? 0xffd24a : ev.sz === 'M' ? 0xc9ced6 : 0xffb066;
      starburst(this.scene, this.effects, ev.x, this.terrain.heightAt(ev.x, -ev.z) + 3, -ev.z, tone);
      if (ev.pid === this.youId) {
        const box = ev.sz === 'L' ? '大型' : ev.sz === 'M' ? '中型' : '小型';
        if (ev.r === 'medkit') this.hud.feed?.(`🩹 拾獲${box}空投【急救包】裝甲 +${ev.hp}・護盾 +${ev.sp}`);
        else if (ev.r === 'battery') this.hud.feed?.(`🔋 拾獲${box}空投【電池】電力 +${ev.mp}(可破上限)・招式冷卻 −${ev.cd}s`);
        else this.hud.feed?.(`💰 拾獲${box}空投物資 +$${ev.v}`);
      } else if (ev.side && ev.side !== this.side) {
        this.hud.feed?.(`⚠️ ${(sideInfo(ev.side)?.name) || '敵方'}搶走了一箱空投物資!`);
      }
    } else if (ev.e === 'civkill') {
      // 擊殺平民/間諜的報酬回饋(死亡瞬間才揭露身分):只有擊殺者本人看得到明細
      if (ev.pid === this.youId) {
        const enemy = ev.cs !== this.side;
        const who = ev.spy ? (enemy ? '敵方間諜' : '我方間諜') : (enemy ? '敵方平民' : '我方平民');
        const gain = ev.v >= 0;
        this.hud.feed?.(`${gain ? '🎯' : '☠️'} ${who}:${gain ? '+' : ''}$${ev.v}`);
      }
    } else if (ev.e === 'civaid') {
      // 我方跟隨平民每 3 分提供的物資(依職業)
      if (ev.pid === this.youId) {
        const nm = CIVILIANS[ev.prof]?.name || '平民';
        const msg = ev.r === 'medkit' ? `急救包(裝甲 +${ev.hp}・護盾 +${ev.sp})`
          : ev.r === 'battery' ? `電池(電力 +${ev.mp}・冷卻 −${ev.cd}s)`
            : `資金(+$${ev.v})`;
        this.hud.feed?.(`🤝 跟隨的${nm}提供物資:${msg}`);
      }
    } else if (ev.e === 'civact') {
      if (ev.pid === this.youId) this.hud.feed?.(ev.act === 'follow' ? '🚶 平民開始跟隨你' : '👋 你驅離了一名平民');
    } else if (ev.e === 'civfree') {
      if (ev.pid === this.youId) this.hud.feed?.(`🕊️ 清空第三方營地!${ev.n} 名平民脫困並自動跟隨你(隨機陣營・不重生)`);
    } else if (ev.e === 'relay') {
      this.hud.feed?.(ev.side === this.side
        ? `📡 我方啟動偵察中繼站:全隊 ${FIELD.RELAY.VISION_S} 秒無霧視野!`
        : `⚠️ ${SIDES[ev.side].name}啟動了偵察中繼站,我方位置全數曝光!`);
      // 小地圖迷霧全掀(鏡像 sim.visionUntil 的 pulse 旁路)
      if (ev.side === this.side) this._pulseUntil = performance.now() / 1000 + FIELD.RELAY.VISION_S;
      starburst(this.scene, this.effects, ev.x, this.terrain.heightAt(ev.x, -ev.z) + 9, -ev.z,
        8, ev.side ? SIDES[ev.side].color : 0x66ffe0);
    } else if (ev.e === 'sam') {
      // 發射端視覺(2026-07-22 規則 3):防空陣地發射點火光 + 揚塵 —— 飛彈不再憑空出現
      if (ev.from) {
        const sx = ev.from[0], sz = -ev.from[1];
        const sy = this.terrain.heightAt(sx, sz) + 2;
        starburst(this.scene, this.effects, sx, sy, sz, 2.2, 0xffc79a);
        starburst(this.scene, this.effects, sx, sy + 1.5, sz, 1.2, 0xffe9c8);
      }
      if (ev.tpid === this.youId) {
        this.hud.feed?.(ev.ambush
          ? '🚨 匿蹤防空陣地開火!命中即墜毀,快擊落飛彈或回兵線走廊!'
          : '🚨 防空飛彈鎖定你了,快規避!');
      }
    } else if (ev.e === 'lock') {
      // 伺服器確認的準星鎖定:我鎖到人 → 目標亮光暈;我被鎖 → HUD 警告(LOCK.WARN_S 後自動退)
      if (ev.pid === this.youId) {
        const ent = this.ents.get(ev.tid);
        if (ent) this._setLockGlow(ent);
      } else if (ev.tpid === this.youId) {
        this._lockedUntil = performance.now() / 1000 + LOCK.WARN_S;
      }
    } else if (ev.e === 'cc') {
      // 控場位移(拉近):位置客戶端權威 —— 指名自己的事件才生效,自套朝彈著中心的衝量
      // (dash 先例的反向;NPC/bot/僚機由伺服器直接位移,不會收到這條)
      if (ev.k === 'pull' && ev.tpid === this.youId && !this.dead) {
        const wx = ev.x, wz = -ev.z;
        const dx = wx - this.pos.x, dz = wz - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1) {
          const imp = Math.min(ev.imp || 18, d * 2);   // 近距離不過衝
          this.vel.x += dx / d * imp;
          this.vel.z += dz / d * imp;
          if (!this._flying()) this.vy = (this.vy ?? 0) + 3;   // 地面機體被拉離地(掀起感)
          this.trauma = Math.min(1, this.trauma + 0.3);
          this.hud.feed?.('🪝 被拉向彈著中心!');
        }
      }
    } else if (ev.e === 'iframe') {
      // 無敵幀(蓄力跳/變形中段):施放者機體亮相位光環;自己的由 _ccFeed 播報
      const ent = [...this.ents.values()].find((e2) => e2.pid === ev.pid && e2.hero && e2.mesh.visible);
      if (ent) {
        const p = ent.mesh.position;
        shockRing(this.scene, this.effects, p.x, p.y + (ent.dimH || 4) * 0.5, p.z, (ent.dimR || 3) * 1.6, 0xcfe8ff);
      }
    } else if (ev.e === 'decoy') {
      if (ev.pid === this.youId) {
        // 餌機(轟炸機)彈射分離:掛點瞬間抽離的機體震動(伺服器確認才震,請求被拒不會誤震)
        this.trauma = Math.min(1, this.trauma + SHAKE.DECOY);
        this.hud.feed?.(ev.homing ? '🚀 餌機分離:追蹤鎖定目標!' : '🛰️ 餌機分離:直飛偵察中(無法操舵)');
      }
    } else if (ev.e === 'decoyLost') {
      if (ev.pid === this.youId) this.hud.feed?.(`📡 餌機超出 ${DECOY.LINK_M}m,鏈路中斷`);
    } else if (ev.e === 'barrage') {
      // 重砲(巨炮)開窗:記射手時戳,讓其後短暫窗內的視覺彈體掛上氣旋噴射尾流(自己那份在 _tryFire 判)
      if (ev.pid !== this.youId) this._barragePids.set(ev.pid, performance.now() / 1000 + BARRAGE.DUR + 0.3);
    } else if (ev.e === 'cast') {
      // 招式施放:角色專屬演出(castfx.js:魔法陣/元素環繞/拳影劍氣/靈魂束縛……)+ 播報
      const c = CHARACTERS[ev.ch];
      const a = c?.[ev.slot];
      const wx = ev.x, wz = -ev.z;
      // 施放者錨點:自己 = 即時位置;他人 = 快照插值中的 ent(迷霧看不見 → null,錨定落點)。
      // 蜂群一 pid 三架 → 取離施放座標最近那架(自身型招式 ev.x/z 就是施放機位置)。
      let casterPos = null, scale = 4;
      if (ev.pid === this.youId) {
        casterPos = () => this.pos;
        scale = heroTargetH(this.heroKind, this.ch);
      } else {
        let best = null, bd = Infinity;
        for (const ent of this.ents.values()) {
          if (ent.pid !== ev.pid || ent.isSelf || !ent.hero || !ent.mesh.visible) continue;
          const d = (ent.mesh.position.x - wx) ** 2 + (ent.mesh.position.z - wz) ** 2;
          if (d < bd) { bd = d; best = ent; }
        }
        if (best) { casterPos = () => best.mesh.position; scale = best.dimH || 4; }
      }
      // 地面高走 surfaceAt 唯一縫(§2):以施放者當下高度當 curY —— 隧道內施放
      // 特效貼隧道路面、橋上施放貼橋面;裸 heightAt 會把演出釘上覆蓋段山頂。
      const surfY = (x, z) => this._surf(x, z, casterPos ? casterPos().y : this.terrain.heightAt(x, z));
      spawnCastFx(this.scene, this.effects, {
        ch: ev.ch, slot: ev.slot, lvl: ev.lvl || 1, fx: ev.fx, side: ev.side,
        at: new THREE.Vector3(wx, surfY(wx, wz), wz),
        casterPos, groundY: surfY,
        r: ev.r || 0, dur: ev.dur || 0, scale,
      });
      // 施法動作(locomotion stepCastPose;與展示台共用,MUST NOT 另寫分叉):
      // 指向型招式(strike/dash/遠端 emp)= 定向動作(揮武/刺拳/踢腿),其餘 = 全向(吼叫/跺腳/旋轉…)
      const cpNow = casterPos ? casterPos() : null;
      const dirCast = ev.fx === 'strike' || ev.fx === 'dash'
        || (ev.fx === 'emp' && cpNow && Math.hypot(wx - cpNow.x, wz - cpNow.z) > 12) ? 1 : 0;
      const castT0 = performance.now() / 1000;
      for (const ent of this.ents.values()) {
        if (ent.pid !== ev.pid || ent.isSelf || !ent.hero) continue;
        ent.castFx = { t0: castT0, slot: ev.slot, dir: dirCast };
      }
      // 偵察類招式(vision > 0)= 全隊無霧脈衝:小地圖迷霧全掀(鏡像 sim.visionUntil)
      const abV = heroAbility(ev.ch, ev.slot, ev.lvl)?.vision;
      if (abV && ev.side === this.side) {
        this._pulseUntil = Math.max(this._pulseUntil, performance.now() / 1000 + abV);
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
    } else if (ev.e === 'dodge') {
      // 閃避(伺服器擲骰):在目標頭上跳「閃」——只畫鏡頭附近的,避免全場刷字
      const wx = ev.x, wz = -ev.z, cam = this.camera.position;
      if (Math.hypot(wx - cam.x, wz - cam.z) < 140) {
        const y = this.terrain.heightAt(wx, wz) + (ev.y || 0) + 3;
        comicPop(this.scene, this.effects, wx, y, wz, { text: '閃', hue: 190 });
      }
    } else if (ev.e === 'buy') {
      if (ev.pid === this.youId && ev.lvl != null) {
        const up = ECON.UPGRADES[ev.item];
        // 戰鬥面向(abil = 1 + upg):顯示階級 = 已購步數 + 1;防禦系統直接顯示 Lv
        this.hud.feed?.(`⬆️ ${up?.name || ev.item} Lv.${up?.abil ? ev.lvl + 1 : ev.lvl}`);
      }
    } else if (ev.e === 'assist') {
      if (ev.pid === this.youId) this.hud.feed?.(`🤝 助攻 +$${ev.v}`);
    } else if (ev.e === 'penalty') {
      if (ev.pid === this.youId && ev.v > 0) this.hud.feed?.(`💀 陣亡罰金 -$${ev.v}`);
    } else if (ev.e === 'plasma') {
      // 他人施放電漿扇形(自己那份已在 _tryFire 本地畫過)
      if (ev.pid !== this.youId) {
        const fx = ev.x, fz = -ev.z;
        // 起點優先解析射手機體的 rig 槍口錨(嘴砲/噴口);退路才用 ent 座標 + 高度概略
        const from = this._entMuzzle(ev.pid, ev.slot !== 'light' ? 'heavy' : 'light',
          new THREE.Vector3(fx, this.terrain.heightAt(fx, fz) + (ev.y || 0) + 2, fz));
        const dir3 = new THREE.Vector3(ev.dx, 0, -ev.dz).normalize();
        const arc = (ev.arc || 15) * Math.PI / 180;
        const up = new THREE.Vector3(0, 1, 0);
        const pcol = ev.side === 'SWARM' ? 0xffcf7f : 0x7fe8ff;
        const heavy = ev.slot !== 'light';   // 電漿重武器 = 明顯焰舌;散彈輕武器 = 細一號
        const bar = heavy && this._isBarraging(ev.pid);   // 巨炮離子扇:更寬更亮 + 射程 +20%(2026-07-22)
        const wF = bar ? 1.9 : 1, kMax = bar ? 4 : 2;
        this._muzzleBurst(from, heavy, ev.side);
        if (bar) shockRing(this.scene, this.effects, from.x, from.y, from.z, 3.8, pcol);
        // 他人的離子吐息(與自機 _fanBlast 同一支 ionBreath —— 共用視覺入口,不另寫一套)
        if (heavy) {
          const core = this._shotCols(ev.side).hot;
          const clip = this._clipBeam(from, from.clone().addScaledVector(dir3, (ev.r || 150) * 0.82 * (bar ? BARRAGE.RANGE_F : 1)));
          ionBreath(this.scene, this.effects, from, clip.to, pcol,
            { r: 2.2 * wF, ttl: 0.45 * (bar ? 1.4 : 1), coil: bar ? 4 : 3, core });
        }
        for (let k = -kMax; k <= kMax; k++) {
          const dk = dir3.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(up, arc * k / kMax));
          const end = from.clone().addScaledVector(dk, (ev.r || 150) * 0.8 * (bar ? BARRAGE.RANGE_F : 1));
          const clip = this._clipBeam(from, end);   // 扇形焰舌不畫穿牆(伺服器逐目標 LOS 已擋傷害)
          beamLine(this.scene, this.effects, from, clip.to, pcol, heavy ? { ttl: 0.26 * (bar ? 1.5 : 1), w: 0.22 * wF } : { ttl: 0.2, w: 0.09 });
          if (bar) starburst(this.scene, this.effects, clip.to.x, clip.to.y, clip.to.z, 3.2, pcol);
        }
        // 扇形武器不走 tracer 訊息 → 在此標記射手開火動畫(電漿噴湧的後座/射姿)
        this._markFire(ev.pid, heavy ? 'heavy' : 'light', performance.now() / 1000);
      }
    } else if (ev.e === 'shot') {
      // 開火事件(2026-07-17 全兵種化):曳光/槍口焰一律自射手機體的實際槍口射出、
      // 射手標記後座動畫並面向攻擊目標;榴彈兵(howitzer)畫拋物線曳光、砲管仰角與弧線一致
      const [fx, fz] = [ev.from[0], -ev.from[1]];
      const [tx, tz] = [ev.to[0], -ev.to[1]];
      const to = new THREE.Vector3(tx, this.terrain.heightAt(tx, tz) + (ev.ty || 0) + 2, tz);
      const t0 = performance.now() / 1000;
      if (ev.pid != null) {
        // bot 英雄 / 僚機齊射:走真人 tracer 同一條槍口/後座路徑(曳光被障礙截斷,火花打在障礙面)
        const from = this._entMuzzle(ev.pid, ev.slot,
          new THREE.Vector3(fx, this.terrain.heightAt(fx, fz) + 2, fz));
        const sh = ev.slot === 'heavy' ? this._heroEntByPid(ev.pid) : null;
        const def = sh ? this._heroDefOf(sh.ch, 'heavy') : null;
        const d3 = to.clone().sub(from);
        if (def && (def.type === 'launcher' || def.type === 'missile') && d3.lengthSq() > 0.01) {
          // bot 重武器(heroBurst 補發的 shot):彈藥同源 —— 與真人 tracer 同一顆視覺彈體;
          // launcher 拋物線命中目標,砲管仰角與實際發射角一致(規則 1)
          const ldir = this._spawnVisShell(from, to, def, ev.side, sh.ch, this._isBarraging(ev.pid));
          this._muzzleBurst(from, true, ev.side);
          if (def.type === 'launcher') this._aimHeavyBarrel(ev.pid, ldir);
        } else if (def && aoeClass(def) === 'line') {
          // bot 的直線貫穿重武器:與真人 tracer 同一支 _lanceVisual(圓柱粗細 = 貫穿半徑)
          this._lanceVisual(from, this._clipBeam(from, to).to, def, ev.side, this._isBarraging(ev.pid));
          this._muzzleBurst(from, true, ev.side);
        } else {
          const clip = this._clipBeam(from, to);
          this._shotFx(from, clip.to, { heavy: ev.slot === 'heavy', side: ev.side, impact: true, barrage: ev.slot === 'heavy' && this._isBarraging(ev.pid) });
        }
        this._markFire(ev.pid, ev.slot, t0, { x: tx, z: tz, y: to.y });
      } else {
        const ent = ev.id != null ? this.ents.get(ev.id) : null;
        const from = this._npcMuzzle(ent, ev, fx, fz);
        if (ent) {
          ent._aimAt = { x: tx, z: tz, y: to.y, until: t0 + 2.5 };   // 交戰面向:槍口朝攻擊方向
          if (ent.isStatic) ent._turKick = 1;                // 塔/主堡:砲塔後座
          else {
            ent.fireFx = { t0, slot: 'light' };              // 一般單位:stepCombatFx 後座 + 槍口焰
            if (ent.mesh.userData.turret) ent._turKick = 1;  // 車載砲塔:砲管另補上撇後座
          }
        }
        const { col, hot } = this._shotCols(ev.side);
        starburst(this.scene, this.effects, from.x, from.y, from.z, 1.0, hot);
        // 拋物線曳光:榴彈兵 + 坦克攻城砲(wid 'siege' 彈道學拋物線)—— 砲管仰角與弧線一致
        if (ev.kind === 'howitzer' || ev.kind === 'tank') this._arcTracer(from, to, col, ent);
        else {
          // NPC/塔/主堡曳光被大型障礙截斷(伺服器 LOS 已擋開火,這裡吸收兩端幾何不同形的殘餘穿幫)
          const clip = this._clipBeam(from, to);
          beamLine(this.scene, this.effects, from, clip.to, col, { ttl: 0.11, w: 0.06 });
          if (clip.cut) starburst(this.scene, this.effects, clip.to.x, clip.to.y, clip.to.z, 1.2, col);
        }
      }
    } else if (ev.e === 'wave') {
      this.hud.feed?.(`⚔️ 第 ${ev.n} 波兵線出擊(含攻擊直升機)`);
    } else if (ev.e === 'respawn') {
      if (this.side === ev.side) this.hud.feed?.('🔁 你已重生,守住防線!');
    }
  }

  onTracer(m) {
    // 他人開火視覺:槍口爆 + 發光曳光束 +(命中點)火花。重武器(slot:'heavy')明顯放大。
    // 起點解析成射手機體的 rig 槍口錨(找不到才用訊息座標)—— 曳光從對方手上/背上的槍管射出
    const from = this._entMuzzle(m.pid, m.slot,
      new THREE.Vector3(m.from[0], m.from[1], m.from[2]));
    const to0 = new THREE.Vector3(m.to[0], m.to[1], m.to[2]);
    // 彈藥同源(2026-07-22):launcher/missile 在他人畫面也是「飛行彈體」(重力彈道,純視覺)
    // 而非直線光束 —— pid→ent.ch 解析射手武器 def,與自機 FPV 同一顆 projectileMesh。
    if (m.slot === 'heavy') {
      const shooter = this._heroEntByPid(m.pid);
      const def = shooter ? this._heroDefOf(shooter.ch, 'heavy') : null;
      // 直線貫穿(beam/rail/gun 重武器):他人畫面同樣看得到圓柱貫穿的粗細 = 危險區(規則可讀性)
      if (def && aoeClass(def) === 'line') {
        this._lanceVisual(from, this._clipBeam(from, to0).to, def, m.side, this._isBarraging(m.pid));
        this._muzzleBurst(from, true, m.side);
        this._markFire(m.pid, m.slot, performance.now() / 1000, { x: to0.x, z: to0.z, y: to0.y });
        return;
      }
      if (def && (def.type === 'launcher' || def.type === 'missile')) {
        const dir = to0.clone().sub(from);
        if (dir.lengthSq() > 0.01) {
          const ldir = this._spawnVisShell(from, to0, def, m.side, shooter.ch, this._isBarraging(m.pid), m.mv);
          this._muzzleBurst(from, true, m.side);
          // 拋物線武器(launcher)砲管仰角與實際發射角一致(規則 1;missile 導引不回寫)
          if (def.type === 'launcher') this._aimHeavyBarrel(m.pid, ldir);
          this._markFire(m.pid, m.slot, performance.now() / 1000, { x: to0.x, z: to0.z, y: to0.y });
          return;
        }
      }
    }
    // 他人曳光同吃障礙截斷(對方客戶端已擋彈道,這裡的 60m 示意曳光也不可畫穿牆)
    const clip = this._clipBeam(from, to0);
    this._shotFx(
      from,
      clip.to,
      { heavy: m.slot === 'heavy', side: m.side, impact: !!m.hit || clip.cut, barrage: m.slot === 'heavy' && this._isBarraging(m.pid) },
    );
    // 射手機體的開火動畫(後座 + 射姿保持):pid 由伺服器轉播時附上(server.js tracer relay)
    this._markFire(m.pid, m.slot, performance.now() / 1000, { x: to0.x, z: to0.z, y: to0.y });
  }

  /** 手持重武器(launcher 彈道)砲管仰角回寫:發射方向的仰角調整 gunPitch 目標角。
   *  aim0 = 建模解算的水平據槍角(首次寫入時快取);仰角向上 = rotation.x 減小,
   *  與 _arcTracer 的 comp − atan 同號約定 —— 拋物線武器的槍管角度與射擊角度一致。 */
  _aimHeavyBarrel(pid, dir) {
    const elev = Math.atan2(dir.y, Math.hypot(dir.x, dir.z) || 1);
    for (const ent of this.ents.values()) {
      if (ent.pid !== pid || ent.isSelf) continue;
      const rig = ent.mesh?.userData?.rig;
      const gp = rig?.weap?.heavy === 'L' ? rig?.gunL : rig?.gunR;
      if (!gp) continue;
      gp.aim0 ??= gp.aim;
      gp.aim = gp.aim0 - elev;
    }
  }

  /** 以 pid 找英雄 ent(有 ch 才算 —— 解析射手武器 def 用) */
  _heroEntByPid(pid) {
    if (pid == null) return null;
    for (const ent of this.ents.values()) if (ent.pid === pid && ent.ch) return ent;
    return null;
  }

  /** 他人武器 def 解析(heroWeapon Lv1;純視覺用 type/mv/range,不涉結算)—— 依 ch:slot 快取 */
  _heroDefOf(ch, slot) {
    if (!ch || !CHARACTERS[ch]) return null;
    const key = `${ch}:${slot}`;
    let d = this._wdefCache.get(key);
    if (!d) { d = heroWeapon(ch, slot, 1, true); this._wdefCache.set(key, d); }
    return d;
  }

  /** 他人是否處於重砲(巨炮)開窗內(barrage 事件記的時戳;過期即清) */
  _isBarraging(pid) {
    const until = this._barragePids.get(pid);
    if (until == null) return false;
    if (until < performance.now() / 1000) { this._barragePids.delete(pid); return false; }
    return true;
  }

  /** 他人重武器的視覺彈體(純表現層:直線+重力近似,不結算;真實爆點由伺服器 boom 事件呈現) */
  /** 彈道初速:榴彈/火箭(launcher)拋物線武器降速(→ BALLISTIC.LAUNCH_MV),讓拋物線軌跡明顯;
   *  其餘武器用真實 mv。純客戶端視覺(伺服器不模擬彈道),與瞄準虛線 _updateArcGuide 同一組值。
   *  aa = 對空彈射模式(見 _updateAaMode):改用 BALLISTIC.AA_MV,彈道拉成高速近直線。 */
  _shotV0(def, aa = false) {
    const v0 = def.mv || 600;
    if (def.type !== 'launcher') return v0;
    return Math.min(v0, aa ? BALLISTIC.AA_MV : BALLISTIC.LAUNCH_MV);
  }

  /**
   * 拋射角解算(真實彈道學):自 from 以速率 v0 命中 to 的兩組解。
   *   lo = 低伸解(彈道平、飛行時間短)、hi = 高角度解(越過遮蔽物的曲射)。
   * 同一距離兩個仰角都命中同一點 —— 這就是「弧線隨距離與仰角改變」的物理根據。
   * ok:false = 超出該初速的射程包絡(判別式 < 0,無實數解)→ 兩解都退回 45°(最大射程角)盡力射。
   */
  _lobSolve(from, to, v0) {
    const hx = to.x - from.x, hz = to.z - from.z;
    const L = Math.hypot(hx, hz) || 1e-3;
    const dy = to.y - from.y, g = BALLISTIC.G, v2 = v0 * v0;
    const disc = v2 * v2 - g * (g * L * L + 2 * dy * v2);
    if (disc < 0) return { ok: false, lo: 1, hi: 1, L, hx, hz };   // 射不到:45° 盡力(視覺落短仍呈拋物)
    const s = Math.sqrt(disc);
    return { ok: true, lo: (v2 - s) / (g * L), hi: (v2 + s) / (g * L), L, hx, hz };
  }

  /** 拋物線發射初速向量:預設低伸解;high = 高角度解(真實榴彈砲越過稜線/建物的曲射)。 */
  _lobVel(from, to, v0, high = false) {
    const s = this._lobSolve(from, to, v0);
    const tan = high ? s.hi : s.lo;
    const vh = v0 / Math.sqrt(1 + tan * tan);
    return new THREE.Vector3((s.hx / s.L) * vh, vh * tan, (s.hz / s.L) * vh);
  }

  /** 他人/bot 重武器視覺彈體。launcher 走拋物線命中 to(慢速明顯弧),其餘直指;回傳實際發射方向(供砲管仰角回寫)。 */
  _spawnVisShell(from, to, def, side, ch, barrage = false, mv = null) {
    // mv = 射手回報的實際初速(火控解定案的裝藥號數 / 彈射模式全速)⇒ 兩端看到同一條弧。
    // bot 的 shot 事件不帶初速,退回以落點離地高度推定對空(> AA_ALT = 打空中目標)→ 高速近直線。
    const aa = def.type === 'launcher' && to.y - this.terrain.heightAt(to.x, to.z) > BALLISTIC.AA_ALT;
    const v0 = mv || this._shotV0(def, aa);
    const vel = def.type === 'launcher'
      ? this._lobVel(from, to, v0)                              // 榴彈/火箭:拋物線命中目標(彈射模式初速高 ⇒ 解自然拉平)
      : to.clone().sub(from).normalize().multiplyScalar(v0);   // 飛彈/動能:直指目標(近似,純視覺)
    const ldir = vel.clone().normalize();
    const mesh = projectileMesh(def, {
      col: this._shotCols(side).col,
      hue: CHARACTERS[ch]?.visual?.hue ?? 0xffd27a,
      heavy: true,
    });
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ldir);
    this.scene.add(mesh);
    this._visShells.push({
      pos: from.clone(), vel,
      dist: 0, max: (def.range || 300) * 1.35, mesh,
      cyclone: barrage ? this._attachCyclone(mesh, side) : null, cycAcc: 0, cycCol: this._shotCols(side).col,
    });
    return ldir;
  }

  /** 視覺彈體逐幀積分:重力下墜 + 地形/實體障礙截斷(解析判定,純視覺不進 A6 raycast 目標) */
  _updateVisShells(dt) {
    for (let i = this._visShells.length - 1; i >= 0; i--) {
      const b = this._visShells[i];
      const prev = b.pos.clone();
      b.vel.y -= BALLISTIC.G * dt;
      b.pos.addScaledVector(b.vel, dt);
      const seg = b.pos.clone().sub(prev);
      const len = seg.length();
      b.dist += len;
      let hit = b.pos.y <= this.terrain.heightAt(b.pos.x, b.pos.z);
      const dB = len > 0.01 ? this._obstHitT(prev.x, prev.y, prev.z, b.pos.x, b.pos.y, b.pos.z) : null;
      if (dB != null) { b.pos.copy(prev).addScaledVector(seg.clone().divideScalar(len), dB); hit = true; }
      if (hit || b.dist >= b.max) {
        starburst(this.scene, this.effects, b.pos.x, b.pos.y, b.pos.z, hit ? 1.6 : 0.8, 0xffc79a);
        this.scene.remove(b.mesh);
        this._visShells.splice(i, 1);
        continue;
      }
      b.mesh.position.copy(b.pos);
      if (len > 0.001) b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), seg.normalize());
      if (b.cyclone) this._spinCyclone(b, dt);
    }
  }

  // ---------------- 氣旋噴射(巨炮砲彈尾流,2026-07-22)----------------
  /** 建立氣旋渦輪並掛在砲彈子體底下;回傳群組(逐幀由 _spinCyclone 自旋 + 撒螺旋煙圈) */
  _attachCyclone(mesh, side) {
    const cyc = cycloneJet(this._shotCols(side).col);
    mesh.add(cyc);
    return cyc;
  }

  /** 氣旋自旋 + 沿行進軸撒外旋螺旋煙圈(讀感 = 氣旋捲動);b.cycAcc 節流撒點,b.cycCol 陣營色 */
  _spinCyclone(b, dt) {
    b.cyclone.rotation.z += dt * 26;                 // 高速自旋
    b.cycAcc = (b.cycAcc || 0) + dt;
    if (b.cycAcc < 0.03) return;
    b.cycAcc = 0;
    // 行進軸的兩條正交向量 → 在垂直於航向的平面上取旋轉相位,撒一顆略微外旋的加法煙點
    const dir = b.vel.clone().normalize();
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const rx = new THREE.Vector3().crossVectors(dir, up).normalize();
    const ry = new THREE.Vector3().crossVectors(dir, rx).normalize();
    const ph = (b.cycPh = (b.cycPh || 0) + 1.1);     // 相位遞進 → 螺旋
    const rad = 0.9;
    const off = rx.clone().multiplyScalar(Math.cos(ph) * rad).addScaledVector(ry, Math.sin(ph) * rad);
    const p = b.pos.clone().addScaledVector(dir, -0.6).add(off);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._fireTex(), color: b.cycCol || 0xffd27a,
      transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.userData.noOutline = true;
    sp.position.copy(p);
    sp.scale.setScalar(1.5);
    this.scene.add(sp);
    // 切向速度(繞航向旋轉)+ 略外擴,快速淡出 → 拖成氣旋螺旋
    const tang = rx.clone().multiplyScalar(-Math.sin(ph)).addScaledVector(ry, Math.cos(ph)).multiplyScalar(9)
      .addScaledVector(off.clone().normalize(), 3).addScaledVector(dir, -6);
    this.effects.push({
      obj: sp, ttl: 0.32,
      fade: (o, f, dtt) => { o.position.addScaledVector(tang, dtt); o.scale.setScalar(1.5 + (1 - f) * 2.2); o.material.opacity = 0.85 * f; },
      dispose: () => sp.material.dispose(),
    });
  }

  // ---------------- 餌機投彈拋擲動畫(2026-07-22)----------------
  /** 拋擲一枚依機體類型上色/造型的炸彈:自餌機高度翻滾墜落 + 拖尾 → 落地引爆(_updateDecoyBombs 驅動) */
  _spawnDecoyBomb(x, z, alt, type, r) {
    const gy = this.terrain.heightAt(x, z);
    const col = (DECOY_BOMB[type] || DECOY_BOMB.fire).color;
    const mesh = decoyBombMesh(type, col);
    const startY = gy + Math.max(4, alt);
    mesh.position.set(x, startY, z);
    this.scene.add(mesh);
    this._decoyBombs.push({
      mesh, type, col, r, gy,
      pos: new THREE.Vector3(x, startY, z),
      // 幾近垂直投放(微隨機水平擾動,落點貼近伺服器爆點);初速略下拋
      vel: new THREE.Vector3((Math.random() - 0.5) * 4, -2, (Math.random() - 0.5) * 4),
      spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3),
      trailAcc: 0,
    });
  }

  /** 拋擲彈體逐幀:重力墜落 + 翻滾 + 類型拖尾;觸地(或逾時)→ 引爆演出 */
  _updateDecoyBombs(dt) {
    for (let i = this._decoyBombs.length - 1; i >= 0; i--) {
      const b = this._decoyBombs[i];
      b.vel.y -= BALLISTIC.G * 1.6 * dt;   // 略重的墜落感
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      b.gy = this.terrain.heightAt(b.pos.x, b.pos.z);
      // 類型拖尾(節流):燃燒/雷爆 = 加法火星,凍結/毒霧 = 柔煙
      b.trailAcc += dt;
      if (b.trailAcc >= 0.045) {
        b.trailAcc = 0;
        const additive = b.type === 'fire' || b.type === 'thunder';
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: additive ? this._fireTex() : this._smokeTex(), color: b.col,
          transparent: true, opacity: additive ? 0.9 : 0.6, depthWrite: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
        sp.userData.noOutline = true;
        sp.position.set(b.pos.x, b.pos.y + 0.2, b.pos.z);
        sp.scale.setScalar(additive ? 1.0 : 1.4);
        this.scene.add(sp);
        this.effects.push({
          obj: sp, ttl: 0.4,
          fade: (o, f) => { o.material.opacity = (additive ? 0.9 : 0.6) * f; o.scale.setScalar((additive ? 1.0 : 1.4) * (1 + (1 - f))); },
          dispose: () => sp.material.dispose(),
        });
      }
      if (b.pos.y <= b.gy + 0.5) {
        b.mesh.parent && this.scene.remove(b.mesh);
        this._decoyBombLandFx(b.pos.x, b.gy, b.pos.z, b.type, b.col, b.r);
        this._decoyBombs.splice(i, 1);
      }
    }
  }

  /** 落地引爆:依類型上色的火球 + 地環 + 衝擊波,再疊類型專屬地面演出 */
  _decoyBombLandFx(x, gy, z, type, col, r) {
    const y = gy + 1.2;
    this._explosion(x, y, z, r * 0.9, col);
    shockRing(this.scene, this.effects, x, gy, z, r * 1.6, col);
    this._applyBlast(x, y, z, r);
    if (type === 'fire') {
      this._emberBurst(x, y, z, 14, 4);
    } else if (type === 'freeze') {
      for (let k = 0; k < 8; k++) {   // 迸射冰晶(慢速、淺藍)
        const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * r * 0.5;
        starburst(this.scene, this.effects, x + Math.cos(a) * d, gy + 0.6 + Math.random() * 2, z + Math.sin(a) * d, 1.6, 0xbfeaff);
      }
    } else if (type === 'poison') {
      for (let k = 0; k < 4; k++) this._crashSmoke(x + (Math.random() - 0.5) * r, gy + 0.5, z + (Math.random() - 0.5) * r, 1.3);
      for (let k = 0; k < 3; k++) starburst(this.scene, this.effects, x + (Math.random() - 0.5) * r, gy + 1 + Math.random() * 2, z + (Math.random() - 0.5) * r, 2.0, 0x9be36a);
    } else if (type === 'thunder') {
      for (let k = 0; k < 6; k++) {   // 放射電弧
        const a = (k / 6) * Math.PI * 2, d = r * (0.6 + Math.random() * 0.5);
        const to = new THREE.Vector3(x + Math.cos(a) * d, gy + 0.5 + Math.random() * 2, z + Math.sin(a) * d);
        beamLine(this.scene, this.effects, new THREE.Vector3(x, y, z), to, 0xffe14f, { ttl: 0.18, w: 0.06 });
      }
    }
  }

  // ---------------- 榴彈對空彈射模式(2026-07-23)----------------
  /**
   * launcher(榴彈/火箭)準星掃到飛行單位 → 切「彈射模式」:初速拉到 BALLISTIC.AA_MV,
   * 彈道變成高速近直線(拋物線吊射對會動的飛行目標毫無火控意義)。射程/傷害/彈藥全不變。
   * **唯一判定縫**:每幀在 `_tickWeapons`(擊發)之前更新 `this._aaAim`,擊發與瞄準虛線
   * 消費同一份結果 ⇒ 所見即所射;MUST NOT 在擊發處另做一次掃描(兩份會分家)。
   */
  _updateAaMode() {
    const def = (this.side && !this.dead && !this.shopOpen) ? this._curWeapon().def : null;
    // 掃到的飛行目標留給 _lobAim 當瞄準點(彈射模式的火控解直接收束到機體幾何中心,
    // 不再靠玩家對著會動的機群手動修正);MUST NOT 在 _lobAim 另掃一次(兩份會分家)。
    this._aaEnt = def && def.type === 'launcher'
      ? this._aaTarget(def.range * this._altRangeMul(def)) : null;
    const on = !!this._aaEnt;
    if (on === this._aaAim) return;
    this._aaAim = on;
    const now = performance.now() / 1000;
    if (on && now - (this._aaFeedAt || 0) > 4) {   // 準星掃過機群會反覆切換,提示節流
      this._aaFeedAt = now;
      this.hud.feed?.('🎯 對空彈射模式:切換為高速平射彈道');
    }
  }

  /** 準星錐(BALLISTIC.AA_CONE ≈ 8°)內、射程內、無障礙遮擋的飛行類敵方單位(TARGET_CLASS 'air');
   *  取最正對的一個。純本地瞄準輔助(不送伺服器、不影響結算),逐幀跑故一律用純量運算不配置向量。 */
  _aaTarget(rng) {
    const ro = this.camera.position;
    const fwd = this.camera.getWorldDirection(this._aaFwd || (this._aaFwd = new THREE.Vector3()));
    let best = null, bestAng = BALLISTIC.AA_CONE;
    for (const ent of this.ents.values()) {
      if (TARGET_CLASS[ent.kind] !== 'air') continue;   // 先過最便宜的條件(每幀掃全場)
      if (ent.side === this.side || ent.neutral || ent.dead || !ent.mesh.visible) continue;
      const p = ent.mesh.position;
      const cy = p.y + (ent.dimTop != null ? ent.dimTop - ent.dimH * 0.5 : 1.5);   // 瞄機體幾何中心
      const dx = p.x - ro.x, dy = cy - ro.y, dz = p.z - ro.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > rng || d < 1e-3) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (fwd.x * dx + fwd.y * dy + fwd.z * dz) / d)));
      if (ang >= bestAng) continue;
      const dB = this._obstHitT(ro.x, ro.y, ro.z, p.x, cy, p.z);
      if (dB != null && dB < d - 1) continue;   // 障礙擋在目標前 = 沒有火控
      best = ent; bestAng = ang;
    }
    return best;
  }

  // ---------------- 榴彈火控(trajClass 'lob';2026-07-22 瞄準指示 → 2026-07-23 改火控解)----------------
  /**
   * 拋物線武器的火控解 —— **唯一判定縫**,每幀在 `_tickWeapons`(擊發)之前定案。
   * 擊發 `_tryFire`、瞄準虛線 `_updateArcGuide`、鎖定光暈 `_tickLock`、砲口仰角(`_loop` 的
   * gunGroup.rotation.x)全部消費同一份 `this._lobFc` ⇒ 所見即所射;
   * **MUST NOT** 在任何一端另解一次(兩份會分家)。
   *
   * 火控流程(遵守真實彈道學,使用者 2026-07-23 定案):
   *  ① 瞄準點:準星射線的交點 —— 打到機體就取**那個部位**的世界座標(規則:瞄哪個部位打哪個部位);
   *     對空彈射模式改取飛行目標的機體幾何中心(會動的目標不該要求玩家對著它手動吊射)。
   *  ② 解算:以初速 v0(吊射 LAUNCH_MV / 彈射 AA_MV)求命中該點的拋射角 —— 出膛仰角、弧高、
   *     飛行時間全隨目標距離與高差改變,砲口因此不再是「沿準星直射的一條固定曲線」。
   *  ③ 驗證:逐步積分;低伸解被地形/障礙截斷 → 逐級降裝藥(仰角自動抬高)重解,直到越過遮蔽物。
   *     全部裝藥都不通 / 超出射程包絡 ⇒ ok:false,虛線轉警示色且**鎖定光暈不亮**
   *     (使用者規則「射程光暈要在拋物線對準時才亮」)。
   */
  _lobAim() {
    const fc = this._lobFc || (this._lobFc = {
      on: false, ok: false, aa: false, high: false, ent: null, v0: 0, sup: 0, n: 0,
      aim: new THREE.Vector3(), vel: new THREE.Vector3(), impact: new THREE.Vector3(), hasImpact: false,
    });
    fc.on = false; fc.ok = false; fc.ent = null; fc.sup = 0;
    const { id, def } = this._curWeapon();
    // 雷射導引(trajClass 'guide')由 _updateGuideLaser 指示 —— 彈體解保險後騎波不吃重力,
    // 走拋物線火控是錯的指示,兩者互斥。
    if (this.dead || this.shopOpen || !this.side || !this.ch || id !== 'heavy'
        || !def || trajClass(def) !== 'lob' || !this.gunGroup) return;
    this.camera.updateMatrixWorld();
    const from = this.gunGroup.localToWorld(this._muzzle.clone());
    const max = def.range * this._altRangeMul(def)
      * ((this._barrageUntil || 0) > performance.now() / 1000 ? BARRAGE.RANGE_F : 1);
    // ① 瞄準點(對空彈射沿用 _updateAaMode 掃到的那架,不另掃)
    const aaEnt = this._aaAim ? this._aaEnt : null;
    if (aaEnt && !aaEnt.dead && aaEnt.mesh.visible) {
      const p = aaEnt.mesh.position;
      fc.aim.set(p.x, p.y + (aaEnt.dimTop != null ? aaEnt.dimTop - aaEnt.dimH * 0.5 : 1.5), p.z);
      fc.ent = aaEnt;
    } else {
      // 準星射線每幀重打太貴(地形 7 萬面 + 全場機體 mesh)—— 鏡頭與槍口都幾乎沒動就沿用上一幀
      // 的瞄準點(靜止架砲是榴彈的主要用法)。轉動/位移一超過門檻立刻重打 ⇒ 瞄準精度不打折,
      // 最壞情況與既有 _updateGuideLaser 的每幀射線同級。
      const dir = this.camera.getWorldDirection(this._lobFwd || (this._lobFwd = new THREE.Vector3()));
      const c = this._lobCache || (this._lobCache = { d: new THREE.Vector3(), o: new THREE.Vector3(), t: -1, ent: null, pt: new THREE.Vector3() });
      const t = performance.now();
      if (t - c.t > 60 || c.d.dot(dir) < 0.999998 || c.o.distanceToSquared(from) > 0.0225
          || (c.ent && (c.ent.dead || !c.ent.mesh.visible))) {
        const r = this._resolveAim(max);
        c.pt.copy(r.point); c.ent = r.ent || null; c.d.copy(dir); c.o.copy(from); c.t = t;
      }
      fc.aim.copy(c.pt);
      fc.ent = c.ent;
    }
    fc.on = true;
    fc.aa = !!this._aaAim;
    const base = this._shotV0(def, fc.aa);
    // ② + ③ 逐級降裝藥(BALLISTIC.LOB_CHARGE):全裝藥低伸解 → 被地形/障礙擋住就降一號,
    // 初速降低 ⇒ 命中同一點所需仰角自動抬高、弧線變高 —— 真實榴彈砲「選裝藥號數 + 高角度射擊」
    // 越過稜線/建物的作法。降到打不到(射程包絡外)即停;出射程/無解的截斷降裝藥也沒用,不白跑積分。
    const Z = BALLISTIC.LOB_CHARGE;
    let arc = null, zi = 0;
    for (let k = 0; k < Z.length; k++) {
      const v = base * Z[k];
      if (!this._lobSolve(from, fc.aim, v).ok) break;   // 該裝藥打不到:更低號更打不到
      const a = this._arcTrace(from, this._lobVel(from, fc.aim, v), max, fc.aim);
      arc = a; zi = k;
      if (a.minD <= BALLISTIC.LOB_TOL) { fc.ok = true; break; }
      if (a.cut !== 'block') break;
    }
    if (!arc) {   // 全裝藥都沒有實數解(超出射程包絡):畫 45° 盡力弧當落短指示
      arc = this._arcTrace(from, this._lobVel(from, fc.aim, base), max, fc.aim);
    }
    fc.v0 = base * Z[zi];
    fc.high = zi > 0;
    fc.vel.copy(this._lobVel(from, fc.aim, fc.v0));
    fc.n = arc.n;
    fc.hasImpact = !!arc.impact;
    if (arc.impact) fc.impact.copy(arc.impact);
    // 砲口實際指向 = 火控解的出膛角(FPV 砲管跟著抬,所見即所射)
    const fwdY = this.camera.getWorldDirection(this._lobFwd || (this._lobFwd = new THREE.Vector3())).y;
    fc.sup = Math.max(-0.35, Math.min(BALLISTIC.LOB_SUP_MAX,
      Math.asin(Math.max(-1, Math.min(1, fc.vel.y / (fc.vel.length() || 1)))) - Math.asin(Math.max(-1, Math.min(1, fwdY)))));
  }

  /**
   * 彈道積分(與 _updateBullets 同一組 G / 地形 / 障礙截斷規則):寫入 `_arcGuide` 預配置緩衝。
   * 回傳 { n:點數, impact:落點或 null, minD:彈道與瞄準點的最近距離, cut:截斷原因 }。
   * minD 即「拋物線有沒有對準」的判據 —— 解算保證彈道通過瞄準點,積分卻可能先被地形/障礙/
   * 射程終點截斷,截斷了就永遠靠不近(單位不擋積分:命中由伺服器結算,虛線只是指示)。
   * cut:'block' 撞地形/障礙(降裝藥抬高彈道可能越過)/ 'range' 射程終點 / 'pass' 飛過瞄準點 / null 緩衝用盡。
   * step 隨初速自適應(恆 ~3m/點):彈射模式 720m/s 若照 0.03s 走,一步 21m 會跳過整條稜線。
   */
  _arcTrace(from, vel, max, aim) {
    this._ensureArcGuide();
    const ag = this._arcGuide, arr = ag.arr, ld = ag.ld, MAXP = ag.maxp;
    let n = 0;
    // lineDistance 自算進預配置緩衝 —— 不呼叫 line.computeLineDistances()(它每幀重建 attribute 洩漏 buffer)
    const put = (v, d) => { if (n < MAXP) { arr[n * 3] = v.x; arr[n * 3 + 1] = v.y; arr[n * 3 + 2] = v.z; ld[n] = d; n++; } };
    put(from, 0);
    const p = from.clone(), v = vel.clone();
    const step = Math.min(0.03, 3 / Math.max(1, vel.length()));
    // 「飛過瞄準點」的判據 = 沿 from→aim 軸的投影長(不用水平距離:正上方的飛行目標水平距離為 0,
    // 會在第一步就誤判成飛過去了)
    const aimD = Math.max(1e-3, from.distanceTo(aim));
    const ux = (aim.x - from.x) / aimD, uy = (aim.y - from.y) / aimD, uz = (aim.z - from.z) / aimD;
    let dist = 0, impact = null, minD = aimD, cut = null;
    const prev = new THREE.Vector3();
    for (let i = 0; i < MAXP - 1; i++) {
      prev.copy(p);
      v.y -= BALLISTIC.G * step;
      p.addScaledVector(v, step);
      dist += prev.distanceTo(p);
      let hit = p.y <= this.terrain.heightAt(p.x, p.z);
      const dB = this._obstHitT(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      if (dB != null) { p.copy(prev).addScaledVector(v.clone().normalize(), dB); hit = true; }
      put(p, dist);
      minD = Math.min(minD, p.distanceTo(aim));
      // 飛過瞄準點即收線(落點環畫在目標上,虛線不再穿過機體往後方山腳延伸)
      const s = (p.x - from.x) * ux + (p.y - from.y) * uy + (p.z - from.z) * uz;
      if (hit || dist >= max || s >= aimD) {
        impact = p.clone();
        cut = hit ? 'block' : (dist >= max ? 'range' : 'pass');
        break;
      }
    }
    return { n, impact, minD, cut };
  }

  /** 拋物線瞄準指示(純繪製):虛線 + 落點環,幾何與顏色全部取自 `_lobFc`,MUST NOT 在此重解彈道。 */
  _updateArcGuide() {
    const fc = this._lobFc;
    if (!fc?.on || !this.aiming) { if (this._arcGuide) this._arcGuide.group.visible = false; return; }
    const ag = this._arcGuide;
    ag.group.visible = true;
    const geo = ag.line.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.lineDistance.needsUpdate = true;
    geo.setDrawRange(0, fc.n);
    geo.computeBoundingSphere();
    // 未對準 = 警示紅(彈道打不到準星指的地方);彈射模式冷色;高角度曲射琥珀色
    const col = !fc.ok ? 0xff6a6a : fc.aa ? 0x9adfff : fc.high ? 0xffd24a : this._shotCols(this.side).col;
    ag.line.material.color.setHex(col);
    if (fc.hasImpact) {
      ag.marker.visible = true;
      // 對空/直擊機體的交會點在半空(投影到地面會落在遠方山腳,讀不出交會位置)→ 環直接畫在彈道終點
      const gy = this.terrain.heightAt(fc.impact.x, fc.impact.z);
      ag.marker.position.set(fc.impact.x,
        fc.impact.y - gy > (fc.aa ? BALLISTIC.AA_ALT : 1.2) ? fc.impact.y : gy + 0.3, fc.impact.z);
      ag.marker.material.color.setHex(col);
    } else ag.marker.visible = false;
  }

  /** 懶建拋物線指示物件(虛線 + 落點環,預配置緩衝持久重用;避免每幀重建 attribute 洩漏 GPU buffer) */
  _ensureArcGuide() {
    if (this._arcGuide) return;
    const MAXP = 264;
    const arr = new Float32Array(MAXP * 3);
    const ld = new Float32Array(MAXP);
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(arr, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    const ldAttr = new THREE.BufferAttribute(ld, 1);
    ldAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('lineDistance', ldAttr);
    geo.setDrawRange(0, 0);
    const group = new THREE.Group();
    group.userData.noOutline = true;
    const line = new THREE.Line(geo,
      new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 2.2, gapSize: 1.6, transparent: true, opacity: 0.9, depthWrite: false }));
    line.userData.noOutline = true;
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.0, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.userData.noOutline = true;
    group.add(line); group.add(marker);
    this.scene.add(group);
    this._arcGuide = { group, line, marker, arr, ld, maxp: MAXP };
  }

  /** 重武器(rail 類)蓄力狀態:純視覺轉播(同 onTracer),驅動射手第三人稱機體的掛點動畫 —
   *  蓄力窗是敵方可利用的戰術情報,MUST 即時轉播(不等 8Hz 快照),讓被瞄準的一方有反應時間。 */
  onHeavyCharge(m) {
    const t0 = performance.now() / 1000;
    for (const ent of this.ents.values()) {
      if (ent.pid !== m.pid) continue;
      ent.heavyFx = m.on ? { phase: 'charge', t0 } : null;
    }
  }

  /** 重武器擊發瞬間:third-person 掛點的釋放/後座演出(所有類型共通,不限 rail) */
  onHeavyFire(m) {
    const t0 = performance.now() / 1000;
    for (const ent of this.ents.values()) {
      if (ent.pid !== m.pid) continue;
      ent.heavyFx = { phase: 'fire', t0 };
    }
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
    // 切換前的視野方向與位置(this.pos 此刻仍是舊座機):新座機在跟隨距離內就沿用原視野方向
    // (含被擊墜自動讓位),太遠(還沒歸隊到編隊距離)才用該機自身朝向。
    const prevYaw = this.yaw, prevX = this.pos.x, prevZ = this.pos.z;
    ent.isSelf = true;
    const wx = e.x, wz = -e.z;
    this.pos.set(wx, this.terrain.heightAt(wx, wz) + (e.y ?? 0), wz);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    const near = Math.hypot(wx - prevX, wz - prevZ) <= SQUAD.REGROUP_M;
    this.yaw = near ? prevYaw : (e.ry ?? this.yaw);
    this.firing = false;
    this._crashSent = false;
    this.trauma = 0.35;
    this._prevVital = null;   // 換座機:重置受傷偵測基準,避免血量落差誤觸暈影
    this.hud.feed?.(`🔀 主視野切換至 ${(e.si ?? 0) + 1} 號機`);
  }

  /** 切換主視野(V 循環 / 1~3 直選);實際換機由伺服器裁決 */
  _swapDrone(i) {
    if (!this.isDrone || !this.side) return;
    this.net.send(i == null ? { t: 'swap' } : { t: 'swap', i });
  }

  /**
   * 準星鎖定:準星掃到「射程內」的敵方單位就回報伺服器(全機種通用)。
   * 伺服器複驗距離/視野後廣播 lock 事件 → 施放者看到光暈、目標本人跳警告。
   * 只送變化與心跳,避免每幀灌訊息。
   */
  _tickLock(now) {
    if (this.dead || this.shopOpen || !this.side) return;
    if (now - (this._lockAt || 0) < 0.25) return;
    this._lockAt = now;
    const def = this._curWeapon().def;
    if (!def) return;
    // 拋物線武器(trajClass 'lob'):鎖定光暈吃**火控解**而非準星直射線 —— 使用者規則
    // 「射程光暈要在拋物線對準時才亮」:準星壓在敵人身上但彈道被稜線擋住/超出包絡 = 打不到,
    // 就不該亮(舊制拿直射線判定 ⇒ 光暈亮著卻常常沒命中)。MUST NOT 在此另解一次彈道。
    const fc = this._lobFc;
    if (fc?.on) {
      if (fc.ok && fc.ent && fc.ent.side !== this.side && !fc.ent.neutral && !fc.ent.dead) {
        this.net.send({ t: 'lock', id: fc.ent.id });
      } else this._clearLockGlow();
      return;
    }
    const rng = def.range * this._altRangeMul(def);   // 高度制空:高空無人機對地拉遠鎖定/射程
    const { ent, point } = this._resolveAim(rng);
    // 準星精確掃到射程內敵方 → 回報鎖定(伺服器仍會複驗)
    if (ent && ent.side !== this.side && !ent.neutral && point && this.pos.distanceTo(point) <= rng) {
      this.net.send({ t: 'lock', id: ent.id });
      return;
    }
    // ② 錐形瞄準輔助:中心單射線常穿過 humanoid 四肢縫隙,或狙擊模式移動靠近時準星微偏 → 射線瞬間掃空。
    //    取準星小錐內、射程內、視線無遮擋的敵方英雄(遲滯優先既有鎖定),維持/取得鎖定不閃斷。
    const soft = this._coneAcquire(rng);
    if (soft) { this.net.send({ t: 'lock', id: soft.id }); return; }
    this._clearLockGlow();
  }

  /** 錐形瞄準輔助 + 黏著:準星錐(~8°)內、射程內、`_obstHitT` 無遮擋的存活敵方英雄;
   *  既有鎖定仍合格則優先保留(遲滯,防忽明忽滅)。只鎖英雄(NPC/塔體型大,精確射線本就打得中)。 */
  _coneAcquire(rng) {
    const ro = this.camera.position;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const CONE = 0.14;   // ~8°
    const score = (ent) => {   // 合格回傳夾角(rad;越小越正對),不合格回 -1
      if (!ent || ent.side === this.side || ent.neutral || !ent.hero || !ent.mesh.visible || ent.dead) return -1;
      const c = ent.mesh.position.clone();
      c.y += (ent.dimTop != null ? ent.dimTop - ent.dimH * 0.5 : 2);   // 瞄機體幾何中心
      if (this.pos.distanceTo(c) > rng) return -1;                     // 出射程
      const to = c.clone().sub(ro), ang = fwd.angleTo(to);
      if (ang > CONE) return -1;                                       // 錐外
      const dB = this._obstHitT(ro.x, ro.y, ro.z, c.x, c.y, c.z);
      return (dB != null && dB < to.length() - 1) ? -1 : ang;          // 障礙擋在目標前 = 失去火控
    };
    const cur = this._lockId != null ? this.ents.get(this._lockId) : null;
    if (cur && score(cur) >= 0) return cur;                            // 遲滯:既有鎖定仍在錐內不切換
    let best = null, bestAng = CONE + 1;
    for (const ent of this.ents.values()) {
      const a = score(ent);
      if (a >= 0 && a < bestAng) { best = ent; bestAng = a; }
    }
    return best;
  }

  // ---------------- 餌機(機甲 F:分離發射)----------------
  /** 發射請求;航向由伺服器取當下機首朝向,玩家無法操舵 */
  _launchDecoy() {
    if (this.isDrone || !this.side) return;
    if (!this.decoyDocked) {
      this.hud.feed?.(`🔧 餌機重組中(${(this.decoyCd || 0).toFixed(0)}s)`);
      return;
    }
    this.net.send({ t: 'decoy' });
  }

  /** 掛點餌機:組合(慢慢裝上)/ 分離(瞬間彈出)的縮放動畫 */
  _updateDecoyPod(ent, dt) {
    const pod = ent.mesh.userData.decoyPod;
    pod.userData.s0 ??= pod.scale.x;
    pod.userData.x0 ??= pod.position.x;
    const want = ent.dock ? 1 : 0;
    const s = ent.podS ?? want;
    const rate = want ? 2.4 : 9;   // 組合:機械臂慢慢裝填;分離:彈射瞬間抽離
    ent.podS = s + Math.max(-rate * dt, Math.min(rate * dt, want - s));
    pod.visible = ent.podS > 0.02;
    pod.scale.setScalar(pod.userData.s0 * ent.podS);
    pod.position.x = pod.userData.x0 - (1 - ent.podS) * 1.2;   // 分離時往外滑開
  }

  /** 目前被自己鎖定的目標:加上脈動光暈 */
  _setLockGlow(ent) {
    if (this._lockId === ent.id) return;
    this._clearLockGlow();
    this._lockId = ent.id;
    // 基準尺寸(排除護盾殼等子節點)→ 光暈剛好包住目標,塔不再是巨球
    this._lockGlow = lockGlow(ent.mesh, SIDES[this.side].color,
      ent.dimH != null ? { h: ent.dimH, r: ent.dimR, top: ent.dimTop } : null);
    this.hud.feed?.(`🎯 鎖定 ${UNITS[ent.kind]?.name || ent.kind}`);
  }

  _clearLockGlow() {
    if (!this._lockGlow) { this._lockId = null; return; }
    this._lockGlow.parent?.remove(this._lockGlow);
    this._lockGlow = null;
    this._lockId = null;
  }

  /** 命中鎖定目標:讓其鎖定光暈短暫閃亮(vfx.lockGlow 讀 userData.flashAt 衰減)*/
  _flashLockGlow() {
    if (this._lockGlow) this._lockGlow.userData.flashAt = performance.now();
  }

  // ---------------- 自身死亡 / 重生 ----------------
  _onSelfDeath() {
    this.dead = true;
    this.firing = false;
    this.aiming = false;
    this._fireDwell = 0; this._swampDwell = 0; this.hud.envFog?.(0); this._env = { code: 0, depth: 0, ground: 0, air: false };   // 死亡:清火場霧化/沼澤滯留(_updatePlayer 已早退不再更新)
    // 陣亡不再跳戰場選單:若當下正開著暫停選單(可能暫停中被擊殺),收掉它,只留陣亡頁
    if (this.paused) { this.paused = false; this.hud.pause?.(false); }
    // 商店保持開啟(陣亡購物):死亡畫面疊在商店下層,B/ESC 仍可開關
    document.exitPointerLock?.();

    // ── 陣亡過場(純表現層;伺服器已權威判定死亡)──
    // 於 _applySnap 觸發、早於本幀 _updatePlayer(對 dead 早退未覆寫 camera)→ camera/pos/vel 仍是死亡瞬間的活體姿態
    const fly = this._flying();
    const eye = this.camera.position.clone();                    // 死亡瞬間眼位(過場錨點)
    const surf = this._surf(this.pos.x, this.pos.z, this.pos.y); // 腳下站立表面(橋面/路面/地表)
    const col = sideInfo(this.side).color;                       // 陣營色(碎片 accent / 地環色)
    const dur = fly ? 2.4 : 2.0;
    // 飛行:重力依墜落高度自適應,確保多數高度在收尾前真正墜地(而非半空硬切鏡頭);仍以觸地偵測為準
    const T = dur - 0.55;
    const g = fly ? Math.min(95, Math.max(30, 2 * Math.max(2, eye.y - surf) / (T * T))) : 0;
    this._deathSeq = {
      t: 0, dur, fly, col, eye, surf, g,
      p: eye.clone(),                                            // 飛行墜落積分位置
      v: fly ? this.vel.clone().add(new THREE.Vector3(0, 5, 0)) : null, // 初速 + 微上拋讓弧線明顯
      yaw: this.yaw, pitch: this.pitch, roll: this.roll,
      // 飛行翻滾角速度(rad/s;per-axis 隨機,roll 為主翻滾);地面 null
      spin: fly ? new THREE.Vector3(
        (Math.random() * 2 - 1) * 2.4,                           // pitch
        (Math.random() * 2 - 1) * 1.6,                           // yaw
        (Math.random() < 0.5 ? -1 : 1) * (3.0 + Math.random() * 1.5), // roll
      ) : null,
      smokeAcc: 0, climax: false, holdUntil: 0,
    };
    this.hud.deathCine?.(true);                                  // 紅警邊框亮(白閃只在高潮/觸地觸發)
    // 地面:腳下起火煙柱(~2s);飛行:死亡高度補一記空中火花(die 事件的地面爆在下方,補視覺缺口)
    if (fly) starburst(this.scene, this.effects, eye.x, eye.y, eye.z, 3.0, 0xffb050);
    else this._deathPlume(this.pos.x, surf, this.pos.z);
  }
  _onSelfRespawn() {
    this.dead = false;
    this._deathSeq = null;        // 過場未播完就重生:硬切,交還 _updatePlayer 控制鏡頭
    this.hud.deathCine?.(false);  // 熄紅框(#deadOverlay 由本幀 e.dead=false 的 hud.dead(null) 自動隱藏)
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
      buy: (item) => this._optimisticBuy(item),
    };
  }

  /**
   * 商店購買:樂觀本地更新(立即扣款/升級 → UI 馬上回饋)+ 送伺服器(權威)。
   * 伺服器拒絕會回 error toast,下一份快照把 money/upg 校正回權威值(僅顯示層,不動 abil —— 讓
   * 快照的 _setChar 重算武器/招式)。修「點了要等一下才生效」的延遲感。
   */
  _optimisticBuy(item) {
    const applied = (() => {
      const up = Object.hasOwn(ECON.UPGRADES, item) ? ECON.UPGRADES[item] : null;
      if (!up) return false;
      const lvl = this.upg[item] || 0;
      if (lvl >= up.max) return false;
      const price = upgradePrice(up, lvl);
      if (this.money < price) return false;
      this.money -= price; this.upg[item] = lvl + 1;
      // 戰鬥面向:同步樂觀推進 abil 階(權威快照會校正);光/重武器另重算武器數值
      if (up.abil) {
        this.abil[up.abil] = 1 + this.upg[item];
        if (up.abil === 'light' || up.abil === 'heavy') this._setChar(this.ch, true);
      }
      return true;
    })();
    if (applied && this.shopOpen) { this._shopSig = null; this.hud.shop?.(true, this._shopState()); }
    this.net.send({ t: 'buy', item });
  }

  _toggleShop(force) {
    if (!this.side) return;   // 死亡不擋:重生等待也能購買
    const want = force != null ? force : !this.shopOpen;
    if (want === this.shopOpen) return;
    this.shopOpen = want;
    this._shopSig = null;   // 重置商店重繪簽章(見 _applySnap 的 gate)
    this.firing = false;
    this.hud.shop?.(want, want ? this._shopState() : null);
    if (want) document.exitPointerLock?.();
  }

  /** 己方主堡往敵方方向 100m、面向敵方主堡 */
  _spawnAt() {
    const mySide = this.side || 'SWARM';
    const other = mySide === 'SWARM' ? 'STEEL' : 'SWARM';
    const [bx, bz] = llToWorld(this.cfg.bases[mySide][0], this.cfg.bases[mySide][1], this.center);
    // 沿「主堡所在的那條兵線」推出生成點 + 面向兵線前進方向 → 一重生就正對兵線箭頭(而非直線指向敵堡)
    let sx, sz, dx, dz;
    let bestLane = null, bd = Infinity;
    for (const L of (this.cfg.lanes || [])) {
      const w = L.map(([lat, lng]) => llToWorld(lat, lng, this.center));
      if (w.length < 2) continue;
      const seq = mySide === 'SWARM' ? w : w.slice().reverse();   // 從我方主堡端往敵方排序
      const d = Math.hypot(seq[0][0] - bx, seq[0][1] - bz);
      if (d < bd) { bd = d; bestLane = seq; }
    }
    if (bestLane) {
      let acc = 0;   // 沿兵線走 HERO_SPAWN_OFF 找生成點(貼著兵線 → 更靠近)
      for (let i = 0; i < bestLane.length - 1; i++) {
        const ax = bestLane[i][0], az = bestLane[i][1];
        const seg = Math.hypot(bestLane[i + 1][0] - ax, bestLane[i + 1][1] - az) || 1;
        dx = bestLane[i + 1][0] - ax; dz = bestLane[i + 1][1] - az;
        if (acc + seg >= GAME.HERO_SPAWN_OFF || i === bestLane.length - 2) {
          const t = Math.min(1, (GAME.HERO_SPAWN_OFF - acc) / seg);
          sx = ax + dx * t; sz = az + dz * t; break;
        }
        acc += seg;
      }
    } else {
      const [ex, ez] = llToWorld(this.cfg.bases[other][0], this.cfg.bases[other][1], this.center);
      dx = ex - bx; dz = ez - bz; const len = Math.hypot(dx, dz) || 1;
      sx = bx + dx / len * GAME.HERO_SPAWN_OFF; sz = bz + dz / len * GAME.HERO_SPAWN_OFF;
    }
    // 橫向偏移到路旁:重生點落在兵線中央會被剛生出/行進中的 NPC 波次撞開,偏出兵線走廊即可避開
    // (伺服器 _spawnPoint 同一偏移;垂直於兵線前進方向,不影響面向兵線箭頭的 yaw)
    const pl = Math.hypot(dx, dz) || 1;
    sx += (dz / pl) * GAME.HERO_SPAWN_SIDE;
    sz += (-dx / pl) * GAME.HERO_SPAWN_SIDE;
    const gy = this._surf(sx, sz, Infinity);
    this.pos.set(sx, gy + (this.isDrone ? 40 : 0), sz);
    this.yaw = Math.atan2(-dx, -dz);   // 面向兵線前進方向(three:-z 前方)→ 看得到兵線箭頭
    this.pitch = -0.05;
    // 變形機甲:重生一律地面型態
    // 蓄力/騰空狀態一律歸零(robot 蓄力中陣亡 → 重生殘留 charge 會立刻誤觸蓄力跳)
    this.charge = 0;
    this._lowG = false;
    if (this.isMorph) {
      this.flight = false;
      this.baseFov = UNITS.morph.fov;
    }
  }

  // ---------------- 變形機甲:型態切換(蓄力彈射 ↔ 觸地變形)----------------
  /** 地面型 → 飛行型:蓄力彈射(初速 ∝ 蓄力比例),FOV 拉廣;變形中段附無敵幀請求 */
  _morphLaunch(gy) {
    this.flight = true;
    this.vel.y = MORPH.JUMP_V * this.charge;
    this.vy = 0;
    this.pos.y = gy + 1.0;   // 抬離地表,避免下一幀立即觸發觸地變形
    this.charge = 0;
    this.baseFov = UNITS.morph.fovAir;
    this.trauma = Math.min(1, this.trauma + 0.4);
    this._reqIframe();
    shockRing(this.scene, this.effects, this.pos.x, gy, this.pos.z, 7, 0xffd27a);
    this.hud.feed?.('🛫 蓄力彈射:變形為飛行型態!(觸地變形回地面型)');
  }

  /** 飛行型 → 地面型:觸地變形;變形中段附無敵幀請求 */
  _morphLand(gy) {
    this.flight = false;
    this.pos.y = gy;
    this.vy = 0;
    this.vel.y = 0;
    this.baseFov = UNITS.morph.fov;
    this.trauma = Math.min(1, this.trauma + 0.3);
    this._reqIframe();
    shockRing(this.scene, this.effects, this.pos.x, gy, this.pos.z, 5, 0x9adfff);
    this.hud.feed?.('🦿 觸地變形:地面型態!(按住 Space 蓄力跳返回飛行)');
  }

  // ---------------- 機甲蓄力跳躍(2026-07-16;robot 限定,常數住 data.js CJUMP)----------------
  /** 垂直彈射 ∝ 蓄力 + 沿視線水平推進(距離 ∝ 機體速度);騰空低重力 = 太空漫步;起跳離地即請求無敵幀 */
  _chargeJump(u) {
    const k = this.charge;
    this.vy = CJUMP.V * k * this._modF('jump');
    this._lowG = true;
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    look.y = 0;
    if (look.lengthSq() > 0) look.normalize();
    const fwd = u.speed * this._modF('speed') * CJUMP.FWD_F * k;   // 前向彈射初速 ∝ 機體速度 ⇒ 最大距離同比
    this.vel.x += look.x * fwd;
    this.vel.z += look.z * fwd;
    this.trauma = Math.min(1, this.trauma + 0.25);
    this._reqIframe();   // 起跳離地即 1s 無敵(伺服器驗 IFRAME.CD)
    shockRing(this.scene, this.effects, this.pos.x, this.pos.y, this.pos.z, 5, 0xbfe6ff);
    this.hud.feed?.('🦿 蓄力跳躍!(騰空低重力滑行)');
  }

  // ---------------- 無人機完美迴避(2026-07-21;drone 限定,常數住 data.js IFRAME)----------------
  /** 戰鬥中按空白鍵飛行:向上迴避衝刺 + 起飛離地當下請求 1s 無敵(伺服器驗 30s CD);本地 _dodgeCd 樂觀閘門 + HUD */
  _perfectDodge(u, now) {
    this._dodgeCd = now + IFRAME.DRONE_CD;   // 樂觀本地 CD(HUD + 客戶端閘門;伺服器 heroIframe 為權威後盾)
    this.vel.y += u.vspeed;                   // 向上迴避衝刺(疊在正常爬升上)
    this.trauma = Math.min(1, this.trauma + 0.3);
    this._reqIframe();
    shockRing(this.scene, this.effects, this.pos.x, this.pos.y, this.pos.z, 6, 0x8fd7ff);
    this.hud.feed?.('🛡️ 完美迴避!(向上飛・1s 無敵)');
  }

  /** 請求無敵幀(蓄力跳 / 升空變形起跳離地 / 無人機完美迴避):時長與 CD 由伺服器 heroIframe 權威把關
   *  (機甲/傭兵 15s、無人機 30s),這裡只做防連發節流 —— 被伺服器拒絕(CD 中)就什麼都不會發生。 */
  _reqIframe() {
    const now = performance.now() / 1000;
    if (now < (this._ifReqAt || 0) + 1.5) return;
    this._ifReqAt = now;
    this.net?.send({ t: 'iframe' });
  }

  // ---------------- 射擊(彈道學:初速 mv + 重力 9.81,射程上限)----------------
  /** 目前武器:平時 = 輕武器,右鍵切換瞄準 = 重武器(CD 型) */
  _curWeapon() {
    const id = this.aiming && this.wdef.heavy ? 'heavy' : 'light';
    return { id, def: this.wdef[id], st: this.wstate[id] };
  }

  /** 高度制空(客戶端):高空無人機的輕/機槍武器對地射程拉遠(伺服器 _altRange 同步驗證);
   *  以「離站立表面高度 _altAG」求 f(與回報 y 同源)。其餘機體 = 1。 */
  _altRangeMul(def) {
    if (!def || !this.isDrone || !isGunnery(def)) return 1;
    return 1 + ALTITUDE.RANGE * altF(this._altAG || 0);
  }

  /** 磁軌蓄力狀態切換:廣播離散事件(比照 heroCast 的 'cast' 事件),
   *  讓其他玩家的畫面也能看到我方 rail 重武器的蓄力窗(戰術情報,非美術裝飾)。 */
  _setRailCharge(on) {
    if (!!this._railCharging === !!on) return;
    this._railCharging = on;
    this.net?.send({ t: 'heavyCharge', on });
  }

  /** 填彈:R 鍵手動 / 打空自動(重武器的「填彈」= CD);完成在 _tickWeapons 補滿 */
  _startReload(id) {
    const wid = id || this._curWeapon().id;
    const def = this.wdef[wid], st = this.wstate[wid];
    if (!def || !st || st.reloadEnd > 0 || st.ammo >= def.mag) return;
    st.ammo = 0;
    // 填彈/冷卻時長 = 武器階級解析後的 reload(2026-07-20:折減併入階級,伺服器 _reloadT 同一條)
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
    if (def?.type === 'beam' || def?.type === 'rail') return { dz: swing * 0.4, dy: 0, rx: 0 };  // 能量/磁軌:整管後拉充能
    if (def?.type === 'launcher' || def?.type === 'missile' || def?.type === 'plasma')
      return { dz: 0, dy: 0, rx: -swing * 0.5 };   // 發射器/飛彈/電漿罐:上掀開膛裝填
    return { dz: 0, dy: -swing * 0.22, rx: swing * 0.12 };                     // 槍械:退彈匣再扣回
  }

  // (重武器掛點動畫已整併進 locomotion.js stepCombatFx —— _updateEnts 於 stepLocomotion 前呼叫)

  /** 第三人稱槍口世界座標:依 pid 找機體 rig.muzzles 錨(models.js 各 builder 登記),
   *  曳光/槍口爆從機體實際槍管射出,不再用射手 FPV 座標(機體越大偏差越大)。
   *  找不到錨(NPC/舊模型)、自己(FPV 已畫)一律退回訊息座標;三機小隊取離訊息座標
   *  最近那架(訊息只描述開火的那一架)。變形機甲飛行型 2026-07-17 起不再退回訊息座標 ——
   *  手持機種雙臂前伸、肩扛機種轉到背部,槍口錨在飛行中一樣朝航向(models.js 變形時窗)。 */
  _entMuzzle(pid, slot, fallback) {
    if (pid == null) return fallback;
    let best = null, bd = Infinity;
    for (const ent of this.ents.values()) {
      if (ent.pid !== pid || ent.isSelf) continue;
      const mz = ent.mesh?.userData?.rig?.muzzles?.[slot === 'heavy' ? 'heavy' : 'light'];
      if (!mz?.n || mz.fxOnly) continue;   // fxOnly = 只掛槍口焰的後向錨(蜂后螫針),曳光不從它出
      const d = ent.mesh.position.distanceToSquared(fallback);
      if (d < bd) { bd = d; best = mz.n; }
    }
    if (!best) return fallback;
    return best.getWorldPosition(new THREE.Vector3());
  }

  /** 開火事件 → 射手第三人稱機體的戰鬥動畫(後座/射姿保持;stepCombatFx 以 t0 邊緣觸發)。
   *  一個 pid 底下可能有三架(蜂群小隊)—— 全數標記,僚機齊射的視覺一致。
   *  重武器擊發同步標記 heavyFx(掛點反向過衝/槍口焰):bot 英雄沒有 heavyFire 訊息,
   *  只靠 shot 事件走到這裡,不標記就看不到重武器的擊發演出。 */
  _markFire(pid, slot, t0, aim) {
    if (pid == null) return;
    for (const ent of this.ents.values()) {
      if (ent.pid !== pid || ent.isSelf) continue;
      ent.fireFx = { t0, slot: slot === 'heavy' ? 'heavy' : 'light' };
      if (slot === 'heavy') ent.heavyFx = { phase: 'fire', t0 };
      // 交戰面向(2026-07-22 規則 1):記下攻擊目標 —— 靜止的 bot/僚機在 _updateEnts
      // 轉身面向它(槍口朝攻擊方向;移動中照舊面向移動方向)
      if (aim) ent._aimAt = { x: aim.x, z: aim.z, y: aim.y, until: t0 + 2.5 };
    }
  }

  /** NPC/建築的槍口世界座標(shot 事件):塔 = 砲塔砲口輪替、主堡 = 兩門大砲(ev.gi)、
   *  其餘 = rig.muzzles.light 錨;查無錨(舊模型/駐守碉堡隱藏)退回訊息座標 + 機體高度概略。 */
  _npcMuzzle(ent, ev, fx, fz) {
    if (ent && ent.mesh.visible) {
      const ms = ent.mesh.userData.turretMuzzles;
      if (ms?.length) {
        // 多槍口輪替擊發:塔(雙管/六管)與直升機(左右莢/側掛雙槍)共用同一條
        ent._mzi = ((ent._mzi ?? -1) + 1) % ms.length;
        return ms[ent._mzi].getWorldPosition(new THREE.Vector3());
      }
      if (ent.kind === 'base') {
        const mz = ent.gunMuzzles?.[ev.gi ?? 0];
        if (mz) {
          // 記下本發目標:_updateEnts 把該門砲管平滑轉向它(槍口朝攻擊方向)
          (ent._gunAim ??= [])[ev.gi ?? 0] = { x: ev.to[0], z: -ev.to[1], until: performance.now() / 1000 + 3 };
          return mz.getWorldPosition(new THREE.Vector3());
        }
      } else {
        const mz = ent.mesh.userData.rig?.muzzles?.light;
        if (mz?.n) return mz.n.getWorldPosition(new THREE.Vector3());
      }
    }
    // 駐守碉堡的步槍兵(gar:機體隱藏在工事裡):曳光自「面向目標的射孔」射出,
    // 不再從碉堡中心上方憑空冒出(規則 3;碉堡射孔高度 ≈ 1.9m、八角主體外緣半徑 ≈ 3.0)
    if (ent?.gar && !ent.mesh.visible) {
      const dx = ev.to[0] - fx, dz = -ev.to[1] - fz;
      const d = Math.hypot(dx, dz) || 1;
      const gy0 = this.terrain.heightAt(fx, fz);
      return new THREE.Vector3(fx + dx / d * 3.0, gy0 + 1.9, fz + dz / d * 3.0);
    }
    const gy = this.terrain.heightAt(fx, fz);
    const oy = ev.oy ?? (ent ? (ent.mesh.position.y - gy) + ent.dimH * 0.6 : 2);
    return new THREE.Vector3(fx, gy + oy, fz);
  }

  /** 拋物線曳光(榴彈兵/坦克攻城砲):多段短束沿彈道畫弧,並把「出膛切線角」回寫射手 ——
   *  手持榴彈槍走 rig.gunR.aim(gunPitch 每幀消費);車載砲塔走 ent._arcPitch
   *  (_aimVehicleTurret 的 pitch 節點消費)—— 拋物線武器的槍口角度與射擊角度一致。 */
  _arcTracer(from, to, col, ent) {
    // 彈道學真解(2026-07-23):舊制用 h = 射距 × 0.22 畫弧 —— 那是一條與距離等比的裝飾曲線,
    // 不是彈道(使用者:「拋物線都固定線條」)。改與玩家榴彈共用 _lobVel:取**打得到的最低裝藥號數**
    // (真實榴彈砲選裝藥的作法),弧高與出膛仰角因此隨射距/高差改變。
    const dx = to.x - from.x, dz = to.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const Z = BALLISTIC.LOB_CHARGE;
    let v0 = BALLISTIC.LAUNCH_MV;
    for (let k = Z.length - 1; k >= 0; k--) {   // 由最低號數往上找第一個有實數解的
      const v = BALLISTIC.LAUNCH_MV * Z[k];
      if (this._lobSolve(from, to, v).ok) { v0 = v; break; }
    }
    const vel = this._lobVel(from, to, v0);
    const T = d / Math.max(1e-3, Math.hypot(vel.x, vel.z));   // 飛抵目標的飛行時間
    const N = 8;
    let prev = from;
    for (let i = 1; i <= N; i++) {
      const t = T * i / N;
      const p = new THREE.Vector3(
        from.x + vel.x * t,
        from.y + vel.y * t - 0.5 * BALLISTIC.G * t * t,
        from.z + vel.z * t);
      // 拋物線逐段吃障礙截斷:弧線打進建物/神木/巨岩即止於面上(火花),不畫穿體
      const clip = this._clipBeam(prev, p);
      beamLine(this.scene, this.effects, prev, clip.to, col, { ttl: 0.3, w: 0.05 });
      if (clip.cut) { starburst(this.scene, this.effects, clip.to.x, clip.to.y, clip.to.z, 1.2, col); break; }
      prev = p;
    }
    const ang = Math.atan2(vel.y, Math.hypot(vel.x, vel.z));   // 出膛仰角 = 火控解的發射角
    const gp = ent?.mesh?.userData?.rig?.gunR;
    if (gp) gp.aim = (gp.comp || 0) - ang;
    else if (ent?.mesh?.userData?.turret?.userData?.pitch)
      ent._arcPitch = { v: ang, until: performance.now() / 1000 + 2.5 };
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
    // 只對單位/飛彈與地形網格做 raycast(地貌植被是純視覺,不擋子彈也不吃效能);
    // 建物/神木/巨岩等「有物理碰撞的障礙」另以解析圓柱判定(_blockerHitT)——
    // 準星射線先撞到障礙 → 視同打在障礙上(看不到的單位就不能射擊/鎖定,beam/招式落點同樣被擋)。
    const hits = this.raycaster.intersectObjects([...targets, ...missileMeshes, this.terrain.mesh], true);
    const rEnd = this.raycaster.ray.at(far, new THREE.Vector3());
    const ro = this.raycaster.ray.origin;
    const dBlock = this._obstHitT(ro.x, ro.y, ro.z, rEnd.x, rEnd.y, rEnd.z);
    for (const h of hits) {
      if (dBlock != null && dBlock < h.distance) break;   // 障礙更近:落到下方的障礙回傳
      let o = h.object;
      while (o && !o.userData.kind && o.userData.missileId == null && o.parent) o = o.parent;
      if (o && o.userData.missileId != null) return { point: h.point, ent: null, missileId: o.userData.missileId };
      if (o && o.userData.kind) return { point: h.point, ent: [...this.ents.values()].find((en) => en.mesh === o), missileId: null };
      return { point: h.point, ent: null, missileId: null };   // 地形
    }
    if (dBlock != null) return { point: this.raycaster.ray.at(dBlock, new THREE.Vector3()), ent: null, missileId: null };
    return { point: rEnd, ent: null, missileId: null };
  }

  /** 命中回饋:星爆 + 準星標記 + 本地估算傷害數字(伺服器仍是權威) */
  _hitFeedback(def, ent, point) {
    this.hud.hitmark?.();
    // 命中鎖定目標 → 該目標的鎖定光暈短暫閃爍(射程範圍提示回饋)
    if (ent && this._lockId === ent.id) this._flashLockGlow();
    starburst(this.scene, this.effects, point.x, point.y, point.z, 2.6, 0xfff2b8);
    if (ent) {
      const mult = vsMult(def, ent.kind);
      // 本地估算含距離物理衰減(伺服器結算同一條公式,HUD 數字才對得上;火力成長走武器品質階級)
      const est = Math.round(def.dmg * mult * dmgFalloff(def, this.pos.distanceTo(point)));
      damageNumber(this.scene, this.effects,
        point.clone().add(new THREE.Vector3(0, 1.2, 0)), est, { big: mult >= 1.5 });
    }
  }

  // ---------------- 直線貫穿(aoeClass 'line':beam / rail / gun 重武器;2026-07-23)----------------
  /**
   * 回報射線給伺服器 heroLance(唯一權威),回傳本地估算的貫穿目標(由近至遠)供 HUD 回饋。
   * 座標轉換:three z 南 → 模擬 z 北(取負);y 一律送「離站立表面高」(與 {t:'pos'} 的 _altAG 同源)。
   * oy 由呼叫端在**擊發當下**取樣後傳入 —— 動能彈飛行 0.1~0.4 秒才定案落點,拿當幀高度會漂。
   */
  _sendLance(from, to, def, oy = null) {
    const seg = to.clone().sub(from);
    const len = seg.length();
    if (len < 0.01) return [];
    const d = seg.clone().divideScalar(len);
    const y = oy != null ? oy : (this._altAG || 0) + (from.y - this.pos.y);
    const q = (v) => Math.round(v * 1000) / 1000;
    this.net?.send({
      t: 'lance',
      o: [Math.round(from.x * 10) / 10, Math.round(-from.z * 10) / 10, Math.round(y * 10) / 10],
      d: [q(d.x), q(-d.z), q(d.y)],
      len: Math.round(len * 10) / 10,
    });
    return this._lancePierced(from, to, lanceR(def));
  }

  /** 射線圓柱內的敵方單位(純本地估算:傷害數字/命中標記;伺服器另有迷霧 + LOS 複驗)*/
  _lancePierced(from, to, r) {
    const seg = to.clone().sub(from);
    const len = seg.length() || 1;
    const d = seg.clone().divideScalar(len);
    const rel = new THREE.Vector3();
    const out = [];
    for (const ent of this.ents.values()) {
      if (ent.isSelf || ent.side === this.side || !ent.mesh.visible) continue;
      rel.copy(ent.mesh.position).sub(from);
      const s = rel.dot(d);
      if (s < 0 || s > len) continue;
      // 大機體吃自身碰撞半徑(伺服器是點判定 + 垂直帶,這裡補回視覺體積的落差)
      if (rel.addScaledVector(d, -s).length() > r + (ent.heroCol?.r || 0) * 0.5) continue;
      out.push({ ent, s });
    }
    out.sort((a, b) => a.s - b.s);
    return out.slice(0, LANCE.MAX).map((k) => k.ent);
  }

  /** 貫穿命中回饋:首個目標全額,之後逐個 ×LANCE.DECAY(與伺服器 heroLance 同一條公式) */
  _lanceFeedback(def, ents, point) {
    if (!ents.length) { starburst(this.scene, this.effects, point.x, point.y, point.z, 1.4, 0xcfc4a8); return; }
    this.hud.hitmark?.();
    for (let i = 0; i < ents.length; i++) {
      const ent = ents[i];
      const p = ent.mesh.position;
      if (this._lockId === ent.id) this._flashLockGlow();
      starburst(this.scene, this.effects, p.x, p.y + 1.4, p.z, i === 0 ? 2.8 : 2.0, 0xfff2b8);
      const mult = vsMult(def, ent.kind);
      const est = Math.round(def.dmg * mult * dmgFalloff(def, this.pos.distanceTo(p)) * LANCE.DECAY ** i);
      damageNumber(this.scene, this.effects,
        p.clone().add(new THREE.Vector3(0, 1.2, 0)), est, { big: i === 0 && mult >= 1.5 });
    }
  }

  /**
   * 貫穿彈道演出(自機與他人共用):
   *   beam  → 鋼彈式光束(熾白內芯 + 外暈 + 行進能量環);
   *   rail/gun → 高速穿透通道(細亮曳光柱 + 兩端衝擊環 —— 空氣被撕開的彈道)。
   * 圓柱半徑一律取 lanceR(def) ⇒ **看到多粗就是打到多粗**,不是裝飾性放大。
   */
  _lanceVisual(from, to, def, side, barrage = false) {
    const { col, hot } = this._shotCols(side);
    const r = lanceR(def) * (barrage ? 1.5 : 1);
    if (def.type === 'beam') {
      const bcol = side === 'SWARM' ? 0xa8fff2 : 0xd2b8ff;
      gundamBeam(this.scene, this.effects, from, to, bcol,
        { r, ttl: barrage ? 0.62 : 0.5, rings: barrage ? 6 : 4, core: hot });
      shockRing(this.scene, this.effects, from.x, from.y, from.z, r * (barrage ? 1.7 : 1.15), bcol);
      return;
    }
    beamLine(this.scene, this.effects, from, to, col, { ttl: 0.26, w: r * 0.45 });
    beamLine(this.scene, this.effects, from, to, hot, { ttl: 0.16, w: r * 0.16 });
    shockRing(this.scene, this.effects, from.x, from.y, from.z, r * 1.2, hot);
    starburst(this.scene, this.effects, to.x, to.y, to.z, r * 1.5, col);
  }

  /**
   * 雷射導引武器(trajClass 'guide')的第一人稱導引雷射:瞄準時自槍口射出一條指向準星目標的
   * 細雷射 + 落點十字環 —— 彈體離架後就是騎這條波修正航向(見 _updateBullets 的 guide 分支)。
   * 逐幀更新故 **MUST NOT** 每幀重建幾何:單一持久 Mesh 以 position/scale/quaternion 驅動
   * (與 _arcGuide 的預配置緩衝同一條紀律)。
   */
  _updateGuideLaser() {
    const showable = this.side && !this.dead && !this.shopOpen && this.aiming;
    const { def } = showable ? this._curWeapon() : {};
    if (!showable || !def || trajClass(def) !== 'guide' || !this.gunGroup) {
      if (this._gLaser) this._gLaser.group.visible = false;
      return;
    }
    if (!this._gLaser) this._ensureGuideLaser();
    const g = this._gLaser;
    g.group.visible = true;
    this.camera.updateMatrixWorld();
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const from = this.gunGroup.localToWorld(this._muzzle.clone());
    const { point } = this._resolveAim(def.range * this._altRangeMul(def));
    const seg = point.clone().sub(from);
    const len = Math.max(0.5, seg.length());
    g.beam.position.copy(from).addScaledVector(seg, 0.5);
    g.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.clone().normalize());
    g.beam.scale.set(1, len, 1);
    g.ring.position.copy(point).addScaledVector(dir, -0.4);
    g.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    // 導引窗:最短距離(ARMING.guide.m)內彈體仍在軌跡修正期 —— 環變紅示警「太近,會打歪」
    const armed = len >= ARMING.guide.m;
    g.ring.material.color.setHex(armed ? 0xff5f4a : 0xffd24a);
    g.ring.scale.setScalar(armed ? 1 : 1.5 + 0.4 * Math.sin(performance.now() / 90));
  }

  _ensureGuideLaser() {
    if (this._gLaser) return;
    const group = new THREE.Group();
    group.userData.noOutline = true;
    const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true), mat(0xff5f4a, 0.55));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 20), mat(0xff5f4a, 0.9));
    ring.material.side = THREE.DoubleSide;
    beam.userData.noOutline = ring.userData.noOutline = true;
    group.add(beam, ring);
    this.scene.add(group);
    this._gLaser = { group, beam, ring };
  }

  _tryFire(now) {
    if (!this.side || this.dead || this.shopOpen || !this.ch) return;
    const { id, def, st } = this._curWeapon();
    if (!def || !st) return;
    // 重砲傾洩窗(非變形機甲重砲模式):此窗內解除射速閘與電力門檻(0.5s 傾洩剩餘彈夾),射程 +20%。
    // 觸發手勢是「狙擊模式長按右鍵」→ 窗內逐幀自動擊發清空彈夾,不需另按住開火鍵(否則彈夾根本不會傾洩)。
    const barraging = id === 'heavy' && (this._barrageUntil || 0) > now;
    if (!this.firing && !barraging) return;
    if (this.empLeft > 0) {
      if (now - (this._empWarnAt || 0) > 1.5) { this._empWarnAt = now; this.hud.feed?.('⚡ 武器離線(遭電磁癱瘓)!'); }
      return;
    }
    const rMul = barraging ? BARRAGE.RANGE_F : 1;
    // 蓄力中切換武器(放開瞄準)= 取消磁軌蓄力
    if (this._railAt && def.type !== 'rail') { this._railAt = 0; this.flash?.scale.setScalar(1); this._setRailCharge(false); }
    if (!barraging && now - (this.lastFireAt[id] || 0) < 1 / def.rate) return;
    if (st.reloadEnd > 0) return;                       // 填彈 / 冷卻中
    if (st.ammo <= 0) { this._startReload(id); return; } // 打空自動填彈
    // 重武器擊發需電力(伺服器 _gateFire 權威;此為本地預測 + HUD 提示)
    const mpc = id === 'heavy' ? heavyMpCost(def) : 0;
    if (!barraging && mpc > 0 && this.mp < mpc) {
      if (now - (this._mpWarnAt || 0) > 1.5) { this._mpWarnAt = now; this.hud.feed?.(`🔋 電力不足(【${def.name}】每發需 ${mpc} MP)`); }
      return;
    }

    const prof = def.recoil || {};
    // 連射回穩(中後座輕武器):連發 N 發後強制回穩,此間不能擊發(與換彈匣機制分離)
    if ((this._settleUntil[id] || 0) > now) return;
    // 高後座重武器:須先「停下 + 穩定」steady 秒才能擊發(狙擊 / 超電磁炮 / 導引飛彈)——
    // rail 用既有 charge 當穩定時間,其餘型別用 steady 計時器;移動中一律無法穩定。
    if (prof.steady > 0) {
      if (this._moveInput()) {
        if (this._railAt || this._steadyAt) { this._railAt = 0; this._steadyAt = 0; this._setRailCharge(false); this.flash?.scale.setScalar(1); }
        if (now - (this._steadyWarnAt || 0) > 1.2) { this._steadyWarnAt = now; this.hud.feed?.(`🎯【${def.name}】須停下穩定後才能擊發`); }
        return;
      }
      if (def.type !== 'rail') {   // 非磁軌的高後座重武器:停穩計時到滿才擊發
        if (!this._steadyAt) { this._steadyAt = now; this._setRailCharge(true); this.hud.feed?.(`🎯【${def.name}】穩定中…`); }
        const sp = (now - this._steadyAt) / prof.steady;
        this.flash.visible = true; this._flashTtl = 0.06;
        this.flash.scale.setScalar(0.4 + Math.min(1, sp) * 2.4);
        if (sp < 1) return;
        this._steadyAt = 0; this.flash.scale.setScalar(1); this._setRailCharge(false);
      }
    }

    // 磁軌炮:按住開火鍵蓄力 charge 秒,蓄滿才擊發;提前放開 = 取消(不耗彈,歸零見 _updateSelf)
    if (def.type === 'rail' && def.charge) {
      if (!this._railAt) { this._railAt = now; this.hud.feed?.(`⚡【${def.name}】蓄力中…`); this._setRailCharge(true); }
      const p = (now - this._railAt) / def.charge;
      this.flash.visible = true;           // 蓄力視覺:槍口電光隨進度增亮
      this._flashTtl = 0.06;
      this.flash.scale.setScalar(0.4 + Math.min(1, p) * 2.4);
      if (p < 1) return;
      this._railAt = 0;
      this.flash.scale.setScalar(1);
      this._setRailCharge(false);
    }
    this.lastFireAt[id] = now;
    st.ammo--;
    if (mpc > 0 && !barraging) this.mp = Math.max(0, this.mp - mpc);   // 本地預測扣電(重砲窗免電力);快照回寫校正
    // 連射回穩計數(中後座輕武器;扇形武器不吃 —— 慢射速本身就是節奏)。
    // 回穩短暫(settle 秒)且準星上踢自明,不下 HUD 提示以免連射時洗版。
    if (prof.burst && !def.fan) {
      this._burstN[id] = (this._burstN[id] || 0) + 1;
      if (this._burstN[id] >= prof.burst) {
        this._burstN[id] = 0;
        this._settleUntil[id] = now + (prof.settle || 0.4);
      }
    }
    if (st.ammo <= 0) this._startReload(id);
    // 重武器擊發:廣播離散事件,驅動第三人稱機體的掛點動畫(自己與他人皆可見)
    if (id === 'heavy') this.net?.send({ t: 'heavyFire' });

    // 槍口與射向(座艙槍管末端,世界座標)
    this.camera.updateMatrixWorld();
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const muzzle = this.gunGroup
      ? this.gunGroup.localToWorld(this._muzzle.clone())
      : this.camera.position.clone().add(dir.clone().multiplyScalar(2));

    // 後座力(依武器分級 def.recoil):視角上踢(準星上移)+ 偏擺 + 槍身後坐 + 鏡頭震動 + 位移擊退
    // 位移懲罰(減速/停止)在 _updatePlayer 依 _recoilMove 夾住;'back' 每發沿槍口反向擊退。
    const fly = this._flying();
    const airF = fly ? RECOIL.AIR_F : 1;                                 // 空中位移懲罰減半(使用者指示)
    this.recoil.p += (prof.climb ?? (id === 'heavy' ? 0.033 : 0.011));   // 準星上踢(開火停止後快速回穩)
    this.recoil.y += (Math.random() - 0.5) * 0.006 * (prof.kick ?? 1);
    // 鏡頭震動:重砲擊發要有頓挫感(輕武器維持細碎抖動),巨炮傾洩窗內每發再放大 → 連發疊成持續轟鳴
    this.trauma = Math.min(1, this.trauma + SHAKE.FIRE * (prof.kick ?? 1)
      * (id === 'heavy' ? SHAKE.HEAVY_F : 1) * (barraging ? SHAKE.BARRAGE_F : 1));
    this.weaponKick = 1;
    this.flash.visible = true;
    this._flashTtl = 0.045;
    this._flashHeavy = id === 'heavy';   // 重武器槍口焰放大(FPV 明顯度)
    if (prof.back) this.vel.addScaledVector(dir, -prof.back * airF);
    this._recoilMove = prof.move || 'free';
    this._recoilSlowF = prof.slowF ?? 0.5;
    this._recoilMoveUntil = now + Math.max(0.22, 1 / def.rate) * 1.1;    // 位移懲罰持續到下一發窗口

    if (def.fan) {
      // 扇形武器(散彈 / 電漿):無彈道,命中由伺服器 heroPlasma 以「射向 + 夾角 + 射程」錐狀結算;
      // 本地畫扇形彈著(近距密、遠距散),slot 分輕(散彈)/ 重(電漿)。
      this._fanBlast(muzzle, dir, def, barraging);   // 巨炮傾洩窗:離子扇加寬加亮 + 射程 +20%(2026-07-22)
      this.net.send({ t: 'plasma', dx: dir.x, dz: -dir.z, slot: id });   // three z 南 → 模擬 z 北
      return;
    }

    if (def.type === 'beam') {
      // 定向能:光速直擊(trajClass 'line',無彈道下墜),仍受射程限制。
      const { point, ent, missileId } = this._resolveAim(def.range * this._altRangeMul(def) * rMul);   // 高度制空(重砲 +20%)
      const col = this.side === 'SWARM' ? 0xa8fff2 : 0xd2b8ff;
      this.net.send({ t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z], to: [point.x, point.y, point.z], slot: id, hit: 1 });
      // 直線貫穿一發只過一次 _gateFire ⇒ 來襲飛彈的擊落併進 heroLance 的圓柱掃描,
      // 這裡 MUST NOT 另送 hitMissile(會重複扣彈藥/電力)。
      if (missileId != null && aoeClass(def) !== 'line') this.net.send({ t: 'hitMissile', id: missileId, w: id });
      if (aoeClass(def) === 'line') {
        // 重武器光束 = 圓柱貫穿(伺服器 heroLance 沿射線結算全部目標);鋼彈式演出見 _lanceVisual
        this._lanceVisual(muzzle, point, def, this.side, barraging);
        this._muzzleBurst(muzzle, true, this.side);
        const oy = (this._altAG || 0) + (muzzle.y - this.pos.y);
        this._lanceFeedback(def, this._sendLance(muzzle, point, def, oy), point);
        return;
      }
      // 輕武器光束:不屬重武器三分類 —— 維持單體直擊(heroHit)
      this._tracer(muzzle, point, col, 0.35);
      this._muzzleBurst(muzzle, false, this.side);
      starburst(this.scene, this.effects, point.x, point.y, point.z, 2.2, col);
      if (missileId != null) this._hitFeedback(def, null, point);
      else if (ent) { this.net.send({ t: 'hit', id: ent.id, w: id }); this._hitFeedback(def, ent, point); }
      return;
    }

    // 彈道學子彈:初速 mv(真實參數)+ 重力下墜;超出射程即失效(FPS/DOTA 射程上限)
    // launcher/missile 皆為 AoE 戰鬥部;missile 帶著發射瞬間的準星鎖定 → 飛行中自動追蹤
    // 彈體同源(2026-07-22):與第三人稱/展示台同一顆 projectileMesh(飛彈=彈體+尾翼+導引頭、
    // 火箭=外露彈頭、動能=曳光條);曳光色 = 第三人稱曳光束同色(_shotCols)
    const aoe = def.type === 'launcher' || def.type === 'missile';
    const pierce = aoeClass(def) === 'line';   // rail 電磁彈射 / gun 反器材砲重武器:圓柱貫穿(不停在第一個目標)
    // 拋物線武器:出膛向量取本幀火控解(_lobAim 已於擊發前定案)—— 不是沿準星直射
    const lobFc = trajClass(def) === 'lob' && this._lobFc?.on ? this._lobFc : null;
    const mesh = projectileMesh(def, {
      col: this._shotCols(this.side).col,
      hue: CHARACTERS[this.ch]?.visual?.hue ?? 0xffd27a,
      heavy: id === 'heavy',
    });
    this.scene.add(mesh);
    mesh.position.copy(muzzle);
    const homing = def.type === 'missile' && this._lockId != null && this.ents.has(this._lockId)
      ? this._lockId : null;
    const v0 = this._shotV0(def, !!this._aaAim);   // 對空彈射(_updateAaMode 於本幀擊發前定案,與瞄準虛線同一份)
    // 最短距離(軌跡修正期):導引/射後不理武器離架後 arm.m 內導引尚未接手,且帶一次性初期散布
    // ⇒ 貼臉開導引彈會偏(命中率較低),拉開距離後導引/追蹤才把偏差修回來。
    const arm = armingOf(def);
    const fdir = arm ? this._armSpread(dir, arm.spread) : dir;
    const fvel = lobFc ? lobFc.vel.clone() : fdir.clone().multiplyScalar(v0);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fvel.clone().normalize());
    this.bullets.push({
      slot: id, aoe, pierce, r: def.r || 0,
      pos: muzzle.clone(), vel: fvel,
      dist: 0, max: def.range * this._altRangeMul(def) * rMul, mesh, origin: muzzle.clone(),   // origin:失鎖判定的圓心(攻擊範圍);高度制空拉遠 + 重砲 +20%
      oy: (this._altAG || 0) + (muzzle.y - this.pos.y),   // 擊發當下的槍口離地高(貫穿回報用;落點定案時本機可能已位移)
      // 巨炮傾洩窗內的重武器砲彈掛氣旋噴射尾流(2026-07-22)
      cyclone: barraging ? this._attachCyclone(mesh, this.side) : null, cycAcc: 0, cycCol: this._shotCols(this.side).col,
      mv: v0, guide: !!def.guide, homing, arm: arm ? arm.m : 0, barrage: barraging,
    });
    if (def.type === 'missile') this.hud.feed?.(homing ? '🚀 飛彈離架:追蹤鎖定目標!' : '🚀 飛彈離架:未鎖定,直飛');
    else if (def.guide) this.hud.feed?.('🔦 雷射導引:瞄準中彈體隨準星修正');
    // 自己 FPV 的槍口爆:重武器一律比輕武器大一號(輕武器已有 this.flash 球體,重武器再補世界爆閃)
    if (id === 'heavy') this._muzzleBurst(muzzle, true, this.side);
    // 其他客戶端的槍口視覺(對方不模擬我的彈道,給一條短曳光示意射向;帶 slot 讓對方分辨輕/重)。
    // 拋物線武器改送**火控瞄準點**:對方的 _spawnVisShell 以同一支 _lobVel 解算 ⇒ 兩端看到同一條弧
    // (送 60m 直線示意點會讓對方的彈體吊到我根本沒瞄的地方)。
    const to = lobFc
      ? [lobFc.aim.x, lobFc.aim.y, lobFc.aim.z]
      : [muzzle.x + dir.x * 60, muzzle.y + dir.y * 60, muzzle.z + dir.z * 60];
    this.net.send({
      t: 'tracer', from: [muzzle.x, muzzle.y, muzzle.z], to, slot: id,
      mv: lobFc ? Math.round(lobFc.v0) : undefined,   // 拋物線武器帶實際初速(裝藥號數),對方重現同一條弧
    });
  }

  /** 軌跡修正期的初期散布:在 dir 周圍的圓錐內取一個隨機偏角(離架瞬間一次性,之後由導引修正) */
  _armSpread(dir, spread) {
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const nx = new THREE.Vector3().crossVectors(dir, up).normalize();
    const nz = new THREE.Vector3().crossVectors(dir, nx).normalize();
    const a = Math.random() * Math.PI * 2, m = Math.tan(Math.random() * spread);
    return dir.clone().addScaledVector(nx, m * Math.cos(a)).addScaledVector(nz, m * Math.sin(a)).normalize();
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
    // 轉向助手:等速改向(推力彈體),每秒最大轉角 maxTurn(弧度)
    const steer = (b, want, maxTurn) => {
      const cur = b.vel.clone().normalize();
      const ang = cur.angleTo(want);
      if (ang > 1e-4) cur.lerp(want, Math.min(1, maxTurn * dt / ang)).normalize();
      b.vel.copy(cur.multiplyScalar(b.mv));
    };
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const prev = b.pos.clone();
      // 失鎖規則(與伺服器 _tickMissiles 同一條):目標/導引點跑出「攻擊範圍」(以發射點為圓心)
      // → 導引失效,之後只沿當下航向直線飛(吃重力),不再追擊。
      let tgt = b.homing ? this.ents.get(b.homing) : null;
      if (tgt && tgt.mesh.position.distanceTo(b.origin) > b.max) {
        b.homing = null; tgt = null;
        this.hud.feed?.('📡 目標脫離射程:飛彈失鎖(直線飛行)');
      }
      // 最短距離(軌跡修正期):離架 b.arm 公尺內導引/追蹤尚未接手 —— 只吃重力直飛,
      // 離架時的初期散布(_armSpread)因此無法被修正 ⇒ 近距離命中率較低(使用者定案規則)。
      const armed = b.dist >= (b.arm || 0);
      if (tgt && armed) {
        // 飛彈自動追蹤:朝鎖定目標修正航向(動力飛行,升力抵銷重力)
        const want = tgt.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)).sub(b.pos).normalize();
        steer(b, want, 3.2);
      } else if (armed && b.guide && this.aiming && b.slot === 'heavy') {
        // 雷射導引(騎波):朝準星射線上、彈體前方 40m 的導引點修正
        const ro = this.camera.position;
        const rd = this.camera.getWorldDirection(new THREE.Vector3());
        const along = Math.max(20, b.pos.clone().sub(ro).dot(rd) + 40);
        const gp = ro.clone().addScaledVector(rd, along);
        if (gp.distanceTo(b.origin) > b.max) {
          b.guide = false;                     // 導引點出了射程 → 雷射導引失效
          b.vel.y -= BALLISTIC.G * dt;
        } else {
          steer(b, gp.sub(b.pos).normalize(), 2.2);
        }
      } else {
        b.vel.y -= BALLISTIC.G * dt;                  // 重力下墜(拋物線彈道)
      }
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
          // 貫穿彈(aoeClass 'line'):單位不擋彈道,只有地形/障礙才終止 —— 圓柱內的目標
          // 由伺服器 heroLance 一次結算(這裡不逐個回報,避免同一發送出多筆傷害)
          if (o && o.userData.missileId != null) { if (b.pierce) continue; hit = { point: h.point, missileId: o.userData.missileId }; break; }
          if (o && o.userData.kind) { if (b.pierce) continue; hit = { point: h.point, ent: [...this.ents.values()].find((en) => en.mesh === o) }; break; }
          hit = { point: h.point, terrain: true };
          break;
        }
        // 實體障礙擋彈(建物/神木/巨岩/橋墩):障礙柱比 mesh 命中更近 → 彈頭止於障礙,
        // 不穿越造成傷害(伺服器 heroHit 另有 LOS 複驗,這裡是彈道本體)。
        const dB = this._obstHitT(prev.x, prev.y, prev.z, b.pos.x, b.pos.y, b.pos.z);
        if (dB != null && (!hit || dB < prev.distanceTo(hit.point))) {
          hit = { point: prev.clone().addScaledVector(seg.clone().divideScalar(len), dB), terrain: true };
        }
      }
      // 追蹤飛彈近炸引信:貼近鎖定目標即引爆(戰鬥部 AoE 由伺服器 heroBurst 結算)
      if (!hit && tgt && b.pos.distanceTo(tgt.mesh.position) < Math.max(4, (b.r || 0) * 0.5)) {
        hit = { point: b.pos.clone(), ent: tgt };
      }
      const done = hit || b.dist >= b.max;
      if (!done) {
        b.mesh.position.copy(b.pos);
        // 彈體一律對準航向(2026-07-22 彈藥同源:火箭/飛彈也是有頭尾的彈體,不再是無方向灰球)
        if (len > 0.001) b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), seg.normalize());
        if (b.cyclone) this._spinCyclone(b, dt);
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
        // y = 離地引爆高度(對空:直擊飛行目標時在其高度炸;sim._blast 吃 3D 距離)
        // lev = 爆點結構層(sim 隧道垂直隔離):彈道已被 _slabHitT 擋在天花外,
        //       故「世界 y 低於天花」只會發生在真的從洞口打進去的彈頭
        const btn = this.terrain.tunnelAt?.(p.x, p.z);
        this.net.send({ t: 'burst', x: p.x, z: -p.z, y: Math.max(0, Math.round((by - gy) * 10) / 10),
          lev: btn && by < btn.ceil ? 2 : 0 });   // three z 南 → 模擬 z 北
      } else if (b.pierce) {   // (貫穿彈的 missileId 分支不會成立:_updateBullets 已讓飛彈不擋彈道)
        // 直線貫穿:落點定案(地形/障礙/射程終點)才回報整條射線,伺服器沿圓柱一次結算全部目標。
        // 高初速近似直線(trajClass 'flat')⇒ 以「槍口→終點」的直線圓柱近似實際彈道,誤差 < 0.4m。
        this._lanceVisual(b.origin, p, def, this.side, b.barrage);
        this._lanceFeedback(def, this._sendLance(b.origin, p, def, b.oy), p);
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
    const lvl = this.abil[slot] || 1;   // 招式開場即 Lv1(2026-07-20;不再有未解鎖狀態)
    const A = heroAbility(this.ch, slot, lvl);
    const cdLeft = this.cds[slot === 'skill' ? 0 : 1] || 0;
    if (cdLeft > 0) { this.hud.feed?.(`⏳【${A.name}】冷卻中(${cdLeft.toFixed(0)}s)`); return; }
    // 招式電力隨招式階級(sk/ult)成長(2026-07-20:無獨立精通折減;伺服器 heroCast 同一條)
    const mpc = Math.round(A.mp);
    if (this.mp < mpc) { this.hud.feed?.(`🔋 電力不足(【${A.name}】需 ${mpc} MP)`); return; }
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

  /** 瞄準模式(右鍵點一下切換):拉近視角、切換重武器(伺服器另行把關開火權限) */
  _setAiming(on) {
    if (!this.side || this.aiming === on) return;
    this.aiming = on;
    this.net.send({ t: 'aim', on });
  }

  /**
   * 無人機自爆:F 鍵必須有準星鎖定目標(伺服器複驗)才會引爆 + 僚機追擊;
   * 無鎖定 = 不動作,只提示。高速撞擊(crash)是物理引爆,不需鎖定。
   */
  /**
   * 無人機護衛自殺機(2026-07-18;狙擊模式長按右鍵):兩架常駐護衛機衝出撲擊(各半傷、3 倍速)。
   * CD 固定 SQUAD.KAMI.CD_S(伺服器把關);有準星鎖定就直接指定目標,否則自動索敵;自爆後 CD 結束才重現。
   */
  _launchKamikaze() {
    if (!this.isDrone || this.dead) return;
    if ((this.kamiCd || 0) > 0.05) {
      this.hud.feed?.(`🛠️ 護衛自殺機整備中(${(this.kamiCd || 0).toFixed(0)}s)`);
      return;
    }
    this.trauma = Math.min(1, this.trauma + SHAKE.KAMI);   // 護衛機彈射的推背感
    this.kamiCd = SQUAD.KAMI.CD_S;   // 樂觀本地冷卻(下一份快照的 kcd 會校正)
    this.net.send({ t: 'kami' });
    this.hud.feed?.(`💥 ${SQUAD.KAMI.N} 架護衛自殺機衝出!`);
  }

  /** 狙擊模式長按右鍵達 GAME.SNIPE_HOLD_S → 觸發機種專屬招(自殺機 / 重砲 / 餌機)。
   *  短按右鍵 = 切換模式(見 _onMouseUp);達門檻才出招,一次按住只觸發一次,
   *  觸發後放開不再切換 → 切換與出招互不衝突。左鍵射擊獨立(狙擊模式重武器照常連射)。 */
  _tickSnipeAbility(now) {
    if (!this.side || this.dead || this.shopOpen || !this.aiming || !this._rmbDownAt || this._rmbAbilityFired) return;
    if (now - this._rmbDownAt < GAME.SNIPE_HOLD_S) return;
    this._rmbAbilityFired = true;
    if (this.isDrone) this._launchKamikaze();
    else if (this.isMorph) this._launchDecoy();
    else this._launchBarrage();
  }

  /** 重砲模式(非變形機甲:狙擊長按右鍵):送請求 + 開本地傾洩窗(0.5s 內快速傾洩剩餘重武器彈夾,
   *  傷害 +33%、射程 +20%;伺服器權威把關 CD 與加成,見 sim.heroBarrage)。 */
  _launchBarrage() {
    if (this.isDrone || this.isMorph || this.dead || !this.side) return;
    const now = performance.now() / 1000;
    // CD 閘門取「伺服器 bcd」與「本地時戳」兩者較大者 —— 樂觀 barrageCd 可能被在途舊快照(server 尚未處理
    // 本次請求)的 bcd=0 洗掉,單靠它會讓 30s CD 內誤判就緒;本地 _barrageCdUntil 時戳補住這個空窗。
    const cdLeft = Math.max(this.barrageCd || 0, (this._barrageCdUntil || 0) - now);
    if (cdLeft > 0.05) {
      this.hud.feed?.(`🎯 重砲整備中(${cdLeft.toFixed(0)}s)`);
      return;
    }
    // 無彈可傾洩(裝填中 / 空夾)→ 不啟動(與伺服器 heroBarrage 同條件,免白吃 CD;亦免本地時戳誤鎖 30s)
    const hv = this.wstate?.heavy;
    if (!hv || hv.reloadEnd > 0 || hv.ammo <= 0) { this.hud.feed?.('🎯 重砲需先裝填彈夾'); return; }
    this.barrageCd = BARRAGE.CD_S;                          // 樂觀本地 CD(HUD;下一份快照的 bcd 校正)
    this._barrageCdUntil = now + BARRAGE.CD_S;              // 本地 CD 時戳(不被在途舊快照 bcd 洗掉)
    this._barrageUntil = now + BARRAGE.DUR;
    this.trauma = Math.min(1, this.trauma + SHAKE.BARRAGE);   // 重砲展開的機體震動
    this.net.send({ t: 'barrage' });
    this.hud.feed?.('💥 重砲模式:傾洩彈夾!');
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
      const lvl = this.abil[slot] || 1;
      const A = heroAbility(this.ch, slot, lvl);
      const mpc = Math.round(A.mp);   // 招式電力(隨階級,無精通折減)
      return { name: A.name, lvl, cd: this.cds[idx] || 0, mp: mpc, ready: (this.cds[idx] || 0) <= 0 && this.mp >= mpc };
    };
    return {
      money: this.money, atBase: this._atBase(),
      code: c.code, machine: c.machine, aiming: this.aiming,
      light: slotHud('light'), heavy: slotHud('heavy'),
      skill: abHud('skill', 0), ult: abHud('ult', 1),
      sp: this.sp, msp: this.maxSp, mp: this.mp, mm: this.maxMp,
      kn: this.kn, emp: this.empLeft, stealth: this.stealthLeft,
      // 機種專屬能力(狙擊模式長按右鍵):無人機護衛自殺機 / 變形機甲餌機 / 非變形機甲重砲(冷卻倒數,0 = 就緒)
      kami: this.isDrone ? { cd: this.kamiCd || 0, n: SQUAD.KAMI.N } : null,
      decoy: this.isMorph ? { ready: !!this.decoyDocked, cd: this.decoyCd || 0 } : null,
      // 重砲 CD 取「伺服器 bcd」與「本地時戳剩餘」較大者 —— 樂觀值被在途舊快照洗回 0 時,HUD 不會瞬閃「就緒」
      barrage: (!this.isDrone && !this.isMorph)
        ? { cd: Math.max(this.barrageCd || 0, (this._barrageCdUntil || 0) - performance.now() / 1000) } : null,
      morph: this.isMorph ? { flight: this.flight, charge: this.charge } : null,
      // 空白鍵機動能力 CD(HUD 顯示;完美迴避 30s / 蓄力跳躍 15s / 升空變形 15s,皆客戶端時戳)
      mobil: this.isDrone ? { name: '完美迴避', cd: Math.max(0, (this._dodgeCd || 0) - now) }
        : this.isMorph ? { name: '升空變形', cd: Math.max(0, (this._morphCd || 0) - now) }
          : { name: '蓄力跳躍', cd: Math.max(0, (this._cjumpCd || 0) - now) },
    };
  }

  // ---------------- 特效 ----------------
  _tracer(from, to, color, ttl = 0.1) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.effects.push({ obj: line, ttl, fade: (o, f) => { o.material.opacity = 0.9 * f; } });
  }

  /**
   * 曳光遮蔽截斷(2026-07-22):NPC/塔/主堡/bot/他人開火視覺與伺服器 LOS 對齊 ——
   * 伺服器判「可射」仍可能因幾何不同形(occ r/h 夾制、THRU_M 擦邊放行、y 離地近似、
   * 射點用 ent 座標非實際槍口)讓客戶端全精度下的束線削過障礙;一律以本端 _obstHitT
   * (圓柱 ∪ 橋面/天花薄板)把 to 夾短到障礙面(cut=true 時呼叫端在截斷點畫火花)。
   * 純表現層 —— 傷害結算在伺服器,不受影響。
   */
  _clipBeam(from, to) {
    const d = this._obstHitT(from.x, from.y, from.z, to.x, to.y, to.z);
    if (d == null) return { to, cut: false };
    const len = from.distanceTo(to) || 1;
    if (d >= len) return { to, cut: false };
    return { to: from.clone().lerp(to, Math.max(0, (d - 0.2) / len)), cut: true };
  }

  /** 陣營射擊配色(曳光主色 / 槍口熱芯);第三方(GUER/MILI)走各自識別色 */
  _shotCols(side) {
    if (side === 'SWARM') return { col: 0xffb300, hot: 0xffe6a0 };
    if (side === 'STEEL') return { col: 0x4fc3f7, hot: 0xcdeeff };
    return { col: new THREE.Color(sideInfo(side).color).getHex(), hot: 0xf4ffd9 };
  }

  /**
   * 統一的「開火視覺」:槍口閃光 + 發光曳光束(取代細線)+(命中點)火花。
   * heavy 重武器一律比 light 更粗、更亮、更持久、槍口爆更大 —— 第一/第三人稱皆適用。
   * @param opts.heavy 重武器  @param opts.side 陣營  @param opts.impact `to` 是真實命中點(才畫落點火花)
   */
  _shotFx(from, to, { heavy = false, side, impact = false, barrage = false } = {}) {
    const { col, hot } = this._shotCols(side);
    this._muzzleBurst(from, heavy, side);
    const wF = barrage ? 2.2 : 1, tF = barrage ? 1.5 : 1;   // 巨炮(光束/動能重砲):更粗更亮更持久 + 落點大爆
    beamLine(this.scene, this.effects, from, to, col,
      heavy ? { ttl: 0.30 * tF, w: 0.30 * wF } : { ttl: 0.13, w: 0.075 });
    if (heavy) beamLine(this.scene, this.effects, from, to, hot, { ttl: 0.18 * tF, w: 0.11 * wF });  // 高熱內芯
    if (barrage) {
      shockRing(this.scene, this.effects, from.x, from.y, from.z, 4.0, col);
      starburst(this.scene, this.effects, to.x, to.y, to.z, 4.5, hot);
    }
    if (impact) starburst(this.scene, this.effects, to.x, to.y, to.z, heavy ? 4.2 : 1.6, col);
  }

  /** 槍口爆閃(世界座標):heavy 加一圈衝擊環 */
  _muzzleBurst(pos, heavy, side) {
    const { col, hot } = this._shotCols(side);
    starburst(this.scene, this.effects, pos.x, pos.y, pos.z, heavy ? 3.4 : 1.3, hot);
    if (heavy) {
      starburst(this.scene, this.effects, pos.x, pos.y, pos.z, 1.8, col);
      shockRing(this.scene, this.effects, pos.x, pos.y, pos.z, 2.6, col);
    }
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
    // 火焰貼圖:取代預設方形點精靈的粗糙塊感,帶內部火舌結構(第一人稱近距離殉爆看得最清楚)
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size: Math.max(1.4, r * 0.3), map: this._fireTex(), transparent: true, opacity: 1, depthWrite: false }));
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

  // ---------------- 陣亡過場(第一人稱被擊毀動畫)----------------
  /** 陣亡過場逐幀驅動:地面=劇震+緩傾覆+火煙柱+尾段殉爆白閃;飛行=拋物墜毀+翻滾+拖煙+觸地(或逾時空中)爆+俯看殘骸。
   *  完整獨佔 this.camera(_updatePlayer 對 dead 早退,無他者寫 camera);cockpit 為 camera 子物件自動隨傾倒/翻滾
   *  → 第一人稱「還在艙內爆」讀感。純表現層不動權威狀態;dt 吃 hitstop 定格,時長確定;結束時 _deathSeq=null 並熄紅框。 */
  _updateDeathSeq(dt, now) {
    const s = this._deathSeq;
    s.t += dt;
    const cam = this.camera;
    let done = false;

    if (!s.fly) {
      // ── 地面機體:原地劇震(0.9s 內衰減)+ smoothstep 側翻下陷,尾段主爆白閃 ──
      const decay = Math.max(0, 1 - s.t / 0.9);
      const n = decay * decay;
      const shP = (Math.random() * 2 - 1) * n * 0.11;
      const shY = (Math.random() * 2 - 1) * n * 0.11;
      const shR = (Math.random() * 2 - 1) * n * 0.13;
      const tp = Math.min(1, Math.max(0, (s.t - 0.2) / 1.4));   // 0.2s→1.6s 之間側翻
      const topple = tp * tp * (3 - 2 * tp);                    // smoothstep
      cam.position.copy(s.eye);
      cam.position.y -= topple * 1.2;                           // 隨傾覆下陷 ~1.2m
      cam.rotation.set(0, 0, 0);
      cam.rotateY(s.yaw + shY);
      cam.rotateX(s.pitch + topple * 0.35 + shP);               // pitch 次(~20°)
      cam.rotateZ(s.roll + topple * 1.0 + shR);                 // roll 主(~57°)
      s.smokeAcc += dt;                                         // 週期小火花(燃燒感)
      if (s.smokeAcc >= 0.22) {
        s.smokeAcc = 0;
        starburst(this.scene, this.effects,
          s.eye.x + (Math.random() * 2 - 1) * 2, s.surf + 1 + Math.random() * 2,
          s.eye.z + (Math.random() * 2 - 1) * 2, 1.2, 0xffb055);
      }
      // 尾段殉爆高潮(t≈1.45):主爆 + 地環 + 碎片 + 大字卡 + hitstop + 白閃(各一次)
      if (!s.climax && s.t >= 1.45) {
        s.climax = true;
        const fx = s.eye.x, fy = s.surf, fz = s.eye.z;
        this._explosion(fx, fy + 3, fz, 11, 0xff8a3a);
        shockRing(this.scene, this.effects, fx, fy, fz, 10, s.col);
        debrisBurst(this.scene, this.effects, fx, fy + 2, fz, { big: true, accent: s.col });
        comicPop(this.scene, this.effects, fx, fy + 9, fz, { big: true, hue: 18 });
        this._deathPlume(fx, fy, fz);                          // 殉爆後持續燃燒的火煙柱
        this._emberBurst(fx, fy + 2, fz, 22, 7);               // 大量迸射火星
        this._hitstop = Math.max(this._hitstop || 0, 0.06);
        this.hud.deathCine?.(true, true);                      // 白閃
      }
      if (s.t >= s.dur) done = true;

    } else if (!s.climax) {
      // ── 飛行機體:自適應重力拋物墜落 + per-axis 翻滾 + 拖尾煙 ──
      s.v.y -= s.g * dt;
      s.v.x *= Math.exp(-dt * 0.7); s.v.z *= Math.exp(-dt * 0.7);   // 微空氣阻力:墜點不飄太遠
      s.p.addScaledVector(s.v, dt);
      s.yaw += s.spin.y * dt; s.pitch += s.spin.x * dt; s.roll += s.spin.z * dt;
      s.smokeAcc += dt;
      if (s.smokeAcc > 0.06) { s.smokeAcc = 0; this._crashSmoke(s.p.x, s.p.y, s.p.z, 1.0); }
      cam.position.copy(s.p);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(s.yaw); cam.rotateX(s.pitch); cam.rotateZ(s.roll);
      // 觸地偵測(_surf → 橋面/地表);逾時仍在空中則就地空中爆(不瞬移鏡頭到地面),時長有界
      const gy = this._surf(s.p.x, s.p.z, s.p.y);
      const hitGround = s.p.y <= gy + 1.6;
      const timeout = s.t >= s.dur - 0.45;
      if (hitGround || timeout) {
        s.climax = true;
        const iy = hitGround ? gy + 1.0 : s.p.y;               // 落地→貼地爆;逾時→原空中位置爆
        s.p.y = iy;
        this._explosion(s.p.x, iy + 2, s.p.z, 13, 0xff7a30);
        shockRing(this.scene, this.effects, s.p.x, iy, s.p.z, 9, s.col);
        debrisBurst(this.scene, this.effects, s.p.x, iy + 1, s.p.z, { big: true, accent: s.col });
        this._deathPlume(s.p.x, iy, s.p.z);                    // 觸地後燃燒火煙柱
        this._emberBurst(s.p.x, iy + 1, s.p.z, 22, 7);         // 大量迸射火星
        this._hitstop = Math.max(this._hitstop || 0, 0.06);
        this.hud.deathCine?.(true, true);                      // 白閃
        s.v.set(0, 0, 0); s.holdUntil = s.t + 0.45;            // 釘爆點,俯看殘骸
      }

    } else {
      // ── 飛行觸地保留:鏡頭在殘骸上方緩緩下俯、翻滾歸零,煙續冒 ──
      s.pitch += (-0.5 - s.pitch) * Math.min(1, dt * 3);
      s.roll += (0 - s.roll) * Math.min(1, dt * 3);
      cam.position.copy(s.p);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(s.yaw); cam.rotateX(s.pitch); cam.rotateZ(s.roll);
      s.smokeAcc += dt;
      if (s.smokeAcc > 0.12) { s.smokeAcc = 0; this._crashSmoke(s.p.x, s.p.y, s.p.z, 1.6); }
      if (s.t >= s.holdUntil) done = true;
    }

    // 第一人稱燃燒吞沒:鏡頭定位「之後」在其前方近距離持續撒火 + 火星,填滿 FPV(座艙被火吞沒感)。
    // climax 前密、climax 後轉稀疏餘燼;純加法火焰不擋操作視覺、隨鏡頭一起翻滾。
    s.fpvAcc = (s.fpvAcc || 0) + dt;
    if (s.fpvAcc >= (s.climax ? 0.26 : 0.12)) { s.fpvAcc = 0; this._engulfFPV(cam); }

    if (done) {
      this._deathSeq = null;
      this.hud.deathCine?.(false);   // 熄紅框(倒數頁由下一 8Hz 快照顯示)
    }
  }

  /** 第一人稱「座艙被火吞沒」:在鏡頭前方近距離撒火焰 + 火星,填滿 FPV(殉爆過場專用,強化第一人稱燃燒感)。 */
  _engulfFPV(cam) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    // 火 + 煙集中在左右兩側帶,中央 ~1/3 正前方留空 —— 被擊殺過場仍看得見前方戰況(可讀性優先)。
    // 交替左右均衡;每顆側向強制外推(lat 絕對值 ≥1.7),焰/煙球不侵入正前方視野。
    for (let i = 0; i < 4; i++) {
      const side = (i % 2) ? 1 : -1;                     // 交替左右兩側
      const smoke = i >= 2;                              // 後兩顆為煙(灰、法線混色),前兩顆為火(加法)
      const d = (smoke ? 1.8 : 1.6) + Math.random() * 1.2;
      const base = smoke ? 1.8 + Math.random() * 1.3 : 1.1 + Math.random() * 1.0;
      // 側向外推量與尺寸掛鉤:大焰球推更遠 → 內緣不越過中央 1/3(FOV 68°,中央 1/3 = ±11°);
      // 焰/煙自畫面左右邊緣舔入(集中兩側),正前方 1/3 保持視野。
      const lat = side * ((smoke ? 2.4 : 1.9) + base * 0.35 + Math.random() * 1.2);
      const p = cam.position.clone()
        .addScaledVector(fwd, d)
        .addScaledVector(right, lat)
        .add(new THREE.Vector3(0, (smoke ? 0.2 : -0.4) - Math.random() * 0.9, 0));   // 火從下往上舔、煙齊眼高翻騰
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smoke ? this._smokeTex() : this._fireTex(),
        color: smoke ? 0x4a4e52 : (Math.random() < 0.5 ? 0xff7a2a : 0xffd166),
        transparent: true, opacity: smoke ? 0.55 : 0.9, depthWrite: false,
        blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending }));
      sp.userData.noOutline = true;
      sp.position.copy(p);
      sp.scale.setScalar(base);
      this.scene.add(sp);
      const rise = smoke ? 2 : 3 + Math.random() * 3, grow = smoke ? 1.2 : 0.8, op = smoke ? 0.55 : 0.9;
      this.effects.push({
        obj: sp, ttl: (smoke ? 0.5 : 0.32) + Math.random() * 0.26,
        fade: (o, f, dt) => { o.position.y += rise * dt; o.scale.setScalar(base * (1 + (1 - f) * grow)); o.material.opacity = op * f; },
        dispose: () => sp.material.dispose(),
      });
    }
    // 火星只沿兩側迸射(以 right 軸偏移),中央不撒 → 正前方保持通透
    for (const s of [-1, 1]) this._emberBurst(
      cam.position.x + right.x * s * 2.2, cam.position.y - 0.3, cam.position.z + right.z * s * 2.2, 2, 1.6);
  }

  /** 火焰粒子貼圖(快取,512px):白熱核心 + 中層暖輝 + 大量細火舌 + 熱斑點 → 加法混色的高解析度火光。 */
  _fireTex() {
    if (this._fireTexC) return this._fireTexC;
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d'), cx = S / 2, cy = S / 2;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,248,224,0.95)');
    g.addColorStop(0.5, 'rgba(255,168,72,0.55)');
    g.addColorStop(0.78, 'rgba(255,110,34,0.24)');
    g.addColorStop(1, 'rgba(230,70,16,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 130; i++) {                  // 細火舌:徑向亮條(高密度內部結構)
      const a = Math.random() * Math.PI * 2;
      const r0 = S * (0.04 + Math.random() * 0.08), r1 = S * (0.24 + Math.random() * 0.24);
      const wob = (Math.random() - 0.5) * 0.25;
      c.strokeStyle = `rgba(255,${(180 + Math.random() * 70) | 0},${(70 + Math.random() * 90) | 0},${0.03 + Math.random() * 0.06})`;
      c.lineWidth = 1 + Math.random() * 4;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.quadraticCurveTo(cx + Math.cos(a + wob) * (r0 + r1) * 0.5, cy + Math.sin(a + wob) * (r0 + r1) * 0.5,
        cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    for (let i = 0; i < 60; i++) {                   // 熱斑點:亮核心散布(火花感)
      const a = Math.random() * Math.PI * 2, rr = S * Math.random() * 0.32;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr, pr = 2 + Math.random() * 6;
      const pg = c.createRadialGradient(px, py, 0, px, py, pr);
      pg.addColorStop(0, `rgba(255,250,220,${0.3 + Math.random() * 0.4})`); pg.addColorStop(1, 'rgba(255,180,90,0)');
      c.fillStyle = pg; c.beginPath(); c.arc(px, py, pr, 0, 7); c.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    this._fireTexC = t; return t;
  }

  /** 煙霧粒子貼圖(快取,512px):多層 fBm 濃度斑塊 + 暗紋(翻騰立體感)+ 圓形遮罩 → 高解析度雲絮,由 sprite 色染灰。 */
  _smokeTex() {
    if (this._smokeTexC) return this._smokeTexC;
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d');
    c.globalCompositeOperation = 'lighter';          // 亮斑:疊多團白斑 → 濃度不均的雲
    for (let i = 0; i < 60; i++) {
      const bx = S / 2 + (Math.random() - 0.5) * S * 0.46, by = S / 2 + (Math.random() - 0.5) * S * 0.46;
      const br = S * (0.06 + Math.random() * 0.22);
      const g = c.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(255,255,255,${0.08 + Math.random() * 0.1})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'destination-out';  // 暗紋:挖掉小塊 → 翻騰的立體暗部(fBm 近似)
    for (let i = 0; i < 34; i++) {
      const bx = S / 2 + (Math.random() - 0.5) * S * 0.5, by = S / 2 + (Math.random() - 0.5) * S * 0.5;
      const br = S * (0.03 + Math.random() * 0.1);
      const g = c.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, `rgba(0,0,0,${0.12 + Math.random() * 0.16})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(bx, by, br, 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'destination-in';   // 圓形遮罩:邊緣淡出
    const m = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.66, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = m; c.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(cv);
    this._smokeTexC = t; return t;
  }

  /** 火星/餘燼(加法小亮點,上升飄散淡出):替殉爆火煙補細節顆粒感。n 顆一批。 */
  _emberBurst(x, y, z, n = 8, spread = 2) {
    const tex = this._fireTex();
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: Math.random() < 0.5 ? 0xffd27a : 0xff9840,
        transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.userData.noOutline = true;
      sp.position.set(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread);
      const base = 0.35 + Math.random() * 0.5;
      sp.scale.setScalar(base);
      this.scene.add(sp);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 8, (Math.random() - 0.5) * 6);
      this.effects.push({
        obj: sp, ttl: 0.7 + Math.random() * 0.6,
        fade: (o, f, dt) => { vel.y -= 6 * dt; o.position.addScaledVector(vel, dt); o.material.opacity = 0.95 * f; },
        dispose: () => sp.material.dispose(),
      });
    }
  }

  /** 殉爆火煙柱(~2s):噴發火(加法橙)+ 煙(灰上升),沿飛彈煙尾 idiom;地面路徑起始演出。
   *  改用柔邊 sprite billboard(徑向漸層貼圖):恆面向相機、無 facet → 第一人稱近距離仍高解析度、不粗糙;
   *  depthWrite:false 不 z-fight,掛 userData.noOutline 讓 outlinify 跳過。貼圖共用快取,dispose 只釋放材質。 */
  _deathPlume(x, y, z) {
    const g = new THREE.Group();
    g.userData.noOutline = true;
    const parts = [], NF = 22, NS = 18;
    for (let i = 0; i < NF + NS; i++) {
      const fire = i < NF;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fire ? this._fireTex() : this._smokeTex(),
        color: fire ? (Math.random() < 0.5 ? 0xff8a3a : 0xffd166) : 0x4a4e52,
        transparent: true, opacity: fire ? 0.95 : 0.62, depthWrite: false,
        blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending }));
      const th = Math.random() * Math.PI * 2, rad = Math.random() * 3;
      sp.position.set(x + Math.cos(th) * rad, y + Math.random() * 2, z + Math.sin(th) * rad);
      const base = fire ? 3.0 + Math.random() * 2 : 5 + Math.random() * 3;
      sp.scale.setScalar(base);
      parts.push({ sp, fire, base,
        rise: fire ? 4 + Math.random() * 4 : 7 + Math.random() * 6,
        drift: new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2),
        grow: fire ? 1.8 : 3.2, delay: fire ? 0 : Math.random() * 0.5 });   // 煙稍晚冒
      g.add(sp);
    }
    this.scene.add(g);
    this.effects.push({
      obj: g, ttl: 2.0,
      fade: (o, f, dt) => {
        const p = 1 - f;
        for (const c of parts) {
          if (p < c.delay) { c.sp.visible = false; continue; }
          c.sp.visible = true;
          c.sp.position.y += c.rise * dt;
          c.sp.position.addScaledVector(c.drift, dt);
          c.sp.scale.setScalar(c.base * (1 + p * c.grow));
          c.sp.material.opacity = c.fire ? Math.max(0, f * 1.4 - 0.2) * 0.95 : 0.6 * f;
        }
      },
      dispose: () => { for (const c of parts) c.sp.material.dispose(); },   // 貼圖共用快取不 dispose
    });
    this._emberBurst(x, y + 1, z, 14, 4);   // 起始迸射一批火星補顆粒細節
  }

  /** 單顆上升灰煙(墜機拖尾 / 觸地煙,單一縫共用);scale 控大小。柔邊 sprite,恆面向相機、無 facet。 */
  _crashSmoke(x, y, z, scale = 1) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._smokeTex(), color: 0x484c50, transparent: true, opacity: 0.6, depthWrite: false }));
    sp.userData.noOutline = true;
    sp.position.set(x + (Math.random() - 0.5) * 2, y, z + (Math.random() - 0.5) * 2);
    const base = 3.4 * scale;
    sp.scale.setScalar(base);
    this.scene.add(sp);
    const rise = 5 + Math.random() * 4;
    this.effects.push({
      obj: sp, ttl: 1.1,
      fade: (o, f, dt) => { o.position.y += rise * dt; o.scale.setScalar(base * (1 + (1 - f) * 2.2)); o.material.opacity = 0.6 * f; },
      dispose: () => { sp.material.dispose(); },
    });
  }

  // ---------------- 玩家移動 ----------------
  _updatePlayer(dt, now) {
    if (!this.side) { this._updateSpectator(dt); return; }
    if (this.dead) return;
    this._env = this._envAt();   // 當幀環境(水/沼):移動減速、pos 回報、狀態結算(伺服器)皆讀它
    this._updateEnvFog(dt);      // 火場滯留 → 視野漸霧化(純客戶端表現)
    // 結構物硬碰撞的參考狀態:位移前的座標與「是否在地下道內」(隧道側壁判定要以移動前為準)
    const px0 = this.pos.x, pz0 = this.pos.z, py0 = this.pos.y;
    const tn0 = this.terrain.tunnelAt?.(px0, pz0);
    const inTun0 = !!(tn0 && py0 < tn0.ceil);
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
      // 控場:垂直升降同樣折速(麻痺 = 禁移動含爬升/下降,否則被暈仍可垂直脫離)
      const ccF = this._ccMoveF();
      if (target.lengthSq() > 0) target.normalize().multiplyScalar(spd * boost * this._recoilMoveF(now, true)
        * ccF * this._modF('speed'));
      // 混亂(招式追加效果):水平操縱反轉 + 慢速航向漂移(垂直升降不反轉,免得直接砸地)
      if ((this.confLeft || 0) > 0) { target.x *= -1; target.z *= -1; this.yaw += Math.sin(now * 2.7) * 0.5 * dt; }
      // 無人機完美迴避(2026-07-21):戰鬥狀態(近 COMBAT_S 秒攻擊或被攻擊)下按空白鍵飛行 →
      //   向上飛的同時 1s 無敵,30s CD。空白鍵上升邊觸發(避免每幀連發);伺服器 heroIframe 為 CD/免傷權威。
      if (this.isDrone) {
        if (this.keys.Space && !this._spaceWas) {
          const inCombat = now - Math.max(this.lastFireAt.light || 0, this.lastFireAt.heavy || 0) < IFRAME.COMBAT_S
            || now - (this._lastHurtAt || 0) < IFRAME.COMBAT_S;
          if (inCombat && now >= (this._dodgeCd || 0)) this._perfectDodge(u, now);
          else if (inCombat) this.hud.feed?.(`🛡️ 完美迴避冷卻中(${Math.ceil((this._dodgeCd || 0) - now)}s)`);
        }
        this._spaceWas = this.keys.Space;
      }
      if (this.keys.Space) target.y += u.vspeed * ccF;
      if (this.keys.KeyC || this.keys.ControlLeft) target.y -= u.vspeed * ccF;
      this.vel.x += (target.x - this.vel.x) * Math.min(1, dt * 4);
      this.vel.z += (target.z - this.vel.z) * Math.min(1, dt * 4);
      this.vel.y += (target.y - this.vel.y) * Math.min(1, dt * 4);
      this.pos.addScaledVector(this.vel, dt);
      const gyS = this._surf(this.pos.x, this.pos.z, this.pos.y);
      // 水面是飛行下限(2026-07-15):海面下的海床不是可懸停的地板 —— 機體不潛水
      const gy = this.terrain.waterY != null ? Math.max(gyS, this.terrain.waterY) : gyS;
      // 無人機不貼地(下限 +2.5);變形機甲允許降到地表 → 觸地即變形回地面型
      this.pos.y = Math.max(gy + (this.isMorph ? 0 : 2.5), Math.min(gy + 320, this.pos.y));
      // 全滅頂深水上空不自動落地變形(水深 > FULL_D:降不到底,維持飛行);較淺水可落地涉水
      const deepW = this.terrain.waterY != null && gyS < this.terrain.waterY - WATER.FULL_D;
      if (this.isMorph && !deepW && this.pos.y <= gy + MORPH.LAND_M) this._morphLand(gy);
      // FPV 側傾:橫移/轉向時機身壓坡度
      const lat = this.vel.x * right.x + this.vel.z * right.z;
      this.roll += (-lat / spd * 0.16 - this.roll) * Math.min(1, dt * 5);
    } else {
      // 機甲:貼地 + 跳躍;this.vel 是爆炸/後座的擊退速度(地面摩擦快速衰減)
      // 蓄力中重心下沉、移動減速(起跳預備動作;morph 變形彈射與 robot 蓄力跳共用 this.charge)
      const slowK = 1 - 0.6 * this.charge;
      // 混亂(招式追加效果):操縱反轉 + 慢速航向漂移
      if ((this.confLeft || 0) > 0) { move.multiplyScalar(-1); this.yaw += Math.sin(now * 2.7) * 0.5 * dt; }
      this.pos.addScaledVector(move, u.speed * boost * this._zoneSlow() * slowK * this._terrainSlowF()
        * this._recoilMoveF(now, false) * this._ccMoveF() * this._modF('speed') * dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      // 蓄力跳騰空(_lowG):水平近乎無阻力滑行(太空漫步的慣性);觸地恢復地面摩擦
      const fr = Math.exp(-dt * (this._lowG ? 0.8 : 6));
      this.vel.x *= fr; this.vel.z *= fr; this.vel.y = 0;
      const gyS = this._surf(this.pos.x, this.pos.z, this.pos.y);
      // 水中有效地板(2026-07-19 可涉水改制):可下沉至「水面 − FULL_D(全滅頂深)」→ 深水可涉、
      // 過深則半浮於 FULL_D(頭沒入水),不無限沉海床;淺水踩實際河床。深水不再是牆(passable 已放行)。
      const gy = this.terrain.waterY != null ? Math.max(gyS, this.terrain.waterY - WATER.FULL_D) : gyS;
      this.vy = this.vy ?? 0;
      const onGround = this.pos.y <= gy + 0.05;
      // 麻痺 = 禁移動:蓄力/起跳/變形彈射一併封鎖(已騰空的物理慣性不受影響)
      if ((this.stunLeft || 0) > 0) {
        this.charge = 0;
      } else if (this.isMorph) {
        // 蓄力跳:按住 Space 蓄力 → 放開時蓄力足夠且變形起飛未冷卻即彈射變形為飛行型,否則只是小跳
        if (onGround && this.keys.Space) {
          this.charge = Math.min(1, this.charge + dt / MORPH.CHARGE_S);
        } else if (this.charge > 0) {
          if (onGround && this.charge >= MORPH.JUMP_MIN && now >= (this._morphCd || 0)) {
            this._morphLaunch(gy); this._morphCd = now + MORPH.CD;   // 變形起飛:15s CD
          } else if (onGround) {
            if (this.charge >= MORPH.JUMP_MIN) this.hud.feed?.(`🛫 變形起飛冷卻中(${Math.ceil((this._morphCd || 0) - now)}s)`);
            this.vy = u.jump * this._modF('jump'); this.charge = 0;
          } else this.charge = 0;
        }
      } else if (onGround && this.keys.Space) {
        // 機甲蓄力跳躍(2026-07-16,CJUMP;robot 限定):長按 Space 蓄力 → 放開彈射高跳,
        // 騰空低重力 = 太空漫步;蓄力不足 = 普通小跳。與 morph 共用 this.charge(下蹲/減速一致)。
        this.charge = Math.min(1, this.charge + dt / CJUMP.CHARGE_S);
      } else if (!this.isMorph && this.charge > 0) {
        if (onGround && this.charge >= CJUMP.MIN && now >= (this._cjumpCd || 0)) {
          this._chargeJump(u); this._cjumpCd = now + CJUMP.CD;   // 蓄力跳躍:15s CD
        } else if (onGround && this.charge >= CJUMP.MIN) {
          this.vy = u.jump * this._modF('jump');
          this.hud.feed?.(`🦿 蓄力跳冷卻中(${Math.ceil((this._cjumpCd || 0) - now)}s)`);
        } else if (onGround) this.vy = u.jump * this._modF('jump');
        this.charge = 0;
      }
      // 蓄力跳騰空吃低重力(月面滯空);無敵幀已於起跳離地(_chargeJump / _morphLaunch)請求
      this.vy -= AIR.GRAV * (this._lowG ? CJUMP.GRAV_F : 1) * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y < gy) { this.pos.y = gy; this.vy = 0; this._lowG = false; }
      this.roll += (0 - this.roll) * Math.min(1, dt * 6);
    }

    // 結構物硬碰撞(高架橋/地下道):機體與橋體/山體不可重疊 ——
    //  ①隧道側壁:洞內只能沿路面走到洞口。側向跨出走廊時 surfaceAt 會瞬移到上方山體
    //    (表面高度躍升 >2.6m)= 穿牆,一律擋下。
    //  ②淨空不足:天花(橋面底緣/隧道天花板)與地面的夾縫塞不下機高 → 進不去(引道漸低段)。
    // 撞牆時逐軸嘗試滑行(沿牆保留另一軸位移),都不行才整步還原;
    // 位移前的位置若本來就違規(例外狀態)則放行,避免卡死。
    if (this.terrain.ceilingAt) {
      const hover = this._flying() ? (this.isMorph ? 0 : 2.5) : 0;
      const passable = (cx, cz) => {
        const g = this._surf(cx, cz, py0);
        if (inTun0 && g > py0 + 2.6) return false;                        // 隧道側壁/上方山體
        // 2026-07-19:深水不再是牆 —— 水域/沼澤可通行,依深度減速(_terrainSlowF),
        // 有效地板 = 水面 − FULL_D(可涉水橫渡河湖)。深水不再由此擋下。
        const ce = this.terrain.ceilingAt(cx, cz, py0);
        if (ce != null && ce - this.selfH - 0.2 < g + hover) return false; // 夾縫 < 機高
        return true;
      };
      if (!passable(this.pos.x, this.pos.z) && passable(px0, pz0)) {
        let cx = px0, cz = pz0;
        for (const [tx, tz] of [[this.pos.x, pz0], [px0, this.pos.z]]) {
          if (passable(tx, tz)) { cx = tx; cz = tz; break; }
        }
        this.pos.x = cx; this.pos.z = cz;
        this.vel.x = 0; this.vel.z = 0;
        // 撞牆幀的高度 MUST 一併還原上限:位移分支已先用「牆外的 gy」把機體吸上山
        // (貼坡吸附),只還原 x/z 會留下被抬高的 y → 下一幀 py0 > ceil = 誤判已在山上,
        // 側壁規則就此解除(實測就是這樣穿牆的)。
        this.pos.y = Math.min(this.pos.y, py0);
        const gy2 = this._surf(cx, cz, py0);
        if (this._flying()) this.pos.y = Math.max(gy2 + hover, Math.min(gy2 + 320, this.pos.y));
        else if (this.pos.y < gy2) { this.pos.y = gy2; this.vy = 0; }
      }
    }

    // 天花碰撞:地下道天花板 / 高架橋底緣 —— 頭頂(pos.y + 機高)不得穿過。ceilingAt 只在「人在其下方」時回值,
    // 站上方地表 / 橋面時回 null → 不受影響(上方照常通行)。
    // 查詢高度取 min(位移前, 位移後):蓄力跳/大 dt 單幀跨越天花時,位移後 y 已在天花之上,
    // 事後查詢回 null = 誤判已在上層 → 直接站上山頂穿模;以位移前高度評估即無此洞。
    const ceil = this.terrain.ceilingAt?.(this.pos.x, this.pos.z, Math.min(py0, this.pos.y));
    if (ceil != null) {
      const cap = ceil - this.selfH - 0.2;   // 頭頂留餘裕,機高由角色動態推導(最大機甲亦保證淨空)
      if (this.pos.y > cap) {
        this.pos.y = cap;
        if (this.vy > 0) this.vy = 0;
        if (this.vel?.y > 0) this.vel.y = 0;
      }
    }

    // 碰撞:不能穿過單位 / 塔 / 主堡 / 建物 / 神木 / 巨岩(px0,pz0 = 本幀位移起點,供掃掠防穿透)
    this._collide(px0, pz0);

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

    // 座艙視點 = 機體實高 × heroView(依機體形狀的頭艙位置):人形在胸腔/頸根、獸型在獸首
    // (低且遠前)、飛行型在機鼻。與 models.js 的 heroTargetH 同一個縫,改角色護甲即連動。
    // 蓄力中重心下沉(鏡頭跟著蹲)。
    const vw = heroView(this.heroKind, this.ch, this._flying());
    const eye = this._eyeH();          // 單一縫:地形異常狀態的視線高度判定共用同一式
    const headF = this.selfH * vw.f;   // 沿正面方向前移(three:-z 為前)
    this.camera.position.copy(this.pos).add(
      new THREE.Vector3(-Math.sin(this.yaw) * headF, eye, -Math.cos(this.yaw) * headF));
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + this.recoil.y + shY);
    this.camera.rotateX(this.pitch + this.recoil.p + shP);
    this.camera.rotateZ(this.roll + shR);
    this._cameraDeClip();   // 鏡頭防穿模:貼牆時退回障礙外緣,不看穿建物/神木/巨岩

    // 瞄準縮放:右鍵切換拉近視角(FOV 越小越像瞄準鏡)
    const wantFov = this.aiming ? (UNITS[this.heroKind]?.zoomFov ?? this.baseFov) : this.baseFov;
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
    // 位置回報(10Hz;模擬 z=北)
    if (now - this.lastPosSend > 0.1) {
      this.lastPosSend = now;
      // y = 離「站立表面」的高度(橋上算 0):伺服器的地面型/防空判定不會因為站上橋面而誤判;
      // 深水處的站立表面 = 水面 − 全滅頂深(泡在水裡的機體是地面單位,不是空中目標)
      const sy = this._surf(this.pos.x, this.pos.z, this.pos.y);
      const th = this.terrain.heightAt(this.pos.x, this.pos.z);
      const tn = this.terrain.tunnelAt?.(this.pos.x, this.pos.z);
      const inTun = !!(tn && this.pos.y < tn.ceil);
      // 所在結構層(#1 slab LOS):2 隧道內 / 1 真・橋面(deck ribbon 對得上站立面)/ 0 地面。
      // 伺服器 y 為離站立表面高(橋上/橋下皆 ≈0 無法區辨),故另回報此層供 _slabBlocked 判板體兩側。
      // 站障礙物頂(建物/神木/巨岩,2026-07-22 可站立)≠ 橋層:屋頂不是 slab ribbon,回報 lev=0,
      // 且 y 基準改「地形」—— 伺服器把障礙視為 [0,h] 圓柱,離地高回報讓射手眼位越過自身柱頂,
      // 站樓頂開火才不會被自己腳下那根 occ 柱誤判遮蔽(高度制空加成隨之生效 = 高地俯射,物理一致)。
      const dY2 = !inTun && sy > th + 1 ? this.terrain.deckY?.(this.pos.x, this.pos.z, 3.0) : null;
      const onBridge = dY2 != null && Math.abs(sy - dY2) < 0.6;
      const yRef = (!inTun && !onBridge && sy > th + 1) ? th : sy;   // 障礙物頂 → 地形基準
      const sEff = this.terrain.waterY != null ? Math.max(yRef, this.terrain.waterY - WATER.FULL_D) : yRef;
      this._altAG = this.pos.y - sEff;   // 離基準面高度(與回報 y 同源;高度制空 _altRangeMul 用)
      const lev = inTun ? 2 : onBridge ? 1 : 0;
      this.net.send({
        t: 'pos',
        x: Math.round(this.pos.x * 10) / 10,
        y: Math.round(this._altAG * 10) / 10,
        z: Math.round(-this.pos.z * 10) / 10,
        ry: Math.round(this.yaw * 100) / 100,
        wet: this._env.code,   // 地形異常狀態(0 無 / 1 水 / 2 沼):伺服器結算沼澤扣血/水域凍結 CD 換彈。
                               // 視線高度制 + 騰空歸零(見 _envAt)⇒ 跳躍/蓄力跳躍期間回報 0 = 狀態解除
        lev,
      });
    }
    // 放開開火鍵:取消磁軌/穩定蓄力(不耗彈)、連射計數歸零(下次扣扳機重新起算 N 連發)
    if (!this.firing) {
      if (this._railAt || this._steadyAt) { this._railAt = 0; this._steadyAt = 0; this.flash?.scale.setScalar(1); this._setRailCharge(false); }
      this._burstN = {};
    }
    this._tickSnipeAbility(now);   // 狙擊模式長按右鍵 → 機種專屬能力(在 _tryFire 之前判定手勢)
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
    // 開火過(shot 事件)優先咬住「實際攻擊目標」,其次追蹤最近敵人 —— 砲口朝攻擊方向
    const aim = ent._aimAt && now < ent._aimAt.until ? ent._aimAt : null;
    const t = aim ? null : this._nearestEnemy(ent, now, UNITS.tower.range);   // 追蹤半徑同砲塔射程
    let wantYaw, wantPitch;
    if (aim || t) {
      const p = aim || (t.isSelf ? this.pos : t.mesh.position);
      const dx = p.x - ent.mesh.position.x, dz = p.z - ent.mesh.position.z;
      wantYaw = Math.atan2(dx, dz);
      const turY = ent.mesh.position.y + tur.position.y;
      wantPitch = Math.atan2(((p.y ?? turY - 2) + 2) - turY, Math.hypot(dx, dz));
    } else {
      wantYaw = tur.rotation.y + dt * 2;   // 警戒掃描
      wantPitch = 0;
    }
    wantPitch = Math.max(-Math.PI / 6, Math.min(Math.PI / 3, wantPitch));
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    tur.rotation.y += wrap(wantYaw - tur.rotation.y) * Math.min(1, dt * 4);
    const pit = tur.userData.pitch;
    pit.rotation.x += (-wantPitch - pit.rotation.x) * Math.min(1, dt * 4);
    // 開火後座(shot 事件標記 _turKick):砲管上撇一記、指數回穩
    if (ent._turKick > 0.01) {
      pit.rotation.x -= ent._turKick * 0.07;
      ent._turKick *= Math.max(0, 1 - dt * 5);
    }
  }

  /** 主堡兩門大砲追瞄:shot 事件記下各門砲的攻擊目標(_gunAim),砲管平滑轉向它;
   *  逾時回正朝敵方主堡(建置時的 rest 朝向)。後座共用 _turKick(雙砲齊仰)。 */
  _aimBaseGuns(ent, dt, now) {
    const g = ent.guns;
    if (!g || !ent.gunPivots) return;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    ent.gunPivots.forEach((c, i) => {
      const aim = ent._gunAim?.[i];
      let wantLocal = 0;   // 無目標:回正 = 建置朝向(敵方主堡)
      if (aim && now < aim.until) {
        const world = Math.atan2(aim.x - g.position.x, aim.z - g.position.z);
        wantLocal = wrap(world - g.rotation.y);
      }
      c.rotation.y += wrap(wantLocal - c.rotation.y) * Math.min(1, dt * 3);
    });
    if (ent._turKick > 0.01) {
      for (const c of ent.gunPivots) c.userData.barrel.rotation.x = -0.14 - ent._turKick * 0.06;
      ent._turKick *= Math.max(0, 1 - dt * 5);
    }
  }

  /**
   * 車載砲塔追蹤(坦克):車體照常朝移動方向,砲塔獨立咬住射程內最近敵人,
   * 換目標跟著轉;無目標平滑歸中(砲管回正對齊車頭)。純視覺,命中仍由伺服器結算。
   */
  _aimVehicleTurret(ent, tur, dt, now) {
    // 開火過(shot 事件)優先咬住「實際攻擊目標」,其次最近敵人 —— 砲口朝攻擊方向
    const aim = ent._aimAt && now < ent._aimAt.until ? ent._aimAt : null;
    const t = aim ? null : this._nearestEnemy(ent, now, (UNITS[ent.kind]?.range || 0) * 1.2, true);
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    // 有敵人:砲管咬住攻擊目標(任意方向,含車後);無敵人:歸中對齊車頭 = 前進方向。
    // 純視覺,命中仍由伺服器結算。
    let wantLocal = 0, wantPitch = 0;
    if (aim || t) {
      const p = aim || (t.isSelf ? this.pos : t.mesh.position);
      const world = Math.atan2(p.x - ent.mesh.position.x, p.z - ent.mesh.position.z);
      wantLocal = wrap(world - ent.mesh.rotation.y);
      const dx = p.x - ent.mesh.position.x, dz = p.z - ent.mesh.position.z;
      const turY = tur.getWorldPosition(new THREE.Vector3()).y;
      wantPitch = Math.atan2(((p.y ?? turY) - turY), Math.hypot(dx, dz) || 1);
    }
    tur.rotation.y += wrap(wantLocal - tur.rotation.y) * Math.min(1, dt * 5);
    // 砲管俯仰(2026-07-22 規則 1):有 pitch 節點的車砲把砲管指向目標仰角;
    // 拋物線攻城砲(tank 'siege')的「出膛仰角」由 _arcTracer 逐發回寫 _arcPitch 優先 ——
    // 砲管角度與實際彈道弧線一致
    const pit = tur.userData?.pitch;
    if (pit) {
      const arc = ent._arcPitch && now < ent._arcPitch.until ? ent._arcPitch.v : null;
      const wp = Math.max(-Math.PI / 6, Math.min(Math.PI / 3, arc ?? wantPitch));
      pit.rotation.x += (-wp - pit.rotation.x) * Math.min(1, dt * 4);
      // 開火後座(shot 事件標 _turKick):砲管上撇一記、指數回穩(同塔砲語意)
      if (ent._turKick > 0.01) {
        pit.rotation.x -= ent._turKick * 0.06;
        ent._turKick *= Math.max(0, 1 - dt * 5);
      }
    }
  }

  /** 共軛俯仰槍架(直升機頜砲/側掛槍/莢艙):機身朝向照舊(移動=航向、停懸=面向目標),
   *  槍架只補「對目標的垂直仰角」—— 對地射擊槍口下壓,曳光與槍管同一條線(規則 1 的俯仰半邊)。 */
  _aimGunTilt(ent, piv, dt, now) {
    const aim = ent._aimAt && now < ent._aimAt.until ? ent._aimAt : null;
    let want = 0;
    if (aim) {
      const py = piv.getWorldPosition(new THREE.Vector3()).y;
      const d = Math.hypot(aim.x - ent.mesh.position.x, aim.z - ent.mesh.position.z) || 1;
      want = Math.max(-1.1, Math.min(0.5, Math.atan2((aim.y ?? py) - py, d)));
    }
    piv.rotation.x += (-want - piv.rotation.x) * Math.min(1, dt * 4);
  }

  _updateEnts(dt, now) {
    for (const ent of this.ents.values()) {
      if (ent.isSelf) {
        ent.mesh.position.copy(this.pos);
        if (ent.escorts) for (const es of ent.escorts) es.mesh.visible = false;   // 切為自機視角:貼身護衛機藏起(自機 FPV 不畫)
        continue;
      }
      if (ent.isStatic) {
        const y = ent.padY ?? this.terrain.heightAt(ent.tgt.x, ent.tgt.z);   // padY:橋上砲塔的墩座台面
        ent.mesh.position.set(ent.tgt.x, y, ent.tgt.z);
        if (ent.kind === 'tower') this._aimTurret(ent, dt, now);
        if (ent.kind === 'base') this._aimBaseGuns(ent, dt, now);
        if (ent.bar) ent.bar.lookAt(this.camera.position);
        continue;
      }
      if (ent.hero && ent.mesh.userData.decoyPod) this._updateDecoyPod(ent, dt);
      const cur = ent.mesh.position;
      const px = cur.x, pz = cur.z, pyaw = ent.mesh.rotation.y;
      let nx, nz, snapped = false;
      if (ent._snapPos) {
        nx = ent.tgt.x; nz = ent.tgt.z;
        ent._snapPos = false;
        snapped = true;
        ent.loco = null;   // 重生瞬移:骨架動畫狀態歸零,不殘留舊速度
        ent.cfx = null; ent.fireFx = null; ent.heavyFx = null; ent.castFx = null;   // 戰鬥動畫狀態一併歸零
      } else {
        const k = Math.min(1, dt * 9);
        nx = cur.x + (ent.tgt.x - cur.x) * k;
        nz = cur.z + (ent.tgt.z - cur.z) * k;
      }
      // 貼地取樣吃橋面:以「上一幀的表面高度」當作判斷依據(離地高度 heroY 要先扣掉),
      // 兵線走上高架橋時小兵/敵機自然走在橋面上,從橋下經過的則照舊踩地形。
      const lift = (ent.hero || ent.flies) ? ent.heroY : 0;
      const gy = this._surf(nx, nz, cur.y - lift);
      let ny = gy + lift;
      // 兵線過水必走橋(#2 倫敦泡水保底 + 2026-07-22 棘輪修):地面小兵設計上過水一律走橋、
      // 不會游泳。surfaceAt 的 mount 台階(curY ≥ deck − DECK_STEP)是單向棘輪 —— 生成抖動/
      // 塔推擠/迷霧刪重建(curY 以裸地形重播種)把 y 落到水面後,永遠爬不回 7.5m 高的橋面。
      // 故泡水點(ny < waterY)上方查得到 deck 就直接貼橋:泡水點不存在「橋下通行」的合法情境;
      // 乾地高架下 ny ≥ waterY 不進此分支,照舊可鑽橋下。查無 deck 才退回浮水面保底(漏建/錯位
      // 橋面時至多浮在水面)。純客戶端渲染,伺服器權威 y 不受影響(A1 相容);英雄/飛行體不夾
      // (英雄可涉水吃凍結、飛行體本在空中)。waterY==null(無水盤)時 no-op。
      const wy = this.terrain.waterY;
      if (wy != null && !ent.hero && !ent.flies && ny < wy) {
        const d = this.terrain.deckY?.(nx, nz, this.terrain.deckMargin || 0);
        ny = (d != null && d > wy) ? d : wy;
      }
      // 朝向:平滑轉向(mobility_plan:8Hz 快照的方位跳變不直接進畫面)
      let wantYaw = null;
      if (ent.decoy || ent.kami) {
        wantYaw = ent.ry + Math.PI;   // 機首朝 +z,與機甲同慣例
      } else if (ent.hero) {
        // ry 是「相機朝向」慣例(前方 = -z),機體模型一律朝 +z(見 buildRobotMech 腳尖/駕駛艙)
        // → 直接套用會讓所有英雄(含 bot)倒著走。差 π。
        wantYaw = ent.ry + Math.PI;
        // 交戰面向(2026-07-22 規則 1):靜止中開火的僚機/bot 面向實際攻擊目標
        // (_markFire 記 _aimAt)—— 齊射不再側著身;移動中照舊面向 ry(伺服器權威朝向)
        const adx = ent.tgt.x - cur.x, adz = ent.tgt.z - cur.z;
        if (adx * adx + adz * adz <= 0.04 && ent._aimAt && now < ent._aimAt.until)
          wantYaw = Math.atan2(ent._aimAt.x - cur.x, ent._aimAt.z - cur.z);
      } else {
        // NPC 沒有伺服器方位,靠插值殘差推朝向。殘差 ≈ 速度/插值增益(小兵 6 m/s → 僅 0.7m),
        // 門檻設 0.5(距離平方)等於永遠不轉向 — 全場小兵一律朝 +z。改用 0.2m 門檻。
        const dx = ent.tgt.x - cur.x, dz = ent.tgt.z - cur.z;
        if (dx * dx + dz * dz > 0.04) wantYaw = Math.atan2(dx, dz);
        else if (ent._aimAt && now < ent._aimAt.until) {
          // 停止 + 開火過(shot 事件):面向「實際攻擊目標」—— 槍口一律朝攻擊方向
          wantYaw = Math.atan2(ent._aimAt.x - cur.x, ent._aimAt.z - cur.z);
        } else {
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
      // 無人機兩架貼身護衛自殺機(顯隱依 kami 冷卻);切離自機視角的機體補建護衛(spawn 時是自機故未建)
      if (ent.kind === 'drone' && !ent.escorts) this._buildDroneEscorts(ent);
      if (ent.escorts) this._updateEscorts(ent);
      // 車載砲塔(坦克):獨立於車體轉向,咬住交戰目標
      const tur = ent.mesh.userData.turret;
      if (tur) this._aimVehicleTurret(ent, tur, dt, now);
      // 共軛俯仰槍架(直升機):槍管補對目標仰角
      const gt = ent.mesh.userData.gunTilt;
      if (gt) this._aimGunTilt(ent, gt, dt, now);
      // 戰鬥開火/蓄力動畫(locomotion stepCombatFx):由 fireFx/heavyFx 事件推導 rig 驅動場
      // (射姿保持/後座脈衝/蓄力反向)+ 直接驅動掛點 glow/pivot 與槍口閃光 ——
      // MUST 在 stepLocomotion 之前呼叫,本幀步態才吃得到驅動場
      stepCombatFx(ent, now, dt);
      // 程序化骨架動畫:實際位移驅動步態/輪速/壓坡(locomotion.js)
      stepLocomotion(ent, dt, now, px, pz, pyaw);
      // 血條面向相機
      if (ent.bar) ent.bar.lookAt(this.camera.position);
      // 敵方單位:頭上掛對方陣營主視覺的箭頭(在快照裡 = 已進入我方視野)
      if (ent.civ) this._civMark(ent, dt, now);   // 平民:不分我方/敵方都掛陣營箭頭(外觀只能分辨陣營)
      else if (this.side && ent.side && ent.side !== this.side) this._enemyMark(ent, dt, now);
    }
  }

  /** 平民/間諜:頭頂掛「其陣營」箭頭(我方/敵方都顯示 —— 外觀只能分辨陣營,不揭露間諜);
   *  跟隨中(fo)略微加亮。marker 由陣營色決定,和一般敵標分開一份(cs ≠ side)。 */
  _civMark(ent, dt, now) {
    if (!ent.civMark) {
      const h = Math.max(1.8, ent.dimH ?? 2);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: factionMarkTex(ent.cs), transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      }));
      sp.scale.setScalar(Math.max(2.6, h * 0.6));
      sp.renderOrder = 998;
      ent.civMarkY = (ent.dimTop ?? h) + 2.4 + sp.scale.y * 0.5;
      ent.mesh.add(sp);
      ent.civMark = sp;
    }
    const m = ent.civMark.material;
    m.opacity = Math.min(ent.fo ? 0.95 : 0.66, m.opacity + dt * 3);
    ent.civMark.position.y = ent.civMarkY + Math.sin(now * 2.4) * 0.35;
  }

  /** 互動半徑內、水平距離最近的平民(靠近可驅趕/跟隨)。 */
  _nearestCiv() {
    if (!this.side || this.dead) return null;
    let best = null, bd = CIVILIAN.INTERACT_R;
    for (const ent of this.ents.values()) {
      if (!ent.civ || !ent.mesh.visible) continue;
      const d = Math.hypot(ent.mesh.position.x - this.pos.x, ent.mesh.position.z - this.pos.z);
      if (d < bd) { bd = d; best = ent; }
    }
    return best;
  }

  /** 送出平民互動(act='follow'|'away'):以本幀算好的最近平民為目標。 */
  _civAct(act) {
    const ent = this._civTarget || this._nearestCiv();
    if (ent) this.net.send({ t: 'civ', id: ent.id, act });
  }

  // ---------------- 2D 戰術地圖 ----------------
  _initMinimap() {
    this.mmCtx = this.minimapCanvas.getContext('2d');
    this._mmLast = 0;
    const w = this.minimapCanvas.width, h = this.minimapCanvas.height;
    this._mmBase = this._bakeMmBase(w, h);   // 底圖 = 原始圖資地形(一次性烤好,之後只 drawImage)
    // 戰爭迷霧:已探索累積遮罩 + 每 tick 重組的迷霧層(觀戰 side=null 無霧,鏡像伺服器規則)
    this._mmSeen = document.createElement('canvas');
    this._mmSeen.width = w; this._mmSeen.height = h;
    this._mmFog = document.createElement('canvas');
    this._mmFog.width = w; this._mmFog.height = h;
    // 每個視野源的獨立遮蔽罩(先畫視野圓、再挖掉障礙陰影),再合成進 seen/fog —— 用暫存畫布隔離,
    // destination-out 挖陰影才不會誤刪其他源已照亮的區域。
    this._mmScr = document.createElement('canvas');
    this._mmScr.width = w; this._mmScr.height = h;
    this._pulseUntil = 0;   // 全隊無霧脈衝(偵察中繼站/偵察招式)到期時刻:迷霧全掀
    this._mmLanes = this._gradeLanes();   // 兵線分級取樣(地面/高架橋/地下道)— 一次算好
    // 已探索的第三方碉堡:一旦進過視野就永久標示(即使離開視野、被摧毀待重建也保留位置)。
    // 位置量化為鍵 → 同一營地重生的碉堡自動去重。
    this._seenBunkers = new Map();
  }

  /**
   * 兵線立體交通分級(小地圖圖例):沿線行進式取樣(帶上一步高度問 surfaceAt,
   * 與 _initLanes 的箭頭剖面同一套規則)—— 站上橋面 = bridge、進洞內 = tunnel、其餘地面。
   * 回傳每條線的 [{x, z, grade}] 取樣序列(世界座標,_drawMinimap 轉小地圖再分段畫虛線)。
   */
  _gradeLanes() {
    const SEG = 6;
    return this.lanePts.map((raw) => {
      const pts = raw.map((p) => [p.x, p.z]);
      if (pts.length < 2) return [];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      }
      const total = cum[cum.length - 1];
      const at = (s) => {
        let i = 1;
        while (i < pts.length - 1 && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      };
      const out = [];
      let py = this.terrain.heightAt(pts[0][0], pts[0][1]);
      for (let s = 0; s <= total; s += SEG) {
        const [sx, sz] = at(Math.min(s, total));
        py = this._surf(sx, sz, py + 1.2);
        let grade = 'ground';
        const tn = this.terrain.tunnelAt?.(sx, sz);
        if (tn && py + 1.2 < tn.ceil && Math.abs(py - tn.floor) < 0.6) {
          grade = 'tunnel';
        } else {
          const d = this.terrain.deckY?.(sx, sz);
          if (d != null && d > this.terrain.heightAt(sx, sz) + 0.5 && Math.abs(py - d) < 0.6) grade = 'bridge';
        }
        out.push({ x: sx, z: sz, grade });
      }
      return out;
    });
  }

  /**
   * 小地圖底圖 = 原始圖資:衛星影像原始像素(terrain.sampleColor,stylize 前捕捉的那份)上色,
   * 高程(terrain.heightAt)做西北光暈渲(hillshade)畫出稜線/谷地;海平面以下鋪水色。
   * 無衛星影像(離線 fallback)→ 高程分層設色。
   */
  _bakeMmBase(w, h) {
    const t = this.terrain;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const bctx = cv.getContext('2d');
    const img = bctx.createImageData(w, h);
    const stepX = (t.maxX - t.minX) / w, stepZ = (t.maxZ - t.minZ) / h;
    const hRange = Math.max(1e-6, t.maxH - t.minH);
    // 高程先取進緩衝:hillshade 梯度直接查鄰格,不重複三角取樣
    const hs = new Float32Array(w * h);
    for (let py = 0; py < h; py++) {
      const z = t.minZ + (py + 0.5) * stepZ;
      for (let px = 0; px < w; px++) hs[py * w + px] = t.heightAt(t.minX + (px + 0.5) * stepX, z);
    }
    // 高程分層設色(無影像時的底色):谷地深綠 → 山腰黃褐 → 稜線灰白
    const RAMP = [[46, 77, 64], [96, 108, 74], [139, 121, 88], [205, 200, 190]];
    const rampAt = (f) => {
      const s = Math.max(0, Math.min(0.999, f)) * (RAMP.length - 1);
      const i = Math.floor(s), k = s - i;
      return [0, 1, 2].map((c) => RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * k);
    };
    for (let py = 0; py < h; py++) {
      const z = t.minZ + (py + 0.5) * stepZ;
      for (let px = 0; px < w; px++) {
        const x = t.minX + (px + 0.5) * stepX;
        const k = py * w + px, y = hs[k];
        let rgb = t.sampleColor?.(x, z) || rampAt((y - t.minH) / hRange);
        if (t.waterY != null && y < t.waterY) rgb = [38, 66, 92];   // 海平面以下 = 水色
        // 西北光 hillshade:高度朝東南遞增(= 坡面朝西北)的斜面亮、背光面暗
        const dx = (px > 0 && px < w - 1) ? hs[k + 1] - hs[k - 1] : 0;
        const dz = (py > 0 && py < h - 1) ? hs[k + w] - hs[k - w] : 0;
        const shade = Math.max(0.55, Math.min(1.3, 0.92 + (dx + dz) / (stepX + stepZ) * 0.9));
        const o = k * 4;
        img.data[o] = Math.min(255, rgb[0] * shade);
        img.data[o + 1] = Math.min(255, rgb[1] * shade);
        img.data[o + 2] = Math.min(255, rgb[2] * shade);
        img.data[o + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    // 壓一層暗紗:單位/兵線標記才拉得開對比
    bctx.fillStyle = 'rgba(5, 9, 13, 0.34)';
    bctx.fillRect(0, 0, w, h);
    return cv;
  }

  /** 戰爭迷霧視野來源(鏡像 sim._visionSources):己方存活單位各自 sight 半徑。
   *  瞄準視野加成:aiming 是小隊共用狀態(SQUAD_SHARED)→ 自機與僚機一起放大;
   *  其他友方英雄的瞄準狀態快照未攜帶,不鏡像 —— 僅顯示層誤差(單位標記本就畫在迷霧之上)。 */
  _mmVision() {
    const out = [];
    const aimF = this.aiming ? GAME.AIM_SIGHT_MULT : 1;
    for (const ent of this.ents.values()) {
      if (ent.side !== this.side || ent.isSelf || ent.dead || ent.hp <= 0) continue;
      if (ent.decoy && ent.lost) continue;   // 失聯餌機不回傳遙測(與伺服器同規則)
      const sight = UNITS[ent.kind]?.sight;
      if (sight == null) continue;
      out.push([ent.mesh.position.x, ent.mesh.position.z, sight * (ent.hero && ent.pid === this.youId ? aimF : 1)]);
    }
    if (!this.dead && this.heroKind) {
      const sight = UNITS[this.heroKind]?.sight;
      if (sight != null) out.push([this.pos.x, this.pos.z, sight * aimF]);
    }
    return out;
  }

  /**
   * 視野源(vx,vz,半徑 r)被障礙圓柱擋出的陰影多邊形(小地圖座標),供迷霧挖除。
   * 障礙 = terrain.blockers(建物/神木/巨岩/橋墩),半徑取 min(60, r) 與伺服器上傳 occ 對齊
   * ⇒ 小地圖迷霧的遮蔽與伺服器 _losBlocked 用同一份圓柱幾何,「看得到的地方才亮」一致。
   * 每柱兩條切線之外(遠端)= 本影:自切點沿切線方向延伸出視野外,由暫存罩的視野圓自然裁掉。
   * 高度不入帳:伺服器對「地面觀察者→地面目標」任何有碰撞的柱皆擋(眼高/目標高皆低於柱頂),
   * 這裡對齊地面偵測語意,一律當不透明圓 —— 寧可多霧(躲掩體者完全不可檢測)也不漏。
   */
  _mmShadows(vx, vz, r, w, h) {
    const bl = this.terrain.blockers;
    if (!bl || !bl.length) return null;
    const out = [];
    const FAR = r * 2;   // 遠端延伸(超出視野圓,溢出部分被暫存罩裁掉)
    for (const b of bl) {
      const br = Math.min(60, b.r);
      if (br < 0.5) continue;
      const dx = b.x - vx, dz = b.z - vz;
      const d = Math.hypot(dx, dz);
      if (d <= br) continue;          // 光源在障礙內 → 不投影
      if (d - br >= r) continue;       // 障礙整體在視野外
      if (br / d < 0.02) continue;     // 角徑過小(≈1°)→ 陰影可忽略
      const th = Math.atan2(dz, dx);
      const al = Math.asin(br / d);    // 切線半張角
      const tD = Math.sqrt(d * d - br * br);   // 切點距離
      const a0 = th - al, a1 = th + al;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      out.push([
        this._world2mm(vx + c0 * tD, vz + s0 * tD, w, h),
        this._world2mm(vx + c0 * FAR, vz + s0 * FAR, w, h),
        this._world2mm(vx + c1 * FAR, vz + s1 * FAR, w, h),
        this._world2mm(vx + c1 * tD, vz + s1 * tD, w, h),
      ]);
      if (out.length >= 96) break;     // 密集市區防爆:上限 96 柱
    }
    return out;
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
    ctx.drawImage(this._mmBase, 0, 0);   // 底圖:原始圖資地形
    // 戰爭迷霧(觀戰無迷霧):未探索近全黑、已探索留暗紗、目前視野全亮。
    // 迷霧只壓底圖 —— 兵線(已知情報)與單位(快照本身就是伺服器迷霧過濾後的結果,
    // 塔/主堡恆可見)一律畫在迷霧之上,與伺服器可見性規則一致。
    if (this.side) {
      // 視野圈按 x/z 各自比例尺畫橢圓 —— battleBBox 是兵線包絡聯集,非恆正方形,
      // 正圓會與逐軸縮放的單位標記在被拉伸的軸向上對不齊
      const scX = w / (this.terrain.maxX - this.terrain.minX);
      const scZ = h / (this.terrain.maxZ - this.terrain.minZ);
      const pulse = now < this._pulseUntil;   // 偵察脈衝:全隊無霧(鏡像 snapshotFor 的 pulse 旁路)
      const vis = this._mmVision();
      const sctx = this._mmSeen.getContext('2d');
      // 每源在暫存罩上先畫視野圓、再挖掉障礙陰影(_mmShadows),隔離後才合成 —— 建物/神木/巨岩背後
      // 的本影維持迷霧,與伺服器 _losBlocked 過濾單位同一份圓柱幾何(躲掩體者完全不可檢測)。
      const scc = this._mmScr.getContext('2d');
      const shadows = pulse ? null : vis.map(([vx, vz, r]) => this._mmShadows(vx, vz, r, w, h));
      const drawReveal = (mx, my, rx, ry, soft, polys) => {
        scc.globalCompositeOperation = 'source-over';
        scc.clearRect(0, 0, w, h);
        if (soft) {                    // 目前視野:柔邊漸層(縮放座標系畫橢圓)
          scc.save(); scc.translate(mx, my); scc.scale(1, ry / rx);
          const grad = scc.createRadialGradient(0, 0, rx * 0.72, 0, 0, rx);
          grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
          scc.fillStyle = grad; scc.beginPath(); scc.arc(0, 0, rx, 0, 7); scc.fill(); scc.restore();
        } else {                       // 已探索累積:硬邊實心橢圓
          scc.fillStyle = '#fff';
          scc.beginPath(); scc.ellipse(mx, my, rx, ry, 0, 0, 7); scc.fill();
        }
        if (polys && polys.length) {   // 挖掉障礙本影(僅動本源暫存罩,不誤刪他源已照亮區)
          scc.globalCompositeOperation = 'destination-out';
          for (const p of polys) {
            scc.beginPath(); scc.moveTo(p[0][0], p[0][1]);
            for (let k = 1; k < p.length; k++) scc.lineTo(p[k][0], p[k][1]);
            scc.closePath(); scc.fill();
          }
        }
      };
      if (pulse) { sctx.globalCompositeOperation = 'source-over'; sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, w, h); }  // 脈衝看過的全圖進「已探索」
      else {
        sctx.globalCompositeOperation = 'source-over';
        for (let n = 0; n < vis.length; n++) {   // 已探索累積(整場保留:走過的地圖記得住,陰影區從未照亮不入帳)
          const [vx, vz, r] = vis[n];
          const [mx, my] = this._world2mm(vx, vz, w, h);
          drawReveal(mx, my, Math.max(6, r * scX), Math.max(6, r * scZ), false, shadows[n]);
          sctx.drawImage(this._mmScr, 0, 0);
        }
        const f = this._mmFog.getContext('2d');
        f.globalCompositeOperation = 'source-over';
        f.globalAlpha = 1;
        f.clearRect(0, 0, w, h);
        f.fillStyle = 'rgba(4, 7, 11, 0.9)';
        f.fillRect(0, 0, w, h);
        f.globalCompositeOperation = 'destination-out';
        f.globalAlpha = 0.5;
        f.drawImage(this._mmSeen, 0, 0);   // 已探索:掀掉一半暗紗
        f.globalAlpha = 1;
        for (let n = 0; n < vis.length; n++) {   // 目前視野:全亮(柔邊 − 障礙陰影)
          const [vx, vz, r] = vis[n];
          const [mx, my] = this._world2mm(vx, vz, w, h);
          drawReveal(mx, my, Math.max(6, r * scX), Math.max(6, r * scZ), true, shadows[n]);
          f.globalCompositeOperation = 'destination-out';
          f.drawImage(this._mmScr, 0, 0);
        }
        ctx.drawImage(this._mmFog, 0, 0);
      }
    }
    // 兵線:依立體交通分段畫線 —— 地面實線、高架橋 --- 虛線、地下道/隧道 ⋯ 點線
    const cols = ['#e6c34a', '#e05c4a', '#4ac3e6'];
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    this._mmLanes.forEach((samples, i) => {
      if (samples.length < 2) return;
      ctx.strokeStyle = cols[i % cols.length];
      let k = 0;
      while (k < samples.length - 1) {
        const gr = samples[k].grade;
        let e = k + 1;
        while (e < samples.length - 1 && samples[e].grade === gr) e++;
        ctx.setLineDash(gr === 'bridge' ? [5, 4] : gr === 'tunnel' ? [1.5, 3.5] : []);
        ctx.beginPath();
        for (let j = k; j <= e; j++) {
          const [mx, my] = this._world2mm(samples[j].x, samples[j].z, w, h);
          j === k ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
        }
        ctx.stroke();
        k = e;
      }
    });
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // 單位(中立障礙不上圖:偵察情報要親眼看)
    for (const ent of this.ents.values()) {
      if (ent.neutral) continue;
      const [mx, my] = this._world2mm(ent.mesh.position.x, ent.mesh.position.z, w, h);
      const c = sideInfo(ent.side).color;   // 第三方(GUER/MILI)走各自識別色
      ctx.fillStyle = c;
      if (ent.kind === 'base') {
        ctx.fillRect(mx - 5, my - 5, 10, 10);
        ctx.strokeStyle = c; ctx.strokeRect(mx - 7, my - 7, 14, 14);
      } else if (ent.kind === 'tower') {
        ctx.fillRect(mx - 3, my - 3, 6, 6);
      } else if (ent.kind === 'bunker') {
        continue;   // 碉堡改由 _seenBunkers 永久標示(見下方持久層),避免離開視野即消失
      } else if (ent.hero) {
        if (!ent.isSelf) {
          ctx.beginPath(); ctx.arc(mx, my, 4, 0, 7); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      } else {
        // NPC 兵團:實心圓點標位置(直升機加外環,一眼看出空中單位),深色描邊拉出對比
        const r = ent.kind === 'heli' ? 3 : 2.4;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, 7); ctx.fill();
        ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
        if (ent.kind === 'heli') {
          ctx.beginPath(); ctx.arc(mx, my, r + 1.6, 0, 7);
          ctx.lineWidth = 1; ctx.strokeStyle = c; ctx.stroke();
        }
      }
    }
    // 已探索的第三方碉堡:永久標示(方塊 + 白框標記為已知據點),即使離開視野/摧毀待重建也保留
    for (const b of this._seenBunkers.values()) {
      const [mx, my] = this._world2mm(b.x, b.z, w, h);
      ctx.fillStyle = sideInfo(b.side).color;
      ctx.fillRect(mx - 2.5, my - 2.5, 5, 5);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeRect(mx - 3.5, my - 3.5, 7, 7);
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
      ctx.rotate(-this.yaw);   // 前方 = (−sinYaw,−cosYaw);世界→小地圖同號 ⇒ θ = −yaw(舊 +π 讓箭頭反向)
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

    this._updateAaMode();             // 榴彈對空彈射模式:MUST 在 _tickWeapons(擊發)之前定案
    this._lobAim();                   // 榴彈火控解(消費 _aaEnt):同樣 MUST 在擊發之前 —— 所見即所射
    this._tickWeapons(now);
    this._updatePlayer(dt, now);
    if (this._deathSeq && !this._gameOver) this._updateDeathSeq(dt, now);   // 陣亡過場獨佔鏡頭(_updatePlayer 已對 dead 早退)
    this._updateEnts(dt, now);
    this._updateBullets(dt);
    this._updateMissiles(dt);
    this._updateVisShells(dt);
    this._updateDecoyBombs(dt);       // 餌機投彈拋擲動畫(2026-07-22)
    this._updateArcGuide();           // 榴彈拋物線瞄準指示(2026-07-22)
    this._updateGuideLaser();         // 雷射導引武器的第一人稱導引雷射(2026-07-23)
    this._updateLaneArrows(now);
    this._updateMines(now);
    this._updateLoot(dt, now);
    this._updateAirdrop(dt, now);
    this._updateEffects(dt);
    for (const s of this.shields) s.userData.update(dt);
    if (this._auras) for (const ent of this._auras) {   // 補血光環 / 第三方射程環:緩慢脈動
      const p = 0.22 + 0.12 * Math.sin(now * 1.6);
      ent.auraRing.material.opacity = p;
      // 移動的第三方單位(soldier/tank/heli 巡邏/追擊):射程環跟著機體貼地移動;
      // 靜態的 base 補血光環與 bunker 射程環(isStatic)固定不動。
      if (!ent.isStatic && ent.aura) {
        const mx = ent.mesh.position.x, mz = ent.mesh.position.z;
        ent.aura.position.set(mx, this.terrain.heightAt(mx, mz) + 0.6, mz);
      }
    }
    this.envFx?.update(dt, this.camera);
    this.terrain.biomesUpdate?.(dt);   // 地貌動態物件(火車 / 瀑布)
    for (const m of this.mixers) m.update(dt);
    for (const g of this.spinners) {
      for (const p of g.userData.spin) p.rotation.y += dt * 40;
    }
    // 座艙:旋翼/螺旋槳恆轉、撲翼拍動、型態切換、槍身後坐回彈、槍口焰熄滅
    if (this.cockpit) {
      const ct = (this._cockT += dt);
      for (const p of this.cockpitSpin) p.rotation.y += dt * 55;
      for (const p of this.cockpitSpinZ) p.rotation.z += dt * 30;
      for (const f of this.cockpitFlap) f.o.rotation[f.ax] = f.base + f.amp * Math.sin(ct * f.hz * 6.283 + f.ph);
      this._syncCockpitWeapon();
      this.weaponKick = Math.max(0, this.weaponKick - dt * 9);
      const cur = this._curWeapon();
      let reloadOff = { dz: 0, dy: 0, rx: 0 };
      if (cur.def && cur.st && cur.st.reloadEnd > 0) {
        // 進度分母 = 武器階級解析後的填彈時長(2026-07-20:無精通折減),否則動作提前結束定格
        const rl = cur.def.reload;
        const p = 1 - Math.max(0, cur.st.reloadEnd - now) / rl;
        reloadOff = this._reloadAnimOffset(cur.def, p);
      }
      this.gunGroup.position.z = this._gunBaseZ + this.weaponKick * 0.11 + reloadOff.dz;
      this.gunGroup.position.y = reloadOff.dy;
      // 榴彈砲口跟著火控解抬高(超高仰角):拋物線武器本就不是沿準星直射,砲管平指才是穿幫
      this.gunGroup.rotation.x = reloadOff.rx + (this._lobFc?.on ? this._lobFc.sup : 0);
      if (this._flashTtl != null) {
        this._flashTtl -= dt;
        if (this._flashTtl <= 0) { this.flash.visible = false; this._flashTtl = null; }
        else this.flash.scale.setScalar((0.7 + Math.random() * 0.7) * (this._flashHeavy ? 2.3 : 1));
      }
      this.cockpit.visible = !this.dead || !!this._deathSeq;   // 過場期間保留座艙,隨鏡頭傾倒/翻滾(第一人稱殉爆)
    }
    this._updateWaterVeil();   // 水下/沼澤視野變色(最終 camera 定案後、render 前)
    this._drawMinimap(now);
    updateCelLight(this.camera);   // 硬邊金屬高光帶的 view-space 光向
    this.renderer.render(this.scene, this.camera);
    this._renderPips();
    this._renderDeathCam();
    this.hud.locked?.(now < (this._lockedUntil || 0));
    // 平民互動提示:靠近平民時顯示「[G]跟隨 [H]驅趕」+ 其陣營(不揭露間諜)
    const nc = this._nearestCiv();
    this._civTarget = nc;
    this.hud.civPrompt?.(nc ? { cs: nc.cs, self: nc.cs === this.side, follow: !!nc.fo } : null);
  }

  // ---------------- 副視窗(PiP)----------------
  /**
   * 需要小螢幕的視角:蜂群 = 非主視野的僚機(最多 2 個);機甲 = 空中的餌機(1 個)。
   * 餌機失聯後不再回傳畫面 → 不渲染(HUD 由 hud.feed 播報鏈路中斷)。
   */
  _pipSources() {
    const out = [];
    if (!this.side || this.dead) return out;
    for (const ent of this.ents.values()) {
      if (ent.pid !== this.youId) continue;
      if (this.isDrone) {
        if (ent.hero && !ent.isSelf && !ent.dead) out.push({ ent, tag: `${ent.si + 1}號機` });
      } else if (ent.decoy && !ent.lost) {
        out.push({ ent, tag: '餌機' });
      }
    }
    return out.sort((a, b) => a.ent.si - b.ent.si).slice(0, 2);
  }

  /**
   * 在主畫面左上角疊畫小螢幕:scissor 限制清除/繪製範圍,同一個 scene 重繪。
   * 座艙掛在主相機底下、來源機體自己的模型 → 兩者都要在該次繪製中藏起來。
   */
  _renderPips() {
    const list = this._pipSources();
    if (!list.length) return;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const pw = Math.round(Math.min(PIP.MAX_W, W * PIP.W_FRAC));
    const ph = Math.round(pw * PIP.ASPECT);
    const r = this.renderer;
    const cockVis = this.cockpit?.visible;
    if (this.cockpit) this.cockpit.visible = false;
    // setClearColor 是 renderer 全域狀態:畫外框會蓋掉它,收工前必須還原
    const clear0 = r.getClearColor(new THREE.Color());
    const alpha0 = r.getClearAlpha();
    this.pipCam.aspect = pw / ph;
    this.pipCam.updateProjectionMatrix();
    r.setScissorTest(true);
    list.forEach((p, i) => {
      const x = PIP.PAD;
      const y = H - PIP.TOP - ph - i * (ph + PIP.GAP);   // scissor 原點在左下,由上往下疊
      const m = p.ent.mesh;
      this.pipCam.position.copy(m.position);
      this.pipCam.position.y += p.ent.decoy ? 0.6 : 1.2;
      // ry 是相機朝向慣例(前方 = -z),模型才要 +π
      this.pipCam.rotation.set(0, p.ent.ry, 0, 'YXZ');
      // 外框:先清一圈陣營色,再把內圈交給場景繪製
      r.setScissor(x - 2, y - 2, pw + 4, ph + 4);
      r.setClearColor(SIDES[this.side].color, 1);
      r.clear(true, false, false);
      r.setViewport(x, y, pw, ph);
      r.setScissor(x, y, pw, ph);
      const wasVisible = m.visible;
      m.visible = false;              // 不要從自己的鼻子裡往外看
      r.render(this.scene, this.pipCam);
      m.visible = wasVisible;
    });
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.setClearColor(clear0, alpha0);
    if (this.cockpit) this.cockpit.visible = cockVis;
  }

  /**
   * 陣亡頁的「最前線砲塔視角」小視窗:離敵堡最近的存活我方砲塔往敵方看(無砲塔 → 我方主堡)。
   * 與 _renderPips 同法(scissor 在主 canvas 上重繪場景),但視窗位置對齊 DOM 框 #deadCam
   * (該框內部透明,外圈由 CSS box-shadow 打洞式變暗);共用 pipCam(陣亡時 _renderPips 早退不衝突)。
   */
  _renderDeathCam() {
    if (!this.dead || this._deathSeq || this._gameOver || !this.side || !this.cfg) return;   // 過場播放中不繪砲塔視窗
    const frame = document.getElementById('deadCam');
    if (!frame || frame.offsetParent === null) return;   // 陣亡頁未顯示 → 不繪

    const enemy = this.side === 'SWARM' ? 'STEEL' : 'SWARM';
    const [ex, ez] = llToWorld(this.cfg.bases[enemy][0], this.cfg.bases[enemy][1], this.center);
    // 最前線 = 離敵堡最近的存活我方砲塔;查無 → 我方主堡
    let src = null, best = Infinity;
    for (const e of this.ents.values()) {
      if (e.kind !== 'tower' || e.side !== this.side || e.dead || !e.mesh) continue;
      const d = (e.mesh.position.x - ex) ** 2 + (e.mesh.position.z - ez) ** 2;
      if (d < best) { best = d; src = e; }
    }
    if (!src) for (const e of this.ents.values()) {
      if (e.kind === 'base' && e.side === this.side && e.mesh) { src = e; break; }
    }
    if (!src) return;

    const m = src.mesh.position, cam = this.pipCam;
    cam.position.set(m.x, m.y + (src.dimTop || 14) + 2, m.z);
    cam.up.set(0, 1, 0);
    // 朝敵堡方向 100m 外近地面看 → 自然俯瞰兵線來襲方向
    const dx = ex - m.x, dz = ez - m.z, dl = Math.hypot(dx, dz) || 1;
    cam.lookAt(m.x + dx / dl * 100, m.y + 1, m.z + dz / dl * 100);

    const r = this.renderer, canvas = this.canvas;
    const cr = canvas.getBoundingClientRect(), fr = frame.getBoundingClientRect();
    const bw = 2;   // 內縮 CSS 邊框
    const px = fr.left - cr.left + bw, pw = fr.width - bw * 2, ph = fr.height - bw * 2;
    const y = canvas.clientHeight - (fr.top - cr.top + bw) - ph;   // scissor 原點左下
    if (pw < 6 || ph < 6) return;
    cam.aspect = pw / ph;
    cam.updateProjectionMatrix();

    const cockVis = this.cockpit?.visible;
    if (this.cockpit) this.cockpit.visible = false;
    const clear0 = r.getClearColor(new THREE.Color()), alpha0 = r.getClearAlpha();
    r.setScissorTest(true);
    r.setViewport(px, y, pw, ph);
    r.setScissor(px, y, pw, ph);
    r.render(this.scene, cam);   // autoClear 只清 scissor 內
    r.setScissorTest(false);
    r.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
    r.setClearColor(clear0, alpha0);
    if (this.cockpit) this.cockpit.visible = cockVis;
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
    document.removeEventListener('pointerlockchange', this._onPlc);
    document.exitPointerLock?.();
    this.renderer.dispose();
  }
}
