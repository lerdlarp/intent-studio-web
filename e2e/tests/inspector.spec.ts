import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMPTY_UUID, office } from '../../packages/core/src/index';

// Phase 3 inspector: select an intent (selection shared with the plan), edit its target (the estimate and status
// follow; the edit survives later advice), switch its product to another generic lumen package (the re-solve changes
// the fixture count), reset the target to the suggestion, and the unit toggle converts the inspector's inputs.
// Each test works in its own project holding a copy of the Office demo room.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const SCREENSHOT = fileURLToPath(new URL('../../docs/screenshots/phase3-inspector.png', import.meta.url));

interface Intent {
  id: string;
  kind: string;
  label: string;
  targetEdited: boolean;
  target: { minimum: number | null; average: number | null; maximum: number | null };
  product: { product: { label: string; lumens: number }; agentPicked: boolean } | null;
  isSuggestion: boolean;
  fixtures: unknown[];
}
interface Design {
  revision: number;
  intents: Intent[];
}

async function officeProject(request: APIRequestContext, name: string): Promise<string> {
  const p = await (await request.post('/api/projects', { data: { name } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, { data: { room: { ...office(), id: EMPTY_UUID }, sourceAssetId: null } });
  expect(r.ok()).toBe(true);
  return (await r.json()).id;
}
const design = async (request: APIRequestContext, roomId: string): Promise<Design> =>
  (await request.get(`/api/rooms/${roomId}/design`)).json();
const intentNamed = async (request: APIRequestContext, roomId: string, label: string): Promise<Intent | undefined> =>
  (await design(request, roomId)).intents.find((i) => i.label === label);

async function openAccepted(page: Page, project: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(project) }).click();
  await page.getByRole('button', { name: /204 Open office/ }).click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect(page.getByTestId('suggestion')).toHaveCount(0);
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
}

const row = (page: Page, label: string) => page.getByTestId('intent').filter({ has: page.getByRole('button', { name: new RegExp(`^${label}`) }) });
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

