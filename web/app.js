import {defaults,pdfResultToDraft,escapeHtml} from './modules/document.js';
import {buildResourceIndex} from './modules/resources.js';
import {renderMarkdown} from './modules/markdown.js';
import {typesetDocument} from './modules/math.js';
import {buildHtml,downloadHtml} from './modules/export.js';
import {createTaskState} from './modules/state.js';
const $=id=>document.getElementById(id);
const state=createTaskState(),options={...defaults};
let file=null,sourcePath='未命名.md',resources=null,resourceFiles=[],pdfUrl=null,pdfRequest=null,timer=null,currentHtml='';
const isPdf=()=>file?.name.toLowerCase().endsWith('.pdf');
function status(message,error=false){$('status').textContent=message;$('status').parentElement.classList.toggle('error',error);}
function begin(){clearTimeout(timer);pdfRequest?.abort();const id=state.begin();$('export').disabled=true;$('preview-loading').hidden=false;return id;}
function renderDiagnostics(model){
 const list=model.diagnostics;$('diagnostics').hidden=!list.length;$('diagnostics-title').textContent=`转换提示 · ${list.length} 项`;
 $('diagnostics-list').innerHTML=list.slice(0,100).map(d=>`<li>${escapeHtml(d.message)}${d.source?` <code>${escapeHtml(d.source.slice(0,120))}</code>`:''}</li>`).join('');
 $('export-missing').hidden=!model.missingAssets.length;
}
function finish(id,model){
 if(!state.finish(id,model))return;
 currentHtml=buildHtml(model,options,{allowMissing:true});$('preview').srcdoc=currentHtml;
 $('preview-loading').hidden=true;$('export').disabled=!!model.missingAssets.length;
 const size=new Blob([currentHtml]).size/1024;
 $('result-meta').textContent=`${isPdf()?`${model.stats.pages} 页`:`${model.math.length} 个公式`} · ${size>=1024?(size/1024).toFixed(1)+' MB':Math.ceil(size)+' KB'}`;
 renderDiagnostics(model);status(model.diagnostics.length?`排版完成 · ${model.diagnostics.length} 项提示，请核对转换结果`:'排版完成 · 可导出独立 HTML');
}
async function convert(id){
 if(!state.isCurrent(id))return;
 status(isPdf()?'正在转换 PDF，请稍候…':'正在排版文档与公式…');
 try{
  let draft;
  if(isPdf()){
   pdfRequest=new AbortController();
   const response=await fetch(`/api/pdf?mode=${$('pdf-mode').value}&dpi=${$('pdf-dpi').value}`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf'},signal:pdfRequest.signal});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'PDF 转换失败');
   draft=pdfResultToDraft(result);draft.title=file.name.replace(/\.pdf$/i,'');
  }else draft=renderMarkdown($('editor').value,resources,sourcePath);
  if(!state.isCurrent(id))return;
  const model=await typesetDocument(draft,options);finish(id,model);
 }catch(error){
  if(!state.isCurrent(id)||error.name==='AbortError')return;
  $('preview-loading').hidden=true;status(error.message,true);
 }
}
function schedule(delay=0){const id=begin();timer=setTimeout(()=>convert(id),delay);}
function releasePdf(){if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}$('pdf-source').removeAttribute('data');}
function showFile(){
 const pdf=isPdf();document.body.classList.toggle('is-pdf',pdf);$('pdf-settings').hidden=!pdf;$('editor').hidden=pdf;$('pdf-source').hidden=!pdf;
 $('source-type').textContent=pdf?'PDF':'MARKDOWN';$('source-name').textContent=sourcePath.split('/').at(-1);$('source-label').textContent=sourcePath.split('/').at(-1);
 $('source-meta').textContent=pdf?'原始 PDF · 本机处理':'可直接编辑';
 $('character-count').textContent=pdf?`${(file.size/1024/1024).toFixed(2)} MB`:`${$('editor').value.length.toLocaleString()} 字符`;
}
async function acceptFiles(files,folder=false){
 const id=begin();
 try{
  const docs=files.filter(f=>/\.(md|markdown|pdf)$/i.test(f.name));
  const main=folder?(file?null:(docs.length===1?docs[0]:null)):docs[0];
  if(main){
   if(main.size>(/\.pdf$/i.test(main.name)?40:5)*1024*1024)throw new Error('文档超过大小限制：PDF 40 MiB，Markdown 5 MiB。');
   releasePdf();file=main;sourcePath=main.webkitRelativePath||main.name;
   if(!isPdf())$('editor').value=await main.text();else{pdfUrl=URL.createObjectURL(main);$('pdf-source').data=pdfUrl;}
  }
  const images=files.filter(f=>/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
  if(main&&!folder)resourceFiles=[];
  // Replacing an imported directory also replaces earlier versions of its files.
  const map=new Map(resourceFiles.map(f=>[f.webkitRelativePath||f.name,f]));for(const f of images)map.set(f.webkitRelativePath||f.name,f);resourceFiles=[...map.values()];
  resources=await buildResourceIndex(resourceFiles);
  if(folder&&file){const matches=docs.filter(f=>f.name===file.name);if(matches.length===1)sourcePath=matches[0].webkitRelativePath||matches[0].name;}
  if(!state.isCurrent(id))return;showFile();await convert(id);
 }catch(error){if(state.isCurrent(id)){$('preview-loading').hidden=true;status(error.message,true);}}
 $('file-input').value='';$('folder-input').value='';
}
async function example(){
 const id=begin();status('正在加载本地示例…');
 try{
  const [text,svg]=await Promise.all([fetch('/examples/showcase.md').then(r=>{if(!r.ok)throw new Error('示例文件缺失');return r.text();}),fetch('/examples/assets/circuit.svg').then(r=>r.text())]);
  const image=new File([svg],'circuit.svg',{type:'image/svg+xml'});Object.defineProperty(image,'webkitRelativePath',{value:'assets/circuit.svg'});
  const idx=await buildResourceIndex([image]);if(!state.isCurrent(id))return;
  releasePdf();file=new File([text],'工程笔记.md',{type:'text/markdown'});sourcePath='工程笔记.md';resourceFiles=[image];resources=idx;$('editor').value=text;showFile();await convert(id);
 }catch(error){if(state.isCurrent(id)){status(`示例加载失败：${error.message}。请重新运行 安装.cmd 检查本地资源。`,true);$('preview-loading').hidden=true;}}
}
function updateOptions(){
 options.fontFamily=$('font-family').value;options.fontSize=Number($('font-size').value);options.lineHeight=Number($('line-height').value);options.contentWidth=Number($('content-width').value);
 $('font-size-value').textContent=options.fontSize+' px';$('line-height-value').textContent=options.lineHeight.toFixed(1);$('content-width-value').textContent=options.contentWidth+' px';
}
function restyle(){
 const model=state.model;updateOptions();
 if(model){const id=begin();finish(id,model);}else schedule(150);
}
$('editor').addEventListener('input',()=>{showFile();schedule(300);});
$('choose').onclick=e=>{e.stopPropagation();$('file-input').click();};
$('dropzone').onclick=()=>$('file-input').click();$('dropzone').onkeydown=e=>{if(e.target===$('dropzone')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();$('file-input').click();}};
$('assets').onclick=()=>$('folder-input').click();
$('file-input').onchange=e=>acceptFiles([...e.target.files]);$('folder-input').onchange=e=>acceptFiles([...e.target.files],true);
for(const event of ['dragenter','dragover'])document.addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('dragover');});
document.addEventListener('dragleave',()=>$('dropzone').classList.remove('dragover'));
document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragover');acceptFiles([...e.dataTransfer.files]);});
$('example').onclick=example;
$('export').onclick=()=>{try{if(state.model)downloadHtml(buildHtml(state.model,options),sourcePath.split('/').at(-1).replace(/\.(md|markdown|pdf)$/i,''));}catch(e){status(e.message,true);}};
$('export-missing').onclick=()=>{if(state.model)downloadHtml(buildHtml(state.model,options,{allowMissing:true}),sourcePath.split('/').at(-1).replace(/\.(md|markdown|pdf)$/i,''));};
for(const button of document.querySelectorAll('[data-theme]'))button.onclick=()=>{
 options.theme=button.dataset.theme;document.querySelectorAll('[data-theme]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});
 $('font-family').value=options.theme==='academic'?'serif':'sans';restyle();
};
for(const name of ['font-family','font-size','line-height','content-width'])$(name).addEventListener('input',restyle);
for(const name of ['pdf-mode','pdf-dpi'])$(name).onchange=()=>schedule();
$('mobile-view').onclick=()=>{$('preview').classList.add('mobile');$('mobile-view').classList.add('active');$('desktop-view').classList.remove('active');};
$('desktop-view').onclick=()=>{$('preview').classList.remove('mobile');$('desktop-view').classList.add('active');$('mobile-view').classList.remove('active');};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.body.dataset.tab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(t=>t.classList.toggle('active',t===b));});
window.addEventListener('beforeunload',releasePdf);
example();
