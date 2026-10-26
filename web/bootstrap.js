// Keep this boundary independent of the application's module graph.
document.addEventListener('folio-ready',()=>{document.getElementById('startup-trouble').hidden=true;},{once:true});
import('/vendor/folio-app.js').catch(()=>{
 const notice=document.getElementById('startup-trouble');notice.hidden=false;notice.classList.add('error');
 document.getElementById('startup-message').textContent='启动资源加载失败，请点击重新加载。原有本机草稿仍保留；若持续失败，请重新运行安装脚本检查本地资源。';
 document.getElementById('status').textContent='工作台尚未启动，请重新加载页面。';
});
