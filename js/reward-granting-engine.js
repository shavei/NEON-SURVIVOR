/* NEON SURVIVOR — reward-granting-engine.js : the unified reward catalog + grant/inventory/Soundtrack layer.
 * Classic global. Loads AFTER achievements-ui.js (reads Ach/AchUI/COSMETICS/COSMETIC_MAP) and BEFORE
 * skins-ui.js (Skins.skinDefs() merges in the skins defined here). Headless/offline-safe: every DOM/SB/
 * localStorage touch is guarded, so verify*.cjs load it clean and offline play never throws.
 *
 * Why its own file: every achievement (not just gold) now drops a unique reward — a Neon Skin, a
 * Projectile Trail, or an Orchestral Music Track. Keeping the 35-row REWARD_MAP + the user_inventory write
 * + the Soundtrack tab + music equip/preview HERE keeps achievements.js / achievements-ui.js under the
 * 28 KB silent-truncation threshold. Division of labour: the DATA layer (achievements.js, _grantRewards)
 * owns the local mirror; THIS file owns the cloud inventory write, the Soundtrack UI, and music
 * equip/preview. The server (api/verify.js, service role) stays the AUTHORITATIVE grantor — the client
 * user_inventory insert is an optimistic mirror that degrades silently if the table/policy is absent. */

/* achievement id → reward. kind ∈ skin | trail | music | palette. For music, `src` is the audio-orchestrator
 * JUKE key previewed/equipped; for palette, `id` is a Theme.PALETTES key (the unlockable map colour scheme).
 * The 8 gold ids reuse their existing COSMETICS ids byte-for-byte so nothing already granted breaks. MUST stay
 * in lockstep with REWARD_MAP in api/verify.js — verify-achievements.cjs cross-checks the {kind,id,src}
 * projection is identical. title/ico are client-only UI metadata. */
