import { describe, expect, it } from 'vitest';
import { Group, Mesh, Scene } from 'three';
import { StudioRoomSchema, area, signedArea } from '@intent-studio/core';
import { extractRooms } from '../src/extract-room';
import { hasTags, parseTagString, readNodeTags, resolveTags } from '../src/tags';
import { box, plainRoom, roundTrip } from './helpers';

const close = (a: number, b: number, tol = 0.02): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('parseTagString', () => {
  const cases: [string, ReturnType<typeof parseTagString>][] = [
    ['room:204 Open office', { room: '204 Open office' }],
    ['Room = Lobby', { room: 'Lobby' }],
    ['floor', { role: 'floor' }],
    ['Floor.001', { role: 'floor' }],
    ['ceiling (2)', { role: 'ceiling' }],
    ['Wall_North_02', { role: 'wall' }],
    ['walls', { role: 'wall' }],
    ['wall: north side', { role: 'wall' }],
    ['Window 3', { role: 'window' }],
    ['door_left', { role: 'door' }],
    ['ignore', { role: 'ignore' }],
    ['obj:desk Desk 1', { role: 'object', kind: 'desk' }],
    ['object', { role: 'object' }],
    ['obj:Sofa', { role: 'object', kind: 'seating' }],
    ['obj:plinth', { role: 'object', kind: 'display' }],
    ['room:101 Lobby|floor', { room: '101 Lobby', role: 'floor' }],
    ['Wallpaper', {}],
    ['Wall art', {}],
    ['Floor lamp', {}],
    ['Door handle', {}],
    ['Desk 01', {}],
    ['', {}],
  ];
  it.each(cases)('%j', (text, expected) => expect(parseTagString(text)).toEqual(expected));
});

describe('readNodeTags / resolveTags', () => {
  it('reads extras fields, explicit fields beating the name', () => {
    expect(readNodeTags('Wall art', { role: 'floor' })).toEqual({ role: 'floor' });
    expect(readNodeTags('Mesh 12', { type: 'Ceiling' })).toEqual({ role: 'ceiling' });
    expect(readNodeTags('Mesh', { tags: ['room:5 Lab', 'wall'] })).toEqual({ room: '5 Lab', role: 'wall' });
    expect(readNodeTags('obj:desk', { kind: 'Mirror' })).toEqual({ role: 'object', kind: 'mirror' });
    expect(readNodeTags('Group', { room: ' Gallery ' })).toEqual({ room: 'Gallery' });
    expect(readNodeTags('x', { tag: 'room:7|floor' })).toEqual({ room: '7', role: 'floor' });
  });

  it('inherits role and room from the nearest tagged ancestor', () => {
    const room = new Group();
    room.name = 'room:204 Open office';
    const desk = new Group();
    desk.name = 'obj:desk Bench';
    const top = new Mesh();
    top.name = 'Top';
    desk.add(top);
    room.add(desk);
    const t = resolveTags(top, room);
    expect(t).toMatchObject({ role: 'object', kind: 'desk', room: '204 Open office' });
    expect(t.roleNode).toBe(desk);
    expect(t.roomNode).toBe(room);
    expect(hasTags(room)).toBe(true);
    const plain = new Group();
    plain.add(new Mesh());
    expect(hasTags(plain)).toBe(false);
  });
});

/** Two tagged rooms side by side: 101 Lobby (15 × 12, 8 ft, window) and 102 Meeting (10 × 12, 10 ft). */
function taggedScene(): Scene {
  const s = new Scene();
  const tag = (role: string, k: number): string => (role === 'wall' ? `wall_${k}` : role);
  const lobby = plainRoom('room:101 Lobby', 0, 15, 0, 12, 8, tag, { from: 5, to: 10, bottom: 3, top: 6.5 });
  const glass = box('window', 5, 10, -0.3, -0.2, 3, 6.5);
  lobby.add(glass);
  lobby.add(box('obj:table Big slab', 6, 9, 5, 8, 0, 2.5));
  const tv = box('Panel 9', 0, 0.2, 4, 8, 3, 6);
  tv.userData = { kind: 'screen' };
  lobby.add(tv);
  s.add(lobby);
  const meeting = plainRoom('Block B', 20, 30, 0, 12, 10, (role, k) => `${role} ${k}`);
  meeting.userData = { room: '102 Meeting' };
  meeting.children.forEach((c) => {
    if (c.name.startsWith('floor')) c.userData = { role: 'floor' };
  });
  meeting.add(box('Lounge Chair', 22, 24, 2, 4, 0, 3));
  meeting.add(box('Gizmo', 27, 28, 9, 10, 0, 1));
  s.add(meeting);
  return s;
}

