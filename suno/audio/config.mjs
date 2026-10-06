import { resolve, extname } from 'node:path';
const numbers = { 'chunk-seconds': [6, .001, 3600], 'pitch-up': [8, -24, 24], 'studio-transpose': [-8, -24, 24], 'upload-concurrency': [4, 1, 16],
  'minimum-slice-seconds': [6,0,600], 'handle-clip-count':[4,2,10], 'preroll-ms': [300, 0, 2000], 'postroll-ms': [200, 0, 2000], 'crossfade-ms': [10, 1, 30], 'bps': [1.95, .1, 20], 'bridge-timeout-seconds': [90, 1, 600], 'abc-seconds': [0, 0, 600] };
const bools = new Set(['diagnose','abc-test','abc-test-only','dry-run','keep-workdir','verbose','json-log','handle-test','gain-test','help']);
const strings = new Set(['output','resume','strategy','strategy-evidence','good-project','good-version','bad-project','bad-version','reuse-uploads','preprocessed']);
export function parseConfig(args) {
  const values = Object.fromEntries(Object.entries(numbers).map(([k, [v]]) => [k, v])); values.strategy = 'auto';
  let input; const provided = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { if (input) throw Error(`Unexpected positional argument: ${arg}`); input = resolve(arg); continue; }
    const split = arg.indexOf('='), key = arg.slice(2, split < 0 ? undefined : split), inline = split < 0 ? undefined : arg.slice(split + 1);
    provided.push(key);
    if (bools.has(key)) { if (inline !== undefined) throw Error(`Boolean --${key} takes no value`); values[key] = true; continue; }
    if (!numbers[key] && !strings.has(key)) throw Error(`Unknown option: --${key}`);
    const v = inline ?? args[++i]; if (v === undefined || v.startsWith('--')) throw Error(`Missing value for --${key}`);
    if (numbers[key]) { const n = Number(v), [, min, max] = numbers[key]; if (!Number.isFinite(n) || n < min || n > max || ['upload-concurrency','handle-clip-count'].includes(key) && !Number.isInteger(n)) throw Error(`Invalid --${key}`); values[key] = n; }
    else values[key] = v;
  }
  if (!values.help && !input && !values.resume) throw Error('Audio input or --resume is required');
  if (!['auto','exact','preroll','crossfade'].includes(values.strategy)) throw Error('Invalid strategy');
  if(values['strategy-evidence']&&values.strategy!=='auto')throw Error('--strategy-evidence requires --strategy auto');
  if (values['chunk-seconds'] < values['minimum-slice-seconds']) throw Error('--chunk-seconds must reach --minimum-slice-seconds');
  if (values.output && extname(values.output).toLowerCase() !== '.wav') throw Error('--output must end in .wav');
  if (values['handle-test'] && !values['abc-test']) throw Error('--handle-test requires --abc-test');
  if (values['abc-test-only'] && !values['abc-test']) throw Error('--abc-test-only requires --abc-test');
  if (values['good-version'] && !values['good-project'] || values['bad-version'] && !values['bad-project']) throw Error('Version requires matching project');
  return { ...values, input, provided };
}
