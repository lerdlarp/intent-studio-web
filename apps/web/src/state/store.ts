// The studio store (PLAN §2C, mirrors the original StudioViewModel). Per open room it holds one solved design.
//
// Every change: snapshot for undo (edits to the same field of the same intent within 1 s coalesce) → solve (core
// solveAll, via pipeline.ts) → bump revision → debounced estimate (estimateAll + power) → debounced autosave
// (PUT design with the server revision; 409 → reload and report) → calculation marked stale.
//
// Suggestions come from core `seed(room)` when a room has never been saved. Accepting turns `isSuggestion` off,
// re-solves, then asks /api/ai/advise and applies advice only to fields the designer has not edited.
//
// Phase 3 adds the plan's actions: painted intents (core defaults, then advice like an accepted suggestion), moving a
// fixture (pins it and marks the intent hand-tuned, which the solver then keeps as is), behaviour / target / plane /
// label / product edits, describe (free text → /api/ai/interpret, offline interpreter fallback), and the view state
// the plan and 3D view share: selection, active tool and overlay mode (view state is not part of undo).
//
// Phase 4: accepted / painted / described intents get core `defaultCct` (marked `cctSuggested`; a designer CCT is
// never replaced by advice), "Suggest a design" (/api/ai/propose → open suggestions only, rules fallback = core seed),
// and the suggestions' source ('ai' / 'rules') and agent rationale (saved with the design as the optional
// `suggestions` draft field, so a reload keeps them).
//
// Phase 5: the full calculation (`calculate` → worker via workers/calcClient, cancellable, progress 0..1) keeps its
// result with the revision it was started for; it is stale once the design revision moves past it. The project's
// product library (uploaded IES products) is loaded per project and feeds the inspector's ranker (`productCatalog`).
//
// Phase 6: with a `solver` (the worker client, workers/solveClient) a change shows a provisional design at once (the
// edited intents with their previous fixtures, `solving` true) and the worker returns the solved design with its quick
// estimate; only the reply for the latest revision is applied (rapid edits coalesce in the client). Saves, flush and
// the full calculation wait for the pending solve. Without a solver (tests, no Worker) every change solves inline and
// synchronously, exactly as before. Autosave failures keep the local design and retry with backoff.
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  DEMO_ROOM_NAMES,
  EMPTY_UUID,
  OFFLINE_ISSUE,
  CCT_VALUES,
  PATTERNS,
  applyAdviceWithCct,
  asProject,
  toSnapshot,
  withDefaultCct,
  defaultTarget,
  demoRoom,
  fallbackAi,
  interpret,
  planeEquals,
  productOf,
  seed,
  slimIntents,
  targetEquals,
  type CalcResult,
  type DemoRoomName,
  type DraftSuggestions,
  type IntentAdvice,
  type IntentBehavior,
  type IntentEstimate,
  type IntentKind,
  type LightingIntent,
  type P2,
  type PowerSummary,
  type RoomDesign,
  type StudioProduct,
  type StudioRoom,
  type StudioTool,
  type TargetRange,
  type Workplane,
} from '@intent-studio/core';
import { ApiError, type AiSource, type ProjectView, type RoomSummary, type StudioApi } from '../api/client';
import { History, snapshotOf, type Snapshot } from './history';
import { acceptInterpreted, acceptProposed, paintedIntent, type PaintTarget } from './paint';
import {
  adoptSolved,
  cloneIntents,
  estimateDesign,
  provisionalDesign,
  replaceIntent,
  solveDesign,
  solveRequest,
} from './pipeline';
import type { Solver } from '../workers/solveClient';
import { CALC_CRASH_NOTICE, runCalculation, type CalcRun } from '../workers/calcClient';

export type { PaintTarget } from './paint';

export type Units = 'imperial' | 'metric';
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';
export type Screen = 'home' | 'project' | 'room';
/** Plan / 3D overlay: the design only, or the estimate heatmap per intent zone. */
export type Overlay = 'none' | 'heatmap';

/** Behaviour knobs the designer can set (sanitised by `setBehavior`). */
export type BehaviorPatch = Partial<
  Pick<
    IntentBehavior,
    | 'density'
    | 'pattern'
    | 'quantity'
    | 'cct'
    | 'mountingHeight'
    | 'keepDimMargin'
    | 'wallOffset'
    | 'aimAngle'
    | 'alignToCeilingGrid'
  >
>;

export const DENSITY_MIN = 0.6;
export const DENSITY_MAX = 1.6;
export const TARGET_MAX_FC = 200;

export const DEMO_PROJECT_NAME = 'Demo rooms';
/**
 * Reason on the product choice the store writes when an intent becomes hand-tuned: the solver skips hand-tuned intents,
 * so the package it settled on is stored with the intent (and saved) instead of living only in the in-memory cache.
 * agentPicked stays true, so releasing the intent (which clears this choice) gives the package back to the solver.
 */
export const HAND_TUNED_PACKAGE_REASON = 'Kept from the layout you hand-tuned';
export const ESTIMATE_DELAY_MS = 120;
export const SAVE_DELAY_MS = 800;
export const SAVE_FAILED_PREFIX = 'Could not save this room:';
export const conflictNotice = (revision: number): string =>
  `This room was saved from somewhere else, so the saved design (revision ${revision}) was reloaded. Your last change was not kept.`;

/** One designer edit of an intent field. */
export type IntentEdit =
  | { field: 'label'; value: string }
  | { field: 'target'; value: TargetRange }
  | { field: 'targetReason'; value: string }
  | { field: 'plane'; value: Workplane }
  | { field: 'behavior'; value: Partial<IntentBehavior> };

export interface StudioData {
  screen: Screen;
  units: Units;
  busy: string | null;
  error: string | null;
  /** The failed request behind `error` can be retried (`retryLast`). */
  canRetry: boolean;
  projects: ProjectView[];
  project: ProjectView | null;
  rooms: RoomSummary[];

