import { describe, expect, it } from 'vitest';
import { StudioRoomSchema, office } from '@intent-studio/core';
import { applyRoomEdits, extractRooms, manualRoom } from './extract';

describe('room confirmation edits', () => {
  it('sets label and kinds without rebuilding when outline and height are unchanged', async () => {
    const room = office();
    const kinds = room.objects.map((_, k) => (k === 0 ? 'table' : room.objects[k]!.kind));
    const out = await applyRoomEdits(room, {
      label: 'Renamed',
      ceilingHeight: room.ceilingHeight,
      outline: null,
      kinds,
    });
    expect(out.label).toBe('Renamed');
    expect(out.objects[0]!.kind).toBe('table');
    expect(out.walls).toEqual(room.walls);
  });

  it('rebuilds walls and zones on a ceiling-height change, keeping openings', async () => {
    const room = office();
    const out = await applyRoomEdits(room, {
      label: room.label,
      ceilingHeight: 10,
      outline: null,
      kinds: room.objects.map((o) => o.kind),
    });
    expect(StudioRoomSchema.safeParse(out).success).toBe(true);
    expect(out.ceilingHeight).toBe(10);
    expect(out.walls).toHaveLength(room.walls.length);
    expect(out.walls.flatMap((w) => w.openings).length).toBe(room.walls.flatMap((w) => w.openings).length);
  });

  it('builds a manual room from a polygon', async () => {
    const r = await manualRoom(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
        { x: 0, y: 20 },
      ],
      9,
      'Manual',
    );
    expect(r.label).toBe('Manual');
    expect(r.walls).toHaveLength(4);
    expect(r.ceilingHeight).toBe(9);
  });
});

describe('unreadable scene files', () => {
  it('a broken GLB fails with a clear message that offers the manual outline', async () => {
    const junk = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 9, 9, 9, 9]).buffer;
    const stages: string[] = [];
    await expect(extractRooms(junk, 'broken.glb', undefined, (s) => stages.push(s))).rejects.toThrow(
      /“broken\.glb” could not be read as a 3D scene .*enter the room outline by hand/,
    );
    expect(stages).toEqual(['parse']);
  });
  it('an unknown format names the expected formats', async () => {
    await expect(extractRooms(new ArrayBuffer(8), 'notes.txt')).rejects.toThrow(
      /expected \.glb, \.gltf, \.obj or \.fbx/,
    );
  });
});
