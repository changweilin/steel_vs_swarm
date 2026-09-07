// 文化／年代是視覺語彙，不改寫圖資的實際用途；比例皆為相對權重。
export const ARCHITECTURE_STYLES = Object.freeze({
  machiya: { label: '日式町屋', era: 'historic', facade: 'lattice', roofForm: 'gable', wall: 0xf0dfbd, roof: 0x434c61, trim: 0x69463b, glass: 0x9cc4c4, affinity: 'house|rowhouse|pagoda|civic' },
  courtyard: { label: '東亞院落', era: 'historic', facade: 'columns', roofForm: 'tiered', wall: 0xeee5cc, roof: 0x466979, trim: 0xa54f43, glass: 0x557c8b, affinity: 'pagoda|civic|house' },
  mediterranean: { label: '地中海拱廊', era: 'historic', facade: 'arches', roofForm: 'gable', wall: 0xf5dcba, roof: 0xba6954, trim: 0xd0ab79, glass: 0x497e92, affinity: 'adobe|stone|civic|house' },
  alpine: { label: '山地木石屋', era: 'historic', facade: 'timber', roofForm: 'gable', wall: 0xe2c8a4, roof: 0x5c6175, trim: 0x614538, glass: 0x8bb6c8, affinity: 'cottage|stone|house|windmill' },
  earthen: { label: '土築聚落', era: 'historic', facade: 'recess', roofForm: 'dome', wall: 0xe0b780, roof: 0xad8064, trim: 0x926c4c, glass: 0x516d77, affinity: 'adobe|yurt|stone' },
  deco: { label: '近代裝飾藝術', era: 'transitional', facade: 'piers', roofForm: 'stepped', wall: 0xecdac0, roof: 0x617487, trim: 0xae9270, glass: 0x678f9e, affinity: 'civic|rowhouse|mass|commercial' },
  modern: { label: '當代玻璃街廓', era: 'modern', facade: 'ribbon', roofForm: 'flat', wall: 0xd8e6ed, roof: 0x4e667b, trim: 0x93afbd, glass: 0x4d92aa, affinity: 'mass|commercial|office|apartment' },
  industrial: { label: '近代廠房', era: 'transitional', facade: 'industrial', roofForm: 'sawtooth', wall: 0xc18d78, roof: 0x597f87, trim: 0x616572, glass: 0x9ec8d2, affinity: 'industrial|warehouse|mass|shed' },
});

export const ARCHITECTURE_PROFILES = Object.freeze({
  urban: { machiya: 10, courtyard: 8, mediterranean: 9, alpine: 3, earthen: 3, deco: 22, modern: 35, industrial: 10 },
  rural: { machiya: 22, courtyard: 20, mediterranean: 15, alpine: 16, earthen: 12, deco: 5, modern: 5, industrial: 5 },
  plain: { machiya: 12, courtyard: 14, mediterranean: 14, alpine: 7, earthen: 19, deco: 8, modern: 10, industrial: 16 },
  hillside: { machiya: 12, courtyard: 9, mediterranean: 18, alpine: 34, earthen: 14, deco: 5, modern: 5, industrial: 3 },
});

export const ARCHITECTURE_SITE = Object.freeze({ slopeDeg: 10, probeM: 12, densityCellM: 100, urbanNeighbors: 18 });
