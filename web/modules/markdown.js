import {escapeHtml} from './document.js';
import {resolveResource} from './resources.js';
import {mathPlugin} from './math-plugin.js';
export function renderMarkdown(source,resources=null,sourcePath='document.md'){
 if(new TextEncoder().encode(source).length>5*1024*1024)throw new Error('Markdown 超过 5 MiB，请拆分文档。');
 const env={math:[],diagnostics:[...(resources?.diagnostics||[])]};
 const md=window.markdownit({html:true,linkify:true,typographer:true,highlight:(code,language)=>{
  if(language&&window.hljs?.getLanguage(language))return `<pre class="hljs"><code>${hljs.highlight(code,{language,ignoreIllegals:true}).value}</code></pre>`;
  return `<pre><code>${escapeHtml(code)}</code></pre>`;
 }}).use(window.markdownitFootnote).use(mathPlugin);
 const rendered=md.render(source,env);
 const clean=DOMPurify.sanitize(rendered,{FORBID_TAGS:['style','iframe','object','embed','video','audio','source','svg','math','form','input','button'],FORBID_ATTR:['style','srcset','poster'],ADD_ATTR:['data-folio-math']});
 const template=document.createElement('template');template.innerHTML=clean;
 const missingAssets=[];
 for(const img of template.content.querySelectorAll('img')){
  const path=img.getAttribute('src')||'';const r=resolveResource(resources,path,sourcePath);
  img.removeAttribute('src');
  if(r.dataUrl){img.src=r.dataUrl;img.loading='lazy';img.decoding='async';}
  else{missingAssets.push(path);env.diagnostics.push(r.diagnostic);const marker=document.createElement('span');marker.className='missing-image';marker.textContent=`图片缺失：${img.alt||path}`;img.replaceWith(marker);}
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
 return {title:toc[0]?.text||sourcePath.split('/').at(-1).replace(/\.(md|markdown)$/i,''),bodyHtml:template.innerHTML,toc,diagnostics:env.diagnostics,math,missingAssets:[...new Set(missingAssets)],stats:{characters:source.length,headings:toc.length,formulas:math.length}};
}
