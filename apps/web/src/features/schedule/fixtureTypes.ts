// Luminaire schedule: accepted zones grouped into fixture types (same product and CCT = same type), tagged A, B, C…
// in design order. Derived only; nothing is stored. CCT belongs to the type; a zone may suggest a different one.
import {
  defaultCct,
  intentCct,
  productKey,
  productOf,
  type Cct,
  type LightingIntent,
  type RoomDesign,
  type StudioProduct,
} from '@intent-studio/core';

export interface FixtureType {
  tag: string;
  key: string;
  product: StudioProduct;
  cct: number;
  /** Fixtures placed across all zones of this type. */
  count: number;
  /** count × product watts. */
  watts: number;
  zones: { id: string; label: string; automatic: boolean }[];
}

/** A, B, … Z, AA, AB, … */
export function typeTag(n: number): string {
  let s = '';
  let k = n;
  do {
    s = String.fromCharCode(65 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return s;
}

const placesFixtures = (i: LightingIntent) => !i.isSuggestion && i.kind !== 'KeepDim';

export function fixtureTypes(design: RoomDesign): FixtureType[] {
  const types: FixtureType[] = [];
  const byKey = new Map<string, FixtureType>();
  for (const intent of design.intents) {
    if (!placesFixtures(intent)) continue;
    const product = productOf(design.room, intent);
    const cct = intentCct(design, intent);
    const key = `${productKey(product)}@${cct}`;
    let t = byKey.get(key);
    if (!t) {
      t = { tag: typeTag(types.length), key, product, cct, count: 0, watts: 0, zones: [] };
      byKey.set(key, t);
      types.push(t);
    }
    t.count += intent.fixtures.length;
    t.watts += intent.fixtures.length * product.watts;
    t.zones.push({ id: intent.id, label: intent.label, automatic: intent.product === null });
  }
  return types;
}

export const typeOfIntent = (types: readonly FixtureType[], intentId: string): FixtureType | undefined =>
  types.find((t) => t.zones.some((z) => z.id === intentId));

/** The CCT the zone's kind suggests for this room, when it differs from the CCT its type uses. */
export function cctSuggestion(design: RoomDesign, intent: LightingIntent): Cct | null {
  const suggested = defaultCct(design.room, intent);
  if (suggested === null) return null;
  return suggested === intentCct(design, intent) ? null : suggested;
}
