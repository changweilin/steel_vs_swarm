// ============ 劇情戰役地圖 + NPC BOSS 稽核 ============
// 用途:改 `data.js` 的 `STORY_MAP`/`mapPlan`/`mapArg`/`mapScaleF`/`laneChainOf`/`laneCountFor`/
// `siteCPs`/`solveTowerSites` 的劇情分支/`BOSS` 那一整區塊,或 `sim.js` 的 `isBoss`/`_bossAnchor`/
// `_bossSync`/`_bossEnrage`/`_healBody`/`addHero`/`_kill`/`_prefillLanes`,或 `bots.js` 的
// `_zoneClamp`/`_home`/`_hold`,或 `rooms.js` 的旗標正規化之後跑。
//
// 2026-08-13 使用者定案(原句見 data.js STORY_MAP / BOSS 檔頭)。這一支要咬住的是**六種
// 不會有錯誤訊息、只表現成「這場戰役怪怪的」的壞法**:
//   ① **半套地圖** —— 塔拆成非對稱了而地圖沒縮(或反過來)。四個推論全掛在 `defSide` 一格上,
//      任一項各自寫死就是半套,而每一條既有斷言照樣全綠。
//   ② **消費端直接讀 `site.SWARM`/`site.STEEL`** —— 劇情戰役有一側是 undefined:好一點的當場炸,
//      壞一點的展開成 `p.x` 生出 NaN 座標,世界就長在一個不存在的地方。
//   ③ **BOSS 沒被點進逐階存活數** —— `_spawnStructures` 在建構期就數完了(那時還沒有英雄)⇒
//      前線 BOSS 還活著,中段就解鎖了。
//   ④ **恢復三條規則沒寫在同一個點** —— 漏掉段天花板的症狀是「BOSS 被治療招式一路推回滿血,
//      而狂暴等級留在最高」。
//   ⑤ **狂暴化沒走 `_applyUpg`** —— 升階可能加大彈夾,漏掉清空那一段 = BOSS 拿著舊彈匣計數。
//   ⑥ **一般對戰被波及** —— 省略 `defSide` 的每一條推導 MUST 逐位元同舊制。
//
// 反向驗證(原則 9;每一支都 MUST 讓對應條目紅字,否則等於沒驗到):
//   node tools/audit_story_map.mjs --break-stage     敵方塔位階數改成 1(= 迷你地圖)
//   node tools/audit_story_map.mjs --break-hpmul     段權重改了而總倍率手寫沒跟著走
//   node tools/audit_story_map.mjs --break-full      建圖/生成改吃「完整戰場」的塔位解
//   node tools/audit_story_map.mjs --break-cap       恢復不夾當前段天花板(退回 min(maxHp, …))
//   node tools/audit_story_map.mjs --break-enrage    擊破一段不升攻擊面
//   node tools/audit_story_map.mjs --break-respawn   BOSS 照一般規則重生
//   node tools/audit_story_map.mjs --break-team      地圖大小跟著人數走(= 迷你地圖那條路)
//   node tools/audit_story_map.mjs --break-prefill   開場預置退回「兩側取較小者」(守方補不到前線塔)
//   node tools/audit_story_map.mjs --break-sp        進段不補滿護盾
//   node tools/audit_story_map.mjs --break-hpscale   裝甲上限升級補滿那一截(= 段位被推回上一階)
//   node tools/audit_story_map.mjs --break-allybot   我方電腦玩家的傷害折減拿掉
// 跑法:`node tools/audit_story_map.mjs`
// 讀原文與抽方法走 `audit_src.mjs` 單一縫(含換行正規化 —— 逐行剝註解在 CRLF 工作區會靜默失效)。
import { readSrc, grabMethod } from './audit_src.mjs';
import {
  STORY_MAP, MINI, FULL_STAGES, TEAM, SIEGE, UNITS, GAME, ECON, OTHER_SIDE, CHARACTERS,
  mapPlan, mapArg, mapScaleF, miniScaleF, laneChainOf, laneChainF, laneCountFor, towerStages,
  solveTowerSites, siteCPs, siegeSiteStages, towerLayoutAudit, edgeBufferM, llToXZ,
  waveSpacingM, siegeTalkS, allyBotDmgF, isBotId, hitH, hitR, HERO_HIT_R, heroTargetH, heroWeapon, heroAbility,
  heroMobility, vsMult,
  BOSS, bossSegN, bossSegCapF, bossSegOf, bossGlow, bossZoneR, bossSlotPlan, bossSlotOff, bossHealF,
  bossScaleF, bossInvulnS,
} from '../public/js/data.js';
import { VENUES, venueConfig } from '../public/js/venues.js';
import { BattleSim } from '../server/sim.js';
import { BotBrain } from '../server/bots.js';

const ARG = new Set(process.argv.slice(2));
const BRK = {
  stage: ARG.has('--break-stage'), hpmul: ARG.has('--break-hpmul'), full: ARG.has('--break-full'),
  cap: ARG.has('--break-cap'), enrage: ARG.has('--break-enrage'), respawn: ARG.has('--break-respawn'),
  team: ARG.has('--break-team'),
  prefill: ARG.has('--break-prefill'), sp: ARG.has('--break-sp'),
  hpscale: ARG.has('--break-hpscale'), allybot: ARG.has('--break-allybot'),
  invuln: ARG.has('--break-invuln'), scale: ARG.has('--break-scale'),
  enrageNpc: ARG.has('--break-enrage-npc'), enrageSpd: ARG.has('--break-enrage-spd'),
  enrageDmg: ARG.has('--break-enrage-dmg'), enrageCd: ARG.has('--break-enrage-cd'),
  enrageRate: ARG.has('--break-enrage-rate'),
  turretRange: ARG.has('--break-turret-range'),
};
// 壞版:開場預置退回「兩側一律取較小者」。做法 = 在 `_prefillLanes` 執行期間把 defSide 藏起來
// (那正是舊制的行為),不必抄一份舊實作 —— 抄的那一份會自己過期。
if (BRK.prefill) {
  const real = BattleSim.prototype._prefillLanes;
  BattleSim.prototype._prefillLanes = function () {
    const def = this.defSide; this.defSide = null; real.call(this); this.defSide = def;
  };
}
// 壞版:段權重多一段而總倍率留在原地(= 手寫 10 的下場)
if (BRK.hpmul) BOSS.SEG_W = [1, 2, 3, 4, 5];
// 壞版:敵方只剩一階塔(照抄迷你地圖的階數 ⇒ 沒有中段砲塔可打,而地圖大小自己會跟著縮)
if (BRK.stage) STORY_MAP.DEF_STAGES = MINI.STAGES;
if (BRK.invuln) BOSS.INVULN_S = [0, 0, 0, 0];
if (BRK.scale) BOSS.SCALE_F = [1.0, 1.0, 1.0, 1.0];
if (BRK.enrageNpc) BOSS.ENRAGE_NPC_DMG_F = 1.0;
if (BRK.enrageSpd) BOSS.ENRAGE_SPD_F = 1.0;
if (BRK.enrageDmg) BOSS.ENRAGE_DMG_F = 1.0;
if (BRK.enrageCd) { BOSS.ENRAGE_CD_F = 1.0; BOSS.ENRAGE_RELOAD_F = 1.0; }
if (BRK.enrageRate) BOSS.ENRAGE_RATE_F = 1.0;

