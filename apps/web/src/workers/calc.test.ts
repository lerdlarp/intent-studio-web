import { describe, expect, it } from 'vitest';
import { calculate, office, productOf, resolveProducts, seed, solveAll, type RoomDesign } from '@intent-studio/core';
import { handleRun } from './calc.worker';
import { runCalculation } from './calcClient';
import type { CalcRunMessage, CalcWorkerReply } from './calc.protocol';

function solvedOffice(): RoomDesign {
  const room = office();
  const d: RoomDesign = { room, intents: seed(room).map((i) => ({ ...i, isSuggestion: false })), removedExisting: [], calculation: null, revision: 5 };
  solveAll(d);
  return d;
}

/** In-process stand-in for a Worker that runs handleRun on a structured clone. */
class FakeWorker extends EventTarget {
  terminated = false;
  postMessage(msg: CalcRunMessage): void {
    const copy = structuredClone(msg);
    setTimeout(() => {
      if (this.terminated) return;
      handleRun(copy, (m) => {
        if (!this.terminated) this.dispatchEvent(Object.assign(new Event('message'), { data: m }));
      });
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('calc worker', () => {
  const d = solvedOffice();
  it('handleRun posts progress then done with the same result as calculate', () => {
    const msgs: CalcWorkerReply[] = [];
    handleRun({ type: 'run', id: 1, design: structuredClone(d), products: resolveProducts(d, productOf) }, (m) => msgs.push(m));
    const done = msgs.at(-1)!;
    expect(done.type).toBe('done');
    expect(msgs.filter((m) => m.type === 'progress').at(-1)).toMatchObject({ fraction: 1 });
    if (done.type === 'done') expect(done.result.zones).toEqual(calculate(d, { productOf }).zones);
  });
  it('client over a (fake) worker resolves, reports progress, and cancel resolves aborted', async () => {
    const seen: number[] = [];
    const w = new FakeWorker();
    const run = runCalculation(d, (f) => seen.push(f), { worker: () => w as unknown as Worker });
    const r = await run.promise;
    expect(r.aborted).toBe(false);
    expect(r.revision).toBe(5);
    expect(seen.at(-1)).toBe(1);
    const run2 = runCalculation(d, undefined, { worker: () => new FakeWorker() as unknown as Worker });
    run2.cancel();
    expect((await run2.promise).aborted).toBe(true);
  });
  it('inline fallback (no Worker) computes and can be cancelled', async () => {
    const r = await runCalculation(d, undefined, { worker: null }).promise;
    expect(r.zones.length).toBeGreaterThan(0);
    const c = runCalculation(d, undefined, { worker: null });
    c.cancel();
    expect((await c.promise).aborted).toBe(true);
  });
});
