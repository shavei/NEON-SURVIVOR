#!/usr/bin/env node
/* Headless regression verifier for the whole music system (NEON SURVIVOR).
 *   node .claude/skills/neon-survivor/verify-music.cjs
 * Drives Orchestra/Music through EVERY genre × EVERY audio state under a functional Web-Audio mock, in two
 * passes, asserting no exceptions + sane invariants:
 *   PASS A (files absent — today's reality): genre audio 404s → _realActive=false → the PROCEDURAL composer
 *     drives the mix. Styled genres (rap=trap / edm / trance) must emit a real synth DRUM KIT (noise-based
 *     snare/hats); orchestral-voiced genres must NOT; the danger low-pass must muffle to lowHealth.freq;
 *     PAUSE must freeze _tick; the Soundtrack preview duck must restore to 0.9 (menu) / 0.4 (paused).
 *   PASS B (files present — future, once real CC0/PD tracks are dropped in): tracks load → _realActive=true →
 *     the real track takes over and ALL procedural layers mute to ~0 (you hear the track, not the bed).
 * Run after any audio-orchestrator.js / genre-orchestrator.js / audio-manifest.js edit. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]).filter(s => !/^(https?:)?\/\//.test(s) && !s.startsWith('/'));
const script = srcs.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n');

// ---- functional Web-Audio mock: params hold their last value, sources log their kind on start() ----
let LOG = [], FILES_PRESENT = false;
function param(v0) { let v = v0 || 0; return { get value() { return v; }, set value(x) { v = x; }, setValueAtTime(x) { v = x; }, linearRampToValueAtTime(x) { v = x; }, exponentialRampToValueAtTime(x) { v = x; }, setTargetAtTime(x) { v = x; }, setValueCurveAtTime(a) { v = a[a.length - 1]; }, cancelScheduledValues() {}, cancelAndHoldAtTime() {} }; }
function node(kind) { return { type: '', frequency: param(440), Q: param(1), gain: param(kind === 'gain' ? 0 : 1), buffer: null, connect() {}, disconnect() {}, start() { LOG.push(kind); }, stop() {}, addEventListener() {}, play: () => ({ catch() {} }), pause() {} }; }
const ac = { currentTime: 0, sampleRate: 44100, destination: node('dest'), state: 'running', resume() { return { then() {} }; }, suspend() {},
  createOscillator: () => node('osc'), createGain: () => node('gain'), createBiquadFilter: () => node('filter'),
  createBufferSource: () => node('noise'), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createMediaElementSource: () => node('media') };
// files absent ⇒ fire 'error' (→ procedural); files present ⇒ fire 'canplaythrough' (→ real track). Async (microtask) to match browser event semantics.
function audioEl() { return { loop: false, preload: '', volume: 1, _src: '', set src(v) { this._src = v; }, get src() { return this._src; },
  addEventListener(t, f) { if (t === 'error' && !FILES_PRESENT) queueMicrotask(f); if (t === 'canplaythrough' && FILES_PRESENT) queueMicrotask(f); }, play: () => ({ catch() {} }), pause() {} }; }
const any = new Proxy(function () {}, { get(t, p) { if (p === 'width' || p === 'height') return 32; return any; }, apply() { return any; }, set() { return true; }, construct() { return any; } });
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, getContext: () => any, width: 0, height: 0, set innerHTML(v) {}, set textContent(v) {}, set onclick(v) {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
const els = {}, g = globalThis;
g.document = { body: el(), getElementById: id => els[id] || (els[id] = el()), querySelectorAll: () => [], createElement: () => el(), addEventListener() {} };
g.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
g.window = g; g.addEventListener = () => {}; g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
g.setInterval = () => 1; g.clearInterval = () => {}; g.setTimeout = () => 0; g.clearTimeout = () => {};
g.performance = { now: () => 0 }; g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
g.AudioContext = function () { return ac; }; g.webkitAudioContext = g.AudioContext; g.Audio = function () { return audioEl(); };
g.matchMedia = () => ({ matches: false, addEventListener() {} }); g.CustomEvent = function () {}; g.dispatchEvent = () => {};

try { eval(script + ';globalThis.Sound=Sound;globalThis.Orchestra=Orchestra;globalThis.Music=Music;globalThis.GenreOrchestrator=GenreOrchestrator;globalThis.GENRE_MAP=GENRE_MAP;globalThis.enemies=[];globalThis.player={hp:100,maxhp:100};'); }
catch (e) { console.error('LOAD ERROR:', e.message); process.exit(1); }
Sound.ac = ac; Sound.master = node('gain');

let fail = 0, errs = [];
const ok = (c, m) => { if (!c) { fail++; errs.push(m); } };
const drive = n => { for (let k = 0; k < n; k++) { ac.currentTime += 0.05; Orchestra.nextTime = ac.currentTime; Orchestra.sched(); Orchestra._tick(); } };
const gainsSane = () => { const G = Orchestra._g; if (!G) return true; for (const L in G.layers) { const v = G.layers[L].gain.value; if (!(v >= -0.001 && v <= 1.001)) return false; } return true; };
const filterSane = () => { const G = Orchestra._g; return !G || (G.filter.frequency.value > 0 && G.filter.frequency.value < 30000); };
const noiseCount = () => LOG.filter(k => k === 'noise').length;
const layerMax = () => Math.max(...Object.keys(Orchestra._g.layers).filter(L => L !== 'sting').map(L => Orchestra._g.layers[L].gain.value));

const GENRES = Object.keys(GENRE_MAP);
const STYLED = new Set(['rap', 'edm', 'trance', 'pop', 'metal', 'acoustic']);   // genres whose bed drives a synth DRUM KIT (noise snare/hats); classical is styled-but-drumless, orchestral has no style
const flush = () => new Promise(r => queueMicrotask(r));   // let a pending 404/canplaythrough event settle (≈ one frame), as it would in a real browser
ok(GENRES.length >= 8 && ['rap', 'edm', 'trance', 'orchestral'].every(x => GENRES.includes(x)), 'GENRE_MAP has orchestral + rap + edm + trance (' + GENRES.length + ' genres)');

async function runPass(present, label) {
  FILES_PRESENT = present;
  for (const genre of GENRES) {
    const procBeat = STYLED.has(genre) && !present;   // beat engine audibly drives the mix only when procedural
    try {
      GenreOrchestrator._ov = genre; GenreOrchestrator._last = null;
      Orchestra._jk = {}; Orchestra._real = null; Orchestra._realActive = false;

      Music.menu(); await flush(); LOG = []; drive(8);   // await = let the absent-file 404 hand over to procedural (or the real track finish loading)
      ok(gainsSane() && filterSane(), `${genre}/${label} menu: gains+filter sane`);
      if (procBeat) ok(noiseCount() > 0, `${genre}/${label} menu: drum kit present`);
      if (!STYLED.has(genre) && !present) ok(noiseCount() === 0, `${genre}/${label} menu: no drum kit (orchestral voiced)`);
      if (present) ok(Orchestra._realActive && layerMax() < 0.001, `${genre}/${label} menu: real track active → procedural muted`);

      Orchestra.bossMode = false; Music.start(); await flush(); LOG = []; drive(8);
      ok(gainsSane() && filterSane(), `${genre}/${label} wave: gains+filter sane`);
      if (procBeat) ok(noiseCount() > 0, `${genre}/${label} wave: drum kit present`);
      if (present) ok(Orchestra._realActive && layerMax() < 0.001, `${genre}/${label} wave: procedural muted under real track`);

      for (let bt = 0; bt < 3; bt++) {
        Orchestra.bossMode = false; Music.enterBoss(bt); await flush(); ok(Orchestra.bossMode === true, `${genre}/${label} enterBoss${bt}: bossMode set`);
        LOG = []; drive(10);
        ok(Orchestra.active === 'boss', `${genre}/${label} boss${bt}: active flips to boss within a bar`);
        ok(gainsSane() && filterSane(), `${genre}/${label} boss${bt}: gains+filter sane`);
        if (procBeat) ok(noiseCount() > 0, `${genre}/${label} boss${bt}: drum kit present`);
        if (present) ok(Orchestra._realActive && layerMax() < 0.001, `${genre}/${label} boss${bt}: procedural muted under real track`);
        Music.exitBoss(); await flush(); ok(Orchestra.bossMode === false, `${genre}/${label} exitBoss${bt}: bossMode clear`); drive(10);
        ok(Orchestra.active === 'ambient', `${genre}/${label} boss${bt}→exit: active back to ambient`);
      }

      Orchestra._dangerOv = true; Orchestra._tick(); drive(1);
      const lh = (typeof AUDIO_MANIFEST !== 'undefined' && AUDIO_MANIFEST.lowHealth.freq) || 700;
      ok(Math.abs(Orchestra._g.filter.frequency.value - lh) < 1, `${genre}/${label} danger: filter → ${lh}Hz muffle`);
      Orchestra._dangerOv = false; Orchestra._tick();

      Music.pause(); ok(Orchestra.state === 'PAUSED', `${genre}/${label} pause: state=PAUSED`);
      const frozen = Orchestra._g.layers.strings.gain.value; drive(2); ok(Orchestra._g.layers.strings.gain.value === frozen, `${genre}/${label} pause: _tick frozen`);
      Music.resume(); ok(Orchestra.state !== 'PAUSED', `${genre}/${label} resume`);

      Music.menu(); Orchestra._duckBed(true); ok(Orchestra._g.master.gain.value < 0.01, `${genre}/${label} preview duck: bed hushed`);
      Orchestra._duckBed(false); ok(Math.abs(Orchestra._g.master.gain.value - 0.9) < 0.01, `${genre}/${label} preview restore (menu) → 0.9`);
      Music.pause(); Orchestra._duckBed(true); Orchestra._duckBed(false); ok(Math.abs(Orchestra._g.master.gain.value - 0.4) < 0.01, `${genre}/${label} preview restore (paused) → 0.4`);
      Orchestra.state = 'MENU';

      Music.die(); drive(1); ok(gainsSane(), `${genre}/${label} die: no crash`);
      Music.reset(); drive(2); ok(gainsSane(), `${genre}/${label} reset: no crash`);
      Music.stop();
    } catch (e) { fail++; errs.push(`${genre}/${label} THREW: ${e.message}`); }
  }
}

(async () => {
  await runPass(false, 'A');
  await runPass(true, 'B');

  // BUG-1 regression: previewing an ABSENT track must NOT leave the menu bed ducked to silence (async 404 → stopPreview → restore)
  FILES_PRESENT = false; GenreOrchestrator._ov = 'edm'; Orchestra._jk = {}; Orchestra._real = null; Orchestra._realActive = false;
  Music.menu(); Music.preview('edm');
  await new Promise(r => queueMicrotask(r)); await new Promise(r => queueMicrotask(r));
  ok(Orchestra._g.master.gain.value > 0.5, 'BUG-1: absent-track preview unducks the bed (no 9s silence)');
  Music.stop();

  // LOOP regression: a real track a few s from its end must crossfade onto the idle ping-pong voice (no seam silence)
  FILES_PRESENT = true; GenreOrchestrator._ov = 'orchestral'; Orchestra._jk = {}; Orchestra._real = null; Orchestra._realActive = false;
  Orchestra.bossMode = false; Music.start(); await flush();
  { const rec = Orchestra._jk[Orchestra._real];
    ok(rec && rec.a && rec.a2 && rec.ga && rec.g2, 'LOOP: real track has two ping-pong voices + gains');
    rec.a.duration = 180; rec.a.currentTime = 179; rec.cur = 0; rec.loopT = 0;   // 1 s from the end (< loopLead)
    Orchestra._loop();
    ok(rec.cur === 1 && rec.loopT === 1, 'LOOP: near end → crossfade swaps to the idle voice'); }
  Music.stop();

  // BOSS-OVERLAY regression: gameplay theme IS the boss track (_realBossSame, e.g. Requiem) → sched() overlays war-drums, mix stays sane
  FILES_PRESENT = true; Orchestra._jk = {}; Orchestra._real = null; Orchestra._realActive = false;
  Orchestra.bossMode = false; Music.start(); await flush();
  Orchestra._realBossSame = true; Orchestra.active = 'boss'; Orchestra._pending = null; LOG = []; drive(8);
  ok(gainsSane() && filterSane(), 'BOSS-OVERLAY: same-track boss war-drum overlay keeps the mix sane');
  Orchestra._realBossSame = false; Music.stop();

  if (fail) { console.log('\nMUSIC — ' + fail + ' FAILED:'); errs.slice(0, 40).forEach(e => console.log('  ✗ ' + e)); }
  else console.log('\nMUSIC — ALL PASS (' + GENRES.length + ' genres × 2 passes × menu/wave/boss0-2/danger/pause/preview/die/reset + BUG-1)');
  process.exit(fail ? 1 : 0);
})();
