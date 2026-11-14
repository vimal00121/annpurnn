// One-off generator for PWA icons (run: node scripts/generate-icons.js).
// Draws the ANNPURNN cloche mark: deep green disc, golden serving dome, ivory knob.
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const R = size * 0.48;          // green disc
  const domeR = size * 0.30;      // golden dome
  const baseY = cy + size * 0.10; // dome base line
  const plateH = size * 0.022;
  const knobR = size * 0.055;     // ivory knob
  const knobY = baseY - domeR - knobR * 1.1;
  const GREEN = [27, 94, 32], GREEN_D = [14, 61, 18], GOLD = [255, 213, 79], IVORY = [255, 253, 245];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      let c = [0, 0, 0, 0];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= R) {
        c = y < size * 0.35 ? GREEN_D : GREEN; // subtle top shade
        c = [...c, 255];
      }
      const domeD = Math.sqrt(dx * dx + (y - baseY) * (y - baseY));
      if (y <= baseY && domeD <= domeR) c = [...GOLD, 255];
      if (Math.abs(y - baseY) <= plateH && Math.abs(dx) <= domeR * 1.25) c = [...GOLD, 255];
      const knobD = Math.sqrt(dx * dx + (y - knobY) * (y - knobY));
      if (knobD <= knobR) c = [...IVORY, 255];
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
    }
  }
  return png(size, px);
}

const out = path.join(__dirname, '..', 'public', 'img');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), drawIcon(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), drawIcon(512));
console.log('icons written to', out);
