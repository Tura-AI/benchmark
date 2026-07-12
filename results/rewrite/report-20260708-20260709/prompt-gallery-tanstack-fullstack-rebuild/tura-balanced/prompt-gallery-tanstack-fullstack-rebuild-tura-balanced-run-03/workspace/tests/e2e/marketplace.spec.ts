import { expect, test } from '@playwright/test'

test('storefront search, favorites, lightbox, and cart flow works', async ({ page, isMobile }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell[data-hydrated="true"]')).toBeAttached()
  await expect(page.locator(isMobile ? '.mtop' : '.app-shell > .sidebar').getByText('POWERPROMPT')).toBeVisible()
  await expect(page.getByRole('button', { name: /GPT-4o/ })).toBeVisible()

  await page.getByRole('button', { name: /Reveal search/ }).click()
  await page.getByPlaceholder(/Search prompts/).fill('cold email')
  await expect(page.getByText('The Cold-Email Closer')).toBeVisible()

  await page.getByRole('button', { name: 'Open The Cold-Email Closer' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /Add to cart/ }).click()
  await expect(page.getByRole('status')).toContainText('Added')
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: 'Cart' }).last().click()
  await expect(page).toHaveURL(/\/cart/)
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible()
  await expect(page.getByText('Subtotal')).toBeVisible()
})

test('mobile drawer and dock are usable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile drawer is hidden on desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.app-shell[data-hydrated="true"]')).toBeAttached()
  await page.getByRole('button', { name: 'Menu' }).click()
  const drawer = page.locator('.mobile-drawer.open')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: /Favorites/ })).toBeVisible()
  await drawer.getByRole('button', { name: /Favorites/ }).click()
  await expect(page).toHaveURL(/favorites=true/)
  await page.getByRole('link', { name: 'Analytics' }).click()
  await expect(page.getByRole('heading', { name: 'Creator analytics' })).toBeVisible()
})
