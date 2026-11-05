import { describe, expect, it } from 'vitest';
import {
  aisleNumber,
  capitalize,
  className,
  classFromWords,
  classOf,
  cleanName,
  clusters,
  defaultLabel,
  defaultTarget,
  letter,
  spaceType,
  wallName,
} from '../src/defaults';
import {
  cafeteria,
  createRoom,
  dataHall,
  footprint,
  inflate,
  lobby,
  office,
  rect,
  type IntentKind,
  type P2,
  type RoomObjectInfo,
  type StudioRoom,
  type WallInfo,
} from '../src/index';

const Square: P2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const pt = (x: number, y: number): P2 => ({ x, y });
const obj = (init: Partial<RoomObjectInfo> & { kind: string }): RoomObjectInfo => ({
  name: '',
  center: pt(0, 0),
  length: 3,
  width: 2,
  orientation: 0,
  top: 2.5,
  bottom: 0,
  ...init,
});
const roomWith = (label: string, objects: RoomObjectInfo[] = [], extra: Partial<StudioRoom> = {}): StudioRoom =>
  createRoom({ label, objects, floor: [Square], ...extra });
const wall = (inward: P2, extra: Partial<WallInfo> = {}): WallInfo => ({
  index: 0,
  start: pt(0, 10),
  end: pt(10, 10),
  inward,
  top: 9,
  openings: [],
  ...extra,
});
const rng = (t: { minimum: number | null; average: number | null; maximum: number | null }): unknown[] => [
  t.minimum,
  t.average,
  t.maximum,
];

describe('space class and space type', () => {
  it('office demo space type', () => expect(spaceType(office())).toBe('open office'));
  it('classOf from labels', () => {
    expect(classOf(roomWith('3B Data hall'))).toBe('DataHall');
    expect(classOf(roomWith('Staff dining'))).toBe('Cafeteria');
    expect(classOf(roomWith('Boardroom 4'))).toBe('Conference');
  });
  it('from objects when the label says nothing', () => {
    const desks = [0, 1, 2, 3].map((i) => obj({ name: `Desk ${i}`, kind: 'desk', center: pt(i * 4, 0), length: 3, width: 2 }));
    expect(spaceType(roomWith('Room 12', desks))).toBe('open office');
  });
  it('nothing known', () => expect(spaceType(roomWith('Room 12'))).toBe('room'));
  it('golden classFromWords examples', () => {
    const cases: [string, string | null][] = [
      ['204 Open office', 'OpenOffice'],
      ['Data hall 3B', 'DataHall'],
      ['Main lobby', 'Lobby'],
      ['Hallway', 'Corridor'],
      ['Board room', 'Conference'],
      ['Servery', 'Cafeteria'],
      ['Storage', 'Storage'],
      ['Break room', 'BreakRoom'],
      ['Unknown space', null],
    ];
    for (const [t, c] of cases) expect(classFromWords(t)).toBe(c);
  });
  it('whitespace and null', () => {
    expect(classFromWords('   ')).toBeNull();
    expect(classFromWords(null)).toBeNull();
    expect(classFromWords('')).toBeNull();
  });
  it('order and Unicode boundaries', () => {
    expect(classFromWords('Data hall')).toBe('DataHall');
    expect(classFromWords('Elevator lobby')).toBe('Lobby');
    expect(classFromWords('Café 2')).toBe('Cafeteria');
    expect(classFromWords('Hallmark')).toBeNull();
    expect(classFromWords('CAFÉ')).toBe('Cafeteria');
    expect(classFromWords('Open-plan office')).toBe('OpenOffice');
  });
  it('spaceType trimmed', () => {
    expect(spaceType(createRoom({ spaceType: '  open office  ' }))).toBe('open office');
  });
  it('class from objects', () => {
    const n = (kind: string, count: number): RoomObjectInfo[] => Array.from({ length: count }, () => obj({ kind }));
    expect(classOf(roomWith('X', n('desk', 1)))).toBe('Office');
    expect(classOf(roomWith('X', n('reception', 1)))).toBe('Lobby');
    expect(classOf(roomWith('X', n('cabinet', 4)))).toBe('DataHall');
    expect(classOf(roomWith('X', n('table', 6)))).toBe('Cafeteria');
    expect(classOf(roomWith('X', n('table', 1)))).toBe('Conference');
    expect(classOf(roomWith('X', n('seating', 2)))).toBe('BreakRoom');
    expect(classOf(roomWith('X', n('seating', 1)))).toBe('Other');
  });
  it('golden spaceClass / spaceTypeWords', () => {
    expect([office(), cafeteria(), lobby(), dataHall()].map(classOf)).toEqual(['OpenOffice', 'Cafeteria', 'Lobby', 'DataHall']);
    expect([office(), cafeteria(), lobby(), dataHall()].map(spaceType)).toEqual(['open office', 'cafeteria', 'lobby', 'data hall']);
  });
  it('className table', () => {
    expect(className('Storage')).toBe('storage room');
    expect(className('Other')).toBe('room');
  });
});

