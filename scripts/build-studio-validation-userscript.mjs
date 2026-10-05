import {readFile,writeFile}from'node:fs/promises';
const header=`// ==UserScript==
// @name Suno Studio Validation Capture Harness
// @namespace https://suno-controller.local/studio-validation
// @version 1.0.0
// @match https://suno.com/*
// @match https://www.suno.com/*
// @match http://127.0.0.1:3000/*
// @match http://127.0.0.1:3001/*
// @match http://127.0.0.1:3002/*
// @run-at document-start
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_addValueChangeListener
// @grant GM_xmlhttpRequest
// @grant unsafeWindow
// @connect 127.0.0.1
// ==/UserScript==
`;
const source=header+(await readFile('shared/privacy.cjs','utf8'))+'\n'+(await readFile('shared/studio-privacy.cjs','utf8'))+'\n'+(await readFile('userscripts/studio-validation-hooks.js','utf8'));
await writeFile('userscripts/studio-validation.user.js',source);console.log('Built passive document-start Studio validation harness; no Suno dispatch.');
