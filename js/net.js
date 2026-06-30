/* NEON SURVIVOR — net.js : Supabase global scoreboard (classic global; headless/offline-safe).
 * Loads AFTER core (uses no game globals beyond config), BEFORE main (main calls submitScore/fetchTop).
 * Degrades silently to local-only when the SDK, network, or config is absent (SB===null) — so the
 * headless verifier and offline play never throw. The SDK is injected at runtime (NOT a static
 * <script src>) so verify.cjs, which readFileSync's every src, never tries to read a remote URL. */

let SB=null;   // supabase client once ready; null = offline / unconfigured / headless → local-only
const _isBrowser=(typeof window!=='undefined'&&typeof document!=='undefined'&&typeof document.createElement==='function');
const SUPA_OK=(typeof SUPA_URL==='string'&&/^https:\/\//.test(SUPA_URL)&&typeof SUPA_ANON_KEY==='string'&&SUPA_ANON_KEY.length>20);

/* RFC4122-ish id — prefer the platform CSPRNG, fall back to Math.random when crypto is absent (headless) */
function _uuid(){try{if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();}catch(e){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&0x3|0x8)).toString(16);});}

/* persistent owner identity (localStorage neon_player = {id,name}) */
function getPlayer(){try{const r=localStorage.getItem('neon_player');if(r)return JSON.parse(r);}catch(e){}return null;}
/* id arg (optional) lets the auth layer bind the durable Supabase user_id; else keep/ mint the local one */
function savePlayer(name,id){const p={id:id||(getPlayer()||{}).id||_uuid(),name:String(name||'').slice(0,16)};
  try{localStorage.setItem('neon_player',JSON.stringify(p));}catch(e){}return p;}

/* lazy-load the supabase UMD SDK at runtime, then init the client */
function _initSupabase(){
  if(!_isBrowser||!SUPA_OK)return;                                   // offline / unconfigured / headless
  const boot=()=>{try{if(typeof supabase!=='undefined'){SB=supabase.createClient(SUPA_URL,SUPA_ANON_KEY);
    if(typeof onSupabaseReady==='function')onSupabaseReady();}}catch(e){}};   // wake the UI: refresh the board now the client exists
  if(typeof supabase!=='undefined'){boot();return;}
  try{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.async=true;s.onload=boot;(document.head||document.body).appendChild(s);}catch(e){}
}

/* submitScore — retained as a no-op for callers (leaderboard-engine reportRun, main.js fallback). The
 * global board is now written SERVER-SIDE by /api/verify (achievements.js _submit posts the run_token +
 * username), which re-validates the score against the trusted `runs` anchor before inserting. The old
 * direct anon insert is gone: it let any client post any score (a forged 0:00 billion-point row), and RLS
 * no longer permits a client write. An unvalidated/offline run (no run_token) simply stays local. Always
 * resolves so existing `await`/`Promise.all` call sites are unaffected. */
function submitScore(entry){return Promise.resolve();}

/* fetch top-10 for a difficulty. Resolves to an array, or null when the global board is unavailable
 * (so the UI can distinguish "offline" from "no rows yet"). The read path goes STRAIGHT to PostgREST
 * via fetch — it never waits for the heavy supabase SDK script to download/parse, so the board paints
 * on first frame. The SDK still loads in the background for auth/writes; this is read-only + public. */
async function fetchTop(diff){
  if(_isBrowser&&SUPA_OK&&typeof fetch==='function'){
    try{const u=SUPA_URL+'/rest/v1/leaderboard?select=username,score,secs,wave,created_at'
        +'&difficulty=eq.'+encodeURIComponent(diff)+'&order=score.desc&limit=10';
      const r=await fetch(u,{headers:{apikey:SUPA_ANON_KEY,Authorization:'Bearer '+SUPA_ANON_KEY}});
      return r.ok?(await r.json()||[]):null;}catch(e){return null;}
  }
  if(!SB)return null;                                                  // headless / SDK fallback
  try{const{data,error}=await SB.from('leaderboard').select('username,score,secs,wave,created_at')
      .eq('difficulty',diff).order('score',{ascending:false}).limit(10);
    return error?null:(data||[]);}catch(e){return null;}
}

_initSupabase();
