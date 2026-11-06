import { describe, expect, it } from 'vitest';
import { estimateStatus } from './estimateStatus';

const target = { minimum: 10, average: 20, maximum: 35 };
const estimate = { minimum: 10, average: 22.9, maximum: 93.5, fixtures: 4, watts: 60 };

describe('inspector target feedback', () => {
  it('does not claim success without configured criteria', () => {
    expect(estimateStatus({ minimum: null, average: null, maximum: null }, estimate)).toEqual({
      status: null,
      text: 'No target set',
    });
  });
  it('checks the point minimum even when the average meets its target', () => {
    expect(estimateStatus(target, { ...estimate, minimum: 9.1 })).toEqual({ status: 'Under', text: 'Below minimum' });
  });
  it('uses the existing inclusive model tolerances', () => {
    expect(estimateStatus(target, { ...estimate, minimum: 9.8, average: 18 }).status).toBe('Meets');
    expect(estimateStatus(target, { ...estimate, average: 17.9 }).status).toBe('Under');
  });
  it('compares the upper bound to average illuminance, not the brightest point', () => {
    expect(estimateStatus(target, estimate).status).toBe('Meets');
    expect(estimateStatus(target, { ...estimate, average: 36 })).toEqual({
      status: 'Over',
      text: 'Above average ceiling',
    });
  });
});
