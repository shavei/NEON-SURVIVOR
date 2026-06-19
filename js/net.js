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
function savePlayer(name){const p={id:(getPlayer()||{}).id||_uuid(),name:String(name||'').slice(0,16)};
  try{localStorage.setItem('neon_player',JSON.stringify(p));}catch(e){}return p;}

/* offline queue: owed/failed submits buffer in localStorage and flush on next init or success */
function _pending(){try{return JSON.parse(localStorage.getItem('neon_pending')||'[]');}catch(e){return[];}}
function _setPending(a){try{localStorage.setItem('neon_pending',JSON.stringify(a.slice(-50)));}catch(e){}}
function _queue(row){_setPending(_pending().concat([row]));}
function _flushPending(){if(!SB)return;const q=_pending();if(!q.length)return;_setPending([]);
  q.forEach(row=>{try{SB.from('leaderboard').insert(row).then(({error})=>{if(error)_queue(row);},()=>_queue(row));}catch(e){_queue(row);}});}

/* lazy-load the supabase UMD SDK at runtime, then init the client and flush any queued runs */
function _initSupabase(){
  if(!_isBrowser||!SUPA_OK)return;                                   // offline / unconfigured / headless
  const boot=()=>{try{if(typeof supabase!=='undefined'){SB=supabase.createClient(SUPA_URL,SUPA_ANON_KEY);_flushPending();
    if(typeof onSupabaseReady==='function')onSupabaseReady();}}catch(e){}};   // wake the UI: refresh the board now the client exists
  if(typeof supabase!=='undefined'){boot();return;}
  try{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.async=true;s.onload=boot;(document.head||document.body).appendChild(s);}catch(e){}
}

/* submit a finished run to the global board (fire-and-forget, offline-tolerant) */
function submitScore(entry){
  const p=getPlayer();if(!p)return;
  const row={player_id:p.id,username:p.name,score:entry.score|0,difficulty:entry.difficulty,wave:entry.wave|0,secs:entry.secs|0};
  if(!SB){_queue(row);return;}
  try{SB.from('leaderboard').insert(row).then(({error})=>{if(error)_queue(row);},()=>_queue(row));}catch(e){_queue(row);}
}

/* fetch top-10 for a difficulty. Resolves to an array, or null when the global board is unavailable
 * (so the UI can distinguish "offline" from "no rows yet"). */
async function fetchTop(diff){
  if(!SB)return null;
  try{const{data,error}=await SB.from('leaderboard').select('username,score,secs,wave,created_at')
      .eq('difficulty',diff).order('score',{ascending:false}).limit(10);
    return error?null:(data||[]);}catch(e){return null;}
}

_initSupabase();
