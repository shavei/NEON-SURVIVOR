// Generates branded Android launcher icons for the Capacitor project and drops them into
// android/app/src/main/res/mipmap-*. Run AFTER `npx cap add android`.
//   node tools/gen-android-icons.cjs android/app/src/main/res
// Zero dependencies (Node zlib). Mirrors the favicon: dark tile, pink ring, teal core.
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
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const ringR = size * 0.31, ringW = size * 0.07, coreR = size * 0.10;
  const bg = [0x0a, 0x0a, 0x12], pink = [0xff, 0x5f, 0xa2], teal = [0x54, 0xe6, 0xb5];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    let r = bg[0], g = bg[1], b = bg[2];
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (Math.abs(d - ringR) <= ringW / 2) { r = pink[0]; g = pink[1]; b = pink[2]; }
    if (d <= coreR) { r = teal[0]; g = teal[1]; b = teal[2]; }
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
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
