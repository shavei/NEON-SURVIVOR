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

/* achievement id → reward. kind ∈ skin | trail | music. For music, `src` is the audio-orchestrator JUKE
 * key previewed/equipped. The 8 gold ids reuse their existing COSMETICS ids byte-for-byte so nothing
 * already granted breaks. MUST stay in lockstep with REWARD_MAP in api/verify.js — verify-achievements.cjs
 * cross-checks the {kind,id,src} projection is identical. title/ico are client-only UI metadata. */
const REWARD_MAP = {
  // ---- combat ----
  first_blood:       { kind:'trail', id:'first_blood_spark',   title:'First Blood Spark',   ico:'🩸' },
  swarm_breaker:     { kind:'trail', id:'swarm_pulse',         title:'Swarm Pulse',         ico:'💢' },
  one_man_army:      { kind:'skin',  id:'legionnaire',         title:'Legionnaire',         ico:'🟧' },
  annihilator:       { kind:'skin',  id:'crimson_husk',        title:'Crimson Husk',        ico:'🟥' },
  // ---- survival ----
  high_scorer:       { kind:'trail', id:'scorch_trail',        title:'Scorch Trail',        ico:'🔥' },
  score_legend:      { kind:'skin',  id:'regent',              title:'Regent',              ico:'🟨' },
  neon_god:          { kind:'trail', id:'neon_god_trail',      title:'Neon God Trail',      ico:'✨' },
  wave_rider:        { kind:'music', id:'tide_overture',       title:'Tide Overture',       ico:'🎵', src:'play'  },
  wave_master:       { kind:'music', id:'maelstrom_waltz',     title:'Maelstrom Waltz',     ico:'🎶', src:'boss1' },
  abyss_walker:      { kind:'skin',  id:'void_warden',         title:'Void Warden',         ico:'🟪' },
  power_surge:       { kind:'trail', id:'surge_arc',           title:'Surge Arc',           ico:'⚡' },
  ascended:          { kind:'trail', id:'ascension_wake',      title:'Ascension Wake',      ico:'🌠' },
  veteran:           { kind:'music', id:'veterans_march',      title:'Veteran’s March',     ico:'🎻', src:'over'  },
  hardcore:          { kind:'skin',  id:'cinder_frame',        title:'Cinder Frame',        ico:'🟧' },
  // ---- boss ----
  boss_slayer:       { kind:'trail', id:'slayer_mark',         title:'Slayer Mark',         ico:'💀' },
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
  // ---- speed ----
  power_spike:       { kind:'trail', id:'spike_trail',         title:'Spike Trail',         ico:'📈' },
  ascendant_rush:    { kind:'music', id:'ascendant_theme',     title:'Ascendant Rush',      ico:'🚄', src:'play'  },
  blitz:             { kind:'trail', id:'blitz_streak',        title:'Blitz Streak',        ico:'⏱️' },
  killer_instinct:   { kind:'skin',  id:'predator',            title:'Predator',            ico:'🎯' },
  massacre_clock:    { kind:'music', id:'clockwork_dies_irae', title:'Clockwork Dies Irae', ico:'⏲️', src:'boss0' },
  // ---- challenge ----
  objector:          { kind:'trail', id:'objector_halo',       title:'Objector Halo',       ico:'✋' },
  pacifist_protocol: { kind:'trail', id:'dove_halo',           title:'Dove Halo',           ico:'🕊️' },
  minimalist:        { kind:'skin',  id:'monoline',            title:'Monoline',            ico:'➖' },
  ascetic:           { kind:'music', id:'ascetic_nocturne',    title:'Ascetic Nocturne',    ico:'🧘', src:'menu'  },
  // ---- secret ----
  any_percent:       { kind:'trail', id:'any_percent_blip',    title:'Any% Blip',           ico:'🏁' },
  leet:              { kind:'skin',  id:'leet_chrome',         title:'1337 Chrome',         ico:'😎' },
  completionist:     { kind:'skin',  id:'prism_core',          title:'Prism Core',          ico:'🟩' },
};

