import * as THREE from 'three';
import { generateBackgroundObject } from '../../public/js/backgroundObjects.js';
import { RUNTIME_BACKGROUND_CATALOG, RUNTIME_PARTS } from '../../public/js/runtimeParts.js';
import { mergeRuntimeParts } from '../../public/js/runtimePartModel.js';

const VIEWS = [
  ['正面', [0, 0.35, 1]],
  ['側面', [1, 0.35, 0]],
  ['俯視', [0, 1, 0.001]],
];

const entries = new Map(Object.values(RUNTIME_PARTS).flat().map((entry) => [entry.key, entry]));

function contextOf(key) {
  const ref = RUNTIME_BACKGROUND_CATALOG.objects[key];
  const subcategory = RUNTIME_BACKGROUND_CATALOG.subcategories[ref.subcategoryId];
  const structure = subcategory.structures.find((row) => row.id === ref.structureId);
  return { entry: entries.get(key), structure, member: structure.members.find((row) => row.key === key) };
}

function chooseCase({ label, prefix, rolePattern, includeRoles, isolate = false }) {
  const candidates = Object.keys(RUNTIME_BACKGROUND_CATALOG.objects).filter((key) => key.startsWith(prefix))
    .map((key) => {
      const context = contextOf(key);
      const role = context.member.leafRoles.filter((row) => rolePattern.test(row.role))
        .sort((a, b) => b.slots.length - a.slots.length)[0];
      if (!role || role.slots.length < 2) return null;
      const sourceCount = context.structure.members.flatMap((source) => source.leafRoles
        .filter((row) => row.role === role.role).flatMap((row) => row.slots)).length;
      return { label, key, role, sourceCount, isolate, roles: new Set(includeRoles || [role.role]), ...context };
    }).filter(Boolean)
    .sort((a, b) => b.role.slots.length - a.role.slots.length || b.sourceCount - a.sourceCount
      || a.key.localeCompare(b.key));
  if (!candidates.length) throw new Error(`缺少${label}多槽案例`);
  return candidates[0];
}

function reviewCases() {
  return [
    chooseCase({ label: '葉冠／樹幹', prefix: 'building/', rolePattern: /^canopy$/,
      includeRoles: ['trunk', 'canopy'], isolate: true }),
    chooseCase({ label: '建築窗帶', prefix: 'building/', rolePattern: /^glass$/ }),
    chooseCase({ label: '小客車輪組', prefix: 'vehicle/car_', rolePattern: /^(wheel|wheel_tire)$/ }),
    chooseCase({ label: '重型車輪組', prefix: 'vehicle/heavy_', rolePattern: /^wheel$/ }),
  ];
}

function selectedIndexes(item) {
  const leaf = item.member.leafRoles.filter((row) => item.roles.has(row.role))
    .flatMap((row) => row.slots.flatMap((slot) => slot.partIndexes));
  return item.isolate ? leaf : [...item.member.mainParts.map((row) => row.index), ...leaf];
}

function reviewRows() {
  const rows = [];
  for (const item of reviewCases()) {
    const slotCount = item.member.leafRoles.filter((row) => item.roles.has(row.role))
      .reduce((sum, row) => sum + row.slots.length, 0);
    rows.push({
      label: `${item.label}／原始目標`,
      parts: selectedIndexes(item).map((index) => item.entry.parts[index]),
      palette: null,
      sources: `${[...item.roles].join('＋')}：${slotCount} 槽`,
    });
    const generated = generateBackgroundObject(item.key, 0);
    const ledgers = generated.generation.leafSlots.filter((slot) => item.roles.has(slot.role));
    const leafParts = ledgers.flatMap((slot) => generated.parts.slice(slot.partStart, slot.partStart + slot.partCount));
    const uniqueSources = new Set(ledgers.map((slot) => `${slot.sourceKey}|${slot.sourceSlotId}`)).size;
    rows.push({
      label: `${item.label}／生成變體 0`,
      parts: item.isolate
        ? leafParts
        : [...generated.parts.slice(0, generated.generation.mainPartCount), ...leafParts],
      palette: generated.palettes[0]?.colors || null,
      sources: `${ledgers.length} 槽獨立抽樣／${uniqueSources} 個來源槽`,
    });
  }
  return rows;
}

function renderCell(item, view, direction) {
  const card = document.createElement('section');
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 300;
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${item.label}／${view}\n${item.sources}`;
  card.append(canvas, label);
  document.getElementById('grid').append(card);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(360, 300, false);
  renderer.setClearColor(0xd9dde2, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x43505d, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 2.7);
  light.position.set(5, 9, 7);
  scene.add(light);
  const geometry = mergeRuntimeParts(item.parts, { palette: item.palette });
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  scene.add(new THREE.Mesh(geometry, material));
  const box = geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z) * 2.15;
  const camera = new THREE.PerspectiveCamera(34, 1.2, 0.01, distance * 8);
  camera.position.set(
    center.x + direction[0] * distance,
    center.y + direction[1] * distance,
    center.z + direction[2] * distance,
  );
  if (view === '俯視') camera.up.set(0, 0, -1);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const grid = new THREE.GridHelper(6, 12, 0x607080, 0xaab2bb);
  grid.position.y = Math.min(0, box.min.y);
  scene.add(grid, new THREE.AxesHelper(0.7));
  renderer.render(scene, camera);
  // Chrome 同頁約 16 個 WebGL context 後會回收最早的畫布；逐格凍結成圖片，三視角全數可覆核。
  const preview = new Image();
  preview.className = 'preview';
  preview.alt = `${item.label}／${view}`;
  preview.src = canvas.toDataURL('image/png');
  canvas.replaceWith(preview);
  renderer.dispose();
  renderer.forceContextLoss();
  return size.toArray();
}

try {
  const report = [];
  for (const item of reviewRows()) {
    let measured = null;
    for (const [view, direction] of VIEWS) {
      const size = renderCell(item, view, direction);
      measured ||= size;
    }
    report.push({ label: item.label, size: measured, parts: item.parts.length, sources: item.sources });
  }
  window.__backgroundReview = { ready: true, rows: report };
} catch (error) {
  window.__backgroundReview = { ready: false, error: error.stack || error.message, rows: [] };
}
