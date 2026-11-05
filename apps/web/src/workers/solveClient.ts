// Client for the solver worker: `createSolver().solve(request)` → the solved design, settled packages and quick
// estimate. Rapid edits coalesce: at most one solve runs and one waits; a newer request replaces the waiting one, whose
// promise resolves null (the store additionally drops replies for anything but its latest revision). If the worker
// cannot start or crashes, the client reports it once (`onCrash`) and solves inline from then on, re-running the
// request that was in flight. Without Worker support the client runs inline (deferred, so the caller stays responsive
// to the current event).
import { runSolveRequest, type SolveReply, type SolveRequest } from '../state/pipeline';
import type { SolveRunMessage, SolveWorkerReply } from './solve.protocol';

export interface Solver {
  /** Resolves with the reply, or null when a newer request superseded this one before it started. */
  solve(request: SolveRequest): Promise<SolveReply | null>;
  /** True while a solve runs or waits. */
  readonly busy: boolean;
  /** True once the solver fell back to the main thread. */
  readonly inline: boolean;
  dispose(): void;
}

export interface SolverOptions {
  /** Worker factory; null forces the inline path (tests). Default: the module worker when Worker exists. */
  worker?: (() => Worker) | null;
  /** Called once when the worker fails and the solver falls back to the main thread. */
  onCrash?: (message: string) => void;
}

export const SOLVER_CRASH_NOTICE =
  'The background solver stopped, so layouts are now solved on the main thread (slower).';

const defaultWorker = (): Worker => new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });

interface Job {
  id: number;
  request: SolveRequest;
  resolve: (r: SolveReply | null) => void;
  reject: (e: Error) => void;
}

export function createSolver(opts: SolverOptions = {}): Solver {
  const factory = opts.worker === undefined ? (typeof Worker !== 'undefined' ? defaultWorker : null) : opts.worker;
  let worker: Worker | null = null;
  let inline = factory === null;
  let disposed = false;
  let running: Job | null = null;
  let waiting: Job | null = null;
  let nextId = 1;

  const finish = (job: Job, result: { reply: SolveReply } | { error: Error }) => {
    if (running !== job) return;
    running = null;
    if ('reply' in result) job.resolve(result.reply);
    else job.reject(result.error);
    pump();
  };

  const runInline = (job: Job) => {
    setTimeout(() => {
      if (disposed || running !== job) return;
      try {
        finish(job, { reply: runSolveRequest(job.request) });
      } catch (e) {
        finish(job, { error: e instanceof Error ? e : new Error(String(e)) });
      }
    }, 0);
  };

  const crash = (message: string) => {
    if (inline) return;
    inline = true;
    worker?.terminate();
    worker = null;
    opts.onCrash?.(message);
    if (running) runInline(running); // re-run what the worker dropped
  };

  const onMessage = (ev: MessageEvent<SolveWorkerReply>) => {
    const m = ev.data;
    const job = running;
    if (!m || !job || m.id !== job.id) return;
    if (m.type === 'done') finish(job, { reply: m.reply });
    else finish(job, { error: new Error(m.message) });
  };

  const ensureWorker = (): Worker | null => {
    if (inline || !factory) return null;
    if (worker) return worker;
    try {
      worker = factory();
    } catch (e) {
      crash(e instanceof Error ? e.message : String(e));
      return null;
    }
    worker.addEventListener('message', onMessage as EventListener);
    worker.addEventListener('error', (ev) => {
      ev.preventDefault?.();
      crash((ev as ErrorEvent).message || 'solver worker failed');
    });
    worker.addEventListener('messageerror', () => crash('solver worker message could not be read'));
    return worker;
  };

  function pump(): void {
    if (disposed || running || !waiting) return;
    const job = waiting;
    waiting = null;
    running = job;
    const w = ensureWorker();
    if (!w) return runInline(job);
    const msg: SolveRunMessage = { type: 'solve', id: job.id, request: job.request };
    try {
      w.postMessage(msg);
    } catch (e) {
      crash(e instanceof Error ? e.message : String(e));
      if (running === job && !inline) runInline(job);
    }
  }

  return {
    solve(request) {
      return new Promise<SolveReply | null>((resolve, reject) => {
        if (disposed) return resolve(null);
        waiting?.resolve(null);
        waiting = { id: nextId++, request, resolve, reject };
        pump();
      });
    },
    get busy() {
      return running !== null || waiting !== null;
    },
    get inline() {
      return inline;
    },
    dispose() {
      disposed = true;
      waiting?.resolve(null);
      running?.resolve(null);
      waiting = running = null;
      worker?.terminate();
      worker = null;
    },
  };
}
