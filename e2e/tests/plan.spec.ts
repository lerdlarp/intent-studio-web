import { openMore } from './zone';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMPTY_UUID, office } from '../../packages/core/src/index';
import { furnish, officeRoom, toGlb } from '../../packages/scene/test/helpers';

// Phase 3 gate (PLAN §5): paint a wash on a wall, move a fixture and confirm it stays pinned after a re-solve,
// undo / redo, unit toggle changes display only. Plus the Phase 2 gate: import a GLB → confirm → reload → persists.
//
// Each test works in its own project holding a copy of the Office demo room, so it never races the smoke test (which
// uses the shared "Demo rooms" project).
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const SCREENSHOT = fileURLToPath(new URL('../../docs/screenshots/phase3-plan.png', import.meta.url));

interface P2 {
  x: number;
  y: number;
}
interface Fixture {
  id: string;
  center: P2;
  pinned: boolean;
}
interface Intent {
  id: string;
  kind: string;
  label: string;
  wallIndex: number | null;
  handTuned: boolean;
  isSuggestion: boolean;
  behavior: { density: number };
  fixtures: Fixture[];
}
interface Design {
  revision: number;
  intents: Intent[];
}

async function officeProject(request: APIRequestContext, name: string): Promise<{ projectId: string; roomId: string }> {
  const p = await (await request.post('/api/projects', { data: { name } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, { data: { room: { ...office(), id: EMPTY_UUID }, sourceAssetId: null } });
  expect(r.ok()).toBe(true);
  return { projectId: p.id, roomId: (await r.json()).id };
}

const accepted = (d: Design): boolean => d.intents.length > 0 && d.intents.every((i) => !i.isSuggestion);
const design = async (request: APIRequestContext, roomId: string): Promise<Design> =>
  (await request.get(`/api/rooms/${roomId}/design`)).json();

async function openRoom(page: Page, project: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(project) }).click();
  await page.getByRole('button', { name: /204 Open office/ }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
}

async function acceptAll(page: Page): Promise<number> {
  const suggestions = page.getByTestId('suggestion');
  await expect(suggestions.first()).toBeVisible();
  const n = await suggestions.count();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', String(n));
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  return n;
}

/** Page (CSS px) position of a plan point, from the canvas view transform. */
async function planToPage(page: Page, p: P2): Promise<P2> {
  const canvas = page.getByTestId('plan-canvas');
  const box = (await canvas.boundingBox())!;
  const [scale, ox, oy] = await Promise.all(['data-scale', 'data-ox', 'data-oy'].map(async (a) => Number(await canvas.getAttribute(a))));
  return { x: box.x + ox! + p.x * scale!, y: box.y + oy! - p.y * scale! };
}
const scaleOf = async (page: Page): Promise<number> => Number(await page.getByTestId('plan-canvas').getAttribute('data-scale'));

test('paint a wash on a wall: a new intent with an estimate; heatmap overlay', async ({ page, request }) => {
  await officeProject(request, 'Plan paint');
  await openRoom(page, 'Plan paint');
  const n = await acceptAll(page);

  await page.getByRole('button', { name: 'Paint wall wash' }).click();
  await expect(page.getByRole('button', { name: 'Paint wall wash' })).toHaveAttribute('aria-pressed', 'true');
  const at = await planToPage(page, { x: 35.9, y: 6 }); // the east wall, clear of the screen
  await page.mouse.click(at.x, at.y);

  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', String(n + 1));
  await expect(page.getByLabel('Zone to edit').locator('option:checked')).toHaveText('Screen wash') // core wash label: the east wall holds the screen;
  await expect(page.getByRole('button', { name: 'Select tool' })).toHaveAttribute('aria-pressed', 'true');
  const estimate = page.getByTestId('intent').getByTestId('estimate');
  await expect(estimate).toContainText('Estimate');
  await expect(estimate).toContainText('Average');
  await expect(estimate).toContainText('Minimum');
  await expect(estimate).toContainText('fc');
  await page.getByTestId('all-zones').click();
  const estimates = page.getByTestId('estimate');
  for (let k = 0; k < n + 1; k++) await expect(estimates.nth(k)).toContainText(/fc avg · estimate/);

  // keyboard: 3 is the wash tool, Esc goes back to select
  await page.getByTestId('plan-canvas').focus();
  await page.keyboard.press('3');
  await expect(page.getByRole('button', { name: 'Paint wall wash' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Select tool' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Heatmap' }).click();
  await expect(page.getByRole('note', { name: 'Heatmap legend' })).toContainText('estimate');
  mkdirSync(fileURLToPath(new URL('../../docs/screenshots/', import.meta.url)), { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: SCREENSHOT, fullPage: false });
});

test('drag a fixture: it stays where dropped and pinned after a re-solve; undo / redo', async ({ page, request }) => {
  const { roomId } = await officeProject(request, 'Plan drag');
  await openRoom(page, 'Plan drag');
  await acceptAll(page);
  await expect.poll(async () => accepted(await design(request, roomId))).toBe(true);

  const before = await design(request, roomId);
  const ambient = before.intents.find((i) => i.kind === 'Ambient')!;
  const f = ambient.fixtures[0]!;
  const scale = await scaleOf(page);
  const from = await planToPage(page, f.center);
  const d = { x: 2 * scale, y: -1.5 * scale }; // 2 ft east, 1.5 ft north
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 4 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 4 });
  await page.mouse.up();
  // With snapping on, the drop lands at the next 2 ft ceiling tile centre.
  const expected = { x: f.center.x + 2, y: f.center.y + 2 };

  await expect(page.getByTestId('fixture-info')).toContainText('pinned');
  await expect(page.getByTestId('hand-tuned')).toBeVisible();
  const moved = async () => {
    const i = (await design(request, roomId)).intents.find((x) => x.id === ambient.id)!;
    const m = i.fixtures.find((x) => x.id === f.id);
    return m && m.pinned && i.handTuned ? [Math.round(m.center.x * 1000) / 1000, Math.round(m.center.y * 1000) / 1000] : null;
  };
  const want = [Math.round(expected.x * 1000) / 1000, Math.round(expected.y * 1000) / 1000];
  await expect.poll(moved).toEqual(want);

  // a re-solve: change another intent's density
  const task = before.intents.find((i) => i.kind === 'Task')!;
  await page.getByLabel('Zone to edit').selectOption(task.id);
  await openMore(page);
  await page.getByLabel('Fixture density').fill('1.4');
  await expect
    .poll(async () => (await design(request, roomId)).intents.find((i) => i.id === task.id)!.behavior.density)
    .toBe(1.4);
  await expect.poll(moved).toEqual(want);
  await page.getByLabel('Zone to edit').selectOption(ambient.id);
  await expect(page.getByTestId('hand-tuned')).toBeVisible();

  // undo the density change and the move; redo both
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () => {
      const i = (await design(request, roomId)).intents.find((x) => x.id === ambient.id)!;
      return !i.handTuned && i.fixtures.every((x) => !x.pinned) && i.fixtures.some((x) => x.center.x === f.center.x && x.center.y === f.center.y);
    })
    .toBe(true);
  await expect.poll(async () => (await design(request, roomId)).intents.find((i) => i.id === task.id)!.behavior.density).toBe(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(moved).toEqual(want);
  await expect.poll(async () => (await design(request, roomId)).intents.find((i) => i.id === task.id)!.behavior.density).toBe(1.4);
});

