// The deterministic pipeline the store runs after every change, isolated here so Phase 6 can move it into a worker
// without touching the store: solve (core solveAll) and estimate (core estimateAll + power).
//
// Identity note: core remembers the lumen package the solver settled on in a WeakMap keyed by the intent object
// (products.rememberPackage). The solved design must therefore be estimated with the very objects the solver
// touched; `solveDesign` always solves a fresh deep copy (so the same design in gives the same layout out, never
// depending on a previous run), and `replaceIntent` carries the settled package across when an intent object is
// replaced without re-solving. The solver skips hand-tuned intents (their fixtures stay as the designer left them), so
// it never settles a package for them: `solveDesign` carries the package of the same intent from the previous design.
import {
  estimateAll,
  power,
  productOf,
  rememberPackage,
  type IntentEstimate,
  type LightingIntent,
  type PowerSummary,
  type RoomDesign,
  type StudioRoom,
  solveAll,
} from '@intent-studio/core';

export interface DesignInput {
  room: StudioRoom;
  intents: readonly LightingIntent[];
  removedExisting: readonly string[];
}

export interface EstimateResult {
  estimates: Record<string, IntentEstimate>;
  power: PowerSummary;
}

export const cloneIntents = (intents: readonly LightingIntent[]): LightingIntent[] => structuredClone([...intents]);

/**
 * Deep-copy the input and solve every accepted intent. Pure with respect to its input. `previous` (the design being
 * replaced) lends hand-tuned intents the lumen package the solver settled on before they were hand-tuned.
 */
export function solveDesign(input: DesignInput, revision = 0, previous: RoomDesign | null = null): RoomDesign {
  const design: RoomDesign = {
    room: input.room,
    intents: cloneIntents(input.intents),
    removedExisting: [...input.removedExisting],
    calculation: null,
    revision,
  };
  if (previous) {
    const before = new Map(previous.intents.map((i) => [i.id, i]));
    for (const i of design.intents) {
      const old = before.get(i.id);
      if (old && i.handTuned && i.product === null && old.product === null) rememberPackage(i, productOf(previous.room, old));
    }
  }
  solveAll(design);
  return design;
}

/** Quick estimate of every accepted intent plus room power, from a design returned by `solveDesign`. */
export function estimateDesign(design: RoomDesign): EstimateResult {
  const map = estimateAll(design, productOf);
  return { estimates: Object.fromEntries(map), power: power(design, productOf) };
}

/** Replace an intent object without re-solving, keeping the solver's settled lumen package with the new object. */
export function replaceIntent(room: StudioRoom, old: LightingIntent, next: LightingIntent): LightingIntent {
  if (next !== old && next.product === null) rememberPackage(next, productOf(room, old));
  return next;
}
