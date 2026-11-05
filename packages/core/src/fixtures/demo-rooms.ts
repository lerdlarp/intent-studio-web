// The four built-in demo rooms (spec/demo-rooms.md), built from the design concept's numbers with the Y-up conversion
// formulas so the floating-point values are bit-identical with golden `room` data.
import { dot, sub, unit, zoneContains } from '../geometry';
import { stableId } from '../hash';
import type {
  CeilingStepInfo,
  CeilingZoneInfo,
  ExistingFixture,
  P2,
  RoomObjectInfo,
  StudioRoom,
  WallInfo,
  WallOpening,
} from '../model';

type WallLetter = 'S' | 'E' | 'N' | 'W';
const WALL_INDEX: Record<WallLetter, number> = { S: 0, E: 1, N: 2, W: 3 };

interface ConceptZone {
  name: string;
  height: number;
  /** Concept rect x, y, width, height (y down). */
  loop: [number, number, number, number];
}
interface ConceptOpening {
  wall: WallLetter;
  kind: string;
  a0: number;
  a1: number;
  bottom: number;
  top: number;
}
interface RoomSpec {
  id: string;
  label: string;
  spaceType: string;
  w: number;
  d: number;
  ceiling: number;
  grid: boolean;
  zones: ConceptZone[];
  openings: ConceptOpening[];
  objects: (d: number, w: number) => RoomObjectInfo[];
  existing?: ExistingFixture[];
}

/** Point at distance `a` along a concept wall (N is the wall at Y = d). */
function wallPoint(wall: WallLetter, a: number, w: number, d: number): P2 {
  switch (wall) {
    case 'N':
      return { x: a, y: d };
    case 'S':
      return { x: a, y: 0 };
    case 'W':
      return { x: 0, y: d - a };
    case 'E':
      return { x: w, y: d - a };
  }
}

/** Concept rectangle (x, y, cw × ch, y down) → object, center (x + cw/2, d − (y + ch/2)). */
function rectObject(
  d: number,
  name: string,
  kind: string,
  x: number,
  y: number,
  cw: number,
  ch: number,
  top: number,
  bottom: number,
  over: { length?: number; width?: number } = {},
): RoomObjectInfo {
  return {
    name,
    kind,
    center: { x: x + cw / 2, y: d - (y + ch / 2) },
    length: over.length ?? cw,
    width: over.width ?? ch,
    orientation: 0,
    top,
    bottom,
  };
}

/** Concept round object (cx, cy, r) → center (cx, d − cy), 2r × 2r, bottom 0. */
function roundObject(d: number, name: string, kind: string, cx: number, cy: number, r: number, top: number) {
  return { name, kind, center: { x: cx, y: d - cy }, length: 2 * r, width: 2 * r, orientation: 0, top, bottom: 0 };
}

/** An object on a wall: wall point plus an inward nudge. */
function wallObject(
  at: P2,
  nudge: P2,
  name: string,
  kind: string,
  length: number,
  width: number,
  orientation: number,
  top: number,
  bottom: number,
): RoomObjectInfo {
  return { name, kind, center: { x: at.x + nudge.x, y: at.y + nudge.y }, length, width, orientation, top, bottom };
}

