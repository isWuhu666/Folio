let loading,queue=Promise.resolve();
function loadMath(){
 if(!loading)loading=new Promise((resolve,reject)=>{
  window.MathJax={
   loader:{paths:{mathjax:'/vendor/mathjax',fonts:'/vendor'},load:['[tex]/ams','ui/safe']},
   output:{font:'mathjax-newcm',fontPath:'/vendor/mathjax-font'},
   tex:{packages:{'[-]':['autoload','require','noundefined']},tags:'ams',maxBuffer:50000,maxMacros:1000,formatError:(_jax,error)=>{throw error;}},
   svg:{fontCache:'none'},startup:{typeset:false},options:{enableMenu:false,safeOptions:{allow:{URLs:'none',classes:'none',cssIDs:'none',styles:'none'}}},
  };
  const script=document.createElement('script');script.src='/vendor/mathjax/tex-svg.js';
  const timeout=setTimeout(()=>reject(new Error('公式引擎启动超时，请检查本地资源和浏览器设置后刷新重试。')),15000);
  script.onload=()=>MathJax.startup.promise.then(()=>{clearTimeout(timeout);resolve();},error=>{clearTimeout(timeout);reject(error);});
  script.onerror=()=>{clearTimeout(timeout);reject(new Error('公式排版资源缺失，请重新运行 安装.cmd。'));};
  document.head.append(script);
 });
 return loading;
}
export function typesetDocument(draft,options={},isCurrent=()=>true){
 const job=queue.then(async()=>{
  if(!draft.math.length)return {...draft};
  await loadMath();MathJax.texReset();
  const template=document.createElement('template');template.innerHTML=draft.bodyHtml;
  const diagnostics=[...draft.diagnostics];
  let completed=0;
  for(const formula of draft.math){
   if(!isCurrent())throw new DOMException('已被新版本替代','AbortError');
   if(completed++%8===0)await new Promise(resolve=>setTimeout(resolve,0));
   const slot=template.content.querySelector(`[data-folio-math="${formula.id}"]`);if(!slot)continue;
   slot.setAttribute('aria-label',formula.tex);slot.title=formula.tex;slot.id=`folio-${formula.id}`;
   try{
    if(formula.tex.length>50000)throw new Error('单个公式过长，请拆分。');
    const node=await MathJax.tex2svgPromise(formula.tex,{display:formula.display,em:17,ex:8.5,containerWidth:options.contentWidth||820});
    const error=node.querySelector('[data-mjx-error],merror');if(error)throw new Error(error.getAttribute('data-mjx-error')||'无法解析公式');
    for(const el of node.querySelectorAll('*'))for(const attr of [...el.attributes]){
     if(/^on/i.test(attr.name)||(/href$/i.test(attr.name)&&!attr.value.startsWith('#')))el.removeAttribute(attr.name);
    }
    slot.replaceChildren(node);slot.classList.add(formula.display?'math-display':'math-inline');
   }catch(error){
    slot.textContent=formula.tex;slot.classList.add('math-error');diagnostics.push({code:'math-error',message:`公式排版失败：${error.message}`,source:formula.tex,range:formula.range,previewId:slot.id});
   }
  }
  const sheet=MathJax.svgStylesheet();
  const attached=sheet.isConnected;if(!attached)document.head.append(sheet);
  const mathCss=MathJax.startup.adaptor.cssText(sheet);if(!attached)sheet.remove();
  return {...draft,bodyHtml:template.innerHTML,diagnostics,mathCss};
 });
 queue=job.catch(()=>{});return job;
}
