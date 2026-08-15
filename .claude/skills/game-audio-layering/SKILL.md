---
name: game-audio-layering
description: Source and mix browser game audio — sampled assets vs procedural synthesis, zone ambience as always-playing stems crossfaded by gain, looping movement stems driven by animation weights, retrigger dedupe, click-free gain ramps, gesture unlock, and mobile/low-memory tiers. Use when adding sound effects or music, when music transitions are abrupt, when footsteps machine-gun, when audio clicks or stalls at volume zero, or when deciding between synthesis and CC0 samples.
license: MIT
compatibility: Web Audio API / HTMLAudioElement, any engine
---

# Game Audio Layering

## L0 — The sourcing question, answered

**Both reference projects use pre-produced audio assets, not procedural synthesis.**

- `messenger.abeto.co` ships ~40 `.ogg` files in six named folders: `ambiances/`,
  `character/`, `ui/`, `dialogues/`, `camera/`, `music/`.
- sakura-crossing generates *every texture* procedurally and states that the music playlist
  is "the only binary asset in the project" — and still ships a real music file.

That is the honest answer to "synthesise or source": **synthesis loses on timbre and wins
on nothing that matters at this scale.** A 2.4 MB CC0 sample pack replaces a week of
oscillator tuning and sounds better.

Procedural synthesis still earns its place in exactly one role: **a fallback layer**, so
the game is complete with zero audio files present. Two-layer design:

```
Layer 2  sampled assets   decoded at boot → preferred whenever present
Layer 1  Web Audio synth  always available → used when a file is missing / fails to decode
```

Any missing file, failed fetch or failed `decodeAudioData` falls through silently to
Layer 1. Design Layer 1 to cover *every* category so "no audio directory at all" is a
supported state, not a crash.

**Licence discipline is a repository-wide constraint, not an audio one.** Use **CC0**
only. A BY (attribution) or NC (non-commercial) file changes the distribution terms of the
whole repository, and it does so invisibly.

---

## L1 — Ambience: every stem always playing, gain crossfaded by zone

**Never start and stop ambience stems.** Register all of them at boot with
`volume: 0, autoPlay: true, loop: true`, and ride the gains:

```js
addAudio({ name: 'ambiance-base',       url: 'ambiances/base.ogg',       volume: 0, autoPlay: true, loop: true });
addAudio({ name: 'ambiance-forest',     url: 'ambiances/forest.ogg',     volume: 0, autoPlay: true, loop: true });
addAudio({ name: 'ambiance-city',       url: 'ambiances/city.ogg',       volume: 0, autoPlay: true, loop: true });
// … beach, factory, waterfalls, temple
```

Zones are **spheres with a margin**, and the gain is the fade across that margin:

```js
const zones = {
  forest: { sphere: new Sphere(new Vector3(-13.5, -14.8,  1.4), 15.4), margin: 4   },
  city:   { sphere: new Sphere(new Vector3( 27.7,  13.7,  8.1), 27.5), margin: 10  },
  beach:  { sphere: new Sphere(new Vector3(-11.8,  12.2, -1.9), 12.0), margin: 3.5 },
  // …
};

let winner = '', gain = 0;
for (const key of Object.keys(zones)) {                        // key order IS priority
  const z = zones[key];
  const g = fit(pos.distanceTo(z.sphere.center), z.sphere.radius,
                Math.max(0, z.sphere.radius - z.margin), 0, 1);
  if (g > 0) { winner = key; gain = g; break; }                // first match wins
}
for (const k of Object.keys(volumes)) volumes[k] = 0;
if (winner) volumes[winner] = gain;

setAudioVolume('ambiance-base', 0.5);                          // the bed never goes away
for (const k of Object.keys(volumes)) setAudioVolume(`ambiance-${k}`, volumes[k] * 0.5);
```

Five properties this buys:

1. **No transition to write.** Walking is the transition; the fade is a distance function.
2. **No re-sync problem.** Loops that never stop stay phase-locked to the session, so
   leaving and re-entering a zone does not restart its bed at a different point.
3. **A permanent base bed** underneath everything means silence never happens, which is
   what stops a zone boundary being audible as a hole.
4. **Priority is declaration order**, so overlapping zones are resolved by the list, not by
   a rule — and re-prioritising is moving a line.
5. **A margin, not a hard radius**, and different margins per zone (a city fades over
   10 m, a waterfall over 2) — that difference *is* the character of the boundary.

Cost: N decoded loops resident and N gain nodes summing. On a memory-constrained device,
drop to the base bed alone (L5).

---

## L2 — Movement audio is a looping stem, not one-shots

Footsteps as one-shots need a step-event on the animation, they machine-gun on a slope,
and they desync the moment the animation blends. The reference project instead keeps
**footsteps as a looping stem at volume 0** and rides its gain from the **animation weight
vector** (see `character-and-creature-motion` L2):

