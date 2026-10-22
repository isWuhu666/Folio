import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {sidewaysTextPdf} from './android-fixtures.mjs';

test('Windows sideways text falls back in reading and stays out of exported selection layers',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#file-input').setInputFiles({name:'sideways.pdf',mimeType:'application/pdf',buffer:sidewaysTextPdf()});
 await expect(page.locator('#export')).toBeEnabled();await page.locator('#pdf-mode').selectOption('reading');
 await expect(page.locator('#export')).toBeEnabled();await expect(page.locator('#diagnostics-list')).toContainText('文字方向');
 const reading=await page.frameLocator('#preview').locator('article').innerHTML();
 expect(reading).not.toContain('eton ediS');expect(reading).not.toContain('pdf-text-layer');
 expect(await page.frameLocator('#preview').locator('article img').count()).toBeGreaterThan(0);
 const waiting=page.waitForEvent('download');await page.locator('#export').click();
 const exported=await fs.readFile(await (await waiting).path(),'utf8');expect(exported).not.toContain('eton ediS');expect(exported).not.toMatch(/class="pdf-text-layer/);
 await page.locator('#pdf-mode').selectOption('faithful');await expect(page.locator('#export')).toBeEnabled();
 await expect(page.locator('#diagnostics-list')).toContainText('文字方向');
 expect(await page.frameLocator('#preview').locator('.pdf-text-layer').count()).toBe(0);
});

for(const android of [false,true])test(`new PDF clears an old invalid page range (${android?'Android':'Windows'})`,async({page})=>{
 if(android)await page.addInitScript(()=>{window.FolioAndroid={postMessage(){}};});
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#file-input').setInputFiles('examples/simple.pdf');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#pdf-pages').fill('999');await page.locator('#pdf-pages').press('Tab');
 await expect(page.locator('#status')).toContainText(/页码|范围/);
 await page.locator('#file-input').setInputFiles('examples/table.pdf');
 if(await page.locator('#replace-dialog').isVisible())await page.locator('#confirm-replace').click();
 await expect(page.locator('#source-name')).toHaveText('table.pdf');
 await expect(page.locator('#pdf-pages')).toHaveValue('');await expect(page.locator('#export')).toBeEnabled();
});

test('project encoder rejects incompatible source and resource metadata before producing an archive',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  const {encodeProject,decodeProject}=await import('/modules/project.js');const out=[];
  for(const name of ['中文😀.md','notes:2026.md','a\\b.md','a#b.md']){
   const file=new File(['# Name'],name,{type:'text/markdown'}),draft={version:1,text:'# Name',sourcePath:name,file:{name,path:name,blob:file},resources:[],options:{}};
   let encoded=false,error=null,decodedText=null;
   try{const blob=await encodeProject(draft);encoded=true;decodedText=(await decodeProject(blob)).text;}catch(e){error=e.message;}
   out.push({name,encoded,error,decodedText});
  }
  return out;
 });
 expect(result.filter(r=>r.encoded&&r.error)).toEqual([]);
 expect(result.filter(r=>r.encoded).map(r=>r.decodedText)).toEqual(['# Name','# Name']);
 expect(result.filter(r=>!r.encoded).map(r=>r.name)).toEqual(['notes:2026.md','a\\b.md']);
});

test('restoring a PDF project keeps its saved page range while opening a different file clears it',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#file-input').setInputFiles('examples/simple.pdf');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#pdf-pages').fill('1');await page.locator('#pdf-pages').press('Tab');await expect(page.locator('#export')).toBeEnabled();
 const waiting=page.waitForEvent('download');await page.locator('#save-project').click();const archive=await (await waiting).path();
 await page.locator('#file-input').setInputFiles('examples/table.pdf');
 if(await page.locator('#replace-dialog').isVisible())await page.locator('#confirm-replace').click();
 await expect(page.locator('#pdf-pages')).toHaveValue('');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#project-input').setInputFiles(archive);
 await expect(page.locator('#source-name')).toHaveText('simple.pdf');await expect(page.locator('#pdf-pages')).toHaveValue('1');await expect(page.locator('#export')).toBeEnabled();
});

