import { describe, expect, it } from 'vitest';
import { Group, Scene, type Object3D } from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { area, signedArea } from '@intent-studio/core';
import { m2ft, planToScene, sceneToPlan, ft2m } from '../src/axes';
import { extractRooms } from '../src/extract-room';
import { detectFormat, loadScene, prepareGltf } from '../src/load';
import { buildManualRoom } from '../src/room-build';
import { box, furnish, officeRoom, roundTrip, toGlb } from './helpers';

const close = (a: number, b: number, tol = 0.02): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('axes', () => {
  it('glTF Y-up → plan: x = X, y = −Z, elevation = Y (proper rotation, CCW kept)', () => {
    expect(sceneToPlan({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: -3, z: 2 });
    expect(sceneToPlan({ x: 1, y: 2, z: 3 }, 'z')).toEqual({ x: 1, y: 2, z: 3 });
    expect(planToScene(sceneToPlan({ x: 1, y: 2, z: 3 }))).toEqual({ x: 1, y: 2, z: 3 });
    // A loop CCW seen from +Y (scene) maps to a CCW plan loop.
    const sceneLoop = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: -1 },
      { x: 0, y: 0, z: -1 },
    ];
    expect(signedArea(sceneLoop.map((p) => sceneToPlan(p)))).toBeGreaterThan(0);
    close(m2ft(1), 3.28084, 1e-9);
    close(ft2m(3.28084), 1, 1e-9);
  });
});

describe('detectFormat / loadScene', () => {
  it.each([
    ['room.GLB', 'glb'],
    ['room.gltf', 'gltf'],
    ['a/b/room.obj', 'obj'],
    ['room.fbx', 'fbx'],
  ] as const)('%s → %s', (name, fmt) => expect(detectFormat(name)).toBe(fmt));

  it('sniffs content when the extension is missing', async () => {
    const glb = await toGlb(new Scene());
    expect(detectFormat('upload', glb)).toBe('glb');
    expect(detectFormat('upload', bytes('{"asset":{"version":"2.0"}}'))).toBe('gltf');
    expect(detectFormat('upload', bytes('# obj\nv 0 0 0\n'))).toBe('obj');
    expect(detectFormat('upload', bytes('Kaydara FBX Binary  \0'))).toBe('fbx');
    expect(() => detectFormat('notes.txt', bytes('hello'))).toThrow(/Unsupported/);
  });

  it('rejects malformed GLB', async () => {
    await expect(loadScene(bytes('not a model'), 'x.glb')).rejects.toThrow();
  });

  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  async function texturedGltf(): Promise<Record<string, unknown>> {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const s = new Scene();
    const slab = box('Slab', 0, 10, 0, 10, -0.5, 0);
    slab.userData = { role: 'floor' };
    s.add(slab);
    const json = (await new GLTFExporter().parseAsync(s, { binary: false })) as Record<string, unknown>;
    json.images = [{ uri: PNG_1PX }];
    json.textures = [{ source: 0 }];
    json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    return json;
  }
  const countMeshes = (root: Object3D): number => {
    let n = 0;
    root.traverse((o) => void ((o as { isMesh?: boolean }).isMesh && n++));
    return n;
  };

  it('loads a textured .gltf with embedded buffers in Node (textures skipped)', async () => {
    const loaded = await loadScene(bytes(JSON.stringify(await texturedGltf())), 'room.gltf');
    expect(loaded.format).toBe('gltf');
    expect(loaded.metresPerUnit).toBe(1);
    expect(countMeshes(loaded.root)).toBe(1);
    const mesh = loaded.root.getObjectByName('Slab');
    expect(mesh?.userData).toMatchObject({ role: 'floor' });
  });

  it('loads a textured GLB in Node (textures skipped), keeping extras', async () => {
    const glb = prepareGltf(bytes(JSON.stringify(await texturedGltf())), false);
    expect(detectFormat('upload', glb)).toBe('glb');
    const loaded = await loadScene(glb, 'room.glb');
    expect(countMeshes(loaded.root)).toBe(1);
    const r = extractRooms(loaded);
    expect(r.strategy).toBe('tags');
  });
});

