import {test,expect} from '@playwright/test';

test('empty document has honest state and cannot export',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('  \n');
 await expect(page.locator('#status')).toContainText('添加内容');
 await expect(page.locator('#export')).toBeDisabled();
 await expect(page.locator('#result-meta')).toContainText('空文档');
});

test('draft, resources, name and theme recover explicitly after refresh',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 恢复验收\n\n![图](test.svg)');
 await page.locator('#file-input').setInputFiles({name:'test.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>')});
 await page.locator('#document-name').fill('我的草稿.md');await page.locator('#document-name').press('Tab');
 await page.getByRole('button',{name:'学术论文',exact:true}).click();
 await expect(page.locator('#save-state')).toContainText('已保存');
 await page.reload();await expect(page.locator('#recovery')).toBeVisible();
 await page.locator('#restore-draft').click();
 await expect(page.locator('#editor')).toHaveValue('# 恢复验收\n\n![图](test.svg)');
 await expect(page.locator('#document-name')).toHaveValue('我的草稿.md');
 await expect(page.frameLocator('#preview').locator('body')).toHaveClass('theme-academic');
 await expect(page.frameLocator('#preview').locator('img')).toHaveCount(1);
 await expect(page.locator('#export')).toBeEnabled();
 await page.locator('.privacy-settings summary').click();await page.locator('#clear-draft').click();await page.locator('#confirm-replace').click();
 await expect(page.locator('#save-state')).toContainText('已关闭');
 await page.reload();await expect(page.locator('#recovery')).toBeHidden();
});

test('failed browser storage is reported and manual source backup stays available',async({page})=>{
 await page.addInitScript(()=>{IDBFactory.prototype.open=function(){throw new Error('storage unavailable');};});
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 不能丢失的原文');
 await expect(page.locator('#save-state')).toContainText('失败');
 const download=page.waitForEvent('download');await page.locator('#save-source').click();
 expect((await download).suggestedFilename()).toMatch(/\.md$/);
});

test('mobile import and keyboard view controls are visible and meaningful',async({page})=>{
 await page.setViewportSize({width:320,height:844});await page.goto('/');
 await expect(page.locator('#export')).toBeEnabled();
 await expect(page.locator('#open-document')).toBeVisible();
 const preview=page.getByRole('button',{name:'预览',exact:true});
 await preview.focus();await preview.press('Enter');
 await expect(preview).toHaveAttribute('aria-pressed','true');
 await expect(preview).toHaveAttribute('aria-controls','preview-panel');
 await expect(page.locator('#editor')).toBeHidden();
 await preview.press('ArrowRight');
 await expect(page.getByRole('button',{name:'设置',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('diagnostics select exact formula and repair a missing image',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 定位\n\n缺图 ![设备](missing.svg)\n\n$$\\frac{1}{$$');
 await expect(page.locator('#diagnostics')).toHaveAttribute('open','');
 await page.locator('#diagnostics-list li').filter({hasText:'公式'}).getByRole('button',{name:'定位原文'}).click();
 const selection=await page.locator('#editor').evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd));
 expect(selection).toContain('\\frac{1}{');
 await page.locator('#diagnostics-list li').filter({hasText:'missing.svg'}).getByRole('button',{name:'选择图片修复'}).click();
 await page.locator('#repair-input').setInputFiles({name:'replacement.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>')});
 await expect(page.frameLocator('#preview').locator('img')).toHaveCount(1);
 await expect(page.locator('#diagnostics-list')).not.toContainText('图片尚未找到');
 await expect(page.locator('#diagnostics-list')).toContainText('公式');
});

test('new document and example replacement protect modified work',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 保留当前成果');
 await page.locator('#example').click();await expect(page.locator('#replace-dialog')).toBeVisible();
 await page.locator('#cancel-replace').click();await expect(page.locator('#editor')).toHaveValue('# 保留当前成果');
 await page.locator('#new-document').click();await page.locator('#confirm-replace').click();
 await expect(page.locator('#editor')).toHaveValue('');await expect(page.locator('#export')).toBeDisabled();
});

test('source search and desktop modes preserve input',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 文档\n\n查找目标\n\n查找目标');
 await page.locator('#find-text').fill('查找目标');await page.locator('#find-next').click();
 expect(await page.locator('#editor').evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd))).toBe('查找目标');
 await page.locator('[data-layout="read"]').click();await expect(page.locator('#editor')).toBeHidden();
 await page.locator('[data-layout="compare"]').click();await expect(page.locator('#editor')).toHaveValue('# 文档\n\n查找目标\n\n查找目标');
});

