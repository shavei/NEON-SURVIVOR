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

create policy "anyone can insert"
  on public.leaderboard for insert with check (
    char_length(username) between 1 and 16
    and score >= 0
    and difficulty in ('easy','normal','hard')
  );
-- no update/delete policy → rows are append-only from the client.


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

-- ---------- harden the EXISTING leaderboard (FUTURE cutover, NOT run yet) ----------
-- Today's "anyone can insert" (above) lets any client post any score. Once /api/verify also writes
-- the leaderboard server-side, drop the client insert policy so the service role is the only writer:
--   drop policy if exists "anyone can insert" on public.leaderboard;
-- Staged separately to avoid a write outage while the function rolls out.

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

create policy "anyone can read world"
  on public.world_state for select using (true);

-- co-op peers upsert the room's live snapshot; bounded by the in-game ~2 s cadence
create policy "anyone can upsert world"
  on public.world_state for insert with check (char_length(room) between 1 and 64);
create policy "anyone can update world"
  on public.world_state for update using (char_length(room) between 1 and 64);
