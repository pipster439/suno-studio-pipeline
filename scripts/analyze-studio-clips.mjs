// Bounded static inspection of previously received public bundles. Never evaluates source.
import { parse } from 'acorn';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const children = n => Object.values(n).flatMap(v => Array.isArray(v) ? v.filter(x => x?.type) : v?.type ? [v] : []);
export function inspectModules(source, ids, file, offsets = []) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const modules = [];
  function walk(n) {
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'push') {
      for (const a of n.arguments.filter(a => a.type === 'ArrayExpression')) a.elements.forEach((f, i) => {
        const aliases = [];
        function findAliases(n) {
          if (n?.type === 'CallExpression' && n.callee?.property?.name === 's' && typeof n.arguments[1]?.value === 'number') aliases.push(n.arguments[1].value);
          for (const c of children(n)) findAliases(c);
        }
        if (/Function/.test(f?.type || '')) findAliases(f);
        if (/Function/.test(f?.type || '') && ([a.elements[i - 1]?.value, ...aliases].some(id => ids.includes(id)) || offsets.some(o => f.start <= o && o < f.end))) {
          const definitions = [];
          for (const statement of f.body.body) {
            if (statement.type === 'VariableDeclaration') for (const d of statement.declarations)
              definitions.push({ binding: d.id.name, offset: d.start, expression: source.slice(d.start, d.end) });
            if (statement.type === 'FunctionDeclaration') definitions.push({ binding: statement.id.name, offset: statement.start, expression: source.slice(statement.start, statement.end) });
            if (statement.type === 'ExpressionStatement' && statement.expression?.callee?.property?.name === 's')
              definitions.push({ binding: 'exports', offset: statement.start, expression: source.slice(statement.start, statement.end) });
          }
          function exportsOnly(n) {
            if (n.type === 'CallExpression' && n.callee?.property?.name === 's' && !definitions.some(d => d.offset === n.start))
              definitions.push({ binding: 'exports', offset: n.start, expression: source.slice(n.start, n.end) });
            for (const c of children(n)) exportsOnly(c);
          }
          exportsOnly(f);
          modules.push({ id: a.elements[i - 1].value, exportModuleIds: aliases, offset: f.start, endOffset: f.end, definitions });
        }
      });
    }
    for (const c of children(n)) walk(c);
  }
  walk(ast);
  return { file, sha256: createHash('sha256').update(source).digest('hex'), modules };
}
export async function inspectFile(path, ids, offsets) { return inspectModules(await readFile(path, 'utf8'), ids, path.split(/[\\/]/).at(-1), offsets); }
