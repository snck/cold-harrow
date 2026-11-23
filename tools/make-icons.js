#!/usr/bin/env node
/* Generates the app icons (PNG) with no dependencies: a peak at dawn.
 *   node tools/make-icons.js
 * Writes icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// colour at unit coordinates (0..1, y down). `pad` shrinks the scene for maskable icons.
function scene(x, y, pad) {
  const sx = (x - 0.5) / (1 - pad * 2) + 0.5, sy = (y - 0.5) / (1 - pad * 2) + 0.5;
  // sky: night blue to dawn orange at the horizon
  let c = mix(hex('#141b36'), hex('#e2875a'), clamp((y - 0.05) / 0.62, 0, 1) ** 1.6);
  // sun
  const d = Math.hypot(sx - 0.68, sy - 0.55);
  if (d < 0.2) c = mix(c, hex('#ffcf8a'), clamp((0.2 - d) / 0.12, 0, 1) * 0.55);
  if (d < 0.085) c = hex('#ffe0a8');
  // far ridge
  const far = 0.6 + 0.05 * Math.sin(sx * 11 + 1) + 0.03 * Math.sin(sx * 23);
  if (sy > far) c = hex('#5e4560');
  // the peak (the Crown), with a lit flank
  const peakX = 0.42, peakY = 0.28;
  const near = peakY + Math.abs(sx - peakX) * (sx < peakX ? 1.05 : 0.85);
  if (sy > near) c = sx > peakX && sy < near + 0.05 ? hex('#3a3434') : hex('#1c2326');
  // a summit flag
  if (Math.abs(sx - peakX) < 0.008 && sy > peakY - 0.11 && sy < peakY) c = hex('#e9e4da');
  if (sx > peakX && sx < peakX + 0.07 && sy > peakY - 0.11 && sy < peakY - 0.07) c = hex('#ff8a3d');
  return c;
}

function render(size, pad) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 3; // supersampling per axis
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const c = scene((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size, pad);
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = (y * size + x) * 4, n = ss * ss;
    px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n; px[o + 3] = 255;
  }
  return px;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
const jobs = [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.1], ['apple-touch-icon.png', 180, 0]];
for (const [name, size, pad] of jobs) {
  fs.writeFileSync(path.join(out, name), png(size, render(size, pad)));
  console.log('wrote icons/' + name);
}
