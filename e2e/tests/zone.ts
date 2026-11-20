import { expect, type Page } from '@playwright/test';

export type SettingsTab = 'Target' | 'Layout' | 'Plane' | 'Details';

/** Opens the zone card's Settings on `tab` (from the card's main view or another tab). */
export async function openMore(page: Page, tab: SettingsTab = 'Target'): Promise<void> {
  const card = page.getByTestId('intent');
  const editor = page.getByTestId('intent-editor');
  if (!(await editor.isVisible())) await card.getByRole('button', { name: /^Settings/ }).click();
  await editor.getByRole('tab', { name: tab, exact: true }).click();
  await expect(editor.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
}
