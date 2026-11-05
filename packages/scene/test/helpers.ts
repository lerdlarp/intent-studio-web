// Test helpers: build three.js scenes in plan feet (converted to glTF metres, Y-up) and round-trip them through
// GLTFExporter → GLB bytes → loadScene, all in Node.
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  SphereGeometry,
  TorusKnotGeometry,
  type Object3D,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { loadScene, type LoadedScene } from '../src/load';

const M = 1 / 3.28084;

/** Minimal FileReader for GLTFExporter's binary path (Node has Blob but no FileReader). */
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  onload: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onload?.();
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buf) => {
      let s = '';
      for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${btoa(s)}`;
      this.onload?.();
      this.onloadend?.();
    });
  }
}
const g = globalThis as { FileReader?: unknown };
if (typeof g.FileReader === 'undefined') g.FileReader = NodeFileReader;

const material = new MeshBasicMaterial();

/** Axis-aligned box given in plan feet: x, y ranges and elevation range z. */
export function box(name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Mesh {
  const mesh = new Mesh(new BoxGeometry((x1 - x0) * M, (z1 - z0) * M, (y1 - y0) * M), material);
  mesh.name = name;
  mesh.position.set(((x0 + x1) / 2) * M, ((z0 + z1) / 2) * M, (-(y0 + y1) / 2) * M);
  return mesh;
}

/** A desk group: top + 4 legs, `length` × `width` ft, `height` ft high, centred at (cx, cy), rotated `deg` CCW. */
export function desk(
  name: string,
  cx: number,
  cy: number,
  length: number,
  width: number,
  height: number,
  deg = 0,
): Group {
  const g = new Group();
  g.name = name;
  const hl = length / 2;
  const hw = width / 2;
  g.add(box(`${name} top`, -hl, hl, -hw, hw, height - 0.1, height));
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const lx = sx * (hl - 0.2);
    const ly = sy * (hw - 0.2);
    g.add(box(`${name} leg`, lx - 0.1, lx + 0.1, ly - 0.1, ly + 0.1, 0, height - 0.1));
  }
  g.position.set(cx * M, 0, -cy * M);
  g.rotation.y = (deg * Math.PI) / 180;
  return g;
}

export async function toGlb(root: Object3D): Promise<ArrayBuffer> {
  const out = await new GLTFExporter().parseAsync(root, { binary: true });
  return out as ArrayBuffer;
}

export async function roundTrip(root: Object3D, filename = 'test.glb'): Promise<LoadedScene> {
  return loadScene(await toGlb(root), filename);
}

export interface BoxRoomNames {
  floor: string;
  wall: (side: string, part: number) => string;
  ceiling: string;
  pocket: string;
}
export const NEUTRAL: BoxRoomNames = {
  floor: 'Slab',
  wall: (side, part) => `Partition ${side} ${part}`,
  ceiling: 'Soffit board',
  pocket: 'Coffer',
};

/**
 * The PLAN 2B fixture: a 30 × 20 × 9 ft room (plan origin at the SW interior corner), 0.5 ft walls outside the
 * interior, a 10–20 ft window (sill 3, head 7) in the south wall, a 4–7 ft door (head 7) in the east wall, and a
 * raised 11 ft ceiling pocket over x 12–18, y 8–14.
 */
export function officeRoom(names: BoxRoomNames = NEUTRAL): Scene {
  const s = new Scene();
  const add = (o: Object3D): void => void s.add(o);
  add(box(names.floor, -0.5, 30.5, -0.5, 20.5, -0.5, 0));
  // South wall (y −0.5..0) with the window.
  add(box(names.wall('S', 1), -0.5, 10, -0.5, 0, 0, 9));
  add(box(names.wall('S', 2), 20, 30.5, -0.5, 0, 0, 9));
  add(box(names.wall('S', 3), 10, 20, -0.5, 0, 0, 3));
  add(box(names.wall('S', 4), 10, 20, -0.5, 0, 7, 9));
  // East wall (x 30..30.5) with the door.
  add(box(names.wall('E', 1), 30, 30.5, -0.5, 4, 0, 9));
  add(box(names.wall('E', 2), 30, 30.5, 7, 20.5, 0, 9));
  add(box(names.wall('E', 3), 30, 30.5, 4, 7, 7, 9));
  add(box(names.wall('N', 1), -0.5, 30.5, 20, 20.5, 0, 9));
  add(box(names.wall('W', 1), -0.5, 0, -0.5, 20.5, 0, 9));
  // Ceiling slab 9..9.5 with a hole x 12..18, y 8..14.
  add(box(`${names.ceiling} 1`, -0.5, 30.5, -0.5, 8, 9, 9.5));
  add(box(`${names.ceiling} 2`, -0.5, 30.5, 14, 20.5, 9, 9.5));
  add(box(`${names.ceiling} 3`, -0.5, 12, 8, 14, 9, 9.5));
  add(box(`${names.ceiling} 4`, 18, 30.5, 8, 14, 9, 9.5));
  // Pocket: sides 9..11 outside the hole, lid at 11.
  add(box(`${names.pocket} side 1`, 11.5, 18.5, 7.5, 8, 9.5, 11));
  add(box(`${names.pocket} side 2`, 11.5, 18.5, 14, 14.5, 9.5, 11));
  add(box(`${names.pocket} side 3`, 11.5, 12, 8, 14, 9.5, 11));
  add(box(`${names.pocket} side 4`, 18, 18.5, 8, 14, 9.5, 11));
  add(box(`${names.pocket} lid`, 11.5, 18.5, 7.5, 14.5, 11, 11.5));
  return s;
}

/** Furniture for the office fixture. */
export function furnish(s: Object3D): void {
  s.add(desk('Desk 01', 6, 5, 5, 2.5, 2.5));
  s.add(desk('Desk 02', 22, 14, 5, 2.5, 2.5, 30));
  s.add(box('Artwork - Sunset', 0, 0.1, 8, 12, 4.5, 7));
  s.add(box('Office Chair', 5.5, 7, 6.5, 8, 0, 3));
  s.add(box('Thing 7', 25, 26, 2, 3, 0, 1));
}

/**
 * A plain rectangular room of interior x0..x1, y0..y1 (ft) and ceiling height h, 0.5 ft walls and slabs, in a group.
 * `name(role, k)` names each piece (role: floor | wall | ceiling); `gap` cuts an opening out of the south wall.
 */
export function plainRoom(
  groupName: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  h: number,
  name: (role: 'floor' | 'wall' | 'ceiling', k: number) => string,
  gap?: { from: number; to: number; bottom: number; top: number },
): Group {
  const g = new Group();
  g.name = groupName;
  g.add(box(name('floor', 0), x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5, -0.5, 0));
  g.add(box(name('ceiling', 0), x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5, h, h + 0.5));
  if (gap) {
    const a = x0 + gap.from;
    const b = x0 + gap.to;
    g.add(box(name('wall', 1), x0 - 0.5, a, y0 - 0.5, y0, 0, h));
    g.add(box(name('wall', 2), b, x1 + 0.5, y0 - 0.5, y0, 0, h));
    if (gap.bottom > 0) g.add(box(name('wall', 3), a, b, y0 - 0.5, y0, 0, gap.bottom));
    if (gap.top < h) g.add(box(name('wall', 4), a, b, y0 - 0.5, y0, gap.top, h));
  } else g.add(box(name('wall', 1), x0 - 0.5, x1 + 0.5, y0 - 0.5, y0, 0, h));
  g.add(box(name('wall', 5), x1, x1 + 0.5, y0 - 0.5, y1 + 0.5, 0, h));
  g.add(box(name('wall', 6), x0 - 0.5, x1 + 0.5, y1, y1 + 0.5, 0, h));
  g.add(box(name('wall', 7), x0 - 0.5, x0, y0 - 0.5, y1 + 0.5, 0, h));
  return g;
}

/**
 * Phase 6 large-scene fixture: two dense sculptures (≈296k triangles) and `tinyParts` 1 cm parts on the floor, added
 * to `s`. Returns the triangle count added.
 */
export function addClutter(s: Object3D, tinyParts = 1500): number {
  const mat = new MeshBasicMaterial({ name: 'clutter' });
  const sculpture = new Mesh(new SphereGeometry(0.4, 320, 240), mat); // 152,960 triangles
  sculpture.name = 'Sculpture';
  sculpture.position.set(15 * M, 1.5 * M, -4 * M);
  const knot = new Mesh(new TorusKnotGeometry(0.3, 0.08, 1200, 60), mat); // 144,000 triangles
  knot.name = 'Knot sculpture';
  knot.position.set(25 * M, 2 * M, -16 * M);
  s.add(sculpture, knot);
  const part = new BoxGeometry(0.01, 0.01, 0.01);
  for (let k = 0; k < tinyParts; k++) {
    const m = new Mesh(part, mat);
    m.name = `Screw ${k}`;
    m.position.set((3 + (k % 50) * 0.5) * M, 0.005, -(2 + Math.floor(k / 50) * 0.5) * M);
    s.add(m);
  }
  return 2 * 320 * 239 + 1200 * 60 * 2 + tinyParts * 12;
}
