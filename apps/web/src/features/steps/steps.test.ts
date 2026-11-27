// The step panel's pure helpers: which steps are done, and the one-tap fixes for a zone that misses its target.
import { describe, expect, it } from 'vitest';
import { createFixture, createIntent, createProduct, office, seed, type IntentEstimate } from '@intent-studio/core';
import { stepsDone } from './progress';
import { zoneFixes } from './fixes';
import type { ProductOptions } from '../inspector/productOptions';

const product = (label: string, lumens: number) =>
  createProduct({
    family: 'downlight',
    label,
    lumens,
    watts: lumens / 100,
    length: 0.5,
    width: 0.5,
    isRound: true,
    beamAngle: 60,
  });
const est = (average: number, minimum: number): IntentEstimate =>
  ({ average, minimum, maximum: average * 1.5, fixtures: 4 }) as IntentEstimate;

function zone(fixtures: number) {
  const z = createIntent({ kind: 'Task', target: { minimum: null, average: 40, maximum: null } });
  z.fixtures = Array.from({ length: fixtures }, (_, k) =>
    createFixture({ intentId: z.id, center: { x: k, y: 0 }, height: 9 }),
  );
  return z;
}

const dim = product('Dim', 800);
const mid = product('Mid', 1500);
const bright = product('Bright', 3000);
const opts: ProductOptions = {
  groups: [
    {
      label: 'Generic',
      options: [dim, mid, bright].map((p) => ({ key: p.label, product: p, reason: '', best: false })),
    },
  ],
  chosenKey: null,
  automatic: mid,
  automaticReason: '',
};

describe('zoneFixes', () => {
  it('too dark: enough fixtures to reach the average, and the next brighter luminaire', () => {
    const fixes = zoneFixes(zone(8), est(32, 20), opts, { ...mid, label: 'Current' });
    expect(fixes).toEqual([
      { kind: 'quantity', label: 'Add 2 fixtures', quantity: 10 },
      { kind: 'product', label: 'Brighter type', product: bright },
    ]);
  });
  it('too bright: fewer fixtures and a dimmer luminaire', () => {
    const z = zone(8);
    z.target = { minimum: null, average: 20, maximum: 25 };
    const fixes = zoneFixes(z, est(40, 30), opts, mid);
    expect(fixes.map((f) => f.label)).toEqual(['Remove 4 fixtures', 'Dimmer type']);
  });
  it('on target or keep-dim: nothing to fix', () => {
    expect(zoneFixes(zone(8), est(40, 30), opts, mid)).toEqual([]);
    const k = zone(0);
    k.kind = 'KeepDim';
    expect(zoneFixes(k, est(40, 30), opts, mid)).toEqual([]);
  });
});

describe('stepsDone', () => {
  it('follows the design', () => {
    const room = office();
    const intents = seed(room);
    const d = { room, intents, removedExisting: [], calculation: null, revision: 0 };
    expect(stepsDone(null, false)).toMatchObject({ intent: false });
    expect(stepsDone(d, false)).toEqual({ intent: false, zones: false, luminaires: false, check: false });
    const accepted = intents.map((i) => ({ ...i, isSuggestion: false }));
    expect(stepsDone({ ...d, intents: accepted }, true)).toMatchObject({
      intent: true,
      zones: true,
      luminaires: false,
      check: true,
    });
  });
});
