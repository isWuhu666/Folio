let loading,queue=Promise.resolve();
function loadMath(){
 if(!loading)loading=new Promise((resolve,reject)=>{
  window.MathJax={
   loader:{paths:{mathjax:'/vendor/mathjax',fonts:'/vendor'},load:['[tex]/ams']},
   output:{font:'mathjax-newcm',fontPath:'/vendor/mathjax-font'},
   tex:{packages:{'[-]':['autoload','require','noundefined']},tags:'ams',maxBuffer:50000,maxMacros:1000,formatError:(_jax,error)=>{throw error;}},
   svg:{fontCache:'none'},startup:{typeset:false},options:{enableMenu:false},
  };
  const script=document.createElement('script');script.src='/vendor/mathjax/tex-svg.js';
  script.onload=()=>MathJax.startup.promise.then(resolve,reject);
  script.onerror=()=>reject(new Error('公式排版资源缺失，请重新运行 安装.cmd。'));
  document.head.append(script);
 });
 return loading;
}
export function typesetDocument(draft,options={}){
 const job=queue.then(async()=>{
  if(!draft.math.length)return {...draft};
  await loadMath();MathJax.texReset();
  const template=document.createElement('template');template.innerHTML=draft.bodyHtml;
  const diagnostics=[...draft.diagnostics];
  for(const formula of draft.math){
   const slot=template.content.querySelector(`[data-folio-math="${formula.id}"]`);if(!slot)continue;
   slot.setAttribute('aria-label',formula.tex);slot.title=formula.tex;
   try{
    if(formula.tex.length>50000)throw new Error('单个公式过长，请拆分。');
    const node=await MathJax.tex2svgPromise(formula.tex,{display:formula.display,em:17,ex:8.5,containerWidth:options.contentWidth||820});
    const error=node.querySelector('[data-mjx-error],merror');if(error)throw new Error(error.getAttribute('data-mjx-error')||'无法解析公式');
    slot.replaceChildren(node);slot.classList.add(formula.display?'math-display':'math-inline');
   }catch(error){
    slot.textContent=formula.tex;slot.classList.add('math-error');diagnostics.push({code:'math-error',message:`公式排版失败：${error.message}`,source:formula.tex});
   }
  }
  const sheet=MathJax.svgStylesheet();
  const attached=sheet.isConnected;if(!attached)document.head.append(sheet);
  const mathCss=MathJax.startup.adaptor.cssText(sheet);if(!attached)sheet.remove();
  return {...draft,bodyHtml:template.innerHTML,diagnostics,mathCss};
 });
 queue=job.catch(()=>{});return job;
}
