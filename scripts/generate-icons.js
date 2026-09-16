// Generates Taskora PWA icons as PNG files using zlib (no external deps).
// Run: node scripts/generate-icons.js
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Draws the Taskora "T" mark: dark rounded square + white T.
 * Returns RGBA buffer.
 */
function drawIcon(size, { maskable = false } = {}) {
  const data = Buffer.alloc(size * size * 4);

  // Colors: near-black tile, white glyph
  const bg = [23, 23, 23, 255];
  const fg = [255, 255, 255, 255];

  // Rounded-rect radius (16% of size), full-bleed when maskable
  const radius = maskable ? 0 : Math.round(size * 0.16);
  const inset = maskable ? Math.round(size * 0.1) : 0; // safe zone for maskable

  const x0 = inset;
  const y0 = inset;
  const x1 = size - 1 - inset;
  const y1 = size - 1 - inset;

  function insideRoundedRect(x, y) {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    if (radius === 0) return true;
    const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
    const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  }

  // T glyph geometry (relative to the tile)
  const tileW = x1 - x0 + 1;
  const tileH = y1 - y0 + 1;
  // Bar: horizontal, centered; Stem: vertical
  const barH = Math.round(tileH * 0.135);
  const barW = Math.round(tileW * 0.56);
  const stemW = Math.round(tileW * 0.135);
  const stemH = Math.round(tileH * 0.46);
  const barX = x0 + Math.round((tileW - barW) / 2);
  const barY = y0 + Math.round(tileH * 0.22);
  const stemX = x0 + Math.round((tileW - stemW) / 2);
  const stemY = barY + barH;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!insideRoundedRect(x, y)) {
        // transparent
        data[i + 3] = 0;
        continue;
      }
      const inBar =
        x >= barX && x < barX + barW && y >= barY && y < barY + barH;
      const inStem =
        x >= stemX && x < stemX + stemW && y >= stemY && y < stemY + stemH;
      const px = inBar || inStem ? fg : bg;
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = px[3];
    }
  }
  return data;
}

function encodePNG(size, rgba, maskable) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines with filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-192.png", size: 192, maskable: true },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

for (const t of targets) {
  const rgba = drawIcon(t.size, { maskable: t.maskable });
  const png = encodePNG(t.size, rgba, t.maskable);
  writeFileSync(join(outDir, t.file), png);
  console.log(`Wrote ${t.file} (${t.size}x${t.size})`);
}
console.log("Done.");
