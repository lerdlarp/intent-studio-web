// Quick estimate (spec/estimate.md): point sources with I(θ) = I0·cosⁿθ, a distance-weighted indirect term and a light
// loss factor. Every number it produces is an estimate. Evaluation order follows the spec exactly (golden parity is
// ~1e-16), so do not reorder sums or products.
//
// Product data comes in through a `ProductResolver` (products.md §7 `productOf`); this module depends only on the
// StudioProduct model type. The default resolver uses the intent's own product choice and treats an intent without one
// as dark — callers should pass `productOf` from products.ts.
import { contains, bounds, centroid, area, heading } from './geometry';
import { roundHalfEven } from './format';
import type { IntentEstimate, LightingIntent, P2, P3, RoomDesign, StudioProduct, StudioRoom } from './model';
import { zoneShape, type ZoneShape } from './zones';

export const LIGHT_LOSS_FACTOR = 0.85;
export const MAX_SAMPLES = 400;
export const BEAM_MIN = 8;
export const BEAM_MAX = 170;
export const CUTOFF_FRACTION = 0.002;
export const CUTOFF_COS_CAP = 0.95;
export const MIN_D2 = 0.01;
export const ASYMMETRIC_TILT = 35;
export const TILT_THRESHOLD = 0.01;
export const UPLIGHT_SOURCE_THRESHOLD = 0.04;

/** products.md §7 `productOf(room, intent)`; null means the intent emits nothing and draws no power. */
export type ProductResolver = (room: StudioRoom, intent: LightingIntent) => StudioProduct | null;

/** Default resolver: the intent's product choice, if any. Pass products.ts `productOf` for the reference behaviour. */
export const choiceProductOf: ProductResolver = (_room, intent) => intent.product?.product ?? null;

// §1 ---------------------------------------------------------------------------------------------------------------

/** cosⁿ exponent that halves at half the (clamped) beam angle. */
export function exponent(beam: number): number {
  const h = ((Math.min(Math.max(beam, BEAM_MIN), BEAM_MAX) / 2) * Math.PI) / 180;
  return Math.log(0.5) / Math.log(Math.cos(h));
}

// §2 ---------------------------------------------------------------------------------------------------------------

export interface LightSource {
  x: number;
  y: number;
  z: number;
  ax: number;
  ay: number;
  az: number;
  i0: number;
  n: number;
  cosCut: number;
  /** Integer fast path (1..6) or 0 for the general `pow`. */
  power: number;
}

export interface IndirectEntry {
  x: number;
  y: number;
  flux: number;
}

/** The shared source set of a design (build once, evaluate many points). */
export interface SourceSet {
  sources: LightSource[];
  indirect: IndirectEntry[];
  /** floorArea(room). */
  area: number;
  reach: number;
}

export function makeSource(
  flux: number,
  n: number,
  pos: { x: number; y: number; z: number },
  axis: { x: number; y: number; z: number },
): LightSource {
  const r = Math.round(n);
  const power = Math.abs(n - r) < 0.02 && n >= 0.98 && n <= 6.02 ? r : 0;
  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    ax: axis.x,
    ay: axis.y,
    az: axis.z,
    i0: (flux * (n + 1)) / (2 * Math.PI),
    n,
    cosCut: Math.min(Math.exp(Math.log(CUTOFF_FRACTION) / Math.max(n, 0.1)), CUTOFF_COS_CAP),
    power,
  };
}

/** Linear pieces of a product: clamp(roundHalfEven(L/2), 2, 4) for a linear product, else 1. */
export function pieceCount(p: StudioProduct): number {
  const linear = p.length >= 3 && p.length >= 3 * p.width;
  return linear ? Math.min(Math.max(roundHalfEven(p.length / 2), 2), 4) : 1;
}

/** Non-suggestion intents with fixtures, in design order, with their products. */
function litIntents(
  design: RoomDesign,
  productOf: ProductResolver,
): { intent: LightingIntent; product: StudioProduct }[] {
  const out: { intent: LightingIntent; product: StudioProduct }[] = [];
  for (const intent of design.intents) {
    if (intent.isSuggestion || intent.fixtures.length === 0) continue;
    const product = productOf(design.room, intent);
    if (product) out.push({ intent, product });
  }
  return out;
}

