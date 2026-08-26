import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const dbPath = path.resolve(ROOT, 'out/3d_database.json');
const manifestPath = path.resolve(ROOT, 'tools/ai3d/parts_manifest.json');

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 1. Color utilities & palette clustering
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

// 2. Comprehensive Rock Palettes Pool
const rawRockPalettes = [
  { colors: { facadeHex: 0x7f8c8d, roofHex: 0x95a5a6, baseHex: 0x566573, accentHex: 0x34495e, darkHex: 0x2c3e50, brightHex: 0xbdc3c7, glassHex: 0x1e293b } }, // Granite Slate
  { colors: { facadeHex: 0x2c3e50, roofHex: 0x34495e, baseHex: 0x1a252f, accentHex: 0x415b76, darkHex: 0x17202a, brightHex: 0x5d6d7e, glassHex: 0x1e293b } }, // Dark Basalt
  { colors: { facadeHex: 0xb9770e, roofHex: 0xd68910, baseHex: 0x7e5109, accentHex: 0xf39c12, darkHex: 0x563805, brightHex: 0xf8c471, glassHex: 0x1e293b } }, // Red Sandstone
  { colors: { facadeHex: 0x5d6d7e, roofHex: 0x58d68d, baseHex: 0x34495e, accentHex: 0x27ae60, darkHex: 0x212f3d, brightHex: 0xa9dfbf, glassHex: 0x1e293b } }, // Mossy Granite
  { colors: { facadeHex: 0xecf0f1, roofHex: 0xd5dbdb, baseHex: 0xa6acaf, accentHex: 0xfdfefe, darkHex: 0x7f8c8d, brightHex: 0xffffff, glassHex: 0x1e293b } }, // White Marble/Limestone
  { colors: { facadeHex: 0x6e2c00, roofHex: 0x873600, baseHex: 0x4e2000, accentHex: 0xa04000, darkHex: 0x3e1800, brightHex: 0xba4a00, glassHex: 0x1e293b } }, // Canyon Ochre
  { colors: { facadeHex: 0x515a5a, roofHex: 0x707b7c, baseHex: 0x343a40, accentHex: 0x99a3a4, darkHex: 0x212529, brightHex: 0xd0d3d4, glassHex: 0x1e293b } }, // Alpine Shale
  { colors: { facadeHex: 0x85929e, roofHex: 0xaeb6bf, baseHex: 0x5d6d7e, accentHex: 0xd5d8dc, darkHex: 0x34495e, brightHex: 0xeaecee, glassHex: 0x1e293b } }, // Glacial Erratic
  { colors: { facadeHex: 0x784212, roofHex: 0x935116, baseHex: 0x512e0c, accentHex: 0xaf601a, darkHex: 0x3d2309, brightHex: 0xca6f1e, glassHex: 0x1e293b } }, // Desert Mesa
  { colors: { facadeHex: 0x424949, roofHex: 0x515a5a, baseHex: 0x2b3030, accentHex: 0x707b7c, darkHex: 0x1b1e1e, brightHex: 0x99a3a4, glassHex: 0x1e293b } }, // Volcanic Obsidian
];
const mergedRockPalettes = mergeSimilarPalettes(rawRockPalettes, 30);

// 3. Comprehensive Conifer Palettes Pool
const rawConiferPalettes = [
  { colors: { roofHex: 0x1e4d2b, facadeHex: 0x276738, baseHex: 0x4e342e, accentHex: 0x2e7d32, darkHex: 0x3e2723, brightHex: 0x4caf50, glassHex: 0x1e293b } }, // Deep Alpine Pine
  { colors: { roofHex: 0x1b4f4f, facadeHex: 0x236b6b, baseHex: 0x3e2723, accentHex: 0x2e8b8b, darkHex: 0x261916, brightHex: 0x48c9b0, glassHex: 0x1e293b } }, // Blue Spruce
  { colors: { roofHex: 0x145a32, facadeHex: 0x1e8449, baseHex: 0x5d4037, accentHex: 0x27ae60, darkHex: 0x4e342e, brightHex: 0x52be80, glassHex: 0x1e293b } }, // Emerald Fir
  { colors: { roofHex: 0x7d6608, facadeHex: 0x9a7d0a, baseHex: 0x4e342e, accentHex: 0xb7950b, darkHex: 0x3e2723, brightHex: 0xf1c40f, glassHex: 0x1e293b } }, // Autumn Larch Gold
  { colors: { roofHex: 0x2c3e50, facadeHex: 0x1a5276, baseHex: 0x3e2723, accentHex: 0x2980b9, darkHex: 0x1b2631, brightHex: 0x5dade2, glassHex: 0x1e293b } }, // Frost Conifer
  { colors: { roofHex: 0x3d5634, facadeHex: 0x4c6b41, baseHex: 0x553c2b, accentHex: 0x5c824f, darkHex: 0x3d2b1f, brightHex: 0x7a9a6b, glassHex: 0x1e293b } }, // Cypress Olive
  { colors: { roofHex: 0x0e3a1f, facadeHex: 0x14522c, baseHex: 0x442c1d, accentHex: 0x1c6e3b, darkHex: 0x2e1e14, brightHex: 0x2eb85c, glassHex: 0x1e293b } }, // Taiga Forest Green
];
const mergedConiferPalettes = mergeSimilarPalettes(rawConiferPalettes, 30);

