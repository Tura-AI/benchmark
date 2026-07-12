import { expect, test } from '@playwright/test'

test('storefront search, detail, cart, and analytics flow works', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Marketplace navigation').getByText('POWERPROMPT')).toBeVisible()
  await expect(page.getByRole('button', { name: 'GPT-4o' })).toBeVisible()

  await page.getByRole('button', { name: 'GPT-4o' }).click()
  await page.getByPlaceholder(/Search prompts/).fill('cover')
  await expect(page.getByText('Magazine Cover Maker')).toBeVisible()

  await page.getByText('Magazine Cover Maker').click()
  await expect(page.getByRole('heading', { name: 'Magazine Cover Maker' })).toBeVisible()
  await page.getByRole('button', { name: /Add to cart/ }).click()

  await page.getByLabel('Cart').click()
  await expect(page.getByRole('heading', { name: /Review your POWERPROMPT stack/ })).toBeVisible()
  await expect(page.getByText('Checkout simulation')).toBeVisible()

  await page.getByLabel('Creator analytics').click()
  await expect(page.getByRole('heading', { name: /Revenue, conversion/ })).toBeVisible()
  await expect(page.getByText('Creator revenue')).toBeVisible()
})

test('mobile drawer and dock are usable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only drawer smoke')
  await page.goto('/')
  await page.getByLabel('Open menu').click()
  await expect(page.getByLabel('Marketplace navigation')).toBeVisible()
  await page.getByLabel('Favorites', { exact: true }).click()
  await expect(page.getByText('Favorites').first()).toBeVisible()
})
