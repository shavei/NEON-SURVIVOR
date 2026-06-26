/* NEON SURVIVOR — skins-ui.js : the Skins sub-tab of the Showcase panel + equip persistence.
 * Classic global `Skins`. Loads AFTER achievements-ui.js (reads COSMETICS + the Ach mirror) and net.js
 * (uses SB/getPlayer), BEFORE main.js. Headless/offline-safe: every DOM/localStorage/SB touch is guarded,
 * so verify.cjs loads it clean and offline play never throws.
 *
 * Deliberately owns ONLY the display + active-selection side of cosmetics; it never defines or grants skins
 * (that's achievements.js → cosmetics_inventory). It reads ownership live from Ach._load().cosmetics and the
 * catalog from COSMETICS, so any skin added later shows up here automatically — no edit to those files needed.
 *
 *   renderGallery()  — equip-cards into #skinlist: owned / locked / equipped states + neon pulse on the active hull.
 *   equip(id)        — validate ∈ owned → persist locally + best-effort profiles.equipped_skin_id upsert; the
 *                      avatar updates on the very next frame because render.js reads Skins.equipped() per draw.
 *   debugUnlockSkin/debugEquipSkin/debugLockAllSkins — console verification, mirror-only (server untouched). */

const Skins = {
  _mem: '',            // in-memory equip fallback when localStorage is unavailable (headless)
  _synced: false,      // cloud equip-state pulled once this session
  _cloudOff: false,    // profiles.equipped_skin_id column / table absent → stop poking the cloud

  /* ----- data (all read-only from the achievements side) ----- */
  skinDefs() { return (typeof COSMETICS !== 'undefined' ? COSMETICS : []).filter(c => c.kind === 'skin'); },
  _def(id) { return this.skinDefs().find(c => c.id === id); },
  _owned() {
    try { return (typeof Ach !== 'undefined' ? (Ach._load().cosmetics || []) : []); } catch (e) { return []; }
  },
  owns(id) { return !!id && this._owned().indexOf(id) >= 0; },
  _accent(id) { return ({ '': '#ff8a5e', crimson_husk: '#ff3b6b', void_warden: '#9a5cff' })[id] || '#54e6b5'; },

  /* ----- equip state: local-first (instant, offline), cloud best-effort for cross-device ----- */
  _key() {
    const p = (typeof getPlayer === 'function') && getPlayer();
    return 'neon_skin:' + ((p && p.id) || 'local');
  },
  _getLocal() { try { const v = localStorage.getItem(this._key()); if (v != null) return v; } catch (e) {} return this._mem || ''; },
  _setLocal(id) {
    this._mem = id || '';
    try { if (id) localStorage.setItem(this._key(), id); else localStorage.removeItem(this._key()); } catch (e) {}
  },
  // the single source of truth render.js reads each frame: validated equipped skin id, or null (= default hull)
  equipped() { const id = this._getLocal(); return this.owns(id) ? id : null; },

  equip(id) {
    if (id && !this.owns(id)) return false;          // can't equip what you don't own (default hull = id '')
    this._setLocal(id || '');                        // avatar swaps next frame via equipped()
    this._cloudSave(id || null);
    this.renderGallery();
    if (id && typeof AchUI !== 'undefined' && AchUI._push) {
      const c = this._def(id);
      if (c) AchUI._push(`<span class="at-ico">${c.ico}</span><div class="at-text"><b>🎨 SKIN EQUIPPED</b>` +
                         `<span>${c.title}</span></div>`, this._accent(id));
    }
    return true;
  },

  /* ----- cloud sync (profiles.equipped_skin_id). Best-effort: the row already exists once signed-in
   *       (achievement-sync._setProfile created it), so this just patches one column. Degrades silently
   *       offline or if the column hasn't been provisioned yet. ----- */
  _cloudSave(id) {
    try {
      if (this._cloudOff || typeof SB === 'undefined' || !SB) return;
      const p = (typeof getPlayer === 'function') && getPlayer(); if (!p || !p.id) return;
      const row = { id: p.id, equipped_skin_id: id || null }; if (p.name) row.username = p.name;
      SB.from('profiles').upsert(row).then(r => { if (r && r.error) this._cloudOff = true; }).catch(() => { this._cloudOff = true; });
    } catch (e) {}
  },
  _cloudSync() {
    try {
      if (this._synced || this._cloudOff || typeof SB === 'undefined' || !SB) return;
      const p = (typeof getPlayer === 'function') && getPlayer(); if (!p || !p.id) return;
      this._synced = true;
      SB.from('profiles').select('equipped_skin_id').eq('id', p.id).single().then(r => {
        if (r && r.error) { const m = (r.error.message || '') + (r.error.code || ''); if (/equipped_skin_id|column|42703|PGRST/i.test(m)) this._cloudOff = true; return; }
        const id = r && r.data && r.data.equipped_skin_id;
        if (id && this.owns(id) && this.equipped() !== id) { this._setLocal(id); this.renderGallery(); }
      }).catch(() => {});
    } catch (e) {}
  },

  /* ----- the gallery (rendered into #skinlist) ----- */
  renderGallery() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('skinlist'); if (!host) return;
    this._cloudSync();
    const defs = this.skinDefs(), eq = this.equipped();
    const ownedN = defs.filter(c => this.owns(c.id)).length;
    const header = `<div class="skin-bar"><div class="skin-h">🎨 SKINS — equip a hull</div>` +
                   `<div class="skin-n">Owned ${ownedN}/${defs.length}</div></div>`;
    // default-hull card first (always available → revert to the stock neon ship), then every catalogued skin
    const cards = [this._cardHTML({ id: '', title: 'Default Hull', ico: '🔺', from: null, _def: true }, eq)]
      .concat(defs.map(c => this._cardHTML(c, eq))).join('');
    host.innerHTML = header + `<div class="skin-grid">${cards}</div>`;
    if (typeof host.querySelectorAll === 'function')
      host.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => this.equip(b.dataset.equip));
  },
  _cardHTML(c, eq) {
    const isDef = !!c._def, owned = isDef || this.owns(c.id);
    const isEq = owned && (isDef ? !eq : c.id === eq);
    const accent = this._accent(c.id);
    const cls = ['skin-card', owned ? 'owned' : 'locked', isEq ? 'equipped' : ''].join(' ').trim();
    const foot = isEq ? `<span class="skin-badge">✓ EQUIPPED</span>`
               : owned ? `<button class="skin-btn" data-equip="${c.id}">EQUIP</button>`
               : `<span class="skin-lock">🔒 ${c.from ? 'from: ' + c.from : 'locked'}</span>`;
    return `<div class="${cls}" style="--skin-accent:${accent}">` +
             `<div class="skin-card-head"><span class="skin-ico">${owned ? c.ico : '🔒'}</span><span class="skin-tag">skin</span></div>` +
             `<div class="skin-card-body"><b>${owned ? c.title : '???'}</b>` +
               `<span>${isDef ? 'Stock neon hull' : (owned ? 'Hull cosmetic' : 'Gold-tier reward')}</span></div>` +
             foot + `</div>`;
  },

  /* ----- mount: inject the Showcase sub-tab toggle + #skinlist beside #achlist (no index.html markup edit,
   *       so this stays clear of the achievements panel other work may touch). AchUI only rewrites
   *       #achlist's innerHTML, so the injected toggle + #skinlist survive its re-renders. ----- */
  _init() {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('achlist'); if (!host || document.getElementById('skinlist')) return;
    const panel = host.parentNode; if (!panel || typeof document.createElement !== 'function') return;
    const title = panel.querySelector && panel.querySelector('.mptitle'); if (title) title.textContent = '🏆 Showcase';
    const bar = document.createElement('div'); bar.className = 'show-tabs';
    bar.innerHTML = '<button class="show-tab on" data-show="ach">🏅 Achievements</button>' +
                    '<button class="show-tab" data-show="skin">🎨 Skins</button>';
    const skinHost = document.createElement('div'); skinHost.className = 'achlist'; skinHost.id = 'skinlist'; skinHost.style.display = 'none';
    panel.insertBefore(bar, host); panel.insertBefore(skinHost, host.nextSibling);
    bar.querySelectorAll('.show-tab').forEach(b => b.onclick = () => {
      const sk = b.dataset.show === 'skin';
      bar.querySelectorAll('.show-tab').forEach(x => x.classList.toggle('on', x === b));
      host.style.display = sk ? 'none' : 'block';
      skinHost.style.display = sk ? 'block' : 'none';
      if (sk) Skins.renderGallery();
    });
  },
};

