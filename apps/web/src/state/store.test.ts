import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_ISSUES,
  OFFLINE_ISSUE,
  advise,
  defaultCct,
  createFixture,
  createIntent,
  downlight6,
  makeSuggestion,
  p2,
  washRun,
  estimateAll,
  interpret,
  office,
  isNominal,
  productKey,
  productOf,
  seed,
  solveAll,
  type IntentAdvice,
  type LightingIntent,
  type RoomDesign,
  type StudioRoom,
} from '@intent-studio/core';
import { createApi, type AiReply, type DesignView, type StudioApi } from '../api/client';
import { COALESCE_MS } from './history';
import { issueBanner } from './display';
import {
  DENSITY_MAX,
  DENSITY_MIN,
  HAND_TUNED_PACKAGE_REASON,
  SAVE_DELAY_MS,
  ESTIMATE_DELAY_MS,
  createStudioStore,
  sanitizeBehavior,
  sanitizeTarget,
  type StudioStore,
} from './store';

const ROOM_ID = 'room-1';
const PROJECT = { id: 'p1', name: 'P', createdAt: 't', updatedAt: 't' };

interface Fake {
  api: StudioApi;
  puts: { revision: number; intents: LightingIntent[] }[];
  setAdvise(fn: (room: StudioRoom, intents: LightingIntent[]) => Promise<AiReply<IntentAdvice[]>>): void;
  setInterpret(fn: (room: StudioRoom, text: string) => Promise<AiReply<LightingIntent[]>>): void;
  setPropose(fn: (room: StudioRoom, current: { id: string; kind: string }[]) => Promise<AiReply<LightingIntent[]>>): void;
  proposeCalls: { id: string; kind: string }[][];
}

/** In-memory server: one project, one room (Office), revisioned design. */
function fakeApi(room: StudioRoom = office()): Fake {
  let revision = 0;
  let saved: DesignView = { roomId: ROOM_ID, revision: 0, intents: [], removedExisting: [], updatedAt: null };
  const puts: Fake['puts'] = [];
  let adviseFn = async (r: StudioRoom, intents: LightingIntent[]): Promise<AiReply<IntentAdvice[]>> => ({
    result: advise(r, intents),
    source: 'rules',
    lastIssue: OFFLINE_ISSUE,
  });
  let interpretFn = async (r: StudioRoom, text: string): Promise<AiReply<LightingIntent[]>> => ({
    result: interpret(r, text),
    source: 'rules',
    lastIssue: OFFLINE_ISSUE,
  });
  const proposeCalls: { id: string; kind: string }[][] = [];
  let proposeFn = async (r: StudioRoom, _current: { id: string; kind: string }[]): Promise<AiReply<LightingIntent[]>> => ({
    result: seed(r),
    source: 'rules',
    lastIssue: OFFLINE_ISSUE,
  });
  const roomView = { id: ROOM_ID, projectId: PROJECT.id, label: room.label, sourceAssetId: null, updatedAt: 't', createdAt: 't', room };
  const api: StudioApi = {
    listProjects: async () => [PROJECT],
    createProject: async () => PROJECT,
    listRooms: async () => [roomView],
    createRoom: async () => roomView,
    getRoom: async () => structuredClone(roomView),
    getDesign: async () => structuredClone(saved),
    putDesign: async (_id, body) => {
      puts.push(structuredClone(body));
      if (body.revision !== revision) return { ok: false, conflict: true, revision };
      revision++;
      saved = { roomId: ROOM_ID, revision, intents: body.intents, removedExisting: body.removedExisting, updatedAt: 't' };
      return { ok: true, revision };
    },
    uploadAsset: async () => {
      throw new Error('not used');
    },
    advise: (b) => adviseFn(b.room, b.intents),
    interpret: (b) => interpretFn(b.room, b.text),
    propose: (b) => {
      proposeCalls.push(b.intents);
      return proposeFn(b.room, b.intents);
    },
    classify: async () => ({ result: [], source: 'rules' }),
  };
  return {
    api,
    puts,
    proposeCalls,
    setAdvise: (fn) => (adviseFn = fn),
    setInterpret: (fn) => (interpretFn = fn),
    setPropose: (fn) => (proposeFn = fn),
  };
}

let clock = 0;
const now = () => clock;

async function openOffice(api: StudioApi): Promise<StudioStore> {
  const store = createStudioStore({ api, now });
  await store.getState().openRoom(ROOM_ID);
  return store;
}
const accepted = (s: StudioStore) => s.getState().design!.intents.filter((i) => !i.isSuggestion);
const suggestions = (s: StudioStore) => s.getState().design!.intents.filter((i) => i.isSuggestion);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});
afterEach(() => vi.useRealTimers());

describe('room open', () => {
  it('seeds suggestions for a never-saved room; they place nothing', async () => {
    const store = await openOffice(fakeApi().api);
    const s = store.getState();
    expect(s.screen).toBe('room');
    expect(suggestions(store).map((i) => i.label)).toEqual(seed(office()).map((i) => i.label));
    expect(s.design!.intents.every((i) => i.fixtures.length === 0)).toBe(true);
    expect(s.canUndo).toBe(false);
    expect(s.save).toBe('idle');
  });
});

