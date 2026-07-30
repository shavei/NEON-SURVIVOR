/* NEON SURVIVOR — onboarding.js : the FIRST-RUN experience. Classic global, self-wiring.
 * Loads AFTER auth-uplink.js (calls showAuth / reads _signedIn,_netOnline) and BEFORE main.js,
 * whose startGame/gameOver/updateHUD call the hooks below. Headless/offline-safe: every DOM and
 * storage touch is guarded, so verify*.cjs load it clean.
 *
 * The problem it solves: a brand-new player used to meet the GRID ACCESS modal — email, password
 * and the word "callsign" — before ever seeing the game, with no way past it. Playtesting found
 * exactly what you'd expect: they didn't know what any of it meant, and bounced.
 *
 * So: PLAY FIRST, ask later.
 *   1. No account? You land on the menu and can start a run immediately, as a guest. With no
 *      neon_player record Ach.openToken() no-ops, so a guest run never reaches the cloud — it
 *      just saves locally, exactly like the long-standing offline path.
 *   2. Three timed coaching tips teach auto-fire / XP orbs / upgrade cards on the first run only.
 *   3. The account ask moves to the death screen, where "your score stayed on this device" is a
 *      motivation instead of a riddle.
 *   4. adoptGuest() carries the guest's locally-earned achievements onto the new account, so
 *      signing up after a good run never costs progress. */

const Onboard = {
  _get(k){try{return localStorage.getItem(k);}catch(e){return null;}},
  _put(k,v){try{localStorage.setItem(k,v);}catch(e){}},

  /* Has this browser EVER completed a cloud sign-in? Set by _setSignedIn(true) in auth-uplink.js.
   * This is what separates "new player, don't wall them" from "known account whose session
   * expired, a re-login is meaningful" — the latter still gets the modal on boot. */
  hadAccount(){return this._get('neon_acct')==='1';},
  markAccount(){this._put('neon_acct','1');},
  firstRun(){return !this._get('neon_seen');},
  signedIn(){try{return typeof _signedIn!=='undefined'&&!!_signedIn;}catch(e){return false;}},
  online(){try{return typeof _netOnline==='function'&&_netOnline();}catch(e){return false;}},

  /* ---------- menu ---------- */
  toMenu(){const s=document.getElementById('start');if(s)s.classList.remove('hidden');this.syncMenu();},
  /* the sign-in affordance only matters while signed out — once the wall is optional it is the ONLY
   * route back to GRID ACCESS, so it must never be hidden from a signed-out player */
  syncMenu(){const b=document.getElementById('signinbtn');if(b)b.hidden=this.signedIn();},
  /* online → the full account flow; offline → the local callsign stage (all the cloud can't do) */
  openAuth(){if(typeof showAuth==='function')showAuth(this.online()?'login':'local');},

  /* ---------- first-run coaching ---------- */
  /* [run-clock seconds, icon, text]. Driven off updateHUD's sim elapsed, NOT a timer, so the tips
   * freeze with the game on pause and can't fire behind an overlay. */
  TIPS:[
    [2,'🕹','Your gun fires by itself — you only have to move and dodge.'],
    [11,'✨','Collect the gold orbs enemies drop — they fill your XP bar.'],
    [24,'⬆','When the XP bar fills you pick one of three upgrade cards. That is how you get stronger.'],
  ],
  _ti:0, _tipT:0,
  onRunStart(){this._ti=this.firstRun()?0:this.TIPS.length;this.hideTip();},
  /* called every tick from updateHUD(elapsed) — must stay cheap; one compare on the common path */
  tick(elapsed){
    if(this._ti<this.TIPS.length&&elapsed>=this.TIPS[this._ti][0]){
      const t=this.TIPS[this._ti++];this.showTip(t[1],t[2]);}
    if(this._tipT&&elapsed>this._tipT){this._tipT=0;this.hideTip();}
  },
  /* "can this player actually drag?" — the same coarse-pointer AND touch-events test main.js uses to pick
   * the touch zoom. NOT IS_MOBILE: that also trips on a merely narrow desktop window, whose player is
   * still on a keyboard and would be told to drag a screen they can't touch. */
  touchPlay(){try{return !!(_mqCoarse&&_mqCoarse.matches&&_hasTouch);}catch(e){return false;}},
  showTip(ico,txt){const el=document.getElementById('tip');if(!el)return;
    let s=tr(txt);
    // the movement tip is device-specific — a phone player has no WASD to be told about
    if(this._ti===1)s+=' '+tr(this.touchPlay()?'(drag anywhere on the screen)':'(WASD or the arrow keys)');
    el.innerHTML='<span class="tipico">'+ico+'</span><span>'+s+'</span>';
    el.classList.add('show');
    this._tipT=this.TIPS[this._ti-1][0]+7;},                 // auto-hide 7 run-seconds later (tick() clears it)
  hideTip(){const el=document.getElementById('tip');if(el)el.classList.remove('show');this._tipT=0;},

  /* ---------- the account ask, moved to the death screen ---------- */
  onGameOver(){
    this.hideTip();this._put('neon_seen','1');
    const el=document.getElementById('saveprompt');if(!el)return;
    if(this.signedIn()||!this.online()){el.hidden=true;return;}   // signed in, or offline (nothing to offer yet)
    // the badge just above already states the guest status — lead with the OFFER, don't restate it
    el.innerHTML='<b>'+tr('Want this score on the global leaderboard?')+'</b><span>'
      +tr('Make a free account to post your runs and keep your unlocks on every device.')
      +'</span><button class="savebtn" type="button">'+tr('🔗 Create an account')+'</button>';
    const b=el.querySelector&&el.querySelector('.savebtn');
    if(b)b.onclick=()=>this.openAuth();
    el.hidden=false;},

  /* ---------- guest → account ----------
   * A guest has no neon_player, so their achievement mirror sits at the unkeyed 'neon_ach:local'.
   * achievement-sync's _adopt() calls this the moment savePlayer() rebinds the id — BEFORE pull(),
   * whose cloud/local union then preserves whatever we move across. Without it, signing up after a
   * strong first run would silently wipe that run's unlocks. */
  adoptGuest(){
    try{
      if(typeof Ach==='undefined')return;
      const guest=this._get('neon_ach:local');if(!guest)return;
      const g=JSON.parse(guest),s=Ach._load();
      ['unlocked','cosmetics','tracks'].forEach(function(k){
        const src=g[k]||[];s[k]=s[k]||[];
        src.forEach(function(v){if(s[k].indexOf(v)<0)s[k].push(v);});});
      const gl=g.life||{},sl=s.life||(s.life={});
      Object.keys(gl).forEach(function(k){
        if(typeof gl[k]==='number')sl[k]=Math.max(sl[k]||0,gl[k]);});
      Ach._save(s);
      try{localStorage.removeItem('neon_ach:local');}catch(e){}    // consumed — never merge it twice
    }catch(e){}
  },
};

/* self-wiring — keeps main.js clear of the 28 KB line */
if(typeof _isBrowser!=='undefined'&&_isBrowser){
  const b=document.getElementById('signinbtn');if(b)b.onclick=()=>Onboard.openAuth();
  if(typeof I18N!=='undefined')I18N.onChange(()=>Onboard.syncMenu());
  Onboard.syncMenu();
}
