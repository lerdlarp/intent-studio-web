import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_PALETTE } from './draw';

// The fallback palette is also the print palette (PNG and PDF exports): it must be the light theme exactly.
describe('plan print palette', () => {
  it('matches the light theme tokens', () => {
    const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
    const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
    for (const [key, value] of Object.entries(FALLBACK_PALETTE)) {
      const m = light.match(new RegExp(`--${key}:\\s*(#[0-9a-f]{6})`, 'i'));
      expect(m?.[1]?.toLowerCase(), key).toBe(value.toLowerCase());
    }
  });
});
