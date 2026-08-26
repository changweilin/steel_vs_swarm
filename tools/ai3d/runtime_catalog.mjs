import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_FUNCTIONAL_SUBPARTS,
  isNativeFunctionalSubpart,
} from '../../public/js/nativeFunctionalBuildings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

const SOURCE_PATHS = Object.freeze({
  review: 'tools/parts_review/state.json',
  manifest: 'tools/ai3d/parts_manifest.json',
  database: 'out/3d_database.json',
});

const PART_FIELDS = Object.freeze([
  'name', 'type', 'dimensions', 'radii', 'radius', 'height', 'sides', 'tube',
  'position', 'rotation', 'color', 'triangles',
]);
const textCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function manifestKeys(row) {
  if (Array.isArray(row?.keys)) return row.keys.filter((key) => typeof key === 'string');
  return typeof row?.key === 'string' ? [row.key] : [];
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteArray(value) {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function isConifer(record) {
  return record.family === 'tree'
    && (/^cf(?:_|$)/.test(record.subpart || '') || /^tree\/cf(?:_|\/)/.test(record.key || ''));
}

export function runtimeVersionEligible(record) {
  if (record.version === 5 || record.version === 6) return true;
  if (record.version !== 1) return false;
  return record.family === 'rock' || isConifer(record);
}

function primaryImage(manifest, database) {
  const images = Array.isArray(manifest.imgs) ? manifest.imgs : [];
  return images.find((image) => image?.role === 'primary') || images[0] || (database.image ? {
    id: database.image,
    file: database.image,
  } : null);
}

export function canonicalTargetOf(database, manifest) {
  if (database.version === 5 || database.verStr === 'v5') {
    if (!manifest.consumer && !database.key) return null;
    return `${database.family}/${database.subpart}|${database.key}|${manifest.consumer || 'catalog'}`;
  }
  const image = primaryImage(manifest, database);
  const imageId = image?.id || image?.file || database.image;
  if (!imageId || !manifest.consumer) return null;
  return `${database.family}/${database.subpart}|${imageId}|${manifest.consumer}`;
}

function sanitizePart(part) {
  if (!part || typeof part !== 'object' || typeof part.type !== 'string') return null;
  if (!isFiniteArray(part.position) || part.position.length !== 3) return null;
  if (!isFiniteArray(part.rotation) || part.rotation.length !== 3) return null;
  if (!isFiniteNumber(part.color)) return null;

  const clean = {};
  for (const field of PART_FIELDS) {
    if (part[field] === undefined) continue;
    const value = part[field];
    if (Array.isArray(value)) {
      if (!isFiniteArray(value)) return null;
      clean[field] = [...value];
    } else if (typeof value === 'number') {
      if (!isFiniteNumber(value)) return null;
      clean[field] = value;
    } else if (typeof value === 'string') {
      clean[field] = value;
    }
  }
  return clean;
}

function sanitizeSource(image) {
  return {
    id: image?.id || null,
    file: image?.file || null,
    license: image?.license || null,
    creator: image?.creator || null,
    sourceUrl: image?.source_url || null,
  };
}

function sanitizeAsset(database, manifest, review, model, canonicalTarget) {
  if (!Array.isArray(model.parts) || model.parts.length === 0) return null;
  const parts = model.parts.map(sanitizePart);
  if (parts.some((part) => part === null)) return null;

  return {
    key: database.key,
    id: database.id,
    family: database.family,
    subpart: database.subpart,
    version: database.version,
    verStr: database.verStr || `v${database.version}`,
    canonicalTarget,
    style: model.style || database.style || null,
    symmetryMode: model.symmetryMode || database.symmetryMode || null,
    image: database.image || null,
    bounds: model.bounds || database.bounds || null,
    spec: model.spec || database.spec || null,
    triangles: model.bounds?.triangles ?? database.triangles ?? null,
    provenance: {
      method: manifest.method || null,
      consumer: manifest.consumer || null,
      source: sanitizeSource(primaryImage(manifest, database)),
      review: {
        status: review.status,
        at: review.at || null,
        note: review.note || null,
      },
    },
    parts,
  };
}

function exclusion(key, reason, detail = null) {
  return { key, reason, detail };
}

export function buildRuntimeCatalog(root = REPO_ROOT) {
  const reviewDoc = readJson(root, SOURCE_PATHS.review);
  const manifestDoc = readJson(root, SOURCE_PATHS.manifest);
  const databaseDoc = readJson(root, SOURCE_PATHS.database);
  const reviewItems = reviewDoc.items || {};
  const databaseItems = Array.isArray(databaseDoc.items) ? databaseDoc.items : [];
  const manifestItems = Array.isArray(manifestDoc.parts) ? manifestDoc.parts : [];

  const databaseByKey = new Map(databaseItems.map((row) => [row.key, row]));
  const manifestByKey = new Map();
  for (const row of manifestItems) {
    for (const key of manifestKeys(row)) {
      if (!manifestByKey.has(key)) manifestByKey.set(key, []);
      manifestByKey.get(key).push(row);
    }
  }

  const excluded = [];
  for (const [key, review] of Object.entries(reviewItems)) {
    if (review?.status !== 'ok') continue;
    if (!databaseByKey.has(key)) excluded.push(exclusion(key, 'stale-review-no-database'));
  }

  const candidates = [];
  for (const database of databaseItems) {
    const review = reviewItems[database.key];
    if (review?.status !== 'ok') continue;
    if (isNativeFunctionalSubpart(database.family, database.subpart)) {
      excluded.push(exclusion(database.key, 'native-functional-building'));
      continue;
    }
    if (!runtimeVersionEligible(database)) {
      excluded.push(exclusion(database.key, 'version-policy', database.verStr || database.version));
      continue;
    }

    const manifests = manifestByKey.get(database.key) || [];
    if (manifests.length !== 1) {
      excluded.push(exclusion(
        database.key,
        manifests.length === 0 ? 'stale-review-no-manifest' : 'ambiguous-manifest',
        manifests.length,
      ));
      continue;
    }
    const manifest = manifests[0];
    const canonicalTarget = canonicalTargetOf(database, manifest);
    if (!canonicalTarget) {
      excluded.push(exclusion(database.key, 'incomplete-provenance'));
      continue;
    }

    const modelPath = path.join(root, database.outputDir || '', 'model.json');
    if (!database.outputDir || !fs.existsSync(modelPath)) {
      excluded.push(exclusion(database.key, 'missing-model'));
      continue;
    }

    let model;
    try {
      model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    } catch (error) {
      excluded.push(exclusion(database.key, 'invalid-model-json', error.message));
      continue;
    }
    const asset = sanitizeAsset(database, manifest, review, model, canonicalTarget);
    if (!asset) {
      excluded.push(exclusion(database.key, 'invalid-model-parts'));
      continue;
    }
    candidates.push(asset);
  }

  candidates.sort((a, b) => textCmp(a.canonicalTarget, b.canonicalTarget) || textCmp(a.key, b.key));
  const selectedByTarget = new Map();
  for (const candidate of candidates) {
    const current = selectedByTarget.get(candidate.canonicalTarget);
    if (!current) {
      selectedByTarget.set(candidate.canonicalTarget, candidate);
      continue;
    }
    if (candidate.version === current.version) {
      throw new Error(`同版本 canonical target 重複：${candidate.canonicalTarget}`);
    }
    const rank = (version) => version === 6 ? 3 : version === 5 ? 2 : 1;
    const winner = rank(candidate.version) > rank(current.version) ? candidate : current;
    const loser = winner === candidate ? current : candidate;
    selectedByTarget.set(candidate.canonicalTarget, winner);
    excluded.push(exclusion(loser.key, winner.version === 6 ? 'superseded-by-v6' : 'superseded-by-production', winner.key));
  }

  const selected = [...selectedByTarget.values()].sort((a, b) => textCmp(a.key, b.key));
  const families = {};
  for (const asset of selected) {
    if (!families[asset.family]) families[asset.family] = [];
    families[asset.family].push(asset);
  }

  excluded.sort((a, b) => textCmp(a.key, b.key) || textCmp(a.reason, b.reason));
  const counts = Object.fromEntries(Object.entries(families).map(([family, rows]) => [family, rows.length]));
  const versions = {};
  for (const asset of selected) versions[asset.verStr] = (versions[asset.verStr] || 0) + 1;

  return {
    schemaVersion: 1,
    policy: {
      acceptedVerdict: 'ok',
      productionVersions: ['v5', 'v6'],
      duplicatePreference: 'v6',
      legacyV1Families: ['rock', 'tree:conifer'],
      nativeFunctionalBuildings: [...NATIVE_FUNCTIONAL_SUBPARTS],
    },
    generatedFrom: { ...SOURCE_PATHS },
    counts,
    versions,
    families,
    excluded,
  };
}
