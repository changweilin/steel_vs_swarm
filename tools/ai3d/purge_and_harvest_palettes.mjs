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

const okKeys = new Set(
  Object.entries(state.items)
    .filter(([, v]) => v.status === 'ok')
    .map(([k]) => k)
);

// 1. Collect all building color palettes from the whole out/3d_data/ directory
const hexToRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const colorDist = (h1, h2) => {
  const [r1, g1, b1] = hexToRgb(h1);
  const [r2, g2, b2] = hexToRgb(h2);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};
const paletteDist = (p1, p2) => {
  const c1 = p1.colors;
  const c2 = p2.colors;
  const df = colorDist(c1.facadeHex, c2.facadeHex);
  const dr = colorDist(c1.roofHex || c1.facadeHex, c2.roofHex || c2.facadeHex);
  const db = colorDist(c1.baseHex || c1.facadeHex, c2.baseHex || c2.facadeHex);
  const da = colorDist(c1.accentHex || c1.facadeHex, c2.accentHex || c2.facadeHex);
  return 0.4 * df + 0.3 * dr + 0.15 * db + 0.15 * da;
};

function mergeSimilarPalettes(palettes, threshold = 35) {
  const clusters = [];
  for (const pal of palettes) {
    let merged = false;
    for (const cluster of clusters) {
      if (paletteDist(cluster.rep, pal) < threshold) {
        cluster.members.push(pal);
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ rep: pal, members: [pal] });
    }
  }
  return clusters.map((c, i) => ({
    id: `pal_${i}`,
    name: `Palette ${i + 1}`,
    variantCount: c.members.length,
    colors: {
      roofHex: c.rep.colors.roofHex || c.rep.colors.facadeHex,
      facadeHex: c.rep.colors.facadeHex,
      baseHex: c.rep.colors.baseHex || c.rep.colors.facadeHex,
      accentHex: c.rep.colors.accentHex || c.rep.colors.facadeHex,
      darkHex: c.rep.colors.darkHex || 0x2c3e50,
      brightHex: c.rep.colors.brightHex || 0xecf0f1,
      glassHex: c.rep.colors.glassHex || 0x1e293b,
    },
  }));
}

// Harvest all building palettes
const allHarvestedPalettes = [];
function harvestDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const featPath = path.join(full, 'features.json');
      if (fs.existsSync(featPath)) {
        try {
          const feat = JSON.parse(fs.readFileSync(featPath, 'utf8'));
          const cols = feat.colors || {};
          if (cols.facadeHex) {
            allHarvestedPalettes.push({
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
          if (Array.isArray(feat.palettes)) {
            for (const p of feat.palettes) {
              if (p.colors?.facadeHex) {
                allHarvestedPalettes.push({ colors: p.colors });
              }
            }
          }
        } catch (e) {}
      }
      harvestDir(full);
    }
  }
}

harvestDir(path.resolve(ROOT, 'out/3d_data/building'));
console.log(`Harvested ${allHarvestedPalettes.length} raw building color schemes from building data.`);

// 2. Separate approved v5 items vs unapproved v5 items
const approvedV5Items = [];
const unapprovedV5Items = [];

for (const item of db.items) {
  if (item.version === 5) {
    if (okKeys.has(item.key)) {
      approvedV5Items.push(item);
    } else {
      unapprovedV5Items.push(item);
    }
  }
}

console.log(`Approved v5 items (retained): ${approvedV5Items.length}`);
console.log(`Unapproved v5 items (to purge): ${unapprovedV5Items.length}`);

// Delete unapproved v5 directories from out/3d_data/
for (const item of unapprovedV5Items) {
  const itemDir = path.resolve(ROOT, item.outputDir);
  if (fs.existsSync(itemDir)) {
    try {
      fs.rmSync(itemDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`Failed to delete dir: ${itemDir}`, e.message);
    }
  }
}

// 3. Cluster and merge building palettes
const globalMergedPalettes = mergeSimilarPalettes(allHarvestedPalettes, 35);
console.log(`Clustered and merged into ${globalMergedPalettes.length} distinct building palettes.`);

