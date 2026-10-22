// Small bounded ZIP codec. Writers use stored entries; imports also accept DEFLATE.
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX=130*1024*1024;
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function validPath(path){return typeof path==='string'&&path.length<=1000&&!/[\\\x00-\x1f:]/.test(path)&&!path.startsWith('/')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');}
export async function writeZip(entries){
 const parts=[],central=[];let offset=0,total=0;const seen=new Set();
 for(const [path,value] of entries){
  if(!validPath(path)||seen.has(path))throw new Error('项目包含无效或重复路径');seen.add(path);
  const name=encoder.encode(path),bytes=new Uint8Array(await (value instanceof Blob?value:new Blob([value])).arrayBuffer());total+=bytes.length;
  if(total>MAX||seen.size>260)throw new Error('项目超过 130 MiB 或文件数量限制');
  const local=new Uint8Array(30+name.length),l=new DataView(local.buffer),checksum=crc(bytes);
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint32(14,checksum,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,name.length,true);local.set(name,30);
  const header=new Uint8Array(46+name.length),h=new DataView(header.buffer);h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);h.setUint16(8,0x800,true);h.setUint32(16,checksum,true);h.setUint32(20,bytes.length,true);h.setUint32(24,bytes.length,true);h.setUint16(28,name.length,true);h.setUint32(42,offset,true);header.set(name,46);
  parts.push(local,bytes);central.push(header);offset+=local.length+bytes.length;
 }
 const length=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,length,true);e.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}
export async function readZip(blob){
 if(blob.size>MAX+1024*1024||blob.size<22)throw new Error('项目文件大小无效');
 const bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==v.getUint16(end+10,true))throw new Error('不支持的 ZIP 项目格式');
 const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),start=v.getUint32(end+16,true);
 if(count>260||start+size!==end)throw new Error('项目目录无效或文件过多');
 const result=new Map();let at=start,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||v.getUint32(at,true)!==0x02014b50)throw new Error('项目目录已损坏');
  const flags=v.getUint16(at+8,true),method=v.getUint16(at+10,true),checksum=v.getUint32(at+16,true),packed=v.getUint32(at+20,true),unpacked=v.getUint32(at+24,true),n=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true),local=v.getUint32(at+42,true);
  if(at+46+n+extra+comment>end)throw new Error('项目路径数据损坏');
  const path=decoder.decode(bytes.subarray(at+46,at+46+n));total+=unpacked;
  if(!validPath(path)||result.has(path)||flags&1||![0,8].includes(method)||total>MAX||unpacked>80*1024*1024)throw new Error('项目路径、压缩方式或解压大小不安全');
  if(local+30>start||v.getUint32(local,true)!==0x04034b50)throw new Error('项目文件头无效');
  const ln=v.getUint16(local+26,true),le=v.getUint16(local+28,true),dataAt=local+30+ln+le;
  if(dataAt+packed>start||decoder.decode(bytes.subarray(local+30,local+30+ln))!==path||v.getUint16(local+8,true)!==method)throw new Error('项目文件内容无效');
  let content=bytes.slice(dataAt,dataAt+packed);
  if(method===8){
   const reader=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0;
   try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>unpacked){await reader.cancel();throw new Error('项目解压超过声明大小');}chunks.push(r.value);}}finally{reader.releaseLock();}
   content=new Uint8Array(await new Blob(chunks).arrayBuffer());
  }
  if(content.length!==unpacked||crc(content)!==checksum)throw new Error('项目文件校验失败');
  result.set(path,new Blob([content]));at+=46+n+extra+comment;
 }
 if(at!==end)throw new Error('项目目录长度不一致');return result;
}
