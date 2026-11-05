import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { area, type StudioRoom } from '@intent-studio/core';
import { extractRooms } from '../src/extract-room';
import { loadScene } from '../src/load';
import { buildDisplayMesh, waterFill } from '../src/display-mesh';
import { addClutter, furnish, officeRoom, toGlb } from './helpers';

// Phase 6 large scenes: the office fixture plus ~300k triangles of clutter (two dense sculptures and 1,500 tiny
// parts) as a real GLB. Extraction (full mesh) must find the same room as without the clutter; the display mesh for
// the 3D context is capped and merged per material. Timings are printed (Node, this machine).
const outline = (r: StudioRoom) => r.floor[0]!.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);

describe('large scene (≈300k clutter triangles)', async () => {
  const plain = officeRoom();
  furnish(plain);
  const baseline = extractRooms(await loadScene(await toGlb(plain), 'office.glb'), { sourceName: 'office.glb' });

  const big = officeRoom();
  furnish(big);
  const clutterTris = addClutter(big);
  const glb = await toGlb(big);
  const t0 = performance.now();
  const loaded = await loadScene(glb, 'big.glb');
  const t1 = performance.now();
  const result = extractRooms(loaded, { sourceName: 'big.glb' });
  const t2 = performance.now();
  const display = buildDisplayMesh(loaded.root, { maxTriangles: 200_000 });
  const t3 = performance.now();
  console.log(
    `large scene: ${(glb.byteLength / 1e6).toFixed(1)} MB, ${display.sourceTriangles} triangles in ${display.sourceMeshes} meshes; ` +
      `load ${(t1 - t0).toFixed(0)} ms, extract ${(t2 - t1).toFixed(0)} ms, display mesh ${(t3 - t2).toFixed(0)} ms → ` +
      `${display.triangles} triangles in ${display.meshes} meshes (${display.droppedMeshes} tiny meshes dropped)`,
  );

  it('the clutter is really there (≥ 300k triangles)', () => {
    expect(clutterTris).toBeGreaterThanOrEqual(300_000);
    expect(display.sourceTriangles).toBeGreaterThanOrEqual(300_000);
  });

  it('extraction on the full mesh finds the same room as without the clutter', () => {
    expect(result.strategy).toBe(baseline.strategy);
    expect(result.rooms).toHaveLength(1);
    const room = result.rooms[0]!.room;
    const ref = baseline.rooms[0]!.room;
    expect(outline(room)).toEqual(outline(ref));
    expect(area(room.floor[0]!)).toBeCloseTo(area(ref.floor[0]!), 3);
    expect(room.ceilingHeight).toBeCloseTo(ref.ceilingHeight, 3);
    expect(room.walls.length).toBe(ref.walls.length);
    expect(room.ceilingZones.length).toBe(ref.ceilingZones.length);
    // the sculptures are objects of the room; the furniture is still found
    const names = room.objects.map((o) => o.name);
    for (const o of ref.objects) expect(names).toContain(o.name);
    expect(names).toContain('Sculpture');
    expect(room.objects.length).toBe(ref.objects.length + 2); // + the two sculptures; the 1,500 tiny parts are not objects
  });

  it('load + extraction stays well under 10 s', () => {
    expect(t2 - t0).toBeLessThan(10_000);
  });

  it('display mesh: capped, tiny parts dropped, merged per material', () => {
    expect(display.triangles).toBeLessThanOrEqual(200_000);
    expect(display.decimated).toBe(true);
    expect(display.droppedMeshes).toBe(1500);
    expect(display.meshes).toBeLessThanOrEqual(2); // the fixture's material + the clutter material
    expect(display.root.children.every((c) => (c as Mesh).isMesh)).toBe(true);
  });
});

describe('display mesh basics', () => {
  it('waterFill: per-mesh cap', () => {
    expect(waterFill([10, 20, 30], 100)).toBe(Infinity);
    expect(waterFill([10, 100, 100], 110)).toBe(50);
    expect(waterFill([1000], 10)).toBe(10);
  });

  it('under budget: every triangle kept in root space, transforms baked', () => {
    const root = new Object3D();
    root.position.set(10, 0, 0);
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    m.position.set(0, 5, 0);
    root.add(m);
    const r = buildDisplayMesh(root);
    expect(r.triangles).toBe(12);
    expect(r.decimated).toBe(false);
    const g = (r.root.children[0] as Mesh).geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.min.toArray()).toEqual([9.5, 4.5, -0.5]);
  });
});
