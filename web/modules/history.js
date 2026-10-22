// Explicit local snapshots. No document content enters localStorage or server logs.
let opening;
function open(){return opening||=new Promise((resolve,reject)=>{const r=indexedDB.open('folio-projects',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('projects'))r.result.createObjectStore('projects',{keyPath:'id'});if(!r.result.objectStoreNames.contains('meta'))r.result.createObjectStore('meta');};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};r.onblocked=()=>reject(new Error('请关闭旧版项目快照标签页后重试'));r.onerror=()=>reject(new Error('无法打开本机项目记录'));}).catch(error=>{opening=null;throw error;});}
async function transact(mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('projects',mode),r=action(tx.objectStore('projects'));tx.oncomplete=()=>resolve(r?.result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('本机项目记录未保存'));});}
export const listSnapshots=async()=>((await transact('readonly',s=>s.getAll()))||[]).sort((a,b)=>b.updatedAt-a.updatedAt);
export async function snapshotEpoch(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('meta','readonly'),r=tx.objectStore('meta').get('epoch');tx.oncomplete=()=>resolve(r.result||'0');tx.onerror=()=>reject(new Error('无法读取快照状态'));});}
export async function saveSnapshot(name,blob,expectedEpoch){
 if(blob.size>130*1024*1024)throw new Error('项目过大，无法保存快照');
 const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction(['projects','meta'],'readwrite'),s=tx.objectStore('projects'),epoch=tx.objectStore('meta').get('epoch');let cleared=false;
  epoch.onsuccess=()=>{if((epoch.result||'0')!==expectedEpoch){cleared=true;tx.abort();return;}const r=s.getAll();r.onsuccess=()=>{const rows=r.result.sort((a,b)=>b.updatedAt-a.updatedAt);let size=blob.size,count=1;for(const row of rows){if(count>=5||size+row.blob.size>150*1024*1024)s.delete(row.id);else{size+=row.blob.size;count++;}}s.put({id:crypto.randomUUID(),name,blob,updatedAt:Date.now()});};};
  tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(new Error(cleared?'快照已被清除，取消了此前尚未完成的保存':'快照保存失败，可能是浏览器空间不足，请下载项目备份'));
 });
}
export const deleteSnapshot=id=>transact('readwrite',s=>s.delete(id));
export async function clearSnapshots(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(['projects','meta'],'readwrite');tx.objectStore('projects').clear();tx.objectStore('meta').put(crypto.randomUUID(),'epoch');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(new Error('快照未能清除，请重试'));});}
