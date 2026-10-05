import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(resolve(root, p), 'utf8');
let source = await read('vendor/suno-original.user.js');
function replace(before, after) {
  if (!source.includes(before)) throw new Error('source drift: expected adaptation anchor missing');
  source = source.replace(before, after);
}
source = source.replace(/\r\n/g, '\n');
replace('// @name         Suno Console 登录同步助手', '// @name         Suno Local Controller Transport + Recorder');
replace('// @namespace    https://suno-console.local/', '// @namespace    https://suno-controller.local/');
source = source.replace(/^\/\/ @(?:updateURL|downloadURL|match|connect).*\n/gm, '');
replace('// @run-at', '// @match        https://suno.com/*\n// @match        https://www.suno.com/*\n// @match        http://127.0.0.1:3000/*\n// @match        http://127.0.0.1:3001/*\n// @match        http://127.0.0.1:3002/*\n// @connect      studio-api-prod.suno.com\n// @connect      127.0.0.1\n// @run-at');
replace('// @version      1.3.11', '// @version      1.3.19');
replace("const VERSION = '1.3.11';", "const VERSION = '1.3.19';");
replace('// @grant        unsafeWindow','// @grant        GM_getTab\n// @grant        GM_saveTab\n// @grant        unsafeWindow');
replace('function currentHeaders() {',(await read('userscripts/studio-read-adapter.js'))+'\n    function currentHeaders() {');
source = source.replaceAll('void checkForScriptUpdate(panel);', '// Local build: no auto-update request.');
replace('async function refreshAccount() {', 'async function refreshAccount() {\n      return null; // No workbench account request in local-only build.\n      /*');
replace('async function sync(payload) {', '*/ }\n\n    async function sync(payload) {\n      emitLocalAuthState(); return; // Never upload auth to controller.\n      /*');
// Close the original refreshAccount function inside the comment; close sync too.
replace('function requestSync() {', '*/ }\n\n    function requestSync() {');
replace("void fetch('/api/auth?expired=1', { method: 'DELETE', credentials: 'include' }).catch(() => undefined);", 'emitLocalAuthState();');
replace('const pending = callSunoApi(request.path, request.method, requestBody);', 'const pending = callSunoApi(request.path, request.method, requestBody, request);');
replace('function callSunoApi(path, method = \'GET\', body) {', `function callSunoApi(path, method = 'GET', body, req = {}) {
      method = String(method || 'GET').toUpperCase();
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\\\\s#]/.test(path) || /%(?:0[0-9a-f]|1[0-9a-f]|5c)/i.test(path) || !['GET','POST','PUT','PATCH','DELETE'].includes(method)) {
        return { promise: Promise.reject(Object.assign(new Error('Invalid path or method'), { kind: 'validation_error' })), abort() {} };
      }
      const blocked = StudioProtocol.dispatchBlock(path, method, {allow_verified_studio_writes:GM_getValue('allow_verified_studio_writes', false) === true && req.verifiedStudioWrite === true});
      if (blocked) return { promise: Promise.reject(Object.assign(new Error('STUDIO WRITES LOCKED'), { kind: blocked })), abort() {} };
      const startedAt = performance.now();`);
replace('resolve(result);', 'resolve({ body: result, status: response.status, durationMs: performance.now() - startedAt });');
replace('ok: true, result }', 'ok: true, result: result.body, status: result.status, durationMs: result.durationMs }');
replace('error.status = response.status;', 'error.status = response.status; error.details = SunoPrivacy.body(result);');
replace('status: error.status }', 'status: error.status, details: error.details, kind: error.kind }');
source = source.replaceAll("new Error('无法连接 Suno，请检查网络或登录状态')", "Object.assign(new Error('无法连接 Suno，请检查网络或登录状态'), { kind: 'network_error' })");
source = source.replaceAll("new Error('上传请求已取消')", "Object.assign(new Error('上传请求已取消'), { kind: 'cancelled' })");
source = source.replaceAll("new Error('请求 Suno 超时')", "Object.assign(new Error('请求 Suno 超时'), { kind: 'timeout' })");
source = source.replaceAll("new Error('Suno 登录未续期，请打开已登录的 Suno 页面后重试')", "Object.assign(new Error('Suno 登录未续期，请打开已登录的 Suno 页面后重试'), { kind: 'auth_error' })");
replace('async function refreshAccount() {', (await read('userscripts/local-adapter.js')) + '\n    async function refreshAccount() {');
const end = source.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length;
source = source.slice(0, end) + '\n' + await read('shared/privacy.cjs') + '\n' + await read('shared/studio-privacy.cjs') + '\n' + (await read('shared/studio-protocol.cjs')).replace('/* WRITE_POLICY_SNAPSHOT */ []', JSON.stringify(JSON.parse(await read('suno/studio/endpoint-inventory.json')).endpoints.filter(e=>e.method==='POST'&&e.status==='VERIFIED').map(e=>e.path))) + '\n' + await read('userscripts/studio-read-panel.js') + '\n' + await read('userscripts/studio-validation-hooks.js') + '\n' + await read('userscripts/recorder.js') + '\n' + source.slice(end);
source = source.replace('__LOCAL_BUILD_HASH__', createHash('sha256').update(source).digest('hex'));
await mkdir(resolve(root, 'userscripts'), { recursive: true });
await writeFile(resolve(root, 'userscripts/local-transport.user.js'), source);
console.log('Built userscripts/local-transport.user.js from preserved source and local adapters.');
