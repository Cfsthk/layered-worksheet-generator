import { fail } from './domain.mjs';
export const defaults = { vision: ['qwen3-vl-plus', 'qwen3-vl-plus-2025-12-19'], language: ['qwen3.7-plus', 'qwen3.6-plus', 'qwen-plus'] };
const rates = { 'qwen3.7-plus': [0.826, 3.301], 'qwen3.6-plus': [1.101, 6.602], 'qwen-plus': [1.2, 12], 'qwen3-vl-plus': [0.6, 4.8], 'qwen3-vl-plus-2025-12-19': [0.6, 4.8] };
export function config(v = {}) {
  const workspace = String(v.workspace || '').trim();
  if (workspace && !/^[A-Za-z0-9-]{1,80}$/.test(workspace)) throw fail('Workspace ID 格式錯誤。');
  const models = {};
  for (const service of Object.keys(defaults)) {
    models[service] = v.models?.[service] || '';
    if (typeof models[service] !== 'string' || (models[service] && !/^[A-Za-z0-9_.:/-]{1,150}$/.test(models[service]))) throw fail('Model ID 格式錯誤。');
  }
  const cost = Number(v.cost ?? 1);
  if (!Number.isFinite(cost) || cost < 0 || cost > 100) throw fail('費用門檻須介乎 US$0 至 US$100。');
  return { workspace, models, cost, fallback: v.fallback !== false };
}
export const host = c => c.workspace ? `${c.workspace}.ap-southeast-1.maas.aliyuncs.com` : 'dashscope-intl.aliyuncs.com';
export const models = (c, service) => [...new Set([c.models[service] || defaults[service][0], ...(c.fallback ? defaults[service] : [])])].slice(0, 4);
export function estimate(c, service, textBytes, images, output, calls = 1) {
  const candidates = models(c, service);
  if (candidates.some(m => !rates[m])) return null;
  const total = candidates.reduce((sum, m) => sum + (textBytes + images*16384 + 7000)*rates[m][0] + output*rates[m][1], 0)*calls/1000000;
  return Math.ceil(total*1000)/1000;
}
export async function chat(c, key, service, system, prompt, images = [], signal, maxTokens = 12000, transport = fetch) {
  if (typeof key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(key)) throw fail('請先輸入國際區域的 Qwen API Key。', 'missing_key');
  const candidates = models(c, service), notes = [];
  for (const [i, model] of candidates.entries()) {
    if (signal?.aborted) throw fail('已取消。', 'cancelled');
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 90000);
    const abort = () => timeout.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await transport(`https://${host(c)}/compatible-mode/v1/chat/completions`, {
        method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', signal: timeout.signal,
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: [
          { type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }],
          response_format: { type: 'json_object' }, enable_thinking: false, stream: false, max_tokens: maxTokens })
      });
      if ([401, 403].includes(response.status)) throw fail('金鑰無效、區域不符或沒有模型權限。請檢查國際區域 Qwen API Key 及 Workspace。', 'authentication');
      if (!response.ok) {
        const fallback = [400, 404, 422, 429, 500, 502, 503, 504].includes(response.status);
        if (fallback && i < candidates.length-1) { notes.push(`${model} 無法使用，已切換至 ${candidates[i+1]}。`); continue; }
        throw fail(`模型服務未能處理請求（HTTP ${response.status}）。請檢查模型權限、額度或稍後重試。`, 'provider_error');
      }
      const raw = await response.text();
      if (raw.length > 4000000) throw fail('模型回覆過長。');
      let value, result;
      try {
        result = JSON.parse(raw);
        if (result.choices?.[0]?.finish_reason === 'length') throw fail('模型回覆被截斷，請分拆工作紙。', 'truncated_output');
        const text = result.choices[0].message.content;
        value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      } catch (error) { throw error.code ? error : fail('模型未回傳完整資料，請重試。'); }
      if (signal?.aborted) throw fail('已取消。', 'cancelled');
      return { value, meta: { model, notes, usage: result.usage || {} } };
    } catch (error) {
      if (signal?.aborted) throw fail('已取消。已提交的請求仍可能計費。', 'cancelled');
      if (error.code) throw error;
      throw fail(timeout.signal.aborted ? '模型處理逾時，請稍後重試。' : '未能連接國際 Qwen。請檢查網絡、Workspace 或瀏覽器連線限制。', 'network_error');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
