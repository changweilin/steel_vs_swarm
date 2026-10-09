# Animation & Visual Effects (VFX / Shader) Direction Specification

> **Status**: Design & Technical Implementation Roadmap for future development.  
> **Authority Source**: Underlying numeric data strictly bound to `public/js/data.js` (32 Mechs, 128 Slots Dual-Attribute Architecture) and `server/sim.js`.  
> **Visual Principle**: Tell -> Release -> Contact -> Decay lifecycle with bit-identical hit bounds derived solely from server authority radii. Grayscale silhouette readability first; no generic recolors or ubiquitous magic rings.

---

## 1. Architectural Principles & Visual Bounds

1. **Server-Authoritative Visual Seam**:
   - VFX particles and shader rings MUST reflect the authoritative radius (`r`), duration (`dur`), and velocity (`mv`) defined in `CHARACTERS`.
   - Decorative particle falloff may decay inward, but MUST NOT expand outward past the physical hit boundary (avoids false-hit perception).
2. **Readability & Silhouette Distinction**:
   - Every move must differ from all other 63 moves in at least two visual dimensions:
     - Grayscale silhouette contour (directional slash, falling curtain, radial fracture, etc.).
     - Tell phase presentation (first 0.25s).
     - Contact impact / decay signature.
3. **Dual-Attribute Alignment (128 Slots)**:
   - Visual identity MUST match the underlying elemental tag (`elem` / `elemBuildup` / `elemProb`):
     - `physical` (32.0%): High-explosive, solid propellant, mechanical recoil, spall, kinetic dust.
     - `shock` (19.5%): Ionizing arcs, EMP distortion ripples, scan grids, electromagnetic pulses.
     - `laser` (14.8%): Coherent photon beams, bloom cores, thermal incandescence, optical refraction.
     - `fire` (13.3%): Thermobaric blast, burning napalm stickiness, black turbulent smoke plumes.
     - `frost` (8.6%): Cryogenic frostbite, sublimation mist, snowflake crystal lattice, ice decals.
     - `impact` (6.3%): Gravitational lens distortion, shockwave rings, concrete/ground seismic fissures.
     - `corrosive` (5.5%): Chemical acidic spray, bubbling metal decay, toxic vapor clouds.
4. **GPU Performance & Overdraw Budget**:
   - Minor cast limit: Max 4 material layers, 3 draw calls, 24 instances.
   - Ultimate cast limit: Max 7 material layers, 5 draw calls, 48 instances.
   - Screen-space overdraw: Maximum 3 overlapping transparent blending surfaces per pixel.
   - All particle batches (sparks, casings, droplets, debris) MUST utilize `THREE.InstancedMesh` or pre-baked particle buffers. Zero runtime object allocations during animation playback.

---

## 2. Seven Elemental VFX & Shader Pipelines

### 2.1 Physical (`elem: 'physical'`) — 41 Slots
- **Visual Keyword**: High-velocity ballistic kinetic energy, military spall, cartridge ejection.
- **Color Palette**: Off-white core (`#FFFFFF`), dull tungsten/lead gray (`#707070`), brass sparks (`#FFA500`), gunsmoke charcoal (`#2A2A2A`).
- **Muzzle & Launch**: Directional conical flash (sharp diamond cross-section, 0.04s decay) + smoking brass casing ejector trail + muzzle gas puff.
- **In-Flight**: Supersonic shockwave cone (subtle inverted-cone distortion shader) + minimal faint tracer line.
- **Contact & Impact**: High-speed angular metal spall (instanced tiny triangle fragments) + brown-gray dirt geyser + mechanical ricochet sparks. No magical glow rings.

### 2.2 Shock / Electromagnetic (`elem: 'shock'`) — 25 Slots
- **Visual Keyword**: High-voltage electrical breakdown, EMP interference, radar spectrum disruption.
- **Color Palette**: Electric cyan (`#00F0FF`), neon violet-blue (`#4B0082`), flash white core (`#F0FFFF`).
- **Muzzle & Launch**: Magnetic rail hypervelocity muzzle flash (stretching horizontal light disc) + electromagnetic corona hugging the barrel.
- **In-Flight**: Hyper-fast ionized streak with branching micro-arcs jumping perpendicular to flight path.
- **Contact & Impact**: Surface-crawling Lichtenberg electric discharge + HUD glitch / chromatic aberration screen flicker + localized EMP expanding pulse ring (sine-wave refraction distortion).

