import { expect, test } from '@playwright/test'

test('storefront, detail, cart, analytics, and mobile drawer smoke', async ({ page, isMobile }) => {
  await page.goto('/')
  await expect(page.getByText('POWERPROMPT gallery')).toBeVisible()
  await page.getByRole('button', { name: 'Flux' }).click()
  await expect(page.getByText('Flux Beauty Lookbook System')).toBeVisible()
  await page.getByRole('link', { name: 'Detail' }).first().click()
  await expect(page.getByRole('button', { name: /Add to Cart|Get free/ })).toBeVisible()
  await page.getByRole('button', { name: /Add to Cart|Get free/ }).click()
  await page.getByRole('link', { name: 'Cart' }).first().click()
  await expect(page.getByText('Marketplace fee')).toBeVisible()
  const analyticsLink = isMobile
    ? page.getByLabel('Quick actions').getByRole('link', { name: 'Creator analytics' })
    : page.getByRole('link', { name: 'Creator analytics' })
  await analyticsLink.click()
  await expect(page.getByText('Marketplace performance')).toBeVisible()
  if (isMobile) {
    await page.goto('/')
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByLabel('POWERPROMPT navigation')).toBeVisible()
  }
})
