// 通過零件台的正式建模接線稽核。
// 反向驗證：--break-building／--break-wiring／--break-native／--break-faction／--break-national-models。
import { readSrc } from './audit_src.mjs';
import {
  BUILDING_PARTS,
  RUNTIME_PARTS_META,
  VEHICLE_PARTS,
} from '../public/js/runtimeParts.js';
import {
  NATIVE_FUNCTIONAL_BUILDINGS,
  NATIVE_FUNCTIONAL_KINDS,
  NATIVE_FUNCTIONAL_SUBPARTS,
  nativeFunctionalKind,
} from '../public/js/nativeFunctionalBuildings.js';

const BREAK_BUILDING = process.argv.includes('--break-building');
const BREAK_WIRING = process.argv.includes('--break-wiring');
const BREAK_NATIVE = process.argv.includes('--break-native');
const BREAK_FACTION = process.argv.includes('--break-faction');
const BREAK_NATIONAL_MODELS = process.argv.includes('--break-national-models');
const buildings = BREAK_BUILDING ? BUILDING_PARTS.slice(1) : BUILDING_PARTS;
let biomes = readSrc('public', 'js', 'biomes.js');
if (BREAK_WIRING) biomes = biomes.replace('makeApprovedBuildingBatch(entry, rows)', 'makeLegacyBuildingBatch(entry, rows)');
if (BREAK_NATIVE) biomes = biomes.replace('const native = nativeFunctionalKind(tags);', 'const native = null;');
let models = readSrc('public', 'js', 'models.js');
if (BREAK_FACTION) models = models.replace('paintFactionUnit(built, side, kind);', 'paintUnit(built, null, side);');
const runtimeRenderer = readSrc('public', 'js', 'runtimePartModel.js');
let npcModels = readSrc('public', 'js', 'npcModels.js');
let buildingUnits = readSrc('public', 'js', 'buildingUnitModels.js');
if (BREAK_NATIONAL_MODELS) {
  npcModels = npcModels.replace("reference: 'BTR-4E'", "reference: 'K-17 Bumerang'");
  buildingUnits = buildingUnits.replace("reference: '烏克蘭 36D6 機動雷達塔'", "reference: '蘇式裝甲海岸砲台'");
}
const partlib = readSrc('public', 'js', 'partlib.js');
const runtimeCatalog = readSrc('tools', 'ai3d', 'runtime_catalog.mjs');
const directIngest = readSrc('tools', 'ai3d', 'direct_ingest_v6.mjs');

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
ok(buildings.length === 29, `建築正式名冊 29 款（實得 ${buildings.length}）`);
ok(VEHICLE_PARTS.length === 14, `載具正式名冊 14 款（實得 ${VEHICLE_PARTS.length}）`);
ok(buildings.filter((row) => row.version === 5).length === 13
  && buildings.filter((row) => row.version === 6).length === 16, '建築 v5=13（母體原型）、v6=16 同時正式採用');
ok(buildings.some((row) => row.version === 5 && Array.isArray(row.palettes) && row.palettes.length > 1),
  'v5 母體建築包含多套配色清單 (palettes)');
ok(buildings.every((row) => row.version !== 5 || row.parts.every((p) => typeof p.colorKey === 'string' && p.colorKey.length > 0)),
  'v5 零件均標註語意著色鍵 colorKey');
ok(buildings.every((row) => [5, 6].includes(row.version)
  && row.provenance?.review?.status === 'ok'), '建築只收 v5/v6 且每列通過零件台');
ok(new Set(buildings.map((row) => row.key)).size === buildings.length, '建築 key 唯一');
ok(new Set(buildings.map((row) => row.canonicalTarget)).size === buildings.length,
  '重複目標已消解（同目標由 v6 勝出）');
ok(RUNTIME_PARTS_META.policy.duplicatePreference === 'v6'
  && RUNTIME_PARTS_META.policy.legacyV1Families.join('|') === 'rock|tree:conifer',
  '目錄政策固定為 v6 優先、v1 僅岩石／針葉');

console.log('\nⅠ-b 原生功能性建築');
const nativeKinds = BREAK_NATIVE ? NATIVE_FUNCTIONAL_KINDS.slice(1) : NATIVE_FUNCTIONAL_KINDS;
ok(nativeKinds.length === 6 && NATIVE_FUNCTIONAL_SUBPARTS.length === 6,
  '廟宇／教堂／醫院／學校／車站／博物館六類共用單一排除名冊');
