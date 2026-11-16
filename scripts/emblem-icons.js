// Builds ANNPURNN brand icons from the Annapurna-feeds-Shiva emblem.
// Usage: node scripts/emblem-icons.js [path-to-emblem.png]
// Pure Node (zlib only) — decodes an 8-bit RGB/RGBA non-interlaced PNG,
// area-averages it to the target sizes and re-encodes RGBA PNGs.
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SRC = process.argv[2] ||
  '/mnt/vibefs/uploads/ec225b4c-c5f2-4c68-b8a3-d33cf8d00ffb/H3CWCUj8-Annapurna Feeds Shiva Emblem.png';
const OUT = path.join(__dirname, '..', 'public', 'img');
const GREEN = [27, 94, 32]; // brand deep green #1b5e20

// ---------- PNG decoding ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('unsupported PNG (need 8-bit, non-interlaced)');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported color type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * channels);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    prev.set(cur);
  }
  // normalise to RGBA
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    rgba[i * 4] = px[j * 1 + 0];
    if (colorType === 2 || colorType === 6) {
      rgba[i * 4 + 1] = px[j + 1];
      rgba[i * 4 + 2] = px[j + 2];
      rgba[i * 4 + 3] = colorType === 6 ? px[j + 3] : 255;
    } else {
      rgba[i * 4 + 1] = rgba[i * 4 + 2] = rgba[i * 4];
      rgba[i * 4 + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

// ---------- scaling (area average) ----------
function resize(img, size) {
  const out = Buffer.alloc(size * size * 4);
  const sx = img.width / size, sy = img.height / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, data: out };
}

// ---------- PNG encoding (RGBA) ----------
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
function encodePng(img) {
  const size = img.width;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    img.data.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- compositing ----------
// Emblem centred on a solid brand-green square (for maskable icons).
function onGreen(img, size, scale) {
  const inner = resize(img, Math.round(size * scale));
  const out = Buffer.alloc(size * size * 4);
  const off = Math.floor((size - inner.width) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const iy = y - off, ix = x - off;
      if (iy >= 0 && iy < inner.width && ix >= 0 && ix < inner.width) {
        const i = (iy * inner.width + ix) * 4;
        const al = inner.data[i + 3] / 255;
        out[o] = Math.round(GREEN[0] * (1 - al) + inner.data[i] * al);
        out[o + 1] = Math.round(GREEN[1] * (1 - al) + inner.data[i + 1] * al);
        out[o + 2] = Math.round(GREEN[2] * (1 - al) + inner.data[i + 2] * al);
        out[o + 3] = 255;
      } else {
        out[o] = GREEN[0]; out[o + 1] = GREEN[1]; out[o + 2] = GREEN[2]; out[o + 3] = 255;
      }
    }
  }
  return { width: size, height: size, data: out };
}

// ---------- main ----------
const emblem = decodePng(fs.readFileSync(SRC));
console.log(`emblem decoded: ${emblem.width}x${emblem.height}`);
fs.mkdirSync(OUT, { recursive: true });

const write = (name, img) => {
  fs.writeFileSync(path.join(OUT, name), encodePng(img));
  console.log('wrote', name);
};

// Hero / in-app emblem (crisp, moderate weight)
write('emblem.png', resize(emblem, 512));
// PWA icons — full-bleed artwork
write('icon-512.png', resize(emblem, 512));
write('icon-192.png', resize(emblem, 192));
// Maskable variants — emblem centred on brand green with safe-zone padding
write('icon-maskable-512.png', onGreen(emblem, 512, 0.82));
write('icon-maskable-192.png', onGreen(emblem, 192, 0.82));
// Favicon
write('favicon-64.png', resize(emblem, 64));
console.log('done');
