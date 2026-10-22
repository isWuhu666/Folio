import {defaults,escapeHtml} from './document.js';
import {saveFile} from './platform.js';
const css=await fetch('/document.css').then(r=>{if(!r.ok)throw new Error('文档样式缺失，请重新安装。');return r.text();});
const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
export function buildHtml(model,options={}, {allowMissing=false}={}){
 if(model.missingAssets.length&&!allowMissing)throw new Error(`仍有 ${model.missingAssets.length} 张图片缺失，请先补充图片或选择带标记导出。`);
 if(!allowMissing&&model.diagnostics.some(d=>['math-error','math-unclosed'].includes(d.code)))throw new Error('公式仍有问题，请修复或明确选择带问题导出。');
 const o={...defaults,...options};
 const theme=['academic','modern','report'].includes(o.theme)?o.theme:'modern';
 const font=o.fontFamily==='serif'?'Georgia,"Noto Serif CJK SC","Source Han Serif SC","SimSun",serif':'Inter,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
 const vars=`:root{--body-font:${font};--body-size:${clamp(o.fontSize,12,28,17)}px;--leading:${clamp(o.lineHeight,1.2,2.6,1.8)};--content-width:${clamp(o.contentWidth,480,1400,820)}px;}`;
 const toc=model.toc.length>1?`<nav class="document-toc" aria-label="文档目录"><details><summary>文档目录</summary><ol>${model.toc.map(h=>`<li class="level-${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`).join('')}</ol></details></nav>`:'';
 const warning=model.missingAssets.length||model.diagnostics.some(d=>['math-error','math-unclosed'].includes(d.code))?'<aside class="export-warning">本文含有缺失图片或未成功排版的公式，请对照原文核对。</aside>':'';
 const audit=inspectBody(model.bodyHtml);
 if(audit.external||audit.active)throw new Error('输出安全检查未通过：存在外部资源或活动内容。');
 return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="墨页 Folio"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(model.title)}</title><style>${css}\n${model.mathCss||''}\n${vars}</style></head><body class="theme-${theme}"><main class="document">${warning}${toc}<article>${model.bodyHtml}</article><footer class="document-footer">墨页 Folio · 本地排版</footer></main></body></html>`;
}
export function inspectBody(html){
 const template=document.createElement('template');template.innerHTML=html;
 let active=!!template.content.querySelector('script,iframe,object,embed,form,meta,link,base'),external=0;
 for(const el of template.content.querySelectorAll('*'))for(const attr of [...el.attributes]){
  if(/^on/i.test(attr.name)||(/href$/i.test(attr.name)&&/^\s*(javascript|vbscript|data):/i.test(attr.value)))active=true;
  if(['src','srcset','poster'].includes(attr.name)&&!attr.value.startsWith('data:image/'))external++;
  if(attr.name==='style'&&/url\s*\(|@import|expression\s*\(/i.test(attr.value))active=true;
 }
 return {active,external,images:template.content.querySelectorAll('img[src^="data:image/"]').length};
}
export function safeFilename(title){return (title||'文档').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'文档';}
export function downloadHtml(html,filename){
 return saveFile(new Blob([html],{type:'text/html;charset=utf-8'}),safeFilename(filename)+'.html');
}