### 2.3 Laser / Optical (`elem: 'laser'`) — 19 Slots
- **Visual Keyword**: Coherent photon density, optical diffraction, thermal vaporization.
- **Color Palette**: Prismatic laser ruby/emerald/sapphire (specific to mech culture), pure white core beam (`#FFFFFF`), iridescent lens flare rings.
- **Muzzle & Launch**: Optic pre-charge convergence glint (3-point focal gathering in 0.1s) -> instantaneous beam release.
- **In-Flight / Ray**: Cylindrical beam with high-emissive white core and soft Fresnel glowing falloff envelope; continuous laser hits leave a glowing molten burn trail.
- **Contact & Impact**: Molten metal slag splash (droplets with gravity decay) + radial Fresnel flash + smoke plume of vaporized composite armor.

### 2.4 Fire / Thermobaric (`elem: 'fire'`) — 17 Slots
- **Visual Keyword**: Exothermic combustion, fuel-air thermobaric overpressure, sticky incendiary.
- **Color Palette**: Incandescent white-yellow (`#FFF7C2`), flame orange (`#FF5500`), soot black (`#1A1A1A`).
- **Muzzle & Launch**: Dense orange fireball with trailing black carbon particles + backblast thermal wave.
- **In-Flight**: Heavy exhaust smoke plume with fluctuating combustion embers.
- **Contact & Impact**: Hemispherical thermobaric blast shockwave (refraction ring expanding at supersonic decay) -> swirling mushroom/torus cloud of dark smoke + persistent ground-burning fire decal for Area-of-Effect fields.

### 2.5 Frost / Cryogenic (`elem: 'frost'`) — 11 Slots
- **Visual Keyword**: Rapid sub-zero sublimation, dendritic crystal lattice, frostbite condensation.
- **Color Palette**: Glacial cyan (`#7FE5D9`), ice diamond white (`#E6FFFF`), polar navy shadow (`#1D3557`).
- **Muzzle & Launch**: Pressurized cryo-vapor puff + crystal needles discharging forward.
- **In-Flight**: Drifting cold vapor trail, micro ice crystals shedding along the wake.
- **Contact & Impact**: Rapid radial growth of crystalline ice decals on the terrain/target surfaces + shivering fog cloud + cracking ice shatter shards on target movement.

### 2.6 Impact / Gravity (`elem: 'impact'`) — 8 Slots
- **Visual Keyword**: High-gravity singularity, tectonic crust fracture, massive kinetic crushing.
- **Color Palette**: Deep basalt brown (`#4A3728`), tectonic amber glow (`#DDA15E`), gravity lens black.
- **Muzzle & Launch**: Ground dust sucking inward toward muzzle/initiator before outward slam.
- **In-Flight / Surge**: Heavy low-frequency shock compression wave displacing ground dust.
- **Contact & Impact**: Radial crust fracturing decal (displaced stone slab normal offsets) + high-intensity camera micro-shake + inward-pulling vortex ribbons for pull abilities.

### 2.7 Corrosive / Chemical (`elem: 'corrosive'`) — 7 Slots
- **Visual Keyword**: High-acidity cavitation, chemical neurotoxin mist, exothermic decomposition.
- **Color Palette**: Toxic fluorescent lime-yellow (`#CCFF00`), swamp purple (`#660066`), boiling yellow-green foam (`#A8E6CF`).
- **Muzzle & Launch**: Pressurized liquid spray droplets discharging with acidic vapor hiss.
- **In-Flight**: Irregular tumbling chemical droplets shedding vapor ribbons.
- **Contact & Impact**: Boiling bubbling foam decals on armor/terrain + rising acrid vapor columns + melting armor sizzle particles.

---

## 3. Dedicated Priority Reworks (Healing & Tactical Skills)