test('project encoding refuses unsupported resources and PDF metadata instead of making unreadable backups',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  const {encodeProject,decodeProject}=await import('/modules/project.js');
  const resource={name:'a.svg',path:'assets/a.svg',blob:new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],{type:'image/svg+xml'})};
  const base={version:1,text:'# Source',sourcePath:'source.md',file:null,resources:[resource],options:{}};
  const invalid=[{...base,resources:[{...resource,name:'a\\b.svg'}]},{...base,resources:[{...resource,path:'assets:bad/a.svg'}]}, {...base,resources:[resource,resource]},{...base,pdfPages:'bad'},{...base,options:null},{...base,sourcePath:'source.pdf',text:'',file:{name:'source.pdf',path:'source.pdf',blob:new Blob(['not a PDF'])}}];
  const states=[];
  for(const d of invalid){let encoded=false,error=null;try{const blob=await encodeProject(d);encoded=true;await decodeProject(blob);}catch(e){error=e.message;}states.push({encoded,error});}
  return states;
 });
 expect(result.every(r=>!r.encoded&&r.error)).toBe(true);
});

test('incompatible imported filename cannot replace edited work or report a successful project',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 保留正在编辑的内容');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#file-input').setInputFiles({name:'notes:2026.md',mimeType:'text/markdown',buffer:Buffer.from('# Unusable filename')});
 // Validation must happen before a replacement or any success acknowledgement.
 await expect(page.locator('#replace-dialog')).not.toBeVisible();
 await expect(page.locator('#status')).toContainText(/文件名|路径/);await expect(page.locator('#editor')).toHaveValue('# 保留正在编辑的内容');
});

test('legacy project display names remain readable when their logical paths are safe',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  const {writeZip}=await import('/modules/zip.js'),{encodeProject,decodeProject}=await import('/modules/project.js');
  const text='# Legacy\n\n![x](assets/a.svg)',svg='<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  const manifest={format:'folio-project',version:1,sourcePath:'source.md',text,options:{},file:{name:'display:source.md',path:'source.md',entry:'source/original.md'},resources:[{name:'display:2026.svg',path:'assets/a.svg',entry:'assets/0.svg'}]};
  const blob=await writeZip([['manifest.json',JSON.stringify(manifest)],['source/original.md',text],['assets/0.svg',svg]]);
  const original=await decodeProject(blob),restored=await decodeProject(await encodeProject(original));
  return {text:restored.text,fileName:restored.file.name,resourceName:restored.resources[0].name,path:restored.resources[0].path};
 });
 expect(result).toEqual({text:'# Legacy\n\n![x](assets/a.svg)',fileName:'display:source.md',resourceName:'display:2026.svg',path:'assets/a.svg'});
});

test('large Markdown retains every block without a quadratic main-thread lookup',async({page},testInfo)=>{
 test.setTimeout(90000);await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const metrics=await page.evaluate(async()=>{
  const {renderMarkdown}=await import('/modules/markdown.js');const result=[];
  renderMarkdown('Warm up.\n\n'.repeat(1000));
  for(const count of [1000,5000,10000,20000,40000]){
   const text='A paragraph.\n\n'.repeat(count),start=performance.now(),d=renderMarkdown(text),ms=performance.now()-start;
   const doc=new DOMParser().parseFromString(d.bodyHtml,'text/html'),blocks=[...doc.querySelectorAll('[data-folio-block]')];
   result.push({count,bytes:text.length,ms,blocks:d.blocks.length,markers:blocks.length,first:blocks[0]?.textContent,last:blocks.at(-1)?.textContent});
  }
  return result;
 });
 await testInfo.attach('markdown-scaling',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
 await fs.mkdir('artifacts',{recursive:true});await fs.writeFile(process.env.FOLIO_MARKDOWN_METRICS||'artifacts/markdown-scaling-latest.json',JSON.stringify(metrics,null,2));
 for(const r of metrics){expect(r.blocks).toBe(r.count);expect(r.markers).toBe(r.count);expect(r.first).toBe('A paragraph.');expect(r.last).toBe('A paragraph.');}
 // Compare 8x input on the same browser; allow substantial GC/CI noise but not quadratic growth.
 expect(metrics.at(-1).ms/metrics[1].ms).toBeLessThan(24);
});
