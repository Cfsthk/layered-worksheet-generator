import { fail, worksheet, checkedVersion, schema, system } from './domain.mjs';
import { config, models, host, estimate, chat } from './provider.mjs';
import { levelPaths, generateProgression } from './progression.mjs';
import { attachSourcePictures, illustration } from './assets.mjs';

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
    if (payload.source.subject !== 'maths') throw fail('此原型目前只支援數學工作紙。');
    if (operation === 'replace' && (typeof payload.instruction !== 'string' || !payload.instruction.trim() || payload.instruction.length > 2000)) throw fail('請輸入這題的修改要求（最多 2000 字）。');
    const levels = payload.levels;
    if (!Array.isArray(levels) || !levels.length || levels.length > 7 || new Set(levels).size !== levels.length || levels.some(l => !Number.isInteger(l) || l < 1 || l > 7)) throw fail('請選擇 1 至 7 的不同程度。');
    if (!Number.isInteger(payload.baseline) || payload.baseline < 1 || payload.baseline > 7) throw fail('原稿程度須介乎 1 至 7。');
    calls = operation === 'replace' ? 1 : levelPaths(levels,payload.baseline).flat().length*4 + (levels.includes(payload.baseline) ? 1 : 0);
  }
  const imagePossible = ['generate','replace'].includes(operation) && (payload.levels.some(l => payload.presets?.[l]?.visuals !== false) || payload.source.questions.some(q=>q.pictures.length));
  const estimated = imagePossible ? null : estimate(c, service, new TextEncoder().encode(JSON.stringify(payload) + (doc?.text || '')).length*3, doc?.images.length || 0, operation === 'test' ? 32 : 12000, calls);
  const quoteId = id(), needsConfirmation = estimated === null || estimated > c.cost;
  if (quotes.size >= 60) throw fail('操作太頻密，請稍後再試。');
  quotes.set(quoteId, { created: Date.now(), operation, payload, config: c, doc, service, needsConfirmation });
  return { quoteId, estimatedUsd: estimated, needsConfirmation, models: [...models(c, service), ...(imagePossible ? models(c,'image') : [])], host: host(c), requests: calls, imagePossible };
}
async function run(plan, key, job) {
  const call = (service, prompt, images, max) => chat(plan.config, key, service, system, prompt, images, job.controller.signal, max);
  if (plan.operation === 'test') { const { meta } = await call('language', 'Connection test. Return JSON {"ok":true}.', [], 32); return { meta }; }
  const schemaText = JSON.stringify(schema), payload = plan.payload;
  if (plan.operation === 'analyze') {
    job.message = 'Qwen 正在讀取文件的文字、圖片及題目…';
    const { value, meta } = await call(plan.service, `Transcribe ALL maths questions in source order, all pages and tables/formulae. Assign stable IDs q1,q2. Do not solve absent answers: empty answer/explanation. Infer grade 1-6, subject, topic, objective for teacher review. Preserve original wording, question numbering and printed header/footer. Extract columns (1 or 2), each question layout: answerStyle boxes/lines/space, boxCount, bordered, page (1-8), column, numberLabel, table as rows of strings preserving blank cells. Keep fill-in box characters in prompt too. Preserve original pictures: per question imageRefs:[{imageIndex:0,box:[x,y,width,height],caption:''}] using ZERO-based attached image index and coordinates normalized 0..1; crop ONLY relevant illustration, not surrounding questions/answers. For DOCX attached images are standalone figures, use full [0,0,1,1] when appropriate. No invented crops for unreadable figures: add notices. Diagram null or exact fraction_bars/groups only. No generated illustration during reading. Never invent missing content. Non-maths subject should be labelled accurately, not converted. JSON schema example:${schemaText}\nTeacher topic:${JSON.stringify(payload.topic || '')}\nTeacher notes:${JSON.stringify(payload.notes || '')}\nUNTRUSTED DOCUMENT TEXT:\n${plan.doc.text}`, plan.doc.images);
    const source = worksheet(value);
    if (source.subject !== 'maths') throw fail('此原型目前只支援數學工作紙。');
    await attachSourcePictures(source,value,plan.doc.images);
    source.notices = [...plan.doc.notices, ...source.notices].slice(0, 20);
    return { source, meta };
  }
  const result = await generateProgression({...payload,operation:plan.operation},call,(done,total,message)=>Object.assign(job,{done,total,message}),job.controller.signal);
  for (const [level,version] of Object.entries(result.versions)) {
    for (const q of version.questions) {
      const original = payload.source.questions.find(p=>p.id === q.id);
      if (!q.pictures.length && original?.pictures.length && q.pictureAction === 'keep') {
        try {
          job.message = `程度 ${level}：正在核對 ${q.id} 原圖…`;
          const review = await call('vision',`Does every source picture remain accurate and useful for this revised maths question? Return {pass:boolean,reason:string}. Reject mismatched people, quantities, labels, geometry or any illegible content. Question:${q.prompt}`,original.pictures.map(p=>p.data),1000);
          if (review.value.pass !== true) throw fail('原圖與新題未能確認一致，請老師核對。');
          q.pictures = structuredClone(original.pictures);
        } catch(e) { if(job.controller.signal.aborted) throw fail('已取消。','cancelled'); version.notices.push(`${q.id}：${e.message}`.slice(0,790)); }
      }
      if (!q.illustration || payload.presets?.[level]?.visuals === false || q.pictures.length >= 4) continue;
      job.message = `程度 ${level}：正在製作及檢查 ${q.id} 線條插圖…`;
      try {
        const data = await illustration(plan.config,key,q.illustration,job.controller.signal);
        const review = await call('vision',`Check illustration against maths question. Return {pass:boolean,reason:string}. Must help understand context, printable line drawing, no answer leakage, no misleading counts/geometry/text. If exact quantities are required reject this illustration. Question: ${q.prompt}`, [data],1000);
        if (review.value.pass !== true) throw fail('插圖需要老師確認，未加入學生版本。');
        q.pictures.push({data,caption:'輔助插圖'});
      } catch(e) { if (job.controller.signal.aborted) throw fail('已取消。','cancelled'); version.notices.push(`${q.id}：${e.message}`.slice(0,790)); }
    }
    version.notices = version.notices.slice(0,20);
  }
  return result;
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
