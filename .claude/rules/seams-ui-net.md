# §2.1 H — HUD / Input / UI / Connection (single seams)

> Layer 2: full definitions. Principles live in root `AGENTS.md`; assertion details live in audit script headers (layer 4).

| Topic | Single seam | Constraints | Guards |
|---|---|---|---|
| Connection mechanism | `netmode.js` modes and URL builder, `net.js makeNet()` | Callers MUST NOT construct connections, inspect hosts, or branch solo copies; button labels derive from the link-mode table. | — |
| Road-network relay | `osmrelay.js` payload, commit table, room relay branch | Host fetches once and the server relays to the room; sanitization is single, shared, idempotent; the payload module stays import-free and stateless; the server accepts the host only, stores fresh objects, stays monotone per cell; relay data stays out of sync traffic, coordinate boxes, and persistent caches; late joiners fall back to self-fetch. | `audit_osm_relay` |
| LAN multipath | Server demux with dual protocol, certificate names, address watch | Demux stays paused; exactly one socket server instance; certificate names take the union. | `audit_net_modes` |
| Control mode | `ctrlmode.js` | The choice is a host-owned room setting with the broadcast as the sole client write path; merging happens in one place; hardening binds device capability while layout binds stick use — the two MUST NOT substitute. | `audit_ctrl_mode` |
| View lock | `VIEW_LOCK`, `viewLockStep()`, tick/applier/aim-point helpers | Per-frame turns go through one stepper and one applier; roster order follows screen order; anchors survive release; client view aid only. | `audit_view_lock` |
| Spectator camera | `SPEC_CAM`, `specViewNext()`, damping and angle helpers | Cycle order has one source; damping is frame-rate independent with shortest-path angles; locked views rigidly follow interpolated hulls; the panel copies snapshot fields with unknowns as null, MUST NOT fake local values. | `audit_spectator_cam` |
| Shop sweep and reserve | Sweep/buy/reserve/tick helpers plus shop state | Client-side scheduling only with every order verified by the server; affordability judged once; sweep covers the eight tracks only with one key format and one unlock gate. | `audit_shop_auto` |
| Hit blood cues | `BLOOD` timing/alpha/size helpers, sourced from the server damage log into splat/update/clear | Presentation only with direction sourced from the server; the server merges per tick and attacker at one flush point; drop size follows damage share; death and swaps clear. | `audit_blood_splat` |
| Status blind flash | `CC_FLASH` alpha/duration helpers, edge trigger | Fires on the rising edge of blinding states only; duration fixed and never extended; the intensity table MUST NOT admit physical states. | — |
| Charged-jump airspeed | `CJUMP.AIR_SPD_F` | Both air consumers share it; the vertical term MUST NOT use it. | — |
| Tap adjudication | `mobile.js` tap time and slop thresholds with button/tap/drop/tick bindings | One threshold set site-wide; hold-type buttons act on press and release and MUST NOT pass the tap gate; timeouts judge in the frame loop. | `audit_touch_gesture` |
| Viewport settle | `mobile.js` viewport helpers consumed by the resize handler | Durations come from one helper with no hand-written milliseconds; consumers subscribe and MUST NOT bind resize directly. | `audit_ctrl_mode`, `audit_touch_gesture` |
| Page-level touch hardening | `body.touch-dev` capability flag beside the touch-UI installer | Hardening binds device capability while layout binds room setting — the two MUST NOT merge; touch-action restrictions MUST NOT land on scrollable roots. | `audit_ctrl_mode` |
| Audio tiers | `audio.js` ambience/SFX/BGM manifests, `ambienceMix()`, `bgmUrl()` | Four tiers (place beds, movement beds, one-shots, music); place priority is first-match-wins with exactly one audible bed; resident beds never pause and stream without decoded buffers; dry/wet chains share one oscillator; multi-take picks avoid repeats; low-memory gate exits before fetching. | `audit_audio_layers` |
| Deterministic random | `rng.js mulberry32()` | Sole generator project-wide; the file MUST stay import-free. | — |

Assertion details live in layer-4 audit script headers.
