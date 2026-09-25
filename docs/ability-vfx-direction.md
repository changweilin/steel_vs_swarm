# 64-Move Procedural VFX Art Direction

> Status: implementation spec. Names, effects, ranges, and durations read only from
> `CHARACTERS`; this document defines presentation only.
>
> Goal: every move must differ from the other 63 in at least two of (grayscale
> silhouette, first 0.25s, contact tail). Recolor or totem-swap alone never counts
> as a distinct move.

## Common visual grammar

- Every move follows Tell -> Release -> Contact -> Decay, but no longer stacks the
  same circular `fxCastBeat`.
- Magic circles only for skills that truly need "field, ritual, formula"; dashes,
  snipes, stealth, and summons use directional contours instead.
- Effective-range borders derive from authority radii only. Decorative light, smoke,
  and debris may decay inward but MUST NOT imply a larger hit zone.
- Every move owns a unique `profileId`. Geometry, materials, textures, and updaters
  may be shared, but never the identical layer stack plus timing curve.
- Primary color follows the body; accents per roster below. All bright cores flash
  white or low-saturation warm for instant contrast only -- no full-duration bloom wash.

## Roster: Free Swarm Coalition

| Move | Visual beat | Totem | Palette / mood |
|---|---|---|---|
| `s01.skill.fugue_concord` | Ground staff-spiral unfurls; three voice-arcs at different tempi chase in; baton light-blade cuts down; dark-red notes stream back | Staff, quavers, hive beat-dots | Ivory + blue/yellow + dark-red reflux |
| `s01.ult.sky_orchestra` | Horizontal full score opens across the sky, hex-rotor beat-lights ignite row by row; three score-gates disgorge helicopter silhouettes; staff-lines shred in rotor wash | Baton, bar lines, six-point swarm | Parade formality + air formation |
| `s02.skill.tempered_reforge` | Red-hot cracks mark damage side first; four weld-arm beams stitch inward; anvil imprint drops as plates clasp with orange-white spatter; metal cools orange-to-dark | Anvil, rivets, weld beads | Close industrial repair, never a heal ring |
| `s02.ult.world_crucible` | Crucible mouth projects under the core; molten gold runs six casting channels to allies; segmented temper-scale rises at the border; one die-stamp light-print per ally plus quench steam | Crucible, runners, temper marks | Black iron + molten orange + cooling off-white |
| `s03.skill.silent_lobes` | Twin ear-lobe ellipses open; narrow interference fringes clamp the drop point; center shows a silent black band only at the cancellation instant; enemy sensor glyphs die cell by cell | Ear lobes, phase signs, fluke | Pearl gray + teal; "sound removed" |
| `s03.ult.leviathan_song` | Sixteen belly-rib lines ignite in sequence; low-frequency ellipses push out like bathymetric contours; a whale profile surfaces mid-way and dissolves into spectrum; rim settles as EM quiet, not explosion | Sixteen ribs, song spectrum, sea-sky line | Deep sea teal + silver |
| `s04.skill.breakthrough_thrust` | Sight-line presses a hair-thin white blade-road; twin reversed thrust-wedges ignite underfoot; release leaves one red-edged speed remnant with a forward-biased spear-tip impact, no circular wave | Spade spear-tip, single footprint | Military white + alarm red |
| `s04.ult.deadline_shura` | Four black-red death-lines lock safe gaps at the sides; an open octahedral cut-frame forms; pulses flash short slashes from changing bearings; all lines snap at once | Asura eyes, severed lines, four-way cuts | Black, deep red, snap white |
| `s05.skill.synapse_overclock` | Twin synapse chains spark beside the core at high-APM rhythm; racing HUD arrows compress along motion; reload nodes jump full like progress bars; misaligned afterimages linger | Neural nodes, refresh arrows, pixel stars | Esports magenta + electric blue + white |
| `s05.ult.star_swarm_dive` | Funnel flight-lines form over the target; micro star-points orbit up then dive in batches; contact is staggered multi-point strobe bursts plus brief blinding noise, never one big blast | Six-point waymarks, FPV reticle, spiral tracks | Neon racing + chaotic bullet-pattern |
| `s06.skill.elegy_intercept` | Translucent dome sewn upward from log-line rings; thin white intercept strings meet incomings; each kill opens one restrained jazz-blue spark; lines sink back into the dome | Blank tabs, log lines, keel arch | Midnight blue + cold white; quiet, funereal |
| `s06.ult.undying_phalanx` | Staggered oblong shield-walls rise between allies like nameless tombstones; a blank banner unfurls center; impacts split into side arc-light | Blank banner, escort wings, stone rows | Deep indigo + silver gray; no generic holy gold |
| `s07.skill.causal_proof` | Incoming vectors draw with shortest intercept chords; axiom nodes mark intersections in order; on proof the polygon snaps shut and erases missile tracks, leaving a `Q.E.D.`-style box glyph, no text | Chords, tangents, proof box | Whiteboard teal + amber nodes |
| `s07.ult.inverse_geometry` | Target zone triangulates irregularly; all triangles push outward then snap-fold inward; contact shreds fragment vectors along aerodynamic faces; grid collapses for lack of solution | Counter-proof cross, triangulation, limit arrows | Cold geometric teal + red error terms |
| `s08.skill.angel_dropship` | Vertical dawn-light marks the drop; med-pods descend the beam; four candlestick struts unfold on landing; repair dew bounces inward to allies | Candelabra, dew drops, white-green med cross | Dawn gold + medical green |
| `s08.ult.krakow_bells` | Bell-pendulum outlines float up; first toll pushes a gold compression wave, second forms a rose-window light array, third rings each ally a full shield; afterglow falls as stained-glass shards | Morning bells, rose window, candle flames | Limestone + gold-green stained glass |
| `s09.skill.royal_hunt` | Ground brands kangaroo long-jump tracks with pasture fire-marks; twin-barrel speed bars stretch forward; each leap leaves a short tea-gold arc, no generic buff ring | Pasture brands, hunt horn, twin barrels | Oilcloth brown + hunting green + fire-mark orange |
| `s09.ult.sky_snare` | Four snare-stakes fire skyward and weave an inward-shrinking hunt-net; mesh tightens cell by cell toward the target; center forms a small gravity knot, not an explosion; lines reel back like lassos | Lasso, hunt-net, reserve marks | Brass + deep green |
| `s10.skill.allseeing_decode` | Archaeopteryx wing-fan opens as spectrum; packet blocks stream along feather-shafts into a central eye; error codes peel layer by layer; final sweep throws one hair-thin sight-line across the field | Feather-shaft circuits, packet brackets, all-seeing eye | Terminal green + platinum |
| `s10.ult.white_noise_void` | Broadband waterfall fills with dense color noise, wipes outside-in to pure white, then cuts to a black silence ring; wing bones survive only as negative outlines | Spectrum waterfall, delete cursor, negative wings | Color noise -> white -> near-black |
| `s11.skill.fatal_escapement` | Transparent escapement wheel spins against the target; teeth seat into stress points one by one; time stops on the last tooth; the weak point lights as a hair-thin gold crack | Escape fork, jewel bearings, crack graduations | Gunmetal + watch gold + ruby |
| `s11.ult.glashutte_retime` | Own body projects as an exploded diagram; gears, springs, and armor hover out in layers; the second hand runs one revolution backward; every part seats back exactly; shields close like blued-steel bezels | Concentric caliber, retrograde seconds | Watchmaker precision, no green heal wave |
| `s12.skill.lavender_moonveil` | New moon sweeps past the wing; stars string a cloak along the star chart; pale lavender mist covers the hull rearward; outlines crumble to stardust | New moon, star chart, lavender sprigs | Moon white + lavender |
| `s12.ult.homeward_constellation` | Sky chart reconnects severed routes; faint soul-lamps rise from downed positions and rejoin along the lines; center opens a star-gate toward home, not a holy array | Homing compass, star roads, home arch | Midnight blue + warm window-gold |

