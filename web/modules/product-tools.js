import {encodeProject,decodeProject,downloadBlob} from './project.js';
import {unpackFile} from './drafts.js';
import {listSnapshots,saveSnapshot,deleteSnapshot,clearSnapshots,snapshotEpoch} from './history.js';
import {resourceKey} from './resources.js';
import {safeFilename} from './export.js';
import {isAndroid} from './platform.js';
const $=id=>document.getElementById(id);
const templates={fraction:'$$\n\\frac{a}{b} + \\sqrt{x^2+y^2}\n$$',matrix:'$$\n\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}\n$$',cases:'$$\nf(x)=\\begin{cases}x^2 & x \\ge 0 \\\\ -x & x < 0\\end{cases}\n$$',aligned:'$$\n\\begin{aligned}a &= b+c \\\\ d &= e-f\\end{aligned}\n$$'};
export function mountProductTools(ctx){
 let formulaSelection=null,resourceUrls=[],busy=false;
 const report=fn=>async(...args)=>{try{await fn(...args);}catch(error){ctx.status(error.message,true);}};
 const name=()=>safeFilename(ctx.snapshot().sourcePath.split('/').at(-1).replace(/\.(md|markdown|pdf)$/i,''));
 const saveProject=report(async()=>{if(busy)return;busy=true;try{const blob=await encodeProject(ctx.snapshot());await downloadBlob(blob,name()+'.folio');ctx.status(isAndroid()?'完整项目已保存到所选位置':'完整项目已生成 · 请确认浏览器下载完成');}finally{busy=false;}});
 $('save-project').onclick=saveProject;$('open-project').onclick=()=>$('project-input').click();
 async function importProject(blob){
  const revision=ctx.getRevision(),d=await decodeProject(blob);
  if(revision!==ctx.getRevision())throw new Error('校验期间文档已变化，请重新打开项目');
  if(!await ctx.mayReplace())return;await ctx.applyProject(d,revision);
 }
 $('project-input').onchange=report(async e=>{const file=e.target.files[0];e.target.value='';if(file)await importProject(file);});
 async function history(){
  const rows=await listSnapshots();$('history-list').replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.textContent='暂无快照。保存后可在此恢复最近项目。';$('history-list').append(p);}
  for(const row of rows){
   const section=document.createElement('div'),label=document.createElement('p');section.className='history-row';label.textContent=`${row.name} · ${new Date(row.updatedAt).toLocaleString()} · ${(row.blob.size/1024/1024).toFixed(2)} MiB`;
   const open=document.createElement('button');open.textContent='恢复';open.className='small-button';open.onclick=report(async()=>{$('history-dialog').close();await importProject(row.blob);});
   const download=document.createElement('button');download.textContent='下载项目';download.className='small-button';download.onclick=report(()=>downloadBlob(row.blob,safeFilename(row.name)+'.folio'));
   const remove=document.createElement('button');remove.textContent='删除';remove.className='small-button';remove.onclick=report(async()=>{await deleteSnapshot(row.id);await history();});
   section.append(label,open,download,remove);$('history-list').append(section);
  }
 }
 $('project-history').onclick=report(async()=>{await history();$('history-dialog').showModal();});
 $('save-snapshot').onclick=report(async()=>{const revision=ctx.getRevision(),epoch=await snapshotEpoch(),blob=await encodeProject(ctx.snapshot());if(revision!==ctx.getRevision())throw new Error('文档已变化，请重新保存快照');await saveSnapshot(name(),blob,epoch);await history();ctx.status('已保存本机快照；可下载项目进行独立备份');});
 $('clear-history').onclick=report(async()=>{await clearSnapshots();await history();ctx.status('本机项目快照已清除');});$('close-history').onclick=()=>$('history-dialog').close();
 function resourceUsage(d){
  const md=window.markdownit({html:true}),refs=[];
  const tokens=md.parse(d.text,{});
  function visit(tokens){for(const t of tokens){if(t.type==='image')refs.push(t.attrGet('src'));if(t.children)visit(t.children);if(t.type==='html_block'||t.type==='html_inline'){const template=document.createElement('template');template.innerHTML=DOMPurify.sanitize(t.content);for(const image of template.content.querySelectorAll('img[src]'))refs.push(image.getAttribute('src'));}}}
  visit(tokens);return refs.map(source=>({source,key:resourceKey(source,d.sourcePath)}));
 }
 async function showResources(){
  for(const url of resourceUrls)URL.revokeObjectURL(url);resourceUrls=[];
  const d=ctx.snapshot(),revision=ctx.getRevision(),refs=resourceUsage(d),used=new Set(refs.map(r=>r.key));$('resource-list').replaceChildren();
  for(const r of d.resources){
   const row=document.createElement('div');row.className='resource-row';const img=document.createElement('img');img.alt=r.name;
   // Resource preview uses the same validated/sanitized data as the renderer, never raw SVG markup.
   const {buildResourceIndex}=await import('./resources.js'),index=await buildResourceIndex([unpackFile(r)]);img.src=index.entries.get(r.path)?.[0]||'';
   const text=document.createElement('div');text.textContent=`${r.path} · ${(r.blob.size/1024).toFixed(1)} KiB · ${used.has(r.path)?'已引用':'未使用'}`;
   const locate=document.createElement('button');locate.className='small-button';locate.textContent='定位引用';locate.disabled=!used.has(r.path);locate.onclick=()=>{if(ctx.getRevision()!==revision){ctx.status('文档已变化，请重新打开资源面板');return;}const ref=refs.find(v=>v.key===r.path),start=d.text.indexOf(ref.source);$('resource-dialog').close();if(start>=0)ctx.locateDiagnostic({range:{start,end:start+ref.source.length}});};
   const replace=document.createElement('button');replace.className='small-button';replace.textContent='替换';replace.onclick=()=>{
    const input=document.createElement('input');input.type='file';input.accept='.'+r.name.split('.').at(-1);input.onchange=report(async()=>{const chosen=input.files[0];if(!chosen)return;if(chosen.name.split('.').at(-1).toLowerCase()!==r.name.split('.').at(-1).toLowerCase())throw new Error('替换图片需保持同一格式，避免路径与内容类型不一致');const image=new File([chosen],r.name,{type:chosen.type});Object.defineProperty(image,'webkitRelativePath',{value:r.path});await ctx.setResources(d.resources.map(v=>v.path===r.path?image:unpackFile(v)),revision);await showResources();});input.click();
   };row.append(img,text,locate,replace);$('resource-list').append(row);
  }
  const missing=refs.filter(ref=>!d.resources.some(r=>r.path===ref.key));for(const ref of missing){const p=document.createElement('p');p.className='missing-resource';p.textContent=`缺失：${ref.source} · 请通过下方转换提示选择图片修复`; $('resource-list').append(p);}
  if(!d.resources.length&&!missing.length){const p=document.createElement('p');p.textContent='当前没有图片资源，可直接粘贴截图或导入图片。';$('resource-list').append(p);}
  $('remove-unused').disabled=ctx.isPdf()||!d.resources.some(r=>!used.has(r.path));
 }
 $('manage-resources').onclick=report(async()=>{await showResources();$('resource-dialog').showModal();});$('close-resources').onclick=()=>$('resource-dialog').close();
 $('remove-unused').onclick=report(async()=>{const d=ctx.snapshot(),revision=ctx.getRevision(),used=new Set(resourceUsage(d).map(r=>r.key));await ctx.setResources(d.resources.filter(r=>used.has(r.path)).map(unpackFile),revision);await showResources();});
 $('formula-help').onclick=()=>{const e=$('editor');formulaSelection={start:e.selectionStart,end:e.selectionEnd,revision:ctx.getRevision()};$('formula-dialog').showModal();};$('close-formulas').onclick=()=>$('formula-dialog').close();
 document.querySelectorAll('[data-formula]').forEach(button=>button.onclick=()=>{if(ctx.isPdf())return;if(formulaSelection?.revision!==ctx.getRevision()){ctx.status('文档已变化，请重新打开公式模板');return;}const editor=$('editor'),value='\n\n'+templates[button.dataset.formula]+'\n\n';editor.setRangeText(value,formulaSelection.start,formulaSelection.end,'end');$('formula-dialog').close();editor.focus();ctx.onEdit();});
 $('editor').addEventListener('paste',report(async event=>{
  const items=[...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/'));if(!items.length||ctx.isPdf())return;event.preventDefault();
  const revision=ctx.getRevision(),editor=$('editor'),start=editor.selectionStart,end=editor.selectionEnd,d=ctx.snapshot(),files=d.resources.map(unpackFile),links=[];
  for(const item of items){const raw=item.getAsFile(),ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[item.type];if(!raw||!ext)throw new Error('剪贴板图片格式不支持，请先另存 PNG');const name='paste-'+crypto.randomUUID()+'.'+ext,path=resourceKey('images/'+name,d.sourcePath),f=new File([raw],name,{type:item.type});Object.defineProperty(f,'webkitRelativePath',{value:path});files.push(f);links.push(`![截图](images/${name})`);}
  // Validate before touching either source or resource state.
  const {buildResourceIndex}=await import('./resources.js'),checked=await buildResourceIndex(files);if(checked.diagnostics.length)throw new Error(checked.diagnostics[0].message);
  if(revision!==ctx.getRevision())throw new Error('粘贴期间文档已变化，请重新粘贴');
  await ctx.setResources(files,revision);editor.setRangeText('\n'+links.join('\n')+'\n',start,end,'end');ctx.onEdit();
 }));
 document.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229||!(event.ctrlKey||event.metaKey)||document.querySelector('dialog[open]')||document.querySelector('.workspace').inert)return;
  const key=event.key.toLowerCase();if(key==='s'){event.preventDefault();saveProject();}else if(key==='f'&&!ctx.isPdf()){event.preventDefault();$('find-text').focus();}else if(key==='enter'&&!ctx.isPdf()){event.preventDefault();$('locate-preview').click();}else if(key==='e'&&event.shiftKey){event.preventDefault();if(!$('export').disabled)$('export').click();}
 });
 return {importProject};
}
