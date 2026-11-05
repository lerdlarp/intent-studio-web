// Solver orchestration (spec/solver.md §4–§9): Solve/SolveAll, Place, Search, lumen packages, Rebalance, Relieve,
// FollowAmbient, keep-dim enforcement and the trace.
import { roundHalfEven } from '../format';
import { polygonDistance, contains } from '../geometry';
import {
  productKey,
  type IntentEstimate,
  type IntentKind,
  type LightingIntent,
  type ProductChoice,
  type RoomDesign,
  type StudioFixture,
  type StudioProduct,
} from '../model';
import { byFamily, packagesOf, productOf, rememberPackage } from '../products';
import {
  CEILING_FACTOR,
  F1,
  FLOOR_FACTOR,
  KEEP_DIM_DEFAULT_MAX,
  KEEP_DIM_REACH,
  Lm,
  MAX_KEEP_DIM_MOVES,
  MAX_PACKAGE_ALTERNATIVES,
  SOLVE_ORDER,
  addNote,
  avg,
  clamp,
  D0,
  D1,
  estimateEvery,
  estimateOf,
  excess,
  hasTarget,
  isHandTuned,
  leanWant,
  makeCtx,
  s,
  session,
  shortfall,
  signature,
  want,
  withSession,
  type Ctx,
} from './context';
import { anchor, layout, nearestAllowed, relocated, settle } from './layouts';

/** Result of placing one intent. */
export interface Fit {
  how: string;
  notes: string;
  minCount: number;
  factor: number;
  package: string | null;
  packageKey: string | null;
}

export interface SolveResult {
  estimate: IntentEstimate;
  trace: string[];
}

const fit = (how: string, notes: string, minCount: number, factor: number): Fit => ({
  how,
  notes,
  minCount,
  factor,
  package: null,
  packageKey: null,
});

const pinnedOf = (i: LightingIntent): StudioFixture[] => i.fixtures.filter((f) => f.pinned);

// §5 Search -----------------------------------------------------------------------------------------------------------

interface Candidate {
  placed: StudioFixture[];
  how: string;
  notes: string;
  factor: number;
  total: number;
  avg: number;
}

