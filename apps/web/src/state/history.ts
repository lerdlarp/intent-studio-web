// Undo/redo of design snapshots (intents + removed existing fixtures). Consecutive edits to the same field of the same
// intent within COALESCE_MS of the previous one share one undo step.
import type { LightingIntent } from '@intent-studio/core';
import { cloneIntents } from './pipeline';

export const COALESCE_MS = 1000;
export const HISTORY_LIMIT = 200;

export interface Snapshot {
  intents: LightingIntent[];
  removedExisting: string[];
}

interface Entry extends Snapshot {
  /** Coalescing key (`<intentId>:<field>`), null for discrete actions. */
  key: string | null;
  at: number;
}

export const snapshotOf = (s: { intents: readonly LightingIntent[]; removedExisting: readonly string[] }): Snapshot => ({
  intents: cloneIntents(s.intents),
  removedExisting: [...s.removedExisting],
});

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Snapshot[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoDepth(): number {
    return this.undoStack.length;
  }

  /**
   * Record the state *before* a change. Returns false when the change was coalesced into the previous step (same
   * key, within COALESCE_MS of the last edit with that key).
   */
  record(before: Snapshot, key: string | null, now: number): boolean {
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (key !== null && top && top.key === key && now - top.at <= COALESCE_MS) {
      top.at = now;
      return false;
    }
    this.undoStack.push({ ...before, key, at: now });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    return true;
  }

  /** Pop the last step; `current` goes onto the redo stack. Null when there is nothing to undo. */
  undo(current: Snapshot): Snapshot | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(current);
    return { intents: e.intents, removedExisting: e.removedExisting };
  }

  redo(current: Snapshot, now: number): Snapshot | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push({ ...current, key: null, at: now });
    return s;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
