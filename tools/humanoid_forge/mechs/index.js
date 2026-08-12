// ============ 逐機零件檔名冊(dev-only)============
// 一格一檔:2D 定案圖 → 多面體零件的轉換各自住 mechs/<檔名>.js;本檔只做彙整。
//
// **鍵 = roster.js 的 entryKey()**(2026-08-12 第四輪):`t01` / `t06@ground` / `t06@flight`。
// 變形者一台兩格(地面型與飛行型是兩個不同原型、各自對照自己的 2D 定案圖),
// 檔名以底線代替 `@`(`t06_flight.js`),**鍵仍是 `@`** —— 鍵的唯一真相在 roster.js,
// 這裡 MUST NOT 出現第二套字串規則(拼錯的下場是那一格從名冊消失,而分類頁不會報錯)。
import t01 from './t01.js';
import t02 from './t02.js';
import t10 from './t10.js';
import t12 from './t12.js';
import t06g from './t06.js';
import t11g from './t11.js';
import m01g from './m01.js';
import m05g from './m05.js';
// 仿生批次(2026-08-12:★ 定案圖 → 仿生機型;四足 kind:'quad' + 獸型雙足)
import s06 from './s06.js';
import s07 from './s07.js';
import t04 from './t04.js';
import m06 from './m06.js';
import s09 from './s09.js';
import t03 from './t03.js';
import t05 from './t05.js';
import m02 from './m02.js';
// 航空批次(2026-08-12 第四輪:kind:'air';旋翼機 / 定翼機 / 撲翼機 / 變形者飛行型)
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
  // ── 人形機甲(biped 鷹架)──
  t01, t02, t10, t12,
  't06@ground': t06g, 't11@ground': t11g, 'm01@ground': m01g, 'm05@ground': m05g,
  // ── 仿生機體(quad 鷹架 / 獸型雙足 biped 鷹架)──
  s06, s07, t04, m06, s09, t03, t05, m02,
  // ── 航空機體(air 鷹架)──
  s01, s02, s04, s05, s08, s11, s12, t07, t08, t09, m03, m04,
  's03@flight': s03f, 's10@flight': s10f, 't06@flight': t06f, 't11@flight': t11f,
  'm01@flight': m01f, 'm05@flight': m05f, 'm07@flight': m07f, 'm08@flight': m08f,
};
