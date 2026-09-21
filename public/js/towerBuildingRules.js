// 尺寸同時供生成、占位與碰撞使用；造型不讀場景共用 RNG。
export const TOWER_BUILDINGS = Object.freeze({
  bell_tower: { r: 5, h: 28 },
  clock_tower: { r: 5, h: 30 },
  control_tower: { r: 6, h: 32 },
  watchtower: { r: 5, h: 24 },
  beacon_tower: { r: 6, h: 20 },
  gun_tower: { r: 6, h: 18 },
  iron_tower: { r: 7, h: 40 },
  observation_tower: { r: 7, h: 36 },
  radio_tower: { r: 5, h: 44 },
});

export function towerSides(tags = {}, seed = 0) {
  const shape = String(tags['tower:shape'] || tags['building:shape'] || '').trim().toLowerCase();
  const sides = { round: 24, circular: 24, square: 4, rectangular: 4, hexagonal: 6, octagonal: 8 };
  return Object.hasOwn(sides, shape) ? sides[shape] : [4, 6, 8, 24][(seed >>> 0) % 4];
}

