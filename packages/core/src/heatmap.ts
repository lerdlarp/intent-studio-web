// Heatmap rasterizer (spec/heatmap.md §2-4): paints a calculated zone into an RGBA bitmap plus the world corners.
import { roundHalfEven } from './format';
import { heatColorAt, heatFraction, type HeatScale } from './heatscale';
import type { P3 } from './model';

export interface HeatPoint {
  x: number;
  y: number;
  z: number;
  value: number;
}
export interface HeatZone {
  outline: readonly P3[];
  normal: P3;
  columnSpacing: number;
  rowSpacing: number;
  points: readonly HeatPoint[];
}
export interface HeatRaster {
  width: number;
  height: number;
  /** RGBA, row 0 on top; unpainted pixels are (0,0,0,0). */
  pixels: Uint8ClampedArray;
  /** World position of the top-left pixel corner. */
  origin: P3;
  /** Top-right corner. */
  uEnd: P3;
  /** Bottom-left corner. */
  vEnd: P3;
  outline: readonly P3[];
}

export const MAX_SIDE = 1024;
export const MAX_LATTICE_CELLS = 4_000_000;
export const LUT_SIZE = 512;
export const MIN_PIXELS_PER_FOOT = 0.25;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const dot3 = (a: P3, b: P3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sub3 = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross3 = (a: P3, b: P3): P3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function normalize(v: P3): P3 | null {
  const len = Math.sqrt(dot3(v, v));
  if (!(len > 1e-9) || !Number.isFinite(len)) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function newell(poly: readonly P3[]): P3 {
  let x = 0,
    y = 0,
    z = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i + poly.length - 1) % poly.length] as P3;
    const b = poly[i] as P3;
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

type Sampler = (pu: number, pv: number) => number | null;
interface UV {
  u: number;
  v: number;
  value: number;
}

function infer(values: readonly number[]): number {
  const d = [...new Set(values.map((v) => roundHalfEven(v, 4)))].sort((a, b) => a - b);
  let best = Infinity;
  for (let i = 1; i < d.length; i++) best = Math.min(best, (d[i] as number) - (d[i - 1] as number));
  return Number.isFinite(best) ? best : 0;
}

function buildLattice(zone: HeatZone, pts: readonly UV[]): Sampler | null {
  const dul = zone.columnSpacing > 1e-6 ? zone.columnSpacing : infer(pts.map((p) => p.u));
  const dvl = zone.rowSpacing > 1e-6 ? zone.rowSpacing : infer(pts.map((p) => p.v));
  if (!(dul > 1e-6) || !(dvl > 1e-6)) return null;
  let lu0 = Infinity,
    lv0 = Infinity,
    mu = -Infinity,
    mv = -Infinity;
  for (const p of pts) {
    lu0 = Math.min(lu0, p.u);
    lv0 = Math.min(lv0, p.v);
    mu = Math.max(mu, p.u);
    mv = Math.max(mv, p.v);
  }
  const columns = roundHalfEven((mu - lu0) / dul) + 1;
  const rows = roundHalfEven((mv - lv0) / dvl) + 1;
  if (columns <= 0 || rows <= 0 || columns * rows > MAX_LATTICE_CELLS) return null;
  const cells = new Float64Array(columns * rows).fill(NaN);
  for (const p of pts) {
    const i = clamp(roundHalfEven((p.u - lu0) / dul), 0, columns - 1);
    const j = clamp(roundHalfEven((p.v - lv0) / dvl), 0, rows - 1);
    cells[j * columns + i] = p.value;
  }
  return (pu, pv) => {
    const fu = clamp((pu - lu0) / dul, 0, columns - 1);
    const fv = clamp((pv - lv0) / dvl, 0, rows - 1);
    const i = Math.floor(fu);
    const j = Math.floor(fv);
    const tu = fu - i;
    const tv = fv - j;
    const i1 = Math.min(i + 1, columns - 1);
    const j1 = Math.min(j + 1, rows - 1);
    let sum = 0;
    let weight = 0;
    const terms: [number, number, number][] = [
      [i, j, (1 - tu) * (1 - tv)],
      [i1, j, tu * (1 - tv)],
      [i, j1, (1 - tu) * tv],
      [i1, j1, tu * tv],
    ];
    for (const [ci, cj, w] of terms) {
      const c = cells[cj * columns + ci] as number;
      if (w <= 0 || Number.isNaN(c)) continue;
      sum += c * w;
      weight += w;
    }
    if (weight > 1e-9) return sum / weight;
    for (let r = 1; r <= 2; r++) {
      let rs = 0;
      let rw = 0;
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const ci = i + di;
          const cj = j + dj;
          if (ci < 0 || cj < 0 || ci >= columns || cj >= rows) continue;
          const c = cells[cj * columns + ci] as number;
          if (Number.isNaN(c)) continue;
          const w = 1 / Math.sqrt(di * di + dj * dj);
          rs += c * w;
          rw += w;
        }
      if (rw > 0) return rs / rw;
    }
    return null;
  };
}

function buildNearest(zone: HeatZone, pts: readonly UV[]): Sampler {
  const reachU = Math.max(zone.columnSpacing, 0.5) / 2;
  const reachV = Math.max(zone.rowSpacing, 0.5) / 2;
  return (pu, pv) => {
    let best = Infinity;
    let val: number | null = null;
    for (const p of pts) {
      const du = p.u - pu;
      const dv = p.v - pv;
      if (Math.abs(du) > reachU || Math.abs(dv) > reachV) continue;
      const d = du * du + dv * dv;
      if (d < best) {
        best = d;
        val = p.value;
      }
    }
    return val;
  };
}

