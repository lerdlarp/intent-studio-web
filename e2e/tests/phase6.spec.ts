import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMPTY_UUID, demoRoom, type DemoRoomName } from '../../packages/core/src/index';
import { addClutter, furnish, officeRoom, toGlb } from '../../packages/scene/test/helpers';

// Phase 6 hardening: large-scene import (progress, simplified 3D context, extraction on the full mesh), unreadable /
// oversized files, network errors with retry, autosave failure + retry, keyboard painting, the plan's text
// alternative, the library dialog's focus trap, axe (no serious / critical violations) on home, project and room, and
// the room screen layout (inspector column starts at the top) → docs/screenshots/phase6-room.png.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const OUT = fileURLToPath(new URL('../test-results/phase6/', import.meta.url));
const SCREENSHOT = fileURLToPath(new URL('../../docs/screenshots/phase6-room.png', import.meta.url));

async function project(request: APIRequestContext, name: string, room: DemoRoomName = 'Office'): Promise<string> {
  const p = await (await request.post('/api/projects', { data: { name } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, {
    data: { room: { ...demoRoom(room), id: EMPTY_UUID }, sourceAssetId: null },
  });
  expect(r.ok()).toBe(true);
  return (await r.json()).id;
}
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

async function openRoom(page: Page, projectName: string, roomLabel: RegExp, accept = true): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(projectName) }).click();
  await page.getByRole('button', { name: roomLabel }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  if (!accept) return;
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByTestId('suggestion')).toHaveCount(0);
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await expect(page.getByTestId('solving')).toHaveCount(0);
  await saved(page);
}

/** axe on the current page: no serious or critical violations (details written to test-results/phase6). */
async function axe(page: Page, name: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}axe-${name}.json`, JSON.stringify(r.violations, null, 2));
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(
    `axe ${name}: ${r.violations.length} violations (${bad.length} serious/critical), ${r.passes.length} rules passed`,
  );
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('axe: home, project and room screens (incl. library dialog) have no serious/critical violations', async ({
  page,
  request,
}) => {
  await project(request, 'Axe project');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Open a demo room' })).toBeVisible();
  await axe(page, 'home');
  await page.getByRole('button', { name: /Axe project/ }).click();
  await expect(page.getByTestId('library')).toBeVisible();
  await axe(page, 'project');
  await page.getByRole('button', { name: /204 Open office/ }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await axe(page, 'room-suggestions');
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await page.getByRole('button', { name: /^Desk cluster A task/ }).click();
  await page.getByTestId('plan-summary').locator('summary').click();
  await axe(page, 'room');
  await page.getByTestId('manage-products').click();
  await expect(page.getByRole('dialog', { name: 'Project products' })).toBeVisible();
  await axe(page, 'library-dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByRole('region', { name: '3D view' })).toBeVisible();
  await axe(page, 'room-3d');
});

test('large scene: progress, extraction on the full mesh, simplified 3D context', async ({ page }) => {
  test.setTimeout(120_000);
  const scene = officeRoom();
  furnish(scene);
  addClutter(scene); // ≈300k triangles of clutter + 1,500 tiny parts
  const glb = Buffer.from(await toGlb(scene));

  await page.goto('/');
  await page.getByPlaceholder('New project name').fill('Large scene');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Import a 3D scene…' }).click();
  const t0 = Date.now();
  await page
    .getByTestId('scene-input')
    .setInputFiles({ name: 'cluttered-office.glb', mimeType: 'model/gltf-binary', buffer: glb });
  await expect(page.getByTestId('import-progress')).toBeVisible();
  const label = page.getByRole('textbox', { name: 'Label' }).first();
  await expect(label).toBeVisible({ timeout: 60_000 });
  const importMs = Date.now() - t0;
  await expect(page.getByTestId('import-size-warning')).toHaveCount(0); // 9 MB: no warning
  await label.fill('Cluttered office');
  await page.getByRole('button', { name: /^Create room/ }).click();
  await expect(page.getByTestId('plan-dims')).toHaveText('Room 30′-0″ × 20′-0″'); // same room as without clutter

  await page.getByRole('button', { name: 'Split', exact: true }).click();
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Toggle imported mesh context' }).click();
  const note = page.locator('.room3d-note');
  await expect(note).toContainText('Imported mesh simplified for display', { timeout: 30_000 });
  const contextMs = Date.now() - t1;
  mkdirSync(OUT, { recursive: true });
  const report = { megabytes: +(glb.byteLength / 1e6).toFixed(1), importMs, contextMs, note: await note.textContent() };
  writeFileSync(`${OUT}large-scene.json`, JSON.stringify(report, null, 2));
  console.log('large scene', JSON.stringify(report));
  expect(importMs).toBeLessThan(30_000);
});

test('oversized unreadable file: size warning, clear message, manual room option', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('New project name').fill('Broken file');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Import a 3D scene…' }).click();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}huge.glb`, Buffer.alloc(51 * 1024 * 1024, 7)); // > 50 MB of garbage named .glb
  await page.getByTestId('scene-input').setInputFiles(`${OUT}huge.glb`);
  await expect(page.getByTestId('import-size-warning')).toContainText('51 MB');
  const err = page.getByTestId('import-error');
  await expect(err).toContainText('could not be read as a 3D scene', { timeout: 60_000 });
  await expect(err.getByRole('button', { name: 'Try again' })).toBeVisible();
  await err.getByRole('button', { name: 'Enter the outline by hand' }).click();
  await expect(page.getByText('Manual outline')).toBeVisible();
});