// 4. Declarative 3D Builders for Rocks and Conifers
function buildRockGeometry(subpart, style) {
  const parts = [];
  const dim = { L: 6.0, W: 6.0, H: 4.8 };

  if (style === 'columnar_hexagonal_basalt') {
    const numCols = 8;
    for (let p = 0; p < numCols; p++) {
      const pAng = (p / numCols) * Math.PI * 2;
      const pDist = p === 0 ? 0 : dim.W * 0.35;
      const px = Math.cos(pAng) * pDist;
      const pz = Math.sin(pAng) * pDist;
      const ph = dim.H * (0.45 + ((p * 7 + 3) % 7) * 0.09);
      parts.push({
        name: `basalt_hex_column_${p + 1}`,
        type: 'polygonal_prism',
        sides: 6,
        radius: 0.95,
        height: ph,
        position: [px, ph / 2, pz],
        rotation: [0, pAng, 0],
        color: 0x2c3e50,
        colorKey: 'base',
        triangles: 24,
      });
      parts.push({
        name: `basalt_joint_facet_${p + 1}`,
        type: 'frustum_pyramid',
        sides: 6,
        radii: [0.85, 0.95],
        height: 0.35,
        position: [px, ph + 0.175, pz],
        rotation: [0, pAng, 0],
        color: 0x7f8c8d,
        colorKey: 'facade',
        triangles: 24,
      });
    }
  } else if (style === 'natural_monolithic_arch') {
    parts.push({
      name: 'arch_left_buttress',
      type: 'dodecahedron_polyhedron',
      radius: 2.2,
      position: [-dim.L * 0.35, 2.2, 0],
      rotation: [0.1, 0.2, 0],
      color: 0x566573,
      colorKey: 'base',
      triangles: 36,
    });
    parts.push({
      name: 'arch_right_buttress',
      type: 'dodecahedron_polyhedron',
      radius: 2.2,
      position: [dim.L * 0.35, 2.2, 0],
      rotation: [-0.1, 0.4, 0],
      color: 0x566573,
      colorKey: 'base',
      triangles: 36,
    });
    parts.push({
      name: 'natural_rock_arch_span',
      type: 'torus_ring',
      radius: dim.L * 0.38,
      tube: 1.15,
      position: [0, 2.4, 0],
      rotation: [Math.PI / 2, 0, 0],
      color: 0x7f8c8d,
      colorKey: 'facade',
      triangles: 144,
    });
  } else {
    // faceted erratic boulder
    parts.push({
      name: 'erratic_boulder_core',
      type: 'dodecahedron_polyhedron',
      radius: dim.H * 0.58,
      position: [0, dim.H * 0.48, 0],
      rotation: [0.15, 0.32, -0.1],
      color: 0x7f8c8d,
      colorKey: 'facade',
      triangles: 36,
    });
    parts.push({
      name: 'talus_scree_facet_1',
      type: 'frustum_pyramid',
      sides: 6,
      radii: [dim.L * 0.35, dim.L * 0.55],
      height: dim.H * 0.38,
      position: [dim.L * 0.25, dim.H * 0.19, -dim.W * 0.25],
      rotation: [0.2, -0.4, 0.15],
      color: 0x566573,
      colorKey: 'base',
      triangles: 24,
    });
    parts.push({
      name: 'talus_scree_facet_2',
      type: 'frustum_pyramid',
      sides: 5,
      radii: [dim.L * 0.28, dim.L * 0.45],
      height: dim.H * 0.32,
      position: [-dim.L * 0.28, dim.H * 0.16, dim.W * 0.28],
      rotation: [-0.2, 0.5, -0.1],
      color: 0x95a5a6,
      colorKey: 'roof',
      triangles: 20,
    });
  }

  const totalTris = parts.reduce((sum, p) => sum + (p.triangles || 12), 0);
  const bounds = {
    min: [-dim.L / 2, 0, -dim.W / 2],
    max: [dim.L / 2, dim.H, dim.W / 2],
    size: [dim.L, dim.H, dim.W],
    rMax: Math.hypot(dim.L / 2, dim.W / 2),
    triangles: totalTris,
    vertices: totalTris * 3,
  };

  return { parts, bounds, spec: { style, L: dim.L, W: dim.W, H: dim.H } };
}

