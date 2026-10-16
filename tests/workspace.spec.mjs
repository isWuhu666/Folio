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
test('a slow old file cannot overwrite a newer import',async({page})=>{
 await page.addInitScript(()=>{
  const original=File.prototype.text;
  File.prototype.text=async function(){const text=await original.call(this);if(this.name==='slow.md'){window.slowWaiting=true;await new Promise(r=>window.releaseSlow=r);window.slowFinished=true;}return text;};
 });
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#file-input').setInputFiles({name:'slow.md',mimeType:'text/markdown',buffer:Buffer.from('# 旧文件')});
 await page.waitForFunction(()=>window.slowWaiting);
 await page.locator('#file-input').setInputFiles({name:'new.md',mimeType:'text/markdown',buffer:Buffer.from('# 最新文件')});
 await expect(page.frameLocator('#preview').locator('h1')).toHaveText('最新文件');
 await page.evaluate(()=>window.releaseSlow());await page.waitForFunction(()=>window.slowFinished);
 await expect(page.locator('#editor')).toHaveValue('# 最新文件');
});
