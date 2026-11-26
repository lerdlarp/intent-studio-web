import { expect, test } from '@playwright/test';
import { toZones } from './zone';

// Phase 2C smoke: open a demo room on its room intent, go to Zones (the intent is applied), accept the rest,
// every zone shows an estimate.
// SCREENSHOT=<path> also saves a 1440×900 @2x screenshot after accept-all.
if (process.env.SCREENSHOT) test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

test('open the Office demo room, accept all, estimates are shown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /204 Open office/ }).click();

  // the room opens on its intent: the hard-coded demo brief
  await expect(page.getByTestId('intent-step')).toBeVisible();
  await expect(page.getByTestId('brief-note')).toContainText('Demo intent');
  await toZones(page);

  // the demo intent accepted the base and 6 zones; one suggestion is left
  const intents = page.getByTestId('zone-row');
  await expect(intents).toHaveCount(7);
  const suggestions = page.getByTestId('suggestion');
  await expect(suggestions).toHaveCount(1);
  await page.getByRole('button', { name: /^Accept / }).click();
  await expect(suggestions).toHaveCount(0);
  const count = 8;
  await expect(intents).toHaveCount(count);
  const estimates = page.getByTestId('estimate');
  for (let k = 0; k < count; k++) {
    await expect(estimates.nth(k)).toContainText('estimate');
    await expect(estimates.nth(k)).toContainText(/\d[\d,.]* fc avg · estimate/);
  }
  await expect(page.getByTestId('room-power')).toContainText(/W\/ft²/);
  // no API key in e2e: the rules fallback is reported
  await expect(page.getByTestId('ai-issue')).toContainText('The agent is offline — using rules');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // unit toggle changes display only
  await page.getByText('m · lx').click();
  await expect(estimates.first()).toContainText(' lx avg · estimate');
  await page.getByText('ft · fc').click();

  if (process.env.SCREENSHOT) {
    await page.getByRole('button', { name: 'Dismiss agent notice' }).focus();
    await page.locator(':focus').blur();
    await page.screenshot({ path: process.env.SCREENSHOT, fullPage: false });
  }
});