export function search(ctx: Ctx, pinned: StudioFixture[], startFactor: number): Fit {
  const { design, intent } = ctx;
  const customDensity = Math.abs(clamp(intent.behavior.density, 0.6, 1.6) - 1) > 1e-9;
  const fitted = hasTarget(intent) && intent.behavior.quantity === null;
  ctx.densityOverride = customDensity && fitted ? 1.0 : null;

  const build = (factor: number): Candidate => {
    const { fixtures: raw, how } = layout(ctx, factor, pinned.length);
    let { kept: placed, notes } = settle(ctx, raw, pinned);
    if (placed.length === 0 && pinned.length === 0 && raw.length > 0) {
      const a = anchor(ctx, raw, pinned, notes);
      placed = a.placed;
      notes = a.notes;
    }
    return { placed, how, notes, factor, total: pinned.length + placed.length, avg: 0 };
  };

  if (!fitted) {
    const only = build(1);
    intent.fixtures = [...pinned, ...only.placed];
    return fit(only.how, only.notes, 0, 1);
  }

  const w = want(intent);
  intent.fixtures = pinned.slice();
  const rest = avg(design, intent);
  const seen = new Map<string, Candidate>();
  const evalAt = (factor: number): [Candidate, boolean] => {
    const cand = build(factor);
    const sig = signature(cand.placed);
    const prior = seen.get(sig);
    if (prior) return [prior, false];
    intent.fixtures = [...pinned, ...cand.placed];
    cand.avg = avg(design, intent);
    seen.set(sig, cand);
    return [cand, true];
  };

  let f = clamp(startFactor, FLOOR_FACTOR, CEILING_FACTOR);
  for (let it = 0; it < 6; it++) {
    const [cand, fresh] = evalAt(f);
    if (!fresh && it > 0) break;
    const mine = cand.avg - rest;
    let next: number;
    if (w <= rest + 1e-6) next = 0.02;
    else if (mine < 1e-6) next = f * 2;
    else next = f * clamp((w - rest) / mine, 0.2, 5);
    next = clamp(next, FLOOR_FACTOR, CEILING_FACTOR);
    if (Math.abs(next / f - 1) < 0.015) break;
    f = next;
  }

  const score = (c: Candidate): number => Math.abs(c.avg - w) / Math.max(w, 1e-6) + 1e-4 * c.total;
  const best = (): Candidate => {
    let b: Candidate | null = null;
    let bs = Infinity;
    for (const c of seen.values()) {
      const sc = score(c);
      if (b === null || sc < bs || (sc === bs && c.total < b.total)) {
        b = c;
        bs = sc;
      }
    }
    return b!;
  };

  let minCount = 0;
  if (best().avg > w * 1.1) {
    const [floorCand] = evalAt(FLOOR_FACTOR);
    minCount = floorCand.total;
  }

  const b0 = best();
  const atFewest = minCount > 0 && b0.total <= minCount;
  const center = b0.factor;
  if (!atFewest && !(Math.abs(b0.avg - w) < 0.04 * w)) {
    for (const direction of [1, -1]) {
      const mul = Math.pow(1.05, direction);
      let g = center;
      let tried = 0;
      let step = 0;
      while (tried < 2 && step < 24) {
        g = clamp(g * mul, FLOOR_FACTOR, CEILING_FACTOR);
        if (evalAt(g)[1]) tried++;
        step++;
      }
    }
  }

  let chosen = best();
  if (customDensity) {
    ctx.densityOverride = null;
    chosen = build(chosen.factor);
  }
  intent.fixtures = [...pinned, ...chosen.placed];
  return fit(chosen.how, chosen.notes, minCount, chosen.factor);
}

// §6 Lumen packages ----------------------------------------------------------------------------------------------------

export function packagesFor(design: RoomDesign, intent: LightingIntent): readonly StudioProduct[] | null {
  if (intent.product !== null && !intent.product.agentPicked) return null;
  const pk = packagesOf(productOf(design.room, intent));
  return pk.length > 1 ? pk : null;
}

function use(intent: LightingIntent, pkg: StudioProduct, reason = '', alternatives: StudioProduct[] | null = null): void {
  if (intent.product === null) {
    rememberPackage(intent, pkg);
    return;
  }
  const old = intent.product;
  intent.product = {
    product: pkg,
    agentPicked: true,
    reason: reason !== '' ? reason : old.reason,
    alternatives: alternatives ?? old.alternatives,
  };
}

interface Tried {
  pkg: StudioProduct;
  fit: Fit;
  avg: number;
  fixtures: StudioFixture[];
  count: number;
  good: boolean;
  score: number;
}

function stepNote(intent: LightingIntent, from: Tried, to: Tried, w: number): string {
  const down = to.pkg.lumens < from.pkg.lumens;
  const max = intent.target.maximum;
  let why: string;
  if (!down) why = `${Lm(from.pkg)} falls short at ${F1(from.avg)} fc against ${F1(w)} fc`;
  else if (max !== null && from.avg > max * 1.02) {
    why =
      from.fit.minCount > 0 && from.count <= from.fit.minCount
        ? `${Lm(from.pkg)} overshoots ${F1(max)} fc at the fewest fixtures`
        : `${Lm(from.pkg)} overshoots ${F1(max)} fc`;
  } else why = `${Lm(from.pkg)} gives ${F1(from.avg)} fc against ${F1(w)} fc`;
  return `${intent.label}: Stepped ${down ? 'down' : 'up'} to ${Lm(to.pkg)}: ${why}.`;
}

