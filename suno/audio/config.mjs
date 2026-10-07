import { resolve, extname } from 'node:path';
const numbers = { 'render-timeout-seconds':[900,1,7200], 'delivery-timeout-seconds':[180,1,3600], 'studio-pitch':[-8,-24,24], 'local-pitch':[8,-24,24], 'studio-speed':[.5,.25,4], 'studio-formant':[0,0,1], 'studio-volume':[1,.001,10], 'chunk-seconds': [6, .001, 3600], 'pitch-up': [8, -24, 24], 'studio-transpose': [-8, -24, 24], 'upload-concurrency': [4, 1, 16],
  'minimum-slice-seconds': [6,0,600], 'handle-clip-count':[4,2,10], 'preroll-ms': [50, 0, 2000], 'postroll-ms': [200, 0, 2000], 'crossfade-ms': [10, 1, 30], 'bps': [1.95, .1, 20], 'bridge-timeout-seconds': [90, 1, 600], 'abc-seconds': [0, 0, 600] };
const bools = new Set(['postprocess-test','validate-transform','synthetic-reference','download','recalibrate','skip-calibration','allow-quality-warning','diagnose','abc-test','abc-test-only','dry-run','keep-workdir','verbose','json-log','handle-test','gain-test','help']);
const strings = new Set(['studio-profile','studio-stretch','studio-quantize','output','resume','strategy','strategy-evidence','good-project','good-version','bad-project','bad-version','reuse-uploads','preprocessed']);
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
    if (key === 'chunk-seconds' && v === 'auto') values[key] = 'auto';
    else if (numbers[key]) { const n = Number(v), [, min, max] = numbers[key]; if (!Number.isFinite(n) || n < min || n > max || ['upload-concurrency','handle-clip-count'].includes(key) && !Number.isInteger(n)) throw Error(`Invalid --${key}`); values[key] = n; }
    else values[key] = v;
  }
  if (!values.help && !input && !values.resume && !values['postprocess-test']) throw Error('Audio input or --resume is required');
  if (!['auto','exact','preroll','crossfade'].includes(values.strategy)) throw Error('Invalid strategy');
  if(values['strategy-evidence']&&values.strategy!=='auto')throw Error('--strategy-evidence requires --strategy auto');
  if (!provided.includes('chunk-seconds')) values['chunk-seconds'] = 'auto';
  if (values['chunk-seconds'] !== 'auto' && values['chunk-seconds'] < values['minimum-slice-seconds']) throw Error('--chunk-seconds must reach --minimum-slice-seconds');
  if (values.output && !['.m4a','.mp4','.wav','.mp3','.flac'].includes(extname(values.output).toLowerCase())) throw Error('--output supports .m4a/.mp4/.wav/.mp3/.flac');
  if(values.output&&!values.download&&!values.resume)throw Error('--output requires explicit --download');
  if(values['recalibrate']&&values['skip-calibration'])throw Error('--recalibrate conflicts with --skip-calibration');
  if (values['handle-test'] && !values['abc-test']) throw Error('--handle-test requires --abc-test');
  if (values['abc-test-only'] && !values['abc-test']) throw Error('--abc-test-only requires --abc-test');
  if (values['good-version'] && !values['good-project'] || values['bad-version'] && !values['bad-project']) throw Error('Version requires matching project');
  return { ...values, input, provided };
}
