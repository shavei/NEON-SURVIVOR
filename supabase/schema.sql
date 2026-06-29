-- NEON SURVIVOR — global leaderboard schema.
-- Run once in the Supabase SQL editor (Project → SQL → New query), then paste your
-- project URL + anon key into js/config.js. RLS (not the anon key) is the security boundary.

create table if not exists public.leaderboard (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid        not null,                                   -- localStorage owner token
  username    text        not null check (char_length(username) between 1 and 16),
  score       integer     not null check (score >= 0),
  difficulty  text        not null check (difficulty in ('easy','normal','hard')),
  wave        integer     not null default 1,
  secs        integer     not null default 0,
  created_at  timestamptz not null default now()
);

-- top-N-per-difficulty read path
create index if not exists leaderboard_diff_score_idx
  on public.leaderboard (difficulty, score desc);

-- public, anon, no-auth access governed by RLS
alter table public.leaderboard enable row level security;

drop policy if exists "anyone can read"   on public.leaderboard;
drop policy if exists "anyone can insert" on public.leaderboard;

create policy "anyone can read"
  on public.leaderboard for select using (true);

-- NO client insert policy → every browser write is denied by Postgres. The ONLY writer is /api/verify.js
-- (service_role, bypasses RLS), which re-validates the score against the trusted `runs` anchor + per-difficulty
-- rate ceilings before inserting. This closes the hole where any client could anon-insert any score (the
-- forged 0:00 billion-point rows). No update/delete policy → rows stay append-only, server-written.


-- ============================================================
-- ACHIEVEMENTS — server-granted, client-readable, client-UNwritable.
-- The anti-spoof core: player_achievements has NO write policy, so every browser write is
-- denied by Postgres. Only /api/verify.js (service_role, bypasses RLS) may grant a badge,
-- and it derives the grant from numbers it re-validates itself — client claims can't forge one.
-- ============================================================

-- Static catalog. Seeded by an admin/migration (service_role); read by everyone.
create table if not exists public.achievement_defs (
  id          text primary key,                                       -- e.g. 'first_blood','wave_master'
  title       text not null,
  description text not null,
  metric      text not null check (metric in ('kills','score','wave','level','bosses','runs')),
  threshold   integer not null check (threshold >= 0),
  difficulty  text check (difficulty in ('easy','normal','hard')),    -- null = any difficulty
  sort        integer not null default 0
);

-- Per-player unlocks. Written ONLY by the service role via /api/verify. RLS blocks all client writes.
create table if not exists public.player_achievements (
  player_id      uuid not null,
  achievement_id text not null references public.achievement_defs(id),
  unlocked_at    timestamptz not null default now(),
  run_score      integer not null default 0,                          -- the validated score that earned it
  primary key (player_id, achievement_id)
);
create index if not exists player_ach_player_idx on public.player_achievements (player_id);

-- TIERED PROGRESSION (additive, non-breaking). Existing rows backfill as fully-unlocked/complete.
-- current_progress + is_unlocked let a badge exist BEFORE it unlocks; the PK stays the upsert key.
-- NOTE: /api/verify writes is_unlocked=true on grant; partial (locked) progress for the progress
-- bars is tracked in the CLIENT mirror (js/achievements.js) — the server only persists unlocks.
alter table public.player_achievements
  add column if not exists current_progress integer not null default 0,
  add column if not exists is_unlocked       boolean not null default true;

-- Bronze/Silver/Gold chaining for the gallery. Cross-checked fields (metric/threshold/difficulty)
-- are unchanged; tier/chain are display+reward metadata only. hidden = secret (render ??? until seen).
alter table public.achievement_defs
  add column if not exists tier   text check (tier in ('bronze','silver','gold')),
  add column if not exists chain  text,
  add column if not exists hidden boolean not null default false;

