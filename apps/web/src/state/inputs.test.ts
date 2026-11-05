import { describe, expect, it } from 'vitest';
import { footcandlesToLux, metersToFeet } from '@intent-studio/core';
import { illuminanceInput, integerInput, lengthInput, parseIlluminance, parseInteger, parseLength } from './inputs';

describe('inspector inputs: display units ⇄ model', () => {
  it('illuminance: fc with one decimal, lux whole; empty is no bound; bad text is rejected', () => {
    expect(illuminanceInput(30, 'imperial')).toBe('30');
    expect(illuminanceInput(12.24, 'imperial')).toBe('12.2');
    expect(illuminanceInput(30, 'metric')).toBe('323');
    expect(illuminanceInput(null, 'metric')).toBe('');
    expect(parseIlluminance('35', 'imperial')).toBe(35);
    expect(parseIlluminance(' 35 fc ', 'imperial')).toBe(35);
    expect(parseIlluminance('500', 'metric')).toBeCloseTo(500 / footcandlesToLux(1), 12);
    expect(parseIlluminance('500 lx', 'metric')).toBeCloseTo(46.4515, 3);
    expect(parseIlluminance('', 'imperial')).toBeNull();
    for (const bad of ['abc', '-5', '1e3', '3..', 'NaN']) expect(parseIlluminance(bad, 'imperial')).toBeUndefined();
  });

  it('length: feet-inches or decimal feet (imperial), metres (metric)', () => {
    expect(lengthInput(2.5, 'imperial')).toBe('2′-6″');
    expect(lengthInput(2.5, 'metric')).toBe('0.76');
    expect(lengthInput(null, 'imperial')).toBe('');
    const cases: [string, number][] = [
      ['2′-6″', 2.5],
      [`2'-6"`, 2.5],
      [`2' 6"`, 2.5],
      [`3'`, 3],
      ['6"', 0.5],
      ['30 in', 2.5],
      ['3.5', 3.5],
      ['3.5 ft', 3.5],
      ['0′-0″', 0],
    ];
    for (const [t, ft] of cases) expect(parseLength(t, 'imperial'), t).toBeCloseTo(ft, 12);
    expect(parseLength('0.76', 'metric')).toBeCloseTo(metersToFeet(0.76), 12);
    expect(parseLength('1.2 m', 'metric')).toBeCloseTo(metersToFeet(1.2), 12);
    expect(parseLength('', 'metric')).toBeNull();
    for (const bad of ['two', '2 6', '-1', `2'-6"x`]) expect(parseLength(bad, 'imperial'), bad).toBeUndefined();
    expect(parseLength(`2'`, 'metric')).toBeUndefined();
  });

  it('round trip in display units is stable', () => {
    for (const ft of [0, 2.5, 3, 3.5, 9]) {
      expect(parseLength(lengthInput(ft, 'imperial'), 'imperial')).toBeCloseTo(ft, 12);
      expect(parseLength(lengthInput(ft, 'metric'), 'metric')).toBeCloseTo(ft, 1);
    }
  });

  it('integers', () => {
    expect(integerInput(null)).toBe('');
    expect(integerInput(6)).toBe('6');
    expect(parseInteger('6')).toBe(6);
    expect(parseInteger('')).toBeNull();
    expect(parseInteger('2.5')).toBeUndefined();
    expect(parseInteger('-15')).toBeUndefined();
    expect(parseInteger('-15', true)).toBe(-15);
  });
});