function buildConiferGeometry(subpart, style) {
  const parts = [];
  const dim = { L: 7.5, W: 7.5, H: 18.0 };

  if (style === 'shrub_bush_mound') {
    const numClumps = 6;
    for (let c = 0; c < numClumps; c++) {
      const th = (c / numClumps) * Math.PI * 2;
      const dist = 1.6;
      const cx = Math.cos(th) * dist;
      const cz = Math.sin(th) * dist;
      const cr = 1.4;
      parts.push({
        name: `shrub_foliage_mound_${c + 1}`,
        type: 'dodecahedron_polyhedron',
        radius: cr,
        position: [cx, cr * 0.85, cz],
        rotation: [0, th, 0],
        color: 0x1e4d2b,
        colorKey: 'roof',
        triangles: 36,
      });
    }
  } else {
    // 6-tier conical needle whorls
    const trunkH = dim.H * 0.35;
    parts.push({
      name: 'pine_tapered_trunk',
      type: 'conical_frustum',
      sides: 8,
      radii: [0.22, 0.48],
      height: trunkH,
      position: [0, trunkH / 2, 0],
      rotation: [0, 0, 0],
      color: 0x4e342e,
      colorKey: 'base',
      triangles: 32,
    });

    const numTiers = 6;
    const crownH = dim.H - trunkH * 0.65;
    for (let t = 0; t < numTiers; t++) {
      const y = trunkH * 0.65 + (t / numTiers) * crownH + (crownH / numTiers) * 0.5;
      const scale = 1.0 - (t / numTiers) * 0.78;
      const rBot = (dim.W / 2) * scale;
      const tH = (crownH / numTiers) * 1.45;
      parts.push({
        name: `pine_canopy_tier_${t + 1}`,
        type: 'cone',
        sides: 8,
        radius: rBot,
        height: tH,
        position: [0, y, 0],
        rotation: [0, (t * Math.PI) / 6, 0],
        color: 0x1e4d2b,
        colorKey: 'roof',
        triangles: 16,
      });
    }
  }

  const totalTris = parts.reduce((sum, p) => sum + (p.triangles || 12), 0);
  const bounds = {
    min: [-dim.W / 2, 0, -dim.L / 2],
    max: [dim.W / 2, dim.H, dim.L / 2],
    size: [dim.W, dim.H, dim.L],
    rMax: Math.hypot(dim.W / 2, dim.L / 2),
    triangles: totalTris,
    vertices: totalTris * 3,
  };

  return { parts, bounds, spec: { style, L: dim.L, W: dim.W, H: dim.H } };
}

// 5. Archetype definitions
const rockArchetypes = [
  { subpart: 'main', style: 'faceted_erratic_boulder' },
  { subpart: 'facet', style: 'faceted_erratic_boulder' },
  { subpart: 'collapse', style: 'faceted_erratic_boulder' },
  { subpart: 'hoodoo', style: 'faceted_erratic_boulder' },
  { subpart: 'strata', style: 'faceted_erratic_boulder' },
  { subpart: 'talus', style: 'faceted_erratic_boulder' },
  { subpart: 'tor', style: 'faceted_erratic_boulder' },
  { subpart: 'st_dolmen', style: 'faceted_erratic_boulder' },
  { subpart: 'mg_arch', style: 'natural_monolithic_arch' },
  { subpart: 'mg_basalt', style: 'columnar_hexagonal_basalt' },
  { subpart: 'mg_dome', style: 'faceted_erratic_boulder' },
  { subpart: 'mg_marble', style: 'faceted_erratic_boulder' },
  { subpart: 'mg_mesa', style: 'faceted_erratic_boulder' },
  { subpart: 'mg_slab', style: 'faceted_erratic_boulder' },
  { subpart: 'mg_tower', style: 'faceted_erratic_boulder' },
];

