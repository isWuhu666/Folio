import {test,expect} from '@playwright/test';
test('example, editing, theme controls and HTML download',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'导出 HTML',exact:true})).toBeEnabled();
 await expect(page.frameLocator('#preview').locator('h1')).toContainText('二阶系统');
 await page.getByRole('button',{name:'学术论文',exact:true}).click();
 await expect(page.frameLocator('#preview').locator('body')).toHaveClass('theme-academic');
 await page.locator('#editor').fill('# 我的文档\n\n公式 $E=mc^2$\n\n|A|B|\n|-|-|\n|1|2|');
 await expect(page.frameLocator('#preview').locator('h1')).toHaveText('我的文档');
 await expect(page.frameLocator('#preview').locator('.math-slot')).toHaveCount(1);
 expect(await page.frameLocator('#preview').locator('.math-slot svg').count()).toBeGreaterThan(0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 HTML',exact:true}).click();
 expect((await download).suggestedFilename()).toMatch(/\.html$/);
});
test('latest input wins and failed PDF can be replaced',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 旧结果\n\n$$x^2$$');
 await page.locator('#editor').fill('# 最新结果');
 await expect(page.frameLocator('#preview').locator('h1')).toHaveText('最新结果');
 await page.locator('#file-input').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});
 await expect(page.locator('#status')).toContainText('PDF');
 await page.getByRole('button',{name:'打开示例',exact:true}).click();
 await expect(page.frameLocator('#preview').locator('h1')).toContainText('二阶系统');
 await expect(page.locator('#export')).toBeEnabled();
});
test('narrow viewport stays within viewport and allows preview tab',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.locator('#export')).toBeEnabled();
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await expect(page.locator('#preview')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