export function buildSources(design: RoomDesign, productOf: ProductResolver = choiceProductOf): SourceSet {
  const sources: LightSource[] = [];
  const indirect: IndirectEntry[] = [];
  for (const { intent, product: p } of litIntents(design, productOf)) {
    const n = exponent(p.beamAngle);
    const pieces = pieceCount(p);
    const linear = pieces > 1;
    const L = p.length;
    for (const f of intent.fixtures) {
      if (f.output <= 0 || p.lumens <= 0) continue;
      const total = p.lumens * f.output;
      const up = Math.min(Math.max(p.uplightShare, 0), 1);
      indirect.push({ x: f.center.x, y: f.center.y, flux: total * (up * 0.6 + (1 - up) * 0.25) });
      const tilt = f.tilt + (p.asymmetric ? ASYMMETRIC_TILT : 0);
      const dir = heading(f.orientation);
      const t = (tilt * Math.PI) / 180;
      let axis: { x: number; y: number; z: number };
      if (f.mount === 'wall') axis = { x: dir.x, y: dir.y, z: 0 };
      else if (tilt > TILT_THRESHOLD) axis = { x: dir.x * Math.sin(t), y: dir.y * Math.sin(t), z: -Math.cos(t) };
      else axis = { x: 0, y: 0, z: -1 };
      const down = total * (1 - up);
      for (let k = 0; k < pieces; k++) {
        const offset = linear ? -L / 2 + (L * (k + 0.5)) / pieces : 0;
        const pos = { x: f.center.x + dir.x * offset, y: f.center.y + dir.y * offset, z: f.height };
        if (down > 0) sources.push(makeSource(down / pieces, n, pos, axis));
        if (up >= UPLIGHT_SOURCE_THRESHOLD)
          sources.push(makeSource((total * up) / pieces, 1, pos, { x: 0, y: 0, z: 1 }));
      }
    }
  }
  const A = floorArea(design.room);
  return { sources, indirect, area: A, reach: Math.sqrt(Math.max(A, 1)) };
}

// §3, §4 -----------------------------------------------------------------------------------------------------------

function direct(s: LightSource, px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
  const vx = px - s.x;
  const vy = py - s.y;
  const vz = pz - s.z;
  let d2 = vx * vx + vy * vy + vz * vz;
  if (d2 < MIN_D2) d2 = MIN_D2;
  const inv = 1 / Math.sqrt(d2);
  const cosA = (vx * s.ax + vy * s.ay + vz * s.az) * inv;
  if (cosA <= s.cosCut) return 0;
  const cosInc = -(vx * nx + vy * ny + vz * nz) * inv;
  if (cosInc <= 0) return 0;
  let c: number;
  switch (s.power) {
    case 1:
      c = cosA;
      break;
    case 2:
      c = cosA * cosA;
      break;
    case 3:
      c = cosA * cosA * cosA;
      break;
    case 4: {
      const c2 = cosA * cosA;
      c = c2 * c2;
      break;
    }
    case 5: {
      const c2 = cosA * cosA;
      c = c2 * c2 * cosA;
      break;
    }
    case 6: {
      const c3 = cosA * cosA * cosA;
      c = c3 * c3;
      break;
    }
    default:
      c = Math.pow(cosA, s.n);
  }
  return (s.i0 * c * cosInc) / d2;
}

function indirectAt(set: SourceSet, x: number, y: number): number {
  if (set.indirect.length === 0) return 0;
  const inv = 2 / set.reach;
  let sum = 0;
  for (const e of set.indirect) {
    const dx = x - e.x;
    const dy = y - e.y;
    const near = 2 - Math.sqrt(dx * dx + dy * dy) * inv;
    sum += e.flux * (near >= 0.1 ? near : 0.1);
  }
  // floorArea is ≥ 1 whenever the room has a floor; a floorless room (area 0) divides by 1 (QUESTIONS.md).
  return sum / (set.area > 0 ? set.area : 1);
}

/** Illuminance (fc, estimate) at `point` on a surface facing `normal`, from a prebuilt source set. */
export function illuminance(set: SourceSet, point: P3, normal: P3): number {
  let e = 0;
  for (const s of set.sources) e += direct(s, point.x, point.y, point.z, normal.x, normal.y, normal.z);
  return (e + indirectAt(set, point.x, point.y)) * LIGHT_LOSS_FACTOR;
}

/** `QuickEstimate.At`: illuminance at a point of the design (builds the source set each call). */
export function at(design: RoomDesign, point: P3, normal: P3, productOf: ProductResolver = choiceProductOf): number {
  return illuminance(buildSources(design, productOf), point, normal);
}

// §6 ---------------------------------------------------------------------------------------------------------------

export interface SampleSet {
  points: P3[];
  normal: P3;
}

