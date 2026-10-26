import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('startup uses one application bundle without source-module requests',async({page})=>{
 const modules=[],bundles=[];
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/modules/'))modules.push(url.pathname);if(url.pathname==='/vendor/folio-app.js')bundles.push(url.pathname);});
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 expect(modules).toEqual([]);expect(bundles).toEqual(['/vendor/folio-app.js']);
 await page.locator('#editor').fill('# Bundle math\n\n$$\\frac{a}{b}+\\sqrt{x}$$');
 await expect(page.frameLocator('#preview').locator('svg')).toHaveCount(1);
 await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#open-batch').click();
 await page.locator('#batch-input').setInputFiles([{name:'bundle.md',mimeType:'text/markdown',buffer:Buffer.from('# Bundle batch')}]);
 await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);
 expect(modules).toEqual([]);
});

test('application bundle remains compatible with the no-eval CSP',async()=>{
 const source=await readFile(new URL('../web/vendor/folio-app.js',import.meta.url),'utf8');
 expect(source).not.toMatch(/\beval\s*\(|\bnew\s+Function\s*\(/);
 expect(source).not.toMatch(/(?:from\s*|import\s*\()\s*['"](?:\.\.?\/|\/modules\/)/);
});
