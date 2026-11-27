// Which room steps are done, derived from the design only (nothing stored). The stepper shows a check on done steps;
// any step can be opened at any time.
import type { RoomDesign } from '@intent-studio/core';
import type { RoomStep } from '../../state/store';

export const STEP_NAMES: Readonly<Record<RoomStep, string>> = {
  intent: 'Intent',
  zones: 'Zones',
  luminaires: 'Luminaires',
  check: 'Check',
};

export const NEXT_STEP: Readonly<Partial<Record<RoomStep, RoomStep>>> = {
  intent: 'zones',
  zones: 'luminaires',
  luminaires: 'check',
};

export const PREV_STEP: Readonly<Partial<Record<RoomStep, RoomStep>>> = {
  zones: 'intent',
  luminaires: 'zones',
  check: 'luminaires',
};

export function stepsDone(design: RoomDesign | null, calcFresh: boolean): Record<RoomStep, boolean> {
  const accepted = design ? design.intents.filter((i) => !i.isSuggestion) : [];
  const fixtures = accepted.reduce((n, i) => n + i.fixtures.length, 0);
  return {
    intent: accepted.some((i) => i.kind === 'Ambient'),
    zones: accepted.some((i) => i.kind !== 'Ambient'),
    luminaires: fixtures > 0,
    check: calcFresh,
  };
}
