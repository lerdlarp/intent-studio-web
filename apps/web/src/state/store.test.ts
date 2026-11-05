import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_ISSUE,
  advise,
  estimateAll,
  office,
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
import { SAVE_DELAY_MS, ESTIMATE_DELAY_MS, createStudioStore, type StudioStore } from './store';

const ROOM_ID = 'room-1';
const PROJECT = { id: 'p1', name: 'P', createdAt: 't', updatedAt: 't' };

interface Fake {
  api: StudioApi;
  puts: { revision: number; intents: LightingIntent[] }[];
  setAdvise(fn: (room: StudioRoom, intents: LightingIntent[]) => Promise<AiReply<IntentAdvice[]>>): void;
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
    classify: async () => ({ result: [], source: 'rules' }),
  };
  return { api, puts, setAdvise: (fn) => (adviseFn = fn) };
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
