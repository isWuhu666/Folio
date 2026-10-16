import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');});
test('structure, math delimiters and code exclusions',async({page})=>{
 const r=await page.evaluate(async()=>{
   const {renderMarkdown}=await import('/modules/markdown.js');
   return renderMarkdown('# 重复\n\n# 重复\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n$x_1$ 和 \\(y_2\\)\n\n$$\\frac{1}{2}$$\n\n\\[z^2\\]\n\n`$code$`\n\n```tex\n$raw$\n```\n\n脚注[^a]\n\n[^a]: 内容',null,'sample.md');
 });
 expect(r.math.map(m=>m.tex)).toEqual(['x_1','y_2','\\frac{1}{2}','z^2']);
 expect(r.toc).toHaveLength(2);expect(r.toc[0].id).not.toBe(r.toc[1].id);
 expect(r.bodyHtml).toContain('<table>');expect(r.bodyHtml).toContain('footnote');expect(r.bodyHtml).toContain('$code$');
});
test('currency, escapes and unclosed math preserve text',async({page})=>{
 const r=await page.evaluate(async()=>{const {renderMarkdown}=await import('/modules/markdown.js');return renderMarkdown('价格 $20 和 $30，转义 \\$x\\$。\n\n$$未闭合\n\n后续正文',null,'x.md');});
 expect(r.math).toHaveLength(0);expect(r.bodyHtml).toContain('后续正文');expect(r.diagnostics.length).toBeGreaterThan(0);
});
test('untrusted HTML and external resources stay inert',async({page})=>{
 const r=await page.evaluate(async()=>{const {renderMarkdown}=await import('/modules/markdown.js');return renderMarkdown('<script>window.pwned=1</script><img src="https://evil.example/x" onerror="window.pwned=1"><iframe src="https://evil.example"></iframe>\n\n[bad](javascript:alert(1))',null,'x.md');});
 expect(r.bodyHtml).not.toMatch(/<script|onerror|<iframe|src="https:/);expect(r.missingAssets.length).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.pwned)).toBeUndefined();
});
test('currency prefix cannot swallow later code or formulas',async({page})=>{
 const results=await page.evaluate(async()=>{const {renderMarkdown}=await import('/modules/markdown.js');return ['Price $20 and formula $x$.','Price $20, code `$raw$`, formula $x$.'].map(s=>renderMarkdown(s,null,'x.md'));});
 for(const r of results){expect(r.math.map(m=>m.tex)).toEqual(['x']);expect(r.bodyHtml).toContain('Price $20');}
 expect(results[1].bodyHtml).toContain('<code>$raw$</code>');
});
test('heading slugs cannot collide with numbered headings',async({page})=>{
 const r=await page.evaluate(async()=>{const {renderMarkdown}=await import('/modules/markdown.js');return renderMarkdown('# Foo\n\n# Foo\n\n# Foo-2',null,'x.md');});
 expect(r.toc.map(h=>h.id)).toEqual(['foo','foo-2','foo-2-2']);
});
