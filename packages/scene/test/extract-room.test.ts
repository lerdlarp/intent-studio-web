import { describe, expect, it } from 'vitest';
import { StudioRoomSchema, area, signedArea, type StudioRoom } from '@intent-studio/core';
import { extractRooms, type ExtractResult } from '../src/extract-room';
import { furnish, officeRoom, roundTrip } from './helpers';

const close = (a: number, b: number, tol = 0.02): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

async function office(): Promise<{ result: ExtractResult; room: StudioRoom }> {
  const s = officeRoom();
  furnish(s);
  const loaded = await roundTrip(s);
  const result = extractRooms(loaded, { sourceName: 'office.glb' });
  return { result, room: (result.rooms[0] as { room: StudioRoom }).room };
}

describe('geometry strategy: 30 × 20 × 9 ft office GLB', async () => {
  const { result, room } = await office();

  it('finds one room by geometry and parses through StudioRoomSchema', () => {
    expect(result.strategy).toBe('geometry');
    expect(result.rooms).toHaveLength(1);
    expect(StudioRoomSchema.parse(room)).toEqual(room);
  });

  it('outline: 600 ft², CCW, rectangle starting at the SW corner', () => {
    expect(room.floor).toHaveLength(1);
    const outline = room.floor[0] ?? [];
    expect(outline).toHaveLength(4);
    expect(signedArea(outline)).toBeGreaterThan(0);
    close(area(outline), 600, 0.5);
    const expected = [
      [0, 0],
      [30, 0],
      [30, 20],
      [0, 20],
    ];
    outline.forEach((p, k) => {
      close(p.x, expected[k]?.[0] as number);
      close(p.y, expected[k]?.[1] as number);
    });
  });

  it('walls follow the outline with inward normals', () => {
    expect(room.walls).toHaveLength(4);
    const w0 = room.walls[0];
    expect(w0?.inward).toEqual({ x: 0, y: 1 });
    expect(room.walls[1]?.inward).toEqual({ x: -1, y: 0 });
    for (const w of room.walls) close(w.top, 9);
  });

  it('ceiling 9 ft with an 11 ft pocket zone and its steps', () => {
    close(room.ceilingHeight, 9);
    const main = room.ceilingZones.filter((z) => z.isMain);
    const pockets = room.ceilingZones.filter((z) => !z.isMain);
    expect(main).toHaveLength(1);
    expect(pockets).toHaveLength(1);
    const pocket = pockets[0];
    close(pocket?.height as number, 11);
    const loop = pocket?.loops[0] ?? [];
    expect(loop).toHaveLength(4);
    expect(signedArea(loop)).toBeGreaterThan(0);
    close(area(loop), 36, 0.2);
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    close(Math.min(...xs), 12);
    close(Math.max(...xs), 18);
    close(Math.min(...ys), 8);
    close(Math.max(...ys), 14);
    expect(room.ceilingSteps).toHaveLength(4);
    for (const s of room.ceilingSteps) {
      close(s.lowerHeight, 9);
      close(s.upperHeight, 11);
    }
  });

  it('window opening on the south wall: from 10 to 20, sill 3, head 7', () => {
    const ops = room.walls[0]?.openings ?? [];
    expect(ops).toHaveLength(1);
    const o = ops[0];
    expect(o?.kind).toBe('window');
    close(o?.from as number, 10);
    close(o?.to as number, 20);
    close(o?.bottom as number, 3);
    close(o?.top as number, 7);
  });

  it('door opening on the east wall: from 4 to 7, floor to 7 ft', () => {
    const ops = room.walls[1]?.openings ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'door' });
    close(ops[0]?.from as number, 4);
    close(ops[0]?.to as number, 7);
    close(ops[0]?.bottom as number, 0);
    close(ops[0]?.top as number, 7);
    expect(room.walls[2]?.openings).toEqual([]);
    expect(room.walls[3]?.openings).toEqual([]);
  });

  it('objects: kinds, centres, dims, orientation, top/bottom', () => {
    const byName = new Map(room.objects.map((o) => [o.name, o]));
    expect([...byName.keys()].sort()).toEqual(['Artwork - Sunset', 'Desk 01', 'Desk 02', 'Office Chair', 'Thing 7']);
    const d1 = byName.get('Desk 01');
    expect(d1?.kind).toBe('desk');
    close(d1?.center.x as number, 6);
    close(d1?.center.y as number, 5);
    close(d1?.length as number, 5);
    close(d1?.width as number, 2.5);
    close(d1?.orientation as number, 0, 0.01);
    close(d1?.top as number, 2.5);
    close(d1?.bottom as number, 0);
    const d2 = byName.get('Desk 02');
    expect(d2?.kind).toBe('desk');
    close(d2?.center.x as number, 22);
    close(d2?.center.y as number, 14);
    close(d2?.length as number, 5);
    close(d2?.width as number, 2.5);
    close(d2?.orientation as number, 30, 0.01);
    const art = byName.get('Artwork - Sunset');
    expect(art?.kind).toBe('artwork');
    close(art?.center.x as number, 0.05);
    close(art?.center.y as number, 10);
    close(art?.length as number, 4);
    close(art?.width as number, 0.1);
    close(art?.orientation as number, 90, 0.01);
    close(art?.bottom as number, 4.5);
    close(art?.top as number, 7);
    expect(byName.get('Office Chair')?.kind).toBe('seating');
    expect(byName.get('Thing 7')?.kind).toBe('other');
  });

  it('per-object sources and the unresolved batch', () => {
    const r = result.rooms[0];
    expect(r?.objects).toHaveLength(room.objects.length);
    r?.objects.forEach((src, k) => {
      expect(src.objectIndex).toBe(k);
      expect(src.nodeName).toBe(room.objects[k]?.name);
      expect(src.meshes.length).toBeGreaterThan(0);
    });
    const desk = r?.objects.find((o) => o.nodeName === 'Desk 01');
    expect(desk?.meshes).toHaveLength(5);
    expect(desk?.kindSource).toBe('name');
    expect(r?.objects.find((o) => o.nodeName === 'Thing 7')?.kindSource).toBe('unresolved');
    expect(result.unresolved).toEqual([expect.objectContaining({ roomIndex: 0, name: 'Thing 7' })]);
    close(result.unresolved[0]?.top as number, 1);
  });

  it('reports structural nodes and the floor elevation', () => {
    const r = result.rooms[0];
    expect(r?.floorElevation).toBeCloseTo(0, 6);
    expect(r?.floorNodes.map((m) => m.name)).toEqual(['Slab']);
    expect(r?.wallNodes.length).toBe(9); // 6 full-height pieces + sill, header, door head
    expect(r?.ceilingNodes.length).toBe(9);
  });

  it('is deterministic (same scene → same room, stable id)', async () => {
    const again = await office();
    expect(again.room).toEqual(room);
    expect(room.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('warns and returns no rooms for an empty scene', async () => {
    const { Scene } = await import('three');
    const r = extractRooms(new Scene());
    expect(r.rooms).toEqual([]);
    expect(r.strategy).toBe('none');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
