// Room extraction (PLAN §3 "Room extraction"): scene → StudioRoom[] for the designer to confirm.
//
// Strategies, tried in order:
//  (a) tags     — floors tagged `floor` (grouped by `room:<label>`); walls / ceilings / objects / windows / doors from
//                 their tags, untagged meshes classified geometrically (see tags.ts).
//  (b) geometry — floor = largest upward-facing horizontal level, lowest such level; rooms = connected free floor
//                 cells bounded by the wall sections (one room per segmented floor).
//  (c) manual   — `buildManualRoom` (room-build.ts) when (a) and (b) find nothing.
//
// Per room: outline = inner face of the wall section at 1 m (raster flood of the floor bounded by the sections at
// 0.3/1.0/1.6/2.2 m and just under the ceiling so window/door gaps do not leak), raster staircase removed, snapped onto
// the exact 1 m section segments, Douglas–Peucker 2 cm, CCW. Ceiling = lowest downward-facing surface above each floor cell; the lowest
// level covering ≥ 25 % of the room is the main height, the other levels become ceiling zones (pockets/soffits).
// Openings = gaps in the wall face found at 0.5–2.5 m, extended down/up by bisection to their sill/head. Objects =
// remaining top-level node units with a PCA/min-area oriented rectangle in plan and top/bottom.
//
// All work happens in plan metres (axes.ts); the emitted StudioRoom is in feet, heights above the room's floor.
import {
  contains,
  distanceToSegment,
  signedArea,
  stableId,
  type P2,
  type RoomObjectInfo,
  type StudioRoom,
} from '@intent-studio/core';
import type { Mesh, Object3D } from 'three';
import { m2ft, type UpAxis } from './axes';
import { classifyNames, unresolvedObjects, type UnresolvedObject } from './classify';
import type { LoadedScene } from './load';
import { orientedBounds, simplifyLoop, snapLoop, removeCollinear, type Segment } from './polygon';
import { Grid, components, distanceInside, rasterSegment, rasterTriangle, traceLoops } from './raster';
import { assembleRoom } from './room-build';
import {
  HORIZONTAL_NZ,
  VERTICAL_NZ,
  collectMeshes,
  levels,
  section,
  triCount,
  triPlanArea,
  triPoint,
  triZ,
  type MeshRecord,
  type TriRef,
} from './scene-data';
import { nodeName, tagsOf } from './tags';

export type ExtractStrategy = 'tags' | 'geometry' | 'none';

export interface ExtractOptions {
  /** Overrides LoadedScene.metresPerUnit (default 1). */
  metresPerUnit?: number;
  /** Overrides LoadedScene.upAxis (default 'y'). */
  upAxis?: UpAxis;
  /** 'auto' (default) uses tags when any floor is tagged, else geometry. */
  strategy?: 'auto' | 'tags' | 'geometry';
  /** Raster cell, metres (default 0.02, grown for very large floors to cap the grid at ~4M cells). */
  cellSize?: number;
  /** Douglas–Peucker tolerance, metres (default 0.02). */
  simplifyTolerance?: number;
  /** Outline section height above the floor, metres (default 1). */
  sectionHeight?: number;
  /** Heights (m above floor) at which wall gaps are searched for openings (default [0.5, 2.5]). */
  openingBand?: [number, number];
  /** Rooms smaller than this (m²) are ignored (default 1). */
  minRoomArea?: number;
  /** Mixed into the stable room ids (e.g. the asset id / filename). */
  sourceName?: string;
}

/** Where a room object came from, so the UI can highlight and confirm it on the model. */
export interface ObjectSource {
  objectIndex: number;
  /** The node that forms the object unit (a mesh, or the group of an assembly such as a desk with legs). */
  node: Object3D;
  nodeName: string;
  meshes: Mesh[];
  /** InstancedMesh instance index when the unit is a single instance. */
  instance: number | null;
  /** How the kind was decided: explicit tag, name regex, or not at all (kind "other", queued for the AI). */
  kindSource: 'tag' | 'name' | 'unresolved';
  /** The name the regex matched (node or a descendant mesh). */
  matchedName?: string;
}

export interface ExtractedRoom {
  room: StudioRoom;
  /** `room:<label>` for tagged rooms, `floor:<n>` for segmented floors. */
  key: string;
  /** Floor level in plan metres (scene elevation). StudioRoom heights are measured from here. */
  floorElevation: number;
  floorNodes: Mesh[];
  wallNodes: Mesh[];
  ceilingNodes: Mesh[];
  openingNodes: Mesh[];
  /** Parallel to `room.objects`. */
  objects: ObjectSource[];
}

export interface ExtractResult {
  rooms: ExtractedRoom[];
  strategy: ExtractStrategy;
  warnings: string[];
  /** Objects whose kind is "other" — the batch for the AI `classify` task. */
  unresolved: UnresolvedObject[];
  metresPerUnit: number;
  upAxis: UpAxis;
}

type Role = 'floor' | 'wall' | 'ceiling' | 'structure' | 'object' | 'opening' | 'ignore';

const MIN_CEILING = 1.5; // m above the floor before a down-facing surface counts as ceiling
const DEFAULT_CEILING = 9 / 3.28084;

