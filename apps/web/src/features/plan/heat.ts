// Plan heatmap layers: each accepted intent's zone sampled with the quick estimate at the estimate's own sample
// points (core zoneShape + samples, ≤ 400 per zone — IntentEstimate only carries avg/min/max), painted with core
// `rasterize` and placed in plan feet by an affine map. Vertical (wall) zones are laid flat as a strip in front of the
// wall. Pure; callers memoize per design object.
import {
  MAX_SAMPLES,
  buildSources,
  illuminance,
  isEmptyTarget,
  autoScale,
  productOf,
  rasterize,
  samples,
  targetScale,
  zoneShape,
  type HeatPoint,
  type HeatRaster,
  type HeatScale,
  type P2,
  type P3,
  type CalcResult,
  type RoomDesign,
  heatScale,
  roomResult,
} from '@intent-studio/core';
import { heatScaleOf, heatZoneOf } from '../ledger/heat';

/** Depth (ft) of the strip that shows a wall zone in plan. */
export const WALL_STRIP_DEPTH = 1.5;
export const PLAN_HEAT_PPF = 6;

export interface PlanHeatLayer {
  intentId: string;
  raster: HeatRaster;
  scale: HeatScale;
  /** Plan position of the raster's pixel (0, 0) corner, its (width, 0) corner and its (0, height) corner. */
  origin: P2;
  uEnd: P2;
  vEnd: P2;
}

const flat = (p: P3): P2 => ({ x: p.x, y: p.y });

/** One scale for every layer (the whole-room view) and whether ceiling zones stay off the plan. */
export interface SharedHeat {
  scale?: HeatScale;
  skipCeiling?: boolean;
}

/** Heat layers for every accepted intent with fixtures, in design order. */
export function planHeat(design: RoomDesign, pixelsPerFoot = PLAN_HEAT_PPF, shared?: SharedHeat): PlanHeatLayer[] {
  const set = buildSources(design, productOf);
  const out: PlanHeatLayer[] = [];
  for (const intent of design.intents) {
    if (intent.isSuggestion || intent.fixtures.length === 0) continue;
    const shape = zoneShape(design, intent);
    if (!shape) continue;
    if (shared?.skipCeiling && shape.kind === 'Ceiling') continue;
    const s = samples(shape, MAX_SAMPLES);
    const points: HeatPoint[] = s.points.map((p) => ({ ...p, value: illuminance(set, p, s.normal) }));
    const scale = shared?.scale ?? (isEmptyTarget(intent.target) ? autoScale([{ points }]) : targetScale(intent.target));
    if (shape.kind === 'Vertical') {
      const { from, to, bottom, top, inward } = shape;
      const outline: P3[] = [
        { x: from.x, y: from.y, z: bottom },
        { x: to.x, y: to.y, z: bottom },
        { x: to.x, y: to.y, z: top },
        { x: from.x, y: from.y, z: top },
      ];
      const raster = rasterize(
        { outline, normal: { x: inward.x, y: inward.y, z: 0 }, columnSpacing: 0, rowSpacing: 0, points },
        scale,
        pixelsPerFoot,
      );
      // u runs along the wall, v up it: lay v out into the room
      const o = flat(raster.origin);
      const u = flat(raster.uEnd);
      const d = WALL_STRIP_DEPTH;
      out.push({
        intentId: intent.id,
        raster,
        scale,
        origin: o,
        uEnd: u,
        vEnd: { x: o.x + inward.x * d, y: o.y + inward.y * d },
      });
      continue;
    }
    const outline: P3[] = shape.polygon.map((p) => ({ x: p.x, y: p.y, z: shape.height }));
    const raster = rasterize(
      { outline, normal: s.normal, columnSpacing: 0, rowSpacing: 0, points },
      scale,
      pixelsPerFoot,
    );
    out.push({
      intentId: intent.id,
      raster,
      scale,
      origin: flat(raster.origin),
      uEnd: flat(raster.uEnd),
      vEnd: flat(raster.vEnd),
    });
  }
  return out;
}

