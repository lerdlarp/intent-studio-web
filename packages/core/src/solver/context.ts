// Shared solver state and definitions (spec/solver.md §1–§3): constants, number formats, Want/LeanWant, Excess,
// Shortfall, Signature, product flags, the per-intent context and the SolveAll session.
import { estimate, estimateAll } from '../estimate';
import {
  format0,
  format0_1,
  format0_2,
  formatFixed1,
  formatFixed2,
  formatGrouped,
} from '../format';
import { ceilingAt, centroid, inflate } from '../geometry';
import type { IntentEstimate, LightingIntent, P2, RoomDesign, StudioFixture, StudioProduct, TargetRange } from '../model';
import { productOf } from '../products';
import { fixtureFootprint, type FixtureFootprint } from './fixture-overlap';

// §1 Constants -------------------------------------------------------------------------------------------------------

export const MAX_FIXTURES = 300;
export const MAX_KEEP_DIM_MOVES = 3;
export const FLOOR_FACTOR = 0.02;
export const CEILING_FACTOR = 20;
export const MAX_PACKAGE_ALTERNATIVES = 8;
export const SOLVE_ORDER = [
  'KeepDim',
  'Task',
  'Path',
  'WallWash',
  'FeaturePendant',
  'CeilingGlow',
  'Ambient',
  'Accent',
] as const;
export const SEARCH_ITERATIONS = 6;
export const KEEP_DIM_REACH = 30;
export const KEEP_DIM_DEFAULT_MAX = 5;
export const PINNED_CLEARANCE = 1.5;
export const LLF = 0.85;

// §2 Number formats ---------------------------------------------------------------------------------------------------

/** `0.#` */
export const F1 = format0_1;
/** `0.##` */
export const F2 = format0_2;
/** `0` */
export const D0 = format0;
/** `0.0` */
export const D1 = formatFixed1;
/** `0.00` */
export const D2 = formatFixed2;
/** `#,0` */
export const G0 = formatGrouped;
/** `{G0(lumens)} lm` */
export const Lm = (p: StudioProduct): string => `${G0(p.lumens)} lm`;
/** Plural suffix. */
export const s = (n: number): string => (n === 1 ? '' : 's');

export const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

// Session ---------------------------------------------------------------------------------------------------------------

/** SolveAll session: per-intent lean wants, trace notes and intents with placement priority. */
export interface Session {
  lean: Map<LightingIntent, number>;
  notes: Map<LightingIntent, string[]>;
  taskZones: readonly LightingIntent[];
  wallWashes: readonly LightingIntent[];
}
let current: Session | null = null;
export const session = (): Session | null => current;
/** Run `fn` inside a fresh session, restoring the outer one afterwards. */
export function withSession<T>(priority: Pick<Session, 'taskZones' | 'wallWashes'>, fn: () => T): T {
  const outer = current;
  current = { lean: new Map(), notes: new Map(), ...priority };
  try {
    return fn();
  } finally {
    current = outer;
  }
}
export function addNote(intent: LightingIntent, line: string): void {
  if (!current) return;
  const list = current.notes.get(intent);
  if (list) list.push(line);
  else current.notes.set(intent, [line]);
}

// §3 Shared definitions -----------------------------------------------------------------------------------------------

export const hasTarget = (i: LightingIntent): boolean =>
  i.target.average !== null || (i.target.minimum !== null && i.target.maximum !== null);

export function want(i: LightingIntent): number {
  const lean = current?.lean.get(i);
  if (lean !== undefined) return lean;
  const t = i.target;
  if (t.average !== null) return t.average;
  if (t.minimum !== null && t.maximum !== null) return (t.minimum + t.maximum) / 2;
  return t.minimum ?? t.maximum ?? 20;
}

export function leanWant(i: LightingIntent): number | null {
  const t = i.target;
  const floor = t.minimum !== null ? t.minimum : t.average !== null ? 0.9 * t.average : null;
  return floor === null ? null : floor * 1.06;
}

