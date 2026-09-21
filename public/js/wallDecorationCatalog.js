// Content and numeric budgets for presentation-only wall attachments.
export const WALL_DECORATION_LIMIT = 160;
export const WALL_DECORATIONS = Object.freeze({
  video: { label: '拼接電視牆', categories: ['commercial'], modern: true, color: 0x192e42, accent: 0x62cdd5 },
  advertisement: { label: '圖像廣告牆', categories: ['commercial', 'tourism'], modern: true, color: 0xe8dac0, accent: 0xba573f },
  graffiti: { label: '街頭塗鴉牆', categories: ['industrial', 'residential', 'commercial'], modern: true, color: 0x666875, accent: 0xe4ab66 },
  posters: { label: '錯落海報群', categories: ['commercial', 'residential', 'civic', 'tourism'], modern: true, color: 0xe6dfcd, accent: 0x416878 },
  mosaic: { label: '馬賽克壁飾', categories: ['civic', 'tourism', 'residential'], color: 0xcfbb94, accent: 0x397c81 },
  ivy: { label: '常春藤攀牆', categories: ['residential', 'rural', 'tourism', 'industrial'], plant: true, color: 0x3c6240, accent: 0x69874c },
  flowering_trellis: { label: '開花藤架', categories: ['residential', 'rural', 'tourism'], plant: true, color: 0x537443, accent: 0xc9889d },
  hanging_vines: { label: '垂吊藤蔓', categories: ['residential', 'commercial', 'tourism'], plant: true, color: 0x365e48, accent: 0x84a462 },
});
export const WALL_COVERAGE = Object.freeze({
  patch: [0.28, 0.24], band: [0.72, 0.18], column: [0.2, 0.62], field: [0.58, 0.48],
});

export const WALL_DECORATION_PLACEMENT = Object.freeze({ maxCount: 2, prob: 0.82, minLength: 3, minHeight: 3 });
export const WALL_DECORATION_RULES = Object.freeze(Object.fromEntries(
  Object.entries(WALL_DECORATIONS).map(([key, rule]) => [`wall_${key}`, {
    ...WALL_DECORATION_PLACEMENT, label: rule.label, categories: rule.categories, slot: 'facade',
  }]),
));