interface Box2 {
  min: P2;
  max: P2;
}
const boxesOverlap = (a: Box2, b: Box2, pad = 0): boolean =>
  a.min.x - pad <= b.max.x && b.min.x - pad <= a.max.x && a.min.y - pad <= b.max.y && b.min.y - pad <= a.max.y;
const recBox = (r: MeshRecord): Box2 => ({ min: { x: r.min.x, y: r.min.y }, max: { x: r.max.x, y: r.max.y } });

function triBox(tris: readonly TriRef[]): Box2 {
  const b = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  for (const { rec, t } of tris)
    for (let c = 0; c < 3; c++) {
      const p = triPoint(rec, t, c);
      b.min.x = Math.min(b.min.x, p.x);
      b.min.y = Math.min(b.min.y, p.y);
      b.max.x = Math.max(b.max.x, p.x);
      b.max.y = Math.max(b.max.y, p.y);
    }
  return b;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
};

function upTris(recs: readonly MeshRecord[]): TriRef[] {
  const out: TriRef[] = [];
  for (const rec of recs)
    for (let t = 0; t < triCount(rec); t++) if ((rec.nz[t] as number) > HORIZONTAL_NZ) out.push({ rec, t });
  return out;
}

/** Lowest level whose area is ≥ 30 % of the largest level (and ≥ 0.5 m²). */
function floorLevel(tris: readonly TriRef[]): number | null {
  const lv = levels(tris.map(({ rec, t }) => ({ z: triZ(rec, t), area: triPlanArea(rec, t) })));
  const maxA = Math.max(0, ...lv.map((l) => l.area));
  const ok = lv.filter((l) => l.area >= 0.3 * maxA && l.area >= 0.5);
  return ok.length ? (ok[0] as { z: number }).z : null;
}

/**
 * Douglas–Peucker tolerance for loops traced along raster cell edges: a 4-connected staircase strays up to √2 cells
 * from the true edge, so quantisation is removed at 2 cells first; the loop is then snapped onto the exact section
 * segments and simplified again at the designer-facing tolerance (2 cm).
 */
const rasterTol = (grid: Grid, dpTol: number): number => Math.max(dpTol, 2 * grid.cell);

interface FloorGroup {
  key: string;
  label: string;
  segment: boolean;
  z0: number;
  zc: number;
  floor: TriRef[];
  box: Box2;
}

interface RoomWork {
  group: FloorGroup;
  grid: Grid;
  mask: Uint8Array;
  outer: P2[];
  holes: P2[][];
  key: string;
  label: string;
}