// 4. Update the 13 approved v5 building models with rich merged palettes and colorKey
const approvedKeys = new Set(approvedV5Items.map((i) => i.key));

for (const item of approvedV5Items) {
  const itemPalettes = Array.isArray(item.palettes) && item.palettes.length ? item.palettes : [];
  // Combine item's own palettes with global building palettes
  const combined = [...itemPalettes, ...globalMergedPalettes];
  const distinctPalettes = mergeSimilarPalettes(combined, 32);

  item.palettes = distinctPalettes;

  const modelPath = path.resolve(ROOT, item.outputDir, 'model.json');
  const featPath = path.resolve(ROOT, item.outputDir, 'features.json');
  const metaPath = path.resolve(ROOT, item.outputDir, 'metadata.json');

  if (fs.existsSync(modelPath) && fs.existsSync(featPath)) {
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    const feat = JSON.parse(fs.readFileSync(featPath, 'utf8'));
    const cols = feat.colors || distinctPalettes[0]?.colors || {};

    // Ensure colorKey on every part
    for (const p of model.parts || []) {
      if (p.color === cols.roofHex) p.colorKey = 'roof';
      else if (p.color === cols.facadeHex) p.colorKey = 'facade';
      else if (p.color === cols.baseHex) p.colorKey = 'base';
      else if (p.color === cols.accentHex) p.colorKey = 'accent';
      else if (p.color === cols.darkHex) p.colorKey = 'dark';
      else if (p.color === cols.brightHex) p.colorKey = 'bright';
      else if (p.color === cols.glassHex) p.colorKey = 'glass';
      else if (!p.colorKey) {
        const name = (p.name || '').toLowerCase();
        if (/roof|eave|spire|dome|canopy/.test(name)) p.colorKey = 'roof';
        else if (/base|plinth|foundation|stylobate|trunk/.test(name)) p.colorKey = 'base';
        else if (/glass|window|glaze|windscreen/.test(name)) p.colorKey = 'glass';
        else if (/accent|wheel|tire|rim|column|pillar|door/.test(name)) p.colorKey = 'accent';
        else if (/dark|frame|strut|chassis/.test(name)) p.colorKey = 'dark';
        else if (/bright|lamp|light|cap/.test(name)) p.colorKey = 'bright';
        else p.colorKey = 'facade';
      }
    }

    model.palettes = distinctPalettes;
    fs.writeFileSync(modelPath, JSON.stringify(model, null, 2), 'utf8');

    feat.palettes = distinctPalettes;
    fs.writeFileSync(featPath, JSON.stringify(feat, null, 2), 'utf8');

    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta.palettes = distinctPalettes;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    }
  }
}

// 5. Update out/3d_database.json (only approved v5 + all non-v5)
const nonV5DbItems = db.items.filter((i) => i.version !== 5);
db.items = [...approvedV5Items, ...nonV5DbItems];
db.total_objects = db.items.length;
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log(`Updated out/3d_database.json: ${db.items.length} total items (v5 = ${approvedV5Items.length}, v6 = ${nonV5DbItems.length})`);

// 6. Update tools/ai3d/parts_manifest.json
const updatedManifestParts = [];
for (const p of manifest.parts) {
  if (p.version === 5 || p.verStr === 'v5') {
    const keys = p.keys || (p.key ? [p.key] : []);
    const matchingKey = keys.find((k) => approvedKeys.has(k));
    if (matchingKey) {
      const dbItem = approvedV5Items.find((i) => i.key === matchingKey);
      p.keys = [matchingKey];
      p.imgs = [];
      p.palettes = dbItem?.palettes || [];
      updatedManifestParts.push(p);
    }
  } else {
    updatedManifestParts.push(p);
  }
}

manifest.parts = updatedManifestParts;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Updated tools/ai3d/parts_manifest.json: ${manifest.parts.length} total parts (v5 = ${approvedV5Items.length})`);
