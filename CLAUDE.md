# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

無人戰略:鋼鐵與蜂群 (Steel vs. Swarm) — browser-based DOTA+FPS: drones (SWARM) vs mechs (STEEL) on 3D battlefields generated from real-world map data (OSRM roads, AWS terrain tiles, Esri satellite imagery, Overpass buildings). Node.js + `ws` server, vanilla-JS ES-module client, Three.js 0.160 via CDN importmap. **No build step, no bundler, no framework, no TypeScript** — do not introduce any. Comments and UI strings are Traditional Chinese; keep that convention.

## Commands

```bash
npm start                 # server on http://localhost:8620 (--port <n> to override; PORT=x env prefix does NOT work in PowerShell)
npm test                  # node test/e2e.mjs (~60 assertions)
```

### ⚠️ `npm test` does NOT start the server — critical trap

`test/e2e.mjs` is only a WebSocket client against `ws://localhost:8620`. After editing `server/*.js` or `public/js/data.js` you MUST restart the server or the tests silently exercise stale code and can pass green. Worse: on Windows, Node's SO_REUSEADDR lets **two servers LISTEN on 8620 simultaneously** (no EADDRINUSE) — connections split across processes and tests fail bizarrely (lost events, `timeout: host`).

Before every test run:
1. `netstat -ano | grep :8620` — inspect **all** LISTENING lines (don't truncate with head).
2. `taskkill` every listener **including npm parent processes**; re-check for 0 listeners.
3. Start a fresh `node server/server.js`, then `npm test`.

Test structure: first half imports `BattleSim` directly (deterministic unit tests: mines, magazines, damage multipliers, self-destruct, shop, AA ambush — dummy creeps added via `_add` have no `lane`, delete them before `tick`); second half is WebSocket end-to-end. Browser smoke tests: reuse Playwright from `file:///C:/Users/user/Documents/app/mapping_elf/node_modules/playwright/index.mjs`; `window.__SVS` exposes app state; `__SVS.net.send({t:'createRoom', battleConfig: <synthetic cfg>})` skips the slow OSRM scan.

## Architecture

```
server/server.js   HTTP static + WS rooms/matchmaking + 8Hz battle broadcast + bot management
server/sim.js      BattleSim — server-AUTHORITATIVE simulation (single source of truth)
server/bots.js     BotBrain — computer players (push/engage/retreat state machine)
public/js/data.js  Shared constants (SIDES/UNITS/WEAPONS/ECON/GAME/HAZARDS/FIELD) —
                   the server imports this client file directly; all balance numbers live here
public/js/         net.js (WS reconnect) · mapSelect.js (real-map site picking + OSRM lanes) ·
                   venues.js (21 precomputed venues + localStorage favorites) ·
                   terrain.js (elevation + satellite-textured mesh, heightAt/sampleColor) ·
                   biomes.js (satellite-color biome classification, vegetation InstancedMesh,
                   Overpass buildings/rails/waterfalls) · models.js (MODEL_MANIFEST GLB +
                   procedural fallback) · toon.js (cel-shading core) · vfx.js (comic FX) ·
                   hazards.js (re-exports toon.js for compat) · game.js (FPV cockpit, physics,
                   snapshot interpolation) · main.js (screen flow) · environment.js (season/time/weather)
reference/         Read-only upstream copies (mapping_elf, ai_tycoon) — consult, never edit
doc/               Design plan HTML; docs/ story & characters
```

### Server-authoritative rules

- All HP/damage/ammo/economy/win-loss resolves in `sim.js`. Clients report hits (`heroHit`) and inputs; the server gates fire rate + magazine via `_gateFire` (humans get ×1.5 leniency). Client `wstate` is HUD-only and drifts slightly from server ammo — by design (misses aren't reported).
- Heroes are keyed by **pid** (connection id) in a `heroes` Map; bots use string pids (`'b1'`). Snapshots carry pid; clients identify themselves by it.
- **Fog of war is server-side**: `snapshotFor(side)` filters units only — towers/bases/neutral ents are always visible. `snapshot()` = unfogged (spectators/tests). Same tick emits SWARM/STEEL/spectator snapshots sharing one cached frame (`_tickN`/`_frameTickN` — events may only be cleared once). E2E tests that need to "see" enemy units must use a `mode:'spectator'` client for discovery; actions still come from the real players (fog affects snapshots only, never server-side hit validation).
- `createRoom` requires a valid prebuilt `battleConfig` (server validates lane count/distance). There is no in-room map-select phase; `backToRoom` keeps the map. Environment (season×time×weather) is resolved once at room creation into `cfg.env` — identical for the whole room.
- Hazards/AA sites are **neutral ents** (`side:null, neutral:true`): `_acquireTarget` (sim), `_acquire` (bots), and the main tick loop must all skip neutrals, else `UNITS[kind]` is undefined and crashes. `inv:true` ents are indestructible (`_damage` early-returns).
- Death→respawn must span a full tick (`deadTick` guard) so `dead:true` reaches at least one broadcast snapshot — clients edge-trigger `_onSelfDeath` off it. Don't "optimize" this away.

### Constants coupled to tests — change together or not at all

- Weapon `range` values are all deliberately **> 200**: e2e fires vertically from y=250 and `heroHit` checks `d3 > range*1.25`. Lowering any range below ~200 breaks those tests.
- Tower SAM `range: 240` is deliberately **< 250** so e2e high-altitude probes at y=250 aren't locked. Changing SAM range or tower positions requires revalidating e2e.
- `fakeBattleConfig` in e2e uses 1600m×L base distance (vs production 1000×L) as an anti-air safety margin — do not shrink it.
- AA-ambush tests park a drone with `hp: 99999` directly above an `aasite` to avoid tower fire.

### Rendering conventions (toon.js / models.js / biomes.js)

- Cel-shading core lives in `toon.js` (`hazards.js` only re-exports). 3-step ramp `[102,182,255]` — the dark step was once 88 and crushed dark hulls to pure black; don't lower it. `MeshToonMaterial` has no roughness/metalness/flatShading — `mat()` strips them and maps `metalness ≥ 0.5` to the celMetal hard-highlight patch.
- `outlinify()` inverted-hull outlines: skip transparent materials and `userData.noOutline`; vegetation/building InstancedMesh are deliberately NOT outlined; SkinnedMesh outline shells share the source skeleton.
- Models: `MODEL_MANIFEST` maps units to Quaternius CC0 GLBs with automatic procedural low-poly fallback on load failure. Prefer open-source (Quaternius) models over procedural geometry when adding assets; delete 20MB normal maps (toon shading ignores them) and rewrite the gltf to drop the references. SkinnedMesh: measure with `computeBoundingBox()` (skeleton-aware) and disable `frustumCulled`, or models vanish/misplace.
- Shooting raycasts hit units + `terrain.mesh` only — vegetation is visual-only for performance; keep it out of raycast targets.
- Determinism across clients: vegetation/scatter uses `mulberry32` seeded from battlefield center so all players see the same scene.

### Known footguns

- Leaflet: call `map.stop()` before destroying a map, or removal during a `fitBounds` animation throws `_leaflet_pos`.
- FPV cockpit is parented to the camera — the camera must be `scene.add`ed.
- Helicopter creeps are intentionally NOT wired into the tower-SAM/AA-ambush missile system (that system looks up heroes by pid; heli is a pidless creep). They take normal tower fire only.
- External APIs (OSRM demo, Overpass, terrain tiles) are rate-limited/flaky: every fetch path has an offline/procedural fallback (synthetic Bézier lanes, procedural blocks). Preserve fallbacks when touching fetch code.
- In `openroom`, a saved-favorite `battleConfig` bakes in its teamSize; switching the team-size buttons without a selected venue must clear `favCfg` (server rejects mismatched lane counts). In map flows, call `mapSel.showConfig` **before** setting `favCfg` (showConfig's internal reset fires `confirmReady(null)` which clears it).
