// Client wrapper for the calculation worker: `runCalculation(design, onProgress)` → { promise, cancel }.
// One long-lived worker; `cancel()` terminates it (the next run starts a fresh one) and resolves the promise with an
// aborted result. Without Worker support (tests, old browsers) the calculation runs inline in small async steps.
import {
  CALC_LABEL,
  calculate,
  productOf as defaultProductOf,
  resolveProducts,
  resolverFromMap,
  type CalcResult,
  type ProductResolver,
  type RoomDesign,
} from '@intent-studio/core';
import type { CalcRunMessage, CalcWorkerReply } from './calc.protocol';

export interface CalcRun {
  /** Resolves with the result (aborted: true after cancel); rejects only on an unexpected worker error. */
  promise: Promise<CalcResult>;
  cancel(): void;
}

export interface RunOptions {
  productOf?: ProductResolver;
  /** Force the inline path (tests) or a custom worker factory. */
  worker?: (() => Worker) | null;
}

const aborted = (revision: number): CalcResult => ({ label: CALC_LABEL, revision, aborted: true, zones: [], pointCount: 0 });

let shared: Worker | null = null;
let nextId = 1;

const defaultWorker = (): Worker => new Worker(new URL('./calc.worker.ts', import.meta.url), { type: 'module' });

/** Strip what the worker does not need (and cannot clone cheaply): the previous calculation snapshot. */
const forWorker = (d: RoomDesign): RoomDesign => ({ ...d, calculation: null });

export function runCalculation(design: RoomDesign, onProgress?: (fraction: number) => void, opts: RunOptions = {}): CalcRun {
  const products = resolveProducts(design, opts.productOf ?? defaultProductOf);
  const factory = opts.worker === undefined ? (typeof Worker !== 'undefined' ? defaultWorker : null) : opts.worker;
  if (!factory) return runInline(design, products, onProgress);

  const id = nextId++;
  const worker = (shared ??= factory());
  let settle: ((r: CalcResult) => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  const promise = new Promise<CalcResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const listener = (ev: MessageEvent<CalcWorkerReply>): void => {
    const m = ev.data;
    if (!m || m.id !== id) return;
    if (m.type === 'progress') onProgress?.(m.fraction);
    else {
      worker.removeEventListener('message', listener);
      if (m.type === 'done') settle?.(m.result);
      else fail?.(new Error(m.message));
      settle = fail = null;
    }
  };
  worker.addEventListener('message', listener);
  worker.addEventListener(
    'error',
    (ev) => {
      fail?.(new Error(ev.message || 'calculation worker failed'));
      settle = fail = null;
      if (shared === worker) shared = null;
    },
    { once: true },
  );
  const msg: CalcRunMessage = { type: 'run', id, design: forWorker(design), products };
  worker.postMessage(msg);
  return {
    promise,
    cancel: () => {
      if (!settle) return;
      worker.removeEventListener('message', listener);
      worker.terminate();
      if (shared === worker) shared = null;
      settle(aborted(design.revision));
      settle = fail = null;
    },
  };
}

function runInline(
  design: RoomDesign,
  products: ReturnType<typeof resolveProducts>,
  onProgress?: (fraction: number) => void,
): CalcRun {
  let cancelled = false;
  const promise = new Promise<CalcResult>((resolve) => {
    // defer so the caller can attach handlers / cancel before the synchronous run starts
    setTimeout(() => {
      if (cancelled) return resolve(aborted(design.revision));
      resolve(
        calculate(design, { productOf: resolverFromMap(products), onProgress, shouldAbort: () => cancelled }),
      );
    }, 0);
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
  };
}

/** Terminate the shared worker (e.g. on unmount of the project screen). */
export function disposeCalcWorker(): void {
  shared?.terminate();
  shared = null;
}
