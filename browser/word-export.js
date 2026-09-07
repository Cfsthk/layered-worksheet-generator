import { Document, Packer, Paragraph, TextRun, Math as WordMath, MathFraction, MathRun, ImageRun } from 'docx';
import { question, fail } from './domain.mjs';

function runs(text) {
  const parts = text.split(/(\d+[/／]\d+)/g);
  return parts.filter(Boolean).map(part => /^\d+[/／]\d+$/.test(part)
    ? new WordMath({ children: [new MathFraction({ numerator: [new MathRun(part.split(/[/／]/)[0])], denominator: [new MathRun(part.split(/[/／]/)[1])] })] })
    : new TextRun(part));
}
const para = (text, bold = false) => new Paragraph({ spacing: { after: 160 }, children: bold ? [new TextRun({ text, bold })] : runs(text) });
function picture(diagram) {
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = diagram.fractions.length*90+20;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '26px sans-serif';
  diagram.fractions.forEach(([n, d], i) => {
    ctx.fillStyle = '#222'; ctx.fillText(`${n}/${d}`, 10, i*90+50);
    for (let j = 0; j < d; j++) { ctx.fillStyle = j < n ? '#bec8ef' : 'white'; ctx.fillRect(100+j*870/d, i*90+15, 870/d, 45); ctx.strokeStyle = '#555'; ctx.strokeRect(100+j*870/d, i*90+15, 870/d, 45); }
  });
  return new Paragraph({ children: [new ImageRun({ type: 'png', data: Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)), transformation: { width: 480, height: Math.round(canvas.height*0.48) } })] });
}
export async function exportWord({ worksheet: w, level, mode, extension }) {
  if (!['student', 'answers', 'both'].includes(mode)) throw fail('匯出格式錯誤。');
  const blocks = [];
  for (const answers of mode === 'both' ? [false, true] : [mode === 'answers']) {
    const children = [para(`${w.topic}${answers ? ' · 答案' : ''}`, true), para(`小${w.grade} · 程度 ${level}　${w.objective}`)];
    if (!answers) children.push(para('姓名：________________　班別：________　日期：____________'));
    if (w.context) children.push(para(w.context));
    let last = '';
    const add = (q, i) => {
      if (q.section !== last) { children.push(para(q.section, true)); last = q.section; }
      children.push(para(`${i+1}. ${q.prompt}`));
      if (q.diagram) children.push(picture(q.diagram));
      if (answers) { children.push(para(q.answer)); if (q.explanation) children.push(para(q.explanation)); }
      else { if (q.hint) children.push(para(`提示：${q.hint}`)); for (let n = 0; n < q.workLines; n++) children.push(para('________________________________________________________________')); }
    };
    w.questions.forEach(add);
    if (extension) { children.push(para(`延伸題 · ${extension.objective}`, true)); add(question(extension.question, 60, true), w.questions.length); }
    blocks.push({ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children });
  }
  return Packer.toBlob(new Document({
    styles: { default: { document: {
      run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft JhengHei' }, size: 24 },
      paragraph: { spacing: { line: 360 } }
    } } },
    sections: blocks
  }));
}