## Roster: Continental Steel Pact

| Move | Visual beat | Totem | Palette / mood |
|---|---|---|---|
| `t01.skill.steel_advance` | Red banner-geometry rises along track direction; rank arrows step forward row by row; horn pulse spreads as a wide fan toward the line, not a ring | Banners, track teeth, triple assault arrows | Parade red + steel gray |
| `t01.ult.ural_avalanche` | Artillery bearing ticks drop first; snow grains suck upward; staggered shells land amid overlapping white avalanche pressure-waves and black-orange blast; paralysis ends in short quake polylines | Ural ridgeline, gun ticks, avalanche wedge | Snow + blast + seismic linework |
| `t02.skill.neural_seventh_step` | Seven neural nodes overexpose along the move line; space stretches into a narrow prism rift; the body passes as the seventh node seals backward, leaving chromatic-dispersion afterimages | Folded seven, synapse chain, space seam | Violet-white dispersion + cold black |
| `t02.ult.galatea_fullsync` | Human neural outline and mech wireframe slide from offset into perfect overlap; seven broken rings lock in turn; full-sync holds one seamless white contour; fragility reads only as ring cracks when hits break it | Seven rings, brain-machine spine, 100% loop | Sterile white + neural violet |
| `t03.skill.cauldron_ram` | Heavy shield-plates clasp like furnace doors with rivets seating one by one; a rectangular dozer impact-face forms ahead; travel kicks coal-smoke and furnace stars | Furnace door, giant rivets, ram prow | Cast-iron black + furnace orange |
| `t03.ult.furnace_maelstrom` | Ground cracks into a boiler volute; molten-red streamlines spiral down to the core; the pressure gauge redlines then bursts into inward-rolling flame; scorched vortex prints remain | Pressure gauge, grate bars, melt spiral | Furnace red on blackened swirl |
| `t04.skill.grey_goose_cloak` | Goose feathers flip to background color head-to-tail row by row; a scan-blade wipes the radar-cross-section wireframe; wake keeps only low-contrast cold-gray ripples | Goose feathers, deleting scan-line, diamond frame | Gray-blue, low luminance, no glow halo |
| `t04.ult.reaper_gaze` | Narrow red view-cone searches, then locks one high-value target; four hunter brackets narrow stepwise; the next shot draws a slit-like red-white line like a single eye | Single eye, value ticks, four-corner lock | Graphite + dark red |
| `t05.skill.crane_stress_heal` | Crane-wing skeleton linework scans joint by joint; damaged nodes fold back nine micro-times; nanofibers regrow cracks like feather shafts; finish sets porcelain-smooth | Crane feathers, nine-fold circuits, joint stress map | Porcelain white + machine teal |
| `t05.ult.industrial_descent` | Assembly blueprints project overhead; crane ticks, track modules, and armor plates land in three layers; rectangular factory gates open along lanes pushing tank silhouettes out | Hook blocks, line takt, track seals | Blueprint engineering + hazard striping |
| `t06.skill.cloud_somersault` | Platinum cloud-bands roll up underfoot like dry-brush strokes; three ape-gait landing flashes blink ahead; the dash path curves S-shaped draconic, never a straight remnant | Tumble cloud, monkey-king footprints, cudgel seal | Rice-paper white + gilt + cinnabar |
| `t06.ult.heaven_riot` | Cudgel light-column stretches skyward then slams down; the cloud sea splits in two; mountain-crack patterns and hoop-rings mark the hit; war-stripes dance around the body | Gold hoop, cudgel, split mountain-cloud | Mythic gold-red on hard mechanical edges |
| `t07.skill.pterosaur_silence` | Wing-membrane heat-prints cool cell by cell like breathing; sound-wave contours gather rearward off wingtips; the body folds into one non-reflective black wing with only a faint glide vortex | Pterosaur membrane-bones, muted waves, closed pupil | Charcoal + cold violet-gray |
| `t07.ult.terminal_arrow` | No array; one hair-thin white line plus a single rhombic penetrator mark before the muzzle; world direction-lines converge on it while charging; the target takes a pinhole white flash first, then tears a long red-black wound late | Single-line arrow, penetrator rhomb, breath ticks | Minimalist high contrast |
| `t08.skill.broken_tuning` | A whole waveform enters then shatters into offset bars; staff lines snap like glass; the center pressure-node bursts inverted; enemy weapon icons fall silent one by one | Broken score, inverted waves, dragon-scale beats | Electric violet + songstress pink + black breaks |
| `t08.ult.dragon_aria` | Wireframe dragon-throat cross-section opens ahead; colored vocal cords resonate low-to-high in layers; release drives a scale-noded acoustoelectric tsunami; aftermath holds a soundless negative frame briefly | Dragon throat, aria arcs, full-range scale | Throat-wireframe chroma into silence |
| `t09.skill.martyrs_elegy` | Two calligraphic ribbons ink the muster path; tails resolve into banner-gates; rocket-troop silhouettes approach along the ink, no generic hex portal | Quill, elegy ribbons, rocket plumes | Indigo ink + copper gold |
| `t09.ult.missile_black_rain` | Sky-ink bleeds into black cloud; gold verse shatters into cruise-missile waymarks; slanted volleys land in batches; bursts bloom like ink-flowers burning orange-red | Ink rain, broken verse, missile wedge | Persian-miniature turned battlefield black rain |
| `t10.skill.prophetic_intercept` | Every incoming track grows a mirrored counter-track; parabola pairs meet at predicted points; kills flash hourglass-dual glints; all prediction lines clear at once | Dual parabolas, impact crosses, hourglass | Sand gold + survey teal |
| `t10.ult.sky_sanctuary` | Eight arch wall-panels rise on bearing ticks and join into a muqarnas-style dome; damage directions shunt along arches into the ground | Eight bearings, arches, refuge gate | Glazed teal + sandstone gold |
| `t11.skill.trench_doctrine` | Old contour map unrolls with pencil tactic arrows; each ally gains a body-hugging trench kink; enemy fire-lanes slide off into gaps | Contours, trench kinks, cigar ember | Aged paper + army green + charcoal white |
| `t11.ult.veteran_muster` | One short whistle pushes a narrow fan; boot-print rows and squad blocks appear column by column; gun barrels and shields emerge from smoke before infantry silhouettes press the line | Muster whistle, squad blocks, gapped banner | Battlefield realism, fantasy dialed down |
| `t12.skill.firefly_spectrum` | Few firefly points rise and sweep small fans in different bands; points link into a field-wide spectrum net that flashes distant outlines, then drifts free | Firefly glow-dots, spectrum comb, micro eye-spots | Night black + bio yellow-green |
| `t12.ult.collective_silence` | All marked targets join by hair-thin ghost-green nerve-lines; pulses arrive center together; the net blacks out, leaving one exact coordinate ember per target | Nerve net, mourning lamps, coordinate crosses | Ghost green into cold black, no generic EMP ring |

