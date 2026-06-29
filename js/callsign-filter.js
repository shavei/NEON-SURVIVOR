/* NEON SURVIVOR — callsign-filter.js : the cross-language Callsign Censorship Engine. Classic global,
 * headless/offline-safe (no DOM / SB / storage touch at load), so verify*.cjs require it clean. Loads
 * AFTER achievement-sync.js and BEFORE auth-uplink.js — confirmUsername()/_checkCallsign() gate on it
 * before any cloud write, so a restricted callsign never reaches Supabase (no throwaway account needed).
 *
 * Bidirectional by design (English ↔ Hebrew). normalizeCallsign(text) folds the input into TWO
 * "Standardized Comparison Strings":
 *   .latin  — Hebrew letters → Latin phonetics + leet de-obfuscation (catches עברית-typed English slurs)
 *   .hebrew — Latin letters → a Hebrew consonant skeleton           (catches Latin-typed Hebrew profanity)
 * blocked() substring-tests each form against its own canonical, run-collapsed registry. Because the
 * input is normalized first, the registry stores ONE canonical root per term (no case/leet/spelling
 * variants) — ~a few hundred roots stay a few KB, far under the 28 KB silent-truncation line. */

/* ---- de-obfuscation: leet digits / lookalike symbols → the letter they stand in for ---- */
const _CF_LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l', '(': 'c' };

/* ---- Hebrew letter → Latin phonetic (final forms folded to base; digraphs ch/sh/tz emitted whole) ---- */
const _CF_HE2LAT = {
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y',
  'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'f',
  'ף': 'f', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't'
};

/* ---- Latin → Hebrew consonant skeleton. Digraphs resolve first; a/e drop (silent), o/u→ו, i→י so the
 *      common transliteration of a Hebrew word lands on the same skeleton a Hebrew typist produces. ---- */
const _CF_EN2HEB_DI = { 'sh': 'ש', 'ch': 'ח', 'tz': 'צ', 'ts': 'צ', 'th': 'ת', 'ph': 'פ', 'kh': 'כ' };
const _CF_EN2HEB = {
  'a': '', 'e': '', 'h': '', 'o': 'ו', 'u': 'ו', 'i': 'י', 'y': 'י',
  'b': 'ב', 'v': 'ו', 'w': 'ו', 'g': 'ג', 'j': 'ג', 'd': 'ד', 'z': 'ז', 't': 'ת',
  'k': 'כ', 'c': 'כ', 'q': 'כ', 'l': 'ל', 'm': 'מ', 'n': 'נ', 's': 'ס', 'f': 'פ', 'p': 'פ', 'r': 'ר', 'x': 'כס'
};
/* final forms → base, then homophone folds so a Hebrew typist and a Latin transliterator converge:
 *   weak maters א/ה drop (silent vowels), ט→ת and ק→כ (same sound, different glyph). */
const _CF_HE_FOLD = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ', 'ט': 'ת', 'ק': 'כ' };

function _cfCollapse(s) { return s.replace(/(.)\1+/g, '$1'); }   // fold padded runs: aaa→a, ششش→ش

/* The normalizer: one lowercase NFKD pass, then build both comparison strings from the same source. */
function normalizeCallsign(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  try { s = s.normalize('NFKD').replace(/[̀-֑ͯ-ׇ]/g, ''); } catch (e) {}  // strip diacritics + niqqud
  s = s.replace(/[0-9@$!|(]/g, function (c) { return _CF_LEET[c] || ''; });                     // de-obfuscate

  // LATIN form: Hebrew letters → phonetics, keep a-z, collapse runs
  let latin = '';
  for (const ch of s) latin += (_CF_HE2LAT[ch] !== undefined ? _CF_HE2LAT[ch] : ch);
  latin = _cfCollapse(latin.replace(/[^a-z]/g, ''));

  // HEBREW form: Latin (digraphs first) → consonant skeleton, fold finals+homophones, drop weak maters א/ה
  let heb = s.replace(/sh|ch|tz|ts|th|ph|kh/g, function (d) { return _CF_EN2HEB_DI[d]; })
             .replace(/[a-z]/g, function (c) { return _CF_EN2HEB[c] !== undefined ? _CF_EN2HEB[c] : ''; })
             .replace(/[ךםןףץטק]/g, function (c) { return _CF_HE_FOLD[c]; });
  heb = _cfCollapse(heb.replace(/[אה]/g, '').replace(/[^ב-ת]/g, ''));

  return { latin: latin, hebrew: heb };
}

/* ---- THE BLOCKLIST REGISTRY ---- canonical, run-collapsed roots ONLY (normalization handles the rest).
 * Stored as comma-delimited strings (cheaper than a quoted JSON array) and split once at load. Each list
 * is matched by substring against its own normalized form, so affixes (-er/-ing/ה-/-ים) fold in for free.
 * Keep additions in CANONICAL form: lowercase + run-collapsed Latin, or vowel-light Hebrew skeleton. */
const _CF_EN_RAW = 'fuck,shit,bitch,cunt,niger,nigr,fagot,faget,retard,ashole,asshole,dick,pussy,whore,slut,wank,bastard,dildo,jizm,cum,boner,nazi,rape,rapist,molest,pedo,kkk,hitler,coon,spic,kike,chink,trany';
const _CF_HE_RAW = 'כוס,זין,תחת,חרא,מניאק,שרמוטה,בנזונה,זונה,מזדין,קוקסינל,נאצי,מפגר,פאק,שיט,ביץ';

const CallsignFilter = (function () {
  const EN = _CF_EN_RAW.split(',').filter(Boolean);
  const HE = _CF_HE_RAW.split(',').map(function (w) { return normalizeCallsign(w).hebrew; }).filter(Boolean);
  function _hit(form, list) { for (let i = 0; i < list.length; i++) if (list[i] && form.indexOf(list[i]) !== -1) return list[i]; return ''; }
  return {
    normalize: normalizeCallsign,
    /* full audit: { input, normalized:{latin,hebrew}, blocked, hit, lang } */
    inspect: function (text) {
      const n = normalizeCallsign(text);
      const en = _hit(n.latin, EN), he = _hit(n.hebrew, HE);
      const hit = en || he;
      return { input: String(text == null ? '' : text), normalized: n, blocked: !!hit, hit: hit, lang: en ? 'en' : (he ? 'he' : '') };
    },
    blocked: function (text) { return this.inspect(text).blocked; },
    _stats: function () { return { en: EN.length, he: HE.length }; }
  };
})();

/* ---- Filter Stress Test ---- window.debugCensor('בן זונה') logs normalization + verdict and returns the
 * audit, so transliterated profanity can be proven caught with no Supabase round-trip. */
function debugCensor(text) {
  const r = CallsignFilter.inspect(text);
  try { console.log('[CENSOR]', JSON.stringify(r)); } catch (e) {}
  return r;
}
try { if (typeof window !== 'undefined') { window.CallsignFilter = CallsignFilter; window.debugCensor = debugCensor; } } catch (e) {}
try { if (typeof globalThis !== 'undefined') { globalThis.CallsignFilter = CallsignFilter; globalThis.debugCensor = debugCensor; } } catch (e) {}