/** Extract rooms from a loaded scene (or a bare Object3D in metres, Y-up). */
export function extractRooms(input: Object3D | LoadedScene, options: ExtractOptions = {}): ExtractResult {
  const loaded = 'root' in input && 'format' in input ? (input as LoadedScene) : null;
  const root = loaded ? loaded.root : (input as Object3D);
  const metresPerUnit = options.metresPerUnit ?? loaded?.metresPerUnit ?? 1;
  const upAxis = options.upAxis ?? loaded?.upAxis ?? 'y';
  const warnings: string[] = [];
  const done = (rooms: ExtractedRoom[], strategy: ExtractStrategy): ExtractResult => ({
    rooms,
    strategy,
    warnings,
    // Objects a rule or tag already decided (even as "other", e.g. lamps, plants) are not sent to the AI.
    unresolved: unresolvedObjects(
      rooms.map((r) => r.room),
      (ri, oi) => rooms[ri]?.objects[oi]?.kindSource !== 'unresolved',
    ),
    metresPerUnit,
    upAxis,
  });

  const recs = collectMeshes(root, metresPerUnit, upAxis);
  if (recs.length === 0) {
    warnings.push('The scene has no meshes; draw the floor outline manually.');
    return done([], 'none');
  }
  const useTags = options.strategy !== 'geometry';
  const role = new Map<MeshRecord, Role>();
  for (const r of recs) {
    const t = useTags ? r.tags.role : r.tags.role === 'ignore' ? 'ignore' : undefined;
    role.set(
      r,
      t === 'window' || t === 'door'
        ? 'opening'
        : t === 'floor' || t === 'wall' || t === 'ceiling' || t === 'object' || t === 'ignore'
          ? t
          : 'structure',
    );
  }
  const auto = new Set(recs.filter((r) => role.get(r) === 'structure')); // undecided until classified below

  // ---- floors -------------------------------------------------------------------------------------------------
  const tagged = recs.filter((r) => role.get(r) === 'floor');
  let strategy: ExtractStrategy = 'geometry';
  const groups: FloorGroup[] = [];
  const makeGroup = (key: string, label: string, segment: boolean, src: MeshRecord[]): void => {
    const ups = upTris(src);
    const z0 = floorLevel(ups);
    if (z0 === null) {
      warnings.push(`No upward-facing floor surface found for ${label || 'the scene'}.`);
      return;
    }
    const floor = ups.filter(({ rec, t }) => Math.abs(triZ(rec, t) - z0) <= 0.05);
    groups.push({ key, label, segment, z0, zc: z0 + DEFAULT_CEILING, floor, box: triBox(floor) });
  };
  if (tagged.length > 0) {
    strategy = 'tags';
    const byRoom = new Map<string, MeshRecord[]>();
    for (const r of tagged) {
      const k = r.tags.room ?? '';
      byRoom.set(k, [...(byRoom.get(k) ?? []), r]);
    }
    const keys = [...byRoom.keys()].sort((a, b) =>
      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true }),
    );
    for (const k of keys) makeGroup(k ? `room:${k}` : 'floor', k, k === '', byRoom.get(k) as MeshRecord[]);
  } else {
    if (options.strategy === 'tags') warnings.push('No tagged floor found; fell back to the geometry strategy.');
    makeGroup(
      'floor',
      '',
      true,
      recs.filter((r) => role.get(r) === 'structure'),
    );
  }
  if (groups.length === 0) {
    warnings.push('No floor found; draw the floor outline manually.');
    return done([], 'none');
  }

  // ---- preliminary ceiling level per group, then classify untagged meshes -----------------------------------
  for (const g of groups) {
    const downs: { z: number; area: number }[] = [];
    for (const r of recs) {
      const rl = role.get(r);
      if ((rl !== 'structure' && rl !== 'ceiling') || !boxesOverlap(recBox(r), g.box)) continue;
      for (let t = 0; t < triCount(r); t++) {
        const z = triZ(r, t);
        if ((r.nz[t] as number) < -HORIZONTAL_NZ && z > g.z0 + MIN_CEILING) downs.push({ z, area: triPlanArea(r, t) });
      }
    }
    const lv = levels(downs);
    if (lv.length) g.zc = lv.reduce((a, b) => (b.area > a.area ? b : a)).z;
  }
  for (const r of auto) {
    const isStructural = groups.some((g) => {
      if (!boxesOverlap(recBox(r), g.box, 0.5)) return false;
      if (r.max.z < g.z0 - 0.5 || r.min.z > g.zc + 3) return false;
      if (strategy === 'geometry' && g.floor.some((f) => f.rec === r)) {
        let a = 0;
        for (const f of g.floor) if (f.rec === r) a += triPlanArea(r, f.t);
        if (a >= 0.5) return true;
      }
      if (r.min.z <= g.z0 + 0.15 && r.max.z >= g.zc - 0.15) return true; // floor to ceiling: walls, columns
      if (r.min.z >= g.zc - 0.15) return true; // at/above the ceiling: pockets, slabs, plenum
      if (r.max.z >= g.zc - 0.05 && r.min.z >= g.z0 + MIN_CEILING) {
        let down = 0;
        for (let t = 0; t < triCount(r); t++) if ((r.nz[t] as number) < -HORIZONTAL_NZ) down += triPlanArea(r, t);
        if (down >= 0.5) return true; // ceiling panels
      }
      return false;
    });
    if (!isStructural) role.set(r, 'object');
  }
  const infill = promoteWallInfill(recs, role, auto);

  const wallTris: TriRef[] = [];
  const ceilTris: TriRef[] = [];
  for (const r of recs) {
    const rl = role.get(r);
    const walls = rl === 'wall' || rl === 'structure';
    const ceil = rl === 'ceiling' || rl === 'structure';
    for (let t = 0; t < triCount(r); t++) {
      const nz = r.nz[t] as number;
      if (walls && Math.abs(nz) < VERTICAL_NZ && (r.area[t] as number) > 1e-10) wallTris.push({ rec: r, t });
      if (ceil && nz < -HORIZONTAL_NZ) ceilTris.push({ rec: r, t });
    }
  }

  // ---- rooms per group --------------------------------------------------------------------------------------
  const work: RoomWork[] = [];
  const sectionH = options.sectionHeight ?? 1;
  const minArea = options.minRoomArea ?? 1;
  const dpTol = options.simplifyTolerance ?? 0.02;
  let floorCounter = 0;
  for (const g of groups) {
    const ext = Math.max(1e-6, (g.box.max.x - g.box.min.x) * (g.box.max.y - g.box.min.y));
    const cell = options.cellSize ?? Math.max(0.02, Math.sqrt(ext / 4e6));
    const grid = Grid.cover(g.box.min, g.box.max, cell);
    const floorMask = grid.mask();
    for (const { rec, t } of g.floor) {
      const a = triPoint(rec, t, 0);
      const b = triPoint(rec, t, 1);
      const c = triPoint(rec, t, 2);
      rasterTriangle(grid, a, b, c, (k) => (floorMask[k] = 1));
    }
    const nearWalls = wallTris.filter(
      ({ rec }) => boxesOverlap(recBox(rec), g.box, 0.5) && rec.max.z > g.z0 && rec.min.z < g.zc,
    );
    const ch = g.zc - g.z0;
    const heights = [0.3, sectionH, 1.6, 2.2, ch - 0.1].filter((h) => h > 0.05 && h < ch - 0.05);
    const wallMask = grid.mask();
    let wallSegs = 0;
    for (const h of heights)
      for (const s of section(nearWalls, g.z0 + h + 1e-4)) {
        rasterSegment(grid, wallMask, s.a, s.b);
        wallSegs++;
      }
    if (wallSegs === 0)
      warnings.push(`${g.label || 'Floor'}: no wall geometry found; the outline follows the floor edge.`);
    const free = grid.mask();
    for (let k = 0; k < grid.size; k++) free[k] = floorMask[k] && !wallMask[k] ? 1 : 0;
    const { labels, sizes } = components(grid, free);
    const dist = distanceInside(grid, free);
    const reach = new Float32Array(sizes.length);
    for (let k = 0; k < grid.size; k++) {
      const l = labels[k] as number;
      if (l && (dist[k] as number) > (reach[l] as number)) reach[l] = dist[k] as number;
    }
    const kept: number[] = [];
    for (let l = 1; l < sizes.length; l++)
      if ((sizes[l] as number) * grid.cellArea() >= minArea && (reach[l] as number) >= 0.25) kept.push(l);
    if (kept.length === 0) {
      warnings.push(`${g.label || 'Floor'}: no enclosed floor area found.`);
      continue;
    }
    kept.sort((a, b) => (sizes[b] as number) - (sizes[a] as number));
    const use = g.segment ? kept : kept.slice(0, 1);
    if (!g.segment && kept.length > 1)
      warnings.push(`${g.label}: the floor splits into ${kept.length} areas; kept the largest.`);
    const snapSegs = section(nearWalls, g.z0 + sectionH + 1e-4);
    for (const l of use) {
      const mask = grid.mask();
      for (let k = 0; k < grid.size; k++) if (labels[k] === l) mask[k] = 1;
      const loops = traceLoops(grid, mask).map((lp) => simplifyLoop(lp, rasterTol(grid, dpTol)));
      const outers = loops.filter((lp) => signedArea(lp) > 0).sort((a, b) => signedArea(b) - signedArea(a));
      const rawOuter = outers[0];
      if (!rawOuter) continue;
      const snapTol = 1.5 * grid.cell + 0.01;
      const snap = (lp: P2[]): P2[] => {
        const s = simplifyLoop(removeCollinear(snapLoop(lp, snapSegs, snapTol), 0.005), dpTol);
        const a0 = Math.abs(signedArea(lp));
        return s.length >= 3 && Math.abs(Math.abs(signedArea(s)) - a0) <= 0.05 * a0 ? s : lp;
      };
      const outer = snap(rawOuter);
      const holes = loops.filter((lp) => signedArea(lp) < -0.05).map(snap);
      const key = g.segment ? `floor:${floorCounter++}` : g.key;
      work.push({ group: g, grid, mask, outer, holes, key, label: g.label });
    }
  }
  if (work.length === 0) {
    warnings.push('No room could be extracted; draw the floor outline manually.');
    return done([], 'none');
  }
  // Segmented floors: south-west first, labelled Room 1, Room 2…
  const order = (w: RoomWork): [number, number] => {
    let mx = Infinity;
    let my = Infinity;
    for (const p of w.outer) {
      mx = Math.min(mx, p.x);
      my = Math.min(my, p.y);
    }
    return [Math.round(my * 100), Math.round(mx * 100)];
  };
  const taggedWork = work.filter((w) => !w.group.segment);
  const segWork = work
    .filter((w) => w.group.segment)
    .sort((a, b) => {
      const [ay, ax] = order(a);
      const [by, bx] = order(b);
      return ay - by || ax - bx;
    });
  segWork.forEach((w, n) => {
    w.key = `floor:${n}`;
    w.label = segWork.length === 1 && taggedWork.length === 0 ? '' : `Room ${n + 1}`;
  });
  const allWork = [...taggedWork, ...segWork];

  // ---- objects ------------------------------------------------------------------------------------------------
  const units = objectUnits(root, recs, role);
  const roomObjects = new Map<RoomWork, { info: RoomObjectInfo; src: Omit<ObjectSource, 'objectIndex'> }[]>();
  for (const u of units) {
    const pts: P2[] = [];
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const r of u.recs) {
      for (let k = 0; k < r.tri.length; k += 3) pts.push({ x: r.tri[k] as number, y: r.tri[k + 1] as number });
      zMin = Math.min(zMin, r.min.z);
      zMax = Math.max(zMax, r.max.z);
    }
    if (pts.length < 3) continue;
    const obb = orientedBounds(pts);
    if (obb.length < 0.01 && zMax - zMin < 0.01) continue;
    const taggedRoom = u.room ? allWork.find((w) => w.group.label === u.room) : undefined;
    let target = taggedRoom;
    if (!target) {
      let bestD = 1;
      for (const w of allWork) {
        if (zMax < w.group.z0 - 0.1 || zMin > w.group.zc + 0.5) continue;
        const d = contains(w.outer, obb.center) ? 0 : loopDistance(w.outer, obb.center);
        if (d < bestD) {
          bestD = d;
          target = w;
        }
      }
    }
    if (!target) {
      warnings.push(`Object "${u.name}" lies outside every room; skipped.`);
      continue;
    }
    const z0 = target.group.z0;
    const cls = u.kind
      ? { kind: u.kind, source: 'tag' as const, matched: undefined }
      : (() => {
          const c = classifyNames(u.names);
          return c
            ? { kind: c.kind, source: 'name' as const, matched: c.matched }
            : { kind: 'other', source: 'unresolved' as const, matched: undefined };
        })();
    const info: RoomObjectInfo = {
      name: u.name,
      kind: cls.kind,
      center: { x: m2ft(obb.center.x), y: m2ft(obb.center.y) },
      length: m2ft(obb.length),
      width: m2ft(obb.width),
      orientation: obb.orientation,
      top: m2ft(zMax - z0),
      bottom: m2ft(zMin - z0),
    };
    const src: Omit<ObjectSource, 'objectIndex'> = {
      node: u.node,
      nodeName: u.name,
      meshes: [...new Set(u.recs.map((r) => r.mesh))],
      instance: u.instance,
      kindSource: cls.source,
      ...(cls.matched !== undefined ? { matchedName: cls.matched } : {}),
    };
    roomObjects.set(target, [...(roomObjects.get(target) ?? []), { info, src }]);
  }

  // ---- assemble ----------------------------------------------------------------------------------------------
  const openingRecs = recs.filter((r) => role.get(r) === 'opening');
  const rooms: ExtractedRoom[] = allWork.map((w) => {
    const { group: g } = w;
    const ceiling = ceilingOf(w, ceilTris, wallTris, dpTol, warnings);
    const ft = (lp: P2[]): P2[] => lp.map((p) => ({ x: m2ft(p.x), y: m2ft(p.y) }));
    const roomWalls = wallTris.filter(({ rec }) => boxesOverlap(recBox(rec), g.box, 0.5));
    const objs = roomObjects.get(w) ?? [];
    const name = w.label || 'Room';
    const room = assembleRoom({
      id: stableId(`scene:${options.sourceName ?? ''}:${w.key}`),
      label: w.label,
      outline: ft(w.outer),
      holes: w.holes.map(ft),
      ceilingHeight: m2ft(ceiling.main),
      pockets: ceiling.pockets.map((p) => ({ height: m2ft(p.height), loops: p.loops.map(ft) })),
      objects: objs.map((o) => o.info),
      openings: (_i, wall) => {
        const start = { x: wall.start.x / 3.28084, y: wall.start.y / 3.28084 };
        const end = { x: wall.end.x / 3.28084, y: wall.end.y / 3.28084 };
        return wallOpenings(
          start,
          end,
          wall.top / 3.28084,
          g.z0,
          roomWalls,
          openingRecs,
          w.grid.cell,
          options.openingBand,
          (m) => warnings.push(`${name}, wall ${_i}: ${m}`),
        ).map((o) => ({ kind: o.kind, from: m2ft(o.from), to: m2ft(o.to), bottom: m2ft(o.bottom), top: m2ft(o.top) }));
      },
    });
    const meshesOf = (pred: (r: MeshRecord) => boolean): Mesh[] => [
      ...new Set(recs.filter((r) => pred(r) && boxesOverlap(recBox(r), g.box, 0.5)).map((r) => r.mesh)),
    ];
    return {
      room,
      key: w.key,
      floorElevation: g.z0,
      floorNodes: [...new Set(g.floor.map((f) => f.rec.mesh))],
      wallNodes: meshesOf(
        (r) =>
          role.get(r) === 'wall' ||
          infill.has(r) ||
          (role.get(r) === 'structure' && r.min.z <= g.z0 + 0.15 && r.max.z >= g.zc - 0.15),
      ),
      ceilingNodes: meshesOf(
        (r) =>
          role.get(r) === 'ceiling' || (role.get(r) === 'structure' && !infill.has(r) && r.min.z >= g.z0 + MIN_CEILING),
      ),
      openingNodes: meshesOf((r) => role.get(r) === 'opening'),
      objects: objs.map((o, objectIndex) => ({ objectIndex, ...o.src })),
    };
  });
  return done(rooms, strategy);
}

