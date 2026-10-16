import {test,expect} from '@playwright/test';
test('relative image paths are exact and SVG is sanitized',async({page})=>{
 await page.goto('/');
 const r=await page.evaluate(async()=>{
  const {buildResourceIndex,resolveResource}=await import('/modules/resources.js');
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><image href="https://evil.example/a"/><circle cx="5" cy="5" r="3" onload="alert(1)"/></svg>';
  const make=(path,text)=>{const f=new File([text],path.split('/').at(-1),{type:'image/svg+xml'});Object.defineProperty(f,'webkitRelativePath',{value:path});return f;};
  const idx=await buildResourceIndex([make('资料/图/实验 图.svg',svg),make('另一个/图/实验 图.svg','<svg xmlns="http://www.w3.org/2000/svg"/>')]);
  return [resolveResource(idx,'图/实验%20图.svg','资料/main.md'),resolveResource(idx,'图/实验 图.svg','main.md'),resolveResource(idx,'../../../x.svg','main.md')];
 });
 expect(r[0].dataUrl).toMatch(/^data:image\/svg\+xml/);
 const decoded=Buffer.from(r[0].dataUrl.split(',')[1],'base64').toString();expect(decoded).not.toMatch(/script|onload|evil.example/);
 expect(r[1].dataUrl).toBeNull();expect(r[2].dataUrl).toBeNull();
});
test('size limits reject large documents before parsing or image decoding',async({page})=>{
 await page.goto('/');const r=await page.evaluate(async()=>{
  const {buildResourceIndex}=await import('/modules/resources.js');const {renderMarkdown}=await import('/modules/markdown.js');
  let assets=false,md=false;
  try{await buildResourceIndex([new File([new Uint8Array(80*1024*1024+1)],'huge.png',{type:'image/png'})]);}catch(e){assets=e.message.includes('80 MiB');}
  try{renderMarkdown('a'.repeat(5*1024*1024+1),null,'huge.md');}catch(e){md=e.message.includes('5 MiB');}
  return {assets,md};
 });expect(r).toEqual({assets:true,md:true});
});
