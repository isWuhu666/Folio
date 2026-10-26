import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const phase=process.env.FOLIO_LOADING_PHASE||'after';
async function record(name,result){await mkdir('artifacts/loading-results',{recursive:true});await writeFile(`artifacts/loading-results/${phase}-${name}.json`,JSON.stringify(result,null,2));}
async function isolated(page){await page.goto('/api/health');}

test('resource reads overlap within a three-file bound and retain input order',async({page})=>{
 await isolated(page);await page.addScriptTag({url:'/vendor/purify.min.js'});
 const result=await page.evaluate(async()=>{
  const {buildResourceIndex}=await import('/modules/resources.js');let active=0,maxActive=0,reads=0;
  const files=Array.from({length:9},(_,i)=>{const file=new File([`<svg xmlns="http://www.w3.org/2000/svg"><text>${i}</text><script>bad()</script></svg>`],i<2?'duplicate.svg':`${i}.svg`,{type:'image/svg+xml'});const text=file.text.bind(file);file.text=async()=>{reads++;active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,i===0?100:40));active--;return text();};return file;});
  const start=performance.now(),index=await buildResourceIndex(files),elapsedMs=performance.now()-start;
  const repeatStart=performance.now();await buildResourceIndex(files);const repeatMs=performance.now()-repeatStart;
  return {elapsedMs,repeatMs,maxActive,reads,paths:[...index.entries.keys()],duplicates:index.entries.get('duplicate.svg').map(u=>atob(u.split(',')[1])),warnings:index.diagnostics.map(d=>d.resourcePath)};
 });await record('resources',result);
 expect(result.paths).toEqual(['duplicate.svg',...Array.from({length:7},(_,i)=>`${i+2}.svg`)]);
 expect(result.duplicates[0]).toContain('>0<');expect(result.duplicates[1]).toContain('>1<');
 expect(result.warnings).toEqual(['duplicate.svg','duplicate.svg',...Array.from({length:7},(_,i)=>`${i+2}.svg`)]);
 expect(result.maxActive).toBeGreaterThan(1);expect(result.maxActive).toBeLessThanOrEqual(3);
});

test('same immutable File reuses validated bytes while failed reads retry and same names stay distinct',async({page})=>{
 await isolated(page);await page.addScriptTag({url:'/vendor/purify.min.js'});
 const result=await page.evaluate(async()=>{
  const {buildResourceIndex}=await import('/modules/resources.js');let reads=0;
  const file=new File(['<svg xmlns="http://www.w3.org/2000/svg"><text>one</text></svg>'],'same.svg');const read=file.text.bind(file);file.text=async()=>{reads++;if(reads===1)throw new Error('temporary read failure');return read();};
  const failed=await buildResourceIndex([file]);const [a,b]=await Promise.all([buildResourceIndex([file]),buildResourceIndex([file])]);
  const other=await buildResourceIndex([new File(['<svg xmlns="http://www.w3.org/2000/svg"><text>two</text></svg>'],'same.svg')]);
  return {reads,failed:failed.diagnostics.length,first:a.entries.get('same.svg'),second:b.entries.get('same.svg'),other:other.entries.get('same.svg')};
 });expect(result.failed).toBe(1);expect(result.first).toEqual(result.second);expect(result.other).not.toEqual(result.first);expect(result.reads).toBe(2);
});

test('plain documents finish while an unrelated MathJax startup is pending',async({page})=>{
 await isolated(page);
 await page.route('**/vendor/mathjax/tex-svg.js',async route=>{await new Promise(r=>setTimeout(r,600));await route.abort();});
 const result=await page.evaluate(async()=>{
  const {typesetDocument}=await import('/modules/math.js');const draft={bodyHtml:'<span data-folio-math="m1"></span>',math:[{id:'m1',tex:'x',display:false}],diagnostics:[]};
  const math=typesetDocument(draft).catch(()=>{});await new Promise(r=>setTimeout(r,20));
  const start=performance.now();await typesetDocument({bodyHtml:'<p>plain</p>',math:[],diagnostics:[]});const elapsedMs=performance.now()-start;await math;return {elapsedMs};
 });await record('plain-math-queue',result);expect(result.elapsedMs).toBeLessThan(150);
});

test('desktop PDF jobs do not load the Android conversion module',async({page})=>{
 await isolated(page);const requests=[];page.on('request',request=>{if(request.url().includes('/modules/android-pdf.js'))requests.push(request.url());});
 await page.evaluate(()=>import('/modules/pdf-job.js'));expect(requests).toEqual([]);
});