const REWARD_MAP = {
  // ---- combat ----
  first_blood:       { kind:'trail', id:'first_blood_spark',   title:'First Blood Spark',   ico:'🩸' },
  swarm_breaker:     { kind:'trail', id:'swarm_pulse',         title:'Swarm Pulse',         ico:'💢' },
  one_man_army:      { kind:'skin',  id:'legionnaire',         title:'Legionnaire',         ico:'🟧' },
  annihilator:       { kind:'skin',  id:'crimson_husk',        title:'Crimson Husk',        ico:'🟥' },
  // ---- survival ----
  high_scorer:       { kind:'palette', id:'aurora_drift',      title:'Aurora Drift',        ico:'🌌' },
  score_legend:      { kind:'skin',  id:'regent',              title:'Regent',              ico:'🟨' },
  neon_god:          { kind:'trail', id:'neon_god_trail',      title:'Neon God Trail',      ico:'✨' },
  wave_rider:        { kind:'music', id:'midnight_jazz',       title:'Midnight Jazz',       ico:'🎷', src:'jazz',  genre:'Jazz' },
  wave_master:       { kind:'music', id:'maelstrom_waltz',     title:'Maelstrom Waltz',     ico:'🎶', src:'boss1' },
  abyss_walker:      { kind:'skin',  id:'void_warden',         title:'Void Warden',         ico:'🟪' },
  power_surge:       { kind:'trail', id:'surge_arc',           title:'Surge Arc',           ico:'⚡' },
  ascended:          { kind:'palette', id:'violet_void',       title:'Violet Void',         ico:'🔮' },
  veteran:           { kind:'music', id:'neon_pop',            title:'Neon Pop',            ico:'🎤', src:'pop',   genre:'Pop'  },
  hardcore:          { kind:'skin',  id:'cinder_frame',        title:'Cinder Frame',        ico:'🟧' },
  // ---- boss ----
  boss_slayer:       { kind:'palette', id:'crimson_nebula',    title:'Crimson Nebula',      ico:'🟥' },
  warden_hunter:     { kind:'music', id:'requiem_hunt',        title:'Requiem of the Hunt', ico:'🎼', src:'boss0' },
  warden_legend:     { kind:'trail', id:'warden_halo',         title:'Warden Halo',         ico:'💫' },
  // ---- skill ----
  ghost_grid:        { kind:'trail', id:'ghost_streak',        title:'Ghost Streak',        ico:'👻' },
  untouchable:       { kind:'trail', id:'phase_trail',         title:'Phase Trail',         ico:'🌀' },
  flawless_protocol: { kind:'skin',  id:'wardens_bane',        title:'Warden’s Bane',       ico:'🟦' },
  factory_settings:  { kind:'trail', id:'factory_line',        title:'Factory Line',        ico:'🔧' },
  overclocked:       { kind:'music', id:'overclock_toccata',   title:'Overclock Toccata',   ico:'🎹', src:'boss1' },
  second_wind:       { kind:'trail', id:'second_wind_gust',    title:'Second Wind Gust',    ico:'🫀' },
  glass_cannon:      { kind:'skin',  id:'prism_shard',         title:'Prism Shard',         ico:'🔮' },
  weaponsmith:       { kind:'trail', id:'evolver_arc',         title:'Evolver Arc',         ico:'🔩' },
  // ---- speed ----
  power_spike:       { kind:'trail', id:'spike_trail',         title:'Spike Trail',         ico:'📈' },
  ascendant_rush:    { kind:'music', id:'overdrive_rock',      title:'Overdrive',           ico:'🎸', src:'rock',  genre:'Rock' },
  blitz:             { kind:'trail', id:'blitz_streak',        title:'Blitz Streak',        ico:'⏱️' },
  killer_instinct:   { kind:'skin',  id:'predator',            title:'Predator',            ico:'🎯' },
  massacre_clock:    { kind:'music', id:'breakbeat_rap',       title:'Breakbeat',           ico:'🎧', src:'rap',   genre:'Rap'  },
  // ---- challenge ----
  objector:          { kind:'trail', id:'objector_halo',       title:'Objector Halo',       ico:'✋' },
  pacifist_protocol: { kind:'skin',  id:'radiant_aura',        title:'Radiant Aura',        ico:'☀️' },
  minimalist:        { kind:'skin',  id:'monoline',            title:'Monoline',            ico:'➖' },
  ascetic:           { kind:'music', id:'ascetic_nocturne',    title:'Ascetic Nocturne',    ico:'🧘', src:'menu'  },
  bare_bones:        { kind:'music', id:'acoustic_grid',       title:'Acoustic Grid',       ico:'🎵', src:'menu'  },
  // ---- secret ----
  any_percent:       { kind:'trail', id:'any_percent_blip',    title:'Any% Blip',           ico:'🏁' },
  leet:              { kind:'skin',  id:'leet_chrome',         title:'1337 Chrome',         ico:'😎' },
  completionist:     { kind:'skin',  id:'prism_core',          title:'Prism Core',          ico:'🟩' },
};

/* trail reward id → streak colour (client-only — render.js draws the equipped trail behind every bullet in
 * this hue, the Trails gallery shows it as a swatch). Keys are the 13 kind:'trail' reward ids above. */
const TRAIL_COL = {
  first_blood_spark:'#ff3b6b', swarm_pulse:'#ff6b3b', neon_god_trail:'#ffd95e', surge_arc:'#5ec8ff',
  warden_halo:'#b98cff', ghost_streak:'#d6f0ff', phase_trail:'#54e6ff', factory_line:'#9db0ff',
  second_wind_gust:'#54e6b5', spike_trail:'#7cff6b', blitz_streak:'#ffe45e', objector_halo:'#ff9d2e',
  any_percent_blip:'#ffffff', evolver_arc:'#ff5fd0',
};

