---
name: mobile-webgl-interaction
description: Make a WebGL scene feel native in a phone browser — one Pointer Event path for mouse and touch, per-finger slots, tap-vs-drag discrimination, synthesised hover, the viewport/CSS incantations, DPR clamping with hysteretic adaptive scaling, device tiers and asset variants. Use when adding touch controls, when taps also drag or zoom the page, when hover-driven affordances are dead on touch, when the frame rate oscillates, or when a scene is unusable on a phone.
license: MIT
compatibility: Any browser WebGL app; Three.js examples
---

# Mobile WebGL Interaction

Two independent problems that both get reported as "it's bad on mobile":

- **Input** — the browser is fighting you for the gesture (L1–L3).
- **Frame budget** — the device cannot afford what you are drawing (L4–L5).

Method sources: `messenger.abeto.co` (pointer abstraction, adaptive DPR, device tiers);
sakura-crossing (render-target scaling).

> In this repository the device/scheme seam is `ctrlmode.js` `deviceScheme()`, the
> low-power flag lives in `mobile.js`, and the adaptive resolution governor already exists
> in `postfx.js`. Extend those rather than adding a second source of truth.

---

## L1 — One input path: Pointer Events with finger slots

**Do not write `mousedown` and `touchstart` handlers.** Bind pointer events only, and
normalise the type:

```js
node.addEventListener('pointerdown',   onStart);
node.addEventListener('pointermove',   onMove);
node.addEventListener('pointerup',     onEnd);
node.addEventListener('pointerout',    onEnd);      // ← easy to forget; a lost pointer sticks
node.addEventListener('pointercancel', onEnd);      // ← system gesture takeover
node.addEventListener('contextmenu',   preventDefault);
node.addEventListener('touchstart',    preventDefault, { passive: false });
document.addEventListener('dblclick',  preventDefault);

input = e.pointerType === 'mouse' ? 'mouse' : 'touch';
```

Four of those five listeners exist for failure modes rather than for the happy path:
`pointerout` and `pointercancel` are how a drag ends when the finger leaves the canvas or
iOS takes the gesture; `touchstart` with `passive: false` is the only way to stop the page
scrolling and rubber-banding under the canvas; `dblclick` prevention stops double-tap zoom.

**Allocate a fixed number of finger slots and match pointers to them by `pointerId`:**

```js
const free  = slots.find(s => s.touchID === false);            // on pointerdown
const slot  = slots.find(s => s.touchID === e.pointerId);      // on move/up
```

Declare the count up front (`fingers: 2` covers look + move, or drag + pinch). Slots make
multi-touch state a small fixed array instead of a map that leaks entries when a pointer
disappears without an `up`.

Store three coordinate forms per slot once, at capture — pixels, `[0,1]`, and `[-1,1]` —
because raycasting wants one and UI wants another and converting at the call site is where
the y-flip bugs come from.

---

## L2 — A tap is a distance and a duration

```js
const moved   = Math.hypot(x - start.x, y - start.y);
const elapsed = now - start.time;
if (moved >= CLICK_DIST || elapsed >= CLICK_TIME) return;      // it was a drag / a hold
if (e.pointerType === 'mouse' && e.button !== 0) return;
if (e.type === 'pointerout') return;
emit('click');
```

A native `click` on a canvas fires after a drag, fires after a long press, and on iOS
arrives ~300 ms late behind a synthetic-event heuristic. Deriving it yourself from the two
thresholds is four lines and removes all three problems.

**Synthesise hover for touch.** Affordances built on hover (highlight, pulse, label,
scale-up) are otherwise simply dead on a phone:

```
TOUCH_START →  hover_in  then  touch_start      // hover fires first, so the visual plays
TOUCH_MOVE  →  hover_in if not already hovering, then move / drag
TOUCH_END   →  touch_end then hover_out
```

Mouse `pointerup` keeps hover; touch `pointerup` releases it. That single asymmetry is what
makes the same UI code correct on both.

**Give interactive world objects a visible, animated affordance** rather than relying on the
cursor: a `uShow`/`uShowDistance` fade so markers appear within range, a `uPulse` that
breathes, a `uWiggleDir` nudge on hover, and a scale-up on touch. On a touch screen the
pointer is under the user's own finger, so the feedback must be large and must start
*before* the finger lands (proximity), not after it lifts.

---

## L3 — The page-level incantations

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1.0, shrink-to-fit=no, minimal-ui, viewport-fit=cover">
```

```css
html, html body { margin:0; padding:0; width:100%; height:100%;
                  overflow:hidden; touch-action:none;
                  -webkit-text-size-adjust:100%; text-size-adjust:100%; }
