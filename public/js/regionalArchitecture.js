// 地域建築語彙；是遊戲用抽象化，不是歷史建築復原模型。
const styles = {
  gassho: {
    label: "日本合掌造農舍", region: "japan",
    roofForm: "steep_gable", facade: "timber", wallType: "timber", detail: "half_timber",
    wall: 0xd8c9aa, roof: 0x6b5940, trim: 0x49392b, glass: 0x829a99,
    foundation: "retaining", affinity: "house|farm|cottage", maxHeight: 18,
  },
  hanok: {
    label: "韓式瓦頂木構", region: "korea",
    roofForm: "xieshan", facade: "lattice", wallType: "timber", detail: "eave_brackets",
    wall: 0xe8dfce, roof: 0x4b5258, trim: 0x704a36, glass: 0xb4bfc0,
    affinity: "house|cultural|visitor", maxHeight: 20,
  },
  dutch_canal: {
    label: "低地國階梯山牆街屋", region: "low_countries",
    roofForm: "crowstep", facade: "brick", wallType: "brick", detail: "shutters",
    wall: 0x9c503e, roof: 0x4b5059, trim: 0xe4d8bb, glass: 0x849eae,
    affinity: "rowhouse|townhouse|commercial", maxHeight: 26,
  },
  tudor: {
    label: "英式半木構街屋", region: "british_isles",
    roofForm: "steep_gable", facade: "timber", wallType: "plaster", detail: "half_timber",
    wall: 0xe8dec8, roof: 0x605751, trim: 0x44352a, glass: 0x849b98,
    affinity: "house|rowhouse|civic", maxHeight: 22,
  },
  nordic_board: {
    label: "北歐木板屋", region: "nordic",
    roofForm: "gable", facade: "timber", wallType: "timber", detail: "board_batten",
    wall: 0xa04436, roof: 0x494f58, trim: 0xe4ddce, glass: 0x91b0bd,
    foundation: "retaining", affinity: "house|cottage|farm", maxHeight: 22,
  },
  haveli: {
    label: "南亞格柵宅邸", region: "south_asia",
    roofForm: "flat", facade: "recess", wallType: "sandstone", detail: "jali", roofFeature: "chhatri",
    wall: 0xd4ad83, roof: 0xb78c63, trim: 0x955e42, glass: 0x526b71,
    affinity: "house|cultural|civic", maxHeight: 26,
  },
  persian_wind: {
    label: "波斯風塔土屋", region: "iran",
    roofForm: "flat", facade: "recess", wallType: "earth", detail: "recess_bands", roofFeature: "windcatcher",
    wall: 0xcbb28d, roof: 0xb59872, trim: 0xe5caa2, glass: 0x596e70,
    affinity: "adobe|house|visitor", maxHeight: 24,
  },
  maghreb_riad: {
    label: "馬格里布灰泥院宅", region: "maghreb",
    roofForm: "flat", facade: "arches", wallType: "plaster", detail: "tile_band",
    wall: 0xe7d5ba, roof: 0xc9b590, trim: 0x477f79, glass: 0x6f959a,
    affinity: "adobe|house|cultural", maxHeight: 24,
  },
  sahel_earth: {
    label: "薩赫勒土築扶壁", region: "sahel",
    roofForm: "flat", facade: "recess", wallType: "earth", detail: "toron",
    wall: 0xb69168, roof: 0xa37d57, trim: 0x60432f, glass: 0x4d5350,
    affinity: "adobe|cultural|house", maxHeight: 24,
  },
  swahili: {
    label: "斯瓦希里珊瑚石街屋", region: "east_africa",
    roofForm: "flat", facade: "stone", wallType: "stone", detail: "carved_frame",
    wall: 0xd9d0b4, roof: 0xb6aa8b, trim: 0x77533a, glass: 0x77958f,
    affinity: "house|civic|commercial", maxHeight: 24,
  },
  malay_timber: {
    label: "馬來木構百葉屋", region: "southeast_asia",
    roofForm: "gable", facade: "timber", wallType: "timber", detail: "louvers",
    wall: 0xb9885b, roof: 0x755044, trim: 0x5d3c29, glass: 0x829b93,
    affinity: "house|visitor|farm", maxHeight: 18,
  },
  andean_adobe: {
    label: "安地斯石基土屋", region: "andes",
    roofForm: "gable", facade: "recess", wallType: "earth", detail: "stone_base",
    wall: 0xd0ad79, roof: 0x9b573d, trim: 0x79634d, glass: 0x6a8b90,
    foundation: "retaining", affinity: "adobe|house|farm", maxHeight: 20,
  },
  mexican_colonial: {
    label: "墨西哥彩灰泥街屋", region: "mesoamerica",
    roofForm: "gable", facade: "arches", wallType: "plaster", detail: "tile_band",
    wall: 0xe0ab59, roof: 0xa04e37, trim: 0x397e88, glass: 0x789c9f,
    affinity: "house|rowhouse|commercial", maxHeight: 24,
  },
  yemeni_tower: {
    label: "葉門土磚塔屋", region: "arabia",
    roofForm: "flat", facade: "recess", wallType: "earth", detail: "recess_bands",
    wall: 0xa88561, roof: 0x947153, trim: 0xefe5cf, glass: 0x597f87,
    affinity: "tower|house|apartment", maxHeight: 34,
  },
  american_barn: {
    label: "北美複折穀倉", region: "americas",
    roofForm: "gambrel", facade: "timber", wallType: "timber", detail: "board_batten",
    wall: 0x984c42, roof: 0x626972, trim: 0xe5d6bb, glass: 0x83a3af,
    affinity: "barn|farm|warehouse", maxHeight: 18, categories: ["rural","industrial"],
  },
  tropical_modern: {
    label: "熱帶遮陽現代建築", region: "oceania", era: "modern",
    roofForm: "butterfly", facade: "ribbon", wallType: "concrete", detail: "brise_soleil",
    wall: 0xe2e4d8, roof: 0x667e83, trim: 0x967a5c, glass: 0x6aa5b4,
    foundation: "retaining", affinity: "office|house|visitor", maxHeight: 30, categories: ["residential","commercial","tourism"],
  },
};
export const REGIONAL_STYLES = Object.freeze(Object.fromEntries(Object.entries(styles).map(([id,row]) =>
  [id, Object.freeze({ era: 'historic', proceduralOnly: true, categories: ['residential', 'rural', 'tourism'], ...row })])));
