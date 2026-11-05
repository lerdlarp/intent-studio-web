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
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  DEMO_ROOM_NAMES,
  EMPTY_UUID,
  OFFLINE_ISSUE,
  CCT_VALUES,
  PATTERNS,
  applyAdvice,
  defaultTarget,
  demoRoom,
  fallbackAi,
  interpret,
  planeEquals,
  seed,
  slimIntents,
  targetEquals,
  type DemoRoomName,
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
import { ApiError, type ProjectView, type RoomSummary, type StudioApi } from '../api/client';
import { History, snapshotOf, type Snapshot } from './history';
import { acceptInterpreted, paintedIntent, type PaintTarget } from './paint';
import { cloneIntents, estimateDesign, replaceIntent, solveDesign } from './pipeline';

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
export const ESTIMATE_DELAY_MS = 120;
export const SAVE_DELAY_MS = 800;
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
  estimates: Record<string, IntentEstimate>;
  power: PowerSummary | null;
  /** Local revision the estimates were computed for. */
  estimateRevision: number;
  /** A full calculation (Phase 5) would be out of date. */
  calcStale: boolean;
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
  select(intentId: string | null, fixtureId?: string | null): void;
  setTool(tool: StudioTool): void;
  setOverlay(overlay: Overlay): void;

  undo(): void;
  redo(): void;

  setUnits(units: Units): void;
  dismissIssue(): void;
  dismissNotice(): void;
  /** Run any pending estimate now and save if there are unsaved changes. */
  flush(): Promise<void>;
  /** Resolves when the in-flight advice request (if any) has been applied. */
  adviceSettled(): Promise<void>;
}

export type StudioState = StudioData & StudioActions;
export type StudioStore = StoreApi<StudioState>;

export interface StoreDeps {
  api: StudioApi;
  now?: () => number;
  estimateDelay?: number;
  saveDelay?: number;
  units?: Units;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const initialData = (units: Units = 'imperial'): StudioData => ({
  screen: 'home',
  units,
  busy: null,
  error: null,
  projects: [],
  project: null,
  rooms: [],
  roomId: null,
  design: null,
  revision: 0,
  serverRevision: 0,
  savedRevision: 0,
  save: 'idle',
  estimates: {},
  power: null,
  estimateRevision: -1,
  calcStale: true,
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

export function createStudioStore(deps: StoreDeps): StudioStore {
  const { api } = deps;
  const now = deps.now ?? (() => Date.now());
  const estimateDelay = deps.estimateDelay ?? ESTIMATE_DELAY_MS;
  const saveDelay = deps.saveDelay ?? SAVE_DELAY_MS;
  const history = new History();

  let token = 0; // bumps whenever the open room changes; stale async results are dropped
  let estimateTimer: ReturnType<typeof setTimeout> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let saveAgain = false;
  let advising: Promise<void> = Promise.resolve();

  return createStore<StudioState>()((set, get) => {
    const historyFlags = () => ({ canUndo: history.canUndo, canRedo: history.canRedo });
    /** Selection that still exists in `design` (fixture ids change when an intent is re-laid). */
    const prunedSelection = (design: RoomDesign) => {
      const { selectedIntentId: id, selectedFixtureId: fid } = get();
      const i = id === null ? undefined : design.intents.find((x) => x.id === id);
      if (!i) return { selectedIntentId: null, selectedFixtureId: null };
      return { selectedIntentId: i.id, selectedFixtureId: fid !== null && i.fixtures.some((f) => f.id === fid) ? fid : null };
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
      if (!s.design) return;
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
      const revision = get().revision + 1;
      const design = solveDesign({ room: s.design.room, intents: dv.intents, removedExisting: dv.removedExisting }, revision);
      set({
        design,
        revision,
        savedRevision: revision,
        serverRevision: dv.revision,
        save: 'conflict',
        notice: conflictNotice(dv.revision),
        calcStale: true,
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
          });
          if (tok !== token) return;
          if (r.ok) set({ serverRevision: r.revision, savedRevision: rev, save: get().revision === rev ? 'saved' : 'pending' });
          else await reloadAfterConflict(tok);
        } catch (e) {
          if (tok === token) set({ save: 'error', notice: `Could not save this room: ${message(e)}` });
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
      const design = solveDesign({ room: s.design.room, ...next }, revision, s.design);
      set({ design, revision, save: 'pending', calcStale: true, ...historyFlags(), ...prunedSelection(design) });
      scheduleEstimate();
      scheduleSave();
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
        const n = applyAdvice(i, a);
        const solverInputs = !targetEquals(n.target, i.target) || !planeEquals(n.plane, i.plane);
        if (!solverInputs && n.label === i.label && n.targetReason === i.targetReason && n.behavior.cct === i.behavior.cct)
          return i;
        changed = true;
        resolve ||= solverInputs;
        return n;
      });
      if (!changed) return;
      if (resolve) {
        settle({ intents: next, removedExisting: s.design.removedExisting });
        return;
      }
      // label / reason / CCT only: no re-solve; keep the solved fixtures and the settled packages
      const room = s.design.room;
      const intents = next.map((n, k) => replaceIntent(room, s.design!.intents[k] as LightingIntent, n));
      set({ design: { ...s.design, intents, revision: s.revision + 1 }, revision: s.revision + 1, save: 'pending' });
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
        notice: null,
        selectedIntentId: null,
        selectedFixtureId: null,
        tool: 'Select',
        describing: false,
        ...historyFlags(),
      });
    };

    const guard = async <T>(busy: string, fn: () => Promise<T>): Promise<T | null> => {
      set({ busy, error: null });
      try {
        return await fn();
      } catch (e) {
        set({ error: message(e) });
        return null;
      } finally {
        set({ busy: null });
      }
    };

    const loadRooms = async (projectId: string) => set({ rooms: await api.listRooms(projectId) });

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
          await loadRooms(id);
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
        });
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
            calcStale: true,
            notice: null,
            ...historyFlags(),
          });
          if (!get().project || get().project?.id !== rv.projectId) {
            const projects = get().projects.length ? get().projects : await api.listProjects();
            set({ projects, project: projects.find((p) => p.id === rv.projectId) ?? null });
          }
          runEstimate();
        });
      },

      accept: (id) => {
        const ok = change(null, (d) => {
          const i = d.intents.find((x) => x.id === id);
          if (!i || !i.isSuggestion) return false;
          i.isSuggestion = false;
        });
        if (ok) adviseIntents([id]);
      },

      acceptAll: () => {
        const ids: string[] = [];
        change(null, (d) => {
          for (const i of d.intents)
            if (i.isSuggestion) {
              i.isSuggestion = false;
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
              break;
          }
        });
      },

      paintIntent: (kind, target) => {
        const s = get();
        if (!s.design) return null;
        const intent = paintedIntent(s.design.room, kind, target, new Set(s.design.intents.map((i) => i.id)));
        if (!intent) return null;
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
        const added = acceptInterpreted(room, list, get().design!.intents);
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

      flush: async () => {
        if (estimateTimer) runEstimate();
        await saveNow();
      },

      adviceSettled: () => advising,
    };
  });
}