#app { position:absolute; inset:0; overflow:hidden; }
```

- **`touch-action: none`** on the root is what stops pan/zoom being stolen before your
  handlers run. `preventDefault` alone is not enough on all engines.
- **`viewport-fit=cover`** plus `env(safe-area-inset-*)` padding on any HUD, or controls sit
  under the notch and the home indicator.
- **`-webkit-text-size-adjust`** stops iOS inflating HUD text in landscape.
- **Debounce resize by device**: ~50 ms normally, **~500 ms on iOS**, and listen to
  `orientationchange` as well as `resize` — iOS fires several intermediate sizes during a
  rotation and the last one is the only correct one. Resizing render targets on each of
  them is both a hitch and a wrong result.
- Handle `visibilitychange`, `focus` and `blur` explicitly: pause the clock, pause audio,
  and **do not accumulate `dt` across a backgrounded period** — the first frame back
  otherwise integrates a 40-second step through every physics and animation system.

**Probe capabilities once into a struct**, and branch on the struct — never on a
user-agent string at the call site:

```js
capabilities = {
  webgl2:   WebGL.isWebGL2Available(),
  webgpu:   navigator.gpu !== undefined,
  touch:    'ontouchstart' in window || navigator.maxTouchPoints > 0,
  offscreenCanvas: !!HTMLCanvasElement.prototype.transferControlToOffscreen,
  imageBitmap: true,        // then disabled for known-broken engines
  opus:     true,           // then disabled for Safari
  colorScheme: !!matchMedia?.('(prefers-color-scheme: dark)'),
  fullScreen: document.fullscreenEnabled || …,
};
```

A few capabilities really are per-engine, not per-feature-test: `createImageBitmap` exists
but misbehaves on some Safari and older Firefox; Opus in Ogg is unavailable on some Safari.
Keep those as **named exceptions with a version check**, in the same struct.

---

## L4 — Resolution: clamp first, then adapt

**Clamp DPR before anything else.** A 3× phone at native resolution is 9× the fragment work
of a 1× render for a display difference nobody can see at arm's length.

```js
const DPR = window.devicePixelRatio <= 2
  ? Math.min(window.devicePixelRatio, 1.15)
  : Math.min(window.devicePixelRatio, 1.5);