describe('accept all (Office demo room)', () => {
  it('solves, and every intent gets an estimate', async () => {
    const fake = fakeApi();
    const store = await openOffice(fake.api);
    const n = suggestions(store).length;
    expect(n).toBeGreaterThan(0);
    store.getState().acceptAll();
    const s = store.getState();
    expect(suggestions(store)).toHaveLength(0);
    expect(accepted(store)).toHaveLength(n);
    expect(s.revision).toBe(1);
    expect(s.calcStale).toBe(true);
    expect(accepted(store).some((i) => i.fixtures.length > 0)).toBe(true);
    expect(s.estimateRevision).toBeLessThan(s.revision); // debounced

    await vi.advanceTimersByTimeAsync(ESTIMATE_DELAY_MS);
    await store.getState().adviceSettled();
    await vi.advanceTimersByTimeAsync(ESTIMATE_DELAY_MS);
    const t = store.getState();
    expect(t.estimateRevision).toBe(t.revision);
    for (const i of t.design!.intents) {
      const e = t.estimates[i.id];
      expect(e, i.label).toBeDefined();
      expect(Number.isFinite(e!.average)).toBe(true);
      expect(e!.fixtures).toBe(i.fixtures.length);
    }
    expect(t.power!.watts).toBeGreaterThan(0);
    expect(t.power!.lpd).toBeGreaterThan(0);

    // same numbers as running the core pipeline directly (deterministic, settled packages kept)
    const ref: RoomDesign = {
      room: office(),
      intents: seed(office()).map((i) => ({ ...i, isSuggestion: false })),
      removedExisting: [],
      calculation: null,
      revision: 0,
    };
    solveAll(ref);
    const refEst = estimateAll(ref, productOf);
    ref.intents.forEach((i, k) => {
      const mine = t.design!.intents[k]!;
      expect(mine.fixtures.length).toBe(i.fixtures.length);
      expect(t.estimates[mine.id]!.average).toBeCloseTo(refEst.get(i.id)!.average, 9);
    });
  });

  it('surfaces lastIssue from advise and autosaves with the server revision', async () => {
    const fake = fakeApi();
    const store = await openOffice(fake.api);
    store.getState().acceptAll();
    await store.getState().adviceSettled();
    expect(store.getState().aiIssue).toBe(OFFLINE_ISSUE);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0]!.revision).toBe(0);
    expect(fake.puts[0]!.intents.every((i) => i.trace.length === 0)).toBe(true); // slimmed
    expect(store.getState().serverRevision).toBe(1);
    expect(store.getState().save).toBe('saved');
  });

  it('falls back to local rules when the advise call fails', async () => {
    const fake = fakeApi();
    fake.setAdvise(() => Promise.reject(new TypeError('Failed to fetch')));
    const store = await openOffice(fake.api);
    store.getState().acceptAll();
    await store.getState().adviceSettled();
    expect(store.getState().aiIssue).toBe(OFFLINE_ISSUE);
  });

  it('undo / redo restores and re-solves', async () => {
    const store = await openOffice(fakeApi().api);
    const before = store.getState().design!.intents.map((i) => i.id);
    store.getState().acceptAll();
    await store.getState().adviceSettled();
    const fixtureCount = accepted(store).reduce((n, i) => n + i.fixtures.length, 0);
    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(suggestions(store).map((i) => i.id)).toEqual(before);
    expect(store.getState().design!.intents.every((i) => i.fixtures.length === 0)).toBe(true);
    expect(store.getState().canRedo).toBe(true);
    store.getState().redo();
    expect(accepted(store)).toHaveLength(before.length);
    expect(accepted(store).reduce((n, i) => n + i.fixtures.length, 0)).toBe(fixtureCount);
  });
});

describe('undo coalescing', () => {
  it('coalesces edits to the same field of the same intent within 1 s', async () => {
    const store = await openOffice(fakeApi().api);
    store.getState().acceptAll();
    await store.getState().adviceSettled();
    const [a, b] = accepted(store);
    const original = a!.label;
    expect(store.getState().canUndo).toBe(true);

    const ed = (id: string, label: string, dt: number) => {
      clock += dt;
      store.getState().editIntent(id, { field: 'label', value: label });
    };
    ed(a!.id, 'D', 0);
    ed(a!.id, 'De', 300);
    ed(a!.id, 'Des', 300);
    ed(a!.id, 'Desks', COALESCE_MS - 1); // still within 1 s of the previous edit
    expect(accepted(store)[0]!.label).toBe('Desks');
    expect(accepted(store)[0]!.labelSuggested).toBe(false);

    // a different intent, then a different field, are their own steps
    ed(b!.id, 'Other', 10);
    clock += 10;
    store.getState().editIntent(a!.id, { field: 'targetReason', value: 'mine' });

    store.getState().undo(); // targetReason
    expect(accepted(store)[0]!.targetReason).not.toBe('mine');
    expect(accepted(store)[0]!.label).toBe('Desks');
    store.getState().undo(); // b label
    expect(accepted(store)[1]!.label).toBe(b!.label);
    store.getState().undo(); // the whole coalesced run
    expect(accepted(store)[0]!.label).toBe(original);
    expect(accepted(store)[0]!.labelSuggested).toBe(true);
    store.getState().undo(); // accept all
    expect(accepted(store)).toHaveLength(0);
    expect(store.getState().canUndo).toBe(false);
  });

  it('starts a new step after more than 1 s', async () => {
    const store = await openOffice(fakeApi().api);
    store.getState().acceptAll();
    await store.getState().adviceSettled();
    const a = accepted(store)[0]!;
    store.getState().editIntent(a.id, { field: 'label', value: 'One' });
    clock += COALESCE_MS + 1;
    store.getState().editIntent(a.id, { field: 'label', value: 'Two' });
    store.getState().undo();
    expect(accepted(store)[0]!.label).toBe('One');
    store.getState().undo();
    expect(accepted(store)[0]!.label).toBe(a.label);
  });
});

