// The app's single store instance and its React hook.
import { useStore } from 'zustand';
import { createApi } from '../api/client';
import { createStudioStore, type StudioState, type Units } from './store';

const UNITS_KEY = 'intent-studio.units';

function storedUnits(): Units {
  try {
    return localStorage.getItem(UNITS_KEY) === 'metric' ? 'metric' : 'imperial';
  } catch {
    return 'imperial';
  }
}

export const studio = createStudioStore({ api: createApi(), units: storedUnits() });

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
