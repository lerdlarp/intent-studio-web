import polygonClipping, { type Polygon } from 'polygon-clipping';
import { area } from './geometry';
import type { P2 } from './model';

const polygon = (points: readonly P2[]): Polygon => [points.map(({ x, y }) => [x, y])];

/** Union two overlapping simple regions when the result is a single region without holes. */
export function unionOverlappingRegions(a: readonly P2[], b: readonly P2[]): P2[] | null {
  if (a.length < 3 || b.length < 3 || area(a) < 1e-8 || area(b) < 1e-8) return null;
  try {
    const overlap = polygonClipping.intersection(polygon(a), polygon(b));
    const overlapArea = overlap.reduce(
      (sum, poly) =>
        sum +
        poly.reduce((s, ring, index) => {
          const points = ring.map(([x, y]) => ({ x, y }));
          return s + (index === 0 ? area(points) : -area(points));
        }, 0),
      0,
    );
    if (overlapArea < 1e-8) return null;
    const result = polygonClipping.union(polygon(a), polygon(b));
    if (result.length !== 1 || result[0]!.length !== 1) return null;
    return result[0]![0]!.slice(0, -1).map(([x, y]) => ({ x, y }));
  } catch {
    return null;
  }
}
