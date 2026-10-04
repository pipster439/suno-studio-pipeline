#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { SunoBridge } from './bridge/client.mjs';
const [command, ...args] = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
try {
  const bridge = new SunoBridge({ base: option('base', 'http://127.0.0.1:3000') });
  let result;
  if (command === 'raw-call') {
    const bodyFile = option('body');
    const body = bodyFile ? JSON.parse(await readFile(bodyFile, 'utf8')) : undefined;
    const abort = new AbortController(); process.once('SIGINT', () => abort.abort());
    result = await bridge.call({ method: option('method', 'GET'), path: option('path'), body, timeoutMs: Number(option('timeout', '30000')), requestId: option('id') }, { signal: abort.signal });
  } else if (command === 'capture-start') result = await bridge.request('/api/capture/start', { label: option('label', 'operation') });
  else if (command === 'capture-stop') result = await bridge.request('/api/capture/stop', {});
  else if (command === 'probe') result = await bridge.request('/api/probe', {});
  else if (command === 'cancel') result = await bridge.cancel(option('id'));
  else throw new Error('commands: raw-call | capture-start | capture-stop | probe | cancel');
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(JSON.stringify(e.toJSON?.() || { kind: 'local_error', message: e.message })); process.exitCode = 1; }
