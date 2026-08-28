import { RUNTIME_PARTS } from './runtimeParts.js';

// 通過零件台的場景載具適配層。來源零件保持原始局部座標，整台車只靠 sceneBasis
// 轉成「鼻頭 +X、原點在足跡中心地面」；權威碰撞量體仍由既有 vehicles.js 管理。
const EXPECTED_V6_COUNT = 14;
const EPS = 1e-6;
const AXLE_EPS_M = 0.12;
const SUPPORTED_PRIMITIVES = new Set(['box', 'cylinder', 'torus_ring', 'wedge']);
const FRONT_RE = /(^|_)(front|headlight|grille|radiator|crank)(_|$)/;
const WHEEL_RE = /(^|_)(wheel|tire)(_|$)/;

const finite = (v) => Number.isFinite(v);
const fail = (message) => { throw new Error(`[approvedVehicleModels] ${message}`); };

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function requireVec3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) {
    fail(`${label} 必須是三個有限數值`);
  }
  return value;
}

function materialRole(name) {
  if (/(windshield|window|glass)/.test(name)) return 'glass';
  if (/(headlight|taillight|hazard|lamp)/.test(name)) return 'lamp';
  if (!/steering/.test(name) && /(tire|tyre|(^|_)wheel(_|$))/.test(name)) return 'tire';
  if (/(rim|chrome|grille|bumper|rail|rack|mirror|crank|steering|protection)/.test(name)) return 'hardware';
  if (/(plate|sign|logo|text|stripe|panel)/.test(name)) return 'marking';
  return 'body';
}

function vehicleClass(row) {
  const names = row.parts.map((part) => part.name).join(' ');
  if (/\bbus_/.test(names)) return 'bus';
  if (/(container|trailer|cargo_bed)/.test(names)) return 'cargo';
  if (row.subpart === 'heavy') return 'heavy';
  if (/(vintage|retro)/.test(`${row.style} ${row.spec?.style || ''}`)) return 'heritage';
  return 'passenger';
}

function longitudinalFrame(row) {
  const { min, max, size } = row.bounds;
  const longitudinalAxis = size[0] >= size[2] ? 0 : 2;
  const lateralAxis = longitudinalAxis === 0 ? 2 : 0;
  const centre = (min[longitudinalAxis] + max[longitudinalAxis]) * 0.5;
  const front = row.parts.filter((part) => FRONT_RE.test(part.name));
  if (!front.length) fail(`${row.key} 缺少可推導鼻頭方向的 front 硬體`);
  const frontCentre = front.reduce((sum, part) => sum + part.position[longitudinalAxis], 0) / front.length;
  if (Math.abs(frontCentre - centre) < EPS) fail(`${row.key} 的 front 硬體無法判斷鼻頭方向`);
  const frontSign = frontCentre > centre ? 1 : -1;
  const rotationY = longitudinalAxis === 0
    ? (frontSign > 0 ? 0 : Math.PI)
    : (frontSign > 0 ? Math.PI / 2 : -Math.PI / 2);
  return { longitudinalAxis, lateralAxis, frontSign, rotationY, centre };
}

function axleProfile(row, frame) {
  const wheelParts = row.parts.filter((part) => WHEEL_RE.test(part.name) && !/rim|steering/.test(part.name));
  if (wheelParts.length < 4) fail(`${row.key} 的可辨識車輪少於四個`);
  const centre = frame.centre;
  const centres = wheelParts
    .map((part) => frame.frontSign * (part.position[frame.longitudinalAxis] - centre))
    .sort((a, b) => a - b);
  const axles = [];
  for (const value of centres) {
    const last = axles[axles.length - 1];
    if (!last || Math.abs(last.mean - value) > AXLE_EPS_M) axles.push({ sum: value, count: 1, mean: value });
    else {
      last.sum += value;
      last.count += 1;
      last.mean = last.sum / last.count;
    }
  }
  if (axles.length < 2 || axles.some((axle) => axle.count < 2)) {
    fail(`${row.key} 的左右輪無法合併為至少兩根車軸`);
  }
  const positions = axles.map((axle) => axle.mean);
  return {
    positions,
    wheelbase: positions[positions.length - 1] - positions[0],
    wheelCount: wheelParts.length,
  };
}

function normalizePart(row, part, origin) {
  if (!part || typeof part !== 'object') fail(`${row.key} 含無效零件列`);
  if (!SUPPORTED_PRIMITIVES.has(part.type)) fail(`${row.key}/${part.name} 使用未支援形狀 ${part.type}`);
  if (typeof part.name !== 'string' || !part.name) fail(`${row.key} 含無名稱零件`);
  requireVec3(part.position, `${row.key}/${part.name}.position`);
  requireVec3(part.rotation, `${row.key}/${part.name}.rotation`);
  if (!Number.isInteger(part.color) || part.color < 0 || part.color > 0xffffff) {
    fail(`${row.key}/${part.name}.color 必須是 24-bit 色碼`);
  }
  const dimensions = part.dimensions == null ? null : [...part.dimensions];
  if (dimensions && (!dimensions.length || !dimensions.every((v) => finite(v) && v > 0))) {
    fail(`${row.key}/${part.name}.dimensions 必須為正有限數值`);
  }
  return {
    name: part.name,
    type: part.type,
    ...(dimensions ? { dimensions } : {}),
    ...(part.radii ? { radii: [...part.radii] } : {}),
    ...(finite(part.radius) ? { radius: part.radius } : {}),
    ...(finite(part.height) ? { height: part.height } : {}),
    ...(finite(part.sides) ? { sides: part.sides } : {}),
    ...(finite(part.tube) ? { tube: part.tube } : {}),
    position: [
      part.position[0] - origin[0],
      part.position[1] - origin[1],
      part.position[2] - origin[2],
    ],
    rotation: [...part.rotation],
    color: part.color,
    materialRole: materialRole(part.name),
    triangles: part.triangles,
  };
}

