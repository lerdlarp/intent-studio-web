// Deterministic colour-temperature and beam defaults (PLAN §3 "CCT and beam proposals"). Pure data + lookup.
//
// The default CCT of an intent is a function of the room's space class (defaults.classOf) and the intent kind:
// the class row gives a base, a (class, kind) override wins over it. Values come only from CCT_VALUES.
//
// | Space class            | Base  | Overrides                                                        |
// |------------------------|-------|------------------------------------------------------------------|
// | Office, OpenOffice     | 4000  | Ambient 3500 · Accent, FeaturePendant, WallWash 3000             |
// | Conference             | 3500  | Accent, FeaturePendant 3000                                       |
// | Classroom              | 4000  | Accent, FeaturePendant 3500                                       |
// | Cafeteria              | 3500  | Accent, FeaturePendant, CeilingGlow 3000                          |
// | Lobby                  | 3000  | Task (reception) 3500                                             |
// | Corridor               | 3500  | Accent, FeaturePendant 3000                                       |
// | DataHall               | 4000  | Task (cold aisle) 5000                                            |
// | Retail                 | 3500  | Accent, FeaturePendant 3000                                       |
// | Restroom               | 3500  |                                                                  |
// | Storage                | 4000  |                                                                  |
// | BreakRoom              | 3000  | Task 3500                                                         |
// | Other                  | 3500  | Accent, FeaturePendant 3000                                       |
//
// KeepDim intents light nothing, so they get no CCT (null).
//
// Beam preference (degrees, full angle at 50 % peak) per kind — optional, a ranking hint only; it never changes a
// real IES file's photometry: Accent 25°, FeaturePendant 60°, WallWash 100°; every other kind has none.
import type { Cct, IntentAdvice, IntentKind, LightingIntent, SpaceClass, StudioRoom } from './model';
import { classOf } from './defaults';
import { applyAdvice } from './ai-codecs';

export const CCT_BASE: Readonly<Record<SpaceClass, Cct>> = {
  Office: 4000,
  OpenOffice: 4000,
  Conference: 3500,
  Classroom: 4000,
  Cafeteria: 3500,
  Lobby: 3000,
  Corridor: 3500,
  DataHall: 4000,
  Retail: 3500,
  Restroom: 3500,
  Storage: 4000,
  BreakRoom: 3000,
  Other: 3500,
};

const WARM_FEATURES: Partial<Record<IntentKind, Cct>> = { Accent: 3000, FeaturePendant: 3000 };

export const CCT_OVERRIDES: Readonly<Partial<Record<SpaceClass, Partial<Record<IntentKind, Cct>>>>> = {
  Office: { Ambient: 3500, Accent: 3000, FeaturePendant: 3000, WallWash: 3000 },
  OpenOffice: { Ambient: 3500, Accent: 3000, FeaturePendant: 3000, WallWash: 3000 },
  Conference: WARM_FEATURES,
  Classroom: { Accent: 3500, FeaturePendant: 3500 },
  Cafeteria: { Accent: 3000, FeaturePendant: 3000, CeilingGlow: 3000 },
  Lobby: { Task: 3500 },
  Corridor: WARM_FEATURES,
  DataHall: { Task: 5000 },
  Retail: WARM_FEATURES,
  BreakRoom: { Task: 3500 },
  Other: WARM_FEATURES,
};

/** Default CCT for a kind in a space class; null for keep-dim. */
export function cctFor(cls: SpaceClass, kind: IntentKind): Cct | null {
  if (kind === 'KeepDim') return null;
  return CCT_OVERRIDES[cls]?.[kind] ?? CCT_BASE[cls];
}

/** Deterministic default CCT for an intent in a room (null for keep-dim). */
export const defaultCct = (room: StudioRoom, intent: Pick<LightingIntent, 'kind'>): Cct | null =>
  cctFor(classOf(room), intent.kind);

export const BEAM_PREFERENCE: Readonly<Partial<Record<IntentKind, number>>> = {
  Accent: 25,
  FeaturePendant: 60,
  WallWash: 100,
};

/** Optional preferred beam angle (degrees) for a kind; undefined = no preference. */
export const defaultBeam = (kind: IntentKind): number | undefined => BEAM_PREFERENCE[kind];

/**
 * Apply advice like `applyAdvice` (designer edits win), where a cct the rules or the agent suggested
 * (`cctSuggested`) may still be replaced by the advice's cct; a designer-chosen cct never is.
 */
export function applyAdviceWithCct(intent: LightingIntent, advice: IntentAdvice): LightingIntent {
  if (advice.intentId !== intent.id) return intent;
  const open = intent.cctSuggested === true || intent.behavior.cct === undefined;
  const base = open && intent.behavior.cct !== undefined ? { ...intent, behavior: { ...intent.behavior, cct: undefined } } : intent;
  const next = applyAdvice(base, advice);
  if (next === base) return intent;
  if (open && advice.cct !== undefined) return { ...next, cctSuggested: true };
  if (open && intent.behavior.cct !== undefined) return { ...next, behavior: { ...next.behavior, cct: intent.behavior.cct } };
  return next;
}

/** Give an intent its default CCT when it has none (marked suggested). Returns the same object when nothing changes. */
export function withDefaultCct(room: StudioRoom, intent: LightingIntent): LightingIntent {
  if (intent.behavior.cct !== undefined) return intent;
  const cct = defaultCct(room, intent);
  if (cct === null) return intent;
  return { ...intent, behavior: { ...intent.behavior, cct }, cctSuggested: true };
}