describe('targets', () => {
  type Args = [IntentKind, (number | null)?, (number | null)?];
  const cases: [string, StudioRoom, Args, unknown[], string][] = [
    ['office ambient', office(), ['Ambient'], [10, 20, 35], 'Office ambient, IES 10–35 fc at the work plane'],
    ['office desk task', office(), ['Task', 0], [20, 30, 50], 'Office desk task, IES 20–50 fc'],
    ['cafeteria ambient', cafeteria(), ['Ambient'], [10, 15, 25], 'Cafeteria dining ambient, IES 10–25 fc at table height'],
    ['servery counter', cafeteria(), ['Task', 0], [25, 40, 60], 'Servery counter, 25–60 fc'],
    ['lobby ambient', lobby(), ['Ambient'], [5, 10, 20], 'Lobby and circulation ambient, 5–20 fc on the floor'],
    ['wall wash', office(), ['WallWash'], [15, 25, 45], 'Wall wash, 15–45 fc vertical'],
    ['feature pendant', office(), ['FeaturePendant'], [15, 25, 40], 'Feature pendants over a table, 15–40 fc'],
    ['ceiling glow', office(), ['CeilingGlow'], [5, 10, 20], 'Ceiling glow, 5–20 fc on the ceiling'],
    ['path', office(), ['Path'], [1, 3, 10], 'Path of travel, 1–10 fc'],
    ['keep dim', office(), ['KeepDim'], [null, null, 5], 'Keep dim: nothing brighter than 5 fc'],
    ['data hall ambient', dataHall(), ['Ambient'], [20, 30, 50], 'Data hall aisle, 20–50 fc on the floor'],
    ['data hall task', dataHall(), ['Task'], [20, 30, 50], 'Data hall cold aisle, 20–50 fc on the floor'],
    ['accent 3x', office(), ['Accent', null, 20], [null, 60, null], '3× the surrounding ambient (20 fc)'],
    ['accent fallback', office(), ['Accent', null, null], [30, 50, 80], 'Accent, 30–80 fc (no surrounding ambient yet)'],
    ['accent ambient 0', office(), ['Accent', null, 0], [30, 50, 80], 'Accent, 30–80 fc (no surrounding ambient yet)'],
    ['accent formatting', office(), ['Accent', null, 12.25], [null, 36.8, null], '3× the surrounding ambient (12.3 fc)'],
    ['lobby reception task', lobby(), ['Task', 0], [20, 30, 50], 'Reception desk task, 20–50 fc'],
    ['office meeting table task', office(), ['Task', 3], [20, 30, 50], 'Office task, IES 20–50 fc'],
    ['task without index', cafeteria(), ['Task'], [20, 30, 50], 'Office task, IES 20–50 fc'],
  ];
  for (const [name, room, args, range, reason] of cases) {
    it(name, () => {
      const r = defaultTarget(room, args[0], args[1], args[2]);
      expect(rng(r.target)).toEqual(range);
      expect(r.reason).toBe(reason);
    });
  }
  it('other class ambients', () => {
    const t = (label: string) => defaultTarget(roomWith(label), 'Ambient');
    expect(t('Classroom 1').reason).toBe('Classroom ambient, IES 20–50 fc');
    expect(t('Retail shop').reason).toBe('Retail ambient, 15–40 fc');
    expect(t('Restroom').reason).toBe('Support space ambient, 10–30 fc');
    expect(t('Storage').reason).toBe('Storage ambient, 5–20 fc');
  });
  it('task variants', () => {
    const r = roomWith('Classroom', [obj({ kind: 'desk' }), obj({ kind: 'bar' }), obj({ kind: 'island' })]);
    expect(defaultTarget(r, 'Task', 0).reason).toBe('Classroom desk, IES 30–75 fc');
    expect(defaultTarget(r, 'Task', 1).reason).toBe('Bar counter, 15–40 fc');
    expect(defaultTarget(r, 'Task', 2).reason).toBe('Counter task, 25–60 fc');
    const c = roomWith('Dining', [obj({ kind: 'table' })]);
    expect(defaultTarget(c, 'Task', 0).reason).toBe('Dining table, 10–35 fc');
    const m = roomWith('Meeting', [obj({ kind: 'table' })]);
    expect(defaultTarget(m, 'Task', 0).reason).toBe('Conference table, IES 20–50 fc');
  });
});