```

Then **adapt with hysteresis and a stop condition**:

```
window of ~4–5 frame times, first sample ~2 s after start (skip warm-up)
median < 30 fps      → multiplier −0.1  (floor 0.6)
median ≥ 60 fps      → multiplier +0.1  (ceiling 1.0)
count direction flips; after ~4 flips, stop adapting entirely and log it
```

The flip counter is the part people leave out, and it is the one that matters: without it a
device sitting exactly on a threshold oscillates between two resolutions forever, and the
*change* is far more visible than either resolution.

**Canvas at display size, scale on the render targets** (this also gives you supersampling
on low-DPI desktops, which is what keeps a line pass clean):

```js
renderer.setPixelRatio(1);
renderer.setSize(w, h, true);        // CSS size
rt.setSize(w * scale, h * scale);    // internal size carries the scale
```

And **never MSAA on a tiler**. It is a bandwidth cost on mobile GPUs and it does nothing at
all for lines produced in a post pass, because those are not on geometry edges. Supersample
plus FXAA instead (`cel-shading-pipeline` L5c).

---

## L5 — Device tiers and asset variants

Derive one or two coarse tier flags at boot and branch on those:

```js
iOS        = browser === 'safari' && capabilities.touch;
iphone     = iOS && min(screen.w, screen.h) / max(screen.w, screen.h) < 0.65;   // aspect, not UA
oldIphone  = iphone && devicePixelRatio < 3;
lowMemoryDevice = iphone;
```

Aspect ratio as the phone test is deliberate: it is a property of the *screen*, survives UA
freezing, and does not need a device list.

Then ship variants, not just lower settings:

| Asset | High tier | Low tier |
|---|---|---|
| Textures | `*-highq.ktx2` (GPU-compressed, mipmapped) | smaller encode, same format |
| Music | `bgmusic-highq.ogg` | `bgmusic-mobile.ogg` — a different encode |
| SFX bank | ~40 decoded buffers | **not registered at all**; one bed + one sting |
| Shadows | full map | reduced or off |
| Post chain | full | drop the optional passes, keep the line pass |

Two rules that make this honest:

- **Use GPU-compressed textures (KTX2 + Basis) and geometry compression (Draco/meshopt) on
  every tier.** They cut *GPU memory*, not just download — which is the resource that
  actually fails on a phone.
- **A tier that only lowers numbers is not a tier.** The reference project's low-memory
  branch skips the whole SFX bank rather than loading it quieter, because decoded audio
  buffers compete with textures for the same budget.

**Loading UI costs nothing:** an inline SVG frame sequence driven by pure CSS
`visibility` keyframes with staggered `animation-delay` runs while the main thread is
blocked compiling shaders. A JS-driven spinner freezes exactly when it is needed.

**Persist settings through a `localStorage` Proxy** so writes are automatic and a parse
failure resets to `{}` rather than throwing on boot:

```js
let data = {}; try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const storage = new Proxy(data, { set: (o, k, v) => (o[k] = v, save(o), true) });
```

---

## Verification

- **Test rotation, not just size.** The 500 ms iOS debounce, the safe-area padding and the
  render-target resize all only fail during a rotation.
- **Test with the tab backgrounded and returned** — that is where `dt` accumulation, audio
  resume and rAF suspension all show up at once.
- **Test a tap that moves 5 px** and a **300 ms press**; both must not be clicks, and on a
  phone both happen constantly.
- **Watch the DPR multiplier over a minute** on a mid-tier device: if it is still moving,
  the flip stop is not working.
- Frame-time noise on a desktop can be 8 ms run to run. **Compare draw calls** when judging
  a change; only trust a timing difference reproducible across alternating A/B runs inside
  one page session.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| Page scrolls / rubber-bands under the canvas | Missing `touch-action: none`, or `touchstart` bound without `{ passive: false }` |
| Double-tap zooms the page | No `dblclick` prevention |
| A drag also fires a click | Native `click` used instead of a distance + duration test |
| Taps feel 300 ms late on iOS | Same cause |
| Hover-driven affordances are invisible on touch | No synthesised `hover_in` on `touch_start` |
| A drag never ends; the camera keeps spinning | `pointerout` / `pointercancel` not bound |
| Multi-touch state leaks after a few minutes | Pointers tracked in a map instead of fixed slots |
| Controls sit under the notch / home indicator | Missing `viewport-fit=cover` + safe-area padding |
| Render targets are the wrong size after rotating | Resize not debounced long enough on iOS, or `orientationchange` not bound |
| Everything jumps on returning from a background tab | `dt` accumulated across the hidden period |
| Frame rate oscillates visibly | Adaptive DPR without hysteresis and a flip-count stop |
| Phone runs hot and slow at "low settings" | DPR not clamped — that is 9× the fragment work before any setting matters |
| Aliasing is still bad after enabling MSAA | Lines produced in a post pass are not geometry edges; supersample + FXAA |
| Out-of-memory on older phones | Uncompressed textures, or a full decoded audio bank on the low tier |
| The loading spinner freezes | Driven by JS on a main thread that is compiling shaders |

---

## Reference implementations

`WebFetch` gets 403 on both sites — use `curl` / `gh`.

**messenger.abeto.co** — the primary source here: pointer abstraction with finger slots,
capability probe, device tiers, adaptive DPR, per-tier asset variants, and a CSS-only
loading spinner. Everything in L1–L5 is in its shipped bundle.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html               # HTML: viewport meta
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/webgl-<hash>.js -o entry.js   # CSS + viewport injection
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/style-<hash>.css -o style.css # the spinner
```

**sakura-crossing** — desktop-first (pointer lock, WASD), but the render-target scaling in
its pipeline is the cleanest statement of "canvas at display size, scale on the targets".

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**Read for this skill:**

| What | Where |
|---|---|
| Pointer listeners, finger slots, the three coordinate forms per slot | messenger — `grep -n "addEventListener(\"pointerdown\"" App3D.js` and read the surrounding class |
| Tap = distance + duration; synthesised hover on touch | messenger — `grep -n 'pointerType' App3D.js`; look for the `TOUCH_START / TOUCH_MOVE / TOUCH_END` dispatcher and `hover_in` / `hover_out` |
| Capability probe struct and the named per-engine exceptions (`opus`, `imageBitmap`) | messenger — `grep -n 'maxTouchPoints' App3D.js` |
| Device tiers derived from screen aspect, not user agent (`iphone`, `oldIphone`, `lowMemoryDevice`) | messenger — same region; and the iOS-vs-other resize debounce a few lines below |
| DPR clamp, then `adaptiveDPR` with thresholds, step, floor and the flip-count stop | messenger — `grep -n 'adaptiveDPR' App3D.js`; the clamp is at the `global$1.init({ … DPR: T … })` call site |
| Viewport meta and root CSS (`touch-action:none`, `overflow:hidden`, text-size-adjust) | messenger — `entry.js`, near the top; it injects both |
| CSS-only frame-sequence loading spinner | messenger — `style.css`, the `@keyframes … sequence` block with staggered `animation-delay` |
| Per-tier asset variants (`-highq` textures, two music encodes) | messenger — `grep -oE '"[a-zA-Z0-9_/.-]+\.(ktx2\|ogg)"' App3D.js \| sort -u` |
| Canvas at display size with the scale carried on the render targets | sakura — `src/core/post.js`, `Pipeline.setSize` |
| Why frame-time comparisons are worthless below ~8 ms and draw calls are the metric | sakura — `AGENTS.md`, the wall-clock drift note |
