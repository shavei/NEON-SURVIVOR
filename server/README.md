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

## Deploy to Render
The repo ships a `Dockerfile` + `render.yaml` (root). The image copies only `js/` + `server/` (no install).

- **Blueprint:** in Render, New → Blueprint → pick this repo; it reads `render.yaml` (Docker web
  service, health check `/healthz`).
- **Existing Web Service (dashboard):** set Runtime = **Docker** (uses `./Dockerfile`) and
  Health Check Path = **`/healthz`**. (If you instead chose a **Node** runtime: Build Command empty,
  Start Command `node server/game-server.js`.)

Notes:
- Render injects `PORT`; the server binds `process.env.PORT` automatically — nothing to configure.
- WebSockets ride Render's HTTPS service; browsers connect with `wss://<service>.onrender.com`.
- Free instances sleep after ~15 min idle and cold-start (~tens of seconds) on the next connection;
  use a paid instance for always-on.
- Keep **one instance** (`numInstances: 1`): rooms live in memory, so a second instance would host a
  *different* set of rooms. Multi-instance needs sticky sessions or a shared store (future).

## Wiring the client (Phase 5)
Set `GAME_SERVER_URL` in `js/config.js` to the Render origin, e.g. `wss://neon-survivor-server.onrender.com`. The
client's `WebSocketTransport` (`js/transport.js`) then routes the world through this authority; empty
keeps the in-page `MockServerTransport` (single-player / elected-host). The main-loop cutover that makes
the client a pure renderer + input sender is the remaining Phase 5 integration step.
