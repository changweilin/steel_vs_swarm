/**
 * AI3D 物件分類、功能拆件與替換資格的唯一縫。
 *
 * 分類與替換只看現實用途、工作介質、接合介面與材料語意；外觀、輪廓、顏色距離與 primitive
 * 相似度均不得成為替換資格。幾何相似度仍可服務渲染批次，但不得越過本檔的相容性閘門。
 */

export const CLASSIFICATION_SCHEMA_VERSION = 1;
export const UNKNOWN_TYPE = 'unresolved';

export const OBJECT_TYPES = Object.freeze({
  building: Object.freeze([
    'residential_detached', 'residential_multifamily', 'residential_row', 'mixed_use',
    'commercial_retail', 'commercial_office', 'hospitality', 'industrial_production',
    'industrial_storage', 'agricultural', 'civic_administrative', 'educational',
    'healthcare', 'religious', 'transportation_terminal', 'utility_service',
    'observation_landmark', UNKNOWN_TYPE,
  ]),
  landmark: Object.freeze([
    'commemorative_monument', 'ceremonial_gateway', 'observation_tower',
    'communications_tower', 'navigation_marker', 'public_art', 'industrial_landmark',
    'natural_landmark', 'office_landmark', 'religious_landmark',
    'museum_cultural_landmark', 'mixed_use_landmark', 'hospitality_landmark', UNKNOWN_TYPE,
  ]),
  rock: Object.freeze([
    'boulder', 'outcrop', 'monolith', 'tor', 'hoodoo', 'mesa', 'natural_arch',
    'columnar_basalt', 'stratified_slab', 'talus', 'collapse', 'dolmen_megalith',
    UNKNOWN_TYPE,
  ]),
  tree: Object.freeze([
    'broadleaf_tree', 'conifer_tree', 'palm_tree', 'shrub', 'snag',
    'buttressed_giant', 'sculptural_tree', UNKNOWN_TYPE,
  ]),
  ship: Object.freeze([
    'container_cargo', 'bulk_cargo', 'tanker', 'passenger_ferry', 'cruise_ship',
    'aircraft_carrier', 'surface_combatant', 'submarine', 'patrol_rescue',
    'tug_workboat', 'fishing_vessel', 'sail_vessel', 'landing_amphibious',
    'recreational_powerboat', 'research_vessel', 'offshore_support_vessel',
    'vehicle_carrier', UNKNOWN_TYPE,
  ]),
  vehicle: Object.freeze([
    'bicycle', 'motorcycle', 'passenger_car', 'bus', 'cargo_truck',
    'construction_vehicle', 'rail_vehicle', 'agricultural_vehicle', UNKNOWN_TYPE,
  ]),
});

export const FUNCTIONAL_ROLES = Object.freeze([
  'primary_structure', 'foundation_mount', 'enclosure_shell', 'weather_protection',
  'access', 'occupant_space', 'transparent_view', 'mobility_contact', 'suspension_support',
  'propulsion', 'power_source', 'transmission', 'steering_control', 'sensor_communication',
  'payload_support', 'work_equipment', 'cargo_volume', 'safety_protection',
  'visibility_signal', 'fluid_handling', 'thermal_exhaust', 'surface_finish',
  'root_anchor', 'trunk_support', 'branch_support', 'foliage_canopy',
  'geologic_mass', 'geologic_layer', 'weathering_overlay', 'unresolved_detail',
]);

export const PALETTE_SLOTS = Object.freeze([
  'structural', 'enclosure', 'roof_weathering', 'trim_identity', 'transparent',
  'emissive_signal', 'safety_marking', 'working_surface', 'natural_primary',
  'natural_secondary', 'weathering',
]);

export const DECOMPOSITION_RULES = Object.freeze({
  splitWhen: Object.freeze([
    '零件具有獨立現實功能或失效模式',
    '零件經明確接合介面安裝，現實中可拆卸或更換',
    '零件具有獨立運動、轉向、開闔或動畫自由度',
    '零件承擔不同碰撞、負載、工作介質或安全責任',
    '零件材料語意不同且不可共用配色槽，例如玻璃、燈具、輪胎與結構體',
    '零件是重複模組，但每個安裝槽必須獨立抽樣或保留左右手性',
  ]),
  keepTogetherWhen: Object.freeze([
    '只是同一製造件上的造型折面、凹凸或裝飾線',
    '拆分後沒有獨立功能、接合、運動、材料或替換意義',
    '只是照片陰影、反光、污漬或 YOLO 遮罩破碎造成的區塊',
    '拆分會把共同受力殼體切成沒有真實接縫的碎片',
  ]),
  requiredFields: Object.freeze([
    'role', 'function', 'interfaceFamily', 'kinematicClass', 'loadClass',
    'workingMedium', 'handedness', 'materialClass', 'paletteSlot', 'mountCount',
  ]),
});

