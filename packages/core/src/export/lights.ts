// Pure light descriptors for every placed fixture: shared by the lit preview and the glTF export so both show the
// same thing. Plan space, feet; photometry is a visual approximation (not a calculation).
import { ceilingAt, heading } from '../geometry';
import { exponent } from '../estimate';
import type { LightingIntent, RoomDesign, StudioProduct } from '../model';
import { defaultCct } from '../cct';
import { iesPeakCandela } from '../ies';
import { productOf } from '../products';
import { kelvinToRgbUnit } from './kelvin';

export const DEFAULT_CCT = 3500;

/** The intent's CCT: the designer's/agent's choice, else the deterministic default, else 3500 K. */
export const intentCct = (design: RoomDesign, intent: LightingIntent): number =>
  intent.behavior.cct ?? defaultCct(design.room, intent) ?? DEFAULT_CCT;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FixtureLight {
  fixtureId: string;
  intentId: string;
  intentLabel: string;
  productLabel: string;
  /** Plan feet, z up. */
  position: Vec3;
  /** Unit aim vector, plan space (z up). */
  direction: Vec3;
  /** Peak intensity, candela. */
  candela: number;
  /** Full beam angle, degrees (half-angle = spot cone). */
  beamAngle: number;
  cct: number;
  /** sRGB 0..1. */
  rgb: [number, number, number];
  /** How many fixtures this descriptor stands for (>1 after merging). */
  count: number;
}

/**
 * Peak candela at `fluxLumens`: the IES table's peak scaled by flux / table flux when the product has photometry
 * (core `iesPeakCandela`), else the cosⁿ model I0 = Φ·(n+1)/2π from the beam angle.
 */
export function peakCandela(p: StudioProduct, fluxLumens = p.lumens): number {
  const peak = iesPeakCandela(p, fluxLumens);
  if (peak !== null && Number.isFinite(peak) && peak > 0) return peak;
  const n = exponent(p.beamAngle);
  return (Math.max(fluxLumens, 0) * (n + 1)) / (2 * Math.PI);
}

/** Height by mount, matching the 3D view (wall 7 ft, pendant 2 ft below ceiling, else flush). */
function mountHeight(mount: string, height: number, ceil: number): number {
  const m = mount.trim().toLowerCase();
  if (m === 'wall') return height > 0 ? height : 7;
  if (m === 'pendant') return height > 0 ? Math.min(height, ceil) : Math.max(ceil - 2, 0.5);
  return height > 0 ? height : ceil;
}

export function describeLights(design: RoomDesign): FixtureLight[] {
  const out: FixtureLight[] = [];
  for (const intent of design.intents) {
    if (intent.isSuggestion) continue;
    const p = productOf(design.room, intent);
    if (!p || p.lumens <= 0) continue;
    out.push(...intentLights(design, intent, p));
  }
  return out;
}

function intentLights(design: RoomDesign, intent: LightingIntent, p: StudioProduct): FixtureLight[] {
  const up = Math.min(Math.max(p.uplightShare, 0), 1);
  const aimUp = up > 0.5;
  const flux = p.lumens * (aimUp ? up : 1 - up);
  const cct = intentCct(design, intent);
  const rgb = kelvinToRgbUnit(cct);
  const beam = Math.min(Math.max(p.beamAngle, 8), 170);
  const list: FixtureLight[] = [];
  for (const f of intent.fixtures) {
    if (f.output <= 0) continue;
    const ceil = ceilingAt(design.room, f.center);
    const z = mountHeight(f.mount, f.height, ceil);
    const dir = heading(f.orientation);
    const tilt = f.tilt + (p.asymmetric ? 35 : 0);
    const t = (tilt * Math.PI) / 180;
    let direction: Vec3;
    if (f.mount.trim().toLowerCase() === 'wall') direction = { x: dir.x, y: dir.y, z: 0 };
    else if (aimUp) direction = { x: 0, y: 0, z: 1 };
    else if (tilt > 0.01) direction = { x: dir.x * Math.sin(t), y: dir.y * Math.sin(t), z: -Math.cos(t) };
    else direction = { x: 0, y: 0, z: -1 };
    list.push({
      fixtureId: f.id,
      intentId: intent.id,
      intentLabel: intent.label,
      productLabel: p.label,
      position: { x: f.center.x, y: f.center.y, z },
      direction,
      // An IES table's peak already belongs to its whole distribution (up + down), so it scales with the fixture's
      // full lumens; the cosⁿ model only gets the share of flux going the way it aims.
      candela: peakCandela(p, (p.ies ? p.lumens : flux) * f.output),
      beamAngle: beam,
      cct,
      rgb,
      count: 1,
    });
  }
  return list;
}

export interface CappedLights {
  lights: FixtureLight[];
  /** True when fixtures were merged to respect the cap. */
  merged: boolean;
  /** Lights before merging. */
  total: number;
}

/**
 * Cap the light count for rendering. Over `max`, lights are binned on a plan grid (the cell grows until the bin
 * count fits), keyed also by height, CCT, beam and aim, and each bin becomes one light at the centroid with summed
 * candela. Deterministic.
 */
export function capLights(lights: readonly FixtureLight[], max = 64): CappedLights {
  const total = lights.length;
  if (total <= max) return { lights: [...lights], merged: false, total };
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const l of lights) {
    xmin = Math.min(xmin, l.position.x);
    xmax = Math.max(xmax, l.position.x);
    ymin = Math.min(ymin, l.position.y);
    ymax = Math.max(ymax, l.position.y);
  }
  let cell = Math.max((xmax - xmin) / 16, (ymax - ymin) / 16, 1);
  for (let guard = 0; ; guard++, cell *= 1.5) {
    const bins = new Map<string, FixtureLight[]>();
    for (const l of lights) {
      const key = [
        Math.floor((l.position.x - xmin) / cell),
        Math.floor((l.position.y - ymin) / cell),
        Math.round(l.position.z),
        l.cct,
        Math.round(l.beamAngle),
        Math.round(l.direction.z * 4),
      ].join('|');
      const b = bins.get(key);
      if (b) b.push(l);
      else bins.set(key, [l]);
    }
    if (bins.size <= max || guard >= 40) {
      return { lights: [...bins.values()].map(mergeBin), merged: true, total };
    }
  }
}

function mergeBin(bin: FixtureLight[]): FixtureLight {
  const first = bin[0]!;
  if (bin.length === 1) return first;
  const n = bin.length;
  const sum = (f: (l: FixtureLight) => number) => bin.reduce((a, l) => a + f(l), 0);
  const dx = sum((l) => l.direction.x);
  const dy = sum((l) => l.direction.y);
  const dz = sum((l) => l.direction.z);
  const dl = Math.hypot(dx, dy, dz) || 1;
  return {
    ...first,
    position: { x: sum((l) => l.position.x) / n, y: sum((l) => l.position.y) / n, z: sum((l) => l.position.z) / n },
    direction: { x: dx / dl, y: dy / dl, z: dz / dl },
    candela: sum((l) => l.candela),
    count: sum((l) => l.count),
  };
}
