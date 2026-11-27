import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2 contrast of the status glyph / text colours (✓ ↓ ↑, links, muted text) against every panel and banner
// background, light and dark themes (app.css tokens). AA for normal text: 4.5:1.
const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]!] = m[2]!;
  return out;
}
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const darkEnd = css.indexOf('\n* {', darkAt);
const light = tokens(css.slice(css.indexOf(':root {'), darkAt));
const darkOnly = tokens(css.slice(darkAt, darkEnd));
const dark = { ...light, ...darkOnly };

const lum = (hex: string): number => {
  const c = [1, 3, 5]
    .map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('colour contrast (status glyphs, accent, muted)', () => {
  for (const [name, t] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`${name}: ≥ 4.5:1 on every background`, () => {
      for (const fg of ['ok', 'under', 'over', 'muted', 'accent', 'ink'])
        for (const bg of ['panel', 'bg', 'canvas', 'hover', 'control', 'field', 'info-bg', 'warn-bg', 'error-bg'])
          expect(ratio(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['accent-ink']!, t.accent!), 'primary button text').toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['strong-ink']!, t['strong-bg']!), 'type tags, toasts').toBeGreaterThanOrEqual(4.5);
    });
  }
});

// One set of surfaces per theme: every colour token the light theme defines is redefined for dark, so no surface
// falls back to a light value in dark mode.
describe('dark theme coverage', () => {
  it('redefines every light colour token', () => {
    expect(darkEnd).toBeGreaterThan(darkAt);
    const missing = Object.keys(light).filter((k) => !(k in darkOnly));
    expect(missing).toEqual([]);
  });
  it('steps up in lightness from canvas to panel to control', () => {
    expect(lum(dark.canvas!)).toBeLessThan(lum(dark.panel!));
    expect(lum(dark.panel!)).toBeLessThan(lum(dark.control!));
    expect(lum(dark.panel!)).toBeLessThan(lum(dark.hover!));
  });
});

// Stylesheets use the tokens: no hard-coded colours outside the token blocks (shadows and scrims included).
describe('no hard-coded colours', () => {
  const sheets = import.meta.glob('../**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >;
  it('finds the stylesheets', () => expect(Object.keys(sheets).length).toBeGreaterThan(5));
  for (const [file, text] of Object.entries(sheets)) {
    it(file, () => {
      const body = file.endsWith('styles/app.css') ? text.slice(text.indexOf('\n* {')) : text;
      const hits = body.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|var\(--warn[,)]/gi) ?? [];
      expect(hits, file).toEqual([]);
    });
  }
});
