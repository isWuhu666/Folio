/**
 * @typedef {{code:string,message:string,page?:number,source?:string}} Diagnostic
 * @typedef {{id:string,text:string,level:number}} Heading
 * @typedef {{id:string,tex:string,display:boolean}} MathFragment
 * @typedef {{title:string,bodyHtml:string,toc:Heading[],diagnostics:Diagnostic[],math:MathFragment[],missingAssets:string[],stats:object}} DocumentDraft
 */
export const defaults = {theme:'modern',fontFamily:'sans',fontSize:17,lineHeight:1.8,contentWidth:820};
export const escapeHtml = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pdfResultToDraft(r){return {title:r.title,bodyHtml:r.bodyHtml,toc:[],diagnostics:r.diagnostics,math:[],missingAssets:[],stats:{pages:r.pageCount,mode:r.mode}};}
