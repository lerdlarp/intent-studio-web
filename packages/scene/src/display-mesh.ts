// Display mesh for large scenes (Phase 6): a light copy of a loaded scene for the 3D "imported mesh" context only.
// Room extraction always reads the full loaded scene; this never feeds it.
//
// 1. Bake every visible mesh into the root's space (world matrices with the root as the origin).
// 2. Drop tiny meshes: bounding-box diagonal < `minSizeRatio` × the scene's diagonal (screws, cables, cutlery…),
//    unless that would drop everything.
// 3. Cap triangles at `maxTriangles` by water-filling: meshes under the per-mesh share stay intact, larger ones keep
//    an evenly strided subset of their triangles (the context is drawn translucent; holes read as detail loss).
// 4. Merge what is left into one non-indexed, position-only geometry per material.
// Deterministic: same scene in → same display mesh out.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Vector3,
  type Material,
  type Object3D,
} from 'three';

export interface DisplayMeshOptions {
  /** Triangle budget of the result (default 500 000). */
  maxTriangles?: number;
  /** Meshes smaller than this fraction of the scene diagonal are dropped (default 0.003). */
  minSizeRatio?: number;
}

export interface DisplayMeshResult {
  /** Merged meshes, one per material, in the coordinates of the input root (its own transform included). */
  root: Group;
  sourceMeshes: number;
  sourceTriangles: number;
  /** Meshes dropped as tiny. */
  droppedMeshes: number;
  triangles: number;
  /** Output meshes (= materials kept). */
  meshes: number;
  /** Some meshes keep only part of their triangles. */
  decimated: boolean;
}

export const DISPLAY_MAX_TRIANGLES = 500_000;
export const DISPLAY_MIN_SIZE_RATIO = 0.003;

interface Part {
  mesh: Mesh;
  geometry: BufferGeometry;
  matrix: Matrix4;
  triangles: number;
  diagonal: number;
  material: Material;
}

const triangleCount = (g: BufferGeometry): number => {
  const pos = g.getAttribute('position');
  if (!pos) return 0;
  return Math.floor((g.index ? g.index.count : pos.count) / 3);
};

/** Per-mesh cap c with Σ min(tᵢ, c) ≤ budget (water-filling over the triangle counts). */
export function waterFill(counts: readonly number[], budget: number): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= budget) return Infinity;
  const sorted = [...counts].sort((a, b) => a - b);
  let left = budget;
  for (let k = 0; k < sorted.length; k++) {
    const share = Math.floor(left / (sorted.length - k));
    if ((sorted[k] as number) > share) return Math.max(1, share);
    left -= sorted[k] as number;
  }
  return Infinity;
}

export function buildDisplayMesh(input: Object3D, options: DisplayMeshOptions = {}): DisplayMeshResult {
  const maxTriangles = Math.max(1, Math.floor(options.maxTriangles ?? DISPLAY_MAX_TRIANGLES));
  const minSizeRatio = options.minSizeRatio ?? DISPLAY_MIN_SIZE_RATIO;
  input.updateMatrixWorld(true);
  // bake relative to the root's parent so the root's own transform is kept
  const base = new Matrix4();
  if (input.parent) base.copy(input.parent.matrixWorld).invert();

  const parts: Part[] = [];
  const sceneBox = new Box3();
  const box = new Box3();
  input.traverseVisible((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry?.getAttribute('position')) return;
    const triangles = triangleCount(m.geometry);
    if (triangles === 0) return;
    const matrix = new Matrix4().multiplyMatrices(base, m.matrixWorld);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox as Box3).applyMatrix4(matrix);
    sceneBox.union(box);
    const material = (Array.isArray(m.material) ? m.material[0] : m.material) as Material;
    parts.push({ mesh: m, geometry: m.geometry, matrix, triangles, diagonal: box.min.distanceTo(box.max), material });
  });

  const sourceTriangles = parts.reduce((n, p) => n + p.triangles, 0);
  const sceneDiag = sceneBox.isEmpty() ? 0 : sceneBox.min.distanceTo(sceneBox.max);
  let kept = parts.filter((p) => p.diagonal >= sceneDiag * minSizeRatio);
  if (kept.length === 0) kept = parts;
  const cap = waterFill(
    kept.map((p) => p.triangles),
    maxTriangles,
  );

  // group by material (first-seen order), then write positions
  const groups = new Map<Material | undefined, { parts: Part[]; triangles: number }>();
  let triangles = 0;
  let decimated = false;
  for (const p of kept) {
    const n = Math.min(p.triangles, cap);
    if (n < p.triangles) decimated = true;
    const g = groups.get(p.material) ?? { parts: [], triangles: 0 };
    g.parts.push(p);
    g.triangles += n;
    groups.set(p.material, g);
    triangles += n;
  }

  const out = new Group();
  out.name = 'display-mesh';
  const v = new Vector3();
  for (const [material, g] of groups) {
    const positions = new Float32Array(g.triangles * 9);
    let at = 0;
    for (const p of g.parts) {
      const pos = p.geometry.getAttribute('position');
      const index = p.geometry.index;
      const n = Math.min(p.triangles, cap);
      const stride = p.triangles / n; // ≥ 1: evenly spread kept triangles
      for (let k = 0; k < n; k++) {
        const t = Math.floor(k * stride);
        for (let c = 0; c < 3; c++) {
          const vi = index ? index.getX(t * 3 + c) : t * 3 + c;
          v.fromBufferAttribute(pos, vi).applyMatrix4(p.matrix);
          positions[at++] = v.x;
          positions[at++] = v.y;
          positions[at++] = v.z;
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = material?.name || 'display';
    out.add(mesh);
  }

  return {
    root: out,
    sourceMeshes: parts.length,
    sourceTriangles,
    droppedMeshes: parts.length - kept.length,
    triangles,
    meshes: out.children.length,
    decimated,
  };
}

/** Free the GPU-side resources of a loaded scene that is no longer shown (geometries only; materials are shared). */
export function disposeGeometries(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) m.geometry?.dispose();
  });
}