describe('tag strategy: two tagged rooms in one GLB', async () => {
  const loaded = await roundTrip(taggedScene());
  const result = extractRooms(loaded, { sourceName: 'tagged.glb' });

  it('extracts one room per tagged floor, ordered by label', () => {
    expect(result.strategy).toBe('tags');
    expect(result.rooms.map((r) => r.key)).toEqual(['room:101 Lobby', 'room:102 Meeting']);
    expect(result.rooms.map((r) => r.room.label)).toEqual(['101 Lobby', '102 Meeting']);
    for (const r of result.rooms) expect(StudioRoomSchema.parse(r.room)).toEqual(r.room);
    expect(new Set(result.rooms.map((r) => r.room.id)).size).toBe(2);
  });

  it('outlines, areas and ceiling heights', () => {
    const [lobby, meeting] = result.rooms.map((r) => r.room);
    const lo = lobby?.floor[0] ?? [];
    expect(signedArea(lo)).toBeGreaterThan(0);
    close(area(lo), 180, 0.3);
    close(lo[0]?.x as number, 0);
    close(lo[0]?.y as number, 0);
    close(lobby?.ceilingHeight as number, 8);
    const mo = meeting?.floor[0] ?? [];
    close(area(mo), 120, 0.3);
    close(Math.min(...mo.map((p) => p.x)), 20);
    close(meeting?.ceilingHeight as number, 10);
    expect(lobby?.ceilingZones.filter((z) => !z.isMain)).toEqual([]);
  });

  it('a tagged window mesh names the wall gap', () => {
    const lobby = result.rooms[0];
    const ops = lobby?.room.walls[0]?.openings ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('window');
    close(ops[0]?.from as number, 5);
    close(ops[0]?.to as number, 10);
    close(ops[0]?.bottom as number, 3);
    close(ops[0]?.top as number, 6.5);
    expect(lobby?.openingNodes.map((m) => m.name)).toEqual(['window']);
  });

  it('objects: tag kinds, extras kinds, name regex, unresolved; grouped by tagged room', () => {
    const [lobby, meeting] = result.rooms;
    const lk = Object.fromEntries((lobby?.room.objects ?? []).map((o) => [o.name, o.kind]));
    expect(lk).toEqual({ 'obj:table Big slab': 'table', 'Panel 9': 'screen' });
    expect(lobby?.objects.map((o) => o.kindSource)).toEqual(['tag', 'tag']);
    const mk = Object.fromEntries((meeting?.room.objects ?? []).map((o) => [o.name, o.kind]));
    expect(mk).toEqual({ 'Lounge Chair': 'seating', Gizmo: 'other' });
    const tbl = lobby?.room.objects.find((o) => o.kind === 'table');
    close(tbl?.center.x as number, 7.5);
    close(tbl?.center.y as number, 6.5);
    close(tbl?.length as number, 3);
    close(tbl?.width as number, 3);
    close(tbl?.top as number, 2.5);
    expect(result.unresolved).toEqual([expect.objectContaining({ roomIndex: 1, name: 'Gizmo' })]);
  });

  it('strategy "geometry" ignores the tags and segments the floor instead', () => {
    const g = extractRooms(loaded, { strategy: 'geometry' });
    expect(g.strategy).toBe('geometry');
    expect(g.rooms.map((r) => r.room.label)).toEqual(['Room 1', 'Room 2']);
    close(area(g.rooms[0]?.room.floor[0] ?? []), 180, 0.3);
    close(area(g.rooms[1]?.room.floor[0] ?? []), 120, 0.3);
    close(g.rooms[0]?.room.ceilingHeight as number, 8);
    close(g.rooms[1]?.room.ceilingHeight as number, 10);
    expect(g.rooms[0]?.room.walls[0]?.openings).toEqual([expect.objectContaining({ kind: 'window' })]);
  });
});
