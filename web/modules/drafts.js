// IndexedDB transactions, including Blob resources, commit atomically.
export function createDraftStore(){
 let opening;
 function open(){
  if(!opening)opening=new Promise((resolve,reject)=>{
   const request=indexedDB.open('folio-workspace',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
   request.onerror=()=>reject(request.error||new Error('浏览器存储不可用'));
   request.onblocked=()=>reject(new Error('草稿存储被其他标签页阻塞，请关闭旧标签页后重试'));
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
  }).catch(error=>{opening=null;throw error;});
  return opening;
 }
 async function transaction(mode,action){
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('drafts',mode),request=action(tx.objectStore('drafts'));
   tx.oncomplete=()=>resolve(request.result);
   tx.onabort=tx.onerror=()=>reject(tx.error||new Error('草稿保存未完成'));
  });
 }
 return {
  load:()=>transaction('readonly',s=>s.get('current')),
  async save(value,expectedWriteId=null){
   // Never replace a recoverable record with content the restore path rejects.
   validateDraft(value);
   const db=await open(),writeId=crypto.randomUUID();
   return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite'),s=tx.objectStore('drafts'),request=s.get('current');let conflict=false;
    request.onsuccess=()=>{
     if((request.result?.writeId||null)!==expectedWriteId){conflict=true;tx.abort();return;}
     s.put({...value,writeId},'current');
    };
    tx.oncomplete=()=>resolve(writeId);
    tx.onabort=tx.onerror=()=>reject(conflict?new Error('其他标签页已更新草稿，请先保存当前原文，再刷新选择恢复。'):tx.error||new Error('草稿保存未完成'));
   });
  },
  async clear(expectedWriteId=undefined){
   const db=await open(),writeId=crypto.randomUUID();
   return new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite'),s=tx.objectStore('drafts'),request=s.get('current');let conflict=false;
    request.onsuccess=()=>{
     if(expectedWriteId!==undefined&&(request.result?.writeId||null)!==expectedWriteId){conflict=true;tx.abort();return;}
     // A content-free tombstone also prevents an older queued save resurrecting cleared resources.
     s.put({cleared:true,writeId},'current');
    };
    tx.oncomplete=()=>resolve(writeId);
    tx.onabort=tx.onerror=()=>reject(conflict?new Error('其他标签页已更新草稿，未删除新内容。请重新打开恢复页面。'):tx.error||new Error('草稿清除未完成'));
   });
  },
 };
}

export function packFile(file){return file?{blob:file,name:file.name,path:file.webkitRelativePath||file.name}:null;}
export function unpackFile(value){
 if(!value||!(value.blob instanceof Blob)||typeof value.name!=='string'||typeof value.path!=='string')throw new Error('草稿资源无效，请保留原始文件重新导入');
 const file=new File([value.blob],value.name,{type:value.blob.type});
 Object.defineProperty(file,'webkitRelativePath',{value:value.path});return file;
}
export function validateDraft(value){
 if(!value||value.version!==1||typeof value.text!=='string'||new Blob([value.text]).size>5*1024*1024||typeof value.sourcePath!=='string'||value.sourcePath.length>1000||!Array.isArray(value.resources)||value.resources.length>256)throw new Error('草稿格式或大小无效，未覆盖任何内容');
 for(const record of [...(value.file?[value.file]:[]),...value.resources]){
  if(!record||!(record.blob instanceof Blob)||typeof record.name!=='string'||typeof record.path!=='string')throw new Error('草稿资源无效，请保留原始文件重新导入');
 }
 if(value.resources.reduce((n,r)=>n+(r?.blob?.size||0),0)>80*1024*1024||(value.file?.blob?.size||0)>40*1024*1024)throw new Error('草稿资源超过大小限制');
 return value;
}

// Legacy records can fail restore validation and still contain valuable text.
// Keep rescue independent of resource/metadata validation, with an explicit bound.
export function rescueDraftText(value){
 if(typeof value?.text!=='string'||new Blob([value.text]).size>20*1024*1024)throw new Error('草稿原文不可救援或超过 20 MiB 限制，请保留浏览器数据并从原文件重新导入');
 const candidate=typeof value.sourcePath==='string'?value.sourcePath.split(/[\\/]/).at(-1):'';
 const name=candidate&&candidate.length<=200&&!/[\x00-\x1f<>:"|?*]/.test(candidate)&&/\.(md|markdown|txt)$/i.test(candidate)?candidate:'草稿救援.txt';
 return {text:value.text,name};
}
