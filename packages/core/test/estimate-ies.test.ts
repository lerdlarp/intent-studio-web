// Estimate IES path (PLAN.md §3 "Full calculation"): bilinear candela lookup instead of cosⁿ when a product has `ies`.
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFixture, createIntent, createProduct, createRoom, type RoomDesign, type StudioProduct } from '../src/model';
import { rect } from '../src/geometry';
import { at, buildSources, estimate } from '../src/estimate';
import { parseIes, productFromIes } from '../src/ies';

const dir = fileURLToPath(new URL('fixtures/ies/', import.meta.url));
function iesProduct(name: string): StudioProduct {
  const r = parseIes(readFileSync(dir + name, 'utf8'));
  if (!r.ok) throw new Error(r.error);
  return productFromIes(r.data, name);
}
const room = createRoom({ floor: [rect({ x: 0, y: 0 }, { x: 20, y: 20 })], ceilingHeight: 10 });
function one(product: StudioProduct, fixture: Partial<Parameters<typeof createFixture>[0]> = {}): RoomDesign {
  const intent = createIntent({
    kind: 'Ambient',
    region: rect({ x: 0, y: 0 }, { x: 20, y: 20 }),
    product: { product, agentPicked: false, reason: '', alternatives: [] },
    fixtures: [createFixture({ center: { x: 10, y: 10 }, height: 10, output: 1, mount: 'ceiling', ...fixture })],
  });
  return { room, intents: [intent], removedExisting: [], calculation: null, revision: 0 };
}
const up = { x: 0, y: 0, z: 1 };

describe('estimate: IES path', () => {
  const lam = iesProduct('lambert-2002.ies');
  const { ies: _drop, ...plain } = lam;
  const cosn = createProduct(plain);

  it('only IES products get table sources; generic sources carry no ies frame', () => {
    expect(buildSources(one(lam)).sources[0]!.ies).toBeDefined();
    expect(buildSources(one(cosn)).sources[0]!.ies).toBeUndefined();
  });
  it('Lambertian file agrees with cos¹ (beam 120°) within 2 % across the floor', () => {
    expect(cosn.beamAngle).toBeCloseTo(120, 0);
    const a = one(lam);
    const b = one(cosn);
    for (const [x, y] of [[10, 10], [14, 10], [10, 3], [2, 2], [18, 15]] as const) {
      const p = { x, y, z: 0 };
      const ei = at(a, p, up);
      const ec = at(b, p, up);
      expect(Math.abs(ei / ec - 1)).toBeLessThan(0.02);
    }
    const ea = estimate(a, a.intents[0]!);
    const eb = estimate(b, b.intents[0]!);
    expect(Math.abs(ea.average / eb.average - 1)).toBeLessThan(0.02);
  });
  it('scales with the product lumens and the fixture output', () => {
    const p = { x: 12, y: 9, z: 0 };
    const base = at(one(lam), p, up);
    expect(at(one({ ...lam, lumens: lam.lumens * 2 }), p, up)).toBeCloseTo(base * 2, 9);
    expect(at(one(lam, { output: 0.5 }), p, up)).toBeCloseTo(base * 0.5, 9);
  });
  it('asymmetric file is orientation-sensitive (throws toward the heading)', () => {
    const ww = iesProduct('washer-2019.ies');
    expect(ww.asymmetric).toBe(true);
    const east = { x: 15, y: 10, z: 0 };
    const west = { x: 5, y: 10, z: 0 };
    const facingEast = one(ww, { orientation: 0 });
    const facingWest = one(ww, { orientation: 180 });
    expect(at(facingEast, east, up)).toBeGreaterThan(1.3 * at(facingEast, west, up));
    expect(at(facingWest, west, up)).toBeCloseTo(at(facingEast, east, up), 9);
    const north = one(ww, { orientation: 90 });
    expect(at(north, { x: 10, y: 15, z: 0 }, up)).toBeCloseTo(at(facingEast, east, up), 9);
  });
  it('tilt rotates the IES nadir toward the heading', () => {
    const dl = iesProduct('downlight-1995.ies');
    const straight = one(dl);
    const tilted = one(dl, { tilt: 30, orientation: 0 });
    const p = { x: 10 + 10 * Math.tan(Math.PI / 6), y: 10, z: 0 };
    expect(at(tilted, p, up)).toBeGreaterThan(at(straight, p, up));
  });
  it('uplight file lights a downward-facing ceiling and not the floor directly', () => {
    const cove = iesProduct('uplight-2002.ies');
    const d = one(cove, { height: 8 });
    const s = buildSources(d);
    expect(s.sources).toHaveLength(pieceCountOf(cove));
    const ceil = at(d, { x: 10, y: 10, z: 10 }, { x: 0, y: 0, z: -1 });
    const floor = at(d, { x: 10, y: 10, z: 0 }, up);
    expect(ceil).toBeGreaterThan(3 * floor);
  });
});

const pieceCountOf = (p: StudioProduct): number =>
  p.length >= 3 && p.length >= 3 * p.width ? Math.min(Math.max(Math.round(p.length / 2), 2), 4) : 1;
