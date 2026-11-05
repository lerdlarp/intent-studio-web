// Mesh triangles in plan metres, plus the level / section queries the geometry strategy is built on.
import { Matrix4, Vector3, type BufferGeometry, type InstancedMesh, type Mesh, type Object3D } from 'three';
import type { P2 } from '@intent-studio/core';
import { sceneToPlan, type UpAxis, type Vec3 } from './axes';
import { resolveTags, nodeName, type ResolvedTags } from './tags';
import type { Segment } from './polygon';

/** Horizontal-surface threshold on |normal.z| (≈ 18° from level). */
export const HORIZONTAL_NZ = 0.95;
/** Vertical-surface threshold on |normal.z| (≈ 6° from plumb). */
export const VERTICAL_NZ = 0.1;

export interface MeshRecord {
  id: number;
  mesh: Mesh;
  /** Instance index for InstancedMesh, else null. */
  instance: number | null;
  name: string;
  tags: ResolvedTags;
  /** 9 numbers per triangle: a, b, c in plan metres (x, y, elevation). */
  tri: Float64Array;
  /** Unit normal z per triangle (+1 faces up). */
  nz: Float64Array;
  /** 3-D area per triangle (m²). */
  area: Float64Array;
  min: Vec3;
  max: Vec3;
}

export const triCount = (r: MeshRecord): number => r.area.length;

function geometryTriangles(geo: BufferGeometry): number[][] {
  const pos = geo.getAttribute('position');
  if (!pos) return [];
  const idx = geo.getIndex();
  const out: number[][] = [];
  const count = idx ? idx.count : pos.count;
  const groups = geo.drawRange;
  const start = Math.max(0, groups.start);
  const end = Math.min(count, groups.count === Infinity ? count : start + groups.count);
  for (let k = start; k + 2 < end; k += 3) {
    out.push(idx ? [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)] : [k, k + 1, k + 2]);
  }
  return out;
}

function buildRecord(
  id: number,
  mesh: Mesh,
  instance: number | null,
  matrix: Matrix4,
  metresPerUnit: number,
  up: UpAxis,
  root: Object3D,
): MeshRecord | null {
  const geo = mesh.geometry as BufferGeometry | undefined;
  const pos = geo?.getAttribute('position');
  if (!geo || !pos) return null;
  const tris = geometryTriangles(geo);
  if (tris.length === 0) return null;
  const flip = matrix.determinant() < 0;
  const n = tris.length;
  const tri = new Float64Array(n * 9);
  const nz = new Float64Array(n);
  const area = new Float64Array(n);
  const v = new Vector3();
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const P: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ];
  for (let t = 0; t < n; t++) {
    const ids = tris[t] as number[];
    for (let c = 0; c < 3; c++) {
      v.fromBufferAttribute(pos, ids[flip ? ([0, 2, 1][c] as number) : c] as number).applyMatrix4(matrix);
      const p = sceneToPlan({ x: v.x * metresPerUnit, y: v.y * metresPerUnit, z: v.z * metresPerUnit }, up);
      P[c] = p;
      tri[t * 9 + c * 3] = p.x;
      tri[t * 9 + c * 3 + 1] = p.y;
      tri[t * 9 + c * 3 + 2] = p.z;
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    }
    const [a, b, c] = P as [Vec3, Vec3, Vec3];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const wx = c.x - a.x;
    const wy = c.y - a.y;
    const wz = c.z - a.z;
    const cx = uy * wz - uz * wy;
    const cy = uz * wx - ux * wz;
    const cz = ux * wy - uy * wx;
    const len = Math.hypot(cx, cy, cz);
    area[t] = len / 2;
    nz[t] = len > 0 ? cz / len : 0;
  }
  return { id, mesh, instance, name: nodeName(mesh), tags: resolveTags(mesh, root), tri, nz, area, min, max };
}

