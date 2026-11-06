import { expect, type Page } from '@playwright/test';

/** Opens the zone card's "More settings" (it stays open for the rest of the page session). */
export async function openMore(page: Page): Promise<void> {
  const editor = page.getByTestId('intent-editor');
  if (await editor.isVisible()) return;
  await page.getByTestId('intent').getByText('More settings').click();
  await expect(editor).toBeVisible();
}
