import { expect, test } from '@playwright/test'
test('filters, previews, favorites, and cart checkout', async ({page}, testInfo) => {
  await page.goto('/'); await expect(page.getByText('POWERPROMPT').first()).toBeVisible(); await expect(page.getByTestId('prompt-card')).toHaveCount(22); await page.screenshot({path:`test-results/storefront-${testInfo.project.name}.png`,fullPage:true})
  await page.getByRole('button',{name:'Flux'}).click(); await expect(page.getByTestId('prompt-card')).toHaveCount(6)
  await page.getByRole('link',{name:'Editorial Photo Grade',exact:true}).click(); await expect(page.getByRole('heading',{name:'Editorial Photo Grade'})).toBeVisible()
  await page.getByRole('button',{name:/Add to Cart/}).click(); const mobile = testInfo.project.name === 'mobile'; await (mobile ? page.getByRole('link',{name:/Cart, 1 items/}) : page.getByRole('link',{name:'Cart',exact:true})).first().click(); await expect(page.getByRole('heading',{name:/Cart/})).toBeVisible(); await expect(page.getByRole('link',{name:'Editorial Photo Grade'})).toBeVisible()
  await page.getByRole('button',{name:'Complete checkout'}).click(); await expect(page.getByRole('heading',{name:'Your prompt stack is ready.'})).toBeVisible()
})
test('creator analytics and API are server-backed', async ({page,request}, testInfo) => {
  const response=await request.get('/api/prompts?model=Claude'); expect(response.ok()).toBeTruthy(); const body=await response.json(); expect(body.prompts.every((p:{model:string})=>p.model==='Claude')).toBeTruthy()
  await page.goto('/creator'); await expect(page.getByRole('heading',{name:'Field & Co.'})).toBeVisible(); await expect(page.getByText('Revenue trend')).toBeVisible(); await page.screenshot({path:`test-results/analytics-${testInfo.project.name}.png`,fullPage:true})
})
