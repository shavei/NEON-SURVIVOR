// Rasterizes the brand SVGs (brand/*.svg) into the PNG assets the app + stores need.
// Uses the global Playwright chromium (same one the verify-ui-he harness uses).
//   node tools/gen-brand-pngs.cjs
// Outputs (versioned to bust the 30-day icons/ cache per vercel.json):
//   icons/icon-192.v2.png, icons/icon-512.v2.png, icons/icon-192-maskable.v2.png,
//   icons/icon-512-maskable.v2.png, og-image.png, store/feature-graphic.png
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');

function loadPW() {
  try { return require('playwright'); } catch (e) {}
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) {}
  return null;
}

const ROOT = path.join(__dirname, '..');
const jobs = [
  { svg: 'brand/logo.svg',          out: 'icons/icon-192.v2.png',          w: 192,  h: 192 },
  { svg: 'brand/logo.svg',          out: 'icons/icon-512.v2.png',          w: 512,  h: 512 },
  { svg: 'brand/logo-maskable.svg', out: 'icons/icon-192-maskable.v2.png', w: 192,  h: 192 },
  { svg: 'brand/logo-maskable.svg', out: 'icons/icon-512-maskable.v2.png', w: 512,  h: 512 },
  { svg: 'brand/og-image.svg',      out: 'og-image.png',                   w: 1200, h: 630 },
];

(async () => {
  const pw = loadPW();
  if (!pw) { console.error('FAIL — playwright not found (npm i -g playwright + browsers)'); process.exit(1); }
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const j of jobs) {
    const svg = fs.readFileSync(path.join(ROOT, j.svg), 'utf8');
    await page.setViewportSize({ width: j.w, height: j.h });
    const html = `<!doctype html><meta charset="utf-8">
      <style>*{margin:0;padding:0}html,body{width:${j.w}px;height:${j.h}px;overflow:hidden;background:transparent}
      svg{display:block;width:${j.w}px;height:${j.h}px}</style>${svg}`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    const el = await page.$('svg');
    const outPath = path.join(ROOT, j.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await el.screenshot({ path: outPath, omitBackground: true });
    console.log('wrote', j.out, `${j.w}x${j.h}`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
