import {test,expect} from '@playwright/test';
import path from 'node:path';
test('portable project restores source assets and options and rejects malformed archive',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  const {encodeProject,decodeProject}=await import('/modules/project.js');
  const f=new File(['# 跨电脑\n\n![图](assets/a.svg)'],'稿件.md',{type:'text/markdown'});
  const image=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'],'a.svg',{type:'image/svg+xml'});
  const d={version:1,text:await f.text(),sourcePath:'稿件.md',file:{blob:f,name:f.name,path:f.name},resources:[{blob:image,name:'a.svg',path:'assets/a.svg'}],options:{theme:'academic'},pdfMode:'reading',pdfDpi:'96',pdfPages:'1-2'};
  const blob=await encodeProject(d),restored=await decodeProject(blob);
  let rejected=false;try{await decodeProject(new Blob(['invalid']));}catch{rejected=true;}
  return {text:restored.text,path:restored.resources[0].path,theme:restored.options.theme,pages:restored.pdfPages,size:restored.resources[0].blob.size,rejected};
 });
 expect(result).toMatchObject({text:'# 跨电脑\n\n![图](assets/a.svg)',path:'assets/a.svg',theme:'academic',pages:'1-2',rejected:true});expect(result.size).toBeGreaterThan(20);
});
test('project UI transfers edited text and settings into a fresh context',async({page,browser})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 项目带走\n\n$x^2$');
 await page.getByRole('button',{name:'学术论文',exact:true}).click();await expect(page.locator('#export')).toBeEnabled();
 const downloading=page.waitForEvent('download');await page.locator('#save-project').click();const download=await downloading;
 expect(download.suggestedFilename()).toMatch(/\.folio$/);const path=await download.path();
 const context=await browser.newContext(),other=await context.newPage();await other.goto('/');await expect(other.locator('#export')).toBeEnabled();
 await other.locator('#project-input').setInputFiles(path);await expect(other.locator('#editor')).toHaveValue('# 项目带走\n\n$x^2$');
 await expect(other.frameLocator('#preview').locator('body')).toHaveClass('theme-academic');await expect(other.locator('#export')).toBeEnabled();await context.close();
});
test('formula templates, resource overview and export profiles work',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 公式帮助\n');await page.locator('#editor').press('Control+End');
 await page.locator('#formula-help').click();await page.locator('[data-formula="matrix"]').click();
 await expect(page.locator('#editor')).toHaveValue(/bmatrix/);await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#manage-resources').click();await expect(page.locator('#resource-dialog')).toBeVisible();await page.locator('#close-resources').click();
 await page.locator('#quality-panel summary').click();await page.locator('#export-profile').selectOption('share');await expect(page.locator('#export')).toBeEnabled();
 const downloading=page.waitForEvent('download');await page.locator('#export-format').selectOption('zip');await page.locator('#export').click();expect((await downloading).suggestedFilename()).toMatch(/\.zip$/);
});
test('untrusted project cannot replace work and ZIP CRC and metadata are checked',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 保留工作');
 await page.locator('#project-input').setInputFiles({name:'bad.folio',mimeType:'application/zip',buffer:Buffer.from('bad zip')});await expect(page.locator('#status')).toContainText('无效');await expect(page.locator('#editor')).toHaveValue('# 保留工作');
 const failures=await page.evaluate(async()=>{
  const {writeZip,readZip}=await import('/modules/zip.js'),{decodeProject}=await import('/modules/project.js');const errors=[];
  for(const p of ['../evil.js','/absolute','folder/../../evil','C:/evil'])try{await writeZip([[p,'bad']]);errors.push(false);}catch{errors.push(true);}
  const zip=await writeZip([['entry.txt','original']]),bytes=new Uint8Array(await zip.arrayBuffer());bytes[39]^=1;try{await readZip(new Blob([bytes]));errors.push(false);}catch{errors.push(true);}
  const bad=await writeZip([['manifest.json',JSON.stringify({format:'folio-project',version:1,sourcePath:'x.md',text:'# x',resources:[],options:null})]]);try{await decodeProject(bad);errors.push(false);}catch{errors.push(true);}return errors;
 });expect(failures).toEqual([true,true,true,true,true,true]);
});
test('explicit local snapshot restores a project and privacy clears snapshots',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 快照版本');
 await page.locator('#project-history').click();await page.locator('#save-snapshot').click();await expect(page.locator('#history-list .history-row')).toHaveCount(1);await page.locator('#close-history').click();
 await page.locator('#editor').fill('# 其他内容');await page.locator('#project-history').click();await page.locator('#history-list').getByRole('button',{name:'恢复',exact:true}).click();await page.locator('#confirm-replace').click();await expect(page.locator('#editor')).toHaveValue('# 快照版本');
 await page.locator('.privacy-settings summary').click();await page.locator('#clear-draft').click();await page.locator('#confirm-replace').click();await expect(page.locator('#save-state')).toContainText('已清除');await page.locator('#project-history').click();await expect(page.locator('#history-list .history-row')).toHaveCount(0);
});
test('pasted screenshot becomes a validated local image and project asset',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 截图');
 await page.locator('#editor').evaluate(async editor=>{
  const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;canvas.getContext('2d').fillRect(0,0,20,20);const blob=await new Promise(r=>canvas.toBlob(r));
  const transfer=new DataTransfer();transfer.items.add(new File([blob],'image.png',{type:'image/png'}));editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
 });
 await expect(page.locator('#editor')).toHaveValue(/!\[截图\]\(images\/paste-/);await expect(page.frameLocator('#preview').locator('article img')).toHaveCount(1);await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#manage-resources').click();await expect(page.locator('#resource-list')).toContainText('已引用');await page.locator('#close-resources').click();
});
test('real async PDF conversion preserves selected page and supports page review',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#file-input').setInputFiles(path.resolve('examples/simple.pdf'));
 await expect(page.locator('#export')).toBeEnabled({timeout:30000});await expect(page.locator('#pdf-review-page option')).toHaveCount(1);
 await page.locator('#pdf-pages').fill('1');await page.locator('#pdf-pages').press('Tab');await expect(page.locator('#export')).toBeEnabled();await page.locator('#review-pdf').click();await expect(page.locator('#pdf-source')).toHaveAttribute('data',/#page=1/);
 await page.locator('#pdf-pages').fill('999');await page.locator('#pdf-pages').press('Tab');await expect(page.locator('#status')).toContainText(/页码|范围/);await expect(page.locator('#export')).toBeDisabled();
});
test('PDF cancel sends capability token and leaves source usable',async({page})=>{
 let cancelled=false;
 await page.route('**/api/pdf/jobs**',async route=>{
  const u=route.request().url();if(u.endsWith('/cancel')){expect(route.request().headers()['x-folio-job']).toBe('secret');cancelled=true;return route.fulfill({json:{state:'cancelled',stage:'cancelled',completed:1,total:20}});}
  if(route.request().method()==='POST')return route.fulfill({status:202,json:{id:'testing',token:'secret'}});
  return route.fulfill({json:{state:cancelled?'cancelled':'running',stage:'converting',completed:1,total:20}});
 });
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#file-input').setInputFiles(path.resolve('examples/simple.pdf'));await expect(page.locator('#pdf-progress-label')).toContainText('1 / 20');await page.locator('#cancel-pdf').click();await expect.poll(()=>cancelled).toBe(true);await expect(page.locator('#status')).toContainText('已取消');await expect(page.locator('#export')).toBeDisabled();await expect(page.locator('#pdf-source')).toBeVisible();
});
test('ZIP export opens offline and compact profile reduces raster size without changing original',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const outcome=await page.evaluate(async()=>{
  const {prepareOutput,outputArchive}=await import('/modules/output.js'),{readZip}=await import('/modules/zip.js');
  const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;const c=canvas.getContext('2d');for(let x=0;x<2400;x+=10){c.fillStyle=`hsl(${x%360},60%,50%)`;c.fillRect(x,0,10,1200);}const image=canvas.toDataURL(),model={title:'离线',bodyHtml:`<h1>离线</h1><img src="${image}" alt="image">`,math:[],toc:[],diagnostics:[],missingAssets:[]};
  const archive=await prepareOutput(model,{},'archive'),compact=await prepareOutput(model,{},'share'),zip=await outputArchive(compact,'离线'),files=await readZip(zip),html=await files.get('离线.html').text();
  return {archive:archive.length,compact:compact.length,unchanged:model.bodyHtml.includes(image),entries:[...files.keys()],html};
 });expect(outcome.compact).toBeLessThan(outcome.archive);expect(outcome.unchanged).toBe(true);expect(outcome.entries).toContain('assets/image-1.webp');expect(outcome.html).toContain('src="assets/image-1.webp"');expect(outcome.html).toContain("img-src 'self' data:");
});
test('large escaped source round trips within the documented Markdown limit',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async()=>{const {encodeProject,decodeProject}=await import('/modules/project.js'),text='\\'.repeat(4*1024*1024),blob=await encodeProject({version:1,text,sourcePath:'large.md',file:null,resources:[],options:{}}),restored=await decodeProject(blob);return {same:text===restored.text,size:blob.size};});expect(result.same).toBe(true);expect(result.size).toBeGreaterThan(6*1024*1024);
});
for(const clearVia of ['history','privacy'])test(`pending snapshot cannot resurrect records after ${clearVia} clear`,async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 不得恢复的快照');await expect(page.locator('#export')).toBeEnabled();await page.locator('#project-history').click();
 await page.evaluate(()=>{const original=Blob.prototype.arrayBuffer;window.snapshotEncoding=false;Blob.prototype.arrayBuffer=function(){window.snapshotEncoding=true;const blob=this;return new Promise(resolve=>{window.resumeSnapshot=async()=>resolve(await original.call(blob));Blob.prototype.arrayBuffer=original;});};});
 await page.locator('#save-snapshot').click();await expect.poll(()=>page.evaluate(()=>window.snapshotEncoding)).toBe(true);
 if(clearVia==='history'){await page.locator('#clear-history').click();await expect(page.locator('#status')).toContainText('快照已清除');}else{await page.locator('#close-history').click();await page.locator('.privacy-settings summary').click();await page.locator('#clear-draft').click();await page.locator('#confirm-replace').click();await expect(page.locator('#save-state')).toContainText('已清除');}
 await page.evaluate(()=>window.resumeSnapshot());await expect(page.locator('#status')).toContainText('取消');expect(await page.evaluate(async()=>(await (await import('/modules/history.js')).listSnapshots()).length)).toBe(0);
});
test('replacement backup contains pasted image instead of only a broken Markdown reference',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 完整备份\n\n![图](test.svg)');
 await page.locator('#file-input').setInputFiles({name:'test.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')});await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#new-document').click();const downloading=page.waitForEvent('download');await page.locator('#backup-replace').click();const download=await downloading;expect(download.suggestedFilename()).toMatch(/\.folio$/);await expect(page.locator('#editor')).toHaveValue('');
 await page.locator('#project-input').setInputFiles(await download.path());await expect(page.locator('#editor')).toHaveValue(/完整备份/);await expect(page.frameLocator('#preview').locator('img')).toHaveCount(1);await expect(page.locator('#export')).toBeEnabled();
});