```js
const onGround = char.userData.medium === MEDIUMS.GROUND ? 1 : 0;
const moving   = clamp(weights[WALK] + weights[RUN], 0, 1) * onGround > 0.5 ? 1 : 0;

volumes.walk      = lerpFPS(volumes.walk,      moving,            0.25, dtRatio);
volumes.walkWater = lerpFPS(volumes.walkWater, moving * inWater,  0.25, dtRatio);

setAudioVolume('footsteps',       Math.max(0, volumes.walk - volumes.walkWater) * 0.2);
setAudioVolume('footsteps-water', volumes.walkWater * 0.2);
```

- **Both surface variants are registered with a `sync` flag** so the two loops run on the
  same clock. Crossfading between them mid-stride then keeps the rhythm — a fresh `play()`
  on the water loop would restart the cycle and the character would trip.
- **Dry gain is `walk − walkWater`**, so the two always sum to the movement gain and there
  is no doubled step.
- The smoothing constant is applied through `lerpFPS`, not per frame.

Same pattern generalises to rotor wash, engine notes, machinery beds and rain — anything
whose intensity is continuous. Reserve one-shots for **events**: jump, land, impact, door.

---

## L3 — One-shots: dedupe, cap, and vary

```js
addAudio({ name: 'button-turn', url: 'ui/button-turn.ogg', volume: 0.1, minTimeBetweenPlays: 0.2 });
```

| Control | Value | Why |
|---|---|---|
| `minTimeBetweenPlays` | 0.045–0.2 s | A volley of ten units firing on one tick converges to one or two voices instead of a wall |
| Voice cap | ~24 concurrent | Beyond that, drop new voices rather than queue them |
| Distance cull | ~240 m | Do not allocate a node for something inaudible |
| `playbackRate` jitter | ±5–10 % | Repeated identical samples are the strongest artificial cue in a mix |
| Multiple takes per event | 2–4 files | `dialogues/male1..3`, `female1..3`, `emoji-starts1..3` — one file per event is a machine |

**Spatialisation is a budget decision.** Full `PannerNode` HRTF per voice is expensive on
mobile; a `StereoPannerNode` plus a CPU-computed distance gain is typically indistinguishable
in a busy mix and costs a fraction. Reserve real positional audio
(`refDistance`/`rolloffFactor`/`maxDistance`/`directionalCone`) for a handful of
world-anchored sources.

**Dialogue "voice"** is gibberish blips picked per speaker (`male1..3`, `female1..3`, plus
one-off stings like `quest`), driven by the same `uIsTalking` flag that drives the mouth
shapes. Cheap, language-neutral, and never needs re-recording.

---

## L4 — Envelopes, gain and unlock

**Never drive an audio envelope from `requestAnimationFrame`.** rAF can be suspended
outright (hidden tab, embedded view, a pane that is not compositing), and a stalled fade
leaves a track playing at volume 0 with `paused === false`. Two safe implementations:

```js
// Web Audio: let the hardware do it — click-free by construction
gain.gain.setTargetAtTime(value, ctx.currentTime, 0.01);

// HTMLAudioElement: timers plus a trailing snap that guarantees the end state
rampTimer = setInterval(step, 33);
snapTimer = setTimeout(settle, seconds * 1000 + 600);   // however badly throttled, it lands
```

Scale the ramp rate by the **distance actually being covered**, so `seconds` is the duration
of *this* fade rather than of a full 0→1 sweep.

Other must-haves:

- **Start only from a real user gesture** (the same click that takes pointer lock / dismisses
  the title card). Arm at load, start at gesture. If `play()` rejects, fail quietly and
  permanently — the scene is the point and it works in silence.
- **A saved zero-volume preference is a real mute state**: arm playback without streaming a
  track, so muted users do not pay the bandwidth.
- **Pause on `visibilitychange`, resume on return.** Background tabs playing music is the
  most-reported audio complaint there is.
- **Music playlist: shuffle a round, then reshuffle without repeating the last track.**
  `loop = false` per track; advance on `ended`. Streaming via `HTMLAudioElement`, not
  `decodeAudioData` — a full playlist held as PCM is hundreds of megabytes.
- **An empty playlist is a supported state**, not a bug to discover at first click:
  `available` must be false immediately, or the mute key reports music that was never there.

### Music transitions

Two mechanisms, and they compose:

- **Between scenes/tracks:** an explicit crossfade over 0.3–2.6 s, with the trailing snap
  above. Fade-in on first start is longer (~2.6 s) than fade-out on mute (~0.35 s) —
  arriving should be gentle, leaving should be immediate.
- **Between musical states within a scene** (menu ⇄ battle, calm ⇄ danger): the L1 pattern —
  both stems always playing, gains crossfaded. It is the only way to switch without losing
  the bar, and it costs one extra decoded loop.

---

## L5 — Device tiers

The reference project's low-memory branch is more aggressive than most people expect, and
it is the honest choice:

