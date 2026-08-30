#!/usr/bin/env node
/**
 * 功能分類閘：母照片覆蓋、YOLO26 同列配對、拆件欄位與功能替換的正反例。
 * 反向驗證：--break-interface / --break-palette / --break-decomposition。
 */
import {
  objectCompatibility,
  paletteCompatibility,
  partCompatibility,
  validateClassification,
} from './object_classification_policy.mjs';
import { buildClassificationManifest } from './object_classification_inventory.mjs';

const BREAK_INTERFACE = process.argv.includes('--break-interface');
const BREAK_PALETTE = process.argv.includes('--break-palette');
const BREAK_DECOMPOSITION = process.argv.includes('--break-decomposition');
const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

const manifest = buildClassificationManifest();
if (BREAK_DECOMPOSITION) {
  const target = manifest.items.find((row) => row.classification?.parts?.length);
  if (!target) throw new Error('--break-decomposition 找不到適用分類列');
  target.classification.parts[0].interfaceFamily = '';
}

ok('每張直屬來源照片恰有一列 Luna 功能分類', manifest.counts.sources > 0
  && manifest.counts.classified === manifest.counts.sources,
`classified=${manifest.counts.classified}/${manifest.counts.sources}`);
ok('分類清單沒有重複、孤兒或 schema 問題', manifest.issues.length === 0,
  manifest.issues.slice(0, 3).join('；'));
ok('分類家族與來源路徑一致', manifest.items.every((row) => (
  row.classification?.family === row.source.image.split('/')[0]
  && row.classification?.source?.corpus === row.source.corpus
  && row.classification?.source?.image === row.source.image
)));
ok('每張母照片與 YOLO26 證據共用同一分類列', manifest.items.every((row) => (
  row.yolo26?.status === 'missing'
    ? row.yolo26.expectedFeatureFile && row.yolo26.expectedLegacyFeatureFile
    : row.yolo26.status === 'present' && row.yolo26.schemaVersion === 2
      && row.yolo26.featureFile && Array.isArray(row.yolo26.targets)
)));
ok('每列功能零件與拆件狀態完整', manifest.items.every((row) => {
  const classification = row.classification;
  if (!classification || validateClassification(classification).length) return false;
  const missing = classification.missingFunctionalParts || [];
  return classification.decompositionStatus === 'needs_decomposition' ? missing.length > 0 : missing.length === 0;
}));

const basePart = {
  role: 'visibility_signal', function: '道路車輛前方照明', interfaceFamily: 'vehicle-lamp-two-bolt',
  kinematicClass: 'fixed', loadClass: 'light', workingMedium: 'road-air', handedness: 'symmetric-pair',
  materialClass: 'lamp-lens-housing', paletteSlot: 'emissive_signal', mountCount: 2,
};
const sameFunctionDifferentAppearance = { ...basePart, cosmeticStyle: 'round-chrome' };
ok('外觀不同但功能介面相同的零件可替換',
  partCompatibility(basePart, sameFunctionDifferentAppearance).compatible);

const wrongInterface = {
  ...basePart,
  interfaceFamily: BREAK_INTERFACE ? basePart.interfaceFamily : 'marine-deck-flange',
  cosmeticStyle: basePart.cosmeticStyle,
};
ok('外觀欄相同也不能越過現實接合介面', !partCompatibility(basePart, wrongInterface).compatible);

const objectA = {
  objectType: 'cargo_truck',
  functionalProfile: { workingMedium: 'road-air', operationMode: 'cargo-haul', safetyClass: 'road-heavy', compatibleTypes: [] },
};
const objectB = structuredClone(objectA);
objectB.style = '完全不同外型';
ok('物件相容性只看用途與工作條件', objectCompatibility(objectA, objectB).compatible);

const paletteA = {
  paletteDomain: 'civilian-road-cargo', operationalMarking: ['road-civilian'],
  parts: [{ paletteSlot: 'structural' }, { paletteSlot: 'safety_marking' }],
};
const paletteB = {
  paletteDomain: 'civilian-road-cargo',
  operationalMarking: BREAK_PALETTE ? ['road-civilian'] : ['military-identification'],
  parts: [{ paletteSlot: 'structural' }, { paletteSlot: 'safety_marking' }],
};
ok('整體顏色接近也不能跨越作業標記語意', !paletteCompatibility(paletteA, paletteB).compatible);

const compatibilitySource = [objectCompatibility, partCompatibility, paletteCompatibility]
  .map((fn) => fn.toString()).join('\n');
ok('替換資格未讀外觀、primitive、色差或幾何尺寸',
  !/appearance|cosmetic|primitive|shape|style|colorDistance|dimensions/.test(compatibilitySource));

for (const check of checks) console.log(`${check.pass ? '✓' : '✗'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
