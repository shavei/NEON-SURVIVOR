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
