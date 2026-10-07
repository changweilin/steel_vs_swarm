// ============ 通用物件池(唯一縫)============
// Frequently created and destroyed objects (bullet records/tracers/particle sprites/shells) are preallocated and recycled,
// avoids per-shot allocation causing GC spikes or per-frame hitches.
//
// Contract:
//   - Presentation/record-layer reuse only; never touches authoritative settlement (A1). The pool owns object bodies;
//     hit/damage still follow their original paths.
//   - Browser-safe: zero imports, zero Node APIs (sim/game/castfx share this same file, see server/AGENTS.md).
//   - Determinism: the pool is a LIFO free stack consuming no random sequence; live-object semantics stay bit-identical (A4).
//   - Release semantics: A25 single disposal -- real dispose only on overflow; otherwise objects are just hidden for reuse.
//   - Callers must fully overwrite mutable fields after acquire; release does only the minimal hide-safe reset,
//     so residue from the previous shot never leaks into the next (position/velocity/visibility/opacity).
export class Pool {
  /**
   * @param make  () => new object (called only when the pool is empty)
   * @param opts.reset (o) => minimal hide-safe reset on release; heavy reset is overwritten by the caller after acquire
   * @param opts.max    free-stack cap (surplus releases are dropped for the caller to dispose separately)
   * @param opts.prewarm prefill count at construction (avoids first-shot hitches; fills only the free stack, never the scene)
   */
  constructor(make, { reset = null, max = 64, prewarm = 0 } = {}) {
    this._make = make;
    this._reset = reset || null;
    this._max = Math.max(1, max | 0);
    this._free = [];
    if (prewarm > 0) this.prewarm(prewarm);
  }

  /** Take one available object (creates a new one when empty; never throws). */
  acquire() {
    const f = this._free;
    return f.length ? f.pop() : this._make();
  }

  /**
   * Release an object. Returns true = pooled / false = pool full so dropped (caller disposes only then).
   * Releasing null/undefined is a no-op (returns false) so dispose paths can pass through.
   */
  release(o) {
    if (o == null) return false;
    if (this._reset) this._reset(o);
    if (this._free.length < this._max) { this._free.push(o); return true; }
    return false;
  }

  /** Prefill the free stack (once at open/entry; avoids first-allocation hitches). */
  prewarm(n) {
    const want = Math.min(this._max, Math.max(0, n | 0));
    while (this._free.length < want) this._free.push(this._make());
  }

  /** Drain the free stack (on leave); calls dispose per object when given, else just drops references. */
  clear(dispose) {
    if (typeof dispose === 'function') {
      for (const o of this._free) {
        try { dispose(o); } catch { /* Release path never throws */ }
      }
    }
    this._free.length = 0;
  }

  get size() { return this._free.length; }
  get max() { return this._max; }
}