export const INTERCHANGE_RULES = Object.freeze({
  object: Object.freeze([
    '物件必須屬於相同 objectType，或由明文 functionalProfile.compatibleTypes 授權',
    '用途、工作介質、操作方向與安全責任必須一致',
    '主結構、權威碰撞或遊戲語意不同時一律不可替換',
  ]),
  part: Object.freeze([
    'role 與 interfaceFamily 必須相同',
    'kinematicClass、loadClass、workingMedium 與 handedness 必須相容',
    '安裝點數與拓樸必須一致，尺寸只可在目標槽 envelope 內縮放',
    'materialClass 與 paletteSlot 必須保留；透明件、燈具、輪胎、葉冠不得被外殼色替代',
    '純視覺替換不得改變權威 collider、LOS 或地面接觸',
  ]),
  palette: Object.freeze([
    '物件的 paletteDomain 必須相同',
    '只可逐 semantic paletteSlot 對應，不可用色差或整張色票相似度判斷',
    'transparent、emissive_signal、safety_marking 與 working_surface 不得互換',
    '軍民、航海導航、宗教象徵與法定安全標記等 operationalMarking 不得跨域搬用',
  ]),
});

const allowed = (family, objectType) => OBJECT_TYPES[family]?.includes(objectType) === true;
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

export function validateClassification(row) {
  const issues = [];
  if (!row || typeof row !== 'object') return ['分類列不是物件'];
  if (!text(row.id)) issues.push('缺 id');
  if (!text(row.source?.corpus)) issues.push('缺 source.corpus');
  if (!text(row.source?.image)) issues.push('缺 source.image');
  if (!allowed(row.family, row.objectType)) issues.push(`不合法 family/objectType：${row.family}/${row.objectType}`);
  if (!text(row.subtype)) issues.push('缺 subtype');
  if (!text(row.paletteDomain)) issues.push('缺 paletteDomain');
  if (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) issues.push('confidence 必須介於 0 與 1');
  if (!Array.isArray(row.reasons) || !row.reasons.length) issues.push('缺功能判斷 reasons');
  for (const field of ['workingMedium', 'operationMode', 'safetyClass']) {
    if (!text(row.functionalProfile?.[field])) issues.push(`functionalProfile.${field} 缺值`);
  }
  if (!Array.isArray(row.functionalProfile?.compatibleTypes)) issues.push('functionalProfile.compatibleTypes 必須為陣列');
  if (!['decomposed', 'needs_decomposition'].includes(row.decompositionStatus)) issues.push('decompositionStatus 不合法');
  if (!Array.isArray(row.missingFunctionalParts)) issues.push('missingFunctionalParts 必須為陣列');
  if (!Array.isArray(row.operationalMarking)) issues.push('operationalMarking 必須為陣列');
  if (!Array.isArray(row.parts) || !row.parts.length) issues.push('缺功能零件 parts');
  for (const [index, part] of (row.parts || []).entries()) {
    if (!FUNCTIONAL_ROLES.includes(part.role)) issues.push(`parts[${index}].role 不合法`);
    for (const field of DECOMPOSITION_RULES.requiredFields) {
      if (field === 'mountCount') {
        if (!Number.isInteger(part.mountCount) || part.mountCount < 1) issues.push(`parts[${index}].mountCount 必須為正整數`);
      } else if (!text(part[field])) issues.push(`parts[${index}].${field} 缺值`);
    }
    if (!PALETTE_SLOTS.includes(part.paletteSlot)) issues.push(`parts[${index}].paletteSlot 不合法`);
  }
  return issues;
}

export function objectCompatibility(a, b) {
  const reasons = [];
  if (!a || !b) return { compatible: false, reasons: ['缺物件分類'] };
  const compatibleTypes = new Set([a.objectType, ...(a.functionalProfile?.compatibleTypes || [])]);
  if (!compatibleTypes.has(b.objectType)) reasons.push('objectType 未獲功能相容授權');
  for (const field of ['workingMedium', 'operationMode', 'safetyClass']) {
    if (text(a.functionalProfile?.[field]) !== text(b.functionalProfile?.[field])) reasons.push(`${field} 不同`);
  }
  return { compatible: reasons.length === 0, reasons };
}

export function partCompatibility(target, source) {
  const reasons = [];
  if (!target || !source) return { compatible: false, reasons: ['缺零件功能資料'] };
  for (const field of ['role', 'interfaceFamily', 'kinematicClass', 'loadClass', 'workingMedium', 'handedness']) {
    if (text(target[field]) !== text(source[field])) reasons.push(`${field} 不同`);
  }
  if (text(target.materialClass) !== text(source.materialClass)) reasons.push('materialClass 不同');
  if (text(target.paletteSlot) !== text(source.paletteSlot)) reasons.push('paletteSlot 不同');
  if (Number(target.mountCount || 0) !== Number(source.mountCount || 0)) reasons.push('安裝點數不同');
  return { compatible: reasons.length === 0, reasons };
}

export function paletteCompatibility(a, b) {
  const reasons = [];
  if (!a || !b) return { compatible: false, reasons: ['缺配色功能資料'] };
  if (text(a.paletteDomain) !== text(b.paletteDomain)) reasons.push('paletteDomain 不同');
  const aMarks = [...(a.operationalMarking || [])].sort().join('|');
  const bMarks = [...(b.operationalMarking || [])].sort().join('|');
  if (aMarks !== bMarks) reasons.push('operationalMarking 不同');
  const aSlots = new Set((a.parts || []).map((part) => part.paletteSlot));
  const bSlots = new Set((b.parts || []).map((part) => part.paletteSlot));
  for (const slot of aSlots) if (!bSlots.has(slot)) reasons.push(`來源缺少 ${slot} 配色槽`);
  return { compatible: reasons.length === 0, reasons };
}
