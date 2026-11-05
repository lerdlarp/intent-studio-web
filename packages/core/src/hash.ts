// Pure-TS MD5 (RFC 1321) and the demo `stableId` (spec/products.md §6, spec/demo-rooms.md §2). No Node/DOM APIs.

/** UTF-8 encode a JS string (lone surrogates become U+FFFD, like TextEncoder). */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 digest (16 bytes) of `data`. */
export function md5(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  // Length in bits, little-endian 64-bit (high word supports inputs ≥ 512 MiB).
  const lo = bitLen >>> 0;
  const hi = Math.floor(bitLen / 2 ** 32) >>> 0;
  for (let i = 0; i < 4; i++) {
    padded[padded.length - 8 + i] = (lo >>> (8 * i)) & 0xff;
    padded[padded.length - 4 + i] = (hi >>> (8 * i)) & 0xff;
  }
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Array<number>(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4;
      m[j] =
        ((padded[p] ?? 0) |
          ((padded[p + 1] ?? 0) << 8) |
          ((padded[p + 2] ?? 0) << 16) |
          ((padded[p + 3] ?? 0) << 24)) >>>
        0;
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (f + a + (K[i] ?? 0) + (m[g] ?? 0)) >>> 0;
      const s = S[i] ?? 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((w, k) => {
    for (let i = 0; i < 4; i++) out[k * 4 + i] = (w >>> (8 * i)) & 0xff;
  });
  return out;
}

const hex2 = (b: number | undefined): string => (b ?? 0).toString(16).padStart(2, '0');

/** Lowercase hex MD5 of the UTF-8 bytes of `text`. */
export const md5Hex = (text: string): string => Array.from(md5(utf8Bytes(text)), (b) => hex2(b)).join('');

/** 16 bytes → GUID text the way .NET's byte-array constructor does (first three groups little-endian). */
export function guidFromBytesLE(b: Uint8Array): string {
  const h = (...idx: number[]): string => idx.map((i) => hex2(b[i])).join('');
  return `${h(3, 2, 1, 0)}-${h(5, 4)}-${h(7, 6)}-${h(8, 9)}-${h(10, 11, 12, 13, 14, 15)}`;
}

/** Deterministic demo id: GUID(bytes_le = MD5(UTF-8 "studio-demo:" + text)). */
export const stableId = (text: string): string => guidFromBytesLE(md5(utf8Bytes('studio-demo:' + text)));
