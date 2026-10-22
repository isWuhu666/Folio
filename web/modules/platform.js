// Native messaging is installed only for the app's trusted top-level origin.
export const isAndroid=()=>!!window.FolioAndroid?.postMessage;
let queue=Promise.resolve(),listening=false;
const awaiting=new Map();
function listen(){
 if(listening)return;listening=true;
 window.FolioAndroid.onmessage=event=>{
  let reply;try{reply=JSON.parse(event.data);}catch{return;}
  const pending=awaiting.get(reply.id);if(!pending)return;awaiting.delete(reply.id);clearTimeout(pending.timer);
  if(reply.error)pending.reject(reply.cancelled?new DOMException(reply.error,'AbortError'):new Error(reply.error));else if(reply.ok)pending.resolve(reply);else pending.reject(new Error('安卓保存返回无效确认'));
 };
}
function send(message,timeout=30000){
 listen();return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{awaiting.delete(message.id);reject(new Error('安卓文件操作未完成，请重试'));},timeout);awaiting.set(message.id,{resolve,reject,timer});
  try{window.FolioAndroid.postMessage(JSON.stringify(message));}catch(error){clearTimeout(timer);awaiting.delete(message.id);reject(error);}
 });
}
function cleanName(name){return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,140)||'Folio.html';}
export function saveFile(blob,name){
 if(!(blob instanceof Blob))return Promise.reject(new Error('保存内容无效'));
 name=cleanName(name);
 if(!isAndroid()){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);return Promise.resolve();
 }
 const job=queue.catch(()=>{}).then(async()=>{
  if(blob.size>130*1024*1024)throw new Error('安卓单次保存上限 130 MiB，请减少资源');
  // Generic binary preserves unknown extensions and keeps collision suffixes
  // before .folio. ZIP or unknown custom MIME types break Android naming.
  const id=crypto.randomUUID(),mime=/\.folio$/i.test(name)?'application/octet-stream':blob.type||(/\.zip$/i.test(name)?'application/zip':'application/octet-stream');
  try{
   await send({id,op:'begin',name,mime,size:blob.size},180000);
   for(let offset=0;offset<blob.size;offset+=128*1024){
    const bytes=new Uint8Array(await blob.slice(offset,offset+128*1024).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    await send({id,op:'chunk',data:btoa(binary)});
   }
   await send({id,op:'finish'});
  }catch(error){try{window.FolioAndroid.postMessage(JSON.stringify({id,op:'abort'}));}catch{}throw error;}
 });
 queue=job.catch(()=>{});return job;
}
export async function requestPrint(html){
 if(!isAndroid())throw new Error('原生打印仅在安卓应用可用');
 if(new Blob([html]).size>8*1024*1024)throw new Error('打印内容超过 8 MiB，请先选择分享预设或导出 HTML 后打印');
 await send({id:crypto.randomUUID(),op:'print',html},60000);
}
