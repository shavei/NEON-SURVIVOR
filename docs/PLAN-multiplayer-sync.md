# Implementation Plan — Unified Multiplayer State Synchronization

> **Scaffold/plan only. No game logic written yet.** Grounded in the live codebase as of
> this branch: classic `<script defer>` globals (`index.html:137-151`), the existing
> host-authoritative co-op stack (`js/network.js`, `js/multiplayer-combat.js`), the
> leaderboard/identity layer (`js/net.js`), and the fixed-timestep + `alpha` lerp sim
> (`js/sim.js` / `js/render.js`). Awaiting approval before any code is written.

---

## 0 — Audit: what exists today (and why it "feels like separate sessions")

A game-wide audit of the networking and entity layers was run via subagents. Findings:

### 0.1 Networking layer

| Concern | Where | Finding |
|---|---|---|
| Realtime transport | `js/network.js:39` | **One** channel per room: `SB.channel('lobby:'+roomId, {presence:{key:me}})`. Presence = roster/liveness; Broadcast = everything else. |
| Broadcast events | `js/multiplayer-combat.js:87-98` | 9 events bound: `enemies`, `drops`, `ekill`, `hit`, `pickup`, `xp`, `shot`, `ping`, `pong`. |
| Authority model | `js/multiplayer-combat.js:6-14, 65-70` | **Host-authoritative.** Lowest *living* lobby id hosts, runs the real spawner, and broadcasts full `enemies` + `drops` rosters @10 Hz. Non-hosts render those rosters and report `hit`/`pickup` back. |
| Position transport | `js/network.js:94-101` | Each client broadcasts its own `pos` @10 Hz; peers smooth toward the target (`step()`/`_smooth`). |
| Identity | `js/net.js:16-18` | `neon_player = {id:uuid, name}` in localStorage. No auth. `Lobby.me` = that uuid. |
| Persistence | `js/net.js:39-54` | Supabase is used **only** for the append-only `leaderboard` table + an offline retry queue. The *live world* is never persisted — it lives entirely in ephemeral Broadcast. |
| Headless safety | every entry point | All net code no-ops when `SB` is null (`typeof SB==='undefined'||!SB`), so `verify.cjs` loads with no DOM/network and solo play is byte-for-byte untouched. **Every new file must preserve this.** |

### 0.2 Entity layer

| Entity | Array | ID | Spawn → Move → Delete |
|---|---|---|---|
| Enemies | `enemies` | `++_eid` (`world.js:150,159`) | `spawnEnemy()` → AI chase (`sim.js:100`) → `killEnemy()` (`world.js:210`) |
| XP orbs | `orbs` | `++_oid` (`world.js:222,232`) | kill burst → magnet to nearest player (`sim.js:131-137`) → collect `orbs.splice` (`sim.js:138-141`) |
| Items | `items` | `++_iid` (`world.js:223,242`) | `spawnItem()` / boss drop → bob + `life--` (`sim.js:66`) → `pickItem()` (`world.js:253`) |
| Player bullets | `bullets` | **none** (anonymous) | `fire()` (`world.js:188-197`) → velocity (`sim.js:74`) → pierce/expiry splice |
| Missiles | `missiles` | **none** | `fireMissiles()` (`world.js:267`) → homing (`sim.js:84`) → splice |
| Boss bullets | `ebullets` | **none** | boss attacks (`world.js:171-183`) → velocity (`sim.js:120`) → splice |
| Chain bolts | `bolts` | **none** | `castChain()` (`world.js:286`) → 9-tick visual → splice |

**Key facts that shape this plan:**

1. **Orbs and items already carry unique ids and `tx/ty` glide fields** — the client reconcile
   path (`applyDrops`, `multiplayer-combat.js:157-177`) and the lerp pattern
   (`render.js:10` `ix()/iy()`) already exist. We are *refining* a working scheme, not greenfield.
2. **Ids are globally monotonic (`_oid`/`_iid`)**, assigned only by whoever runs the spawner.
   In a symmetric "two main characters" world, two independent spawners would collide on ids.
   This is the single biggest blocker to making both players authoritative.
3. **Projectiles are anonymous and never networked** except the cosmetic `shot` tracer
   (one short line, `applyShot` `multiplayer-combat.js:227-232`). There is no real "fire event."
4. **The world is host-rostered, not event-driven.** `drops` re-sends the *entire* orb+item set
   @10 Hz (`broadcastDrops`, `multiplayer-combat.js:148-155`). Clients can't create or destroy
   world entities — only the host can. That asymmetry *is* the "separate sessions" feeling: the
   non-host is a spectator of the host's world, not a co-author of a shared one.

### 0.3 The gap, stated precisely

