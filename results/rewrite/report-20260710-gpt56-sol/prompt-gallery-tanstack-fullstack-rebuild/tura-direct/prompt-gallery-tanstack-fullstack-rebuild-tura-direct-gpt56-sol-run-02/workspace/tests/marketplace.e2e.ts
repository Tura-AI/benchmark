import { expect, test } from '@playwright/test'

async function openHydrated(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 20_000 })
}

test('browse, preview, favorite, and cart flow',async({page})=>{await openHydrated(page);await expect(page.getByRole('heading',{name:'Prompts worth keeping.'})).toBeVisible();await expect(page.getByTestId('prompt-card')).toHaveCount(22);await page.getByRole('button',{name:/Quick view/}).first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close preview'}).click();await page.getByRole('button',{name:/Save to favorites/}).first().click();await expect(page.getByRole('status')).toContainText('Favorites');await page.getByRole('button',{name:/Add .* to cart/}).first().click();await page.getByRole('link',{name:/Cart/}).first().click();await expect(page.getByRole('heading',{name:'Cart'})).toBeVisible()})
test('filters and opens analytics',async({page})=>{await openHydrated(page);await page.getByRole('button',{name:'Claude'}).click();await expect(page.getByTestId('prompt-card')).toHaveCount(5);await page.goto('/analytics');await expect(page.getByRole('heading',{name:'Marketplace analytics'})).toBeVisible();await expect(page.getByText('Gross revenue')).toBeVisible()})
