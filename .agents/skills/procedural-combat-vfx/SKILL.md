---
name: procedural-combat-vfx
description: Refactor Three.js combat animation and hit feedback into scalable, server-safe procedural VFX with fixed draw-call and particle budgets. Use for ability casts, projectiles, missiles, trails, muzzle flashes, shockwaves, explosions, beams, ion streams, and performance-sensitive combat presentation.
---

# Procedural Combat VFX

Build readable combat effects around one shared presentation pipeline without changing authoritative combat state.

## Non-negotiable boundary

- Treat damage, hit validation, range, collision, ammunition, cooldowns, and status effects as read-only inputs.
- Keep animation, recoil, camera response, particles, light, and sound presentation-only.
- Derive visible damage footprints from authoritative radii. Decorative glow may soften an edge, but must not imply a larger valid hit area.
- Reuse the battlefield entry points in previews and galleries. Do not maintain a second visual implementation.

## Author every effect as a beat

Use a short four-phase envelope:

1. **Tell** — contract, charge, aim, or gather energy.
2. **Release** — create the fastest silhouette change and the brightest core.
3. **Contact** — add the impact flash, directional recoil, shock ring, or debris impulse.
4. **Decay** — remove energy quickly, then leave a weaker smoke, distortion, or glow tail.

Use normalized lifetime `p = age / duration`. Update existing transforms and uniforms from `p`; never schedule per-effect timers or create objects inside the frame loop.

## Layering vocabulary

- **Kinetic projectile:** narrow tracer, brief muzzle core, contact spark, optional heavy shock ring.
- **Missile or rocket:** pooled body, colored airflow halo, white-hot exhaust core, impact flash, honest-radius shockwave.
- **Beam:** saturated outer tube, delayed white core, instanced traveling rings, contact bloom.
- **Ion stream:** tapered throat, thin core, one instanced coil field, one instanced arc field.
- **Explosion:** white contact core, colored expansion, one shockwave, then batched debris or smoke.
- **Ability cast:** one shared gather/release beat plus the ability-specific motif and silhouette.

Prefer hard silhouettes and two-layer core/halo geometry over bloom-heavy translucent fog. Mark emissive presentation meshes so outline passes ignore them.

## Performance contract

- Build geometry once at unit scale and resize with transforms.
- Mark shared geometry so effect cleanup never disposes it.
- Pool projectile roots and other high-frequency effect objects with a fixed depth cap.
- Use one `InstancedMesh` for repeated beads, rings, arcs, sparks, or debris that share geometry and material.
- Cap instance counts explicitly; visual intensity must not create unbounded objects or draw calls.
- Set frequently updated instance matrices to dynamic draw usage.
- Cache generated textures and never upload a new canvas texture per hit.
- Avoid per-frame `new`, array growth, traversal, raycasts, and particle spawning.
- Dispose per-effect materials and non-shared geometry when an effect expires or a preview changes character.
- Keep a global active-effect cap and evict the oldest decaying effects first.

### Steel vs. Swarm ability budget

Treat these values as hard runtime invariants for this repository:

- Budget each active ability at **4–6 fixed draw calls total**. Count the two shared particle layers plus every submitted structural layer; constants or audit labels do not count as proof when the entry point still submits legacy meshes.
- Use **64–128 particle instances per cast** in normal mode. Read the existing low-power preference seam and halve every recipe in low-power mode.
- Cap all live ability particles in a scene at **1024 in normal mode and 512 in low-power mode**. This is one global slot budget across both particle layers, not 1024 or 512 per layer.
- Implement the particle renderer as two scene-scoped `InstancedMesh` layers. Split the backing allocation across them: 512 slots per layer in normal mode, with 256 active instances per layer in low-power mode.
- Map each global ring slot to exactly one particle layer and one local instance index. Overwriting a slot must not leave a live copy in the other layer.
- Drive eviction with a cursor modulo the current active capacity. When switching to low-power mode, clear and hide slots above 511 so a quick switch back cannot resurrect old particles.
- Store spawn position/time, lifetime/size, velocity, color, and profile style in `InstancedBufferAttribute`s with `DynamicDrawUsage`. Integrate motion, shaping, and decay in the vertex/fragment shaders.
- Upload only dirty attribute ranges after spawn writes. Do not upload or rebuild the entire pool for one cast.
- Scope engines by `THREE.Scene` (for example with a `WeakMap`) so the showcase and battlefield cannot share mutable cursors, attributes, or roots.

Use a bounded compositor at the shared cast entry point:

- Ordinary casts: two shared particle draws plus exactly three structural draws (`culturalSeal`, `layoutStructure`, and `accentMotif`) = five total.
- Shield casts: replace the accent layer with one or two instanced shield-field layers = five or six total.
- Repeated glyphs, walls, pillars, rings, chains, waves, or afterimages must be instances inside one named layer, never one mesh or sprite per repeated element.
- Collect material references once at construction. Frame updates may iterate fixed arrays but must not traverse the scene tree.
- Do not call legacy high-draw archetypes after the bounded compositor. Leaving old helpers defined is acceptable only when the shared entry point cannot submit them.

Every roster ability needs a deterministic recipe derived from its full visual profile: shape, layout, motion, contact, accent motif, phase, tempo, cultural palette, and structural form. Validate that all 64 skill/ultimate slots resolve to recipes, normal counts span the full 64–128 range, and complete visual signatures remain unique.

## Integration sequence

1. Find the existing shared cast, projectile, impact, and cleanup seams.
2. Add or extend a common helper instead of patching individual characters.
3. Route battlefield, remote-player, AI, tower, and preview effects through that helper.
4. Preserve every authoritative value and network message byte-for-byte.
5. Verify syntax and GPU lifecycle audits.
6. Exercise light fire, heavy fire, missile flight, beam impact, ion output, skill, and ultimate in a real WebGL render.
7. Compare renderer draw calls and active effect counts before and after the change.

## Acceptance checks

- Every roster entry reaches the shared skill-cast beat and its mapped archetype.
- Light and heavy weapons are visibly distinguishable without changing fire rate or damage.
- Missile exhaust animates without spawning trail objects each frame.
- Repeated beam rings use one draw call.
- Ion coils and arcs use bounded instancing rather than one mesh per segment.
- Preview cleanup releases per-effect GPU resources.
- Visual radii remain derived from the same values used by authoritative combat.
- Core gameplay, balance, determinism, and network tests remain unchanged.
- A source-level budget audit proves the shared entry point submits only the bounded compositor and particle pool, including reverse-break cases for capacity, instancing, recipe range, and entry-point routing.
- A real WebGL pass exercises every roster skill and ultimate in both normal and low-power modes with no shader errors, frozen animations, or console errors.

## Reference pattern

The architectural pattern is adapted from `achrefelouafi/LinearAbiltyCastingThreeJS`: parameterized effect lifecycles, pooled roots, unit geometry, layered energy cores, bounded instances, and fixed performance budgets. Reimplement the pattern inside the host project's existing runtime; do not import its Vite stack, dependency graph, parameter surface, or source code wholesale.