test('unit toggle changes the display only', async ({ page, request }) => {
  const { roomId } = await officeProject(request, 'Plan units');
  await openRoom(page, 'Plan units');
  await acceptAll(page);
  await expect.poll(async () => accepted(await design(request, roomId))).toBe(true);
  // let advice and autosave settle
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const saved = JSON.stringify(await design(request, roomId));

  // select a fixture so its position shows
  const ambient = (JSON.parse(saved) as Design).intents.find((i) => i.kind === 'Ambient')!;
  const at = await planToPage(page, ambient.fixtures[0]!.center);
  await page.mouse.click(at.x, at.y);
  const info = page.getByTestId('fixture-info');
  await expect(info).toContainText('′');
  const dims = page.getByTestId('plan-dims');
  await expect(dims).toHaveText('Room 36′-0″ × 24′-0″');
  const imperialInfo = await info.textContent();
  const firstEstimate = page.getByTestId('estimate').first();
  await expect(firstEstimate).toContainText(' fc');

  await page.getByText('m · lx').click();
  await expect(dims).toHaveText('Room 10.97 m × 7.32 m');
  await expect(info).toContainText(' m');
  await expect(firstEstimate).toContainText(' lx');
  await expect(page.getByTestId('intent').getByTestId('estimate')).toContainText(' lx');

  await page.getByText('ft · fc').click();
  await expect(dims).toHaveText('Room 36′-0″ × 24′-0″');
  await expect(info).toHaveText(imperialInfo!);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect(JSON.stringify(await design(request, roomId))).toBe(saved); // model (and revision) unchanged
});

test('Phase 2 gate: import a GLB, confirm the room, reload, the room persists', async ({ page }) => {
  const scene = officeRoom();
  furnish(scene);
  const glb = Buffer.from(await toGlb(scene));

  await page.goto('/');
  await page.getByPlaceholder('New project name').fill('Imported GLB');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Import a 3D scene…' }).click();
  await page.locator('input[type=file][accept^=".glb"]').setInputFiles({ name: 'office-fixture.glb', mimeType: 'model/gltf-binary', buffer: glb });
  const label = page.getByRole('textbox', { name: 'Label' }).first();
  await expect(label).toBeVisible({ timeout: 30_000 });
  await label.fill('Imported office');
  await page.getByRole('button', { name: /^Create room/ }).click();

  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await expect(page.getByTestId('plan-dims')).toHaveText('Room 30′-0″ × 20′-0″');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Imported office');

  await page.reload();
  await page.getByRole('button', { name: /Imported GLB/ }).click();
  await expect(page.getByRole('button', { name: /Imported office/ })).toContainText('imported');
  await page.getByRole('button', { name: /Imported office/ }).click();
  await expect(page.getByTestId('plan-dims')).toHaveText('Room 30′-0″ × 20′-0″');
  await expect(page.getByTestId('suggestion').first()).toBeVisible(); // empty design → seeded suggestions
});