function placePackaged(
  design: RoomDesign,
  intent: LightingIntent,
  pinned: StudioFixture[],
  startFactor: number,
  pk: readonly StudioProduct[],
  previous: Fit | null,
  fresh: boolean,
): Fit {
  const current = productOf(design.room, intent);
  const nominal = byFamily(current.family);
  let startIndex: number;
  if (fresh && nominal !== null) startIndex = pk.findIndex((p) => Math.abs(p.lumens - nominal.lumens) < 0.5);
  else {
    const key = productKey(current);
    startIndex = pk.findIndex((p) => productKey(p) === key);
  }
  if (startIndex < 0) startIndex = 0;
  const w = want(intent);
  const tried = new Map<number, Tried>();
  const evalAt = (index: number): Tried => {
    const memo = tried.get(index);
    if (memo) return memo;
    const pkg = pk[index]!;
    use(intent, pkg);
    const f = search(makeCtx(design, intent), pinned, index === startIndex ? startFactor : 1);
    const a = avg(design, intent);
    const fixtures = intent.fixtures.slice();
    const t = intent.target;
    const penalty = 10 * Math.min(excess(t, a), 1) + shortfall(t, a);
    const close = Math.abs(a - w) / Math.max(w, 1e-6);
    const r: Tried = {
      pkg,
      fit: f,
      avg: a,
      fixtures,
      count: fixtures.length,
      good: penalty === 0 && close <= 0.2,
      score: penalty + close + 1e-4 * fixtures.length,
    };
    tried.set(index, r);
    return r;
  };
  const first = evalAt(startIndex);
  let best = first;
  if (!first.good) {
    const step = first.avg > w ? -1 : 1;
    for (let i = startIndex + step; i >= 0 && i < pk.length; i += step) {
      const t = evalAt(i);
      if (t.score >= best.score - 1e-9 && !t.good) break;
      if (t.score < best.score) best = t;
      if (t.good) break;
    }
  }
  const bestKey = productKey(best.pkg);
  const alternatives: StudioProduct[] = pk.filter((p) => productKey(p) !== bestKey);
  if (intent.product !== null) {
    const pkKeys = new Set(pk.map(productKey));
    for (const a of intent.product.alternatives) {
      const k = productKey(a);
      if (k !== bestKey && !pkKeys.has(k)) alternatives.push(a);
    }
  }
  const source = best.pkg.isGeneric ? 'Generic stand-in' : 'In your project';
  use(
    intent,
    best.pkg,
    `${source} · the ${Lm(best.pkg)} package: the one whose fixture count lands closest to the target`,
    alternatives.slice(0, MAX_PACKAGE_ALTERNATIVES),
  );
  intent.fixtures = best.fixtures;
  let note: string | null;
  if (best !== first) note = stepNote(intent, first, best, w);
  else if (previous !== null && previous.packageKey === bestKey) note = previous.package;
  else note = null;
  return { ...best.fit, package: note, packageKey: bestKey };
}

// §4.3 Place -----------------------------------------------------------------------------------------------------------

export function place(
  design: RoomDesign,
  intent: LightingIntent,
  startFactor: number,
  previous: Fit | null,
  fresh: boolean,
): Fit | null {
  if (intent.isSuggestion || intent.kind === 'KeepDim') {
    intent.fixtures = [];
    return null;
  }
  const pinned = pinnedOf(intent);
  const pk = packagesFor(design, intent);
  if (pk !== null && hasTarget(intent)) return placePackaged(design, intent, pinned, startFactor, pk, previous, fresh);
  return search(makeCtx(design, intent), pinned, startFactor);
}

// §7 Balancing ---------------------------------------------------------------------------------------------------------

const byOrder = (active: readonly LightingIntent[]): LightingIntent[] =>
  SOLVE_ORDER.flatMap((k: IntentKind) => active.filter((i) => i.kind === k));

