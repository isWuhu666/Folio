import {readZip,writeZip} from './zip.js';
import {validateDraft,unpackFile} from './drafts.js';
import {buildResourceIndex} from './resources.js';
import {saveFile} from './platform.js';
const types={md:'text/markdown',markdown:'text/markdown',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',gif:'image/gif',webp:'image/webp'};
function fileType(name){return types[name.split('.').at(-1).toLowerCase()];}
function safeRelative(path){return typeof path==='string'&&path.length<=1000&&!/^[\/\\]|[\x00-\x1f:]/.test(path)&&path.split(/[\/\\]/).every(p=>p&&p!=='.'&&p!=='..');}
export async function encodeProject(value){
 validateDraft(value);const entries=[],manifest={format:'folio-project',version:1,text:value.text,sourcePath:value.sourcePath,options:value.options,editorSize:value.editorSize,pdfMode:value.pdfMode,pdfDpi:value.pdfDpi,pdfPages:value.pdfPages||'',exportProfile:value.exportProfile||'archive',exportFormat:value.exportFormat||'html',updatedAt:Date.now(),resources:[],file:null};
 if(value.file){const ext=value.file.name.split('.').at(-1).toLowerCase(),entry='source/original.'+ext;manifest.file={name:value.file.name,path:value.file.path,entry};entries.push([entry,value.file.blob]);}
 value.resources.forEach((r,i)=>{const entry=`assets/${i}.${r.name.split('.').at(-1).toLowerCase()}`;manifest.resources.push({name:r.name,path:r.path,entry});entries.push([entry,r.blob]);});
 return writeZip([['manifest.json',JSON.stringify(manifest,null,2)],...entries]);
}
export async function decodeProject(blob){
 const entries=await readZip(blob),meta=entries.get('manifest.json');if(!meta||meta.size>32*1024*1024)throw new Error('项目缺少有效清单');
 const m=JSON.parse(await meta.text());if(m.format!=='folio-project'||m.version!==1||!Array.isArray(m.resources)||m.resources.length>256||!safeRelative(m.sourcePath)||!/\.(md|markdown|pdf)$/i.test(m.sourcePath))throw new Error('不支持的项目版本或原文路径');
 if(!m.options||typeof m.options!=='object'||Array.isArray(m.options)||m.pdfPages!==undefined&&(typeof m.pdfPages!=='string'||m.pdfPages.length>400||!/^[\d,\s-]*$/.test(m.pdfPages)))throw new Error('项目排版或页码参数无效');
 const o=m.options;m.options={theme:['modern','academic','report'].includes(o.theme)?o.theme:'modern',fontFamily:o.fontFamily==='serif'?'serif':'sans',fontSize:Number.isFinite(Number(o.fontSize))?Math.min(24,Math.max(12,Number(o.fontSize))):17,lineHeight:Number.isFinite(Number(o.lineHeight))?Math.min(2.4,Math.max(1.3,Number(o.lineHeight))):1.8,contentWidth:Number.isFinite(Number(o.contentWidth))?Math.min(1200,Math.max(480,Number(o.contentWidth))):820};
 const used=new Set(['manifest.json']),paths=new Set();
 function restore(r,isSource=false){
  if(!r||typeof r.name!=='string'||!safeRelative(r.path)||!safeRelative(r.entry)||r.name!==r.name.split(/[\/\\]/).at(-1)||!fileType(r.name)||used.has(r.entry)||paths.has(r.path)||!entries.has(r.entry))throw new Error('项目资源清单无效');
  if(isSource?!/\.(md|markdown|pdf)$/i.test(r.name):!/\.(png|jpe?g|webp|gif|svg)$/i.test(r.name))throw new Error('项目包含不支持的资源');
  used.add(r.entry);paths.add(r.path);const original=entries.get(r.entry);return {name:r.name,path:r.path,blob:new Blob([original],{type:fileType(r.name)})};
 }
 const d={...m,file:m.file?restore(m.file,true):null,resources:m.resources.map(r=>restore(r))};validateDraft(d);
 if(used.size!==entries.size)throw new Error('项目包含未声明文件');
 if(/\.pdf$/i.test(d.sourcePath)){if(!d.file||!/\.pdf$/i.test(d.file.name)||await d.file.blob.slice(0,5).text()!=='%PDF-')throw new Error('项目 PDF 原文件无效');}
 else if(d.file&&/\.pdf$/i.test(d.file.name))throw new Error('项目原文类型不一致');
 const index=await buildResourceIndex(d.resources.map(unpackFile));if(index.diagnostics.length)throw new Error(index.diagnostics[0].message);
 return d;
}
export function downloadBlob(blob,name){return saveFile(blob,name);}
