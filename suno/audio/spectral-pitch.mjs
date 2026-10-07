import { sample } from './pcm.mjs';

// Relative spectral translation is an estimate for aligned polyphonic material,
// not an F0 detector or a guarantee that every voice has the same pitch.
export const SPECTRAL_PITCH_THRESHOLDS = Object.freeze({
  version: 'spectral-translation-v1', binsPerOctave: 96, windowCount: 16,
  minimumWindows: 4, minimumCorrelation: .5, minimumMargin: .025,
  minimumAgreement: .6, agreementCents: 35, exclusionCents: 50
});
function vector(pcm, center) {
  const size = 32768, origin = Math.round(center * pcm.sampleRate) - size / 2;
  if (origin < 0 || origin + size > pcm.frames) return null;
  const re = new Float64Array(size), im = new Float64Array(size); let energy = 0;
  for (let i = 0; i < size; i++) {
    const x = sample(pcm, origin + i, 0); energy += x * x;
    re[i] = x * (.5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)));
  }
  if (energy / size < 1e-8) return null;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let length = 2; length <= size; length *= 2) {
    const theta = -2 * Math.PI / length;
    for (let base = 0; base < size; base += length) for (let j = 0; j < length / 2; j++) {
      const a = base + j, b = a + length / 2, c = Math.cos(theta * j), s = Math.sin(theta * j);
      const r = re[b] * c - im[b] * s, v = re[b] * s + im[b] * c;
      re[b] = re[a] - r; im[b] = im[a] - v; re[a] += r; im[a] += v;
    }
  }
  const count = Math.floor(Math.log2(Math.min(6000, pcm.sampleRate * .4) / 100) * 96);
  const logPower = Array.from({ length: count }, (_, i) => {
    const bin = 100 * 2 ** (i / 96) * size / pcm.sampleRate, a = Math.floor(bin), t = bin - a;
    const power = k => re[k] ** 2 + im[k] ** 2;
    return Math.log(1e-12 + power(a) * (1 - t) + power(a + 1) * t);
  });
  // Remove broad spectral envelope so gain/EQ changes cannot masquerade as pitch.
  return logPower.map((x, i) => {
    const local = logPower.slice(Math.max(0, i - 8), Math.min(count, i + 9));
    return x - local.reduce((s, v) => s + v, 0) / local.length;
  });
}
function scores(a, b) {
  return Array.from({ length: 193 }, (_, index) => {
    const shift = index - 96; let xy = 0, xx = 0, yy = 0;
    // Common support for all offsets avoids a changing score denominator.
    for (let i = 96; i < a.length - 96; i++) {
      xy += a[i] * b[i + shift]; xx += a[i] ** 2; yy += b[i + shift] ** 2;
    }
    return xy / Math.max(1e-12, Math.sqrt(xx * yy));
  });
}
export function estimateSpectralPitchShift(reference, rendered, { lagMs = 0 } = {}) {
  if (reference.sampleRate !== rendered.sampleRate) throw Error('Pitch comparison requires equal sample rates');
  const t = SPECTRAL_PITCH_THRESHOLDS, duration = Math.min(reference.frames, rendered.frames) / reference.sampleRate;
  const windows = [];
  for (let w = 0; w < t.windowCount; w++) {
    const center = duration * (w + .5) / t.windowCount;
    const a = vector(reference, center), b = vector(rendered, center + lagMs / 1000);
    if (a && b) { const values = scores(a, b), best = values.indexOf(Math.max(...values)); windows.push({ center, values, deltaCents: (best - 96) * 12.5 }); }
  }
  const method = 'Aligned 32768-sample Hann FFT windows; envelope-whitened 96-bin/octave log spectra; relative translation within +/-1200 cents';
  if (windows.length < t.minimumWindows) return { status: 'NOT VERIFIED', deltaCents: null, reason: 'Insufficient non-silent aligned windows', method, thresholdVersion: t.version };
  const mean = Array.from({ length: 193 }, (_, i) => windows.reduce((s, w) => s + w.values[i], 0) / windows.length);
  const best = mean.indexOf(Math.max(...mean)), delta = (best - 96) * 12.5;
  const competitor = Math.max(...mean.filter((_, i) => Math.abs(i - best) * 12.5 > t.exclusionCents));
  const margin = mean[best] - competitor, agreement = windows.filter(w => Math.abs(w.deltaCents - delta) <= t.agreementCents).length / windows.length;
  const reliable = best > 0 && best < 192 && mean[best] >= t.minimumCorrelation && margin >= t.minimumMargin && agreement >= t.minimumAgreement;
  return { status: reliable ? 'ESTIMATED_RELATIVE_SPECTRAL_SHIFT' : 'NOT VERIFIED',
    deltaCents: reliable ? delta : null, candidateDeltaCents: delta, resolutionCents: 12.5,
    correlation: mean[best], competingShiftMargin: margin, agreement, windowCount: windows.length,
    windows: windows.map(({ center, deltaCents }) => ({ center, deltaCents })), method,
    thresholdVersion: t.version, limitation: 'Relative spectral estimate, not per-voice F0 or perceptual equivalence' };
}