describe('advice: designer edits win', () => {
  it('applies advice only to untouched fields and re-solves when target/plane change', async () => {
    const fake = fakeApi();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake.setAdvise(async (room, intents) => {
      await gate;
      return {
        source: 'ai',
        result: advise(room, intents).map((a) => ({
          ...a,
          label: `Agent ${a.label}`.slice(0, 40),
          target: { minimum: null, average: 42, maximum: null },
          reason: 'agent reason',
          plane: { ...a.plane, height: a.plane.kind === 'Horizontal' ? 3 : a.plane.height },
        })),
      };
    });
    const store = await openOffice(fake.api);
    const [first, second] = suggestions(store);
    store.getState().accept(first!.id);
    store.getState().accept(second!.id);
    // the designer edits the first intent's label and target before the agent answers
    store.getState().editIntent(first!.id, { field: 'label', value: 'My desks' });
    store.getState().editIntent(first!.id, { field: 'target', value: { minimum: 20, average: 30, maximum: null } });
    const revBefore = store.getState().revision;

    release();
    await store.getState().adviceSettled();
    const s = store.getState();
    expect(s.aiIssue).toBeNull();
    const a = s.design!.intents.find((i) => i.id === first!.id)!;
    const b = s.design!.intents.find((i) => i.id === second!.id)!;
    expect(a.label).toBe('My desks');
    expect(a.target).toEqual({ minimum: 20, average: 30, maximum: null });
    expect(a.targetReason).not.toBe('agent reason');
    expect(b.label.startsWith('Agent ')).toBe(true);
    expect(b.target.average).toBe(42);
    expect(b.targetReason).toBe('agent reason');
    expect(s.revision).toBeGreaterThan(revBefore); // re-solved
    expect(b.fixtures.length).toBeGreaterThan(0);
  });

  it('label-only advice keeps fixtures and settled packages without re-solving', async () => {
    const fake = fakeApi();
    fake.setAdvise(async (room, intents) => ({
      source: 'ai',
      result: advise(room, intents).map((a) => ({ ...a, label: 'Agent label' })),
    }));
    const store = await openOffice(fake.api);
    store.getState().acceptAll();
    await vi.advanceTimersByTimeAsync(ESTIMATE_DELAY_MS);
    const est = structuredClone(store.getState().estimates);
    await store.getState().adviceSettled();
    await vi.advanceTimersByTimeAsync(ESTIMATE_DELAY_MS);
    const s = store.getState();
    expect(accepted(store).every((i) => i.label === 'Agent label')).toBe(true);
    for (const [id, e] of Object.entries(est)) expect(s.estimates[id]).toEqual(e);
  });
});

describe('autosave conflict (mocked fetch)', () => {
  it('on 409 reloads the saved design and reports it', async () => {
    const room = { ...office(), id: '00000000-0000-0000-0000-0000000000aa' };
    const serverIntent = { ...seed(room)[0]!, isSuggestion: false, label: 'Saved elsewhere', labelSuggested: false };
    let designCalls = 0;
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, body });
      if (method === 'GET' && url === `/api/rooms/${room.id}`)
        return json(200, { id: room.id, projectId: 'p1', label: room.label, room, sourceAssetId: null, createdAt: 't', updatedAt: 't' });
      if (method === 'GET' && url === `/api/rooms/${room.id}/design`) {
        designCalls++;
        return designCalls === 1
          ? json(200, { roomId: room.id, revision: 0, intents: [], removedExisting: [], updatedAt: null })
          : json(200, { roomId: room.id, revision: 5, intents: [serverIntent], removedExisting: [], updatedAt: 't' });
      }
      if (method === 'GET' && url === '/api/projects') return json(200, [PROJECT]);
      if (method === 'PUT' && url === `/api/rooms/${room.id}/design`) return json(409, { error: 'stale revision', revision: 5 });
      if (method === 'POST' && url === '/api/ai/advise') {
        const b = body as { room: StudioRoom; intents: LightingIntent[] };
        return json(200, { result: advise(b.room, b.intents), source: 'rules', lastIssue: OFFLINE_ISSUE });
      }
      return json(404, { error: 'not found' });
    });
    const store = createStudioStore({ api: createApi(fetchMock), now });
    await store.getState().openRoom(room.id);
    store.getState().acceptAll();
    await store.getState().adviceSettled();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    await vi.waitFor(() => expect(store.getState().save).toBe('conflict'));

    const put = calls.find((c) => c.method === 'PUT')!;
    expect((put.body as { revision: number }).revision).toBe(0);
    const s = store.getState();
    expect(s.serverRevision).toBe(5);
    expect(s.notice).toMatch(/revision 5/);
    expect(s.design!.intents.map((i) => i.label)).toEqual(['Saved elsewhere']);
    expect(s.design!.intents[0]!.fixtures.length).toBeGreaterThan(0); // re-solved
    expect(s.canUndo).toBe(false);
    expect(s.aiIssue).toBe(OFFLINE_ISSUE);

    // no save loop: the reloaded design counts as saved
    const puts = calls.filter((c) => c.method === 'PUT').length;
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3);
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(puts);

    // the next change saves against the reloaded revision
    store.getState().editIntent(s.design!.intents[0]!.id, { field: 'label', value: 'Mine again' });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    const last = calls.filter((c) => c.method === 'PUT').at(-1)!;
    expect((last.body as { revision: number }).revision).toBe(5);
  });
});

// ---- Phase 3: plan actions --------------------------------------------------------------------------------------

async function officeAccepted(fake: Fake = fakeApi()): Promise<StudioStore> {
  const store = await openOffice(fake.api);
  store.getState().acceptAll();
  await store.getState().adviceSettled();
  return store;
}
const intentOf = (s: StudioStore, id: string) => s.getState().design!.intents.find((i) => i.id === id)!;
const EAST_WALL = 1;

