import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import privacy from '../shared/privacy.cjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/studio_project_get.json', import.meta.url), 'utf8'));
const plain = v => JSON.parse(JSON.stringify(v));
test('exact musical meter survives browser and backend double redaction with all genuine fixture state values', async () => {
  const source = await readFile(new URL('../shared/privacy.cjs', import.meta.url), 'utf8');
  const sandbox = { URL, URLSearchParams }; sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const browser = sandbox.SunoPrivacy.redact(fixture);
  assert.deepEqual(plain(browser), fixture);
  assert.deepEqual(plain(privacy.redact(browser)), fixture);
  assert.deepEqual(plain(privacy.body(JSON.stringify(fixture))), fixture);
});
test('exception is exact, recursive, and limited to JSON fields, with no signature/header/query relaxation', () => {
  const marker = 'PRIVACY_NEGATIVE_SECRET';
  const jwt = 'abcdefghijk.abcdefghijk.abcdefghijk';
  const input = { timeSignatureChanges: { '0': { numerator: 7, denominator: 8 }, nested: { token: marker, cookie: marker,
    authorization: marker, jwt, deviceIdentifier: marker, captcha_token: marker, sessionToken: marker, signature: marker,
    signedUrl: 'https://cdn.example/a?Signature=' + marker, text: 'Bearer ' + marker } },
    TimeSignatureChanges: marker, timeSignatureChangesToken: marker, timeSignatureChangesSignature: marker, timeSignatureChangesExtra: marker,
    signature: marker, authorization: marker, cookie: marker, 'set-cookie': marker };
  const output = plain(privacy.redact(privacy.redact(input)));
  assert.deepEqual(output.timeSignatureChanges['0'], { numerator: 7, denominator: 8 });
  for (const key of ['TimeSignatureChanges', 'timeSignatureChangesToken', 'timeSignatureChangesSignature', 'timeSignatureChangesExtra', 'signature']) assert.equal(output[key], privacy.MASK);
  assert.ok(!JSON.stringify(output).includes(marker)); assert.ok(!JSON.stringify(output).includes(jwt));
  assert.equal(privacy.headers({ timeSignatureChanges: marker }).timeSignatureChanges, privacy.MASK);
  const signed = new URL(privacy.url('https://studio-api-prod.suno.com/a?timeSignatureChanges=' + marker + '&title=public&Signature=' + marker));
  for (const value of signed.searchParams.values()) assert.equal(value, privacy.MASK);
  assert.equal(new URL(privacy.url('https://studio-api-prod.suno.com/a?timeSignatureChanges=' + marker)).searchParams.get('timeSignatureChanges'), privacy.MASK);
  const nestedJson = JSON.stringify({ timeSignatureChanges: { '0': { numerator: 5, denominator: 4 }, token: marker } });
  const nested = JSON.parse(privacy.redact(nestedJson));
  assert.equal(nested.timeSignatureChanges.token, privacy.MASK);
  assert.equal(nested.timeSignatureChanges['0'].numerator, 5);
});
