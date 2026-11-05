// spec/interpreter.md "Test cases" tables.
import { describe, expect, it } from 'vitest';
import { cafeteria, dataHall, lobby, office } from '../src/fixtures/demo-rooms';
import { area, bounds } from '../src/geometry';
import {
  clauses,
  forTarget,
  interpret,
  kindsIn,
  levelIn,
  nameWords,
  tokens,
  wallsNamed,
} from '../src/interpreter';
import type { LightingIntent, StudioRoom } from '../src/model';

const idx = (room: StudioRoom, name: string): number => {
  const i = room.objects.findIndex((o) => o.name === name);
  if (i < 0) throw new Error(`no object ${name}`);
  return i;
};
const sorted = <T>(xs: T[]): T[] => [...xs].sort();

describe('interpreter (reference AI tests)', () => {
  it('wash brand wall + keep screen dim', () => {
    const room = office();
    const r = interpret(room, 'wash the brand wall, keep the screen dim');
    expect(r).toHaveLength(2);
    const wash = r.find((i) => i.kind === 'WallWash')!;
    expect(wash.objectIndex).toBe(idx(room, 'Brand wall'));
    expect(wash.wallIndex).toBe(2);
    expect(wash.plane.kind).toBe('Vertical');
    expect(wash.region).toHaveLength(2);
    const dim = r.find((i) => i.kind === 'KeepDim')!;
    expect(dim.objectIndex).toBe(idx(room, 'Screen'));
    expect(dim.target.average).toBeNull();
    expect(dim.target.maximum).toBe(5);
    for (const i of r) {
      expect(i.isSuggestion).toBe(false);
      expect(i.label.length).toBeGreaterThan(0);
    }
  });

  it('compass: north', () => {
    const r = interpret(office(), 'wash the north wall');
    expect(r).toHaveLength(1);
    expect(r[0]!.wallIndex).toBe(2);
    for (const p of r[0]!.region) expect(Math.abs(p.y - 24)).toBeLessThanOrEqual(1e-9);
  });

  it('compass: south', () => {
    const r = interpret(office(), 'wash the south wall');
    expect(r).toHaveLength(1);
    expect(r[0]!.wallIndex).toBe(0);
  });

  it('compass: east and west', () => {
    const r = interpret(office(), 'wash the east and west walls');
    expect(sorted(r.map((i) => i.wallIndex))).toEqual([1, 3]);
  });

  it('footcandle request', () => {
    const r = interpret(office(), 'wash the north wall to 40 fc');
    expect(r).toHaveLength(1);
    expect(r[0]!.target.average).toBe(40);
    expect(r[0]!.targetReason).toContain('40');
  });

  it('lux request', () => {
    const r = interpret(office(), 'wash the north wall at 500 lux');
    expect(r).toHaveLength(1);
    expect(r[0]!.target.average).toBe(46.5);
  });

  it('desks by kind', () => {
    const r = interpret(office(), 'task light on the desks');
    expect(r.length).toBeGreaterThanOrEqual(2);
    for (const i of r) {
      expect(i.kind).toBe('Task');
      expect(i.plane.height).toBe(2.5);
    }
  });

  it('desk by letter', () => {
    const room = office();
    const r = interpret(room, 'desk cluster B task');
    expect(r).toHaveLength(1);
    expect(r[0]!.objectIndex).toBe(idx(room, 'Desk cluster B'));
  });

  it('pendants by name', () => {
    const room = office();
    const r = interpret(room, 'meeting table pendants');
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('FeaturePendant');
    expect(r[0]!.objectIndex).toBe(idx(room, 'Meeting table'));
  });

  it('accent by synonym', () => {
    const room = office();
    const r = interpret(room, 'accent the artwork');
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('Accent');
    expect(r[0]!.objectIndex).toBe(idx(room, 'Brand wall'));
    expect(r[0]!.plane.kind).toBe('Vertical');
  });

  it('counter synonym', () => {
    const room = cafeteria();
    const r = interpret(room, 'servery task');
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('Task');
    expect(r[0]!.objectIndex).toBe(idx(room, 'Servery counter'));
    expect(Math.abs(r[0]!.plane.height - 3)).toBeLessThanOrEqual(1e-9);
  });

  it('plural name tokens', () => {
    const room = cafeteria();
    const r = interpret(room, 'accent the menu boards');
    expect(r).toHaveLength(1);
    expect(r[0]!.objectIndex).toBe(idx(room, 'Menu boards'));
  });

  it('cove follows the cloud', () => {
    const room = cafeteria();
    const r = interpret(room, 'add a cove glow');
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('CeilingGlow');
    expect(r[0]!.plane.kind).toBe('Ceiling');
    expect(Math.abs(r[0]!.plane.height - 12)).toBeLessThanOrEqual(1e-9);
    const zones = room.ceilingZones.filter((z) => !z.isMain);
    expect(zones).toHaveLength(1);
    expect(r[0]!.region).toEqual(zones[0]!.loops[0]);
  });

  it('room-wide ambient', () => {
    const room = office();
    const r = interpret(room, 'general ambient light');
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('Ambient');
    expect(Math.abs(area(r[0]!.region) - area(room.floor[0]!))).toBeLessThanOrEqual(1e-6);
  });

  it('path band', () => {
    const r = interpret(lobby(), 'light the path');
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('Path');
    expect(Math.abs(r[0]!.plane.height)).toBeLessThanOrEqual(1e-9);
    const b = bounds(r[0]!.region);
    expect(Math.abs(Math.min(b.max.x - b.min.x, b.max.y - b.min.y) - 4)).toBeLessThanOrEqual(1e-9);
  });

  it('kind joins following target', () => {
    const room = office();
    const r = interpret(room, 'wash and accent the brand wall');
    expect(sorted(r.map((i) => i.kind))).toEqual(['Accent', 'WallWash']);
    for (const i of r) expect(i.objectIndex).toBe(idx(room, 'Brand wall'));
  });

  it('empty text', () => {
    expect(interpret(office(), '')).toEqual([]);
    expect(interpret(office(), '   ')).toEqual([]);
  });

  it('unreadable text', () => {
    expect(interpret(office(), 'hello there, how are you?')).toEqual([]);
  });

  it('no duplicates', () => {
    expect(interpret(office(), 'wash the north wall, wash the north wall')).toHaveLength(1);
  });
});

