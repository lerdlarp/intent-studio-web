// Heatmap data adapter for full-calculation grids: zone grids → core HeatZone / HeatRaster (world corners), so the
// plan and 3D views can paint the full calculation instead of the ≤ 400-sample quick estimate. Pure (no three/DOM).
import {
  autoScale,
  isEmptyTarget,
  rasterize,
  targetScale,
  type CalcResult,
  type HeatPoint,
  type HeatRaster,
  type HeatScale,
  type HeatZone,
  type ZoneGrid,
} from '@intent-studio/core';
import { zoneTargetRange } from './ledgerRows';

export interface CalcHeatLayer {
  zoneId: string;
  kind: ZoneGrid['kind'];
  zone: HeatZone;
  scale: HeatScale;
  raster: HeatRaster;
}

/** A zone grid as a core HeatZone (points carry values; spacings are the lattice steps actually used). */
export function heatZoneOf(g: ZoneGrid): HeatZone {
  const points: HeatPoint[] = g.points.map((p, i) => ({ x: p.x, y: p.y, z: p.z, value: g.values[i] ?? 0 }));
  return { outline: g.outline, normal: g.normal, columnSpacing: g.columnSpacing, rowSpacing: g.rowSpacing, points };
}

/** Target scale when the zone has a target, else an auto scale over its own values. */
export function heatScaleOf(g: ZoneGrid): HeatScale {
  const t = zoneTargetRange(g);
  if (t && !isEmptyTarget(t)) return targetScale(t);
  return autoScale([{ points: g.values.map((value) => ({ value })) }]);
}

export interface CalcHeatOptions {
  pixelsPerFoot?: number;
  /** Keep surfaces (floor/ceiling/walls); default true. */
  surfaces?: boolean;
  /** Only these zone ids (e.g. the selected intent). */
  only?: ReadonlySet<string>;
}

/** Rasterized heat layers of a full calculation, in result (zone) order. Skip aborted/partial zones gracefully. */
export function calcHeatLayers(result: CalcResult | null, opts: CalcHeatOptions = {}): CalcHeatLayer[] {
  if (!result) return [];
  const out: CalcHeatLayer[] = [];
  for (const g of result.zones) {
    if (opts.surfaces === false && g.zoneId.startsWith('surface:')) continue;
    if (opts.only && !opts.only.has(g.zoneId)) continue;
    if (g.points.length === 0) continue;
    const zone = heatZoneOf(g);
    const scale = heatScaleOf(g);
    out.push({ zoneId: g.zoneId, kind: g.kind, zone, scale, raster: rasterize(zone, scale, opts.pixelsPerFoot ?? 6) });
  }
  return out;
}
