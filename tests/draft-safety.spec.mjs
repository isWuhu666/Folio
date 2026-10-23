import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('autosave rejects an oversized replacement and preserves the previous recoverable draft',async({page})=>{
 await page.goto('/modules/drafts.js');
 const result=await page.evaluate(async()=>{
  const {createDraftStore,validateDraft}=await import('/modules/drafts.js'),store=createDraftStore();
  const previous={version:1,text:'# 可以恢复',sourcePath:'notes.md',resources:[],file:null};
  const writeId=await store.save(previous);let error='';
  try{await store.save({...previous,text:'x'.repeat(5*1024*1024+1)},writeId);}catch(e){error=e.message;}
  const stored=await store.load();return {error,text:validateDraft(stored).text,writeId:stored.writeId,previousId:writeId};
 });
 expect(result.error).toContain('草稿');expect(result.text).toBe('# 可以恢复');expect(result.writeId).toBe(result.previousId);
});

test('autosave rejects malformed resources before overwriting a recoverable draft',async({page})=>{
 await page.goto('/modules/drafts.js');
 const result=await page.evaluate(async()=>{
  const {createDraftStore}=await import('/modules/drafts.js'),store=createDraftStore();
  const previous={version:1,text:'previous',sourcePath:'notes.md',resources:[],file:null};
  const writeId=await store.save(previous);let rejected=false;
  try{await store.save({...previous,resources:[{name:'bad.png',path:'bad.png',blob:'not a blob'}]},writeId);}catch{rejected=true;}
  return {rejected,text:(await store.load()).text};
 });
 expect(result).toEqual({rejected:true,text:'previous'});
});

test('legacy invalid draft offers complete bounded text rescue without resource validation',async({page})=>{
 await page.goto('/modules/drafts.js');
 const result=await page.evaluate(async()=>{
  const {rescueDraftText}=await import('/modules/drafts.js');
  const text='原'.repeat(2*1024*1024),rescued=rescueDraftText({text,sourcePath:'folder/report.md',resources:'corrupt',file:{blob:null}});
  return {same:rescued.text===text,name:rescued.name};
 });
 expect(result).toEqual({same:true,name:'report.md'});
});

test('text rescue rejects missing or excessive text and gives unsafe legacy names a safe fallback',async({page})=>{
 await page.goto('/modules/drafts.js');
 const result=await page.evaluate(async()=>{
  const {rescueDraftText}=await import('/modules/drafts.js');let rejected=0;
  for(const value of [null,{text:42},{text:'x'.repeat(20*1024*1024+1)}])try{rescueDraftText(value);}catch{rejected++;}
  return {rejected,fallback:rescueDraftText({text:'safe',sourcePath:'bad\u0000.pdf'}).name};
 });
 expect(result).toEqual({rejected:3,fallback:'草稿救援.txt'});
});

test('oversized editor autosave reports failure and keeps the previous valid draft',async({page})=>{
 await page.goto('/');await expect(page.locator('#export')).toBeEnabled();
 await page.locator('#editor').fill('# 保留上一份草稿');await expect(page.locator('#save-state')).toContainText('已保存');
 await page.evaluate(()=>{const editor=document.getElementById('editor');editor.value='x'.repeat(5*1024*1024+1);editor.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect(page.locator('#save-state')).toContainText('保存失败');
 expect(await page.evaluate(async()=>{const {createDraftStore}=await import('/modules/drafts.js');return (await createDraftStore().load()).text;})).toBe('# 保留上一份草稿');
});

test('recovery dialog rescues complete oversized legacy text without restoring or clearing it',async({page})=>{
 await page.goto('/modules/drafts.js');
 await page.evaluate(async()=>{
  const {createDraftStore}=await import('/modules/drafts.js');await createDraftStore().load();
  await new Promise((resolve,reject)=>{const request=indexedDB.open('folio-workspace',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({version:1,text:'x'.repeat(5*1024*1024)+'救援尾部',sourcePath:'legacy.md',resources:'broken',updatedAt:Date.now()},'current');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
 });
 await page.goto('/');await expect(page.locator('#recovery')).toBeVisible();
 const downloading=page.waitForEvent('download');await page.locator('#backup-draft').click();const download=await downloading;
 expect(download.suggestedFilename()).toBe('legacy.md');
 const text=await readFile(await download.path(),'utf8');expect(text).toHaveLength(5*1024*1024+4);expect(text.endsWith('救援尾部')).toBe(true);
 await expect(page.locator('#recovery')).toBeVisible();
 expect(await page.evaluate(async()=>{const {createDraftStore}=await import('/modules/drafts.js');return (await createDraftStore().load()).text.length;})).toBe(text.length);
});

test('recovery project backup preserves source resources and settings without dismissing recovery',async({page})=>{
 await page.goto('/modules/drafts.js');
 await page.evaluate(async()=>{
  const {createDraftStore,packFile}=await import('/modules/drafts.js');
  const text='# 完整草稿\n\n![图](image.svg)',file=new File([text],'notes.md',{type:'text/markdown'}),image=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="green"/></svg>'],'image.svg',{type:'image/svg+xml'});
  await createDraftStore().save({version:1,text,sourcePath:'notes.md',file:packFile(file),resources:[packFile(image)],options:{theme:'academic',fontSize:19},updatedAt:Date.now()});
 });
 await page.goto('/');await expect(page.locator('#recovery')).toBeVisible();
 const downloading=page.waitForEvent('download');await page.locator('#backup-project-draft').click();const download=await downloading;
 expect(download.suggestedFilename()).toBe('notes.folio');
 const bytes=await readFile(await download.path());
 const result=await page.evaluate(async bytes=>{const {decodeProject}=await import('/modules/project.js'),draft=await decodeProject(new Blob([new Uint8Array(bytes)]));return {text:draft.text,source:await draft.file.blob.text(),names:draft.resources.map(r=>r.name),theme:draft.options.theme,fontSize:draft.options.fontSize};},[...bytes]);
 expect(result).toEqual({text:'# 完整草稿\n\n![图](image.svg)',source:'# 完整草稿\n\n![图](image.svg)',names:['image.svg'],theme:'academic',fontSize:19});
 await expect(page.locator('#recovery')).toBeVisible();
});