export function samples(shape: ZoneShape, maxSamples = MAX_SAMPLES): SampleSet {
  const points: P3[] = [];
  if (shape.kind === 'Vertical') {
    const run = { x: shape.to.x - shape.from.x, y: shape.to.y - shape.from.y };
    const len = Math.sqrt(run.x * run.x + run.y * run.y);
    const height = Math.max(shape.top - shape.bottom, 0.1);
    const step = Math.max(1, Math.sqrt((len * height) / maxSamples));
    const nu = Math.max(1, Math.floor(len / step + 1e-9));
    const nv = Math.max(1, Math.floor(height / step + 1e-9));
    for (let a = 0; a < nu; a++) {
      const u = (a + 0.5) / nu;
      const x = shape.from.x + run.x * u;
      const y = shape.from.y + run.y * u;
      for (let b = 0; b < nv; b++) points.push({ x, y, z: shape.bottom + (height * (b + 0.5)) / nv });
    }
    return { points, normal: { x: shape.inward.x, y: shape.inward.y, z: 0 } };
  }
  const poly = shape.polygon;
  const { min: lo, max: hi } = bounds(poly);
  const W = hi.x - lo.x;
  const H = hi.y - lo.y;
  const sp = Math.max(1, Math.sqrt(Math.max(W * H, 1) / maxSamples));
  const nx = Math.max(1, Math.floor(W / sp + 1e-9));
  const ny = Math.max(1, Math.floor(H / sp + 1e-9));
  const dx = W / nx;
  const dy = H / ny;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < ny; b++) {
      const p: P2 = { x: lo.x + (a + 0.5) * dx, y: lo.y + (b + 0.5) * dy };
      if (contains(poly, p)) points.push({ x: p.x, y: p.y, z: shape.height });
    }
  }
  if (points.length === 0) {
    const c = centroid(poly);
    points.push({ x: c.x, y: c.y, z: shape.height });
  }
  return { points, normal: { x: 0, y: 0, z: shape.kind === 'Ceiling' ? -1 : 1 } };
}

// §7 ---------------------------------------------------------------------------------------------------------------

/** Outer floor loop minus holes, at least 1; 0 when the room has no floor. */
export function floorArea(room: StudioRoom): number {
  const outer = room.floor[0];
  if (!outer) return 0;
  let a = area(outer);
  for (let i = 1; i < room.floor.length; i++) a -= area(room.floor[i] as P2[]);
  return Math.max(a, 1);
}

export interface PowerSummary {
  watts: number;
  /** W/ft². */
  lpd: number;
}

export function power(design: RoomDesign, productOf: ProductResolver = choiceProductOf): PowerSummary {
  let watts = 0;
  for (const { intent, product } of litIntents(design, productOf)) {
    for (const f of intent.fixtures) watts += product.watts * f.output;
  }
  const A = floorArea(design.room);
  return { watts, lpd: A > 0 ? watts / A : 0 };
}

// §8 ---------------------------------------------------------------------------------------------------------------

/** Estimate of one intent against a prebuilt source set (same result as `estimate`). */
export function estimateWith(
  set: SourceSet,
  design: RoomDesign,
  intent: LightingIntent,
  productOf: ProductResolver = choiceProductOf,
): IntentEstimate {
  const product = productOf(design.room, intent);
  let watts = 0;
  if (product) for (const f of intent.fixtures) watts += product.watts * f.output;
  const fixtures = intent.fixtures.length;
  const shape = zoneShape(design, intent);
  if (!shape) return { average: 0, minimum: 0, maximum: 0, fixtures, watts };
  const { points, normal } = samples(shape);
  let sum = 0;
  let min = Infinity;
  let max = 0;
  for (const p of points) {
    const e = illuminance(set, p, normal);
    sum += e;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  return {
    average: sum / points.length,
    minimum: min === Infinity ? 0 : min,
    maximum: max,
    fixtures,
    watts,
  };
}

export function estimate(
  design: RoomDesign,
  intent: LightingIntent,
  productOf: ProductResolver = choiceProductOf,
): IntentEstimate {
  return estimateWith(buildSources(design, productOf), design, intent, productOf);
}

/** Estimate of every non-suggestion intent, keyed by intent id, from one shared source set. */
export function estimateAll(
  design: RoomDesign,
  productOf: ProductResolver = choiceProductOf,
): Map<string, IntentEstimate> {
  const set = buildSources(design, productOf);
  const out = new Map<string, IntentEstimate>();
  for (const intent of design.intents) {
    if (!intent.isSuggestion) out.set(intent.id, estimateWith(set, design, intent, productOf));
  }
  return out;
}

/** Uniformity minimum / average (UI-side); 0 when the average is 0. */
export const uniformity = (e: Pick<IntentEstimate, 'average' | 'minimum'>): number =>
  e.average > 0 ? e.minimum / e.average : 0;