/** Concept loop (x, y, cw, ch) → world box (x, d − (y + ch)) .. (x + cw, d − y), CCW. */
function conceptLoop(d: number, [x, y, cw, ch]: [number, number, number, number]): P2[] {
  const x0 = x;
  const y0 = d - (y + ch);
  const x1 = x + cw;
  const y1 = d - y;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function buildRoom(s: RoomSpec): StudioRoom {
  const { w, d, ceiling } = s;
  const floorLoop = (): P2[] => [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  const zones: CeilingZoneInfo[] = [{ height: ceiling, isMain: true, loops: [floorLoop()] }];
  for (const z of s.zones) zones.push({ height: z.height, isMain: false, loops: [conceptLoop(d, z.loop)] });

  const wallDefs: { start: P2; end: P2; inward: P2 }[] = [
    { start: { x: 0, y: 0 }, end: { x: w, y: 0 }, inward: { x: 0, y: 1 } },
    { start: { x: w, y: 0 }, end: { x: w, y: d }, inward: { x: -1, y: 0 } },
    { start: { x: w, y: d }, end: { x: 0, y: d }, inward: { x: 0, y: -1 } },
    { start: { x: 0, y: d }, end: { x: 0, y: 0 }, inward: { x: 1, y: 0 } },
  ];
  const walls: WallInfo[] = wallDefs.map((wd, index) => {
    const mid = { x: (wd.start.x + wd.end.x) / 2, y: (wd.start.y + wd.end.y) / 2 };
    const probe = { x: mid.x + wd.inward.x * 0.5, y: mid.y + wd.inward.y * 0.5 };
    let top = ceiling;
    for (let k = zones.length - 1; k >= 1; k--) {
      const z = zones[k] as CeilingZoneInfo;
      if (zoneContains(z, probe)) {
        top = z.height;
        break;
      }
    }
    const dir = unit(sub(wd.end, wd.start));
    const openings: WallOpening[] = s.openings
      .filter((o) => WALL_INDEX[o.wall] === index)
      .map((o) => {
        const t0 = dot(sub(wallPoint(o.wall, o.a0, w, d), wd.start), dir);
        const t1 = dot(sub(wallPoint(o.wall, o.a1, w, d), wd.start), dir);
        return { kind: o.kind, from: Math.min(t0, t1), to: Math.max(t0, t1), bottom: o.bottom, top: o.top };
      });
    return { index, start: wd.start, end: wd.end, inward: wd.inward, top, openings };
  });

  const steps: CeilingStepInfo[] = [];
  for (const z of zones) {
    if (z.isMain) continue;
    const loop = z.loops[0] ?? [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] as P2;
      const b = loop[(i + 1) % loop.length] as P2;
      steps.push({
        start: { x: a.x, y: a.y },
        end: { x: b.x, y: b.y },
        lowerHeight: Math.min(z.height, ceiling),
        upperHeight: Math.max(z.height, ceiling),
      });
    }
  }

  return {
    id: s.id,
    label: s.label,
    spaceType: s.spaceType,
    floor: [floorLoop()],
    walls,
    ceilingHeight: ceiling,
    ceilingZones: zones,
    ceilingSteps: steps,
    ceilingGrid: s.grid ? { origin: { x: 0, y: 0 }, u: { x: 2, y: 0 }, v: { x: 0, y: 2 } } : null,
    objects: s.objects(d, w),
    existing: s.existing ?? [],
  };
}

const OFFICE: RoomSpec = {
  id: 'a0000204-0000-4000-8000-000000000204',
  label: '204 Open office',
  spaceType: 'open office',
  w: 36,
  d: 24,
  ceiling: 9,
  grid: true,
  zones: [],
  openings: [
    { wall: 'S', kind: 'window', a0: 3, a1: 33, bottom: 3, top: 7.5 },
    { wall: 'W', kind: 'door', a0: 2, a1: 5, bottom: 0, top: 7 },
  ],
  objects: (d, w) => [
    rectObject(d, 'Desk cluster A', 'desk', 3, 9, 12, 4.5, 2.5, 0, { length: 12 - 1, width: 3 }),
    rectObject(d, 'Desk cluster B', 'desk', 3, 16, 12, 4.5, 2.5, 0, { length: 12 - 1, width: 3 }),
    rectObject(d, 'Desk cluster C', 'desk', 18, 16, 8, 4.5, 2.5, 0, { length: 8 - 1, width: 3 }),
    rectObject(d, 'Meeting table', 'table', 24, 5, 8, 4, 2.5, 0),
    rectObject(d, 'Lounge sofa A', 'seating', 28.5, 14.8, 6, 1.6, 1.5, 0),
    rectObject(d, 'Lounge sofa B', 'seating', 28.5, 19.1, 6, 1.6, 1.5, 0),
    wallObject(wallPoint('N', 10, w, d), { x: 0, y: -0.15 }, 'Brand wall', 'artwork', 14, 0.2, 0, 7, 3),
    wallObject(wallPoint('E', 7, w, d), { x: -0.15, y: 0 }, 'Screen', 'screen', 5, 0.2, 90, 6, 3),
  ],
};

const CAFETERIA: RoomSpec = {
  id: 'a0000110-0000-4000-8000-000000000110',
  label: '110 Cafeteria',
  spaceType: 'cafeteria',
  w: 48,
  d: 32,
  ceiling: 10,
  grid: true,
  zones: [{ name: 'Raised GWB cloud', height: 12, loop: [12, 10, 24, 16] }],
  openings: [
    { wall: 'E', kind: 'window', a0: 4, a1: 28, bottom: 3, top: 8 },
    { wall: 'W', kind: 'door', a0: 14, a1: 18, bottom: 0, top: 7 },
    { wall: 'N', kind: 'door', a0: 40, a1: 43, bottom: 0, top: 7 },
  ],
  objects: (d, w) => {
    const objects: RoomObjectInfo[] = [
      rectObject(d, 'Servery counter', 'counter', 4, 2, 26, 3, 3, 0),
      wallObject(wallPoint('N', 17, w, d), { x: 0, y: -0.15 }, 'Menu boards', 'signage', 26, 0.2, 0, 8, 5.5),
    ];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        objects.push(roundObject(d, `Table ${i * 4 + j + 1}`, 'table', 11 + i * 5.6, 11.5 + j * 5, 1.8, 2.5));
      }
    }
    return objects;
  },
};

const LOBBY_EXISTING_CENTERS: P2[] = [
  { x: 10, y: 9 },
  { x: 30, y: 9 },
  { x: 10, y: 19 },
  { x: 30, y: 19 },
];

