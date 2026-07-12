import { expect, test } from '@playwright/test'

test('storefront search, preview, cart, and admin flows work', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('POWERPROMPT').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /GPT-4o/i })).toBeVisible()
  await page.waitForLoadState('networkidle')

  if ((page.viewportSize()?.width ?? 1000) < 960) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByPlaceholder(/Search prompts/i).fill('memo')
  await expect(page.locator('.tile')).toHaveCount(1)

  await page.locator('.tile .media').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /Add|Get it free/i }).click()
  await expect(page.getByRole('status')).toContainText('Added')

  await page.getByLabel('Cart').click()
  await expect(page).toHaveURL(/\/cart/)
  await expect(page.getByText('Prompt checkout')).toBeVisible()

  await page.goto('/admin')
  await expect(page.getByText('Marketplace pulse')).toBeVisible()
  await expect(page.getByText('Creator revenue')).toBeVisible()
})
