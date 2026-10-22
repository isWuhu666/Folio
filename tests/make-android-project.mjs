// Synthetic desktop project for testing Android interoperability.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.goto(process.env.FOLIO_QA_URL||'http://127.0.0.1:8765/');
 const text=await readFile('examples/showcase.md','utf8'),svg=await readFile('examples/assets/circuit.svg','utf8');
 const bytes=await page.evaluate(async({text,svg})=>{
  const {encodeProject}=await import('/modules/project.js');
  const value={version:1,text,sourcePath:'android-cross-platform.md',file:{name:'android-cross-platform.md',path:'android-cross-platform.md',blob:new Blob([text],{type:'text/markdown'})},resources:[{name:'circuit.svg',path:'assets/circuit.svg',blob:new Blob([svg],{type:'image/svg+xml'})}],options:{theme:'academic',fontFamily:'serif',fontSize:17,lineHeight:1.8,contentWidth:820},pdfMode:'faithful',pdfDpi:'96'};
  return Array.from(new Uint8Array(await (await encodeProject(value)).arrayBuffer()));
 },{text,svg});await writeFile('artifacts/android-cross-platform.folio',Buffer.from(bytes));console.log('Desktop Folio project generated with formula source and image.');
}finally{await browser.close();}
