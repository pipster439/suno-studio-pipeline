import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const base = resolve(process.argv[2] || 'captures'); let files = 0, suspects = [];
async function walk(dir) {
  let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) await walk(path);
    else if (/\.(json|md)$/.test(e.name)) {
      files++; const text = await readFile(path, 'utf8');
      if (/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|Bearer\s+(?!<redacted>)[A-Za-z0-9_-]{10,}/.test(text)) suspects.push(path);
    }
  }
}
await walk(base);
console.log(JSON.stringify({ scannedFiles: files, suspiciousFiles: suspects, scope: 'JWT/Bearer heuristic only; inspect unknown fields before sharing' }, null, 2));
if (suspects.length) process.exitCode = 1;
