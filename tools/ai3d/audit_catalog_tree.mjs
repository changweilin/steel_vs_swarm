#!/usr/bin/env node
/**
 * 樹狀 3D 型錄離線閘：入選聯集、移除優先、四層目錄、主結構唯一、零件樹、子類別配色。
 * 反向驗證：--break-tree / --break-palette。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSrc } from '../audit_src.mjs';
import { manifest as reviewManifest } from '../parts_review.mjs';
import { buildCatalogTree, CATALOG_PATH, DIRECT_LUNA_METHOD, REMOVED_STATUSES } from './catalog_tree.mjs';

const load = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const state = load(path.join(ROOT, 'tools', 'parts_review', 'state.json'), { items: {} });
const database = load(path.join(ROOT, 'out', '3d_database.json'), { items: [] });
const manifest = load(path.join(ROOT, 'tools', 'ai3d', 'parts_manifest.json'), { parts: [] });
const candidates = load(path.join(ROOT, 'out', 'review_previews', 'rock_luna_v6_candidates.json'), { candidates: [] });
const manifestKeys = (row) => row.keys?.length ? row.keys : (row.key ? [row.key] : []);
const directKeys = new Set([
  ...(database.items || []).filter((row) => row.method === DIRECT_LUNA_METHOD).map((row) => row.key),
  ...(manifest.parts || []).filter((row) => row.method === DIRECT_LUNA_METHOD).flatMap(manifestKeys),
  ...(candidates.candidates || []).map((row) => row.key),
]);
const approvedKeys = new Set(Object.entries(state.items || {}).filter(([, row]) => row.status === 'ok').map(([key]) => key));
const removedKeys = new Set(Object.entries(state.items || {})
  .filter(([, row]) => REMOVED_STATUSES.has(row.status)).map(([key]) => key));
const expected = new Set([...approvedKeys, ...directKeys].filter((key) => !removedKeys.has(key)));
const catalog = buildCatalogTree();

if (process.argv.includes('--break-tree')) delete catalog.objects[Object.keys(catalog.objects)[0]].structureId;
if (process.argv.includes('--break-palette')) catalog.objects[Object.keys(catalog.objects)[0]].paletteIds = [];

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const actualKeys = new Set(Object.keys(catalog.objects));
ok('入選集合 = 已通過 ∪ luna 直接 v6', expected.size === actualKeys.size
  && [...expected].every((key) => actualKeys.has(key)), `expected=${expected.size}, actual=${actualKeys.size}`);
ok('archive/purge 不進型錄', [...removedKeys].every((key) => !actualKeys.has(key)));
ok('四層目錄欄位完整', Object.values(catalog.objects).every((row) =>
  row.category && row.subcategory && row.subcategoryId && row.structureId && row.path));
ok('每物件指向既有主結構', Object.entries(catalog.objects).every(([key, row]) => {
  const sub = catalog.subcategories[row.subcategoryId];
  const structure = sub?.structures.find((item) => item.id === row.structureId);
  return structure && structure.members.some((member) => member.key === key) && structure.canonicalKey === row.canonicalKey;
}));
ok('每組主結構恰一 canonical', Object.values(catalog.subcategories).every((sub) =>
  sub.structures.every((structure) => structure.canonicalKey
    && structure.members.filter((member) => member.key === structure.canonicalKey).length === 1
    && structure.mainStructure?.sourceKey === structure.canonicalKey)));
ok('非主結構零件依角色/相似形分樹', Object.values(catalog.subcategories).every((sub) =>
  sub.structures.every((structure) => structure.partGroups.every((group) =>
    group.id && group.role && group.type && group.members.length > 0))));
ok('每子類別恰一配色清單路徑', Object.values(catalog.subcategories).every((sub) =>
  sub.palettePath === `${sub.path}/palette-list.json` && Array.isArray(sub.palettes)));
ok('每物件的渲染配色已記錄', Object.values(catalog.objects).every((row) => row.paletteIds.length > 0
  && row.paletteIds.every((id) => catalog.subcategories[row.subcategoryId].palettes.some((palette) => palette.id === id))));
ok('決定性實體目錄是最新輸出', JSON.stringify(load(CATALOG_PATH, null)) === JSON.stringify(catalog));
const reviewCatalogKeys = new Set(reviewManifest(state.items || {}).rows.filter((row) => row.catalog).map((row) => row.key));
ok('零件台列完整覆蓋型錄', reviewCatalogKeys.size === actualKeys.size
  && [...actualKeys].every((key) => reviewCatalogKeys.has(key)),
`catalog=${actualKeys.size}, review=${reviewCatalogKeys.size}`);

const reviewSrc = readSrc('tools/parts_review/review.js');
const serverSrc = readSrc('tools/parts_review.mjs');
ok('零件台讀型錄唯一縫', serverSrc.includes("from './ai3d/catalog_tree.mjs'") && serverSrc.includes('catalogReviewView(catalog)'));
ok('零件台呈現類別/子類別/主結構樹', reviewSrc.includes('pr-tree-cat')
  && reviewSrc.includes('pr-tree-sub') && reviewSrc.includes('pr-tree-shape') && reviewSrc.includes('catalogSection(r)'));
ok('零件台樹葉列出零件群與配色', reviewSrc.includes('catalogTreeBranches')
  && reviewSrc.includes('pr-tree-branches') && reviewSrc.includes('partGroups')
  && reviewSrc.includes('palettes'));
ok('零件台支援指定／隨機零件與配色', reviewSrc.includes('generateBackgroundObject')
  && reviewSrc.includes('partOverrides') && reviewSrc.includes('data-assembly-action="random"')
  && reviewSrc.includes('prAssemblyPalette'));

for (const check of checks) console.log(`${check.pass ? '✓' : '✗'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
const failed = checks.filter((check) => !check.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
