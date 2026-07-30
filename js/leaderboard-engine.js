/* NEON SURVIVOR — leaderboard-engine.js : every player-facing view of the board —
 *   1) the MENU panel (#global): tabbed by difficulty, painted from the leaderboard-sync cache;
 *   2) the DEATH screen: game-over score sync + dynamic rank feedback.
 * Loads AFTER net.js (uses submitScore/fetchTop), BEFORE main.js (gameOver() calls reportRun,
 * showMenu() reads _gdiff, and the bootstrap calls renderGlobal/syncGlobalTab).
 * Headless/offline-safe: tolerates fetchTop()===null and a missing #gofeedback element (never throws). */

function fmtTime(sec){const m=Math.floor(sec/60),s=sec%60;return m+':'+String(s).padStart(2,'0');}
/* ===== global leaderboard (Supabase via net.js) — tabbed by difficulty, top 10 each ===== */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let _gdiff='normal';       // visible tab; rows come from the shared leaderboardCache (leaderboard-sync.js)
function renderGlobalRows(rows){
  const el=document.getElementById('global');if(!el)return;
  if(rows===null){el.innerHTML='<div class="empty">'+tr('Global board offline.<br>Scores still save on this device.')+'</div>';return;}
  if(!rows.length){el.innerHTML='<div class="empty">'+tr('No runs yet.<br>Be the first!')+'</div>';return;}
  el.innerHTML=rows.map((r,i)=>
    `<div class="lbrow"><span class="rank">${i+1}</span><span class="sc">${r.score}</span><span class="meta">${esc(r.username||'—')} · ${fmtTime(r.secs)}</span></div>`).join('');}
function renderGlobalSkeleton(){const el=document.getElementById('global');if(!el)return;   // shimmer placeholder
  el.innerHTML=Array.from({length:6},(_,i)=>`<div class="lbrow skel"><span class="rank">${i+1}</span><span class="sc"></span><span class="meta"></span></div>`).join('');}
/* paint from the prefetched cache → instant when 'ready'; skeleton + background fetch otherwise */
function renderGlobal(diff){_gdiff=diff;
  if(typeof LBSync==='undefined'){   // sync module absent (shouldn't happen) → legacy direct fetch
    if(typeof fetchTop!=='function'){renderGlobalRows(null);return;}
    renderGlobalSkeleton();fetchTop(diff).then(rows=>{if(_gdiff===diff)renderGlobalRows(rows);});return;}
  const e=LBSync.get(diff);
  if(e&&e.state==='ready'){renderGlobalRows(e.rows);return;}
  if(e&&e.state==='error'){renderGlobalRows(null);return;}   // known-offline → message (retry via syncAll on menu open/SDK connect)
  if(e&&e.rows&&e.rows.length){renderGlobalRows(e.rows);LBSync.ensure(diff);return;}  // stale-while-revalidate: show last-known rows during the refetch (no skeleton flash)
  renderGlobalSkeleton();LBSync.ensure(diff);}                                    // loading/absent → resolves via onLeaderboardUpdate
/* leaderboard-sync.js calls this when any difficulty's rows land → repaint only if it's the visible tab */
function onLeaderboardUpdate(diff){if(diff===_gdiff)renderGlobal(diff);}
function onSupabaseReady(){if(typeof LBSync!=='undefined')LBSync.syncAll(true);renderGlobal(_gdiff);   // SDK connected → re-warm every board
  if(typeof AchSync!=='undefined'&&AchSync.enabled())AchSync.resolveSession();   // …and resolve the auth session (restore identity + pull achievements)
  if(typeof renderNetStatus==='function')renderNetStatus();   // SDK connected → flip the ONLINE/OFFLINE badge
  if(state==='play'&&typeof Ach!=='undefined'&&Ach.openToken)Ach.openToken();}   // …and if the SDK connected mid-run, anchor the token so THIS run still reaches the cloud
document.querySelectorAll('#gtabs .gtab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#gtabs .gtab').forEach(z=>z.classList.remove('on'));b.classList.add('on');
  renderGlobal(b.dataset.d);});
function syncGlobalTab(diff){document.querySelectorAll('#gtabs .gtab').forEach(z=>z.classList.toggle('on',z.dataset.d===diff));}

/* Optimistic source for instant death-screen feedback: the shared leaderboardCache (leaderboard-sync.js),
 * already warmed in the background. _cachedRows(diff) → last known top-10, or undefined when not ready. */
function _cachedRows(diff){if(typeof leaderboardCache==='undefined')return undefined;
  const e=leaderboardCache[diff];return(e&&e.state==='ready')?e.rows:undefined;}

/* 1-based rank a score would take on `rows` (already desc by score); null if it misses the top 10 */
function rankFor(score,rows){
  if(!rows)return null;
  for(let i=0;i<rows.length;i++){if(score>=((rows[i]||{}).score|0))return i+1;}
  return rows.length<10?rows.length+1:null;
}

/* feedback message + css class from a score vs a top-10 board (null = board unavailable/offline) */
function feedbackMsg(score,rows){
  if(rows===null)return{txt:tr('Global board offline — your score is saved on this device.'),cls:'offline'};
  const full=rows.length>=10,cutoff=full?(rows[9].score|0):0;
  if(!full||score>=cutoff){const r=rankFor(score,rows);
    return{txt:tr('Good job! You made it to the leaderboard!')+(r?' (#'+r+')':''),cls:'qualified'};}
  return{txt:tr('You were')+' '+(cutoff-score)+' '+tr('points away from the leaderboard.'),cls:'missed'};}

function _lbRender(score,rows){
  const el=(typeof document!=='undefined')&&document.getElementById('gofeedback');if(!el)return;
  const f=feedbackMsg(score,rows);el.className='gofeedback '+f.cls;el.textContent=f.txt;}

/* called from gameOver(): submit the run and refresh the board CONCURRENTLY, paint an optimistic
 * message from cache immediately, then reconcile with the authoritative rows when they land. */
function reportRun(entry){
  const diff=entry.difficulty,score=entry.score|0;
  const cached=_cachedRows(diff);                             // warmed snapshot from leaderboardCache
  _lbRender(score,cached===undefined?null:cached);            // instant feedback (zero network wait)
  if(typeof submitScore!=='function'||typeof fetchTop!=='function')return;
  Promise.all([submitScore(entry),fetchTop(diff)]).then(([,rows])=>{   // submit + refresh concurrently
    if(rows!==null&&typeof leaderboardCache!=='undefined'){leaderboardCache[diff]={state:'ready',rows,ts:Date.now()};
      if(typeof LBSync!=='undefined')LBSync._persist();}   // keep the post-run board for the next visit
    _lbRender(score,rows);},()=>{});
}