export function followAmbient(design: RoomDesign, accent: LightingIntent): void {
  const r = accent.targetReason;
  if (!(r.startsWith('3×') || r.includes('no surrounding ambient'))) return;
  const at = accent.region[0] ?? { x: 0, y: 0 };
  const ambients = design.intents.filter((i) => i.kind === 'Ambient' && !i.isSuggestion && i.fixtures.length > 0);
  const around = ambients.find((i) => i.region.length >= 3 && contains(i.region, at)) ?? ambients[0];
  if (!around) return;
  const a = avg(design, around);
  if (a <= 0.5) return;
  accent.target = { minimum: null, average: roundHalfEven(a * 3 * 10) / 10, maximum: null };
  accent.targetReason = `3× the surrounding ambient (${F1(a)} fc)`;
}

type Fits = Map<LightingIntent, Fit | null>;

function rebalance(design: RoomDesign, active: LightingIntent[], fits: Fits, frozen: Set<LightingIntent>): void {
  for (let round = 0; round < 3; round++) {
    for (const i of active) if (i.kind === 'Accent') followAmbient(design, i);
    let changed = false;
    for (const i of byOrder(active)) {
      if (i.kind === 'KeepDim' || isHandTuned(i) || frozen.has(i)) continue;
      const prev = fits.get(i);
      if (!prev) continue;
      if (i.fixtures.length > 0 && i.fixtures.every((f) => f.pinned)) continue;
      const before = signature(i.fixtures);
      fits.set(i, place(design, i, prev.factor, prev, false));
      if (signature(i.fixtures) !== before) changed = true;
    }
    if (!changed) break;
  }
}

function canLean(y: LightingIntent, fits: Fits): boolean {
  return (
    y.kind !== 'KeepDim' &&
    y.kind !== 'Accent' &&
    !y.isSuggestion &&
    !isHandTuned(y) &&
    y.fixtures.length > 0 &&
    !y.fixtures.every((f) => f.pinned) &&
    hasTarget(y) &&
    !!fits.get(y)
  );
}

function relieve(design: RoomDesign, active: LightingIntent[], fits: Fits): void {
  const ses = session();
  if (!ses) return;
  const refused = new Set<string>();
  const pairKey = (x: LightingIntent, y: LightingIntent): string =>
    `${active.indexOf(x)}:${active.indexOf(y)}`;
  for (let pass = 0; pass < 12; pass++) {
    const est = estimateEvery(design);
    const over = active
      .filter((i) => {
        const e = est.get(i.id);
        return i.target.maximum !== null && e !== undefined && e.average > i.target.maximum * 1.03;
      })
      .map((i) => ({ i, r: est.get(i.id)!.average / i.target.maximum! }))
      .sort((a, b) => b.r - a.r)
      .map((o) => o.i);
    let moved = false;
    for (const x of over) {
      const baseline = est.get(x.id)!.average;
      const max = x.target.maximum!;
      let best: LightingIntent | null = null;
      let bestDelta = 0;
      for (const y of active) {
        if (y === x || refused.has(pairKey(x, y)) || ses.lean.has(y) || !canLean(y, fits)) continue;
        const lw = leanWant(y);
        const ey = est.get(y.id);
        if (lw === null || !ey || ey.average <= lw * 1.08) continue;
        const saved = y.fixtures;
        y.fixtures = pinnedOf(y);
        const without = avg(design, x);
        y.fixtures = saved;
        if (baseline - without > bestDelta) {
          best = y;
          bestDelta = baseline - without;
        }
      }
      if (best === null) continue;
      const savedFixtures = best.fixtures;
      const savedChoice: ProductChoice | null = best.product;
      const savedProduct = productOf(design.room, best);
      const savedFit = fits.get(best)!;
      const lean = leanWant(best)!;
      ses.lean.set(best, lean);
      fits.set(best, place(design, best, savedFit.factor, savedFit, false));
      const after = avg(design, x);
      if (after <= max * 1.02 || baseline - after >= 0.25 * (baseline - max)) {
        addNote(
          best,
          `${best.label}: leans to the bottom of its range (${F1(lean)} fc) because its light puts ${x.label} over its ${F1(max)} fc maximum, and fixtures cannot be dimmed.`,
        );
        addNote(
          x,
          `${x.label}: ${best.label} gives up light here (${F1(baseline)} fc → ${F1(after)} fc) to keep it under ${F1(max)} fc.`,
        );
      } else {
        ses.lean.delete(best);
        best.fixtures = savedFixtures;
        if (savedChoice === null) rememberPackage(best, savedProduct);
        else best.product = savedChoice;
        fits.set(best, savedFit);
        refused.add(pairKey(x, best));
      }
      moved = true;
      break;
    }
    if (!moved) break;
  }
}

