#!/usr/bin/env node
/**
 * 背景物件組裝閘：主結構固定、同角色多槽獨立抽樣、槽包絡與接合中心固定、配色取自子類別清單。
 * NPC／戰鬥建築／玩家機甲必須與本縫隔離。
 * 反向驗證：--break-leaf / --break-multi / --break-slot / --break-palette。
 */
import { readSrc } from './audit_src.mjs';
import { runtimePartsFrameBounds } from './ai3d/catalog_tree.mjs';
import { RUNTIME_BACKGROUND_CATALOG, RUNTIME_PARTS } from '../public/js/runtimeParts.js';
import {
  BACKGROUND_VARIANTS_PER_TARGET,
  backgroundObjectTargets,
  generateBackgroundObject,
} from '../public/js/backgroundObjects.js';

const BREAK_LEAF = process.argv.includes('--break-leaf');
const BREAK_MULTI = process.argv.includes('--break-multi');
const BREAK_SLOT = process.argv.includes('--break-slot');
const BREAK_PALETTE = process.argv.includes('--break-palette');
const entries = new Map(Object.values(RUNTIME_PARTS).flat().map((entry) => [entry.key, entry]));
const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

const refs = Object.entries(RUNTIME_BACKGROUND_CATALOG.objects);
ok('所有正式背景列都有主結構索引', refs.length === entries.size
  && refs.every(([key]) => entries.has(key)), `index=${refs.length}, runtime=${entries.size}`);
ok('排除 NPC／戰鬥建築／玩家機甲',
  RUNTIME_BACKGROUND_CATALOG.policy.excludedConsumers?.join('|') === 'npc|building-unit|player-mecha');
ok('五層葉節點／多槽政策固定', RUNTIME_BACKGROUND_CATALOG.schemaVersion === 2
  && RUNTIME_BACKGROUND_CATALOG.policy.hierarchy?.join('|')
    === 'target-main-structure|leaf-role|target-slot|source-slot|part-index');

