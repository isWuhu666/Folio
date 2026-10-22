import {buildHtml,safeFilename} from './export.js';
import {writeZip} from './zip.js';
function imageBlob(url){
 const match=/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/.exec(url);if(!match)throw new Error('图片内嵌格式无效');
 const raw=atob(match[2]),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new Blob([bytes],{type:match[1]});
}
export async function prepareOutput(model,options,profile='archive',allowMissing=false){
 if(!['archive','reading','share'].includes(profile))throw new Error('导出预设无效');
 let body=model.bodyHtml;
 if(profile!=='archive'){
  const template=document.createElement('template');template.innerHTML=body;
  const cache=new Map(),limit=profile==='share'?1280:1920;
  for(const img of template.content.querySelectorAll('img[src^="data:image/"]')){
   const source=img.getAttribute('src');if(/^data:image\/(svg\+xml|gif)/i.test(source))continue;
   if(!cache.has(source))cache.set(source,(async()=>{
    const blob=imageBlob(source),bitmap=await createImageBitmap(blob);
    try{
     const ratio=Math.min(1,limit/bitmap.width),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
     canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
     const url=canvas.toDataURL(profile==='share'?'image/webp':'image/png',.88);return url.length<source.length?url:source;
    }finally{bitmap.close();}
   })());
   img.src=await cache.get(source);
  }
  body=template.innerHTML;
 }
 return buildHtml({...model,bodyHtml:body},options,{allowMissing});
}
export async function outputArchive(html,name){
 const document=new DOMParser().parseFromString(html,'text/html'),entries=[],seen=new Map();
 for(const img of document.querySelectorAll('img[src^="data:image/"]')){
  const source=img.getAttribute('src');
  if(!seen.has(source)){
   const blob=imageBlob(source),ext=({'image/svg+xml':'svg','image/png':'png','image/webp':'webp','image/jpeg':'jpg','image/gif':'gif'})[blob.type];
   if(!ext)throw new Error('导出包含不支持的图片格式');const path=`assets/image-${seen.size+1}.${ext}`;seen.set(source,path);entries.push([path,blob]);
  }
  img.setAttribute('src',seen.get(source));
 }
 const csp=document.querySelector('meta[http-equiv="Content-Security-Policy"]');csp.content=csp.content.replace('img-src data:',"img-src 'self' data:");
 entries.unshift([safeFilename(name)+'.html','<!doctype html>\n'+document.documentElement.outerHTML]);
 return writeZip(entries);
}
