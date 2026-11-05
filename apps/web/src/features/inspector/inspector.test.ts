import { describe, expect, it } from 'vitest';
import {
  createFixture,
  createProduct,
  genericFor,
  office,
  packagesOf,
  productKey,
  productOf,
  rank,
  seed,
  solveAll,
  type LightingIntent,
  type RoomDesign,
} from '@intent-studio/core';
import { findOption, isDesignerChoice, productOptions } from './productOptions';
import { quantityShortfall } from './hints';

function solvedOffice(): RoomDesign {
  const room = office();
  const d: RoomDesign = { room, intents: seed(room).map((i) => ({ ...i, isSuggestion: false })), removedExisting: [], calculation: null, revision: 0 };
  solveAll(d);
  return d;
}

describe('product switcher options', () => {
  const d = solvedOffice();
  const ambient = d.intents.find((i) => i.kind === 'Ambient')!;

  it('groups the ranker pick and alternatives as Project products / Generic, best first with its reason', () => {
    const o = productOptions(d.room, ambient);
    const r = rank(d.room, ambient);
    expect(o.groups.map((g) => g.label)).toEqual(['Project products', 'Generic']);
    const all = o.groups.flatMap((g) => g.options);
    const best = all.find((x) => x.best)!;
    expect(best.key).toBe(productKey(r.product));
    expect(best.reason).toBe(r.reason);
    for (const p of r.alternatives) expect(all.some((x) => x.key === productKey(p))).toBe(true);
    expect(o.groups[0]!.options.every((x) => !x.product.isGeneric)).toBe(true);
    expect(o.groups[1]!.options.every((x) => x.product.isGeneric)).toBe(true);
    // every generic package of the kind's family is offered, ascending by lumens
    const fam = packagesOf(genericFor('Ambient', d.room)).map(productKey);
    const generic = o.groups[1]!.options.map((x) => x.key);
    expect(generic.filter((k) => fam.includes(k))).toEqual(fam);
    expect(new Set(all.map((x) => x.key)).size).toBe(all.length);
    for (const x of all) expect(x.reason).toMatch(/^(In your project|Generic stand-in) · /);
  });

  it('automatic: no designer choice; resolves to what the solver uses', () => {
    const o = productOptions(d.room, ambient);
    expect(o.chosenKey).toBeNull();
    expect(productKey(o.automatic)).toBe(productKey(productOf(d.room, ambient)));
    expect(isDesignerChoice(ambient)).toBe(false);
  });

  it('a designer choice is the selected key and findOption returns it', () => {
    const pkg = packagesOf(genericFor('Ambient', d.room))[0]!;
    const chosen: LightingIntent = { ...ambient, product: { product: pkg, agentPicked: false, reason: '', alternatives: [] } };
    const o = productOptions(d.room, chosen);
    expect(isDesignerChoice(chosen)).toBe(true);
    expect(o.chosenKey).toBe(productKey(pkg));
    expect(findOption(o, o.chosenKey!)!.product).toEqual(pkg);
    // an agent / solver pick counts as automatic
    expect(productOptions(d.room, { ...chosen, product: { ...chosen.product!, agentPicked: true } }).chosenKey).toBeNull();
  });
});

describe('quantity shortfall hint', () => {
  const base = solvedOffice().intents.find((i) => i.kind === 'Task')!;
  const withQ = (q: number | null, n: number, trace: string[] = []): LightingIntent => ({
    ...base,
    behavior: { ...base.behavior, quantity: q },
    fixtures: Array.from({ length: n }, () => createFixture()),
    trace,
  });
  it('only when a fixed quantity places fewer fixtures; names keep-dim zones when the trace does', () => {
    expect(quantityShortfall(withQ(null, 2))).toBeUndefined();
    expect(quantityShortfall(withQ(4, 4))).toBeUndefined();
    expect(quantityShortfall(withQ(6, 4, ['Desk: kept 2 out of keep-dim zones.']))).toBe('6 requested · 4 placed (keep-dim zones)');
    expect(quantityShortfall(withQ(6, 5))).toBe('6 requested · 5 placed');
  });
});

describe('product switcher: uploaded project products', () => {
  const d = solvedOffice();
  const accent = d.intents.find((i) => i.kind === 'Accent')!;
  const uploaded = createProduct({
    productId: '22222222-3333-4444-8555-666666666666',
    label: 'Lambertian test panel · 3,140 lm',
    family: 'downlight-ho',
    lumens: 3140,
    beamAngle: 120,
  });
  it('are always offered under Project products, even when the ranker does not list them', () => {
    const r = rank(d.room, accent, [uploaded]);
    const o = productOptions(d.room, accent, [uploaded]);
    const project = o.groups.find((g) => g.label === 'Project products')!;
    expect(project.options.map((x) => x.key)).toContain(productKey(uploaded));
    expect(project.options.find((x) => x.key === productKey(uploaded))!.reason).toMatch(/^In your project · |Accent/);
    // the ranker's own pick is unchanged by the extra listing
    expect(o.groups.flatMap((g) => g.options).find((x) => x.best)!.key).toBe(productKey(r.product));
  });
  it('without project products only the generic group is offered', () => {
    const o = productOptions(d.room, accent, []);
    expect(o.groups.map((g) => g.label)).toEqual(['Generic']);
  });
});
