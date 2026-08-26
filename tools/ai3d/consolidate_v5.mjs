import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const dbPath = path.resolve(ROOT, 'out/3d_database.json');
const manifestPath = path.resolve(ROOT, 'tools/ai3d/parts_manifest.json');
const statePath = path.resolve(ROOT, 'tools/parts_review/state.json');

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

const okKeys = new Set(Object.entries(state.items).filter(([k, v]) => v.status === 'ok').map(([k]) => k));

const v5DbItems = db.items.filter((i) => i.version === 5);
const v6DbItems = db.items.filter((i) => i.version === 6);
const otherDbItems = db.items.filter((i) => i.version !== 5 && i.version !== 6);

// Group v5 by family/subpart/style
const v5Groups = new Map();
for (const item of v5DbItems) {
  const gk = `${item.family}/${item.subpart}/${item.style}`;
  if (!v5Groups.has(gk)) v5Groups.set(gk, []);
  v5Groups.get(gk).push(item);
}

console.log(`Found ${v5DbItems.length} v5 items across ${v5Groups.size} archetype groups.`);

const consolidatedV5DbItems = [];
const consolidatedKeys = new Set();
let totalPalettes = 0;

for (const [gk, items] of v5Groups.entries()) {
  // Find canonical item (prefer item with 'ok' status)
  const canonical = items.find((i) => okKeys.has(i.key)) || items[0];

  // Collect all unique palettes from items
  const paletteMap = new Map();
  for (const it of items) {
    const featPath = path.resolve(ROOT, it.outputDir, 'features.json');
    if (fs.existsSync(featPath)) {
      try {
        const feat = JSON.parse(fs.readFileSync(featPath, 'utf8'));
        const cols = feat.colors || {};
        if (cols.facadeHex) {
          const sig = [cols.roofHex, cols.facadeHex, cols.baseHex, cols.accentHex, cols.darkHex, cols.brightHex, cols.glassHex].join('_');
          if (!paletteMap.has(sig)) {
            paletteMap.set(sig, {
              id: `pal_${paletteMap.size}`,
              name: `Palette ${paletteMap.size + 1}`,
              colors: {
                roofHex: cols.roofHex || cols.facadeHex,
                facadeHex: cols.facadeHex,
                baseHex: cols.baseHex || cols.facadeHex,
                accentHex: cols.accentHex || cols.facadeHex,
                darkHex: cols.darkHex || 0x2c3e50,
                brightHex: cols.brightHex || 0xecf0f1,
                glassHex: cols.glassHex || 0x1e293b,
              },
            });
          }
        }
      } catch (e) {}
    }
  }

  const palettes = [...paletteMap.values()];
  totalPalettes += palettes.length;

  // Update canonical model.json with colorKey and palettes
  const modelPath = path.resolve(ROOT, canonical.outputDir, 'model.json');
  const featPath = path.resolve(ROOT, canonical.outputDir, 'features.json');
  const metaPath = path.resolve(ROOT, canonical.outputDir, 'metadata.json');

  if (fs.existsSync(modelPath) && fs.existsSync(featPath)) {
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    const feat = JSON.parse(fs.readFileSync(featPath, 'utf8'));
    const cols = feat.colors || (palettes[0]?.colors) || {};

    // Assign colorKey to all parts
    for (const p of model.parts || []) {
      if (p.color === cols.roofHex) p.colorKey = 'roof';
      else if (p.color === cols.facadeHex) p.colorKey = 'facade';
      else if (p.color === cols.baseHex) p.colorKey = 'base';
      else if (p.color === cols.accentHex) p.colorKey = 'accent';
      else if (p.color === cols.darkHex) p.colorKey = 'dark';
      else if (p.color === cols.brightHex) p.colorKey = 'bright';
      else if (p.color === cols.glassHex) p.colorKey = 'glass';
      else {
        const name = (p.name || '').toLowerCase();
        if (/roof|eave|spire|dome|canopy|needle|foliage/.test(name)) p.colorKey = 'roof';
        else if (/base|plinth|foundation|stylobate|trunk|stem|ground/.test(name)) p.colorKey = 'base';
        else if (/glass|window|glaze|windscreen|light_chamber/.test(name)) p.colorKey = 'glass';
        else if (/accent|wheel|tire|rim|column|pillar|door|wing|sail|sign/.test(name)) p.colorKey = 'accent';
        else if (/dark|frame|strut|chassis|exhaust|shadow/.test(name)) p.colorKey = 'dark';
        else if (/bright|lamp|light|cap|finial|chrome/.test(name)) p.colorKey = 'bright';
        else p.colorKey = 'facade';
      }
    }

    model.palettes = palettes;
    fs.writeFileSync(modelPath, JSON.stringify(model, null, 2), 'utf8');

    feat.palettes = palettes;
    fs.writeFileSync(featPath, JSON.stringify(feat, null, 2), 'utf8');

    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta.palettes = palettes;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    }
  }

  canonical.palettes = palettes;
  consolidatedV5DbItems.push(canonical);
  consolidatedKeys.add(canonical.key);
}

// 3. Update out/3d_database.json
db.items = [...consolidatedV5DbItems, ...v6DbItems, ...otherDbItems];
db.total_objects = db.items.length;
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log(`Updated out/3d_database.json: total items = ${db.items.length} (v5 = ${consolidatedV5DbItems.length}, v6 = ${v6DbItems.length})`);
console.log(`Total unique palettes collected across v5 archetypes: ${totalPalettes}`);

// 4. Update tools/ai3d/parts_manifest.json
const v5ManifestMap = new Map();
const nonV5Manifest = [];

for (const p of manifest.parts) {
  if (p.version === 5 || p.verStr === 'v5') {
    const keys = p.keys || (p.key ? [p.key] : []);
    const matchingCanonicalKey = keys.find((k) => consolidatedKeys.has(k));
    if (matchingCanonicalKey) {
      const matchingDbItem = consolidatedV5DbItems.find((i) => i.key === matchingCanonicalKey);
      p.keys = [matchingCanonicalKey];
      if (matchingDbItem?.palettes) {
        p.palettes = matchingDbItem.palettes;
      }
      p.imgs = [];
      v5ManifestMap.set(matchingCanonicalKey, p);
    }
  } else {
    nonV5Manifest.push(p);
  }
}

// Ensure every consolidated v5 item has a manifest entry
for (const item of consolidatedV5DbItems) {
  if (!v5ManifestMap.has(item.key)) {
    v5ManifestMap.set(item.key, {
      method: 'llm_parts',
      version: 5,
      verStr: 'v5',
      consumer: `${item.family} catalog & partlib (${item.subpart})`,
      rev: 'HEAD',
      at: new Date().toISOString().slice(0, 10),
      imgs: [],
      palettes: item.palettes || [],
      gen: {
        tool: 'Direct Declarative Polyhedral Synthesis Engine v5.0',
        runner: 'tools/ai3d/direct_ingest_all.mjs',
        params: `--family ${item.family} --subpart ${item.subpart} --style ${item.style}`,
        machine: 'Node.js Native Multi-Polyhedral 3D Engine',
        measured: `Triangles ${item.bounds?.triangles || 0}`,
      },
      post: {
        tool: 'tools/ai3d/direct_ingest_all.mjs',
        fit: 1.0,
        bounds: item.bounds?.size || [1, 1, 1],
      },
      keys: [item.key],
    });
  }
}

manifest.parts = [...v5ManifestMap.values(), ...nonV5Manifest];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Updated tools/ai3d/parts_manifest.json: total parts = ${manifest.parts.length} (v5 = ${v5ManifestMap.size})`);
