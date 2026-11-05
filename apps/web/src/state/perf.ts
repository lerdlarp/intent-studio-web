// Performance probe (Phase 6): times the deterministic pipeline on the calling thread for each demo room. Loaded only
// by the perf e2e (dynamic import through the dev server); not part of the app bundle.
import { DEMO_ROOM_NAMES, demoRoom, seed, type DemoRoomName } from '@intent-studio/core';
import { estimateDesign, solveDesign } from './pipeline';

export interface SolveTiming {
  room: DemoRoomName;
  intents: number;
  fixtures: number;
  /** Median / max of `reps` solveDesign runs (ms). */
  solveMedian: number;
  solveMax: number;
  estimateMedian: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

export function timeSolves(reps = 7): SolveTiming[] {
  return DEMO_ROOM_NAMES.map((name) => {
    const room = demoRoom(name);
    const intents = seed(room).map((i) => ({ ...i, isSuggestion: false }));
    const solves: number[] = [];
    const estimates: number[] = [];
    let fixtures = 0;
    for (let k = 0; k < reps + 1; k++) {
      const t0 = performance.now();
      const d = solveDesign({ room, intents, removedExisting: [] }, k);
      const t1 = performance.now();
      estimateDesign(d);
      const t2 = performance.now();
      fixtures = d.intents.reduce((n, i) => n + i.fixtures.length, 0);
      if (k > 0) {
        // the first run warms the JIT
        solves.push(t1 - t0);
        estimates.push(t2 - t1);
      }
    }
    return {
      room: name,
      intents: intents.length,
      fixtures,
      solveMedian: median(solves),
      solveMax: Math.max(...solves),
      estimateMedian: median(estimates),
    };
  });
}