const RewardEngine = {
  MAP: REWARD_MAP,
  _invOff: false,   // user_inventory table/policy absent → stop poking the cloud (no repeat 4xx)

  rewardFor(achId) { return REWARD_MAP[achId] || null; },
  _mirror() { try { return (typeof Ach !== 'undefined') ? Ach._load() : { cosmetics: [], tracks: [] }; } catch (e) { return { cosmetics: [], tracks: [] }; } },
  // skins + trails share the cosmetics mirror; music tracks live in their own list
  owns(rewardId) { const s = this._mirror(); return (s.cosmetics || []).indexOf(rewardId) >= 0 || (s.tracks || []).indexOf(rewardId) >= 0; },

  /* ---- the granting hook: called from AchUI.unlockToast(id) the instant is_unlocked flips true ----
   * The local mirror is already written by Ach._grantRewards (data layer) on the SAME _save, so here we
   * only do the cloud-facing side effects: the reward toast (skipped for gold, which Ach._grantCosmetics
   * already toasted to avoid a double) + the optimistic user_inventory insert. */
  onUnlock(achId) {
    const r = this.rewardFor(achId); if (!r) return;
    const gold = (typeof COSMETIC_MAP !== 'undefined') && COSMETIC_MAP[achId];   // gold cosmetic already toasted by Ach._grantCosmetics
    if (!gold) this._toast(r);
    this._insertInventory(r);
  },
  _toast(r) {
    if (typeof AchUI === 'undefined' || !AchUI._push) return;
    const label = r.kind === 'music' ? '🎵 SOUNDTRACK UNLOCKED' : r.kind === 'trail' ? '🎨 TRAIL UNLOCKED' : '🎨 SKIN UNLOCKED';
    const accent = r.kind === 'music' ? '#b98cff' : '#54e6ff';
    AchUI._push(`<span class="at-ico">${r.ico}</span><div class="at-text"><b>${label}</b><span>${r.title}</span></div>`, accent);
  },

  /* optimistic cloud mirror: drop the reward into user_inventory. Best-effort & RLS-guarded exactly like
   * Skins._cloudSave — the server (api/verify.js) is the authoritative writer, so a missing table / RLS
   * denial just latches _invOff and we fall back to the local mirror (offline-safe, no repeat failures). */
  _insertInventory(r) {
    try {
      if (this._invOff || typeof SB === 'undefined' || !SB) return;
      const p = (typeof getPlayer === 'function') && getPlayer(); if (!p || !p.id) return;
      SB.from('user_inventory').insert({ player_id: p.id, reward_id: r.id, kind: r.kind })
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
        self.renderTrackGallery();
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
    return Object.keys(REWARD_MAP).map(function (ach) { const r = REWARD_MAP[ach]; return r.kind === 'music' ? { id: r.id, title: r.title, ico: r.ico, src: r.src, from: ach } : null; }).filter(Boolean);
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
      if (d) AchUI._push(`<span class="at-ico">${d.ico}</span><div class="at-text"><b>🎵 TRACK EQUIPPED</b><span>${d.title}</span></div>`, '#b98cff');
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
    const header = `<div class="skin-bar"><div class="skin-n">Unlocked ${ownedN}/${defs.length}</div></div>`;
    const cards = defs.map(function (d) { return self._trackCardHTML(d, eq); }).join('');
    host.innerHTML = header + `<div class="track-grid">${cards}</div>`;
    if (typeof host.querySelectorAll === 'function') {
      host.querySelectorAll('[data-prev]').forEach(function (b) { b.onclick = function () { self.previewMusic(b.dataset.prev); }; });
      host.querySelectorAll('[data-equipm]').forEach(function (b) { b.onclick = function () { self.equipMusic(b.dataset.equipm); }; });
    }
  },
  _trackCardHTML(d, eq) {
    const owned = this.owns(d.id), isEq = owned && d.id === eq;
    const cls = ['track-card', owned ? 'owned' : 'locked', isEq ? 'equipped' : ''].join(' ').trim();
    const foot = owned
      ? `<div class="track-btns"><button class="track-btn prev" data-prev="${d.id}">▶ Preview</button>` +
        (isEq ? `<span class="track-badge">✓ EQUIPPED</span>` : `<button class="track-btn equip" data-equipm="${d.id}">EQUIP</button>`) + `</div>`
      : `<span class="skin-lock">🔒 from: ${d.from}</span>`;
    return `<div class="${cls}">` +
             `<div class="skin-card-head"><span class="skin-ico">${owned ? d.ico : '🔒'}</span><span class="skin-tag">track</span></div>` +
             `<div class="skin-card-body"><b>${owned ? d.title : '???'}</b><span>${owned ? 'Orchestral score' : 'Achievement reward'}</span></div>` +
             foot + `</div>`;
  },

  /* showcase tab toggle (Skins | Soundtrack) — bound once; panes are the static #skinlist / #tracklist */
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
  _init() { if (typeof document === 'undefined') return; this._initTabs(); this.renderTrackGallery(); },
};

/* ----- DEV verification tool (console) : prove a reward end-to-end -----
 *   debugAchievement('wave_master', 100)  → unlock it: fire the toast AND grant the reward, then report.
 *   debugAchievement('ghost_grid', 80)    → drive the badge bar to 80% (no unlock) — exercises the progress UI.
 * Returns a plain object: whether the toast fired, the reward granted, whether it's now in the mirror, and
 * whether it's IMMEDIATELY selectable in the Showcase (skin equippable / track equipped) + the inventory
 * state. Mirror-only + optimistic insert — the server is never forced, so prod data is safe. */
if (typeof window !== 'undefined') window.debugAchievement = function (id, pct) {
  if (typeof Ach === 'undefined' || typeof AchUI === 'undefined') return 'no Ach/AchUI';
  const d = Ach.CATALOG.find(function (x) { return x.id === id; }); if (!d) return 'unknown achievement: ' + id;
  if (pct == null) pct = 100;
  const frac = Math.max(0, Math.min(1, pct / 100));
  AchUI.mock(id, frac);                            // <100 → bar only; ==100 → mockGrant → _notify → onUnlock hook
  if (frac < 1) return { id: id, progress: Math.round(frac * 100) + '%', unlocked: false };
  const r = RewardEngine.rewardFor(id), s = Ach._load();
  const inMirror = r ? ((r.kind === 'music' ? (s.tracks || []) : (s.cosmetics || [])).indexOf(r.id) >= 0) : false;
  let selectable = false;
  if (r) {
    if (r.kind === 'music') { RewardEngine.equipMusic(r.id); selectable = RewardEngine.equippedMusic() === r.id; }   // prove it's equippable
    else if (r.kind === 'skin') selectable = (typeof Skins !== 'undefined' && Skins.owns(r.id));
    else selectable = inMirror;                    // trails are inventoried (equip surface is future work)
  }
  if (typeof Skins !== 'undefined' && Skins.renderGallery) Skins.renderGallery();
  RewardEngine.renderTrackGallery();
  return { id: id, unlocked: Ach.isUnlocked(id), toast: true, reward: r && { kind: r.kind, id: r.id, title: r.title },
           inMirror: inMirror, selectable: selectable, inventory: RewardEngine._invOff ? 'mirror-only(offline/no-table)' : 'insert-sent' };
};

if (typeof document !== 'undefined') RewardEngine._init();