/** Every visible mesh (and InstancedMesh instance) under root as plan-metre triangles. */
export function collectMeshes(root: Object3D, metresPerUnit: number, up: UpAxis): MeshRecord[] {
  root.updateMatrixWorld(true);
  const out: MeshRecord[] = [];
  const visible = (o: Object3D): boolean => {
    for (let n: Object3D | null = o; n; n = n.parent) {
      if (!n.visible) return false;
      if (n === root) break;
    }
    return true;
  };
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !visible(mesh)) return;
    const inst = o as InstancedMesh;
    if (inst.isInstancedMesh) {
      const m = new Matrix4();
      for (let k = 0; k < inst.count; k++) {
        inst.getMatrixAt(k, m);
        const rec = buildRecord(out.length, mesh, k, m.clone().premultiply(inst.matrixWorld), metresPerUnit, up, root);
        if (rec) out.push(rec);
      }
      return;
    }
    const rec = buildRecord(out.length, mesh, null, mesh.matrixWorld, metresPerUnit, up, root);
    if (rec) out.push(rec);
  });
  return out;
}

/** A reference to one triangle. */
export interface TriRef {
  rec: MeshRecord;
  t: number;
}

export const triPoint = (r: MeshRecord, t: number, c: number): Vec3 => ({
  x: r.tri[t * 9 + c * 3] as number,
  y: r.tri[t * 9 + c * 3 + 1] as number,
  z: r.tri[t * 9 + c * 3 + 2] as number,
});
export const triZ = (r: MeshRecord, t: number): number =>
  ((r.tri[t * 9 + 2] as number) + (r.tri[t * 9 + 5] as number) + (r.tri[t * 9 + 8] as number)) / 3;
/** Plan-projected area. */
export const triPlanArea = (r: MeshRecord, t: number): number => (r.area[t] as number) * Math.abs(r.nz[t] as number);

export interface Level {
  z: number;
  area: number;
}

/** Cluster (z, area) samples into levels: 1 cm buckets chained while consecutive buckets are ≤ 3 cm apart. */
export function levels(samples: readonly Level[]): Level[] {
  const buckets = new Map<number, { za: number; area: number }>();
  for (const s of samples) {
    const k = Math.round(s.z / 0.01);
    const b = buckets.get(k) ?? { za: 0, area: 0 };
    b.za += s.z * s.area;
    b.area += s.area;
    buckets.set(k, b);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const out: Level[] = [];
  let cur: { za: number; area: number; last: number } | null = null;
  for (const k of keys) {
    const b = buckets.get(k) as { za: number; area: number };
    if (cur && k - cur.last <= 3) {
      cur.za += b.za;
      cur.area += b.area;
      cur.last = k;
    } else {
      if (cur && cur.area > 0) out.push({ z: cur.za / cur.area, area: cur.area });
      cur = { za: b.za, area: b.area, last: k };
    }
  }
  if (cur && cur.area > 0) out.push({ z: cur.za / cur.area, area: cur.area });
  return out;
}

/** Section of triangles with the horizontal plane z = h: one plan segment per crossing triangle. */
export function section(tris: readonly TriRef[], h: number): Segment[] {
  const out: Segment[] = [];
  for (const { rec, t } of tris) {
    const o = t * 9;
    const T = rec.tri;
    const z0 = (T[o + 2] as number) - h;
    const z1 = (T[o + 5] as number) - h;
    const z2 = (T[o + 8] as number) - h;
    if ((z0 > 0 && z1 > 0 && z2 > 0) || (z0 < 0 && z1 < 0 && z2 < 0)) continue;
    const pts: P2[] = [];
    const edge = (i: number, j: number, zi: number, zj: number): void => {
      if (zi > 0 === zj > 0 || zi === zj) return;
      const u = zi / (zi - zj);
      pts.push({
        x: (T[o + i * 3] as number) + ((T[o + j * 3] as number) - (T[o + i * 3] as number)) * u,
        y: (T[o + i * 3 + 1] as number) + ((T[o + j * 3 + 1] as number) - (T[o + i * 3 + 1] as number)) * u,
      });
    };
    edge(0, 1, z0, z1);
    edge(1, 2, z1, z2);
    edge(2, 0, z2, z0);
    if (pts.length >= 2) out.push({ a: pts[0] as P2, b: pts[1] as P2 });
  }
  return out;
}
