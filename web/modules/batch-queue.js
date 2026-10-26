const abort=()=>new DOMException('任务已取消','AbortError');
export function createBatchQueue({run,concurrency=2,maxItems=20,maxResultsBytes=120*1024*1024,onChange=()=>{}}){
 const items=[];let active=0,started=false,retainedBytes=0;const waiters=[];
 const changed=()=>onChange(items);
 function settled(){if(!active&&(!started||!items.some(t=>t.state==='queued'))){started=false;for(const resolve of waiters.splice(0))resolve();}changed();}
 function pump(){
  if(!started)return;
  while(active<concurrency){
   const task=items.find(t=>t.state==='queued');if(!task)break;
   const controller=new AbortController();task.controller=controller;task.state='running';task.progress='准备处理';active++;changed();
   Promise.resolve().then(()=>{if(controller.signal.aborted)throw abort();return run(task,{signal:controller.signal,onProgress:message=>{if(task.state==='running'&&task.progress!==message){task.progress=message;changed();}}});})
    .then(result=>{
     if(controller.signal.aborted)throw abort();
     if(!(result?.blob instanceof Blob))throw new Error('任务没有生成有效成品');
     const size=result.blob.size+(typeof result.html==='string'?new Blob([result.html]).size:0);
     if(retainedBytes+size>maxResultsBytes)throw new Error('批量结果达到内存保留上限，请先下载并清空已完成结果，再重试。');
     retainedBytes+=size;task.retainedSize=size;task.result=result;task.state=result.review?'review':'done';task.progress=result.review?'有问题需要核对':'已完成';
    }).catch(error=>{task.state=controller.signal.aborted||error.name==='AbortError'?'cancelled':'failed';task.error=error.message;task.progress=task.state==='cancelled'?'已取消':error.message;})
    .finally(()=>{active--;delete task.controller;pump();settled();});
  }
  settled();
 }
 return {
  items,get active(){return active;},get retainedBytes(){return retainedBytes;},get running(){return started||active>0;},
  add(entries){if(this.running)throw new Error('请等待当前批量任务完成后再添加文件');if(items.length+entries.length>maxItems)throw new Error(`一次最多保留 ${maxItems} 份文档，请先下载并清空任务。`);const added=entries.map(entry=>({...entry,id:crypto.randomUUID(),state:'queued',progress:'等待处理',result:null}));items.push(...added);changed();return added;},
  setConcurrency(value){if(!Number.isInteger(value)||value<1||value>2)throw new Error('并发数只能为 1 或 2');concurrency=value;pump();},
  start(){started=true;pump();},
  cancel(id){const task=items.find(t=>t.id===id);if(!task)return;if(task.state==='queued'){task.state='cancelled';task.progress='已取消';}else if(task.state==='running'){task.progress='取消中，正在清理';task.controller.abort();}settled();},
  cancelAll(){for(const task of items)this.cancel(task.id);},
  retry(id){if(this.running)throw new Error('请等待当前任务完成后再重试');const task=items.find(t=>t.id===id);if(!task||!['failed','cancelled','review'].includes(task.state))return;retainedBytes-=task.retainedSize||0;task.retainedSize=0;task.result=null;task.error='';task.state='queued';task.progress='等待重试';changed();},
  clear(){if(this.running)throw new Error('请先取消任务并等待后台清理完成');items.length=0;retainedBytes=0;changed();},
  idle(){return !active&&(!started||!items.some(t=>t.state==='queued'))?Promise.resolve():new Promise(resolve=>waiters.push(resolve));},
 };
}
