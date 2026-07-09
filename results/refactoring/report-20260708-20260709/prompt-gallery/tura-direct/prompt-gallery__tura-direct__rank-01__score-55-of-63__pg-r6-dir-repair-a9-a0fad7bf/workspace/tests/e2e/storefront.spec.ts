import { expect, test } from '@playwright/test';

test('storefront, filters, detail, cart and admin routes render', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('POWERPROMPT')).toBeVisible();
  await expect(page.getByRole('button', { name: 'GPT-4o' })).toBeVisible();
  await page.getByRole('button', { name: 'GPT-4o' }).click();
  await expect(page.getByText('Cart Abandonment Agent')).toBeVisible();
  await page.getByLabel('Search prompts').fill('macro');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Makeup Macro Free Pack')).toBeVisible();
  await page.getByLabel('Open Makeup Macro Free Pack').click();
  await expect(page.getByRole('heading', { name: 'Makeup Macro Free Pack' })).toBeVisible();
  await page.getByRole('link', { name: 'Cart' }).first().click();
  await expect(page.getByRole('heading', { name: 'Checkout simulation' })).toBeVisible();
  await page.getByRole('link', { name: 'Analytics' }).first().click();
  await expect(page.getByText('Creator revenue')).toBeVisible();
});
