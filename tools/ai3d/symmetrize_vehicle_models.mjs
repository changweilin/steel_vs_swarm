import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mirrorVehiclePart, vehicleLateralAxis, vehicleSymmetryReport } from './vehicle_symmetry.mjs';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(HERE, '..', '..');
const DB_PATH = join(ROOT, 'out', '3d_database.json');
const MANIFEST_PATH = join(ROOT, 'tools', 'ai3d', 'parts_manifest.json');
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJsonAtomic(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (existsSync(path)) unlinkSync(path);
  renameSync(temp, path);
}
function finiteArray(value, length = null) {
  return Array.isArray(value)
    && (length === null || value.length === length)
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}
function round3(value) { return Number(value.toFixed(3)); }
function partTriangleStart(parts, index) {
  return parts.slice(0, index).reduce((sum, part) => sum + part.triangles, 0) * 3;
}
function colorRgb(color) {
  const value = Number.isInteger(color) ? color : 0x888888;
  return [(value >> 16 & 0xff) / 255, (value >> 8 & 0xff) / 255, (value & 0xff) / 255];
}

function prepareMeshData(model) {
  const mesh = model.meshData;
  if (!mesh || !finiteArray(mesh.vertices) || mesh.vertices.length % 3 !== 0
    || !finiteArray(mesh.faces) || mesh.faces.length % 3 !== 0
    || !mesh.faces.every((index) => Number.isInteger(index) && index >= 0 && index < mesh.vertices.length / 3)) {
    throw new Error(`${model.id}: meshData 顶點或三角面無效，停止對稱修復`);
  }
  const triangleTotal = model.parts.reduce((sum, part) => {
    if (!Number.isInteger(part.triangles) || part.triangles < 0) throw new Error(`${model.id}: 零件三角面數無效 ${part.name}`);
    return sum + part.triangles;
  }, 0);
  if (triangleTotal * 3 !== mesh.faces.length) throw new Error(`${model.id}: parts 與 meshData 面索引未對齊`);
  if (mesh.normals !== undefined && !finiteArray(mesh.normals, mesh.vertices.length)) throw new Error(`${model.id}: normals 長度無效`);
  if (mesh.uvs !== undefined && !finiteArray(mesh.uvs, (mesh.vertices.length / 3) * 2)) throw new Error(`${model.id}: uvs 長度無效`);
  if (!finiteArray(mesh.colors, mesh.vertices.length)) {
    mesh.colors = new Array(mesh.vertices.length).fill(0);
    let cursor = 0;
    for (const part of model.parts) {
      const rgb = colorRgb(part.color);
      const touched = new Set(mesh.faces.slice(cursor, cursor + part.triangles * 3));
      for (const index of touched) mesh.colors.splice(index * 3, 3, ...rgb);
      cursor += part.triangles * 3;
    }
  }
}

function appendMirroredMesh(model, sourceIndex, lateralAxis) {
  const mesh = model.meshData;
  const start = partTriangleStart(model.parts, sourceIndex);
  const end = start + model.parts[sourceIndex].triangles * 3;
  const sourceFaces = mesh.faces.slice(start, end);
  const sourceIndices = [...new Set(sourceFaces)];
  const indexMap = new Map();
  const vertices = [];
  const normals = mesh.normals ? [] : null;
  const uvs = mesh.uvs ? [] : null;
  const colors = mesh.colors ? [] : null;
  for (const sourceVertex of sourceIndices) {
    indexMap.set(sourceVertex, mesh.vertices.length / 3 + vertices.length / 3);
    const sourceOffset = sourceVertex * 3;
    const position = mesh.vertices.slice(sourceOffset, sourceOffset + 3);
    position[lateralAxis] *= -1;
    vertices.push(...position);
    if (normals) {
      const normal = mesh.normals.slice(sourceOffset, sourceOffset + 3);
      normal[lateralAxis] *= -1;
      normals.push(...normal);
    }
    if (uvs) uvs.push(...mesh.uvs.slice(sourceVertex * 2, sourceVertex * 2 + 2));
    if (colors) colors.push(...mesh.colors.slice(sourceOffset, sourceOffset + 3));
  }
  const faces = [];
  for (let index = 0; index < sourceFaces.length; index += 3) {
    const a = indexMap.get(sourceFaces[index]);
    const b = indexMap.get(sourceFaces[index + 1]);
    const c = indexMap.get(sourceFaces[index + 2]);
    faces.push(a, c, b);
  }
  mesh.vertices.push(...vertices);
  mesh.faces.push(...faces);
  if (mesh.normals) mesh.normals.push(...normals);
  if (mesh.uvs) mesh.uvs.push(...uvs);
  if (mesh.colors) mesh.colors.push(...colors);
}

