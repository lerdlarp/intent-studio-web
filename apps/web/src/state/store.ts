// The studio store (PLAN §2C, mirrors the original StudioViewModel). Per open room it holds one solved design.
//
// Every change: snapshot for undo (edits to the same field of the same intent within 1 s coalesce) → solve (core
// solveAll, via pipeline.ts) → bump revision → debounced estimate (estimateAll + power) → debounced autosave
// (PUT design with the server revision; 409 → reload and report) → calculation marked stale.
//
// Suggestions come from core `seed(room)` when a room has never been saved. Accepting turns `isSuggestion` off,
// re-solves, then asks /api/ai/advise and applies advice only to fields the designer has not edited.
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  DEMO_ROOM_NAMES,
  EMPTY_UUID,
  OFFLINE_ISSUE,
  applyAdvice,
  demoRoom,
  fallbackAi,
  planeEquals,
  seed,
  slimIntents,
  targetEquals,
  type DemoRoomName,
  type IntentAdvice,
  type IntentBehavior,
  type IntentEstimate,
  type LightingIntent,
  type PowerSummary,
  type RoomDesign,
  type StudioRoom,
  type TargetRange,
  type Workplane,
} from '@intent-studio/core';
import { ApiError, type ProjectView, type RoomSummary, type StudioApi } from '../api/client';
import { History, snapshotOf, type Snapshot } from './history';
import { cloneIntents, estimateDesign, replaceIntent, solveDesign } from './pipeline';

export type Units = 'imperial' | 'metric';
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';
export type Screen = 'home' | 'project' | 'room';

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
});

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
      const design = solveDesign({ room: s.design.room, ...next }, revision);
      set({ design, revision, save: 'pending', calcStale: true, ...historyFlags() });
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