describe('OBJ import', async () => {
  const s = officeRoom();
  s.add(box('Reception Desk', 20, 26, 14, 16, 0, 3.5));
  s.add(box('Wall Mirror', 29.9, 30, 10, 13, 3, 6));
  s.updateMatrixWorld(true);
  const text = new OBJExporter().parse(s);
  const loaded = await loadScene(bytes(text), 'office.obj');
  const result = extractRooms(loaded);
  const room = result.rooms[0]?.room;

  it('extracts the same room as the GLB', () => {
    expect(loaded.format).toBe('obj');
    expect(result.strategy).toBe('geometry');
    expect(result.rooms).toHaveLength(1);
    close(area(room?.floor[0] ?? []), 600, 0.5);
    close(room?.ceilingHeight as number, 9);
    expect(room?.ceilingZones.filter((z) => !z.isMain).map((z) => Math.round(z.height))).toEqual([11]);
    expect(room?.walls[0]?.openings).toEqual([expect.objectContaining({ kind: 'window' })]);
    expect(room?.walls[1]?.openings).toEqual([expect.objectContaining({ kind: 'door' })]);
  });

  it('classifies OBJ objects by name', () => {
    const kinds = Object.fromEntries((room?.objects ?? []).map((o) => [o.name, o.kind]));
    expect(kinds).toEqual({ 'Reception Desk': 'reception', 'Wall Mirror': 'mirror' });
    const rd = room?.objects.find((o) => o.kind === 'reception');
    close(rd?.center.x as number, 23);
    close(rd?.center.y as number, 15);
    close(rd?.length as number, 6);
    close(rd?.width as number, 2);
    close(rd?.top as number, 3.5);
  });
});

describe('geometry strategy is rotation- and offset-invariant', async () => {
  const s = officeRoom();
  furnish(s);
  const outer = new Group();
  const inner = new Group();
  for (const c of [...s.children]) inner.add(c);
  inner.rotation.y = (25 * Math.PI) / 180; // CCW seen from above (+Y)
  outer.position.set(40, 3, -7); // metres; floor raised 3 m
  outer.add(inner);
  const scene = new Scene();
  scene.add(outer);
  const result = extractRooms(await roundTrip(scene));
  const r = result.rooms[0];
  const room = r?.room;

  it('keeps area, CCW winding, heights, openings and objects', () => {
    expect(result.rooms).toHaveLength(1);
    const loop = room?.floor[0] ?? [];
    expect(loop).toHaveLength(4);
    expect(signedArea(loop)).toBeGreaterThan(0);
    close(area(loop), 600, 1);
    close(r?.floorElevation as number, 3, 1e-6);
    close(room?.ceilingHeight as number, 9);
    expect(room?.ceilingZones).toHaveLength(2);
    const lengths = (room?.walls ?? []).map((w) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y));
    expect(lengths.map((l) => Math.round(l)).sort()).toEqual([20, 20, 30, 30]);
    const ops = (room?.walls ?? []).flatMap((w) => w.openings);
    expect(ops.map((o) => o.kind).sort()).toEqual(['door', 'window']);
    const win = ops.find((o) => o.kind === 'window');
    close((win?.to as number) - (win?.from as number), 10, 0.05);
    close(win?.bottom as number, 3, 0.05);
    close(win?.top as number, 7, 0.05);
    const d2 = room?.objects.find((o) => o.name === 'Desk 02');
    close(d2?.orientation as number, 55, 0.05);
    close(d2?.length as number, 5);
    close(d2?.top as number, 2.5);
  });
});

describe('manual strategy (c)', () => {
  it('builds a CCW room from a clockwise polygon and a typed ceiling height', () => {
    const room = buildManualRoom(
      [
        { x: 0, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 0 },
        { x: 15, y: 0 },
        { x: 0, y: 0 },
      ],
      9.5,
      { label: 'Drawn' },
    );
    expect(room.floor[0]).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 0, y: 20 },
    ]);
    expect(room.ceilingHeight).toBe(9.5);
    expect(room.label).toBe('Drawn');
    expect(room.walls.map((w) => w.inward)).toEqual([
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ]);
    expect(room.walls.every((w) => w.top === 9.5 && w.openings.length === 0)).toBe(true);
    expect(room.ceilingZones).toEqual([{ height: 9.5, isMain: true, loops: room.floor }]);
  });

  it('rejects degenerate input', () => {
    expect(() =>
      buildManualRoom(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        9,
      ),
    ).toThrow();
    expect(() =>
      buildManualRoom(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        0,
      ),
    ).toThrow();
    expect(() =>
      buildManualRoom(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        NaN,
      ),
    ).toThrow();
  });
});