test('untrusted math slots and unsafe formula links cannot become active output',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('<span data-folio-math="math-1">伪造槽位</span>\n\n$\\href{javascript:alert(1)}{危险}$\n\n![x](https://attacker.invalid/pixel)');
 await expect(page.locator('#preview-loading')).toBeHidden();
 await expect(page.locator('#status')).not.toContainText('Cannot');
 const html=await page.frameLocator('#preview').locator('html').evaluate(e=>e.outerHTML);
 expect(html).not.toMatch(/(?:href|src)="javascript:/i);
 expect(html).not.toContain('src="https://attacker');
 expect(await page.locator('#preview').getAttribute('sandbox')).not.toContain('allow-scripts');
 expect(await page.locator('#preview').getAttribute('sandbox')).not.toContain('allow-popups-to-escape-sandbox');
});

test('a second tab cannot silently overwrite a newer draft',async({page,context})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 初始草稿');await expect(page.locator('#save-state')).toContainText('已保存');
 const other=await context.newPage();await other.goto('/');await other.locator('#restore-draft').click();
 await page.locator('#editor').fill('# 第一窗口的新工作');await expect(page.locator('#save-state')).toContainText('已保存');
 await other.locator('#editor').fill('# 第二窗口的旧工作');
 await expect(other.locator('#save-state')).toContainText('其他标签页');
 await expect(other.locator('#editor')).toHaveValue('# 第二窗口的旧工作');
});

test('PDF original file and conversion settings survive draft recovery',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#file-input').setInputFiles('examples/simple.pdf');
 await expect(page.locator('#export')).toBeEnabled();await page.locator('#pdf-mode').selectOption('reading');
 await expect(page.locator('#export')).toBeEnabled();await expect(page.locator('#save-state')).toContainText('已保存');
 await page.reload();await page.locator('#restore-draft').click();
 await expect(page.locator('#source-type')).toHaveText('PDF');await expect(page.locator('#pdf-mode')).toHaveValue('reading');
 await expect(page.locator('#export')).toBeEnabled();await expect(page.frameLocator('#preview').locator('img')).not.toHaveCount(0);
});

test('composition does not replace native input while preview is pending',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const editor=page.locator('#editor');await editor.dispatchEvent('compositionstart');
 await editor.fill('# 中文连续输入');await expect(page.locator('#export')).toBeDisabled();
 await editor.dispatchEvent('compositionend');
 await expect(page.frameLocator('#preview').locator('h1')).toHaveText('中文连续输入');
 await expect(editor).toHaveValue('# 中文连续输入');
});

test('renaming a Markdown draft cannot change its source type or lose edited text',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 当前修订原文');
 await page.locator('#document-name').fill('改名.pdf');await page.locator('#document-name').press('Tab');
 await expect(page.locator('#document-name')).toHaveValue('改名.md');
 const download=page.waitForEvent('download');await page.locator('#save-source').click();
 expect((await download).suggestedFilename()).toBe('改名.md');
});

test('discarding an old recovery offer cannot remove another tabs newer draft',async({page,context})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 原草稿');await expect(page.locator('#save-state')).toContainText('已保存');
 const other=await context.newPage();await other.goto('/');await expect(other.locator('#recovery')).toBeVisible();
 await page.locator('#editor').fill('# 后来保存的重要工作');await expect(page.locator('#save-state')).toContainText('已保存');
 await other.locator('#discard-draft').click();await expect(other.locator('#recovery-error')).toContainText('其他标签页');
 await page.reload();await page.locator('#restore-draft').click();await expect(page.locator('#editor')).toHaveValue('# 后来保存的重要工作');
});

test('initial draft read prevents editing until the recovery decision is known',async({page})=>{
 await page.addInitScript(()=>{
  const open=IDBFactory.prototype.open;
  IDBFactory.prototype.open=function(...args){const request=open.apply(this,args);request.addEventListener('success',event=>{event.stopImmediatePropagation();window.draftReadWaiting=true;setTimeout(()=>request.onsuccess?.(event),1500);},{once:true});return request;};
 });
 await page.goto('/');await page.waitForFunction(()=>window.draftReadWaiting);
 await page.locator('#editor').evaluate(e=>e.focus());await expect(page.locator('#editor')).not.toBeFocused();
 await expect(page.locator('#example')).toBeDisabled();
 await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 初始化后输入');
 await expect(page.frameLocator('#preview').locator('h1')).toHaveText('初始化后输入');
});

test('a rejected resource repair preserves the original reference',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const source='# 资源上限\n\n![图](https://example.invalid/image.svg)';await page.locator('#editor').fill(source);
 const buffer=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
 await page.locator('#file-input').setInputFiles(Array.from({length:255},(_,i)=>({name:`r${i}.svg`,mimeType:'image/svg+xml',buffer})));
 await expect(page.locator('#diagnostics-list')).toBeVisible();
 await page.locator('#diagnostics-list').getByRole('button',{name:'选择图片修复'}).click();
 await page.locator('#repair-input').setInputFiles({name:'additional.svg',mimeType:'image/svg+xml',buffer});
 await expect(page.locator('#status')).toContainText('256');
 await expect(page.locator('#editor')).toHaveValue(source);
});
