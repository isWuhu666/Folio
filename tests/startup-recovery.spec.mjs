import {test,expect} from '@playwright/test';
test('failed application bundle gives a visible reload path and preserves inert workspace',async({page})=>{
 await page.route('**/vendor/folio-app.js',route=>route.abort());await page.goto('/');await expect(page.locator('#startup-trouble')).toBeVisible();await expect(page.locator('#startup-message')).toContainText('加载失败');await expect(page.locator('#startup-reload')).toHaveAttribute('href','/');await expect(page.locator('.workspace')).toHaveAttribute('inert','');
});
