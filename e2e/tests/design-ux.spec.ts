import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  createFixture,
  createIntent,
  createRoom,
  type LightingIntent,
  type RoomDesign,
} from '../../packages/core/src/index';

test.use({ viewport: { width: 1440, height: 900 } });
const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

async function setup(request: APIRequestContext, page: Page, name: string) {
  const room = createRoom({
    label: 'Studio',
    floor: [rect(0, 0, 24, 20)],
    ceilingGrid: { origin: { x: 0, y: 0 }, u: { x: 2, y: 0 }, v: { x: 0, y: 2 } },
  });
  const project = await (await request.post('/api/projects', { data: { name } })).json();
  const added = await (
    await request.post(`/api/projects/${project.id}/rooms`, { data: { room, sourceAssetId: null } })
  ).json();
  const make = (id: string, label: string, x: number): LightingIntent =>
    createIntent({
      id,
      label,
      kind: 'Ambient',
      region: rect(x, 2, 8, 8),
      handTuned: true,
      fixtures: [createFixture({ intentId: id, center: { x: x + 3, y: 5 }, height: 9, mount: 'ceiling' })],
    });
  const intents = [make('zone-a', 'North zone', 2), make('zone-b', 'South zone', 6)];
  const saved = await request.put(`/api/rooms/${added.id}/design`, {
    data: { revision: 0, intents, removedExisting: [] },
  });
  expect(saved.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Studio demo', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  const read = async (): Promise<RoomDesign> => (await request.get(`/api/rooms/${added.id}/design`)).json();
  return { read, roomId: added.id, intents };
}

test('selection prioritizes the product; delete a fixture, undo, redo and reload', async ({ page, request }) => {
  const { read } = await setup(request, page, 'UX fixture');
  await expect(page.getByTestId('manage-products')).toBeVisible();
  await expect(page.getByTestId('ledger')).toHaveCount(0);
  await page.getByRole('button', { name: /^North zone/ }).click();
  await expect(page.getByTestId('product-preview')).toBeVisible();
  const product = (await page.getByTestId('product-preview').boundingBox())!;
  expect(product.y).toBeLessThan(500);
  await page.getByLabel('Selected fixture', { exact: true }).selectOption({ index: 1 });
  await expect(page.getByTestId('remove-fixture')).toBeVisible();
  await page.screenshot({ path: fileURLToPath(new URL('../../docs/screenshots/ux-selected.png', import.meta.url)) });
  await page.getByTestId('remove-fixture').click();
  await expect.poll(async () => (await read()).intents.find((i) => i.id === 'zone-a')?.fixtures.length).toBe(0);
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', '2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await read()).intents.find((i) => i.id === 'zone-a')?.fixtures.length).toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await read()).intents.find((i) => i.id === 'zone-a')?.fixtures.length).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: /UX fixture/ }).click();
  await page.getByRole('button', { name: 'Studio demo', exact: true }).click();
  await page.getByRole('button', { name: /^North zone/ }).click();
  await expect(page.getByTestId('zone-row').first()).toContainText('0 fixtures');
});

test('merge has an outline preview, preserves two fixtures, and can be undone', async ({ page, request }) => {
  const { read } = await setup(request, page, 'UX merge');
  await page.getByRole('button', { name: /^North zone/ }).click();
  await page.getByTestId('merge-zones').click();
  const dialog = page.getByRole('dialog', { name: 'Merge overlapping zones' });
  await expect(dialog.getByRole('img', { name: 'Merged zone outline' })).toBeVisible();
  await expect(dialog).toContainText('South zone');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', '2');
  await page.getByTestId('merge-zones').click();
  await page.getByTestId('confirm-merge').click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', '1');
  await expect.poll(async () => (await read()).intents.length).toBe(1);
  expect((await read()).intents[0]!.fixtures).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', '2');
});

test('drag previews grid snap, toggle allows free placement, and canvas Delete removes only the fixture', async ({
  page,
  request,
}) => {
  const { read } = await setup(request, page, 'UX snapping');
  const canvas = page.getByTestId('plan-canvas');
  const at = async (x: number, y: number) => {
    const box = (await canvas.boundingBox())!;
    const scale = Number(await canvas.getAttribute('data-scale'));
    return {
      x: box.x + Number(await canvas.getAttribute('data-ox')) + x * scale,
      y: box.y + Number(await canvas.getAttribute('data-oy')) - y * scale,
    };
  };
  const drag = async (x: number, y: number, tx: number, ty: number) => {
    const a = await at(x, y);
    const b = await at(tx, ty);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  await drag(5, 5, 6.2, 5.2);
  await expect.poll(async () => (await read()).intents[0]?.fixtures[0]?.center).toEqual({ x: 7, y: 5 });
  await expect(page.getByTestId('snap-grid')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('snap-grid').click();
  await drag(7, 5, 6.2, 5.2);
  await expect.poll(async () => Math.round(((await read()).intents[0]?.fixtures[0]?.center.x ?? 0) * 10)).toBe(62);
  await canvas.focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await read()).intents[0]?.fixtures.length).toBe(0);
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', '2');
});

test('canvas workspace: dense room, primary action and products fit without page scroll', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /110 Cafeteria Cafeteria/ }).click();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await expect(page.getByTestId('solving')).toHaveCount(0);
  await expect(page.getByTestId('zone-row').first()).toContainText(/\b[1-9]\d* fixtures/);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const calculate = (await page.getByTestId('calculate').boundingBox())!;
  expect(calculate.y + calculate.height).toBeLessThanOrEqual(900);
  await expect(page.getByTestId('manage-products')).toBeVisible();
  await page.screenshot({ path: fileURLToPath(new URL('../../docs/screenshots/ux-room.png', import.meta.url)) });
  // header: 3D alone hides the plan; Calculate opens the results under the plan
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByTestId('calculate').click();
  await expect(page.getByTestId('ledger')).toBeVisible();
  await expect(page.getByTestId('calculate')).toHaveText('Recalculate', { timeout: 30_000 });
});
