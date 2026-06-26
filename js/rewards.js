/* NEON SURVIVOR — rewards.js
 * Reward — the JUICE facade. Composes the existing feedback primitives (global `shake`, Fx.flash,
 * slowmo, burst, floatText, Fx.sfx/toast) into named, tunable "feel" presets so every reward in the
 * game (synergy evolutions, map-node payouts) shakes + neon-pulses through ONE code path.
 * Classic script (shared global scope). Load AFTER render, BEFORE map-system/synergy. Headless-safe. */

const Reward = {
  /* additive screen-shake using the same clamp pattern the sim already uses (shake is a shared global) */
  shake(mag, cap){ if(typeof shake!=='undefined')shake=Math.min(shake+mag, cap||24); },

  /* full-screen neon pulse — GPU-cheap CSS overlay (#pulse), never touches the sim loop.
     restart trick: yank the class, force reflow, re-add → the keyframe replays every call. */
  pulse(col){
    if(typeof document==='undefined')return;
    const el=document.getElementById('pulse'); if(!el)return;
    el.style.setProperty('--pc', col||'#54e6b5');
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  },

  /* guaranteed particle ring at a world point (wraps burst, which self-caps to the particle budget) */
  burstRing(x,y,col,n){ if(typeof burst==='function')burst(x,y,col,n||16,5); },

  /* dramatic real-time slow-motion (ms) — loop() bleeds this down; never lengthens, only deepens */
  slow(ms){ if(typeof slowmo!=='undefined')slowmo=Math.max(slowmo, ms||0); },

  /* COMPOSITE reward beats — every payout in the engagement layer funnels through trigger().
     tiers escalate shake + pulse strength + slow-mo so 'evolution' reads as the marquee moment. */
  trigger(tier, opts){
    opts=opts||{};
    const col=opts.col||'#54e6b5', x=opts.x, y=opts.y;
    const T={
      minor:    {sh:5,  slow:0,   sfx:'pickup', burst:14},
      major:    {sh:12, slow:160, sfx:'boom',   burst:30},
      evolution:{sh:16, slow:420, sfx:'boom',   burst:46},
    }[tier]||{sh:6,slow:0,sfx:'pickup',burst:16};
    this.shake(T.sh);
    this.pulse(col);
    this.slow(T.slow);
    if(typeof Fx!=='undefined')Fx.flash&&(tier==='evolution')&&Fx.flash();   // extra screen-flash only on the big one
    if(x!=null&&y!=null)this.burstRing(x,y,col,T.burst);
    if(typeof Fx!=='undefined')Fx.sfx(T.sfx);
    if(opts.text&&x!=null&&y!=null&&typeof floatText==='function')floatText(x,y-30,opts.text,col);
    if(opts.toast&&typeof Fx!=='undefined')Fx.toast(opts.ico||'✦', opts.toast, col);
  },
};
