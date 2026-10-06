import { sample, wav } from './pcm.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
const db = x => 20 * Math.log10(Math.max(1e-12, x));
export function windowMetrics(pcm, center, radius) {
  const a = Math.max(0, center - radius), b = Math.min(pcm.frames, center + radius);
  const channels = [];
  for (let ch = 0; ch < pcm.channels; ch++) {
    let energy = 0, peak = 0, dc = 0, jump = 0, derivativeEnergy = 0, crosses = 0, nearClip = 0, clip = 0;
    let pre = 0, post = 0, preN = 0, postN = 0, preDC = 0, postDC = 0;
    for (let i = a; i < b; i++) {
      const x = sample(pcm, i, ch); if (!Number.isFinite(x)) throw Error('Non-finite PCM sample');
      energy += x * x; peak = Math.max(peak, Math.abs(x)); dc += x;
      if (Math.abs(x) >= 0.999) nearClip++; if (Math.abs(x) >= 1) clip++;
      if (i < center) { pre += x * x; preDC += x; preN++; } else { post += x * x; postDC += x; postN++; }
      if (i > a) { const prev = sample(pcm, i - 1, ch), d = Math.abs(x - prev); jump = Math.max(jump, d); derivativeEnergy += d * d; if ((x >= 0) !== (prev >= 0)) crosses++; }
    }
    const n = Math.max(1, b - a);
    channels.push({ peak, peakDbFS: db(peak), rms: Math.sqrt(energy / n), rmsBefore: Math.sqrt(pre / Math.max(1, preN)), rmsAfter: Math.sqrt(post / Math.max(1, postN)),
      derivativeRMS: Math.sqrt(derivativeEnergy / n), maxAdjacentJump: jump, exactBoundaryJump: center > 0 && center < pcm.frames ? Math.abs(sample(pcm, center, ch) - sample(pcm, center - 1, ch)) : 0,
      dcOffset: dc / n, dcBefore: preDC / Math.max(1, preN), dcAfter: postDC / Math.max(1, postN), zeroCrossings: crosses, zeroCrossingRate: crosses / n,
      clippedSamples: clip, nearClippedSamples: nearClip });
  }
  return { startSample: a, endSample: b, channels };
}
function features(windows) {
  const large = windows.ms500.channels, small = windows.ms10.channels, medium = windows.ms50.channels;
  return { jump: Math.max(...small.map(c => c.maxAdjacentJump)), exactJump: Math.max(...small.map(c => c.exactBoundaryJump)),
    isolation: Math.max(...small.map((c, i) => c.maxAdjacentJump / Math.max(1e-7, large[i].derivativeRMS))),
    rmsStepDb: Math.max(...medium.map(c => Math.abs(db(c.rmsBefore) - db(c.rmsAfter)))),
    dcStep: Math.max(...small.map(c => Math.abs(c.dcAfter - c.dcBefore))),
    spikeDb: Math.max(...small.map((c, i) => db(c.rms) - db(large[i].rms))),
    dipDb: Math.max(...small.map((c, i) => db(large[i].rms) - db(c.rms))),
    audibleRms: Math.max(...medium.map(c => Math.max(c.rmsBefore, c.rmsAfter))),
    peak: Math.max(...small.map(c => c.peak)), nearClippedSamples: small.reduce((n, c) => n + c.nearClippedSamples, 0),
    clippedSamples: small.reduce((n, c) => n + c.clippedSamples, 0) };
}
function measure(pcm, seconds) {
  const center = Math.round(seconds * pcm.sampleRate), windows = Object.fromEntries([500, 50, 10].map(ms => [`ms${ms}`, windowMetrics(pcm, center, Math.round(ms * pcm.sampleRate / 1000))]));
  let narrowJump = 0, seamSalience = 0;
  const inner = Math.max(1, Math.round(.001 * pcm.sampleRate)), outer = Math.round(.01 * pcm.sampleRate);
  for (let ch = 0; ch < pcm.channels; ch++) {
    const surrounding = []; let peak = 0;
    for (let i = Math.max(1, center - outer); i < Math.min(pcm.frames, center + outer); i++) {
      const d = Math.abs(sample(pcm, i, ch) - sample(pcm, i - 1, ch));
      if (Math.abs(i - center) <= inner) peak = Math.max(peak, d); else surrounding.push(d);
    }
    narrowJump = Math.max(narrowJump, peak); seamSalience = Math.max(seamSalience, peak / Math.max(1e-6, quantile(surrounding, .99)));
  }
  return { timestamp: seconds, sample: center, windows, features: { ...features(windows), narrowJump, seamSalience } };
}
export function analyzeBoundaries(pcm, times, { baselineCount = 128, seed = 1977 } = {}) {
  const duration = pcm.frames / pcm.sampleRate, normals = []; let rand = seed >>> 0;
  for (let attempt = 0; normals.length < baselineCount && attempt < baselineCount * 100; attempt++) {
    rand = (Math.imul(rand, 1664525) + 1013904223) >>> 0;
    const t = .5 + rand / 2 ** 32 * Math.max(0, duration - 1);
    if (duration < 1 || times.some(b => Math.abs(t - b) < .55)) continue;
    normals.push(measure(pcm, t));
  }
  const keys = ['jump', 'exactJump', 'isolation', 'rmsStepDb', 'dcStep', 'spikeDb', 'dipDb','narrowJump','seamSalience'];
  // Silent outro windows must not make the relative dip baseline hundreds of dB.
  const activeNormals = normals.filter(n => n.features.audibleRms >= .001);
  const baseline = Object.fromEntries(keys.map(k => [k, { median: quantile(activeNormals.map(x => x.features[k]), .5), p95: quantile(activeNormals.map(x => x.features[k]), .95), p99: quantile(activeNormals.map(x => x.features[k]), .99) }]));
  const boundaries = times.map((t, index) => {
    const m = measure(pcm, t), f = m.features, findings = [];
    const elevated = (key, floor) => activeNormals.length >= 16 && f[key] > Math.max(floor, baseline[key].p99 * 1.3);
    // A large derivative alone is NOT a click. Require isolated impulse plus unusual
    // DC/energy/adjacent seam behavior relative to deterministic non-boundary controls.
    if (elevated('jump', .08) && elevated('isolation', 8) && (elevated('dcStep', .025) || elevated('spikeDb', 4) || elevated('exactJump', .08))) findings.push({ metric: 'sample_discontinuity_candidate', severity: 'warning' });
    if (elevated('seamSalience', 6) && f.narrowJump > .01 && f.audibleRms >= .001 && !findings.some(f => f.metric === 'sample_discontinuity_candidate')) findings.push({ metric: 'isolated_seam_impulse_candidate', severity: 'warning' });
    if (f.clippedSamples > 2) findings.push({ metric: 'clipping', severity: 'warning' });
    if (f.audibleRms >= .001 && elevated('spikeDb', 8)) findings.push({ metric: 'energy_spike', severity: 'warning' });
    if (f.audibleRms >= .001 && elevated('dipDb', 10)) findings.push({ metric: 'energy_dip', severity: 'warning' });
    if (f.audibleRms >= .001 && elevated('rmsStepDb', 12)) findings.push({ metric: 'RMS_step', severity: 'warning' });
    const score = activeNormals.length >= 16 ? (f.audibleRms < .001 ? 0 : Math.max(...keys.map(k => Math.max(0, (f[k] - baseline[k].median) / Math.max(.001, baseline[k].p99 - baseline[k].median))))) : null;
    return { index, ...m, score, findings, anomaly: findings.length > 0 };
  });
  return { version: 1, detector: 'heuristic candidates; not a perceptual click verdict', duration, sampleRate: pcm.sampleRate, channels: pcm.channels,
    baselineCount: activeNormals.length, normalWindowCount: normals.length, baselineSeed: seed, baseline, normalWindows: normals.map(n => ({ timestamp: n.timestamp, features: n.features })),
    boundaryCount: boundaries.length, detectedAnomalyCount: boundaries.filter(b => b.anomaly).length,
    averageBoundaryScore: mean(boundaries.map(b => b.score ?? 0)), maxBoundaryScore: Math.max(0, ...boundaries.map(b => b.score ?? 0)), boundaries };
}
export function classifyABC(a, b, c) {
  if (![a, b, c].every(x => x && x.baselineCount >= 16 && x.boundaries.length && x.responseValidated)) return 'INSUFFICIENT_EVIDENCE';
  const flagged = x => x.detectedAnomalyCount > 0;
  if (!flagged(a) && flagged(b) && !flagged(c)) return 'LIKELY_PER_CLIP_DSP_RESET';
  if (flagged(a) && flagged(b)) return 'INVESTIGATE_TIMELINE_CUT_WARP_PLACEMENT';
  if (flagged(b) && flagged(c)) return 'INVESTIGATE_TRANSPOSITION_PREPROCESS_RENDER';
  return flagged(a) || flagged(b) || flagged(c) ? 'INCONCLUSIVE' : 'NO_DETECTED_ANOMALY';
}
export function qualityGate(analysis, expectedDuration, metadataDuration) {
  const warnings = analysis.boundaries.flatMap(b => b.findings.map(f => ({ ...f, boundaryIndex: b.index, timestamp: b.timestamp })));
  const tolerance = Math.max(.05, 2 / analysis.sampleRate);
  if (Math.abs(analysis.duration - expectedDuration) > tolerance) warnings.push({ metric: 'duration', severity: 'warning', expected: expectedDuration, actual: analysis.duration, tolerance });
  if (metadataDuration != null && Math.abs(analysis.duration - metadataDuration) > tolerance) warnings.push({ metric: 'render_duration_metadata', severity: 'warning', expected: metadataDuration, actual: analysis.duration });
  return { status: warnings.length ? 'QUALITY WARNING' : 'PASS', expectedDuration, actualDuration: analysis.duration, warnings };
}
export function silentGaps(pcm, minimumMs = 20) {
  const hop = Math.max(1, Math.round(.01 * pcm.sampleRate)), gaps = []; let start = null;
  for (let i = 0; i < pcm.frames; i += hop) {
    let energy = 0, n = 0;
    for (let k = i; k < Math.min(pcm.frames, i + hop); k++) for (let c = 0; c < pcm.channels; c++) { energy += sample(pcm, k, c) ** 2; n++; }
    if (Math.sqrt(energy / n) < 1e-5) { start ??= i; }
    else if (start !== null) { if ((i - start) * 1000 / pcm.sampleRate >= minimumMs) gaps.push({ start: start / pcm.sampleRate, end: i / pcm.sampleRate }); start = null; }
  }
  if (start !== null && (pcm.frames - start) * 1000 / pcm.sampleRate >= minimumMs) gaps.push({ start: start / pcm.sampleRate, end: pcm.frames / pcm.sampleRate });
  return gaps;
}
export async function writeAnalysis(dir, analysis, pcm, debug = false) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'boundaries.json'), JSON.stringify(analysis, null, 2) + '\n');
  const header = ['index','timestamp','sample','score','anomaly','jump','exactJump','isolation','narrowJump','seamSalience','audibleRms','rmsStepDb','dcStep','spikeDb','dipDb','peak','clippedSamples','nearClippedSamples'];
  await writeFile(join(dir, 'boundaries.csv'), [header.join(','), ...analysis.boundaries.map(b => header.map(k => b[k] ?? b.features[k]).join(','))].join('\n') + '\n');
  if (debug) for (const b of analysis.boundaries) { const a = Math.max(0, b.sample - Math.round(pcm.sampleRate / 2)), z = Math.min(pcm.frames, b.sample + Math.round(pcm.sampleRate / 2)); if (z > a) await writeFile(join(dir, `boundary_${String(b.index).padStart(3, '0')}.wav`), wav(pcm, a, z)); }
}