test('select, edit the target, survive advice, reset; product switch re-solves; units convert', async ({ page, request }) => {
  const roomId = await officeProject(request, 'Inspector edit');
  await openAccepted(page, 'Inspector edit');
  const label = 'Desk cluster A task';

  // select in the inspector → the plan's selection follows, the editor expands
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  const editor = page.getByTestId('intent-editor');
  await expect(editor).toHaveCount(1);
  await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Selected intent').locator('option:checked')).toHaveText(label);
  await expect(editor.getByText('suggested').first()).toBeVisible();

  const avg = editor.getByTestId('target-average');
  const min = editor.getByTestId('target-minimum');
  const max = editor.getByTestId('target-maximum');
  const suggested = [await min.inputValue(), await avg.inputValue(), await max.inputValue()];
  expect(suggested.every((v) => /^\d+(\.\d)?$/.test(v) || v === '')).toBe(true);
  const estimate = row(page, label).getByTestId('estimate');
  await expect(estimate).toContainText(/fc · U/);
  const before = await estimate.textContent();

  // edit avg (and min) upward: re-solve, the estimate moves, the status glyph reflects the new target
  await avg.fill('45');
  await avg.press('Enter');
  await min.fill('40');
  await min.press('Enter');
  await expect(row(page, label)).toContainText('min 40 · avg 45');
  await expect(estimate).not.toHaveText(before!);
  await expect(estimate.getByTestId('status-glyph')).toHaveAttribute('data-status', /^(Meets|Under|Over)$/);
  await expect(editor.getByRole('button', { name: 'Reset to suggested' })).toBeVisible();
  await saved(page);
  await expect.poll(async () => (await intentNamed(request, roomId, label))?.targetEdited).toBe(true);

  // advice runs again (another intent's target goes back to its suggestion, which asks the agent): the edit stays
  const other = 'Desk cluster B task';
  await page.getByRole('button', { name: new RegExp(`^${other}`) }).click();
  const otherAvg = page.getByTestId('intent-editor').getByTestId('target-average');
  await otherAvg.fill('33');
  await otherAvg.press('Enter');
  await page.getByTestId('intent-editor').getByRole('button', { name: 'Reset to suggested' }).click();
  await expect(page.getByText('asking the agent')).toHaveCount(0);
  await saved(page);
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await expect(editor.getByTestId('target-average')).toHaveValue('45');
  await expect(editor.getByTestId('target-minimum')).toHaveValue('40');
  const kept = await intentNamed(request, roomId, label);
  expect([kept!.target.minimum, kept!.target.average, kept!.targetEdited]).toEqual([40, 45, true]);

  // reset restores the suggested range
  await editor.getByRole('button', { name: 'Reset to suggested' }).click();
  await expect(editor.getByTestId('target-minimum')).toHaveValue(suggested[0]!);
  await expect(editor.getByTestId('target-average')).toHaveValue(suggested[1]!);
  await expect(editor.getByTestId('target-maximum')).toHaveValue(suggested[2]!);
  await expect(editor.getByRole('button', { name: 'Reset to suggested' })).toHaveCount(0);
  await saved(page);
  await expect.poll(async () => (await intentNamed(request, roomId, label))?.targetEdited).toBe(false);

  // unit toggle converts the inspector inputs (display only)
  const height = editor.getByTestId('plane-height');
  await expect(height).toHaveValue('2′-6″');
  const avgFc = Number(suggested[1]);
  await page.getByText('m · lx').click();
  await expect(editor.getByTestId('target-average')).toHaveValue(String(Math.round(avgFc * 10.7639)));
  await expect(height).toHaveValue('0.76');
  await expect(editor.getByRole('button', { name: /^Desk 0\.76 m/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('ft · fc').click();
  await expect(editor.getByTestId('target-average')).toHaveValue(suggested[1]!);
  await expect(height).toHaveValue('2′-6″');
});

test('switching to another generic lumen package changes the fixture count; Automatic gives it back', async ({ page, request }) => {
  const roomId = await officeProject(request, 'Inspector product');
  await openAccepted(page, 'Inspector product');
  // the Office ambient sits at its fewest fixtures with every volumetric package; the accent's count does follow lumens
  const label = 'Brand wall accent';
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  const editor = page.getByTestId('intent-editor');
  const product = editor.getByTestId('product');
  await expect(product.locator('optgroup[label="Generic"]')).toHaveCount(1);
  await expect(product.locator('optgroup[label="Project products"]')).toHaveCount(1);
  await expect(product.locator('option:checked')).toHaveText(/^Automatic · /);
  await expect(editor.getByTestId('product-reason')).not.toBeEmpty();

  await expect.poll(async () => (await intentNamed(request, roomId, label))?.fixtures.length ?? 0).toBeGreaterThan(0);
  const start = (await intentNamed(request, roomId, label))!;
  const count0 = start.fixtures.length;
  expect(count0).toBeGreaterThan(0);
  const auto = (await product.locator('option:checked').textContent())!;
  const lumensOf = (t: string) => Number(/([\d,]+) lm/.exec(t)?.[1]?.replace(',', '') ?? NaN);
  const autoLm = lumensOf(auto);
  // the lowest-output package of the same generic family (fewer lumens → more fixtures)
  const generic = await product.locator('optgroup[label="Generic"] option').evaluateAll((os) =>
    os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? '' })),
  );
  const same = generic.filter((g) => g.text.split(' · ')[0] === auto.replace(/^Automatic · /, '').split(' · ')[0]);
  const pick = same.sort((a, b) => lumensOf(a.text) - lumensOf(b.text))[0]!;
  expect(lumensOf(pick.text)).not.toBe(autoLm);

  await product.selectOption(pick.value);
  await expect(editor.getByTestId('product-reason')).toContainText('Your choice');
  await saved(page);
  await expect.poll(async () => (await intentNamed(request, roomId, label))?.product?.agentPicked).toBe(false);
  const chosen = (await intentNamed(request, roomId, label))!;
  expect(chosen.product!.product.lumens).toBe(lumensOf(pick.text));
  expect(chosen.fixtures.length).toBeGreaterThan(count0);
  await expect(page.getByTestId('intent').filter({ hasText: label })).toContainText(`${chosen.fixtures.length} fixture`);

  await product.selectOption('');
  await saved(page);
  await expect.poll(async () => (await intentNamed(request, roomId, label))?.product?.agentPicked ?? null).not.toBe(false);
  await expect.poll(async () => (await intentNamed(request, roomId, label))?.fixtures.length).toBe(count0);
});

test('screenshot: Office with an intent selected and the inspector expanded; 3D focus follows the selection', async ({ page, request }) => {
  await officeProject(request, 'Inspector shot');
  await openAccepted(page, 'Inspector shot');
  const label = 'Open office ambient';
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await expect(page.getByTestId('intent-editor')).toBeVisible();
  await page.getByTestId('intent-editor').locator('summary').click(); // open the trace
  await page.getByRole('button', { name: 'Heatmap' }).click();
  await page.getByRole('button', { name: 'Dismiss agent notice' }).click();

  await page.getByRole('button', { name: 'Show 3D' }).click();
  await expect(page.getByRole('button', { name: `Focus on ${label}` })).toBeEnabled();
  await page.getByLabel('Selected intent').selectOption({ label: 'Nothing' });
  await expect(page.getByRole('button', { name: /^Focus on the selected intent/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Hide 3D' }).click();

  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await expect(page.getByTestId('intent-editor')).toBeVisible();
  await page.getByTestId('intent-editor').locator('summary').click();
  // show the expanded row from its top (opening the trace may have scrolled the inspector)
  await page.getByTestId('intent').filter({ has: page.getByTestId('intent-editor') }).evaluate((row) => {
    const panel = row.closest('.inspector') as HTMLElement;
    panel.scrollTop = (row as HTMLElement).offsetTop - panel.offsetTop - 8;
  });
  await page.mouse.move(0, 0);
  mkdirSync(fileURLToPath(new URL('../../docs/screenshots/', import.meta.url)), { recursive: true });
  await page.screenshot({ path: SCREENSHOT, fullPage: false });
});
