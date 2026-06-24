/* NEON SURVIVOR — config.js : public Supabase project settings.
 * Safe to commit: the anon key is a PUBLIC client token; Row-Level Security is the real
 * security boundary (never put the service_role key here). Fill both in to enable the
 * global scoreboard — leave empty and the game runs local-only (on-device leaderboard).
 *   SUPA_URL      e.g. https://abcd1234.supabase.co
 *   SUPA_ANON_KEY e.g. eyJhbGciOi...  (Project Settings → API → anon/public key) */
const SUPA_URL='https://ukvsnjgysbrmuheibrgv.supabase.co';
const SUPA_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrdnNuamd5c2JybXVoZWlicmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NjM1MDksImV4cCI6MjA5NzQzOTUwOX0.Mgwvo1JNhtZEk_0PRHbONClysF2LqGuYM-IW7TsKsNQ';
/* Base origin for the serverless validator (/api/verify). Empty = same-origin (the Vercel deploy
 * that serves this page). The SERVICE_ROLE key lives ONLY in Vercel env vars, never here. */
const SUPA_FUNCTIONS_URL='';
/* Authoritative game server (server/game-server.js, deployed to Render). Empty = run the sim in-page
 * via MockServerTransport (single-player / elected-host). Set to the Render service's WSS origin to
 * route the world through the cloud authority via WebSocketTransport, e.g.
 * wss://neon-survivor-server.onrender.com */
const GAME_SERVER_URL='wss://neon-survivor-5zq3.onrender.com';
