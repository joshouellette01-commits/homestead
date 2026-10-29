// Generates placeholder app icons (a red barn on snow) into public/.
// Run with `npm run icons`. Replace with real art in a later phase.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

type RGB = [number, number, number];

const SKY: RGB = [168, 200, 224];
const SNOW: RGB = [240, 244, 248];
const BARN: RGB = [178, 48, 40];
const TRIM: RGB = [250, 250, 250];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size: number, pixel: (x: number, y: number) => RGB): Buffer {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let i = 0;
  for (let y = 0; y < size; y++) {
    raw[i++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      raw[i++] = r;
      raw[i++] = g;
      raw[i++] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Barn drawn in unit coordinates (0..1), so every size matches.
function barn(u: number, v: number): RGB {
  const ground = 0.72;
  const left = 0.26;
  const right = 0.74;
  const eaves = 0.46;
  const peak = 0.26;
  const inWalls = u >= left && u <= right && v >= eaves && v <= ground;
  const roofHalfWidth = ((v - peak) / (eaves - peak)) * ((right - left) / 2 + 0.04);
  const inRoof = v >= peak && v < eaves && Math.abs(u - 0.5) <= roofHalfWidth;
  const inDoor = Math.abs(u - 0.5) <= 0.08 && v >= 0.56 && v <= ground;
  if (inDoor) return TRIM;
  if (inWalls || inRoof) return BARN;
  return v > ground ? SNOW : SKY;
}

mkdirSync('public', { recursive: true });
for (const [name, size] of [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['apple-touch-icon.png', 180],
] as const) {
  writeFileSync(`public/${name}`, encodePng(size, (x, y) => barn(x / size, y / size)));
  console.log(`wrote public/${name}`);
}