/* ----- DEV verification tool (console) — exercise the UI + equip path WITHOUT earning a gold achievement.
 *   debugUnlockSkin('void_warden')  → drop it into the local mirror (cards + showcase update; no cloud write)
 *   debugEquipSkin('void_warden')   → equip it (avatar recolours live next frame)
 *   debugLockAllSkins()             → strip every skin + unequip → verify the locked-card + default-hull paths
 * Mirror-only, so prod data is safe and it all works fully offline (SB === null). */
if (typeof window !== 'undefined') {
  window.debugUnlockSkin = function (id) {
    if (typeof Ach === 'undefined') return 'no Ach';
    if (!Skins._def(id)) return 'unknown skin: ' + id;
    const s = Ach._load(); s.cosmetics = s.cosmetics || [];
    if (s.cosmetics.indexOf(id) < 0) s.cosmetics.push(id);
    Ach._save(s);
    Skins.renderGallery(); if (typeof AchUI !== 'undefined' && AchUI.renderGallery) AchUI.renderGallery();
    return id + ' unlocked (local mirror) — open the Skins tab';
  };
  window.debugEquipSkin = function (id) {
    if (!Skins.owns(id)) return id + ' not owned — run debugUnlockSkin("' + id + '") first';
    Skins.equip(id); return 'equipped ' + id;
  };
  window.debugLockAllSkins = function () {
    if (typeof Ach === 'undefined') return 'no Ach';
    const s = Ach._load();
    s.cosmetics = (s.cosmetics || []).filter(id => { const c = Skins._def(id); return !c; });
    Ach._save(s); Skins._setLocal('');
    Skins.renderGallery(); if (typeof AchUI !== 'undefined' && AchUI.renderGallery) AchUI.renderGallery();
    return 'all skins locked + unequipped';
  };
}

if (typeof document !== 'undefined') Skins._init();