const coniferArchetypes = [
  { subpart: 'conifer', style: 'conifer_pine_spire' },
  { subpart: 'sp_conifer', style: 'conifer_pine_spire' },
  { subpart: 'cf_araucaria', style: 'conifer_pine_spire' },
  { subpart: 'cf_juniper_tree', style: 'shrub_bush_mound' },
  { subpart: 'gt_cryptomeria', style: 'conifer_pine_spire' },
  { subpart: 'sp_cypress', style: 'conifer_pine_spire' },
];

const newV5Items = [];
const newManifestParts = [];

// Build Rock Archetypes
for (const arch of rockArchetypes) {
  const stem = `v5_${arch.subpart}_master`;
  const key = `rock/${arch.subpart}_${stem}`;
  const outDir = `out/3d_data/rock/${arch.subpart}/rock_${arch.subpart}_${stem}`;
  const fullOutDir = path.resolve(ROOT, outDir);
  if (!fs.existsSync(fullOutDir)) fs.mkdirSync(fullOutDir, { recursive: true });

  const { parts, bounds, spec } = buildRockGeometry(arch.subpart, arch.style);

  const modelJson = {
    id: `rock_${arch.subpart}_${stem}`,
    family: 'rock',
    subpart: arch.subpart,
    style: arch.style,
    symmetryMode: 'organic',
    spec,
    bounds,
    palettes: mergedRockPalettes,
    parts,
  };
  fs.writeFileSync(path.join(fullOutDir, 'model.json'), JSON.stringify(modelJson, null, 2), 'utf8');

  const featuresJson = {
    id: `rock_${arch.subpart}_${stem}`,
    sourceImage: null,
    style: arch.style,
    symmetryMode: 'organic',
    colors: mergedRockPalettes[0].colors,
    palettes: mergedRockPalettes,
    totalParts: parts.length,
    partNames: parts.map((p) => p.name),
  };
  fs.writeFileSync(path.join(fullOutDir, 'features.json'), JSON.stringify(featuresJson, null, 2), 'utf8');

  const metadataJson = {
    id: `rock_${arch.subpart}_${stem}`,
    family: 'rock',
    subpart: arch.subpart,
    style: arch.style,
    version: 5,
    method: 'declarative_polyhedral_geometry',
    palettes: mergedRockPalettes,
  };
  fs.writeFileSync(path.join(fullOutDir, 'metadata.json'), JSON.stringify(metadataJson, null, 2), 'utf8');

  const dbItem = {
    id: `rock_${arch.subpart}_${stem}`,
    key,
    family: 'rock',
    subpart: arch.subpart,
    style: arch.style,
    version: 5,
    verStr: 'v5',
    outputDir: outDir,
    modelPath: path.join(outDir, 'model.json').replace(/\\/g, '/'),
    bounds,
    palettes: mergedRockPalettes,
  };
  newV5Items.push(dbItem);

  newManifestParts.push({
    method: 'llm_parts',
    version: 5,
    verStr: 'v5',
    consumer: `rock catalog & partlib (${arch.subpart})`,
    rev: 'HEAD',
    at: new Date().toISOString().slice(0, 10),
    imgs: [],
    palettes: mergedRockPalettes,
    gen: {
      tool: 'Direct Declarative Polyhedral Synthesis Engine v5.0',
      runner: 'tools/ai3d/direct_ingest_all.mjs',
      params: `--family rock --subpart ${arch.subpart} --style ${arch.style}`,
      machine: 'Node.js Native Multi-Polyhedral 3D Engine',
      measured: `Triangles ${bounds.triangles}`,
    },
    post: {
      tool: 'tools/ai3d/direct_ingest_all.mjs',
      fit: 1.0,
      bounds: bounds.size,
    },
    keys: [key],
  });
}