export function excess(t: TargetRange, avg: number): number {
  return t.maximum !== null && avg > t.maximum * 1.02 ? (avg - t.maximum) / t.maximum : 0;
}

export function shortfall(t: TargetRange, avg: number): number {
  const floor = t.minimum !== null ? t.minimum : t.average !== null ? 0.9 * t.average : null;
  if (floor === null) return 0;
  return avg < floor * 0.98 ? (floor - avg) / floor : 0;
}

export const isHandTuned = (i: LightingIntent): boolean => i.handTuned;

export const isAutomaticAmbient = (i: LightingIntent): boolean =>
  i.kind === 'Ambient' && !isHandTuned(i) && i.behavior.quantity === null;

export const signature = (list: readonly StudioFixture[]): string =>
  `${list.length}:${list.map((f) => `${F2(f.center.x)},${F2(f.center.y)}`).join(';')}`;

const PENDANT_RE = /pendant|suspend|chain|stem/i;
const COVE_RE = /\bcove\b/i;
export const isPendant = (p: StudioProduct): boolean =>
  PENDANT_RE.test(`${p.family} ${p.label}`) || p.family === 'strip';
export const isCove = (p: StudioProduct): boolean => p.family === 'cove' || COVE_RE.test(p.label);
export const isLinear = (p: StudioProduct): boolean => p.length >= 3 && p.length >= 3 * p.width;

// Estimates (products.ts productOf is the resolver everywhere) -----------------------------------------------------------

export const estimateOf = (design: RoomDesign, i: LightingIntent): IntentEstimate => estimate(design, i, productOf);
export const avg = (design: RoomDesign, i: LightingIntent): number => estimateOf(design, i).average;
export const estimateEvery = (design: RoomDesign): Map<string, IntentEstimate> => estimateAll(design, productOf);

// Context ---------------------------------------------------------------------------------------------------------------

export interface KeepRef {
  intent: LightingIntent;
  margin: number;
  zone: P2[];
}

export interface Ctx {
  design: RoomDesign;
  intent: LightingIntent;
  product: StudioProduct;
  keeps: KeepRef[];
  taskRegions: readonly (readonly P2[])[];
  wallWashFootprints: readonly FixtureFootprint[];
  /** Fit-density override (1.0 during a fit with a custom density), else null. */
  densityOverride: number | null;
}

export const ctxDensity = (ctx: Ctx): number =>
  ctx.densityOverride ?? clamp(ctx.intent.behavior.density, 0.6, 1.6);

/** solver-layouts.md §8 KeepDimMargin, computed with the context product's beam. */
export function keepDimMargin(design: RoomDesign, product: StudioProduct, keep: LightingIntent): number {
  if (keep.behavior.keepDimMargin !== null) return Math.max(keep.behavior.keepDimMargin, 0);
  const c = keep.region.length > 0 ? centroid(keep.region) : { x: 0, y: 0 };
  const ceiling = ceilingAt(design.room, c);
  const beam = clamp(product.beamAngle, 10, 150);
  return Math.min(4, ceiling * Math.tan(((beam / 2) * Math.PI) / 180));
}

export function makeCtx(design: RoomDesign, intent: LightingIntent): Ctx {
  const product = productOf(design.room, intent);
  const keeps: KeepRef[] = [];
  for (const k of design.intents) {
    if (k === intent || k.kind !== 'KeepDim' || k.isSuggestion || k.region.length < 3) continue;
    const margin = keepDimMargin(design, product, k);
    keeps.push({ intent: k, margin, zone: inflate(k.region, margin) });
  }
  const priority = isAutomaticAmbient(intent) ? current : null;
  const taskRegions = priority?.taskZones.filter((task) => task.fixtures.length > 0).map((task) => task.region) ?? [];
  const wallWashFootprints =
    priority?.wallWashes.flatMap((wash) => {
      const washProduct = productOf(design.room, wash);
      return wash.fixtures.map((f) => fixtureFootprint(f, washProduct));
    }) ?? [];
  return { design, intent, product, keeps, taskRegions, wallWashFootprints, densityOverride: null };
}
