import { expect, test, type Page } from '@playwright/test';
import { EMPTY_UUID, demoRoom } from '../../packages/core/src/index';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { goStep, openZone, toZones } from './zone';

// Dark theme: one set of surfaces. The plan canvas is the darkest surface, floating panels sit one step lighter,
// controls one more, and nothing in the chrome falls back to a light colour. An export made in dark mode still
// prints dark ink on white. Screenshots of each step go to test-results/dark/ (uploaded by CI).
const OUT = fileURLToPath(new URL('../test-results/dark/', import.meta.url));
test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });

const lum = ([r, g, b]: number[]): number => {
  const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
};

/** Background colours of every visible element under `selector` (inline-coloured swatches left out). */
async function lightSurfaces(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    // accent and status fills (primary buttons, level bars) are meant to be bright
    const probe = document.createElement('i');
    document.body.append(probe);
    const fills = new Set(
      ['accent', 'ok', 'under', 'over'].map((t) => {
        probe.style.backgroundColor = `var(--${t})`;
        return getComputedStyle(probe).backgroundColor;
      }),
    );
    probe.remove();
    const out: string[] = [];
    for (const root of Array.from(document.querySelectorAll<HTMLElement>(sel)))
      for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
        if (el.style.background || el.style.backgroundColor || !el.checkVisibility?.()) continue;
        const m = getComputedStyle(el)
          .backgroundColor.match(/[\d.]+/g)
          ?.map(Number);
        if (!m || (m.length > 3 && m[3] === 0) || fills.has(getComputedStyle(el).backgroundColor)) continue;
        const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        const l = 0.2126 * f(m[0]!) + 0.7152 * f(m[1]!) + 0.0722 * f(m[2]!);
        if (l > 0.3) out.push(`${el.tagName.toLowerCase()}.${el.className} ${getComputedStyle(el).backgroundColor}`);
      }
    return out;
  }, selector);
}

const bg = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) =>
      getComputedStyle(el)
        .backgroundColor.match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number),
    );

test('dark theme: layered surfaces, no light fallbacks, exports print light', async ({ page, request }) => {
  mkdirSync(OUT, { recursive: true });
  // its own project, so the demo rooms other specs open stay untouched
  const p = await (await request.post('/api/projects', { data: { name: 'Dark theme' } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, {
    data: { room: { ...demoRoom('Office'), id: EMPTY_UUID }, sourceAssetId: null },
  });
  expect(r.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Dark theme/ }).click();
  await page.getByRole('button', { name: /204 Open office/ }).click();
  await expect(page.getByTestId('intent-step')).toBeVisible();
  await page.screenshot({ path: OUT + 'intent.png' });
  await toZones(page);
  await openZone(page, /./);

  // depth: canvas < floating panel < button
  const canvas = await page.getByTestId('plan-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(2, 2, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!];
  });
  const panel = await bg(page, '.step-panel');
  const button = await page.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('.step-panel button'))) {
      const m = getComputedStyle(b)
        .backgroundColor.match(/[\d.]+/g)!
        .map(Number);
      if (m.length === 3 || m[3] !== 0) return m.slice(0, 3);
    }
    return null;
  });
  expect(button, 'a filled button in the step panel').not.toBeNull();
  expect(lum(canvas)).toBeLessThan(0.03);
  expect(lum(canvas)).toBeLessThan(lum(panel));
  expect(lum(panel)).toBeLessThan(lum(button!));

  const chrome = '.app-header, .step-panel, .view-pill, .room-heat, .plan-selection-float';
  expect(await lightSurfaces(page, chrome)).toEqual([]);
  await page.screenshot({ path: OUT + 'zones.png' });

  await goStep(page, 'luminaires');
  await page.getByTestId('schedule-row').first().getByRole('button').first().click();
  await expect(page.getByTestId('type-detail')).toBeVisible();
  expect(await lightSurfaces(page, chrome)).toEqual([]);
  await page.screenshot({ path: OUT + 'luminaires.png' });

  await goStep(page, 'check');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect(await lightSurfaces(page, '.export-pop')).toEqual([]);
  await page.screenshot({ path: OUT + 'check-export.png' });

  // the plan PNG is drawn on the light palette: a white corner
  const [d] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Plan PNG/ }).click(),
  ]);
  const path = OUT + 'export-plan.png';
  await d.saveAs(path);
  const corner = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const p = ctx.getImageData(2, 2, 1, 1).data;
    return [p[0]!, p[1]!, p[2]!];
  }, readFileSync(path).toString('base64'));
  expect(lum(corner)).toBeGreaterThan(0.95);
});
