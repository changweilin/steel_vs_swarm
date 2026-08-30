#!/usr/bin/env node
/**
 * 將功能分類決定性展開為 family / existing|extended / objectType 樹狀目錄。
 * 證據不足與損壞來源只進隔離分支，不得冒充新類別。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../audit_src.mjs';
import { buildClassificationManifest, EXTENSIONS_PATH } from './object_classification_inventory.mjs';
import {
  OBJECT_TYPES,
  UNKNOWN_TYPE,
  resolveCategory,
  validateCategoryExtensions,
} from './object_classification_policy.mjs';

export const CATEGORY_TREE_DIR = path.join(ROOT, 'tools', 'ai3d', 'object_category_tree');
const textCmp = (a, b) => String(a).localeCompare(String(b), 'en');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicJson(file, value) {
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, json(value), 'utf8');
  fs.renameSync(temp, file);
}

function memberRow(row) {
  return {
    id: row.id,
    source: row.source,
    subtype: row.classification.subtype,
    confidence: row.classification.confidence,
    decompositionStatus: row.classification.decompositionStatus,
    yolo26Status: row.yolo26.status,
  };
}

export function buildObjectCategoryTree() {
  const manifest = buildClassificationManifest();
  const extensionDoc = readJson(EXTENSIONS_PATH, { schemaVersion: 1, categories: [] });
  const extensionIssues = validateCategoryExtensions(extensionDoc);
  const issues = [...manifest.issues, ...extensionIssues.map((issue) => `類別擴充登錄：${issue}`)];
  const categories = new Map();

  const ensure = (categoryPath, definition) => {
    if (!categories.has(categoryPath)) categories.set(categoryPath, {
      schemaVersion: 1,
      path: categoryPath,
      ...definition,
      members: [],
    });
    return categories.get(categoryPath);
  };

  for (const extension of extensionDoc.categories || []) {
    ensure(`${extension.family}/extended/${extension.id}`, {
      family: extension.family,
      branch: 'extended',
      objectType: extension.id,
      definitionSource: 'tools/ai3d/object_category_extensions.json',
      definition: extension,
    });
  }

  for (const row of manifest.items) {
    if (!row.classification) continue;
    const category = resolveCategory(row.classification, extensionDoc.categories || []);
    if (!category.path) continue;
    const isExisting = category.status === 'existing';
    const definition = isExisting ? {
      family: row.classification.family,
      branch: 'existing',
      objectType: row.classification.objectType,
      definitionSource: 'tools/ai3d/object_classification_policy.mjs',
    } : category.status === 'extension' ? {
      family: row.classification.family,
      branch: 'extended',
      objectType: row.classification.objectType,
      definitionSource: 'tools/ai3d/object_category_extensions.json',
      definition: category.extension,
    } : {
      family: row.classification.family,
      branch: '__unresolved__',
      objectType: UNKNOWN_TYPE,
      resolution: category.status,
      definitionSource: 'evidence gate',
    };
    ensure(category.path, definition).members.push(memberRow(row));
  }

  const categoryRows = [...categories.values()]
    .map((category) => ({
      ...category,
      members: category.members.sort((a, b) => textCmp(a.id, b.id)),
    }))
    .sort((a, b) => textCmp(a.path, b.path));
  const families = {};
  for (const family of Object.keys(OBJECT_TYPES).sort(textCmp)) {
    const rows = categoryRows.filter((category) => category.family === family);
    if (!rows.length) continue;
    families[family] = {
      schemaVersion: 1,
      family,
      categories: rows.map((category) => ({
        path: category.path,
        branch: category.branch,
        objectType: category.objectType,
        resolution: category.resolution || null,
        members: category.members.length,
      })),
    };
  }

  const root = {
    schemaVersion: 1,
    policy: {
      axis: 'real-world object function',
      existingPath: '<family>/existing/<objectType>',
      extensionPath: '<family>/extended/<objectType>',
      unresolvedPath: '<family>/__unresolved__/<reason>',
      sourceMutation: 'none',
      extensionGate: 'registered functional definition; never appearance',
    },
    counts: {
      objects: categoryRows.reduce((sum, category) => sum + category.members.length, 0),
      categories: categoryRows.length,
      existingCategories: categoryRows.filter((category) => category.branch === 'existing').length,
      extensionCategories: categoryRows.filter((category) => category.branch === 'extended').length,
      insufficientEvidence: categoryRows.filter((category) => category.resolution === 'insufficient_evidence')
        .reduce((sum, category) => sum + category.members.length, 0),
      invalidSources: categoryRows.filter((category) => category.resolution === 'invalid_source')
        .reduce((sum, category) => sum + category.members.length, 0),
      issues: issues.length,
    },
    families: Object.values(families).map((family) => ({
      family: family.family,
      path: family.family,
      categories: family.categories.length,
      members: family.categories.reduce((sum, category) => sum + category.members, 0),
    })),
    categoryPaths: categoryRows.map((category) => category.path),
    issues: issues.sort(textCmp),
  };
  return { root, families, categories: categoryRows };
}

function expectedFiles(tree) {
  const files = new Map([['index.json', tree.root]]);
  for (const family of Object.values(tree.families)) files.set(`${family.family}/index.json`, family);
  for (const category of tree.categories) files.set(`${category.path}/index.json`, category);
  return files;
}

function main() {
  const tree = buildObjectCategoryTree();
  const files = expectedFiles(tree);
  const check = process.argv.includes('--check');
  for (const [relative, value] of files) {
    const file = path.join(CATEGORY_TREE_DIR, ...relative.split('/'));
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json(value)) {
        console.error(`  ✗ 類別樹不是最新輸出：${relative}`);
        process.exitCode = 1;
      }
    } else if (process.argv.includes('--write')) atomicJson(file, value);
  }
  console.log(`類別樹：${tree.root.counts.objects} 個物件；${tree.root.counts.categories} 個節點；擴充類別 ${tree.root.counts.extensionCategories}`);
  if (tree.root.issues.length) {
    for (const issue of tree.root.issues) console.error(`  ✗ ${issue}`);
    if (check) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
