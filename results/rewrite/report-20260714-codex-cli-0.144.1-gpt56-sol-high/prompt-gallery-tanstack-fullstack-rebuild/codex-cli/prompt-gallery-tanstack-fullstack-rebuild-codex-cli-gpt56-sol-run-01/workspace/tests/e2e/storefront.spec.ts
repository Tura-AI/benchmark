import { expect, test } from '@playwright/test'

test('storefront filters, previews, favorites, and cart work', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'desktop product-flow smoke')
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Built to get you there/ })).toBeVisible()
  await expect(page.getByTestId('prompt-card')).toHaveCount(22)

  await page.getByRole('button', { name: 'Claude', exact: true }).click()
  await expect(page.getByTestId('prompt-card')).toHaveCount(5)
  await page.getByRole('button', { name: 'Toggle search' }).click()
  await page.getByRole('textbox', { name: 'Search prompts' }).fill('code reviewer')
  await expect(page.getByTestId('prompt-card')).toHaveCount(1)

  await page.getByRole('button', { name: /Preview Senior Code Reviewer/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /Add to Cart/ }).click()
  await expect(page.getByRole('status')).toContainText('Added')
  await page.getByRole('button', { name: 'Close preview' }).click()
  await page.getByRole('link', { name: 'Cart' }).last().click()
  await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible()
  expect(errors).toEqual([])
})

test('responsive navigation exposes the mobile drawer and dock', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only')
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await page.getByRole('link', { name: 'Creator analytics' }).click()
  await expect(page.getByRole('heading', { name: /Marketplace pulse/ })).toBeVisible()
})
