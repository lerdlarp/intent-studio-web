import { expect, test } from '@playwright/test';

// Bearer auth (server API_TOKEN, playwright project "auth" on its own server + web ports): the first API call gets a
// 401 → the "Access token" dialog (focus inside, Esc / Cancel close it); a wrong token is refused and asks again; the
// right one loads the projects and is remembered across a reload.
const TOKEN = 'e2e-secret-token';

test('access token prompt: wrong token re-prompts, right token loads projects', async ({ page, request }) => {
  expect((await request.get('/api/projects')).status()).toBe(401);
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Access token' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByLabel('Token');
  await expect(input).toBeFocused();
  // focus stays inside the dialog
  for (let k = 0; k < 4; k++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

  await input.fill('wrong-token');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('not accepted');
  await expect(dialog.getByLabel('Token')).toHaveValue('');

  await dialog.getByLabel('Token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('No projects yet.')).toBeVisible();
  await page.getByPlaceholder('New project name').fill('Token project');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Rooms in Token project' })).toBeVisible();

  // remembered: a reload goes straight in
  await page.reload();
  await expect(page.getByRole('button', { name: /Token project/ })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('Esc closes the token dialog; the error banner offers Retry', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Access token' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const banner = page.getByTestId('error-banner');
  await expect(banner).toContainText('access token');
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Token').fill(TOKEN);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});