// §8 Keep-dim enforcement ------------------------------------------------------------------------------------------------

interface LogEntry {
  removed: number;
  moved: number;
}

/** Keep-dim log shared across EnforceKeepDim passes. */
export class KeepDimLog {
  keeps: LightingIntent[] = [];
  entries = new Map<LightingIntent, Map<LightingIntent, LogEntry>>();
  lastKept = new Map<LightingIntent, LightingIntent[]>();

  entry(keep: LightingIntent, intent: LightingIntent): LogEntry {
    let m = this.entries.get(keep);
    if (!m) this.entries.set(keep, (m = new Map()));
    let e = m.get(intent);
    if (!e) m.set(intent, (e = { removed: 0, moved: 0 }));
    return e;
  }

  moves(keep: LightingIntent): number {
    let n = 0;
    for (const e of this.entries.get(keep)?.values() ?? []) n += e.removed + e.moved;
    return n;
  }

  keptLast(keep: LightingIntent, intent: LightingIntent): void {
    let l = this.lastKept.get(keep);
    if (!l) this.lastKept.set(keep, (l = []));
    if (!l.includes(intent)) l.push(intent);
  }

  flush(design: RoomDesign): void {
    for (const i of design.intents) {
      i.trace = i.trace.filter(
        (l) => !(l.startsWith('Removed ') || l.startsWith('Moved ') || l.startsWith('Keep-dim: ')),
      );
    }
    const done = new Set<LightingIntent>();
    for (const keep of this.keeps) {
      if (done.has(keep)) continue;
      done.add(keep);
      if (keep.region.length < 3) continue;
      const max = keep.target.maximum ?? KEEP_DIM_DEFAULT_MAX;
      for (const [intent, e] of this.entries.get(keep) ?? []) {
        const lines: string[] = [];
        if (e.removed > 0)
          lines.push(
            `Removed ${e.removed} fixture${s(e.removed)} of ${intent.label} near ${keep.label}: it was over ${F1(max)} fc and fixtures cannot be dimmed.`,
          );
        if (e.moved > 0)
          lines.push(
            `Moved the last fixture of ${intent.label} away from ${keep.label}: it was over ${F1(max)} fc and fixtures cannot be dimmed.`,
          );
        for (const line of lines) {
          keep.trace.push(line);
          intent.trace.push(line);
        }
      }
      const a = avg(design, keep);
      if (a <= max) continue;
      const stayed = this.lastKept.get(keep) ?? [];
      const why =
        stayed.length > 0
          ? `The last fixture of ${stayed.map((i) => i.label).join(' and ')} stays, and fixtures cannot be dimmed.`
          : 'Fixtures cannot be dimmed, and no further unpinned fixture can move without emptying an intent.';
      const line = `Keep-dim: ${keep.label} still reads ${F1(a)} fc against its ${F1(max)} fc maximum, so the keep-dim zone is over its maximum. ${why}`;
      keep.trace.push(line);
      for (const i of stayed) i.trace.push(line);
    }
  }
}

