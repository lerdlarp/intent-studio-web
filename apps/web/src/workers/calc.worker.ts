// Calculation worker: runs core `calculate` (full point-by-point estimate) off the main thread and streams progress.
// Cancellation is by `worker.terminate()` from the client (the calculation is synchronous, so a message could not
// interrupt it); results of a terminated run are never posted.
import { calculate, resolverFromMap } from '@intent-studio/core';
import type { CalcRunMessage, CalcWorkerReply } from './calc.protocol';

interface WorkerScope {
  postMessage(message: CalcWorkerReply): void;
  onmessage: ((ev: MessageEvent<CalcRunMessage>) => void) | null;
}

/** Handle one run message (exported for tests; the worker calls it from onmessage). */
export function handleRun(msg: CalcRunMessage, post: (m: CalcWorkerReply) => void): void {
  const t0 = performance.now();
  try {
    let last = -1;
    const result = calculate(msg.design, {
      productOf: resolverFromMap(msg.products),
      onProgress: (fraction) => {
        // at most ~100 progress messages per run
        if (fraction === 1 || fraction - last >= 0.01) {
          last = fraction;
          post({ type: 'progress', id: msg.id, fraction });
        }
      },
    });
    post({ type: 'done', id: msg.id, result, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
}

if (typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined') {
  const scope = self as unknown as WorkerScope;
  scope.onmessage = (ev) => {
    if (ev.data?.type === 'run') handleRun(ev.data, (m) => scope.postMessage(m));
  };
}
