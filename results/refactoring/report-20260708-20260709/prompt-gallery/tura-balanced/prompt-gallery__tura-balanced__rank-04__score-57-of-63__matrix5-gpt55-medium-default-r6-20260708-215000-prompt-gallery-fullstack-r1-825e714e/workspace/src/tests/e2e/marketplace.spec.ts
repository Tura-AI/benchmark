import { expect, test } from '@playwright/test'

test('storefront filters, preview, favorite, and cart flow', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('POWERPROMPT').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'GPT-4o' })).toBeVisible()
  await page.getByRole('button', { name: 'GPT-4o' }).click()
  await expect(page.locator('.tile').first()).toBeVisible()
  await page.getByRole('button', { name: /Preview/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /Add to cart|Get it free/ }).click()
  await expect(page.getByText('Added to Cart')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel(/Save/).first().click()
  await expect(page.getByText(/Saved to favorites|Removed from favorites/)).toBeVisible()
})

test('checkout and analytics routes render backend calculations', async ({ page }) => {
  await page.goto('/cart')
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible()
  await expect(page.getByText(/Total \$/)).toBeVisible()
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Creator analytics' })).toBeVisible()
  await expect(page.getByText(/conversion/i)).toBeVisible()
  await expect(page.getByText('Category revenue')).toBeVisible()
})

test('mobile dock remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.dock')).toBeVisible()
  await page.getByLabel('Cart').click()
  await expect(page).toHaveURL(/\/cart/)
})
