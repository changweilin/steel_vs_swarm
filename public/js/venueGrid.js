// ============ 場地主方位(離線烘焙,人手 MUST NOT 編輯)============
// 由 `node tools/bake_venue_grid.mjs` 產生。值 = **度**,語意 = 「把地圖轉這麼多度,
// 該場地的大馬路就會對齊世界軸(組成正交網格)」= 大馬路 mod 90° 主方位的負值,∈ [−45, 45]。
// 消費端只有 `venues.js venueConfig()`(寫進 cfg.center.rot,單位換成弧度);
// 場地不在表內 ⇒ 0 = 不旋轉 = 逐位元同舊制(自訂地圖與舊的「我的最愛」都走這一條)。
// 改 `roadgrid.js gridAngle()` 或取樣面(大馬路的定義)MUST 重烤。
export const VENUE_GRID = {
  aokigahara: -8.2079,
  barcelona: 42.8032,
  berlin: -22.8745,
  blackforest: 21.3496,
  chicago: -0.003,
  civicblvd: -11.2171,
  crimea: 7.7706,
  giza: 23.692,
  hehuanshan: -37.0424,
  iguazu: 44.5928,
  jinlong: 40.7597,
  kyoto: -2.5417,
  london: -5.2105,
  madrid: 0.2899,
  manhattan: -28.9951,
  okavango: 44.091,
  paris: -43.8495,
  phoenix: -4.6822,
  rio: 36.7165,
  roppongi: 25.9097,
  seoul: 19.755,
  shibuya: 14.5273,
  taipei101: -9.2412,
  tamsui: -31.107,
  taroko: -26.0386,
  venice: -19.0145,
  yangmingshan: -18.3252,
  yosemite: -19.4497,
};
