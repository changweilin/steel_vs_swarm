const EPS = 1e-4;

const ASYMMETRIC_FUNCTION_RE = /(?:chain|drivetrain|crank|pedal|spoke|kickstand|side[_-]?stand|exhaust|muffler|snorkel|luggage|steering|driver|derailleur|cassette|brake|rotor|caliper|cable|license|plate|logo|text|stripe|decal|badge|wiper|valve)/i;
const SIDE_TOKEN_RE = /(^|[_-])(left|right)(?=$|[_-])/i;

function finiteArray(value, length = null) {
  return Array.isArray(value)
    && (length === null || value.length === length)
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function angleDelta(a, b) {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function valuesEqual(a, b, tolerance = EPS) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length
      && a.every((value, index) => valuesEqual(value, b[index], tolerance));
  }
  if (typeof a === 'number' || typeof b === 'number') {
    return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
  }
  return a === b;
}

function sideInfo(name) {
  const match = typeof name === 'string' ? name.match(SIDE_TOKEN_RE) : null;
  if (!match) return null;
  const side = match[2].toLowerCase();
  return { side, counterpart: name.replace(SIDE_TOKEN_RE, `$1${side === 'left' ? 'right' : 'left'}`) };
}

function lateralAxisFromBounds(bounds) {
  const size = bounds?.size;
  if (!finiteArray(size, 3)) return 2;
  // 長邊為車體縱向；另一軸才是左右軸。等長時沿用 X 縱向、Z 橫向的載具慣例。
  return size[0] >= size[2] ? 2 : 0;
}

export function vehicleLateralAxis(model, meshData = model?.meshData) {
  if (model?.symmetryContract?.lateralAxis === 'x') return 0;
  if (model?.symmetryContract?.lateralAxis === 'z') return 2;
  if (meshData?.vertices && meshData.vertices.length >= 6) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < meshData.vertices.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], meshData.vertices[index + axis]);
        max[axis] = Math.max(max[axis], meshData.vertices[index + axis]);
      }
    }
    return lateralAxisFromBounds({ size: max.map((value, axis) => value - min[axis]) });
  }
  return lateralAxisFromBounds(model?.bounds);
}

function expectedMirrorRotation(rotation, lateralAxis) {
  if (!finiteArray(rotation, 3)) return null;
  if (lateralAxis === 0) return [rotation[0], -rotation[1], -rotation[2]];
  return [-rotation[0], -rotation[1], rotation[2]];
}

function mirroredRotationForPart(part, lateralAxis) {
  // Torus 輪胎繞自身法線旋轉不改變幾何；保留原角度可避免把同一個輪面
  // 因 Euler 角等價表示誤判成方向錯誤。
  if (part?.type === 'torus_ring' || /(?:wheel|rim|hub|axle)/i.test(part?.name || '')) return [...part.rotation];
  return expectedMirrorRotation(part.rotation, lateralAxis);
}

function cylinderAxis(rotation) {
  let [x, y, z] = [0, 1, 0];
  const [rx, ry, rz] = rotation;
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]; }
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; }
  const length = Math.hypot(x, y, z);
  return length > EPS ? [x / length, y / length, z / length] : null;
}

export function mirrorVehiclePart(part, lateralAxis) {
  const info = sideInfo(part?.name);
  if (!info) throw new Error(`無法鏡像沒有 left/right 標記的零件: ${part?.name || '<unknown>'}`);
  const position = [...part.position];
  position[lateralAxis] *= -1;
  return {
    ...part,
    name: info.counterpart,
    position,
    rotation: mirroredRotationForPart(part, lateralAxis),
    ...(Array.isArray(part.dimensions) ? { dimensions: [...part.dimensions] } : {}),
    ...(Array.isArray(part.radii) ? { radii: [...part.radii] } : {}),
  };
}