describe('paintIntent', () => {
  it('a wash painted on a wall: core label / target / plane, accepted, solved, estimated', async () => {
    const store = await officeAccepted();
    const id = store.getState().paintIntent('WallWash', { wallIndex: EAST_WALL })!;
    expect(id).toBeTruthy();
    const i = intentOf(store, id);
    const ref = makeSuggestion(office(), 'WallWash', washRun(office(), EAST_WALL), EAST_WALL, null);
    expect(i.isSuggestion).toBe(false);
    expect(i.label).toBe(ref.label);
    expect(i.label).toBe('Screen wash'); // the east wall holds the screen (core wash label)
    expect(i.labelSuggested).toBe(true);
    expect(i.target).toEqual(ref.target);
    expect(i.targetReason).toBe(ref.targetReason);
    expect(i.plane).toEqual(ref.plane);
    expect(i.region).toEqual(ref.region);
    expect(i.wallIndex).toBe(EAST_WALL);
    expect(i.fixtures.length).toBeGreaterThan(0);
    expect(store.getState().selectedIntentId).toBe(id);
    await store.getState().adviceSettled();
    await vi.advanceTimersByTimeAsync(ESTIMATE_DELAY_MS);
    expect(store.getState().estimates[id]!.fixtures).toBe(intentOf(store, id).fixtures.length);
    // one undo step removes it
    store.getState().undo();
    expect(store.getState().design!.intents.some((x) => x.id === id)).toBe(false);
    expect(store.getState().selectedIntentId).toBeNull();
  });

  it('area kinds from a rect region; accents from an object or a point; bad input makes nothing', async () => {
    const store = await officeAccepted();
    const room = office();
    const region = [p2(2, 2), p2(14, 2), p2(14, 9), p2(2, 9)];
    const task = intentOf(store, store.getState().paintIntent('Task', { region })!);
    const ref = makeSuggestion(room, 'Task', region, null, null);
    expect([task.label, task.target, task.plane]).toEqual([ref.label, ref.target, ref.plane]);

    const accent = intentOf(store, store.getState().paintIntent('Accent', { objectIndex: 6 })!);
    expect(accent.label).toBe('Brand wall accent');
    expect(accent.objectIndex).toBe(6);
    const pt = intentOf(store, store.getState().paintIntent('Accent', { point: p2(20, 12) })!);
    expect(pt.region).toEqual([p2(20, 12)]);
    expect(pt.label).toBe(makeSuggestion(room, 'Accent', [p2(20, 12)], null, null).label);

    const rev = store.getState().revision;
    expect(store.getState().paintIntent('WallWash', { wallIndex: 99 })).toBeNull();
    expect(store.getState().paintIntent('Task', { region: [p2(0, 0), p2(0.1, 0), p2(0.1, 0.1)] })).toBeNull();
    expect(store.getState().paintIntent('Ambient', { wallIndex: 0 })).toBeNull();
    expect(store.getState().revision).toBe(rev);
  });
});

