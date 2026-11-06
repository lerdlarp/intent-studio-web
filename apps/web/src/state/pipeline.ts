// The deterministic pipeline the store runs after every change, isolated here so Phase 6 can move it into a worker
// without touching the store: solve (core solveAll) and estimate (core estimateAll + power).
//
// Identity note: core remembers the lumen package the solver settled on in a WeakMap keyed by the intent object
// (products.rememberPackage). The solved design must therefore be estimated with the very objects the solver
// touched; `solveDesign` always solves a fresh deep copy (so the same design in gives the same layout out, never
// depending on a previous run), and `replaceIntent` carries the settled package across when an intent object is
// replaced without re-solving. The solver skips hand-tuned intents (their fixtures stay as the designer left them), so
// it never settles a package for them: `solveDesign` carries the package of the same intent from the previous design.
//
// Phase 6: the same solve runs in a worker (workers/solve.worker.ts) through `solveRequest` / `runSolveRequest` /
// `adoptSolved`. The WeakMap does not survive structured cloning, so the settled packages cross the boundary
// explicitly: the request carries the hand-tuned intents' packages (`carried`, what `solveDesign` takes from
// `previous`), the reply returns every unchosen intent's settled package (`packages`), and `adoptSolved` remembers them
// on the received intent objects. Inline and worker paths call the same functions, so their layouts are identical.
import {
  estimateAll,
  power,
  productOf,
  rememberPackage,
  type IntentEstimate,
  type LightingIntent,
  type PowerSummary,
  type RoomDesign,
  type StudioProduct,
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
const solveOptions = { prioritizeTaskZones: true, avoidWallWashOverlap: true };

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
      if (old && i.handTuned && i.product === null && old.product === null)
        rememberPackage(i, productOf(previous.room, old));
    }
  }
  solveAll(design, solveOptions);
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

/** Everything a solve needs, as plain cloneable data (crosses the worker boundary). */
export interface SolveRequest {
  input: DesignInput;
  revision: number;
  /** intent id → lumen package for hand-tuned intents without a product choice (from the previous design). */
  carried: Record<string, StudioProduct>;
}

export interface SolveReply {
  design: RoomDesign;
  /** intent id → the package `productOf` resolves for every intent without a product choice after the solve. */
  packages: Record<string, StudioProduct>;
  estimate: EstimateResult;
  /** Wall-clock of solve + estimate where it ran (ms). */
  ms: number;
}

/** Build a request from the input and the design it replaces (same carry rule as `solveDesign`'s `previous`). */
export function solveRequest(input: DesignInput, revision: number, previous: RoomDesign | null): SolveRequest {
  const carried: Record<string, StudioProduct> = {};
  if (previous) {
    const before = new Map(previous.intents.map((i) => [i.id, i]));
    for (const i of input.intents) {
      const old = before.get(i.id);
      if (old && i.handTuned && i.product === null && old.product === null)
        carried[i.id] = productOf(previous.room, old);
    }
  }
  return { input, revision, carried };
}

/** Run a request: solve (deep copy) → settled packages → quick estimate. Pure; the worker and the inline path share it. */
export function runSolveRequest(req: SolveRequest): SolveReply {
  const t0 = performance.now();
  const design: RoomDesign = {
    room: req.input.room,
    intents: cloneIntents(req.input.intents),
    removedExisting: [...req.input.removedExisting],
    calculation: null,
    revision: req.revision,
  };
  for (const i of design.intents) {
    const pkg = req.carried[i.id];
    if (pkg && i.product === null) rememberPackage(i, pkg);
  }
  solveAll(design, solveOptions);
  const packages: Record<string, StudioProduct> = {};
  for (const i of design.intents) if (i.product === null) packages[i.id] = productOf(design.room, i);
  const estimate = estimateDesign(design);
  return { design, packages, estimate, ms: performance.now() - t0 };
}

/** Remember the reply's settled packages on its (received, possibly cloned) intent objects; returns the design. */
export function adoptSolved(reply: SolveReply): RoomDesign {
  for (const i of reply.design.intents) {
    const pkg = reply.packages[i.id];
    if (pkg && i.product === null) rememberPackage(i, pkg);
  }
  return reply.design;
}

/**
 * The not-yet-solved design shown while a worker solve runs: the edited intents (their previous fixtures) with the
 * previous settled packages carried by id, so `productOf` keeps answering like before the edit.
 */
export function provisionalDesign(input: DesignInput, revision: number, previous: RoomDesign | null): RoomDesign {
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
      if (old && i.product === null && old.product === null) rememberPackage(i, productOf(previous.room, old));
    }
  }
  return design;
}
