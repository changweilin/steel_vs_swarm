#!/usr/bin/env node
/**
 * 3D 型錄唯一縫：類別 → 子類別 → 共用主結構 → 非主結構零件相似樹。
 *
 * 原始 v5/v6 原子產物保留在 out/3d_data；本檔只產生決定性的共用結構索引，避免把同一份
 * model.json 複製到第二個可載入位置。入選集合 = 人眼 ok ∪ gpt-5.6-luna_visual_direct，
 * archive/purge 永遠優先排除。配色逐物件收錄，且每個子類別恰有一份 palette-list.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../audit_src.mjs';

export const CATALOG_ROOT = path.join(ROOT, 'out', '3d_catalog');
export const CATALOG_PATH = path.join(CATALOG_ROOT, 'catalog.json');
export const DIRECT_LUNA_METHOD = 'gpt-5.6-luna_visual_direct';
export const REMOVED_STATUSES = new Set(['archive', 'purge']);

const PATHS = Object.freeze({
  review: path.join(ROOT, 'tools', 'parts_review', 'state.json'),
  manifest: path.join(ROOT, 'tools', 'ai3d', 'parts_manifest.json'),
  database: path.join(ROOT, 'out', '3d_database.json'),
  archive: path.join(ROOT, 'tools', 'ai3d', 'archive_manifest.json'),
  candidateReport: path.join(ROOT, 'out', 'review_previews', 'rock_luna_v6_candidates.json'),
});
const ZONES = Object.freeze(['roofHex', 'facadeHex', 'baseHex', 'accentHex', 'glassHex', 'darkHex', 'brightHex']);
const TYPES = Object.freeze([
  'box', 'wedge', 'polygonal_prism', 'frustum_pyramid', 'pyramid', 'cylinder',
  'conical_frustum', 'cone', 'hemisphere_dome', 'ellipsoid_sphere',
  'torus_ring', 'dodecahedron_polyhedron', 'icosahedron_polyhedron',
]);
const TYPE_INDEX = new Map(TYPES.map((type, index) => [type, index]));
const textCmp = (a, b) => String(a).localeCompare(String(b), 'en');
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hashOf = (value, size = 10) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, size);
const manifestKeys = (row) => Array.isArray(row?.keys) && row.keys.length ? row.keys : (row?.key ? [row.key] : []);
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');
const safeName = (value) => String(value || 'other').normalize('NFKC')
  .replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[_\.]+|[_\.]+$/g, '').slice(0, 80) || 'other';
const partPos = (part) => part.position || part.pos || [0, 0, 0];

function atomicJson(file, value) {
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, json(value), 'utf8');
  fs.renameSync(temp, file);
}

function inside(file, root) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function modelFiles(root, outputDir) {
  if (!outputDir) return { model: null, features: null, metadata: null };
  const dir = path.resolve(root, outputDir);
  return {
    dir,
    model: readJson(path.join(dir, 'model.json'), null),
    features: readJson(path.join(dir, 'features.json'), null),
    metadata: readJson(path.join(dir, 'metadata.json'), null),
  };
}

function atomicOutputs(root) {
  const base = path.join(root, 'out', '3d_data');
  const found = new Map();
  if (!fs.existsSync(base)) return found;
  const pending = [base];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => textCmp(a.name, b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(file);
        continue;
      }
      if (entry.name !== 'metadata.json') continue;
      const metadata = readJson(file, null);
      if (!metadata?.key || found.has(metadata.key)) continue;
      found.set(metadata.key, { metadata, outputDir: rel(dir) });
    }
  }
  return found;
}

function inferKeyParts(key) {
  const [family = 'other', tail = 'other'] = String(key || '').split('/');
  const subpart = tail.split('_')[0] || 'other';
  return { family, subpart };
}

function normalizedColors(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const facade = Number.isInteger(raw.facadeHex) ? raw.facadeHex
    : (Number.isInteger(raw.primaryHex) ? raw.primaryHex : null);
  if (facade == null) return null;
  const fallback = {
    roofHex: facade, facadeHex: facade, baseHex: facade, accentHex: facade,
    glassHex: 0x1e293b, darkHex: 0x2c3e50, brightHex: 0xecf0f1,
  };
  return Object.fromEntries(ZONES.map((zone) => [zone, Number.isInteger(raw[zone]) ? raw[zone] : fallback[zone]]));
}

function paletteRows(record) {
  const raw = [];
  const push = (colors, name = null, source = null) => {
    const clean = normalizedColors(colors);
    if (clean) raw.push({ colors: clean, name, source });
  };
  push(record.features?.colors, '原始渲染配色', 'features.colors');
  push(record.model?.colors, '模型渲染配色', 'model.colors');
  for (const [index, palette] of (record.model?.palettes || record.database?.palettes || record.manifest?.palettes || []).entries()) {
    push(palette.colors || palette, palette.name || `配色 ${index + 1}`, 'palettes');
  }
  if (!raw.length && Array.isArray(record.model?.parts)) {
    const counts = new Map();
    const keyed = {};
    for (const part of record.model.parts) {
      if (!Number.isInteger(part.color)) continue;
      counts.set(part.color, (counts.get(part.color) || 0) + 1);
      if (ZONES.includes(part.colorKey)) keyed[part.colorKey] = part.color;
    }
    const facadeHex = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (facadeHex != null) push({ facadeHex, ...keyed }, '零件材質推導配色', 'model.parts');
  }
  if (!raw.length) raw.push({
    colors: null,
    name: '執行期繼承配色',
    source: 'runtime-consumer',
    signature: `runtime:${record.method || 'unknown'}:${record.manifest?.consumer || record.key}`,
  });
  const unique = new Map();
  for (const row of raw) {
    const signature = row.signature || ZONES.map((zone) => row.colors[zone]).join(':');
    if (!unique.has(signature)) unique.set(signature, { ...row, signature });
  }
  return [...unique.values()];
}

function primitiveMetric(part) {
  const d = part.dimensions || [];
  const r = part.radii || [];
  const height = Number(part.height || d[1] || 0);
  let size = [Number(d[0] || 0), height, Number(d[2] || d[0] || 0)];
  let volume = 0;
  if (part.type === 'box' || part.type === 'wedge') {
    volume = Math.abs(size[0] * size[1] * size[2]) * (part.type === 'wedge' ? 0.5 : 1);
  } else if (['cylinder', 'conical_frustum', 'cone', 'frustum_pyramid', 'pyramid', 'polygonal_prism'].includes(part.type)) {
    const top = Number(r[0] ?? part.radius ?? 0);
    const bottom = Number(r[1] ?? part.radius ?? top);
    size = [2 * Math.max(top, bottom), height, 2 * Math.max(top, bottom)];
    volume = Math.PI * Math.abs(height) * (top * top + top * bottom + bottom * bottom) / 3;
  } else if (part.type === 'torus_ring') {
    const major = Number(part.radius || 0), tube = Number(part.tube || 0);
    size = [2 * (major + tube), 2 * (major + tube), 2 * tube];
    volume = 2 * Math.PI * Math.PI * major * tube * tube;
  } else if (part.type === 'ellipsoid_sphere' || part.type === 'hemisphere_dome') {
    const [rx = 0, ry = rx, rz = rx] = r;
    size = [2 * rx, 2 * ry, 2 * rz];
    volume = 4 * Math.PI * rx * ry * rz / 3 * (part.type === 'hemisphere_dome' ? 0.5 : 1);
  } else {
    const radius = Number(part.radius || r[0] || 0);
    size = [2 * radius, 2 * radius, 2 * radius];
    volume = 4 * Math.PI * radius ** 3 / 3;
  }
  return { size: size.map((v) => Math.abs(Number(v) || 0)), volume: Math.max(Math.abs(volume), 1e-9) };
}

const ROLE_RULES = Object.freeze([
  ['wheel_spoke', /spoke/], ['wheel_tire', /tire|tyre/], ['wheel_rim', /\brim\b/],
  ['wheel', /wheel/], ['glass', /glass|window|windscreen|windshield|glaz/],
  ['lamp', /lamp|headlight|taillight|light_|_light|beacon/], ['mirror', /mirror/],
  ['door', /door|hatch/], ['trim', /trim|seam|stripe|decal|plate|badge|handle/],
  ['rail', /rail|railing|balustrade|fence/], ['stair', /stair|step|ladder/],
  ['antenna', /antenna|aerial|mast|finial/], ['roof', /roof|eave|dome|spire|cap/],
  ['canopy', /canopy|crown|foliage|leaf|needle_pad|cloud_lobe|puff/],
  ['branch', /branch|bough|primary|outer|secondary|arm/], ['trunk', /trunk|bole|root|buttress/],
  ['body', /body|chassis|frame|cab|cabin|hull|fuselage|podium|tower|facade|wall|mass|core/],
  ['rock_mass', /rock|boulder|stone|slab|pillar|column|arch|outcrop/],
  ['overlay', /lichen|moss|wet|foam|stain|strata|highlight|shadow/],
]);

function partRole(part) {
  const text = `${part.role || ''} ${part.name || ''}`.toLowerCase();
  for (const [role, pattern] of ROLE_RULES) if (pattern.test(text)) return role;
  return safeName(String(part.role || part.name || part.type || 'detail').toLowerCase()
    .replace(/(?:^|_)(?:left|right|front|rear|upper|lower)(?:_|$)/g, '_').replace(/_?\d+$/g, ''));
}

function isMainRole(family, role) {
  if (family === 'vehicle') return ['body'].includes(role);
  if (family === 'tree') return ['trunk', 'branch', 'canopy'].includes(role);
  if (family === 'rock') return role === 'rock_mass' || role === 'body';
  if (family === 'cloud') return role === 'canopy' || role === 'body';
  if (family === 'building' || family === 'beacon' || family === 'ship') {
    return ['body', 'roof', 'rock_mass'].includes(role);
  }
  return role === 'body';
}

function splitParts(record) {
  const parts = Array.isArray(record.model?.parts) ? record.model.parts : [];
  if (!parts.length) return { main: [], accessory: [] };
  const rows = parts.map((part, index) => ({ part, index, role: partRole(part), ...primitiveMetric(part) }));
  const ranked = [...rows].sort((a, b) => b.volume - a.volume || a.index - b.index);
  const total = ranked.reduce((sum, row) => sum + row.volume, 0);
  const main = new Set(rows.filter((row) => isMainRole(record.family, row.role)).map((row) => row.index));
  let covered = rows.filter((row) => main.has(row.index)).reduce((sum, row) => sum + row.volume, 0);
  for (const row of ranked) {
    if (covered / total >= 0.72 && main.size) break;
    if (['glass', 'lamp', 'mirror', 'trim', 'overlay', 'wheel_spoke', 'wheel_tire', 'wheel_rim'].includes(row.role)) continue;
    if (!main.has(row.index)) { main.add(row.index); covered += row.volume; }
  }
  if (!main.size) main.add(ranked[0].index);
  return {
    main: rows.filter((row) => main.has(row.index)),
    accessory: rows.filter((row) => !main.has(row.index)),
  };
}

function structureVector(record, main) {
  const bounds = record.model?.bounds || record.database?.bounds || {};
  const size = bounds.size || record.database?.bounds?.size || [1, 1, 1];
  const maxSize = Math.max(...size.map((v) => Math.abs(Number(v) || 0)), 1e-6);
  const vector = size.map((v) => (Number(v) || 0) / maxSize);
  vector.push(Math.min(1, Math.log2(main.length + 1) / 8));
  const volumes = main.reduce((sum, row) => sum + row.volume, 0) || 1;
  const typeWeights = Array(TYPES.length).fill(0);
  const centre = [0, 0, 0], spread = [0, 0, 0];
  for (const row of main) {
    const typeIndex = TYPE_INDEX.get(row.part.type);
    if (typeIndex != null) typeWeights[typeIndex] += row.volume / volumes;
    const pos = partPos(row.part);
    for (let axis = 0; axis < 3; axis++) centre[axis] += (Number(pos[axis]) || 0) * row.volume / volumes / maxSize;
  }
  for (const row of main) {
    const pos = partPos(row.part);
    for (let axis = 0; axis < 3; axis++) {
      const delta = (Number(pos[axis]) || 0) / maxSize - centre[axis];
      spread[axis] += delta * delta * row.volume / volumes;
    }
  }
  vector.push(...typeWeights, ...centre, ...spread.map(Math.sqrt));
  return vector.map((value) => Number.isFinite(value) ? value : 0);
}

function vectorDistance(a, b) {
  const n = Math.max(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ((a[i] || 0) - (b[i] || 0)) ** 2;
  return Math.sqrt(sum / n);
}

function candidateRank(record) {
  return (record.reviewStatus === 'ok' ? 1_000_000 : 0)
    + Number(record.database?.similarityScore || record.metadata?.similarityScore || record.candidate?.similarityReview?.similarityScore || 0) * 1_000
    - Number(record.database?.bounds?.triangles || record.model?.bounds?.triangles || 0) / 1_000_000;
}

function clusterStructures(records, threshold = 0.145) {
  const clusters = [];
  for (const record of [...records].sort((a, b) => textCmp(a.key, b.key))) {
    const split = splitParts(record);
    const vector = structureVector(record, split.main);
    let best = null;
    for (const cluster of clusters) {
      const distance = vectorDistance(vector, cluster.vector);
      if (distance <= threshold && (!best || distance < best.distance)) best = { cluster, distance };
    }
    if (!best) {
      clusters.push({ vector, records: [{ record, split, vector, distance: 0 }] });
    } else {
      best.cluster.records.push({ record, split, vector, distance: best.distance });
    }
  }
  for (const cluster of clusters) {
    cluster.records.sort((a, b) => candidateRank(b.record) - candidateRank(a.record) || textCmp(a.record.key, b.record.key));
    cluster.canonical = cluster.records[0];
    cluster.id = `shape_${hashOf(cluster.vector.map((v) => Math.round(v * 20) / 20).join(','))}`;
    for (const row of cluster.records) row.similarity = Math.max(0, Math.round((1 - row.distance / threshold) * 100));
  }
  return clusters.sort((a, b) => textCmp(a.id, b.id));
}

function partShapeSignature(row) {
  const maxSize = Math.max(...row.size, 1e-6);
  const ratio = row.size.map((v) => Math.round(v / maxSize * 8) / 8);
  const sides = Math.max(0, Math.round(Number(row.part.sides || 0) / 2) * 2);
  return `${row.part.type}|${ratio.join(',')}|${sides}`;
}

function accessoryTree(cluster) {
  const groups = new Map();
  for (const member of cluster.records) {
    for (const row of member.split.accessory) {
      const signature = partShapeSignature(row);
      const id = `${safeName(row.role)}_${hashOf(signature, 8)}`;
      if (!groups.has(id)) groups.set(id, {
        id, role: row.role, type: row.part.type, signature,
        canonical: { objectKey: member.record.key, name: row.part.name || null, part: row.part }, members: [],
      });
      groups.get(id).members.push({
        objectKey: member.record.key, name: row.part.name || null,
        position: partPos(row.part), rotation: row.part.rotation || row.part.rot || [0, 0, 0],
        colorKey: row.part.colorKey || null, color: row.part.color ?? null,
      });
    }
  }
  return [...groups.values()].sort((a, b) => textCmp(a.role, b.role) || textCmp(a.id, b.id));
}

function collectRecords(root = ROOT, reviewItems = null) {
  const review = reviewItems || readJson(PATHS.review, { items: {} }).items || {};
  const manifestDoc = readJson(PATHS.manifest, { parts: [] });
  const databaseDoc = readJson(PATHS.database, { items: [] });
  const archiveDoc = readJson(PATHS.archive, { parts: [] });
  const candidatesDoc = readJson(PATHS.candidateReport, { candidates: [] });
  const atomicByKey = atomicOutputs(root);
  const manifestByKey = new Map();
  for (const row of manifestDoc.parts || []) for (const key of manifestKeys(row)) manifestByKey.set(key, row);
  const removed = new Set([
    ...Object.entries(review).filter(([, item]) => REMOVED_STATUSES.has(item?.status)).map(([key]) => key),
    ...(archiveDoc.parts || []).flatMap(manifestKeys),
  ]);
  const records = [];
  const seen = new Set();
  const add = (database, manifest, candidate = null) => {
    const key = database.key;
    if (!key || seen.has(key) || removed.has(key)) return;
    const method = database.method || manifest?.method || candidate?.method || null;
    const reviewStatus = review[key]?.status || database.status || candidate?.status || null;
    const approved = reviewStatus === 'ok';
    const direct = method === DIRECT_LUNA_METHOD;
    if (!approved && !direct) return;
    const files = modelFiles(root, database.outputDir || candidate?.outputDir);
    const inferred = inferKeyParts(key);
    records.push({
      key, family: database.family || candidate?.family || inferred.family,
      subpart: database.subpart || candidate?.subpart || inferred.subpart,
      method, reviewStatus, approved, direct,
      selection: approved && direct ? 'approved+luna-direct-v6' : approved ? 'approved' : 'luna-direct-v6',
      database, manifest, candidate, model: files.model, features: files.features, metadata: files.metadata,
      outputDir: database.outputDir || candidate?.outputDir || null,
      sourceKind: candidate ? 'candidate' : 'database',
    });
    seen.add(key);
  };
  for (const database of databaseDoc.items || []) add(database, manifestByKey.get(database.key) || null);
  for (const candidate of candidatesDoc.candidates || []) add({
    key: candidate.key, id: candidate.targetId, family: candidate.family, subpart: candidate.subpart,
    method: DIRECT_LUNA_METHOD, version: 6, verStr: 'v6', style: candidate.style,
    bounds: candidate.bounds, outputDir: candidate.outputDir, similarityScore: candidate.similarityReview?.similarityScore,
  }, manifestByKey.get(candidate.key) || null, candidate);
  for (const [key, item] of Object.entries(review)) {
    if (item?.status !== 'ok' || seen.has(key) || removed.has(key)) continue;
    const manifest = manifestByKey.get(key) || null;
    const inferred = inferKeyParts(key);
    const atomic = atomicByKey.get(key);
    add({
      ...(atomic?.metadata || {}), key,
      family: atomic?.metadata?.family || inferred.family,
      subpart: atomic?.metadata?.subpart || inferred.subpart,
      method: atomic?.metadata?.method || manifest?.method,
      version: atomic?.metadata?.version || manifest?.version || 1,
      verStr: atomic?.metadata?.verStr || manifest?.verStr || `v${atomic?.metadata?.version || manifest?.version || 1}`,
      outputDir: atomic?.outputDir || null,
    }, manifest);
  }
  return { records, removed, review, manifestDoc, databaseDoc, candidatesDoc };
}

export function buildCatalogTree(root = ROOT, options = {}) {
  const { records, removed } = collectRecords(root, options.reviewItems || null);
  const bySubcategory = new Map();
  for (const record of records) {
    const id = `${record.family}/${record.subpart}`;
    if (!bySubcategory.has(id)) bySubcategory.set(id, []);
    bySubcategory.get(id).push(record);
  }
  const categories = new Map();
  const objects = {};
  const subcategories = {};
  let structureCount = 0, partGroupCount = 0, paletteCount = 0;
  for (const [subcategoryId, rows] of [...bySubcategory].sort(([a], [b]) => textCmp(a, b))) {
    const [category, subpart] = subcategoryId.split('/');
    const paletteMap = new Map();
    const objectPaletteIds = new Map();
    for (const record of rows) {
      const ids = [];
      for (const palette of paletteRows(record)) {
        const id = `palette_${hashOf(palette.signature, 8)}`;
        if (!paletteMap.has(id)) paletteMap.set(id, { id, name: palette.name, colors: palette.colors, objects: [] });
        const entry = paletteMap.get(id);
        if (!entry.objects.some((row) => row.key === record.key)) entry.objects.push({ key: record.key, source: palette.source });
        ids.push(id);
      }
      objectPaletteIds.set(record.key, [...new Set(ids)]);
    }
    const palettes = [...paletteMap.values()].sort((a, b) => textCmp(a.id, b.id));
    paletteCount += palettes.length;
    const structures = clusterStructures(rows).map((cluster) => {
      const canonical = cluster.canonical;
      const partGroups = accessoryTree(cluster);
      partGroupCount += partGroups.length;
      const structurePath = `${safeName(category)}/${safeName(subpart)}/structures/${cluster.id}`;
      const members = cluster.records.map((member) => {
        const canonicalSize = canonical.record.model?.bounds?.size || canonical.record.database?.bounds?.size || [1, 1, 1];
        const memberSize = member.record.model?.bounds?.size || member.record.database?.bounds?.size || canonicalSize;
        const scale = memberSize.map((value, index) => Number((value / Math.max(canonicalSize[index] || 1, 1e-6)).toFixed(5)));
        objects[member.record.key] = {
          category, subcategory: subpart, subcategoryId, structureId: cluster.id,
          canonicalKey: canonical.record.key, similarity: member.similarity,
          paletteIds: objectPaletteIds.get(member.record.key) || [],
          partGroupIds: partGroups.filter((group) => group.members.some((row) => row.objectKey === member.record.key)).map((group) => group.id),
          path: structurePath,
        };
        return {
          key: member.record.key, selection: member.record.selection, method: member.record.method,
          reviewStatus: member.record.reviewStatus, sourceKind: member.record.sourceKind,
          outputDir: member.record.outputDir, similarity: member.similarity, scale,
          paletteIds: objectPaletteIds.get(member.record.key) || [],
        };
      });
      return {
        id: cluster.id, path: structurePath, canonicalKey: canonical.record.key,
        mainStructure: {
          kind: canonical.split.main.length ? 'declarative-parts' : 'runtime-reference',
          sourceKey: canonical.record.key,
          bounds: canonical.record.model?.bounds || canonical.record.database?.bounds || null,
          parts: canonical.split.main.map((row) => row.part),
        },
        members,
        partGroups,
      };
    });
    structureCount += structures.length;
    const subcategory = {
      id: subcategoryId, category, subpart,
      path: `${safeName(category)}/${safeName(subpart)}`,
      palettePath: `${safeName(category)}/${safeName(subpart)}/palette-list.json`,
      objectCount: rows.length, palettes, structures,
    };
    subcategories[subcategoryId] = subcategory;
    if (!categories.has(category)) categories.set(category, { id: category, path: safeName(category), subcategories: [] });
    categories.get(category).subcategories.push(subcategory);
  }
  return {
    schemaVersion: 1,
    policy: {
      selection: 'review.status === ok OR method === gpt-5.6-luna_visual_direct',
      removedPrecedence: ['archive', 'purge'],
      hierarchy: ['category', 'subcategory', 'main-structure-similarity', 'part-similarity'],
      structureThreshold: 0.145,
      paletteScope: 'one-list-per-subcategory',
    },
    generatedFrom: {
      review: rel(PATHS.review), manifest: rel(PATHS.manifest), database: rel(PATHS.database),
      candidates: rel(PATHS.candidateReport),
    },
    counts: {
      objects: records.length, categories: categories.size, subcategories: bySubcategory.size,
      structures: structureCount, partGroups: partGroupCount, palettes: paletteCount,
      removedExcluded: removed.size,
    },
    categories: [...categories.values()].sort((a, b) => textCmp(a.id, b.id)),
    subcategories,
    objects,
  };
}

export function writeCatalogTree(catalog, root = CATALOG_ROOT) {
  const resolved = path.resolve(root);
  if (!inside(resolved, path.join(ROOT, 'out')) || path.basename(resolved) !== '3d_catalog') {
    throw new Error(`拒絕重建未驗證的型錄目錄：${resolved}`);
  }
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  for (const subcategory of Object.values(catalog.subcategories)) {
    const subDir = path.join(resolved, ...subcategory.path.split('/'));
    atomicJson(path.join(subDir, 'palette-list.json'), {
      schemaVersion: 1, category: subcategory.category, subcategory: subcategory.subpart,
      palettes: subcategory.palettes,
    });
    for (const structure of subcategory.structures) {
      const structureDir = path.join(resolved, ...structure.path.split('/'));
      atomicJson(path.join(structureDir, 'structure.json'), {
        schemaVersion: 1, id: structure.id, canonicalKey: structure.canonicalKey,
        mainStructure: structure.mainStructure, members: structure.members,
      });
      for (const group of structure.partGroups) {
        atomicJson(path.join(structureDir, 'parts', safeName(group.role), group.id, 'index.json'), group);
      }
    }
  }
  atomicJson(path.join(resolved, 'catalog.json'), catalog);
  return resolved;
}

/** 零件台只需目錄與統計；主結構/零件幾何留在 3d_catalog，避免 API 重送整座型錄。 */
export function catalogReviewView(catalog) {
  const subcategories = {};
  for (const [id, subcategory] of Object.entries(catalog.subcategories)) {
    subcategories[id] = {
      id, category: subcategory.category, subpart: subcategory.subpart,
      path: subcategory.path, palettePath: subcategory.palettePath,
      objectCount: subcategory.objectCount, palettes: subcategory.palettes,
      structures: subcategory.structures.map((structure) => ({
        id: structure.id, path: structure.path, canonicalKey: structure.canonicalKey,
        members: structure.members,
        partGroups: structure.partGroups.map((group) => ({
          id: group.id, role: group.role, type: group.type, count: group.members.length,
          objectCount: new Set(group.members.map((row) => row.objectKey)).size,
        })),
      })),
    };
  }
  return {
    schemaVersion: catalog.schemaVersion, policy: catalog.policy, counts: catalog.counts,
    categories: catalog.categories.map((category) => ({
      id: category.id, path: category.path,
      subcategories: category.subcategories.map((subcategory) => subcategory.id),
    })),
    subcategories,
    objects: catalog.objects,
  };
}

