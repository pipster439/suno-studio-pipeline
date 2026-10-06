import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function ffmpeg(args) { return execute(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 4 * 1024 * 1024 }); }
export async function probe(file) {
  const { stdout } = await execute(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],{timeout:30000,maxBuffer:4*1024*1024});
  const info = JSON.parse(stdout), stream = info.streams.find(s => s.codec_type === 'audio');
  if (!stream) throw Error('Input has no audio stream');
  return { sampleRate: Number(stream.sample_rate), channels: stream.channels, channelLayout: stream.channel_layout ?? null,
    codec: stream.codec_name, formatName: info.format.format_name, sampleFormat: stream.sample_fmt, duration: Number(stream.duration ?? info.format.duration) };
}
export function readPCM(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw Error('Expected RIFF WAV PCM');
  let format, data;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', p, p + 4), size = bytes.readUInt32LE(p + 4), start = p + 8;
    if (start + size > bytes.length) throw Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16) throw Error('Invalid fmt chunk');
      let tag = bytes.readUInt16LE(start);
      if (tag === 0xfffe && size >= 40) tag = bytes.readUInt16LE(start + 24);
      format = { tag, channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    }
    if (id === 'data') data = bytes.subarray(start, start + size);
    p = start + size + (size & 1);
  }
  if (!format || !data || ![1, 3].includes(format.tag) || ![16, 24, 32].includes(format.bits) || format.tag === 3 && format.bits !== 32 || format.channels < 1 || !format.sampleRate || format.blockAlign !== format.channels * format.bits / 8 || data.length % format.blockAlign) throw Error('Unsupported or malformed PCM format');
  return { ...format, data, frames: data.length / format.blockAlign };
}
export function wav(pcm, start = 0, end = pcm.frames) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > pcm.frames || end <= start) throw Error('Invalid sample range');
  const data = pcm.data.subarray(start * pcm.blockAlign, end * pcm.blockAlign), h = Buffer.alloc(44), pad = data.length & 1;
  h.write('RIFF'); h.writeUInt32LE(36 + data.length + pad, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(pcm.tag, 20); h.writeUInt16LE(pcm.channels, 22); h.writeUInt32LE(pcm.sampleRate, 24);
  h.writeUInt32LE(pcm.sampleRate * pcm.blockAlign, 28); h.writeUInt16LE(pcm.blockAlign, 32); h.writeUInt16LE(pcm.bits, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data, Buffer.alloc(pad)]);
}
export function sample(pcm, frame, channel) {
  const pos = frame * pcm.blockAlign + channel * pcm.bits / 8;
  return pcm.tag === 3 ? pcm.data.readFloatLE(pos) : pcm.data.readIntLE(pos, pcm.bits / 8) / 2 ** (pcm.bits - 1);
}
export function slicePlan(pcm, { chunkSeconds = 6, prerollMs = 0, postrollMs = 0, minimumSliceSeconds = 0 } = {}) {
  const size = Math.round(chunkSeconds * pcm.sampleRate), pre = Math.round(prerollMs * pcm.sampleRate / 1000), post = Math.round(postrollMs * pcm.sampleRate / 1000);
  const minimum = Math.round(minimumSliceSeconds * pcm.sampleRate);
  if (size < 1 || pre < 0 || post < 0) throw Error('Invalid slice parameters');
  if (!Number.isFinite(minimumSliceSeconds) || minimum < 0 || size < minimum) throw Error('Chunk duration must reach minimum slice duration');
  if (pcm.frames < minimum) throw Error(`Source is shorter than minimum upload duration (${minimumSliceSeconds}s)`);
  const result = [];
  for (let start = 0, index = 0; start < pcm.frames; index++) {
    let end = Math.min(pcm.frames, start + size);
    // A duration rejection is not a seam: absorb a short tail without padding,
    // dropping samples or introducing an additional sub-minimum source upload.
    if (pcm.frames > end && pcm.frames - end < minimum) end = pcm.frames;
    const sourceStart = Math.max(0, start - pre), sourceEnd = Math.min(pcm.frames, end + post);
    result.push({ index, start, end, sourceStart, sourceEnd, startSec: start / pcm.sampleRate, endSec: end / pcm.sampleRate,
      durSec: (end - start) / pcm.sampleRate, sourceDurationSeconds: (sourceEnd - sourceStart) / pcm.sampleRate,
      readOffsetSeconds: (start - sourceStart) / pcm.sampleRate, localHash: sha256(wav(pcm, sourceStart, sourceEnd)) });
    start = end;
  }
  return result;
}
export async function preprocess(input, output, pitchUp) {
  const sourceInfo = await probe(input);
  // Preserve sample rate/channel count; float PCM avoids an extra integer quantization.
  await ffmpeg(['-y', '-i', input, '-map', '0:a:0', '-vn', ...(pitchUp === 0 ? [] : ['-af', `rubberband=pitch=${2 ** (pitchUp / 12)}:pitchq=quality`]), '-c:a', 'pcm_f32le', output]);
  const pcm = readPCM(await readFile(output));
  if (pcm.sampleRate !== sourceInfo.sampleRate || pcm.channels !== sourceInfo.channels) throw Error('Unexpected sample format normalization');
  return { sourceInfo, pcm, conversion: { codec: 'pcm_f32le', sampleRate: pcm.sampleRate, channels: pcm.channels, pitchUp, rubberBandFactor: 2 ** (pitchUp / 12), gainProcessing: 'none' } };
}
export async function decode(file, output) { await ffmpeg(['-y', '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', output]); return readPCM(await readFile(output)); }
export async function writeSlice(pcm, slice, file) { await writeFile(file, wav(pcm, slice.sourceStart, slice.sourceEnd)); }
// Compare the audible trim against the zero-transpose exact render, including
// codec delay. Searching a range wider than the handle detects a wrong read offset.
export function verifyAlignment(reference, candidate, times, { maxLagMs = 200, toleranceMs = 2 } = {}) {
  if (reference.sampleRate !== candidate.sampleRate || reference.channels !== candidate.channels) throw Error('Alignment requires matching decoded sample formats');
  const rate = reference.sampleRate, radius = Math.round(rate * .15), coarse = Math.max(1, Math.round(rate / 1000));
  const checks = times.map(timestamp => {
    const center = Math.round(timestamp * rate), limit = Math.round(maxLagMs * rate / 1000);
    function correlation(lag) {
      let xy=0,xx=0,yy=0;
      for(let i=center-radius;i<center+radius;i+=4) {
        if(i<0 || i>=reference.frames || i+lag<0 || i+lag>=candidate.frames) continue;
        for(let c=0;c<reference.channels;c++){const x=sample(reference,i,c),y=sample(candidate,i+lag,c);xy+=x*y;xx+=x*x;yy+=y*y;}
      }
      return xy/Math.max(1e-12,Math.sqrt(xx*yy));
    }
    let best={lag:0,correlation:-1};
    for(let lag=-limit;lag<=limit;lag+=coarse){const score=correlation(lag);if(score>best.correlation)best={lag,correlation:score};}
    const coarseBest=best.lag;
    for(let lag=coarseBest-coarse;lag<=coarseBest+coarse;lag++){const score=correlation(lag);if(score>best.correlation)best={lag,correlation:score};}
    return {timestamp,...best,lagMs:best.lag/rate*1000,passed:best.correlation>=.95 && Math.abs(best.lag/rate*1000)<=toleranceMs};
  });
  return {passed:checks.length>0 && checks.every(c=>c.passed),toleranceMs,maxLagMs,checks};
}