function normalizeMeshData(row, raw, origin) {
  if (!raw || !Array.isArray(raw.vertices) || raw.vertices.length < 9 || raw.vertices.length % 3 !== 0
    || !Array.isArray(raw.faces) || raw.faces.length < 3 || raw.faces.length % 3 !== 0) {
    fail(`${row.key} 缺少可供三端共用的 meshData`);
  }
  const vertexCount = raw.vertices.length / 3;
  if (!raw.faces.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)) {
    fail(`${row.key} meshData.faces 超出頂點範圍`);
  }
  if (!Array.isArray(raw.colors) || raw.colors.length !== raw.vertices.length
    || !raw.colors.every(finite)) {
    fail(`${row.key} meshData.colors 缺失或長度不符`);
  }
  if (raw.normals != null && (!Array.isArray(raw.normals) || raw.normals.length !== raw.vertices.length || !raw.normals.every(finite))) {
    fail(`${row.key} meshData.normals 長度不符`);
  }
  if (raw.uvs != null && (!Array.isArray(raw.uvs) || raw.uvs.length !== vertexCount * 2 || !raw.uvs.every(finite))) {
    fail(`${row.key} meshData.uvs 長度不符`);
  }
  const vertices = raw.vertices.map((value, index) => value - origin[index % 3]);
  return {
    vertexCount,
    triangleCount: raw.faces.length / 3,
    vertices,
    ...(raw.normals ? { normals: [...raw.normals] } : {}),
    ...(raw.uvs ? { uvs: [...raw.uvs] } : {}),
    colors: [...raw.colors],
    faces: [...raw.faces],
  };
}

function adapt(row) {
  if (row.family !== 'vehicle' || row.version !== 6 || row.verStr !== 'v6') {
    fail(`${row.key} 不是正式 v6 vehicle row`);
  }
  if (row.provenance?.review?.status !== 'ok') fail(`${row.key} 未通過零件台`);
  if (!Array.isArray(row.parts) || !row.parts.length) fail(`${row.key} 沒有宣告零件`);
  const { min, max, size } = row.bounds || {};
  requireVec3(min, `${row.key}.bounds.min`);
  requireVec3(max, `${row.key}.bounds.max`);
  requireVec3(size, `${row.key}.bounds.size`);
  if (size.some((v) => v <= 0)) fail(`${row.key} 外廓尺寸必須大於零`);

  const frame = longitudinalFrame(row);
  const origin = [(min[0] + max[0]) * 0.5, min[1], (min[2] + max[2]) * 0.5];
  const axles = axleProfile(row, frame);
  const parts = row.parts.map((part) => normalizePart(row, part, origin));
  const meshData = normalizeMeshData(row, row.meshData, origin);
  return {
    key: row.key,
    id: row.id,
    family: 'vehicle',
    subpart: row.subpart,
    kind: row.key.slice('vehicle/'.length),
    canonicalTarget: row.canonicalTarget,
    class: vehicleClass(row),
    version: row.version,
    triangles: row.triangles,
    source: {
      image: row.image,
      method: row.provenance.method,
      sourceId: row.provenance.source?.id,
      license: row.provenance.source?.license,
    },
    dimensions: {
      L: size[frame.longitudinalAxis],
      W: size[frame.lateralAxis],
      H: size[1],
    },
    sceneBasis: {
      authoredNose: '+x',
      origin,
      rotationY: frame.rotationY,
    },
    axles,
    materials: [...new Set(parts.map((part) => part.materialRole))],
    parts,
    meshData,
  };
}

const sourceRows = RUNTIME_PARTS?.vehicle;
if (!Array.isArray(sourceRows)) fail('runtimeParts.js 未提供 RUNTIME_PARTS.vehicle');
const v6Rows = sourceRows.filter((row) => row.version === 6);
if (v6Rows.length !== EXPECTED_V6_COUNT) {
  fail(`正式 v6 載具應為 ${EXPECTED_V6_COUNT} 筆，實得 ${v6Rows.length} 筆`);
}

export const APPROVED_VEHICLE_MODELS = deepFreeze(v6Rows.map(adapt).sort((a, b) => (
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0
)));
const BY_KEY = new Map(APPROVED_VEHICLE_MODELS.map((row) => [row.key, row]));

if (BY_KEY.size !== APPROVED_VEHICLE_MODELS.length) fail('載具 key 重複');

/** 取得正式場景載具；未知鍵直接失敗，禁止安靜退回錯款。 */
export function approvedVehicleModel(key) {
  const row = BY_KEY.get(key);
  if (!row) fail(`未知載具 ${key}`);
  return row;
}

/** 由類別取得固定排序型錄；回傳新陣列，不暴露型錄容器。 */
export function approvedVehicleModelsByClass(vehicleClass) {
  return APPROVED_VEHICLE_MODELS.filter((row) => row.class === vehicleClass);
}

/** 以穩定整數挑款；呼叫端種子相同就逐位元同款，不消耗任何共享亂數。 */
export function approvedVehicleModelAt(index, vehicleClass = null) {
  if (!Number.isSafeInteger(index)) fail('index 必須是安全整數');
  const rows = vehicleClass ? approvedVehicleModelsByClass(vehicleClass) : APPROVED_VEHICLE_MODELS;
  if (!rows.length) fail(`類別 ${vehicleClass} 沒有正式載具`);
  return rows[((index % rows.length) + rows.length) % rows.length];
}
