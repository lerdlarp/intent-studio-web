// Deterministic (fallback) AI (handoff/spec/fallback-ai.md): the agent with no model. Labels, targets and planes come
// from defaults/workplane, products from the ranker (no external candidates), sentences from the interpreter.
import { defaultLabel, defaultTarget } from './defaults';
import { interpret as interpretText } from './interpreter';
import {
  createRoom,
  type IntentAdvice,
  type IntentKind,
  type LightingIntent,
  type ProductChoice,
  type StudioProduct,
  type StudioRoom,
} from './model';
import { all as genericProducts } from './products';
import { family, familyFit, rank } from './ranker';
import { inferPlane } from './workplane';

/** Maximum results of `searchProducts`. */
export const MAX_SEARCH_RESULTS = 8;
/** Minimum family fit for a search result. */
export const MIN_SEARCH_FIT = 0.25;

/** The fallback agent is never online. */
export const isOnline = false;

/** The ambient average accents follow: first non-suggestion Ambient avg > 0, else any Ambient, else the room default. */
export function ambientAverage(room: StudioRoom, intents: readonly LightingIntent[]): number | null {
  const ambient = intents.filter((i) => i.kind === 'Ambient');
  const pick = (xs: readonly LightingIntent[]): number | null => {
    for (const i of xs) {
      const a = i.target.average;
      if (a !== null && a > 0) return a;
    }
    return null;
  };
  return (
    pick(ambient.filter((i) => !i.isSuggestion)) ??
    pick(ambient) ??
    defaultTarget(room, 'Ambient', null, null).target.average
  );
}

/** One advice per intent, same order; recomputed from room + kind + region + wall + object. Never fails. */
export function advise(room: StudioRoom, intents: readonly LightingIntent[]): IntentAdvice[] {
  const avg = ambientAverage(room, intents);
  return intents.map((intent) => {
    const { target, reason } = defaultTarget(room, intent.kind, intent.objectIndex, avg);
    return {
      intentId: intent.id,
      label: defaultLabel(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex),
      target: { ...target },
      plane: inferPlane(room, intent.kind, intent.region, intent.wallIndex, intent.objectIndex),
      reason,
    };
  });
}

/** The ranker over the project's products with no external candidates. */
export function pickProduct(
  room: StudioRoom,
  intent: LightingIntent,
  projectProducts: readonly StudioProduct[],
): ProductChoice {
  return rank(room, intent, projectProducts);
}

/** Generic stand-ins matching every query word and fitting the kind (offline only; never an external catalog). */
export function searchProducts(
  query: string | null | undefined,
  kind: IntentKind,
  targetLumens?: number | null,
): StudioProduct[] {
  const words = (query ?? '')
    .split(/[ ,;]/)
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());
  const probe = createRoom();
  const scored = genericProducts
    .map((p) => ({ p, fit: familyFit(probe, kind, family(p)) }))
    .filter(({ p, fit }) => {
      const text = `${p.label} ${p.description} ${p.family}`.toLowerCase();
      return words.every((w) => text.includes(w)) && fit >= MIN_SEARCH_FIT;
    });
  const lumenGap = (p: StudioProduct): number =>
    targetLumens === undefined || targetLumens === null
      ? 0
      : Math.abs(Math.log(Math.max(p.lumens, 1) / Math.max(targetLumens, 1)));
  scored.sort((a, b) => b.fit - a.fit || lumenGap(a.p) - lumenGap(b.p));
  return scored.slice(0, MAX_SEARCH_RESULTS).map((s) => s.p);
}

/** The offline interpreter, unchanged. */
export function interpret(room: StudioRoom, text: string | null | undefined): LightingIntent[] {
  return interpretText(room, text);
}

/** The fallback agent as one object (the server's offline `StudioAi`). */
export const fallbackAi = {
  isOnline,
  advise,
  pickProduct,
  searchProducts,
  interpret,
} as const;
