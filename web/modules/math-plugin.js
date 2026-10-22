function add(env,tex,display,raw){const id=`math-${env.math.length+1}`;env.math.push({id,tex:tex.trim(),display,raw});return id;}
export function mathPlugin(md){
 md.inline.ruler.before('escape','folio_math',(state,silent)=>{
  const src=state.src,pos=state.pos;
  let open,close,display=false;
  if(src.startsWith('\\(',pos)){open='\\(';close='\\)';}
  else if(src.startsWith('\\[',pos)){open='\\[';close='\\]';display=true;}
  else if(src.startsWith('$$',pos)){open=close='$$';display=true;}
  else if(src[pos]==='$'&&!/\s/.test(src[pos+1]||' ')){open=close='$';}
  else return false;
  let end=pos+open.length;
  while((end=src.indexOf(close,end))>=0){
   if(src[end-1]==='\\'){end+=close.length;continue;}
   if(open==='$'&&(/\s/.test(src[end-1])||/\d/.test(src[end+1]||'')||src.slice(pos+1,end).includes('`')))return false;
   break;
  }
  if(end<0||(!display&&src.slice(pos,end).includes('\n'))){
   if(!silent)state.env.diagnostics.push({code:'math-unclosed',message:'发现未闭合的公式分隔符，已保留原文。',source:src.slice(pos,pos+60)});
   return false;
  }
  if(!silent){const token=state.push('folio_math','',0);token.meta={id:add(state.env,src.slice(pos+open.length,end),display,src.slice(pos,end+close.length)),display};}
  state.pos=end+close.length;return true;
 });
 md.block.ruler.before('fence','folio_math_block',(state,start,end,silent)=>{
  const first=state.src.slice(state.bMarks[start]+state.tShift[start],state.eMarks[start]);
  const open=first.startsWith('$$')?'$$':first.startsWith('\\[')?'\\[':null;
  if(!open)return false;
  const close=open==='$$'?'$$':'\\]';
  let content=first.slice(open.length),last=start,found=content.indexOf(close);
  while(found<0&&last+1<end){last++;content+='\n'+state.src.slice(state.bMarks[last]+state.tShift[last],state.eMarks[last]);found=content.indexOf(close);}
  if(found<0||content.slice(found+close.length).trim())return false;
  if(silent)return true;
  const token=state.push('folio_math','',0);token.block=true;token.map=[start,last+1];token.meta={id:add(state.env,content.slice(0,found),true,open+content.slice(0,found)+close),display:true};state.line=last+1;return true;
 },{alt:['paragraph','reference','blockquote','list']});
 md.renderer.rules.folio_math=(tokens,idx,_options,env)=>{const m=tokens[idx].meta;return `<${m.display?'div':'span'} class="math-slot" data-folio-internal="${env.nonce}:${m.id}"></${m.display?'div':'span'}>`;};
}