describe('moveFixture (pinning)', () => {
  it('pins the fixture, marks the intent hand-tuned, and the pin survives re-solves and undo / redo', async () => {
    const store = await officeAccepted();
    const ambient = accepted(store).find((i) => i.kind === 'Ambient')!;
    const f = ambient.fixtures[0]!;
    const to = p2(f.center.x + 1.25, f.center.y + 0.75);
    expect(store.getState().moveFixture(ambient.id, f.id, to)).toBe(true);
    const moved = () => intentOf(store, ambient.id).fixtures.find((x) => x.id === f.id);
    expect(moved()!.center).toEqual(to);
    expect(moved()!.pinned).toBe(true);
    expect(intentOf(store, ambient.id).handTuned).toBe(true);
    expect(intentOf(store, ambient.id).trace.join(' ')).toMatch(/hand-tuned/);
    expect(store.getState().selectedFixtureId).toBe(f.id);
    const count = intentOf(store, ambient.id).fixtures.length;

    // re-solve via another intent's behaviour change
    const task = accepted(store).find((i) => i.kind === 'Task')!;
    clock += 5000;
    store.getState().setBehavior(task.id, { density: 1.4 });
    expect(intentOf(store, task.id).behavior.density).toBe(1.4);
    expect(moved()!.center).toEqual(to);
    expect(moved()!.pinned).toBe(true);
    expect(intentOf(store, ambient.id).fixtures).toHaveLength(count);

    // the hand-tuned intent keeps its settled package (estimate uses the same product as before the move)
    await vi.advanceTimersByTimeAsync(ESTIMATE_DELAY_MS);
    expect(store.getState().estimates[ambient.id]!.watts).toBeCloseTo(
      productOf(office(), ambient).watts * count,
      9,
    );

    store.getState().undo(); // density
    store.getState().undo(); // move
    expect(intentOf(store, ambient.id).handTuned).toBe(false);
    expect(intentOf(store, ambient.id).fixtures.some((x) => x.pinned)).toBe(false);
    store.getState().redo();
    expect(moved()!.center).toEqual(to);
    expect(moved()!.pinned).toBe(true);
  });

  it('releaseHandTuned gives the intent back to the solver', async () => {
    const store = await officeAccepted();
    const ambient = accepted(store).find((i) => i.kind === 'Ambient')!;
    const f = ambient.fixtures[0]!;
    store.getState().moveFixture(ambient.id, f.id, p2(f.center.x + 2, f.center.y));
    expect(store.getState().releaseHandTuned(ambient.id)).toBe(true);
    const i = intentOf(store, ambient.id);
    expect(i.handTuned).toBe(false);
    expect(i.fixtures.every((x) => !x.pinned)).toBe(true);
    expect(i.fixtures.map((x) => x.center)).toEqual(ambient.fixtures.map((x) => x.center)); // deterministic re-lay
    expect(store.getState().releaseHandTuned(ambient.id)).toBe(false);
  });

  it('a hand-tuned intent keeps its settled lumen package after a reload; release gives it back', async () => {
    const fake = fakeApi();
    const store = await officeAccepted(fake);
    // an intent whose settled package is not its family's nominal, so losing it would show
    const room = office();
    const tuned = accepted(store).find((i) => i.fixtures.length > 0 && !isNominal(productOf(room, i)))!;
    expect(tuned).toBeDefined();
    const settled = productOf(room, tuned);
    const f = tuned.fixtures[0]!;
    store.getState().moveFixture(tuned.id, f.id, p2(f.center.x + 1, f.center.y));
    const choice = intentOf(store, tuned.id).product!;
    expect(choice.agentPicked).toBe(true);
    expect(choice.reason).toBe(HAND_TUNED_PACKAGE_REASON);
    expect(productKey(choice.product)).toBe(productKey(settled));
    await store.getState().flush();
    const count = intentOf(store, tuned.id).fixtures.length;

    // a fresh page load: new store, same server
    const reloaded = createStudioStore({ api: fake.api, now });
    await reloaded.getState().openRoom(ROOM_ID);
    const back = intentOf(reloaded, tuned.id);
    expect(back.handTuned).toBe(true);
    expect(back.fixtures).toHaveLength(count);
    expect(productKey(productOf(room, back))).toBe(productKey(settled));
    expect(reloaded.getState().estimates[tuned.id]!.watts).toBeCloseTo(settled.watts * count, 9);

    // release: the stored choice goes, the solver picks the package again
    expect(reloaded.getState().releaseHandTuned(tuned.id)).toBe(true);
    expect(intentOf(reloaded, tuned.id).product).toBeNull();
    expect(intentOf(reloaded, tuned.id).handTuned).toBe(false);
  });

  it('ignores unknown fixtures, suggestions and non-finite positions', async () => {
    const store = await openOffice(fakeApi().api);
    const sug = suggestions(store)[0]!;
    expect(store.getState().moveFixture(sug.id, 'nope', p2(1, 1))).toBe(false);
    expect(store.getState().moveFixture(sug.id, 'nope', p2(Number.NaN, 1))).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('intent edits', () => {
  it('setBehavior clamps and drops values that are not allowed', () => {
    expect(sanitizeBehavior({ density: 3, quantity: 2.6, cct: 4100 as never, pattern: 'zigzag' as never })).toEqual({
      density: DENSITY_MAX,
      quantity: 3,
    });
    expect(sanitizeBehavior({ density: 0.1, mountingHeight: null, keepDimMargin: -4, aimAngle: 400, cct: 3000 })).toEqual({
      density: DENSITY_MIN,
      mountingHeight: null,
      keepDimMargin: 0,
      aimAngle: 90,
      cct: 3000,
    });
    expect(sanitizeTarget({ minimum: 40, average: 30, maximum: null })).toBeNull();
    expect(sanitizeTarget({ minimum: Number.NaN, average: 30, maximum: null })).toBeNull();
    expect(sanitizeTarget({ minimum: null, average: 300, maximum: null })).toEqual({ minimum: null, average: 200, maximum: null });
  });

  it('setBehavior re-solves (fixed quantity)', async () => {
    const store = await officeAccepted();
    const ambient = accepted(store).find((i) => i.kind === 'Ambient')!;
    store.getState().setBehavior(ambient.id, { quantity: 6, cct: 3500 });
    const i = intentOf(store, ambient.id);
    expect(i.behavior).toMatchObject({ quantity: 6, cct: 3500 });
    expect(i.fixtures.length).not.toBe(ambient.fixtures.length);
    clock += 5000;
    store.getState().setBehavior(ambient.id, { pattern: 'rows' });
    expect(intentOf(store, ambient.id).behavior.pattern).toBe('rows');
  });

  it('setTarget / setLabel / setPlane survive later advice; resetTarget goes back to the suggestion', async () => {
    const fake = fakeApi();
    const store = await officeAccepted(fake);
    const task = accepted(store).find((i) => i.kind === 'Task')!;
    const original = { target: task.target, reason: task.targetReason };
    expect(store.getState().setTarget(task.id, { minimum: 20, average: 35, maximum: 60 }, 'my reason')).toBe(true);
    expect(store.getState().setTarget(task.id, { minimum: 50, average: 35, maximum: 60 })).toBe(false);
    store.getState().setLabel(task.id, '  Hot desks  ');
    const plane = { ...task.plane, height: 3 };
    store.getState().setPlane(task.id, plane);

    // the agent now advises everything
    fake.setAdvise(async (room, intents) => ({
      source: 'ai',
      result: advise(room, intents).map((a) => ({
        ...a,
        label: 'Agent label',
        target: { minimum: null, average: 99, maximum: null },
        reason: 'agent',
        plane: { ...a.plane, height: 1 },
      })),
    }));
    const wash = store.getState().paintIntent('WallWash', { wallIndex: EAST_WALL })!;
    // advise the task too (painted intents are advised along with the first accepted ones)
    store.getState().resetTarget(wash);
    await store.getState().adviceSettled();
    const t = intentOf(store, task.id);
    expect(t.target).toEqual({ minimum: 20, average: 35, maximum: 60 });
    expect(t.targetReason).toBe('my reason');
    expect(t.targetEdited).toBe(true);
    expect(t.label).toBe('Hot desks');
    expect(t.labelSuggested).toBe(false);
    expect(t.plane.height).toBe(3);
    expect(t.plane.inferred).toBe(false);
    const w = intentOf(store, wash);
    expect(w.label).toBe('Agent label'); // untouched fields take advice
    expect(w.target.average).toBe(99);

    // reset: back to the core suggestion, then advice may refine it again
    fake.setAdvise(async (room, intents) => ({ source: 'rules', result: advise(room, intents) }));
    store.getState().resetTarget(task.id);
    await store.getState().adviceSettled();
    const r = intentOf(store, task.id);
    expect(r.targetEdited).toBe(false);
    expect(r.target).toEqual(original.target);
    expect(r.targetReason).toBe(original.reason);
    expect(r.label).toBe('Hot desks'); // still the designer's
  });

  it('setProduct chooses (and clears) a product; the solver uses it', async () => {
    const store = await officeAccepted();
    const ambient = accepted(store).find((i) => i.kind === 'Ambient')!;
    const product = { ...downlight6(), productId: '11111111-2222-4333-8444-555555555555', label: 'My downlight' };
    store.getState().setProduct(ambient.id, product);
    expect(intentOf(store, ambient.id).product!.product.label).toBe('My downlight');
    expect(intentOf(store, ambient.id).product!.agentPicked).toBe(false);
    await vi.advanceTimersByTimeAsync(ESTIMATE_DELAY_MS);
    expect(store.getState().estimates[ambient.id]!.watts).toBeCloseTo(product.watts * intentOf(store, ambient.id).fixtures.length, 9);
    clock += 5000;
    store.getState().setProduct(ambient.id, null);
    expect(intentOf(store, ambient.id).product).toBeNull();
  });
});

describe('describe', () => {
  it('adds the interpreted intents from the server', async () => {
    const fake = fakeApi();
    const store = await officeAccepted(fake);
    const ids = await store.getState().describe('wash the east wall');
    expect(ids).toHaveLength(1);
    const i = intentOf(store, ids[0]!);
    expect(i).toMatchObject({ kind: 'WallWash', wallIndex: EAST_WALL, isSuggestion: false });
    expect(i.fixtures.length).toBeGreaterThan(0);
    expect(store.getState().selectedIntentId).toBe(ids[0]);
    // already there: nothing new
    expect(await store.getState().describe('wash the east wall')).toEqual([]);
    expect(store.getState().notice).toMatch(/Nothing new/);
  });

  it('falls back to the offline interpreter when the server cannot be reached', async () => {
    const fake = fakeApi();
    fake.setInterpret(() => Promise.reject(new TypeError('Failed to fetch')));
    const store = await openOffice(fake.api);
    const ids = await store.getState().describe('wash the east wall');
    expect(ids).toHaveLength(1);
    expect(store.getState().aiIssue).toBe(OFFLINE_ISSUE);
    expect(intentOf(store, ids[0]!).label).toBe(interpret(office(), 'wash the east wall')[0]!.label);
  });

  it('treats server rows as untrusted: indices, fixtures, ids', async () => {
    const fake = fakeApi();
    const bogus = createIntent({
      id: 'x',
      kind: 'Accent',
      region: [p2(5, 5)],
      wallIndex: 42,
      objectIndex: -3,
      isSuggestion: true,
      handTuned: true,
      fixtures: [createFixture({ pinned: true })],
    });
    fake.setInterpret(async () => ({ source: 'ai', result: [bogus, { ...bogus }] }));
    const store = await officeAccepted(fake);
    const ids = await store.getState().describe('anything');
    expect(ids).toHaveLength(1); // the duplicate is dropped
    const i = intentOf(store, ids[0]!);
    expect(i).toMatchObject({ wallIndex: null, objectIndex: null, isSuggestion: false, handTuned: false });
    expect(i.fixtures.every((f) => !f.pinned)).toBe(true);
  });
});

describe('view state', () => {
  it('select / tool / overlay; selection is pruned when its intent goes away', async () => {
    const store = await officeAccepted();
    const a = accepted(store)[0]!;
    store.getState().select(a.id, a.fixtures[0]!.id);
    expect(store.getState()).toMatchObject({ selectedIntentId: a.id, selectedFixtureId: a.fixtures[0]!.id });
    store.getState().select('missing');
    expect(store.getState().selectedIntentId).toBeNull();
    store.getState().setTool('WallWash');
    store.getState().setOverlay('heatmap');
    expect(store.getState()).toMatchObject({ tool: 'WallWash', overlay: 'heatmap' });
    store.getState().select(a.id);
    store.getState().removeIntent(a.id);
    expect(store.getState().selectedIntentId).toBeNull();
    const rev = store.getState().revision;
    store.getState().setOverlay('none');
    expect(store.getState().revision).toBe(rev); // view state is not a design change
  });
});

// ---- Phase 4: CCT, advise audit, "Suggest a design", lastIssue ------------------------------------------------------

/** Agent advice that tries to change every field of every intent. */
const greedyAdvice = (room: StudioRoom, intents: LightingIntent[]): IntentAdvice[] =>
  advise(room, intents).map((a) => ({
    ...a,
    label: 'Agent label',
    target: a.target.average !== null ? { minimum: null, average: 41, maximum: null } : a.target,
    reason: 'agent reason',
    plane:
      a.plane.kind === 'Horizontal'
        ? { ...a.plane, height: 3.25, inferred: true, reason: 'Agent: 3′-3″ plane' }
        : { ...a.plane, bottom: 0.5, top: 8.5, inferred: true, reason: 'Agent: wall' },
    cct: 2700,
  }));

describe('CCT defaults', () => {
  it('accepting a suggestion gives it the default CCT (suggested); KeepDim gets none', async () => {
    const store = await openOffice(fakeApi().api);
    store.getState().acceptAll();
    for (const i of accepted(store)) {
      const want = defaultCct(office(), i);
      expect(i.behavior.cct, i.label).toBe(want ?? undefined);
      expect(i.cctSuggested, i.label).toBe(want === null ? undefined : true);
    }
    expect(accepted(store).some((i) => i.behavior.cct === 3500)).toBe(true); // office ambient
  });

  it('a painted intent gets its default CCT; a designer CCT is kept and marked as the designer’s', async () => {
    const store = await openOffice(fakeApi().api);
    const id = store.getState().paintIntent('WallWash', { wallIndex: 1 })!;
    const i = () => store.getState().design!.intents.find((x) => x.id === id)!;
    expect(i().behavior.cct).toBe(3000);
    expect(i().cctSuggested).toBe(true);
    store.getState().setBehavior(id, { cct: 4000 });
    expect(i().behavior.cct).toBe(4000);
    expect(i().cctSuggested).toBe(false);
    // "Automatic" goes back to the suggested default
    store.getState().setBehavior(id, { cct: undefined });
    expect(i().behavior.cct).toBe(3000);
    expect(i().cctSuggested).toBe(true);
  });

  it('advice may replace a suggested CCT, never a designer CCT', async () => {
    const fake = fakeApi();
    fake.setAdvise(async (room, intents) => ({ source: 'ai', result: advise(room, intents).map((a) => ({ ...a, cct: 5000 as const })) }));
    const store = await openOffice(fake.api);
    const [a, b] = suggestions(store);
    store.getState().accept(a!.id);
    store.getState().accept(b!.id);
    store.getState().setBehavior(a!.id, { cct: 2700 });
    await store.getState().adviceSettled();
    const get = (id: string) => store.getState().design!.intents.find((x) => x.id === id)!;
    expect(get(a!.id).behavior.cct).toBe(2700);
    expect(get(a!.id).cctSuggested).toBe(false);
    expect(get(b!.id).behavior.cct).toBe(5000);
    expect(get(b!.id).cctSuggested).toBe(true);
  });
});

describe('advise audit: nothing the designer edited is ever changed', () => {
  type Edit = (store: StudioStore, id: string) => void;
  type Check = (before: LightingIntent, after: LightingIntent) => void;
  const cases: [string, Edit, Check][] = [
    [
      'label',
      (st, id) => st.getState().setLabel(id, 'My label'),
      (_b, a) => {
        expect(a.label).toBe('My label');
        expect(a.labelSuggested).toBe(false);
      },
    ],
    [
      'target',
      (st, id) => void st.getState().setTarget(id, { minimum: 11, average: 22, maximum: 44 }, 'typed'),
      (_b, a) => {
        expect(a.target).toEqual({ minimum: 11, average: 22, maximum: 44 });
        expect(a.targetReason).toBe('typed');
      },
    ],
    [
      'plane',
      (st, id) => {
        const i = st.getState().design!.intents.find((x) => x.id === id)!;
        st.getState().setPlane(id, { ...i.plane, height: 2.75 });
      },
      (_b, a) => {
        expect(a.plane.height).toBe(2.75);
        expect(a.plane.inferred).toBe(false);
      },
    ],
    [
      'cct',
      (st, id) => st.getState().setBehavior(id, { cct: 3000 }),
      (_b, a) => {
        expect(a.behavior.cct).toBe(3000);
        expect(a.cctSuggested).toBe(false);
      },
    ],
  ];

  it.each(cases)('%s: kept through accept advice, a re-advise (resetTarget) and paint advice', async (field, edit, check) => {
    const fake = fakeApi();
    fake.setAdvise(async (room, intents) => ({ source: 'ai', result: greedyAdvice(room, intents) }));
    const store = await openOffice(fake.api);
    const task = suggestions(store).find((i) => i.kind === 'Task')!;
    store.getState().accept(task.id);
    edit(store, task.id); // edited before the agent answers
    await store.getState().adviceSettled();
    const get = () => store.getState().design!.intents.find((x) => x.id === task.id)!;
    const before = structuredClone(get());
    check(before, get());

    // the other fields did take the advice
    const after = get();
    if (field !== 'label') expect(after.label).toBe('Agent label');
    if (field !== 'target') expect(after.target.average).toBe(41);
    if (field !== 'plane') expect(after.plane.height).toBe(3.25);
    if (field !== 'cct') expect(after.behavior.cct).toBe(2700);

    // more advice rounds (re-advise of this intent when another field resets; advice for a new painted intent)
    if (field !== 'target') store.getState().resetTarget(task.id);
    store.getState().paintIntent('Ambient', { region: [p2(1, 1), p2(6, 1), p2(6, 6), p2(1, 6)] });
    await store.getState().adviceSettled();
    check(before, get());
  });

  it('re-solves when advice changes the plane only; label/cct-only advice does not re-solve', async () => {
    const fake = fakeApi();
    let mode: 'plane' | 'label' = 'label';
    fake.setAdvise(async (room, intents) => ({
      source: 'ai',
      result: advise(room, intents).map((a) =>
        mode === 'plane' && a.plane.kind === 'Horizontal'
          ? { ...a, plane: { ...a.plane, height: 3.5, inferred: true, reason: 'Agent: bar' } }
          : { ...a, label: 'Agent only label', cct: 3500 as const },
      ),
    }));
    const store = await openOffice(fake.api);
    const task = suggestions(store).find((i) => i.kind === 'Task')!;
    store.getState().accept(task.id);
    const solved = store.getState().design!.intents.find((x) => x.id === task.id)!;
    await store.getState().adviceSettled();
    let now = store.getState().design!.intents.find((x) => x.id === task.id)!;
    expect(now.label).toBe('Agent only label');
    expect(now.fixtures).toEqual(solved.fixtures); // not re-solved: same fixture ids
    mode = 'plane';
    store.getState().resetTarget(task.id);
    await store.getState().adviceSettled();
    now = store.getState().design!.intents.find((x) => x.id === task.id)!;
    expect(now.plane.height).toBe(3.5);
    expect(now.fixtures.map((f) => f.id)).not.toEqual(solved.fixtures.map((f) => f.id));
  });
});

describe('Suggest a design', () => {
  const agentReply = (room: StudioRoom): LightingIntent[] => {
    const wash = makeSuggestion(room, 'WallWash', washRun(room, 0), 0, null);
    return [
      { ...wash, isSuggestion: true, behavior: { ...wash.behavior, cct: 3000 }, trace: ['Agent: Warm the south wall', 'Rule: x'] },
      {
        ...createIntent({ kind: 'Ambient', region: [p2(0, 0), p2(10, 0), p2(10, 10), p2(0, 10)], label: 'Bad', isSuggestion: true }),
        objectIndex: 999,
        fixtures: [createFixture({ center: p2(1, 1) })],
        behavior: { ...createIntent().behavior, cct: 4100 as never },
        trace: ['Agent: General light'],
      },
    ];
  };

  it('agent suggestions replace only the open suggestions; accepted intents stay; rationale and source shown', async () => {
    const fake = fakeApi();
    fake.setPropose(async (room) => ({ source: 'ai', result: agentReply(room) }));
    const store = await openOffice(fake.api);
    expect(store.getState().suggestionSource).toBe('rules');
    const keep = suggestions(store)[0]!;
    store.getState().accept(keep.id);
    store.getState().setLabel(keep.id, 'Mine');
    const ids = await store.getState().suggestDesign();
    const s = store.getState();
    expect(s.suggestionSource).toBe('ai');
    expect(s.aiIssue).toBeNull();
    expect(fake.proposeCalls[0]!.map((i) => i.id)).toEqual([keep.id]); // only accepted intents are sent
    expect(suggestions(store).map((i) => i.id)).toEqual(ids);
    expect(ids).toHaveLength(2);
    const [wash, amb] = suggestions(store);
    expect(s.rationale).toEqual({ [wash!.id]: 'Agent: Warm the south wall', [amb!.id]: 'Agent: General light' });
    expect(wash!.behavior.cct).toBe(3000);
    expect(wash!.cctSuggested).toBe(true);
    expect(amb!.objectIndex).toBeNull();
    expect(amb!.fixtures).toEqual([]);
    expect(amb!.behavior.cct).toBe(3500); // invalid CCT → office ambient default
    const kept = accepted(store);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.label).toBe('Mine');
    // accepting an agent suggestion keeps its CCT
    store.getState().accept(wash!.id);
    expect(accepted(store).find((i) => i.id === wash!.id)!.behavior.cct).toBe(3000);
  });

  it('offline: rule suggestions (core seed) with the offline issue and the Rules source', async () => {
    const fake = fakeApi();
    fake.setPropose(() => Promise.reject(new TypeError('Failed to fetch')));
    const store = await openOffice(fake.api);
    store.getState().dismiss(suggestions(store)[0]!.id);
    await store.getState().suggestDesign();
    expect(store.getState().aiIssue).toBe(OFFLINE_ISSUE);
    expect(store.getState().suggestionSource).toBe('rules');
    expect(suggestions(store).map((i) => i.label)).toEqual(seed(office()).map((i) => i.label));
    expect(suggestions(store).every((i) => i.cctSuggested === true || i.kind === 'KeepDim')).toBe(true);
  });

  it('never re-suggests what is already accepted', async () => {
    const fake = fakeApi();
    const store = await openOffice(fake.api);
    store.getState().acceptAll();
    await store.getState().suggestDesign();
    expect(suggestions(store)).toHaveLength(0);
    expect(accepted(store)).toHaveLength(seed(office()).length);
  });
});

describe('lastIssue', () => {
  it.each(Object.entries(AI_ISSUES))('%s: shown, dismissable, and reappears on the next issue', async (_kind, text) => {
    const fake = fakeApi();
    fake.setAdvise(async (room, intents) => ({ source: 'rules', result: advise(room, intents), lastIssue: text }));
    const store = await openOffice(fake.api);
    const [a, b] = suggestions(store);
    store.getState().accept(a!.id);
    await store.getState().adviceSettled();
    expect(store.getState().aiIssue).toBe(text);
    expect(issueBanner(text)).toMatchObject({ title: text });
    store.getState().dismissIssue();
    expect(store.getState().aiIssue).toBeNull();
    store.getState().accept(b!.id);
    await store.getState().adviceSettled();
    expect(store.getState().aiIssue).toBe(text);
  });
  it('an answering agent clears it', async () => {
    const fake = fakeApi();
    const store = await openOffice(fake.api);
    const [a, b] = suggestions(store);
    store.getState().accept(a!.id);
    await store.getState().adviceSettled();
    expect(store.getState().aiIssue).toBe(OFFLINE_ISSUE);
    fake.setAdvise(async (room, intents) => ({ source: 'ai', result: advise(room, intents) }));
    store.getState().accept(b!.id);
    await store.getState().adviceSettled();
    expect(store.getState().aiIssue).toBeNull();
  });
});