test('Android PDF cancellation works before its lazy module has loaded',async({page})=>{
 await isolated(page);let release;const gate=new Promise(r=>release=r);let requested;const started=new Promise(r=>requested=r);
 await page.route('**/modules/android-pdf.js',async route=>{requested();await gate;await route.continue();});
 const job=page.evaluate(async()=>{window.FolioAndroid={postMessage(){}};const {startPdfJob}=await import('/modules/pdf-job.js');const job=startPdfJob(new File(['%PDF-bad'],'test.pdf'),{mode:'faithful',dpi:'96'});window.loadingPdfJob=job;return !!job.promise&&typeof job.cancel==='function';});
 // A lazy import must return the cancellable job before the engine response arrives.
 const returned=await Promise.race([job,new Promise(r=>setTimeout(()=>r(false),500))]);
 if(!returned){release();await job;expect(returned).toBe(true);return;}
 await started;
 const cancelled=await page.evaluate(async()=>{const job=window.loadingPdfJob;const cancellation=job.cancel();const state=await Promise.race([job.promise.then(()=> 'completed',e=>e.name),new Promise(r=>setTimeout(()=>r('pending'),200))]);await cancellation;return state;});
 release();expect(cancelled).toBe('AbortError');
});

test('concurrent numbered math documents keep independent numbering and label references',async({page})=>{
 await isolated(page);
 const result=await page.evaluate(async()=>{
  const {typesetDocument}=await import('/modules/math.js');
  const make=()=>({bodyHtml:'<span data-folio-math="n1"></span><span data-folio-math="n2"></span>',math:[{id:'n1',tex:'\\begin{equation}x=1\\label{shared}\\end{equation}',display:true},{id:'n2',tex:'\\eqref{shared}',display:false}],diagnostics:[]});
  const models=await Promise.all([typesetDocument(make()),typesetDocument(make())]);
  return models.map(model=>({html:model.bodyHtml,diagnostics:model.diagnostics}));
 });
 expect(result[0].diagnostics).toEqual([]);expect(result[1].diagnostics).toEqual([]);
 for(const model of result){expect(model.html).toContain('open paren 1 close paren');expect(model.html).not.toContain('open paren 2 close paren');}
});

test('PDF capacity rejection preserves its machine-readable retry contract',async({page})=>{
 await isolated(page);await page.route('**/api/pdf/jobs?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'busy',code:'pdf_busy',retryable:true})}));
 const result=await page.evaluate(async()=>{const {startPdfJob}=await import('/modules/pdf-job.js');try{await startPdfJob(new File(['%PDF-'],'x.pdf'),{mode:'faithful',dpi:'96'}).promise;}catch(error){return {message:error.message,code:error.code,retryable:error.retryable};}});
 expect(result).toEqual({message:'busy',code:'pdf_busy',retryable:true});
});

test('independent resource indexes share a global three-file validation bound',async({page})=>{
 await isolated(page);await page.addScriptTag({url:'/vendor/purify.min.js'});
 const result=await page.evaluate(async()=>{
  const {buildResourceIndex}=await import('/modules/resources.js');let active=0,peak=0;
  const make=(prefix)=>Array.from({length:6},(_,i)=>{const file=new File([`<svg xmlns="http://www.w3.org/2000/svg"><text>${prefix}${i}</text></svg>`],`${prefix}${i}.svg`);const read=file.text.bind(file);file.text=async()=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,30));return await read();}finally{active--;}};return file;});
  const a=make('a'),b=make('b'),indexes=await Promise.all([buildResourceIndex(a),buildResourceIndex(b)]);
  return {peak,paths:indexes.map(index=>[...index.entries.keys()])};
 });await record('global-resource-bound',result);expect(result.paths).toEqual([Array.from({length:6},(_,i)=>`a${i}.svg`),Array.from({length:6},(_,i)=>`b${i}.svg`)]);expect(result.peak).toBeGreaterThan(1);expect(result.peak).toBeLessThanOrEqual(3);
});

test('separate math module copies share one engine startup and numbering queue',async({page})=>{
 await isolated(page);
 const result=await page.evaluate(async()=>{
  const [one,two]=await Promise.all([import('/modules/math.js?copy=one'),import('/modules/math.js?copy=two')]);
  const make=()=>({bodyHtml:'<span data-folio-math="c1"></span><span data-folio-math="c2"></span>',math:[{id:'c1',tex:'\\begin{equation}x=1\\label{copy}\\end{equation}',display:true},{id:'c2',tex:'\\eqref{copy}',display:false}],diagnostics:[]});
  const models=await Promise.allSettled([one.typesetDocument(make()),two.typesetDocument(make())]);
  return {scripts:document.querySelectorAll('script[src="/vendor/mathjax/tex-svg.js"]').length,models:models.map(result=>result.status==='fulfilled'?{html:result.value.bodyHtml,diagnostics:result.value.diagnostics}:{error:result.reason.message})};
 });
 expect(result.scripts).toBe(1);
 for(const model of result.models){expect(model.error).toBeUndefined();expect(model.diagnostics).toEqual([]);expect(model.html).toContain('open paren 1 close paren');expect(model.html).not.toContain('open paren 2 close paren');}
});
