/* NEON SURVIVOR — callsign-filter.js : the HARDENED cross-language Callsign Censorship Engine. Classic
 * global, headless/offline-safe (no DOM / SB / storage touch at load), so verify*.cjs require it clean.
 * Loads AFTER achievement-sync.js and BEFORE auth-uplink.js — confirmUsername()/_checkCallsign() gate on
 * it before any cloud write, so a restricted callsign never reaches Supabase (no throwaway account needed).
 *
 * Bidirectional by design (English <-> Hebrew). deepNormalize(text) folds an input through ONE pipeline:
 *   lowercase -> NFKD (strip combining diacritics + Hebrew niqqud) -> HOMOGLYPH collapse (Cyrillic / Greek /
 *   IPA look-alikes -> their Latin base) -> LEETSPEAK de-obfuscation (3->e, 0->o, @->a ...) -> strip every
 *   punctuation / space / symbol, leaving a letters-only base. normalizeCallsign() then projects that base
 *   into TWO "Standardized Comparison Strings":
 *     .latin  - Hebrew letters -> Latin phonetics  (catches Hebrew-typed English slurs)
 *     .hebrew - Latin letters  -> a Hebrew consonant skeleton (catches Latin-typed Hebrew profanity)
 * Because the input is normalized first, the registry stores ONE canonical root per term (no case / leet /
 * homoglyph / spelling variants) — a few hundred roots stay a few KB, far under the 28 KB truncation line. */

/* ---- leetspeak: digits / lookalike symbols -> the letter they stand in for (works for both scripts) ---- */
const _CF_LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l', '(': 'c' };

/* ---- HOMOGLYPHS: Unicode look-alikes (Cyrillic / Greek / IPA) -> the Latin letter they impersonate. Folded
 *      BEFORE the projection so "fцck" / "ѕhіt" / "ρuѕѕy" all converge on their ASCII root. Any char in the
 *      covered blocks with no entry passes through and is stripped later as a non-letter. ---- */
const _CF_HOMO = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'к': 'k', 'м': 'm', 'т': 't',
  'н': 'h', 'в': 'b', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ё': 'e',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'ν': 'v', 'κ': 'k', 'τ': 't', 'ι': 'i', 'υ': 'u', 'γ': 'y',
  'σ': 's', 'χ': 'x', 'β': 'b',
  'ɡ': 'g', 'ɪ': 'i', 'ʟ': 'l', 'ʀ': 'r', 'ɴ': 'n', 'ɢ': 'g'
};
const _CF_HOMO_RE = /[Ͱ-ϿЀ-ӿɐ-ʯ]/g;   // Greek + Cyrillic + IPA-extension blocks

/* ---- Hebrew letter -> Latin phonetic (final forms folded to base; digraphs ch/sh/tz emitted whole) ---- */
const _CF_HE2LAT = {
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y',
  'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'f',
  'ף': 'f', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't'
};

/* ---- Latin -> Hebrew consonant skeleton. Digraphs resolve first; a/e drop (silent), o/u->ו, i->י so the
 *      common transliteration of a Hebrew word lands on the same skeleton a Hebrew typist produces. ---- */
const _CF_EN2HEB_DI = { 'sh': 'ש', 'ch': 'ח', 'tz': 'צ', 'ts': 'צ', 'th': 'ת', 'ph': 'פ', 'kh': 'כ' };
const _CF_EN2HEB = {
  'a': '', 'e': '', 'h': '', 'o': 'ו', 'u': 'ו', 'i': 'י', 'y': 'י',
  'b': 'ב', 'v': 'ו', 'w': 'ו', 'g': 'ג', 'j': 'ג', 'd': 'ד', 'z': 'ז', 't': 'ת',
  'k': 'כ', 'c': 'כ', 'q': 'כ', 'l': 'ל', 'm': 'מ', 'n': 'נ', 's': 'ס', 'f': 'פ', 'p': 'פ', 'r': 'ר', 'x': 'כס'
};
/* final forms -> base, then homophone folds so a Hebrew typist and a Latin transliterator converge:
 *   weak maters א/ה drop (silent vowels), ט->ת and ק->כ (same sound, different glyph). */
const _CF_HE_FOLD = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ', 'ט': 'ת', 'ק': 'כ' };

function _cfCollapse(s) { return s.replace(/(.)\1+/g, '$1'); }   // fold padded runs: aaa->a

/* ---- the shared pre-clean: lowercase -> NFKD -> strip combining marks -> homoglyph fold -> leet. KEEPS
 *      separators (so a token view can still see word boundaries); deepNormalize() does the letters-only strip.
 *      The strip range is combining diacritics (U+0300-036F) + Hebrew niqqud/accents (U+0591-05C7) ONLY —
 *      it must NOT swallow whole Greek/Cyrillic letters, which the homoglyph step still needs to see. ---- */
