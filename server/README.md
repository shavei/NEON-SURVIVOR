# NEON SURVIVOR — authoritative game server

The cloud authority for the server-model migration. Dependency-free (Node built-ins only),
matching the game's no-deps ethos.

## Pieces
- `sim-host.js` — the authoritative world. Loads the sim layer (`js/config-sim,core,world,sim`) into an
  isolated VM with the `Fx` presentation port no-op'd, and ticks `updateShared()` over the agreed seed.
  Owns enemy AI/spawning, boss logic, damage, XP, waves and player HP. Inputs come in as the per-avatar
  `[mx,my]`; `snapshot()` emits exactly what the client renders.
- `ws.js` — minimal RFC 6455 WebSocket server on Node's `http` (handshake, text frames, ping/pong, close).
- `game-server.js` — one `SimHost` per room, ticked at 60 Hz, fed by `{input}`, broadcasting `{snap}`
  every 3 ticks (~20 Hz). Serves `GET /healthz` → 200 for Fly health checks.

## Run locally
```sh
node server/game-server.js 8787        # or: PORT=8787 npm start
```

## Wire protocol (JSON text frames)
```
client → server : {t:'join', room, id?, seed?, difficulty?} | {t:'input', mx, my} | {t:'leave'}
server → client : {t:'welcome', id, seed, room} | {t:'snap', ...authoritativeSnapshot} | {t:'bye'}
```

## Tests
```sh
npm run verify:server   # server-parity + ws round-trip + transport-parity (all no-deps)
```

## Deploy to Fly.io
The repo ships a `Dockerfile` + `fly.toml` (root). The image copies only `js/` + `server/` (no install).

```sh
fly launch --no-deploy      # first time: claims an app name, keep the provided fly.toml
fly deploy
fly scale count 1           # rooms are in-memory → keep ONE machine so all clients share the world
```

Notes:
- WebSockets ride Fly's HTTPS service; browsers connect with `wss://<app>.fly.dev`.
- `auto_stop_machines` lets the single machine sleep when idle and wake on the next connection
  (~1–2s cold start). Set `min_machines_running = 1` in `fly.toml` for always-on (no cold start).
- Keep the deployment at one machine (`fly scale count 1`): rooms live in memory, so a second machine
  would host a *different* set of rooms. Multi-machine needs sticky routing or a shared store (future).

## Wiring the client (Phase 5)
Set `GAME_SERVER_URL` in `js/config.js` to the Fly origin, e.g. `wss://neon-survivor.fly.dev`. The
client's `WebSocketTransport` (`js/transport.js`) then routes the world through this authority; empty
keeps the in-page `MockServerTransport` (single-player / elected-host). The main-loop cutover that makes
the client a pure renderer + input sender is the remaining Phase 5 integration step.