function emptyRaster(zone: HeatZone): HeatRaster {
  const z = { x: 0, y: 0, z: 0 };
  return {
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray(4),
    origin: { ...z },
    uEnd: { ...z },
    vEnd: { ...z },
    outline: zone.outline,
  };
}

/** Paint a zone into an RGBA bitmap coloured by `scale`. */
export function rasterize(zone: HeatZone, scale: HeatScale, pixelsPerFoot = 6): HeatRaster {
  // 1. outline
  let outline: readonly P3[] = zone.outline;
  if (outline.length < 3 && zone.points.length > 0) {
    const halfX = Math.max(zone.columnSpacing, 0.5) / 2;
    const halfY = Math.max(zone.rowSpacing, 0.5) / 2;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      sz = 0;
    for (const p of zone.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      sz += p.z;
    }
    const z = sz / zone.points.length;
    const x0 = minX - halfX,
      x1 = maxX + halfX,
      y0 = minY - halfY,
      y1 = maxY + halfY;
    outline = [
      { x: x0, y: y0, z },
      { x: x1, y: y0, z },
      { x: x1, y: y1, z },
      { x: x0, y: y1, z },
    ];
  }
  if (outline.length < 3) return emptyRaster(zone);

  // 2-5. plane basis
  const origin = outline[0] as P3;
  const n = normalize(zone.normal) ?? normalize(newell(outline)) ?? { x: 0, y: 0, z: 1 };
  let e: P3 = { x: 1, y: 0, z: 0 };
  for (let i = 1; i < outline.length; i++) {
    const d = sub3(outline[i] as P3, origin);
    if (dot3(d, d) > 1e-12) {
      e = d;
      break;
    }
  }
  const en = dot3(e, n);
  const u = normalize({ x: e.x - n.x * en, y: e.y - n.y * en, z: e.z - n.z * en }) ??
    normalize(e) ?? { x: 1, y: 0, z: 0 };
  let v = cross3(n, u);

  // 6. project
  const project = (p: { x: number; y: number; z: number }): { U: number; V: number } => {
    const d = sub3(p, origin);
    return { U: dot3(d, u), V: dot3(d, v) };
  };
  let proj = outline.map(project);
  if (proj.reduce((s, p) => s + p.V, 0) / proj.length < 0) {
    v = { x: -v.x, y: -v.y, z: -v.z };
    proj = outline.map(project);
  }

  // 7-8. extents and size
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (const p of proj) {
    u0 = Math.min(u0, p.U);
    u1 = Math.max(u1, p.U);
    v0 = Math.min(v0, p.V);
    v1 = Math.max(v1, p.V);
  }
  const spanU = Math.max(u1 - u0, 1e-6);
  const spanV = Math.max(v1 - v0, 1e-6);
  let ppf = Math.max(pixelsPerFoot, MIN_PIXELS_PER_FOOT);
  ppf = Math.min(ppf, MAX_SIDE / spanU, MAX_SIDE / spanV);
  const width = clamp(Math.ceil(spanU * ppf), 1, MAX_SIDE);
  const height = clamp(Math.ceil(spanV * ppf), 1, MAX_SIDE);
  const du = spanU / width;
  const dv = spanV / height;

  // 9-10. points and sampler
  const pts: UV[] = [];
  for (const p of zone.points) {
    if (!Number.isFinite(p.value)) continue;
    const q = project(p);
    pts.push({ u: q.U, v: q.V, value: p.value });
  }
  const sampler: Sampler = (pts.length >= 4 ? buildLattice(zone, pts) : null) ?? buildNearest(zone, pts);

  // 11. LUT
  const lut = Array.from({ length: LUT_SIZE }, (_, i) =>
    heatColorAt(scale, scale.min + ((scale.max - scale.min) * i) / (LUT_SIZE - 1)),
  );

  // 12. scan
  const pixels = new Uint8ClampedArray(width * height * 4);
  const m = proj.length;
  for (let row = 0; row < height; row++) {
    const pv = v0 + (row + 0.5) * dv;
    const cs: number[] = [];
    for (let k = 0; k < m; k++) {
      const a = proj[(k + m - 1) % m] as { U: number; V: number };
      const b = proj[k] as { U: number; V: number };
      if (a.V <= pv !== b.V <= pv) cs.push(a.U + ((pv - a.V) / (b.V - a.V)) * (b.U - a.U));
    }
    cs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < cs.length; k += 2) {
      const from = Math.max(0, Math.ceil(((cs[k] as number) - u0) / du - 0.5));
      const to = Math.min(width - 1, Math.floor(((cs[k + 1] as number) - u0) / du - 0.5));
      for (let col = from; col <= to; col++) {
        const val = sampler(u0 + (col + 0.5) * du, pv);
        if (val === null) continue;
        const c = lut[clamp(roundHalfEven(heatFraction(scale, val) * (LUT_SIZE - 1)), 0, LUT_SIZE - 1)] as readonly [
          number,
          number,
          number,
        ];
        const o = (row * width + col) * 4;
        pixels[o] = c[0];
        pixels[o + 1] = c[1];
        pixels[o + 2] = c[2];
        pixels[o + 3] = 255;
      }
    }
  }

  // 13. corners
  const at = (a: number, b: number): P3 => ({
    x: origin.x + u.x * a + v.x * b,
    y: origin.y + u.y * a + v.y * b,
    z: origin.z + u.z * a + v.z * b,
  });
  return { width, height, pixels, origin: at(u0, v0), uEnd: at(u1, v0), vEnd: at(u0, v1), outline };
}
