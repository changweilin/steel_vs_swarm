#!/usr/bin/env node
/**
 * 功能類別樹稽核：新類別須先登錄功能定義，證據不足/損壞來源須隔離。
 * 反向驗證：--break-extension / --break-unresolved / --break-appearance。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../audit_src.mjs';
import { buildClassificationManifest } from './object_classification_inventory.mjs';
import { CATEGORY_TREE_DIR, buildObjectCategoryTree } from './object_category_tree.mjs';
import { resolveCategory, validateClassification } from './object_classification_policy.mjs';

const args = new Set(process.argv.slice(2));
const tree = buildObjectCategoryTree();
const manifest = buildClassificationManifest();
const interchange = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'ai3d', 'object_interchangeability.json'), 'utf8'));
const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

if (args.has('--break-unresolved')) {
  const unresolved = tree.categories.find((category) => category.branch === '__unresolved__');
  unresolved.branch = 'existing';
}
if (args.has('--break-appearance')) tree.categories[0].appearanceKey = 'same-silhouette';

const rootFile = path.join(CATEGORY_TREE_DIR, 'index.json');
ok('根索引是最新決定性輸出', fs.existsSync(rootFile)
  && fs.readFileSync(rootFile, 'utf8') === json(tree.root));
ok('每個 family 與 category 都有樹狀目錄索引',
  Object.values(tree.families).every((family) => {
    const file = path.join(CATEGORY_TREE_DIR, family.family, 'index.json');
    return fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json(family);
  }) && tree.categories.every((category) => {
    const file = path.join(CATEGORY_TREE_DIR, ...category.path.split('/'), 'index.json');
    return fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json(category);
  }));

const memberIds = tree.categories.flatMap((category) => category.members.map((member) => member.id));
ok('305 個來源各自只出現在一個類別節點', memberIds.length === manifest.counts.sources
  && new Set(memberIds).size === memberIds.length
  && manifest.items.every((row) => memberIds.includes(row.id)), `members=${memberIds.length}`);
ok('現有類別與擴充類別使用不同分支', tree.categories.every((category) => (
  category.branch === 'existing' ? category.path === `${category.family}/existing/${category.objectType}`
    : category.branch === 'extended' ? category.path === `${category.family}/extended/${category.objectType}`
      : category.branch === '__unresolved__'
  )));

const unresolvedIds = new Set(manifest.items
  .filter((row) => row.classification?.objectType === 'unresolved')
  .map((row) => row.id));
const unresolvedTreeIds = new Set(tree.categories
  .filter((category) => category.branch === '__unresolved__')
  .flatMap((category) => category.members.map((member) => member.id)));
const interchangeableIds = new Set([
  ...(interchange.objectGroups || []).flatMap((group) => group.members),
  ...(interchange.partGroups || []).flatMap((group) => group.members.map((member) => member.objectId)),
  ...(interchange.paletteGroups || []).flatMap((group) => group.members),
]);
ok('證據不足與損壞來源只進隔離分支', unresolvedIds.size === unresolvedTreeIds.size
  && [...unresolvedIds].every((id) => unresolvedTreeIds.has(id))
  && [...unresolvedIds].every((id) => !interchangeableIds.has(id))
  && tree.categories.filter((category) => category.branch === '__unresolved__')
    .every((category) => ['insufficient_evidence', 'invalid_source'].includes(category.resolution)));

const base = structuredClone(manifest.items.find((row) => row.classification.objectType !== 'unresolved').classification);
base.objectType = 'functional_test_extension';
base.categoryStatus = 'extension';
const extension = {
  family: base.family,
  id: base.objectType,
  displayName: '功能測試擴充',
  functionDefinition: '測試新功能類別能建立獨立節點',
  distinguishesFrom: '與現有類別具有不同現實用途',
  realityEvidence: '明確工作介質、操作模式與安全責任',
};
const extensionCategories = args.has('--break-extension') ? [] : [extension];
ok('不存在的功能類別會建立 extended 樹節點，未登錄則拒絕',
  validateClassification(base, { extensionCategories }).length === 0
  && resolveCategory(base, extensionCategories).path === `${base.family}/extended/${base.objectType}`
  && validateClassification(base, { extensionCategories: [] }).some((issue) => issue.includes('未登錄')));

const forbiddenKeys = new Set([
  'appearance', 'appearanceKey', 'shape', 'shapeSimilarity', 'primitive',
  'geometrySimilarity', 'colorDistance', 'dominantColor', 'visualStyle',
]);
const seenKeys = [];
const walk = (value) => {
  if (Array.isArray(value)) return value.forEach(walk);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { seenKeys.push(key); walk(child); }
};
walk(tree);
ok('類別樹沒有外觀、形狀或色差分類軸', !seenKeys.some((key) => forbiddenKeys.has(key)));

for (const check of checks) console.log(`${check.pass ? '✓' : '✗'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