  roomId: string | null;
  /** The solved design of the open room (never mutated after it is set). */
  design: RoomDesign | null;
  /** Local revision: bumps on every change of the open room. */
  revision: number;
  /** Design revision the server last confirmed (sent with every save). */
  serverRevision: number;
  /** Local revision that was last saved. */
  savedRevision: number;
  save: SaveStatus;
  /** After a failed autosave: when the next automatic retry runs (epoch ms); null otherwise. */
  saveRetryAt: number | null;
  estimates: Record<string, IntentEstimate>;
  power: PowerSummary | null;
  /** Local revision the estimates were computed for. */
  estimateRevision: number;
  /** A worker solve for the latest change is pending (the shown design is provisional). */
  solving: boolean;
  /** The last full calculation is out of date (the design revision moved past the one it was started for). */
  calcStale: boolean;
  /** Last finished full calculation (cancelled runs keep the previous one). */
  calcResult: CalcResult | null;
  /** A calculation is running. */
  calcRunning: boolean;
  /** 0..1 while running. */
  calcProgress: number;
  calcError: string | null;
  /** Wall-clock time of the last finished calculation (ms). */
  calcMs: number | null;
  /** The open project's product library (uploaded IES products), in listing order. */
  projectProducts: StudioProduct[];
  /** Project the product library was loaded for. */
  productsProjectId: string | null;
  advising: boolean;
  /** Latest AI issue ("The agent is offline — using rules"); null when the agent answered. */
  aiIssue: string | null;
  /** One-off report for the designer (e.g. a save conflict). */
  notice: string | null;
  canUndo: boolean;
  canRedo: boolean;

  /** Selected intent (plan / 3D / inspector share it); null when nothing is selected. */
  selectedIntentId: string | null;
  /** Selected fixture of the selected intent. */
  selectedFixtureId: string | null;
  tool: StudioTool;
  overlay: Overlay;
  /** A describe request is in flight. */
  describing: boolean;
  /** A "Suggest a design" request is in flight. */
  proposing: boolean;
  /** Where the open suggestions came from: the agent ('ai') or the rules ('rules'); null when unknown (reloaded). */
  suggestionSource: AiSource | null;
  /**
   * The agent's rationale per open suggestion ("Agent: …"), from its proposal trace. View state: the solver rewrites a
   * suggestion's trace and traces are not saved, so the rationale lives here until the suggestions are replaced.
   */
  rationale: Record<string, string>;
}

export interface StudioActions {
  loadProjects(): Promise<void>;
  createProject(name: string): Promise<ProjectView | null>;
  openProject(id: string): Promise<void>;
  goHome(): Promise<void>;
  backToProject(): Promise<void>;
  /** Create (once) the demo project with the four core demo rooms, then open the named room. */
  openDemo(name: DemoRoomName): Promise<void>;
  /** Create a room on the server in the current project (import flow). */
  addRoom(room: StudioRoom, sourceAssetId: string | null): Promise<RoomSummary | null>;
  openRoom(roomId: string): Promise<void>;

  accept(id: string): void;
  acceptAll(): void;
  dismiss(id: string): void;
  removeIntent(id: string): void;
  editIntent(id: string, edit: IntentEdit): void;

  /** Paint a new accepted intent of `kind`; returns its id (selected), or null when the input makes no intent. */
  paintIntent(kind: IntentKind, target: PaintTarget): string | null;
  /** Move a fixture (by hand): pins it, marks its intent hand-tuned, re-solves. */
  moveFixture(intentId: string, fixtureId: string, center: P2): boolean;
  /** Give a hand-tuned intent back to the solver: clears hand-tuned and unpins its fixtures, re-solves. */
  releaseHandTuned(intentId: string): boolean;
  setBehavior(intentId: string, patch: BehaviorPatch): void;
  /** Designer target (marks targetEdited; advice never overwrites it). Rejects inconsistent ranges. */
  setTarget(intentId: string, target: TargetRange, reason?: string): boolean;
  /** Back to the suggested target (core defaults, then advice), clearing targetEdited. */
  resetTarget(intentId: string): void;
  setPlane(intentId: string, plane: Workplane): void;
  setLabel(intentId: string, label: string): void;
  /** Choose a product for the intent (null = let the ranker / generic family decide). */
  setProduct(intentId: string, product: StudioProduct | null): void;
  /** Free text → new intents (server interpret, offline interpreter fallback). Resolves with the new intent ids. */
  describe(text: string): Promise<string[]>;
  /**
   * "Suggest a design": /api/ai/propose → open suggestions (agent rationale in the trace). Replaces only the open
   * suggestions, never accepted intents; offline / failure → the core seed (source 'rules'). Resolves with the ids.
   */
  suggestDesign(): Promise<string[]>;
  select(intentId: string | null, fixtureId?: string | null): void;
  setTool(tool: StudioTool): void;
  setOverlay(overlay: Overlay): void;

  undo(): void;
  redo(): void;

  setUnits(units: Units): void;
  dismissIssue(): void;
  dismissNotice(): void;
  /** Show a one-off notice (e.g. the solver fell back to the main thread). */
  notify(text: string): void;
  /** Run any pending estimate now and save if there are unsaved changes. */
  flush(): Promise<void>;
  /** Resolves when the in-flight advice request (if any) has been applied. */
  adviceSettled(): Promise<void>;
  /** Resolves when the pending worker solve (if any) has been applied or dropped. */
  solveSettled(): Promise<void>;
  /** Run the request that failed last again (the error banner's Retry). */
  retryLast(): Promise<void>;
  dismissError(): void;
  /** Save now after a failed autosave (resets the backoff). */
  retrySave(): Promise<void>;

  /** Run the full calculation of the open design (cancels a running one). Resolves with the result (null if dropped). */
  calculate(): Promise<CalcResult | null>;
  cancelCalculation(): void;
  /** Replace the project's product library (the Library panel calls this after load / upload / delete). */
  setProjectProducts(products: readonly StudioProduct[], projectId?: string): void;
  loadProjectProducts(projectId: string): Promise<void>;
}

