// Messages between the main thread (calcClient.ts) and the calculation worker (calc.worker.ts).
import type { CalcResult, RoomDesign, StudioProduct } from '@intent-studio/core';

export interface CalcRunMessage {
  type: 'run';
  id: number;
  design: RoomDesign;
  /** intent id → product, resolved on the main thread (the settled-package cache lives there). */
  products: Record<string, StudioProduct>;
}

export type CalcWorkerReply =
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'done'; id: number; result: CalcResult; ms: number }
  | { type: 'error'; id: number; message: string };