const RewardEngine = {
  MAP: REWARD_MAP,
  _invOff: false,   // user_inventory table/policy absent → stop poking the cloud (no repeat 4xx)

  rewardFor(achId) { return REWARD_MAP[achId] || null; },
  _mirror() { try { return (typeof Ach !== 'undefined') ? Ach._load() : { cosmetics: [], tracks: [] }; } catch (e) { return { cosmetics: [], tracks: [] }; } },
  // skins + trails share the cosmetics mirror; music tracks live in their own list
  owns(rewardId) { const s = this._mirror(); return (s.cosmetics || []).indexOf(rewardId) >= 0 || (s.tracks || []).indexOf(rewardId) >= 0; },

  /* ---- the granting hook: called from AchUI.unlockToast(id) the instant is_unlocked flips true ----
   * The local mirror is already written by Ach._grantRewards (data layer) on the SAME _save, and the
   * unlock toast itself now carries the reward line (one toast per unlock) — so the only job left here
   * is the cloud-facing side effect: the optimistic user_inventory insert. */
  onUnlock(achId) {
    const r = this.rewardFor(achId); if (!r) return;
    this._insertInventory(r);
  },

  /* optimistic cloud mirror: drop the reward into user_inventory. Best-effort & RLS-guarded exactly like
   * Skins._cloudSave — the server (api/verify.js) is the authoritative writer, so a missing table / RLS
   * denial just latches _invOff and we fall back to the local mirror (offline-safe, no repeat failures). */
  _insertInventory(r) {
    try {
      if (this._invOff || typeof SB === 'undefined' || !SB) return;
      const p = (typeof getPlayer === 'function') && getPlayer(); if (!p || !p.id) return;
      // ignore-duplicates upsert (PK = player_id,reward_id): the server (api/verify.js) already wrote this row
      // for any prior grant, so a plain insert's unique-violation would wrongly latch _invOff and kill pullInventory.
      SB.from('user_inventory').upsert({ player_id: p.id, reward_id: r.id, kind: r.kind }, { onConflict: 'player_id,reward_id', ignoreDuplicates: true })
        .then(res => { if (res && res.error) this._invOff = true; }, () => { this._invOff = true; });
    } catch (e) { this._invOff = true; }
  },

  /* cross-device hydration: read the server-granted inventory into the local mirror so equipped skins /
   * tracks reappear on any device. Cloud is authoritative; optimistic local-only ids are preserved.
   * Called from AchSync.pull(). No-op offline/headless / when the table is absent. */
  pullInventory(id) {
    id = id || ((typeof getPlayer === 'function' && getPlayer()) || {}).id;
    if (this._invOff || typeof SB === 'undefined' || !SB || !id || typeof Ach === 'undefined') return Promise.resolve();
    const self = this;
    try {
      return SB.from('user_inventory').select('reward_id,kind').eq('player_id', id).then(function (res) {
        if (res && res.error) { const c = res.error.code, m = (res.error.message || ''); if (c === 'PGRST205' || c === '42P01' || /find the table|does not exist/i.test(m)) self._invOff = true; return; }
        if (!res || !Array.isArray(res.data)) return;
        const s = Ach._load(); s.cosmetics = s.cosmetics || []; s.tracks = s.tracks || [];
        res.data.forEach(function (row) { const arr = row.kind === 'music' ? s.tracks : s.cosmetics; if (row.reward_id && arr.indexOf(row.reward_id) < 0) arr.push(row.reward_id); });
        Ach._save(s);
        if (typeof Skins !== 'undefined' && Skins.renderGallery) Skins.renderGallery();
        self.renderTrailGallery();
        self.renderTrackGallery();
        self.renderGridGallery();
      }, function () {});
    } catch (e) { return Promise.resolve(); }
  },

  /* ---- skins: hand Skins.skinDefs() the full roster (gold COSMETICS + the new achievement skins) so the
   *      existing Skins panel shows + equips every skin with zero changes to its card/equip logic. ---- */
  skinDefs(base) {
    const out = (base || []).slice(), seen = {};
    out.forEach(function (c) { seen[c.id] = 1; });
    Object.keys(REWARD_MAP).forEach(function (ach) {
      const r = REWARD_MAP[ach];
      if (r.kind === 'skin' && !seen[r.id]) { seen[r.id] = 1; out.push({ id: r.id, kind: 'skin', title: r.title, ico: r.ico, from: ach }); }
    });
    return out;
  },

  /* ---- music: the Soundtrack tab roster + equip/preview ---- */
  musicDefs() {
    return Object.keys(REWARD_MAP).map(function (ach) { const r = REWARD_MAP[ach]; return r.kind === 'music' ? { id: r.id, title: r.title, ico: r.ico, src: r.src, genre: r.genre || null, from: ach } : null; }).filter(Boolean);
  },
  _trackKey() { const p = (typeof getPlayer === 'function') && getPlayer(); return 'neon_track:' + ((p && p.id) || 'local'); },
  // the equipped track id render/audio reads; validated against ownership, or null (= default theme)
  equippedMusic() { try { const v = localStorage.getItem(this._trackKey()); return (v && this.owns(v)) ? v : null; } catch (e) { return null; } },
  equipMusic(id) {
    if (id && !this.owns(id)) return false;                  // can't equip what you don't own (id '' = default theme)
    try { if (id) localStorage.setItem(this._trackKey(), id); else localStorage.removeItem(this._trackKey()); } catch (e) {}
    if (typeof Music !== 'undefined' && Music.stopPreview) Music.stopPreview();   // hush any preview; the new theme applies on the next start/reset
    this.renderTrackGallery();
    if (id && typeof AchUI !== 'undefined' && AchUI._push) {
      const d = this.musicDefs().find(function (m) { return m.id === id; });
      if (d) AchUI._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>${tr('🎵 TRACK EQUIPPED')}</b><span>${tr(d.title)}</span></div>`, '#b98cff');
    }
    return true;
  },
  previewMusic(id) { const d = this.musicDefs().find(function (m) { return m.id === id; }); if (d && typeof Music !== 'undefined' && Music.preview) Music.preview(d.src); },

  /* ----- the Soundtrack gallery (rendered into #tracklist) — CSS Grid of orchestral tracks ----- */
  renderTrackGallery() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('tracklist'); if (!host) return;
    const defs = this.musicDefs(), eq = this.equippedMusic(), self = this;
    const ownedN = defs.filter(function (d) { return self.owns(d.id); }).length;
    const header = `<div class="skin-bar"><div class="skin-n">${tr('Unlocked')} ${ownedN}/${defs.length}</div></div>`;
    const cards = defs.map(function (d) { return self._trackCardHTML(d, eq); }).join('');
    host.innerHTML = header + `<div class="track-grid">${cards}</div>`;
    if (typeof host.querySelectorAll === 'function') {
      host.querySelectorAll('[data-prev]').forEach(function (b) { b.onclick = function () { self.previewMusic(b.dataset.prev); }; });
      host.querySelectorAll('[data-equipm]').forEach(function (b) { b.onclick = function () { self.equipMusic(b.dataset.equipm); }; });
    }
  },
  // the achievement a track unlocks from (title/desc) so a LOCKED card can name the genre + the exact goal
  _unlockAch(id) { try { if (typeof Ach !== 'undefined' && Ach.CATALOG) return Ach.CATALOG.find(function (x) { return x.id === id; }) || null; } catch (e) {} return null; },
  _trackCardHTML(d, eq) {
    const owned = this.owns(d.id), isEq = owned && d.id === eq;
    const cls = ['track-card', owned ? 'owned' : 'locked', isEq ? 'equipped' : ''].join(' ').trim();
    const ach = owned ? null : this._unlockAch(d.from), genre = d.genre || 'Orchestral';
    // show the genre emoji + name even when locked, so players can pick a favourite genre and work toward it
    const foot = owned
      ? `<div class="track-btns"><button class="track-btn prev" data-prev="${d.id}">${tr('▶ Preview')}</button>` +
        (isEq ? `<span class="track-badge">${tr('✓ EQUIPPED')}</span>` : `<button class="track-btn equip" data-equipm="${d.id}">${tr('EQUIP')}</button>`) + `</div>`
      : `<span class="skin-lock">🔒 ${ach ? tr(ach.desc) : (tr('from:') + ' ' + d.from)}</span>`;
    return `<div class="${cls}">` +
             `<div class="skin-card-head"><span class="skin-ico">${d.ico}</span><span class="skin-tag">${tr('track')}</span></div>` +
             `<div class="skin-card-body"><b>${owned ? tr(d.title) : tr(genre)}</b><span>${owned ? (d.genre ? tr(d.genre) + ' ' + tr('track') : tr('Orchestral score')) : (ach ? tr('Unlock:') + ' ' + tr(ach.title) : tr('Achievement reward'))}</span></div>` +
             foot + `</div>`;
  },

  /* ---- map palettes: the Grids tab roster + equip (the colour swap itself is delegated to Theme) ---- */
  paletteDefs() {
    return Object.keys(REWARD_MAP).map(function (ach) { const r = REWARD_MAP[ach]; return r.kind === 'palette' ? { id: r.id, title: r.title, ico: r.ico, from: ach } : null; }).filter(Boolean);
  },
  _paletteKey() { const p = (typeof getPlayer === 'function') && getPlayer(); return 'neon_grid:' + ((p && p.id) || 'local'); },
  // equipped palette id (validated against ownership), or null = the free default "cosmic nebula"
  equippedPalette() { try { const v = localStorage.getItem(this._paletteKey()); return (v && this.owns(v)) ? v : null; } catch (e) { return null; } },
  equipPalette(id) {
    if (id && !this.owns(id)) return false;                  // can't equip a locked theme (id '' = default nebula)
    try { if (id) localStorage.setItem(this._paletteKey(), id); else localStorage.removeItem(this._paletteKey()); } catch (e) {}
    if (typeof Theme !== 'undefined' && Theme.apply) Theme.apply(id || (Theme.DEFAULT));   // rebuild the nebula/starfield in the new colours
    this.renderGridGallery();
    if (id && typeof AchUI !== 'undefined' && AchUI._push) {
      const d = this.paletteDefs().find(function (m) { return m.id === id; });
      if (d) AchUI._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>${tr('🌌 GRID EQUIPPED')}</b><span>${tr(d.title)}</span></div>`, '#54e6b5');
    }
    return true;
  },

  /* ----- the Grids gallery (rendered into #gridlist) — the free default + every unlocked map theme ----- */
  renderGridGallery() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('gridlist'); if (!host) return;
    const defs = this.paletteDefs(), eq = this.equippedPalette(), self = this;
    const ownedN = defs.filter(function (d) { return self.owns(d.id); }).length;
    const header = `<div class="skin-bar"><div class="skin-n">${tr('Unlocked')} ${ownedN}/${defs.length}</div></div>`;
    const dfCard = self._gridCardHTML({ id: '', title: 'Cosmic Nebula', ico: '🌌', from: null, free: true }, eq);   // the free default always shows first
    const cards = defs.map(function (d) { return self._gridCardHTML(d, eq); }).join('');
    host.innerHTML = header + `<div class="track-grid">${dfCard}${cards}</div>`;
    if (typeof host.querySelectorAll === 'function')
      host.querySelectorAll('[data-equipg]').forEach(function (b) { b.onclick = function () { self.equipPalette(b.dataset.equipg); }; });
  },
  _gridCardHTML(d, eq) {
    const owned = d.free || this.owns(d.id), isEq = owned && (d.id || null) === (eq || null);
    const cls = ['track-card', owned ? 'owned' : 'locked', isEq ? 'equipped' : ''].join(' ').trim();
    const sw = (typeof Theme !== 'undefined' && Theme.swatch) ? Theme.swatch(d.free ? (Theme.DEFAULT) : d.id) : '';
    const foot = owned
      ? (isEq ? `<span class="track-badge">${tr('✓ EQUIPPED')}</span>` : `<button class="track-btn equip" data-equipg="${d.id}">${tr('EQUIP')}</button>`)
      : `<span class="skin-lock">🔒 ${tr('from:')} ${d.from}</span>`;
    return `<div class="${cls}">` +
             `<div class="skin-card-head"><span class="skin-ico">${owned ? d.ico : '🔒'}</span><span class="skin-tag">${tr('grid')}</span></div>` +
             sw +
             `<div class="skin-card-body"><b>${owned ? tr(d.title) : '???'}</b><span>${owned ? tr('Map colour theme') : tr('Achievement reward')}</span></div>` +
             foot + `</div>`;
  },

  /* ---- trails: the Trails tab roster + equip. The equipped trail's colour is read by render.js, which
   *      draws a fading streak behind every player bullet in that hue (id '' = no trail = default look). ---- */
  trailDefs() {
    return Object.keys(REWARD_MAP).map(function (ach) { const r = REWARD_MAP[ach]; return r.kind === 'trail' ? { id: r.id, title: r.title, ico: r.ico, col: (TRAIL_COL[r.id] || '#54e6ff'), from: ach } : null; }).filter(Boolean);
  },
  _trailKey() { const p = (typeof getPlayer === 'function') && getPlayer(); return 'neon_trail:' + ((p && p.id) || 'local'); },
  // equipped trail id (validated against ownership), or null = no trail (default bullet look)
  equippedTrail() { try { const v = localStorage.getItem(this._trailKey()); return (v && this.owns(v)) ? v : null; } catch (e) { return null; } },
  // the colour render.js draws the bullet streak in, or null when no trail is equipped (skip the streak entirely)
  equippedTrailColor() { const id = this.equippedTrail(); return id ? (TRAIL_COL[id] || '#54e6ff') : null; },
  equipTrail(id) {
    if (id && !this.owns(id)) return false;                  // can't equip a locked trail (id '' = no trail)
    try { if (id) localStorage.setItem(this._trailKey(), id); else localStorage.removeItem(this._trailKey()); } catch (e) {}
    this.renderTrailGallery();
    if (id && typeof AchUI !== 'undefined' && AchUI._push) {
      const d = this.trailDefs().find(function (m) { return m.id === id; });
      if (d) AchUI._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>${tr('🎨 TRAIL EQUIPPED')}</b><span>${tr(d.title)}</span></div>`, '#54e6ff');
    }
    return true;
  },

  /* ----- the Trails gallery (rendered into #traillist) — the free "no trail" default + every unlocked trail ----- */
  renderTrailGallery() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('traillist'); if (!host) return;
    const defs = this.trailDefs(), eq = this.equippedTrail(), self = this;
    const ownedN = defs.filter(function (d) { return self.owns(d.id); }).length;
    const header = `<div class="skin-bar"><div class="skin-n">${tr('Unlocked')} ${ownedN}/${defs.length}</div></div>`;
    const dfCard = self._trailCardHTML({ id: '', title: 'No Trail', ico: '∅', col: '#7c8cff', from: null, free: true }, eq);   // the free default always shows first
    const cards = defs.map(function (d) { return self._trailCardHTML(d, eq); }).join('');
    host.innerHTML = header + `<div class="track-grid">${dfCard}${cards}</div>`;
    if (typeof host.querySelectorAll === 'function')
      host.querySelectorAll('[data-equipt]').forEach(function (b) { b.onclick = function () { self.equipTrail(b.dataset.equipt); }; });
  },
  _trailCardHTML(d, eq) {
    const owned = d.free || this.owns(d.id), isEq = owned && (d.id || null) === (eq || null);
    const cls = ['track-card', owned ? 'owned' : 'locked', isEq ? 'equipped' : ''].join(' ').trim();
    const sw = owned ? `<div class="trail-swatch" style="--trail-col:${d.col};background:linear-gradient(90deg,transparent,${d.col})"></div>` : '';
    const foot = owned
      ? (isEq ? `<span class="track-badge">${tr('✓ EQUIPPED')}</span>` : `<button class="track-btn equip" data-equipt="${d.id}">${tr('EQUIP')}</button>`)
      : `<span class="skin-lock">🔒 ${tr('from:')} ${d.from}</span>`;
    return `<div class="${cls}">` +
             `<div class="skin-card-head"><span class="skin-ico">${owned ? d.ico : '🔒'}</span><span class="skin-tag">${tr('trail')}</span></div>` +
             sw +
             `<div class="skin-card-body"><b>${owned ? tr(d.title) : '???'}</b><span>${owned ? tr('Projectile trail') : tr('Achievement reward')}</span></div>` +
             foot + `</div>`;
  },

  /* showcase tab toggle (Skins | Trails | Soundtrack | Grids) — bound once; panes are #skinlist / #traillist / #tracklist / #gridlist */
  _initTabs() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const tabs = document.querySelectorAll('.showcase-tab'); if (!tabs || !tabs.forEach) return;
    tabs.forEach(function (t) {
      t.onclick = function () {
        const sc = t.dataset.sc;
        document.querySelectorAll('.showcase-tab').forEach(function (x) { x.classList.toggle('on', x.dataset.sc === sc); });
        document.querySelectorAll('.sc-pane').forEach(function (p) { p.classList.toggle('sc-off', p.dataset.pane !== sc); });
      };
    });
  },
  // NB: the Grids gallery is rendered by theme-system.js after it loads (it owns the `Theme` const that
  // _gridCardHTML reads) — rendering it here would touch `Theme` before its declaration in the bundled build.
  _init() { if (typeof document === 'undefined') return; this._initTabs(); this.renderTrailGallery(); this.renderTrackGallery(); },
};

// window.debugAchievement (the console full-cycle prover) lives in dev-tools.js — loaded last, kept
// out of THIS file so it stays under the 28 KB silent-truncation threshold.

if (typeof document !== 'undefined') RewardEngine._init();
