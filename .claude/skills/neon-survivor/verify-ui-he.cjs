#!/usr/bin/env node
'use strict';
/* verify-ui-he.cjs — Hebrew UI snapshot test (real browser).
   Boots the game in Hebrew (localStorage neon_lang=he) in headless Chromium via Playwright,
   then walks the two text-heaviest surfaces — the main menu and the Level-Up modal — and asserts:
     · <html lang="he"> is stamped and the CSS-only RTL rule takes effect (direction:rtl on text blocks)
     · key strings render the LANG_HE dictionary (PLAY button, LEVEL UP header/sub)
     · layout survives: no horizontal page scroll, no clipped/overflowing buttons or upgrade cards
   Saves PNG snapshots (menu + level-up) to $UIHE_OUT or the OS tmpdir for eyeball review.
   Requires the playwright package (repo-local or global npm root) + a Playwright chromium
   (PLAYWRIGHT_BROWSERS_PATH honoured); exits 2 with a clear message when the browser stack is absent. */
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),{execSync}=require('child_process');
const ROOT=path.resolve(__dirname,'../../..');
const OUT=process.env.UIHE_OUT||os.tmpdir();
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp3':'audio/mpeg','.json':'application/json','.ico':'image/x-icon'};
function loadPlaywright(){
  try{return require('playwright');}catch(e){}
  try{return require(path.join(execSync('npm root -g').toString().trim(),'playwright'));}catch(e){}
  return null;
}
const fails=[];const ok=(cond,label)=>{console.log((cond?'  ✓ ':'  ✗ ')+label);if(!cond)fails.push(label);};
(async()=>{
  const pw=loadPlaywright();
  if(!pw){console.error('SKIP — playwright not installed (npm i -g playwright + browsers)');process.exit(2);}
  const srv=http.createServer((req,res)=>{
    const p=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'')||'index.html');
    const f=fs.existsSync(p)&&fs.statSync(p).isDirectory()?path.join(p,'index.html'):p;
    fs.readFile(f,(err,buf)=>{ if(err){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(buf);});
  });
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${srv.address().port}/`;
  const browser=await pw.chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1024,height:768}});
    /* hermetic boot: Hebrew + an existing local player (skips the first-run GRID ACCESS modal),
       navigator.onLine=false → AchSync.boot() takes the fast 400 ms offline fallback, and all
       non-local requests aborted so the Supabase SDK/CDN can never stall the run. */
    await page.addInitScript(()=>{try{localStorage.setItem('neon_lang','he');
      localStorage.setItem('neon_player',JSON.stringify({id:'ui-he-test',name:'UIHE'}));}catch(e){}
      try{Object.defineProperty(navigator,'onLine',{get:()=>false});}catch(e){}});
    await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
    page.on('pageerror',e=>fails.push('pageerror: '+e.message));
    await page.goto(url,{waitUntil:'load'});
    await page.waitForSelector('#startbtn',{state:'visible',timeout:15000});
    await page.waitForTimeout(400);   // let boot/auth probe settle + fonts paint

    console.log('MAIN MENU (he)');
    const menu=await page.evaluate(()=>{
      const heb=s=>/[֐-׿]/.test(s);
      const btns=[...document.querySelectorAll('#start .btn,#start .menubtn')].filter(b=>b.offsetParent);
      const rtlEl=document.querySelector('.diffhint,.tag');
      return{lang:document.documentElement.lang,
        play:(document.getElementById('startbtn').textContent||'').trim(),
        rtl:rtlEl?getComputedStyle(rtlEl).direction:'none',
        hebBtns:btns.filter(b=>heb(b.textContent)).length,
        clipped:btns.filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.textContent.trim().slice(0,30)),
        hscroll:document.documentElement.scrollWidth>window.innerWidth+1};
    });
    ok(menu.lang==='he','<html lang="he">');
    ok(menu.play==='▶ מתחברים לרשת',`PLAY button = "${menu.play}"`);
    ok(menu.rtl==='rtl','CSS RTL rule active (direction:rtl)');
    ok(menu.hebBtns>0,`${menu.hebBtns} Hebrew menu buttons rendered`);
    ok(menu.clipped.length===0,'no clipped menu buttons'+(menu.clipped.length?` → ${menu.clipped.join(' | ')}`:''));
    ok(!menu.hscroll,'no horizontal page scroll');
    const shot1=path.join(OUT,'he-menu.png');await page.screenshot({path:shot1});

    console.log('LEVEL-UP MODAL (he)');
    await page.click('#startbtn');
    await page.waitForSelector('#start',{state:'hidden',timeout:5000});
    await page.waitForTimeout(300);   // a few sim ticks so the run is live
    await page.evaluate(()=>openLevelUp());
    await page.waitForSelector('#levelup.show .upg',{timeout:5000});
    await page.waitForTimeout(600);   // let the card pop-in animation settle so the snapshot shows the final layout
    const lu=await page.evaluate(()=>{
      const heb=s=>/[֐-׿]/.test(s);
      const cards=[...document.querySelectorAll('#cards .upg')];
      return{head:(document.querySelector('#levelup .luhead').textContent||'').trim(),
        sub:(document.querySelector('#levelup .lusub').textContent||'').trim(),
        n:cards.length,
        hebTitles:cards.filter(c=>heb(c.querySelector('h3')?.textContent||'')).length,
        clipped:cards.filter(c=>c.scrollWidth>c.clientWidth+2).map(c=>c.querySelector('h3')?.textContent),
        subDir:getComputedStyle(document.querySelector('#levelup .lusub')).direction,
        headDir:getComputedStyle(document.querySelector('#levelup .luhead')).direction,
        hscroll:document.documentElement.scrollWidth>window.innerWidth+1};
    });
    ok(lu.head==='עלית רמה!',`header = "${lu.head}"`);
    ok(lu.sub==='בוחרים שדרוג אחד',`sub = "${lu.sub}"`);
    ok(lu.n===3,`${lu.n} upgrade cards offered`);
    ok(lu.hebTitles===lu.n,`${lu.hebTitles}/${lu.n} card titles in Hebrew`);
    ok(lu.subDir==='rtl','modal subtitle direction:rtl');
    ok(lu.headDir==='rtl','modal header direction:rtl (trailing ! sits on the correct side)');
    ok(lu.clipped.length===0,'no horizontally clipped cards'+(lu.clipped.length?` → ${lu.clipped.join(' | ')}`:''));
    ok(!lu.hscroll,'no horizontal page scroll');
    const shot2=path.join(OUT,'he-levelup.png');await page.screenshot({path:shot2});
    console.log(`snapshots: ${shot1}  ${shot2}`);
  }finally{await browser.close();srv.close();}
  if(fails.length){console.error(`UI-HE — FAIL (${fails.length}): ${fails.join(' · ')}`);process.exit(1);}
  console.log('UI-HE — PASS (menu + level-up render Hebrew, RTL applied, no clipping)');
})().catch(e=>{console.error('UI-HE — ERROR:',e.message);process.exit(1);});
