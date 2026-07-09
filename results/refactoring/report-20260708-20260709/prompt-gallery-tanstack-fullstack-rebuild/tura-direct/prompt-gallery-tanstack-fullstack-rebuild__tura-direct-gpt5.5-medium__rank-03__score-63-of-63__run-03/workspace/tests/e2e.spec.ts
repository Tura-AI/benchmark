import { expect, test } from '@playwright/test'

test('storefront, detail, cart, and analytics flows render', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('POWERPROMPT').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'GPT-4o' })).toBeVisible()
  await page.getByRole('button', { name: 'Flux' }).click()
  await expect(page.getByText('Flux Bottle Shadow Lab')).toBeVisible()
  await page.getByRole('link', { name: /Flux Bottle Shadow Lab/ }).click()
  await expect(page.getByRole('heading', { name: 'Flux Bottle Shadow Lab' })).toBeVisible()
  await page.getByRole('button', { name: /Add to Cart/ }).click()
  await page.getByRole('link', { name: 'Cart' }).last().click()
  await expect(page.getByText('Marketplace fee', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Stats' }).click()
  await expect(page.getByText('Creator Analytics')).toBeVisible()
  await expect(page.getByText('Conversion rate')).toBeVisible()
})
