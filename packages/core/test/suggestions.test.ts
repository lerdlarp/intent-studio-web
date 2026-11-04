// suggestions.md test tables.
import { describe, expect, it } from 'vitest';
import { clusters, defaultLabel } from '../src/defaults';
import { bounds, footprint, overlapArea } from '../src/geometry';
import {
  cafeteria,
  createRoom,
  dataHall,
  lobby,
  office,
  rect,
  type RoomObjectInfo,
  type StudioRoom,
} from '../src/index';
import {
  keepDimRegion,
  pathRegion,
  pickWashWall,
  scoredSuggestions,
  seed,
  taskWanted,
  washRun,
  washWanted,
} from '../src/suggestions';

const desk = (name: string, x: number, y: number): RoomObjectInfo => ({
  name,
  kind: 'desk',
  center: { x, y },
  length: 4,
  width: 2,
  orientation: 0,
  top: 2.5,
  bottom: 0,
});

describe('Seed_OfficeSuggestsSensibleKinds', () => {
  const s = seed(office());
  it('count 4..8', () => {
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(s.length).toBeLessThanOrEqual(8);
  });
  it('every seed is a labelled suggestion', () => {
    for (const i of s) {
      expect(i.isSuggestion).toBe(true);
      expect(i.labelSuggested).toBe(true);
      expect(i.label).not.toBe('');
    }
  });
  it('kinds', () => {
    expect(s.filter((i) => i.kind === 'Ambient')).toHaveLength(1);
    expect(s.filter((i) => i.kind === 'Task').length).toBeGreaterThanOrEqual(2);
    expect(s.some((i) => i.kind === 'Accent' && i.label === 'Brand wall accent')).toBe(true);
    expect(s.some((i) => i.kind === 'KeepDim' && i.label === 'Screen — keep dim')).toBe(true);
    const wash = s.filter((i) => i.kind === 'WallWash');
    expect(wash).toHaveLength(1);
    expect(wash[0]!.wallIndex).toBe(2);
    expect(wash[0]!.plane.kind).toBe('Vertical');
    expect(s.filter((i) => i.kind === 'CeilingGlow')).toHaveLength(0);
  });
});

describe('Seed_DesksMergeWithinThreeFeet', () => {
  it('office desks: three clusters', () => {
    const d = clusters(office()).filter((c) => c.group === 'desk');
    expect(d.map((c) => c.ordinal)).toEqual([0, 1, 2]);
  });
  it('desks 1 ft apart merge', () => {
    const room = createRoom({
      label: 'Open office',
      floor: [rect({ x: 0, y: 0 }, { x: 30, y: 20 })],
      objects: [desk('D0', 5, 5), desk('D1', 5, 8), desk('D2', 20, 5)],
    });
    const c = clusters(room);
    expect(c).toHaveLength(2);
    const largest = [...c].sort((a, b) => b.objects.length - a.objects.length)[0]!;
    expect(largest.objects).toEqual([0, 1]);
  });
});

describe('Seed_CafeteriaCoversCounterTablesCloudAndMenuBoards', () => {
  const s = seed(cafeteria());
  it('count and ambient', () => {
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s.some((i) => i.kind === 'Ambient')).toBe(true);
  });
  it('servery task', () => {
    const t = s.filter((i) => i.kind === 'Task' && /servery/i.test(i.label));
    expect(t).toHaveLength(1);
    expect(t[0]!.plane.height).toBeCloseTo(3, 9);
    expect(t[0]!.target).toEqual({ minimum: 25, average: 40, maximum: 60 });
  });
  it('cove glow and menu accent', () => {
    const g = s.filter((i) => i.kind === 'CeilingGlow');
    expect(g).toHaveLength(1);
    expect(g[0]!.plane.kind).toBe('Ceiling');
    expect(g[0]!.plane.height).toBeCloseTo(12, 9);
    expect(s.some((i) => i.kind === 'Accent' && /menu/i.test(i.label))).toBe(true);
  });
});

describe('Seed_LobbyHasAFloorAmbientReceptionPendantsAccentAndPath', () => {
  const s = seed(lobby());
  it('assertions', () => {
    expect(s.find((i) => i.kind === 'Ambient')!.plane.height).toBe(0);
    expect(s.some((i) => i.kind === 'FeaturePendant')).toBe(true);
    expect(s.some((i) => i.kind === 'Accent' && i.label.includes('Feature wall'))).toBe(true);
    expect(s.some((i) => i.kind === 'Path')).toBe(true);
    expect(s.some((i) => i.kind === 'Task' && i.label.includes('Reception'))).toBe(true);
    expect(s.some((i) => i.kind === 'CeilingGlow')).toBe(false);
  });
});

