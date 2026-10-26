const abort=()=>new DOMException('转换已取消','AbortError');
export function startPdfJob(file,{mode,dpi,pages='',onProgress=()=>{}}){
 if(isAndroid())return startAndroidPdf(file,{mode,dpi,pages,onProgress});
 let identity=null,cancelled=false,cancelPromise=null;
 async function cancelRemote(){
  if(!identity)return;
  cancelPromise||=fetch(`/api/pdf/jobs/${identity.id}/cancel`,{method:'POST',headers:{'X-Folio-Request':'1','X-Folio-Job':identity.token}}).then(async r=>{if(!r.ok&&r.status!==404)throw new Error('后台取消未确认，请稍后重试');});
  await cancelPromise;
 }
 const promise=(async()=>{
  const query=new URLSearchParams({mode,dpi,pages});
  const response=await fetch('/api/pdf/jobs?'+query,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','X-Folio-Request':'1'}}),created=await response.json();
  if(!response.ok)throw Object.assign(new Error(created.error||'PDF 转换未能开始'),{code:created.code,retryable:created.retryable});identity=created;
  if(cancelled){await cancelRemote();throw abort();}
  while(true){
   const r=await fetch(`/api/pdf/jobs/${identity.id}`,{headers:{'X-Folio-Job':identity.token}}),job=await r.json();
   if(!r.ok)throw new Error(job.error||'无法读取转换进度');
   if(cancelled){await cancelRemote();throw abort();}
   onProgress(job);
   if(job.state==='completed')return job.result;
   if(job.state==='cancelled')throw abort();
   if(job.state==='failed')throw new Error(job.error||'PDF 转换失败');
   await new Promise(resolve=>setTimeout(resolve,300));
  }
 })();
 return {promise,async cancel(){cancelled=true;await cancelRemote();try{await promise;}catch(error){if(error.name!=='AbortError')throw error;}}};
}
import {isAndroid} from './platform.js';
// Return a cancellable handle even while the Android engine module is loading.
function startAndroidPdf(file,options){
 let job,cancelled=false,rejectCancel;
 const cancellation=new Promise((_,reject)=>{rejectCancel=reject;});
 const conversion=import('./android-pdf.js').then(module=>{
  if(cancelled)throw abort();
  job=module.startAndroidPdf(file,options);return job.promise;
 });
 const promise=Promise.race([conversion,cancellation]);promise.catch(()=>{});
 return {promise,async cancel(){
  cancelled=true;rejectCancel(abort());
  if(job)await job.cancel();
  try{await promise;}catch(error){if(error.name!=='AbortError')throw error;}
 }};
}
