import { describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_ISSUE,
  advise,
  office,
  productOf,
  seed,
  type LightingIntent,
  type StudioRoom,
} from '@intent-studio/core';
import type { DesignView, StudioApi } from '../api/client';
import {
  adoptSolved,
  estimateDesign,
  runSolveRequest,
  solveDesign,
  solveRequest,
  type SolveReply,
} from '../state/pipeline';
import { createStudioStore, type StudioStore } from '../state/store';
import { handleSolve } from './solve.worker';
import { createSolver, type Solver } from './solveClient';
import type { SolveRunMessage } from './solve.protocol';

/** In-process stand-in for the solver Worker: handleSolve on a structured clone (drops the WeakMap like a real one). */
class FakeWorker extends EventTarget {
  posted = 0;
  constructor(private readonly crashOn = -1) {
    super();
  }
  postMessage(msg: SolveRunMessage): void {
    const copy = structuredClone(msg);
    const n = this.posted++;
    setTimeout(() => {
      if (n === this.crashOn) return void this.dispatchEvent(Object.assign(new Event('error'), { message: 'boom' }));
      handleSolve(copy, (m) => this.dispatchEvent(Object.assign(new Event('message'), { data: structuredClone(m) })));
    }, 1);
  }
  terminate(): void {}
}

/** Fixture layout without the (random) fixture ids. */
const layout = (intents: readonly LightingIntent[]) =>
  intents.map((i) => i.fixtures.map(({ id: _id, intentId: _intent, ...f }) => f));

const accepted = (room: StudioRoom): LightingIntent[] => seed(room).map((i) => ({ ...i, isSuggestion: false }));

