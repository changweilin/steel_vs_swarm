// 背景物件的決定性組裝縫：指定主結構 → 每個目標槽位獨立挑葉零件 → 子類別配色抽樣。
// NPC、戰鬥建築與玩家機甲不引用本檔；它們各自保留權威 Rig / 碰撞 / 動畫契約。
import { RUNTIME_BACKGROUND_CATALOG, RUNTIME_PARTS } from './runtimeParts.js';
import {
  eulerXYZFromMat3,
  mat3Apply,
  mat3FromEulerXYZ,
  mat3Multiply,
  mat3Transpose,
} from './partTransform.js';

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
const slotKey = (role, id) => `${role}:${id}`;

function requestedLeafChoice(choices, request) {
  if (!request || request.random) return null;
  const sourceKey = typeof request === 'string' ? request : request.sourceKey || request.key;
  const sourceSlotId = typeof request === 'string' ? null : request.sourceSlotId || request.slotId;
  if (!sourceKey) return null;
  return choices.find((choice) => choice.member.key === sourceKey
    && (!sourceSlotId || choice.slot.id === sourceSlotId)) || null;
}

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

/**
 * 把來源槽的零件群塞進目標槽包絡。槽中心與方向取自目標，因此接合點不受來源物件座標影響；
 * 槽內相對位置與尺寸一起縮放，疊層零件仍保持為同一個組件。
 */
function fitLeafSlot(part, role, sourceSlot, targetSlot) {
  const out = decorate(part, role);
  if (!finite3(sourceSlot?.center) || !finite3(sourceSlot?.size)
    || !finite3(targetSlot?.center) || !finite3(targetSlot?.size)
    || sourceSlot.size.some((value) => value <= 0) || targetSlot.size.some((value) => value <= 0)
    || !finite3(out.position)) return out;
  const ratios = targetSlot.size.map((value, axis) => value / sourceSlot.size[axis]);
  const sourceFrame = mat3FromEulerXYZ(sourceSlot.rotation);
  const targetFrame = mat3FromEulerXYZ(targetSlot.rotation);
  const sourceInverse = mat3Transpose(sourceFrame);
  const relativePosition = mat3Apply(sourceInverse,
    out.position.map((value, axis) => value - sourceSlot.center[axis]));
  const targetOffset = mat3Apply(targetFrame, relativePosition.map((value, axis) => value * ratios[axis]));
  out.position = targetSlot.center.map((value, axis) => value + targetOffset[axis]);
  const baseScale = finite3(out.scale) ? out.scale : [1, 1, 1];
  out.scale = baseScale.map((value, axis) => value * ratios[axis]);
  const partFrame = mat3FromEulerXYZ(out.rotation);
  out.rotation = eulerXYZFromMat3(mat3Multiply(targetFrame, mat3Multiply(sourceInverse, partFrame)));
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
 * options 只增加覆核台／工具需要的選擇，不改變未傳 options 時的遊戲路徑：
 *   partOverrides: { 'role:target-slot': { sourceKey, sourceSlotId } | { random: true } }
 *   randomParts: true、paletteId、randomPalette: true
 */
export function generateBackgroundObject(targetKey, seed = 0, options = {}) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('背景物件 seed 必須是安全整數');
  const targetEntry = entries.get(targetKey);
  if (!targetEntry) throw new RangeError(`背景物件主結構缺少執行期資料:${targetKey}`);
  const { subcategory, structure, target } = catalogTarget(targetKey);
  const settings = options && typeof options === 'object' ? options : {};
  const partOverrides = settings.partOverrides && typeof settings.partOverrides === 'object'
    ? settings.partOverrides : {};
  const variant = ((seed % BACKGROUND_VARIANTS_PER_TARGET) + BACKGROUND_VARIANTS_PER_TARGET)
    % BACKGROUND_VARIANTS_PER_TARGET;
  const parts = target.mainParts.map(({ index, role }) => decorate(targetEntry.parts[index], role));
  const sources = {};
  const slotSources = [];
  // 目標自己的槽位名冊固定成品接合點；來源只提供槽內零件，不得新增目標不存在的位置。
  for (const targetRole of target.leafRoles) {
    const choices = structure.members.flatMap((member) => member.leafRoles
      .filter((row) => row.role === targetRole.role)
      .flatMap((row) => row.slots.map((slot) => ({ member, slot }))));
    if (!choices.length) continue;
    sources[targetRole.role] = [];
    for (const targetSlot of targetRole.slots) {
      const override = partOverrides[slotKey(targetRole.role, targetSlot.id)];
      const choice = requestedLeafChoice(choices, override)
        || pick(choices, variant, `${targetKey}:leaf:${targetRole.role}:${targetSlot.id}`
          + (settings.randomParts || override?.random ? ':random' : ''));
      const sourceEntry = entries.get(choice.member.key);
      if (!sourceEntry) throw new Error(`背景葉節點缺少來源:${choice.member.key}`);
      const partStart = parts.length;
      sources[targetRole.role].push(choice.member.key);
      for (const index of choice.slot.partIndexes) {
        parts.push(fitLeafSlot(sourceEntry.parts[index], targetRole.role, choice.slot, targetSlot));
      }
      slotSources.push({
        role: targetRole.role,
        targetSlotId: targetSlot.id,
        sourceKey: choice.member.key,
        sourceSlotId: choice.slot.id,
        partStart,
        partCount: choice.slot.partIndexes.length,
        anchor: [...targetSlot.center],
        size: [...targetSlot.size],
      });
    }
  }

  const requestedPalette = settings.paletteId && settings.paletteId !== 'auto'
    && settings.paletteId !== 'random'
    ? subcategory.palettes.find((palette) => palette.id === settings.paletteId) : null;
  const paletteRow = requestedPalette || (subcategory.palettes.length
    ? pick(subcategory.palettes, variant, `${targetKey}:palette${settings.randomPalette ? ':random' : ''}`)
    : null);
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
      leafSlots: slotSources,
      paletteId: paletteRow?.id || null,
      selectionMode: settings.randomParts ? 'random' : Object.keys(partOverrides).length ? 'specified' : 'seed',
      paletteMode: settings.randomPalette || settings.paletteId === 'random'
        ? 'random' : requestedPalette ? 'specified' : 'seed',
    },
  };
}

export function backgroundObjectTargets(family = null) {
  return [...entries.values()].filter((entry) => !family || entry.family === family).map((entry) => entry.key);
}
