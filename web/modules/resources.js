const MAX_ASSETS=80*1024*1024;
const raster=new Set(['image/png','image/jpeg','image/webp','image/gif']);
function normalize(s){
 if(/^[a-z][a-z\d+.-]*:|^\/|^\\/i.test(s))return null;
 const parts=[];
 for(const p of s.replaceAll('\\','/').split('/')){
  if(!p||p==='.')continue;
  if(p==='..'){if(!parts.length)return null;parts.pop();}else parts.push(p);
 }
 return parts.join('/');
}
function dataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error(`无法读取图片：${file.name}`));r.readAsDataURL(file);});}
function svgData(text){
 const clean=DOMPurify.sanitize(text,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['script','foreignObject','style','image','use','animate','set','a']});
 // DOMPurify may report its HTML parser's synthetic BODY wrapper as removed.
 // Only changes to the supplied SVG content should trigger a warning.
 let sanitized=DOMPurify.removed.some(r=>r.attribute||r.element?.localName!=='body');
 const doc=new DOMParser().parseFromString(clean,'image/svg+xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw new Error('SVG 文件无效');
 for(const el of doc.querySelectorAll('*'))for(const a of [...el.attributes]){
  if(/^on/i.test(a.name)||/href$/i.test(a.name)||/url\s*\(/i.test(a.value)){el.removeAttribute(a.name);sanitized=true;}
 }
 const bytes=new TextEncoder().encode(new XMLSerializer().serializeToString(doc.documentElement));
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return {url:'data:image/svg+xml;base64,'+btoa(binary),sanitized};
}
// File bytes are immutable; identity caching never trusts a filename or skips validation.
const validatedFiles=new WeakMap();
// Foreground imports and batch imports share the same decoding budget.
let activeValidations=0;
const validationWaiters=[];
function acquireValidationSlot(){
 if(activeValidations<3){activeValidations++;return Promise.resolve();}
 return new Promise(resolve=>validationWaiters.push(resolve));
}
function releaseValidationSlot(){
 if(validationWaiters.length)validationWaiters.shift()();
 else activeValidations--;
}
function validatedResource(file){
 if(validatedFiles.has(file))return validatedFiles.get(file);
 const pending=(async()=>{
  await acquireValidationSlot();
  try{
  if(file.size>(/\.svg$/i.test(file.name)?2:20)*1024*1024)throw new Error('图片过大，SVG 上限 2 MiB，其他图片上限 20 MiB');
  if(/\.svg$/i.test(file.name))return svgData(await file.text());
  const type=file.type||({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','webp':'image/webp'}[file.name.split('.').at(-1).toLowerCase()]);
  if(!raster.has(type))throw new Error('不支持的图片格式');
  const blob=new Blob([file],{type});
  const bitmap=await createImageBitmap(blob);const pixels=bitmap.width*bitmap.height;bitmap.close();
  if(pixels>20000000)throw new Error('图片超过 2000 万像素，请先缩小图片');
  return {url:await dataUrl(blob),sanitized:false};
  }finally{releaseValidationSlot();}
 })();
 validatedFiles.set(file,pending);
 pending.catch(()=>{if(validatedFiles.get(file)===pending)validatedFiles.delete(file);});
 return pending;
}
export async function buildResourceIndex(files){
 if(files.length>256)throw new Error('图片数量超过 256 个，请分批处理。');
 if(files.reduce((n,f)=>n+f.size,0)>MAX_ASSETS)throw new Error('图片总量超过 80 MiB，请减少文件。');
 const index={entries:new Map(),diagnostics:[]},results=new Array(files.length);let next=0;
 async function worker(){
  while(next<files.length){
   const i=next++,f=files[i];
   if(!/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name))continue;
   const path=normalize(f.webkitRelativePath||f.name);if(!path)continue;
   try{results[i]={path,...await validatedResource(f)};}
   catch(error){results[i]={path,error};}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,files.length)},worker));
 // Completion order must not change duplicate paths or warning order.
 for(const result of results){
  if(!result)continue;const {path,url,sanitized,error}=result;
  if(error){index.diagnostics.push({code:'image-invalid',resourcePath:path,source:path,message:`图片 ${path}：${error.message}`});continue;}
  if(sanitized)index.diagnostics.push({code:'image-sanitized',severity:'warning',resourcePath:path,source:path,message:`图片 ${path}：SVG 中的引用对象、活动内容或属性已被安全清理，图形可能缺失或变为空白。请核对预览；如显示不完整，请转换为 PNG 后重新导入。`});
  const values=index.entries.get(path)||[];values.push(url);index.entries.set(path,values);
 }
 return index;
}
export function resourceKey(path,sourcePath=''){
 try{const reference=decodeURIComponent(path.split('#')[0]);if(/^[a-z][a-z\d+.-]*:|^[\/\\]/i.test(reference))return null;const base=sourcePath.split('/').slice(0,-1).join('/');return normalize((base?base+'/':'')+reference);}catch{return null;}
}
export function resolveResource(index,path,sourcePath=''){
 const missing=message=>({dataUrl:null,diagnostic:{code:'image-missing',source:path,message}});
 if(/^data:/i.test(path))return missing('请将内嵌图片作为本地图片文件导入，以便校验格式。');
 if(/^[a-z][a-z\d+.-]*:|^\/\//i.test(path))return missing(`外链图片未下载：${path}`);
 let reference;
 try{reference=decodeURIComponent(path.split('#')[0]);}catch{return missing(`图片 URL 编码无效：${path}`);}
 if(/^[a-z][a-z\d+.-]*:|^[\/\\]/i.test(reference))return missing(`图片路径不是相对路径：${path}`);
 const base=sourcePath.split('/').slice(0,-1).join('/');
 const key=normalize((base?base+'/':'')+reference);
 if(!key)return missing(`图片路径超出导入目录：${path}`);
 const values=index?.entries.get(key);
 if(!values||values.length!==1)return missing(`请补充图片或检查重复路径：${key}`);
 return {dataUrl:values[0],diagnostic:null};
}
