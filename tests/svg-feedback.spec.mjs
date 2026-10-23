import {test,expect} from '@playwright/test';

const referencedSvg='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><defs><rect id="square" width="20" height="20" fill="green"/></defs><use href="#square"/></svg>';

test('removed SVG references report a nonblocking PNG suggestion through Markdown and project roundtrip',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(svg)=>{
  const {buildResourceIndex}=await import('/modules/resources.js');
  const {renderMarkdown}=await import('/modules/markdown.js');
  const {buildHtml}=await import('/modules/export.js');
  const {encodeProject,decodeProject}=await import('/modules/project.js');
  const {unpackFile}=await import('/modules/drafts.js');
  const file=new File([svg],'reference.svg',{type:'image/svg+xml'});
  const text='![方块](reference.svg)',index=await buildResourceIndex([file]);
  const model=renderMarkdown(text,index,'main.md');
  const draft={version:1,text,sourcePath:'main.md',file:null,resources:[{name:file.name,path:file.name,blob:file}],options:{}};
  const restored=await decodeProject(await encodeProject(draft));
  const reindexed=await buildResourceIndex(restored.resources.map(unpackFile));
  return {diagnostics:index.diagnostics,markdownDiagnostics:model.diagnostics,clean:atob(index.entries.get(file.name)[0].split(',')[1]),exported:buildHtml(model).includes('data:image/svg+xml'),restoredText:restored.text,restoredDiagnostics:reindexed.diagnostics};
 },referencedSvg);
 expect(result.diagnostics).toEqual([expect.objectContaining({code:'image-sanitized',severity:'warning',source:'reference.svg',message:expect.stringMatching(/PNG/)})]);
 expect(result.markdownDiagnostics).toEqual(result.diagnostics);
 expect(result.restoredDiagnostics).toEqual(result.diagnostics);
 expect(result.clean).not.toContain('<use');
 expect(result.exported).toBe(true);
 expect(result.restoredText).toBe('![方块](reference.svg)');
});

test('plain SVG has no warning while active elements and unsafe attributes remain removed',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {buildResourceIndex}=await import('/modules/resources.js');
  const plain='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>';
  const unsafe='<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><p>unsafe</p></foreignObject><image href="https://evil.example/a"/><use href="#a"/><animate attributeName="x"/><a href="javascript:alert(1)"><circle r="2"/></a><rect id="a" width="20" height="20" onload="alert(1)" fill="url(https://evil.example/a)"/></svg>';
  const [plainIndex,unsafeIndex]=await Promise.all([plain,unsafe].map(svg=>buildResourceIndex([new File([svg],'image.svg',{type:'image/svg+xml'})])));
  return {plainDiagnostics:plainIndex.diagnostics,unsafeDiagnostics:unsafeIndex.diagnostics,clean:atob(unsafeIndex.entries.get('image.svg')[0].split(',')[1])};
 });
 expect(result.plainDiagnostics).toEqual([]);
 expect(result.unsafeDiagnostics).toEqual([expect.objectContaining({code:'image-sanitized',severity:'warning'})]);
 expect(result.clean).not.toMatch(/script|foreignObject|<image|<use|<animate|<a\s|href|onload|url\s*\(|evil\.example/i);
 expect(result.clean).toContain('<rect');
});

test('invalid images still block project encoding and decoding',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {encodeProject,decodeProject}=await import('/modules/project.js');
  const {writeZip}=await import('/modules/zip.js');
  const bad=new Blob(['this is not an SVG'],{type:'image/svg+xml'});
  const draft={version:1,text:'# Invalid',sourcePath:'main.md',file:null,resources:[{name:'bad.svg',path:'bad.svg',blob:bad}],options:{}};
  const manifest={...draft,format:'folio-project',version:1,resources:[{name:'bad.svg',path:'bad.svg',entry:'assets/0.svg'}]};
  const archive=await writeZip([['manifest.json',JSON.stringify(manifest)],['assets/0.svg',bad]]);
  const errors=[];
  for(const action of [()=>encodeProject(draft),()=>decodeProject(archive)])try{await action();errors.push(null);}catch(error){errors.push(error.message);}
  return errors;
 });
 expect(result).toEqual([expect.stringContaining('SVG 文件无效'),expect.stringContaining('SVG 文件无效')]);
});
