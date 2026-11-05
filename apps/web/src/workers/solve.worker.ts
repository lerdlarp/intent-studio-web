// Solver worker: runs the store's deterministic pipeline (pipeline.ts `runSolveRequest`: solveAll + quick estimate)
// off the main thread. The settled lumen packages travel back explicitly in the reply (see pipeline.ts).
import { runSolveRequest } from '../state/pipeline';
import type { SolveRunMessage, SolveWorkerReply } from './solve.protocol';

interface WorkerScope {
  postMessage(message: SolveWorkerReply): void;
  onmessage: ((ev: MessageEvent<SolveRunMessage>) => void) | null;
}

/** Handle one solve message (exported for tests; the worker calls it from onmessage). */
export function handleSolve(msg: SolveRunMessage, post: (m: SolveWorkerReply) => void): void {
  try {
    post({ type: 'done', id: msg.id, reply: runSolveRequest(msg.request) });
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
}

if (typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined') {
  const scope = self as unknown as WorkerScope;
  scope.onmessage = (ev) => {
    if (ev.data?.type === 'solve') handleSolve(ev.data, (m) => scope.postMessage(m));
  };
}
