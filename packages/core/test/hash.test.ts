import { describe, expect, it } from 'vitest';
import { md5Hex, stableId, utf8Bytes } from '../src/index';

describe('hash: md5 (RFC 1321 vectors)', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
    ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
  ])('md5(%j)', (text, hex) => expect(md5Hex(text)).toBe(hex));
  it('utf8', () => {
    expect(Array.from(utf8Bytes('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8Bytes('′'))).toEqual([0xe2, 0x80, 0xb2]);
    expect(Array.from(utf8Bytes('😀'))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });
});

describe('hash: stableId (products.md §6 vectors)', () => {
  it.each([
    ['downlight', '8713baa4-22dc-51c2-6e01-fb595b1d00b5'],
    ['existing-lobby-0', '8a105443-3344-103a-4577-087e27d5e99c'],
    ['volumetric', '4d8c8455-d245-9b55-2540-05adbe812031'],
    ['troffer', '0ad75c6a-2bcc-d685-0f64-43a11538fc65'],
    ['downlight-ho', 'c1d547cc-c447-318e-5009-d4ea1ff9529f'],
    ['wallwash', '4259a34b-56c2-8dda-5677-3b98c452fff4'],
    ['accent', '77e4a964-9948-6848-2d81-6576f8121617'],
    ['pendant-linear', 'c72e82af-e699-c62e-07d5-1997453b42f7'],
    ['pendant-can', '6f202738-d59d-7cf4-1820-3dc9c8515a5b'],
    ['cove', '11e94b02-bda1-3c05-2e63-158248bb3ca8'],
    ['strip', '1d32d533-2612-b703-c987-85b950d558e3'],
    ['step', 'd254d04c-300e-62e2-3a0f-4dcb0fba3b5a'],
    ['volumetric:1500', 'cea7810f-fe18-3df7-716c-2fedfe4c6154'],
    ['downlight:2500', 'bda914ed-d90a-07fa-6fa5-2da69b018baa'],
  ])('stableId(%s)', (text, id) => expect(stableId(text)).toBe(id));
});
