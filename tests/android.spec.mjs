import {test,expect} from '@playwright/test';
import {sidewaysTextPdf} from './android-fixtures.mjs';
test('Android native export streams bytes and waits for final acknowledgement',async({page})=>{
 await page.addInitScript(()=>{window.nativeWrites=[];window.FolioAndroid={postMessage(text){const message=JSON.parse(text);window.nativeWrites.push(message);queueMicrotask(()=>window.FolioAndroid.onmessage({data:JSON.stringify({id:message.id,ok:true})}));}};});
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async()=>{const {saveFile,isAndroid}=await import('/modules/platform.js');await saveFile(new Blob(['中文项目'],{type:'application/zip'}),'test.folio');return {android:isAndroid(),messages:window.nativeWrites};});
 expect(result.android).toBe(true);expect(result.messages.map(m=>m.op)).toEqual(['begin','chunk','finish']);expect(result.messages[0]).toMatchObject({name:'test.folio',size:12,mime:'application/octet-stream'});expect(Buffer.from(result.messages[1].data,'base64').toString()).toBe('中文项目');
});
test('Android cancelled save keeps current work and does not report saved',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{window.FolioAndroid={postMessage(text){const m=JSON.parse(text);if(m.op==='abort')return;queueMicrotask(()=>window.FolioAndroid.onmessage({data:JSON.stringify({id:m.id,error:'已取消保存',cancelled:true})}));}};});
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#editor').fill('# 原文必须保留');await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.locator('#save-project').click();await expect(page.locator('#status')).toContainText('取消');await expect(page.locator('#editor')).toHaveValue('# 原文必须保留');
});
test('Android local PDF runs offline with real progress and selectable text',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async()=>{const {startAndroidPdf}=await import('/modules/android-pdf.js'),data=await fetch('/examples/simple.pdf').then(r=>r.blob()),events=[];const task=startAndroidPdf(new File([data],'simple.pdf'),{mode:'faithful',dpi:'96',pages:'1',onProgress:p=>events.push(p.completed)}),result=await task.promise;return {result,events};});
 expect(result.result.pageCount).toBe(1);expect(result.result.bodyHtml).toContain('data:image/png;base64,');expect(result.result.bodyHtml).toContain('pdf-text-layer');expect(result.events).toContain(1);
});
test('Android PDF cancellation and phone limits preserve honest errors',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const results=await page.evaluate(async()=>{const {startAndroidPdf}=await import('/modules/android-pdf.js'),data=await fetch('/examples/simple.pdf').then(r=>r.blob()),events=[];const task=startAndroidPdf(new File([data],'simple.pdf'),{dpi:'96',mode:'faithful'});await task.cancel();try{await task.promise;}catch(e){events.push(e.name);}try{await startAndroidPdf(new File([new Uint8Array(21*1024*1024)],'big.pdf'),{dpi:'96',mode:'faithful'}).promise;}catch(e){events.push(e.message);}return events;});
 expect(results[0]).toBe('AbortError');expect(results[1]).toContain('20 MiB');
});
test('Android reading safely falls back for scans tables math and rotated pages',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const results=await page.evaluate(async()=>{const {startAndroidPdf}=await import('/modules/android-pdf.js'),out={};for(const name of ['simple','scan','table','math','rotated']){const blob=await fetch(`/examples/${name}.pdf`).then(r=>r.blob()),result=await startAndroidPdf(new File([blob],name+'.pdf'),{mode:'reading',dpi:'96'}).promise;out[name]={fallback:result.diagnostics.some(d=>d.code==='reading-fallback'),body:result.bodyHtml,textSkip:result.diagnostics.some(d=>d.code==='text-layer-skipped')};}return out;});
 expect(results.simple.fallback).toBe(false);expect(results.simple.body).toContain('original-page');for(const name of ['scan','table','math','rotated'])expect(results[name].fallback).toBe(true);expect(results.rotated.textSkip).toBe(true);expect(results.rotated.body).not.toContain('pdf-text-layer');
});
test('Android app converts without Python API and displays original page on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.addInitScript(()=>{window.FolioAndroid={postMessage(text){const m=JSON.parse(text);queueMicrotask(()=>window.FolioAndroid.onmessage?.({data:JSON.stringify({id:m.id,ok:true})}));}};});
 const api=[];await page.route('**/api/pdf**',route=>{api.push(route.request().url());return route.abort();});
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();await page.locator('#file-input').setInputFiles('examples/simple.pdf');await expect(page.locator('#pdf-local-source img')).toBeVisible();await expect(page.locator('#export')).toBeEnabled();expect(api).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('Android reading preserves a sideways text run even when page rotation is zero',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 const result=await page.evaluate(async bytes=>{const {startAndroidPdf}=await import('/modules/android-pdf.js');return startAndroidPdf(new File([new Uint8Array(bytes)],'sideways.pdf'),{mode:'reading',dpi:'96'}).promise;},[...sidewaysTextPdf()]);
 expect(result.diagnostics.some(d=>d.code==='reading-fallback')).toBe(true);expect(result.bodyHtml).not.toContain('original-page');expect(result.bodyHtml).toContain('data:image/png;base64,');
});