interface VPlane {
  nx: number;
  ny: number;
  off: number;
}

/** Distinct vertical face planes of a mesh (plan normal + offset). */
function verticalPlanes(r: MeshRecord): VPlane[] {
  const out: VPlane[] = [];
  for (let t = 0; t < triCount(r); t++) {
    if (Math.abs(r.nz[t] as number) >= VERTICAL_NZ || (r.area[t] as number) < 1e-6) continue;
    const a = triPoint(r, t, 0);
    const b = triPoint(r, t, 1);
    const c = triPoint(r, t, 2);
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const wx = c.x - a.x;
    const wy = c.y - a.y;
    const wz = c.z - a.z;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    const l = Math.hypot(nx, ny);
    if (l < 1e-12) continue;
    nx /= l;
    ny /= l;
    const off = nx * a.x + ny * a.y;
    if (!out.some((p) => p.nx * nx + p.ny * ny > 0.9995 && Math.abs(p.off - off) < 0.005)) out.push({ nx, ny, off });
  }
  return out;
}

const touching = (a: MeshRecord, b: MeshRecord, gap = 0.02): boolean =>
  a.min.x - gap <= b.max.x &&
  b.min.x - gap <= a.max.x &&
  a.min.y - gap <= b.max.y &&
  b.min.y - gap <= a.max.y &&
  a.min.z - gap <= b.max.z &&
  b.min.z - gap <= a.max.z;

