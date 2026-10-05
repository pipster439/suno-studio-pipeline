import {mkdir,writeFile,readFile,readdir}from'node:fs/promises';import{resolve}from'node:path';import{createHash}from'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
export function buildEvidenceZip(files){
  const parts=[],central=[],names=new Set();let offset=0;
  for(const[name,input]of Object.entries(files)){
    if(!/^[A-Za-z0-9_.\/-]+$/.test(name)||name.split('/').some(p=>p==='..'||!p)||/\.(zip|tar|gz)$/i.test(name)||names.has(name.toLowerCase()))throw Error('unsafe/duplicate/nested evidence member');names.add(name.toLowerCase());
    const bytes=Buffer.from(input),filename=Buffer.from(name);if(bytes.length>1024*1024)throw Error('evidence member too large');
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc(bytes),14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
    parts.push(header,filename,bytes);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt32LE(crc(bytes),16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);central.push(entry,filename);offset+=header.length+filename.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.size,8);end.writeUInt16LE(names.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);
}
export function scanEvidenceText(text){return {jwt:/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text),bearer:/Bearer\s+[A-Za-z0-9_.-]{16,}/i.test(text),email:/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(text),signedQuery:/(?:x-amz-signature|x-goog-signature|signature)=[A-Za-z0-9%+/]{16,}/i.test(text),credentialValue:/"(?:authorization|cookie|set-cookie|session_id|sessionId)"\s*:\s*"(?!<redacted>)[^"\s]+/i.test(text)};}
export async function archiveEvidence({staging,output,name,files,metadata={}}){
  if(!/^[A-Za-z0-9_-]+\.zip$/.test(name)||Object.values(scanEvidenceText(JSON.stringify(metadata))).some(Boolean))throw Error('unsafe archive name or sensitive manifest metadata');
  staging=resolve(staging);output=resolve(output);if(output===staging||output.startsWith(staging+'/')||output.startsWith(staging+'\\'))throw Error('output must be outside staging');
  await mkdir(staging,{recursive:false});await mkdir(output,{recursive:true});const members={};
  for(const[k,v]of Object.entries(files)){if(k.includes('/')||k.includes('\\')||k==='MANIFEST.json')throw Error('flat small evidence only');const b=Buffer.from(typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');if(Object.values(scanEvidenceText(b.toString('utf8'))).some(Boolean))throw Error('sensitive evidence values rejected');await writeFile(resolve(staging,k),b,{flag:'wx'});members[k]=b;}
  members['MANIFEST.json']=Buffer.from(JSON.stringify({...metadata,files:Object.entries(members).map(([path,b])=>({path,bytes:b.length,sha256:sha(b)})),manifestExcludedFromOwnHash:true},null,2)+'\n');await writeFile(resolve(staging,'MANIFEST.json'),members['MANIFEST.json'],{flag:'wx'});
  const zip=buildEvidenceZip(members),path=resolve(output,name);await writeFile(path,zip,{flag:'wx'});await writeFile(path+'.sha256',sha(zip)+'  '+name+'\n',{flag:'wx'});
  if((await readdir(staging)).length!==Object.keys(members).length)throw Error('unexpected staging files');
  for(const[k,b]of Object.entries(members))if(!b.equals(await readFile(resolve(staging,k))))throw Error('staging mutation');
  return {path,sha256:sha(zip),entries:Object.keys(members),bytes:zip.length};
}
