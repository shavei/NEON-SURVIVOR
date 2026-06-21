# Implementation Plan — One Shared World: a Deterministic Co-op Simulation

> **Scaffold/plan only. No game logic written yet.** Grounded in the live codebase as of
> this branch: classic `<script defer>` globals (`index.html:137-151`), the existing co-op
> stack (`js/network.js`, `js/multiplayer-combat.js`), the leaderboard/identity layer
> (`js/net.js`), and the fixed-timestep + `alpha` lerp sim (`js/sim.js` / `js/render.js`).
> Awaiting approval before any code is written.

> **Design north star (from the user):** *"Look at how the player behaves in single-player —
> that's what I want in multiplayer, all at the same time with multiple players. No ghosts. We
> both damage the same enemies, we both pick up the same XP. We are actually in the same world."*
> So the goal is **not** "play as if single-player, side by side" — it is **one genuine
> single-player simulation that several players inhabit at once.**

---

## 0 — Audit: what exists today, and why it isn't that yet

A game-wide audit (run via subagents) of the networking + entity layers found a working but
**host-authoritative** co-op stack — and that model is the root of the problem.

### 0.1 The current model

| Concern | Where | Finding |
|---|---|---|
| Transport | `network.js:39` | One Realtime channel per room (`lobby:{roomId}`); Presence = roster/liveness, Broadcast = everything else. |
| Authority | `multiplayer-combat.js:6-14, 65-70` | **One host** (lowest living id) runs the real spawner and broadcasts a compact enemy roster @10 Hz. |
| Clients | `multiplayer-combat.js:25-30, 131-145` | Non-hosts **do not run the real sim.** They build *kinematic copies* of enemies from the roster and glide them (`e.x → e.tx`). |
| Acknowledged gap | `multiplayer-combat.js:24` | Comment: *"dmg/r/xp/sc are type-derived (not elapsed-scaled) — a known v1 fidelity gap; host stays authoritative."* |
| Damage path | `multiplayer-combat.js:193-197` | Clients *report* hits; host owns HP. Real shared damage already half-exists here. |
| Sim clock | `sim.js` (`STEP=1000/60`, `MAXSUBSTEP`) | **Fixed timestep already.** Bodies snapshot `px/py` and lerp by `alpha` in `draw()`. |
| RNG | `core.js:9` `rand=(a,b)=>a+Math.random()*(b-a)` | Single global RNG. Used for **gameplay** (spawn pos/type, orb scatter, item rolls) *and* **cosmetic** backdrop (`world.js:54-95`, render-only). |
| Headless safety | every net entry point | All net code no-ops when `SB` is null → `verify.cjs` loads with no DOM/network; solo is byte-for-byte untouched. **Every new file must preserve this.** |

### 0.2 Why it "feels like separate sessions"

The non-host is a **spectator of the host's world**, not a co-author of a shared one. It renders lossy
kinematic copies (the `dmg/r/xp/sc` fidelity gap is explicit in the code), and only the host
experiences the genuine, elapsed-scaled, full-AI single-player simulation. That asymmetry is exactly
what the user is rejecting. They want **every** player to get the real single-player experience —
same enemies, same scaling, same boss telegraphs, same magnet — in **one** world.

### 0.3 The pivotal realization

A fixed-timestep auto-shooter whose only true randomness is a single `rand()` call is a textbook
candidate for **lockstep determinism**. If every machine runs the *real* `update()` from the *same
seed* on the *same inputs*, every machine computes the *identical* world — same spawns, same orbs,
same bullets, same boss — with **no per-entity streaming at all.** That is the truest possible "same
world": not synchronized copies, but the *same computation* run in parallel. It is also the most
token-efficient, because we broadcast a few bytes of input per tick instead of 140-orb rosters @10 Hz.

This supersedes the earlier "broadcast every orb/bullet" approach: under a shared deterministic sim,
orbs and bullets are **not** broadcast — they *emerge identically everywhere*. (The entity-broadcast
design is retained in §6 as the fallback if determinism proves impractical.)

---

## 1 — Target architecture: shared deterministic simulation (lockstep)

```
Every peer runs the REAL js/sim.js update() — full fidelity, no kinematic copies.
        │
        ├─ shared SEED  ........ one PRNG, same sequence on every machine
        ├─ shared INPUTS ....... each player's movement + upgrade picks, broadcast per tick
        └─ shared CLOCK ........ the existing fixed STEP=1000/60, advanced in lockstep
                                   │
   desync guard ── periodic state hash compare ── snapshot resync (Supabase world_state)
```

**Three things must be made shared. Everything else is already deterministic.**

### 1.1 Shared seed (the only RNG change that matters)

- Split `rand()` into two channels:
  - **`srand()`** — a seeded PRNG (e.g. `mulberry32`) for **gameplay** randomness: spawn position/type
    (`world.js:136-161`), orb scatter (`world.js:222,232`), item rolls (`world.js:223,242`). Seeded
    from a single lobby-shared `worldSeed`.
  - **`rand()`** — stays `Math.random` for **cosmetic-only** draws (nebula/starfield, `world.js:54-95`),
    which never touch sim state and so may diverge harmlessly between screens.
