import {open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export async function durableJson(path,value){
  const temp=path+'.'+randomUUID()+'.tmp';let file;
  try{file=await open(temp,'wx');await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();await file.close();file=null;await rename(temp,path);}
  finally{await file?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