export function enforceKeepDim(design: RoomDesign, log: KeepDimLog | null = null): Set<LightingIntent> {
  const own = log === null;
  const lg = log ?? new KeepDimLog();
  const touched = new Set<LightingIntent>();
  for (const keep of design.intents) {
    if (keep.kind !== 'KeepDim' || keep.isSuggestion) continue;
    lg.keeps.push(keep);
    if (keep.region.length < 3) continue;
    const max = keep.target.maximum ?? KEEP_DIM_DEFAULT_MAX;
    let a = avg(design, keep);
    const skipped = new Set<string>();
    let moves = lg.moves(keep);
    while (moves < MAX_KEEP_DIM_MOVES && a > max) {
      let victim: { intent: LightingIntent; f: StudioFixture } | null = null;
      let vd = Infinity;
      for (const i of design.intents) {
        if (i === keep || i.isSuggestion || i.kind === 'KeepDim' || isHandTuned(i) || i.behavior.quantity !== null)
          continue;
        for (const f of i.fixtures) {
          if (f.pinned || skipped.has(f.id)) continue;
          const d = polygonDistance(keep.region, [f.center]);
          if (d > KEEP_DIM_REACH) continue;
          if (d < vd) {
            vd = d;
            victim = { intent: i, f };
          }
        }
      }
      if (victim === null) break;
      const { intent, f } = victim;
      if (intent.fixtures.length > 1) {
        intent.fixtures = intent.fixtures.filter((x) => x.id !== f.id);
        lg.entry(keep, intent).removed += 1;
      } else {
        const ctx = makeCtx(design, intent);
        const inZone = ctx.keeps.some((k) => contains(k.zone, f.center));
        const spot = inZone ? nearestAllowed(ctx, f.center) : null;
        if (spot !== null) {
          intent.fixtures = intent.fixtures.map((x) => (x.id === f.id ? relocated(ctx, x, spot) : x));
          lg.entry(keep, intent).moved += 1;
        } else {
          skipped.add(f.id);
          lg.keptLast(keep, intent);
          continue;
        }
      }
      moves += 1;
      touched.add(intent);
      a = avg(design, keep);
    }
  }
  if (own) lg.flush(design);
  return touched;
}

// §9 Trace -------------------------------------------------------------------------------------------------------------

function lowerHint(product: StudioProduct): string {
  let lower: StudioProduct | null = null;
  for (const p of packagesOf(product)) if (p.lumens < product.lumens - 0.5) lower = p;
  return lower === null ? '; pick a lower-output product' : `; the ${Lm(lower)} package of this family would land closer`;
}