function reportPartPair(source, counterpart, lateralAxis) {
  const issues = [];
  const sourcePosition = source.position;
  const targetPosition = counterpart.position;
  if (!finiteArray(sourcePosition, 3) || !finiteArray(targetPosition, 3)) {
    issues.push('position_invalid');
  } else {
    for (let axis = 0; axis < 3; axis += 1) {
      const expected = axis === lateralAxis ? -sourcePosition[axis] : sourcePosition[axis];
      if (Math.abs(targetPosition[axis] - expected) > EPS) issues.push(`position_axis_${axis}`);
    }
  }

  const sourceRotation = source.rotation;
  const targetRotation = counterpart.rotation;
  const expectedRotation = mirroredRotationForPart(source, lateralAxis);
  if (!expectedRotation || !finiteArray(targetRotation, 3)) {
    issues.push('rotation_invalid');
  } else if (source.type === 'cylinder') {
    const sourceAxis = cylinderAxis(sourceRotation);
    const targetAxis = cylinderAxis(targetRotation);
    if (!sourceAxis || !targetAxis) issues.push('rotation_invalid');
    else {
      sourceAxis[lateralAxis] *= -1;
      const axisDot = sourceAxis[0] * targetAxis[0] + sourceAxis[1] * targetAxis[1] + sourceAxis[2] * targetAxis[2];
      // 圓柱兩端沒有正反之分，接受 ± 同一軸向；繞自身軸的 Euler 角也不影響形狀。
      if (1 - Math.abs(axisDot) > EPS) issues.push('rotation_mirror');
    }
  } else if (expectedRotation.some((value, index) => Math.abs(angleDelta(targetRotation[index], value)) > EPS)) {
    issues.push('rotation_mirror');
  }

  for (const field of ['type', 'dimensions', 'radii', 'radius', 'height', 'sides', 'tube', 'color', 'colorKey', 'role', 'triangles']) {
    if (!valuesEqual(source[field], counterpart[field])) issues.push(`field_${field}`);
  }
  return issues;
}

function meshBounds(meshData) {
  if (!finiteArray(meshData?.vertices) || meshData.vertices.length < 3 || meshData.vertices.length % 3 !== 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < meshData.vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], meshData.vertices[index + axis]);
      max[axis] = Math.max(max[axis], meshData.vertices[index + axis]);
    }
  }
  return { min, max };
}

export function vehicleSymmetryReport(model, meshData = model?.meshData) {
  const lateralAxis = vehicleLateralAxis(model, meshData);
  const axisName = lateralAxis === 0 ? 'x' : 'z';
  const issues = [];
  const bounds = meshBounds(meshData);
  if (bounds && Math.abs(bounds.min[lateralAxis] + bounds.max[lateralAxis]) > EPS) {
    issues.push({ type: 'outer_bounds', axis: axisName, min: bounds.min[lateralAxis], max: bounds.max[lateralAxis] });
  }

  const parts = Array.isArray(model?.parts) ? model.parts : [];
  const byName = new Map(parts.filter((part) => typeof part?.name === 'string').map((part) => [part.name, part]));
  const checked = new Set();
  for (const part of parts) {
    const info = sideInfo(part?.name);
    if (!info || checked.has(part.name) || ASYMMETRIC_FUNCTION_RE.test(part.name)) continue;
    checked.add(part.name);
    const lateral = part.position?.[lateralAxis];
    if (!Number.isFinite(lateral) || Math.abs(lateral) <= EPS) continue;
    const counterpart = byName.get(info.counterpart);
    if (!counterpart) {
      issues.push({ type: 'missing_counterpart', part: part.name, counterpart: info.counterpart, axis: axisName });
      continue;
    }
    checked.add(counterpart.name);
    const pairIssues = reportPartPair(part, counterpart, lateralAxis);
    if (pairIssues.length) issues.push({ type: 'counterpart_mismatch', part: part.name, counterpart: counterpart.name, issues: pairIssues });
  }
  return { ok: issues.length === 0, axis: lateralAxis, axisName, issues };
}

export const vehicleSymmetryConstants = Object.freeze({ EPS, ASYMMETRIC_FUNCTION_RE: ASYMMETRIC_FUNCTION_RE.source });
