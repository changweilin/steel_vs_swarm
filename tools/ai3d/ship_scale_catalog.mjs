/**
 * 照片船的真實尺度單一真相表。
 *
 * 已能由船名確定者使用公開規格；無法辨識型號者保留照片重建長度，僅以船型
 * 的實船比例範圍修正過寬、過扁或過高的包圍盒。size 固定為 [長, 高, 寬] 公尺。
 */

const EXACT = [
  {
    match:/USS_Enterprise_.*CVN_65/i, className:'aircraft_carrier', size:[335.6,40,76.8], confidence:'exact',
    source:'US Naval History DANFS：CVN-65 長 1,101 呎、飛行甲板寬 252 呎。',
  },
  {
    match:/Virginia_class_submarine/i, className:'attack_submarine', size:[114.8,13,10.36], confidence:'exact',
    source:'US Navy Fact File：Virginia 級長 377 呎、寬 34 呎。',
  },
  {
    match:/royal-caribbean-explorer-of-the-seas/i, className:'cruise_ship', size:[310,58,47], confidence:'exact',
    source:'Royal Caribbean Explorer Fact Sheet：長 310m、寬 47m、15 層甲板。',
  },
  {
    match:/20090411-TurboJET_Barca/i, className:'fast_catamaran_ferry', size:[47.5,12,11.8], confidence:'exact',
    source:'TurboJET Austal Cat 規格：LOA 47.50m、船寬 11.8m。',
  },
  {
    match:/中鋼運通公司208000載重噸級散裝貨輪/i, className:'capesize_bulk_carrier', size:[299.7,43,50], confidence:'sister_ship',
    source:'台船同型 208,000 DWT 系列：長 299.7m、寬 50.0m、型深 25.0m。',
  },
  {
    match:/圖2-超日王號/i, className:'ski_jump_aircraft_carrier', size:[283.5,36,61], confidence:'identified_photo',
    source:'照片辨識為 INS Vikramaditya／超日王號級外形；採該級公開主尺度。',
  },
  {
    match:/00int-China-aircraft-carrier/i, className:'catobar_aircraft_carrier', size:[316,38,76], confidence:'identified_photo',
    source:'照片辨識為福建艦 003 型平甲板航母；採公開主尺度近似。',
  },
  {
    match:/e7642302/i, className:'ski_jump_aircraft_carrier', size:[315,38,75], confidence:'identified_photo',
    source:'照片辨識為山東艦滑躍航母；採公開主尺度近似。',
  },
  {
    match:/GettyImages-630597388-compressor/i, className:'ski_jump_aircraft_carrier', size:[304.5,37,75], confidence:'identified_photo',
    source:'照片辨識為遼寧艦滑躍航母；採公開主尺度近似。',
  },
  {
    match:/Disney%20Adventure%20ship%201/i, className:'mega_cruise_ship', size:[342,66,46.4], confidence:'identified_ship',
    source:'Disney Adventure（原 Global Dream 船體）公開主尺度；Disney 官方確認為船隊最大船並具四煙囪。',
  },
];

// 一張母照片一列；具名船由 EXACT 覆蓋，其餘是依可見船型選定的保守實船全長。
const LENGTH_BY_STEM = Object.freeze({
  '_127290139_04alamy-pwtk4p':285,
  '000-34TU8F7':135,
  '00int-China-aircraft-carrier-HFO-placeholder-vjtw-master1050':305,
  '0350p12000t3nb68kA8C8':9,
  '1593571989300':20,
  '1695146093':250,
  '1718874672484-5f571666b46b4ec29d16e8b955dd37ba-1200x637':9,
  '174340740201':250,
  '1778437182_68368':120,
  '1802':60,
  '2-5-1024x768':40,
  '2000x1250_wmkn_84254351907813_0':60,
  '2000x1429_wmkn_19056648845677_0':135,
  '20090411-TurboJET_Barca':47.5,
  '2020120858047817':15,
  '20210430002927_47':20,
  '202135002-4':15,
  '20230821004313':180,
  '20240301000865':70,
  '20250401005245':285,
  '202512251310033872':70,
  '202602131051276980':80,
  '20260421104430-37bd4fa5':120,
  '20oz-china-ships-wgkl-master1050':135,
  '22xp-boaty-master1050':90,
  '2798933':12,
  '300gt-tuna-long-liner-boat_02':40,
  '379b7bfc740ea9d22183f066b6e40ff8-600x400':135,
  '489644a4-bb94-6109-6f71-d81400ca1a48_620':220,
  '6232d26edb8ab':15,
  '6621n':60,
  '666':60,
  '668d6f418c667-870x500':250,
  '762bcd7026aa844c83ed2b0f5454b162':285,
  '7d1d0fe3-7909-4cab-a1cb-fcf8300c0d58':12,
  '8eadcf6f-3d54-4ddf-92e6-a815be2b03c1':60,
  '中鋼運通公司208000載重噸級散裝貨輪-中鋼和諧':299.7,
  '圖2-超日王號':283.5,
  'A04A00_P_01_02':220,
  'aerial-view-of-a-bulk-carrier-cargo-vessel-traveling-with-high-speed-over-blue-sea':225,
  'article-5ca19fe0e988a':250,
  'c85048fc4c49c7444019ec75c0f06fb04a030e7c':180,
  'Capture-3139':220,
  'd5154891':220,
  'Disney%20Adventure%20ship%201':342,
  'e7642302':315,
  'GettyImages-630597388-compressor':304.5,
  'id13750938-558191':135,
  'img-1478851082-74949':10,
  'k23':20,
  'Methanier_aspher_LNGRIVERS':285,
  'mobile01-d0f6425557ae4a5310b111f39cf1a5ad':75,
  'mobileadv_1976_9821316_46373':60,
  'nzdnc7pepb9ltbpslhtv':9,
  'pngtree-a-small-fishing-boat-png-image_16296083':9,
  'pngtree-blue-and-white-speedboat-png-image_16228702':10,
  'royal-caribbean-explorer-of-the-seas-01-eG_-WK3':310,
  's11_1667405441519':15,
  'tkldbkxi3ftl5wewz3u2':9,
  'ttn1071_Cover0106':250,
  'US_Navy_120125-N-XO220-368_The_aircraft_carrier_USS_Enterprise_(CVN_65)_is_underway_in_the_Atlantic_Ocean_during_a_composite_training_unit_exercise':335.6,
  'Virginia_class_submarine':114.8,
});

