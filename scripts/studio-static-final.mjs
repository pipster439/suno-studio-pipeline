// Bounded final inventory from previously acquired, hash-pinned public assets. Never evaluates code.
import { parse } from 'acorn';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const children = n => Object.values(n).flatMap(v => Array.isArray(v) ? v.filter(x=>x?.type) : v?.type ? [v] : []);
const value = n => n?.type==='Literal'?n.value:n?.type==='Identifier'?n.name:null;
export function extractModules(source, file, targets) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}), results=[];
  function visit(n) {
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&value(n.callee.property)==='push')
      for(const array of n.arguments.filter(a=>a.type==='ArrayExpression'))for(let i=1;i<array.elements.length;i++){
        const fn=array.elements[i],id=value(array.elements[i-1]);
        if(typeof id!=='number'||!/Function/.test(fn?.type??''))continue;
        const aliases=new Set([id]);
        function exportAliases(x){if(x.type==='CallExpression'&&x.callee.type==='MemberExpression'&&value(x.callee.property)==='s'&&typeof value(x.arguments[1])==='number')aliases.add(value(x.arguments[1]));for(const c of children(x))exportAliases(c);}
        exportAliases(fn);
        if([...aliases].some(x=>targets.has(x)))results.push({file,moduleId:id,aliases:[...aliases],offset:fn.start,byteOffset:Buffer.byteLength(source.slice(0,fn.start)),expression:source.slice(fn.start,fn.end)});
      }
    for(const c of children(n))visit(c);
  }
  visit(ast);return results;
}
export async function collectFinalStatic(manifestPath, output, ids=[17660,950155,714981,801426,879379,634782,748387,130800,371498,103929]) {
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),modules=[],hashes=[];
  for(const row of manifest.rows){
    if(row.error)continue;
    if(!/^[\w-]+\.js$/.test(row.name))throw Error('invalid manifest asset');
    const bytes=await readFile(resolve(dirname(manifestPath),row.name));
    const sha=createHash('sha256').update(bytes).digest('hex');if(sha!==row.sha256)throw Error('snapshot changed: '+row.name);
    hashes.push({file:row.name,sha256:sha});modules.push(...extractModules(bytes.toString('utf8'),row.name,new Set(ids)));
  }
  const result={status:'FOUND_STATICALLY',source:'existing official snapshot only',modules,hashes,
    missing:ids.filter(id=>!modules.some(m=>m.aliases.includes(id))),newNetworkRequests:0};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const result=await collectFinalStatic(resolve(process.argv[2]),resolve(process.argv[3]));
  console.log(JSON.stringify({modules:result.modules.map(({file,moduleId,aliases,offset,expression})=>({file,moduleId,aliases,offset,chars:expression.length})),missing:result.missing}));
}
