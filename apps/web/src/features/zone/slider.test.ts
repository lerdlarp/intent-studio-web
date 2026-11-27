import { describe, expect, it } from 'vitest';
import { LEVEL_PRESETS, levelWord, sliderRange, sliderScale } from './ZoneCard';

// The open zone's target slider: one caption scale for every kind, and a span that keeps the presets apart.
describe('target slider', () => {
  it('names every kind soft, comfortable or bright', () => {
    for (const presets of Object.values(LEVEL_PRESETS))
      expect(presets!.map(([n]) => n)).toEqual(['Soft', 'Comfortable', 'Bright']);
  });

  it('captions the nearest preset on a log scale', () => {
    const task = LEVEL_PRESETS.Task!; // 20, 30, 50 fc
    expect(levelWord(task, 8)).toBe('Soft');
    expect(levelWord(task, 24)).toBe('Soft');
    expect(levelWord(task, 25)).toBe('Comfortable');
    expect(levelWord(task, 40)).toBe('Bright');
    expect(levelWord(task, 150)).toBe('Bright');
    expect(levelWord([], 30)).toBeNull();
  });

  it('spans half the softest preset to 1.5 times the brightest, widened to the target', () => {
    expect(sliderRange(LEVEL_PRESETS.Task!, 30)).toEqual({ min: 10, max: 75, step: 1 });
    expect(sliderRange(LEVEL_PRESETS.Task!, 90)).toEqual({ min: 10, max: 90, step: 1 });
    expect(sliderRange(LEVEL_PRESETS.Path!, null)).toEqual({ min: 0.5, max: 7.5, step: 0.5 });
    expect(sliderRange(LEVEL_PRESETS.Accent!, null).max).toBe(150);
    expect(sliderRange([], null)).toEqual({ min: 5, max: 45, step: 1 });
  });

  it('is logarithmic, round-trips the presets and keeps their words apart', () => {
    const { at, value } = sliderScale(10, 75, 1);
    expect(at(10)).toBe(0);
    expect(at(75)).toBe(1);
    expect(at(5)).toBe(0);
    expect(at(200)).toBe(1);
    expect(value(0)).toBe(10);
    expect(value(1)).toBe(75);
    expect(at(20) - at(10)).toBeCloseTo(at(40) - at(20), 9); // equal ratios, equal travel
    for (const presets of Object.values(LEVEL_PRESETS)) {
      const { min, max, step } = sliderRange(presets!, null);
      const s = sliderScale(min, max, step);
      const t = presets!.map(([, fc]) => s.at(fc));
      for (const [i, [, fc]] of presets!.entries()) expect(s.value(t[i]!)).toBe(fc);
      // room for a word under each tick on a 280 px track
      expect(Math.min(t[1]! - t[0]!, t[2]! - t[1]!)).toBeGreaterThan(0.18);
    }
  });
});
