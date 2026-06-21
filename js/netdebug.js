/* NEON SURVIVOR — netdebug.js : Network Debug Overlay (toggle F4), dev-only.
 * Classic global (loads BEFORE main.js so main's keydown can call NetDebug.toggle()). Mirrors the
 * F3 perf overlay pattern: off by default (zero cost), reads globals only, never mutates sim state.
 * Surfaces lobby channel state, the live peer/lerp table, outbound send rate, and the last
 * /api/verify response — so player sync and achievement grants can be eyeballed before committing.
 * Headless-safe: all DOM access is lazy and guarded. */

const NetDebug = {
  on: false, el: null,

  toggle() {
    if (typeof document === 'undefined') return;
    this.on = !this.on;
    if (!this.el) { const d = document.createElement('div'); d.id = 'nethud'; document.body.appendChild(d); this.el = d; }
    this.el.style.display = this.on ? 'block' : 'none';
    if (this.on) this.render();
  },

  /* called each frame from loop(); cheap no-op while hidden */
  tick() { if (this.on) this.render(); },

  render() {
    if (!this.el) return;
    const L = (typeof Lobby !== 'undefined') ? Lobby : null;
    const lines = [];
    if (L) {
      const ch = L.channel, st = ch && ch.state ? ch.state : (ch ? 'open' : 'CLOSED');
      lines.push(`LOBBY ${L.room || '—'} · ${st} · me=${(L.me || '—')} · peers=${L.count()}`);
      lines.push(`send≈${(1000 / L.SEND_MS).toFixed(0)}Hz · smooth=${L.SMOOTH} · timeout=${L.TIMEOUT}ms`);
      for (const id in L.peers) {
        const p = L.peers[id], lag = ((Date.now() - p.lastSeen) | 0);
        lines.push(` ${(p.name || id).slice(0, 8).padEnd(8)} pos(${p.x.toFixed(0)},${p.y.toFixed(0)}) ` +
                   `→(${p.tx.toFixed(0)},${p.ty.toFixed(0)}) lag ${lag}ms`);
      }
    } else lines.push('LOBBY module absent');
    if (typeof Coop !== 'undefined') {
      const P = Coop.spawnP(), mul = Coop.scaleMul(P);
      lines.push(`COOP ${Coop.active ? 'ON' : 'off'} · host=${Coop.host} · P=${P} · mul=${mul.toFixed(2)}` +
                 ` · fake=${Coop._fake == null ? '—' : Coop._fake} · ÷√P=${(1 / Math.sqrt(Math.max(1, P))).toFixed(2)}`);
      if (Coop.active) {
        const ne = (typeof enemies !== 'undefined') ? enemies.length : 0;
        const no = (typeof orbs !== 'undefined') ? orbs.length : 0;
        const ni = (typeof items !== 'undefined') ? items.length : 0;
        lines.push(`Entities Synced: ${ne + no + ni}  (enemies ${ne} · orbs ${no} · items ${ni}) seq=${Coop._rseq || Coop._seq || 0}`);
        lines.push(`Broadcast Latency: ${Coop.host ? '— (host)' : ((Coop._lat | 0) + 'ms')}` +
                   ` · host=${(Coop._recvHost || (Coop.host && L ? L.me : '?'))} · migrations=${Coop._migrations || 0} · alive=${Coop._alive}`);
      }
    }
    if (typeof Ach !== 'undefined') {
      const last = Ach._last;
      lines.push(`ACH token=${Ach._token ? 'open' : '—'} · runBosses=${Ach.run.bosses}`);
      lines.push('verify: ' + (last ? JSON.stringify(last).slice(0, 80) : 'none yet'));
    }
    this.el.textContent = lines.join('\n');
  },
};