## Roster: Non-Aligned Market

| Move | Visual beat | Totem | Palette / mood |
|---|---|---|---|
| `m01.skill.night_bat_escape` | Twin bat-wing shadows wrap inward, then tear along sight into three black-red remnants; raven feathers scatter at the endpoint and drink back into night | Bat wings, raven feathers, blood-drop arrow | Near-black violet + dark blood-red |
| `m01.ult.blood_raven_feast` | Broken blood-moon rises behind; crow feathers rotate counterclockwise; hit reflux returns on thin blood-silk threads; each return briefly completes the moon | Broken moon, crow feathers, siphon veins | Gothic black-red on hard mechanical contours |
| `m02.skill.titan_stance` | Four load-piles drive down; heavy plates bite upward stratum by stratum; finish leaves only a low ridgeline silhouette and heavy settling dust | Rock strata, load piles, dinosaur back-plates | Basalt gray + earth gold |
| `m02.ult.cornerstone_oath` | Four corner megaliths rise at the zone corners; gold mortar seams run between into low walls; the keystone drops and seals the ring; impacts run off as gold stress-waves along walls | Keystone, mortar seams, oath knot | Old city stone + modern composite armor |
| `m03.skill.alpine_spring` | Contour lines and snowline draw first; repair pods land as blue-green meltwater runs downhill branches to allies; contact grows brief ice-crystal guards | Snowline contours, spring eyes, twin wake-trails | Ice blue + pine green |
| `m03.ult.aurora_revival` | Three aurora curtains close centerward from the rim; snowflake lattices patch ally armor along outlines; full shields crown overhead in aurora light | Aurora crown, hex snow-crystals, mountain outline | Polar teal-green + violet-blue |
| `m04.skill.steppe_mist` | Low steppe wind-bands roll in sideways; golden-eagle feathers settle over the hull with the flow; outlines dissolve like heat-haze on a far horizon | Eagle feathers, steppe wind-print, nameless seal | Mist gray + leather brown + eagle gold |
| `m04.ult.eagle_skyeye` | High eagle-eye drops a long view-cone; a steppe compass unfolds field-wide; each ally takes one tailwind feather-mark; vision, range, and mobility buffs read as three wind-bands in different directions | Eagle eye, eight-wind compass, falconer wrist-knot | Wind-mapped triple buffs |
| `m05.skill.blackout_breaker` | Four breaker knife-switches frame the zone with current still dancing on Tell; Release drops all switches at once; light sources die cell by cell leaving crawling violet residual arcs | Knife switches, cut lines, dead bulbs | Industrial black + warning violet |
| `m05.ult.thunder_judgement` | Black storm-clouds build as flat hard-edged shadow slabs, never textures; six-to-ten vertical pillars fall on judgement ticks; center ends in an inverted electric-chair arc-frame; paralysis closes on ground-crawl arcs | Scales, breaker glyphs, falling volts | Black-violet + snap white |
| `m06.skill.carnival_vanguard` | Streamers act as three precise coordinate bands meeting mid-air, not decoration; the crossing opens a drum-head portal; rocket-troop silhouettes land along lanes on samba-drum beats | Coordinate knots, war drums, rocket plumes | Brazil green-yellow-blue + military black |
| `m06.ult.helicopter_carnival` | Fan deck-light grating unfolds off the carrier back; helicopter ranks lift in feather-crest tiers; rotor wash presses streamers into directional wakes; the formation tilts onto the line as one | Crest feathers, rotors, deck grid | Festive order, never confetti chaos |
| `m07.skill.border_dome` | Four-to-eight boundary steles slam down along the authority radius in turn; vertical plasma gate-faces span between and bend into a dome; contacts score one white mark on the nearest stele | Stele number-slots, drop gates, hazard striping | Concrete gray + plasma teal |
| `m07.ult.total_exclusion` | Zone slices into a red no-go grid with borders dropping segment by segment like great gates; barrages pour on grid-intersection order; the rim holds inward prohibition arrows -- denial, not one blast | Blockade grid, prohibition lines, fire coordinates | Alert red + scorched black |
| `m08.skill.paid_positioning` | One minimal contract check-mark lights toward the destination; only folding ruler-ticks span start to end; a single bill-green confirmation flash teleports the body along the fold, no magic circle | Check-mark, folding ruler, coordinate decimals | Matte black + bill green + cold white |
| `m08.ult.formless_finale` | A hollow ink "formless" ring swallows the body; the frame holds only a breathing black-white negative; the reveal instant slices the ring with one ultra-thin sniper line; the target takes a soundless rhombic breach, then all falls back to zero | Hollow ring, severed-contract line, rhombic bullet-hole | Ink black-white + one cold-gold flash |

