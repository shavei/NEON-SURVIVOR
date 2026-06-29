-- NEON SURVIVOR — one-shot cleanup of forged leaderboard rows.
-- Run ONCE in the Supabase SQL editor (Project → SQL → New query). Requires the SQL editor / service
-- role; the anon client cannot delete (no client delete policy on leaderboard — by design).
--
-- Context: before the /api/verify cutover (see schema.sql), the leaderboard had an open "anyone can
-- insert" policy, so any client could post any score with no validation. That produced the impossible
-- rows under the callsign "(ju)" — e.g. 1,215,752,191 points in 0:00. This removes them.

-- Preview first (optional): see exactly what will be deleted.
--   select id, username, score, difficulty, secs, created_at
--   from public.leaderboard where username in ('(ju)', 'ju') order by score desc;

delete from public.leaderboard where username in ('(ju)', 'ju');

-- Belt-and-suspenders: also clear any obviously-fabricated rows the open policy may have let through
-- (a score that's impossible for the elapsed time — e.g. tens of thousands of points in 0 seconds).
-- Adjust/inspect before running if you have legitimate edge-case rows.
--   delete from public.leaderboard where secs = 0 and score > 1000;
