// Golden parity for the solver (spec/solver.md, spec/solver-layouts.md): every golden room's seeds, accepted, SolveAll →
// golden `solved` (product family + lumens, fixture count, mounts, coordinates, trace text, estimates) and `power`.
import { describe, expect, it } from 'vitest';
import type { RoomDesign } from '../../src/model';
import { estimate, power } from '../../src/estimate';
import { productOf } from '../../src/products';
import { solveAll } from '../../src/solver';
import { GOLDEN_ROOMS, goldenIntent, goldenRoom, loadGolden, type GoldenRoomName } from './load';

declare const performance: { now(): number };

const ABS = 1e-6;
const REL = 1e-6;

/** Golden seeds mapped into a design, every seed accepted. */
export function acceptedSeedDesign(name: GoldenRoomName): RoomDesign {
  const g = loadGolden(name);
  return {
    room: goldenRoom(name),
    intents: g.seeds.map((s) => ({ ...goldenIntent(s), isSuggestion: false })),
    removedExisting: [],
    calculation: null,
    revision: 0,
  };
}

const near = (a: number, e: number, abs = ABS): boolean => Math.abs(a - e) <= abs;
const nearRel = (a: number, e: number): boolean => a === e || Math.abs(a - e) <= REL * Math.max(Math.abs(e), 1e-300);

/** Every mismatch between the solved design and golden `solved`, as readable lines. */
export function solvedMismatches(name: GoldenRoomName, design: RoomDesign): string[] {
  const g = loadGolden(name);
  const out: string[] = [];
  g.solved.forEach((s, idx) => {
    const e = s.intent;
    const a = design.intents[idx]!;
    const tag = `${name}[${idx}] ${e.label}`;
    if (a.label !== e.label) out.push(`${tag}: label ${a.label}`);
    if (JSON.stringify(a.target) !== JSON.stringify(e.target))
      out.push(`${tag}: target ${JSON.stringify(a.target)} != ${JSON.stringify(e.target)}`);
    if (a.targetReason !== e.targetReason) out.push(`${tag}: reason "${a.targetReason}" != "${e.targetReason}"`);
    const p = productOf(design.room, a);
    if (e.product && (p.family !== e.product.family || p.lumens !== e.product.lumens || p.label !== e.product.label))
      out.push(`${tag}: product ${p.family} ${p.lumens} != ${e.product.family} ${e.product.lumens}`);
    if (a.product !== null) out.push(`${tag}: intent.product should stay null`);
    const ef = e.fixtures ?? [];
    if (a.fixtures.length !== ef.length) out.push(`${tag}: fixture count ${a.fixtures.length} != ${ef.length}`);
    else {
      ef.forEach((x, k) => {
        const y = a.fixtures[k]!;
        const ft = `${tag} fixture ${k}`;
        if (y.mount !== x.mount) out.push(`${ft}: mount ${y.mount} != ${x.mount}`);
        if (!near(y.center.x, x.center.x) || !near(y.center.y, x.center.y))
          out.push(`${ft}: centre (${y.center.x}, ${y.center.y}) != (${x.center.x}, ${x.center.y})`);
        if (!near(y.height, x.height)) out.push(`${ft}: height ${y.height} != ${x.height}`);
        if (!near(y.orientation, x.orientation)) out.push(`${ft}: orientation ${y.orientation} != ${x.orientation}`);
        if (!near(y.tilt, x.tilt)) out.push(`${ft}: tilt ${y.tilt} != ${x.tilt}`);
        if (y.output !== x.output || y.pinned !== x.pinned) out.push(`${ft}: output/pinned`);
      });
    }
    const et = e.trace ?? [];
    const n = Math.max(et.length, a.trace.length);
    for (let k = 0; k < n; k++) {
      if (a.trace[k] !== et[k]) out.push(`${tag} trace ${k}:\n    actual   ${a.trace[k]}\n    expected ${et[k]}`);
    }
    const est = estimate(design, a, productOf);
    for (const key of ['average', 'minimum', 'maximum', 'watts'] as const) {
      if (!nearRel(est[key], s.estimate[key])) out.push(`${tag}: estimate.${key} ${est[key]} != ${s.estimate[key]}`);
    }
    if (est.fixtures !== s.estimate.fixtures) out.push(`${tag}: estimate.fixtures ${est.fixtures}`);
  });
  const pw = power(design, productOf);
  if (!nearRel(pw.watts, g.power.watts)) out.push(`${name}: power watts ${pw.watts} != ${g.power.watts}`);
  if (!nearRel(pw.lpd, g.power.lpdWPerFt2)) out.push(`${name}: LPD ${pw.lpd} != ${g.power.lpdWPerFt2}`);
  return out;
}

const snapshot = (d: RoomDesign) =>
  d.intents.map((i) => ({
    key: productOf(d.room, i).label,
    trace: i.trace,
    target: i.target,
    fixtures: i.fixtures.map((f) => [f.center.x, f.center.y, f.height, f.orientation, f.tilt, f.mount, f.output]),
  }));

describe('golden: solver parity', () => {
  for (const name of GOLDEN_ROOMS) {
    it(`${name}: solveAll(accepted seeds) equals golden solved`, () => {
      const design = acceptedSeedDesign(name);
      expect(design.intents).toHaveLength(loadGolden(name).solved.length);
      solveAll(design);
      const mism = solvedMismatches(name, design);
      expect(mism, mism.join('\n')).toEqual([]);
    });
    it(`${name}: deterministic (two fresh solves identical)`, () => {
      const a = acceptedSeedDesign(name);
      const b = acceptedSeedDesign(name);
      solveAll(a);
      solveAll(b);
      expect(snapshot(a)).toEqual(snapshot(b));
    });
  }

  it('timing: the largest room solves in < 150 ms', () => {
    let worst = 0;
    let worstRoom = '';
    for (const name of GOLDEN_ROOMS) {
      solveAll(acceptedSeedDesign(name)); // warm-up
      const runs: number[] = [];
      for (let k = 0; k < 3; k++) {
        const d = acceptedSeedDesign(name);
        const t0 = performance.now();
        solveAll(d);
        runs.push(performance.now() - t0);
      }
      const best = Math.min(...runs);
      if (best > worst) {
        worst = best;
        worstRoom = name;
      }
    }
    console.log(`solveAll slowest room: ${worstRoom} ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(150);
  });
});