function _cfPre(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  try { s = s.normalize('NFKD').replace(/[\u0300-\u036f\u0591-\u05c7]/g, ''); } catch (e) {}
  s = s.replace(_CF_HOMO_RE, function (c) { return _CF_HOMO[c] || c; });        // homoglyphs -> base letter
  s = s.replace(/[0-9@$!|(]/g, function (c) { return _CF_LEET[c] || ''; });     // leetspeak -> letter
  return s;
}

/* Projections (shared by the fused normalizer AND the per-token view). */
function _toLatin(s) { let o = ''; for (const ch of s) o += (_CF_HE2LAT[ch] !== undefined ? _CF_HE2LAT[ch] : ch); return _cfCollapse(o.replace(/[^a-z]/g, '')); }
function _toHeb(s) {
  const h = s.replace(/sh|ch|tz|ts|th|ph|kh/g, function (d) { return _CF_EN2HEB_DI[d]; })
             .replace(/[a-z]/g, function (c) { return _CF_EN2HEB[c] !== undefined ? _CF_EN2HEB[c] : ''; })
             .replace(/[ךםןףץטק]/g, function (c) { return _CF_HE_FOLD[c]; });
  return _cfCollapse(h.replace(/[אה]/g, '').replace(/[^ב-ת]/g, ''));
}

/* deepNormalize: the public hardened normalizer — homoglyph + leet folded, every punctuation/space/symbol
 * removed, leaving ONLY Latin a-z + Hebrew base letters fused into one comparison-ready string. */
function deepNormalize(text) { return _cfPre(text).replace(/[^a-zא-ת]/g, ''); }

/* normalizeCallsign: deepNormalize -> both Standardized Comparison Strings (.latin + .hebrew) + .base. */
function normalizeCallsign(text) { const s = deepNormalize(text); return { latin: _toLatin(s), hebrew: _toHeb(s), base: s }; }

/* token view: split the pre-cleaned text on real separators, projecting each surviving word on its own.
 * Soft bans match per-TOKEN (boundary-aware -> no Scunthorpe); hard bans match the fused form. */
function _cfTokens(text) {
  return _cfPre(text).split(/[^a-zא-ת]+/).filter(Boolean).map(function (p) {
    return { latin: _toLatin(p), hebrew: _toHeb(p), he: /[א-ת]/.test(p), lat: /[a-z]/.test(p) };
  });
}

/* ---- THE MULTI-TIERED BLOCKLIST ---- canonical, run-collapsed roots ONLY (the normalizer handles case,
 * leet, homoglyphs, spelling & affixes). Four sections:
 *   hard      - extreme terms, matched by RECURSIVE SUBSTRING on the fused form -> flagged even when buried in
 *               a larger word or split by noise ("B.A.D.W.O.R.D" -> "badword", "ihate.fuckers" -> hit).
 *   soft      - milder / Scunthorpe-prone terms, matched only as a whole TOKEN or a short suffixed form
 *               (token === root, or starts with root within +3 chars) so "Essex"/"Ashkenazi"/"torpedo"/
 *               "analytics"/"documentary" all pass while "S3X"/"sexy"/"nazis" are caught.
 *   phonetic  - the cross-script sub-registry: enInHe = English slurs typed in Hebrew letters (projected to
 *               .latin); heInEn = Hebrew profanity typed in Latin letters (projected to .hebrew skeleton).
 *   allow     - exact-match exceptions for famous false positives (the Scunthorpe problem): a whole callsign
 *               equal to one of these is admitted even if it contains a hard substring.
 * Roots are comma-strings (cheaper than a quoted JSON array) — the compressed storage that keeps us under
 * 28 KB; they are split + projected to canonical form once at load. Keep additions in CANONICAL form. */
const _CF_REGISTRY = {
  hard: {
    en: 'fuck,shit,bitch,cunt,niger,nigr,fagot,faget,retard,ashole,asshole,dick,pussy,whore,slut,wank,bastard,dildo,jizm,boner,rapist,kike,chink,trany,hitler,coon,molest,pedophil',
    he: 'כוס,זין,תחת,חרא,מניאק,שרמוטה,בנזונה,זונה,מזדין,קוקסינל,נאצי,מפגר'
  },
  soft: {
    en: 'sex,cum,anal,anus,pedo,spic,nazi,rape,homo',
    he: 'סקס'
  },
  phonetic: {
    enInHe: 'פאק,שיט,ביץ',                          // fuck / shit / bitch written in Hebrew letters
    heInEn: 'kus,zayin,benzona,sharmuta,manyak'      // Hebrew profanity written in Latin letters
  },
  allow: 'scunthorpe,clitheroe,penistone,lightwater,cockburn'
};

const CallsignFilter = (function () {
  const R = _CF_REGISTRY;
  const split = function (s) { return String(s || '').split(',').filter(Boolean); };
  const lat = function (w) { return _toLatin(deepNormalize(w)); };
  const heb = function (w) { return _toHeb(deepNormalize(w)); };
  const minLen = function (n) { return function (r) { return r.length >= n; }; };  // drop roots that collapse too short (e.g. 'kkk'->'k') — they'd over-block

  // HARD (substring): EN roots + English-in-Hebrew phonetics -> Latin; HE roots + Hebrew-in-Latin phonetics -> skeleton.
  const HARD_EN = split(R.hard.en).map(lat).concat(split(R.phonetic.enInHe).map(lat)).filter(minLen(3));
  const HARD_HE = split(R.hard.he).map(heb).concat(split(R.phonetic.heInEn).map(heb)).filter(minLen(2));
  // SOFT (whole-token / short suffix): EN against Latin tokens, HE against Hebrew tokens.
  const SOFT_EN = split(R.soft.en).map(lat).filter(minLen(3));
  const SOFT_HE = split(R.soft.he).map(heb).filter(minLen(2));
  const ALLOW = split(R.allow).map(lat);

  function _sub(form, list) { for (let i = 0; i < list.length; i++) if (list[i] && form.indexOf(list[i]) !== -1) return list[i]; return ''; }
  function _tok(tokens, list, key) {                       // fuzzy whole-token: root == token, or token starts with root within +3 chars
    for (let i = 0; i < tokens.length; i++) { const t = tokens[i][key];
      for (let j = 0; j < list.length; j++) { const r = list[j];
        if (r && (t === r || (t.indexOf(r) === 0 && t.length - r.length <= 3))) return r; } }
    return '';
  }
  return {
    normalize: normalizeCallsign,
    deep: deepNormalize,
    registry: R,
    /* full audit: { input, normalized:{latin,hebrew,base}, blocked, hit, lang, tier } */
    inspect: function (text) {
      const n = normalizeCallsign(text);
      if (n.latin && ALLOW.indexOf(n.latin) !== -1)         // famous Scunthorpe-problem exception, whole-string only
        return { input: String(text == null ? '' : text), normalized: n, blocked: false, hit: '', lang: '', tier: '' };
      const toks = _cfTokens(text);
      const enTok = toks.filter(function (t) { return t.lat; }), heTok = toks.filter(function (t) { return t.he; });
      let hit, lang = '', tier = '';
      hit = _sub(n.latin, HARD_EN); if (hit) { lang = 'en'; tier = 'hard'; }
      if (!hit) { hit = _sub(n.hebrew, HARD_HE); if (hit) { lang = 'he'; tier = 'hard'; } }
      if (!hit) { hit = _tok(enTok, SOFT_EN, 'latin'); if (hit) { lang = 'en'; tier = 'soft'; } }
      if (!hit) { hit = _tok(heTok, SOFT_HE, 'hebrew'); if (hit) { lang = 'he'; tier = 'soft'; } }
      return { input: String(text == null ? '' : text), normalized: n, blocked: !!hit, hit: hit || '', lang: lang, tier: tier };
    },
    blocked: function (text) { return this.inspect(text).blocked; },
    _stats: function () { return { enHard: HARD_EN.length, heHard: HARD_HE.length, enSoft: SOFT_EN.length, heSoft: SOFT_HE.length, allow: ALLOW.length }; }
  };
})();

/* ---- Filter Stress Test ---- window.debugCensor('בן זונה') logs normalization + verdict (incl. tier) and
 * returns the audit, so transliterated/obfuscated profanity can be proven caught with no Supabase round-trip. */
function debugCensor(text) {
  const r = CallsignFilter.inspect(text);
  try { console.log('[CENSOR]', JSON.stringify(r)); } catch (e) {}
  return r;
}
try { if (typeof window !== 'undefined') { window.CallsignFilter = CallsignFilter; window.debugCensor = debugCensor; window.deepNormalize = deepNormalize; window.normalizeCallsign = normalizeCallsign; } } catch (e) {}
try { if (typeof globalThis !== 'undefined') { globalThis.CallsignFilter = CallsignFilter; globalThis.debugCensor = debugCensor; globalThis.deepNormalize = deepNormalize; globalThis.normalizeCallsign = normalizeCallsign; } } catch (e) {}
