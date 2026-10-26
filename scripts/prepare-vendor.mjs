import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'web/vendor');
await mkdir(target, {recursive: true});
for (const [src, dest] of [
  ['markdown-it/dist/browser/markdown-it.umd.min.js','markdown-it.min.js'],
  ['markdown-it-footnote/dist/markdown-it-footnote.min.js','footnote.min.js'],
  ['dompurify/dist/purify.min.js','purify.min.js'],
  ['@highlightjs/cdn-assets/highlight.min.js','highlight.min.js'],
  ['mathjax','mathjax'],
  ['@mathjax/mathjax-newcm-font','mathjax-font'],
  ['pdfjs-dist/legacy/build','pdfjs/build'],
  ['pdfjs-dist/cmaps','pdfjs/cmaps'],
  ['pdfjs-dist/standard_fonts','pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm','pdfjs/wasm'],
  ['pdfjs-dist/iccs','pdfjs/iccs'],
]) await cp(path.join(root, 'node_modules', src), path.join(target, dest), {recursive: true});
const names=['markdown-it','markdown-it-footnote','dompurify','@highlightjs/cdn-assets','mathjax','@mathjax/mathjax-newcm-font','pdfjs-dist','esbuild'];
const notices=[`墨页 Folio\n${await readFile(path.join(root,'LICENSE'),'utf8')}\n`,await readFile(path.join(root,'THIRD_PARTY_NOTICES.md'),'utf8')];
for(const name of names){
  const dir=path.join(root,'node_modules',name);
  const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
  let license='';
  for(const file of ['LICENSE','LICENSE.txt','LICENSE.md']){
    try {license=await readFile(path.join(dir,file),'utf8');break;}catch{}
  }
  notices.push(`${name} ${pkg.version}\n${license || String(pkg.license)}\n`);
}
await writeFile(path.join(target,'LICENSES.txt'),notices.join('\n---\n'));
await import('./build-web.mjs');
console.log('本地浏览器资源已准备完成。');