export function writeTrace(design: RoomDesign, intent: LightingIntent, f: Fit | null): void {
  const label = intent.label;
  const lines: string[] = [];
  if (intent.isSuggestion) {
    intent.trace = [`${label}: a suggestion; it places nothing until you accept it.`];
    return;
  }
  if (intent.kind === 'KeepDim' || f === null) {
    lines.push(
      `${label}: keeps other fixtures out of its margin and holds its plane under its maximum; it places none of its own.`,
    );
  } else {
    const product = productOf(design.room, intent);
    const P = product.label !== '' ? product.label : 'fixture';
    const count = intent.fixtures.length;
    if (intent.kind === 'Accent' && intent.targetReason.startsWith('3×') && intent.target.average !== null)
      lines.push(`${label}: target set to ${intent.targetReason}: ${D0(intent.target.average)} fc.`);
    lines.push(`${label}: ${f.how} → ${count} × ${P}.`);
    if (f.notes !== '') lines.push(`${label}: ${f.notes}.`);
    if (f.package) lines.push(f.package);
    if (hasTarget(intent) && count > 0) {
      const w = want(intent);
      const a = avg(design, intent);
      const density = clamp(intent.behavior.density, 0.6, 1.6);
      const q = intent.behavior.quantity;
      if (q !== null)
        lines.push(`${label}: ${count} fixture${s(count)} at full output, a count you set, estimate ${F1(a)} fc against ${F1(w)} fc.`);
      else if (Math.abs(density - 1) > 1e-9)
        lines.push(
          `${label}: density ${D1(density)} sets the spacing, so ${count} fixture${s(count)} at full output give ${F1(a)} fc against ${F1(w)} fc.`,
        );
      else
        lines.push(
          `${label}: ${count} fixture${s(count)} at full output (Designer cannot dim fixtures), chosen so the estimate lands on ${F1(w)} fc: ${F1(a)} fc.`,
        );
      if (a > w * 1.15 && f.minCount > 0 && count <= f.minCount) {
        const saved = intent.fixtures;
        intent.fixtures = pinnedOf(intent);
        const rest = avg(design, intent);
        intent.fixtures = saved;
        if (rest >= w * 0.95)
          lines.push(
            `${label}: the other intents already light this plane to ${F1(rest)} fc, so it keeps just ${count} fixture${s(count)}, the fewest that still cover it evenly.`,
          );
        else
          lines.push(
            `${label}: even ${count} fixture${s(count)} give${count === 1 ? 's' : ''} ${F1(a)} fc against ${F1(w)} fc` +
              (rest > w * 0.3 ? ` (${F1(rest)} fc of it from the other intents)` : '') +
              lowerHint(product) +
              '.',
          );
      } else if (a < w * 0.85 && count >= 300)
        lines.push(`${label}: 300 fixtures limits the count, so the estimate falls short of ${F1(w)} fc at ${F1(a)} fc.`);
      else if (a < w * 0.85 && q === null && Math.abs(density - 1) < 1e-9)
        lines.push(`${label}: the estimate falls short of ${F1(w)} fc at ${F1(a)} fc.`);
    }
    const p = intent.fixtures.filter((x) => x.pinned).length;
    if (p > 0) lines.push(`${label}: kept ${p} fixture${s(p)} you placed by hand.`);
    if (intent.product === null || intent.product.product.isGeneric)
      lines.push(`${label}: no product chosen yet, so this uses a generic ${P.toLowerCase()}.`);
  }
  for (const n of session()?.notes.get(intent) ?? []) lines.push(n);
  intent.trace = lines;
}

// §4 Entry points --------------------------------------------------------------------------------------------------------

/** Solve one intent (no SolveAll session unless called inside one). */
export function solve(design: RoomDesign, intent: LightingIntent): SolveResult {
  const f = place(design, intent, 1, null, false);
  writeTrace(design, intent, f);
  if (!intent.isSuggestion) enforceKeepDim(design);
  return { estimate: estimateOf(design, intent), trace: intent.trace };
}

/** Solve every accepted intent of the design (spec/solver.md §4.2). */
export function solveAll(design: RoomDesign): void {
  withSession(() => {
    const active = design.intents.filter((i) => !i.isSuggestion);
    for (const i of design.intents) {
      if (!i.isSuggestion) continue;
      i.fixtures = [];
      i.trace = [`${i.label}: a suggestion; it places nothing until you accept it.`];
    }
    const fits: Fits = new Map();
    for (const i of byOrder(active)) {
      if (isHandTuned(i)) continue;
      if (i.kind === 'Accent') followAmbient(design, i);
      fits.set(i, place(design, i, 1, null, true));
    }
    rebalance(design, active, fits, new Set());
    relieve(design, active, fits);
    const log = new KeepDimLog();
    const frozen = new Set<LightingIntent>();
    for (let k = 0; k < 3; k++) {
      const touched = enforceKeepDim(design, log);
      if (touched.size === 0) break;
      for (const t of touched) frozen.add(t);
      rebalance(design, active, fits, frozen);
    }
    enforceKeepDim(design, log);
    for (const i of active) {
      if (isHandTuned(i)) i.trace = [`${i.label}: hand-tuned by you, kept as is.`];
      else writeTrace(design, i, fits.get(i) ?? null);
    }
    log.flush(design);
  });
}
