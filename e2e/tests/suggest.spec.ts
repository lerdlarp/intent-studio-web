import { openMore, openZone, toZones } from './zone';
import { expect, test } from '@playwright/test';
import { EMPTY_UUID, office, seed } from '../../packages/core/src/index';

// Phase 4: "Suggest more" with no API key → the rule suggestions (core seed), labelled "Rules", the offline
// banner (dismissable, back on the next issue); accepted intents are kept and not suggested again; an accepted
// intent shows its suggested CCT. A room that is not a demo gets the rules room intent, which accepts the base only.
test('Suggest a design offline shows rule suggestions with the Rules source', async ({ page, request }) => {
  const p = await (await request.post('/api/projects', { data: { name: 'Suggest offline' } })).json();
  const r = await request.post(`/api/projects/${p.id}/rooms`, { data: { room: { ...office(), id: EMPTY_UUID }, sourceAssetId: null } });
  expect(r.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: /Suggest offline/ }).click();
  await page.getByRole('button', { name: /204 Open office/ }).click();
  await expect(page.getByTestId('brief-note')).toContainText('From the room type');
  await toZones(page);
  const suggestions = page.getByTestId('suggestion');
  const seeds = seed(office());
  const total = seeds.length;
  await expect(page.getByTestId('zone-row')).toHaveCount(1); // the base light
  await expect(suggestions).toHaveCount(total - 1);
  await expect(page.getByTestId('suggestion-source')).toHaveText('Rules');

  // accept the first zone suggestion, dismiss the second
  const first = seeds[1]!.label;
  await page.getByRole('button', { name: `Add ${first}` }).click();
  await page.getByRole('button', { name: `Skip ${seeds[2]!.label}` }).click();
  await expect(suggestions).toHaveCount(total - 3);
  await expect(page.getByTestId('ai-issue')).toContainText('The agent is offline — using rules');
  await page.getByRole('button', { name: 'Dismiss agent notice' }).click();
  await expect(page.getByTestId('ai-issue')).toHaveCount(0);

  await page.getByTestId('suggest-design').click();
  // the dismissed one is back, the accepted one is not suggested again
  await expect(suggestions).toHaveCount(total - 2);
  await expect(page.getByTestId('suggestion-source')).toHaveText('Rules');
  await expect(page.getByTestId('ai-issue')).toContainText('The agent is offline — using rules');
  await expect(page.getByTestId('ai-issue')).toHaveAttribute('data-kind', 'offline');
  await expect(page.getByTestId('zone-row')).toHaveCount(2);

  // the accepted intent carries a suggested CCT the designer can override
  await openZone(page, first);
  await openMore(page, 'Details');
  const cct = page.getByTestId('behavior-cct');
  await expect(cct).not.toHaveValue('');
  await expect(page.getByTestId('cct-origin')).toHaveText('suggested');
  await cct.selectOption('2700');
  await expect(page.getByTestId('cct-origin')).toHaveText('set by you');
});