- `worldSeed` is chosen once (room creator) and shipped to joiners via Presence metadata on
  `Lobby.join` — no new channel. Solo play seeds from `Date.now()` and is behaviorally identical to
  today (`verify.cjs` unaffected: a fixed seed even makes it *more* reproducible).

### 1.2 Shared inputs (tiny — most "inputs" are already derived)

The genius of this game for netcode: **aim is automatic** (`fire()` targets `player.near`, the nearest
enemy — `world.js:188`), so it is a *pure function of world state*, not an input. With a shared world,
aim, firing, magnet, and AI are all already identical everywhere. The **only** true inputs are:

| Input | Source | Broadcast |
|---|---|---|
| Movement vector | WASD / touch (`sim.js:15-32`) | per-tick, 1 quantized byte-pair per player |
| Upgrade pick | level-up 1-of-3 (`world.js` upgrade flow) | once per level-up (the 3 options are `srand`-derived → identical on all screens; only the *choice* is sent) |

`fire` events, orb broadcasts, enemy rosters — **all deleted.** They were artifacts of the
non-deterministic model. Bandwidth drops from ~140-entity rosters @10 Hz to ~2-4 bytes/player/tick.

### 1.3 Lockstep clock + input delay

- Each peer broadcasts its input for tick `T` and simulates `T` only once all peers' `T` inputs are in.
- A small **input-delay buffer** (~2-3 ticks ≈ 33-50 ms) hides latency: you send input for `T+2`,
  so by the time the sim reaches `T+2` the remote inputs have arrived. For an *auto-aim* shooter where
  the only manual input is movement, this delay is imperceptible.
- The existing `MAXSUBSTEP` catch-up loop is retained, but capped so a lagging peer requests a resync
  (§1.4) rather than fast-forwarding out of sync.

### 1.4 Desync guard + resync (honesty about the one real risk)

JS integer/float math is deterministic, **but transcendental funcs (`Math.sin/cos`) are not guaranteed
bit-identical across browser engines.** Over long sessions, tiny drift could accumulate. Mitigation —
a cheap, well-established correction layer:

- Every ~1 s, each peer hashes a compact world digest (enemy ids+rounded positions, orb count, RNG
  cursor) and the **seed-authority** (lowest living id, reusing `Coop._hostId`) compares.
- On mismatch, the authority pushes a full **snapshot**; peers hard-reset their world to it. Visible as
  at most a tiny one-frame correction, rare in practice.
- This same snapshot path doubles as **late-join / reconnect hydration** (§3) — one mechanism, two uses.

---

## 2 — What this delivers against the user's words

| User requirement | How the shared sim satisfies it |
|---|---|
| "How the player behaves in single-player" | Every peer runs the **real** `update()` — full AI, elapsed-scaling, boss telegraphs, magnet. No kinematic copies, no fidelity gap. |
| "All at the same time, multiple players" | All peers advance the **same** fixed-timestep world in lockstep. |
| "We both damage the same enemies" | There is literally **one** enemy set, computed identically; each player's auto-fire resolves against it on every machine. Damage isn't *reported* — it just *happens*, the same way, everywhere. |
| "We both pick up the same XP" | One orb field, identical on all screens. Whoever's avatar reaches an orb collects it; the collect is deterministic from shared positions, so all machines agree without a packet. |
| "No ghosts" | Nothing is a cosmetic copy. Every bullet, orb, and enemy is a real, simulated, shared entity. |
| "Actually in the same world" | Not N synced worlds — the **same computation** run in parallel from one seed. |

Remote **players** are the one genuinely external input (their movement), so each remote avatar is
driven by its broadcast movement vector and rendered with the existing `px/py` + `ix()/iy()` lerp
(`render.js:10`) — the same interpolation the lobby already uses for peers (`network.js:104-113`).

---

## 3 — Persistence: the "Global World State" via Supabase (`world_state`)

The shared sim is live-only; a reconnecting or late-joining player needs to drop into the world
*in progress*. Reuse the desync snapshot as durable state:

```sql
create table public.world_state (
  room       text primary key,
  seed       bigint not null,         -- the worldSeed (so a rejoin re-derives identical RNG)
  tick       bigint not null,         -- authoritative sim tick
  snapshot   jsonb not null,          -- enemies + orbs + items + per-player level/xp
  updated_at timestamptz default now()
);
-- read by anyone in the room; writes validated/rate-limited like leaderboard inserts
```

- The seed-authority upserts every ~2 s (one row/room, overwritten → trivial storage, bounded writes).
- **Join/reconnect:** `NetSync` does one `SELECT`, seeds the PRNG to `seed`, fast-forwards/loads to
  `tick`+`snapshot`, then joins the lockstep. The player walks into a populated, continuous world —
  this is what makes it *persistent and global*, not a fresh session.
