import {renderMarkdown} from './markdown.js';
import {typesetDocument} from './math.js';
import {pdfResultToDraft} from './document.js';
import {readMarkdown} from './text-input.js';
import {prepareOutput} from './output.js';
import {startPdfJob} from './pdf-job.js';
const abort=()=>new DOMException('批量任务已取消','AbortError');
function pause(ms,signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(abort());return;}const done=()=>{signal.removeEventListener('abort',stop);resolve();},timer=setTimeout(done,ms),stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(abort());};signal.addEventListener('abort',stop,{once:true});});}
async function waitForPdfCapacity(signal,deadline){
 while(true){
  if(Date.now()>deadline)throw new Error('等待 PDF 转换名额超时，请稍后重试。');
  await pause(500,signal);const response=await fetch('/api/pdf/capacity',{signal});
  if(!response.ok)throw new Error('无法读取 PDF 并发状态，请确认本机服务仍在运行。');
  const capacity=await response.json();if(capacity.available===true)return;
 }
}
export async function convertBatchDocument(task,{signal,onProgress,settings,resources}){
 const check=()=>{if(signal.aborted)throw abort();};check();let draft;
 await pause(0,signal);
 if(/\.pdf$/i.test(task.file.name)){
  // A foreground conversion may occupy a slot. Wait only for explicit capacity responses.
  const deadline=Date.now()+180000;
  while(true){
   check();onProgress('等待 PDF 转换名额');
   const job=startPdfJob(task.file,{mode:settings.pdfMode,dpi:settings.pdfDpi,pages:'',onProgress:p=>onProgress(p.total?`PDF 已处理 ${p.completed||0} / ${p.total} 页`:'PDF 正在读取页数')});
   const cancel=()=>{job.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
   try{draft=pdfResultToDraft(await job.promise);draft.title=task.file.name.replace(/\.pdf$/i,'');break;}
   catch(error){check();if(error.code!=='pdf_busy'||!error.retryable||Date.now()>deadline)throw error;await waitForPdfCapacity(signal,deadline);}
   finally{signal.removeEventListener('abort',cancel);if(signal.aborted)try{await job.cancel();}catch{}}
  }
 }else{
  onProgress('校验编码并解析正文');const text=await readMarkdown(task.file);check();
  const index=await resources;check();draft=renderMarkdown(text,index,task.sourcePath,{onlyReferencedResources:true});
 }
 check();onProgress('排版公式与准备成品');const model=await typesetDocument(draft,settings.options,()=>!signal.aborted);check();
 const review=!!model.missingAssets.length||model.diagnostics.some(d=>['math-error','math-unclosed','image-invalid'].includes(d.code));
 const html=await prepareOutput(model,settings.options,settings.profile,true);check();
 return {html,blob:new Blob([html],{type:'text/html;charset=utf-8'}),review,diagnostics:model.diagnostics,title:model.title};
}
