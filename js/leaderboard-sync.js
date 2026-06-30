/* NEON SURVIVOR — leaderboard-sync.js : concurrent background prefetch of every difficulty board.
 * Loads AFTER net.js (uses fetchTop), BEFORE leaderboard-engine.js + main.js (they read leaderboardCache).
 * Single source of truth for global-board rows: the menu tabs, the death-screen feedback, and the F4
 * NetDebug overlay all read `leaderboardCache`. Headless/offline-safe — fetchTop()===null → state:'error',
 * never throws, never blocks. Trigger: fire-and-forget syncAll() after identity/SDK is ready. */

/* diff -> { state:'loading'|'ready'|'error', rows:array|null, ts:ms }. Global (classic script). */
const leaderboardCache = {};

const LBSync = {
  DIFFS: ['easy', 'normal', 'hard'],
  TTL: 30000,                 // a 'ready' entry younger than this is reused as-is (instant tab switch)
  _inflight: {},              // diff -> Promise, so concurrent callers share one network round-trip

  /* true when we already hold a recent successful snapshot for `diff` (skip the refetch) */
  fresh(diff) { const e = leaderboardCache[diff]; return !!(e && e.state === 'ready' && (Date.now() - e.ts) < LBSync.TTL); },
  get(diff) { return leaderboardCache[diff]; },

  /* cross-session persistence (stale-while-revalidate): last-known rows survive a reload so the board
   * paints instantly from disk on the next visit, then refreshes in the background. localStorage may be
   * absent (headless/private mode) — every access is guarded, never throws. */
  _KEY: 'neon_lb_cache',
  _persist() { try { if (typeof localStorage === 'undefined') return;
    const o = {}; LBSync.DIFFS.forEach(d => { const e = leaderboardCache[d]; if (e && e.state === 'ready' && e.rows) o[d] = e.rows; });
    localStorage.setItem(LBSync._KEY, JSON.stringify(o)); } catch (e) {} },
  /* hydrate at boot: seed each board as 'ready' but ts:0 so it renders at once yet is never deemed
   * 'fresh' — syncAll() still refetches, replacing the stale snapshot when the network lands. */
  _hydrate() { try { if (typeof localStorage === 'undefined') return;
    const o = JSON.parse(localStorage.getItem(LBSync._KEY) || '{}');
    LBSync.DIFFS.forEach(d => { if (o[d] && o[d].length && !leaderboardCache[d]) leaderboardCache[d] = { state: 'ready', rows: o[d], ts: 0 }; }); } catch (e) {} },

  /* fetch ONE difficulty; isolates its own failure so a sibling in Promise.all can't be taken down */
  _one(diff) {
    if (LBSync._inflight[diff]) return LBSync._inflight[diff];
    const prev = leaderboardCache[diff];
    leaderboardCache[diff] = { state: 'loading', rows: prev ? prev.rows : null, ts: prev ? prev.ts : 0 };
    const settle = (state, rows) => {
      leaderboardCache[diff] = { state, rows, ts: Date.now() };
      delete LBSync._inflight[diff];
      if (state === 'ready') LBSync._persist();   // survive a reload → instant paint next visit
      if (typeof onLeaderboardUpdate === 'function') try { onLeaderboardUpdate(diff); } catch (e) {}
    };
    let p;
    if (typeof fetchTop !== 'function') { settle('error', null); p = Promise.resolve(); }
    else p = fetchTop(diff).then(
      rows => settle(rows === null ? 'error' : 'ready', rows === null ? null : rows),
      () => settle('error', null));
    LBSync._inflight[diff] = p;
    return p;
  },

  /* fetch one difficulty unless we already have a fresh snapshot (used by tab clicks) */
  ensure(diff) { return LBSync.fresh(diff) ? Promise.resolve() : LBSync._one(diff); },

  /* fire ALL difficulties at once. `force` refetches even fresh entries. Logs a batch-timing audit so
   * parallelism is provable: total ≈ slowest single fetch when concurrent, ≈ their sum if serialized. */
  /* debug-only audit log: silent unless the F3 perf overlay (_perf.on) is toggled on, so a normal
   * console stays clean. Guarded for headless where _perf/console may be absent. */
  _log(...a) { if (typeof _perf !== 'undefined' && _perf.on && typeof console !== 'undefined') console.log('[LBSync]', ...a); },

  syncAll(force) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    LBSync._log('batch start', LBSync.DIFFS.join(','));
    const jobs = LBSync.DIFFS.map(d => (force ? LBSync._one(d) : LBSync.ensure(d)));
    return Promise.all(jobs).then(() => {
      const ms = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(0);
      LBSync._log('batch done in ' + ms + 'ms',
        LBSync.DIFFS.map(d => d + ':' + ((leaderboardCache[d] || {}).state || '—')).join(' '));
    });
  },
};

LBSync._hydrate();   // seed the cache from last session so boards render before the first network round-trip
