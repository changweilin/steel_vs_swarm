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

Build the capture path into the app instead. Method source: sakura-crossing `AGENTS.md`
"Verifying visual changes".

---

## 0. First thing after any edit: build headless and read the stack

A world that throws inside its build function leaves the exposed scene handle
**undefined and the console empty** — the error is swallowed, and every capture call then
fails with a message that says nothing about the cause. Before debugging anything else:

```js
// via the browser JS tool — a three-method stub is enough if the builder only calls scene.add
try {
  const w = await import('/src/world/index.js?t=' + Date.now());
  w.buildWorld({ add() {}, children: [], traverse() {} });
  'built OK';
} catch (e) { 'THROW: ' + e.stack; }
```

This turns "the page is blank and there is nothing in the console" into a file and a line
number, in one call.

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

**A mystery surface filling half a frame is worth one raycast, not three guesses.** Every
time it was guessed from the shape it was wrong (0 for 3: a "bare cutting bank" was a
masking wall at 1.96 m; a "tan hillside" was an unplanted tunnel cap). Recipe:

1. Render the frame, then `camera.updateMatrixWorld(true)` — `setFromCamera` reads
   `matrixWorld`, which an on-demand capture does not flush; skip this and the ray fires
   from wherever the camera was two shots ago.
2. Fire at the middle of the mystery area; the hit returns **mesh name, parent and
   distance**.
3. To turn a world-space hit back into authoring coordinates when a projection/bake is
   involved: minimise `positionAt(x, 0, z).distanceTo(hit)` over a coarse-to-fine sweep
   (4 / 1 / 0.25 / 0.05 m) — converges in milliseconds.

Two ray-direction traps: verify a wall-mounted prop's clearance by firing **out of its
back**, not from behind the wall coming forward (inside a building the ray hits an
interior face and reports a metre of clearance that is not there); and find coplanar
sheets by firing at the wall and reading the **hit list** — two hits at the same depth is
the z-fighting coin toss.

Related: check a cross-section **numerically** against whatever must fit through it, rather
than by eye. A tunnel bore whose arch was written from its radius instead of its springing
put the crown 2.75 m out and ran a train through solid rock — invisible for the structure's
whole life, because a tunnel is a dark hole with a dark shape moving in it. Write a
`clearance()` function and keep it runnable.

---

## 5. Keep a fixed camera set — and derive every camera, never guess it

Maintain a checked-in list of establishing shots, one per area, and run the relevant ones
**before and after** any change that could touch them.

```js
await __shot('open',   1400, 790, {});                                              // opening frame
await __shot('gate',   1400, 790, { pos: [12.6, 0, -49.5], yaw: -1.42, pitch: 0.1 });
await __shot('yard',   1400, 790, { pos: [39, 0, -45],     yaw: -0.7,  pitch: 0.03 });
```

Fixed cameras make diffs meaningful. Ad-hoc angles cannot prove absence of regression, and
"I took a screenshot and it looked fine" is not a verification of anything you did not frame.

**Derive the yaw with a helper; never write the number by hand.**

```js
window.look = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));
await __shot('x', 1400, 790, { pos: [13.4, 0, 44.4], yaw: look([13.4, 44.4], [15.8, 51.5]), pitch: 0.1 });
```

A yaw with the signs flipped is the same number reflected through the origin — **a wrong
yaw does not look wrong; it returns a perfectly composed frame of something else.** Three
hand-written cameras were 180° out and two had never actually been looked at. If a frame
does not contain the thing its comment names, suspect the sign before suspecting the world.

**Vet a new camera position before shooting it** — half of positions picked off a plan
land inside something:

1. **Against the collider list** — a spot inside a shop, a machine or a parked van comes
   back as a wall with a ceiling on it and no clue why.
2. **Against the terrain along the sight line** — a viewpoint 1.6 m behind a crest frames
   pure hillside. Four lines find it in one call, and can pick the best spot for you:

   ```js
   const sees = (x, z, tx, tz, ty) => {          // eye ~1.7 above the ground
     const y0 = groundAt(x, z) + 1.7;
     for (let t = 0.05; t < 1; t += 0.03) {
       const px = x + (tx - x) * t, pz = z + (tz - z) * t;
       if (groundAt(px, pz) > y0 + (ty - y0) * t - 0.4) return false;
     }
     return true;
   };
   // sweep the candidate ridge/area and take the best point that passes —
   // 75 of one ridge's points passed and no amount of looking at renders would say which
   ```
3. **Against water** — a capture helper that re-derives feet from the height query seats
   the camera on the *bed* inside a lake, 0.5–2.6 m under the surface, and single-sided
   water is invisible from below: the frame is a flat pale field with the scene floating
   above it and nothing to diagnose from. If `heightAt(x,z) < waterY`, the spot is in the
   water.
4. **Against elevated platforms** — a height query that maxes over every platform seats
   the camera on a roof deck **above** where you asked for, anywhere inside that
   building's footprint. If a shot comes back looking at the roof when you asked for a
   shopfront, that is what happened.

Cheapest of all: build a **coordinate readout into the game** (a debug key that prints the
authoring-space `{ pos, yaw, pitch }` and copies it to the clipboard). Walking to the spot
and copying the line beats every derivation above.

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
| A frame of a wall with a ceiling on it | The camera position is inside an object — vet positions per §5 |
| A flat pale field with the scene floating above it | The camera is under single-sided water |
| An interaction plays but nothing visibly happens | The moved object is inside opaque geometry (a can released *behind* a printed panel is inside the machine). Check where the thing it moves actually **is**, before checking the logic |
| A recessed detail invisible from where the player stands | A pocket is only visible along sight lines shallower than `atan(height / depth)` — check from the interaction distance, not from a convenient render |

**Performance readings:** wall-clock frame time drifts 33–42 ms run to run with nothing
changed, so it cannot resolve anything under ~8 ms. Judge changes by **draw calls**, and
only trust a timing you can reproduce across several alternating A/B runs in one page
session. Know your most expensive fixed cameras (a high vantage can cost 2× the ground
views because nothing is culled) before blaming a change for a regression measured there.

---

## Order of operations

1. `preview_start` the dev server; confirm `window.__scene` exists.
2. `player.reset()` → `__shot('before', …, {})` for the baseline frames you will compare.
3. Make the change (HMR usually applies it; re-check `__scene` after a hard error).
4. Re-shoot the **same** camera list.
5. `Read` both images and state the difference in words. If you cannot name the difference,
   you have not verified it.
6. For anything time-dependent, step and shoot; for anything geometric, raycast in Node.
