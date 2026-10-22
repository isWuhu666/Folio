// Run with a test server already running: node tests/render-evidence.mjs
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const folder=path.resolve('docs/screenshots-2026-10-22');await mkdir(folder,{recursive:true});await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:process.env.FOLIO_BROWSER_CHANNEL||'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${process.env.FOLIO_TEST_PORT||8780}/`);await page.locator('#export:enabled').waitFor();
 await page.screenshot({path:path.join(folder,'desktop.png')});await page.locator('#manage-resources').click();await page.screenshot({path:path.join(folder,'resources.png')});await page.locator('#close-resources').click();
 await page.locator('#quality-panel summary').click();await page.screenshot({path:path.join(folder,'export.png')});
 const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading,html=path.resolve('artifacts/print-review.html');await download.saveAs(html);
 await page.setViewportSize({width:320,height:844});await page.getByRole('button',{name:'原文',exact:true}).click();await page.screenshot({path:path.join(folder,'mobile-320.png'),fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth)>320)throw new Error('320px source overflows');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.screenshot({path:path.join(folder,'mobile-settings.png'),fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth)>320)throw new Error('320px settings overflow');
 const print=await browser.newPage({viewport:{width:794,height:1123}});await print.goto(pathToFileURL(html).href);await print.emulateMedia({media:'print'});await print.screenshot({path:path.join(folder,'print-style.png'),fullPage:true});
 const checks=await print.evaluate(()=>({svg:document.querySelectorAll('svg').length,thead:[...document.querySelectorAll('thead')].every(t=>getComputedStyle(t).display==='table-header-group'),images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)}));
 if(!checks.svg||!checks.thead||!checks.images||errors.length)throw new Error(JSON.stringify({checks,errors}));console.log(JSON.stringify({screenshots:folder,printChecks:checks,pageErrors:errors}));
}finally{await browser.close();}
