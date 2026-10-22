import {escapeHtml} from './document.js';
import {resolveResource} from './resources.js';
import {mathPlugin} from './math-plugin.js';
export function renderMarkdown(source,resources=null,sourcePath='document.md'){
 if(new TextEncoder().encode(source).length>5*1024*1024)throw new Error('Markdown 超过 5 MiB，请拆分文档。');
 const env={math:[],diagnostics:[...(resources?.diagnostics||[])],nonce:crypto.randomUUID()};
 const md=window.markdownit({html:true,linkify:true,typographer:true,highlight:(code,language)=>{
  if(language&&window.hljs?.getLanguage(language))return `<pre class="hljs"><code>${hljs.highlight(code,{language,ignoreIllegals:true}).value}</code></pre>`;
  return `<pre><code>${escapeHtml(code)}</code></pre>`;
 }}).use(window.markdownitFootnote).use(mathPlugin);
 const tokens=md.parse(source,env),lineStarts=[0],blocks=[];
 if(env.math.length>500)throw new Error('单篇文档超过 500 个公式，请拆分后排版。');
 for(let i=0;i<source.length;i++)if(source[i]==='\n')lineStarts.push(i+1);
 const byMath=new Map(env.math.map(m=>[m.id,m]));
 for(const token of tokens){
  if(!token.map)continue;
  const range={start:lineStarts[token.map[0]]??0,end:lineStarts[token.map[1]]??source.length};
  if(token.nesting===1||['fence','code_block'].includes(token.type)){
   const id=`block-${blocks.length}`;token.attrSet('data-folio-internal',`${env.nonce}:${id}`);blocks.push({id,...range});
  }
  let cursor=range.start;
  for(const child of token.type==='folio_math'?[token]:(token.children||[])){
   if(child.type!=='folio_math')continue;
   const formula=byMath.get(child.meta.id),start=source.indexOf(formula.raw,cursor);
   formula.range=start>=range.start&&start<range.end?{start,end:start+formula.raw.length}:range;
   cursor=formula.range.end;
  }
 }
 const byBlock=new Map(blocks.map(block=>[block.id,block]));
 const rendered=md.renderer.render(tokens,md.options,env);
 const clean=DOMPurify.sanitize(rendered,{ALLOW_DATA_ATTR:false,FORBID_TAGS:['style','iframe','object','embed','video','audio','source','svg','math','form','input','button','meta','link','base'],FORBID_ATTR:['style','srcset','poster'],ADD_ATTR:['data-folio-internal']});
 const template=document.createElement('template');template.innerHTML=clean;
 for(const el of template.content.querySelectorAll('[data-folio-internal]')){
  const value=el.getAttribute('data-folio-internal');el.removeAttribute('data-folio-internal');
  if(!value.startsWith(env.nonce+':'))continue;
  const id=value.slice(env.nonce.length+1);
  if(byMath.has(id))el.dataset.folioMath=id;
  else if(byBlock.has(id))el.dataset.folioBlock=id;
 }
 const missingAssets=[];
 for(const img of template.content.querySelectorAll('img')){
  const path=img.getAttribute('src')||'';const r=resolveResource(resources,path,sourcePath);
  img.removeAttribute('src');
  if(r.dataUrl){img.src=r.dataUrl;img.loading='lazy';img.decoding='async';}
  else{
   missingAssets.push(path);const blockId=img.closest('[data-folio-block]')?.dataset.folioBlock,block=byBlock.get(blockId);
   const start=source.indexOf(path,block?.start||0),range=start>=0?{start,end:start+path.length}:block;
   const previewId=`folio-image-${env.diagnostics.length}`;
   env.diagnostics.push({...r.diagnostic,range,previewId});const marker=document.createElement('span');marker.id=previewId;marker.className='missing-image';marker.textContent=`图片缺失：${img.alt||path}`;img.replaceWith(marker);
  }
 }
 const toc=[],seen=new Map(),used=new Set();
 for(const h of template.content.querySelectorAll('h1,h2,h3,h4,h5,h6')){
  const text=h.textContent,base=text.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu,'-')||'section';
  let count=(seen.get(base)||0)+1,id=base+(count>1?'-'+count:'');
  while(used.has(id)){count++;id=base+'-'+count;}
  seen.set(base,count);used.add(id);h.id=id;toc.push({id,text,level:Number(h.tagName[1])});
 }
 for(const a of template.content.querySelectorAll('a')){if(!a.getAttribute('href')?.startsWith('#'))a.rel='noopener noreferrer';}
 const byId=new Map(env.math.map(m=>[m.id,m]));
 const math=[...template.content.querySelectorAll('[data-folio-math]')].map(el=>byId.get(el.dataset.folioMath));
 return {title:toc[0]?.text||sourcePath.split('/').at(-1).replace(/\.(md|markdown)$/i,''),bodyHtml:template.innerHTML,toc,diagnostics:env.diagnostics,math,blocks,missingAssets:[...new Set(missingAssets)],stats:{characters:source.length,headings:toc.length,formulas:math.length}};
}
