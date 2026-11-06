import { describe, expect, it } from 'vitest';
import { placeCard } from './ZoneCard';

describe('placeCard', () => {
  const surface = { w: 1000, h: 600 };
  it('goes right of the zone when it fits', () => {
    expect(placeCard({ x: 100, y: 50, w: 200, h: 100 }, surface)).toEqual({ left: 312, top: 50, maxHeight: 542 });
  });
  it('goes left when the right side is full', () => {
    expect(placeCard({ x: 600, y: 50, w: 300, h: 100 }, surface).left).toBe(600 - 12 - 272);
  });
  it('pins to the right edge when neither side fits, and never runs past the bottom', () => {
    const p = placeCard({ x: 0, y: 500, w: 1000, h: 90 }, surface);
    expect(p.left).toBe(1000 - 272 - 8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(592);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
});