/**
 * 將已判 archive/purge 的物件從 DB、manifest、候選報告、原子產物與零件台狀態移除。
 * 來源照片不屬於「3D 物件」；只有 purge 專用管線會刪來源照片。
 */
export function cleanupRemovedObjects(root = ROOT, apply = false) {
  const state = readJson(PATHS.review, { version: 1, items: {} });
  const database = readJson(PATHS.database, { items: [] });
  const manifest = readJson(PATHS.manifest, { version: 1, parts: [] });
  const archive = readJson(PATHS.archive, { version: 1, parts: [] });
  const candidates = readJson(PATHS.candidateReport, null);
  const removed = new Set([
    ...Object.entries(state.items || {}).filter(([, item]) => REMOVED_STATUSES.has(item?.status)).map(([key]) => key),
    ...(archive.parts || []).flatMap(manifestKeys),
  ]);
  const dirs = new Set();
  const previews = new Set();
  for (const row of database.items || []) if (removed.has(row.key) && row.outputDir) dirs.add(path.resolve(root, row.outputDir));
  for (const row of candidates?.candidates || []) {
    if (!removed.has(row.key)) continue;
    if (row.outputDir) dirs.add(path.resolve(root, row.outputDir));
    if (row.preview) previews.add(path.resolve(root, row.preview));
  }
  const previewRoot = path.join(root, 'out', 'review_previews');
  if (fs.existsSync(previewRoot)) {
    const stems = (database.items || []).filter((row) => removed.has(row.key))
      .flatMap((row) => [row.id, path.basename(row.outputDir || ''), safeName(row.key)]).filter(Boolean);
    for (const name of fs.readdirSync(previewRoot)) {
      if (stems.some((stem) => name === `${stem}.png` || name.startsWith(`${stem}_`))) previews.add(path.join(previewRoot, name));
    }
  }
  const allowedRoots = [path.join(root, 'out', '3d_data'), path.join(root, 'out', '3d_data_luna_candidates')];
  for (const dir of dirs) if (!allowedRoots.some((allowed) => inside(dir, allowed))) throw new Error(`拒絕刪除未驗證的產物目錄：${dir}`);
  for (const file of previews) if (!inside(file, previewRoot)) throw new Error(`拒絕刪除未驗證的預覽：${file}`);
  const plan = {
    keys: [...removed].sort(textCmp),
    databaseRows: (database.items || []).filter((row) => removed.has(row.key)).length,
    manifestKeys: (manifest.parts || []).flatMap(manifestKeys).filter((key) => removed.has(key)).length,
    candidateRows: (candidates?.candidates || []).filter((row) => removed.has(row.key)).length,
    directories: [...dirs].filter(fs.existsSync).map(rel).sort(textCmp),
    previews: [...previews].filter(fs.existsSync).map(rel).sort(textCmp),
    stateRows: Object.keys(state.items || {}).filter((key) => removed.has(key)).length,
  };
  if (!apply) return plan;
  for (const dir of dirs) if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  for (const file of previews) if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  database.items = (database.items || []).filter((row) => !removed.has(row.key));
  database.total_objects = database.items.length;
  const nextManifest = [];
  for (const row of manifest.parts || []) {
    const keys = manifestKeys(row).filter((key) => !removed.has(key));
    if (!keys.length) continue;
    if (keys.length !== manifestKeys(row).length) {
      const next = { ...row, keys };
      delete next.key;
      nextManifest.push(next);
    } else nextManifest.push(row);
  }
  manifest.parts = nextManifest;
  for (const key of removed) delete state.items[key];
  archive.parts = (archive.parts || []).filter((row) => !manifestKeys(row).some((key) => removed.has(key)));
  atomicJson(PATHS.database, database);
  atomicJson(PATHS.manifest, manifest);
  atomicJson(PATHS.review, state);
  if (fs.existsSync(PATHS.archive)) atomicJson(PATHS.archive, archive);
  if (candidates) {
    candidates.candidates = (candidates.candidates || []).filter((row) => !removed.has(row.key));
    atomicJson(PATHS.candidateReport, candidates);
  }
  return plan;
}

function printSummary(catalog, cleanup = null) {
  if (cleanup) console.log(`已移除物件：${cleanup.keys.length} 鍵 / ${cleanup.databaseRows} DB / ${cleanup.manifestKeys} manifest / ${cleanup.directories.length} 目錄`);
  console.log(`型錄：${catalog.counts.objects} 物件 / ${catalog.counts.categories} 類別 / ${catalog.counts.subcategories} 子類別`);
  console.log(`共用主結構：${catalog.counts.structures}；非主結構零件群：${catalog.counts.partGroups}；配色：${catalog.counts.palettes}`);
}

function main() {
  const clean = process.argv.includes('--clean-removed');
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  const cleanup = clean ? cleanupRemovedObjects(ROOT, !check) : null;
  const catalog = buildCatalogTree();
  if (check) {
    const current = readJson(CATALOG_PATH, null);
    if (JSON.stringify(current) !== JSON.stringify(catalog)) throw new Error('out/3d_catalog 不是最新決定性輸出');
  } else if (write || clean) writeCatalogTree(catalog);
  printSummary(catalog, cleanup);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
