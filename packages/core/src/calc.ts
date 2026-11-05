// Full calculation (PLAN.md §3 "Full calculation", spec/zones.md): every zone and surface of `zones(design)` sampled
// at the zone's own spacing and evaluated with the estimate engine (same sources — IES candela tables when a product
// has one, cosⁿ otherwise — same light loss factor and indirect model). Pure and deterministic; cancellable through an
// abort callback that is polled between chunks; progress is reported as a 0..1 fraction.
//
// Grid rule (mirrors estimate.md §6 with `spacing` in place of the 400-sample widening): horizontal/ceiling zones put
// cell centres on a bounding-box lattice with nx = max(1, floor(W/spacing + 1e-9)) columns (dx = W/nx) and keep the ones
// inside the polygon, falling back to the centroid; vertical zones split the run and the height the same way. If the
// whole room would exceed MAX_GRID_POINTS, every spacing is widened by √(points / MAX_GRID_POINTS).
import { area, bounds, centroid, contains } from './geometry';
import { buildSources, choiceProductOf, illuminance, type ProductResolver } from './estimate';
import type { CalculationSnapshot, P2, P3, RoomDesign, StudioProduct, ZoneResult } from './model';
import { MAX_GRID_POINTS, zones, type Zone, type ZoneTarget } from './zones';

export const CALC_LABEL = 'Estimate (point-by-point, simplified inter-reflection)';
/** Points evaluated between abort polls / progress reports. */
export const CALC_CHUNK = 512;

export interface ZoneGrid {
  zoneId: string;
  label: string;
  kind: Zone['kind'];
  target?: ZoneTarget;
  /** Requested spacing (ft) and the lattice steps actually used along the two grid axes. */
  spacing: number;
  columnSpacing: number;
  rowSpacing: number;
  /** Zone outline in room coordinates (polygon at height, or the wall rectangle). */
  outline: P3[];
  normal: P3;
  points: P3[];
  /** Illuminance (fc, estimate) per point, same order as `points`. */
  values: number[];
  avg: number;
  min: number;
  max: number;
  /** Uniformity min/avg (0 when avg is 0). */
  U: number;
}

export interface CalcResult {
  label: typeof CALC_LABEL;
  /** Design revision the calculation was started for. */
  revision: number;
  /** True when the abort callback stopped it; `zones` then holds only the finished zones. */
  aborted: boolean;
  zones: ZoneGrid[];
  pointCount: number;
}

export interface CalcOptions {
  productOf?: ProductResolver;
  /** Polled between chunks; return true to stop. */
  shouldAbort?: () => boolean;
  /** 0..1, called after every chunk and once at the end. */
  onProgress?: (fraction: number) => void;
  /** Include floor/ceiling/wall surfaces (default true). */
  surfaces?: boolean;
  /** Point budget for the whole room (default MAX_GRID_POINTS). */
  maxPoints?: number;
}

interface Plan {
  zone: Zone;
  outline: P3[];
  normal: P3;
  points: P3[];
  columnSpacing: number;
  rowSpacing: number;
}

