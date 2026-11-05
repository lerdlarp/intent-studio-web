// Plan rasters used by the geometry strategy (plan metres). A Grid is a cell lattice over a plan rectangle; masks
// are Uint8Array (0/1) and height maps Float32Array (NaN = empty), both indexed j * nx + i with j growing with +Y.
import type { P2 } from '@intent-studio/core';

export class Grid {
  readonly size: number;
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly cell: number,
    readonly nx: number,
    readonly ny: number,
  ) {
    this.size = nx * ny;
  }

  /** Grid covering [min, max] padded by `pad` cells. */
  static cover(min: P2, max: P2, cell: number, pad = 3): Grid {
    const x0 = min.x - pad * cell;
    const y0 = min.y - pad * cell;
    const nx = Math.max(1, Math.ceil((max.x - min.x) / cell) + 2 * pad);
    const ny = Math.max(1, Math.ceil((max.y - min.y) / cell) + 2 * pad);
    return new Grid(x0, y0, cell, nx, ny);
  }

  cx(i: number): number {
    return this.x0 + (i + 0.5) * this.cell;
  }
  cy(j: number): number {
    return this.y0 + (j + 0.5) * this.cell;
  }
  /** Cell index of a point, or -1 outside. */
  at(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((y - this.y0) / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i;
  }
  mask(): Uint8Array {
    return new Uint8Array(this.size);
  }
  cellArea(): number {
    return this.cell * this.cell;
  }
}

/**
 * Visit every cell whose centre lies inside (or on the boundary of) triangle abc; `f(index, u, v)` gets the
 * barycentric weights of b and c at the centre (so a value interpolates as a + u(b − a) + v(c − a)).
 */
export function rasterTriangle(g: Grid, a: P2, b: P2, c: P2, f: (index: number, u: number, v: number) => void): void {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const fx = c.x - a.x;
  const fy = c.y - a.y;
  const det = ex * fy - ey * fx;
  if (Math.abs(det) < 1e-14) return;
  const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - g.x0) / g.cell - 0.5));
  const i1 = Math.min(g.nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - g.x0) / g.cell - 0.5));
  const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - g.y0) / g.cell - 0.5));
  const j1 = Math.min(g.ny - 1, Math.ceil((Math.max(a.y, b.y, c.y) - g.y0) / g.cell - 0.5));
  const eps = 1e-9;
  for (let j = j0; j <= j1; j++) {
    const py = g.cy(j) - a.y;
    for (let i = i0; i <= i1; i++) {
      const px = g.cx(i) - a.x;
      const u = (px * fy - py * fx) / det;
      const v = (ex * py - ey * px) / det;
      if (u >= -eps && v >= -eps && u + v <= 1 + eps) f(j * g.nx + i, u, v);
    }
  }
}

/** Mark an 8-connected chain of cells along segment pq (blocks 4-connected flood fills). */
export function rasterSegment(g: Grid, mask: Uint8Array, p: P2, q: P2): void {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const steps = Math.max(1, Math.ceil(len / (g.cell * 0.45)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const k = g.at(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
    if (k >= 0) mask[k] = 1;
  }
}

/** 4-connected component labels of mask cells (0 = not in mask, 1..n), plus each component's cell count. */
export function components(g: Grid, mask: Uint8Array): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(g.size);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let next = 0;
  for (let s = 0; s < g.size; s++) {
    if (!mask[s] || labels[s]) continue;
    next++;
    let count = 0;
    labels[s] = next;
    stack.push(s);
    while (stack.length) {
      const k = stack.pop() as number;
      count++;
      const i = k % g.nx;
      const j = (k - i) / g.nx;
      const visit = (n: number): void => {
        if (mask[n] && !labels[n]) {
          labels[n] = next;
          stack.push(n);
        }
      };
      if (i > 0) visit(k - 1);
      if (i < g.nx - 1) visit(k + 1);
      if (j > 0) visit(k - g.nx);
      if (j < g.ny - 1) visit(k + g.nx);
    }
    sizes.push(count);
  }
  return { labels, sizes };
}

/** Chamfer (3-4) distance, in metres, from each mask cell to the nearest non-mask cell or the grid edge. */
export function distanceInside(g: Grid, mask: Uint8Array): Float32Array {
  const { nx, ny } = g;
  const d = new Float32Array(g.size);
  const BIG = 1e9;
  for (let k = 0; k < g.size; k++) d[k] = mask[k] ? BIG : 0;
  const get = (i: number, j: number): number => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : (d[j * nx + i] as number));
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!d[k]) continue;
      d[k] = Math.min(
        d[k] as number,
        get(i - 1, j) + 3,
        get(i, j - 1) + 3,
        get(i - 1, j - 1) + 4,
        get(i + 1, j - 1) + 4,
      );
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!d[k]) continue;
      d[k] = Math.min(
        d[k] as number,
        get(i + 1, j) + 3,
        get(i, j + 1) + 3,
        get(i + 1, j + 1) + 4,
        get(i - 1, j + 1) + 4,
      );
    }
  for (let k = 0; k < g.size; k++) d[k] = ((d[k] as number) / 3) * g.cell;
  return d;
}

/**
 * Boundary loops of the mask along cell edges: outer loops counter-clockwise, holes clockwise (plan +Y up),
 * vertices only at corners. Diagonal-only contacts are kept apart (4-connected regions).
 */
export function traceLoops(g: Grid, mask: Uint8Array): P2[][] {
  const { nx, ny } = g;
  const W = nx + 1;
  const inside = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i] === 1;
  // Directed edges keyed by start vertex; dir 0 = +x, 1 = +y, 2 = −x, 3 = −y.
  const out = new Map<number, number[]>();
  const add = (vi: number, vj: number, dir: number): void => {
    const key = vj * W + vi;
    const list = out.get(key);
    if (list) list.push(dir);
    else out.set(key, [dir]);
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!inside(i, j)) continue;
      if (!inside(i, j - 1)) add(i, j, 0);
      if (!inside(i + 1, j)) add(i + 1, j, 1);
      if (!inside(i, j + 1)) add(i + 1, j + 1, 2);
      if (!inside(i - 1, j)) add(i, j + 1, 3);
    }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const loops: P2[][] = [];
  const keys = [...out.keys()].sort((a, b) => a - b);
  for (const startKey of keys) {
    while ((out.get(startKey)?.length ?? 0) > 0) {
      const startDir = (out.get(startKey) as number[]).shift() as number;
      let key = startKey;
      let dir = startDir;
      let prevDir = -1;
      const pts: P2[] = [];
      for (let guard = 0; guard < 4 * g.size + 8; guard++) {
        const vi = key % W;
        const vj = (key - vi) / W;
        if (dir !== prevDir) pts.push({ x: g.x0 + vi * g.cell, y: g.y0 + vj * g.cell });
        prevDir = dir;
        key = (vj + (DY[dir] as number)) * W + vi + (DX[dir] as number);
        const list = out.get(key) ?? [];
        // Prefer a left turn, then straight, then right (keeps 4-connected regions separate at saddles).
        let pick = -1;
        let closed = false;
        for (const cand of [(dir + 1) % 4, dir, (dir + 3) % 4]) {
          if (key === startKey && cand === startDir) {
            closed = true;
            break;
          }
          const idx = list.indexOf(cand);
          if (idx >= 0) {
            pick = cand;
            list.splice(idx, 1);
            break;
          }
        }
        if (closed || pick < 0) break;
        dir = pick;
      }
      if (pts.length >= 4) loops.push(pts);
    }
  }
  return loops;
}
