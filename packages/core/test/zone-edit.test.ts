import { describe, expect, it } from 'vitest';
import { area, contains, p2, unionOverlappingRegions } from '../src';

const rectangle = (x1: number, y1: number, x2: number, y2: number) => [p2(x1, y1), p2(x2, y1), p2(x2, y2), p2(x1, y2)];

describe('unionOverlappingRegions', () => {
  it('returns the exact concave union, independent of winding', () => {
    const a = rectangle(0, 0, 4, 2);
    const b = rectangle(2, 1, 3, 4).reverse();
    const result = unionOverlappingRegions(a, b)!;
    expect(area(result)).toBeCloseTo(10);
    expect(contains(result, p2(3.5, 3))).toBe(false);
    expect(contains(result, p2(2.5, 3))).toBe(true);
  });
  it('rejects disjoint and merely touching regions', () => {
    const a = rectangle(0, 0, 2, 2);
    expect(unionOverlappingRegions(a, rectangle(2, 0, 4, 2))).toBeNull();
    expect(unionOverlappingRegions(a, rectangle(3, 0, 4, 2))).toBeNull();
  });
});
