#!/usr/bin/env node

/**
 * 船體多面體組裝離線稽核。
 *
 * 逐一讀取每個 out/3d_data/ship/hull 子資料夾內的 model/metadata JSON，驗證：
 * 1. primitive 尺寸、座標與旋轉皆為有限正數，且不存在退化薄片。
 * 2. 船艏沿 +X，主船體長軸沿 X，左右舷沿 Z 完整且鏡射配對。
 * 3. 所有非船體零件均與船體支撐鏈接觸；接合公差為 max(0.08m, 船長 0.4%)。
 * 4. 主船體、甲板、上層、桅杆、武器間無明顯漂浮或過度互穿。
 * 5. 船體落在 y=0，並具艏艉收束體，避免只剩長方體平頭船殼。
 * 6. 艙室由甲板封閉至艙頂；禁止裸露座椅、開放內裝或玻璃後方空洞。
 * 7. 非航母甲板與艙室不得超出支撐面；上層艙室必須收在下層艙室內。
 * 8. 每個零件須以不超過 0.08m 的接縫連回主船體。
 * 9. 玻璃／標線片厚度依長邊夾制；玻璃須與艙室同高、貼面且角度一致。
 * 10. 水面船船殼深度具最低長深比；LNG 船最低為船長 7%。
 *
 * --break-floating / --break-degenerate / --break-open / --break-winding / --break-fit / --break-upper-fit /
 * --break-external /
 * --break-sheet / --break-sheet-angle / --break-sheet-height / --break-flat 會在記憶體中製造壞例，且必須使對應
 * 斷言轉紅；若挑不到適用零件或沒有攔截到，腳本本身視為失敗。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SHIP_ROOT = path.join(REPO_ROOT, 'out', '3d_data', 'ship', 'hull');

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has('--json');
const quiet = args.has('--quiet');
let brokeExternal = false;
const versionArg = process.argv.find((value) => value.startsWith('--version='));
const onlyArg = process.argv.find((value) => value.startsWith('--only='));
const wantedVersion = versionArg?.split('=')[1] ?? 'all';
const wantedKey = onlyArg?.slice('--only='.length) ?? null;

const MAJOR_RE = /(hull|deck|superstructure|bridge|cabin|island|tower|container|tank|hangar|platform|stern_base|sponson)/i;
const ROOT_RE = /(main_?hull|hull_?(main|base|body|lower|bottom)|vessel_hull|carrier_main_hull|underwater_hull)/i;
const TAPER_RE = /(bow|stern_cone|bow_cone|bow_taper|stern_taper|bulbous)/i;
const DETAIL_RE = /(window|glass|stripe|trim|light|ring|buoy|tyre|tire|name_plate|flag|railing|fin|plane|aircraft|propeller|shaft|anchor|marking|centerline|landing_line|balcony_|funnel_plinth)/i;
const STACK_RE = /(mast|funnel|radar|gun|turret|crane|support|pillar|stack|dome|roof|aircraft|lifeboat|raft|seat|canopy|motor)/i;
const HULL_LAYER_RE = /(hull|waterline|bottom|base|stripe|bulge)/i;
const ROOM_RE = /superstructure|bridge|cabin|wheelhouse|island|hangar|sealed_/i;
const DECK_RE = /deck|platform/i;
const SHEET_RE = /glass|window|windshield|stripe|marking|landing_(center)?line/i;
const EXTERNAL_SUBMARINE_OBJECT_RE = /^(?:torpedo_(?:body|nose|tail|fin|motor)|external_(?:torpedo|weapon)|launched_(?:torpedo|missile)|(?:missile|rocket|mine|drone|payload)(?:_|$))/i;
const WINDING_AUDIT_TYPES = new Set([
  'box', 'tapered_box', 'polygonal_prism', 'frustum_pyramid', 'pyramid',
  'cylinder', 'cone', 'conical_frustum', 'ellipsoid_sphere',
]);

function finiteVector(value, size) {
  return Array.isArray(value) && value.length >= size && value.slice(0, size).every(Number.isFinite);
}

function isCabinSupport(part) {
  return ROOM_RE.test(part.name) && !DETAIL_RE.test(part.name) && !/tunnel|wing|deck|platform/i.test(part.name);
}

function partPosition(part) {
  return part.position ?? part.pos ?? [0, 0, 0];
}

function partRotation(part) {
  return part.rotation ?? part.rot ?? [0, 0, 0];
}

function localHalfExtents(part) {
  if (finiteVector(part.dimensions, 3)) return part.dimensions.slice(0, 3).map((value) => Math.abs(value) / 2);
  if (part.type === 'hemisphere_dome' || part.type === 'ellipsoid_sphere') {
    if (finiteVector(part.radii, 3)) return part.radii.slice(0, 3).map(Math.abs);
  }
  if (part.type === 'torus_ring' && Number.isFinite(part.radius) && Number.isFinite(part.tube)) {
    const outer = Math.abs(part.radius) + Math.abs(part.tube);
    return [outer, Math.abs(part.tube), outer];
  }
  if (/(dodecahedron|icosahedron)/.test(part.type) && Number.isFinite(part.radius)) {
    const radius = Math.abs(part.radius);
    return [radius, radius, radius];
  }
  if (Number.isFinite(part.height)) {
    const radii = Array.isArray(part.radii) ? part.radii : [];
    const radius = Math.max(
      0,
      ...radii.filter(Number.isFinite).map(Math.abs),
      Number.isFinite(part.radius) ? Math.abs(part.radius) : 0,
    );
    if (radius > 0) return [radius, Math.abs(part.height) / 2, radius];
  }
  return null;
}

function rotationMatrix([x, y, z]) {
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

function worldAabb(part) {
  const half = localHalfExtents(part);
  const position = partPosition(part);
  const rotation = partRotation(part);
  if (!half || !finiteVector(position, 3) || !finiteVector(rotation, 3)) return null;
  if (part.type === 'hull_polyhedron') {
    const longX = Math.abs(Math.sin(rotation[1])) > 0.7;
    const size = longX
      ? [part.dimensions[2], part.dimensions[1], part.dimensions[0]]
      : [part.dimensions[0], part.dimensions[1], part.dimensions[2]];
    return {
      min: [position[0]-size[0]/2, position[1], position[2]-size[2]/2],
      max: [position[0]+size[0]/2, position[1]+size[1], position[2]+size[2]/2],
      size,
      center: [position[0], position[1]+size[1]/2, position[2]],
    };
  }
  if (part.type === 'hemisphere_dome' && Math.abs(rotation[0]) < 0.1 && Math.abs(rotation[2]) < 0.1) {
    const [rx, ry, rz] = part.radii;
    return {
      min:[position[0]-rx,position[1],position[2]-rz],
      max:[position[0]+rx,position[1]+ry,position[2]+rz],
      size:[rx*2,ry,rz*2],
      center:[position[0],position[1]+ry/2,position[2]],
    };
  }
  const matrix = rotationMatrix(rotation);
  const extent = [0, 1, 2].map((row) =>
    Math.abs(matrix[row * 3]) * half[0]
      + Math.abs(matrix[row * 3 + 1]) * half[1]
      + Math.abs(matrix[row * 3 + 2]) * half[2]);
  return {
    min: position.map((value, axis) => value - extent[axis]),
    max: position.map((value, axis) => value + extent[axis]),
    size: extent.map((value) => value * 2),
    center: position.slice(0, 3),
  };
}

function unionAabb(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  const min = [0, 1, 2].map((axis) => Math.min(...valid.map((box) => box.min[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...valid.map((box) => box.max[axis])));
  return { min, max, size: min.map((value, axis) => max[axis] - value) };
}

function aabbGap(a, b) {
  return Math.hypot(...[0, 1, 2].map((axis) => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis])));
}

function overlapSize(a, b) {
  return [0, 1, 2].map((axis) => Math.max(0, Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis])));
}

function volume(box) {
  return box.size.reduce((product, value) => product * Math.max(0, value), 1);
}

function pairStem(name) {
  return name.toLowerCase()
    .replace(/(^|[_\s-])(starboard|port|right|left)(?=$|[_\s-])/g, '$1{side}')
    .replace(/[_\s-]+/g, '_');
}

function sideOf(name) {
  if (/(^|[_\s-])(starboard|right)(?=$|[_\s-])/i.test(name)) return 1;
  if (/(^|[_\s-])(port|left)(?=$|[_\s-])/i.test(name)) return -1;
  return 0;
}

function issue(list, severity, code, part, detail, fix) {
  list.push({ severity, code, part: part?.name ?? null, detail, fix });
}

function validatePartShape(part, issues) {
  const position = partPosition(part);
  const rotation = partRotation(part);
  if (!finiteVector(position, 3) || !finiteVector(rotation, 3)) {
    issue(issues, 'error', 'INVALID_TRANSFORM', part, '位置或旋轉不是三個有限數值。', '重建 transform，統一使用公尺與弧度。');
    return null;
  }
  const box = worldAabb(part);
  if (!box || box.size.some((value) => !Number.isFinite(value) || value <= 0)) {
    issue(issues, 'error', 'INVALID_DIMENSIONS', part, 'primitive 缺少合法正尺寸。', '依 primitive schema 補齊 dimensions/radii/height。');
    return null;
  }
  const sorted = [...box.size].sort((a, b) => a - b);
  const isSurfaceDetail = DETAIL_RE.test(part.name);
  if (sorted[0] < 0.015 || (!isSurfaceDetail && sorted[0] / sorted[2] < 0.0015)) {
    issue(issues, isSurfaceDetail ? 'warn' : 'error', 'DEGENERATE_THIN', part,
      `旋轉後尺寸 ${box.size.map((value) => value.toFixed(3)).join('×')}m，接近零厚度。`,
      '改用具實體厚度的 box/frustum/wedge，細節厚度至少 0.02m。');
  }
  const rotationMagnitude = partRotation(part).reduce((sum, value) => sum + Math.abs(value), 0);
  if (part.type === 'cylinder' && /(gun|cannon|barrel|propeller_?shaft)/i.test(part.name) && rotationMagnitude < 0.1) {
    issue(issues, 'error', 'WRONG_DIRECTIONAL_PART', part,
      '方向性圓柱仍沿預設 Y 軸，未朝船艏或艉軸。', '由命名 muzzle/shaft joint 計算端點向量，再用 atan2 對準長軸。');
  }
  if (part.type === 'cylinder' && /(mast|funnel|stack|support|pillar)/i.test(part.name) && box.size[1] < Math.max(box.size[0], box.size[2]) * 0.8) {
    issue(issues, 'error', 'WRONG_DIRECTIONAL_PART', part,
      '應垂直的桅杆／煙囪圓柱未沿 Y 軸。', '由 deck joint 垂直向上建構，避免套用船體整體旋轉兩次。');
  }
  return box;
}

function validateFaceWinding(model, parts, issues) {
  const vertices = model.meshData?.vertices;
  const faces = model.meshData?.faces;
  if (!Array.isArray(vertices) || !Array.isArray(faces)) return;
  let faceOffset = 0;
  for (const part of parts) {
    const triangleCount = Number.isInteger(part.triangles) ? part.triangles : 0;
    const faceEnd = Math.min(faces.length, faceOffset + triangleCount * 3);
    if (WINDING_AUDIT_TYPES.has(part.type)) {
      const origin = partPosition(part);
      let inward = 0;
      let valid = 0;
      for (let index = faceOffset; index + 2 < faceEnd; index += 3) {
        const ia = faces[index] * 3, ib = faces[index + 1] * 3, ic = faces[index + 2] * 3;
        const ax = vertices[ia], ay = vertices[ia + 1], az = vertices[ia + 2];
        const abx = vertices[ib] - ax, aby = vertices[ib + 1] - ay, abz = vertices[ib + 2] - az;
        const acx = vertices[ic] - ax, acy = vertices[ic + 1] - ay, acz = vertices[ic + 2] - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const area2 = Math.hypot(nx, ny, nz);
        if (area2 < 1e-9) continue;
        const cx = (ax + vertices[ib] + vertices[ic]) / 3 - origin[0];
        const cy = (ay + vertices[ib + 1] + vertices[ic + 1]) / 3 - origin[1];
        const cz = (az + vertices[ib + 2] + vertices[ic + 2]) / 3 - origin[2];
        valid += 1;
        if ((nx * cx + ny * cy + nz * cz) < -area2 * 1e-7) inward += 1;
      }
      if (inward) {
        issue(issues, 'error', 'INWARD_FACE', part,
          `零件有 ${inward}/${valid} 個三角面朝內，FrontSide 材質由外側觀看會透明。`,
          '交換錯誤三角面的第二、第三頂點，維持 FrontSide 與正確外向光照。');
      }
    }
    faceOffset = faceEnd;
  }
}

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
}

function validateSheets(parts, boxes, issues) {
  const supports = parts.filter((part)=>!DETAIL_RE.test(part.name) && /hull|deck|platform|superstructure|bridge|cabin|wheelhouse|island|hangar|sealed_/i.test(part.name));
  for (const part of parts.filter((candidate)=>SHEET_RE.test(candidate.name) && finiteVector(candidate.dimensions,3))) {
    const longest = Math.max(...part.dimensions);
    const thickness = Math.min(...part.dimensions);
    const glazing = /glass|window|windshield/i.test(part.name);
    const maxThickness = glazing ? Math.min(0.08,Math.max(0.025,longest*0.004)) : Math.min(0.045,Math.max(0.015,longest*0.002));
    if (thickness > maxThickness+0.002) {
      issue(issues,'error','SHEET_TOO_THICK',part,
        `片件厚 ${thickness.toFixed(3)}m，長邊 ${longest.toFixed(2)}m 的上限為 ${maxThickness.toFixed(3)}m。`,
        '以最短尺寸作厚度，玻璃上限 0.08m、標線上限 0.045m，貼於支撐面而非嵌成厚塊。');
    }
    if (!glazing || !supports.length) continue;
    const roomSupports = supports.filter(isCabinSupport);
    const pool = roomSupports.length ? roomSupports : supports;
    const support = pool.filter((candidate)=>candidate!==part && boxes.get(candidate))
      .sort((a,b)=>aabbGap(boxes.get(part),boxes.get(a))-aabbGap(boxes.get(part),boxes.get(b)))[0];
    if (!support) continue;
    const partBox = boxes.get(part), supportBox = boxes.get(support);
    const overlapY = Math.max(0,Math.min(partBox.max[1],supportBox.max[1])-Math.max(partBox.min[1],supportBox.min[1]));
    const minHeight = Math.max(0.001,Math.min(partBox.size[1],supportBox.size[1]));
    if (overlapY/minHeight < 0.5) {
      issue(issues,'error','SHEET_HEIGHT_MISMATCH',part,
        `玻璃與艙室 ${support.name} 的垂直重疊只有 ${(overlapY/minHeight*100).toFixed(1)}%。`,
        '沿艙室支撐面重新安裝玻璃，將中心高度夾在艙室上下緣之內。');
    }
    const mountGap = aabbGap(partBox,supportBox);
    if (mountGap > 0.05) {
      issue(issues,'error','SHEET_NOT_MOUNTED',part,
        `玻璃距艙室 ${support.name} ${mountGap.toFixed(3)}m。`,
        '玻璃沿艙室外向法線留 0.02–0.05m 表面間距，不可漂浮或誤貼船殼。');
    }
    const rotation = partRotation(part), supportRotation = partRotation(support);
    const mismatch = Math.max(...rotation.map((value,axis)=>angleDelta(value,supportRotation[axis])));
    if (mismatch > 0.08) {
      issue(issues,'error','SHEET_ANGLE_MISMATCH',part,
        `玻璃與最近支撐件 ${support.name} 的旋轉差 ${(mismatch*180/Math.PI).toFixed(1)}°。`,
        '沿支撐件局部表面法線放置玻璃，保留同一 Euler 基準，只以最短軸決定正面方向。');
    }
  }
}

function validateStackContainment(parts, boxes, issues, identity) {
  const carrier = /aircraft_carrier/i.test(identity);
  const twinHull = parts.filter((part)=>/^main_hull_(port|starboard)$/i.test(part.name)).length >= 2;
  const structural = parts.filter((part)=>(ROOM_RE.test(part.name) || DECK_RE.test(part.name)) && !DETAIL_RE.test(part.name));
  for (const child of structural) {
    if (/catamaran_bridge_tunnel/i.test(child.name)) continue;
    const childBox = boxes.get(child);
    if (!childBox) continue;
    const childCenterY = (childBox.min[1]+childBox.max[1])*0.5;
    const lower = parts.filter((part)=>part!==child && !DETAIL_RE.test(part.name) && boxes.get(part) && /hull|deck|platform|superstructure|bridge|cabin|wheelhouse|island|hangar|sealed_/i.test(part.name))
      .filter((part)=>(boxes.get(part).min[1]+boxes.get(part).max[1])*0.5 < childCenterY-0.01 && horizontalOverlapAudit(childBox,boxes.get(part))>0.001)
      .sort((a,b)=>boxes.get(b).max[1]-boxes.get(a).max[1]);
    const roomSupport = ROOM_RE.test(child.name) ? lower.find((part)=>isCabinSupport(part)
      && boxes.get(part).max[1] <= childBox.min[1]+0.08 && horizontalOverlapAudit(childBox,boxes.get(part))>0.35) : null;
    const baseSupport = /^main_deck$/i.test(child.name)
      ? lower.find((part)=>ROOT_RE.test(part.name))
      : ROOM_RE.test(child.name)
        ? lower.find((part)=>DECK_RE.test(part.name) || ROOT_RE.test(part.name))
        : lower[0];
    const support = roomSupport || baseSupport;
    if (!support) continue;
    const carrierDeckOverhang = carrier && DECK_RE.test(child.name) && /flight|landing|elevator|catwalk|ski_jump/i.test(child.name);
    const twinHullBridge = twinHull && /deck|platform|catamaran_bridge_tunnel/i.test(child.name);
    if (carrierDeckOverhang || twinHullBridge) continue;
    const supportBox = boxes.get(support);
    const tolerance = Math.max(0.03,Math.min(0.12,(supportBox.size[2]||0)*0.006));
    const overflow = Math.max(
      supportBox.min[0]-childBox.min[0],childBox.max[0]-supportBox.max[0],
      supportBox.min[2]-childBox.min[2],childBox.max[2]-supportBox.max[2],0,
    );
    if (overflow > tolerance) {
      issue(issues,'error',ROOM_RE.test(child.name) && roomSupport ? 'UPPER_ROOM_OVERHANG' : 'DECK_OR_ROOM_OVERHANG',child,
        `${child.name} 超出支撐件 ${support.name} ${overflow.toFixed(3)}m。`,
        '以支撐件水平包絡夾制中心與長寬；上層艙室逐層向內收束，僅航母飛行甲板可外挑。');
    }
  }
}

function horizontalOverlapAudit(a, b) {
  const x = Math.max(0,Math.min(a.max[0],b.max[0])-Math.max(a.min[0],b.min[0]));
  const z = Math.max(0,Math.min(a.max[2],b.max[2])-Math.max(a.min[2],b.min[2]));
  return x*z/Math.max(0.001,a.size[0]*a.size[2]);
}

function validatePairs(parts, boxes, issues, beam, lateralAxis) {
  const groups = new Map();
  for (const part of parts) {
    if (!sideOf(part.name)) continue;
    const key = pairStem(part.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(part);
  }
  for (const [stem, members] of groups) {
    if (/catwalk/i.test(stem)) continue;
    const port = members.find((part) => sideOf(part.name) < 0);
    const starboard = members.find((part) => sideOf(part.name) > 0);
    if (!port || !starboard) {
      issue(issues, 'error', 'MISSING_MIRROR', members[0], `${stem} 缺少另一舷對稱零件。`, '沿 Z=0 鏡射位置與對應旋轉。');
      continue;
    }
    const a = boxes.get(port), b = boxes.get(starboard);
    if (!a || !b) continue;
    const tolerance = Math.max(0.08, beam * 0.04);
    const sharedAxes = [0, 2].filter((axis) => axis !== lateralAxis);
    const mirrored = Math.abs(a.center[sharedAxes[0]] - b.center[sharedAxes[0]]) <= tolerance
      && Math.abs(a.center[1] - b.center[1]) <= tolerance
      && Math.abs(a.center[lateralAxis] + b.center[lateralAxis]) <= tolerance;
    if (!mirrored || Math.abs(a.center[lateralAxis] - b.center[lateralAxis]) < beam * 0.08) {
      issue(issues, 'error', 'BAD_MIRROR_TRANSFORM', port,
        `${port.name}/${starboard.name} 未以側向中心面正確鏡射。`, '共用一份局部尺寸，側向座標互為相反數，對應旋轉分量反號。');
    }
    const relativeSizeError = Math.max(...a.size.map((value, axis) => Math.abs(value - b.size[axis]) / Math.max(value, b.size[axis], 0.001)));
    if (relativeSizeError > 0.12) {
      issue(issues, 'warn', 'MIRROR_SIZE_MISMATCH', port,
        `${port.name}/${starboard.name} 尺寸差 ${(relativeSizeError * 100).toFixed(1)}%。`, '由同一參數列產生左右件，再保留明確的功能性不對稱。');
    }
  }
}

function validateAssembly(model, metadata) {
  const issues = [];
  const parts = Array.isArray(model.parts) ? model.parts : [];
  if (!parts.length) {
    issue(issues, 'error', 'NO_PARTS', null, '模型沒有 declarative parts。', '重新產生完整船體組件。');
    return { issues, envelope: null };
  }
  const boxes = new Map();
  for (const part of parts) boxes.set(part, validatePartShape(part, issues));
  validateFaceWinding(model, parts, issues);
  validateSheets(parts,boxes,issues);
  const envelope = unionAabb([...boxes.values()]);
  if (!envelope) return { issues, envelope };
  const longAxis = envelope.size[0] >= envelope.size[2] ? 0 : 2;
  const lateralAxis = longAxis === 0 ? 2 : 0;
  const length = envelope.size[longAxis];
  const beam = envelope.size[lateralAxis];
  const height = envelope.size[1];
  const tolerance = Math.max(0.08, length * 0.004);
  const identity = `${metadata.key ?? ''} ${metadata.style ?? ''} ${model.style ?? ''}`;
  validateStackContainment(parts,boxes,issues,identity);

  for (const interior of parts.filter((part)=>/cockpit_seating|seat_row_|open_interior|cabin_interior|bridge_interior/i.test(part.name))) {
    issue(issues, 'error', 'OPEN_CABIN', interior,
      '艙室仍含可直接看見的內裝或開放座艙。', '移除內裝透視，並以封閉 box/tapered_box 包覆至頂板與甲板。');
  }
  const structuralRoom = /cabin|bridge|superstructure|sealed_/i;
  const roomDetail = /window|glass|roof|deck|wing|mast|radar/i;
  for (const roof of parts.filter((part)=>/^(canopy_roof|roof_canopy|rear_canopy_roof)$/i.test(part.name))) {
    const roofBox = boxes.get(roof);
    const closed = parts.some((part)=>part!==roof && boxes.get(part) && structuralRoom.test(part.name)
      && (!roomDetail.test(part.name) || /^sealed_/i.test(part.name))
      && overlapSize(roofBox,boxes.get(part))[0]*overlapSize(roofBox,boxes.get(part))[2]
        >= roofBox.size[0]*roofBox.size[2]*0.50
      && boxes.get(part).min[1]<roofBox.min[1]
      && boxes.get(part).max[1]>=roofBox.min[1]-0.08);
    if (!closed) issue(issues, 'error', 'OPEN_CABIN', roof,
      '頂篷下方沒有連續封閉艙壁，可從側面透視內部。', '由甲板支撐面補到頂篷底面，使用四側封閉的 tapered_box 艙體。');
  }
  const glazing = parts.filter((part)=>/windshield|canopy_glass|side_window_(left|right|port|starboard)/i.test(part.name));
  const opaqueRoom = parts.some((part)=>structuralRoom.test(part.name)
    && (!roomDetail.test(part.name) || /^sealed_/i.test(part.name)));
  if (glazing.length && !opaqueRoom) issue(issues, 'error', 'OPEN_CABIN', glazing[0],
    '玻璃或擋風板後方沒有不透明封閉艙體，可透視座艙內部。', '以封閉 tapered_box 從甲板包覆至玻璃頂緣。');

  if (longAxis !== 0 || length < beam * 1.35) {
    issue(issues, 'error', 'WRONG_LONGITUDINAL_AXIS', null,
      `外包尺寸 X=${envelope.size[0].toFixed(2)}m、Z=${envelope.size[2].toFixed(2)}m，長軸未沿 canonical X。`, '將整船統一轉向 +X，圓柱船體通常需繞 Z 旋轉 90°。');
  }
  if (envelope.min[1] < -0.05 || envelope.min[1] > 0.08) {
    issue(issues, 'error', 'BAD_GROUND_SEATING', null,
      `最低點 y=${envelope.min[1].toFixed(3)}m，未貼齊 y=0。`, '整體平移 -minY；再調整旋轉船艏，禁止用負 y 穿地補縫。');
  }

  const roots = parts.filter((part) => ROOT_RE.test(part.name) && boxes.get(part));
  const structuralRoots = roots.length ? roots : parts.filter((part) => /hull/i.test(part.name) && boxes.get(part));
  if (!structuralRoots.length) {
    issue(issues, 'error', 'NO_HULL_ROOT', null, '找不到主船體根零件。', '提供 main_hull 或 hull_base 作為所有組件的共同根。');
  } else {
    const hullBox = unionAabb(structuralRoots.map((part) => boxes.get(part)));
    const centreOffset = Math.abs((hullBox.min[lateralAxis] + hullBox.max[lateralAxis]) / 2);
    const sideMismatch = Math.abs(Math.abs(hullBox.min[lateralAxis]) - Math.abs(hullBox.max[lateralAxis]));
    if (centreOffset > beam * 0.04 || sideMismatch > beam * 0.08) {
      issue(issues, 'error', 'ASYMMETRIC_HULL', null,
        `主船體左右邊界 ${hullBox.min[lateralAxis].toFixed(2)} / ${hullBox.max[lateralAxis].toFixed(2)}m。`, '主船體以側向零平面為中心，先完成對稱殼體再加功能性不對稱附件。');
    }
    if (hullBox.size[longAxis] < hullBox.size[lateralAxis] * 1.5) {
      issue(issues, 'error', 'HULL_AXIS_OR_SCALE', null, '主船體本身不像沿 X 延伸的船殼。', '交換錯置的長/寬尺寸或修正旋轉。');
    }
  }

  const bowParts = parts.filter((part) => /bow|bulbous/i.test(part.name) && !/mast|deck|rail/i.test(part.name) && boxes.get(part));
  for (const bow of bowParts) {
    const box = boxes.get(bow);
    if (box.center[longAxis] < envelope.min[longAxis] + length * 0.52) {
      issue(issues, 'error', 'BOW_POINTS_AFT', bow,
        `船艏中心 ${longAxis === 0 ? 'x' : 'z'}=${box.center[longAxis].toFixed(2)}m，未位於長軸正向前半部。`, '船艏統一指向長軸正向；轉入 canonical +X 時一併修正。');
    }
  }
  const submarine = /submarine/i.test(identity);
  if (submarine) {
    for (const part of parts) {
      if (EXTERNAL_SUBMARINE_OBJECT_RE.test(part.name)) {
        issue(issues, 'error', 'EXTERNAL_SUBMARINE_OBJECT', part,
          `偵測到非潛艦本體零件「${part.name}」。`, '照片中的發射物、武器或載荷不得併入潛艦自身模型。');
      }
    }
  }
  if (!submarine && !parts.some((part) => TAPER_RE.test(part.name) || part.type === 'hull_polyhedron')) {
    issue(issues, 'error', 'NO_HULL_TAPER', null, '船體沒有可辨識的艏艉收束多面體。', '在主船體兩端接 wedge/frustum；艏端較尖、艉端較平。');
  }
  const mainHullBoxes = structuralRoots.filter((part) => /box/.test(part.type));
  if (!submarine && mainHullBoxes.length && !parts.some((part) => TAPER_RE.test(part.name) && part.type !== 'box')) {
    issue(issues, 'warn', 'BOX_ONLY_HULL_PROFILE', mainHullBoxes[0],
      '主船體是長方體，端部沒有非 box 收束體。', '以中心箱體 + 艏 wedge + 艉 frustum 組成連續水線輪廓。');
  }

  if (!submarine && structuralRoots.length) {
    const hullBox = unionAabb(structuralRoots.map((part)=>boxes.get(part)));
    const minimumRatio = /LNG|methan/i.test(identity) ? 0.070 : /bulk|container|cargo/i.test(identity) ? 0.055 : 0.045;
    const ratio = hullBox.size[1]/Math.max(0.001,length);
    if (ratio < minimumRatio) {
      issue(issues,'error','FLAT_HULL',structuralRoots[0],
        `船殼深度／船長 ${(ratio*100).toFixed(2)}%，低於此船型 ${(minimumRatio*100).toFixed(1)}%。`,
        '提高 hull_polyhedron 型深並連帶抬升甲板支撐鏈；LNG 船殼至少為船長 7%。');
    }
  }

  validatePairs(parts, boxes, issues, beam, lateralAxis);

  const primaryRoot = structuralRoots.reduce((largest, part) =>
    !largest || volume(boxes.get(part)) > volume(boxes.get(largest)) ? part : largest, null);
  const rootSet = new Set(primaryRoot ? [primaryRoot] : []);
  const connected = new Set(rootSet);
  const joinTolerance = Math.min(0.08,Math.max(0.035,length*0.00025));
  let changed = true;
  while (changed) {
    changed = false;
    for (const part of parts) {
      if (connected.has(part) || !boxes.get(part)) continue;
      if ([...connected].some((support) => boxes.get(support) && aabbGap(boxes.get(part), boxes.get(support)) <= joinTolerance)) {
        connected.add(part);
        changed = true;
      }
    }
  }
  for (const part of parts) {
    const box = boxes.get(part);
    if (!box || rootSet.has(part)) continue;
    if (!connected.has(part)) {
      const nearest = Math.min(...[...connected].map((support) => aabbGap(box, boxes.get(support))));
      issue(issues, 'error', structuralRoots.includes(part) ? 'FLOATING_HULL_SEGMENT' : 'FLOATING_PART', part,
        `離支撐鏈最近仍有 ${nearest.toFixed(3)}m 間隙（公差 ${joinTolerance.toFixed(3)}m）。`, '用命名 joint 共用接合座標；桅杆/武器底面直接等於支撐面頂高。');
    }
  }

  for (let i = 0; i < parts.length; i += 1) {
    const a = parts[i], boxA = boxes.get(a);
    if (!boxA) continue;
    for (let j = i + 1; j < parts.length; j += 1) {
      const b = parts[j], boxB = boxes.get(b);
      if (!boxB) continue;
      const overlap = overlapSize(boxA, boxB);
      if (overlap.some((value) => value <= 0)) continue;
      const overlapVolume = overlap.reduce((product, value) => product * value, 1);
      const ratio = overlapVolume / Math.max(0.001, Math.min(volume(boxA), volume(boxB)));
      const intentionalLayer = (HULL_LAYER_RE.test(a.name) && HULL_LAYER_RE.test(b.name))
        || DETAIL_RE.test(a.name) || DETAIL_RE.test(b.name)
        || /cradle/i.test(a.name) || /cradle/i.test(b.name);
      if (ratio > 0.72 && !intentionalLayer && (MAJOR_RE.test(a.name) || STACK_RE.test(a.name)) && (MAJOR_RE.test(b.name) || STACK_RE.test(b.name))) {
        issue(issues, 'warn', 'EXCESSIVE_INTERSECTION', a,
          `${a.name}/${b.name} 約 ${(ratio * 100).toFixed(0)}% 體積互穿。`, '將兩件改為共面相接，或用較貼形的 wedge/frustum 取代包覆 box。');
      }
    }
  }

  if (!Number.isFinite(length) || length < 2.5 || length > 450 || beam < 0.7 || height < 0.3) {
    issue(issues, 'error', 'IMPLAUSIBLE_SCALE', null,
      `整船長高寬 ${length.toFixed(2)}×${height.toFixed(2)}×${beam.toFixed(2)}m 不合理。`, '依照片船型重新標定真實公尺尺度。');
  }
  return { issues, envelope };
}

function loadEntries() {
  if (!fs.existsSync(SHIP_ROOT)) throw new Error(`找不到船體資料夾：${SHIP_ROOT}`);
  const catalogDirs = new Set();
  if (!args.has('--all-candidates')) {
    const database = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'out', '3d_database.json'), 'utf8'));
    const rows = Array.isArray(database) ? database : database.items ?? database.models ?? [];
    for (const row of rows.filter((item) => item.family === 'ship')) catalogDirs.add(path.basename(row.outputDir));
  }
  const entries = [];
  for (const directory of fs.readdirSync(SHIP_ROOT).sort()) {
    if (catalogDirs.size && !catalogDirs.has(directory)) continue;
    const modelPath = path.join(SHIP_ROOT, directory, 'model.json');
    const metadataPath = path.join(SHIP_ROOT, directory, 'metadata.json');
    if (!fs.existsSync(modelPath) || !fs.existsSync(metadataPath)) continue;
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (wantedVersion !== 'all' && metadata.verStr !== wantedVersion) continue;
    if (wantedKey && !`${metadata.key ?? ''} ${metadata.id ?? ''} ${directory}`.includes(wantedKey)) continue;
    entries.push({ directory, model, metadata });
  }
  if (!args.has('--unique-source')) return entries;
  const unique = new Map();
  for (const entry of entries) {
    const identity = entry.metadata.source_image ?? entry.metadata.key ?? entry.directory;
    const current = unique.get(identity);
    if (!current || (entry.metadata.similarityScore ?? -1) > (current.metadata.similarityScore ?? -1)) unique.set(identity, entry);
  }
  return [...unique.values()];
}

function entryId(entry) {
  return entry.metadata.key ?? entry.metadata.id ?? entry.directory;
}

function injectBreak(entries) {
  if (!entries.length) throw new Error('--break-* 找不到適用模型。');
  const markers = [];
  if (args.has('--break-degenerate')) {
    const entry = entries.find((candidate) => (candidate.model.parts ?? []).some((part) => finiteVector(part.dimensions, 3)));
    const part = entry?.model.parts.find((candidate) => finiteVector(candidate.dimensions, 3));
    if (!entry || !part) throw new Error('--break-degenerate 找不到 dimensions primitive。');
    part.dimensions[1] = 0.00001;
    markers.push({ entryId: entryId(entry), partName: part.name, expectedCode: 'DEGENERATE_THIN' });
  }
  if (args.has('--break-floating')) {
    let selected = null;
    for (const entry of entries) {
      const baseline = validateAssembly(entry.model, entry.metadata);
      const alreadyFloating = new Set(baseline.issues.filter((item) => item.code === 'FLOATING_PART').map((item) => item.part));
      const part = (entry.model.parts ?? []).find((candidate) => !ROOT_RE.test(candidate.name) && !alreadyFloating.has(candidate.name));
      if (part) {
        selected = { entry, part };
        break;
      }
    }
    if (!selected) throw new Error('--break-floating 找不到原本已接合的非船體零件。');
    const { entry, part } = selected;
    const position = part.position ?? part.pos;
    if (!finiteVector(position, 3)) throw new Error('--break-floating 選中的零件沒有合法位置。');
    position[1] += 1000;
    markers.push({ entryId: entryId(entry), partName: part.name, expectedCode: 'FLOATING_PART' });
  }
  if (args.has('--break-open')) {
    const entry = entries.find((candidate)=>(candidate.model.parts ?? []).length);
    if (!entry) throw new Error('--break-open 找不到可注入開放座艙的模型。');
    const part = { name:'cockpit_seating_break_case', type:'box', dimensions:[1,0.4,1], position:[0,2,0], rotation:[0,0,0] };
    entry.model.parts.push(part);
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'OPEN_CABIN' });
  }
  if (args.has('--break-external')) {
    const entry = entries.find((candidate) => /submarine/i.test(`${candidate.metadata.key} ${candidate.model.style}`));
    if (!entry) throw new Error('--break-external 找不到潛艦模型。');
    const part = { name:'external_torpedo_break_case', type:'cylinder', sides:8, radii:[0.5,0.5], height:2, position:[0,1,0], rotation:[0,0,0] };
    entry.model.parts.push(part);
    brokeExternal = true;
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'EXTERNAL_SUBMARINE_OBJECT' });
  }
  if (args.has('--break-winding')) {
    let selected = null;
    for (const entry of entries) {
      const faces = entry.model.meshData?.faces;
      if (!Array.isArray(faces)) continue;
      let faceOffset = 0;
      for (const part of entry.model.parts ?? []) {
        if (WINDING_AUDIT_TYPES.has(part.type) && Number.isInteger(part.triangles) && part.triangles > 0) {
          selected = { entry, part, faces, faceOffset };
          break;
        }
        faceOffset += (part.triangles ?? 0) * 3;
      }
      if (selected) break;
    }
    if (!selected) throw new Error('--break-winding 找不到可反轉的封閉 primitive。');
    const { entry, part, faces, faceOffset } = selected;
    [faces[faceOffset + 1], faces[faceOffset + 2]] = [faces[faceOffset + 2], faces[faceOffset + 1]];
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'INWARD_FACE' });
  }
  if (args.has('--break-fit')) {
    const entry = entries.find((candidate)=>!(/aircraft_carrier/i.test(`${candidate.metadata.key} ${candidate.model.style}`))
      && (candidate.model.parts ?? []).some((part)=>DECK_RE.test(part.name) && finiteVector(part.dimensions,3)));
    const part = entry?.model.parts.find((candidate)=>DECK_RE.test(candidate.name) && finiteVector(candidate.dimensions,3));
    if (!entry || !part) throw new Error('--break-fit 找不到可放大越界的甲板或艙室。');
    part.dimensions[0] *= 8;
    part.dimensions[2] *= 8;
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'DECK_OR_ROOM_OVERHANG' });
  }
  if (args.has('--break-upper-fit')) {
    let entry = null, part = null, support = null;
    for (const candidate of entries) {
      const rooms = (candidate.model.parts ?? []).filter((room)=>isCabinSupport(room) && finiteVector(room.dimensions,3));
      const boxes = new Map(rooms.map((room)=>[room,worldAabb(room)]));
      part = rooms.find((upper)=> {
        support = rooms.find((lower)=>lower!==upper && boxes.get(lower) && boxes.get(upper)
          && boxes.get(lower).max[1] <= boxes.get(upper).min[1]+0.08
          && horizontalOverlapAudit(boxes.get(upper),boxes.get(lower))>0.35) || null;
        return support;
      });
      if (part) { entry = candidate; break; }
    }
    if (!entry || !part || !support) throw new Error('--break-upper-fit 找不到至少兩層艙室的模型。');
    const upperBox = worldAabb(part), lowerBox = worldAabb(support);
    const position = part.position ?? part.pos;
    const axis = upperBox.size[0] <= upperBox.size[2] ? 0 : 2;
    position[axis] += lowerBox.max[axis]-upperBox.max[axis]+upperBox.size[axis]*0.2;
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'UPPER_ROOM_OVERHANG' });
  }
  if (args.has('--break-sheet')) {
    const entry = entries.find((candidate)=>(candidate.model.parts ?? []).some((part)=>SHEET_RE.test(part.name) && finiteVector(part.dimensions,3)));
    const part = entry?.model.parts.find((candidate)=>SHEET_RE.test(candidate.name) && finiteVector(candidate.dimensions,3));
    if (!entry || !part) throw new Error('--break-sheet 找不到片狀零件。');
    const longest = Math.max(...part.dimensions);
    const thinAxis = part.dimensions.indexOf(Math.min(...part.dimensions));
    part.dimensions[thinAxis] = longest*0.5;
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'SHEET_TOO_THICK' });
  }
  if (args.has('--break-sheet-angle')) {
    const entry = entries.find((candidate)=>(candidate.model.parts ?? []).some((part)=>/glass|window|windshield/i.test(part.name)));
    const part = entry?.model.parts.find((candidate)=>/glass|window|windshield/i.test(candidate.name));
    if (!entry || !part) throw new Error('--break-sheet-angle 找不到玻璃零件。');
    const rotation = part.rotation ?? part.rot;
    if (!finiteVector(rotation,3)) throw new Error('--break-sheet-angle 玻璃缺少旋轉。');
    rotation[0] += 0.7;
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'SHEET_ANGLE_MISMATCH' });
  }
  if (args.has('--break-sheet-height')) {
    const entry = entries.find((candidate)=>(candidate.model.parts ?? []).some((part)=>/glass|window|windshield/i.test(part.name)));
    const part = entry?.model.parts.find((candidate)=>/glass|window|windshield/i.test(candidate.name));
    if (!entry || !part) throw new Error('--break-sheet-height 找不到玻璃零件。');
    const position = part.position ?? part.pos;
    if (!finiteVector(position,3)) throw new Error('--break-sheet-height 玻璃缺少位置。');
    position[1] += 100;
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'SHEET_HEIGHT_MISMATCH' });
  }
  if (args.has('--break-flat')) {
    const entry = entries.find((candidate)=>/LNG|methan/i.test(`${candidate.metadata.key} ${candidate.model.style}`)
      && (candidate.model.parts ?? []).some((part)=>part.type==='hull_polyhedron'));
    const part = entry?.model.parts.find((candidate)=>candidate.type==='hull_polyhedron');
    if (!entry || !part) throw new Error('--break-flat 找不到 LNG hull_polyhedron。');
    part.dimensions[1] = 0.01;
    markers.push({ entryId:entryId(entry), partName:part.name, expectedCode:'FLAT_HULL' });
  }
  return markers;
}

const entries = loadEntries();
const breakMarkers = injectBreak(entries);
if (args.has('--break-external') && !brokeExternal) throw new Error('--break-external 未找到可注入潛艦外部物件的模型。');
const results = entries.map((entry) => ({
  id: entryId(entry),
  version: entry.metadata.verStr ?? 'unknown',
  source: entry.metadata.source_image ?? null,
  ...validateAssembly(entry.model, entry.metadata),
}));

const allIssues = results.flatMap((result) => result.issues);
const summary = {
  ships: results.length,
  clean: results.filter((result) => result.issues.length === 0).length,
  errors: allIssues.filter((item) => item.severity === 'error').length,
  warnings: allIssues.filter((item) => item.severity === 'warn').length,
  byCode: Object.fromEntries([...new Set(allIssues.map((item) => item.code))].sort().map((code) => [code, allIssues.filter((item) => item.code === code).length])),
};
const repairRules = Object.fromEntries([...new Set(allIssues.map((item) => item.code))].sort().map((code) => [
  code,
  allIssues.find((item) => item.code === code)?.fix,
]));

for (const marker of breakMarkers) {
  const result = results.find((item) => item.id === marker.entryId);
  const caught = result?.issues.some((item) => item.code === marker.expectedCode && item.part === marker.partName);
  if (!caught) throw new Error(`${marker.expectedCode} 反向壞例 ${marker.partName} 未被對應斷言攔截。`);
}

if (jsonOutput) {
  console.log(JSON.stringify({ summary, repairRules, results }, null, 2));
} else {
  console.log(`船體組裝稽核：${summary.ships} 艘，乾淨 ${summary.clean}，錯誤 ${summary.errors}，警告 ${summary.warnings}`);
  console.log(`缺陷分布：${Object.entries(summary.byCode).map(([code, count]) => `${code}=${count}`).join('、') || '無'}`);
  console.log('可機械修復規則：');
  for (const [code, fix] of Object.entries(repairRules)) console.log(`  ${code}: ${fix}`);
  if (!quiet) {
    for (const result of results.filter((item) => item.issues.length)) {
      console.log(`\n[${result.version}] ${result.id}`);
      for (const item of result.issues) {
        console.log(`  ${item.severity === 'error' ? '錯' : '警'} ${item.code}${item.part ? ` (${item.part})` : ''}: ${item.detail}`);
        console.log(`      修復：${item.fix}`);
      }
    }
  }
}

if (summary.errors > 0 && !args.has('--no-fail')) process.exitCode = 1;
