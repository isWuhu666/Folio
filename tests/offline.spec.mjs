import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('application uses local resources and exported Markdown is independently readable',async({page})=>{
 const external=[];await page.route('https://**/*',r=>{external.push(r.request().url());return r.abort();});
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const download=page.waitForEvent('download');await page.locator('#export').click();const d=await download;
 await mkdir('artifacts',{recursive:true});const file=path.resolve('artifacts/offline-markdown.html');await d.saveAs(file);
 const html=await readFile(file,'utf8');expect(html).not.toContain('<script');expect(html).not.toContain('src="/');
 await page.route('http://**/*',r=>r.abort());await page.goto(pathToFileURL(file).href);
 await expect(page.locator('h1')).toContainText('二阶系统');expect(await page.locator('.math-slot svg').count()).toBeGreaterThan(5);
 await expect(page.locator('img')).toHaveCount(1);expect(await page.locator('img').evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);
 expect(external).toEqual([]);
});
for(const mode of ['faithful','reading'])test(`PDF ${mode} mode exports offline images`,async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#file-input').setInputFiles('examples/工程笔记.pdf');
 await expect(page.locator('#source-type')).toHaveText('PDF');
 if(mode==='reading'){await page.locator('#pdf-mode').selectOption(mode);}
 await expect(page.locator('#export')).toBeEnabled({timeout:30000});
 expect(await page.frameLocator('#preview').locator('img').count()).toBeGreaterThan(0);
 const download=page.waitForEvent('download');await page.locator('#export').click();const file=path.resolve(`artifacts/offline-${mode}.html`);await (await download).saveAs(file);
 await page.route('http://**/*',r=>r.abort());await page.route('https://**/*',r=>r.abort());await page.goto(pathToFileURL(file).href);
 expect(await page.locator('img').count()).toBeGreaterThan(0);expect(await page.locator('img').first().evaluate(i=>i.naturalWidth)).toBeGreaterThan(0);
});
test('missing browser dependency gives installation recovery instructions',async({page})=>{
 await page.route('**/vendor/markdown-it.min.js',r=>r.abort());await page.goto('/');
 await expect(page.locator('#status')).toContainText('安装.cmd');
});
test('PDF selectable text scales with the actual page width',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#file-input').setInputFiles('examples/simple.pdf');
 await expect(page.locator('#source-type')).toHaveText('PDF');await expect(page.locator('#export')).toBeEnabled();
 const dimensions=await page.frameLocator('#preview').locator('.pdf-text-layer span').first().evaluate(s=>({font:parseFloat(getComputedStyle(s).fontSize),page:s.closest('.pdf-page').getBoundingClientRect().width}));
 expect(Math.abs(dimensions.font-24*dimensions.page/360)).toBeLessThan(1);
});
