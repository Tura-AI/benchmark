import { expect, test } from '@playwright/test'

test('storefront filtering, preview, cart, and analytics flows work', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make something remarkable.' })).toBeVisible()
  await expect(page.getByTestId('prompt-card')).toHaveCount(22)
  await page.getByRole('button', { name: 'Midjourney' }).click()
  await expect(page.getByTestId('prompt-card')).toHaveCount(6)

  await page.locator('.search-toggle').click()
  await page.getByLabel('Search prompts').last().fill('warrior')
  await expect(page.getByTestId('prompt-card')).toHaveCount(1)
  await page.locator('.card-hit').click()
  await expect(page.getByRole('dialog')).toContainText('Ink Wash Warrior')
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByRole('status')).toContainText('Added')

  await page.goto('/cart')
  await expect(page.getByRole('heading', { name: /Cart/ })).toBeVisible()
  await expect(page.locator('.order-summary')).toContainText('Order summary')
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'The numbers, clearly.' })).toBeVisible()
  await expect(page.locator('.metric-grid')).toContainText('Gross revenue')
})

test('mobile drawer and dock remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.dock')).toBeVisible()
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/open/)
  await page.getByRole('button', { name: 'Favorites' }).first().click()
  await expect(page.getByRole('heading', { name: 'Your saved prompts' })).toBeVisible()
  await expect(page.getByTestId('prompt-card')).toHaveCount(2)
})