```js
const url = lowMemoryDevice ? 'music/bgmusic-mobile.ogg' : 'music/bgmusic-highq.ogg';
addAudio({ name: 'bgmusic', url, volume: 0.1, autoPlay: true, loop: true });

if (lowMemoryDevice) {
  addAudio({ name: 'quest-complete', url: 'ui/quest-complete.ogg', volume: 0.25 });
  return;                       // ← the entire rest of the SFX bank is never registered
}
```

- **A separate, smaller music encode** for the mobile tier, not just a lower gain.
- **On the constrained tier the SFX bank is not loaded at all** — one music bed and one
  reward sting. Decoded buffers are the audio system's real cost, and 40 of them on a
  memory-limited phone competes with the textures.
- Codec capability is per-browser, not per-device (`opus` is unavailable on some Safari
  versions) — probe and pick the container, do not assume.

`lowMemoryDevice` derivation and the rest of the device tiering live in
`mobile-webgl-interaction`.

---

## Symptom → cause

| Observed | Cause |
|---|---|
| Zone changes are audible as a cut | Stems started/stopped instead of gain-ridden; and no permanent base bed |
| A zone bed restarts from the top each time you enter | Same cause — never stop the loop |
| Overlapping zones both play | No first-match-wins priority over an ordered list |
| Footsteps machine-gun / desync from the animation | One-shots on step events instead of a looping stem driven by the weight vector |
| The character trips when walking into water | Surface loops not `sync`ed; the crossfade restarts the cycle |
| A volley of fire is a wall of noise | No `minTimeBetweenPlays`, no voice cap |
| Repeated sounds read as a machine | One take per event, no `playbackRate` jitter |
| Music plays at volume 0 and never comes back | Envelope on rAF; use timers plus a trailing snap, or `setTargetAtTime` |
| Clicks on every volume change | Direct assignment to `gain.gain.value` |
| No audio at all until something random happens | Playback not armed from a real user gesture |
| Music keeps playing in a background tab | No `visibilitychange` handler |
| The mute key reports music that does not exist | `available` computed lazily instead of at registration |
| Memory pressure / crashes on older phones | Whole SFX bank decoded on the low tier |
| Licence audit fails | A BY or NC asset in the tree — CC0 only |

---

## Reference implementations

`WebFetch` gets 403 on both sites — use `curl` / `gh`.

**messenger.abeto.co** — the primary source here: ~40 `.ogg` assets in six named folders,
zone ambience, gain-ridden movement stems, per-tier music encodes. No public source, but
the audio wiring is greppable in the shipped bundle, and the **asset manifest is visible
from the outside**, which is the fastest way to read someone's audio design.

```bash
curl -sSL --ssl-no-revoke https://messenger.abeto.co/ -o msg.html   # read the App3D-<hash>.js name
curl -sSL --ssl-no-revoke https://messenger.abeto.co/assets/App3D-<hash>.js -o App3D.js
grep -oE '"[a-zA-Z0-9_/.-]+\.(ogg|mp3)"' App3D.js | sort -u        # the whole sound design, listed
```

That listing alone tells you the category split (`ambiances/`, `character/`, `ui/`,
`dialogues/`, `camera/`, `music/`), that dialogue is 3 male + 3 female gibberish takes,
that footsteps have a water variant, and that music ships in two encodes.

**sakura-crossing** — the minimal end: one CC0 track, an `HTMLAudioElement` playlist, and
a fade implementation written specifically to survive rAF being suspended.

```bash
git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing.git /c/tmp/sk
#                                                                    ↑ short path: a deep
#   temp dir fails on Windows with "cannot write keep file … Filename too long"
```

**Read for this skill:**

| What | Where |
|---|---|
| The full `addAudio` manifest — every stem, its volume, `autoPlay`, `loop`, `minTimeBetweenPlays` | messenger — `grep -n 'ambiances/' App3D.js` and read outward from the match |
| Zone crossfade: spheres with margins, first-match-wins, permanent base bed | messenger — `grep -n 'ambianceSpheres' App3D.js` |
| Footsteps as a gain-ridden loop driven by animation weights, with a synced water variant | messenger — same region; look for `volumes.walk`, `volumes.walkWater`, `lerpFPS` |
| Low-memory branch that skips the whole SFX bank and swaps the music encode | messenger — `grep -n 'bgmusic-mobile' App3D.js` |
| Click-free gain (`setTargetAtTime`) and positional parameters | messenger — the bundled three.js `Audio` / `AudioListener` classes |
| Playlist shuffle without immediate repeat; timers-not-rAF fades with a trailing snap; empty-playlist as a supported state; gesture unlock; `visibilitychange` | sakura — `src/core/audio.js`, the whole file (193 lines, and the header states the reasoning) |
| Why an envelope must not run on rAF | sakura — `CLAUDE.md` trap table, the "Don't drive audio/UI envelopes from `requestAnimationFrame`" row |
