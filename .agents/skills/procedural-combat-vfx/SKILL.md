---
name: procedural-combat-vfx
description: Refactor Three.js combat animation and hit feedback into scalable, server-safe procedural VFX. Use for ability casts, projectiles, missiles, trails, muzzle flashes, shockwaves, explosions, beams, ion streams, and performance-sensitive combat presentation.
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

## Reference pattern

The architectural pattern is adapted from `achrefelouafi/LinearAbiltyCastingThreeJS`: parameterized effect lifecycles, pooled roots, unit geometry, layered energy cores, bounded instances, and fixed performance budgets. Reimplement the pattern inside the host project's existing runtime; do not import its Vite stack, dependency graph, parameter surface, or source code wholesale.
