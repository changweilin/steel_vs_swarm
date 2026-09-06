# server/ — Authority Layer Principles & Boundaries

> Scope: principles and boundaries only. No methods, no workflows, no commands.
> Global principles live in root `AGENTS.md`.
> Nothing in this file restricts skill selection or skill usage.

## Module Boundaries (MUST NOT interpenetrate)

- `server.js`: transport only (HTTP static + WebSocket + health + LAN/dev routes).
- `rooms.js`: `RoomHub` lifecycle (rooms, matchmaking, battleConfig, 8Hz loop).
- `sim.js`: `BattleSim` — sole settlement point for HP / damage / ammo / economy / outcome.
- `bots.js`: `BotBrain` state machine (push / engage / retreat).

## Hard Boundaries

1. `rooms.js`, `sim.js`, `bots.js` MUST stay browser-runnable. MUST NOT import Node builtins, `process.*`, `Buffer`, or `require()`. Only `server.js` may use Node APIs.
2. No hard-coded balance numbers in `sim.js` / `bots.js`. `public/js/data.js` is the single numeric source, imported directly by the server.
3. Client input is untrusted. Reports are validated, then silently dropped on failure. MUST NOT trust coordinates, fire points, or hit targets blindly.
4. Heroes are keyed by connection `pid` in the `heroes` Map (bots use string pids such as `'b1'`). MUST NOT key by array index or Socket object. Squad-shared state mounts via `_bindShared()`; per-team iteration uses `heroes.values()`, per-body iteration uses `_allBodies()`.
