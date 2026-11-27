import { describe, expect, it } from 'vitest';
import { popPosition } from './ZoneActions';

// The zone's actions sit beside its name: right of the label, flipped left near the edge, below when neither fits.
describe('zone actions position', () => {
  const pop = { w: 200, h: 36 };
  const label = (x: number, y: number) => ({ x, y, w: 100, h: 18 });

  it('sits right of the label, centred on it', () => {
    expect(popPosition(label(300, 200), pop, 1000, 600)).toEqual({ left: 358, top: 182 });
  });

  it('flips left when the right side would leave the canvas', () => {
    expect(popPosition(label(850, 200), pop, 1000, 600)).toEqual({ left: 592, top: 182 });
  });

  it('drops below, kept on the canvas, when neither side fits', () => {
    expect(popPosition(label(200, 100), pop, 400, 600)).toEqual({ left: 100, top: 117 });
    expect(popPosition(label(200, 590), pop, 400, 600)).toEqual({ left: 100, top: 537 });
  });

  it('stays inside the canvas vertically', () => {
    expect(popPosition(label(300, 4), pop, 1000, 600).top).toBe(8);
    expect(popPosition(label(300, 598), pop, 1000, 600).top).toBe(556);
  });
});
