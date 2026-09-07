import { Document, Packer, Paragraph, TextRun, Math as WordMath, MathFraction, MathRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { question, fail } from './domain.mjs';

function runs(text) {
  const parts = text.split(/(\d+[/／]\d+)/g);
  return parts.filter(Boolean).map(part => /^\d+[/／]\d+$/.test(part)
    ? new WordMath({ children: [new MathFraction({ numerator: [new MathRun(part.split(/[/／]/)[0])], denominator: [new MathRun(part.split(/[/／]/)[1])] })] })
    : new TextRun(part));
}
const para = (text, bold = false) => new Paragraph({ spacing: { after: 160 }, children: bold ? [new TextRun({ text, bold })] : runs(text) });
function picture(diagram) {
  if (diagram.type === 'groups') return para(Array.from({length:diagram.groups},()=>`[ ${'○ '.repeat(diagram.count)}]`).join('   '));
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = diagram.fractions.length*90+20;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '26px sans-serif';
  diagram.fractions.forEach(([n, d], i) => {
    ctx.fillStyle = '#222'; ctx.fillText(`${n}/${d}`, 10, i*90+50);
    for (let j = 0; j < d; j++) { ctx.fillStyle = j < n ? '#bbb' : 'white'; ctx.fillRect(100+j*870/d, i*90+15, 870/d, 45); ctx.strokeStyle = '#555'; ctx.strokeRect(100+j*870/d, i*90+15, 870/d, 45); }
  });
  return new Paragraph({ children: [new ImageRun({ type: 'png', data: Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)), transformation: { width: 480, height: Math.round(canvas.height*0.48) } })] });
}
const grid = rows => new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:rows.map(row=>new TableRow({children:row.map(text=>new TableCell({children:[para(text || ' ')]}))})) });
async function imageParagraph(p, columns) {
  const bitmap = await createImageBitmap(await (await fetch(p.data)).blob());
  const width = Math.min(columns === 2 ? 200 : 360,bitmap.width), height = Math.round(width*bitmap.height/bitmap.width); bitmap.close();
  return new Paragraph({children:[new ImageRun({type:p.data.startsWith('data:image/png') ? 'png':'jpg',data:Uint8Array.from(atob(p.data.split(',')[1]),c=>c.charCodeAt(0)),transformation:{width,height}})]});
}
export async function exportWord({ worksheet: w, level, mode, extension }) {
  if (!['student', 'answers', 'both'].includes(mode)) throw fail('匯出格式錯誤。');
  const blocks = [];
  for (const answers of mode === 'both' ? [false, true] : [mode === 'answers']) {
    const children = [para(`${w.topic}${answers ? ' · 答案' : ''}`, true), para(`小${w.grade} · 程度 ${level}　${w.objective}`)];
    if (w.header) children.unshift(para(w.header));
    if (!answers) children.push(para('姓名：________________　班別：________　日期：____________'));
    if (w.context) children.push(para(w.context));
    let last = '';
    const add = async (q, i) => {
      if (i > 0 && w.questions[i-1] && q.layout?.page > w.questions[i-1].layout?.page) children.push(new Paragraph({pageBreakBefore:true}));
      if (q.section !== last) { children.push(para(q.section, true)); last = q.section; }
      const start = children.length;
      children.push(para(`${q.layout?.numberLabel || `${i+1}.`} ${q.prompt}`));
      if (q.diagram) children.push(picture(q.diagram));
      for (const p of q.pictures || []) children.push(await imageParagraph(p,w.columns));
      if (q.layout?.table?.length) children.push(grid(q.layout.table));
      if (answers) { children.push(para(q.answer)); if (q.explanation) children.push(para(q.explanation)); }
      else {
        if (q.hint) children.push(para(`提示：${q.hint}`));
        if (q.layout?.answerStyle === 'boxes') children.push(grid([Array(q.layout.boxCount || 1).fill('      ')]));
        else for (let n=0;n<q.workLines;n++) children.push(para(q.layout?.answerStyle === 'space' ? ' ' : w.columns === 2 ? '________________________' : '________________________________________________'));
      }
      if (q.layout?.bordered) { const inner=children.splice(start); children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[new TableRow({children:[new TableCell({children:inner})]})]})); }
    };
    for (const [i,q] of w.questions.entries()) await add(q,i);
    if (extension) { children.push(para(`延伸題 · ${extension.objective}`, true)); await add(question(extension.question, 60, true), w.questions.length); }
    if (w.footer) children.push(para(w.footer));
    blocks.push({ properties: { column: {count:w.columns || 1,space:400}, page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children });
  }
  return Packer.toBlob(new Document({
    styles: { default: { document: {
      run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft JhengHei' }, size: 24 },
      paragraph: { spacing: { line: 360 } }
    } } },
    sections: blocks
  }));
}
