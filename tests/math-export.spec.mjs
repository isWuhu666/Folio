import {test,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('professional SVG math is self-contained and survives offline file opening',async({page})=>{
 await page.goto('/');
 const r=await page.evaluate(async()=>{
  const {renderMarkdown}=await import('/modules/markdown.js');const {typesetDocument}=await import('/modules/math.js');const {buildHtml}=await import('/modules/export.js');
  const draft=renderMarkdown('# 公式验收\n\n$x_1^2$\n\n$$\\int_0^1 x^2 dx=\\frac13$$\n\n$$\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$$\n\n$$\\begin{align}a&=b+c\\\\ d&=e\\end{align}$$\n\n$$x=2\\tag{A}\\label{a}$$',null,'math.md');
  const model=await typesetDocument(draft,{});return {html:buildHtml(model,{}),diagnostics:model.diagnostics};
 });
 expect(r.diagnostics).toEqual([]);expect(r.html).toContain('<svg');expect(r.html).toContain('<path');expect(r.html).not.toContain('<script');
 await mkdir('artifacts',{recursive:true});const file=path.resolve('artifacts/math-check.html');await writeFile(file,r.html);
 const requests=[];await page.route('http://**/*',route=>{requests.push(route.request().url());return route.abort();});await page.route('https://**/*',route=>{requests.push(route.request().url());return route.abort();});
 await page.goto(pathToFileURL(file).href);await expect(page.locator('mjx-container > svg')).toHaveCount(5);expect(requests).toEqual([]);
 expect(await page.locator('svg').first().evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(5);
 expect(await page.evaluate(()=>[...document.querySelectorAll('use')].every(u=>{const id=u.getAttribute('href')||u.getAttribute('xlink:href');return !id||!!document.getElementById(id.slice(1));}))).toBe(true);
});
test('bad math reports source and missing assets block complete export',async({page})=>{
 await page.goto('/');const r=await page.evaluate(async()=>{
  const {renderMarkdown}=await import('/modules/markdown.js');const {typesetDocument}=await import('/modules/math.js');const {buildHtml}=await import('/modules/export.js');
  const model=await typesetDocument(renderMarkdown('$$\\notARealCommand{x}$$\n\n![missing](a.png)',null,'x.md'),{});
  let blocked=false;try{buildHtml(model,{});}catch{blocked=true;}return {blocked,html:buildHtml(model,{}, {allowMissing:true}),diagnostics:model.diagnostics};
 });expect(r.blocked).toBe(true);expect(r.diagnostics.some(x=>x.code==='math-error')).toBe(true);expect(r.html).toContain('notARealCommand');
});
