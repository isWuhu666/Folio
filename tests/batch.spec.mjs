import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const md=(name,text)=>({name,mimeType:'text/markdown',buffer:Buffer.from(text)});
async function ready(page){await page.goto('/');await expect(page.locator('#export')).toBeEnabled();}
async function openBatch(page){await page.locator('#open-batch').click();await expect(page.locator('#batch-dialog')).toBeVisible();}
test('batch scheduler overlaps two tasks, preserves identity, and contains failures',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{
  const {createBatchQueue}=await import('/modules/batch-queue.js');let active=0,peak=0;const gates={};
  const q=createBatchQueue({concurrency:2,run:async task=>{active++;peak=Math.max(peak,active);await new Promise(r=>gates[task.name]=r);active--;if(task.name==='bad')throw new Error('bad document');return {blob:new Blob([task.name]),html:task.name};}});
  q.add([{name:'first'},{name:'second'},{name:'bad'}]);q.start();await new Promise(r=>setTimeout(r,0));const overlap=active;
  gates.second();await new Promise(r=>setTimeout(r,0));gates.bad();gates.first();await q.idle();
  return {overlap,peak,states:q.items.map(t=>[t.name,t.state,t.result?.html])};
 });expect(result.overlap).toBe(2);expect(result.peak).toBe(2);expect(result.states).toEqual([['first','done','first'],['second','done','second'],['bad','failed',undefined]]);
});
test('batch scheduler cancels queued and running work and bounds retained outputs',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{
  const {createBatchQueue}=await import('/modules/batch-queue.js');const calls=[];
  const q=createBatchQueue({concurrency:1,maxResultsBytes:8,run:async(t,{signal})=>{calls.push(t.name);if(t.name==='cancel')await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true}));return {blob:new Blob(['123456789']),html:''};}});
  const tasks=q.add([{name:'cancel'},{name:'queued'},{name:'large'}]);q.cancel(tasks[1].id);q.start();await new Promise(r=>setTimeout(r,0));q.cancel(tasks[0].id);await q.idle();return {calls,states:q.items.map(t=>t.state),bytes:q.retainedBytes};
 });expect(result.calls).toEqual(['cancel','large']);expect(result.states).toEqual(['cancelled','cancelled','failed']);expect(result.bytes).toBe(0);
});
test('batch creates separate named HTML results and combined offline ZIP without touching editor',async({page})=>{
 await ready(page);const original=await page.locator('#editor').inputValue();await openBatch(page);
 await page.locator('#batch-input').setInputFiles([md('note.md','# First unique'),md('note.md','# Second unique')]);await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(2);
 await expect(page.locator('#editor')).toHaveValue(original);const waiting=page.waitForEvent('download');await page.locator('#batch-download-all').click();const blob=[...await fs.readFile(await (await waiting).path())];
 const files=await page.evaluate(async bytes=>{const {readZip}=await import('/modules/zip.js');const z=await readZip(new Blob([new Uint8Array(bytes)]));return Promise.all([...z].map(async([name,blob])=>[name,await blob.text()]));},blob);
 expect(files.map(f=>f[0])).toEqual(['note.html','note (2).html']);expect(files[0][1]).toContain('First unique');expect(files[1][1]).toContain('Second unique');
 await page.locator('.batch-row').first().getByRole('button',{name:'预览',exact:true}).click();await expect(page.frameLocator('#batch-preview').locator('h1')).toHaveText('First unique');
});
test('batch invalid encoding and missing images do not hide good results or bypass export review',async({page})=>{
 await ready(page);await openBatch(page);await page.locator('#batch-input').setInputFiles([md('good.md','# Good'),md('missing.md','# Missing\n\n![x](absent.png)'),{name:'gbk.md',mimeType:'text/markdown',buffer:Buffer.from([0xd6,0xd0])}]);
 await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);await expect(page.locator('.batch-row[data-state=review]')).toHaveCount(1);await expect(page.locator('.batch-row[data-state=failed]')).toHaveCount(1);
 await expect(page.locator('.batch-row[data-state=failed]')).toContainText('编码');await expect(page.locator('.batch-row[data-state=review]')).toContainText('核对');
 const waiting=page.waitForEvent('download');await page.locator('#batch-download-all').click();const bytes=[...await fs.readFile(await (await waiting).path())];
 expect(await page.evaluate(async b=>[...(await (await import('/modules/zip.js')).readZip(new Blob([new Uint8Array(b)]))).keys()],bytes)).toEqual(['good.html']);
});
test('batch uses exact folder resource paths and exports sanitized images offline',async({page})=>{
 await ready(page);await openBatch(page);await page.evaluate(()=>{
  const input=document.getElementById('batch-input'),dt=new DataTransfer();
  for(const [name,path,text,type] of [['main.md','folder/main.md','# Diagram\n\n![figure](assets/a.svg)','text/markdown'],['a.svg','folder/assets/a.svg','<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>','image/svg+xml']]){const f=new File([text],name,{type});Object.defineProperty(f,'webkitRelativePath',{value:path});dt.items.add(f);}input.files=dt.files;input.dispatchEvent(new Event('change'));
 });await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);await page.locator('.batch-row').getByRole('button',{name:'预览',exact:true}).click();
 await expect(page.frameLocator('#batch-preview').locator('img')).toHaveCount(1);expect(await page.frameLocator('#batch-preview').locator('img').evaluate(e=>e.naturalWidth)).toBeGreaterThan(0);
});
test('batch cancels one remote PDF without cancelling an independent Markdown result',async({page})=>{
 let cancelled=false;await page.route('**/api/pdf/jobs?*',route=>route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({id:'batch-cancel-job',token:'batch-token'})}));
 await page.route('**/api/pdf/jobs/batch-cancel-job',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({state:'running',total:5,completed:1})}));
 await page.route('**/api/pdf/jobs/batch-cancel-job/cancel',route=>{cancelled=true;return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 await ready(page);await openBatch(page);await page.locator('#batch-input').setInputFiles([md('independent.md','# Still good'),{name:'cancel.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')}]);await page.locator('#batch-start').click();
 await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);await expect(page.locator('.batch-row[data-state=running]')).toContainText('1 / 5');await page.locator('.batch-row[data-state=running]').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.batch-row[data-state=cancelled]')).toHaveCount(1);expect(cancelled).toBe(true);await expect(page.locator('.batch-row[data-state=done]')).toContainText('independent.md');
});
test('two real PDF batch results retain distinct documents',async({page})=>{
 await ready(page);await openBatch(page);await page.locator('#batch-input').setInputFiles(['examples/simple.pdf','examples/table.pdf']);await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(2);
 const waiting=page.waitForEvent('download');await page.locator('#batch-download-all').click();const bytes=[...await fs.readFile(await (await waiting).path())];
 const entries=await page.evaluate(async b=>{const z=await(await import('/modules/zip.js')).readZip(new Blob([new Uint8Array(b)]));return Promise.all([...z].map(async([name,blob])=>[name,await blob.text()]));},bytes);expect(entries.map(e=>e[0])).toEqual(['simple.html','table.html']);expect(entries[0][1]).toContain('data:image/png;base64,');expect(entries[1][1]).toContain('data:image/png;base64,');expect(entries[0][1]).not.toBe(entries[1][1]);
});
test('batch fits a narrow screen and retains results when closing its panel',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('[data-tab=settings]').click();await openBatch(page);await page.locator('#batch-input').setInputFiles(md('phone.md','# Phone result'));await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);
 expect(await page.locator('#batch-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.screenshot({path:'artifacts/batch-mobile.png'});await page.locator('#batch-close').click();await openBatch(page);await expect(page.locator('.batch-row[data-state=done]')).toContainText('phone.md');
});
test('duplicate image paths cannot silently replace an earlier document resource',async({page})=>{
 await ready(page);await openBatch(page);const svg=fill=>({name:'chart.svg',mimeType:'image/svg+xml',buffer:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${fill}"/></svg>`)});
 await page.locator('#batch-input').setInputFiles([md('first.md','# First\n\n![a](chart.svg)'),svg('green')]);await page.locator('#batch-input').setInputFiles([md('second.md','# Second\n\n![b](chart.svg)'),svg('red')]);
 await expect(page.locator('#batch-notice')).toContainText('路径重复');await expect(page.locator('.batch-row')).toHaveCount(1);await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);
});
test('an unreferenced corrupt image cannot block another batch document',async({page})=>{
 await ready(page);await openBatch(page);await page.locator('#batch-input').setInputFiles([md('clean.md','# Clean output'),md('uses-broken.md','# Broken\n\n![a](broken.svg)'),{name:'broken.svg',mimeType:'image/svg+xml',buffer:Buffer.from('invalid svg')}]);await page.locator('#batch-start').click();
 await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);await expect(page.locator('.batch-row[data-state=done]')).toContainText('clean.md');await expect(page.locator('.batch-row[data-state=review]')).toHaveCount(1);
});
test('batch retry uses newly supplied images and clear removes previous batch resources',async({page})=>{
 await ready(page);await openBatch(page);await page.locator('#batch-input').setInputFiles(md('retry.md','# Retry\n\n![a](new.svg)'));await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=review]')).toHaveCount(1);
 await page.locator('#batch-settings summary').click();await page.locator('#batch-input').setInputFiles({name:'new.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>')});await page.locator('.batch-row').getByRole('button',{name:'重试',exact:true}).click();await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);
 page.once('dialog',d=>d.accept());await page.locator('#batch-clear').click();await expect(page.locator('.batch-row')).toHaveCount(0);await expect(page.locator('#batch-resource-count')).toContainText('0 张');
 await page.locator('#batch-settings summary').click();await page.locator('#batch-input').setInputFiles(md('fresh.md','# Fresh\n\n![a](new.svg)'));await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=review]')).toHaveCount(1);
});
test('Android batch starts conservatively and keeps independent Markdown results',async({page})=>{
 await page.addInitScript(()=>{window.FolioAndroid={postMessage(){}};});await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('[data-tab=settings]').click();await openBatch(page);await expect(page.locator('#batch-concurrency')).toHaveValue('1');await expect(page.locator('#batch-pdf-dpi')).toHaveValue('96');
 await page.locator('#batch-input').setInputFiles([md('one.md','# Android one'),md('two.md','# Android two')]);await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(2);await expect(page.locator('#batch-notice')).toContainText('已结束');
});
test('a saturated batch waits with small capacity requests instead of resending PDF bodies',async({page})=>{
 let posts=0,polls=0;await page.route('**/api/pdf/jobs?*',route=>{posts++;return route.fulfill({status:posts===1?503:202,contentType:'application/json',body:JSON.stringify(posts===1?{error:'busy',code:'pdf_busy',retryable:true}:{id:'capacity-task',token:'capacity-token'})});});
 await page.route('**/api/pdf/capacity',route=>{polls++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({active:polls<3?2:0,limit:2,available:polls>=3})});});
 await page.route('**/api/pdf/jobs/capacity-task',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({state:'completed',result:{title:'Capacity',pageCount:1,mode:'faithful',diagnostics:[],bodyHtml:'<p>Capacity result</p>'}})}));
 await ready(page);await openBatch(page);await page.locator('#batch-input').setInputFiles({name:'waiting.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')});await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);expect(posts).toBe(2);expect(polls).toBe(3);
});
test('batch progress updates preserve keyboard focus on its cancel action',async({page})=>{
 let completed=1;await page.route('**/api/pdf/jobs?*',r=>r.fulfill({status:202,contentType:'application/json',body:'{"id":"focus-job","token":"focus-token"}'}));await page.route('**/api/pdf/jobs/focus-job',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({state:'running',total:5,completed})}));await page.route('**/api/pdf/jobs/focus-job/cancel',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await ready(page);await openBatch(page);await page.locator('#batch-input').setInputFiles({name:'focus.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')});await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=running]')).toContainText('1 / 5');const cancel=page.locator('.batch-row').getByRole('button',{name:'取消',exact:true});await cancel.focus();completed=2;await expect(page.locator('.batch-row')).toContainText('2 / 5');await expect(cancel).toBeFocused();await cancel.press('Enter');await expect(page.locator('.batch-row[data-state=cancelled]')).toHaveCount(1);
});
test('Android back closes batch preview before the retained task panel',async({page})=>{
 await page.addInitScript(()=>{window.FolioAndroid={postMessage(){}};});await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('[data-tab=settings]').click();await openBatch(page);await page.locator('#batch-input').setInputFiles(md('back.md','# Back result'));await page.locator('#batch-start').click();await expect(page.locator('.batch-row[data-state=done]')).toHaveCount(1);await page.locator('.batch-row').getByRole('button',{name:'预览',exact:true}).click();await expect(page.locator('#batch-preview-dialog')).toBeVisible();expect(await page.evaluate(()=>window.FolioAndroidBack())).toBe(true);await expect(page.locator('#batch-preview-dialog')).toBeHidden();await expect(page.locator('#batch-dialog')).toBeVisible();await expect(page.locator('#batch-preview')).toHaveAttribute('srcdoc','');
});
