import { CHARACTERS } from './data.js';

export const CULTURAL_PALETTES = {
  s01:{culture:'烏克蘭軍樂', accent:0xf4c542, structure:'ukrainian_score', shieldForm:'score_canopy'},
  s02:{culture:'工業鍛造', accent:0xff7b35, structure:'forge_anvil', shieldForm:'forge_battlements'},
  s03:{culture:'台灣利維坦深海', accent:0x8ce7ee, structure:'leviathan_ribs', shieldForm:'whale_ellipse'},
  s04:{culture:'日本修羅軍刀', accent:0xff4747, structure:'shura_deadline', shieldForm:'broken_frame'},
  s05:{culture:'競速神經電競', accent:0x47d9ff, structure:'neon_synapse', shieldForm:'pixel_lattice'},
  s06:{culture:'追悼護航拱券', accent:0xcfd6ff, structure:'elegy_tally', shieldForm:'tomb_phalanx'},
  s07:{culture:'白板數學證明', accent:0xffc857, structure:'proof_chords', shieldForm:'axiom_polygon'},
  s08:{culture:'克拉科夫晨鐘', accent:0xb8ffbe, structure:'krakow_rose', shieldForm:'rose_vault'},
  s09:{culture:'澳洲牧場獵巡', accent:0xe49b52, structure:'outback_brand', shieldForm:'ranch_fence'},
  s10:{culture:'終端始祖翼陣', accent:0xd8ff9f, structure:'spectrum_feather', shieldForm:'negative_screen'},
  s11:{culture:'德國精密錶芯', accent:0xd8c690, structure:'watch_escapement', shieldForm:'clockwork_cage'},
  s12:{culture:'克里米亞星圖', accent:0xc7a8ff, structure:'crimea_starpath', shieldForm:'constellation_door'},
  t01:{culture:'烏拉爾閱兵砲兵', accent:0xff5b4d, structure:'ural_artillery', shieldForm:'avalanche_wedge'},
  t02:{culture:'神經同步科幻', accent:0xd89cff, structure:'neural_seventh', shieldForm:'seven_rings'},
  t03:{culture:'中式熔爐神話', accent:0xffa94f, structure:'xianxia_furnace', shieldForm:'cauldron_shell'},
  t04:{culture:'格魯烏灰雁', accent:0x8294a8, structure:'gru_feather', shieldForm:'optical_cloak'},
  t05:{culture:'兵工重工生產線', accent:0xf0d27c, structure:'crane_blueprint', shieldForm:'assembly_gate'},
  t06:{culture:'齊天筋斗雲', accent:0xffc83d, structure:'qitian_cloudstaff', shieldForm:'cloud_mandala'},
  t07:{culture:'翼龍終結狙擊', accent:0xc9b6ff, structure:'pterosaur_arrow', shieldForm:'needle_sight'},
  t08:{culture:'聲電神龍', accent:0xff65d2, structure:'dragon_aria', shieldForm:'resonance_bowl'},
  t09:{culture:'波斯火箭哀歌', accent:0xc49a5a, structure:'persian_calligraphy', shieldForm:'ink_rain'},
  t10:{culture:'穆卡納斯庇護所', accent:0x6fe4c9, structure:'mukarnas_arch', shieldForm:'octant_vault'},
  t11:{culture:'戰壕老兵', accent:0xb7a27a, structure:'trench_whistle', shieldForm:'sandbag_line'},
  t12:{culture:'螢火神經悼亡', accent:0xbaff67, structure:'firefly_network', shieldForm:'coordinate_mesh'},
  m01:{culture:'哥德渡鴉血月', accent:0xff435f, structure:'raven_batmoon', shieldForm:'blood_moon'},
  m02:{culture:'泰坦岩層誓約', accent:0xd4aa70, structure:'titan_strata', shieldForm:'cornerstone_wall'},
  m03:{culture:'阿爾卑斯極光', accent:0x79f5d0, structure:'alpine_aurora', shieldForm:'ice_crown'},
  m04:{culture:'蒙古金鵰草原', accent:0xd9b45b, structure:'steppe_eagle', shieldForm:'wind_compass'},
  m05:{culture:'工業斷路雷刑', accent:0xb58aff, structure:'blackout_breaker', shieldForm:'thunder_cage'},
  m06:{culture:'巴西嘉年華艦隊', accent:0x54e8a3, structure:'carnival_rotor', shieldForm:'flightdeck_fan'},
  m07:{culture:'邊境界碑拒止', accent:0x62e9ff, structure:'border_gate', shieldForm:'exclusion_grid'},
  m08:{culture:'合約刺客水墨', accent:0xd0b36a, structure:'contract_empty', shieldForm:'folded_circle'},
};
// Cultural frames share architectural vocabulary; each cast signature supplies the character identity.
export const CULTURE_FRAME = {
  s01:'baroque', s02:'rivet', s03:'tao_cloud', s04:'torii', s05:'cyber', s06:'jazz',
  s07:'hexstar', s08:'gothic', s09:'frontier', s10:'runic', s11:'clockwork', s12:'girih',
  t01:'constructivist', t02:'cyber', t03:'tao_cloud', t04:'constructivist', t05:'rivet', t06:'tao_cloud',
  t07:'torii', t08:'tao_cloud', t09:'girih', t10:'girih', t11:'trench', t12:'folklore',
  m01:'gothic', m02:'citadel', m03:'alpine', m04:'tengri', m05:'storm', m06:'carnival',
  m07:'stepped', m08:'mandala',
};

export function characterCombatStyle(ch) {
  const culture = CULTURAL_PALETTES[ch];
  if (!culture) return null;
  return { ...culture, color: CHARACTERS[ch].visual.hue, frame: CULTURE_FRAME[ch],
    variant: Object.keys(CULTURAL_PALETTES).indexOf(ch) };
}
