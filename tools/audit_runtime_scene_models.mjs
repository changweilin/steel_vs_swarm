// 通過零件台的正式建模接線稽核。
// 反向驗證：--break-building 破壞建築名冊；--break-wiring 破壞場景接線。
import { readSrc } from './audit_src.mjs';
import {
  BUILDING_PARTS,
  RUNTIME_PARTS_META,
  VEHICLE_PARTS,
} from '../public/js/runtimeParts.js';

const BREAK_BUILDING = process.argv.includes('--break-building');
const BREAK_WIRING = process.argv.includes('--break-wiring');
const buildings = BREAK_BUILDING ? BUILDING_PARTS.slice(1) : BUILDING_PARTS;
let biomes = readSrc('public', 'js', 'biomes.js');
if (BREAK_WIRING) biomes = biomes.replace('makeApprovedBuildingBatch(entry, rows)', 'makeLegacyBuildingBatch(entry, rows)');
const models = readSrc('public', 'js', 'models.js');
const runtimeRenderer = readSrc('public', 'js', 'runtimePartModel.js');
const npcModels = readSrc('public', 'js', 'npcModels.js');
const buildingUnits = readSrc('public', 'js', 'buildingUnitModels.js');
const partlib = readSrc('public', 'js', 'partlib.js');

let pass = 0;
let fail = 0;
const ok = (condition, message) => {
  if (condition) {
    pass++;
    console.log(`  ✅ ${message}`);
  } else {
    fail++;
    console.log(`  ❌ ${message}`);
  }
};

console.log('\nⅠ 正式 v5/v6 目錄');
ok(buildings.length === 39, `建築正式名冊 39 款（實得 ${buildings.length}）`);
ok(VEHICLE_PARTS.length === 14, `載具正式名冊 14 款（實得 ${VEHICLE_PARTS.length}）`);
ok(buildings.filter((row) => row.version === 5).length === 23
  && buildings.filter((row) => row.version === 6).length === 16, '建築 v5=23、v6=16 同時正式採用');
ok(buildings.every((row) => [5, 6].includes(row.version)
  && row.provenance?.review?.status === 'ok'), '建築只收 v5/v6 且每列通過零件台');
ok(new Set(buildings.map((row) => row.key)).size === buildings.length, '建築 key 唯一');
ok(new Set(buildings.map((row) => row.canonicalTarget)).size === buildings.length,
  '重複目標已消解（同目標由 v6 勝出）');
ok(RUNTIME_PARTS_META.policy.duplicatePreference === 'v6'
  && RUNTIME_PARTS_META.policy.legacyV1Families.join('|') === 'rock|tree:conifer',
  '目錄政策固定為 v6 優先、v1 僅岩石／針葉');

console.log('\nⅡ 通用幾何與場景接線');
const usedTypes = new Set([...buildings, ...VEHICLE_PARTS].flatMap((row) => row.parts.map((part) => part.type)));
ok([...usedTypes].every((type) => runtimeRenderer.includes(`'${type}'`)),
  `通用 renderer 涵蓋全部 ${usedTypes.size} 種正式 primitive`);
ok(/fitApprovedBuilding\(b\)/.test(biomes)
  && /makeApprovedBuildingBatch\(entry, rows\)/.test(biomes), '一般建物經正式選款與每款批次進場');
ok(/approvedVehicleModelAt\(/.test(biomes) && /makeRuntimePartModel\(model/.test(biomes),
  '場景載具經正式 v6 型錄與通用 renderer 進場');
ok(!/buildBldBucket\.mass\s*\(/.test(biomes) && !/makeVehicle\s*\(/.test(biomes),
  '舊整棟建模與舊場景載具建模已無執行期呼叫點');
ok(/const PART_LIBS = \['rock', 'tree'\];/.test(partlib), '舊 building GLB 家族不再載入');
ok(!runtimeRenderer.includes('Math.random(') && !biomes.match(/approvedVehicleModelAt\([^)]*Math\.random/),
  '正式模型選款不消耗非決定性亂數');

console.log('\nⅢ NPC／戰鬥建築；玩家機甲隔離');
const npcKinds = ['soldier', 'apc', 'tank', 'rocketeer', 'howitzer', 'heli'];
ok(npcKinds.every((kind) => models.includes(`buildNpcModel('creep:${kind}'`))
  && models.includes("buildNpcModel('bunker'") && models.includes("buildNpcModel('civ'"),
  '六類小兵、碉堡與平民全部轉接新版 NPC 家族');
ok(/buildBuildingUnit\('tower'/.test(models)
  && /buildBuildingUnit\('base:SWARM'/.test(models)
  && /buildBuildingUnit\('base:STEEL'/.test(models)
  && /buildBuildingUnitTurret\(side\)/.test(models), '防禦塔、雙主堡與旋轉砲塔全部轉接新版建築單位');
ok(npcModels.includes("'rig.kind=biped'") && npcModels.includes("'rig.kind=wheeled'")
  && npcModels.includes("'rig.kind=tracked'") && npcModels.includes("'rig.kind=aerial'"),
  'NPC 模型宣告四類既有動畫／槍口契約');
ok(buildingUnits.includes('yaw.userData.pitch = pitch')
  && buildingUnits.includes('yaw.userData.muzzles = muzzles'), '新版砲塔保留俯仰與多槍口 API');
const heroBranch = models.slice(models.indexOf('if (forged) {'), models.indexOf('} else if (entry) {'));
ok(/forgeHero\(heroKind, ch, side\)/.test(models)
  && /const built = forged\.group;/.test(heroBranch)
  && !heroBranch.includes('buildNpcModel'), '玩家操控機甲仍只走 forge，未被 NPC 重建接管');

console.log(`\n${fail ? '❌' : '✅'} 正式場景建模：${pass} 通過，${fail} 失敗`);
if (fail) process.exit(1);
