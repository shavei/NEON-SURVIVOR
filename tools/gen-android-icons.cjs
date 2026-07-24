// Generates branded Android launcher icons for the Capacitor project and drops them into
// android/app/src/main/res/mipmap-*. Run AFTER `npx cap add android`.
//   node tools/gen-android-icons.cjs android/app/src/main/res
// Zero dependencies (Node zlib). Mirrors the favicon: dark tile, neon targeting reticle
// (pink→violet ring with diagonal gaps + teal cardinal crosshair ticks) around a teal core diamond.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// Full-bleed (maskable-style) icon: the launcher applies its own mask/rounding.
const PI = Math.PI;
function angDiff(a, b) { let d = a - b; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return d; }
function lerp(c1, c2, t) { return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]; }
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const ringR = size * 0.293, ringW = size * 0.052;
  const coreR = size * 0.125, coreHi = size * 0.058;
  const tickIn = size * 0.205, tickOut = size * 0.262, tickHalf = size * 0.032;
  const gapHalf = 0.202; // rad — reticle gaps centred on the diagonals
  const diags = [PI / 4, 3 * PI / 4, -PI / 4, -3 * PI / 4];
  const bg = [0x0a, 0x0a, 0x12], pink = [0xff, 0x5f, 0xa2], violet = [0x9b, 0x6d, 0xff];
  const teal = [0x54, 0xe6, 0xb5], white = [0xea, 0xff, 0xf9];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy), m = Math.abs(dx) + Math.abs(dy);
    let col = bg;
    // reticle ring (pink→violet along the diagonal), broken by 4 diagonal gaps
    if (Math.abs(d - ringR) <= ringW / 2) {
      const ang = Math.atan2(dy, dx);
      const inGap = diags.some(a => Math.abs(angDiff(ang, a)) < gapHalf);
      if (!inGap) { const t = Math.max(0, Math.min(1, ((dx + dy) / (2 * ringR)) * 0.5 + 0.5)); col = lerp(pink, violet, t); }
    }
    // cardinal crosshair ticks (teal), drawn over the ring
    if ((Math.abs(dx) <= tickHalf && Math.abs(dy) >= tickIn && Math.abs(dy) <= tickOut) ||
        (Math.abs(dy) <= tickHalf && Math.abs(dx) >= tickIn && Math.abs(dx) <= tickOut)) col = teal;
    // energy-core diamond + highlight
    if (m <= coreR) col = teal;
    if (m <= coreHi) col = white;
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
  }
  return png(size, buf);
}

const resDir = process.argv[2];
if (!resDir) { console.error('usage: node tools/gen-android-icons.cjs <android res dir>'); process.exit(1); }
const densities = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
for (const [dir, size] of Object.entries(densities)) {
  const out = path.join(resDir, dir);
  fs.mkdirSync(out, { recursive: true });
  const data = draw(size);
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    fs.writeFileSync(path.join(out, name), data);
  }
  console.log('wrote', dir, size + 'px');
}
// Remove the default adaptive-icon XML so our PNG launcher icons are used on API 26+.
const anydpi = path.join(resDir, 'mipmap-anydpi-v26');
if (fs.existsSync(anydpi)) { fs.rmSync(anydpi, { recursive: true, force: true }); console.log('removed mipmap-anydpi-v26'); }
