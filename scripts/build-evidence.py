"""Pack a small explicit evidence staging directory; never pack the workspace."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('staging')
parser.add_argument('output')
args = parser.parse_args()
stage = Path(args.staging).resolve(strict=True)
out = Path(args.output).resolve()
if out.is_relative_to(stage) or not stage.name.startswith('phase1-'):
    raise SystemExit('Use an independent phase1-* staging folder and an external output')
out.parent.mkdir(parents=True, exist_ok=True)
allowed = {'logs', 'manifests', 'hashes', 'screenshots', 'evidence'}
allowed_suffixes = {'.md', '.json', '.txt', '.log', '.sha256', '.jpg', '.png'}
secret_pattern = re.compile(r'\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|Bearer\s+(?!<redacted>)[A-Za-z0-9_-]{10,}')
files = sorted(p for p in stage.rglob('*') if p.is_file())
inventory = []
for p in files:
    rel = p.relative_to(stage)
    if p.is_symlink() or not p.resolve().is_relative_to(stage):
        raise SystemExit('Symlink or escaping path rejected')
    if rel.as_posix() != 'REPORT.md' and rel.parts[0] not in allowed:
        raise SystemExit('Unrelated evidence entry rejected: ' + rel.as_posix())
    if p.suffix.lower() not in allowed_suffixes or p.stat().st_size > 2 * 1024 * 1024:
        raise SystemExit('Archive/large/unexpected artifact rejected: ' + rel.as_posix())
    if p.suffix.lower() not in {'.jpg', '.png'} and secret_pattern.search(p.read_text(encoding='utf-8')):
        raise SystemExit('Possible credential rejected in ' + rel.as_posix())
    data = p.read_bytes()
    inventory.append({'path': rel.as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(stage / 'manifests').mkdir(exist_ok=True)
(stage / 'hashes').mkdir(exist_ok=True)
(stage / 'manifests' / 'content-manifest.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
(stage / 'hashes' / 'files.sha256').write_text(''.join(f"{f['sha256']}  {f['path']}\n" for f in inventory), encoding='utf-8')
files = sorted(p for p in stage.rglob('*') if p.is_file())
names = [p.relative_to(stage).as_posix() for p in files]
if len(set(n.lower() for n in names)) != len(names):
    raise SystemExit('Duplicate archive entries rejected')
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for p, name in zip(files, names):
        z.write(p, name)
with zipfile.ZipFile(out) as z:
    if z.testzip() is not None or z.namelist() != names:
        raise SystemExit('Archive verification failed')
    for f in inventory:
        if hashlib.sha256(z.read(f['path'])).hexdigest() != f['sha256']:
            raise SystemExit('Entry hash mismatch')
digest = hashlib.sha256(out.read_bytes()).hexdigest()
out.with_suffix(out.suffix + '.sha256').write_text(f'{digest}  {out.name}\n', encoding='utf-8')
print(json.dumps({'archive': str(out), 'entries': names, 'bytes': out.stat().st_size, 'sha256': digest,
                  'verified': True, 'nested_archives': False, 'duplicates': False}, indent=2))
