import { describe, expect, it } from 'vitest';
import {
  allDemoRooms,
  area,
  cafeteria,
  contains,
  dataHall,
  demoRoomById,
  inRoom,
  inflate,
  lerp,
  lobby,
  office,
  type P2,
} from '../src/index';

const add = (a: P2, b: P2, k: number): P2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });

describe('demo rooms', () => {
  it('office floor area', () => expect(area(office().floor[0] ?? [])).toBeCloseTo(864, 9));
  it('office ceiling', () => expect(office().ceilingHeight).toBe(9));
  it('office grid', () =>
    expect(office().ceilingGrid).toEqual({ origin: { x: 0, y: 0 }, u: { x: 2, y: 0 }, v: { x: 0, y: 2 } }));
  it('office walls', () => expect(office().walls).toHaveLength(4));
  it('south glazing', () => expect(office().walls[0]?.openings.some((o) => o.kind === 'window')).toBe(true));
  it('cafeteria floor area', () => expect(area(cafeteria().floor[0] ?? [])).toBe(1536));
  it('cafeteria tables', () => expect(cafeteria().objects.filter((o) => o.name.startsWith('Table'))).toHaveLength(24));
  it('cafeteria table positions', () => {
    const o = cafeteria().objects;
    expect(o[2]?.name).toBe('Table 1');
    expect(o[2]?.center).toEqual({ x: 11, y: 20.5 });
    expect(o[3]?.center).toEqual({ x: 11, y: 15.5 });
    expect(o[25]?.name).toBe('Table 24');
    expect(o[25]?.center).toEqual({ x: 39, y: 5.5 });
    expect(o.map((x) => x.center.x).filter((x, i, a) => a.indexOf(x) === i)).toEqual([
      17, 11, 16.6, 22.2, 27.799999999999997, 33.4, 39,
    ]);
  });
  it('cafeteria cloud', () => {
    const zones = cafeteria().ceilingZones.filter((z) => !z.isMain);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.height).toBe(12);
    expect(area(zones[0]?.loops[0] ?? [])).toBe(384);
  });
  it('cafeteria steps', () => {
    const s = cafeteria().ceilingSteps;
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ start: { x: 12, y: 6 }, end: { x: 36, y: 6 }, lowerHeight: 10, upperHeight: 12 });
  });
  it('lobby ceiling', () => expect(lobby().ceilingHeight).toBe(14));
  it('lobby zones', () => expect(lobby().ceilingZones.filter((z) => !z.isMain)).toHaveLength(2));
  it('lobby steps', () => {
    const s = lobby().ceilingSteps;
    expect(s).toHaveLength(8);
    expect(s.slice(0, 4).every((x) => x.lowerHeight === 10 && x.upperHeight === 14)).toBe(true);
    expect(s.slice(4).every((x) => x.lowerHeight === 9 && x.upperHeight === 14)).toBe(true);
  });
  it('lobby elevators', () => expect(lobby().objects.filter((o) => o.kind === 'door')).toHaveLength(2));
  it('lobby grid', () => expect(lobby().ceilingGrid).toBeNull());
  it('lobby existing', () => {
    const e = lobby().existing;
    expect(e.map((x) => x.id)).toEqual([
      '8a105443-3344-103a-4577-087e27d5e99c',
      'cd34b9de-0661-2373-d73e-0f7eaca8e50d',
      'd025ec56-85bc-17ec-6a58-d15cd8fb0cfd',
      '3237f734-b815-4e91-82c4-bdc50f7207b1',
    ]);
    expect(e.every((x) => x.productId === '8713baa4-22dc-51c2-6e01-fb595b1d00b5')).toBe(true);
  });
  it('data hall racks', () =>
    expect(dataHall().objects.filter((o) => o.kind === 'cabinet' && o.top === 7)).toHaveLength(4));
  it('data hall grid', () => expect(dataHall().ceilingGrid).toBeNull());
  it('data hall ceiling', () => expect(dataHall().ceilingHeight).toBe(14));
  it('walls face inward', () => {
    for (const room of allDemoRooms()) {
      for (const w of room.walls) {
        const mid = lerp(w.start, w.end, 0.5);
        expect(inRoom(room, add(mid, w.inward, 0.5))).toBe(true);
        expect(inRoom(room, add(mid, w.inward, -0.5))).toBe(false);
      }
    }
  });
  it('lobby north wall under soffit', () => expect(lobby().walls[2]?.top).toBe(10));
  it('lobby south wall under vestibule', () => expect(lobby().walls[0]?.top).toBe(9));
  it('lobby east wall', () => expect(lobby().walls[1]?.top).toBe(14));
  it('objects stay inside their room', () => {
    for (const room of allDemoRooms()) {
      const grown = inflate(room.floor[0] ?? [], 0.5);
      for (const o of room.objects) expect(contains(grown, o.center)).toBe(true);
    }
  });
  it('room order', () =>
    expect(allDemoRooms().map((r) => r.label)).toEqual([
      '204 Open office',
      '110 Cafeteria',
      '101 Entry lobby',
      '3B Data hall',
    ]));
  it('byId', () => {
    expect(demoRoomById('a0000101-0000-4000-8000-000000000101')?.label).toBe('101 Entry lobby');
    expect(demoRoomById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
  it('opening order on east wall', () =>
    expect(lobby().walls[1]?.openings.map((o) => [o.kind, o.from, o.to])).toEqual([
      ['door', 15, 19],
      ['door', 9, 13],
    ]));
  it('north door projection', () => {
    const o = cafeteria().walls[2]?.openings[0];
    expect(o?.from).toBe(5);
    expect(o?.to).toBe(8);
  });
  it('fresh copies each call', () => {
    const a = office();
    a.objects.pop();
    expect(office().objects).toHaveLength(8);
  });
});
