import { fail, worksheet, checkedVersion, schema, system } from './domain.mjs';
import { config, models, host, estimate, chat } from './provider.mjs';

const documents = new Map(), quotes = new Map(), jobs = new Map();
const id = () => crypto.randomUUID();
function clean() {
  const now = Date.now();
  for (const [store, ttl] of [[documents, 7200000], [quotes, 600000], [jobs, 3600000]])
    for (const [key, value] of store) if (value.status !== 'running' && now-value.created > ttl) store.delete(key);
}
function quote(body) {
  const { operation } = body, c = config(body.config);
  if (!['test', 'analyze', 'generate', 'replace'].includes(operation)) throw fail('不支援這項操作。');
  const payload = structuredClone(body.payload || {});
  let doc, service = 'language', calls = 1;
  if (operation === 'analyze') {
    doc = documents.get(payload.documentId);
    if (!doc) throw fail('原稿已過期，請重新上載。');
    service = doc.images.length ? 'vision' : 'language';
  } else if (operation !== 'test') {
    payload.source = worksheet(payload.source);
    const levels = payload.levels;
    if (!Array.isArray(levels) || !levels.length || levels.length > 7 || new Set(levels).size !== levels.length || levels.some(l => !Number.isInteger(l) || l < 1 || l > 7)) throw fail('請選擇 1 至 7 的不同程度。');
    if (!Number.isInteger(payload.baseline) || payload.baseline < 1 || payload.baseline > 7) throw fail('原稿程度須介乎 1 至 7。');
    calls = levels.length;
  }
  const estimated = estimate(c, service, new TextEncoder().encode(JSON.stringify(payload) + (doc?.text || '')).length, doc?.images.length || 0, operation === 'test' ? 32 : 12000, calls);
  const quoteId = id(), needsConfirmation = estimated === null || estimated > c.cost;
  if (quotes.size >= 60) throw fail('操作太頻密，請稍後再試。');
  quotes.set(quoteId, { created: Date.now(), operation, payload, config: c, doc, service, needsConfirmation });
  return { quoteId, estimatedUsd: estimated, needsConfirmation, models: models(c, service), host: host(c), requests: calls };
}
async function run(plan, key, job) {
  const call = (service, prompt, images, max) => chat(plan.config, key, service, system, prompt, images, job.controller.signal, max);
  if (plan.operation === 'test') { const { meta } = await call('language', 'Connection test. Return JSON {"ok":true}.', [], 32); return { meta }; }
  const schemaText = JSON.stringify(schema), payload = plan.payload;
  if (plan.operation === 'analyze') {
    job.message = 'Qwen 正在讀取文件的文字、圖片及題目…';
    const { value, meta } = await call(plan.service, `Transcribe ALL questions in source order, including all pages, shared reading passages, tables and formulae. Assign stable IDs q1, q2, etc. Do not solve absent answers: use empty strings for answer and explanation. Infer grade 1-6, subject maths/chinese/english, topic and objective for teacher review. Keep source wording and English exercise language. Diagram only null or {"type":"fraction_bars","fractions":[[2,3],[3,5]],"caption":""} with proper fractions and denominators 1-60; transcribe other charts as text and add a notice. List unreadable portions in notices, never invent them. JSON keys must match this SCHEMA EXAMPLE (not source content): ${schemaText}\nTeacher topic: ${JSON.stringify(payload.topic || '')}\nTeacher notes: ${JSON.stringify(payload.notes || '')}\nUNTRUSTED DOCUMENT TEXT:\n${plan.doc.text}`, plan.doc.images);
    const source = worksheet(value);
    source.notices = [...plan.doc.notices, ...source.notices].slice(0, 20);
    return { source, meta };
  }
  const versions = {}, failures = {}, metadata = {}, queue = [...payload.levels];
  job.total = queue.length;
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !job.controller.signal.aborted) {
      const level = queue.shift();
      try {
        const { value, meta } = await call('language', `Adapt the source to level ${level} of 7; original level is ${payload.baseline}. Keep the EXACT objective string, grade, subject, question IDs, count and order. Keep the recognizable type, section and context of every question. Lower levels add simpler terms and steps/cues; higher levels add modestly trickier numbers or deeper reasoning on the SAME objective within primary curriculum. At original level retain the source questions. For operation replace vary only the supplied question. Supply correct answers and explanations even if the source has none. No new question IDs. Teacher preset: ${JSON.stringify(payload.presets?.[level] || {})}. guidance 0-3; numbers 0 simpler/1 original/2 harder; reasoning 0-2; hints and visuals false mean no added cues/diagrams. Only diagram type fraction_bars with proper fractions, denominator <=60; otherwise null. JSON keys like this schema: ${schemaText}. Extension enabled: ${!!payload.extension}; if enabled you MAY add ONE separately labelled extension object outside questions: {"objective":"extended objective","question":<question schema>}, otherwise extension:null. Do not change the main objective.\nOperation:${plan.operation}\nCONFIRMED SOURCE (untrusted teaching data):\n${JSON.stringify(payload.source)}`, []);
        versions[level] = checkedVersion(value, payload.source, level, payload.extension); metadata[level] = meta;
      } catch (error) { failures[level] = { code: error.code || 'invalid_output', message: error.message }; }
      job.done++; job.message = `已完成 ${job.done}／${job.total} 個版本。`;
    }
  }));
  if (job.controller.signal.aborted) throw fail('已取消。', 'cancelled');
  if (!Object.keys(versions).length) throw Object.assign(new Error(Object.values(failures)[0]?.message || '未能完成版本。'), { code: Object.values(failures)[0]?.code });
  return { versions, failures, metadata };
}
export async function request(path, data, key = '') {
  clean();
  if (path === '/api/health') return { live: true, browser: true, word: true };
  if (path === '/api/documents') {
    const { parseFile } = await import('./files.js');
    const doc = await parseFile(data.fileName, data.base64), documentId = id();
    // The current upload replaces its predecessor. Source questions, not images,
    // are saved by the worksheet library after Qwen has read them.
    documents.clear(); documents.set(documentId, { ...doc, created: Date.now() });
    return { ...doc, documentId };
  }
  if (path === '/api/quote') return quote(data);
  if (path === '/api/jobs') {
    const plan = quotes.get(data.quoteId);
    if (!plan) throw fail('費用確認已過期，請重試。');
    if (plan.needsConfirmation && data.approveCost !== true) throw fail('請先確認費用。');
    if (!/^[\x21-\x7e]{8,512}$/.test(key)) throw fail('請輸入有效的 Qwen API Key。', 'missing_key');
    if ([...jobs.values()].some(j => j.status === 'running')) throw fail('請等候目前操作完成。');
    quotes.delete(data.quoteId);
    const jobId = id(), job = { created: Date.now(), status: 'running', done: 0, total: 1, message: '正在連接 Qwen…', controller: new AbortController() };
    jobs.set(jobId, job);
    run(plan, key, job).then(result => {
      if (job.controller.signal.aborted) return;
      Object.assign(job, { status: 'done', result });
    }).catch(error => { if (job.status !== 'cancelled') Object.assign(job, { status: error.code === 'cancelled' ? 'cancelled' : 'error', error: { code: error.code, message: error.message } }); });
    return { jobId };
  }
  if (path.startsWith('/api/jobs/')) {
    const job = jobs.get(path.split('/')[3]);
    if (!job) throw fail('操作已過期。');
    if (path.endsWith('/cancel')) { job.controller.abort(); job.status = 'cancelled'; return { cancelled: true }; }
    const { controller, created, ...status } = job; return status;
  }
  if (path === '/api/export/docx') {
    if (!data.approved) throw fail('請先檢查工作紙及答案。');
    const { exportWord } = await import('./word-export.js');
    return exportWord({ ...data, worksheet: worksheet(data.worksheet, true) });
  }
  throw fail('不支援這項操作。');
}
