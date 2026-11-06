import { describe, expect, it } from 'vitest';
import { createProduct, office, productOf, seed, solveAll, type RoomDesign } from '@intent-studio/core';
import { cctSuggestion, fixtureTypes, typeOfIntent, typeTag } from './fixtureTypes';

function solvedOffice(): RoomDesign {
  const room = office();
  const d: RoomDesign = {
    room,
    intents: seed(room).map((i) => ({ ...i, isSuggestion: false })),
    removedExisting: [],
    calculation: null,
    revision: 0,
  };
  solveAll(d);
  return d;
}

describe('typeTag', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
  ])('%i → %s', (n, tag) => expect(typeTag(n)).toBe(tag));
});

describe('fixtureTypes', () => {
  it('tags types in design order, counts fixtures and watts, skips suggestions and keep-dim', () => {
    const d = solvedOffice();
    const types = fixtureTypes(d);
    expect(types.map((t) => t.tag)).toEqual(types.map((_, k) => typeTag(k)));
    const placed = d.intents.filter((i) => !i.isSuggestion && i.kind !== 'KeepDim');
    expect(types.reduce((n, t) => n + t.count, 0)).toBe(placed.reduce((n, i) => n + i.fixtures.length, 0));
    for (const t of types) expect(t.watts).toBeCloseTo(t.count * t.product.watts);
    const first = placed[0]!;
    expect(typeOfIntent(types, first.id)?.tag).toBe('A');
    expect(types.flatMap((t) => t.zones).some((z) => d.intents.find((i) => i.id === z.id)?.kind === 'KeepDim')).toBe(
      false,
    );
  });

  it('is deterministic', () => {
    const d = solvedOffice();
    expect(fixtureTypes(d)).toEqual(fixtureTypes(d));
  });

  it('same product and CCT share a type; a different CCT splits it', () => {
    const d = solvedOffice();
    const [a, b] = d.intents.filter((i) => !i.isSuggestion && i.kind !== 'KeepDim');
    const p = createProduct({
      productId: '00000000-0000-4000-8000-000000000001',
      label: 'Shared',
      lumens: 1000,
      watts: 10,
    });
    a!.product = { product: p, agentPicked: false, reason: '', alternatives: [] };
    b!.product = { product: p, agentPicked: false, reason: '', alternatives: [] };
    a!.behavior = { ...a!.behavior, cct: 3000 };
    b!.behavior = { ...b!.behavior, cct: 3000 };
    expect(productOf(d.room, a!).label).toBe('Shared');
    const shared = fixtureTypes(d);
    expect(typeOfIntent(shared, a!.id)?.key).toBe(typeOfIntent(shared, b!.id)?.key);
    b!.behavior = { ...b!.behavior, cct: 4000 };
    const types = fixtureTypes(d);
    expect(typeOfIntent(types, a!.id)?.key).not.toBe(typeOfIntent(types, b!.id)?.key);
  });

  it('suggests the zone CCT only when it differs from the type CCT', () => {
    const d = solvedOffice();
    const i = d.intents.find((x) => !x.isSuggestion && x.kind !== 'KeepDim')!;
    i.behavior = { ...i.behavior, cct: undefined };
    expect(cctSuggestion(d, i)).toBeNull();
    i.behavior = { ...i.behavior, cct: 5000 };
    const s = cctSuggestion(d, i);
    expect(s === null || s !== 5000).toBe(true);
  });
});