describe('labels', () => {
  const o = office();
  it('desk task label', () => {
    const region = inflate(footprint(o.objects[0] as RoomObjectInfo), 1.5);
    expect(defaultLabel(o, 'Task', region)).toBe('Desk cluster A task');
  });
  it('brand wall accent', () => expect(defaultLabel(o, 'Accent', [pt(10, 23.5)], null, 6)).toBe('Brand wall accent'));
  it('screen keep dim', () => expect(defaultLabel(o, 'KeepDim', [], null, 7)).toBe('Screen — keep dim'));
  it('ambient from space type', () => expect(defaultLabel(o, 'Ambient', o.floor[0] as P2[])).toBe('Open office ambient'));
  it('entry path', () => expect(defaultLabel(lobby(), 'Path', [])).toBe('Entry path'));
  it('cove glow', () => {
    const c = cafeteria();
    expect(defaultLabel(c, 'CeilingGlow', (c.ceilingZones[1]?.loops[0] ?? []) as P2[])).toBe('Cove glow');
  });
  it('north wall wash', () => {
    const r = roomWith('Hall', [], { walls: [wall(pt(0, -1))] });
    expect(defaultLabel(r, 'WallWash', [pt(0, 10), pt(10, 10)], 0)).toBe('North wall wash');
  });
  it('zone ambient', () => expect(defaultLabel(o, 'Ambient', rect(pt(0, 0), pt(10, 10)))).toBe('Zone ambient'));
  it('bar task (single object)', () => {
    const bar = obj({ name: 'Bar', kind: 'bar', center: pt(5, 5), length: 8, width: 2 });
    const r = roomWith('Lounge', [bar]);
    expect(defaultLabel(r, 'Task', inflate(footprint(bar), 1))).toBe('Bar task');
  });
  it('display table accent', () => {
    const t = obj({ name: 'Display table', kind: 'table', center: pt(5, 5), length: 4, width: 3 });
    expect(defaultLabel(roomWith('Showroom', [t]), 'Accent', [pt(5, 5)])).toBe('Display table accent');
  });
  it('reception pendants', () => {
    const l = lobby();
    expect(defaultLabel(l, 'FeaturePendant', footprint(l.objects[0] as RoomObjectInfo))).toBe('Reception desk pendants');
  });
  it('aisle labels', () => {
    const d = dataHall();
    const regions = [rect(pt(6, 20), pt(34, 24)), rect(pt(6, 14), pt(34, 18)), rect(pt(6, 8), pt(34, 12))];
    regions.forEach((r, i) => {
      expect(aisleNumber(d, r)).toBe(i + 1);
      expect(defaultLabel(d, 'Task', r)).toBe(`Aisle ${i + 1} task`);
    });
  });
  it('not an aisle', () => expect(defaultLabel(dataHall(), 'Task', rect(pt(0, 0), pt(4, 4)))).toBe('Task zone'));
  it('keep dim / accent / path / wash fallbacks', () => {
    expect(defaultLabel(o, 'KeepDim', [])).toBe('Keep-dim zone');
    expect(defaultLabel(o, 'Accent', [pt(18, 12)])).toBe('Accent');
    expect(defaultLabel(o, 'Path', [])).toBe('Path');
    expect(defaultLabel(createRoom(), 'WallWash', [])).toBe('Wall wash');
  });
  it('golden seed labels', () => {
    expect([office(), cafeteria(), lobby(), dataHall()].map((r) => defaultLabel(r, 'Ambient', r.floor[0] as P2[]))).toEqual([
      'Open office ambient',
      'Cafeteria ambient',
      'Lobby ambient',
      'Data hall ambient',
    ]);
  });
});