const PROFILES = [
  { test:/aircraft_carrier/i, className:'aircraft_carrier', length:[280,338], fallback:310, beam:[0.19,0.25], height:[0.10,0.15] },
  { test:/submarine/i, className:'submarine', length:[35,141], fallback:85, beam:[0.075,0.12], height:[0.08,0.13] },
  { test:/cruise/i, className:'cruise_ship', length:[120,350], fallback:250, beam:[0.11,0.17], height:[0.14,0.22] },
  { test:/LNG|methan/i, className:'lng_carrier', length:[150,300], fallback:275, beam:[0.15,0.19], height:[0.12,0.19] },
  { test:/bulk/i, className:'bulk_carrier', length:[140,305], fallback:230, beam:[0.14,0.18], height:[0.10,0.17] },
  { test:/container|cargo/i, className:'cargo_ship', length:[75,305], fallback:180, beam:[0.12,0.18], height:[0.11,0.19] },
  { test:/warship|military_ship|naval/i, className:'warship', length:[48,180], fallback:125, beam:[0.10,0.18], height:[0.10,0.20] },
  { test:/icebreaker|research|scientific/i, className:'research_vessel', length:[28,125], fallback:55, beam:[0.17,0.28], height:[0.16,0.28] },
  { test:/catamaran|ferry/i, className:'catamaran', length:[12,55], fallback:40, beam:[0.23,0.36], height:[0.18,0.28] },
  { test:/fishing/i, className:'fishing_vessel', length:[7,50], fallback:18, beam:[0.22,0.38], height:[0.20,0.38] },
  { test:/yacht/i, className:'yacht', length:[8,55], fallback:20, beam:[0.20,0.32], height:[0.16,0.30] },
  { test:/motorboat|speedboat/i, className:'motorboat', length:[5,18], fallback:9, beam:[0.22,0.34], height:[0.15,0.28] },
  { test:/industrial|maritime/i, className:'industrial_ship', length:[45,305], fallback:150, beam:[0.13,0.22], height:[0.11,0.22] },
  { test:/.*/, className:'surface_vessel', length:[6,305], fallback:60, beam:[0.12,0.30], height:[0.10,0.28] },
];

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function resolveShipScale(row, model, measuredSize) {
  const identity = `${row.key} ${model.style || ''}`;
  const exact = EXACT.find((spec)=>spec.match.test(identity));
  if (exact) return { ...exact, size:[...exact.size] };

  const profile = PROFILES.find((spec)=>spec.test.test(identity));
  const stem = decodeURIComponent(String(row.image || '').split('/').pop() || '').replace(/\.[^.]+$/,'');
  const catalogLength = LENGTH_BY_STEM[stem] ?? LENGTH_BY_STEM[encodeURIComponent(stem)];
  const measuredLength = Number(measuredSize[0]) || profile.fallback;
  const length = catalogLength || clamp(measuredLength, profile.length[0], profile.length[1]);
  const measuredHeight = Number(measuredSize[1]) || length * (profile.height[0]+profile.height[1])/2;
  const measuredBeam = Number(measuredSize[2]) || length * (profile.beam[0]+profile.beam[1])/2;
  return {
    className:profile.className,
    size:[
      length,
      clamp(measuredHeight,length*profile.height[0],length*profile.height[1]),
      clamp(measuredBeam,length*profile.beam[0],length*profile.beam[1]),
    ],
    confidence:catalogLength ? 'class_estimate' : 'range_clamp',
    source:catalogLength
      ? `依母照片可見船型採 ${profile.className} 保守標準全長 ${catalogLength}m。`
      : `無法由照片檔名唯一辨識型號；長度沿用照片重建值並限制於 ${profile.className} 實船範圍。`,
  };
}

export const SHIP_EXACT_SCALE_COUNT = EXACT.length;
export const SHIP_SCALE_ROW_COUNT = Object.keys(LENGTH_BY_STEM).length;