/**
 * Wall infill: sill / header / spandrel pieces around openings do not span floor to ceiling, so the first pass
 * calls them objects. A piece is promoted to structure when it touches a wall and lies in that wall's face
 * plane(s) — the same face plane, and the opposite face too when the wall has one (orientation-agnostic, so
 * rotated walls work). Artwork hung on a wall only touches one face from the room side, so it stays an object.
 */
function promoteWallInfill(
  recs: readonly MeshRecord[],
  role: Map<MeshRecord, Role>,
  auto: ReadonlySet<MeshRecord>,
): Set<MeshRecord> {
  const promoted = new Set<MeshRecord>();
  const planes = new Map<MeshRecord, VPlane[]>();
  const planesOf = (r: MeshRecord): VPlane[] => {
    let p = planes.get(r);
    if (!p) planes.set(r, (p = verticalPlanes(r)));
    return p;
  };
  const same = (p: VPlane, q: VPlane): boolean => p.nx * q.nx + p.ny * q.ny > 0.9995 && Math.abs(p.off - q.off) < 0.01;
  const inPlaneOf = (m: MeshRecord, w: MeshRecord): boolean => {
    const mp = planesOf(m);
    const wp = planesOf(w);
    for (const a of wp) {
      if (!mp.some((b) => same(a, b))) continue;
      const opposite = wp.filter((q) => q.nx * a.nx + q.ny * a.ny < -0.9995);
      if (opposite.length === 0) return true;
      if (opposite.some((q) => mp.some((b) => same(q, b)))) return true;
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of auto) {
      if (role.get(m) !== 'object') continue;
      for (const w of recs) {
        const rw = role.get(w);
        if ((rw !== 'structure' && rw !== 'wall') || !touching(m, w) || !inPlaneOf(m, w)) continue;
        role.set(m, rw);
        promoted.add(m);
        changed = true;
        break;
      }
    }
  }
  return promoted;
}

