import { expect, type Page } from '@playwright/test';

export type SettingsTab = 'Target' | 'Layout' | 'Plane' | 'Details';
export type Step = 'room' | 'intent' | 'zones' | 'luminaires' | 'check';

/** Goes to a step with the stepper in the header. Leaving Intent forward applies the room intent (once). */
export async function goStep(page: Page, step: Step): Promise<void> {
  await page.getByTestId(`step-${step}`).click();
  await expect(page.getByTestId(`step-${step}`)).toHaveAttribute('aria-current', 'step');
}

/** Opens the Zones step (applying the room intent if it is not applied yet). */
export const toZones = (page: Page): Promise<void> => goStep(page, 'zones');

/** Opens a zone's sentence card from the zone list on the Zones step. */
export async function openZone(page: Page, label: string | RegExp): Promise<void> {
  const name = typeof label === 'string' ? new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : label;
  const row = page.getByTestId('zone-row').getByRole('button', { name }).first();
  if ((await row.getAttribute('aria-current')) !== 'true') await row.click();
  await expect(page.getByTestId('intent')).toBeVisible();
}

/** Unfolds the zone's settings under it (name, target, luminaire, layout; plane and solver notes folded). `tab` names
 * the part a test is after, from when settings had tabs; 'Plane' also unfolds the measuring plane. */
export async function openMore(page: Page, tab: SettingsTab = 'Target'): Promise<void> {
  const card = page.getByTestId('intent');
  const editor = page.getByTestId('intent-editor');
  if (!(await editor.isVisible())) await card.getByTestId('more-settings').click();
  await expect(editor).toBeVisible();
  const plane = editor.getByTestId('plane-settings');
  if (tab === 'Plane' && (await plane.getAttribute('open')) === null) await plane.locator('summary').click();
}

/** Runs the full calculation from the Check step and waits for it to finish. */
export async function calculate(page: Page): Promise<void> {
  await goStep(page, 'check');
  const run = page.getByTestId('calc-run');
  await run.click();
  await expect(page.getByTestId('result-label')).toContainText('Full calculation', { timeout: 30_000 });
}
