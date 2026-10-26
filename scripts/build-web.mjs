import {build} from 'esbuild';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
// Collapse local source imports into one request. Dynamic feature imports retain
// lazy initialization inside the bundle; the PDF engine remains a separate asset.
await build({
 entryPoints:[path.join(root,'web/app.js')],
 outfile:path.join(root,'web/vendor/folio-app.js'),
 bundle:true,format:'esm',splitting:false,minify:true,target:'chrome120',
 external:['/vendor/*'],legalComments:'eof',
});