let pass = 0, fail = 0;
const t = (n, ok, extra = '') => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const simSrc = readSrc('server', 'sim.js');
const botSrc = readSrc('server', 'bots.js');
const bioSrc = readSrc('public', 'js', 'biomes.js');
const terrSrc = readSrc('public', 'js', 'terrain.js');
const dataSrc = readSrc('public', 'js', 'data.js');
const mainSrc = readSrc('public', 'js', 'main.js');
const roomsSrc = readSrc('server', 'rooms.js');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

// ---------------------------------------------------------------------------
console.log('■ Ⅰ 地圖型態:一格旗標四個推論(data.js STORY_MAP)');
// ---------------------------------------------------------------------------
{
  t("mapPlan 三態:省略 = full / true = mini / side 字串 = story",
    mapPlan().mode === 'full' && mapPlan(true).mode === 'mini'
    && mapPlan('STEEL').mode === 'story' && mapPlan('SWARM').def === 'SWARM');
  t('無效字串退回完整戰場(客戶端送上來的旗標不可信,而半套狀態比拒絕更糟)',
    mapPlan('FOO').mode === 'full' && mapPlan(0).mode === 'full');
  t('mapArg 由 battleConfig 推導(defSide 優先於 mini)',
    mapArg({ defSide: 'STEEL', mini: true }) === 'STEEL' && mapArg({ mini: true }) === true
    && mapArg({}) === false && mapArg(null) === false);

  // ① 兵線數:劇情戰役恆單線,不看人數
  t(`劇情戰役恆 ${STORY_MAP.LANES} 條兵線(3v3 / 5v5 都一樣)`,
    laneCountFor(3, 'STEEL') === STORY_MAP.LANES && laneCountFor(5, 'SWARM') === STORY_MAP.LANES);
  t('一般對戰的兵線數逐位元同舊制(1/3/5 人 → 1/2/3 線)',
    laneCountFor(1) === 1 && laneCountFor(3) === 2 && laneCountFor(5) === 3);

  // ② 塔位階數:我方 0 / 敵方 = 攻堅的兩階塔
  t('我方前線就是主堡 ⇒ 攻方零座塔', mapPlan('STEEL').atkStages === 0);
  t(`敵方兩階塔 + 主堡 = 攻堅三階(DEF_STAGES ${STORY_MAP.DEF_STAGES} MUST === SIEGE.BASE ${SIEGE.BASE})`,
    STORY_MAP.DEF_STAGES === SIEGE.BASE);
  t('towerStages 對完整 / 迷你逐位元同舊制',
    towerStages(false) === FULL_STAGES && towerStages(true) === MINI.STAGES);

  // ③ 地圖尺度:推導不手寫
  t(`塔鏈需求 = 攻方 + 守方 + 1(完整 ${laneChainOf(false)} / 迷你 ${laneChainOf(true)} / 劇情 ${laneChainOf('STEEL')})`,
    laneChainOf(false) === laneChainF(FULL_STAGES) && laneChainOf(true) === laneChainF(MINI.STAGES)
    && laneChainOf('STEEL') === STORY_MAP.ATK_STAGES + STORY_MAP.DEF_STAGES + 1);
  t('完整戰場的尺度倍率**逐位元** 1(x * 1 === x ⇒ 一般對戰一格未動)', mapScaleF() === 1 && mapScaleF(false) === 1);
  t(`劇情戰役 = 迷你地圖大小(${mapScaleF('STEEL')} = miniScaleF ${miniScaleF()})—— 這是推導出來的巧合,不是抄過來的數字`,
    mapScaleF('STEEL') === miniScaleF() && mapScaleF('STEEL') === laneChainOf('STEEL') / laneChainOf(false));
  // 使用者追問定案:「不管人數多少都跟迷你地圖 2vs2 一樣大小」。
  // 這一條目前是**兩步推導的結果**(兵線數被 `laneCountFor` 釘成 1 → 尺度函式只吃 L 不吃人數),
  // 而兩步都可能被日後的改動拆掉(劇情改多兵線 / 尺度公式改讀 teamSize)⇒ 直接把結論釘死:
  // 逐人數與「迷你 2v2」的**整份幾何**(邊長 / 對角 / 兩堡距離 / 主堡座標 / 兵線折線)逐位元相同。
  {
    const geom = (c) => JSON.stringify({ sizeM: c.sizeM, diagM: c.diagM, distM: c.distM, bases: c.bases, lanes: c.lanes, laneCount: c.laneCount });
    let same = 0, tot = 0; const bad = [];
    for (const v of VENUES.slice(0, 12)) {
      const ref = geom(venueConfig(v, MINI.TEAM_MAX, true));   // 迷你地圖能開的最大人數 = 2v2
      for (let ts = TEAM.MIN; ts <= TEAM.MAX; ts++) {
        tot++;
        // 壞版 = 兵線數(進而地圖大小)跟著人數走,也就是迷你地圖那條路
        if (geom(venueConfig(v, ts, BRK.team ? true : 'SWARM')) === ref) same++; else bad.push(`${v.id}/${ts}v${ts}`);
      }
    }
    t(`不管人數多少,劇情戰役的整份幾何都與迷你 ${MINI.TEAM_MAX}v${MINI.TEAM_MAX} **逐位元相同**(${TEAM.MAX} 種人數 × 12 場地)`,
      same === tot, bad.slice(0, 4).join(' '));
  }
  t('尺度函式只吃兵線數 L,不吃人數(人數只准經 `laneCountFor` 影響 L)',
    !/teamSize/.test(dataSrc.slice(dataSrc.indexOf('export const realSideMFor'), dataSrc.indexOf('export const overlapCellM'))));

  // ④ 緩衝深度:劇情刻意不縮(BUFFER_F 換的是手機幀率,使用者這一輪講的是地圖大小)
  t('劇情戰役的邊緣緩衝與完整戰場同深(只有迷你地圖縮到 1/3)',
    near(edgeBufferM('STEEL'), edgeBufferM()) && near(edgeBufferM(true), edgeBufferM() * MINI.BUFFER_F));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅱ 塔位:只有防守方有塔,而位置照舊由「對距 ≥ SEP」定出來');
// ---------------------------------------------------------------------------
const SEP = UNITS.tower.range * GAME.TOWER_SEP_F;
const toGame = (cfg) => cfg.lanes.map((l) => l.map(([lat, lng]) => llToXZ(lat, lng, cfg.center)));
{
  t('solveTowerSites 省略參數 ≡ 明寫 false(逐位元)', (() => {
    const g = toGame(venueConfig(VENUES[0], 5));
    return JSON.stringify(solveTowerSites(g)) === JSON.stringify(solveTowerSites(g, false));
  })());

  let asym = 0, chained = 0, oppOk = 0, healOk = 0, spawnOk = 0, stageOk = 0, layoutOk = 0, n = 0;
  const soft = [];
  for (const v of VENUES.slice(0, 12)) {
    for (const def of ['SWARM', 'STEEL']) {
      const cfg = venueConfig(v, 3, def);
      const g = toGame(cfg);
      const sites = solveTowerSites(g, BRK.full ? false : def);
      const atk = OTHER_SIDE[def];
      n++;
      // 每條兵線恰 DEF_STAGES 個塔位,而且只有防守方那一側有鍵
      if (sites.length === STORY_MAP.LANES
        && sites.every((ls) => ls.length === STORY_MAP.DEF_STAGES
          && ls.every((st) => st[def] && !st[atk] && siteCPs(st).length === 1
            && siteCPs(st)[0].side === def))) asym++;
      // 階段:末項 = 前線(frac 最大);siegeSiteStages 給 [1, 0]
      const stages = siegeSiteStages(sites[0]);
      if (stages[stages.length - 1] === 0 && stages.every((s, i) => (i === stages.length - 1 ? s === 0 : s > 0))) stageOk++;
      // 前線塔對攻方主堡的距離 ≥ SEP(= 對稱戰場的「不對射」同一條規則,對照物換成主堡)
      const ep = g[0];
      const ab = atk === 'SWARM' ? { x: ep[0][0], z: ep[0][1] } : { x: ep.at(-1)[0], z: ep.at(-1)[1] };
      const front = sites[0].at(-1)[def];
      if (front) {
        const fT = [-1, 1].map((s) => ({
          x: front.x + front.nx * GAME.TOWER_SIDE_OFF * s,
          z: front.z + front.nz * GAME.TOWER_SIDE_OFF * s,
        }));
        // 壞版模擬(--break-turret-range):刻意把砲塔往前拉進主堡 40m
        const testT = BRK.turretRange ? fT.map((t) => ({ x: ab.x + (t.x - ab.x) * 0.5, z: ab.z + (t.z - ab.z) * 0.5 })) : fT;
        const d = Math.min(...testT.map((t) => Math.hypot(t.x - ab.x, t.z - ab.z)));
        if (d >= SEP - 1) oppOk++;

        // 敵方砲塔攻擊範圍不可涵蓋主堡治療光環
        const dHeal = d - GAME.HERO_HEAL_R;
        if (dHeal > UNITS.tower.range) healOk++;

        // 敵方砲塔攻擊範圍不可涵蓋主堡重生處
        const end = atk === 'SWARM' ? ep[0] : ep[ep.length - 1];
        const nxt = atk === 'SWARM' ? ep[1] : ep[ep.length - 2];
        let dx = nxt[0] - end[0], dz = nxt[1] - end[1];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = dz, pz = -dx;
        let allSpawnSafe = true;
        for (let sq = 0; sq < TEAM.MAX; sq++) {
          const layer = sq;
          const s = layer % 2 === 0 ? 1 : -1;
          for (let b = 0; b < 3; b++) {
            const lat = GAME.HERO_SPAWN_SIDE + Math.floor(layer / 2) * 11 + b * 10;
            const spx = end[0] + dx * GAME.HERO_SPAWN_OFF + px * lat * s;
            const spz = end[1] + dz * GAME.HERO_SPAWN_OFF + pz * lat * s;
            for (const t of testT) {
              if (Math.hypot(t.x - spx, t.z - spz) <= UNITS.tower.range) {
                allSpawnSafe = false; break;
              }
            }
            if (!allSpawnSafe) break;
          }
          if (!allSpawnSafe) break;
        }
        if (allSpawnSafe) spawnOk++;

        // 塔位沿兵線由主堡往外遞增(中段在前線之前)
        if (sites[0].length < 2 || sites[0][0].frac < sites[0].at(-1).frac) chained++;
      }
      const la = towerLayoutAudit(g, BRK.full ? false : def);
      if (la.ok && !la.stackBad) layoutOk++;
      if (la.residual) soft.push(`${v.id}/${def} RB${Math.round(la.worstRB)}% RF${Math.round(la.worstRF)}%`);
    }
  }
  t(`${n} 組(場地 × 防守方)每條兵線恰 ${STORY_MAP.DEF_STAGES} 個塔位、且只有防守方有鍵`, asym === n, `${asym}/${n}`);
  t('末項 = 前線塔(與對稱版同約定 ⇒ siegeSiteStages / _prefillLanes / beacons 不必改)', stageOk === n, `${stageOk}/${n}`);
  t(`前線塔到**攻方主堡** ≥ 一個塔距 ${SEP.toFixed(0)}m(不對射;對照物換成主堡就是「我方前線就是主堡」)`,
    oppOk === n, `${oppOk}/${n}`);
  t(`前線塔攻擊範圍不涵蓋攻方主堡治療光環(半徑 ${GAME.HERO_HEAL_R}m,到主堡中心 > ${(UNITS.tower.range + GAME.HERO_HEAL_R).toFixed(0)}m)`,
    healOk === n, `${healOk}/${n}`);
  t(`前線塔攻擊範圍不涵蓋攻方主堡重生處(距重生點 > 射程 ${UNITS.tower.range}m)`,
    spawnOk === n, `${spawnOk}/${n}`);
  t('中段塔排在前線塔之後方(frac 遞增)', chained === n, `${chained}/${n}`);
  t('砲塔佈局規則(#4)照樣過:硬規則(不物理疊塔)MUST 全綠 —— 軟規則在劇情戰役降為警示',
    layoutOk === n, `${layoutOk}/${n}`);
  // 降級的是判定不是能見度:蜿蜒兵線上量不到一整個塔距的那幾張,逐張列出來
  console.log(soft.length
    ? `  ⓘ 軟規則殘餘(best-effort,已列入警示不擋房):${soft.join(' / ')}`
    : '  ⓘ 軟規則殘餘:無');
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅲ 消費端:塔位名冊走 siteCPs、地圖型態走 mapArg(原文閘)');
// ---------------------------------------------------------------------------
{
  t('siteCPs 是 data.js 的具名縫(帶 side;缺席那一側自動不列)',
    siteCPs({ frac: 0.3, SWARM: { x: 1, z: 2, nx: 1, nz: 0 } }).length === 1
    && siteCPs({ frac: 0.3, SWARM: {}, STEEL: {} }).length === 2 && siteCPs(null).length === 0);
  const all = [['biomes.js', bioSrc], ['terrain.js', terrSrc], ['sim.js', simSrc]];
  for (const [name, src] of all) {
    t(`${name} 不直接展開 [site.SWARM, site.STEEL](劇情戰役有一側是 undefined)`,
      !/\[\s*(site|st)\.SWARM\s*,\s*\1?\.?STEEL/.test(strip(src))
      && !/for \(const side of \['SWARM', 'STEEL'\]\) \{\s*\n\s*const p = st\[side\];/.test(strip(src)));
  }
  t('sim 生成塔位走 siteCPs', /for \(const p of siteCPs\(st\)\)/.test(grabMethod(simSrc, '_spawnStructures')));
  t('三個建圖消費端與伺服器都把型態傳進 solveTowerSites',
    /solveTowerSites\(lanesW, mapArg\(cfg\)\)/.test(bioSrc) && /solveTowerSites\(lanesW, mapA\)/.test(bioSrc)
    && /solveTowerSites\(lanesW, mapArg\(cfg\)\)/.test(terrSrc)
    && /solveTowerSites\(this\.lanes, this\.mapArg\)/.test(simSrc));
  t('rooms.js 的驗證吃同一個型態入口(mapArg)',
    /const mapA = mapArg\(cfg\);/.test(roomsSrc) && /towerLayoutAudit\(game, mapA\)/.test(roomsSrc)
    && /laneCountFor\(teamSize, mapA\)/.test(roomsSrc));
  t('`cfg.siege` 由 `cfg.defSide` 推導(旗標只有一格,MUST NOT 客戶端再送一份)',
    /cfg\.siege = !!cfg\.defSide;/.test(roomsSrc) && !/cfg\.siege\s*=/.test(strip(mainSrc)));
  t('main.js 出戰把防守方交給 venueConfig(唯一一格旗標)',
    /venueConfig\(v, ch\.teamSize, foe\)/.test(mainSrc));
  t('地形預建鍵帶 defSide(換邊 = 換一個世界)', /cfg\.defSide \|\| null/.test(mainSrc));
  t('sim 收下防守方與型態(一般對戰恆 null / false)',
    /this\.defSide = config\.defSide \|\| null;/.test(simSrc) && /this\.mapArg = mapArg\(config\);/.test(simSrc));
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅳ BOSS 數值:全部推導,名額表是使用者指定的數字');
// ---------------------------------------------------------------------------
{
  t(`HP 倍率 = Σ 段權重(${BOSS.HP_MUL} = ${BOSS.SEG_W.join('+')})—— MUST NOT 手寫`,
    BOSS.HP_MUL === BOSS.SEG_W.reduce((a, b) => a + b, 0),
    `${BOSS.HP_MUL} vs ${BOSS.SEG_W.reduce((a, b) => a + b, 0)}`);
  t('段權重由薄到厚(使用者:先打掉的是 ×1 那一段)',
    BOSS.SEG_W.every((w, i) => i === 0 || w > BOSS.SEG_W[i - 1]));
  t('光暈色數 = 段數(黑 > 青 > 銀 > 金)', BOSS.GLOW.length === bossSegN());
  t('無敵時間表 = [0, 2, 3, 4]s(第2/3/4階段有 2/3/4 秒無敵時間)',
    JSON.stringify(BOSS.INVULN_S) === JSON.stringify([0, 2, 3, 4])
    && [0, 1, 2, 3].every((k) => bossInvulnS(k) === BOSS.INVULN_S[k]));
  t('體型縮放表 = [1.0, 1.2, 1.5, 2.0](大小增加 0%/20%/50%/100%)',
    JSON.stringify(BOSS.SCALE_F) === JSON.stringify([1.0, 1.2, 1.5, 2.0])
    && [0, 1, 2, 3].every((k) => bossScaleF(k) === BOSS.SCALE_F[k]));
  t('第 4 階段狂暴模式常數齊備(NPC減傷25%/移速減半/攻速+25%/換彈+25%/技能CD+25%/傷害+25%)',
    BOSS.ENRAGE_NPC_DMG_F === 0.25 && BOSS.ENRAGE_SPD_F === 0.5
    && BOSS.ENRAGE_RATE_F === 1.25 && BOSS.ENRAGE_RELOAD_F === 1.25
    && BOSS.ENRAGE_CD_F === 1.25 && BOSS.ENRAGE_DMG_F === 1.25);
  t('天花板 capF:0 段 = 1、末段 = 0、且嚴格遞減',
    bossSegCapF(0) === 1 && near(bossSegCapF(bossSegN()), 0)
    && Array.from({ length: bossSegN() }, (_, k) => bossSegCapF(k) > bossSegCapF(k + 1)).every(Boolean));
  t('段位判定與天花板互為逆:恰在天花板上 = 已破那一段',
    Array.from({ length: bossSegN() }, (_, k) => bossSegOf(bossSegCapF(k)) === Math.max(0, k)).every(Boolean)
    && bossSegOf(1) === 0 && bossSegOf(0) === bossSegN() - 1);
  t(`活動半徑 = 半個塔射程(${bossZoneR()}m,推導不手寫)`, bossZoneR() === UNITS.tower.range * BOSS.ZONE_F);
  t('席次分配 3 名 = 前中後 1:1:1、5 名 = 1:2:2(使用者指定)',
    JSON.stringify(bossSlotPlan(3)) === JSON.stringify([0, 1, 2])
    && JSON.stringify(bossSlotPlan(5)) === JSON.stringify([0, 1, 1, 2, 2]));
  t('名額表以外的人數走平均分配保底(總數 MUST 對得上)',
    [1, 2, 4, 6].every((k) => bossSlotPlan(k).length === k && bossSlotPlan(k).every((s) => s >= 0 && s < SIEGE.STAGES.length)));
  t('同據點多名 BOSS 左右輪替錯開,第一名不偏移',
    bossSlotOff(0) === 0 && bossSlotOff(1) === GAME.TOWER_SIDE_OFF * BOSS.SLOT_OFF_F
    && bossSlotOff(2) === -GAME.TOWER_SIDE_OFF * BOSS.SLOT_OFF_F);
  t('恢復倍率:技能減半、其他一律 0(使用者定案)',
    bossHealF('skill') === BOSS.HEAL_SKILL_F && bossHealF('base') === 0 && bossHealF('item') === 0);
  t('光暈取色夾在色表內(段位越界不會拿到 undefined)',
    bossGlow(0) === BOSS.GLOW[0] && bossGlow(99) === BOSS.GLOW.at(-1) && bossGlow(-1) === BOSS.GLOW[0]);
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅴ 行為直測(跑真品 BattleSim:塔、BOSS、鎖血、狂暴、恢復、不重生)');
// ---------------------------------------------------------------------------
{
  const v = VENUES.find((x) => !venueConfig(x, 1).synthetic) || VENUES[0];
  const DEF = 'SWARM', ATK = OTHER_SIDE[DEF], TEAM = 3;
  const cfg = venueConfig(v, TEAM, DEF);
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };
  cfg.siege = true; cfg.teamSize = TEAM;
  if (BRK.full) { cfg.defSide = null; cfg.mini = false; }
  const sim = new BattleSim(cfg);
  const towers = [...sim.ents.values()].filter((e) => e.kind === 'tower');
  t(`防守方 ${STORY_MAP.DEF_STAGES} 個塔位 × 左右 2 座 = ${STORY_MAP.DEF_STAGES * 2} 座`,
    towers.filter((e) => e.side === DEF).length === STORY_MAP.DEF_STAGES * 2,
    `${towers.filter((e) => e.side === DEF).length}`);
  t('攻方零座塔(我方前線就是主堡)', towers.filter((e) => e.side === ATK).length === 0);
  t('主堡兩座照舊', [...sim.ents.values()].filter((e) => e.kind === 'base').length === 2);

  // BOSS 進場:席次 = 到場序
  sim.addHero(ATK, 1, 't06');
  const pids = ['b1', 'b2', 'b3'];
  pids.forEach((p, i) => sim.addHero(DEF, p, ['s03', 's04', 'm05'][i]));
  const plan = bossSlotPlan(TEAM);
  t('BOSS 據點依到場序落在前 / 中 / 後',
    pids.every((p, i) => sim.squads.get(p).bossStage === plan[i]),
    pids.map((p) => sim.squads.get(p).bossStage).join(','));
  t('活動範圍以據點為圓心、半徑 = 半個塔射程(bots 的唯一消費端)',
    pids.every((p) => near(sim.bossHold.get(p).r, bossZoneR())));
  t('前線據點的 BOSS 就位在前線塔位上(±同一據點的錯開量)', (() => {
    const front = sim.towerSites[0].at(-1)[DEF];
    const z = sim.bossHold.get(pids[0]);
    return front && Math.hypot(z.x - front.x, z.z - front.z) <= GAME.TOWER_SIDE_OFF + 1e-6;
  })());
  t('後段據點的 BOSS 就位在主堡上', (() => {
    const [bx, bz] = sim.basePos[DEF];
    const z = sim.bossHold.get(pids[2]);
    return Math.hypot(z.x - bx, z.z - bz) <= GAME.TOWER_SIDE_OFF + 1e-6;
  })());
  const bodyHp = (ch, kind, mul) => Math.round(UNITS[kind].hp * (CHARACTERS[ch].mods?.hp ?? 1) * mul);
  t(`BOSS 的 HP = 一般值 × ${BOSS.HP_MUL}(逐機體 ⇒ 小隊總量也剛好 ×${BOSS.HP_MUL})`,
    pids.every((p) => {
      const sq = sim.squads.get(p);
      // 逐機體 ×HP_MUL(取整只做一次;先取整再乘會與實作差幾點 —— 那不是規則,是四捨五入)
      return sq.bodies.every((b) => b.maxHp === bodyHp(sq.ch, sq.kind, BOSS.HP_MUL))
        && near(sq.bodies.reduce((a, b) => a + b.maxHp, 0)
          / (bodyHp(sq.ch, sq.kind, 1) * sq.bodies.length), BOSS.HP_MUL, 0.02);
    }),
    pids.map((p) => `${sim.squads.get(p).ch}:${sim.heroes.get(p).maxHp}`).join(' '));
  t('攻方英雄一格未動(沒有 BOSS 旗標、沒有活動範圍)',
    !sim.squads.get(1).boss && !sim.bossHold.has(1) && sim.heroes.get(1).sg == null);

  // 逐階存活數:BOSS 進場後 MUST 自己補記一筆
  t('BOSS 被點進逐階存活數(否則前線 BOSS 還活著中段就解鎖了)',
    sim._siegeLeft[DEF][0] === STORY_MAP.DEF_STAGES + 1
    && sim._siegeLeft[DEF][SIEGE.BASE] === 2, JSON.stringify(sim._siegeLeft[DEF]));
  t('鎖血:前線 BOSS 打得到、中段 / 後段 BOSS 完全免傷(同砲塔)',
    !sim.siegeLocked(sim.heroes.get(pids[0]))
    && sim.siegeLocked(sim.heroes.get(pids[1])) && sim.siegeLocked(sim.heroes.get(pids[2])));

  // 分段 → 狂暴化(2026-08-14 起**八軌全升** + 進段補滿護盾;陣營小兵強化仍恆 Lv0)
  const p0 = pids[0], sq0 = sim.squads.get(p0), h0 = sim.heroes.get(p0);
  if (BRK.enrage) sim._bossEnrage = () => {};
  // 壞版:進段不補護盾(升完把護盾按原值放回去)
  if (BRK.sp) {
    const real = sim._bossSync.bind(sim);
    sim._bossSync = (sq) => { const sp = sq.bodies.map((b) => b.sp); real(sq); sq.bodies.forEach((b, i) => { b.sp = sp[i]; }); };
  }
  // 壞版:裝甲上限升級「上限與當下血量同時 +Δ」(= `_applyUpg` 原樣,補滿新增的那一截)
  if (BRK.hpscale) {
    const real = sim._bossEnrage.bind(sim);
    sim._bossEnrage = (sq) => {
      const b0 = sq.bodies.map((b) => ({ hp: b.hp, max: b.maxHp }));
      real(sq);
      sq.bodies.forEach((b, i) => { b.hp = b0[i].hp + (b.maxHp - b0[i].max); });
    };
  }
  const COMBAT = Object.entries(ECON.UPGRADES).filter(([, u]) => u.abil).map(([k]) => k);
  const DEFENCE = Object.keys(ECON.UPGRADES).filter((k) => !COMBAT.includes(k));
  let enrageOk = true, defOk = true, spOk = true, ratioOk = true, invulnOk = true, scaleOk = true;
  for (let k = 1; k < bossSegN(); k++) {
    const want = bossSegCapF(k) - 1e-4;                       // 進段當下的 HP 比例
    for (const b of sq0.bodies) { b.hp = b.maxHp * want; b.sp = 0; }
    const tBefore = sim.t;
    sim._bossSync(sq0);
    if (sq0.bossSeg !== k) enrageOk = false;
    if (!COMBAT.every((it) => (h0.upg[it] || 0) === Math.min(ECON.UPGRADES[it].max, k))) enrageOk = false;
    if (!DEFENCE.every((it) => (h0.upg[it] || 0) === Math.min(ECON.UPGRADES[it].max, k))) defOk = false;
    if (!sq0.bodies.every((b) => b.sp === b.maxSp)) spOk = false;
    // 進入第 2/3/4 階段:獲得 2/3/4 秒無敵時間
    if (!sq0.bodies.every((b) => (b.invUntil || 0) >= tBefore + BOSS.INVULN_S[k] - 1e-6)) invulnOk = false;
    // 體型大小增加 20%/50%/100%:命中量體 hitH/hitR 等比放大
    if (!sq0.bodies.every((b) => near(hitH(b), heroTargetH(b.kind, b.ch) * BOSS.SCALE_F[k])
      && near(hitR(b), heroTargetH(b.kind, b.ch) * HERO_HIT_R[b.kind] * BOSS.SCALE_F[k]))) scaleOk = false;
    // 裝甲上限升級 MUST 等比放大當下 HP ⇒ 段位比例逐位元(容 round)不變
    if (!sq0.bodies.every((b) => near(b.hp / b.maxHp, want, 2e-3))) ratioOk = false;
  }
  t(`每擊破一段,攻擊四軌(${COMBAT.join('/')})各升一級 ⇒ ${bossSegN() - 1} 次剛好升滿`, enrageOk,
    `seg=${sq0.bossSeg} upg=${JSON.stringify(h0.upg)}`);
  t('招式階級跟著推進(走 `_applyUpg` 同一支,與玩家購買共用)',
    COMBAT.every((it) => h0.abil[ECON.UPGRADES[it].abil] === 1 + (h0.upg[it] || 0)));
  t(`防禦四軌(${DEFENCE.join('/')})也跟著升(2026-08-14 使用者:防禦面也隨 HP 階段升級)`,
    defOk, JSON.stringify(h0.upg));
  t('陣營小兵強化仍恆 Lv0(入口只有 buy,而 buy 對 BOSS 直接拒絕)',
    sim.creepUpg[DEF].every((l) => l === 0));
  t('進段補滿護盾(MUST 排在狂暴之後 —— sp 軌剛把 maxSp 加大)',
    spOk && sq0.bodies.some((b) => b.maxSp > 0), sq0.bodies.map((b) => `${b.sp}/${b.maxSp}`).join(' '));
  t('進入第 2/3/4 階段分別獲得 2/3/4 秒無敵時間(完全免傷)',
    invulnOk, sq0.bodies.map((b) => `${b.invUntil - sim.t}s`).join(' '));
  t('進入第 2/3/4 階段體型分別增加 20%/50%/100%(hitH/hitR 同步放大)',
    scaleOk, sq0.bodies.map((b) => `${hitH(b).toFixed(2)}m`).join(' '));
  t('裝甲上限升級 MUST 等比放大當下 HP(補滿那一截 = 段位被推回上一階;只放大上限 = 連鎖狂暴到頂)',
    ratioOk, sq0.bodies.map((b) => (b.hp / b.maxHp).toFixed(4)).join(' '));

  // ---- 第 4 階段狂暴模式行為直測 ----
  const brain0 = new BotBrain(sim, p0, DEF, 0);
  brain0.diff = { tactic: true, elite: true };
  brain0.tac = { PULL_HP: 0.3, BASE_HP: 0.2, PULL_SP: 0.5 };
  t('第 4 階段狂暴:不撤退(_pullWant 回傳 null)', brain0._pullWant(h0, 0.1, 0) === null);
  t('第 4 階段狂暴:解除活動範圍拘束(_zoneClamp 放行)',
    JSON.stringify(brain0._zoneClamp(9999, 9999)) === JSON.stringify([9999, 9999]));
  const normalSpd = heroMobility(h0.kind, CHARACTERS[h0.ch]?.mods, false);
  t(`第 4 階段狂暴:移動速度減半(×${BOSS.ENRAGE_SPD_F})`,
    near(brain0._speed(h0), normalSpd * BOSS.ENRAGE_SPD_F, 1e-3),
    `${brain0._speed(h0)} vs ${normalSpd * BOSS.ENRAGE_SPD_F}`);

  const wp0 = heroWeapon(h0.ch, 'light', h0.abil.light || 1, true);
  const baseDmg0 = wp0.dmg * vsMult(wp0, 'creep');
  t(`第 4 階段狂暴:傷害 +25%(×${BOSS.ENRAGE_DMG_F})`,
    near(sim._heroDmg(h0, wp0, 'creep'), baseDmg0 * BOSS.ENRAGE_DMG_F, 1e-6),
    `${sim._heroDmg(h0, wp0, 'creep')} vs ${baseDmg0 * BOSS.ENRAGE_DMG_F}`);
  t(`第 4 階段狂暴:換彈時間 +25%(×${BOSS.ENRAGE_RELOAD_F})`,
    near(sim._reloadT(h0, wp0), wp0.reload * BOSS.ENRAGE_RELOAD_F, 1e-6),
    `${sim._reloadT(h0, wp0)} vs ${wp0.reload * BOSS.ENRAGE_RELOAD_F}`);

  h0.mp = 999; h0.acd = {};
  const abl0 = heroAbility(h0.ch, 'skill', h0.abil.skill || 1);
  sim.heroCast(p0, 'skill', h0.x, h0.z);
  t(`第 4 階段狂暴:技能 CD 時間 +25%(×${BOSS.ENRAGE_CD_F})`,
    near(h0.acd.skill - sim.t, abl0.cd * BOSS.ENRAGE_CD_F, 1e-6),
    `${(h0.acd.skill - sim.t).toFixed(2)}s vs ${(abl0.cd * BOSS.ENRAGE_CD_F).toFixed(2)}s`);

  // 清除無敵時間後測試受擊減傷
  for (const b of sq0.bodies) b.invUntil = 0;
  const allyHero = sim.heroes.get(1);
  h0.sp = 0; h0.hp = h0.maxHp;
  const hpPreNpc = h0.hp;
  const creepDummy = { kind: 'soldier', cu: 1 };
  sim._damage(h0, 100, creepDummy, 999);
  const creepDmgTaken = hpPreNpc - h0.hp;
  h0.sp = 0; h0.hp = h0.maxHp;
  const hpPreHero = h0.hp;
  sim._damage(h0, 100, allyHero, 999);
  const heroDmgTaken = hpPreHero - h0.hp;
  t(`第 4 階段狂暴:受到兵波NPC/砲塔/主堡的傷害減少至 25%(減傷 75%)`,
    near(creepDmgTaken, 100 * BOSS.ENRAGE_NPC_DMG_F, 1e-3),
    `NPC傷害 ${creepDmgTaken} vs 期望 ${100 * BOSS.ENRAGE_NPC_DMG_F}`);
  t('第 4 階段狂暴:受到真人玩家傷害不折減(100% 全額)',
    near(heroDmgTaken, 100, 1e-3), `玩家傷害 ${heroDmgTaken} vs 100`);
  t('BOSS 買不到任何東西(權威閘門在 sim.buy)',
    typeof sim.buy(p0, 'hp') === 'string' && typeof sim.buy(p0, 'lw') === 'string'
    && typeof sim.buy(p0, 'creep', 0) === 'string' && sim.buy(1, 'hp') === null);

  // 恢復:技能減半 / 其他無效 / 不得越過當前段天花板
  if (BRK.cap) sim._healBody = (b, a) => { const v0 = b.hp; b.hp = Math.min(b.maxHp, b.hp + a); return b.hp - v0; };
  const body = sq0.bodies[0];
  body.hp = body.maxHp * 0.05;
  sim._healBody(body, body.maxHp, 'skill');
  t('技能恢復 MUST 夾在當前段的天花板之下(使用者:補血也不可以回到上一階)',
    near(body.hp / body.maxHp, bossSegCapF(sq0.bossSeg), 1e-6),
    `${(body.hp / body.maxHp).toFixed(3)} vs ${bossSegCapF(sq0.bossSeg)}`);
  body.hp = body.maxHp * 0.05;
  const halfIn = body.maxHp * 0.02;
  const got = sim._healBody(body, halfIn, 'skill');
  t('技能恢復減半', near(got, halfIn * BOSS.HEAL_SKILL_F, 1e-6), `${got.toFixed(2)} vs ${(halfIn / 2).toFixed(2)}`);
  body.hp = body.maxHp * 0.05;
  t('其他來源的恢復無效(主堡修裝甲 / 醫療包)',
    sim._healBody(body, body.maxHp, 'base') === 0 && sim._healBody(body, body.maxHp, 'item') === 0);
  const ally = sim.heroes.get(1);
  ally.hp = 1;
  t('一般英雄的恢復逐位元同舊制(補到滿、不減半、無段天花板)',
    sim._healBody(ally, ally.maxHp, 'base') > 0 && ally.hp === ally.maxHp);

  // ---- 區域 BOSS 關卡:BOSS 沒解決 ⇒ 建築打得掉血但死不了(2026-08-14 使用者)----
  const fTower = towers.find((e) => e.side === DEF && e.sg === 0);
  const fHp0 = fTower.hp;
  sim._damage(fTower, 1e9, null, 999);
  t('區域 BOSS 還活著:前線砲塔**打得掉血但夾在 HP1**(不是免傷 —— 那是 siegeLocked 的語意)',
    fTower.hp === SIEGE.BLD_HP_FLOOR && fHp0 > SIEGE.BLD_HP_FLOOR && !sim.siegeLocked(fTower),
    `${fTower.hp}/${fHp0}`);
  t('鎖 HP 的建築照樣列入索敵(只有 siegeLocked 那一道才排除;兩道閘語意不同,MUST NOT 合併)',
    sim._tgBlockedD({ x: fTower.x, z: fTower.z, side: ATK }, { range: 1e6 }, null, fTower, 0) !== true);
  t('BOSS 自己不吃 HP 地板(判據是 `!t.hero`)', sim.siegeHpFloor(sim.heroes.get(p0)) === 0);

  // 不重生 + 整隊全滅推進階段
  const leftBefore = sim._siegeLeft[DEF][0];
  const tKill = sim.t;
  for (const b of sq0.bodies) { b.hp = 0; sim._kill(b, ally); }
  const talkEv = sim.events.filter((e) => e.e === 'siegeTalk');
  const talkUntil = sim._talkUntil[DEF][0];
  if (BRK.respawn) for (const b of sq0.bodies) b.respawnAt = sim.t;
  t('BOSS 陣亡後不重生(重生倒數推到永遠到不了的時刻)',
    sq0.bodies.every((b) => b.respawnAt === Infinity));
  sim.tick(0.125); sim.tick(0.125);
  t('推進兩個 tick 之後仍然是死的', sq0.bodies.every((b) => b.dead));
  t('整隊全滅 ⇒ 它守的那一階跟著推進', sim._siegeLeft[DEF][0] === leftBefore - 1,
    `${sim._siegeLeft[DEF][0]} vs ${leftBefore - 1}`);
  t('復活招式對 BOSS 無效(復活也是重生)', (() => {
    sim._reviveBody(sq0.bodies[0], 0.5);
    return sq0.bodies[0].dead;
  })());

  // ---- 區域 BOSS 倒下 → 對白窗 → 建築解鎖 ----
  t('這一階最後一名 BOSS 倒下 ⇒ 發一次 `siegeTalk`(對白的觸發點,不再是「整階被推平」)',
    talkEv.length === 1 && talkEv[0].stage === 0 && talkEv[0].side === DEF, JSON.stringify(talkEv));
  t(`對白窗 = 擊敗當下 + siegeTalkS(前線 ${siegeTalkS(0)}s、主堡 ${siegeTalkS(SIEGE.BASE)}s)`,
    near(talkUntil, tKill + siegeTalkS(0), 1e-9) && siegeTalkS(SIEGE.BASE) === 0,
    `${talkUntil} vs ${tKill + siegeTalkS(0)}`);
  t('對白播完之前:建築仍夾在 HP1(BOSS 死了不等於馬上拆得掉)',
    sim.siegeHpFloor(fTower) === SIEGE.BLD_HP_FLOOR && (sim._damage(fTower, 1e9, null, 999), fTower.hp === SIEGE.BLD_HP_FLOOR));
  sim.t = talkUntil + 1e-6;
  t('對白結束 ⇒ 地板撤掉,同一發就打掉了',
    sim.siegeHpFloor(fTower) === 0 && (sim._damage(fTower, 1e9, null, 999), fTower.hp === 0));

  // ---- 一般對戰逐位元不變 ----
  const cfgF = venueConfig(v, TEAM);
  cfgF.env = cfg.env; cfgF.teamSize = TEAM;
  const simF = new BattleSim(cfgF);
  simF.addHero('SWARM', 1, 's03');
  simF.addHero('STEEL', 'b1', 't06');
  t('一般對戰:沒有 BOSS、沒有活動範圍、英雄不帶攻堅階段、HP 沒有倍率',
    simF.defSide === null && simF.mapArg === false && simF.bossHold.size === 0
    && !simF.squads.get('b1').boss && simF.heroes.get('b1').sg == null
    && simF.heroes.get('b1').maxHp === bodyHp(simF.squads.get('b1').ch, simF.squads.get('b1').kind, 1));
  t('一般對戰:兩側塔數相同(非對稱只發生在劇情戰役)', (() => {
    const tf = [...simF.ents.values()].filter((e) => e.kind === 'tower');
    return tf.filter((e) => e.side === 'SWARM').length === tf.filter((e) => e.side === 'STEEL').length
      && tf.length === FULL_STAGES * 2 * 2 * simF.lanes.length;
  })());
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅵ 電腦玩家:活動範圍夾在位置寫入的唯一縫上(bots.js 原文閘)');
// ---------------------------------------------------------------------------
{
  const mv = grabMethod(botSrc, '_move');
  t('`_move` 先夾活動範圍再交給 solidResolve(先解碰撞再硬拉回圓內 = 把機體推進牆裡)',
    /\[nx, nz\] = this\._zoneClamp\(nx, nz\);/.test(mv)
    && mv.indexOf('_zoneClamp') < mv.indexOf('solidResolve'));
  const zc = grabMethod(botSrc, '_zoneClamp');
  t('圓心/半徑讀 sim.bossHold(伺服器定案),bots MUST NOT 自己算',
    /this\.sim\.bossHold\?\.get\(this\.pid\)/.test(zc) && !/bossZoneR|ZONE_F/.test(strip(botSrc)));
  t('非 BOSS 恆原值回傳(一般對戰逐位元同舊制)', /if \(!z\) return \[nx, nz\];/.test(zc));
  t('撤退 / 集結 / 站崗一律回自己的據點(`_home`),MUST NOT 直接寫 basePos',
    /_moveToward\(h, u, this\._home\(\), dt\)/.test(grabMethod(botSrc, 'update'))
    && /this\._rallyAt \|\| this\._home\(\)/.test(grabMethod(botSrc, '_rally'))
    && /this\._rallyAt = this\._home\(\); return;/.test(grabMethod(botSrc, '_pickRally')));
  t('BOSS 不推線(照舊累加 prog 會被夾在圓緣上,`_stuck` 於是整場誤判撞牆;狂暴前守據點)',
    /sim\.bossHold\?\.has\(this\.pid\)( && !\([^)]+\))?\) this\._hold\(h, u, dt\)/.test(grabMethod(botSrc, 'update')));
  t('採購前置篩選帶 `sim.isBoss`(權威閘門仍在 sim.buy)',
    /!sim\.isBoss\(h\) &&/.test(grabMethod(botSrc, 'update')));
  t('`isBoss` 的判據是「這一場有防守方、而且它就是那一邊」(MUST NOT 判 bot id)',
    /return !!\(this\.defSide && h && h\.side === this\.defSide\);/.test(grabMethod(simSrc, 'isBoss')));
  t('恢復三條規則(倍率 / 段天花板 / 上限)寫在同一個結算點 `_healBody`(分開寫必漏其一)', (() => {
    const hb = grabMethod(simSrc, '_healBody');
    return /bossHealF\(src\)/.test(hb) && /bossSegCapF\(b\.sq\.bossSeg\)/.test(hb) && /Math\.min\(cap,/.test(hb);
  })());
  t('五條英雄裝甲恢復路徑全走 `_healBody`(治療招式 / 吸血 / 汲能核心 / 主堡修裝甲 / 醫療包)', (() => {
    const body = (n) => grabMethod(simSrc, n);
    return /this\._healBody\(b, healAmt \* frac, 'skill'\)/.test(body('_castEffect'))
      && /this\._healBody\(by, dealt \* f, 'skill'\)/.test(body('_vamp'))
      && /this\._healBody\(by, by\.maxHp \* AFFIXES\[id\]\.killHeal, 'skill'\)/.test(body('_kill'))
      && /this\._healBody\(b, UNITS\[b\.kind\]\.regen \* rg \* dt, rg > 1 \? 'skill' : 'base'\)/.test(simSrc)
      && /this\._healBody\(body, hp, 'item'\)/.test(body('_grantReward'));
  })());
  t('段位同步掛在 HP 的減損點上(_damage / _fireBurn),MUST NOT 逐處展開',
    /if \(t\.sq\?\.boss\) this\._bossSync\(t\.sq\);/.test(grabMethod(simSrc, '_damage'))
    && /if \(h\.sq\?\.boss\) this\._bossSync\(h\.sq\);/.test(grabMethod(simSrc, '_fireBurn')));
  t('客戶端只拿段位畫光暈(段位 / 狂暴 / 恢復全在伺服器)', (() => {
    const gameSrc = readSrc('public', 'js', 'game.js');
    return /ent\.bossSeg = e\.bs;/.test(gameSrc) && /bossGlow\(ent\.bossSeg\)/.test(gameSrc)
      && !/HP_MUL|bossSegOf|bossHealF/.test(strip(gameSrc));
  })());
}

// ---------------------------------------------------------------------------
console.log('\n■ Ⅶ 開場預置兵線 + 我方電腦玩家的傷害折減(2026-08-14 使用者)');
// ---------------------------------------------------------------------------
{
  const v = VENUES.find((x) => !venueConfig(x, 1).synthetic) || VENUES[0];
  const DEF = 'SWARM', ATK = OTHER_SIDE[DEF], TEAM = 3;
  const cfg = venueConfig(v, TEAM, DEF);
  cfg.env = { season: 'summer', time: 'day', weather: 'clear' };
  cfg.siege = true; cfg.teamSize = TEAM;
  const sim = new BattleSim(cfg);

  // ---- 開場預置:守方補到自己那座前線砲塔 ----
  const pre = (side) => [...sim.ents.values()].filter((e) => e.side === side && e.wv < 0);
  const lead = (side) => Math.max(0, ...pre(side).map((e) => e.prog));
  const cum = sim._laneCum(0), total = cum[cum.length - 1];
  const frontM = total * sim.towerSites[0].at(-1).frac;
  const gap = waveSpacingM();
  t('守方(BOSS 方)開場預置 MUST 補到自己那座前線砲塔(缺口 < 一個波次間距)',
    lead(DEF) <= frontM + 1e-6 && lead(DEF) + gap > frontM,
    `最遠 ${lead(DEF).toFixed(0)}m / 前線塔 ${frontM.toFixed(0)}m / 間距 ${gap.toFixed(0)}m`);
  t('攻方仍吃「兩側取較小者」⇒ 守方的隊伍比攻方深(非對稱地圖的刻意破例)',
    lead(DEF) > lead(ATK) && pre(DEF).length > pre(ATK).length,
    `${lead(DEF).toFixed(0)}m ${pre(DEF).length} 隻 vs ${lead(ATK).toFixed(0)}m ${pre(ATK).length} 隻`);

  // ---- 我方電腦玩家的傷害折減 ----
  sim.addHero(ATK, 1, 't06');       // 真人玩家(關卡是他的)
  sim.addHero(ATK, 'b9', 't05');    // 我方電腦玩家
  sim.addHero(DEF, 'b1', 's03');    // BOSS(到場序 0 ⇒ 前線據點)
  const you = sim.heroes.get(1), botAlly = sim.heroes.get('b9'), boss = sim.heroes.get('b1');
  // 前線那一階(sg 0)—— 中段塔還被 siegeLocked 完全免傷,量不到倍率
  const tw = [...sim.ents.values()].find((e) => e.kind === 'tower' && e.side === DEF && e.sg === 0);
  t('「我方電腦玩家」的判據是 bot id(真人不吃折減)', isBotId('b9') && !isBotId(1));
  if (BRK.allybot) sim._allyBotDmgF = () => 1;
  const hitBoss = (by) => {
    for (const b of boss.sq.bodies) { b.sp = 0; b.hp = b.maxHp; }
    const h0 = boss.hp; sim._damage(boss, 500, by, 0); return h0 - boss.hp;
  };
  const hitBld = (by) => { tw.hp = tw.maxHp; const h0 = tw.hp; sim._damage(tw, 500, by, 0); return h0 - tw.hp; };
  t(`我方電腦玩家對 BOSS 的傷害 = 真人的 ${allyBotDmgF('boss') * 100}%`,
    near(hitBoss(botAlly) / hitBoss(you), allyBotDmgF('boss'), 1e-6),
    `${hitBoss(botAlly).toFixed(2)} vs ${hitBoss(you).toFixed(2)}`);
  t(`我方電腦玩家對建築的傷害 = 真人的 ${allyBotDmgF('building') * 100}%`,
    near(hitBld(botAlly) / hitBld(you), allyBotDmgF('building'), 1e-6),
    `${hitBld(botAlly).toFixed(2)} vs ${hitBld(you).toFixed(2)}`);
  t('折減只落在「攻方 bot 英雄 → 守方 BOSS / 建築」這一格(真人 / 守方輸出 / 小兵一律 ×1)',
    sim._allyBotDmgF(boss, you) === 1
    && sim._allyBotDmgF(boss, botAlly) === allyBotDmgF('boss')
    && sim._allyBotDmgF(tw, botAlly) === allyBotDmgF('building')
    && sim._allyBotDmgF(you, boss) === 1
    && sim._allyBotDmgF(pre(DEF)[0], botAlly) === 1);
  t('一般對戰恆 ×1(沒有 defSide ⇒ 這一支的第一道閘就回 1)', (() => {
    const cfgF = venueConfig(v, TEAM);
    cfgF.env = cfg.env; cfgF.teamSize = TEAM;
    const sf = new BattleSim(cfgF);
    sf.addHero('SWARM', 'b1', 't06');
    const twF = [...sf.ents.values()].find((e) => e.kind === 'tower' && e.side === 'STEEL');
    return sf._allyBotDmgF(twF, sf.heroes.get('b1')) === 1;
  })());
}

console.log(`\n${fail ? '❌' : '🎉'} 劇情戰役地圖 / NPC BOSS 稽核:${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
