'use strict';
/* ================= I18N — EN⇄HE LANGUAGE LAYER =================
   tr('English text') → Hebrew when I18N.lang==='he'. Dictionary lives in js/lang-he.js;
   the exact English display strings ARE the keys — a missing entry (or EN mode) falls back
   to the English string, so untranslated text degrades gracefully and EN is identity.
   Static DOM: mark elements with data-i18n (textContent), data-i18n-html (innerHTML) or
   data-i18n-ph (placeholder); I18N.apply() captures the English original once (data-en*)
   then re-translates on every language switch and notifies onChange subscribers. */
const I18N={
  lang:(function(){try{return localStorage.getItem('neon_lang')==='he'?'he':'en'}catch(e){return 'en'}})(),
  _subs:[],
  onChange(f){I18N._subs.push(f);},
  t(s){return (I18N.lang==='he'&&typeof LANG_HE!=='undefined'&&LANG_HE[s])||s;},
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
document.querySelectorAll('.langbtn').forEach(b=>b.addEventListener('click',()=>I18N.toggle()));