describe('solver across the worker boundary', () => {
  const room = office();
  const input = { room, intents: accepted(room), removedExisting: [] };

  it('reply = inline solve: same layout, settled packages survive cloning, same estimate', async () => {
    const solver = createSolver({ worker: () => new FakeWorker() as unknown as Worker });
    const reply = (await solver.solve(solveRequest(input, 3, null)))!;
    const design = adoptSolved(reply);
    const ref = solveDesign(input, 3);
    expect(layout(design.intents)).toEqual(layout(ref.intents));
    for (const [k, i] of design.intents.entries()) expect(productOf(room, i)).toEqual(productOf(room, ref.intents[k]!));
    expect(estimateDesign(design)).toEqual(estimateDesign(ref));
    expect(reply.estimate).toEqual(estimateDesign(ref));
  });

  it('hand-tuned packages are carried into the worker like solveDesign(previous)', () => {
    const prev = solveDesign(input, 1);
    const intents = structuredClone(prev.intents);
    intents[0]!.handTuned = true;
    const viaWorker = adoptSolved(
      structuredClone(runSolveRequest(solveRequest({ ...input, intents }, 2, prev))) as SolveReply,
    );
    const inline = solveDesign({ ...input, intents }, 2, prev);
    expect(productOf(room, viaWorker.intents[0]!)).toEqual(productOf(room, inline.intents[0]!));
    expect(layout(viaWorker.intents)).toEqual(layout(inline.intents));
  });

  it('rapid requests coalesce: the waiting one is superseded (null), the latest is solved', async () => {
    const solver = createSolver({ worker: () => new FakeWorker() as unknown as Worker });
    const a = solver.solve(solveRequest(input, 1, null));
    const b = solver.solve(solveRequest(input, 2, null));
    const c = solver.solve(solveRequest(input, 3, null));
    expect(solver.busy).toBe(true);
    expect((await a)?.design.revision).toBe(1);
    expect(await b).toBeNull();
    expect((await c)?.design.revision).toBe(3);
    expect(solver.busy).toBe(false);
  });

  it('a worker crash is reported once and the request is solved inline', async () => {
    const onCrash = vi.fn();
    const solver = createSolver({ worker: () => new FakeWorker(0) as unknown as Worker, onCrash });
    const r = await solver.solve(solveRequest(input, 1, null));
    expect(r?.design.revision).toBe(1);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(solver.inline).toBe(true);
    expect((await solver.solve(solveRequest(input, 2, null)))?.design.revision).toBe(2);
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it('no Worker: inline (deferred) path', async () => {
    const solver = createSolver({ worker: null });
    expect(solver.inline).toBe(true);
    expect((await solver.solve(solveRequest(input, 4, null)))?.design.revision).toBe(4);
  });
});

function fakeApi(room: StudioRoom): { api: StudioApi; puts: LightingIntent[][] } {
  let revision = 0;
  let saved: DesignView = { roomId: 'r', revision: 0, intents: [], removedExisting: [], updatedAt: null };
  const puts: LightingIntent[][] = [];
  const view = {
    id: 'r',
    projectId: 'p',
    label: room.label,
    sourceAssetId: null,
    updatedAt: 't',
    createdAt: 't',
    room,
  };
  const api: StudioApi = {
    listProjects: async () => [{ id: 'p', name: 'P', createdAt: 't', updatedAt: 't' }],
    createProject: async () => ({ id: 'p', name: 'P', createdAt: 't', updatedAt: 't' }),
    listRooms: async () => [view],
    createRoom: async () => view,
    getRoom: async () => structuredClone(view),
    getDesign: async () => structuredClone(saved),
    putDesign: async (_id, body) => {
      puts.push(structuredClone(body.intents));
      revision++;
      saved = { roomId: 'r', revision, intents: body.intents, removedExisting: body.removedExisting, updatedAt: 't' };
      return { ok: true, revision };
    },
    uploadAsset: async () => {
      throw new Error('not used');
    },
    advise: async (b) => ({ result: advise(b.room, b.intents), source: 'rules', lastIssue: OFFLINE_ISSUE }),
    interpret: async () => ({ result: [], source: 'rules' }),
    propose: async () => ({ result: [], source: 'rules' }),
    classify: async () => ({ result: [], source: 'rules' }),
  };
  return { api, puts };
}

async function open(solver: Solver | null): Promise<{ store: StudioStore; puts: LightingIntent[][] }> {
  const f = fakeApi(office());
  const store = createStudioStore({ api: f.api, solver, estimateDelay: 0, saveDelay: 5 });
  await store.getState().openRoom('r');
  return { store, puts: f.puts };
}

async function densityDrag(store: StudioStore): Promise<void> {
  store.getState().acceptAll();
  await store.getState().adviceSettled();
  await store.getState().solveSettled();
  const id = store.getState().design!.intents.find((i) => i.kind === 'Ambient')!.id;
  for (const d of [1.1, 1.2, 1.3, 1.4, 1.5, 1.6]) store.getState().setBehavior(id, { density: d });
  await store.getState().flush();
}

describe('store with the worker solver', () => {
  it('rapid density edits: provisional design at once, only the latest reply applies, same result as inline', async () => {
    const worker = new FakeWorker();
    const w = await open(createSolver({ worker: () => worker as unknown as Worker }));
    const inline = await open(null);
    await densityDrag(w.store);
    await densityDrag(inline.store);
    const a = w.store.getState();
    const b = inline.store.getState();
    expect(a.solving).toBe(false);
    expect(a.revision).toBe(b.revision);
    expect(a.estimateRevision).toBe(a.revision);
    expect(layout(a.design!.intents)).toEqual(layout(b.design!.intents));
    const byOrder = (st: typeof a) => st.design!.intents.map((i) => st.estimates[i.id]);
    expect(byOrder(a)).toEqual(byOrder(b));
    expect(a.power).toEqual(b.power);
    // fewer solves than edits reached the worker (6 density edits coalesced)
    expect(worker.posted).toBeLessThan(1 + 6 + 1);
    // the save waited for the solve: the last saved layout is the solved one
    expect(w.puts.at(-1)!.map((i) => i.fixtures.length)).toEqual(b.design!.intents.map((i) => i.fixtures.length));
  });

  it('a change shows the edit immediately with solving = true', async () => {
    const w = await open(createSolver({ worker: () => new FakeWorker() as unknown as Worker }));
    w.store.getState().acceptAll();
    expect(w.store.getState().solving).toBe(true);
    expect(w.store.getState().design!.intents.every((i) => !i.isSuggestion)).toBe(true);
    await w.store.getState().solveSettled();
    expect(w.store.getState().solving).toBe(false);
  });
});
