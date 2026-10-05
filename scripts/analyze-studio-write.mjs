// Public received JS only. No evaluation, downloads, authentication or API calls.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { analyzeManifest } from './analyze-studio.mjs';
const verbs = new Set(['GET','POST','PUT','PATCH','DELETE']);
const targets = new Set([79076,140764,759985,634782,371089,130800,329176]);
const name = n => n?.type === 'Identifier' ? n.name : n?.type === 'Literal' ? n.value : null;
const children = n => Object.values(n).flatMap(v => Array.isArray(v) ? v.filter(x=>x?.type) : v?.type ? [v] : []);

export function traceStudioSource(source, file='source.js') {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}), modules=[], pathReferences=[], keywordReferences=[];
  const text=n=>n?source.slice(n.start,n.end):null;
  const location=n=>({file,offset:n.start,byteOffset:Buffer.byteLength(source.slice(0,n.start))});
  // Only .push([number, callback]) registrations; export sentinel 0 is not a module.
  function registrations(n) {
    if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&name(n.callee.property)==='push') {
      for(const array of n.arguments.filter(a=>a.type==='ArrayExpression')) {
        array.elements.forEach((fn,i)=>{
          const id=array.elements[i-1];
          if(/Function/.test(fn?.type||'')&&id?.type==='Literal'&&typeof id.value==='number') modules.push({id:id.value,node:fn});
        });
      }
    }
    for(const c of children(n)) registrations(c);
  }
  registrations(ast);
  const moduleAt=n=>modules.find(m=>n.start>=m.node.start&&n.end<=m.node.end);
  const out=[];
  for(const m of modules) {
    const imports=new Map(), declarations=new Map(), exportRecords=[], invocations=[];
    const binding=m.node.params[0]?.name;
    // Only declarations in the module's direct lexical scope bind import aliases.
    for(const statement of m.node.body.body??[]) {
      if(statement.type==='VariableDeclaration') for(const d of statement.declarations) {
        if(d.id.type!=='Identifier')continue;
        declarations.set(d.id.name,d.init);
        if(d.init?.type==='CallExpression'&&name(d.init.callee?.object)===binding&&
          name(d.init.callee?.property)==='i'&&typeof name(d.init.arguments[0])==='number') imports.set(d.id.name,name(d.init.arguments[0]));
      }
      if(statement.type==='FunctionDeclaration'&&statement.id)declarations.set(statement.id.name,statement);
    }
    function visit(n,stack=[]) {
      if(n.type==='CallExpression'&&n.callee.type==='MemberExpression') {
        if(name(n.callee.object)===binding&&name(n.callee.property)==='s'&&n.arguments[0]?.type==='ArrayExpression') {
          const a=n.arguments[0].elements;
          for(let i=0;i+1<a.length;) {
            if(typeof name(a[i])!=='string'){i++;continue;}
            const constant=a[i+1]?.type==='Literal'&&a[i+1].value===0;
            const getter=/Function/.test(a[i+1]?.type||''); if(!constant&&!getter){i++;continue;}
            const value=constant?a[i+2]:a[i+1];if(!value)break;
            const target=getter&&value.body?.type==='Identifier'?value.body:value;
            const definition=declarations.get(name(target))??value;
            exportRecords.push({name:name(a[i]),moduleId:typeof name(n.arguments[1])==='number'?name(n.arguments[1]):m.id,
              binding:name(target),...location(a[i]),definitionOffset:definition.start,definitionExpression:text(definition)});
            i+=constant?3:2;
          }
        }
      }
      if(n.type==='CallExpression') {
        let callee=n.callee;
        if(callee.type==='SequenceExpression')callee=callee.expressions.at(-1);
        if(callee.type==='MemberExpression'&&imports.has(name(callee.object))&&targets.has(imports.get(name(callee.object)))) {
          const alias=name(callee.object);
          const shadowed=stack.some(fn=>/Function/.test(fn.type)&&fn!==m.node&&fn.params.some(p=>name(p)===alias));
          if(!shadowed)invocations.push({...location(n),targetModule:imports.get(alias),member:name(callee.property),expression:text(n),
            callerOffset:stack.findLast(fn=>/Function/.test(fn.type))?.start??null});
        }
      }
      for(const c of children(n))visit(c,[...stack,n]);
    }
    visit(m.node);
    if(!targets.has(m.id))for(const record of exportRecords)record.definitionExpression=null;
    out.push({moduleId:m.id,...location(m.node),imports:[...imports].filter(([,id])=>targets.has(id)).map(([alias,moduleId])=>({alias,moduleId})),exports:exportRecords,invocations});
  }
  function references(n,stack=[]) {
    const literal=n.type==='Literal'&&typeof n.value==='string'?n.value:null;
    const template=n.type==='TemplateLiteral'?n.quasis.map(q=>q.value.cooked??'').join('${expression}'):null;
    const value=literal??template;
    if(value?.includes('/api/studio/')) {
      const call=stack.findLast(p=>p.type==='CallExpression'),method=call?.callee.type==='MemberExpression'?name(call.callee.property):null;
      pathReferences.push({...location(n),moduleId:moduleAt(n)?.id??null,expression:text(n),
        enclosingCallOffset:call?.start??null,recognizedMethod:verbs.has(method)?method:null});
    }
    const key=literal??(n.type==='Identifier'?n.name:null);
    if(key&&/^(latest_version_id|studio_project_start_beats|studio_project_end_beats|rendered_context_window|saveProjectVersion|createAndSaveNewStudioProject|markersRegistry)$/.test(key)) {
      keywordReferences.push({...location(n),keyword:key,moduleId:moduleAt(n)?.id??null,context:source.slice(Math.max(0,n.start-80),n.end+100)});
    }
    for(const c of children(n))references(c,[...stack,n]);
  }
  references(ast);
  const sourceMapRefs=[...source.matchAll(/[#@]\s*sourceMappingURL\s*=\s*(\S+)/g)].map(m=>({offset:m.index,url:m[1]}));
  return {modules:out.filter(m=>targets.has(m.moduleId)||m.imports.some(i=>targets.has(i.moduleId))),pathReferences,keywordReferences,sourceMapRefs};
}

export async function traceManifest(path) {
  const verified=await analyzeManifest(path),trace=[];
  for(const asset of verified.assets)trace.push({file:asset.name,sha256:asset.sha256,...traceStudioSource(await readFile(resolve(dirname(path),asset.name),'utf8'),asset.name)});
  return {...verified,trace,status:'FOUND_STATICALLY',limitations:[...verified.limitations,
    'Import graph recognizes direct module imports and member invocations only; no evaluation or complete call graph claim.',
    'Response fields inferred from consumption are partial expectations, not verified service response schemas.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [manifest,output]=process.argv.slice(2);if(!manifest||!output)throw Error('usage: analyze-studio-write.mjs manifest.json output.json');
  const result=await traceManifest(resolve(manifest));await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({assets:result.assets.length,calls:result.calls.length,pathReferences:result.trace.reduce((n,t)=>n+t.pathReferences.length,0),
    methods:[...new Set(result.calls.map(c=>c.method))],sourceMaps:result.trace.reduce((n,t)=>n+t.sourceMapRefs.length,0)}));
}
