import { expect, test } from '@playwright/test'

test('capture storefront and preview',async({page},testInfo)=>{await page.goto('/');await expect(page.locator('[data-hydrated="true"]')).toBeAttached({timeout:20_000});await expect(page.getByRole('heading',{name:'Prompts worth keeping.'})).toBeVisible();await page.screenshot({path:testInfo.outputPath('storefront.png'),fullPage:true});await page.getByRole('button',{name:/Quick view/}).first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.screenshot({path:testInfo.outputPath('preview.png'),fullPage:true})})
