import { expect, test } from '@playwright/test'

test('storefront search, preview, favorite, cart, detail, and analytics flows work', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('POWERPROMPT').first()).toBeVisible()
  await expect(page.getByTestId('prompt-gallery')).toBeVisible()

  await page.getByRole('button', { name: /GPT-4o/i }).click()
  await expect(page.getByText('The Socratic Tutor')).toBeVisible()
  await page.getByRole('button', { name: 'Reveal search' }).click()
  await page.getByLabel('Search prompts').fill('cold')
  await expect(page.getByText('The Cold-Email Closer')).toBeVisible()

  await page.goto('/?model=GPT-4o&category=all&sort=featured&q=cold&preview=142')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /Add to cart/i }).click()
  await page.getByRole('button', { name: 'Close preview' }).click()

  await page.getByRole('link').filter({ hasText: 'The Cold-Email Closer' }).click()
  await expect(page.getByRole('heading', { name: 'The Cold-Email Closer' })).toBeVisible()

  await page.goto('/cart')
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible()
  await expect(page.getByText('The Cold-Email Closer')).toBeVisible()
  await expect(page.getByText('Marketplace fee')).toBeVisible()

  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Creator analytics' })).toBeVisible()
  await expect(page.getByLabel('Creator revenue')).toBeVisible()
})

test('mobile drawer and dock remain usable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only drawer check')
  await page.goto('/')
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('complementary', { name: 'Marketplace navigation' })).toBeVisible()
  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: 'Creator analytics' })).toBeVisible()
})
