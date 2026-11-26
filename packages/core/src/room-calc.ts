// Whole-room result (web addition, logged in spec/QUESTIONS.md "2026-11-26 room result"): one estimate for the room
// that combines every intent zone and every luminaire type (IES photometry where a product carries it).
//
// Two methods feed it, both estimates:
// - Room lumen method: every lit fixture of every type counts toward every zone, each zone at its own measuring
//   elevation. A fixture's flux is split between the zone it sits over (the part of its beam footprint at that
//   elevation that lands inside the zone) and the room as a whole, each through a coefficient of utilisation from the
//   room cavity ratio at that elevation (same CU rule and constants as the solver's first count, solver-layouts.md §2.1
//   step 5) and the 0.85 light loss factor. Vertical and ceiling zones have no lumen-method value.
// - Point-by-point: the full calculation grid of the zone (calc.ts) when one exists for this revision.
//
// The zone's shown value is the point-by-point average when the zone was calculated, else the lumen-method one. The
// solver's own lumen-method count (solver/layouts.ts) is unchanged, so golden layouts are unchanged.
//
// `overlayOrder` gives the drawing order for heat overlays so every zone is drawn at its own elevation: floor-level
// and work-plane zones first by elevation, larger before smaller at the same elevation (so a counter-top zone sits on
// the base light it is cut out of), then wall zones, then ceiling zones. Pure and deterministic.
import { area, contains } from './geometry';
import { LIGHT_LOSS_FACTOR, choiceProductOf, estimateAll, floorArea, hasIes, type ProductResolver } from './estimate';
import type { CalcResult, ZoneGrid } from './calc';
import { targetStatus, type TargetStatus } from './products';
import { isEmptyTarget, productKey, type IntentEstimate, roomBounds, type IntentKind, type LightingIntent, type RoomDesign, type TargetRange } from './model';
import { zoneShape, type ZoneShape } from './zones';

export const ROOM_RESULT_LABEL = 'Estimate (room lumen method and point-by-point, simplified inter-reflection)';
/** Same CU rule as solver-layouts.md §2.1 step 5. */
export const CU_BASE = 0.72;
export const CU_SLOPE = 0.035;
export const CU_MIN = 0.45;
export const CU_MAX = 0.7;
/** Uplight reaches a work plane only after a ceiling bounce: its CU is scaled by this. */
export const UPLIGHT_CU_SHARE = 0.5;

export type ZonePlane = 'horizontal' | 'vertical' | 'ceiling';
export type RoomZoneStatus = 'on-target' | 'low' | 'high' | 'no-target';

export interface RoomLuminaireType {
  /** Product key (id, else name). */
  key: string;
  name: string;
  /** Lit fixtures of this product across every zone. */
  fixtures: number;
  /** Σ lumens · output. */
  lumens: number;
  watts: number;
  beamAngle: number;
  uplightShare: number;
  /** Where the distribution came from. */
  photometry: 'ies' | 'generic';
  intentIds: string[];
}

export interface RoomZoneResult {
  intentId: string;
  label: string;
  kind: IntentKind;
  plane: ZonePlane;
  /** Measuring elevation (ft above floor): plane height, or the bottom of a wall zone. */
  elevation: number;
  /** Top of a wall zone (ft), else equal to elevation. */
  top: number;
  /** Zone area (ft²); a wall zone's face area. */
  area: number;
  target: TargetRange;
  /** Room lumen method at this elevation (fc, estimate); null for wall and ceiling zones. */
  lumen: { average: number; rcr: number; cu: number } | null;
  /** Point-by-point grid statistics (fc, estimate) when the zone was calculated. */
  point: { average: number; minimum: number; maximum: number; uniformity: number; points: number } | null;
  /**
   * Quick point estimate (core estimateAll) for a wall or ceiling zone with no calculated grid: the room lumen method
   * has no value for a vertical or ceiling plane, so these zones still get an estimate. Null otherwise.
   */
  quick: { average: number; minimum: number } | null;
  /** Where `average` comes from. */
  source: 'point' | 'lumen' | 'quick' | null;
  /** The value shown for the zone: point average when calculated, else lumen average, else the quick estimate. */
  average: number | null;
  status: RoomZoneStatus;
  /** 0-based position in overlayOrder. */
  drawOrder: number;
}

