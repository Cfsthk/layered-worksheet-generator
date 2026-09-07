import test from 'node:test';
import assert from 'node:assert/strict';
import { schema, worksheet, checkedVersion } from '../browser/domain.mjs';
import { chat, config, host, estimate } from '../browser/provider.mjs';

const source = () => structuredClone(schema);
const output = () => { const v = source(); v.questions[0].answer = 'incorrect'; return v; };
const json = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
test('source may omit answers; generated versions may not', () => {
  assert.equal(worksheet(source()).questions[0].answer, '');
  assert.throws(() => checkedVersion(source(), source(), 1, false));
});
test('preserve confirmed objective, grade, subject, question sequence and count', () => {
  for (const change of [v => v.objective = 'different', v => v.grade = 5, v => v.subject = 'english', v => v.questions[0].id = 'q2', v => v.questions.push({ ...v.questions[0], id: 'q2' })]) {
    const v = output(); change(v); assert.throws(() => checkedVersion(v, source(), 1, false));
  }
});
test('symbolic comparison uses exact arithmetic and rejects zero denominator', () => {
  const v = output();
  assert.equal(checkedVersion(v, source(), 1, false).questions[0].answer, '2/3 ＞ 3/5');
  v.questions[0].prompt = '2/0 ○ 3/5'; assert.throws(() => checkedVersion(v, source(), 1, false));
});
test('reject unrecognized diagrams and duplicate IDs', () => {
  const v = output(); v.questions[0].diagram = { type: 'svg', src: '<script>' }; assert.throws(() => worksheet(v));
  v.questions[0].diagram = null; v.questions.push(v.questions[0]); assert.throws(() => worksheet(v));
});
test('extension only appears when explicitly enabled', () => {
  const v = output(); v.extension = { objective: 'extension', question: v.questions[0] };
  assert.equal(checkedVersion(v, source(), 1, false).extension, null);
  assert.equal(checkedVersion(v, source(), 1, true).extension.objective, 'extension');
});
test('region stays international and unknown model price requires confirmation', () => {
  assert.equal(host(config()), 'dashscope-intl.aliyuncs.com');
  assert.equal(host(config({ workspace: 'llm-example' })), 'llm-example.ap-southeast-1.maas.aliyuncs.com');
  assert.throws(() => config({ workspace: 'evil.com/' }));
  assert.equal(estimate(config({ models: { vision: 'custom' } }), 'vision', 1, 1, 100), null);
});
test('vision call includes images and key only in Authorization; fallback on explicit unavailability', async () => {
  const calls = [];
  const result = await chat(config(), 'test-only-key', 'vision', 'system', 'read', ['data:image/png;base64,TEST'], undefined, 100, async (url, options) => {
    calls.push({ url, options }); return calls.length === 1 ? new Response('{}', { status: 404 }) : json(source());
  });
  assert.equal(calls.length, 2); assert.equal(result.meta.notes.length, 1);
  for (const { url, options } of calls) {
    assert.match(url, /^https:\/\/dashscope-intl\.aliyuncs\.com\//);
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.body.includes('test-only-key'), false);
    assert.equal(JSON.parse(options.body).messages[1].content[1].type, 'image_url');
  }
});
test('authentication and malformed/truncated replies never trigger another charged attempt', async () => {
  for (const response of [new Response('{}', { status: 401 }), new Response('garbage'), new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] }))]) {
    let calls = 0;
    await assert.rejects(chat(config(), 'test-only-key', 'vision', 's', 'p', [], undefined, 100, async () => { calls++; return response; }));
    assert.equal(calls, 1);
  }
});
test('ambiguous network failure is not automatically retried', async () => {
  let calls = 0;
  await assert.rejects(chat(config(), 'test-only-key', 'language', 's', 'p', [], undefined, 100, async () => { calls++; throw new TypeError('Failed to fetch'); }), { code: 'network_error' });
  assert.equal(calls, 1);
});
test('cancellation prevents requests', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(chat(config(), 'test-only-key', 'language', 's', 'p', [], controller.signal, 100, async () => { calls++; }), { code: 'cancelled' });
  assert.equal(calls, 0);
});