describe('wall names, letters, clean names', () => {
  it('compass with +Y north', () => {
    expect([0, 1, 2, 3].map((i) => wallName(office(), i))).toEqual(['South wall', 'East wall', 'North wall', 'West wall']);
  });
  it('out of range', () => {
    expect(wallName(office(), 7)).toBe('Wall 8');
    expect(wallName(office(), -1)).toBe('Wall 0');
  });
  it('duplicates numbered', () => {
    const r = roomWith('R', [], { walls: [wall(pt(0, -1)), wall(pt(0, -1))] });
    expect([wallName(r, 0), wallName(r, 1)]).toEqual(['North wall 1', 'North wall 2']);
  });
  it('diagonal', () => {
    const h = Math.SQRT1_2;
    expect(wallName(roomWith('R', [], { walls: [wall(pt(-h, -h))] }), 0)).toBe('Northeast wall');
  });
  it('half-sector tie goes to East', () => {
    const a = (22.5 * Math.PI) / 180;
    const r = roomWith('R', [], { walls: [wall(pt(-Math.cos(a), -Math.sin(a)))] });
    expect(wallName(r, 0)).toBe('East wall');
  });
  it('letter', () => expect([0, 2, 30, -1].map(letter)).toEqual(['A', 'C', 'Z', 'A']));
  it('capitalize', () => {
    expect(capitalize('abc')).toBe('Abc');
    expect(capitalize('')).toBe('');
  });
  it('cleanName', () => {
    expect(cleanName(obj({ name: 'Desk_Type-A : 1200', kind: 'desk' }))).toBe('Desk Type A');
    expect(cleanName(obj({ name: 'menu boards', kind: 'signage' }))).toBe('Menu boards');
    expect(cleanName(obj({ name: '', kind: 'table' }))).toBe('Table');
    expect(cleanName(obj({ name: '', kind: 'sofa' }))).toBe('Object');
  });
});

describe('clusters', () => {
  const brief = (r: StudioRoom) => clusters(r).map((c) => ({ g: c.group, o: c.ordinal, objs: c.objects }));
  it('office desks: three clusters', () => {
    const d = clusters(office()).filter((c) => c.group === 'desk');
    expect(d.map((c) => c.ordinal)).toEqual([0, 1, 2]);
    expect(d.map((c) => c.objects)).toEqual([[0], [1], [2]]);
  });
  it('office regions (golden)', () => {
    const c = clusters(office());
    const box = (i: number): number[] => {
      const r = c[i]!.region;
      return [r[0]!.x, r[0]!.y, r[2]!.x, r[2]!.y];
    };
    expect(box(0)).toEqual([2, 9.75, 16, 15.75]);
    expect(box(1)).toEqual([2, 2.75, 16, 8.75]);
    expect(box(2)).toEqual([17, 2.75, 27, 8.75]);
    expect(c[3]!.group).toBe('table');
    expect(box(3)).toEqual([22.5, 13.5, 33.5, 20.5]);
  });
  it('desks within 3 ft merge', () => {
    const d = (x: number, y: number): RoomObjectInfo => obj({ kind: 'desk', center: pt(x, y), length: 4, width: 2 });
    const r = createRoom({ label: 'Open office', floor: [rect(pt(0, 0), pt(30, 20))], objects: [d(5, 5), d(5, 8), d(20, 5)] });
    const c = clusters(r);
    expect(c.map((x) => x.objects)).toEqual([[0, 1], [2]]);
    expect(c[0]!.region).toEqual([pt(1.5, 2.5), pt(8.5, 2.5), pt(8.5, 10.5), pt(1.5, 10.5)]);
    expect(c[1]!.region).toEqual([pt(16.5, 2.5), pt(23.5, 2.5), pt(23.5, 7.5), pt(16.5, 7.5)]);
  });
  it('cafeteria, lobby, data hall', () => {
    const c = clusters(cafeteria());
    expect(brief(cafeteria()).slice(0, 1)).toEqual([{ g: 'counter', o: 0, objs: [0] }]);
    const t = c.find((x) => x.group === 'table')!;
    expect(t.objects).toEqual(Array.from({ length: 24 }, (_, i) => i + 2));
    expect(t.region[0]!.x).toBeCloseTo(7.7, 9);
    expect(t.region[2]!.y).toBeCloseTo(23.8, 9);
    const l = clusters(lobby());
    expect(l.map((x) => x.objects)).toEqual([[0]]);
    expect(l[0]!.region[0]).toEqual(pt(12.5, 14));
    expect(clusters(dataHall())).toEqual([]);
  });
});
