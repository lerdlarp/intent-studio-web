import { expect, test } from '@playwright/test';
import { EMPTY_UUID, office, seed } from '../../packages/core/src/index';

// Phase 4: "Suggest a design" with no API key → the rule suggestions (core seed), labelled "Rules", the offline
// banner (dismissable, back on the next issue); accepted intents are kept and not suggested again; an accepted
// intent shows its suggested CCT.
test('Suggest a design offline shows rule suggestions with the Rules source', async ({ page, request }) => {
  const p = await (await request.post('/api/projects', { data: { name: 'Suggest offline' } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, { data: { room: { ...office(), id: EMPTY_UUID }, sourceAssetId: null } });
  expect(r.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: /Suggest offline/ }).click();
  await page.getByRole('button', { name: /204 Open office/ }).click();
  const suggestions = page.getByTestId('suggestion');
  const total = seed(office()).length;
  await expect(suggestions).toHaveCount(total);
  await expect(page.getByTestId('suggestion-source')).toHaveText('Rules');

  // accept the first, dismiss the second
  const first = seed(office())[0]!.label;
  await page.getByRole('button', { name: `Accept ${first}` }).click();
  await page.getByRole('button', { name: `Dismiss ${seed(office())[1]!.label}` }).click();
  await expect(suggestions).toHaveCount(total - 2);
  await expect(page.getByTestId('ai-issue')).toContainText('The agent is offline — using rules');
  await page.getByRole('button', { name: 'Dismiss agent notice' }).click();
  await expect(page.getByTestId('ai-issue')).toHaveCount(0);

  await page.getByTestId('suggest-design').click();
  // the dismissed one is back, the accepted one is not suggested again
  await expect(suggestions).toHaveCount(total - 1);
  await expect(page.getByTestId('suggestion-source')).toHaveText('Rules');
  await expect(page.getByTestId('ai-issue')).toContainText('The agent is offline — using rules');
  await expect(page.getByTestId('ai-issue')).toHaveAttribute('data-kind', 'offline');
  await expect(page.getByTestId('intent')).toHaveCount(1);

  // the accepted intent carries a suggested CCT the designer can override
  await page.getByRole('button', { name: new RegExp(`^${first}`) }).click();
  const cct = page.getByTestId('behavior-cct');
  await expect(cct).not.toHaveValue('');
  await expect(page.getByTestId('cct-origin')).toHaveText('suggested');
  await cct.selectOption('2700');
  await expect(page.getByTestId('cct-origin')).toHaveText('set by you');
});