describe('interpreter (derived cases)', () => {
  it('kindsIn order', () => {
    expect(kindsIn('accent and wash')).toEqual(['Accent', 'WallWash']);
    expect(kindsIn('wash and accent the brand wall')).toEqual(['WallWash', 'Accent']);
  });

  it('kindsIn tie order', () => {
    // No two kind patterns can start at the same character (their first words differ), so a tie cannot be built from
    // real text; check that each kind appears once and in phrase order instead.
    expect(kindsIn('glow and ambient, wash the cove, keep it dim')).toEqual(['CeilingGlow', 'Ambient', 'WallWash', 'KeepDim']);
    expect(kindsIn('read wash')).toEqual(['Task', 'WallWash']);
  });

  it('singularise', () => {
    expect(tokens('desks glass its tables')).toEqual(['desk', 'glass', 'its', 'table']);
    expect(tokens('b2 bus')).toEqual(['b', '2', 'bus']);
  });

  it('name words', () => {
    expect(nameWords('desk cluster B task')).toEqual(new Set(['desk', 'cluster', 'b']));
    expect(nameWords('the a')).toEqual(new Set());
    expect(nameWords('table 1')).toEqual(new Set(['table', '1']));
    expect(nameWords('a b')).toEqual(new Set());
    expect(nameWords('cluster b')).toEqual(new Set(['cluster', 'b']));
    expect(nameWords("don't")).toEqual(new Set(['don', 't']));
    expect(nameWords('ambient 30 fc')).toEqual(new Set());
  });

  it('levels', () => {
    expect(levelIn('ambient 30 fc')).toBe(30);
    expect(levelIn('500 lux')).toBe(46.5);
    expect(levelIn('ambient 0 fc')).toBeNull();
    expect(levelIn('ambient 250 fc')).toBeNull();
    expect(levelIn('20 footcandles')).toBe(20);
  });

  it('level out of range keeps the default target', () => {
    for (const t of ['ambient 0 fc', 'ambient 250 fc']) {
      const r = interpret(office(), t);
      expect(r).toHaveLength(1);
      expect(r[0]!.target).toEqual({ minimum: 10, average: 20, maximum: 35 });
      expect(r[0]!.targetReason).toBe('Office ambient, IES 10–35 fc at the work plane');
    }
  });

  it('level overrides', () => {
    const t = (s: string): LightingIntent => interpret(office(), s)[0]!;
    expect(t('ambient 30 fc').target).toEqual({ minimum: 21, average: 30, maximum: 45 });
    expect(t('ambient 15 fc').target).toEqual({ minimum: 10.5, average: 15, maximum: 22.5 });
    expect(t('ambient 40 fc').target).toEqual({ minimum: 28, average: 40, maximum: 60 });
    expect(t('ambient 500 lux').targetReason).toBe('Requested 46.5 fc');
    expect(t('ambient 15 fc').targetReason).toBe('Requested 15 fc');
  });

  it('"." splits a decimal level (reference behaviour)', () => {
    expect(clauses(office(), 'ambient 40.5 fc')).toEqual(['ambient 40', '5 fc']);
    const r = interpret(office(), 'ambient 40.5 fc');
    expect(r).toHaveLength(1);
    expect(r[0]!.targetReason).toBe('Office ambient, IES 10–35 fc at the work plane');
  });

  it('compound compass and -ern suffix', () => {
    expect(wallsNamed(office(), 'north east')).toEqual([]);
    expect(wallsNamed(office(), 'the western wall')).toEqual([3]);
    expect(wallsNamed(office(), 'north-west and south')).toEqual([0]);
  });

  it('codec-only level path', () => {
    const room = office();
    const r = forTarget(room, 'KeepDim', [], [idx(room, 'Screen')], 4);
    expect(r).toHaveLength(1);
    expect(r[0]!.target).toEqual({ minimum: null, average: null, maximum: 4 });
    expect(r[0]!.targetReason).toBe('Requested 4 fc');
  });

  it('window, door, long and all walls', () => {
    const room = office();
    expect(interpret(room, 'wash the window wall').map((i) => i.wallIndex)).toEqual([0]);
    expect(interpret(room, 'wash the door wall').map((i) => i.wallIndex)).toEqual([3]);
    const all = interpret(room, 'wash the walls').map((i) => i.wallIndex);
    expect(all).not.toContain(0); // window wall skipped while plain walls exist
    expect(all.length).toBeGreaterThan(0);
  });

  it('no floor → nothing', () => {
    const room = { ...office(), floor: [] };
    expect(interpret(room, 'ambient')).toEqual([]);
    expect(forTarget(room, 'Ambient', [], [])).toEqual([]);
  });

  it('data hall: task from seeds, keep-dim band on a named wall', () => {
    const room = dataHall();
    expect(interpret(room, 'task lighting in the aisles').map((i) => i.label)).toEqual([
      'Aisle 1 task',
      'Aisle 2 task',
      'Aisle 3 task',
    ]);
    const dim = interpret(room, 'keep the north wall dim');
    expect(dim).toHaveLength(1);
    expect(dim[0]!.wallIndex).toBeNull();
  });

  it('fresh ids and not suggestions', () => {
    const r = interpret(office(), 'task light on the desks');
    expect(new Set(r.map((i) => i.id)).size).toBe(r.length);
    for (const i of r) {
      expect(i.id).toMatch(/^[0-9a-f]{8}$/);
      expect(i.isSuggestion).toBe(false);
      expect(i.labelSuggested).toBe(true);
    }
  });
});
