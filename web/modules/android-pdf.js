import {escapeHtml} from './document.js';
const abort=()=>new DOMException('转换已取消','AbortError');
const LIMITS={bytes:20*1024*1024,pages:30,pagePixels:4_000_000,totalPixels:40_000_000,output:48*1024*1024};
export function androidPageSelection(input,count){
 if(!Number.isInteger(count)||count<1)throw new Error('PDF 没有可转换页面');
 if(typeof input!=='string'||input.length>400)throw new Error('页码范围无效');
 if(!input.trim()){if(count>LIMITS.pages)throw new Error('安卓每次最多转换 30 页，请指定页码范围');return Array.from({length:count},(_,i)=>i+1);}
 const selected=new Set();for(const part of input.split(',')){
  const m=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);if(!m)throw new Error('页码范围无效，请使用 1-3,5');const first=Number(m[1]),last=Number(m[2]||m[1]);
  if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last>count)throw new Error('页码超出文档范围');if(last-first+1>LIMITS.pages)throw new Error('安卓每次最多转换 30 页');
  for(let i=first;i<=last;i++)selected.add(i);if(selected.size>LIMITS.pages)throw new Error('安卓每次最多转换 30 页');
 }return [...selected].sort((a,b)=>a-b);
}
let library;
async function loadPdf(){
 if(!library)library=import('/vendor/pdfjs/build/pdf.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';return lib;}).catch(error=>{library=null;throw error;});return library;
}
function textLayer(items,viewport,lib){
 return '<div class="pdf-text-layer" aria-label="可选择的页面文字">'+items.slice(0,50000).filter(t=>t.str&&Array.isArray(t.transform)).map(t=>{
  const transform=lib.Util.transform(viewport.transform,t.transform),height=Math.hypot(transform[2],transform[3]);
  if(![height,transform[4],transform[5]].every(Number.isFinite)||height<=0)return '';
  return `<span style="left:${(100*transform[4]/viewport.width).toFixed(4)}%;top:${(100*(transform[5]-height*.85)/viewport.height).toFixed(4)}%;font-size:${(100*height/viewport.width).toFixed(4)}cqw">${escapeHtml(t.str)}</span>`;
 }).join('')+'</div>';
}
function hasRotatedText(page,text){return !!page.rotate||text.items.some(t=>t.transform&&(Math.abs(t.transform[1])>.01||Math.abs(t.transform[2])>.01)||text.styles?.[t.fontName]?.vertical);}
function readingPage(text,operatorList,page,lib,original){
 const items=text.items.filter(t=>t.str?.trim());
 const unsafe=new Set(['constructPath','paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','shadingFill'].map(k=>lib.OPS[k]));
 let reason=hasRotatedText(page,text)?'旋转或竖排文字':items.length<3?'扫描页或文字太少':operatorList.fnArray.some(n=>unsafe.has(n))?'表格、插图或矢量图形':items.some(t=>/[∫∑∏√∂∇∞α-ωΑ-Ω]/.test(t.str))?'公式或特殊符号':null;
 const heights=items.map(t=>Math.hypot(t.transform[2],t.transform[3])).sort((a,b)=>a-b),median=heights[Math.floor(heights.length/2)]||12,rows=[];
 for(const t of items){const y=t.transform[5],x=t.transform[4],height=Math.hypot(t.transform[2],t.transform[3]);if(height<median*.8)reason||='上下标或复杂字号';let row=rows.find(r=>Math.abs(r.y-y)<Math.max(2,median*.2));if(!row){row={y,items:[]};rows.push(row);}row.items.push({text:t.str,x,width:t.width,height});}
 for(const row of rows){row.items.sort((a,b)=>a.x-b.x);if(row.items.some((a,i)=>i&&a.x-row.items[i-1].x-row.items[i-1].width>page.view[2]*.15))reason||='分栏或不规则间隔';}
 if(reason)return {html:`<p class="page-notice">安卓阅读重排已回退原页：${reason}。无 OCR，请核对原文。</p>${original}`,reason};
 rows.sort((a,b)=>b.y-a.y);const parts=[];let paragraph='',lastY=null;
 const flush=()=>{if(paragraph){parts.push(`<p>${paragraph}</p>`);paragraph='';}};
 for(const row of rows){const line=row.items.map((a,i)=>`${i&&a.x-row.items[i-1].x-row.items[i-1].width>median*.2?' ':''}${escapeHtml(a.text)}`).join(''),heading=row.items.some(t=>t.height>median*1.3);if(heading){flush();parts.push(`<h2>${line}</h2>`);}else{if(lastY!==null&&lastY-row.y>median*1.8)flush();paragraph+=(paragraph?' ':'')+line;}lastY=row.y;}flush();
 return {html:parts.join('')+`<details class="original-page"><summary>查看原页并核对</summary>${original}</details>`,reason:null};
}
export function startAndroidPdf(file,{mode='faithful',dpi='96',pages='',onProgress=()=>{}}={}){
 let cancelled=false,timedOut=false,loading=null,rendering=null,documentProxy=null,deadline=null;
 const check=()=>{if(timedOut)throw new Error('安卓转换超过 180 秒，请减少页数或降低 DPI');if(cancelled)throw abort();};
 const promise=(async()=>{
  check();if(file.size>LIMITS.bytes)throw new Error('安卓 PDF 上限 20 MiB，请拆分文件');if(!['faithful','reading'].includes(mode)||![96,144,192].includes(Number(dpi)))throw new Error('PDF 模式或分辨率无效');
  if(await file.slice(0,5).text()!=='%PDF-')throw new Error('文件不是有效 PDF');check();
  const lib=await loadPdf();check();const bytes=new Uint8Array(await file.arrayBuffer());check();
  loading=lib.getDocument({data:bytes,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',iccUrl:'/vendor/pdfjs/iccs/',isEvalSupported:false,enableXfa:false,useWorkerFetch:true,canvasMaxAreaInBytes:16*1024*1024,stopAtErrors:true,verbosity:0});
  loading.onPassword=()=>{loading.destroy().catch(()=>{});};
  deadline=setTimeout(()=>{timedOut=true;try{rendering?.cancel();loading.destroy().catch(()=>{});}catch{}},180000);
  try{
   documentProxy=await loading.promise;check();const selected=androidPageSelection(pages,documentProxy.numPages),resultPages=[],parts=[],diagnostics=[];let pixels=0,outputSize=0;
   onProgress({state:'running',stage:'converting',completed:0,total:selected.length});
   for(const number of selected){
    check();const page=await documentProxy.getPage(number),viewport=page.getViewport({scale:Number(dpi)/72}),pagePixels=Math.ceil(viewport.width)*Math.ceil(viewport.height);pixels+=pagePixels;
    if(pagePixels>LIMITS.pagePixels||pixels>LIMITS.totalPixels)throw new Error('安卓渲染像素超过限额，请降低到 96 DPI 或减少页数');
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try{
     rendering=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,background:'rgb(255,255,255)'});await rendering.promise;rendering=null;check();
     const url=canvas.toDataURL('image/png'),text=await page.getTextContent();check();
     const rotated=hasRotatedText(page,text);
     if(rotated)diagnostics.push({code:'text-layer-skipped',page:number,message:`第 ${number} 页包含旋转或竖排文字，保留原页图像并关闭定位不可靠的文字层。`});
     const original=`<div class="pdf-page" style="width:${(viewport.width*72/Number(dpi)).toFixed(3)}px;aspect-ratio:${canvas.width}/${canvas.height}"><img src="${url}" alt="第 ${number} 页原文" loading="lazy">${rotated?'':textLayer(text.items,viewport,lib)}</div>`;
     let body=original;if(mode==='reading'){const rebuilt=readingPage(text,await page.getOperatorList(),page,lib,original);body=rebuilt.html;if(rebuilt.reason)diagnostics.push({code:'reading-fallback',page:number,message:`第 ${number} 页回退原页：${rebuilt.reason}。`});}
     if(text.items.length>50000)diagnostics.push({code:'text-layer-limited',page:number,message:'文字层项目过多，已限制选择层；页面图像保留。'});
     if(!text.items.some(t=>t.str?.trim()))diagnostics.push({code:'scan-no-ocr',page:number,message:`第 ${number} 页没有可提取文字，保留图像；安卓版本不含 OCR。`});
     const html=`<section class="pdf-reading-page"><div class="pdf-page-label">PAGE ${number} / ${documentProxy.numPages}</div>${body}</section>`;outputSize+=html.length;
     if(outputSize>LIMITS.output)throw new Error('安卓转换结果超过 48 MiB，请减少页数或降低 DPI');parts.push(html);resultPages.push({number,width:viewport.width*72/Number(dpi),height:viewport.height*72/Number(dpi)});
     onProgress({state:'running',stage:'converting',completed:resultPages.length,total:selected.length});await new Promise(resolve=>setTimeout(resolve,0));
    }finally{canvas.width=canvas.height=1;page.cleanup();}
   }
   check();return {title:file.name.replace(/\.pdf$/i,''),mode,pageCount:selected.length,sourcePageCount:documentProxy.numPages,bodyHtml:parts.join(''),diagnostics,pages:resultPages};
  }catch(error){check();if(/password|Password|Worker was destroyed/i.test(error.message))throw new Error('PDF 已加密，请先提供已解密的副本');throw error;
  }finally{clearTimeout(deadline);if(rendering){try{rendering.cancel();}catch{}}if(loading)await loading.destroy().catch(()=>{});}
 })();
 // Attach a handler immediately so a user cancelling during library load is safe.
 promise.catch(()=>{});
 return {promise,async cancel(){cancelled=true;try{rendering?.cancel();await loading?.destroy();}catch{}try{await promise;}catch(error){if(error.name!=='AbortError')throw error;}}};
}
