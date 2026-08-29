#!/usr/bin/env node
/**
 * 背景物件組裝閘：主結構固定、葉節點依角色整組抽樣、配色取自子類別清單、變體可合批。
 * NPC／戰鬥建築／玩家機甲必須與本縫隔離。
 * 反向驗證：--break-leaf / --break-palette。
 */
import { readSrc } from './audit_src.mjs';
import { RUNTIME_BACKGROUND_CATALOG, RUNTIME_PARTS } from '../public/js/runtimeParts.js';
import {
  BACKGROUND_VARIANTS_PER_TARGET,
  backgroundObjectTargets,
  generateBackgroundObject,
} from '../public/js/backgroundObjects.js';

const BREAK_LEAF = process.argv.includes('--break-leaf');
const BREAK_PALETTE = process.argv.includes('--break-palette');
const entries = new Map(Object.values(RUNTIME_PARTS).flat().map((entry) => [entry.key, entry]));
const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

const refs = Object.entries(RUNTIME_BACKGROUND_CATALOG.objects);
ok('所有正式背景列都有主結構索引', refs.length === entries.size
  && refs.every(([key]) => entries.has(key)), `index=${refs.length}, runtime=${entries.size}`);
ok('排除 NPC／戰鬥建築／玩家機甲',
  RUNTIME_BACKGROUND_CATALOG.policy.excludedConsumers?.join('|') === 'npc|building-unit|player-mecha');
ok('四層葉節點政策固定',
  RUNTIME_BACKGROUND_CATALOG.policy.hierarchy?.join('|')
    === 'target-main-structure|leaf-role|source-assembly|part-index');

let indexOk = true;
for (const [key, ref] of refs) {
  const entry = entries.get(key);
  const sub = RUNTIME_BACKGROUND_CATALOG.subcategories[ref.subcategoryId];
  const structure = sub?.structures.find((row) => row.id === ref.structureId);
  const member = structure?.members.find((row) => row.key === key);
  if (!entry || !sub || !structure || !member || !member.mainParts.length) { indexOk = false; break; }
  const indexes = [
    ...member.mainParts.map((row) => row.index),
    ...member.leafRoles.flatMap((row) => row.partIndexes),
  ];
  if (indexes.some((index) => !entry.parts[index])) { indexOk = false; break; }
}
ok('主結構與葉節點索引皆指向真零件', indexOk);

const target = refs.find(([key, ref]) => {
  const sub = RUNTIME_BACKGROUND_CATALOG.subcategories[ref.subcategoryId];
  const structure = sub.structures.find((row) => row.id === ref.structureId);
  return structure.members.length > 1 && sub.palettes.length > 1 && key.startsWith('building/');
})?.[0];
if (!target) throw new Error('反向驗證沒有可同時抽葉零件與配色的背景目標');
const generated = generateBackgroundObject(target, 3);
const repeated = generateBackgroundObject(target, 3);
if (BREAK_LEAF) generated.generation.leafSources = {};
if (BREAK_PALETTE) generated.palettes = [];
const ref = RUNTIME_BACKGROUND_CATALOG.objects[target];
const sub = RUNTIME_BACKGROUND_CATALOG.subcategories[ref.subcategoryId];
const structure = sub.structures.find((row) => row.id === ref.structureId);
const member = structure.members.find((row) => row.key === target);
ok('相同 target + seed 逐位元同成品', JSON.stringify(generated) === JSON.stringify(repeated));
ok('主結構固定為目標物件', generated.generation.targetKey === target
  && generated.generation.mainPartCount === member.mainParts.length
  && generated.parts.slice(0, member.mainParts.length).every((part, index) => (
    part.name === entries.get(target).parts[member.mainParts[index].index].name
  )));
ok('葉節點按角色保留來源帳', Object.keys(generated.generation.leafSources).length > 0
  && Object.entries(generated.generation.leafSources).every(([role, sourceKey]) => (
    structure.members.some((row) => row.key === sourceKey
      && row.leafRoles.some((leaf) => leaf.role === role))
  )));
ok('渲染配色抽自子類別清單', generated.palettes.length === 1
  && sub.palettes.some((palette) => palette.id === generated.generation.paletteId));

const variants = Array.from({ length: 32 }, (_, seed) => generateBackgroundObject(target, seed));
ok('固定變體上限可合批', new Set(variants.map((row) => row.key)).size <= BACKGROUND_VARIANTS_PER_TARGET);
ok('多成員主結構確實產生葉零件或配色差異', new Set(variants.map((row) => JSON.stringify([
  row.generation.leafSources, row.generation.paletteId,
]))).size > 1);
ok('背景目標查詢只涵蓋執行期環境資產', backgroundObjectTargets().length === entries.size
  && backgroundObjectTargets('building').every((key) => key.startsWith('building/')));

const generatorSrc = readSrc('public', 'js', 'backgroundObjects.js');
const buildingSrc = readSrc('public', 'js', 'approvedBuildingModels.js');
const vehicleSrc = readSrc('public', 'js', 'approvedVehicleModels.js');
const biomesSrc = readSrc('public', 'js', 'biomes.js');
const npcSrc = readSrc('public', 'js', 'npcModels.js');
const buildingUnitSrc = readSrc('public', 'js', 'buildingUnitModels.js');
const forgeSrc = readSrc('public', 'js', 'forge', 'forge.js');
ok('生成路徑零 Math.random', !generatorSrc.includes('Math.random('));
ok('一般建物與場景載具接上共同組裝縫', buildingSrc.includes('generateBackgroundObject(')
  && vehicleSrc.includes('generateBackgroundObject(')
  && biomesSrc.includes('generatedApprovedVehicleModelAt('));
ok('三類戰鬥模型未接背景組裝器', !npcSrc.includes('backgroundObjects')
  && !buildingUnitSrc.includes('backgroundObjects') && !forgeSrc.includes('backgroundObjects'));

for (const check of checks) console.log(`${check.pass ? '✓' : '✗'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);

