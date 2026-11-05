// Pure descriptors for the lit preview (no three, no DOM): one spot per fixture, capped. Purely visual — the scene is
// in feet, so candela is scaled by (ft/m)² to keep the inverse-square falloff right; exposure is a display control.
import { capLights, describeLights, FEET_PER_METER, type RoomDesign } from '@intent-studio/core';
import { planToThree, type V3 } from './describe';

/** Maximum spot lights in the lit preview before fixtures are merged. */
export const MAX_LIT_LIGHTS = 64;
/** Exposure at 0 EV. Chosen so a ~40 fc (430 lx) office reads mid-grey on a neutral surface; slider is ±EV. */
export const BASE_EXPOSURE = 0.006;
export const EV_MIN = -3;
export const EV_MAX = 3;
/** Fill from the (unmodelled) inter-reflection, as a fraction of ambient irradiance units; keeps unlit walls readable. */
export const FILL_INTENSITY = 45;
/** Spots that may cast shadows when shadows are on. */
export const MAX_SHADOW_LIGHTS = 16;
export const SPOT_PENUMBRA = 0.35;

export interface SpotDesc {
  id: string;
  /** Three space, feet. */
  position: V3;
  target: V3;
  /** sRGB 0..1. */
  rgb: [number, number, number];
  /** Scene intensity (candela × (ft/m)² for a feet-scaled scene). */
  intensity: number;
  /** Cone half-angle, radians (beam/2, capped below 90°). */
  angle: number;
  penumbra: number;
  /** Fixtures this spot stands for. */
  count: number;
}

export interface LitPreview {
  spots: SpotDesc[];
  /** Fixtures were merged into representative lights. */
  merged: boolean;
  /** Fixtures with light before merging. */
  total: number;
}

export const exposureOfEv = (ev: number): number => BASE_EXPOSURE * Math.pow(2, Math.min(EV_MAX, Math.max(EV_MIN, ev)));

export function litPreview(design: RoomDesign, max = MAX_LIT_LIGHTS): LitPreview {
  const capped = capLights(describeLights(design), max);
  const spots = capped.lights.map((l): SpotDesc => {
    const position = planToThree(l.position.x, l.position.y, l.position.z);
    const dir = planToThree(l.direction.x, l.direction.y, l.direction.z);
    return {
      id: l.fixtureId,
      position,
      target: [position[0] + dir[0], position[1] + dir[1], position[2] + dir[2]],
      rgb: l.rgb,
      intensity: l.candela * FEET_PER_METER * FEET_PER_METER,
      angle: Math.min(((l.beamAngle / 2) * Math.PI) / 180, (Math.PI / 2) * 0.98),
      penumbra: SPOT_PENUMBRA,
      count: l.count,
    };
  });
  return { spots, merged: capped.merged, total: capped.total };
}