## Implementation contract

### Data and entry points

- Keep `spawnCastFx(scene, effects, opts)` the sole entry for battlefield and showcase.
- Extend the current `a/m/c/c2` tables to 64 unique `profileId`s; character tables select
  profiles only, while lifecycle and shared assets stay centralized in `castfx.js`.
- `opts.r`, `opts.dur`, `opts.scale`, `opts.at`, `opts.casterPos` remain the sole size,
  duration, and position sources; profiles MUST NOT hardcode damage radii.
- `CAST_SIG` drives body casting poses only; profiles may choose launch direction and
  hardpoint semantics but MUST NOT duplicate the pose state machine.

### Performance budget

- Minor-cast visible cap: 4 material layers, 3 draw calls, 24 instances.
- Ultimate visible cap: 7 material layers, 5 draw calls, 48 instances.
- Summon silhouettes, barrages, notes, sparks, rain, fireflies, and grid nodes batch
  via `InstancedMesh` or single procedural textures.
- Module-level shared geometry, `CanvasTexture` cached by semantic key; no object
  creation, array growth, or timers during fade/update.
- Transparent layers use hard-contour core/halo; at most three large transparent faces
  per pixel to bound overdraw.
- Showcase angle swaps and effect expiry MUST release per-cast materials; shared
  geometry and textures are never disposed.

### Acceptance

- Record Tell, Release, Contact frames for all 64; at least 56 stay recognizable by
  silhouette in grayscale, the remaining 8 by motion direction or contact tail.
- Same body's Q/E MUST NOT share archetype, magic-array base, or timing curve.
- No two bodies share an identical profile combination; `rune` retires as the default
  totem, and missing profiles fail loud in dev mode.
- Run `node tools/audit_client_syntax.mjs`, `node tools/audit_cast_jump.mjs`,
  `node tools/audit_gpu_lifecycle.mjs`, keeping the `--break-vfx-ease` counter-proof.
- Click through all 32 bodies x Q/E in the live showcase; animations MUST NOT abort,
  console stays at 0 errors, and renderer memory returns to steady state after clearing.