export interface RoomResult {
  label: typeof ROOM_RESULT_LABEL;
  revision: number;
  /** True when a full calculation for this revision fed the point values. */
  calculated: boolean;
  fixtures: number;
  watts: number;
  /** W/ft² over the floor area. */
  lpd: number;
  lumens: number;
  floorArea: number;
  types: RoomLuminaireType[];
  zones: RoomZoneResult[];
  /** Distinct measuring elevations of horizontal zones, ascending. */
  elevations: number[];
  onTarget: number;
  withTarget: number;
  /** The zone furthest below (or above) its target, or null when every zone with a target is on it. */
  worst: string | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Room cavity ratio for a cavity of height h over the room bounds (solver-layouts.md §2.1 step 5). */
export function roomCavityRatio(h: number, rl: number, rw: number): number {
  return (5 * Math.max(h, 1) * (rl + rw)) / (rl * rw);
}
export const coefficientOfUtilisation = (rcr: number): number => clamp(CU_BASE - CU_SLOPE * rcr, CU_MIN, CU_MAX);

const planeOf = (s: ZoneShape): ZonePlane => (s.kind === 'Vertical' ? 'vertical' : s.kind === 'Ceiling' ? 'ceiling' : 'horizontal');

interface Lit {
  intent: LightingIntent;
  x: number;
  y: number;
  height: number;
  flux: number;
  up: number;
  beam: number;
}

function litFixtures(design: RoomDesign, productOf: ProductResolver): { lit: Lit[]; types: RoomLuminaireType[] } {
  const lit: Lit[] = [];
  const types: RoomLuminaireType[] = [];
  const byKey = new Map<string, RoomLuminaireType>();
  for (const intent of design.intents) {
    if (intent.isSuggestion || intent.fixtures.length === 0) continue;
    const p = productOf(design.room, intent);
    if (!p || p.lumens <= 0) continue;
    const ies = hasIes(p);
    const up = clamp(ies ? p.ies!.derived.uplightShare : p.uplightShare, 0, 1);
    const beam = clamp(ies ? p.ies!.derived.beamAngle : p.beamAngle, 1, 179);
    const key = productKey(p);
    let t = byKey.get(key);
    if (!t) {
      t = {
        key,
        name: p.label || p.catalog || 'Luminaire',
        fixtures: 0,
        lumens: 0,
        watts: 0,
        beamAngle: beam,
        uplightShare: up,
        photometry: ies ? 'ies' : 'generic',
        intentIds: [],
      };
      byKey.set(key, t);
      types.push(t);
    }
    if (!t.intentIds.includes(intent.id)) t.intentIds.push(intent.id);
    for (const f of intent.fixtures) {
      if (f.output <= 0) continue;
      const flux = p.lumens * f.output;
      t.fixtures += 1;
      t.lumens += flux;
      t.watts += p.watts * f.output;
      lit.push({ intent, x: f.center.x, y: f.center.y, height: f.height, flux, up, beam });
    }
  }
  return { lit, types };
}

/**
 * Room lumen method for one horizontal zone at elevation e. Each fixture: cavity h = height − e, CU from the room
 * cavity ratio; its downward flux lands inside the zone in proportion to how much of its beam footprint (radius
 * h·tan(beam/2)) the zone covers when the fixture sits over the zone, the rest spreads over the room; uplight spreads
 * over the room at UPLIGHT_CU_SHARE of the CU.
 */
export function lumenAt(
  polygon: readonly { x: number; y: number }[],
  e: number,
  lit: readonly Pick<Lit, 'x' | 'y' | 'height' | 'flux' | 'up' | 'beam'>[],
  room: { rl: number; rw: number; area: number },
): { average: number; rcr: number; cu: number } {
  const zoneA = Math.max(area(polygon), 1);
  const roomA = Math.max(room.area, 1);
  const whole = zoneA >= roomA * 0.98;
  let sum = 0;
  let cuSum = 0;
  let rcrSum = 0;
  let w = 0;
  for (const f of lit) {
    const h = f.height - e;
    if (h <= 0) continue;
    const rcr = roomCavityRatio(h, room.rl, room.rw);
    const cu = coefficientOfUtilisation(rcr);
    const down = f.flux * (1 - f.up) * cu;
    const up = f.flux * f.up * cu * UPLIGHT_CU_SHARE;
    let local = 0;
    if (!whole && contains(polygon, f)) {
      const r = h * Math.tan(((f.beam / 2) * Math.PI) / 180);
      local = clamp(zoneA / Math.max(Math.PI * r * r, 1e-9), 0, 1);
    }
    sum += (down * local) / zoneA + (down * (1 - local) + up) / roomA;
    cuSum += cu * f.flux;
    rcrSum += rcr * f.flux;
    w += f.flux;
  }
  return {
    average: sum * LIGHT_LOSS_FACTOR,
    cu: w > 0 ? cuSum / w : 0,
    rcr: w > 0 ? rcrSum / w : 0,
  };
}

function statusOf(intent: LightingIntent, average: number | null): RoomZoneStatus {
  if (isEmptyTarget(intent.target) || average === null) return 'no-target';
  const s: TargetStatus = targetStatus(intent.target, average);
  return s === 'Under' ? 'low' : s === 'Over' ? 'high' : 'on-target';
}

/** How far a zone is from its target, as a fraction (0 when on target). */
function miss(z: RoomZoneResult): number {
  if (z.average === null || z.status === 'on-target' || z.status === 'no-target') return 0;
  const t = z.target;
  if (z.status === 'low') {
    const want = t.minimum ?? t.average ?? 0;
    return want > 0 ? (want - z.average) / want : 0;
  }
  const cap = t.maximum ?? 0;
  return cap > 0 ? (z.average - cap) / cap : 0;
}

/** Drawing order of heat overlays (see the header): returns intent ids. */
export function overlayOrder(
  zones: readonly Pick<RoomZoneResult, 'intentId' | 'plane' | 'elevation' | 'area'>[],
): string[] {
  const rank = (p: ZonePlane): number => (p === 'horizontal' ? 0 : p === 'vertical' ? 1 : 2);
  return zones
    .map((z, i) => ({ z, i }))
    .sort(
      (a, b) =>
        rank(a.z.plane) - rank(b.z.plane) ||
        a.z.elevation - b.z.elevation ||
        b.z.area - a.z.area ||
        a.i - b.i,
    )
    .map(({ z }) => z.intentId);
}

function gridStats(g: ZoneGrid): NonNullable<RoomZoneResult['point']> {
  return { average: g.avg, minimum: g.min, maximum: g.max, uniformity: g.U, points: g.points.length };
}

/**
 * The whole-room result for a design. `calc` feeds point-by-point values only when it is for `design.revision` and
 * was not aborted; otherwise every horizontal zone shows its lumen-method value.
 */
export function roomResult(
  design: RoomDesign,
  calc: CalcResult | null = null,
  productOf: ProductResolver = choiceProductOf,
): RoomResult {
  const { lit, types } = litFixtures(design, productOf);
  const b = roomBounds(design.room);
  const room = {
    rl: Math.max(b.max.x - b.min.x, 1),
    rw: Math.max(b.max.y - b.min.y, 1),
    area: floorArea(design.room),
  };
  const usable = calc !== null && !calc.aborted && calc.revision === design.revision;
  const grids = new Map<string, ZoneGrid>();
  if (usable) for (const g of calc.zones) grids.set(g.zoneId, g);

  const zones: RoomZoneResult[] = [];
  let estimates: Map<string, IntentEstimate> | null = null;
  for (const intent of design.intents) {
    if (intent.isSuggestion) continue;
    const shape = zoneShape(design, intent);
    if (!shape) continue;
    const plane = planeOf(shape);
    let elevation: number;
    let top: number;
    let zoneArea: number;
    let lumen: RoomZoneResult['lumen'] = null;
    if (shape.kind === 'Vertical') {
      elevation = shape.bottom;
      top = shape.top;
      zoneArea = Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) * Math.max(shape.top - shape.bottom, 0.1);
    } else {
      elevation = shape.height;
      top = shape.height;
      zoneArea = area(shape.polygon);
      if (shape.kind === 'Horizontal') lumen = lumenAt(shape.polygon, elevation, lit, room);
    }
    const g = grids.get(intent.id);
    const point = g ? gridStats(g) : null;
    let quick: RoomZoneResult['quick'] = null;
    if (!point && !lumen) {
      estimates ??= estimateAll(design, productOf);
      const e = estimates.get(intent.id);
      if (e && lit.length > 0) quick = { average: e.average, minimum: e.minimum };
    }
    const source = point ? 'point' : lumen ? 'lumen' : quick ? 'quick' : null;
    const average = point ? point.average : lumen ? lumen.average : quick ? quick.average : null;
    zones.push({
      intentId: intent.id,
      label: intent.label,
      kind: intent.kind,
      plane,
      elevation,
      top,
      area: zoneArea,
      target: intent.target,
      lumen,
      point,
      quick,
      source,
      average,
      status: statusOf(intent, average),
      drawOrder: 0,
    });
  }
  const order = overlayOrder(zones);
  for (const z of zones) z.drawOrder = order.indexOf(z.intentId);

  const withTarget = zones.filter((z) => z.status !== 'no-target');
  let worst: string | null = null;
  let worstMiss = 0;
  for (const z of withTarget) {
    const m = miss(z);
    if (m > worstMiss) {
      worstMiss = m;
      worst = z.intentId;
    }
  }
  const watts = types.reduce((s, t) => s + t.watts, 0);
  const elevations = [...new Set(zones.filter((z) => z.plane === 'horizontal').map((z) => z.elevation))].sort((x, y) => x - y);
  return {
    label: ROOM_RESULT_LABEL,
    revision: design.revision,
    calculated: usable,
    fixtures: types.reduce((s, t) => s + t.fixtures, 0),
    watts,
    lpd: room.area > 0 ? watts / room.area : 0,
    lumens: types.reduce((s, t) => s + t.lumens, 0),
    floorArea: room.area,
    types,
    zones,
    elevations,
    onTarget: withTarget.filter((z) => z.status === 'on-target').length,
    withTarget: withTarget.length,
    worst,
  };
}