let indexOk = true;
for (const [key, ref] of refs) {
  const entry = entries.get(key);
  const sub = RUNTIME_BACKGROUND_CATALOG.subcategories[ref.subcategoryId];
  const structure = sub?.structures.find((row) => row.id === ref.structureId);
  const member = structure?.members.find((row) => row.key === key);
  if (!entry || !sub || !structure || !member || !member.mainParts.length) { indexOk = false; break; }
  const indexes = [
    ...member.mainParts.map((row) => row.index),
    ...member.leafRoles.flatMap((row) => row.slots.flatMap((slot) => slot.partIndexes)),
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
ok('每個目標槽位保留獨立來源帳', Object.keys(generated.generation.leafSources).length > 0
  && generated.generation.leafSlots.length === member.leafRoles.reduce((sum, row) => sum + row.slots.length, 0)
  && generated.generation.leafSlots.every((slot) => structure.members.some((row) => (
    row.key === slot.sourceKey && row.leafRoles.some((leaf) => leaf.role === slot.role
      && leaf.slots.some((sourceSlot) => sourceSlot.id === slot.sourceSlotId))
  ))));
ok('渲染配色抽自子類別清單', generated.palettes.length === 1
  && sub.palettes.some((palette) => palette.id === generated.generation.paletteId));
const selectableRole = member.leafRoles.map((targetRole) => ({
  targetRole,
  choice: structure.members.flatMap((sourceMember) => sourceMember.leafRoles
    .filter((sourceRole) => sourceRole.role === targetRole.role)
    .flatMap((sourceRole) => sourceRole.slots.map((slot) => ({ sourceMember, slot }))))
    .find((choice) => choice.sourceMember.key !== target),
})).find((row) => row.targetRole.slots.length && row.choice);
const selectedPalette = sub.palettes.find((palette) => palette.id !== generated.generation.paletteId) || sub.palettes[0];
const specified = selectableRole && selectedPalette
  ? generateBackgroundObject(target, 3, {
    partOverrides: {
      [`${selectableRole.targetRole.role}:${selectableRole.targetRole.slots[0].id}`]: {
        sourceKey: selectableRole.choice.sourceMember.key,
        sourceSlotId: selectableRole.choice.slot.id,
      },
    },
    paletteId: selectedPalette.id,
  }) : null;
ok('零件台可指定來源槽與子類別配色', !!specified
  && specified.generation.leafSlots.some((slot) => slot.role === selectableRole.targetRole.role
    && slot.targetSlotId === selectableRole.targetRole.slots[0].id
    && slot.sourceKey === selectableRole.choice.sourceMember.key
    && slot.sourceSlotId === selectableRole.choice.slot.id)
  && specified.generation.paletteId === selectedPalette?.id);

const variants = Array.from({ length: 32 }, (_, seed) => generateBackgroundObject(target, seed));
ok('固定變體上限可合批', new Set(variants.map((row) => row.key)).size <= BACKGROUND_VARIANTS_PER_TARGET);
ok('多成員主結構確實產生葉零件或配色差異', new Set(variants.map((row) => JSON.stringify([
  row.generation.leafSlots.map((slot) => [slot.sourceKey, slot.sourceSlotId]), row.generation.paletteId,
]))).size > 1);

let multiRoleCount = 0;
let multiRoleOk = true;
let canopyCovered = false;
for (const [key, entryRef] of refs) {
  const entrySub = RUNTIME_BACKGROUND_CATALOG.subcategories[entryRef.subcategoryId];
  const entryStructure = entrySub.structures.find((row) => row.id === entryRef.structureId);
  const entryMember = entryStructure.members.find((row) => row.key === key);
  for (const targetRole of entryMember.leafRoles) {
    const choices = entryStructure.members.flatMap((sourceMember) => sourceMember.leafRoles
      .filter((row) => row.role === targetRole.role)
      .flatMap((row) => row.slots.map((slot) => `${sourceMember.key}|${slot.id}`)));
    if (targetRole.slots.length < 2 || new Set(choices).size < 2) continue;
    const roleVariants = Array.from({ length: BACKGROUND_VARIANTS_PER_TARGET }, (_, seed) => (
      generateBackgroundObject(key, seed).generation.leafSlots.filter((slot) => slot.role === targetRole.role)
    ));
    if (BREAK_MULTI && multiRoleCount === 0) {
      for (const slots of roleVariants) {
        for (const slot of slots.slice(1)) {
          slot.sourceKey = slots[0].sourceKey;
          slot.sourceSlotId = slots[0].sourceSlotId;
        }
      }
    }
    const mixesWithinOneObject = roleVariants.some((slots) => (
      new Set(slots.map((slot) => `${slot.sourceKey}|${slot.sourceSlotId}`)).size > 1
    ));
    multiRoleOk &&= roleVariants.every((slots) => slots.length === targetRole.slots.length)
      && mixesWithinOneObject;
    multiRoleCount++;
    canopyCovered ||= targetRole.role === 'canopy';
  }
}
ok('所有同角色多位置皆可逐槽任意組合（含葉冠）', multiRoleOk && multiRoleCount > 0 && canopyCovered,
  `roles=${multiRoleCount}`);

let slotFitOk = true;
let slotCount = 0;
outer: for (const [key, entryRef] of refs) {
  const entrySub = RUNTIME_BACKGROUND_CATALOG.subcategories[entryRef.subcategoryId];
  const entryStructure = entrySub.structures.find((row) => row.id === entryRef.structureId);
  const entryMember = entryStructure.members.find((row) => row.key === key);
  for (let seed = 0; seed < BACKGROUND_VARIANTS_PER_TARGET; seed++) {
    const object = generateBackgroundObject(key, seed);
    for (const ledger of object.generation.leafSlots) {
      const targetRole = entryMember.leafRoles.find((row) => row.role === ledger.role);
      const targetSlot = targetRole?.slots.find((slot) => slot.id === ledger.targetSlotId);
      const output = object.parts.slice(ledger.partStart, ledger.partStart + ledger.partCount);
      if (BREAK_SLOT && slotCount === 0) output[0].position[0] += 0.25;
      const bounds = targetSlot && runtimePartsFrameBounds(output, targetSlot.rotation);
      slotCount++;
      const values = bounds && [...bounds.center.map((value, axis) => value - ledger.anchor[axis]),
        ...bounds.size.map((value, axis) => value - ledger.size[axis])];
      if (!values || values.some((value) => Math.abs(value) > 1e-7)) {
        slotFitOk = false;
        break outer;
      }
    }
  }
}
ok('所有葉槽渲染包絡與目標接合中心逐位元貼合', slotFitOk, `slots=${slotCount}`);
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
