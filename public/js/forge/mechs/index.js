// ============ Mech Component Registry (dev-only) ============
// One module per roster slot translating concept art into polyhedral component hierarchies.
//
// Key MUST strictly match roster.js entryKey(): t01 / t06@ground / t06@flight.
// Morph mechs provide separate entries for ground and flight stances.
// File paths substitute '@' with '_' (e.g. t06_flight.js), but registry dictionary keys MUST use '@'
// to preserve single seam alignment with roster.js.
import t01 from './t01.js';
import t02 from './t02.js';
import t10 from './t10.js';
import t12 from './t12.js';
import t06g from './t06.js';
import t11g from './t11.js';
import m01g from './m01.js';
import m05g from './m05.js';
// Variable-geometry biomimetic ground variants (shared component source for flight forms).
import m07g from './m07.js';
import m08g from './m08.js';
import s03g from './s03.js';
import s10g from './s10.js';
// Biomimetic mechs (quadruped kind:'quad' + digitigrade biped).
import s06 from './s06.js';
import s07 from './s07.js';
import t04 from './t04.js';
import m06 from './m06.js';
import s09 from './s09.js';
import t03 from './t03.js';
import t05 from './t05.js';
import m02 from './m02.js';
// Aerial craft (kind:'air'; rotary-wing / fixed-wing / ornithopter / flight stances).
import s01 from './s01.js';
import s02 from './s02.js';
import s04 from './s04.js';
import s05 from './s05.js';
import s08 from './s08.js';
import s11 from './s11.js';
import s12 from './s12.js';
import t07 from './t07.js';
import t08 from './t08.js';
import t09 from './t09.js';
import m03 from './m03.js';
import m04 from './m04.js';
import s03f from './s03_flight.js';
import s10f from './s10_flight.js';
import t06f from './t06_flight.js';
import t11f from './t11_flight.js';
import m01f from './m01_flight.js';
import m05f from './m05_flight.js';
import m07f from './m07_flight.js';
import m08f from './m08_flight.js';

export const MECH_DETAIL = {
  // Humanoid mechs (biped scaffold)
  t01, t02, t10, t12,
  't06@ground': t06g, 't11@ground': t11g, 'm01@ground': m01g, 'm05@ground': m05g,
  // Biomimetic mechs (quad / digitigrade biped scaffold)
  s06, s07, t04, m06, s09, t03, t05, m02,
  'm07@ground': m07g, 'm08@ground': m08g, 's03@ground': s03g, 's10@ground': s10g,
  // Aerial craft (air scaffold)
  s01, s02, s04, s05, s08, s11, s12, t07, t08, t09, m03, m04,
  's03@flight': s03f, 's10@flight': s10f, 't06@flight': t06f, 't11@flight': t11f,
  'm01@flight': m01f, 'm05@flight': m05f, 'm07@flight': m07f, 'm08@flight': m08f,
};
