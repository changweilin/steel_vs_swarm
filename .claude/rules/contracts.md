# §4 Annotation Contracts (single seam for comment discipline)

> Layer 2: full definition. Principle lives in root `AGENTS.md` (§1 Contracts);
> per-assertion formulas live in `tools/audit_*.mjs` headers (layer 4).
> Guarded mechanically by the discipline audit (see `package.json`).

## 1. Design by Contract (interfaces only)

- File headers state the seam (what settles here) plus the one non-obvious
> why (constraint, failure mode, or invariant). MUST NOT narrate contents.
- Exported functions carry `pre` / `post` / `invariant` where misuse is
> possible (ownership, units, coordinate frames, single-seam call sites).
- Internal helpers carry no contract unless they encode a trap
> (e.g. sign conventions, mirror axes, tolerance direction).

## 2. Inline comments (allowlist, otherwise none)

1. Non-obvious domain logic (why this formula, not what it computes).
2. Hardware / platform workarounds (with the failing condition).
3. Safety invariants (what breaks if the line is removed).

MUST NOT restate what the code plainly shows. MUST NOT log history,
dates, or transitional notes. MUST NOT translate UI/narrative strings.

## 3. Chesterton's Fence

MUST NOT remove an intentional design (see `retired.md` for dropped ones)
without recording its reason first: the constraint it satisfies, the failure
it prevents, and where the guard lives (`verification.md` → audit header).
