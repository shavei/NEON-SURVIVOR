/* NEON SURVIVOR — leaderboard-engine.js : game-over score sync + dynamic rank feedback.
 * Loads AFTER net.js (uses submitScore/fetchTop), BEFORE main.js (gameOver() calls reportRun).
 * Headless/offline-safe: tolerates fetchTop()===null and a missing #gofeedback element (never throws). */

const _lbBoard={};   // diff -> last known top-10 rows; optimistic source so death feedback is instant

/* 1-based rank a score would take on `rows` (already desc by score); null if it misses the top 10 */
function rankFor(score,rows){
  if(!rows)return null;
  for(let i=0;i<rows.length;i++){if(score>=((rows[i]||{}).score|0))return i+1;}
  return rows.length<10?rows.length+1:null;
}

/* feedback message + css class from a score vs a top-10 board (null = board unavailable/offline) */
function feedbackMsg(score,rows){
  if(rows===null)return{txt:'Global board offline — your score is saved on this device.',cls:'offline'};
  const full=rows.length>=10,cutoff=full?(rows[9].score|0):0;
  if(!full||score>=cutoff){const r=rankFor(score,rows);
    return{txt:'Good job! You made it to the leaderboard!'+(r?' (#'+r+')':''),cls:'qualified'};}
  return{txt:'You were '+(cutoff-score)+' points away from the leaderboard.',cls:'missed'};}

function _lbRender(score,rows){
  const el=(typeof document!=='undefined')&&document.getElementById('gofeedback');if(!el)return;
  const f=feedbackMsg(score,rows);el.className='gofeedback '+f.cls;el.textContent=f.txt;}

/* called from gameOver(): submit the run and refresh the board CONCURRENTLY, paint an optimistic
 * message from cache immediately, then reconcile with the authoritative rows when they land. */
function reportRun(entry){
  const diff=entry.difficulty,score=entry.score|0;
  let cached=_lbBoard[diff];                                   // prefer our own snapshot…
  if(cached===undefined&&typeof _gcache!=='undefined')cached=_gcache[diff];   // …else reuse the menu's cache
  _lbRender(score,cached===undefined?null:cached);            // instant feedback (zero network wait)
  if(typeof submitScore!=='function'||typeof fetchTop!=='function')return;
  Promise.all([submitScore(entry),fetchTop(diff)]).then(([,rows])=>{
    if(rows!==null)_lbBoard[diff]=rows;_lbRender(score,rows);},()=>{});
}
