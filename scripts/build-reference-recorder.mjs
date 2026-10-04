import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const header = `// ==UserScript==
// @name         Suno Reference Event Recorder (observer only)
// @namespace    https://suno-controller.local/reference-recorder
// @version      1.0.0
// @description  Observe reference console events and same-origin API data; never transport Suno auth or replay requests.
// @match        https://sunouploader.site/*
// @match        https://www.sunouploader.site/*
// @match        http://127.0.0.1:3000/*
// @match        http://127.0.0.1:3001/*
// @match        http://127.0.0.1:3002/*
// @connect      127.0.0.1
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @noframes
// ==/UserScript==
`;
const source = header + await readFile('shared/privacy.cjs', 'utf8') + '\n' + await readFile('shared/reference-privacy.cjs', 'utf8') + '\n' + await readFile('userscripts/reference-recorder.js', 'utf8');
await writeFile('userscripts/reference-recorder.user.js', source.replace('__REFERENCE_BUILD_HASH__', createHash('sha256').update(source).digest('hex')));
console.log('Built independent observer-only reference recorder v1.0.0.');
