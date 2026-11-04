// spec/fallback-ai.md "Test cases".
import { describe, expect, it } from 'vitest';
import { advise, fallbackAi, interpret, isOnline, pickProduct, searchProducts } from '../src/fallback-ai';
import { allDemoRooms, office, lobby } from '../src/fixtures/demo-rooms';
import { interpret as interpretOffline } from '../src/interpreter';
import { createIntent, type IntentKind, type LightingIntent, type StudioRoom } from '../src/model';
import { asProject } from '../src/products';
import { family } from '../src/ranker';
import { seed } from '../src/suggestions';

const firstSeed = (room: StudioRoom, kind: IntentKind): LightingIntent => {
  const s = seed(room).find((i) => i.kind === kind);
  if (!s) throw new Error(`no ${kind} seed`);
  return s;
};
const adviceFor = (room: StudioRoom, kind: IntentKind) => {
  const seeds = seed(room);
  const i = seeds.findIndex((s) => s.kind === kind);
  return advise(room, seeds)[i]!;
};

describe('fallback AI', () => {
  it('fallback is offline', () => {
    expect(isOnline).toBe(false);
    expect(fallbackAi.isOnline).toBe(false);
  });

  for (const room of allDemoRooms()) {
    it(`advice for demo rooms is sensible: ${room.label}`, () => {
      const seeds = seed(room);
      const advice = advise(room, seeds);
      expect(advice).toHaveLength(seeds.length);
      advice.forEach((a, i) => {
        const s = seeds[i]!;
        expect(a.intentId).toBe(s.id);
        expect(a.label.length).toBeGreaterThanOrEqual(1);
        expect(a.label.length).toBeLessThanOrEqual(40);
        expect(a.reason).not.toBe('');
        if (s.kind === 'KeepDim') {
          expect(a.target.minimum).toBeNull();
          expect(a.target.average).toBeNull();
          expect(a.target.maximum).toBeGreaterThan(0);
        } else {
          expect(a.target.average).toBeGreaterThan(0);
          expect(a.target.average).toBeLessThanOrEqual(200);
          if (a.target.minimum !== null && a.target.maximum !== null)
            expect(a.target.minimum).toBeLessThanOrEqual(a.target.maximum);
        }
        if (s.kind === 'WallWash') expect(a.plane.kind).toBe('Vertical');
        else if (s.kind === 'CeilingGlow') expect(a.plane.kind).toBe('Ceiling');
        else if (s.kind !== 'Accent') expect(a.plane.kind).toBe('Horizontal');
      });
    });
  }

  it('office desk task', () => {
    const a = adviceFor(office(), 'Task');
    expect(Math.abs(a.plane.height - 2.5)).toBeLessThanOrEqual(1e-9);
    expect(a.target).toEqual({ minimum: 20, average: 30, maximum: 50 });
    expect(a.label).toContain('Desk cluster');
  });

  it('office ambient', () => expect(adviceFor(office(), 'Ambient').target.average).toBe(20));
  it('office accent is 3× ambient', () => expect(adviceFor(office(), 'Accent').target.average).toBe(60));
  it('office keep dim', () => expect(adviceFor(office(), 'KeepDim').target.maximum).toBe(5));

  it('lobby ambient on the floor', () => {
    const a = adviceFor(lobby(), 'Ambient');
    expect(Math.abs(a.plane.height)).toBeLessThanOrEqual(1e-9);
    expect(a.target).toEqual({ minimum: 5, average: 10, maximum: 20 });
  });

  it('pick product uses ranker with project', () => {
    const room = office();
    const choice = pickProduct(room, firstSeed(room, 'WallWash'), asProject());
    expect(choice.product.productId).not.toBeNull();
    expect(family(choice.product)).toBe('wallwash');
  });

  it('search stand-ins for the kind', () => {
    const r = searchProducts('', 'WallWash', 1500);
    expect(r.length).toBeGreaterThan(0);
    expect(family(r[0]!)).toBe('wallwash');
    for (const p of r) expect(p.isGeneric).toBe(true);
  });

  it('search narrowed by word', () => {
    const r = searchProducts('pendant', 'FeaturePendant', null);
    expect(r.length).toBeGreaterThan(0);
    for (const p of r) expect(family(p).startsWith('pendant')).toBe(true);
  });

  it('search with no match', () => {
    expect(searchProducts('zzzz', 'Task')).toHaveLength(0);
  });

  it('search caps at 8 and sorts by fit', () => {
    const r = searchProducts(null, 'Task');
    expect(r.length).toBeLessThanOrEqual(8);
  });

  it('interpret delegates', () => {
    const room = office();
    const strip = (xs: LightingIntent[]) => xs.map(({ id: _id, ...rest }) => rest);
    for (const t of ['wash the north wall', 'task light on the desks', 'keep the screen dim', 'hello'])
      expect(strip(interpret(room, t))).toEqual(strip(interpretOffline(room, t)));
  });

  it('ambient source order (derived)', () => {
    const room = office();
    const intents = [
      createIntent({ kind: 'Ambient', isSuggestion: true, target: { minimum: 5, average: 10, maximum: 20 } }),
      createIntent({ kind: 'Ambient', isSuggestion: false, target: { minimum: 15, average: 25, maximum: 40 } }),
      createIntent({ kind: 'Accent' }),
    ];
    const a = advise(room, intents)[2]!;
    expect(a.target).toEqual({ minimum: null, average: 75, maximum: null });
    expect(a.reason).toBe('3× the surrounding ambient (25 fc)');
  });

  it('ambient falls back to suggestions, then the room default', () => {
    const room = office();
    const sugg = createIntent({ kind: 'Ambient', isSuggestion: true, target: { minimum: 5, average: 10, maximum: 20 } });
    expect(advise(room, [sugg, createIntent({ kind: 'Accent' })])[1]!.target.average).toBe(30);
    expect(advise(room, [createIntent({ kind: 'Accent' })])[0]!.target.average).toBe(60);
  });
});
