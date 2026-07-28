/**
 * Deterministic image fixtures for the demo seeder.
 *
 * The demo needs posters, covers, and avatars that are visibly different from one another
 * — a 1x1 fixture proves the upload pipeline works but shows nothing on a hero or a card.
 * Rather than commit binary art or download anything, the bytes are generated here: a real
 * truecolour PNG (signature + IHDR + IDAT + IEND, zlib-deflated scanlines), built from a
 * pure function of the caller's hue. Same hue in, same bytes out, so the content-addressed
 * media service dedups a rerun instead of accumulating assets.
 */
import { deflateSync } from 'node:zlib';

type Rgb = readonly [number, number, number];

const CRC_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes an 8-bit truecolour PNG from a pixel function over normalised coordinates. */
function encodePng(width: number, height: number, pixel: (u: number, v: number) => Rgb): string {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // filter type 0 (none) — the generated gradients deflate well without one
    p += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x / (width - 1), y / (height - 1));
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      p += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]).toString('base64');
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

/** Minimal HSL -> RGB (saturation and lightness in 0..1, hue in degrees). */
function hsl(hue: number, saturation: number, lightness: number): Rgb {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const m = lightness - c / 2;
  return [clamp((r + m) * 255), clamp((g + m) * 255), clamp((b + m) * 255)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
}

/** Deep base tone shared by every fixture, so the set reads as one family. */
const BASE: Rgb = [11, 18, 32];

/**
 * A 16:9 poster: diagonal gradient into the key hue, with two soft chevron bands so cards,
 * heroes, and thumbnails all show structure rather than a flat fill.
 */
export function posterPng(hue: number, width = 640, height = 360): string {
  const near = hsl(hue, 0.62, 0.46);
  const far = hsl(hue + 40, 0.55, 0.24);
  return encodePng(width, height, (u, v) => {
    const diagonal = (u * 0.75 + (1 - v) * 0.25);
    let colour = mix(mix(BASE, far, 0.85), near, diagonal);
    // Two chevrons: a band wherever the skewed coordinate lands near a stripe centre.
    const band = Math.abs(((u * 1.6 + v) % 0.62) - 0.31);
    if (band < 0.055) colour = mix(colour, hsl(hue - 25, 0.85, 0.68), 0.34 * (1 - band / 0.055));
    // Vignette keeps overlaid title text legible on the hero.
    const edge = Math.min(u, 1 - u, v, 1 - v);
    return edge < 0.12 ? mix(colour, BASE, (0.12 - edge) * 2.2) : colour;
  });
}

/** A square avatar: two-tone diagonal split with a centred disc, distinct per hue. */
export function avatarPng(hue: number, size = 256): string {
  const light = hsl(hue, 0.58, 0.52);
  const dark = hsl(hue + 30, 0.5, 0.28);
  return encodePng(size, size, (u, v) => {
    const base = mix(mix(BASE, dark, 0.9), light, u * 0.55 + v * 0.45);
    const radius = Math.hypot(u - 0.5, v - 0.5);
    return radius < 0.28 ? mix(base, hsl(hue - 20, 0.8, 0.72), 0.42 * (1 - radius / 0.28)) : base;
  });
}

/** Stable hue for a fixture key, so the same slug always gets the same artwork. */
export function hueFor(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}
