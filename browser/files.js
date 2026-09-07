import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { fail } from './domain.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
const MAX = 15 * 1024 * 1024;
const xml = value => {
  const doc = new DOMParser().parseFromString(value, 'application/xml');
  if (doc.querySelector('parsererror')) throw fail('Word 內容損壞。', 'invalid_file');
  return doc;
};
function xmlText(n) {
  const name = n.localName;
  if (name === 't') return n.textContent;
  if (name === 'tab' || name === 'tc') return (name === 'tc' ? [...n.children].map(xmlText).join('') : '') + '\t';
  if (name === 'br' || name === 'cr') return '\n';
  if (name === 'f') return [...n.children].filter(c => ['num', 'den'].includes(c.localName)).map(xmlText).join('/');
  return [...(n.children || [])].map(xmlText).join('') + (['p', 'tr'].includes(name) ? '\n' : '');
}
export async function imageData(bytes, type) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type })).catch(() => { throw fail('圖片損壞或格式無效。', 'invalid_file'); });
  try {
    if (bitmap.width * bitmap.height > 24000000) throw fail('圖片超過 2400 萬像素，請縮小後重試。');
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(bitmap.width * scale); canvas.height = Math.ceil(bitmap.height * scale);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally { bitmap.close(); }
}
function readDoc(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./doc-worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(fail('DOC 讀取逾時，請另存為 DOCX。')); }, 20000);
    const done = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = ({ data }) => { done(); data.error ? reject(fail(data.error)) : resolve(data); };
    worker.onerror = () => { done(); reject(fail('未能讀取 DOC，請另存為 DOCX。')); };
    worker.postMessage(buffer.slice(0));
  });
}
// Legacy Word embeds raster pictures in OfficeArt records. Decode only complete
// PNG/JPEG payloads; unsupported vector/OLE drawings are explicitly flagged.
async function docImages(bytes) {
  const images = []; const seen = new Set();
  for (let i = 0; i < bytes.length - 8; i++) {
    let end = -1, type;
    if (bytes[i] === 0xff && bytes[i+1] === 0xd8 && bytes[i+2] === 0xff) {
      type = 'image/jpeg';
      for (let j = i+3; j < bytes.length-1; j++) if (bytes[j] === 0xff && bytes[j+1] === 0xd9) { end = j+2; break; }
    } else if (bytes[i] === 137 && bytes[i+1] === 80 && bytes[i+2] === 78 && bytes[i+3] === 71) {
      type = 'image/png';
      for (let j = i+8; j < bytes.length-8;) {
        const size = new DataView(bytes.buffer, bytes.byteOffset+j, 4).getUint32(0);
        if (j+12+size > bytes.length) break;
        if (bytes[j+4] === 73 && bytes[j+5] === 69 && bytes[j+6] === 78 && bytes[j+7] === 68) { end = j+12+size; break; }
        j += size+12;
      }
    }
    if (end > i) {
      let image; try { image = await imageData(bytes.slice(i, end), type); } catch {}
      if (image && !seen.has(image)) { seen.add(image); images.push(image); if (images.length > 8) throw fail('Word 超過 8 張圖片，請分拆後重試。'); }
      i = end-1;
    }
  }
  return images;
}
export async function parseFile(fileName, base64) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (!['doc', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'heic'].includes(ext)) throw fail('支援 DOC、DOCX、PDF、JPG、JPEG 及 PNG。', 'invalid_file');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX) throw fail('請選擇不超過 15 MB 的檔案。', 'file_too_large');
  const result = { fileName, text: '', images: [], pages: 1, notices: [] };
  if (ext === 'pdf') {
    const task = pdfjs.getDocument({ data: bytes, cMapUrl: new URL('./cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('./standard_fonts/', import.meta.url).href, wasmUrl: new URL('./wasm/', import.meta.url).href, isEvalSupported: false });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 8) throw fail('每次支援 1 至 8 頁 PDF，請分拆後重試。');
      result.pages = pdf.numPages;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, 1800 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise;
        result.images.push(canvas.toDataURL('image/jpeg', 0.9));
        const content = await page.getTextContent();
        result.text += `\n[第 ${i} 頁]\n` + content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('');
        page.cleanup(); canvas.width = canvas.height = 0;
      }
    } catch (e) { throw e.code ? e : fail(e.name === 'PasswordException' ? 'PDF 受密碼保護，請先解除密碼。' : 'PDF 損壞或無法讀取，請重新匯出 PDF。', 'invalid_file'); }
    finally { await task.destroy(); }
  } else if (ext === 'docx' || (ext === 'doc' && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    let zip; try { zip = await JSZip.loadAsync(bytes); } catch { throw fail('這不是有效的 Word 文件。', 'invalid_file'); }
    const entries = Object.values(zip.files);
    if (entries.length > 2000 || entries.reduce((sum, f) => sum + (f._data?.uncompressedSize || 0), 0) > 80*1024*1024) throw fail('Word 解壓後太大，請分拆檔案。');
    if (!zip.file('word/document.xml')) throw fail('Word 文件缺少內容或受保護。');
    for (const f of entries.filter(f => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(f.name))) result.text += xmlText(xml(await f.async('string')).documentElement) + '\n';
    for (const f of entries.filter(f => /^word\/media\//.test(f.name) && !f.dir)) {
      if (result.images.length >= 8) throw fail('Word 超過 8 張圖片，請分拆檔案。');
      try { result.images.push(await imageData(await f.async('uint8array'))); }
      catch { result.notices.push('部分 Word 向量圖無法讀取，可另存 PDF 保留圖解。'); }
    }
    result.notices.push('請核對 Word 的題號、表格及公式；浮動圖形可另存 PDF 保留。');
  } else if (ext === 'doc') {
    if (![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => bytes[i] === v)) throw fail('這不是 Word 97–2003 DOC 文件，請在 Word 另存為 DOCX。');
    const legacy = await readDoc(bytes.buffer);
    result.text = legacy.text;
    for (const stream of legacy.streams) result.images.push(...await docImages(stream));
    result.images = [...new Set(result.images)];
    if (result.images.length > 8) throw fail('Word 超過 8 張圖片，請分拆後重試。');
    result.notices.push('已讀取舊版 Word 文字及可讀圖片。舊版公式、向量圖及版面可能遺漏，可另存 PDF 保留。');
  } else {
    result.images = [await imageData(bytes, ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg')];
  }
  result.text = result.text.trim();
  if (result.text.length > 60000) throw fail('文件超過 60,000 字，請分拆後重試。');
  if (!result.text && !result.images.length) throw fail('檔案沒有可讀內容。');
  result.notices = [...new Set(result.notices)];
  return result;
}