function loopDistance(loop: readonly P2[], p: P2): number {
  let d = Infinity;
  for (let k = 0; k < loop.length; k++)
    d = Math.min(d, distanceToSegment(p, loop[k] as P2, loop[(k + 1) % loop.length] as P2));
  return d;
}

// ---- ceiling ------------------------------------------------------------------------------------------------------

interface CeilingResult {
  /** Metres above the floor. */
  main: number;
  pockets: { height: number; loops: P2[][] }[];
}

function ceilingOf(
  w: RoomWork,
  ceilTris: readonly TriRef[],
  wallTris: readonly TriRef[],
  dpTol: number,
  warnings: string[],
): CeilingResult {
  const { grid, mask, group: g } = w;
  const hmap = new Float32Array(grid.size).fill(NaN);
  for (const { rec, t } of ceilTris) {
    const a = triPoint(rec, t, 0);
    const b = triPoint(rec, t, 1);
    const c = triPoint(rec, t, 2);
    if (Math.max(a.z, b.z, c.z) < g.z0 + MIN_CEILING) continue;
    if (rec.max.x < grid.x0 || rec.max.y < grid.y0) continue;
    rasterTriangle(grid, a, b, c, (k, u, v) => {
      if (!mask[k]) return;
      const z = a.z + u * (b.z - a.z) + v * (c.z - a.z) - g.z0;
      if (z < MIN_CEILING) return;
      const cur = hmap[k] as number;
      if (Number.isNaN(cur) || z < cur) hmap[k] = z;
    });
  }
  let total = 0;
  let covered = 0;
  const samples: { z: number; area: number }[] = [];
  for (let k = 0; k < grid.size; k++) {
    if (!mask[k]) continue;
    total++;
    const z = hmap[k] as number;
    if (!Number.isNaN(z)) {
      covered++;
      samples.push({ z, area: 1 });
    }
  }
  const name = w.label || 'Room';
  if (covered === 0) {
    const main = g.zc - g.z0;
    warnings.push(`${name}: no ceiling surface found; ceiling height set to ${m2ft(main).toFixed(1)} ft.`);
    return { main, pockets: [] };
  }
  if (covered < 0.9 * total)
    warnings.push(`${name}: ${Math.round((100 * (total - covered)) / total)} % of the floor has no ceiling above it.`);
  const lv = levels(samples);
  const mainLevel = lv.find((l) => l.area >= 0.25 * covered) ?? lv.reduce((a, b) => (b.area > a.area ? b : a));
  const main = mainLevel.z;
  const pockets: CeilingResult['pockets'] = [];
  const cellA = grid.cellArea();
  for (const l of lv) {
    if (l === mainLevel || l.area * cellA < 0.5) continue;
    const zm = grid.mask();
    for (let k = 0; k < grid.size; k++) {
      const z = hmap[k] as number;
      if (mask[k] && !Number.isNaN(z) && Math.abs(z - l.z) <= 0.035) zm[k] = 1;
    }
    const { labels, sizes } = components(grid, zm);
    const segs: Segment[] = section(wallTris, g.z0 + (l.z + main) / 2 + 1e-4);
    for (let c = 1; c < sizes.length; c++) {
      if ((sizes[c] as number) * cellA < 0.25) continue;
      const cm = grid.mask();
      for (let k = 0; k < grid.size; k++) if (labels[k] === c) cm[k] = 1;
      const loops = traceLoops(grid, cm).map((lp) => {
        const s = simplifyLoop(lp, rasterTol(grid, dpTol));
        const snapped = simplifyLoop(removeCollinear(snapLoop(s, segs, 1.5 * grid.cell + 0.01), 0.005), dpTol);
        return snapped.length >= 3 ? snapped : s;
      });
      const outer = loops.filter((lp) => signedArea(lp) > 0).sort((a, b) => signedArea(b) - signedArea(a))[0];
      if (!outer) continue;
      pockets.push({ height: l.z, loops: [outer, ...loops.filter((lp) => signedArea(lp) < -0.05)] });
    }
  }
  return { main, pockets };
}

