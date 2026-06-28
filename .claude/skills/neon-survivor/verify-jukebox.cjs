#!/usr/bin/env node
/* Jukebox track-loading verifier for the orchestral audio engine.
 *   node .claude/skills/neon-survivor/verify-jukebox.cjs
 * verify.cjs runs headless with no Audio ctor, so it only exercises the PROCEDURAL fallback. This
 * stubs Audio + Web Audio so the REAL Orchestra code runs the recording path, then drives every state
 * transition and asserts the correct track key is selected, gains crossfade, and a load 'error' falls
 * back to the procedural bed. Proves the wiring without needing the audio files or a browser/network. */
const fs = require('fs'), path = require('path');
const FILE = process.argv[2] || path.resolve(__dirname, '../../../index.html');
const DIR = path.dirname(FILE);
const html = fs.readFileSync(FILE, 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
const script = srcs.map(s => fs.readFileSync(path.resolve(DIR, s), 'utf8')).join('\n;\n');

// ---- fakes: just enough Web Audio + Audio to exercise the jukebox ----
const FakeAudio = function () { return { src: '', loop: false, preload: '', _h: {}, addEventListener(k, fn) { (this._h[k] = this._h[k] || []).push(fn); }, play() { return Promise.resolve(); }, pause() {}, fire(k) { (this._h[k] || []).forEach(f => f()); } }; };
const gain = () => ({ gain: { value: 0, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
const osc = () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} });
const ac = { currentTime: 0, destination: {}, state: 'running', createGain: gain, createBiquadFilter: () => ({ type: '', Q: { value: 0, setTargetAtTime() {} }, frequency: { value: 0, setTargetAtTime() {} }, connect() {} }), createOscillator: osc, createMediaElementSource: () => ({ connect() {} }), createBuffer: () => ({ getChannelData: () => new Float32Array(8) }), createBufferSource: () => ({ connect() {}, start() {}, stop() {} }), createWaveShaper: () => ({ connect() {} }), createDynamicsCompressor: () => ({ connect() {} }), resume() {} };
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
  var over = Orchestra._jk.over; if(over) over.ready = true;
  Music.die();        A(Orchestra._real==='over','die()       -> gameover track');
  Music.menu();
  var mg = Orchestra._jk.menu.gain.gain.value, pg = Orchestra._jk.play.gain.gain.value;
  A(mg===1 && pg===0,'crossfade    -> active gain=1, previous=0 ('+mg+'/'+pg+')');
  Music.start();      A(Orchestra._real==='play','reselect play before error test');
  Orchestra._jk.play.a.fire('error');
  A(Orchestra._real===null && Orchestra._realActive===false,'load error  -> falls back to procedural bed');
  A(['boss0','boss1','boss2','menu','over','play'].every(function(k){return k in Orchestra._jk;}),'all 6 track elements created');
  console.log(fails ? ('\\nJUKEBOX FAIL - '+fails+' assertion(s)') : '\\nJUKEBOX PASS - every state selects its track + fallback works');
  globalThis.__FAIL = fails;
})();`;
try { eval(script + '\n;\n' + driver); } catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
process.exit(globalThis.__FAIL ? 1 : 0);
