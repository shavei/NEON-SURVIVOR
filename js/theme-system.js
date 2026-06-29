/* NEON SURVIVOR — theme-system.js
 * Theme — swappable map colour palettes for the cosmic-nebula backdrop + starfield. The default
 * ("cosmic nebula") is free; the rest unlock as achievement rewards (kind:'palette' in REWARD_MAP) and
 * equip from the Showcase → "Grids" tab. Theme.apply(id) repoints the active palette and rebuilds the
 * cached NEBULA_CANVAS + STAR_FIELD — a one-off cost on swap, NEVER per-frame (the draw loop just blits
 * the cached tile). world.js generateNebula()/initStars() read Theme.nebula()/Theme.stars() at call time;
 * each keeps a built-in default so a Theme-less load (the headless equiv harness) stays byte-identical.
 * Classic script (shared global). Load AFTER reward-granting-engine.js (ownership) + world.js, BEFORE
 * main.js (which builds the nebula once at startup). Headless / offline / localStorage-safe. */

const Theme = {
  DEFAULT: 'cosmic_nebula',

  /* Each palette: nebula bg radial stops (bgrad), 3 gas-cloud RGB triplets (clouds), ambient nebula-tile
   * star colours (neb), and world-space starfield colours (stars). The default mirrors world.js's original
   * hardcoded look exactly. Palette KEYS match their REWARD_MAP reward id so equip wiring needs no lookup. */
  PALETTES: {
    cosmic_nebula:  { name:'Cosmic Nebula',  bgrad:['#070910','#05060d','#020204'], clouds:['255,95,162','84,230,181','124,140,255'], neb:['#fff','#7c8cff','#ffd95e'], stars:['#ffffff','#7c8cff','#ffd95e','#ff5fa2'] },
    aurora_drift:   { name:'Aurora Drift',   bgrad:['#04100d','#03100c','#010604'], clouds:['84,230,181','120,255,214','94,200,255'],  neb:['#fff','#7cffd0','#aef9ff'], stars:['#ffffff','#7cffd0','#aef9ff','#54e6b5'] },
    violet_void:    { name:'Violet Void',    bgrad:['#0b0714','#08050f','#030205'], clouds:['177,75,255','124,140,255','255,95,200'], neb:['#fff','#b14bff','#e0b3ff'], stars:['#ffffff','#b14bff','#e0b3ff','#7c8cff'] },
    crimson_nebula: { name:'Crimson Nebula', bgrad:['#120608','#0d0406','#040202'], clouds:['255,59,107','255,120,80','255,200,90'], neb:['#fff','#ff6a7e','#ffd95e'], stars:['#ffffff','#ff6a7e','#ffd95e','#ff3b6b'] },
  },
  _active: 'cosmic_nebula',

  // resolve a palette by id, falling back to the default for unknown ids (never breaks the backdrop)
  pal(id) { return this.PALETTES[id] || this.PALETTES[this.DEFAULT]; },
  active() { return this.pal(this._active); },
  // the projections world.js generateNebula()/initStars() consume
  nebula() { const p = this.active(); return { bgrad: p.bgrad, clouds: p.clouds, stars: p.neb }; },
  stars() { return this.active().stars; },

  // swap the active palette + rebuild the cached background tile / starfield (off the hot loop)
  apply(id) {
    this._active = this.PALETTES[id] ? id : this.DEFAULT;
    try { localStorage.setItem('neon_grid_active', this._active); } catch (e) {}
    if (typeof generateNebula === 'function') generateNebula();
    if (typeof initStars === 'function') initStars();
    if (typeof needsDraw !== 'undefined') needsDraw = true;
  },

  // small colour-chip preview (the 3 gas-cloud colours) for a Grids card
  swatch(id) {
    const chips = this.pal(id).clouds.map(function (rgb) { return `<i style="background:rgb(${rgb})"></i>`; }).join('');
    return `<div class="grid-swatch">${chips}</div>`;
  },

  // pick the equipped palette at boot (owned + persisted) so the player's grid theme shows from frame 1
  boot() {
    let id = this.DEFAULT;
    try {
      const eq = (typeof RewardEngine !== 'undefined' && RewardEngine.equippedPalette) ? RewardEngine.equippedPalette() : null;
      if (eq && this.PALETTES[eq]) id = eq;
    } catch (e) {}
    this._active = id;
  },
};
Theme.boot();
// Theme is now declared, so it's safe to paint the Grids gallery (RewardEngine deferred this to avoid a TDZ).
if (typeof document !== 'undefined' && typeof RewardEngine !== 'undefined' && RewardEngine.renderGridGallery) RewardEngine.renderGridGallery();