// ---- openings -----------------------------------------------------------------------------------------------------

interface OpeningM {
  kind: string;
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** Openings of one wall (metres along the wall from `start`, heights above the floor). */
function wallOpenings(
  start: P2,
  end: P2,
  wallTop: number,
  z0: number,
  wallTris: readonly TriRef[],
  openingRecs: readonly MeshRecord[],
  cell: number,
  band: [number, number] = [0.5, 2.5],
  warn: (m: string) => void,
): OpeningM[] {
  const L = Math.hypot(end.x - start.x, end.y - start.y);
  if (L < 0.3) return [];
  const d = { x: (end.x - start.x) / L, y: (end.y - start.y) / L };
  const n = { x: -d.y, y: d.x };
  const faceTol = Math.max(0.03, 1.5 * cell + 0.01);
  const near = wallTris.filter(({ rec }) => {
    // Box-vs-segment prefilter (padded).
    const pad = 0.3;
    return (
      rec.max.x >= Math.min(start.x, end.x) - pad &&
      rec.min.x <= Math.max(start.x, end.x) + pad &&
      rec.max.y >= Math.min(start.y, end.y) - pad &&
      rec.min.y <= Math.max(start.y, end.y) + pad
    );
  });
  const cache = new Map<number, [number, number][]>();
  const intervals = (h: number): [number, number][] => {
    const key = Math.round(h * 1e5);
    const hit = cache.get(key);
    if (hit) return hit;
    const out: [number, number][] = [];
    for (const s of section(near, z0 + h + 1e-4)) {
      const oa = (s.a.x - start.x) * n.x + (s.a.y - start.y) * n.y;
      const ob = (s.b.x - start.x) * n.x + (s.b.y - start.y) * n.y;
      if (Math.abs(oa) > faceTol || Math.abs(ob) > faceTol) continue;
      const ta = (s.a.x - start.x) * d.x + (s.a.y - start.y) * d.y;
      const tb = (s.b.x - start.x) * d.x + (s.b.y - start.y) * d.y;
      const sl = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      if (sl < 1e-6 || Math.abs(tb - ta) < 0.7 * sl) continue; // not parallel to the wall
      out.push([Math.min(ta, tb), Math.max(ta, tb)]);
    }
    out.sort((a, b) => a[0] - b[0]);
    cache.set(key, out);
    return out;
  };
  const covered = (h: number, t: number): boolean => intervals(h).some(([a, b]) => a - 0.005 <= t && t <= b + 0.005);
  const gaps = (h: number): [number, number][] => {
    const out: [number, number][] = [];
    let at = 0;
    for (const [a, b] of intervals(h)) {
      if (a > at + 0.005) out.push([at, Math.min(a, L)]);
      at = Math.max(at, b);
      if (at >= L) break;
    }
    if (at < L - 0.005) out.push([at, L]);
    return out.filter(([a, b]) => b - a >= 0.3);
  };

  const top = wallTop > 0 ? wallTop : 2.7;
  const cands: { a: number[]; b: number[]; h: number[] }[] = [];
  const hi = Math.min(band[1], top - 0.05);
  for (let h = band[0]; h <= hi + 1e-9; h += 0.05) {
    for (const [a, b] of gaps(h)) {
      const c = cands.find((c) => {
        const ca = median(c.a);
        const cb = median(c.b);
        return Math.min(b, cb) - Math.max(a, ca) >= 0.5 * Math.min(b - a, cb - ca);
      });
      if (c) {
        c.a.push(a);
        c.b.push(b);
        c.h.push(h);
      } else cands.push({ a: [a], b: [b], h: [h] });
    }
  }
  const out: OpeningM[] = [];
  for (const c of cands) {
    const from = median(c.a);
    const to = median(c.b);
    const t = (from + to) / 2;
    const seed = median(c.h);
    const edge = (dirn: -1 | 1): number => {
      const limit = dirn < 0 ? 0 : top;
      let inH = seed;
      for (;;) {
        const nh = inH + dirn * 0.05;
        if (dirn < 0 ? nh <= limit + 0.002 : nh >= limit - 0.002) {
          const probe = dirn < 0 ? 0.002 : top - 0.002;
          if (!covered(probe, t)) return limit;
          let outH = probe;
          for (let k = 0; k < 24; k++) {
            const mid = (inH + outH) / 2;
            if (covered(mid, t)) outH = mid;
            else inH = mid;
          }
          return (inH + outH) / 2;
        }
        if (covered(nh, t)) {
          let outH = nh;
          for (let k = 0; k < 24; k++) {
            const mid = (inH + outH) / 2;
            if (covered(mid, t)) outH = mid;
            else inH = mid;
          }
          return (inH + outH) / 2;
        }
        inH = nh;
      }
    };
    const bottom = edge(-1);
    const ceilingEdge = edge(1);
    if (ceilingEdge - bottom < 0.3) continue;
    if (from <= 0.01 && to >= L - 0.01 && bottom <= 0.01 && ceilingEdge >= top - 0.01) {
      warn('no wall surface along this edge (open side)');
      continue;
    }
    out.push({
      kind: bottom <= 0.1 ? 'door' : 'window',
      from,
      to,
      bottom: Math.max(0, bottom),
      top: Math.min(top, ceilingEdge),
    });
  }

  // Tagged / named window & door meshes: name the gap they sit in, or add the opening they describe.
  const used = new Set<MeshRecord>();
  for (const r of openingRecs) {
    const kind = r.tags.role === 'door' ? 'door' : 'window';
    const corners: P2[] = [
      { x: r.min.x, y: r.min.y },
      { x: r.max.x, y: r.min.y },
      { x: r.max.x, y: r.max.y },
      { x: r.min.x, y: r.max.y },
    ];
    const cx = (r.min.x + r.max.x) / 2;
    const cy = (r.min.y + r.max.y) / 2;
    const off = Math.abs((cx - start.x) * n.x + (cy - start.y) * n.y);
    const ts = corners.map((p) => (p.x - start.x) * d.x + (p.y - start.y) * d.y);
    const ta = Math.max(0, Math.min(...ts));
    const tb = Math.min(L, Math.max(...ts));
    if (off > 0.4 || tb - ta < 0.1) continue;
    const zb = r.min.z - z0;
    const zt = r.max.z - z0;
    const hitIdx = out.findIndex(
      (o) => Math.min(o.to, tb) - Math.max(o.from, ta) > 0 && Math.min(o.top, zt) - Math.max(o.bottom, zb) > 0,
    );
    used.add(r);
    if (hitIdx >= 0) (out[hitIdx] as OpeningM).kind = kind;
    else out.push({ kind, from: ta, to: tb, bottom: Math.max(0, zb), top: Math.min(top, zt) });
  }
  return out.sort((a, b) => a.from - b.from);
}

// ---- object units -------------------------------------------------------------------------------------------------

interface ObjectUnit {
  node: Object3D;
  name: string;
  /** Names to classify, node first then descendant meshes. */
  names: string[];
  kind?: string;
  room?: string;
  recs: MeshRecord[];
  instance: number | null;
}

/**
 * Group object meshes into units: a mesh climbs to its parent while the parent holds no structural/opening mesh,
 * is not the root or a room group, and is an assembly (its object-bearing children overlap in plan, like a desk
 * top and its legs; a "Furniture" group of separate desks is not). An `obj:` tagged ancestor is always the unit.
 */
function objectUnits(root: Object3D, recs: readonly MeshRecord[], role: Map<MeshRecord, Role>): ObjectUnit[] {
  const dirty = new Set<Object3D>();
  const objRecs = recs.filter((r) => role.get(r) === 'object');
  for (const r of recs) {
    const rl = role.get(r);
    if (rl === 'object' || rl === 'ignore') continue;
    for (let n: Object3D | null = r.mesh; n; n = n.parent) dirty.add(n);
  }
  const boxes = new Map<Object3D, Box2>();
  for (const r of objRecs) {
    for (let n: Object3D | null = r.mesh; n && n !== root; n = n.parent) {
      const b = boxes.get(n);
      const rb = recBox(r);
      if (!b) boxes.set(n, rb);
      else
        boxes.set(n, {
          min: { x: Math.min(b.min.x, rb.min.x), y: Math.min(b.min.y, rb.min.y) },
          max: { x: Math.max(b.max.x, rb.max.x), y: Math.max(b.max.y, rb.max.y) },
        });
    }
  }
  const assembly = (p: Object3D): boolean => {
    const kids = p.children.map((c) => boxes.get(c)).filter((b): b is Box2 => !!b);
    if (kids.length <= 1) return true;
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const i = stack.pop() as number;
      kids.forEach((b, j) => {
        if (!seen.has(j) && boxesOverlap(kids[i] as Box2, b, 0.02)) {
          seen.add(j);
          stack.push(j);
        }
      });
    }
    return seen.size === kids.length;
  };
  const units = new Map<string, ObjectUnit>();
  for (const r of objRecs) {
    let node: Object3D = r.mesh;
    const rn = r.tags.roleNode;
    if (rn && r.tags.role === 'object' && rn !== r.mesh) node = rn;
    else if (r.instance === null) {
      while (
        node.parent &&
        node.parent !== root &&
        !dirty.has(node.parent) &&
        tagsOf(node.parent).room === undefined &&
        assembly(node.parent)
      )
        node = node.parent;
    }
    const key = `${node.uuid}:${r.instance ?? ''}`;
    let u = units.get(key);
    if (!u) {
      const names: string[] = [];
      node.traverse((o) => {
        const nm = nodeName(o);
        if (nm) names.push(nm);
      });
      const own = nodeName(node) || r.name || `Object ${units.size + 1}`;
      u = {
        node,
        name: r.instance !== null ? `${own} #${r.instance + 1}` : own,
        names,
        recs: [],
        instance: r.instance,
        ...(r.tags.role === 'object' && r.tags.kind ? { kind: r.tags.kind } : {}),
        ...(r.tags.room ? { room: r.tags.room } : {}),
      };
      units.set(key, u);
    }
    u.recs.push(r);
  }
  return [...units.values()];
}
