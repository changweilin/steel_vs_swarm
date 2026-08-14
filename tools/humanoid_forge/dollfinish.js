// ============ 紙娃娃收尾注入器(機體台專用;dev-only)============
// 2026-08-14 新版建模整合:鍛造鷹架搬進 `public/js/forge/` 成為遊戲本體的建構器之後,
// 編輯器那一層(doll / shapes / mark / dollapply)**刻意留在 tools/** —— 它是機體台的
// 工具,不是機體的一部分,遊戲出貨包不該帶著它。
//
// 鷹架的收尾因此收成一個選用鉤 `opts.finish`:機體台(:8631)與覆核台(:8621)兩座看板
// 都傳這一支 ⇒ 「一份實作、兩邊同形」的保證原封不動;遊戲不傳 ⇒ 逐位元同出廠規格。
import { applyDoll, outlineAdds } from './dollapply.js';

/** forge.forgeMech(spec, { finish: dollFinish }) 的收尾:套覆寫層 + 補描黏貼件。
 *  覆寫層缺席 = 只建索引不改任何值(applyDoll 的既有語意)。 */
export function dollFinish(unit, spec, outlineWidth) {
  const ix = applyDoll(unit, spec.doll);
  outlineAdds(ix, outlineWidth);   // 黏貼件是 outlinify 之後才掛的,補描它那一棵
  return unit;
}