ok(Object.entries(NATIVE_FUNCTIONAL_BUILDINGS).every(([kind, subpart]) =>
  subpart === `bld_${kind}`), '原生建築類型與照片分類可逆對應');
ok(nativeFunctionalKind({ amenity: 'hospital' }) === 'hospital'
  && nativeFunctionalKind({ amenity: 'school' }) === 'school'
  && nativeFunctionalKind({ railway: 'station' }) === 'station'
  && nativeFunctionalKind({ amenity: 'place_of_worship', religion: 'christian' }) === 'church'
  && nativeFunctionalKind({ amenity: 'place_of_worship', religion: 'buddhist' }) === 'temple'
  && nativeFunctionalKind({ tourism: 'museum' }) === 'museum', 'OSM 標籤回到六類原生生成器');
ok(NATIVE_FUNCTIONAL_KINDS.every((kind) => biomes.includes(`${kind}: (`))
  && biomes.includes('const native = nativeFunctionalKind(tags);'), '六類 LANDMARKS 仍存在且由共同分類縫呼叫');
ok(BUILDING_PARTS.every((row) => !NATIVE_FUNCTIONAL_SUBPARTS.includes(row.subpart)),
  '正式 img-to-3D 建築型錄未混入原生功能性建築');
ok(RUNTIME_PARTS_META.policy.nativeFunctionalBuildings.join('|')
  === NATIVE_FUNCTIONAL_SUBPARTS.join('|'), '產生後的執行期型錄保留同一份原生建築排除政策');
ok(runtimeCatalog.includes('isNativeFunctionalSubpart(database.family, database.subpart)')
  && directIngest.includes('isNativeFunctionalSubpart(family, subpart)'), 'v5/v6 型錄與 v6 匯入都執行原生建築排除政策');

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
ok(models.includes('paintFactionUnit(built, side, kind);')
  && ['SWARM', 'STEEL', 'GUER', 'MILI'].every((side) => npcModels.includes(`side === '${side}'`)),
  '陣營單位套用四套圖樣，NPC 另有四套組成零件語彙');
const vehicleReferences = [
  'BTR-4E', 'T-64BV', 'Mi-24PU2',
  'K-17 Bumerang', 'T-14 Armata', 'Ka-52',
  'Casspir Mk II', 'T-55AM', 'UH-1H',
  'M1126 Stryker', 'M1A2 Abrams', 'AH-64D Apache',
];
ok(vehicleReferences.every((reference) => npcModels.includes(`reference: '${reference}'`))
  && new Set(vehicleReferences).size === 12, '四陣營 APC／坦克／直升機各採不同國家與型號原型');
ok(!npcModels.includes('const VEHICLE = Object.freeze')
  && npcModels.includes("machineModel(side, 'apc')")
  && npcModels.includes("machineModel(side, 'tank')")
  && npcModels.includes("machineModel(side, 'heli')"), '機械單位主輪廓由型號資料列驅動，舊共用底盤已退場');
const buildingReferences = [
  '烏克蘭 36D6 機動雷達塔', '蘇式裝甲海岸砲台',
  '烏克蘭加固機庫群與無人機管制塔', '蘇式潛艇堡與洲際飛彈井',
];
ok(buildingReferences.every((reference) => buildingUnits.includes(`reference: '${reference}'`))
  && new Set(buildingReferences).size === 4, '雙陣營塔／主堡採四種獨立國家與工事原型');
const professions = [
  '醫師', '工程師', '商人', '廚師', '電工', '教師', '農夫', '記者', '郵差', '建築工',
  '護理師', '藥師', '銀行員', '程式設計師', '會計師', '律師', '獸醫', '技師', '攤販', '心理師',
];
ok(professions.every((name) => npcModels.includes(`'${name}': Object.freeze({`))
  && npcModels.includes('addProfessionKit(hips, row, cloth)'), '20 種平民職業各有頭飾／制服／手持件規格');
const heroBranch = models.slice(models.indexOf('if (forged) {'), models.indexOf('} else if (entry) {'));
ok(/forgeHero\(heroKind, ch, side\)/.test(models)
  && /const built = forged\.group;/.test(heroBranch)
  && !heroBranch.includes('buildNpcModel'), '玩家操控機甲仍只走 forge，未被 NPC 重建接管');

console.log(`\n${fail ? '❌' : '✅'} 正式場景建模：${pass} 通過，${fail} 失敗`);
if (fail) process.exit(1);