-- ============================================================
-- COSMETICS — Gold-tier rewards. A gold achievement grant ALSO drops a cosmetic into the player's
-- inventory (server-side, same /api/verify transaction). Like player_achievements: world-readable,
-- service-role-only insert (no client write policy → a forged claim can't mint a skin). The ONE
-- client write allowed is flipping `equipped` on a row the owner already holds.
-- ============================================================
create table if not exists public.cosmetics_definitions (
  id     text primary key,                                    -- 'crimson_husk','void_warden',...
  kind   text not null check (kind in ('skin','trail')),
  title  text not null,
  unlock_achievement_id text references public.achievement_defs(id)   -- the GOLD def that grants it
);

create table if not exists public.cosmetics_inventory (
  player_id    uuid not null,
  cosmetic_id  text not null references public.cosmetics_definitions(id),
  granted_at   timestamptz not null default now(),
  equipped     boolean not null default false,
  primary key (player_id, cosmetic_id)
);
create index if not exists cosmetics_inv_player_idx on public.cosmetics_inventory (player_id);

alter table public.cosmetics_definitions enable row level security;
alter table public.cosmetics_inventory   enable row level security;

drop policy if exists "cosmetic defs readable" on public.cosmetics_definitions;
create policy "cosmetic defs readable" on public.cosmetics_definitions for select using (true);

drop policy if exists "cosmetics readable"    on public.cosmetics_inventory;
drop policy if exists "owner equips cosmetic" on public.cosmetics_inventory;
-- READABLE by all (show off cosmetics); INSERT only by service role (no insert policy). The owner
-- may UPDATE only their own row, and only to (un)equip — never to grant themselves a new cosmetic.
create policy "cosmetics readable"    on public.cosmetics_inventory for select using (true);
create policy "owner equips cosmetic" on public.cosmetics_inventory for update
  using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- ============================================================
-- USER_INVENTORY — the unified reward mirror (ALL tiers, every kind). One row per (player, reward).
-- The 35-row REWARD_MAP (js/reward-granting-engine.js) and api/verify.js both write here as
-- { player_id, reward_id, kind }; the client insert is an OPTIMISTIC owner-mirror, while cosmetics_inventory
-- above stays the service-role-only authoritative GOLD store. A missing row/policy just latches the
-- client's `_invOff` and it falls back to the local mirror — so this table is a sync convenience, not a gate.
-- ============================================================
create table if not exists public.user_inventory (
  player_id    uuid not null,
  reward_id    text not null,                                   -- 'maelstrom_waltz','aurora_drift',...
  kind         text not null check (kind in ('skin','trail','music','palette')),
  granted_at   timestamptz not null default now(),
  primary key (player_id, reward_id)
);
create index if not exists user_inventory_player_idx on public.user_inventory (player_id);

alter table public.user_inventory enable row level security;

drop policy if exists "reward inventory readable" on public.user_inventory;
drop policy if exists "owner mirrors reward"      on public.user_inventory;
-- READABLE by all (show off the collection); each player may INSERT only their OWN rows. No UPDATE/DELETE
-- policy → the optimistic mirror can grow but never be rewritten client-side; /api/verify (service_role)
-- is the authoritative writer and upserts past RLS.
create policy "reward inventory readable" on public.user_inventory for select using (true);
create policy "owner mirrors reward"      on public.user_inventory for insert
  with check (auth.uid() = player_id);

-- One row per run, keyed by a server-issued token → makes /api/verify idempotent and gives it a
-- trusted anchor (started_at, difficulty) to sanity-check the submitted run against.
create table if not exists public.runs (
  run_token   uuid primary key default gen_random_uuid(),
  player_id   uuid not null,
  difficulty  text not null check (difficulty in ('easy','normal','hard')),
  started_at  timestamptz not null default now(),
  verified    boolean not null default false,
  final_score integer
);

-- ---------- RLS ----------
alter table public.achievement_defs    enable row level security;
alter table public.player_achievements enable row level security;
alter table public.runs                enable row level security;

-- Catalog: world-readable, never client-writable (no write policy → only service_role can seed it).
drop policy if exists "defs readable" on public.achievement_defs;
create policy "defs readable" on public.achievement_defs for select using (true);

-- Unlocks: world-READABLE (show anyone's badges), but NO write policy → every client write denied.
drop policy if exists "achievements readable" on public.player_achievements;
create policy "achievements readable" on public.player_achievements for select using (true);

-- Runs: a client may OPEN a run token, but can never close it (set final_score / flip verified).
drop policy if exists "runs insert open" on public.runs;
drop policy if exists "runs readable"    on public.runs;
create policy "runs insert open" on public.runs for insert
  with check (verified = false and final_score is null);
create policy "runs readable"    on public.runs for select using (true);
-- no update/delete policy → only /api/verify (service_role) can verify a run and set its score.


-- ============================================================
-- PROFILES — durable identity. One row per Supabase Auth user, anchored on auth.users(id). This is
-- what makes progress GLOBAL: player_achievements.player_id and runs.player_id are set to this same id
-- once a player signs in, so the same person resolves to the same badges on every device/browser.
-- (No row is created until a user authenticates; offline/local play still uses net.js' legacy uuid.)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null check (char_length(username) between 1 and 16),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- UNIQUE CALLSIGN — one callsign per player, case-insensitive ("Neo" blocks "neo"). Partial index
-- skips NULL/blank rows so a row can briefly exist before its name is set. The DB index is the real
-- boundary; the live availability check (RPC below) is advisory UX only.
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null and username <> '';

drop policy if exists "profiles readable"      on public.profiles;
drop policy if exists "owner writes profile"    on public.profiles;
drop policy if exists "owner updates profile"   on public.profiles;
drop policy if exists "owner sets callsign once" on public.profiles;
-- world-readable (show anyone's name); each user may INSERT only their OWN row (auth.uid() = id).
create policy "profiles readable"    on public.profiles for select using (true);
create policy "owner writes profile" on public.profiles for insert with check (auth.uid() = id);
-- SET-ONCE: a player may UPDATE their row ONLY while the callsign is still empty. Once set, the
-- username column is frozen — there is no path for the client to rename (EDIT NAME is retired).
create policy "owner sets callsign once" on public.profiles for update
  using (auth.uid() = id and (username is null or username = ''))
  with check (auth.uid() = id);

-- AVAILABILITY RPC — returns ONLY a boolean, callable before a session exists (signup flow), so the
-- table itself need not be queried for the live check. SECURITY DEFINER reads past RLS; the pinned
-- search_path keeps it injection-safe.
create or replace function public.callsign_available(name text)
  returns boolean language sql security definer set search_path = public as $$
  select not exists (select 1 from profiles where lower(username) = lower(name));
$$;
grant execute on function public.callsign_available(text) to anon, authenticated;

-- NOTE (P3): once legacy player_achievements rows are re-keyed to auth ids by /api/claim.js, add an FK
-- for integrity:  alter table public.player_achievements add constraint player_achievements_player_fk
--                 foreign key (player_id) references public.profiles(id) on delete cascade;
-- Deferred so the constraint doesn't reject still-orphaned legacy player_ids before the claim runs.


-- ---------- harden the EXISTING leaderboard (DONE — cutover applied above) ----------
-- The old "anyone can insert" policy let any client post any score; it has been dropped (see the
-- leaderboard policies near the top of this file). /api/verify.js (service_role) is now the sole writer
-- and re-validates every score against the `runs` anchor before inserting. Re-running this schema is
-- idempotent: the `drop policy if exists "anyone can insert"` above clears any lingering open policy.

-- ---------- seed the catalog (idempotent) ----------
insert into public.achievement_defs (id,title,description,metric,threshold,difficulty,sort) values
  ('first_blood',   'Draw First Blood', 'Get your first kill.',                 'kills', 1,     null,   0),
  ('swarm_breaker', 'Swarm Breaker',    'Kill 100 enemies in a single run.',    'kills', 100,   null,   1),
  ('one_man_army',  'One-Man Army',     'Kill 500 enemies in a single run.',    'kills', 500,   null,   2),
  ('high_scorer',   'High Scorer',      'Score 10,000 in a single run.',        'score', 10000, null,   3),
  ('score_legend',  'Score Legend',     'Score 50,000 in a single run.',        'score', 50000, null,   4),
  ('wave_rider',    'Wave Rider',       'Reach wave 10.',                       'wave',  10,    null,   5),
  ('wave_master',   'Wave Master',      'Reach wave 20.',                       'wave',  20,    null,   6),
  ('boss_slayer',   'Boss Slayer',      'Defeat your first Warden.',            'bosses',1,     null,   7),
  ('warden_hunter', 'Warden Hunter',    'Defeat 10 Wardens (lifetime).',        'bosses',10,    null,   8),
  ('power_surge',   'Power Surge',      'Reach level 10 in a single run.',      'level', 10,    null,   9),
  ('ascended',      'Ascended',         'Reach level 25 in a single run.',      'level', 25,    null,  10),
  ('veteran',       'Veteran',          'Finish 10 runs (lifetime).',           'runs',  10,    null,  11),
  ('hardcore',      'Hardcore',         'Reach wave 10 on Hard.',               'wave',  10,    'hard',12)
on conflict (id) do update set
  title=excluded.title, description=excluded.description, metric=excluded.metric,
  threshold=excluded.threshold, difficulty=excluded.difficulty, sort=excluded.sort;

-- ---------- TIER CHAINS (keep-and-add): tag the existing defs into Bronze/Silver/Gold families,
--            then add the 4 new GOLD caps. Each gold cap maps to a cosmetic below. ----------
update public.achievement_defs set tier='bronze', chain='combat_kills' where id='swarm_breaker';
update public.achievement_defs set tier='silver', chain='combat_kills' where id='one_man_army';
update public.achievement_defs set tier='bronze', chain='wave_depth'   where id='wave_rider';
update public.achievement_defs set tier='silver', chain='wave_depth'   where id='wave_master';
update public.achievement_defs set tier='bronze', chain='score_run'    where id='high_scorer';
update public.achievement_defs set tier='silver', chain='score_run'    where id='score_legend';
update public.achievement_defs set tier='bronze', chain='boss_hunt'    where id='boss_slayer';
update public.achievement_defs set tier='silver', chain='boss_hunt'    where id='warden_hunter';

insert into public.achievement_defs (id,title,description,metric,threshold,difficulty,sort,tier,chain) values
  ('annihilator',  'Annihilator',  'Kill 1,000 enemies in a single run.', 'kills', 1000,   null,13,'gold','combat_kills'),
  ('abyss_walker', 'Abyss Walker', 'Reach wave 30.',                      'wave',  30,     null,14,'gold','wave_depth'),
  ('neon_god',     'Neon God',     'Score 100,000 in a single run.',      'score', 100000, null,15,'gold','score_run'),
  ('warden_legend','Warden Legend','Defeat 50 Wardens (lifetime).',       'bosses',50,     null,16,'gold','boss_hunt')
on conflict (id) do update set
  title=excluded.title, description=excluded.description, metric=excluded.metric,
  threshold=excluded.threshold, difficulty=excluded.difficulty, sort=excluded.sort,
  tier=excluded.tier, chain=excluded.chain;

-- ---------- COSMETIC REWARDS (one per gold cap; idempotent) ----------
insert into public.cosmetics_definitions (id,kind,title,unlock_achievement_id) values
  ('crimson_husk',   'skin',  'Crimson Husk',     'annihilator'),
  ('void_warden',    'skin',  'Void Warden',      'abyss_walker'),
  ('neon_god_trail', 'trail', 'Neon God Trail',   'neon_god'),
  ('warden_halo',    'trail', 'Warden Halo',      'warden_legend')
on conflict (id) do update set
  kind=excluded.kind, title=excluded.title, unlock_achievement_id=excluded.unlock_achievement_id;


-- ============================================================
-- SHARED WORLD STATE — durable snapshot of an in-progress co-op run, so a reconnecting or late-joining
-- player hydrates into the world already in motion instead of a blank session (docs/PLAN-multiplayer-sync.md).
-- One row per room, overwritten in place by the seed-authority every ~2 s → trivial storage, bounded writes.
-- Read by anyone in the room; like the leaderboard, RLS (not the anon key) is the only boundary.
create table if not exists public.world_state (
  room        text        primary key,
  seed        bigint      not null,
  tick        bigint      not null default 0,
  snapshot    jsonb       not null,
  updated_at  timestamptz not null default now()
);

alter table public.world_state enable row level security;

drop policy if exists "anyone can read world"   on public.world_state;
drop policy if exists "anyone can upsert world" on public.world_state;
drop policy if exists "anyone can update world" on public.world_state;

create policy "anyone can read world"
  on public.world_state for select using (true);

-- co-op peers upsert the room's live snapshot; bounded by the in-game ~2 s cadence
create policy "anyone can upsert world"
  on public.world_state for insert with check (char_length(room) between 1 and 64);
create policy "anyone can update world"
  on public.world_state for update using (char_length(room) between 1 and 64);