export const REGIONAL_CULTURES = Object.freeze({
  japan: {
    name: "日本", countries: ["JP"],
    bbox: [24,123,46,146],
    styles: ["gassho","machiya","suburban_shed","modern"],
  },
  korea: {
    name: "朝鮮半島", countries: ["KR","KP"],
    bbox: [33,124,43,132],
    styles: ["hanok","tile_apartment","modern"],
  },
  low_countries: {
    name: "低地國", countries: ["NL","BE","LU"],
    bbox: [49,2,54,8],
    styles: ["dutch_canal","deco","modern"],
  },
  british_isles: {
    name: "不列顛與愛爾蘭", countries: ["GB","IE"],
    bbox: [50,-11,60,2],
    styles: ["tudor","gothic_spire","deco","modern"],
  },
  nordic: {
    name: "北歐", countries: ["NO","SE","FI","DK","IS"],
    bbox: [55,4,71,32],
    styles: ["nordic_board","suburban_shed","modern"],
  },
  south_asia: {
    name: "南亞", countries: ["IN","PK","BD","LK","NP","BT"],
    bbox: [6,67,35,90],
    styles: ["haveli","modern","brutalist_concrete"],
  },
  southeast_asia: {
    name: "東南亞", countries: ["MY","ID","TH","VN","KH","LA","MM","PH","SG","BN","TL"],
    bbox: [-11,92,24,141],
    styles: ["malay_timber","tropical_modern","tile_apartment"],
  },
  iran: {
    name: "伊朗高原", countries: ["IR","AF"],
    bbox: [25,44,40,66],
    styles: ["persian_wind","islamic_vault","earthen"],
  },
  maghreb: {
    name: "馬格里布", countries: ["MA","DZ","TN","LY"],
    bbox: [20,-17,38,25],
    styles: ["maghreb_riad","earthen","mediterranean"],
  },
  sahel: {
    name: "薩赫勒", countries: ["ML","NE","BF","SN","TD","MR"],
    bbox: [10,-18,20,35],
    styles: ["sahel_earth","earthen","modern"],
  },
  east_africa: {
    name: "東非海岸", countries: ["KE","TZ","SO","KM"],
    bbox: [-12,33,12,52],
    styles: ["swahili","tropical_modern","modern"],
  },
  andes: {
    name: "安地斯", countries: ["PE","BO","EC"],
    bbox: [-25,-82,2,-60],
    styles: ["andean_adobe","mediterranean","modern"],
  },
  mesoamerica: {
    name: "墨西哥與中美洲", countries: ["MX","GT","BZ","HN","SV","NI","CR","PA"],
    bbox: [7,-118,33,-77],
    styles: ["mexican_colonial","mediterranean","modern"],
  },
  arabia: {
    name: "阿拉伯半島", countries: ["YE","OM","SA","AE","QA","BH","KW"],
    bbox: [12,34,32,60],
    styles: ["yemeni_tower","earthen","modern"],
  },
});
export const FACADE_GEOMETRY_LIMIT = Object.freeze({ base: 180, regional: 320 });
