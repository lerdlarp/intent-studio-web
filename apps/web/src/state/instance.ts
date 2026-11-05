// The app's single store instance and its React hook.
import { useStore } from 'zustand';
import { createApi } from '../api/client';
import { createStudioStore, type StudioState, type Units } from './store';
import { SOLVER_CRASH_NOTICE, createSolver } from '../workers/solveClient';

const UNITS_KEY = 'intent-studio.units';

function storedUnits(): Units {
  try {
    return localStorage.getItem(UNITS_KEY) === 'metric' ? 'metric' : 'imperial';
  } catch {
    return 'imperial';
  }
}

// Solve + quick estimate run in a worker where the browser has one; a worker failure falls back to the main thread.
const solver =
  typeof Worker !== 'undefined' ? createSolver({ onCrash: () => studio.getState().notify(SOLVER_CRASH_NOTICE) }) : null;

export const studio = createStudioStore({ api: createApi(), units: storedUnits(), solver });

studio.subscribe((s, prev) => {
  if (s.units === prev.units) return;
  try {
    localStorage.setItem(UNITS_KEY, s.units);
  } catch {
    /* per-viewer convenience only */
  }
});

export function useStudio<T>(selector: (s: StudioState) => T): T {
  return useStore(studio, selector);
}