function planZone(z: Zone, sp: number): Plan {
  const points: P3[] = [];
  if (z.kind === 'vertical') {
    const from = z.from ?? { x: 0, y: 0 };
    const to = z.to ?? from;
    const bottom = z.bottom ?? 0;
    const top = z.top ?? bottom;
    const run = { x: to.x - from.x, y: to.y - from.y };
    const len = Math.sqrt(run.x * run.x + run.y * run.y);
    const height = Math.max(top - bottom, 0.1);
    const nu = Math.max(1, Math.floor(len / sp + 1e-9));
    const nv = Math.max(1, Math.floor(height / sp + 1e-9));
    for (let a = 0; a < nu; a++) {
      const u = (a + 0.5) / nu;
      for (let b = 0; b < nv; b++)
        points.push({ x: from.x + run.x * u, y: from.y + run.y * u, z: bottom + (height * (b + 0.5)) / nv });
    }
    // the inward normal is filled in by calcPlan (verticalNormal) from the room wall the zone lies on
    return {
      zone: z,
      outline: [
        { x: from.x, y: from.y, z: bottom },
        { x: to.x, y: to.y, z: bottom },
        { x: to.x, y: to.y, z: bottom + height },
        { x: from.x, y: from.y, z: bottom + height },
      ],
      normal: { x: 0, y: 0, z: 0 },
      points,
      columnSpacing: len / nu,
      rowSpacing: height / nv,
    };
  }
  const poly = z.polygon ?? [];
  const h = z.height ?? 0;
  const { min: lo, max: hi } = bounds(poly);
  const W = hi.x - lo.x;
  const H = hi.y - lo.y;
  const nx = Math.max(1, Math.floor(W / sp + 1e-9));
  const ny = Math.max(1, Math.floor(H / sp + 1e-9));
  const dx = W / nx;
  const dy = H / ny;
  for (let a = 0; a < nx; a++)
    for (let b = 0; b < ny; b++) {
      const p: P2 = { x: lo.x + (a + 0.5) * dx, y: lo.y + (b + 0.5) * dy };
      if (contains(poly, p)) points.push({ x: p.x, y: p.y, z: h });
    }
  if (points.length === 0 && poly.length > 0) {
    const c = centroid(poly);
    points.push({ x: c.x, y: c.y, z: h });
  }
  return {
    zone: z,
    outline: poly.map((p) => ({ x: p.x, y: p.y, z: h })),
    normal: { x: 0, y: 0, z: z.kind === 'ceiling' ? -1 : 1 },
    points,
    columnSpacing: dx,
    rowSpacing: dy,
  };
}

/** Inward normal of a vertical zone: the inward normal of the room wall it lies on (closest by midpoint), else left. */
function verticalNormal(design: RoomDesign, z: Zone): P3 {
  const from = z.from ?? { x: 0, y: 0 };
  const to = z.to ?? from;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  let best: P2 | null = null;
  let bestD = Infinity;
  for (const w of design.room.walls) {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((mid.x - w.start.x) * dx + (mid.y - w.start.y) * dy) / l2)) : 0;
    const d = Math.hypot(mid.x - (w.start.x + dx * t), mid.y - (w.start.y + dy * t));
    if (d < bestD) {
      bestD = d;
      best = w.inward;
    }
  }
  if (best && bestD < 0.5) return { x: best.x, y: best.y, z: 0 };
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const l = Math.hypot(rx, ry) || 1;
  return { x: -ry / l, y: rx / l, z: 0 };
}

function zoneArea(z: Zone): number {
  if (z.kind === 'vertical') {
    const f = z.from ?? { x: 0, y: 0 };
    const t = z.to ?? f;
    return Math.hypot(t.x - f.x, t.y - f.y) * Math.max((z.top ?? 0) - (z.bottom ?? 0), 0.1);
  }
  return area(z.polygon ?? []);
}

/** Grids of every zone (no evaluation): the point layout `calculate` will use. */
export function calcPlan(design: RoomDesign, surfaces = true, maxPoints = MAX_GRID_POINTS): Plan[] {
  const list = zones(design, surfaces);
  let widen = 1;
  const estimate = list.reduce((s, z) => s + zoneArea(z) / (z.spacing * z.spacing), 0);
  if (estimate > maxPoints) widen = Math.sqrt(estimate / maxPoints);
  for (let attempt = 0; attempt < 8; attempt++) {
    const plans = list.map((z) => {
      const p = planZone(z, z.spacing * widen);
      if (z.kind === 'vertical') p.normal = verticalNormal(design, z);
      return p;
    });
    const n = plans.reduce((s, p) => s + p.points.length, 0);
    if (n <= maxPoints) return plans;
    widen *= Math.sqrt(n / maxPoints) * 1.01;
  }
  return list.map((z) => planZone(z, Infinity));
}

