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

/** Heat layers for every accepted intent with fixtures, in design order. */
export function planHeat(design: RoomDesign, pixelsPerFoot = PLAN_HEAT_PPF): PlanHeatLayer[] {
  const set = buildSources(design, productOf);
  const out: PlanHeatLayer[] = [];
  for (const intent of design.intents) {
    if (intent.isSuggestion || intent.fixtures.length === 0) continue;
    const shape = zoneShape(design, intent);
    if (!shape) continue;
    const s = samples(shape, MAX_SAMPLES);
    const points: HeatPoint[] = s.points.map((p) => ({ ...p, value: illuminance(set, p, s.normal) }));
    const scale = isEmptyTarget(intent.target) ? autoScale([{ points }]) : targetScale(intent.target);
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
export function planHeatFromCalc(result: CalcResult, pixelsPerFoot = PLAN_HEAT_PPF): PlanHeatLayer[] {
  const out: PlanHeatLayer[] = [];
  for (const g of result.zones) {
    if (g.zoneId.startsWith('surface:') || g.points.length === 0) continue;
    const scale = heatScaleOf(g);
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