test('network errors: banner with Retry; autosave failure keeps changes and retries', async ({ page, request }) => {
  await project(request, 'Net errors');
  // the first projects request fails at the network level
  let failProjects = true;
  await page.route('**/api/projects', (route) =>
    failProjects && route.request().method() === 'GET' ? route.abort('failed') : route.fallback(),
  );
  await page.goto('/');
  const banner = page.getByTestId('error-banner');
  await expect(banner).toContainText('Loading projects failed: the server could not be reached.');
  failProjects = false;
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(banner).toHaveCount(0);
  await page.getByRole('button', { name: /Net errors/ }).click();
  await page.getByRole('button', { name: /204 Open office/ }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();

  // saves fail with a 503 → "Not saved" + notice; the design stays; "Retry now" saves once the server is back
  let failSave = true;
  await page.route('**/api/rooms/*/design', (route) =>
    failSave && route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, body: JSON.stringify({ error: 'maintenance' }), contentType: 'application/json' })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Not saved' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save this room' })).toContainText('retrying in');
  await expect(page.getByTestId('zone-row').first()).toBeVisible(); // local changes kept
  failSave = false;
  await page.getByTestId('save-retry').click();
  await saved(page);
});

test('keyboard: paint with a tool from the keyboard, plan text alternative, library dialog traps focus and closes on Esc', async ({
  page,
  request,
}) => {
  await project(request, 'Keyboard');
  await openRoom(page, 'Keyboard', /204 Open office/);
  const before = Number(await page.getByTestId('inspector').getAttribute('data-zone-count'));

  // tool via its shortcut, then paint without a pointer
  await page.getByTestId('plan-canvas').focus();
  await page.keyboard.press('3'); // Wall wash
  const target = page.getByTestId('keyboard-paint-target');
  await expect(target).toBeVisible();
  await target.selectOption({ index: 0 });
  await page.getByTestId('keyboard-paint').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', String(before + 1));
  await expect(page.getByTestId('solving')).toHaveCount(0);

  // the plan as text lists every intent
  const summary = page.getByTestId('plan-summary');
  await summary.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(summary.locator(':scope > ul > li')).toHaveCount(before + 1);
  await expect(summary).toContainText('estimate');

  // library dialog: opens from the inspector, focus inside, Tab wraps, Esc closes and returns focus
  await page.getByLabel('Zone to edit').selectOption({ label: 'Desk cluster A task' });
  const manage = page.getByTestId('manage-products');
  await manage.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Project products' });
  await expect(dialog).toBeVisible();
  for (let k = 0; k < 6; k++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(manage).toBeFocused();
});

test('room layout: the inspector column starts at the top and scrolls on its own; screenshot', async ({
  page,
  request,
}) => {
  await project(request, 'Layout', 'Cafeteria');
  await openRoom(page, 'Layout', /110 Cafeteria/);
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('ledger-row').first()).toBeVisible({ timeout: 10_000 });

  await page.locator('.room-main').evaluate((el) => el.scrollTo(0, 0)); // Calculate scrolled the plan column
  const plan = await page.locator('.plan-panel').boundingBox();
  const inspector = await page.getByRole('complementary', { name: 'Inspector' }).boundingBox();
  expect(Math.abs(inspector!.y - plan!.y)).toBeLessThan(2); // both columns start at the same height
  // scrolling the plan column leaves the inspector where it is, and vice versa
  await page.locator('.room-main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect((await page.getByRole('complementary', { name: 'Inspector' }).boundingBox())!.y).toBeCloseTo(inspector!.y, 0);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  await page.locator('.room-main').evaluate((el) => el.scrollTo(0, 0));
  await saved(page);

  mkdirSync(fileURLToPath(new URL('../../docs/screenshots/', import.meta.url)), { recursive: true });
  await page.screenshot({ path: SCREENSHOT, fullPage: false });
});
