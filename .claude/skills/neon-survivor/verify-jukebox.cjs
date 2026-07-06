#!/usr/bin/env node
/* Jukebox + manifest verifier for the audio engine.
 *   node .claude/skills/neon-survivor/verify-jukebox.cjs
 * verify.cjs runs headless with no Audio ctor, so it only exercises the PROCEDURAL fallback. This
 * stubs Audio + Web Audio (recording GainNode/BiquadFilter params) so the REAL Orchestra code runs the
 * recording path, then drives every state transition and asserts: correct track key per state, the
 * AUDIO_MANIFEST registry shape (6 genres × menu/wave/3 boss archetypes), genre LOCK gating through
 * RewardEngine ownership, equal-power GainNode crossfade curves at the manifest per-kind durations,
 * the low-HP DANGER low-pass sweeping the LIVE mix without a track swap (debugAudioState), and 'error'
 * fallback to the per-genre procedural beds. No audio files or browser/network needed. */
const fs = require('fs'), path = require('path');
const FILE = process.argv[2] || path.resolve(__dirname, '../../../index.html');
const DIR = path.dirname(FILE);
const html = fs.readFileSync(FILE, 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]).filter(s => !/^(https?:)?\/\//.test(s) && !s.startsWith('/'));   // repo files only — skip CDN + platform routes (/_vercel/…)
const script = srcs.map(s => fs.readFileSync(path.resolve(DIR, s), 'utf8')).join('\n;\n');

// ---- fakes: just enough Web Audio + Audio to exercise the jukebox ----
const FakeAudio = function () { return { src: '', loop: false, preload: '', _h: {}, addEventListener(k, fn) { (this._h[k] = this._h[k] || []).push(fn); }, play() { return Promise.resolve(); }, pause() {}, fire(k) { (this._h[k] || []).forEach(f => f()); } }; };
const gain = () => ({ gain: { value: 0, curves: [], setValueCurveAtTime(arr, t, d) { this.curves.push({ from: arr[0], to: arr[arr.length - 1], dur: d }); this.value = arr[arr.length - 1]; }, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
const osc = () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} });
const ac = { currentTime: 0, destination: {}, state: 'running', createGain: gain, createBiquadFilter: () => ({ type: '', Q: { value: 0, setTargetAtTime(v) { this.value = v; } }, frequency: { value: 0, setTargetAtTime(v) { this.value = v; } }, connect() {} }), createOscillator: osc, createMediaElementSource: () => ({ connect() {} }), createBuffer: () => ({ getChannelData: () => new Float32Array(8) }), createBufferSource: () => ({ connect() {}, start() {}, stop() {} }), createWaveShaper: () => ({ connect() {} }), createDynamicsCompressor: () => ({ connect() {} }), resume() {} };
const ctxProxy = new Proxy(function () {}, { get(t, p) { if (p === Symbol.toPrimitive) return () => 0; if (p === 'width' || p === 'height') return 32; return ctxProxy; }, apply() { return ctxProxy; }, set() { return true; }, construct() { return ctxProxy; } });
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, set innerHTML(v) {}, set textContent(v) {}, set onclick(v) {}, getContext: () => ctxProxy, width: 0, height: 0, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });

