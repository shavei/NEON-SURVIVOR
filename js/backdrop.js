/* NEON SURVIVOR - backdrop.js
 * Cosmetic deep-space backdrop: the cached nebula tile (generateNebula -> NEBULA_CANVAS) + world-space
 * starfield (initStars -> STAR_FIELD). Split out of world.js (28 KB line), code moved verbatim.
 * Uses only COSMETIC rand(), never gates sim state. Classic script; loads before world.js (reset() calls initStars). */

/* ========== HIGH-FIDELITY COSMIC NEBULA GENERATOR ========== */
let NEBULA_CANVAS = null;

function generateNebula() {
  const S = 1024; // Resolution of our repeating deep-space texture tile
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');

  // active map palette — swappable via Theme (Showcase → Grids). Built-in default mirrors the original
  // "cosmic nebula" byte-for-byte so a Theme-less load (e.g. the headless equiv harness) is unchanged.
  const _np = (typeof Theme !== 'undefined' && Theme.nebula) ? Theme.nebula()
            : { bgrad:['#070910','#05060d','#020204'], clouds:['255,95,162','84,230,181','124,140,255'], stars:['#fff','#7c8cff','#ffd95e'] };

  // Fill space background depth gradient
  const bgGrad = ctx.createRadialGradient(S/2, S/2, 10, S/2, S/2, S/2 * 1.4);
  bgGrad.addColorStop(0, _np.bgrad[0]);
  bgGrad.addColorStop(0.6, _np.bgrad[1]);
  bgGrad.addColorStop(1, _np.bgrad[2]);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, S, S);

  // subtle nebula gas clouds — faint colored glows, not heavy blobs
  function drawCloud(x, y, radius, rgb, a) {
    const cg = ctx.createRadialGradient(x, y, 0, x, y, radius);
    cg.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    cg.addColorStop(0.35, 'rgba(' + rgb + ',' + (a * 0.3) + ')');
    cg.addColorStop(0.7, 'rgba(' + rgb + ',' + (a * 0.05) + ')');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath(); ctx.arc(x, y, radius, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    drawCloud(rand(0, S), rand(0, S), rand(150, 270), _np.clouds[0], 0.14);
    drawCloud(rand(0, S), rand(0, S), rand(140, 240), _np.clouds[1], 0.12);
    drawCloud(rand(0, S), rand(0, S), rand(170, 310), _np.clouds[2], 0.16);
  }

  // ambient star cluster
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 520; i++) {
    const x = rand(0, S), y = rand(0, S), r = rand(0.4, 1.3);
    ctx.fillStyle = _np.stars[Math.floor(rand(0, _np.stars.length))];
    ctx.globalAlpha = rand(0.2, 0.8);
    ctx.fillRect(x, y, r, r);
  }

  // a few soft lens flares
  for (let i = 0; i < 5; i++) {
    const x = rand(0, S), y = rand(0, S);
    ctx.shadowBlur = rand(8, 18);
    ctx.shadowColor = '#fff';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = rand(0.35, 0.6);
    ctx.beginPath(); ctx.arc(x, y, rand(1.2, 2.4), 0, 7); ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1.0;

  NEBULA_CANVAS = c; // Cache the generated background texture texture map
}

/* ========== COSMIC SPACE BACKGROUND GENERATOR ========== */
const STAR_FIELD = [];
function initStars() {
  STAR_FIELD.length = 0;
  // active palette's world-space star colours; built-in default keeps a Theme-less load byte-identical
  const _sp = (typeof Theme !== 'undefined' && Theme.stars) ? Theme.stars() : ['#ffffff', '#7c8cff', '#ffd95e', '#ff5fa2'];
  // Generate 250 structural stars across the 3200x3200 cosmic map area
  for (let i = 0; i < 250; i++) {
    STAR_FIELD.push({
      x: rand(0, 3200),
      y: rand(0, 3200),
      r: rand(0.8, 2.6), // Size dictates depth perception
      alpha: rand(0.4, 1),
      col: _sp[Math.floor(rand(0, _sp.length))]
    });
  }
}
