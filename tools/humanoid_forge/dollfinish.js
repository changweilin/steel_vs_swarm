// ============ Paper-doll finishing injector (forge stage only; dev-only) ============
// 2026-08-14 new-model integration: once the forge scaffold moved into public/js/forge/ as the game body builder,
// the editor layer (doll / shapes / mark / dollapply) deliberately stayed in tools/ -- it is forge-stage
// tooling, not part of the mech itself, so the shipped game bundle must not carry it.
//
// The scaffold finishing therefore collapses into one optional hook opts.finish: both boards, forge stage (:8631)
// and review board (:8621), pass this file, so the one-implementation same-shape guarantee stays intact;
// the game passes nothing, staying bit-identical to factory spec.
import { applyDoll, outlineAdds } from './dollapply.js';

/** Finishing step for forge.forgeMech(spec, with finish dollFinish): apply override layer plus outline pasted parts.
 *  Missing override layer means build the index only and change no values (existing applyDoll semantics). */
export function dollFinish(unit, spec, outlineWidth) {
  const ix = applyDoll(unit, spec.doll);
  outlineAdds(ix, outlineWidth);   // Pasted parts mount after outlinify, so outline that tree too
  return unit;
}