const g = globalThis;
g.window = g; g.Audio = FakeAudio;
g.AudioContext = function () { return ac; }; g.webkitAudioContext = g.AudioContext;
g.document = { body: el(), getElementById: () => el(), querySelectorAll: () => [], createElement: () => el(), addEventListener() {} };
g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
g.matchMedia = () => ({ matches: false, addEventListener() {} });
g.addEventListener = () => {}; g.removeEventListener = () => {}; g.requestAnimationFrame = () => 1;
g.setInterval = () => 1; g.clearInterval = () => {}; g.setTimeout = () => 1; g.clearTimeout = () => {};
g.performance = { now: () => 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600; g.fetch = undefined;
g.state = 'start'; g.enemies = []; g.player = { hp: 100, maxhp: 100 };

const driver = `;(function(){
  var fails = 0;
  function A(cond, msg){ console.log((cond?'  PASS ':'  FAIL ')+msg+(cond?'':'  [_real='+Orchestra._real+' _realActive='+Orchestra._realActive+']')); if(!cond)fails++; }
  Sound.init();
  Music.menu();       A(Orchestra._real==='menu','menu()      -> menu track');
  Music.start();      A(Orchestra._real==='play','start()     -> gameplay track');
  Music.enterBoss(0); A(Orchestra._real==='boss0','enterBoss(0)-> boss0 (revenant)');
  Music.exitBoss();   A(Orchestra._real==='play','exitBoss()  -> back to gameplay');
  Music.enterBoss(1); A(Orchestra._real==='boss1','enterBoss(1)-> boss1 (maelstrom)');
  Music.exitBoss();
  Music.enterBoss(2); A(Orchestra._real==='boss2','enterBoss(2)-> boss2 (overseer)');
  Music.exitBoss();
  var over = Orchestra._track('over'); if(over) over.ready = true;   // simulate the staggered background warm (setTimeout is a no-op here) + full buffer
  Music.die();        A(Orchestra._real==='over','die()       -> gameover track');
  Music.menu();
  var mg = Orchestra._jk.menu.gain.gain.value, pg = Orchestra._jk.play.gain.gain.value;
  A(mg===1 && pg===0,'crossfade    -> active gain=1, previous=0 ('+mg+'/'+pg+')');
  Music.start();      A(Orchestra._real==='play','reselect play before error test');
  Orchestra._jk.play.a.fire('error');
  A(Orchestra._real===null && Orchestra._realActive===false,'load error  -> falls back to procedural bed');
  A(['boss0','boss1','boss2','menu','over','play'].every(function(k){return k in Orchestra._jk;}),'all 6 track elements created');

  // ---- AUDIO_MANIFEST registry shape: 6 genres, each unlockable one with menu + wave + 3 boss archetypes ----
  A(Object.keys(AUDIO_MANIFEST.genres).length===6,'manifest carries 6 genres');
  A(['classical','pop','metal','acoustic','rap'].every(function(g){var d=AUDIO_MANIFEST.genres[g];
    return d.menu&&d.wave&&d.boss&&d.boss.revenant&&d.boss.maelstrom&&d.boss.overseer&&d.bed&&d.bossbed;}),'every unlockable genre: menu + wave + 3 boss tracks + beds');
  // ---- genre LOCK gating: owned-in-user_inventory is the only key that turns ----
  A(GenreOrchestrator.current()==='orchestral' && !GenreOrchestrator.unlocked('metal'),'metal LOCKED before its achievement');
  A(RewardEngine.equipMusic('overdrive_rock')===false,'equip refused while locked');
  var s=Ach._load(); s.tracks=s.tracks||[]; s.tracks.push('overdrive_rock'); Ach._save(s);   // simulate the server-verified user_inventory grant
  A(GenreOrchestrator.unlocked('metal'),'metal UNLOCKED once the reward is owned');
  A(RewardEngine.equipMusic('overdrive_rock')===true,'equip accepted once owned');
  A(GenreOrchestrator.current()==='metal','equipped genre drives the Director');
  // ---- Total Genre Conversion: menu / wave / per-archetype boss selection ----
  Music.start();      A(Orchestra._real==='metal','wave        -> metal wave track');
  Music.menu();       A(Orchestra._real==='metalmenu','menu        -> metal chill menu track');
  Music.start(); Music.enterBoss(2);
  A(Orchestra._real==='metalboss2','enterBoss(2)-> metal overseer theme');
  // ---- seamless crossfade: GainNode ramps at the manifest per-kind duration (never a hard cut) ----
  var inC=Orchestra._jk.metalboss2.gain.gain.curves, inL=inC[inC.length-1];
  A(!!inL && inL.dur===AUDIO_MANIFEST.xfade.boss && inL.to===1 && inL.from<0.05,'boss xfade  -> gain curve 0->1 over '+AUDIO_MANIFEST.xfade.boss+'s');
  var outC=Orchestra._jk.metal.gain.gain.curves, outL=outC[outC.length-1];
  A(!!outL && outL.to===0 && outL.dur===AUDIO_MANIFEST.xfade.boss,'boss xfade  -> outgoing wave gain curve ->0 in the same window');
  // ---- per-genre procedural boss bed when the boss file is missing ----
  Orchestra._jk.metalboss2.a.fire('error'); Orchestra.active='boss';   // active flips at the sched() bar boundary; forced here (setInterval is stubbed)
  A(Orchestra._realActive===false && Orchestra._bed()==='metalboss','boss file missing -> metal procedural boss bed');
  Music.exitBoss();
  // ---- low-HP DANGER: real-time low-pass on the LIVE mix, no track swap (Music Stress Test hook) ----
  var before=Orchestra._real;
  window.debugAudioState('lowhp');
  A(Orchestra._g.filter.frequency.value===AUDIO_MANIFEST.lowHealth.freq,'lowhp       -> filter sweeps to '+AUDIO_MANIFEST.lowHealth.freq+' Hz');
  A(Orchestra._g.filter.Q.value===AUDIO_MANIFEST.lowHealth.q,'lowhp       -> resonance Q='+AUDIO_MANIFEST.lowHealth.q);
  A(Orchestra._real===before,'lowhp is an effect - the track did NOT swap');
  window.debugAudioState('lowhp_off');
  A(Orchestra._g.filter.frequency.value>1000,'lowhp_off   -> filter reopens');

  console.log(fails ? ('\\nJUKEBOX FAIL - '+fails+' assertion(s)') : '\\nJUKEBOX PASS - states + manifest + locks + crossfade + low-HP filter + fallback');
  globalThis.__FAIL = fails;
})();`;
try { eval(script + '\n;\n' + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
process.exit(globalThis.__FAIL ? 1 : 0);