function recomputeBounds(model) {
  const vertices = model.meshData.vertices;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertices[index + axis]);
      max[axis] = Math.max(max[axis], vertices[index + axis]);
    }
  }
  const size = max.map((value, axis) => round3(value - min[axis]));
  const bounds = {
    min, max, size,
    rMax: round3(Math.max(Math.hypot(min[0], min[2]), Math.hypot(max[0], max[2]))),
    triangles: model.meshData.faces.length / 3,
    vertices: vertices.length / 3,
  };
  model.bounds = bounds;
  model.meshData.vertexCount = bounds.vertices;
  model.meshData.triangleCount = bounds.triangles;
  return bounds;
}

function modelObj(model) {
  const mesh = model.meshData;
  const lines = [`# 3D Model: ${model.family}/${model.subpart}/${model.id} (symmetry repair)`, `# Triangles: ${mesh.faces.length / 3} | Vertices: ${mesh.vertices.length / 3}`];
  for (let index = 0; index < mesh.vertices.length; index += 3) lines.push(`v ${mesh.vertices[index]} ${mesh.vertices[index + 1]} ${mesh.vertices[index + 2]}`);
  if (mesh.uvs) for (let index = 0; index < mesh.uvs.length; index += 2) lines.push(`vt ${mesh.uvs[index]} ${mesh.uvs[index + 1]}`);
  if (mesh.normals) for (let index = 0; index < mesh.normals.length; index += 3) lines.push(`vn ${mesh.normals[index]} ${mesh.normals[index + 1]} ${mesh.normals[index + 2]}`);
  for (let index = 0; index < mesh.faces.length; index += 3) {
    const face = mesh.faces.slice(index, index + 3).map((value) => value + 1);
    if (mesh.uvs && mesh.normals) lines.push(`f ${face[0]}/${face[0]}/${face[0]} ${face[1]}/${face[1]}/${face[1]} ${face[2]}/${face[2]}/${face[2]}`);
    else if (mesh.uvs) lines.push(`f ${face[0]}/${face[0]} ${face[1]}/${face[1]} ${face[2]}/${face[2]}`);
    else if (mesh.normals) lines.push(`f ${face[0]}//${face[0]} ${face[1]}//${face[1]} ${face[2]}//${face[2]}`);
    else lines.push(`f ${face.join(' ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function updateSidecar(path, model, symmetryContract) {
  if (!existsSync(path)) return;
  const sidecar = readJson(path);
  const partNames = model.parts.map((part) => part.name);
  sidecar.totalParts = model.parts.length;
  sidecar.partNames = partNames;
  sidecar.symmetryMode = model.symmetryMode;
  sidecar.symmetryContract = symmetryContract;
  sidecar.bounds = model.bounds;
  if (sidecar.structuralContract) sidecar.structuralContract.symmetryContract = symmetryContract;
  writeJsonAtomic(path, sidecar);
}

function selectedRow(row, reviewItems) {
  return row.family === 'vehicle' && row.version === 6
    && (reviewItems[row.key]?.status === 'ok' || row.key.includes('_luna_v6'));
}

function repairModel(row, reviewItems, manifestByKey) {
  const modelPath = join(ROOT, row.outputDir, 'model.json');
  if (!existsSync(modelPath)) return { key: row.key, status: 'missing_model' };
  const model = readJson(modelPath);
  prepareMeshData(model);
  const before = vehicleSymmetryReport(model, model.meshData);
  if (before.ok) return { key: row.key, status: 'ok', axis: before.axisName, repairedParts: [] };
  const lateralAxis = vehicleLateralAxis(model, model.meshData);
  const byName = new Map(model.parts.map((part, index) => [part.name, { part, index }]));
  const repairedParts = [];
  for (const issue of before.issues) {
    if (issue.type !== 'missing_counterpart') throw new Error(`${row.key}: ${JSON.stringify(issue)}；已有成對零件不一致，停止自動改寫`);
    const source = byName.get(issue.part);
    if (!source) throw new Error(`${row.key}: 找不到待鏡像零件 ${issue.part}`);
    const mirrored = mirrorVehiclePart(source.part, lateralAxis);
    appendMirroredMesh(model, source.index, lateralAxis);
    model.parts.push(mirrored);
    byName.set(mirrored.name, { part: mirrored, index: model.parts.length - 1 });
    repairedParts.push({ source: source.part.name, mirrored: mirrored.name });
  }
  const bounds = recomputeBounds(model);
  const symmetryContract = {
    lateralAxis: lateralAxis === 0 ? 'x' : 'z',
    mirrorPlane: `${lateralAxis === 0 ? 'x' : 'z'}=0`,
    mirroredBilateral: true,
    repairedParts,
    functionalAsymmetry: 'preserved',
  };
  model.symmetryContract = symmetryContract;
  if (model.structuralContract) {
    model.structuralContract.mirroredBilateral = true;
    model.structuralContract.symmetryContract = symmetryContract;
  }
  const after = vehicleSymmetryReport(model, model.meshData);
  if (!after.ok) throw new Error(`${row.key}: 對稱修復後仍未通過 ${JSON.stringify(after.issues)}`);
  if (!DRY_RUN) {
    writeJsonAtomic(modelPath, model);
    writeJsonAtomic(join(ROOT, row.outputDir, 'features.json'), {
      ...readJson(join(ROOT, row.outputDir, 'features.json')),
      totalParts: model.parts.length,
      partNames: model.parts.map((part) => part.name),
      symmetryMode: model.symmetryMode,
      symmetryContract,
      bounds,
    });
    updateSidecar(join(ROOT, row.outputDir, 'metadata.json'), model, symmetryContract);
    const objPath = join(ROOT, row.outputDir, 'model.obj');
    if (existsSync(objPath)) writeFileSync(objPath, modelObj(model), 'utf8');
  }
  row.bounds = bounds;
  row.triangles = bounds.triangles;
  row.symmetryMode = row.symmetryMode || 'symmetric';
  const manifest = manifestByKey.get(row.key);
  if (manifest) {
    manifest.gen = { ...manifest.gen, measured: `Triangles ${bounds.triangles}, Vertices ${bounds.vertices}` };
    manifest.post = { ...manifest.post, bounds: bounds.size, note: `Extents [${bounds.size.join(', ')}]m, rMax ${bounds.rMax}m; bilateral symmetry repaired` };
  }
  return { key: row.key, status: DRY_RUN ? 'would_repair' : 'repaired', axis: after.axisName, repairedParts };
}

const database = readJson(DB_PATH);
const manifestDoc = readJson(MANIFEST_PATH);
const reviewDoc = readJson(join(ROOT, 'tools', 'parts_review', 'state.json'));
const reviewItems = reviewDoc.items || {};
const manifestByKey = new Map();
for (const entry of manifestDoc.parts || []) for (const key of entry.keys || (entry.key ? [entry.key] : [])) manifestByKey.set(key, entry);
const results = [];
for (const row of database.items || []) {
  if (!selectedRow(row, reviewItems)) continue;
  results.push(repairModel(row, reviewItems, manifestByKey));
}
if (!DRY_RUN) {
  writeJsonAtomic(DB_PATH, database);
  writeJsonAtomic(MANIFEST_PATH, manifestDoc);
}
const repaired = results.filter((result) => result.status === 'repaired' || result.status === 'would_repair');
console.log(`車輛 v6 左右對稱檢查 ${results.length} 件；${DRY_RUN ? '預計修復' : '已修復'} ${repaired.length} 件`);
for (const result of repaired) console.log(`${result.status}: ${result.key} [${result.axis}] ${result.repairedParts.map((part) => `${part.source}->${part.mirrored}`).join(', ')}`);