export type StudioState = StudioData & StudioActions;
export type StudioStore = StoreApi<StudioState>;

export interface StoreDeps {
  api: StudioApi;
  now?: () => number;
  estimateDelay?: number;
  saveDelay?: number;
  units?: Units;
  /** Full calculation runner (default: the worker client). */
  calculate?: typeof runCalculation;
  /** Off-thread solver (workers/solveClient). Null / absent: every change solves inline, synchronously. */
  solver?: Solver | null;
  /** Autosave retry delays after a failed save (ms); the last one repeats. */
  saveRetryDelays?: readonly number[];
}

export const SAVE_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000] as const;

/**
 * Products the ranker may choose from for the open project. The demo project keeps the core demo catalogue
 * (`asProject`, the reference behaviour) after its uploaded products; every other project offers only what was
 * uploaded to it (an empty library leaves just the generic stand-ins).
 */
export function productCatalog(s: Pick<StudioData, 'project' | 'projectProducts'>): readonly StudioProduct[] {
  return s.project?.name === DEMO_PROJECT_NAME ? [...s.projectProducts, ...asProject()] : s.projectProducts;
}

/** The full calculation when it is complete and matches the open design's revision, else null. */
export function freshCalc(s: Pick<StudioData, 'calcResult' | 'revision'>): CalcResult | null {
  const r = s.calcResult;
  return r && !r.aborted && s.revision <= r.revision ? r : null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Readable text for a failed request: network failures and server errors say what happened and that retry works. */
export function errorText(doing: string, e: unknown): string {
  const m = message(e);
  if (e instanceof ApiError) {
    if (e.status === 401) return `${doing} failed: the server needs an access token.`;
    if (e.status >= 500) return `${doing} failed: the server had a problem (${m}).`;
    return `${doing} failed: ${m}`;
  }
  if (e instanceof TypeError || /fetch|network/i.test(m)) return `${doing} failed: the server could not be reached.`;
  return m;
}

export const initialData = (units: Units = 'imperial'): StudioData => ({
  screen: 'home',
  units,
  busy: null,
  error: null,
  canRetry: false,
  projects: [],
  project: null,
  rooms: [],
  roomId: null,
  design: null,
  revision: 0,
  serverRevision: 0,
  savedRevision: 0,
  save: 'idle',
  saveRetryAt: null,
  estimates: {},
  power: null,
  estimateRevision: -1,
  solving: false,
  calcStale: false,
  calcResult: null,
  calcRunning: false,
  calcProgress: 0,
  calcError: null,
  calcMs: null,
  projectProducts: [],
  productsProjectId: null,
  advising: false,
  aiIssue: null,
  notice: null,
  canUndo: false,
  canRedo: false,
  selectedIntentId: null,
  selectedFixtureId: null,
  tool: 'Select',
  overlay: 'none',
  describing: false,
  proposing: false,
  suggestionSource: null,
  rationale: {},
});

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Sanitise a behaviour patch: clamp numbers to their documented ranges, drop values that are not allowed. */
export function sanitizeBehavior(patch: BehaviorPatch): Partial<IntentBehavior> {
  const out: Partial<IntentBehavior> = {};
  const has = (k: keyof BehaviorPatch) => Object.prototype.hasOwnProperty.call(patch, k);
  const optional = (k: 'mountingHeight' | 'keepDimMargin' | 'wallOffset' | 'aimAngle', lo: number, hi: number) => {
    if (!has(k)) return;
    const v = patch[k];
    if (v === null) out[k] = null;
    else if (finite(v)) out[k] = clampN(v, lo, hi);
  };
  if (has('density') && finite(patch.density)) out.density = clampN(patch.density, DENSITY_MIN, DENSITY_MAX);
  if (has('pattern') && (patch.pattern === null || (PATTERNS as readonly string[]).includes(patch.pattern as string)))
    out.pattern = patch.pattern ?? null;
  if (has('quantity')) {
    if (patch.quantity === null) out.quantity = null;
    else if (finite(patch.quantity)) out.quantity = clampN(Math.round(patch.quantity), 1, 300);
  }
  if (has('cct') && (patch.cct === undefined || (CCT_VALUES as readonly number[]).includes(patch.cct))) out.cct = patch.cct;
  optional('mountingHeight', 1, 60);
  optional('keepDimMargin', 0, 20);
  optional('wallOffset', 0, 20);
  optional('aimAngle', -90, 90);
  if (has('alignToCeilingGrid') && typeof patch.alignToCeilingGrid === 'boolean') out.alignToCeilingGrid = patch.alignToCeilingGrid;
  return out;
}

/** A designer target: bounds finite, 0–200 fc, min ≤ avg ≤ max; null when inconsistent. */
export function sanitizeTarget(t: TargetRange): TargetRange | null {
  const b = (v: number | null): number | null | undefined =>
    v === null ? null : finite(v) && v >= 0 ? Math.min(v, TARGET_MAX_FC) : undefined;
  const minimum = b(t.minimum);
  const average = b(t.average);
  const maximum = b(t.maximum);
  if (minimum === undefined || average === undefined || maximum === undefined) return null;
  if (minimum !== null && average !== null && minimum > average) return null;
  if (average !== null && maximum !== null && average > maximum) return null;
  if (minimum !== null && maximum !== null && minimum > maximum) return null;
  return { minimum, average, maximum };
}

/** The optional `suggestions` draft field for a save: present only while open suggestions have a known source. */
function suggestionMeta(s: Pick<StudioData, 'design' | 'suggestionSource' | 'rationale'>): DraftSuggestions | null {
  if (!s.design || s.suggestionSource === null) return null;
  const open = new Set(s.design.intents.filter((i) => i.isSuggestion).map((i) => i.id));
  if (open.size === 0) return null;
  const rationale: Record<string, string> = {};
  for (const [id, text] of Object.entries(s.rationale)) if (open.has(id)) rationale[id] = text;
  return { source: s.suggestionSource, rationale };
}

export function createStudioStore(deps: StoreDeps): StudioStore {
  const { api } = deps;
  const now = deps.now ?? (() => Date.now());
  const estimateDelay = deps.estimateDelay ?? ESTIMATE_DELAY_MS;
  const saveDelay = deps.saveDelay ?? SAVE_DELAY_MS;
  const history = new History();
  const calcRunner = deps.calculate ?? runCalculation;
  let calcRun: CalcRun | null = null;

  let token = 0; // bumps whenever the open room changes; stale async results are dropped
  let estimateTimer: ReturnType<typeof setTimeout> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let saveAgain = false;
  let advising: Promise<void> = Promise.resolve();
  const solver = deps.solver ?? null;
  const retryDelays = deps.saveRetryDelays ?? SAVE_RETRY_DELAYS_MS;
  let saveFailures = 0;
  let lastFailed: (() => Promise<unknown>) | null = null;
  /** Latest revision sent to the solver; replies for older revisions are dropped. */
  let solveRevision = -1;
  let solveWaiters: (() => void)[] = [];
  const solveSettled = (): Promise<void> =>
    solver && solveRevision >= 0 ? new Promise<void>((r) => solveWaiters.push(r)) : Promise.resolve();
  const releaseSolveWaiters = () => {
    solveRevision = -1;
    const w = solveWaiters;
    solveWaiters = [];
    for (const f of w) f();
  };

  return createStore<StudioState>()((set, get) => {
    const historyFlags = () => ({ canUndo: history.canUndo, canRedo: history.canRedo });
    /** Selection that still exists in `design` (fixture ids change when an intent is re-laid). */
    const prunedSelection = (design: RoomDesign) => {
      const { selectedIntentId: id, selectedFixtureId: fid } = get();
      const i = id === null ? undefined : design.intents.find((x) => x.id === id);
      if (!i) return { selectedIntentId: null, selectedFixtureId: null };
      return { selectedIntentId: i.id, selectedFixtureId: fid !== null && i.fixtures.some((f) => f.id === fid) ? fid : null };
    };

    /** calcStale for a design at `revision`. */
    const staleAt = (revision: number): boolean => {
      const r = get().calcResult;
      return r !== null && revision > r.revision;
    };
    const stopCalc = () => {
      calcRun?.cancel();
      calcRun = null;
    };

    const clearTimers = () => {
      if (estimateTimer) clearTimeout(estimateTimer);
      if (saveTimer) clearTimeout(saveTimer);
      estimateTimer = saveTimer = null;
    };

    // ---- estimate ------------------------------------------------------------------------------------------------
    const runEstimate = () => {
      if (estimateTimer) clearTimeout(estimateTimer);
      estimateTimer = null;
      const s = get();
      if (!s.design || s.solving) return; // a pending worker solve brings its own estimate
      const r = estimateDesign(s.design);
      set({ estimates: r.estimates, power: r.power, estimateRevision: s.revision });
    };
    const scheduleEstimate = () => {
      if (estimateTimer) clearTimeout(estimateTimer);
      estimateTimer = setTimeout(runEstimate, estimateDelay);
    };

    // ---- autosave ------------------------------------------------------------------------------------------------
    const reloadAfterConflict = async (tok: number) => {
      const s = get();
      if (!s.roomId || !s.design) return;
      const dv = await api.getDesign(s.roomId);
      if (tok !== token) return;
      history.clear();
      releaseSolveWaiters();
      const revision = get().revision + 1;
      const design = solveDesign({ room: s.design.room, intents: dv.intents, removedExisting: dv.removedExisting }, revision);
      set({
        design,
        revision,
        savedRevision: revision,
        serverRevision: dv.revision,
        save: 'conflict',
        solving: false,
        notice: conflictNotice(dv.revision),
        calcStale: staleAt(revision),
        ...historyFlags(),
        ...prunedSelection(design),
      });
      scheduleEstimate();
    };

    const saveNow = async (): Promise<void> => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (saving) {
        saveAgain = true;
        return saving;
      }
      if (get().solving) {
        // never save a provisional design: save once the pending solve has been applied
        const tok0 = token;
        await solveSettled();
        if (tok0 !== token) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        if (saving) {
          saveAgain = true;
          return saving;
        }
      }
      const s = get();
      if (!s.roomId || !s.design || s.revision === s.savedRevision) return;
      const tok = token;
      const rev = s.revision;
      const roomId = s.roomId;
      set({ save: 'saving' });
      saving = (async () => {
        try {
          const r = await api.putDesign(roomId, {
            revision: s.serverRevision,
            intents: slimIntents(s.design!.intents),
            removedExisting: [...s.design!.removedExisting],
            suggestions: suggestionMeta(s),
          });
          if (tok !== token) return;
          if (r.ok) {
            saveFailures = 0;
            const wasError = get().save === 'error' || get().saveRetryAt !== null;
            set({
              serverRevision: r.revision,
              savedRevision: rev,
              save: get().revision === rev ? 'saved' : 'pending',
              saveRetryAt: null,
              ...(wasError && get().notice?.startsWith(SAVE_FAILED_PREFIX) ? { notice: null } : {}),
            });
          } else await reloadAfterConflict(tok);
        } catch (e) {
          if (tok !== token) return;
          // keep the local design; retry with backoff (an edit or "Retry now" saves sooner)
          const delay = retryDelays[Math.min(saveFailures, retryDelays.length - 1)] ?? 30000;
          saveFailures++;
          set({
            save: 'error',
            saveRetryAt: now() + delay,
            notice: `${SAVE_FAILED_PREFIX} ${message(e)}. Your changes are kept here; retrying in ${Math.round(delay / 1000)} s.`,
          });
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => void saveNow(), delay);
        }
      })();
      try {
        await saving;
      } finally {
        saving = null;
      }
      if (saveAgain && tok === token) {
        saveAgain = false;
        await saveNow();
      }
    };
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void saveNow(), saveDelay);
    };

    // ---- the change pipeline --------------------------------------------------------------------------------------
    /** Solve a new intent list, bump the revision, then debounce estimate and save. */
    const settle = (next: Snapshot) => {
      const s = get();
      if (!s.design) return;
      const revision = s.revision + 1;
      if (solver) return settleAsync(next, revision);
      const design = solveDesign({ room: s.design.room, ...next }, revision, s.design);
      design.calculation = s.design.calculation; // the snapshot keeps its own revision (stale from now on)
      set({ design, revision, save: 'pending', calcStale: staleAt(revision), ...historyFlags(), ...prunedSelection(design) });
      scheduleEstimate();
      scheduleSave();
    };

    /** Worker path: show the provisional design now, apply the solver's reply if it is still the latest revision. */
    const settleAsync = (next: Snapshot, revision: number) => {
      const s = get();
      if (!s.design || !solver) return;
      const input = { room: s.design.room, intents: next.intents, removedExisting: next.removedExisting };
      const request = solveRequest(input, revision, s.design);
      const shown = provisionalDesign(input, revision, s.design);
      shown.calculation = s.design.calculation;
      const tok = token;
      solveRevision = revision;
      set({
        design: shown,
        revision,
        solving: true,
        save: 'pending',
        calcStale: staleAt(revision),
        ...historyFlags(),
        ...prunedSelection(shown),
      });
      scheduleSave();
      solver.solve(request).then(
        (reply) => {
          if (!reply || tok !== token || solveRevision !== revision || get().revision !== revision) return;
          const design = adoptSolved(reply);
          design.calculation = get().design?.calculation ?? null;
          set({
            design,
            solving: false,
            estimates: reply.estimate.estimates,
            power: reply.estimate.power,
            estimateRevision: revision,
            ...prunedSelection(design),
          });
          releaseSolveWaiters();
        },
        (e: unknown) => {
          if (tok !== token || solveRevision !== revision) return;
          set({ solving: false, notice: `The layout could not be solved: ${message(e)}` });
          releaseSolveWaiters();
        },
      );
    };

    /** Apply a designer change: undo snapshot (coalesced by key) → solve → … */
    const change = (key: string | null, mutate: (draft: Snapshot) => boolean | void): boolean => {
      const s = get();
      if (!s.design) return false;
      const draft: Snapshot = { intents: cloneIntents(s.design.intents), removedExisting: [...s.design.removedExisting] };
      if (mutate(draft) === false) return false;
      history.record(snapshotOf(s.design), key, now());
      settle(draft);
      return true;
    };

    // ---- advice --------------------------------------------------------------------------------------------------
    const applyAdviceList = (list: readonly IntentAdvice[]) => {
      const s = get();
      if (!s.design) return;
      const byId = new Map(list.map((a) => [a.intentId, a]));
      let resolve = false;
      let changed = false;
      const next = s.design.intents.map((i) => {
        const a = byId.get(i.id);
        if (!a || i.isSuggestion) return i;
        const n = applyAdviceWithCct(i, a);
        const solverInputs = !targetEquals(n.target, i.target) || !planeEquals(n.plane, i.plane);
        if (
          !solverInputs &&
          n.label === i.label &&
          n.targetReason === i.targetReason &&
          n.behavior.cct === i.behavior.cct &&
          n.cctSuggested === i.cctSuggested
        )
          return i;
        changed = true;
        resolve ||= solverInputs;
        return n;
      });
      if (!changed) return;
      if (resolve || s.solving) {
        // (a pending worker solve would be dropped by the revision bump below, so re-solve instead)
        settle({ intents: next, removedExisting: s.design.removedExisting });
        return;
      }
      // label / reason / CCT only: no re-solve; keep the solved fixtures and the settled packages
      const room = s.design.room;
      const intents = next.map((n, k) => replaceIntent(room, s.design!.intents[k] as LightingIntent, n));
      set({
        design: { ...s.design, intents, revision: s.revision + 1 },
        revision: s.revision + 1,
        save: 'pending',
        calcStale: staleAt(s.revision + 1),
      });
      scheduleEstimate();
      scheduleSave();
    };

    const adviseIntents = (ids: readonly string[]) => {
      const s = get();
      if (!s.design || ids.length === 0) return;
      const tok = token;
      const wanted = new Set(ids);
      const accepted = s.design.intents.filter((i) => !i.isSuggestion);
      const ordered = [...accepted.filter((i) => wanted.has(i.id)), ...accepted.filter((i) => !wanted.has(i.id))];
      const room = s.design.room;
      const body = { room, intents: slimIntents(ordered), ...(s.project ? { projectId: s.project.id } : {}) };
      set({ advising: true });
      const run = (async () => {
        let advice: IntentAdvice[];
        let issue: string | null;
        try {
          const r = await api.advise(body);
          advice = r.result;
          issue = r.lastIssue ?? null;
        } catch {
          advice = fallbackAi.advise(room, ordered);
          issue = OFFLINE_ISSUE;
        }
        if (tok !== token) return;
        // advice compares with the solved intents (the solver fills inferred fields): wait for a pending solve
        if (get().solving) await solveSettled();
        if (tok !== token) return;
        set({ aiIssue: issue, advising: false });
        applyAdviceList(advice.filter((a) => wanted.has(a.intentId)));
      })();
      advising = advising.then(() => run);
    };

    // ---- navigation helpers --------------------------------------------------------------------------------------
    const leaveRoom = async () => {
      if (get().roomId) {
        await get().flush();
        token++;
        clearTimers();
        history.clear();
      }
      releaseSolveWaiters();
      saveFailures = 0;
      stopCalc();
      set({
        roomId: null,
        design: null,
        estimates: {},
        power: null,
        estimateRevision: -1,
        revision: 0,
        savedRevision: 0,
        serverRevision: 0,
        save: 'idle',
        saveRetryAt: null,
        solving: false,
        notice: null,
        selectedIntentId: null,
        selectedFixtureId: null,
        tool: 'Select',
        describing: false,
        proposing: false,
        suggestionSource: null,
        rationale: {},
        calcStale: false,
        calcResult: null,
        calcRunning: false,
        calcProgress: 0,
        calcError: null,
        calcMs: null,
        ...historyFlags(),
      });
    };

    const guard = async <T>(busy: string, fn: () => Promise<T>, retry?: () => Promise<unknown>): Promise<T | null> => {
      set({ busy, error: null, canRetry: false });
      lastFailed = null;
      try {
        return await fn();
      } catch (e) {
        lastFailed = retry ?? (() => guard(busy, fn));
        set({ error: errorText(busy, e), canRetry: true });
        return null;
      } finally {
        set({ busy: null });
      }
    };

    const loadRooms = async (projectId: string) => set({ rooms: await api.listRooms(projectId) });
    const loadProducts = async (projectId: string) => {
      if (!api.listProducts) return set({ projectProducts: [], productsProjectId: projectId });
      try {
        const products = await api.listProducts(projectId);
        set({ projectProducts: products, productsProjectId: projectId });
      } catch {
        // the library is an enhancement: without it the ranker still has the generic stand-ins
        set({ projectProducts: [], productsProjectId: projectId });
      }
    };

    return {
      ...initialData(deps.units),

      loadProjects: async () => {
        await guard('Loading projects', async () => set({ projects: await api.listProjects() }));
      },

      createProject: (name) =>
        guard('Creating project', async () => {
          const p = await api.createProject(name);
          set({ projects: [...get().projects, p] });
          return p;
        }),

      openProject: async (id) => {
        await leaveRoom();
        await guard('Opening project', async () => {
          const projects = get().projects.length ? get().projects : await api.listProjects();
          const project = projects.find((p) => p.id === id) ?? null;
          if (!project) throw new Error('That project no longer exists.');
          await Promise.all([loadRooms(id), get().productsProjectId === id ? null : loadProducts(id)]);
          set({ projects, project, screen: 'project' });
        });
      },

      goHome: async () => {
        await leaveRoom();
        set({ screen: 'home', project: null, rooms: [] });
        await get().loadProjects();
      },

      backToProject: async () => {
        await leaveRoom();
        const p = get().project;
        if (!p) return get().goHome();
        set({ screen: 'project' });
        await guard('Loading rooms', () => loadRooms(p.id));
      },

      openDemo: async (name) => {
        const roomId = await guard('Creating the demo rooms', async () => {
          const projects = await api.listProjects();
          let project = projects.find((p) => p.name === DEMO_PROJECT_NAME) ?? null;
          let rooms = project ? await api.listRooms(project.id) : [];
          if (!project) {
            project = await api.createProject(DEMO_PROJECT_NAME);
            projects.push(project);
          }
          for (const n of DEMO_ROOM_NAMES) {
            const room = demoRoom(n);
            if (rooms.some((r) => r.label === room.label)) continue;
            try {
              await api.createRoom(project.id, room);
            } catch (e) {
              // the demo room id is taken (another demo project): let the server assign a fresh one
              if (!(e instanceof ApiError && e.status === 409)) throw e;
              await api.createRoom(project.id, { ...room, id: EMPTY_UUID });
            }
          }
          rooms = await api.listRooms(project.id);
          set({ projects, project, rooms });
          const label = demoRoom(name).label;
          const target = rooms.find((r) => r.label === label);
          if (!target) throw new Error(`Demo room "${label}" was not created.`);
          return target.id;
        }, () => get().openDemo(name));
        if (roomId) await get().openRoom(roomId);
      },

      addRoom: (room, sourceAssetId) =>
        guard('Creating room', async () => {
          const p = get().project;
          if (!p) throw new Error('Open a project first.');
          const created = await api.createRoom(p.id, room, sourceAssetId);
          await loadRooms(p.id);
          return get().rooms.find((r) => r.id === created.id) ?? null;
        }),

      openRoom: async (roomId) => {
        await leaveRoom();
        const tok = ++token;
        await guard('Opening room', async () => {
          const [rv, dv] = await Promise.all([api.getRoom(roomId), api.getDesign(roomId)]);
          if (tok !== token) return;
          const fresh = dv.revision === 0 && dv.intents.length === 0;
          const intents = fresh ? seed(rv.room) : dv.intents;
          const meta = fresh ? null : (dv.suggestions ?? null);
          const design = solveDesign({ room: rv.room, intents, removedExisting: dv.removedExisting }, 0);
          set({
            screen: 'room',
            roomId,
            design,
            revision: 0,
            savedRevision: 0,
            serverRevision: dv.revision,
            save: 'idle',
            estimates: {},
            power: null,
            estimateRevision: -1,
            calcStale: false,
            notice: null,
            suggestionSource: fresh ? 'rules' : (meta?.source ?? null),
            rationale: meta ? { ...meta.rationale } : {},
            ...historyFlags(),
          });
          if (!get().project || get().project?.id !== rv.projectId) {
            const projects = get().projects.length ? get().projects : await api.listProjects();
            set({ projects, project: projects.find((p) => p.id === rv.projectId) ?? null });
          }
          if (get().productsProjectId !== rv.projectId) await loadProducts(rv.projectId);
          runEstimate();
        }, () => get().openRoom(roomId));
      },

      accept: (id) => {
        const room = get().design?.room;
        if (!room) return;
        const ok = change(null, (d) => {
          const i = d.intents.find((x) => x.id === id);
          if (!i || !i.isSuggestion) return false;
          i.isSuggestion = false;
          Object.assign(i, withDefaultCct(room, i));
        });
        if (ok) adviseIntents([id]);
      },

      acceptAll: () => {
        const room = get().design?.room;
        if (!room) return;
        const ids: string[] = [];
        change(null, (d) => {
          for (const i of d.intents)
            if (i.isSuggestion) {
              i.isSuggestion = false;
              Object.assign(i, withDefaultCct(room, i));
              ids.push(i.id);
            }
          return ids.length > 0;
        });
        adviseIntents(ids);
      },

      dismiss: (id) => {
        change(null, (d) => {
          const k = d.intents.findIndex((x) => x.id === id && x.isSuggestion);
          if (k < 0) return false;
          d.intents.splice(k, 1);
        });
      },

      removeIntent: (id) => {
        change(null, (d) => {
          const k = d.intents.findIndex((x) => x.id === id);
          if (k < 0) return false;
          d.intents.splice(k, 1);
        });
      },

      editIntent: (id, edit) => {
        const key =
          edit.field === 'behavior' ? `${id}:behavior.${Object.keys(edit.value).sort().join(',')}` : `${id}:${edit.field}`;
        change(key, (d) => {
          const i = d.intents.find((x) => x.id === id);
          if (!i) return false;
          switch (edit.field) {
            case 'label':
              if (i.label === edit.value && !i.labelSuggested) return false;
              i.label = edit.value;
              i.labelSuggested = false;
              break;
            case 'target':
              i.target = { ...edit.value };
              i.targetEdited = true;
              break;
            case 'targetReason':
              i.targetReason = edit.value;
              i.targetEdited = true;
              break;
            case 'plane':
              i.plane = { ...edit.value, inferred: false };
              break;
            case 'behavior':
              i.behavior = { ...i.behavior, ...edit.value };
              if (Object.prototype.hasOwnProperty.call(edit.value, 'cct')) {
                if (edit.value.cct === undefined) {
                  // "Automatic": back to the suggested default (advice may refine it again)
                  delete i.cctSuggested;
                  Object.assign(i, withDefaultCct(get().design!.room, i));
                } else i.cctSuggested = false;
              }
              break;
          }
        });
      },

      paintIntent: (kind, target) => {
        const s = get();
        if (!s.design) return null;
        const painted = paintedIntent(s.design.room, kind, target, new Set(s.design.intents.map((i) => i.id)));
        if (!painted) return null;
        const intent = withDefaultCct(s.design.room, painted);
        if (!change(null, (d) => void d.intents.push(intent))) return null;
        set({ selectedIntentId: intent.id, selectedFixtureId: null });
        adviseIntents([intent.id]);
        return intent.id;
      },

      moveFixture: (intentId, fixtureId, center) => {
        if (!finite(center.x) || !finite(center.y)) return false;
        const ok = change(null, (d) => {
          const i = d.intents.find((x) => x.id === intentId);
          const f = i?.fixtures.find((x) => x.id === fixtureId);
          if (!i || !f || i.isSuggestion) return false;
          if (f.center.x === center.x && f.center.y === center.y && f.pinned && i.handTuned) return false;
          f.center = { x: center.x, y: center.y };
          f.pinned = true;
          if (!i.handTuned && i.product === null) {
            // persist the settled package: after a reload the solver (which skips hand-tuned intents) cannot recover it
            const solved = get().design!.intents.find((x) => x.id === intentId)!;
            const pkg = structuredClone(productOf(get().design!.room, solved));
            i.product = { product: pkg, agentPicked: true, reason: HAND_TUNED_PACKAGE_REASON, alternatives: [] };
          }
          i.handTuned = true;
        });
        if (ok) set({ selectedIntentId: intentId, selectedFixtureId: fixtureId });
        return ok;
      },

      releaseHandTuned: (intentId) =>
        change(null, (d) => {
          const i = d.intents.find((x) => x.id === intentId);
          if (!i || (!i.handTuned && !i.fixtures.some((f) => f.pinned))) return false;
          i.handTuned = false;
          for (const f of i.fixtures) f.pinned = false;
          if (i.product?.agentPicked && i.product.reason === HAND_TUNED_PACKAGE_REASON) i.product = null;
        }),

      setBehavior: (intentId, patch) => {
        const value = sanitizeBehavior(patch);
        if (Object.keys(value).length === 0) return;
        get().editIntent(intentId, { field: 'behavior', value });
      },

      setTarget: (intentId, target, reason) => {
        const t = sanitizeTarget(target);
        if (!t) return false;
        return change(`${intentId}:target`, (d) => {
          const i = d.intents.find((x) => x.id === intentId);
          if (!i) return false;
          i.target = t;
          if (reason !== undefined) i.targetReason = reason.slice(0, 90);
          i.targetEdited = true;
        });
      },

      resetTarget: (intentId) => {
        const s = get();
        if (!s.design) return;
        const room = s.design.room;
        const ok = change(null, (d) => {
          const i = d.intents.find((x) => x.id === intentId);
          if (!i) return false;
          const ambient = i.kind === 'Accent' ? defaultTarget(room, 'Ambient', null, null).target.average : null;
          const t = defaultTarget(room, i.kind, i.objectIndex, ambient);
          i.target = { ...t.target };
          i.targetReason = t.reason;
          i.targetEdited = false;
        });
        if (ok) adviseIntents([intentId]);
      },

      setPlane: (intentId, plane) => {
        if (![plane.height, plane.bottom, plane.top].every(finite)) return;
        get().editIntent(intentId, { field: 'plane', value: plane });
      },

      setLabel: (intentId, label) => {
        const v = label.trim().slice(0, 40);
        if (v !== '') get().editIntent(intentId, { field: 'label', value: v });
      },

      setProduct: (intentId, product) => {
        change(`${intentId}:product`, (d) => {
          const i = d.intents.find((x) => x.id === intentId);
          if (!i) return false;
          i.product = product ? { product: structuredClone(product), agentPicked: false, reason: '', alternatives: [] } : null;
        });
      },

      describe: async (text) => {
        const s = get();
        const t = text.trim();
        if (!s.design || t === '') return [];
        const tok = token;
        const room = s.design.room;
        set({ describing: true });
        let list: LightingIntent[];
        let issue: string | null;
        try {
          const r = await api.interpret({ room, text: t.slice(0, 4000), ...(s.project ? { projectId: s.project.id } : {}) });
          list = r.result;
          issue = r.lastIssue ?? null;
        } catch {
          list = interpret(room, t);
          issue = OFFLINE_ISSUE;
        }
        if (tok !== token || !get().design) return [];
        set({ describing: false, aiIssue: issue });
        const added = acceptInterpreted(room, list, get().design!.intents).map((i) => withDefaultCct(room, i));
        if (added.length === 0) {
          set({ notice: `Nothing new to add from “${t.slice(0, 60)}”.` });
          return [];
        }
        change(null, (d) => void d.intents.push(...added));
        const ids = added.map((i) => i.id);
        set({ selectedIntentId: ids[0] ?? null, selectedFixtureId: null });
        adviseIntents(ids);
        return ids;
      },

      suggestDesign: async () => {
        const s = get();
        if (!s.design || s.proposing) return [];
        const tok = token;
        const room = s.design.room;
        const current = s.design.intents
          .filter((i) => !i.isSuggestion)
          .map((i) => ({ id: i.id, kind: i.kind, label: i.label, wallIndex: i.wallIndex, objectIndex: i.objectIndex }));
        set({ proposing: true });
        let list: LightingIntent[];
        let source: AiSource;
        let issue: string | null;
        try {
          const r = await api.propose({ room, intents: current, ...(s.project ? { projectId: s.project.id } : {}) });
          source = r.source;
          issue = r.lastIssue ?? null;
          list = r.result;
        } catch {
          source = 'rules';
          issue = OFFLINE_ISSUE;
          list = [];
        }
        if (tok !== token || !get().design) return [];
        // the rules fallback is the core seed: rebuild it locally (deterministic) so its own trace is kept
        if (source === 'rules') list = seed(room);
        const accepted = get().design!.intents.filter((i) => !i.isSuggestion);
        const fresh = acceptProposed(room, list, accepted);
        const rationale: Record<string, string> = {};
        for (const i of fresh) {
          const line = i.trace.find((t) => t.startsWith('Agent: '));
          if (line && source === 'ai') rationale[i.id] = line;
        }
        set({ proposing: false, aiIssue: issue, suggestionSource: source, rationale });
        const ids = fresh.map((i) => i.id);
        change(null, (d) => {
          d.intents = [...d.intents.filter((i) => !i.isSuggestion), ...fresh];
        });
        return ids;
      },

      select: (intentId, fixtureId = null) => {
        const d = get().design;
        const i = intentId === null ? undefined : d?.intents.find((x) => x.id === intentId);
        set({
          selectedIntentId: i ? i.id : null,
          selectedFixtureId: i && fixtureId !== null && i.fixtures.some((f) => f.id === fixtureId) ? fixtureId : null,
        });
      },
      setTool: (tool) => set({ tool }),
      setOverlay: (overlay) => set({ overlay }),

      undo: () => {
        const s = get();
        if (!s.design) return;
        const prev = history.undo(snapshotOf(s.design));
        if (prev) settle(prev);
      },

      redo: () => {
        const s = get();
        if (!s.design) return;
        const next = history.redo(snapshotOf(s.design), now());
        if (next) settle(next);
      },

      setUnits: (units) => set({ units }),
      dismissIssue: () => set({ aiIssue: null }),
      dismissNotice: () => set({ notice: null }),
      notify: (text) => set({ notice: text }),

      flush: async () => {
        await solveSettled();
        if (estimateTimer) runEstimate();
        await saveNow();
      },

      retryLast: async () => {
        const f = lastFailed;
        lastFailed = null;
        set({ error: null, canRetry: false });
        if (f) await f();
      },
      dismissError: () => {
        lastFailed = null;
        set({ error: null, canRetry: false });
      },

      retrySave: async () => {
        saveFailures = 0;
        await saveNow();
      },

      solveSettled,

      adviceSettled: () => advising,

      calculate: async () => {
        if (get().solving) {
          const tok0 = token;
          await solveSettled();
          if (tok0 !== token) return null;
        }
        const s = get();
        if (!s.design) return null;
        stopCalc();
        const tok = token;
        const design = s.design;
        const t0 = now();
        const run = calcRunner(design, (fraction) => {
          if (calcRun === run && tok === token) set({ calcProgress: fraction });
        }, { productOf, onCrash: () => set({ notice: CALC_CRASH_NOTICE }) });
        calcRun = run;
        set({ calcRunning: true, calcProgress: 0, calcError: null });
        try {
          const result = await run.promise;
          if (calcRun !== run || tok !== token) return null;
          calcRun = null;
          if (result.aborted) {
            set({ calcRunning: false, calcProgress: 0 });
            return result;
          }
          const cur = get().design!;
          const snapshot = toSnapshot(result, new Date(now()).toISOString());
          set({
            calcResult: result,
            calcRunning: false,
            calcProgress: 1,
            calcMs: now() - t0,
            calcStale: get().revision > result.revision,
            design: { ...cur, calculation: snapshot },
          });
          return result;
        } catch (e) {
          if (calcRun === run) calcRun = null;
          if (tok === token) set({ calcRunning: false, calcError: message(e) });
          return null;
        }
      },

      cancelCalculation: () => {
        if (!calcRun) return;
        stopCalc();
        set({ calcRunning: false, calcProgress: 0 });
      },

      setProjectProducts: (products, projectId) =>
        set({ projectProducts: [...products], productsProjectId: projectId ?? get().productsProjectId }),

      loadProjectProducts: (projectId) => loadProducts(projectId),
    };
  });
}