- Functions live `net.js`-style (`saveWorld` / `loadWorld`) in `network-sync.js`; headless-safe
  (`SB` null → no-op); never block the sim.

---

## 4 — Token Efficiency & Modularity (Truncation Guard)

**28 KB (28 672-byte) per-file limit, measured against current sizes:**

| File | Bytes | Headroom | Role in this overhaul |
|---|---:|---:|---|
| `main.js` | 24 146 | **4 526** | wiring only — must NOT absorb sync logic |
| `core.js` | 21 535 | 7 137 | gains the `srand` PRNG split (small, surgical) |
| `world.js` | 19 553 | 9 119 | swap `rand→srand` at gameplay sites; one-line `NetSync` seams |
| `multiplayer-combat.js` | 16 588 | 12 084 | host-roster code is **retired** here (net shrink) |
| `render.js` | 12 535 | 16 137 | unchanged (already lerps peers) |
| `sim.js` | 9 666 | 19 006 | lockstep gate around `update()`; movement-input seam |
| `net.js` | 4 039 | 24 633 | untouched (leaderboard concern) |

**Decision: YES — a dedicated `js/network-sync.js` is required.** Rationale:

- **`main.js` is the danger file** (4.5 KB headroom). The lockstep engine — input ring-buffer, tick
  scheduler, seed handshake, hash/resync, `world_state` I/O — is an estimated 4-6 KB and must not land
  in `main.js`, `world.js`, or `sim.js` (the lean hot-loop files).
- The new model is a **distinct concern** from both the leaderboard (`net.js`) and the soon-retired
  host-roster (`multiplayer-combat.js`). A separate file keeps every file well under 28 KB
  indefinitely and isolates the protocol for clean phased work.
- **Modularity rules** (matching the existing net stack): classic global `NetSync`, loaded after
  `multiplayer-combat.js`, before `achievements.js`; no-ops when `SB`/`Lobby.channel` absent
  (`verify.cjs` + solo untouched); world/sim integration is **one-line seams**
  (`NetSync.localInput(mx,my)`, `NetSync.pickUpgrade(i)`, `NetSync.shouldStep()`); compact wire format
  (quantized ints) reused from `broadcastEnemies`.

---

## 5 — Phased rollout (each phase shippable + verifiable)

1. **Determinism foundation.** Split `rand`/`srand`, seed from a constant, prove solo play is
   unchanged via `verify-equiv.cjs`. No networking yet. *(This is the make-or-break phase: if the sim
   isn't reproducible from a seed on one machine, lockstep can't work.)*
2. **Seed handshake + input transport.** Ship `worldSeed` over Presence; broadcast movement inputs;
   `NetSync` buffers them. Still single-sim (host) — just proving the input pipe.
3. **Lockstep cutover.** Every peer runs the real `update()` gated on input availability + delay
   buffer. Retire the `enemies`/`drops`/`fire` broadcasts and the kinematic-copy path in
   `multiplayer-combat.js`. **This is where both players become true co-authors of one world.**
4. **Desync guard + `world_state` persistence.** Hash compare, snapshot resync, join/reconnect
   hydration. Delivers robustness + the "persistent global world."

---

## 6 — Fallback: event-lifecycle model (if determinism proves impractical)

If cross-browser float drift can't be tamed cheaply, fall back to the **authoritative shared sim**:
one peer runs the real `update()`; others send movement inputs and receive a fuller (lossless,
elapsed-scaled — closing the current fidelity gap) authoritative state, with client-side prediction of
their own avatar to hide latency. This still gives "one shared world, real damage, shared XP," but the
sim runs on one machine rather than symmetrically. Under this fallback the earlier per-entity
broadcasts (`ent:spawn`/`ent:despawn`, type-aware `fire` events) return as the transport. Documented
here so the decision is reversible without re-planning.

---

## 7 — Verification gates (per CLAUDE.md, before any push)

1. `verify.cjs` — syntax + headless load + boss sim stays green; `NetSync` loads + no-ops under Node.
2. `verify-upgrades.cjs` — regression on the upgrade flow (now an input).
3. `verify-equiv.cjs` — **critical:** solo behavior byte-for-byte unchanged once seeded; the
   determinism phase lives or dies here.
4. `vercel` preview build succeeds.
5. Two-tab smoke: same seed → identical spawns; kill an enemy in tab A → dies in tab B at the same
   tick; both collect from one orb field; reload a tab → `world_state` hydration drops it back into the
   live world.

---

## 8 — Decision needed before coding

**Lockstep deterministic sim (§1, recommended) vs. authoritative shared sim (§6 fallback).**
Lockstep is the truest "same world, full single-player fidelity for everyone, symmetric, minimal
bandwidth," at the cost of determinism engineering (seeded RNG + a desync guard for `sin/cos` drift).
The authoritative fallback is more robust to float drift but runs the sim on one machine and needs
prediction. Recommendation: **build the determinism foundation (Phase 1) first** — it's required by
both paths and its `verify-equiv` result tells us empirically whether full lockstep is safe before we
commit to it.