/** Full point-by-point calculation of every zone and surface. Pure; cancellable; reports progress. */
export function calculate(design: RoomDesign, opts: CalcOptions = {}): CalcResult {
  const productOf = opts.productOf ?? choiceProductOf;
  const set = buildSources(design, productOf);
  const plans = calcPlan(design, opts.surfaces ?? true, opts.maxPoints ?? MAX_GRID_POINTS);
  const total = plans.reduce((s, p) => s + p.points.length, 0);
  const out: ZoneGrid[] = [];
  let done = 0;
  let sinceCheck = 0;
  const stop = (): CalcResult => ({ label: CALC_LABEL, revision: design.revision, aborted: true, zones: out, pointCount: done });
  for (const plan of plans) {
    if (opts.shouldAbort?.()) return stop();
    const values: number[] = new Array<number>(plan.points.length);
    let sum = 0;
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < plan.points.length; i++) {
      const e = illuminance(set, plan.points[i]!, plan.normal);
      values[i] = e;
      sum += e;
      if (e < min) min = e;
      if (e > max) max = e;
      if (++sinceCheck >= CALC_CHUNK) {
        sinceCheck = 0;
        opts.onProgress?.((done + i + 1) / total);
        if (opts.shouldAbort?.()) return stop();
      }
    }
    done += plan.points.length;
    const n = plan.points.length;
    const avg = n > 0 ? sum / n : 0;
    const mn = min === Infinity ? 0 : min;
    const grid: ZoneGrid = {
      zoneId: plan.zone.id,
      label: plan.zone.label,
      kind: plan.zone.kind,
      spacing: plan.zone.spacing,
      columnSpacing: plan.columnSpacing,
      rowSpacing: plan.rowSpacing,
      outline: plan.outline,
      normal: plan.normal,
      points: plan.points,
      values,
      avg,
      min: mn,
      max,
      U: avg > 0 ? mn / avg : 0,
    };
    if (plan.zone.target) grid.target = plan.zone.target;
    out.push(grid);
  }
  opts.onProgress?.(1);
  return { label: CALC_LABEL, revision: design.revision, aborted: false, zones: out, pointCount: total };
}

/**
 * The product each lit intent resolves to, keyed by intent id — computed where the settled-package cache lives (the
 * main thread) so a worker that receives a structured-clone copy of the design resolves identically.
 */
export function resolveProducts(design: RoomDesign, productOf: ProductResolver): Record<string, StudioProduct> {
  const out: Record<string, StudioProduct> = {};
  for (const i of design.intents) {
    if (i.isSuggestion) continue;
    const p = productOf(design.room, i);
    if (p) out[i.id] = p;
  }
  return out;
}

/** Resolver over a `resolveProducts` map (intents missing from the map are dark). */
export const resolverFromMap =
  (map: Readonly<Record<string, StudioProduct>>): ProductResolver =>
  (_room, intent) =>
    map[intent.id] ?? null;

/** A zone grid as the model's ZoneResult (points carry their values; usable as a heatmap `HeatZone`). */
export function toZoneResult(g: ZoneGrid): ZoneResult {
  return {
    zoneId: g.zoneId,
    state: 'done',
    outline: g.outline,
    normal: g.normal,
    columnSpacing: g.columnSpacing,
    rowSpacing: g.rowSpacing,
    points: g.points.map((p, i) => ({ x: p.x, y: p.y, z: p.z, value: g.values[i]! })),
    average: g.avg,
    minimum: g.min,
    maximum: g.max,
  };
}

/** The design's `calculation` snapshot for a finished result (`at` is an ISO-8601 timestamp supplied by the caller). */
export function toSnapshot(r: CalcResult, at: string): CalculationSnapshot {
  const zonesOut: Record<string, ZoneResult> = {};
  for (const g of r.zones) zonesOut[g.zoneId] = toZoneResult(g);
  return { revision: r.revision, at, zones: zonesOut };
}
