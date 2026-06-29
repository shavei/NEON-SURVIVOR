/* NEON SURVIVOR — dev-tools.js
 * Console-only diagnostics, loaded last so every game global exists. Kept out of main.js/world.js to stay
 * under the 28 KB silent-truncation threshold. Headless-safe (every call guards the globals it touches).
 *
 *   window.stressTest(1000)  → start a run if needed, spawn N enemies at once, then sample real framerate
 *                              for ~2 s and log fps + live body count. Verifies the projectile pools / hot
 *                              loops hold up under load (pair with the F3 perf overlay for per-tick detail). */
if (typeof window !== 'undefined') window.stressTest = function (count) {
  count = (count | 0) || 1000;
  if (typeof startGame === 'function' && typeof state !== 'undefined' && state !== 'play') startGame();
  if (typeof spawnEnemy !== 'function') { console.warn('[stressTest] game not loaded'); return; }
  for (let i = 0; i < count; i++) spawnEnemy();
  const bodies = function () { return enemies.length + bullets.length + ebullets.length + missiles.length + particles.length; };
  console.log('[stressTest] spawned ' + count + ' enemies (' + bodies() + ' bodies) — sampling FPS for ~2s…');
  if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return;
  let frames = 0; const start = performance.now();
  (function tick() {
    frames++;
    const dt = performance.now() - start;
    if (dt < 2000) { requestAnimationFrame(tick); return; }
    const fps = (frames / dt * 1000);
    console.log('[stressTest] ' + count + ' enemies · ' + fps.toFixed(1) + ' fps over ' + (dt / 1000).toFixed(1) + 's · ' + bodies() + ' bodies live');
  })();
  return 'stressTest(' + count + ') running — see console for the FPS readout in ~2s';
};
