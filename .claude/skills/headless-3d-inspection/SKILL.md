---
name: headless-3d-inspection
description: Let an agent actually see and measure its own 3D/WebGL work when browser screenshots time out — dev-only capture endpoint, hand-stepping the world because rAF never fires, pass toggles, fixed camera set, and Node-side raycast checks with no browser. Use when verifying a visual change, capturing before/after frames, testing an animation or interaction sequence, or when `computer{action:"screenshot"}` fails on a canvas app.
license: MIT
compatibility: Vite/any dev server + Three.js or similar WebGL app
---

# Headless 3D Inspection

**Agent-driving browsers frequently cannot screenshot a WebGL canvas.** The pane does not
composite, so captures time out *and* `requestAnimationFrame` never fires — which means
the app is also frozen. Do not spend turns retrying the screenshot tool.

Build the capture path into the app instead. Method source: sakura-crossing `CLAUDE.md`
"Verifying visual changes".

---

## 1. Dev-only capture endpoint

Mount a `POST /__shot` route on the dev server and expose `window.__shot()` that renders
**one frame on demand** and writes it to a folder the agent can `Read`.

```js
await __shot('name', 1600, 900, { pos: [1.85, 0, 13.6], yaw: 0.2, pitch: -0.01 })
await __shot('orbit', 1300, 1300, { orbit: 0.6, dist: 3.4, tilt: 0.85 })   // external view
await __shot('raw',  1600, 900, { ink: false })                            // pass toggle
```

Then `Read` the resulting image file.

Requirements:

- **Gate behind the dev flag** (`import.meta.env.DEV`). Its absence is then a reliable
  signal that you are on a production build.
- **Render one frame explicitly** inside the call — never rely on the animation loop.
- **Accept camera overrides**, and re-derive dependent state (ground height under the
  player) from the app, not from the caller.
- **Expose pass toggles** (`{ ink: false }`, `{ grade: false }`) so a layer can be isolated.
  This is how you tell "the line pass is wrong" from "the material is wrong".
- **Empty options must mean "do not move anything"** — needed whenever you have posed the
  scene by hand (see §3).
- Write to a fixed folder; return the path.

---

## 2. Expose the app on `window`

```js
window.__scene = { scene, camera, renderer, pipeline, world, player, /* subsystems */, THREE };
```

Everything below depends on this. If it is `undefined`, the dev server has probably died —
restart it rather than debugging the app.

---

## 3. Nothing animates: step the world by hand

```js
const w = window.__scene.world;
for (let i = 0; i < 60 * 120; i++) w.update(1 / 60);    // 120 simulated seconds
```

**Interaction sequences are the same pattern — fire, step, shoot:**

```js
const s = window.__scene;
s.world.interactables.find((i) => i.label.includes('vending')).action();
for (let i = 0; i < 24; i++) s.world.update(1 / 60);
await __shot('vend', 1300, 780, { pos: [14, 0, 7.6], yaw: -1.5708, pitch: -0.30 });
```

This is also how you **measure** timing: step frame by frame and find the interval an
object is present. ("in the tray after ~24 frames, gone after 156" ⇒ a 2.2 s window.)

**Subsystems with their own update need their own step.** If the capture helper moves the
player and re-derives its height, but a vehicle is only moved by `vehicle.update()`, then:

```js
const s = window.__scene, p = s.player;
p.pos.set(1.6, 0, 30); p.pos.y = s.world.heightAt(1.6, 30); p.yaw = 0; p.pitch = -0.02;
s.vehicle.summon(); s.vehicle.mount(); s.vehicle.update();
await __shot('ride', 1200, 700, {});      // empty options — do NOT re-pose the player
```

**No keyboard exists in a headless page.** Simulate input by setting the input-lock flag,
inserting keys into the key set, and stepping the player and the vehicle together. This is
the only way to measure top speed, acceleration, or a lean/bank building up.

---

## 4. When you do not need a picture

**"Can this be seen from there" is a raycast, not a screenshot** — and it runs in Node with
no browser at all, which matters because the capture endpoint is the one tool with no fallback.

```
1. stub `document` with a proxy that no-ops every Canvas2D call
   (geometry never depends on what the canvas contains)
2. import the builder module directly
3. step the animation N frames
4. fire a ray from a plausible eye position toward the target, stopping just short
5. report which mesh is in the way, and for how many frames
```

Use this for occlusion, sightlines, "is the prop inside the wall", and visibility windows.
It answers a specific question exactly, where a screenshot answers a vague one approximately.

Related: check a cross-section **numerically** against whatever must fit through it, rather
than by eye. A tunnel bore whose arch was written from its radius instead of its springing
put the crown 2.75 m out and ran a train through solid rock — invisible for the structure's
whole life, because a tunnel is a dark hole with a dark shape moving in it.

---

## 5. Keep a fixed camera set

Maintain a checked-in list of establishing shots, one per area, and run the relevant ones
**before and after** any change that could touch them.

```js
await __shot('open',   1400, 790, {});                                              // opening frame
await __shot('gate',   1400, 790, { pos: [12.6, 0, -49.5], yaw: -1.42, pitch: 0.1 });
await __shot('yard',   1400, 790, { pos: [39, 0, -45],     yaw: -0.7,  pitch: 0.03 });
```

Fixed cameras make diffs meaningful. Ad-hoc angles cannot prove absence of regression, and
"I took a screenshot and it looked fine" is not a verification of anything you did not frame.

---

## 6. Reading a captured frame

| Observation | First hypothesis |
|---|---|
| A material edit produced a **pixel-identical** frame | That surface is not being drawn — usually two coplanar faces. **Never** a subtle material problem |
| An object is missing entirely, no error | Multi-material mesh lost its `geometry.groups`; a material array with no groups draws nothing |
| A decal renders as a blur | Texture aspect vs face aspect mismatch (e.g. 512×128 on a 0.24×1.5 m face = 25× crush) |
| Something flies through the sky keeping pace with its parent | An animated transform on a mesh whose geometry was baked to root space — it now swings about the world origin |
| A sign reads mirrored | Box faces already reverse `udir` on negative axes; an extra mirror flip is the bug, not the fix |
| Everything uniformly dark for no reason | A closed sky/planet sphere is casting shadows onto the world |

---

## Order of operations

1. `preview_start` the dev server; confirm `window.__scene` exists.
2. `player.reset()` → `__shot('before', …, {})` for the baseline frames you will compare.
3. Make the change (HMR usually applies it; re-check `__scene` after a hard error).
4. Re-shoot the **same** camera list.
5. `Read` both images and state the difference in words. If you cannot name the difference,
   you have not verified it.
6. For anything time-dependent, step and shoot; for anything geometric, raycast in Node.
