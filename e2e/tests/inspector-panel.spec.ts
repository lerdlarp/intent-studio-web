import { openMore } from './zone';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createFixture, createIntent, createRoom, type RoomDesign } from '../../packages/core/src/index';

test.use({ viewport: { width: 1440, height: 900 } });
const rect = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];
async function open(request: APIRequestContext, page: Page, name: string) {
  const project = await (await request.post('/api/projects', { data: { name } })).json();
  const room = createRoom({ label: 'Review room', floor: [rect] });
  const added = await (
    await request.post(`/api/projects/${project.id}/rooms`, { data: { room, sourceAssetId: null } })
  ).json();
  const intents = ['No target zone', 'High minimum zone'].map((label, index) =>
    createIntent({
      id: `panel-${index}`,
      label,
      kind: 'Ambient',
      region: rect,
      handTuned: true,
      target: index ? { minimum: 80, average: 90, maximum: 150 } : { minimum: null, average: null, maximum: null },
      fixtures: [createFixture({ intentId: `panel-${index}`, center: { x: 5, y: 5 }, height: 9, mount: 'ceiling' })],
    }),
  );
  expect(
    (await request.put(`/api/rooms/${added.id}/design`, { data: { revision: 0, intents, removedExisting: [] } })).ok(),
  ).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: /^Review room/ }).click();
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-zone-count', '2');
  return async (): Promise<RoomDesign> => (await request.get(`/api/rooms/${added.id}/design`)).json();
}

test('panel keeps navigation visible, hides secondary controls and returns to the overview', async ({
  page,
  request,
}) => {
  await open(request, page, 'Panel navigation');
  await expect(page.getByTestId('zone-row')).toHaveCount(2);
  await page.screenshot({ path: fileURLToPath(new URL('../../docs/screenshots/panel-overview.png', import.meta.url)) });
  await page.getByRole('button', { name: /^No target zone/ }).click();
  await expect(page.getByTestId('intent')).toHaveCount(1);
  await expect(page.getByLabel('Zone to edit')).toBeVisible();
  await expect(page.getByTestId('manage-products')).toBeVisible();
  await expect(page.getByTestId('product-preview')).toBeVisible();
  await expect(page.getByTestId('target-minimum')).not.toBeVisible();
  await expect(page.getByTestId('behavior-mountingHeight')).not.toBeVisible();
  await expect(page.getByTestId('plane-kind')).not.toBeVisible();
  await expect(page.getByTestId('intent').getByTestId('estimate')).toContainText('No target set');
  await expect(page.getByTestId('intent').getByTestId('estimate')).not.toContainText('Meets target');
  await expect(page.getByTestId('behavior-quantity')).not.toBeVisible();
  const card = (await page.getByTestId('intent').boundingBox())!;
  expect(card.y + card.height).toBeLessThan(900);
  await page.getByTestId('product').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('product')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('product')).not.toHaveValue('');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('product')).toHaveValue('');
  await page.getByTestId('manage-products').click();
  await expect(page.getByRole('dialog', { name: 'Project products' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('manage-products')).toBeFocused();
  await page.getByTestId('manage-products').blur();
  await expect(page.getByTestId('solving')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.screenshot({ path: fileURLToPath(new URL('../../docs/screenshots/panel-selected.png', import.meta.url)) });
  await page.getByLabel('Zone to edit').selectOption('panel-1');
  await openMore(page);
  await expect(page.getByTestId('intent-label')).toHaveValue('High minimum zone');
  await expect(page.getByTestId('intent').getByTestId('estimate')).toContainText('Below minimum');
  await page.getByTestId('all-zones').click();
  await expect(page.getByTestId('intent')).toHaveCount(0);
  await expect(page.getByTestId('zone-row')).toHaveCount(2);
});

test('rename and target edits survive switching zones; invalid limits remain rejected', async ({ page, request }) => {
  const read = await open(request, page, 'Panel editing');
  await page.getByRole('button', { name: /^No target zone/ }).click();
  await openMore(page);
  const name = page.getByTestId('intent-label');
  await name.fill('Edited lighting');
  await name.press('Enter');
  await expect(page.getByLabel('Zone to edit').locator('option:checked')).toHaveText('Edited lighting');
  await page.getByTestId('target-average').fill('30');
  await page.getByTestId('target-average').press('Enter');
  await page.getByTestId('target-bounds').locator('summary').click();
  await page.getByTestId('target-minimum').fill('40');
  await page.getByTestId('target-minimum').press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: /Keep min/ })).toBeVisible();
  await page.getByTestId('target-minimum').press('Escape');
  await page.getByLabel('Zone to edit').selectOption('panel-1');
  await page.getByLabel('Zone to edit').selectOption('panel-0');
  await expect(page.getByTestId('intent-label')).toHaveValue('Edited lighting');
  await expect(page.getByTestId('target-average')).toHaveValue('30');
  await expect
    .poll(async () => {
      const i = (await read()).intents.find((x) => x.id === 'panel-0')!;
      return [i.label, i.target.average, i.target.minimum];
    })
    .toEqual(['Edited lighting', 30, null]);
});
