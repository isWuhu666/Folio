import {defaults,pdfResultToDraft} from './modules/document.js';
import {buildResourceIndex,resourceKey} from './modules/resources.js';
import {renderMarkdown} from './modules/markdown.js';
import {typesetDocument} from './modules/math.js';
import {buildHtml,downloadHtml,safeFilename,inspectBody} from './modules/export.js';
import {createTaskState} from './modules/state.js';
import {createDraftStore,packFile,unpackFile,validateDraft,rescueDraftText} from './modules/drafts.js';
import {mountProductTools} from './modules/product-tools.js';
import {prepareOutput,outputArchive} from './modules/output.js';
import {downloadBlob,encodeProject,validateProjectSourcePath} from './modules/project.js';
import {clearSnapshots} from './modules/history.js';
import {startPdfJob} from './modules/pdf-job.js';
import {readMarkdown} from './modules/text-input.js';
import {isAndroid,requestPrint} from './modules/platform.js';

const $=id=>document.getElementById(id),state=createTaskState(),options={...defaults},store=createDraftStore();
let file=null,sourcePath='未命名.md',resources=null,resourceFiles=[],pdfUrl=null,pdfQueue=Promise.resolve(),timer=null,currentHtml='';
let dirty=false,sample=true,revision=0,savedRevision=0,saveTimer=null,saveQueue=Promise.resolve(),pendingDraft=null,replacement=null,repairTarget=null,fileIntent=0,composing=false;
let previewPosition=0,previewTarget=null,exportNameEdited=false,draftWriteId=null,hadDiagnostics=false;
let automaticName=true;
let activePdf=null,pdfResult=null,outputVersion=0,exporting=false;
const isPdf=()=>file?.name.toLowerCase().endsWith('.pdf');
const basename=()=>sourcePath.split('/').at(-1),stem=()=>basename().replace(/\.(md|markdown|pdf)$/i,'');
const hasContent=()=>isPdf()||!!$('editor').value.trim();
function status(message,error=false){$('status').textContent=message;$('status').parentElement.classList.toggle('error',error);}
function saveState(message,kind=''){$('save-state').textContent=message;$('save-state').className=kind;}
async function downloadSource(text=$('editor').value,name=basename(),original=file){
 const blob=original?.name.toLowerCase().endsWith('.pdf')?original:new Blob([text],{type:'text/markdown;charset=utf-8'});
 await downloadBlob(blob,safeFilename(name));
}
function snapshot(){return {version:1,text:isPdf()?'':$('editor').value,sourcePath,file:packFile(isPdf()?file:new File([$('editor').value],basename(),{type:'text/markdown'})),resources:resourceFiles.map(packFile),options:{...options},editorSize:$('editor-size').value,pdfMode:$('pdf-mode').value,pdfDpi:$('pdf-dpi').value,pdfPages:$('pdf-pages').value,exportProfile:$('export-profile').value,exportFormat:$('export-format').value,updatedAt:Date.now()};}
function queueSave(){
 clearTimeout(saveTimer);
 if(!$('autosave').checked||pendingDraft)return Promise.resolve();
 const version=revision,value=snapshot();saveState('正在保存到本机…','pending');
 saveQueue=saveQueue.catch(()=>{}).then(async()=>{
  if(!$('autosave').checked)return;
  try{draftWriteId=await store.save(value,draftWriteId);savedRevision=version;if(revision===version&&$('autosave').checked)saveState('已保存到本机 · 含导入资源');}
  catch(error){if(revision===version)saveState(error.message.includes('其他标签页')?error.message:`自动保存失败 · ${error.message}；上次有效草稿保留，请立即保存原文`,'error');}
 });return saveQueue;
}
function changed(){
 dirty=true;sample=false;revision++;$('document-origin').textContent=isPdf()?'PDF 原文件':'我的文档';
 if(!$('autosave').checked){saveState('自动保存已关闭 · 请手动保存原文');return;}
 saveState('等待保存到本机…','pending');clearTimeout(saveTimer);saveTimer=setTimeout(queueSave,450);
}
function protectReplacement(message){
 if(replacement)return replacement.promise;
 $('replace-message').textContent=message||'继续会替换当前工作。可先保存完整项目，保留原文、图片和排版设置。';
 let resolve;const promise=new Promise(r=>resolve=r);replacement={promise,resolve};$('replace-dialog').showModal();return promise;
}
async function closeReplacement(value,backup=false){const pending=replacement;if(!pending)return;if(backup){const version=revision;try{const blob=await encodeProject(snapshot());if(replacement!==pending)return;if(version!==revision)throw new Error('文档已变化，请重新保存项目');await downloadBlob(blob,safeFilename(stem())+'.folio');}catch(error){status(error.message,true);return;}}if(replacement!==pending)return;replacement=null;$('replace-dialog').close();pending.resolve(value);}
$('cancel-replace').onclick=()=>closeReplacement(false);
$('confirm-replace').onclick=()=>closeReplacement(true);
$('backup-replace').onclick=()=>closeReplacement(true,true);
$('replace-dialog').addEventListener('cancel',e=>{e.preventDefault();closeReplacement(false);});
async function mayReplace(){return !dirty||!hasContent()||await protectReplacement();}

