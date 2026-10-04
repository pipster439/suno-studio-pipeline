// Parse received public JavaScript as data. Never import/evaluate the reference client.
import { parse } from 'acorn';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function analyze(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const scopes = [], calls = [], functions = [], literals = [], objects = [];
  const children = (n) => Object.entries(n).flatMap(([k, v]) => k === 'start' || k === 'end' ? [] :
    Array.isArray(v) ? v.filter((x) => x?.type) : v?.type ? [v] : []);
  const names = (n) => !n ? [] : n.type === 'Identifier' ? [n.name] :
    n.type === 'RestElement' ? names(n.argument) : n.type === 'AssignmentPattern' ? names(n.left) :
    n.type === 'ArrayPattern' ? n.elements.flatMap(names) : n.type === 'ObjectPattern' ? n.properties.flatMap((p) => names(p.value || p.argument)) : [];
  function walk(n, scope, fn, parent) {
    const isFn = /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
    if (n.type === 'FunctionDeclaration' && n.id) scope.bindings.set(n.id.name, n);
    if (n.type === 'VariableDeclarator') {
      let bindingScope = scope;
      if (parent.kind === 'var') while (bindingScope.parent && !bindingScope.functionScope) bindingScope = bindingScope.parent;
      for (const name of names(n.id)) bindingScope.bindings.set(name, n.init || n);
    }
    if (n.type === 'Program' || n.type === 'BlockStatement' || n.type === 'CatchClause' || isFn) {
      scope = { parent: scope, bindings: new Map(), functionScope: isFn || n.type === 'Program' }; scopes.push(scope);
      if (isFn) {
        fn = { node: n, name: n.id?.name || (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ? parent.id.name : `callback@${n.start}`), scope };
        functions.push(fn); for (const p of n.params) for (const name of names(p)) scope.bindings.set(name, p);
      }
      if (n.type === 'CatchClause') for (const name of names(n.param)) scope.bindings.set(name, n.param);
    }
    if (n.type === 'CallExpression') calls.push({ node: n, scope, fn });
    if (n.type === 'Literal' && typeof n.value === 'string') literals.push(n);
    if (n.type === 'ObjectExpression') objects.push({node:n,fn});
    for (const child of children(n)) walk(child, scope, fn, n);
  }
  walk(ast, { bindings: new Map() }, null, null);
  function binding(scope, name) { for (let s = scope; s; s = s.parent) if (s.bindings.has(name)) return s.bindings.get(name); }
  const text = (n, max = 1800) => n ? source.slice(n.start, n.end).slice(0, max) : null;
  const loc = (n) => ({ charOffset: n.start, byteOffset: Buffer.byteLength(source.slice(0, n.start)), lengthChars: n.end - n.start });
  const functionFor = (n) => {
    if (n?.type === 'CallExpression') {
      const callee = n.callee.type === 'SequenceExpression' ? n.callee.expressions.at(-1) : n.callee;
      if (callee?.type === 'MemberExpression' && callee.property?.name === 'useCallback') n = n.arguments[0];
    }
    return functions.find((f) => f.node === n);
  };
  const anchorLiteral = literals.find((n) => n.value === 'suno-console-upload-request');
  if (!anchorLiteral) return { anchorFound: false, sourceBytes: Buffer.byteLength(source) };
  const transport = functions.filter((f) => f.node.start <= anchorLiteral.start && f.node.end >= anchorLiteral.end).sort((a,b) => (b.node.end-b.node.start)-(a.node.end-a.node.start))
    .find((f) => f.node.type === 'FunctionDeclaration');
  if (!transport) throw new Error('anchor has no enclosing named transport function');
  const apiCalls = calls.filter((c) => c.node.callee.type === 'Identifier' && binding(c.scope, c.node.callee.name) === transport.node);
  const siteHelper = functions.find((f) => f.name === 'i9' && text(f.node).includes('fetch('));
  const siteCalls = calls.filter((c) => c.node.callee.type === 'Identifier' && siteHelper && binding(c.scope,c.node.callee.name) === siteHelper.node);
  const describeCall = (c) => ({ ...loc(c.node), caller: c.fn?.name, callerOffset: c.fn?.node.start,
    callee: text(c.node.callee), arguments: c.node.arguments.map((a) => text(a)), pathLiterals: literals.filter((l) => l.start >= c.node.start && l.end <= c.node.end && l.value.startsWith('/api/')).map((l) => l.value) });
  const relevant = new Set([transport.node, ...apiCalls.map((c) => c.fn?.node), siteHelper?.node,
    ...siteCalls.filter((c) => /\/api\/(?:merge|export|state|projects|tasks)/.test(text(c.node))).map((c) => c.fn?.node)].filter(Boolean));
  for (let depth=0;depth<2;depth++) for (const c of calls) {
    if(c.node.callee.type!=='Identifier') continue;
    const f=functionFor(binding(c.scope,c.node.callee.name));
    if(f && relevant.has(f.node) && c.fn) relevant.add(c.fn.node);
  }
  // Include direct callers for parameter provenance, not every UI/render closure in the bundle.
  const edges = calls.filter((c) => c.node.callee.type === 'Identifier').flatMap((c) => {
    const f = functionFor(binding(c.scope,c.node.callee.name));
    return f && (relevant.has(f.node) || relevant.has(c.fn?.node)) ? [{ caller: c.fn?.name, callerOffset: c.fn?.node.start, callee: f.name, calleeOffset: f.node.start, ...loc(c.node), arguments: c.node.arguments.map((a) => text(a,1000)) }] : [];
  });
  return { evidenceKind: 'STATIC_CLIENT', runtimeObserved: false, replayed: false, offsets: 'UTF-16 characters and UTF-8 bytes; minified identifiers are scoped by definition offset',
    anchorFound: true, anchor: { ...loc(anchorLiteral), value: anchorLiteral.value },
    transport: { name: transport.name, ...loc(transport.node), params: transport.node.params.map((p) => text(p)), excerpt: text(transport.node,3500) },
    bridgeCalls: apiCalls.map(describeCall), siteHelper: siteHelper ? { name: siteHelper.name, ...loc(siteHelper.node), excerpt: text(siteHelper.node,1500) } : null,
    siteCalls: siteCalls.map(describeCall), callGraph: edges,
    parameterTemplates: objects.filter(({node}) => {
      const keys=node.properties.filter(p=>p.type==='Property').map(p=>p.key.name||p.key.value);
      return keys.includes('projectId') && keys.includes('sliceIds');
    }).map(({node,fn})=>({...loc(node),caller:fn?.name,fields:node.properties.map(p=>p.type==='SpreadElement'?{spread:text(p.argument)}:{key:p.key.name||p.key.value,expression:text(p.value,1000)}),excerpt:text(node,2200)})),
    studioLiteralCount: literals.filter((l) => l.value.startsWith('/api/studio/')).length,
    wasmReferences: literals.filter((l) => /\.wasm(?:\?|$)/.test(l.value)).map((l) => ({ ...loc(l), value: l.value, receivedWasm: false })),
    functions: functions.filter((f) => relevant.has(f.node) && f.node.end-f.node.start < 12000).map((f) => ({ name: f.name, ...loc(f.node), params:f.node.params.map((p)=>text(p)), excerpt:text(f.node,2200) })) };
}
export function inventorySource(source) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}), strings=[], pending=[ast];let nodes=0;
  while(pending.length) {
    const n=pending.pop();nodes++;
    if(n.type==='Literal'&&typeof n.value==='string') strings.push({value:n.value,charOffset:n.start});
    for(const v of Object.values(n)) {
      if(Array.isArray(v))pending.push(...v.filter(x=>x?.type));else if(v?.type)pending.push(v);
    }
  }
  return {parsedNodes:nodes,studioPathLiterals:strings.filter(x=>x.value.startsWith('/api/studio/')),
    bridgeEventLiterals:strings.filter(x=>/^suno-console-upload-(?:request|response|cancel)$/.test(x.value)),
    wasmReferences:strings.filter(x=>/\.wasm(?:\?|$)/.test(x.value))};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args[0]==='--inventory') {
    const manifestPath=resolve(args[1]), out=args[2], manifest=JSON.parse(await readFile(manifestPath,'utf8')), results=[];
    if(!out)throw new Error('usage: --inventory CODE_MANIFEST OUTPUT_JSON');
    for(const entry of manifest) {
      if(basename(entry.file)!==entry.file)throw new Error('manifest file must stay within observed resource folder');
      const bytes=await readFile(join(dirname(manifestPath),entry.file)),hash=createHash('sha256').update(bytes).digest('hex');
      if(hash!==entry.sha256)throw new Error('received-resource hash changed; do not mix revisions');
      results.push({url:entry.url,file:entry.file,bytes:bytes.length,sha256:hash,...inventorySource(bytes.toString('utf8'))});
    }
    await writeFile(out,JSON.stringify({evidenceKind:'STATIC_RECEIVED_RESOURCE_INVENTORY',sourceManifest:basename(manifestPath),codeExecuted:false,assets:results},null,2)+'\n');
    console.log(JSON.stringify({assets:results.length,studioPathLiterals:results.reduce((n,r)=>n+r.studioPathLiterals.length,0),receivedWasm:0,output:out}));
    process.exit(0);
  }
  const [file,out] = args; if (!file || !out) throw new Error('usage: node scripts/analyze-reference.mjs RECEIVED_JS OUTPUT_JSON');
  const bytes=await readFile(file), result=analyze(bytes.toString('utf8'));
  await mkdir(dirname(resolve(out)),{recursive:true});
  await writeFile(out,JSON.stringify({ file:basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),...result },null,2)+'\n');
  console.log(JSON.stringify({ output:resolve(out),anchor:result.transport?.name,bridgeCalls:result.bridgeCalls?.length,siteCalls:result.siteCalls?.length,studioLiteralCount:result.studioLiteralCount }));
}