The user's goal — *"both players as main characters in a persistent Global World State"* — requires
three changes to the current model:

- **Symmetric authority** for world entities (orbs/items), so either player can create/destroy them
  and both observe it — replacing single-host rostering.
- **Event-driven lifecycle** (`spawn` / `despawn`) instead of full-roster snapshots, so the world
  feels shared and bandwidth scales with *churn*, not with *population*.
- **Persistence** (a Supabase-backed snapshot) so the world survives a reconnect / late join instead
  of being a per-session ephemeral broadcast.

---

## 1 — Architecture: a new event-lifecycle layer in `js/network-sync.js`

```
neon-survivor/
├── js/
│   ├── net.js                  (existing) leaderboard + identity — UNCHANGED
│   ├── network.js              (existing) lobby Presence + pos — UNCHANGED transport, reused
│   ├── multiplayer-combat.js   (existing) host-rostered enemies stay here — see §4 migration
│   ├── network-sync.js         NEW · classic global · the entity-lifecycle + fire-event protocol
│   └── ...
└── supabase/
    └── schema.sql              + world_state table (persistence tier, §3.3)
```

**Why a new file and not an extension of `multiplayer-combat.js` — see the Truncation Guard, §5.**

`network-sync.js` exposes a single global, `NetSync`, mirroring the existing `Coop`/`Lobby` shape:
classic script, loads **after** `multiplayer-combat.js` and **before** `achievements.js`/`main.js`,
no-ops whenever `SB`/`Lobby.channel` is absent, and is driven by thin one-line seams in
`world.js`/`sim.js` exactly like the existing `Coop.xxx()` calls.

---

## 2 — Unified Entity Synchronization

### 2.1 Symmetric ownership via namespaced ids (the enabling change)

Replace "only the host assigns ids" with **owner-namespaced ids**, so any player can spawn world
entities without collision:

```
entity.id = ownerShort + ':' + (++localCounter)     // e.g. "a3f1:204"
ownerShort = Lobby.me.slice(0,4)                     // stable per player
```

- `world.js` keeps incrementing its local counter; only the *prefix* changes (solo prefix can be
  `''` so single-player ids stay numeric and `verify.cjs` is unaffected).
- Every player owns the entities it spawns and is the sole authority for their `despawn`. There is
  **no host** for orbs/items — both players are equal authors of one shared set.
- Reconciliation stays id-keyed exactly as `applyDrops` already does, so the receive path is a small
  edit, not a rewrite.

### 2.2 XP orbs & items — broadcast CREATE / MOVE / DELETE

Three discrete events, sent **only on lifecycle transitions** (not on a fixed roster timer):

| Event | Sender | Payload | When |
|---|---|---|---|
| `ent:spawn` | the spawner | `{k, id, x, y, t}` — `k`=kind(`'o'`orb/`'i'`item), `t`=item-type-code (orbs omit) | once, on creation (kill burst, `spawnItem`, boss drop) |
| `ent:despawn` | the collector | `{k, id}` | once, on pickup/expiry |
| `ent:move` | owner, **batched** | `{k, m:[[id,x,y]...]}` | see §2.3 — coalesced, low-rate, deltas only |

Receive path (in `NetSync`, reusing the `applyDrops` reconcile logic):
- `ent:spawn` → push a body with `px/py/tx/ty` seeded to `x,y` (CLAUDE.md gotcha: anything that moves
  needs the snapshot+lerp pair or it teleports).
- `ent:despawn` → splice by id. **Idempotent** (ignore unknown id) — covers the
  collect-race where both players grab the same orb in the same tick; first despawn wins, second is
  a harmless no-op.
- XP grant stays decoupled from the orb body: the collector grants locally and fires the existing
  shared-pool `xp` event (`multiplayer-combat.js:189`). Double-collect can't double-grant because the
  second `ent:despawn` finds nothing to remove and never reaches the grant.

**Reliability note.** Supabase Broadcast is fire-and-forget (no delivery guarantee). A dropped
`ent:spawn` would orphan an entity. Mitigation: a **low-rate reconcile heartbeat** (1 Hz) sends a
compact id-set digest `{k, ids:[...]}`; the receiver despawns anything locally present but absent from
the digest, and requests a re-`spawn` for anything in the digest it lacks. This is the cheap safety
net that lets the high-frequency path stay event-only. (The current full-roster `drops` @10 Hz is
effectively this heartbeat running 10× too fast — we keep the correction, drop the frequency.)

### 2.3 Movement: simulate locally, broadcast sparsely

Streaming every orb's position @10 Hz is exactly what overloads the link today. Orbs only move under
the **magnet** (`sim.js:131-137`), and **every client already knows every player's position** (via
the lobby `pos` broadcast). So:

- **Default: client-side deterministic magnet.** Each client runs the existing magnet math against
  the *shared* set of player positions (`Coop.nearestPlayer` already does multi-player nearest,
  `multiplayer-combat.js:180`). No movement packets needed — orbs converge identically on every
  screen because the inputs (orb spawn pos + player positions) are shared. This is the
  token-efficient answer the brief asks for.
- **`ent:move` is the fallback only**, used for the rare entity whose motion is *not* a pure function
  of shared state (e.g. a future knockback/explosion shove). When used it is **batched** into one
  packet per tick and **delta/quantized** (rounded ints, like `broadcastEnemies`
  `multiplayer-combat.js:126`). Items effectively never move (they bob in place, `render.js:49`), so
  items never emit `ent:move` at all.

Net effect: bandwidth scales with *spawns + collects* (a handful per second), not with the 140-orb
population the current `drops` snapshot pays for every 100 ms.

### 2.4 Projectile visibility — a lightweight `fire` event

Generalize the cosmetic `shot` tracer into a real, type-aware **fire event**. The brief's constraint
("see each other's attacks without overloading the network") drives the design: broadcast the *intent
to fire*, not the projectiles.

```
fire  {o, x, y, a, t, n}     // owner-short, origin x/y (rounded), base angle (2dp),
                             // weapon type 0=gun 1=missile 2=chain, n=multishot count
```

- **One packet per volley, not per bullet.** The receiver reconstructs the spread locally from
  `(a, n)` using the same fan math as `fire()` (`world.js:191-196`) — so a 5-shot multishot costs the
  same 1 packet as a single shot.
- **Cosmetic-only on the receiver.** Reconstructed bullets are pushed with a `ghost:true` flag and do
  **no damage** (damage authority is unchanged: each player's own bullets hit enemies on their own
  machine, reported via the existing `hit` event for host-rostered enemies). This sidesteps the
  hardest problem in netcode — remote hit detection — while still letting players *see* each other
  fight. It also means ghost bullets never need ids or despawn events; they expire on their local
  `life` counter (`world.js:196`).
- **Throttled**, reusing the existing 70 ms guard (`multiplayer-combat.js:224`, ~14 Hz). Below the
  fire rate of fast weapons, but visually continuous. Missiles/chain piggyback the same event with a
  different `t`, so the receiver draws the right tracer (homing trail vs. lightning) without new
  channels.

This replaces `shot`/`applyShot` and is a strict superset of it (the old single-line tracer becomes
the `t=0, n=1` case).

---

## 3 — Persistent Global World State (the "Supabase stack" tier)

Broadcast is ephemeral: a late joiner or a reconnecting player sees an empty world until new events
arrive. "Persistent" requires a durable snapshot. Three options were considered:

| Option | Mechanism | Verdict |
|---|---|---|
| Postgres Changes | subscribe to row inserts on a `world_entities` table | ❌ a DB round-trip per orb spawn — far too chatty, blows quotas |
| Broadcast-only | no persistence | ❌ doesn't meet the "persistent" requirement; late joiners desync |
| **Snapshot upsert** | host upserts a compact world blob to `world_state` on a slow timer | ✅ **chosen** — durable, cheap, decoupled from the hot path |

**3.3 `world_state` table** (additive schema, RLS mirrors `leaderboard`):

```sql
create table public.world_state (
  room       text primary key,
  snapshot   jsonb not null,        -- {orbs:[[id,x,y]], items:[[id,t,x,y]], seq, t}
  updated_at timestamptz default now()
);
-- anyone in a room may read; writes validated/rate-limited like leaderboard inserts
```

- The current snapshot owner (the lowest living id — we reuse `Coop._hostId`, no new election) upserts
  the compact orb+item set **once every ~2 s**. One row per room, overwritten in place → trivial
  storage, bounded write rate.
- **Join/reconnect hydration:** on `Lobby.join`, `NetSync` does one `SELECT snapshot FROM world_state`
  and seeds `orbs`/`items` from it, then goes live on Broadcast. The player walks into a populated,
  continuous world instead of a blank one — this is what makes it feel *persistent and shared* rather
  than a fresh session.
- Lives in `net.js`-style functions (`saveWorld(room, snap)` / `loadWorld(room)`) added to
  `network-sync.js`, headless-safe (`SB` null → no-op), never blocking the sim.

---

## 4 — Migration: fold the host-roster into the event model

The existing `Coop` enemy rostering (`enemies`/`drops`) is **kept** for v1 — enemies are genuinely
host-authoritative (shared HP, deaths, AI) and the symmetric model doesn't fit them cleanly. The
overhaul targets **orbs + items + projectiles**, which are the entities the brief names. Phasing:

1. **Phase 1 — additive.** Land `NetSync` + the `fire` event + client-side magnet, behind the same
   `Coop.active` gate. Orbs/items still flow through `drops` as a fallback; `NetSync` runs in
   parallel and is verified equivalent.
2. **Phase 2 — cutover.** Stop `broadcastDrops` from sending orb/item rosters; `NetSync` lifecycle
   events become the source of truth, with the 1 Hz digest as the safety net. Delete the now-dead
   orb/item branches from `applyDrops`.
3. **Phase 3 — persistence + symmetry.** Enable namespaced ids (§2.1) and `world_state` hydration
   (§3). This is the step that promotes the non-host from spectator to co-author.

Each phase is independently shippable and independently verifiable.

---

## 5 — Token Efficiency & Modularity (Truncation Guard)

**The 28 KB (28 672-byte) per-file truncation limit, measured against current sizes:**

| File | Bytes | Headroom to 28 KB | Role in this overhaul |
|---|---:|---:|---|
| `main.js` | 24 146 | **4 526** | wiring only — must NOT absorb sync logic |
| `core.js` | 21 535 | 7 137 | untouched |
| `world.js` | 19 553 | 9 119 | gains only one-line `NetSync.xxx()` seams |
| `multiplayer-combat.js` | 16 588 | 12 084 | host-roster stays; **not** the home for the new protocol |
| `render.js` | 12 535 | 16 137 | gains ghost-bullet draw (small) |
| `sim.js` | 9 666 | 19 006 | gains magnet-on-shared-positions + seams |
| `net.js` | 4 039 | 24 633 | untouched (leaderboard concern) |

**Decision: YES — the overhaul requires a dedicated `js/network-sync.js`.** Rationale:

- **`main.js` is the danger file** at 4.5 KB of headroom. The new protocol is an estimated
  3–4 KB (spawn/despawn/move/fire send+receive, digest reconcile, persistence I/O). Putting any of it
  in `main.js` — or in `world.js`/`sim.js`, which must stay lean hot-loop files — risks crossing the
  limit as the protocol grows in phases 2–3.
- **`multiplayer-combat.js` could physically hold it** (12 KB headroom) but **shouldn't**: it is the
  *host-authoritative roster* engine, a conceptually distinct authority model from the *symmetric
  event-lifecycle* layer. Mixing them in one 20 KB file hurts readability and re-creates the coupling
  problem this overhaul exists to undo. Separation of concerns > raw byte budget.
- A new file keeps **every** file comfortably under 28 KB indefinitely and gives the protocol room to
  grow without a future emergency split.

**Modularity rules for the new file** (consistent with the existing net stack):
- Classic global `NetSync`, loaded after `multiplayer-combat.js`, before `achievements.js`.
- Every entry point no-ops when `SB`/`Lobby.channel` is absent → `verify.cjs` and solo play untouched.
- World/sim integration is **one-line seams** (`NetSync.onSpawnOrb(o)`, `NetSync.onFire(x,y,a,t,n)`,
  `NetSync.onDespawn('o',id)`), so `world.js`/`sim.js` grow by bytes, not blocks.
- Compact wire format (positional arrays, rounded ints) reused from `broadcastEnemies`.

---

## 6 — Verification gates (per CLAUDE.md, before any push)

1. `node .claude/skills/neon-survivor/verify.cjs` — syntax + headless load + boss sim must stay green.
   `NetSync` must load and no-op under Node (no `window`/`document`/`supabase`/`fetch` at top level).
2. `node .claude/skills/neon-survivor/verify-upgrades.cjs` — unaffected, run as regression.
3. `node .claude/skills/neon-survivor/verify-equiv.cjs` — assert solo behavior is byte-for-byte
   unchanged (the `Coop.active===false` and empty-prefix id paths must match pre-change output).
4. `vercel` preview build succeeds.
5. Manual two-tab co-op smoke: spawn an orb in tab A, confirm it appears, magnets, and despawns
   exactly once across both tabs; confirm each tab sees the other's `fire` tracers; kill a tab and
   reload it — confirm `world_state` hydration repopulates the world.

---

## 7 — Open questions for approval

1. **Enemy symmetry** — keep enemies host-authoritative (this plan), or also move them to the
   symmetric event model? Recommendation: keep host-rostered for v1; enemies need shared HP/AI that
   the event model handles poorly.
2. **Persistence scope** — persist orbs+items only (cheap), or also player progress/level for a truly
   "persistent" world that survives all players leaving? Recommendation: orbs+items for v1.
3. **Ghost-bullet damage** — strictly cosmetic (this plan, safest), or eventually authoritative
   remote hits? Recommendation: cosmetic for v1; revisit only if players ask for it.