/**
 * Heat layers from a full calculation (core calc.ts zone grids at each zone's own spacing) for the intent zones; the
 * floor/ceiling/wall surfaces stay out of the plan, like the quick-estimate layers. Same plan placement as `planHeat`.
 */
export function planHeatFromCalc(result: CalcResult, pixelsPerFoot = PLAN_HEAT_PPF, shared?: SharedHeat): PlanHeatLayer[] {
  const out: PlanHeatLayer[] = [];
  for (const g of result.zones) {
    if (g.zoneId.startsWith('surface:') || g.points.length === 0) continue;
    if (shared?.skipCeiling && g.kind === 'ceiling') continue;
    const scale = shared?.scale ?? heatScaleOf(g);
    const raster = rasterize(heatZoneOf(g), scale, pixelsPerFoot);
    const o = flat(raster.origin);
    if (g.kind === 'vertical') {
      const n = g.normal;
      const len = Math.hypot(n.x, n.y) || 1;
      const d = WALL_STRIP_DEPTH;
      out.push({
        intentId: g.zoneId,
        raster,
        scale,
        origin: o,
        uEnd: flat(raster.uEnd),
        vEnd: { x: o.x + (n.x / len) * d, y: o.y + (n.y / len) * d },
      });
      continue;
    }
    out.push({ intentId: g.zoneId, raster, scale, origin: o, uEnd: flat(raster.uEnd), vEnd: flat(raster.vEnd) });
  }
  return out;
}

export const ROOM_HEAT_LABEL = 'Room range';

/** 0 to the 95th percentile of every value, rounded up to 5 fc (at least 5): one colour scale for the whole room. */
export function roomScale(values: readonly number[]): HeatScale {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return heatScale(0, 40, ROOM_HEAT_LABEL);
  const p95 = v[Math.min(v.length - 1, Math.floor(0.95 * (v.length - 1)))] ?? 0;
  return heatScale(0, Math.max(5, Math.ceil(p95 / 5) * 5), ROOM_HEAT_LABEL);
}

export interface RoomPlanHeat {
  /** Layers in drawing order (core overlayOrder): each zone at its own measuring height, smaller zones on top. */
  layers: PlanHeatLayer[];
  scale: HeatScale;
  /** Measuring height per drawn layer (ft), keyed by intent id. */
  elevation: Record<string, number>;
  /** True when the full calculation (this revision) fed it; else the quick estimate. */
  full: boolean;
}

/**
 * The whole room as one heat view: every zone on one colour scale, drawn in elevation order so a counter-top zone sits
 * over the base light it is cut out of; ceiling zones stay off the plan (they show in 3D).
 */
export function roomPlanHeat(design: RoomDesign, calc: CalcResult | null, pixelsPerFoot = PLAN_HEAT_PPF): RoomPlanHeat {
  const result = roomResult(design, calc, productOf);
  const full = result.calculated && calc !== null;
  const values: number[] = [];
  if (full) {
    for (const g of calc.zones) if (!g.zoneId.startsWith('surface:') && g.kind !== 'ceiling') values.push(...g.values);
  } else {
    const set = buildSources(design, productOf);
    for (const intent of design.intents) {
      if (intent.isSuggestion || intent.fixtures.length === 0) continue;
      const shape = zoneShape(design, intent);
      if (!shape || shape.kind === 'Ceiling') continue;
      const s = samples(shape, MAX_SAMPLES);
      for (const p of s.points) values.push(illuminance(set, p, s.normal));
    }
  }
  const scale = roomScale(values);
  const shared: SharedHeat = { scale, skipCeiling: true };
  const raw = full ? planHeatFromCalc(calc, pixelsPerFoot, shared) : planHeat(design, pixelsPerFoot, shared);
  const order = new Map(result.zones.map((z) => [z.intentId, z.drawOrder]));
  const layers = raw
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (order.get(a.l.intentId) ?? 1e9) - (order.get(b.l.intentId) ?? 1e9) || a.i - b.i)
    .map(({ l }) => l);
  const elevation: Record<string, number> = {};
  for (const z of result.zones) elevation[z.intentId] = z.elevation;
  return { layers, scale, elevation, full };
}
