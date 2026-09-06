# server/ — Authority Layer Principles & Boundaries

> Scope: principles and boundaries only. No methods, no workflows, no commands.
> Global principles live in root `AGENTS.md`.
> Full definitions live in `.claude/rules/` (`seams-balance`, `seams-weapons`, `seams-bots`, `seams-ui-net`).
> Nothing in this file restricts skill selection or skill usage.

## Roles (MUST NOT interpenetrate)

- Transport: static serving, real-time connections, health, and dev routes only.
- Rooms: room lifecycle, matchmaking, battle-configuration validation, and combat loop only.
- Simulation: the sole settlement point for HP / damage / ammo / economy / outcome.
- Bots: the computer-player state machine (push / engage / retreat) only.

## Behavioral Boundaries

- **Browser-runnable core**: simulation, room, and bot logic MUST stay browser-runnable; Node APIs live in the transport module only, so all three modes share one codebase.
- **Stable identity and granularity**: player state is keyed by stable connection identity, never by positional index or socket object; squad-shared state mounts once; per-team and per-body iteration stay distinct.
