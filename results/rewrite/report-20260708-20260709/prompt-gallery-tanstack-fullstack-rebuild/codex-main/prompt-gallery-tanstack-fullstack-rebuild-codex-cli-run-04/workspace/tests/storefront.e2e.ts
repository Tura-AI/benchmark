import { expect, test } from '@playwright/test'

test('storefront, detail, cart, and admin flows render', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('link', { name: 'POWERPROMPT Gallery' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'GPT-4o', exact: true })).toBeVisible()
  await expect(page.locator('.tile').first()).toBeVisible()

  await page.getByRole('link', { name: 'GPT-4o', exact: true }).click()
  await expect(page.locator('.tile')).toHaveCount(await page.locator('.tile').count())
  await page.locator('.tile').first().click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /Add to cart|Get it free/ }).click()
  await expect(page.getByRole('status')).toContainText('Added')

  await page.getByLabel('Cart').click()
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible()
  await expect(page.getByText('Marketplace fee')).toBeVisible()

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Creator analytics' })).toBeVisible()
  await expect(page.getByText('Conversion', { exact: true })).toBeVisible()
})
