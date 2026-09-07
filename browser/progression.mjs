import { checkedVersion, fail, schema } from './domain.mjs';

export function levelPaths(levels, baseline) {
  const down = [], up = [];
  for (let l = baseline - 1; l >= Math.min(baseline, ...levels); l--) down.push(l);
  for (let l = baseline + 1; l <= Math.max(baseline, ...levels); l++) up.push(l);
  return [down, up];
}
export const rubric = {
  1: 'Maximum access: simpler language/values where needed, an analogous worked example with DIFFERENT answers, concrete visual support when helpful, and intermediate fill-in steps. Do not reveal the target answer.',
  2: 'Break the calculation into meaningful intermediate blanks, simplify wording, and add a useful visual if needed. More independent than level 1; do not duplicate its worked example.',
  3: 'Keep original question mostly intact with ONE targeted hint. Do not supply all intermediate steps.',
  4: 'Usual independent primary-school calculation.',
  5: 'Change a relationship or add a meaningful calculation step within the same concept, not just different numbers or names.',
  6: 'Combine more quantities/people or explicitly defined time periods; require more dependent calculations than level 5, using the SAME mathematical concept.',
  7: 'A more demanding multi-step dependency or missing quantity than level 6, solvable using the SAME concept. No trick ambiguity, no new curriculum concept.'
};
const compact = w => JSON.stringify(w, (k,v) => k === 'pictures' ? [] : v);
export function structuralIssues(previous, next) {
  const stripNumbers = s => s.replace(/[\d０-９]+(?:[./]\d+)?/g, '#').replace(/\s/g, '');
  return next.questions.flatMap((q,i) => {
    const p = previous.questions[i];
    if (stripNumbers(q.prompt) === stripNumbers(p.prompt) && q.hint === p.hint && JSON.stringify(q.diagram) === JSON.stringify(p.diagram)) return [`${q.id}: 只有數字改變或沒有實質差異。`];
    return [];
  });
}
export async function generateProgression(payload, call, progress = () => {}, signal) {
  const { source, baseline, levels } = payload;
  const versions = {}, failures = {}, metadata = {};
  const paths = payload.operation === 'replace' ? [levels] : levelPaths(levels, baseline);
  const total = paths.flat().length + (payload.operation !== 'replace' && levels.includes(baseline) ? 1 : 0);
  let done = 0;
  async function make(level, previous, previousLevel) {
    let feedback = '', result, meta;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw fail('已取消。', 'cancelled');
      progress(done, total, `正在製作程度 ${level}（依據程度 ${previousLevel}）${attempt ? '：修正分級差異' : ''}…`);
      const reply = await call('language', `Create maths worksheet level ${level}/7 from ADJACENT level ${previousLevel}; original baseline ${baseline}. Retain EXACT objective string, grade, subject, question IDs/order/count. Preserve original sections, numbering, boxes, table shape, columns and approximate page grouping; expand space only where needed. Main questions MUST use the same mathematical concept. Never ask students to explain/justify reasoning. Teacher-only answers and solutions must be correct, including when original lacks answers. No ambiguous assumptions: for months explicitly give school days/weeks. Changing only numbers/names/context is NOT a difficulty change.
TARGET: ${level === baseline && payload.operation !== 'replace' ? 'Retain original question wording, hints, diagrams and layout exactly; only supply missing answers.' : rubric[level]}
Direction: ${level < previousLevel ? 'reduce difficulty/support more' : 'increase structural difficulty/support less'}. Each change must be meaningful relative to the ADJACENT version, not merely the source. Teacher presets (never override same-concept requirement): ${JSON.stringify(payload.presets?.[level] || {})}. hints=false: simplify structure without hints; visuals=false: no ADDED diagrams/illustrations. Preserve required source visuals.
If helpful use exact diagram {type:'fraction_bars',fractions:[[1,2]],caption:''} or {type:'groups',groups:3,count:4,caption:''}. Other useful non-quantitative concept illustrations: put a short visual brief in illustration, to be drawn by an image model. Black/white line art; no text, answers or numerically exact geometry/counts. Prefer visuals in levels 1-2, not decoration. Never return image data. Set pictureAction:'keep'|'remove'|'replace' to honor teacher requests to remove/revise visuals; remove also means diagram:null and illustration:''. Per question add change explaining to TEACHER the structural/support difference (not a student question).
Operation: ${payload.operation || 'generate'}. ${payload.operation === 'replace' ? `Revise ONLY the supplied question following this teacher request: ${JSON.stringify(payload.instruction)}. If it changes the mathematical concept, return {objectiveChange:true,reason:'brief explanation'} instead of a worksheet; never silently change objective.` : ''}
Extension: ${!!payload.extension}. Only when enabled, optionally add separately labelled extension {objective,question}; main objective unchanged.
Return worksheet JSON like ${JSON.stringify(schema)}. ORIGINAL: ${compact(source)}\nADJACENT: ${compact(previous)}\nRetry feedback: ${feedback}`, []);
      if (reply.value.objectiveChange) throw fail(`修改可能改變學習目標：${reply.value.reason || '請調整修改要求，或先在原稿確認新目標。'}`, 'objective_change');
      if (level === baseline && payload.operation !== 'replace' && Array.isArray(reply.value.questions)) reply.value.questions.forEach((q,i)=>{if(source.questions[i]) q.prompt=source.questions[i].prompt;});
      result = checkedVersion(reply.value, source, level, payload.extension); meta = reply.meta;
      result.columns = source.columns || 1; result.header = source.header || ''; result.footer = source.footer || '';
      result.questions.forEach((q,i) => {
        const original = source.questions[i];
        const table = q.layout.table;
        q.section = original.section; q.layout = structuredClone(original.layout);
        if (q.layout?.table.length) {
          if (!table.length || table.some(r=>r.length !== q.layout.table[0].length)) throw fail('新題表格未能保留原稿欄位，請重試。','alignment_failed');
          q.layout.table = table;
        }
        q.pictures = q.prompt === original.prompt && q.pictureAction === 'keep' ? structuredClone(original.pictures || []) : [];
        if (q.pictureAction === 'remove') { q.diagram = null; q.illustration = ''; }
        if (level === baseline && payload.operation !== 'replace') Object.assign(q, { prompt: original.prompt, hint: original.hint, diagram: original.diagram, layout: structuredClone(original.layout), pictures: original.pictures || [], illustration: '' });
      });
      if (level === baseline || payload.operation === 'replace') break;
      const review = await call('language', `Audit adjacent MATHS levels ${previousLevel} -> ${level}. Return JSON {pass:boolean,issues:[strings]}. Check EACH question: same mathematical concept, correct/solvable answers, no requests for written explanation, meaningful directional difficulty change. ONLY changing names/numbers is a failure. Lower: distinct scaffolding, not repeated hints. Higher: structural/dependent calculation change; primary grade ${source.grade}. Also check no target answer leaked in student hints. PRIOR:${compact(previous)}\nNEW:${compact(result)}`, []);
      const issues = structuralIssues(previous, result);
      if (review.value.pass !== true) issues.push(...(Array.isArray(review.value.issues) ? review.value.issues.map(String).slice(0,10) : ['未能確認程度差異。']));
      if (!issues.length) break;
      feedback = issues.join('\n');
      if (attempt === 1) result.notices.push(`程度差異不足，請老師檢查：${feedback}`.slice(0,790));
    }
    metadata[level] = meta; done++; progress(done,total,`已完成 ${done}／${total} 個級別（包括背景級別）。`);
    return result;
  }
  if (payload.operation !== 'replace' && levels.includes(baseline)) {
    try { versions[baseline] = await make(baseline,source,baseline); } catch(e) { failures[baseline] = {code:e.code,message:e.message}; }
  }
  await Promise.all(paths.map(async path => {
    let previous = source, previousLevel = baseline;
    for (const [index,level] of path.entries()) {
      try {
        const result = await make(level,previous,previousLevel);
        if (levels.includes(level)) versions[level] = result;
        previous = result; previousLevel = level;
      } catch(e) {
        for (const affected of path.slice(index).filter(l => levels.includes(l))) failures[affected] = {code:e.code || 'dependency_failed', message:`程度 ${level} 未完成：${e.message}`};
        break;
      }
    }
  }));
  if (signal?.aborted) throw fail('已取消。','cancelled');
  if (!Object.keys(versions).length) throw fail(Object.values(failures)[0]?.message || '未能完成版本。',Object.values(failures)[0]?.code);
  return {versions, failures, metadata};
}
