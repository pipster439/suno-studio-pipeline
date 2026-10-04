// Parse only already acquired public assets. Never evaluates code or calls extracted APIs.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';
const verbs = new Set(['GET','POST','PUT','PATCH','DELETE']);
function children(node) {
  return Object.values(node).flatMap(v=>Array.isArray(v)?v.filter(x=>x?.type):v?.type?[v]:[]);
}
const name = n => n?.type==='Identifier'?n.name:n?.type==='Literal'?n.value:null;
function moduleOf(stack) {
  for(let i=stack.length-1;i>0;i--) {
    const fn=stack[i],array=stack[i-1];
    if(!/Function/.test(fn.type)||array.type!=='ArrayExpression')continue;
    const previous=array.elements[array.elements.indexOf(fn)-1];
    if(previous?.type==='Literal'&&typeof previous.value==='number')return {node:fn,id:previous.value};
  }
  return null;
}
export function analyzeStudio(source, file='source.js') {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}), calls=[],exports=[];
  const text=n=>n?source.slice(n.start,n.end):null;
  const prop=(n,key)=>n?.type==='ObjectExpression'?n.properties.find(p=>p.type==='Property'&&name(p.key)===key)?.value:null;
  function visit(n,stack=[]) {
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression') {
      const method=name(n.callee.property),path=n.arguments[0];
      if(verbs.has(method)&&path?.type==='Literal'&&typeof path.value==='string'&&path.value.startsWith('/api/studio/')) {
        const fn=stack.findLast(p=>/Function/.test(p.type)),module=moduleOf(stack);
        calls.push({file,offset:n.start,byteOffset:Buffer.byteLength(source.slice(0,n.start)),method,path:path.value,
          callee:text(n.callee),caller:fn?.id?.name??null,functionOffset:fn?.start??null,
          moduleId:module?.id??null,moduleOffset:module?.node.start??null,
          directModuleFunction:!!module&&stack[stack.indexOf(fn)-1]===module.node.body,
          optionsExpression:text(n.arguments[1]),bodyExpression:text(prop(n.arguments[1],'body')),
          paramsExpression:text(prop(n.arguments[1],'params')),callExpression:text(n),evidence:'STATIC_CLIENT',verified:false});
      }
      const module=moduleOf(stack);
      if(method==='s'&&module&&name(n.callee.object)===name(module.node.params[0])&&n.arguments[0]?.type==='ArrayExpression') {
        const list=n.arguments[0].elements;
        for(let i=0;i+1<list.length;) {
          if(list[i]?.type!=='Literal'||typeof list[i].value!=='string') {i++;continue;}
          const constant=list[i+1]?.type==='Literal'&&list[i+1].value===0;
          const getter=/Function/.test(list[i+1]?.type||'');
          if(!constant&&!getter) {i++;continue;}
          const v=constant?list[i+2]:list[i+1];if(!v)break;
          const target=!constant&&v.type==='ArrowFunctionExpression'&&v.body.type==='Identifier'?v.body:v;
          exports.push({name:list[i].value,offset:list[i].start,binding:name(target),definitionOffset:constant&&/Function/.test(v.type)?v.start:null,
            exportKind:constant?'constant':'getter',moduleId:n.arguments[1]?.type==='Literal'?n.arguments[1].value:module.id,moduleOffset:module.node.start});
          i+=constant?3:2;
        }
      }
    }
    for(const c of children(n))visit(c,[...stack,n]);
  }
  visit(ast);
  // Resolve only module-level declarations or directly exported function expressions.
  for(const call of calls) {
    call.exportNames=exports.filter(x=>x.moduleOffset===call.moduleOffset&&call.moduleOffset!==null&&
      (x.definitionOffset===call.functionOffset&&x.definitionOffset!==null||call.directModuleFunction&&x.binding===call.caller&&call.caller!==null)).map(x=>x.name);
  }
  return {calls,exports:exports.filter(x=>/serializeProjectState|DeserializeProjectState|DefaultState|StudioProjectManagement|AudioClip|AudioTrack|Arrangement|createTrack/.test(x.name))};
}
export async function analyzeManifest(manifestPath) {
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),assets=[],calls=[],exports=[];
  for(const row of manifest.rows) {
    if(row.error)continue;
    const url=new URL(row.url);
    if(url.origin!=='https://suno.com'||url.username||url.password||url.search||url.hash||
      !url.pathname.startsWith('/_next/static/immutable/chunks/')||basename(row.name)!==row.name||basename(url.pathname)!==row.name)throw Error('observed public chunk required');
    const bytes=await readFile(resolve(dirname(manifestPath),row.name)),hash=createHash('sha256').update(bytes).digest('hex');
    if(hash!==row.sha256)throw Error('asset hash mismatch: '+row.name);
    const result=analyzeStudio(bytes.toString('utf8'),row.name);
    assets.push({name:row.name,url:row.url,bytes:bytes.length,sha256:hash,studioCalls:result.calls.length});
    calls.push(...result.calls);exports.push(...result.exports.map(x=>({file:row.name,...x})));
  }
  return {source:'official loaded assets, static only',pageUrl:manifest.pageUrl,inventoryId:manifest.inventoryId,assets,calls,exports,
    limitations:['Literal path templates only; dynamic aliases/paths may be missed.','Parsing proves code construction only, never successful calls or permission.','Exports resolve only direct declarations in observed numeric module arrays; other bundler forms may be missed.','No business operation is implemented or marked VERIFIED.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [manifest,output]=process.argv.slice(2);if(!manifest||!output)throw Error('usage: node scripts/analyze-studio.mjs manifest.json output.json');
  const result=await analyzeManifest(resolve(manifest));await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({assets:result.assets.length,calls:result.calls.length,paths:new Set(result.calls.map(c=>c.path)).size,exports:result.exports.length}));
}
