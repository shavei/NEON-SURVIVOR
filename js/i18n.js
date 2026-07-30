'use strict';
/* ================= I18N — EN⇄HE LANGUAGE LAYER =================
   tr('English text') → Hebrew when I18N.lang==='he'. Dictionary lives in js/lang-he.js;
   the exact English display strings ARE the keys — a missing entry (or EN mode) falls back
   to the English string, so untranslated text degrades gracefully and EN is identity.
   Static DOM: mark elements with data-i18n (textContent), data-i18n-html (innerHTML) or
   data-i18n-ph (placeholder); I18N.apply() captures the English original once (data-en*)
   then re-translates on every language switch and notifies onChange subscribers. */
const I18N={
  /* An explicit choice (the 🌐 toggle persists one) always wins. With none stored we follow the DEVICE
     language, so a Hebrew phone opens in Hebrew instead of booting English behind a corner chip the
     player can't read. 'iw' is Hebrew's legacy ISO code — still reported by some Android builds. */
  lang:(function(){
    try{const s=localStorage.getItem('neon_lang');if(s==='he'||s==='en')return s;}catch(e){}
    try{if(typeof navigator==='undefined')return 'en';
      return [].concat(navigator.languages||[],navigator.language||[])
        .some(l=>/^(he|iw)\b/i.test(String(l)))?'he':'en';}catch(e){return 'en'}})(),
  ov:(function(){try{return JSON.parse(localStorage.getItem('neon_he_ov'))||{}}catch(e){return {}}})(),   // live per-string tweaks (debugLang) — win over LANG_HE
  _subs:[],
  onChange(f){I18N._subs.push(f);},
  t(s){return (I18N.lang==='he'&&(I18N.ov[s]||(typeof LANG_HE!=='undefined'&&LANG_HE[s])))||s;},
  setLang(l){ I18N.lang=l==='he'?'he':'en'; try{localStorage.setItem('neon_lang',I18N.lang)}catch(e){} I18N.apply(); },
  toggle(){I18N.setLang(I18N.lang==='he'?'en':'he');},
  apply(){
    const he=I18N.lang==='he',d=document;
    if(d.documentElement)d.documentElement.lang=I18N.lang;
    d.querySelectorAll('[data-i18n]').forEach(el=>{ if(!el.dataset)return;
      if(el.dataset.en===undefined)el.dataset.en=(el.textContent||'').trim();
      el.textContent=he?I18N.t(el.dataset.en):el.dataset.en; });
    d.querySelectorAll('[data-i18n-html]').forEach(el=>{ if(!el.dataset)return;
      if(el.dataset.enH===undefined)el.dataset.enH=(el.innerHTML||'').trim();
      el.innerHTML=he?I18N.t(el.dataset.enH):el.dataset.enH; });
    d.querySelectorAll('[data-i18n-ph]').forEach(el=>{ if(!el.dataset)return;
      if(el.dataset.enPh===undefined)el.dataset.enPh=el.placeholder||'';
      el.placeholder=he?I18N.t(el.dataset.enPh):el.dataset.enPh; });
    d.querySelectorAll('.langbtn').forEach(b=>{b.textContent=he?'🌐 English':'🌐 עברית';});
    I18N._subs.forEach(f=>{try{f(I18N.lang)}catch(e){}});
  }
};
const tr=s=>I18N.t(s);
/* debugLang() → list live overrides · debugLang('English key','עברית') → try a translation in place (persists
   in this browser via localStorage) · debugLang('English key',null) → drop it. Permanent edits go in lang-he.js. */
if(typeof window!=='undefined')window.debugLang=function(en,he){
  if(en===undefined)return I18N.ov;
  if(he==null)delete I18N.ov[en];else I18N.ov[en]=String(he);
  try{localStorage.setItem('neon_he_ov',JSON.stringify(I18N.ov))}catch(e){}
  I18N.apply();return I18N.ov;};
document.querySelectorAll('.langbtn').forEach(b=>b.addEventListener('click',()=>I18N.toggle()));