describe('Seed_DataHallHasAisleTasksOnTheFloorAndNoWash', () => {
  const room = dataHall();
  const s = seed(room);
  const tasks = s.filter((i) => i.kind === 'Task');
  it('no wash or accent', () => {
    expect(s.some((i) => i.kind === 'WallWash')).toBe(false);
    expect(s.some((i) => i.kind === 'Accent')).toBe(false);
  });
  it('aisle tasks on the floor', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    for (const t of tasks) {
      expect(t.plane.height).toBe(0);
      expect(t.target.minimum).toBe(20);
      expect(t.target.maximum).toBe(50);
    }
  });
  it('labels Aisle n task, distinct, recomputable', () => {
    expect(tasks.map((t) => t.label)).toEqual(tasks.map((_, i) => `Aisle ${i + 1} task`));
    expect(new Set(tasks.map((t) => t.label)).size).toBe(tasks.length);
    for (const t of tasks) {
      expect(t.label).not.toBe('Task zone');
      expect(defaultLabel(room, 'Task', t.region, null, null)).toBe(t.label);
    }
  });
  it('aisles do not overlap racks', () => {
    const racks = room.objects.filter((o) => o.kind.trim().toLowerCase() === 'cabinet');
    for (const t of tasks) for (const r of racks) expect(overlapArea(t.region, footprint(r), 8)).toBeLessThan(1);
  });
});

describe('Seed_IsRankedAmbientFirstAndDeterministic', () => {
  for (const [name, make] of [
    ['Office', office],
    ['Cafeteria', cafeteria],
    ['Lobby', lobby],
    ['DataHall', dataHall],
  ] as [string, () => StudioRoom][]) {
    it(name, () => {
      const room = make();
      const a = seed(room);
      const b = seed(room);
      expect(a[0]!.kind).toBe('Ambient');
      expect(a.map((i) => i.label)).toEqual(b.map((i) => i.label));
      const { min, max } = bounds(room.floor[0]!);
      for (const i of a) {
        expect(i.region.length).toBeGreaterThan(0);
        for (const p of i.region) {
          expect(p.x).toBeGreaterThanOrEqual(min.x - 3);
          expect(p.x).toBeLessThanOrEqual(max.x + 3);
          expect(p.y).toBeGreaterThanOrEqual(min.y - 3);
          expect(p.y).toBeLessThanOrEqual(max.y + 3);
        }
      }
    });
  }
});

describe('Seed_EmptyRoomGivesNothing', () => {
  it('no floor → no seeds', () => {
    expect(seed(createRoom({ label: 'Nothing' }))).toEqual([]);
    expect(
      seed(
        createRoom({
          label: 'Nothing',
          floor: [
            [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          ],
        }),
      ),
    ).toEqual([]);
  });
});

// §9 worked example details (helpers).
describe('worked example: Office helpers', () => {
  const room = office();
  it('wash wall 2, run (18,24)→(2,24)', () => {
    expect(pickWashWall(room)).toBe(2);
    const run = washRun(room, 2);
    expect(run[0]!.x).toBeCloseTo(18, 9);
    expect(run[0]!.y).toBeCloseTo(24, 9);
    expect(run[1]!.x).toBeCloseTo(2, 9);
    expect(run[1]!.y).toBeCloseTo(24, 9);
  });
  it('keep-dim region in front of the screen', () => {
    const r = keepDimRegion(room, room.objects[7]!);
    const exp = [
      [35.85, 14],
      [35.85, 20],
      [30.85, 20],
      [30.85, 14],
    ];
    r.forEach((p, i) => {
      expect(Math.abs(p.x - exp[i]![0]!)).toBeLessThan(1e-12);
      expect(Math.abs(p.y - exp[i]![1]!)).toBeLessThan(1e-12);
    });
  });
  it('scores in insertion order', () => {
    expect(scoredSuggestions(room).map((s) => s.score)).toEqual([100, 90, 87, 84, 81, 80, 70, 65]);
  });
});

describe('policy tables', () => {
  it('TaskWanted', () => {
    expect(taskWanted('OpenOffice', 'desk')).toBe(true);
    expect(taskWanted('DataHall', 'desk')).toBe(false);
    expect(taskWanted('Cafeteria', 'table')).toBe(false);
    expect(taskWanted('Conference', 'table')).toBe(true);
    expect(taskWanted('Lobby', 'reception')).toBe(true);
    expect(taskWanted('Office', 'cabinet')).toBe(false);
  });
  it('WashWanted', () => {
    expect(washWanted('DataHall')).toBe(false);
    expect(washWanted('Storage')).toBe(false);
    expect(washWanted('Restroom')).toBe(false);
    expect(washWanted('Lobby')).toBe(true);
  });
  it('path: lobby band (2,21)–(38,25); too small → null', () => {
    const p = pathRegion(lobby())!;
    expect(p).toEqual(rect({ x: 2, y: 21 }, { x: 38, y: 25 }));
    expect(pathRegion(createRoom({ floor: [rect({ x: 0, y: 0 }, { x: 5, y: 20 })] }))).toBeNull();
  });
  it('keep-dim without walls faces the floor centroid', () => {
    const screen: RoomObjectInfo = {
      name: 'S',
      kind: 'screen',
      center: { x: 0, y: 5 },
      length: 4,
      width: 0.2,
      orientation: 90,
      top: 6,
      bottom: 3,
    };
    const room = createRoom({ floor: [rect({ x: 0, y: 0 }, { x: 10, y: 10 })], objects: [screen] });
    const r = keepDimRegion(room, screen);
    expect(r[2]!.x).toBeCloseTo(5, 9);
    expect(r[3]!.x).toBeCloseTo(5, 9);
  });
});
