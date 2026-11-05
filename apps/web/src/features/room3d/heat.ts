// Per-intent heat rasters for the 3D view: sample the intent's plane with the quick estimate (core `at`, ≤ 400
// points), then paint with core `rasterize`. Pure (no three, no DOM); callers memoize per design object.
import {
  MAX_SAMPLES,
  autoScale,
  buildSources,
  illuminance,
  isEmptyTarget,
  productOf,
  rasterize,
  samples,
  targetScale,
  zoneShape,
  type HeatPoint,
  type HeatRaster,
  type HeatScale,
  type LightingIntent,
  type P3,
  type RoomDesign,
  type SourceSet,
} from '@intent-studio/core';

export interface IntentHeat {
  intentId: string;
  raster: HeatRaster;
  scale: HeatScale;
}

export const HEAT_PIXELS_PER_FOOT = 8;

export function intentHeat(design: RoomDesign, intent: LightingIntent, set: SourceSet): IntentHeat | null {
  if (intent.isSuggestion || intent.fixtures.length === 0) return null;
  const shape = zoneShape(design, intent);
  if (!shape) return null;
  const s = samples(shape, MAX_SAMPLES);
  const points: HeatPoint[] = s.points.map((p) => ({ ...p, value: illuminance(set, p, s.normal) }));
  let outline: P3[];
  let normal: P3;
  if (shape.kind === 'Vertical') {
    const { from, to, bottom, top, inward } = shape;
    outline = [
      { x: from.x, y: from.y, z: bottom },
      { x: to.x, y: to.y, z: bottom },
      { x: to.x, y: to.y, z: top },
      { x: from.x, y: from.y, z: top },
    ];
    normal = { x: inward.x, y: inward.y, z: 0 };
  } else {
    outline = shape.polygon.map((p) => ({ x: p.x, y: p.y, z: shape.height }));
    normal = s.normal;
  }
  const scale = isEmptyTarget(intent.target) ? autoScale([{ points }]) : targetScale(intent.target);
  // spacing 0 → the rasterizer infers the lattice from the sample positions
  const raster = rasterize({ outline, normal, columnSpacing: 0, rowSpacing: 0, points }, scale, HEAT_PIXELS_PER_FOOT);
  return { intentId: intent.id, raster, scale };
}

const cache = new WeakMap<RoomDesign, Map<string, IntentHeat>>();

/** Heat for every accepted intent with fixtures; memoized per design object (the store never mutates a design). */
export function designHeat(design: RoomDesign): Map<string, IntentHeat> {
  const hit = cache.get(design);
  if (hit) return hit;
  const set = buildSources(design, productOf);
  const out = new Map<string, IntentHeat>();
  for (const i of design.intents) {
    const h = intentHeat(design, i, set);
    if (h) out.set(i.id, h);
  }
  cache.set(design, out);
  return out;
}