### 3.1 `t12` 螢火 — Attack Move: `共振・萬象生息` (`heal`, Team Wide, `elem: 'shock'`)
- **Old Presentation**: Dark EMP suppression wave with silence markers (`共振・萬象沉寂`).
- **New Presentation Target**: High-tech spectrum resonance life-support tide.
  1. **Tell (0.0s - 0.25s)**:
     - The forehead sensor antenna array and colossus shoulder radiators deploy, pulsing an amber/emerald warm spectrum comb (`0xb8ffb0` + warm gold).
     - Wireframe coordinate mesh illuminates outward along the ground plane.
  2. **Release (0.25s - 0.75s)**:
     - A gentle, expanding spherical harmonic wave propagates out to $R = 240\text{m}$.
     - As the wave touches allied units, it does NOT trigger an explosion; instead, it establishes an interwoven web of hair-thin firefly photon lifelines connecting all allies back to the flagship.
  3. **Contact & Impact**:
     - Allied mechs erupt with emerald-gold nanofiber repair arcs stitching over armor scars.
     - A crisp hexagonal energy shield flash envelops allies, symbolizing full SP restoration.
     - Negative status icons (burn, freeze, stun, poison) shatter into dissipating white sparks (Cleanse).
  4. **Decay (0.75s - 1.5s)**:
     - The resonance network slowly fades into floating warm firefly light embers that drift upward.

### 3.2 `m03` 雪線 — Attack Move: `極光・萬象霜封` (`emp`, Area Freeze, `elem: 'frost'`)
- **Old Presentation**: Healing aurora curtain restoring all allies (`極光・萬象淨化`).
- **New Presentation Target**: High-altitude Alpine polar aurora freeze & EMP disruption tide.
  1. **Tell (0.0s - 0.3s)**:
     - Twin-boom drone ascends slightly, dipole antenna array between the booms crackles with high-intensity blue-white cryo-electromagnetic arcing.
     - Temperature drop visual effect: frost begins creeping along the camera lens edges.
  2. **Release (0.3s - 0.8s)**:
     - Three vertical curtains of emerald-violet polar aurora (`#59c9a5` and `#79f5d0`) sweep rapidly down from the sky over the $R = 240\text{m}$ combat sector.
     - Supersonic cryogenic pressure wave drops, accompanied by sub-zero condensation fog.
  3. **Contact & Impact**:
     - All enemy vehicles in the radius are struck by flash-freeze crystalline ice decals creeping across their treads, wheels, and joints.
     - Weapon mounts emit frantic cyan electromagnetic short-circuit sparks, and HUD shows `SYSTEM FROZEN / WEAPONS OFFLINE` (EMP lock).
     - Tactical vision marker lights up over frozen targets, transmitting real-time coordinates through battlefield fog.
  4. **Decay (0.8s - 2.0s)**:
     - Ground remains coated in sub-zero frost sheen with creeping sublimation fog as enemies struggle to reboot systems.

### 3.3 Healing Archetype Visual Differentiation (5 Support Mechs)
To prevent visual homogenization across healers, each mech employs a strictly unique material signature:

1. **`s08` 聖燭 (SWARM - Double Healer)**:
   - *Def (`晨鐘・聖域庇護`)*: Mobile 28m monastery dawn-gold aura (`#E8F0F4` / `#B8FFBE`). Radiates subtle golden dew ripples matching mech movement; allies inside gain a translucent gothic rose-window vaulted shield.
   - *Atk (`暮鐘・萬物復甦`)*: Grand cathedral toll. Three massive golden harmonic rings expand; stained-glass colored light shards rain down over the entire theater.
2. **`s02` 鐵砧 (SWARM - Single Healer: `補給・陣地重整`)**:
   - Heavy industrial foundry presentation. Four automated molten welding beams arc into ally chassis with flying orange sparks and quench steam plumes. Industrial repair, strictly avoiding magic arrays.
3. **`t12` 螢火 (STEEL - Double Healer)**:
   - *Def (`同調・螢火護生`)*: Twin-charge spectrum lifeline links. Subtle bio-luminescent firefly dots pulse continuously between allies, with shield recharge flashes triggering on every incoming hit.
   - *Atk (`共振・萬象生息`)*: Wide harmonic life tide described in Section 3.1.
4. **`t05` 鶴鳴 (STEEL - Single Healer: `靈鶴・自修引導`)**:
   - High-speed biomechanical avian self-repair. Porcelain-white stress-line blueprint wireframe overlays the hull. Nano-hydraulic servos rapidly re-align cracked carbon joints in 9 distinct high-frequency micro-pulses. Zero green magic rings.