const LOBBY: RoomSpec = {
  id: 'a0000101-0000-4000-8000-000000000101',
  label: '101 Entry lobby',
  spaceType: 'lobby',
  w: 40,
  d: 28,
  ceiling: 14,
  grid: false,
  zones: [
    { name: 'Soffit over reception', height: 10, loop: [6, 0, 28, 7] },
    { name: 'Vestibule', height: 9, loop: [15, 23, 10, 5] },
  ],
  openings: [
    { wall: 'S', kind: 'window', a0: 2, a1: 15, bottom: 0, top: 12 },
    { wall: 'S', kind: 'window', a0: 25, a1: 38, bottom: 0, top: 12 },
    { wall: 'S', kind: 'door', a0: 17, a1: 23, bottom: 0, top: 7 },
    { wall: 'W', kind: 'door', a0: 4, a1: 7, bottom: 0, top: 7 },
    { wall: 'E', kind: 'door', a0: 9, a1: 13, bottom: 0, top: 7 },
    { wall: 'E', kind: 'door', a0: 15, a1: 19, bottom: 0, top: 7 },
  ],
  objects: (d, w) => [
    rectObject(d, 'Reception desk', 'reception', 14, 9, 12, 3.5, 3, 0),
    rectObject(d, 'Lounge sofa A', 'seating', 3, 14.5, 9, 1.8, 1.5, 0),
    rectObject(d, 'Lounge sofa B', 'seating', 3, 19.2, 9, 1.8, 1.5, 0),
    roundObject(d, 'Planter 1', 'other', 29, 17, 1.4, 3),
    roundObject(d, 'Planter 2', 'other', 8, 25, 1.2, 2.5),
    wallObject(wallPoint('N', 20, w, d), { x: 0, y: -0.15 }, 'Feature wall', 'artwork', 20, 0.2, 0, 8, 3),
    wallObject(wallPoint('E', 11, w, d), { x: -0.15, y: 0 }, 'Elevator 1', 'door', 4, 0.3, 90, 7, 0),
    wallObject(wallPoint('E', 17, w, d), { x: -0.15, y: 0 }, 'Elevator 2', 'door', 4, 0.3, 90, 7, 0),
  ],
  existing: LOBBY_EXISTING_CENTERS.map((center, i) => ({
    id: stableId(`existing-lobby-${i}`),
    productId: stableId('downlight'),
    label: 'E1',
    center,
    orientation: 0,
    length: 0.65,
    width: 0.65,
    isRound: true,
    mount: 'ceiling',
    height: 14,
    calculable: true,
  })),
};

const DATA_HALL: RoomSpec = {
  id: 'a000003b-0000-4000-8000-00000000003b',
  label: '3B Data hall',
  spaceType: 'data hall',
  w: 40,
  d: 30,
  ceiling: 14,
  grid: false,
  zones: [],
  openings: [
    { wall: 'W', kind: 'door', a0: 13, a1: 16.5, bottom: 0, top: 7 },
    { wall: 'E', kind: 'door', a0: 13, a1: 16.5, bottom: 0, top: 7 },
  ],
  objects: (d) => {
    const objects: RoomObjectInfo[] = [];
    for (let i = 0; i < 4; i++) {
      objects.push(rectObject(d, `Rack row ${i + 1}`, 'cabinet', 6, 4 + 6 * i, 28, 2, 7, 0));
    }
    const crah = (name: string, y: number): RoomObjectInfo => ({
      name,
      kind: 'appliance',
      center: { x: 2.3, y },
      length: 5,
      width: 3,
      orientation: 90,
      top: 7,
      bottom: 0,
    });
    objects.push(crah('CRAH-1', d - 7.5), crah('CRAH-2', d - 22.5));
    return objects;
  },
};

/** Office demo room (fresh copy each call). */
export const office = (): StudioRoom => buildRoom(OFFICE);
export const cafeteria = (): StudioRoom => buildRoom(CAFETERIA);
export const lobby = (): StudioRoom => buildRoom(LOBBY);
export const dataHall = (): StudioRoom => buildRoom(DATA_HALL);

/** Demo room names in order, matching golden file names. */
export const DEMO_ROOM_NAMES = ['Office', 'Cafeteria', 'Lobby', 'DataHall'] as const;
export type DemoRoomName = (typeof DEMO_ROOM_NAMES)[number];

/** [Office, Cafeteria, Lobby, DataHall] (fresh copies). */
export const allDemoRooms = (): StudioRoom[] => [office(), cafeteria(), lobby(), dataHall()];
export function demoRoom(name: DemoRoomName): StudioRoom {
  switch (name) {
    case 'Office':
      return office();
    case 'Cafeteria':
      return cafeteria();
    case 'Lobby':
      return lobby();
    case 'DataHall':
      return dataHall();
  }
}
/** The demo room with that id, or null. */
export const demoRoomById = (id: string): StudioRoom | null =>
  allDemoRooms().find((r) => r.id.toLowerCase() === id.toLowerCase()) ?? null;
