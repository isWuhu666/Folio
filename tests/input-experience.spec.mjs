import {test,expect} from '@playwright/test';
const md=(name,text)=>({name,mimeType:'text/markdown',buffer:Buffer.from(text)});
async function ready(page){await page.goto('/');await expect(page.locator('#export')).toBeEnabled();}
test('ambiguous document selection preserves current work and names rejected files',async({page})=>{
 await ready(page);const original=await page.locator('#editor').inputValue();
 await page.locator('#file-input').setInputFiles([md('first.md','# First'),md('second.md','# Second')]);
 await expect(page.locator('#status')).toContainText('多个文档');await expect(page.locator('#status')).toContainText('second.md');await expect(page.locator('#editor')).toHaveValue(original);
});
test('unsupported and mixed imports give named feedback without silent loss',async({page})=>{
 await ready(page);const original=await page.locator('#editor').inputValue();const doc={name:'report.docx',mimeType:'application/octet-stream',buffer:Buffer.from('unsupported')};
 await page.locator('#file-input').setInputFiles(doc);await expect(page.locator('#status')).toContainText('不支持');await expect(page.locator('#editor')).toHaveValue(original);
 await page.locator('#file-input').setInputFiles([md('valid.md','# Valid'),doc]);await expect(page.locator('#editor')).toHaveValue('# Valid');await expect(page.locator('#status')).toContainText('report.docx');
});
test('invalid UTF8 is rejected before replacing work while BOM UTF16 remains readable',async({page})=>{
 await ready(page);const original=await page.locator('#editor').inputValue();
 await page.locator('#file-input').setInputFiles({name:'gbk.md',mimeType:'text/markdown',buffer:Buffer.from([0x23,0x20,0xd6,0xd0,0xce,0xc4])});
 await expect(page.locator('#status')).toContainText('编码');await expect(page.locator('#editor')).toHaveValue(original);
 await page.locator('#file-input').setInputFiles({name:'utf16.md',mimeType:'text/markdown',buffer:Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('# 中文笔记','utf16le')])});
 await expect(page.locator('#editor')).toHaveValue('# 中文笔记');await expect(page.locator('#export')).toBeEnabled();
});
test('mobile settings exposes output controls and accessible targets',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('[data-tab=settings]').click();
 await expect(page.locator('#export-format')).toBeVisible();await expect(page.locator('#export-profile')).toBeVisible();await expect(page.locator('#print-document')).toBeVisible();
 expect(await page.locator('#export').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
});
test('export blocking reason is reachable beside the export action',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('#editor').fill('# Budget\n\nprice $30');
 await expect(page.locator('#export')).toBeDisabled();await expect(page.locator('#export-issues')).toBeVisible();await page.locator('#export-issues').click();
 await expect(page.locator('#diagnostics')).toBeVisible();await expect(page.locator('#diagnostics-list')).toContainText('\\$30');
});
test('focus mode provides substantial editing height on laptop screens',async({page})=>{
 await page.setViewportSize({width:1280,height:720});await ready(page);await page.locator('#focus-mode').click();
 expect(await page.locator('#editor').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(260);
 await page.screenshot({path:'artifacts/audit2-desktop-focus.png'});
});
test('new notes offer an explicit heading name without renaming imported documents',async({page})=>{
 await ready(page);await page.locator('#new-document').click();await page.locator('#editor').fill('# 旅行预算\n\n正文');await expect(page.locator('#document-name')).toHaveValue('未命名.md');
 await page.locator('#suggest-name').click();await expect(page.locator('#document-name')).toHaveValue('旅行预算.md');
 const pending=page.locator('#file-input').setInputFiles(md('未命名.md','# Imported heading'));await pending;await page.locator('#confirm-replace').click();
 await expect(page.locator('#editor')).toHaveValue('# Imported heading');await expect(page.locator('#suggest-name')).toBeHidden();
});
test('task help explains backup formats and narrow enlarged text stays usable',async({page})=>{
 await page.setViewportSize({width:320,height:844});await ready(page);await page.locator('#usage-help').click();await expect(page.locator('#usage-dialog')).toContainText('.folio');await expect(page.locator('#usage-dialog')).toContainText('本机草稿');await page.locator('#close-usage').click();
 await page.locator('[data-tab=settings]').click();await page.addStyleTag({content:'html {font-size:20px} button {font-size:18px!important}'});
 await expect(page.locator('#export-format')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'artifacts/audit2-mobile-settings-320.png',fullPage:true});
});
test('sanitized SVG repair uses the existing resource key for a nested document',async({page})=>{
 await ready(page);await page.evaluate(()=>{
  const files=[new File(['# Nested\n\n![image](image.svg)'],'main.md',{type:'text/markdown'}),new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><defs><rect id="r" width="20" height="20"/></defs><use href="#r"/></svg>'],'image.svg',{type:'image/svg+xml'})];
  const dt=new DataTransfer();for(const f of files){Object.defineProperty(f,'webkitRelativePath',{value:'folder/'+f.name});dt.items.add(f);}const input=document.getElementById('file-input');input.files=dt.files;input.dispatchEvent(new Event('change'));
 });
 await expect(page.locator('#diagnostics-list')).toContainText('安全清理');
 const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=20;return [...new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer())];});
 await page.locator('#diagnostics-list').getByRole('button',{name:'选择图片修复'}).click();await page.locator('#repair-input').setInputFiles({name:'fixed.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
 await expect(page.locator('#diagnostics')).toBeHidden();await expect(page.locator('#export')).toBeEnabled();
 const stored=await page.evaluate(async()=>{const {createDraftStore}=await import('/modules/drafts.js');return (await createDraftStore().load())?.resources.map(r=>r.path);});
 await expect.poll(async()=>page.evaluate(async()=>{const {createDraftStore}=await import('/modules/drafts.js');return (await createDraftStore().load())?.resources.map(r=>r.path);})).toEqual(['folder/image.svg']);
});
