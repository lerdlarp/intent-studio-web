// Investigation: fixed quantity 6 on the Office ambient. Spec'd behaviour (solver-layouts.md §2.1 step 12 + §7 Settle):
// Thin-before-Settle only happens when the layout yields MORE points than n. grid/staggered over-produce points, so the
// keep-zone points are filtered first and the count lands on 6. rows/perimeter/path emit exactly n points; Settle then drops
// the ones inside the keep-dim zone (x >= 26.85, y 10..24) and the count falls short. The trace says so
// ("kept N out of keep-dim zones").
import { describe, expect, it } from 'vitest';
import { office, seed, solveAll, type RoomDesign } from '../src';

function ambientWithQuantity(q: number, pattern: 'grid' | 'rows' | 'perimeter' | null) {
  const room = office();
  const d: RoomDesign = { room, intents: seed(room), removedExisting: [], calculation: null, revision: 0 };
  for (const i of d.intents) i.isSuggestion = false;
  solveAll(d);
  const a = d.intents.find((i) => i.kind === 'Ambient')!;
  a.behavior = { ...a.behavior, quantity: q, pattern };
  solveAll(d);
  return a;
}

describe('fixed quantity on the Office ambient', () => {
  it('default (grid) pattern: exactly 6 (surplus grid points are thinned away from the keep zone first)', () => {
    const a = ambientWithQuantity(6, null);
    expect(a.fixtures).toHaveLength(6);
    expect(a.trace.join('\n')).toContain('quantity fixed at 6');
  });

  it('rows pattern: 6 points are laid, 2 fall in the keep-dim zone and Settle drops them (spec rule), and the trace says so', () => {
    const a = ambientWithQuantity(6, 'rows');
    console.log(a.trace.join('\n'));
    expect(a.fixtures).toHaveLength(4);
    expect(a.trace.some((l) => l === 'Open office ambient: kept 2 out of keep-dim zones.')).toBe(true);
    expect(a.trace[0]).toContain('quantity fixed at 6, rows pattern → 4 ×');
    expect(a.trace.join('\n')).toContain('4 fixtures at full output, a count you set');
    for (const f of a.fixtures) expect(f.center.x < 26.85 || f.center.y < 10 || f.center.y > 24).toBe(true);
  });
});
