import test from 'node:test';
import assert from 'node:assert/strict';
import { schema, worksheet, checkedVersion } from '../browser/domain.mjs';
import { chat, config, host, estimate } from '../browser/provider.mjs';
import { levelPaths, generateProgression } from '../browser/progression.mjs';

const source = () => structuredClone(schema);
const output = () => { const v = source(); v.questions[0].answer = 'incorrect'; return v; };
const json = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
test('hidden adjacent paths honor any baseline', () => {
  assert.deepEqual(levelPaths([1,7],4),[[3,2,1],[5,6,7]]);
  assert.deepEqual(levelPaths([1,4],2),[[1],[3,4]]);
  assert.deepEqual(levelPaths([4],4),[[],[]]);
});
test('adjacent generation feeds previous output and only returns requested levels', async () => {
  const seen=[];
  const result=await generateProgression({source:worksheet(source()),baseline:4,levels:[1,7]},async (service,prompt)=>{
    if (prompt.startsWith('Audit')) return {value:{pass:true,issues:[]},meta:{}};
    const [,level,prior] = prompt.match(/level (\d)\/7 from ADJACENT level (\d)/);
    seen.push([Number(level),Number(prior)]);
    if (+prior !== 4) assert.match(prompt.split('ADJACENT:')[1],new RegExp(`question-${prior}`));
    const v=output(); v.questions[0].prompt=`question-${level}`; v.questions[0].hint=`support-${level}`;
    return {value:v,meta:{model:'mock'}};
  });
  assert.deepEqual(Object.keys(result.versions).sort(),['1','7']);
  assert.deepEqual(seen.filter(([l])=>l<4),[[3,4],[2,3],[1,2]]);
  assert.deepEqual(seen.filter(([l])=>l>4),[[5,4],[6,5],[7,6]]);
  assert.equal(result.versions[1].questions[0].layout.answerStyle,'boxes');
});
test('insufficient difference retries once then warns', async () => {
  let calls=0;
  const result=await generateProgression({source:worksheet(source()),baseline:4,levels:[3]},async (s,p)=>{
    calls++;
    return p.startsWith('Audit') ? {value:{pass:false,issues:['same hints']},meta:{}} : {value:output(),meta:{}};
  });
  assert.equal(calls,4); assert.match(result.versions[3].notices.join(''),/程度差異不足/);
});
test('failed intermediate stops only its dependent branch', async () => {
  const result=await generateProgression({source:worksheet(source()),baseline:4,levels:[1,5]},async(s,p)=>{
    if(p.startsWith('Audit')) return {value:{pass:true},meta:{}};
    if(p.includes('level 3/7')) throw new Error('service unavailable');
    const v=output();v.questions[0].hint='new support';return {value:v,meta:{}};
  });
  assert.ok(result.versions[5]);assert.ok(result.failures[1]);assert.equal(result.versions[1],undefined);
});
test('teacher revision keeps instruction and rejects changed objective', async () => {
  await assert.rejects(generateProgression({source:worksheet(source()),baseline:4,levels:[4],operation:'replace',instruction:'改為加法'},async(s,p)=>{
    assert.match(p,/改為加法/);return {value:{objectiveChange:true,reason:'不同概念'},meta:{}};
  }),/不同概念/);
});
test('baseline retains original wording and fill-in boxes',async()=>{
  const result=await generateProgression({source:worksheet(source()),baseline:4,levels:[4]},async()=>{
    const v=output();v.questions[0].prompt='different';return {value:v,meta:{}};
  });
  assert.equal(result.versions[4].questions[0].prompt,source().questions[0].prompt);
  assert.equal(result.versions[4].questions[0].layout.answerStyle,'boxes');
});
test('layout and exact quantity diagrams validate bounded data',()=>{
  const v=output();v.questions[0].diagram={type:'groups',groups:3,count:4,caption:''};
  assert.equal(worksheet(v).questions[0].diagram.count,4);
  v.questions[0].layout.boxCount=999;assert.throws(()=>worksheet(v));
});
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
test('default to international and preserve explicitly supplied host regions', () => {
  const expected = 'ws-s57l452ce7d9h3vk.cn-hongkong.maas.aliyuncs.com';
  assert.equal(host(config()), 'dashscope-intl.aliyuncs.com');
  assert.equal(host(config({ workspace: 'llm-example' })), 'llm-example.ap-southeast-1.maas.aliyuncs.com');
  for (const workspace of [expected, `https://${expected}/api/v1`, `https://${expected}/compatible-mode/v1/`]) assert.equal(host(config({ workspace })), expected);
  assert.equal(host(config({ workspace: 'llm-example.ap-southeast-1.maas.aliyuncs.com' })), 'llm-example.ap-southeast-1.maas.aliyuncs.com');
  assert.equal(host(config({ workspace: 'https://dashscope-intl.aliyuncs.com/api/v1' })), 'dashscope-intl.aliyuncs.com');
  for (const workspace of [`https://${expected}.evil.test/api/v1`, `https://key@${expected}/api/v1`, `http://${expected}/api/v1`, `https://${expected}/api/v1?key=oops`]) assert.throws(() => config({ workspace }));
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
    assert.equal(url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
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