function begin(){
 $('export-issues').hidden=true;
 if(activePdf)activePdf.cancel().catch(()=>{});
 outputVersion++;$('pdf-progress').hidden=true;
 clearTimeout(timer);const id=state.begin();$('export').disabled=true;$('preview-loading').hidden=false;
 $('diagnostics').hidden=true;$('result-meta').textContent='正在更新';$('render-version').textContent=currentHtml?'正在更新 · 当前画面为上一版本':'正在生成预览';
 $('quality-summary').textContent='导出核对 · 等待当前版本';status('正在生成新预览，暂不可导出');return id;
}
function locateDiagnostic(d){
 if(d.range&&!isPdf()){
  setTab('source');setLayout('compare');const editor=$('editor');editor.focus();editor.setSelectionRange(d.range.start,d.range.end);
  const line=editor.value.slice(0,d.range.start).split('\n').length;editor.scrollTop=Math.max(0,(line-4)*parseFloat(getComputedStyle(editor).lineHeight));
 }
 if(d.previewId){previewTarget=d.previewId;highlightPreview();}
}
function highlightPreview(){
 if(!previewTarget)return;
 const doc=$('preview').contentDocument,target=doc?.getElementById(previewTarget);
 if(target){target.scrollIntoView({block:'center'});target.style.outline='3px solid #bd8032';setTimeout(()=>target.style.outline='',2500);previewTarget=null;}
}
function renderDiagnostics(model){
 const list=model.diagnostics;$('diagnostics').hidden=!list.length;
 $('diagnostics-title').textContent=`转换提示 · ${list.length} 项需要核对`;
 if(list.length&&!hadDiagnostics)$('diagnostics').open=true;hadDiagnostics=!!list.length;
 $('diagnostics-list').replaceChildren();
 for(const d of list.slice(0,100)){
  const li=document.createElement('li'),title=document.createElement('div'),help=document.createElement('p');title.className='diagnostic-title';help.className='diagnostic-help';
  title.textContent=d.code==='image-missing'?'图片尚未找到':d.code==='math-error'?'公式未能排版':d.code==='math-unclosed'?'公式分隔符未闭合':'转换需要核对';
  help.textContent=d.code==='image-sanitized'?'SVG 已安全清理，图形可能改变；请核对预览，必要时将原图转为 PNG 后替换。':d.code.startsWith('image')?'选择对应图片补齐资源；也可检查原文引用路径。':d.code.startsWith('math')?'检查分隔符、大括号和命令；价格中的美元请转义，例如 \\$30。':d.page?`第 ${d.page} 页，请对照原页核对。`:'请对照原文检查转换结果。';
  const detail=document.createElement('div');detail.textContent=d.message;li.append(title,help,detail);
  if(d.source){const code=document.createElement('code');code.textContent=d.source.slice(0,300);li.append(code);}
  const actions=document.createElement('div');actions.className='diagnostic-actions';
  if(!d.range&&d.source&&!isPdf()){const start=$('editor').value.indexOf(d.source);if(start>=0)d.range={start,end:start+d.source.length};}
  if(d.range){const jump=document.createElement('button');jump.className='small-button';jump.textContent='定位原文';jump.onclick=()=>locateDiagnostic(d);actions.append(jump);}
  if(d.previewId){const jump=document.createElement('button');jump.className='small-button';jump.textContent='定位预览';jump.onclick=()=>{setTab('preview');setLayout('compare');previewTarget=d.previewId;highlightPreview();};actions.append(jump);}
  if(d.code.startsWith('image')&&d.source){const repair=document.createElement('button');repair.className='small-button';repair.textContent='选择图片修复';repair.onclick=()=>{repairTarget={...d,revision};$('repair-input').click();};actions.append(repair);}
  li.append(actions);$('diagnostics-list').append(li);
 }
 $('export-missing').hidden=!model.missingAssets.length&&!list.some(d=>d.code.startsWith('math'));
 $('export-issues').hidden=!list.length;$('export-issues').textContent=`${list.length} 项${$('export').disabled?'问题阻止导出':'提示'} · 查看原因`;
}
function finish(id,model){
 if(!state.isCurrent(id))return;
 const html=buildHtml(model,options,{allowMissing:true});
 if(!state.finish(id,model))return;
 try{previewPosition=$('preview').contentWindow?.scrollY||0;}catch{previewPosition=0;}
 currentHtml=html;$('preview').srcdoc=html;$('preview-loading').hidden=true;
 const blocking=model.missingAssets.length||model.diagnostics.some(d=>['math-error','math-unclosed'].includes(d.code));
 $('export').disabled=!!blocking;const size=new Blob([html]).size/1024;
 $('result-meta').textContent=`${isPdf()?`${model.stats.pages} 页`:`${model.math.length} 个公式`} · ${size>=1024?(size/1024).toFixed(1)+' MB':Math.ceil(size)+' KB'}`;
 $('render-version').textContent='预览与当前输入一致';
 renderDiagnostics(model);
 const audit=inspectBody(model.bodyHtml),theme={modern:'现代阅读',academic:'学术论文',report:'简洁报告'}[options.theme];
 $('quality-summary').textContent=`导出核对 · ${theme} · ${audit.images} 张图片已内嵌 · ${model.diagnostics.length} 项提示 · 约 ${Math.ceil(size)} KB`;
 $('quality-details').textContent=`当前版本已就绪。${model.math.length} 个公式，${model.diagnostics.filter(d=>d.code.startsWith('math')).length} 项公式提示；${model.missingAssets.length} 个资源缺失。未检测到外部资源依赖。${isPdf()?(model.stats.mode==='faithful'?'保真结果以页面图片保存；文字层不等于 OCR。':'阅读重排使用启发式识别；回退页见转换提示。'):''}`;
 status(model.diagnostics.length?`排版完成 · ${model.diagnostics.length} 项提示，请核对转换结果`:'排版完成 · 可导出独立 HTML');
 refreshOutputEstimate();
}
function emptyState(id){
 $('export-issues').hidden=true;
 if(!state.isCurrent(id))return;
 currentHtml='';$('preview').srcdoc='<!doctype html><html lang="zh-CN"><body><p>添加内容后，预览将在这里出现。</p></body></html>';
 $('preview-loading').hidden=true;$('export').disabled=true;$('diagnostics').hidden=true;hadDiagnostics=false;$('result-meta').textContent='空文档';$('render-version').textContent='等待输入';$('quality-summary').textContent='导出核对 · 暂无内容';status('添加内容后开始排版 · 可粘贴、打开文档或试用示例');
}
async function convert(id){
 if(!state.isCurrent(id))return;
 if(!hasContent()){emptyState(id);return;}
 const started=performance.now();status(isPdf()?'正在转换 PDF，请稍候…':'正在解析文档与排版公式…');$('loading-label').textContent=isPdf()?'正在转换 PDF…':'正在排版公式与资源…';
 try{
  let draft;
  if(isPdf()){
   const selected=file,mode=$('pdf-mode').value,dpi=$('pdf-dpi').value;
   const job=pdfQueue.then(async()=>{
    if(!state.isCurrent(id))return null;
    const task=startPdfJob(selected,{mode,dpi,pages:$('pdf-pages').value,onProgress(p){if(!state.isCurrent(id))return;$('pdf-progress').hidden=false;$('pdf-progress-bar').max=p.total||1;$('pdf-progress-bar').value=p.completed||0;$('pdf-progress-label').textContent=p.total?`已完成 ${p.completed||0} / ${p.total} 页`:'正在解析页数…';$('loading-label').textContent=$('pdf-progress-label').textContent;}});
    activePdf=task;
    try{return await task.promise;}finally{if(activePdf===task)activePdf=null;if(state.isCurrent(id))$('pdf-progress').hidden=true;}
   });pdfQueue=job.catch(()=>{});const result=await job;if(!result||!state.isCurrent(id))return;
   pdfResult=result;updatePdfReview();showAndroidOriginal(result.pages[0]?.number);draft=pdfResultToDraft(result);draft.title=selected.name.replace(/\.pdf$/i,'');
  }else{
   if(typeof window.markdownit!=='function'||typeof window.markdownitFootnote!=='function'||!window.DOMPurify||!window.hljs)throw new Error('本地排版资源缺失，请重新运行 安装.cmd。');
   draft=renderMarkdown($('editor').value,resources,sourcePath);
  }
  if(!state.isCurrent(id))return;
  const model=await typesetDocument(draft,options,()=>state.isCurrent(id));finish(id,model);
  if(state.isCurrent(id))$('render-version').title=`本次解析与排版 ${(performance.now()-started).toFixed(0)} ms`;
 }catch(error){if(!state.isCurrent(id)||error.name==='AbortError')return;$('preview-loading').hidden=true;$('render-version').textContent='当前转换失败 · 原文仍保留';$('result-meta').textContent='未生成当前版本';$('quality-summary').textContent='导出核对 · 转换失败';status(error.message,true);}
}
function schedule(delay=0){const id=begin();timer=setTimeout(()=>convert(id),delay);}
function releasePdf(){if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}$('pdf-source').removeAttribute('data');$('pdf-local-source').replaceChildren();pdfResult=null;}
function showFile(){
 const heading=$('editor').value.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();$('suggest-name').hidden=!automaticName||isPdf()||sourcePath!=='未命名.md'||!heading;$('suggest-name').title=heading?`建议名称：${safeFilename(heading)}.md`:'';
 const pdf=isPdf();document.body.classList.toggle('is-pdf',pdf);$('pdf-settings').hidden=!pdf;$('editor').hidden=pdf;$('pdf-source').hidden=!pdf||isAndroid();$('pdf-local-source').hidden=!pdf||!isAndroid();
 $('source-type').textContent=pdf?'PDF':'MARKDOWN';$('source-name').textContent=basename();$('source-label').textContent=basename();$('document-name').value=basename();
 $('document-origin').textContent=sample?'示例文档':pdf?'PDF 原文件':'我的文档';$('source-meta').textContent=pdf?'原始 PDF · 本机处理':'可直接编辑';
 $('character-count').textContent=pdf?`${(file.size/1024/1024).toFixed(2)} MB`:`${$('editor').value.length.toLocaleString()} 字符`;
 if(!exportNameEdited)$('export-name').value=stem();
 for(const el of document.querySelectorAll('.editor-tools input,.editor-tools button,.editor-tools select'))el.disabled=pdf;
}
async function acceptFiles(files,folder=false){
 if(!folder&&files.length===1&&/\.(folio|zip)$/i.test(files[0].name)){try{await productTools.importProject(files[0]);}catch(error){status(error.message,true);}finally{$('file-input').value='';}return;}
 const intent=++fileIntent,docs=files.filter(f=>/\.(md|markdown|pdf)$/i.test(f.name));
 const images=files.filter(f=>/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
 const unsupported=files.filter(f=>!docs.includes(f)&&!images.includes(f));
 const reject=message=>{status(message,true);$('file-input').value='';$('folder-input').value='';};
 if(!folder&&docs.length>1){reject(`一次只能打开一份主文档，检测到多个文档：${docs.map(f=>f.name).join('、')}。请分别打开；当前工作未替换。`);return;}
 if(!docs.length&&!images.length){reject(`不支持这些文件：${files.map(f=>f.name).join('、')||'未选择文件'}。请选择 Markdown、PDF、完整项目或图片。`);return;}
 if(folder&&!file&&docs.length>1){reject('资源文件夹包含多个文档，请先单独打开主文档，再导入图片文件夹。');return;}
 const main=folder?(file?null:(docs.length===1?docs[0]:null)):docs[0];
 if(main){try{validateProjectSourcePath(main.webkitRelativePath||main.name,main.name);}catch(error){status(error.message,true);$('file-input').value='';$('folder-input').value='';return;}}
 let decoded;
 try{if(main){if(main.size>(/\.pdf$/i.test(main.name)?(isAndroid()?20:40):5)*1024*1024)throw new Error('文档超过大小限制：Markdown 5 MiB，PDF '+(isAndroid()?20:40)+' MiB。');if(!/\.pdf$/i.test(main.name))decoded=await readMarkdown(main);}}catch(error){reject(error.message);return;}
 if(main&&!(await mayReplace()))return;if(intent!==fileIntent)return;
 const id=begin();
 try{
  if(files.length>512)throw new Error('一次最多导入 512 个文件，请缩小资源文件夹范围。');
  if(main&&main.size>(/\.pdf$/i.test(main.name)?(isAndroid()?20:40):5)*1024*1024)throw new Error(`文档超过大小限制：PDF ${isAndroid()?20:40} MiB，Markdown 5 MiB。`);
  const pdf=main?/\.pdf$/i.test(main.name):isPdf(),text=main&&!pdf?decoded:$('editor').value;
  let nextPath=main?(main.webkitRelativePath||main.name):sourcePath;
  const paths=new Set(images.map(f=>f.webkitRelativePath||f.name));
  const nextFiles=(main&&!folder?[]:resourceFiles).filter(f=>!paths.has(f.webkitRelativePath||f.name)).concat(images),index=await buildResourceIndex(nextFiles),nextFile=main||file;
  if(folder&&nextFile){const matches=docs.filter(f=>f.name===nextFile.name);if(matches.length===1){const path=matches[0].webkitRelativePath||matches[0].name;nextPath=path.split('/').slice(0,-1).concat(main?main.name:basename()).join('/');}}
  if(nextFile)validateProjectSourcePath(nextPath,nextFile.name);
  if(!state.isCurrent(id))return;
  if(main){automaticName=false;releasePdf();file=main;exportNameEdited=false;if(pdf){$('pdf-pages').value='';pdfUrl=URL.createObjectURL(main);$('pdf-source').data=pdfUrl;}else $('editor').value=text;}
  sourcePath=nextPath;resourceFiles=nextFiles;resources=index;sample=false;changed();if(main)dirty=false;showFile();setTab('source');await convert(id);
  if(state.isCurrent(id)&&unsupported.length)status(`${$('status').textContent}；未处理不支持的文件：${unsupported.map(f=>f.name).join('、')}`,true);
 }catch(error){if(state.isCurrent(id)){$('preview-loading').hidden=true;status(error.message,true);}}
 $('file-input').value='';$('folder-input').value='';
}
async function example(initial=false){
 if(!initial&&!(await mayReplace()))return;
 const id=begin();status('正在加载本地示例…');
 try{
  const [text,svg]=await Promise.all([fetch('/examples/showcase.md').then(r=>{if(!r.ok)throw new Error('示例文件缺失');return r.text();}),fetch('/examples/assets/circuit.svg').then(r=>r.text())]);
  const image=new File([svg],'circuit.svg',{type:'image/svg+xml'});Object.defineProperty(image,'webkitRelativePath',{value:'assets/circuit.svg'});
  const idx=await buildResourceIndex([image]);if(!state.isCurrent(id))return;
  clearTimeout(saveTimer);releasePdf();file=new File([text],'工程笔记.md',{type:'text/markdown'});sourcePath='工程笔记.md';resourceFiles=[image];resources=idx;$('editor').value=text;dirty=false;sample=true;exportNameEdited=false;showFile();
  if(!initial){revision++;queueSave();}await convert(id);
 }catch(error){if(state.isCurrent(id)){status(`示例加载失败：${error.message}。请重新运行 安装.cmd 检查本地资源。`,true);$('preview-loading').hidden=true;}}
}
function updateOptions(){
 options.fontFamily=$('font-family').value;options.fontSize=Number($('font-size').value);options.lineHeight=Number($('line-height').value);options.contentWidth=Number($('content-width').value);
 $('font-size-value').textContent=options.fontSize+' px';$('line-height-value').textContent=options.lineHeight.toFixed(1);$('content-width-value').textContent=options.contentWidth+' px';
}
function restyle(){const model=state.model;updateOptions();changed();if(model){const id=begin();finish(id,model);}else schedule(150);}
function setTab(name){document.body.dataset.tab=name;if(name==='settings')$('quality-panel').open=true;document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===name;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function setLayout(name){document.body.dataset.layout=name;document.querySelectorAll('[data-layout]').forEach(b=>{const active=b.dataset.layout===name;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function applyOptions(value={}){
 options.theme=['modern','academic','report'].includes(value.theme)?value.theme:'modern';
 for(const [key,id] of [['fontFamily','font-family'],['fontSize','font-size'],['lineHeight','line-height'],['contentWidth','content-width']])$(id).value=value[key]??defaults[key];
 if(!['sans','serif'].includes($('font-family').value))$('font-family').value='sans';
 document.querySelectorAll('[data-theme]').forEach(b=>{const active=b.dataset.theme===options.theme;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});updateOptions();
}
async function restoreDraft(){
 try{
  const d=validateDraft(pendingDraft),nextFile=d.file?unpackFile(d.file):null,nextFiles=d.resources.map(unpackFile),index=await buildResourceIndex(nextFiles);
  automaticName=false;releasePdf();file=nextFile;resourceFiles=nextFiles;resources=index;sourcePath=d.sourcePath;$('editor').value=d.text;applyOptions(d.options);
  $('editor-size').value=['14','15','16','18','20'].includes(d.editorSize)?d.editorSize:'15';document.documentElement.style.setProperty('--editor-size',$('editor-size').value+'px');
  $('pdf-mode').value=d.pdfMode==='reading'?'reading':'faithful';$('pdf-dpi').value=['96','144','192'].includes(d.pdfDpi)?d.pdfDpi:'144';
  $('pdf-pages').value=typeof d.pdfPages==='string'?d.pdfPages:'';
  $('export-profile').value=['archive','reading','share'].includes(d.exportProfile)?d.exportProfile:'archive';$('export-format').value=d.exportFormat==='zip'?'zip':'html';
  if(isPdf()){pdfUrl=URL.createObjectURL(file);$('pdf-source').data=pdfUrl;}
  draftWriteId=d.writeId||null;sample=false;dirty=true;exportNameEdited=false;pendingDraft=null;$('recovery').close();showFile();saveState('已恢复本机草稿 · 含导入资源');schedule();
 }catch(error){$('recovery-error').textContent=`恢复失败：${error.message}。原草稿仍保留，请先保存原文或从原文件重新导入。`;}
}
async function init(){
 setTab('source');setLayout('compare');
 try{if(localStorage.getItem('folio-autosave')==='off')$('autosave').checked=false;}catch{}
 try{
  const draft=await store.load();
  if(draft&&!draft.cleared){pendingDraft=draft;$('recovery-description').textContent=`${draft.sourcePath||'未命名文档'} · ${new Date(draft.updatedAt).toLocaleString()}`;$('recovery').showModal();saveState('等待选择恢复草稿');return;}
  draftWriteId=draft?.writeId||null;
  saveState($('autosave').checked?'示例未保存 · 编辑后自动保存':'自动保存已关闭 · 请手动保存原文');
 }catch{saveState('读取草稿失败 · 请手动保存原文','error');}
 await example(true);
}

$('editor').addEventListener('compositionstart',()=>composing=true);
$('editor').addEventListener('compositionend',()=>{composing=false;changed();showFile();schedule(300);});
$('editor').addEventListener('input',()=>{showFile();changed();if(!composing)schedule(300);else{begin();$('loading-label').textContent='等待输入完成…';}});
for(const id of ['choose','open-document'])$(id).onclick=e=>{e.stopPropagation();$('file-input').click();};
$('dropzone').onclick=()=>$('file-input').click();$('dropzone').onkeydown=e=>{if(e.target===$('dropzone')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();$('file-input').click();}};
$('assets').onclick=()=>$('folder-input').click();$('file-input').onchange=e=>acceptFiles([...e.target.files]);$('folder-input').onchange=e=>acceptFiles([...e.target.files],true);
for(const event of ['dragenter','dragover'])document.addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('dragover');});
document.addEventListener('dragleave',()=>$('dropzone').classList.remove('dragover'));
document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragover');if(!document.querySelector('.workspace').inert&&!$('recovery').open&&!$('replace-dialog').open)acceptFiles([...e.dataTransfer.files]);});
$('example').onclick=()=>example();$('save-source').onclick=()=>downloadSource().catch(error=>status(error.message,true));
$('new-document').onclick=async()=>{if(!(await mayReplace()))return;fileIntent++;begin();releasePdf();file=null;automaticName=true;sourcePath='未命名.md';resourceFiles=[];resources=null;$('editor').value='';exportNameEdited=false;changed();showFile();setTab('source');setLayout('compare');schedule();};
$('document-name').onchange=()=>{automaticName=false;const raw=safeFilename($('document-name').value),name=isPdf()?raw.replace(/\.(md|markdown|pdf)$/i,'')+'.pdf':raw.replace(/\.pdf$/i,'')+(/\.(md|markdown)$/i.test(raw)?'':'.md');sourcePath=sourcePath.split('/').slice(0,-1).concat(name).join('/');exportNameEdited=false;changed();showFile();};
$('suggest-name').onclick=()=>{const heading=$('editor').value.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();if(!heading)return;$('document-name').value=safeFilename(heading).slice(0,150)+'.md';$('document-name').onchange();};
$('export-name').oninput=()=>exportNameEdited=true;
async function refreshOutputEstimate(){
 const version=++outputVersion,model=state.model;if(!model)return;$('output-estimate').textContent='正在计算所选预设的实际体积…';
 try{const html=await prepareOutput(model,options,$('export-profile').value,true),blob=$('export-format').value==='zip'?await outputArchive(html,$('export-name').value||stem()):new Blob([html]);if(version!==outputVersion)return;$('output-estimate').textContent=`所选成品约 ${(blob.size/1024/1024).toFixed(2)} MiB · ${$('export-format').value==='zip'?'ZIP 解压后打开 HTML':'单文件离线阅读'}`;}catch(error){if(version===outputVersion)$('output-estimate').textContent=`体积计算失败：${error.message}`;}
}
async function exportCurrent(allowMissing=false){
 if(exporting)return;const model=state.model,version=outputVersion;if(!model||!hasContent())return;exporting=true;
 try{const html=await prepareOutput(model,options,$('export-profile').value,allowMissing);if(model!==state.model||version!==outputVersion)throw new Error('文档或导出设置已变化，请重新导出');const name=$('export-name').value||stem();if($('export-format').value==='zip'){const blob=await outputArchive(html,name);if(model!==state.model||version!==outputVersion)throw new Error('文档已变化，请重新导出');await downloadBlob(blob,safeFilename(name)+'.zip');}else await downloadHtml(html,name);if(isAndroid())status('已保存到所选位置');}catch(error){status(error.message,true);}finally{exporting=false;}
}
$('export-issues').onclick=()=>{setTab('source');$('diagnostics').open=true;$('diagnostics').scrollIntoView({block:'center'});$('diagnostics-title').focus();};
$('focus-mode').onclick=()=>{const active=document.body.classList.toggle('focus-mode');$('focus-mode').setAttribute('aria-pressed',String(active));$('focus-mode').textContent=active?'退出专注':'专注模式';};
$('usage-help').onclick=()=>$('usage-dialog').showModal();$('close-usage').onclick=()=>$('usage-dialog').close();
$('export').onclick=()=>exportCurrent();$('export-missing').onclick=()=>exportCurrent(true);
for(const button of document.querySelectorAll('[data-theme]'))button.onclick=()=>{options.theme=button.dataset.theme;document.querySelectorAll('[data-theme]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});$('font-family').value=options.theme==='academic'?'serif':'sans';restyle();};
for(const name of ['font-family','font-size','line-height','content-width'])$(name).addEventListener('input',restyle);
for(const name of ['pdf-mode','pdf-dpi','pdf-pages'])$(name).onchange=()=>{changed();schedule();};
for(const name of ['export-profile','export-format'])$(name).onchange=()=>{changed();refreshOutputEstimate();};
for(const name of ['mobile','desktop'])$(name+'-view').onclick=()=>{$('preview').classList.toggle('mobile',name==='mobile');for(const n of ['mobile','desktop']){$(n+'-view').classList.toggle('active',n===name);$(n+'-view').setAttribute('aria-pressed',String(n===name));}};
document.querySelectorAll('[data-tab]').forEach(b=>{b.onclick=()=>setTab(b.dataset.tab);b.onkeydown=e=>{const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(b);let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();tabs[next].focus();setTab(tabs[next].dataset.tab);}};});
document.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>setLayout(b.dataset.layout));
$('split-ratio').oninput=()=>document.documentElement.style.setProperty('--source-share',$('split-ratio').value+'%');
$('editor-size').onchange=()=>{document.documentElement.style.setProperty('--editor-size',$('editor-size').value+'px');changed();};
$('find-next').onclick=()=>{const editor=$('editor'),query=$('find-text').value;if(!query)return;let start=editor.value.indexOf(query,editor.selectionEnd);if(start<0)start=editor.value.indexOf(query);if(start<0){$('find-status').textContent='没有找到';return;}locateDiagnostic({range:{start,end:start+query.length}});$('find-status').textContent=`第 ${editor.value.slice(0,start).split('\n').length} 行`;};
$('find-text').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('find-next').click();}};
$('locate-preview').onclick=()=>{const offset=$('editor').selectionStart,blocks=(state.model?.blocks||[]).filter(b=>b.start<=offset&&b.end>=offset),block=blocks.at(-1);if(!block){status('当前段落暂无可定位的预览，请等待排版完成');return;}const target=$('preview').contentDocument?.querySelector(`[data-folio-block="${block.id}"]`);if(target){setTab('preview');setLayout('compare');target.scrollIntoView({block:'center'});target.style.outline='3px solid #bd8032';setTimeout(()=>target.style.outline='',2500);}};
$('preview').onload=()=>{const doc=$('preview').contentDocument;if(!doc)return;$('preview').contentWindow.scrollTo(0,previewPosition);highlightPreview();doc.addEventListener('dblclick',e=>{if(isPdf())return;const id=e.target.closest?.('[data-folio-block]')?.dataset.folioBlock,block=state.model?.blocks?.find(b=>b.id===id);if(block)locateDiagnostic({range:block});});doc.addEventListener('click',e=>{const link=e.target.closest?.('a');if(link&&!(link.getAttribute('href')||'').startsWith('#')){e.preventDefault();status('预览中的外部链接已禁用；导出后可由你主动打开。');}});};
$('repair-input').onchange=async e=>{
 const chosen=e.target.files[0],target=repairTarget;e.target.value='';if(!chosen||!target)return;
 if(target.revision!==revision){status('文档已修改，请重新选择当前问题进行修复');return;}
 try{
  let key=target.resourcePath||resourceKey(target.source,sourcePath),replacementRange=null;
  if(!key){const start=target.range?.start;if(start===undefined||$('editor').value.slice(start,target.range.end)!==target.source)throw new Error('无法可靠定位图片路径，请在原文修正后导入');replacementRange={start,end:target.range.end};key=resourceKey(chosen.name,sourcePath);}
  const image=new File([chosen],chosen.name,{type:chosen.type});Object.defineProperty(image,'webkitRelativePath',{value:key});
  const next=resourceFiles.filter(f=>(f.webkitRelativePath||f.name)!==key).concat(image),index=await buildResourceIndex(next);
  if(target.revision!==revision)return;if(replacementRange)$('editor').setRangeText(chosen.name,replacementRange.start,replacementRange.end,'preserve');resourceFiles=next;resources=index;changed();showFile();schedule();
 }catch(error){status(error.message,true);}
};
$('restore-draft').onclick=restoreDraft;
$('backup-draft').onclick=async()=>{try{if(pendingDraft?.file?.name?.toLowerCase().endsWith('.pdf')){const d=validateDraft(pendingDraft);await downloadSource('',d.file.name,unpackFile(d.file));}else{const rescue=rescueDraftText(pendingDraft);await downloadSource(rescue.text,rescue.name,null);}$('recovery-error').textContent='原文已生成，请确认保存完成；草稿仍保留。';}catch(error){$('recovery-error').textContent=error.message;}};
$('backup-project-draft').onclick=async()=>{const draft=pendingDraft;try{const d=validateDraft(draft),blob=await encodeProject(d);await downloadBlob(blob,safeFilename(d.sourcePath.split('/').at(-1).replace(/\.(md|markdown|pdf)$/i,''))+'.folio');$('recovery-error').textContent='完整项目备份已生成，请确认保存完成；草稿仍保留。';}catch(error){$('recovery-error').textContent=`完整备份不可用：${error.message}。仍可尝试“先保存原文”救援。`;}};
$('discard-draft').onclick=async()=>{try{draftWriteId=await store.clear(pendingDraft?.writeId||null);pendingDraft=null;$('recovery').close();$('editor').value='';file=null;resources=null;resourceFiles=[];sample=false;sourcePath='未命名.md';showFile();saveState('已放弃旧草稿 · 等待编辑');schedule();}catch(error){$('recovery-error').textContent=`清除失败：${error.message}`;}};
$('recovery').addEventListener('cancel',e=>e.preventDefault());
$('autosave').onchange=async()=>{try{localStorage.setItem('folio-autosave',$('autosave').checked?'on':'off');}catch{}if($('autosave').checked){revision++;queueSave();}else{clearTimeout(saveTimer);saveState('自动保存已关闭 · 已存草稿仍可清除');}};
$('clear-draft').onclick=async()=>{if(!(await protectReplacement('将清除当前浏览器中的草稿、导入资源和全部项目快照，并关闭自动保存。当前页面内容仍保留；下载到磁盘的项目不受影响。')))return;clearTimeout(saveTimer);$('autosave').checked=false;try{await saveQueue;draftWriteId=await store.clear();await clearSnapshots();try{localStorage.setItem('folio-autosave','off');}catch{}saveState('本机草稿和快照已清除 · 自动保存已关闭');}catch{saveState('清除未全部完成 · 请重试，原记录可能仍保留','error');}};
window.addEventListener('storage',e=>{if(e.key==='folio-autosave'&&e.newValue==='off'){clearTimeout(saveTimer);$('autosave').checked=false;saveState('其他标签页已关闭自动保存 · 请手动保存原文');}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&revision!==savedRevision)queueSave();});
window.addEventListener('beforeunload',e=>{if(dirty&&revision!==savedRevision){e.preventDefault();e.returnValue='';}});
function updatePdfReview(){
 $('pdf-review-page').replaceChildren();
 for(const page of pdfResult?.pages||[]){const option=document.createElement('option');option.value=page.number;option.textContent=`第 ${page.number} 页${pdfResult.diagnostics.some(d=>d.page===page.number)?' · 需核对':''}`;$('pdf-review-page').append(option);}
}
function showAndroidOriginal(number){
 if(!isAndroid()||!pdfResult)return;const index=pdfResult.pages.findIndex(p=>p.number===Number(number));
 const template=document.createElement('template');template.innerHTML=pdfResult.bodyHtml;const original=template.content.querySelectorAll('.pdf-reading-page')[index]?.querySelector('.pdf-page');$('pdf-local-source').replaceChildren();
 if(original){$('pdf-local-source').append(original);const label=document.createElement('p');label.textContent=`原文第 ${number} 页 · 保真图像，清晰度由 DPI 决定`;$('pdf-local-source').prepend(label);}
}
function reviewPdfPage(number){
 if(!isPdf()||!pdfResult||!state.model){status('请先等待当前 PDF 转换完成');return;}
 const index=pdfResult.pages.findIndex(p=>p.number===Number(number));if(index<0)return;
 $('pdf-review-page').value=String(number);$('pdf-source').data=pdfUrl+`#page=${number}&view=FitH`;showAndroidOriginal(number);setTab(isAndroid()?'source':'preview');setLayout('compare');
 const section=$('preview').contentDocument?.querySelectorAll('.pdf-reading-page')[index];section?.scrollIntoView({block:'start'});
 status(`正在核对原文第 ${number} 页 · ${pdfResult.diagnostics.filter(d=>d.page===Number(number)).map(d=>d.message).join('；')||'本页没有自动提示，仍请检查内容'}`);
}
$('review-pdf').onclick=()=>reviewPdfPage($('pdf-review-page').value);
$('pdf-review-page').onchange=()=>$('review-pdf').click();
$('next-pdf-issue').onclick=()=>{const pages=[...new Set((pdfResult?.diagnostics||[]).map(d=>d.page).filter(Boolean))].sort((a,b)=>a-b),current=Number($('pdf-review-page').value);if(!pages.length){status('没有带提示的页面，可选择页码逐页核对');return;}reviewPdfPage(pages.find(n=>n>current)||pages[0]);};
$('cancel-pdf').onclick=async()=>{const task=activePdf;if(!task)return;state.begin();outputVersion++;$('export').disabled=true;$('preview-loading').hidden=true;$('pdf-progress').hidden=true;$('result-meta').textContent='已取消';$('render-version').textContent='转换已取消 · 原文件保留';try{await task.cancel();status('已取消转换，原文件保留，可调整页码或分辨率重试');}catch(error){status(error.message,true);}};
$('print-document').onclick=async()=>{if(!state.model){status('请等待当前预览完成');return;}try{if(isAndroid()){const model=state.model,html=await prepareOutput(model,options,$('export-profile').value,false);if(model!==state.model)throw new Error('文档已变化，请重新打印');await requestPrint(html);}else{$('preview').contentWindow.focus();$('preview').contentWindow.print();}}catch(error){status(isAndroid()?error.message:'浏览器限制了预览打印，请先导出 HTML，打开后按 Ctrl+P 打印。',true);}};
const productTools=mountProductTools({snapshot,isPdf,getRevision:()=>revision,mayReplace,status,locateDiagnostic,
 repairResource(diagnostic,expectedRevision){if(expectedRevision!==revision){status('文档已修改，请重新打开资源面板',true);return;}repairTarget={...diagnostic,revision:expectedRevision};$('repair-input').click();},
 async applyProject(d,expectedRevision){
  validateDraft(d);const nextFiles=d.resources.map(unpackFile),index=await buildResourceIndex(nextFiles),nextFile=d.file?unpackFile(d.file):null;
  if(revision!==expectedRevision)throw new Error('文档已变化，未替换当前工作，请重新打开项目');
  automaticName=false;fileIntent++;begin();releasePdf();file=nextFile;sourcePath=d.sourcePath;resourceFiles=nextFiles;resources=index;$('editor').value=d.text;applyOptions(d.options);
  $('pdf-mode').value=d.pdfMode==='reading'?'reading':'faithful';$('pdf-dpi').value=['96','144','192'].includes(d.pdfDpi)?d.pdfDpi:'144';$('pdf-pages').value=typeof d.pdfPages==='string'?d.pdfPages:'';
  $('editor-size').value=['14','15','16','18','20'].includes(d.editorSize)?d.editorSize:'15';document.documentElement.style.setProperty('--editor-size',$('editor-size').value+'px');
  $('export-profile').value=['archive','reading','share'].includes(d.exportProfile)?d.exportProfile:'archive';$('export-format').value=d.exportFormat==='zip'?'zip':'html';
  if(isPdf()){pdfUrl=URL.createObjectURL(file);$('pdf-source').data=pdfUrl;}
  exportNameEdited=false;changed();showFile();setTab('source');schedule();
 },
 async setResources(files,expectedRevision){const index=await buildResourceIndex(files);const invalid=index.diagnostics.find(d=>d.code==='image-invalid');if(invalid)throw new Error(invalid.message);if(revision!==expectedRevision)throw new Error('文档已变化，请重新操作图片');resourceFiles=files;resources=index;changed();showFile();schedule();},
 onEdit(){changed();showFile();schedule(100);},
});
if(isAndroid()){
 document.body.classList.add('android-app');$('app-version').textContent='墨页 Folio Android 1.2.0';$('app-version').parentElement.lastChild.textContent='安卓离线版 · 文件通过系统选择器导入和保存，无需后台服务器。';
 $('pdf-dpi').value='96';$('assets').textContent='＋ 导入图片（可多选）';$('folder-input').removeAttribute('webkitdirectory');$('folder-input').accept='.png,.jpg,.jpeg,.webp,.gif,.svg';
 $('assets').nextElementSibling.nextElementSibling.textContent='安卓不读取整个文件夹。可打开完整项目，或逐项补齐相对路径图片。';
 $('pdf-mode-help').textContent='安卓在本机 PDF.js 中处理，最多 20 MiB、每次 30 页。保真保存原页图像；阅读仅重排简单文本，表格、公式、插图等保守回退。无 OCR。';
 $('save-project').title='原文、图片和参数一起保存到所选位置';
 window.FolioAndroidBack=()=>{const dialog=document.querySelector('dialog[open]');if(!dialog)return false;if(dialog.id==='replace-dialog'){closeReplacement(false);return true;}if(dialog.id==='recovery')return false;dialog.close();return true;};
}else fetch('/version.json').then(r=>r.json()).then(v=>$('app-version').textContent=`墨页 Folio ${v.version}`).catch(()=>{});
init().finally(()=>{document.querySelector('.workspace').inert=false;$('example').disabled=false;});
