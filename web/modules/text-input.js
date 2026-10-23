// Decode strictly: replacement characters must never silently become saved content.
export async function readMarkdown(file){
 const bytes=new Uint8Array(await file.arrayBuffer());
 const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
 try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}
 catch{throw new Error(`文件 ${file.name} 的编码无法读取。请将原文件转换为 UTF-8 后重新打开（也支持带 BOM 的 UTF-16）；原文件与当前工作均保留。`);}
}
