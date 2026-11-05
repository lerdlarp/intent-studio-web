// Messages between the main thread (solveClient.ts) and the solver worker (solve.worker.ts).
import type { SolveReply, SolveRequest } from '../state/pipeline';

export interface SolveRunMessage {
  type: 'solve';
  id: number;
  request: SolveRequest;
}

export type SolveWorkerReply =
  { type: 'done'; id: number; reply: SolveReply } | { type: 'error'; id: number; message: string };