// Build Conifer Archetypes
for (const arch of coniferArchetypes) {
  const stem = `v5_${arch.subpart}_master`;
  const key = `tree/${arch.subpart}_${stem}`;
  const outDir = `out/3d_data/tree/${arch.subpart}/tree_${arch.subpart}_${stem}`;
  const fullOutDir = path.resolve(ROOT, outDir);
  if (!fs.existsSync(fullOutDir)) fs.mkdirSync(fullOutDir, { recursive: true });

  const { parts, bounds, spec } = buildConiferGeometry(arch.subpart, arch.style);

  const modelJson = {
    id: `tree_${arch.subpart}_${stem}`,
    family: 'tree',
    subpart: arch.subpart,
    style: arch.style,
    symmetryMode: 'radial',
    spec,
    bounds,
    palettes: mergedConiferPalettes,
    parts,
  };
  fs.writeFileSync(path.join(fullOutDir, 'model.json'), JSON.stringify(modelJson, null, 2), 'utf8');

  const featuresJson = {
    id: `tree_${arch.subpart}_${stem}`,
    sourceImage: null,
    style: arch.style,
    symmetryMode: 'radial',
    colors: mergedConiferPalettes[0].colors,
    palettes: mergedConiferPalettes,
    totalParts: parts.length,
    partNames: parts.map((p) => p.name),
  };
  fs.writeFileSync(path.join(fullOutDir, 'features.json'), JSON.stringify(featuresJson, null, 2), 'utf8');

  const metadataJson = {
    id: `tree_${arch.subpart}_${stem}`,
    family: 'tree',
    subpart: arch.subpart,
    style: arch.style,
    version: 5,
    method: 'declarative_polyhedral_geometry',
    palettes: mergedConiferPalettes,
  };
  fs.writeFileSync(path.join(fullOutDir, 'metadata.json'), JSON.stringify(metadataJson, null, 2), 'utf8');

  const dbItem = {
    id: `tree_${arch.subpart}_${stem}`,
    key,
    family: 'tree',
    subpart: arch.subpart,
    style: arch.style,
    version: 5,
    verStr: 'v5',
    outputDir: outDir,
    modelPath: path.join(outDir, 'model.json').replace(/\\/g, '/'),
    bounds,
    palettes: mergedConiferPalettes,
  };
  newV5Items.push(dbItem);

  newManifestParts.push({
    method: 'llm_parts',
    version: 5,
    verStr: 'v5',
    consumer: `tree catalog & partlib (${arch.subpart})`,
    rev: 'HEAD',
    at: new Date().toISOString().slice(0, 10),
    imgs: [],
    palettes: mergedConiferPalettes,
    gen: {
      tool: 'Direct Declarative Polyhedral Synthesis Engine v5.0',
      runner: 'tools/ai3d/direct_ingest_all.mjs',
      params: `--family tree --subpart ${arch.subpart} --style ${arch.style}`,
      machine: 'Node.js Native Multi-Polyhedral 3D Engine',
      measured: `Triangles ${bounds.triangles}`,
    },
    post: {
      tool: 'tools/ai3d/direct_ingest_all.mjs',
      fit: 1.0,
      bounds: bounds.size,
    },
    keys: [key],
  });
}

// 6. Append to out/3d_database.json and tools/ai3d/parts_manifest.json
const existingV5Bld = db.items.filter((i) => i.version === 5 && i.family === 'building');
const nonV5Items = db.items.filter((i) => i.version !== 5);

db.items = [...existingV5Bld, ...newV5Items, ...nonV5Items];
db.total_objects = db.items.length;
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log(`Updated out/3d_database.json: ${db.items.length} total items (v5 = ${existingV5Bld.length + newV5Items.length} [building: ${existingV5Bld.length}, rock: ${rockArchetypes.length}, conifer: ${coniferArchetypes.length}])`);

const existingNonV5Manifest = manifest.parts.filter((p) => !(p.version === 5 || p.verStr === 'v5'));
const existingV5BldManifest = manifest.parts.filter((p) => (p.version === 5 || p.verStr === 'v5') && p.consumer?.includes('building'));

manifest.parts = [...existingV5BldManifest, ...newManifestParts, ...existingNonV5Manifest];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Updated tools/ai3d/parts_manifest.json: ${manifest.parts.length} total parts`);