5. **`m03` 雪線 (MERC - Single Healer: `冰魄・靈泉玉澤`)**:
   - High-mountain glacier rescue syringe. Pressurized blue-green meltwater surge enveloping the drone hull, crystallizing immediate ice armor plating and blowing away debuff particles with high-pressure nitrogen gas.

---

## 4. Weapon Presentation Pipeline & Mechanical Recoil

### 4.1 Weapon Class Visual Matrix
- **`gun` (Autocannon / Machine Gun / Sniper)**:
  - Reciprocating barrel translation ($Z$-axis backward offset $0.05\text{m} - 0.2\text{m}$ based on caliber).
  - High-cadence muzzle flash with rotational variation ($0^\circ, 90^\circ, 180^\circ, 270^\circ$).
  - Micro-smoke plume persisting for $0.2\text{s}$ at barrel exit.
- **`beam` (Continuous / Pulse Laser)**:
  - Barrel remains rigid or emits heatsink radiator vents ($Y$-axis fan opening).
  - Continuous ray maintains point-to-point target tracking without projectile velocity delay.
  - Optical heat distortion envelope surrounding the emitter lens.
- **`rail` (Electromagnetic Railgun)**:
  - Pronounced chassis backward impulse recoil with damper suspension compression.
  - Hypervelocity ionizing vapor sleeve enclosing the projectile trail.
  - Pre-fire capacitor arc discharge between twin conductive rails.
- **`launcher` / `missile` (Rocket / Guided Missile)**:
  - Visible rocket ejection from tube/pod + delayed ignition flash ($0.05\text{s}$ post-launch).
  - Thick churning smoke contrail with curling turbulent wake vortices.
- **`plasma` / `fan` (Spread Shot / Direct Cones)**:
  - Angular sector ejection matching weapon `arc` parameter.
  - Planar wavefront expanding forward with leading-edge brightness falloff.

---

## 5. Technical Shader Implementation (Three.js / WebGL)

### 5.1 Custom Shader Uniforms Standard
All procedural ability shaders in `public/js/` (e.g. `castfx.js`, `particles.js`) MUST expose standard timing and environmental uniforms:

```glsl
uniform float uTime;         // Global monotonic animation clock
uniform float uProgress;     // Normalized move progress [0.0 -> 1.0]
uniform float uRadius;       // Authoritative radius in game meters
uniform vec3  uColorCore;    // Core high-intensity RGB
uniform vec3  uColorRim;     // Outer Fresnel falloff RGB
uniform sampler2D uNoiseTex; // Shared procedural simplex noise
```

### 5.2 Depth Fade / Soft Particle Formula
To eliminate hard planar intersections where VFX geometry cuts into terrain or buildings:

```glsl
// Soft particle depth blend
float sceneZ = texture2D(uDepthTexture, screenUV).r;
float particleZ = gl_FragCoord.z;
float diff = clamp((sceneZ - particleZ) * uDepthFadeRange, 0.0, 1.0);
gl_FragColor.a *= diff;
```

### 5.3 Distortion Pass (Shockwave / Gravity Lens)
- Screen-space normal perturbation shader applied via existing post-processing or auxiliary refraction meshes.
- Inverts chromatic dispersion at the shockwave boundary to simulate supersonic density gradients.

---

## 6. Phased Implementation Roadmap

| Phase | Target Module | Scope of Work |
| :--- | :--- | :--- |
| **Phase 1** | Particle Texture Atlases & Core Elements | Build shared normal/noise/alpha textures for the 7 elements (`physical`, `shock`, `laser`, `fire`, `frost`, `impact`, `corrosive`). Add instanced spall & casing emitters. |
| **Phase 2** | `t12` & `m03` Rework Profiles | Update `public/js/castfx.js` to implement `共振・萬象生息` (warm spectrum heal) and `極光・萬象霜封` (polar cryo-EMP). Remove outdated effects. |
| **Phase 3** | Weapon Trajectory & Projectile Meshes | Align all 128 weapon light/heavy projectiles in `public/js/particles.js` to their exact underlying element colors, trails, and impact particles. |
| **Phase 4** | Rigged Recoil & Firing Animations | Author weapon barrel recoil offsets and heatsink deployments via Blender MCP authoring pipeline (`tools/mech_authoring/combat.py`). |
| **Phase 5** | Regression & Performance Audit | Run `npm run check`, `tools/audit_gpu_lifecycle.mjs`, and verify 60 FPS under 5v5 full particle saturation. |
