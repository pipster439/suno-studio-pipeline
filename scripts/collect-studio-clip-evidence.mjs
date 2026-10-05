// Reads only the previously acquired, hash-pinned snapshots. No network or bundle evaluation.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectFile } from './analyze-studio-clips.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');
const keywords = ['gainReference', 'repairLoudness', 'repairLoudnessOnMerge', 'restorePitchInStudio', 'pitchShiftSemitones'];
export async function collectClipEvidence(manifestPath, fixturePath, referenceManifestPath) {
  const directory = dirname(manifestPath), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const keywordInventory = Object.fromEntries(keywords.map(k => [k, []])), hashes = {};
  for (const row of manifest.rows) {
    const data = await readFile(resolve(directory, row.name));
    if (sha(data) !== row.sha256) throw Error('snapshot hash mismatch: ' + row.name);
    hashes[row.name] = row.sha256;
    for (const keyword of keywords) if (data.toString('utf8').includes(keyword)) keywordInventory[keyword].push(row.name);
  }
  const seeds = [
    ['0kfolb-xhy_j4.js', [386462, 634782, 505593, 934710, 404975], [120643], d => d.binding === 'o' || d.binding === 'exports' || ['a','n','r','t'].includes(d.binding) || d.expression.includes('e.transposition')],
    ['0ureacebq_re1.js', [728531], [], d => d.binding === 'exports'],
    ['3vyf86o0k-66r.js', [46472, 979354, 989274, 39940, 981734, 1755], [], d => ['h','n','y','H','C','q','x','$','G','exports'].includes(d.binding)],
    ['1v4_8jwiw44oy.js', [723181], [], d => ['l','exports'].includes(d.binding)],
    ['3g9-3c-u44c0o.js', [327403, 250367, 492912], [2646649], d => ['v','L','F','O','m'].includes(d.binding) || d.binding === 'exports' && /buildArrangementFromClipCreationIntent|insertArrangementsToContainer|useStudioV2LibraryClipDrop|updateArrangementFadeIn/.test(d.expression)],
    ['2ef8--43y8b0e.js', [879379, 323613], [], d => ['n','i','exports'].includes(d.binding)],
    ['3rk3hbpk2zy7n.js', [291279], [], d => d.binding === 'exports'],
  ];
  const functions = [];
  for (const [file, ids, offsets, predicate] of seeds) {
    const result = await inspectFile(resolve(directory, file), ids, offsets);
    if (result.sha256 !== hashes[file]) throw Error('seed changed');
    for (const m of result.modules) for (const d of m.definitions.filter(predicate)) {
      if (d.expression.length > 14000) continue; // Never include a shared full module/bundle.
      functions.push({ file, sha256: result.sha256, registrationModuleId: m.id, exportModuleIds: m.exportModuleIds,
        binding: d.binding, offset: d.offset, byteOffset: Buffer.byteLength((await readFile(resolve(directory,file),'utf8')).slice(0,d.offset)), expression: d.expression, status: 'FOUND_STATICALLY' });
    }
    if (file === '2ef8--43y8b0e.js') {
      const m = result.modules.find(m => m.id === 323613), source = await readFile(resolve(directory, file),'utf8');
      functions.push({ file, sha256: result.sha256, registrationModuleId: m.id, offset: m.endOffset - 650,
        expression: source.slice(m.endOffset - 650, m.endOffset), note: 'CommonJS MD5 export tail; implementation not evaluated', status: 'FOUND_STATICALLY' });
    }
  }
  // Existing analysis contains exact literal HTTP templates; do not re-discover or invoke APIs.
  const prior = JSON.parse(await readFile(resolve(directory, 'analysis.json'), 'utf8'));
  const endpoints = [...new Map(prior.calls.map(c => [c.method + ' ' + c.path, { method: c.method, path: c.path, file: c.file, offset: c.offset }])).values()];
  const fixtureBytes = await readFile(fixturePath), project = JSON.parse(fixtureBytes), clips = project.state.tracks[0].clips;
  const groups = Object.entries(project.state.markersRegistry).map(([hash, markers]) => ({ hash, markers,
    count: clips.filter(c => c.warp.markersHash === hash).length }));
  const fixture = { sha256: sha(fixtureBytes), status: 'OBSERVED', timing: project.state.timing, trackCount: project.state.tracks.length,
    clipCount: clips.length, sourceIdsMatchAliases: clips.every(c => c.clipId === c.asset.id), arrangementIdsSeparate: clips.every(c => c.id !== c.asset.id),
    transpositions: [...new Set(clips.map(c => c.transposition))], amplitudes: [...new Set(clips.map(c => c.amplitude))], groups,
    algebraicCorrelationOnly: { uploadPitchSemitones: 8, bps: project.state.timing.bps, multiplier: 2 ** (8/12),
      firstMarkerSlope: groups[0].markers['6'] / 6, expectedSlopeIfRelated: project.state.timing.bps * 2 ** (8/12), causalProof: false } };
  const referenceRows = JSON.parse(await readFile(referenceManifestPath, 'utf8'));
  const referenceRow = referenceRows.find(r => r.file?.endsWith('page-b178945df36952c2.js'));
  const referenceData = await readFile(resolve(dirname(referenceManifestPath), referenceRow.file));
  if (sha(referenceData) !== referenceRow.sha256) throw Error('reference snapshot hash mismatch');
  const referenceSource = referenceData.toString('utf8'), reference = [];
  for (const keyword of ['pitchShiftSemitones:!e.isTailSilence', 'restorePitchInStudio:', 'gainReference:e.gainReference', 'repairLoudness:a,gainRepair:c']) {
    const offset = referenceSource.indexOf(keyword);
    if (offset >= 0) reference.push({ file: referenceRow.file, sha256: referenceRow.sha256, keyword, offset,
      expression: referenceSource.slice(Math.max(0, offset - 100), offset + 650), status: 'FOUND_STATICALLY', scope: 'third-party orchestration; not official Studio API' });
  }
  return { source: 'previously received immutable JS snapshots; AST parsing only', analyzedAssets: manifest.rows.length,
    credentialAccess: false, newNetworkRequests: 0, writesDispatched: 0, keywordInventory, endpoints, functions, fixture, reference,
    limitations: ['Literal endpoint inventory is limited to loaded/acquired chunks; no global absence claim.',
      'Shared registrations may export multiple logical modules; offsets and import references are primary evidence.',
      'Static ports and local tests do not verify write authorization, server persistence or render audio.',
      'No inverse upload pitch or loudness algorithm inferred from correlation.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifest, fixture, reference, output] = process.argv.slice(2);
  if (!output) throw Error('usage: collect-studio-clip-evidence.mjs official-manifest fixture reference-manifest output');
  const result = await collectClipEvidence(resolve(manifest), resolve(fixture), resolve(reference));
  await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ assets: result.analyzedAssets, endpoints: result.endpoints.length, functions: result.functions.length,
    officialThirdPartyKeywordHits: result.keywordInventory, fixture: result.fixture, referenceSnippets: result.reference.length }));
}
