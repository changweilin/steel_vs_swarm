// 背景物件的決定性組裝縫：指定主結構 → 逐角色挑一組葉零件 → 子類別配色抽樣。
// NPC、戰鬥建築與玩家機甲不引用本檔；它們各自保留權威 Rig / 碰撞 / 動畫契約。
import { RUNTIME_BACKGROUND_CATALOG, RUNTIME_PARTS } from './runtimeParts.js';

export const BACKGROUND_VARIANTS_PER_TARGET = 4;

const entries = new Map(Object.values(RUNTIME_PARTS).flat().map((entry) => [entry.key, entry]));
const finite3 = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function hash32(value, salt = '') {
  let h = 0x811c9dc5;
  const text = `${value}|${salt}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

const pick = (rows, seed, salt) => rows[hash32(seed, salt) % rows.length];
const clonePart = (part) => Object.fromEntries(Object.entries(part).map(([key, value]) => (
  [key, Array.isArray(value) ? [...value] : value]
)));

function colorKeyForRole(role) {
  if (role === 'roof' || role === 'canopy') return 'roof';
  if (role === 'glass') return 'glass';
  if (role === 'body') return 'facade';
  if (role === 'trunk' || role === 'rock_mass') return 'base';
  if (['wheel_tire', 'wheel_rim', 'wheel', 'overlay'].includes(role)) return 'dark';
  if (['lamp', 'trim', 'mirror', 'rail', 'door', 'stair', 'antenna', 'branch'].includes(role)) return 'accent';
  return 'bright';
}

function decorate(part, role) {
  const out = clonePart(part);
  if (!out.colorKey) out.colorKey = colorKeyForRole(role);
  return out;
}

function boundsFrame(bounds) {
  const min = bounds?.min;
  const size = bounds?.size;
  if (!finite3(min) || !finite3(size) || size.some((value) => value <= 0)) return null;
  return { min, size, center: min.map((value, axis) => value + size[axis] * 0.5) };
}

/** 將另一成員的完整葉組等比例移植到目標主結構；位置按包絡三軸對應，形狀只等比縮放。 */
function remapLeaf(part, role, sourceBounds, targetBounds) {
  const out = decorate(part, role);
  const source = boundsFrame(sourceBounds);
  const target = boundsFrame(targetBounds);
  if (!source || !target || !finite3(out.position)) return out;
  const ratios = target.size.map((value, axis) => value / source.size[axis]);
  const uniform = Math.min(...ratios);
  out.position = out.position.map((value, axis) => (
    target.center[axis] + (value - source.center[axis]) * ratios[axis]
  ));
  if (Array.isArray(out.dimensions)) out.dimensions = out.dimensions.map((value) => value * uniform);
  if (Array.isArray(out.radii)) out.radii = out.radii.map((value) => value * uniform);
  for (const field of ['radius', 'height', 'tube']) {
    if (Number.isFinite(out[field])) out[field] *= uniform;
  }
  return out;
}

function paletteColors(row) {
  if (row.colors) return row.colors;
  const source = entries.get(row.sourceKey);
  const palette = source?.palettes?.[row.paletteIndex];
  return palette?.colors || palette || null;
}

function catalogTarget(targetKey) {
  const ref = RUNTIME_BACKGROUND_CATALOG.objects[targetKey];
  if (!ref) throw new RangeError(`背景物件主結構不在型錄:${targetKey}`);
  const subcategory = RUNTIME_BACKGROUND_CATALOG.subcategories[ref.subcategoryId];
  const structure = subcategory?.structures.find((row) => row.id === ref.structureId);
  const target = structure?.members.find((row) => row.key === targetKey);
  if (!subcategory || !structure || !target) throw new Error(`背景物件型錄索引斷裂:${targetKey}`);
  return { subcategory, structure, target };
}

/**
 * 以穩定 seed 產生一個背景物件描述子。相同 targetKey + seed 恆得到同一組零件與配色；
 * seed 先量化成固定變體數，讓渲染端仍可按成品 key 合批。
 */
export function generateBackgroundObject(targetKey, seed = 0) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('背景物件 seed 必須是安全整數');
  const targetEntry = entries.get(targetKey);
  if (!targetEntry) throw new RangeError(`背景物件主結構缺少執行期資料:${targetKey}`);
  const { subcategory, structure, target } = catalogTarget(targetKey);
  const variant = ((seed % BACKGROUND_VARIANTS_PER_TARGET) + BACKGROUND_VARIANTS_PER_TARGET)
    % BACKGROUND_VARIANTS_PER_TARGET;
  const parts = target.mainParts.map(({ index, role }) => decorate(targetEntry.parts[index], role));
  const sources = {};
  // 主結構目標自己的角色分支就是插槽名冊；別的成員多出的獨有配件不能憑空長到成品上。
  const roles = target.leafRoles.map((row) => row.role).sort();
  for (const role of roles) {
    const choices = structure.members.flatMap((member) => member.leafRoles
      .filter((row) => row.role === role)
      .map((row) => ({ member, row })));
    if (!choices.length) continue;
    const choice = pick(choices, variant, `${targetKey}:leaf:${role}`);
    const sourceEntry = entries.get(choice.member.key);
    if (!sourceEntry) throw new Error(`背景葉節點缺少來源:${choice.member.key}`);
    sources[role] = choice.member.key;
    for (const index of choice.row.partIndexes) {
      parts.push(remapLeaf(sourceEntry.parts[index], role, choice.member.bounds, target.bounds));
    }
  }

  const paletteRow = subcategory.palettes.length
    ? pick(subcategory.palettes, variant, `${targetKey}:palette`)
    : null;
  const colors = paletteRow ? paletteColors(paletteRow) : null;
  const palette = colors ? [{ id: paletteRow.id, name: paletteRow.id, colors }] : [];
  return {
    ...targetEntry,
    key: `${targetKey}#background-${variant}`,
    canonicalTarget: targetEntry.canonicalTarget,
    palettes: palette,
    parts,
    generation: {
      targetKey,
      structureId: structure.id,
      variant,
      mainPartCount: target.mainParts.length,
      leafSources: sources,
      paletteId: paletteRow?.id || null,
    },
  };
}

export function backgroundObjectTargets(family = null) {
  return [...entries.values()].filter((entry) => !family || entry.family === family).map((entry) => entry.key);
}
