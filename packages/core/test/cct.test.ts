import { describe, expect, it } from 'vitest';
import {
  CCT_VALUES,
  SPACE_CLASSES,
  INTENT_KINDS,
  applyAdviceWithCct,
  cafeteria,
  cctFor,
  createIntent,
  dataHall,
  defaultBeam,
  defaultCct,
  lobby,
  office,
  withDefaultCct,
  type IntentAdvice,
  type IntentKind,
  type SpaceClass,
} from '../src/index';

describe('cctFor table', () => {
  it.each<[SpaceClass, IntentKind, number | null]>([
    ['Office', 'Task', 4000],
    ['Office', 'Ambient', 3500],
    ['Office', 'Accent', 3000],
    ['OpenOffice', 'WallWash', 3000],
    ['Conference', 'Task', 3500],
    ['Conference', 'FeaturePendant', 3000],
    ['Classroom', 'Ambient', 4000],
    ['Classroom', 'Accent', 3500],
    ['Cafeteria', 'Ambient', 3500],
    ['Cafeteria', 'FeaturePendant', 3000],
    ['Lobby', 'Accent', 3000],
    ['Lobby', 'FeaturePendant', 3000],
    ['Lobby', 'Task', 3500],
    ['Corridor', 'Path', 3500],
    ['DataHall', 'Ambient', 4000],
    ['DataHall', 'Task', 5000],
    ['Retail', 'Accent', 3000],
    ['Retail', 'Ambient', 3500],
    ['Restroom', 'Ambient', 3500],
    ['Storage', 'Ambient', 4000],
    ['BreakRoom', 'Ambient', 3000],
    ['BreakRoom', 'Task', 3500],
    ['Other', 'Ambient', 3500],
    ['Office', 'KeepDim', null],
  ])('%s %s → %s', (cls, kind, want) => expect(cctFor(cls, kind)).toBe(want));

  it('every class × kind is in the CCT set (or null for keep-dim only)', () => {
    for (const cls of SPACE_CLASSES)
      for (const kind of INTENT_KINDS) {
        const v = cctFor(cls, kind);
        if (kind === 'KeepDim') expect(v).toBeNull();
        else expect(CCT_VALUES).toContain(v);
      }
  });
});

describe('defaultCct (room class)', () => {
  it.each([
    ['Office', office(), 'Ambient', 3500],
    ['Office', office(), 'Task', 4000],
    ['Cafeteria', cafeteria(), 'FeaturePendant', 3000],
    ['Lobby', lobby(), 'Accent', 3000],
    ['DataHall', dataHall(), 'Task', 5000],
  ] as const)('%s %s', (_n, room, kind, want) => expect(defaultCct(room, { kind })).toBe(want));
  it('deterministic', () => expect(defaultCct(office(), { kind: 'Task' })).toBe(defaultCct(office(), { kind: 'Task' })));
});

describe('defaultBeam', () => {
  it('accent / pendant / wash only', () => {
    expect(defaultBeam('Accent')).toBe(25);
    expect(defaultBeam('FeaturePendant')).toBe(60);
    expect(defaultBeam('WallWash')).toBe(100);
    expect(defaultBeam('Ambient')).toBeUndefined();
  });
});

describe('withDefaultCct / applyAdviceWithCct', () => {
  const advice: IntentAdvice = {
    intentId: 'abcd0123',
    label: 'Agent',
    target: { minimum: 1, average: 2, maximum: 3 },
    plane: { kind: 'Horizontal', height: 3, bottom: 0, top: 0, inferred: true, reason: 'Agent' },
    reason: 'r',
    cct: 2700,
  };
  it('fills an unset cct as suggested; leaves a set one alone', () => {
    const i = withDefaultCct(office(), createIntent({ id: 'abcd0123', kind: 'Ambient' }));
    expect(i.behavior.cct).toBe(3500);
    expect(i.cctSuggested).toBe(true);
    const mine = createIntent({ kind: 'Ambient' });
    mine.behavior.cct = 5000;
    expect(withDefaultCct(office(), mine)).toBe(mine);
    expect(withDefaultCct(office(), createIntent({ kind: 'KeepDim' })).behavior.cct).toBeUndefined();
  });
  it('advice replaces a suggested cct', () => {
    const i = withDefaultCct(office(), createIntent({ id: 'abcd0123', kind: 'Ambient' }));
    const n = applyAdviceWithCct(i, advice);
    expect(n.behavior.cct).toBe(2700);
    expect(n.cctSuggested).toBe(true);
  });
  it('advice without a cct keeps the suggested one', () => {
    const i = withDefaultCct(office(), createIntent({ id: 'abcd0123', kind: 'Ambient' }));
    const { cct: _c, ...noCct } = advice;
    const n = applyAdviceWithCct(i, noCct);
    expect(n.behavior.cct).toBe(3500);
    expect(n.cctSuggested).toBe(true);
  });
  it('a designer cct (cctSuggested false or absent) is never replaced', () => {
    for (const flag of [false, undefined]) {
      const i = createIntent({ id: 'abcd0123', kind: 'Ambient' });
      i.behavior.cct = 4000;
      if (flag !== undefined) i.cctSuggested = flag;
      const n = applyAdviceWithCct(i, advice);
      expect(n.behavior.cct).toBe(4000);
      expect(n.label).toBe('Agent');
    }
  });
});
