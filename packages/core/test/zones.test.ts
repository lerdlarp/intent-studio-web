// spec/zones.md test table.
import { describe, expect, it } from 'vitest';
import { createIntent, createRoom, type LightingIntent, type RoomDesign, type StudioRoom } from '../src/model';
import { centroid, heading, perp, rect } from '../src/geometry';
import { intentSpacing, zoneShape, zones, MAX_ZONES_PER_ROOM } from '../src/zones';
import { goldenIntent, goldenRoom, loadGolden, type GoldenRoomName } from './golden/load';

const design = (room: StudioRoom, intents: LightingIntent[]): RoomDesign => ({
  room,
  intents,
  removedExisting: [],
  calculation: null,
  revision: 0,
});
/** All golden seeds accepted (isSuggestion = false), not solved. */
const accepted = (name: GoldenRoomName): RoomDesign =>
  design(
    goldenRoom(name),
    loadGolden(name).seeds.map((s) => ({ ...goldenIntent(s), isSuggestion: false })),
  );
const vertical = (bottom: number, top: number) =>
  ({ kind: 'Vertical', height: bottom, bottom, top, inferred: true, reason: '' }) as const;

describe('zones', () => {
  it('one zone per intent plus surfaces', () => {
    const d = accepted('Office');
    const sugg = createIntent({
      id: 'sugg',
      kind: 'Task',
      isSuggestion: true,
      region: rect({ x: 0, y: 0 }, { x: 10, y: 10 }),
    });
    d.intents.push(sugg);
    const z = zones(d);
    const ids = z.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const real = d.intents.filter((i) => !i.isSuggestion);
    for (const i of real) expect(ids).toContain(i.id);
    expect(ids).not.toContain('sugg');
    for (const id of [
      'surface:floor',
      'surface:ceiling',
      'surface:wall:0',
      'surface:wall:1',
      'surface:wall:2',
      'surface:wall:3',
    ])
      expect(ids).toContain(id);
    expect(z).toHaveLength(real.length + 6);
    expect(zones(d, false)).toHaveLength(real.length);
    for (const x of z) {
      if (x.id.startsWith('surface:')) {
        expect(x.label.startsWith('Surface · ')).toBe(true);
        expect(x.target).toBeUndefined();
      } else expect(x.label.startsWith('Intent · ')).toBe(true);
    }
    expect(z.find((x) => x.id === 'surface:wall:2')!.label).toBe('Surface · North wall');
  });

  it('surfaces', () => {
    const z = zones(design(goldenRoom('Cafeteria'), []));
    const floor = z.find((x) => x.id === 'surface:floor')!;
    expect(floor).toMatchObject({ kind: 'horizontal', height: 0, spacing: 2 });
    expect(z.find((x) => x.id === 'surface:ceiling')).toMatchObject({ kind: 'ceiling', height: 10 });
    expect(z.find((x) => x.id === 'surface:wall:2')).toMatchObject({ kind: 'vertical', bottom: 0, top: 10 });
  });

  it('big room spacing', () => {
    const room = createRoom({ label: 'Hangar', floor: [rect({ x: 0, y: 0 }, { x: 60, y: 40 })], ceilingHeight: 20 });
    expect(zones(design(room, [])).find((x) => x.id === 'surface:floor')!.spacing).toBe(3);
  });

  it('intent spacing', () => {
    expect([99, 100, 1500, 1501].map(intentSpacing)).toEqual([1, 2, 2, 3]);
  });

  it('wash run', () => {
    const room = goldenRoom('Office');
    const w = room.walls[2]!;
    const dir = { x: -1, y: 0 };
    const wash = createIntent({
      kind: 'WallWash',
      region: [
        { x: w.start.x + dir.x * 4, y: w.start.y + dir.y * 4 },
        { x: w.start.x + dir.x * 20, y: w.start.y + dir.y * 20 },
      ],
      wallIndex: 2,
      plane: vertical(2, 8),
    });
    const z = zones(design(room, [wash]), false);
    expect(z).toHaveLength(1);
    const x = z[0]!;
    expect(x.id).toBe(wash.id);
    expect(x).toMatchObject({ kind: 'vertical', spacing: 1, bottom: 2, top: 8 });
    expect(Math.abs(x.from!.y - 24)).toBeLessThan(1e-9);
    expect(Math.abs(Math.min(x.from!.x, x.to!.x) - 16)).toBeLessThan(1e-9);
    expect(Math.abs(Math.max(x.from!.x, x.to!.x) - 32)).toBeLessThan(1e-9);
  });

  describe('accent', () => {
    const d = accepted('Office');
    const room = d.room;
    const objectIndex = room.objects.findIndex((o) => o.kind === 'artwork');
    const o = room.objects[objectIndex]!;
    // faceMidpoint (workplane.md §2)
    const c = centroid(room.floor[0]!);
    let n = perp(heading(o.orientation));
    if (n.x * (c.x - o.center.x) + n.y * (c.y - o.center.y) < 0) n = { x: -n.x, y: -n.y };
    const face = { x: o.center.x + (n.x * o.width) / 2, y: o.center.y + (n.y * o.width) / 2 };
    const seed = d.intents.find((i) => i.kind === 'Accent')!;
    const accent = createIntent({
      kind: 'Accent',
      region: [face],
      objectIndex,
      target: seed.target,
      plane: seed.plane,
    });

    it('patch on a face', () => {
      expect(face.y).toBeCloseTo(23.75, 12);
      const z = zones({ ...d, intents: [...d.intents, accent] }).find((x) => x.id === accent.id)!;
      expect(z.kind).toBe('vertical');
      expect(Math.abs(Math.abs(z.to!.x - z.from!.x) - 3)).toBeLessThan(1e-9);
      expect(z.target?.min).toBe(accent.target.minimum ?? undefined);
      expect(z.target?.avg).toBeDefined();
    });

    it('on a horizontal plane', () => {
      const h = {
        ...accent,
        region: [{ x: 10, y: 10 }],
        plane: { kind: 'Horizontal', height: 2.5, bottom: 0, top: 0, inferred: true, reason: '' } as const,
      };
      const z = zones(design(room, [h]), false)[0]!;
      expect(z.kind).toBe('horizontal');
      expect(z.polygon).toEqual(rect({ x: 8.5, y: 8.5 }, { x: 11.5, y: 11.5 }));
      expect(z.height).toBe(2.5);
    });
  });

  it('ceiling glow', () => {
    const d = accepted('Cafeteria');
    const glow = d.intents.find((i) => i.kind === 'CeilingGlow')!;
    expect(zones(d).find((x) => x.id === glow.id)).toMatchObject({ kind: 'ceiling', height: 12 });
  });

  it('keep-dim target', () => {
    const d = accepted('Office');
    const kd = d.intents.find((i) => i.kind === 'KeepDim')!;
    expect(zones(d).find((x) => x.id === kd.id)!.target).toEqual({ max: 5 });
  });

  it('zone cap', () => {
    const room = goldenRoom('Office');
    const intents = Array.from({ length: 80 }, () => createIntent({ kind: 'Ambient', region: room.floor[0]! }));
    expect(zones(design(room, intents))).toHaveLength(MAX_ZONES_PER_ROOM);
  });

  const wallRoom = (len: number): StudioRoom =>
    createRoom({
      floor: [rect({ x: 0, y: -10 }, { x: len, y: 0 })],
      walls: [
        { index: 0, start: { x: 0, y: 0 }, end: { x: len, y: 0 }, inward: { x: 0, y: -1 }, top: 9, openings: [] },
      ],
    });

  it('short run slides', () => {
    const wash = createIntent({
      kind: 'WallWash',
      region: [
        { x: 35.5, y: 0 },
        { x: 36, y: 0 },
      ],
      wallIndex: 0,
      plane: vertical(2, 8),
    });
    const s = zoneShape(design(wallRoom(36), [wash]), wash)!;
    expect(s.from.x).toBeCloseTo(33, 12);
    expect(s.to.x).toBeCloseTo(36, 12);
  });

  it('short wall', () => {
    const wash = createIntent({ kind: 'WallWash', region: [{ x: 1, y: 0 }], wallIndex: 0, plane: vertical(2, 0) });
    const s = zoneShape(design(wallRoom(2), [wash]), wash)!;
    expect(s.from.x).toBe(0);
    expect(s.to.x).toBe(2);
    expect(s.top).toBe(9); // plane.top ≤ bottom → wall top
  });

  it('no wall', () => {
    const room = createRoom({ floor: [rect({ x: 0, y: 0 }, { x: 10, y: 10 })] });
    const wash = createIntent({ kind: 'WallWash', region: [{ x: 1, y: 0 }], plane: vertical(2, 8) });
    expect(zoneShape(design(room, [wash]), wash)).toBeNull();
    expect(zones(design(room, [wash]), false)).toHaveLength(0);
  });

  it('fewer than 3 polygon points → null (no floor, empty region)', () => {
    const i = createIntent({ kind: 'Ambient' });
    expect(zoneShape(design(createRoom(), [i]), i)).toBeNull();
  });
});
