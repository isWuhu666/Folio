import {createBatchQueue} from './batch-queue.js';
import {convertBatchDocument} from './batch-convert.js';
import {buildResourceIndex} from './resources.js';
import {validateProjectSourcePath,downloadBlob} from './project.js';
import {safeFilename} from './export.js';
import {writeZip} from './zip.js';
import {isAndroid} from './platform.js';
const $=id=>document.getElementById(id);
const labels={queued:'等待',running:'处理中',done:'完成',review:'需核对',failed:'失败',cancelled:'已取消'};
export function mountBatchUI({getOptions}){
 const android=isAndroid(),maxInput=(android?60:120)*1024*1024,maxResults=(android?80:120)*1024*1024;
 let images=new Map(),settings=null,resources=null,previewId=null,packing=false,resourceWarningCount=0;
 const notice=(message,error=false)=>{$('batch-notice').textContent=message;$('batch-notice').classList.toggle('error',error);};
 const guarded=fn=>async()=>{try{await fn();}catch(error){notice(error.message,true);}};
 function currentSettings(){return {options:{...getOptions()},pdfMode:$('batch-pdf-mode').value,pdfDpi:$('batch-pdf-dpi').value,profile:$('batch-profile').value};}
 const queue=createBatchQueue({concurrency:android?1:2,maxResultsBytes:maxResults,onChange:render,run:(task,context)=>convertBatchDocument(task,{...context,settings,resources})});
 function render(){
  const focus=document.activeElement,focusedId=focus?.closest?.('.batch-row')?.dataset.id,focusedAction=focus?.textContent;
  const busy=queue.running,rows=$('batch-list');rows.replaceChildren();
  for(const task of queue.items){
   const row=document.createElement('li');row.className='batch-row';row.tabIndex=-1;row.dataset.state=task.state;row.dataset.id=task.id;
   const title=document.createElement('strong');title.textContent=task.sourcePath;
   const info=document.createElement('p');info.className='batch-progress';info.textContent=`${labels[task.state]} · ${task.progress}${task.result?` · ${(task.result.blob.size/1024).toFixed(1)} KiB · ${task.outputName}`:''}`;
   row.append(title,info);
   if(task.result?.diagnostics?.length){const warnings=document.createElement('p');warnings.className='batch-warnings';warnings.textContent=task.result.diagnostics.slice(0,3).map(d=>d.message).join('；')+(task.result.diagnostics.length>3?`；共 ${task.result.diagnostics.length} 项提示`:'');row.append(warnings);}
   const actions=document.createElement('div');actions.className='batch-actions';
   function button(text,fn,disabled=false){const b=document.createElement('button');b.type='button';b.className='small-button';b.textContent=text;b.disabled=disabled;b.onclick=guarded(fn);actions.append(b);}
   if(task.result){button('预览',()=>{previewId=task.id;$('batch-preview-title').textContent=task.outputName;$('batch-preview').srcdoc=task.result.html;$('batch-preview-dialog').showModal();});button(task.state==='review'?'核对后下载':'下载 HTML',async()=>{if(task.state==='review'&&!window.confirm(`${task.sourcePath} 仍有缺图、公式或图片问题。确认核对后，带问题标记下载？`))return;await downloadBlob(task.result.blob,task.outputName);notice(`${task.outputName} ${android?'已保存到所选位置':'已生成，请确认浏览器下载完成'}`);});}
   if(['queued','running'].includes(task.state))button('取消',()=>queue.cancel(task.id));
   if(['cancelled','failed','review'].includes(task.state))button('重试',()=>{queue.retry(task.id);$('batch-settings').open=true;notice('已加入等待队列；可补充图片或调整设置后点击开始。');},busy);
   row.append(actions);rows.append(row);
   if(task.id===focusedId){const buttons=[...actions.querySelectorAll('button:not(:disabled)')];(buttons.find(b=>b.textContent===focusedAction)||buttons[0]||row).focus({preventScroll:true});}
  }
  const count=state=>queue.items.filter(t=>t.state===state).length;
  $('batch-summary').textContent=`共 ${queue.items.length} 份 · 处理中 ${queue.active} · 完成 ${count('done')} · 需核对 ${count('review')} · 失败 ${count('failed')} · 取消 ${count('cancelled')} · 保留约 ${(queue.retainedBytes/1024/1024).toFixed(1)} MiB`;
  $('batch-resource-count').textContent=`已选 ${images.size} 张图片；按相对路径匹配，不自动猜测同名图片。`;
  for(const id of ['batch-choose','batch-folder','batch-concurrency','batch-pdf-mode','batch-pdf-dpi','batch-profile'])$(id).disabled=busy||packing;
  $('batch-start').disabled=busy||packing||!count('queued');$('batch-cancel-all').disabled=!busy&&!count('queued');$('batch-clear').disabled=busy||packing;$('batch-download-all').disabled=packing||!count('done');
 }
 async function accept(files){
  if(queue.running||packing)throw new Error('请等待任务完成后再添加文件');if(files.length>512)throw new Error('一次最多选择 512 个文件');
  const docs=files.filter(f=>/\.(md|markdown|pdf)$/i.test(f.name)),assets=files.filter(f=>/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name)),unsupported=files.filter(f=>!docs.includes(f)&&!assets.includes(f));
  if(!docs.length&&!assets.length)throw new Error('批量处理仅支持 Markdown、PDF 和图片；完整项目请从工作台打开。');
  if(queue.items.length+docs.length>20)throw new Error('一次最多保留 20 份文档，请先下载并清空任务');
  for(const f of docs){validateProjectSourcePath(f.webkitRelativePath||f.name,f.name);if(f.size>(/\.pdf$/i.test(f.name)?(android?20:40):5)*1024*1024)throw new Error(`${f.name} 超过文档大小限制`);}
  const next=new Map(images);for(const f of assets){const path=f.webkitRelativePath||f.name;if(next.has(path))throw new Error(`图片路径重复：${path}。不同文档使用同名图片时，请保留各自文件夹结构重新选择；未覆盖原图片或任务。`);next.set(path,f);}
  if(next.size>256||[...next.values()].reduce((n,f)=>n+f.size,0)>80*1024*1024)throw new Error('批量图片最多 256 张、合计 80 MiB');
  const total=[...queue.items.map(t=>t.file),...docs,...next.values()].reduce((n,f)=>n+f.size,0);if(total>maxInput)throw new Error(`批量输入合计最多 ${maxInput/1024/1024} MiB，请拆成多批`);
  const used=new Set(queue.items.map(t=>t.outputName.toLocaleLowerCase()));
  const entries=docs.map(file=>{const stem=safeFilename(file.name.replace(/\.(md|markdown|pdf)$/i,''));let name=stem+'.html',n=2;while(used.has(name.toLocaleLowerCase()))name=`${stem} (${n++}).html`;used.add(name.toLocaleLowerCase());return {file,name:file.name,sourcePath:file.webkitRelativePath||file.name,outputName:name};});
  images=next;queue.add(entries);render();notice(`已添加 ${docs.length} 份文档、${assets.length} 张图片${unsupported.length?'；未处理：'+unsupported.map(f=>f.name).join('、'):''}。开始前可继续添加图片；成品仅保留在本次页面，请下载备份。`,!!unsupported.length);
 }
 $('batch-choose').onclick=()=>$('batch-input').click();$('batch-folder').onclick=()=>$('batch-folder-input').click();
 for(const id of ['batch-input','batch-folder-input'])$(id).onchange=async e=>{try{await accept([...e.target.files]);}catch(error){notice(error.message,true);}finally{e.target.value='';}};
 $('batch-start').onclick=guarded(()=>{settings=currentSettings();resourceWarningCount=0;resources=buildResourceIndex([...images.values()]).then(index=>{resourceWarningCount=index.diagnostics.length;if(resourceWarningCount)notice(`资源集合有 ${resourceWarningCount} 项提示，仅影响实际引用对应图片的任务，请逐项核对。`);return index;});resources.catch(()=>{});queue.setConcurrency(Number($('batch-concurrency').value));$('batch-settings').open=false;notice('正在处理；可关闭面板继续编辑，刷新页面会丢失尚未下载的批量结果。');queue.start();queue.idle().then(()=>notice(`批量处理已结束。${resourceWarningCount?`资源集合有 ${resourceWarningCount} 项提示，请核对相关任务；`:''}结果仅保留在本次页面，刷新前请下载。`));});
 $('batch-cancel-all').onclick=()=>queue.cancelAll();
 $('batch-clear').onclick=guarded(()=>{if(queue.items.some(t=>t.result)&&!window.confirm('将清空本次批量结果。确认已经下载需要保留的成品？'))return;queue.clear();images.clear();resources=null;settings=null;previewId=null;$('batch-preview').srcdoc='';notice('批量任务已清空');render();});
 $('batch-download-all').onclick=guarded(async()=>{packing=true;render();try{const completed=queue.items.filter(t=>t.state==='done'&&t.result);const skipped=queue.items.length-completed.length;const zip=await writeZip(completed.map(t=>[t.outputName,t.result.blob]));await downloadBlob(zip,'Folio-批量成品.zip');notice(`已打包 ${completed.length} 份可直接导出的成品${skipped?`；其余 ${skipped} 份未打包，请逐项核对` :''}。请确认保存完成。`);}finally{packing=false;render();}});
 $('batch-close').onclick=()=>$('batch-dialog').close();$('batch-preview-close').onclick=()=>{$('batch-preview-dialog').close();$('batch-preview').srcdoc='';previewId=null;};
 $('batch-preview-dialog').addEventListener('close',()=>{$('batch-preview').srcdoc='';previewId=null;});
 window.addEventListener('beforeunload',e=>{if(queue.running||queue.items.some(t=>t.result)){e.preventDefault();e.returnValue='';}});
 if(android){$('batch-concurrency').value='1';$('batch-pdf-dpi').value='96';$('batch-folder-input').removeAttribute('webkitdirectory');$('batch-folder').textContent='添加图片';$('batch-folder-input').accept='.png,.jpg,.jpeg,.webp,.gif,.svg';}
 render();return {open(){$('batch-dialog').showModal();},queue};
}
