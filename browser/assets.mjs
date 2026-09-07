import { host, models } from './provider.mjs';
import { fail } from './domain.mjs';

export async function cropPicture(data, box = [0,0,1,1]) {
  if (!Array.isArray(box) || box.length !== 4 || box.some(n => !Number.isFinite(n) || n < 0 || n > 1) || box[2] <= 0 || box[3] <= 0 || box[0]+box[2] > 1.001 || box[1]+box[3] > 1.001) throw fail('原圖位置未能辨識。');
  const response = await fetch(data), bitmap = await createImageBitmap(await response.blob());
  try {
    const [x,y,w,h] = box, width = bitmap.width*w, height = bitmap.height*h, scale = Math.min(1,720/Math.max(width,height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(width*scale)); canvas.height = Math.max(1,Math.round(height*scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,x*bitmap.width,y*bitmap.height,width,height,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.8);
  } finally { bitmap.close(); }
}
export async function attachSourcePictures(source, raw, images) {
  for (const [i,q] of source.questions.entries()) {
    const refs = raw.questions[i].imageRefs || [];
    if (!Array.isArray(refs)) continue;
    for (const ref of refs.slice(0,4)) {
      try {
        if (!Number.isInteger(ref.imageIndex) || !images[ref.imageIndex]) throw fail('圖片索引錯誤。');
        q.pictures.push({data: await cropPicture(images[ref.imageIndex],ref.box),caption:String(ref.caption || '').slice(0,300)});
      } catch { source.notices.push(`${q.id} 原圖需要老師確認，未能可靠擷取。`); }
    }
  }
}
export async function illustration(c,key,prompt,signal,transport=fetch) {
  const timeout = AbortSignal.timeout(120000), combined = signal ? AbortSignal.any([signal,timeout]) : timeout;
  const response = await transport(`https://${host(c)}/api/v1/services/aigc/multimodal-generation/generation`, {
    method:'POST',mode:'cors',credentials:'omit',redirect:'error',signal:combined,
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:models(c,'image')[0],input:{messages:[{role:'user',content:[{text:`Primary maths concept illustration, clean black line drawing on white, printable, no shading, no text or numerals, no answers. Illustrate context only, not exact quantities or geometric measurements. ${prompt}`}]}]},parameters:{size:'1328*1328',n:1,prompt_extend:false,watermark:false}})
  });
  if (!response.ok) throw fail(`插圖服務未完成（HTTP ${response.status}），文字題目已保留。`,'image_error');
  const result = await response.json(), url = result.output?.choices?.[0]?.message?.content?.find(c => c.image)?.image;
  let parsed; try { parsed = new URL(url); } catch { throw fail('插圖服務沒有回傳圖片。'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/(?:^|\.)(?:aliyuncs\.com|alicdn\.com)$/.test(parsed.hostname)) throw fail('插圖來源未能確認。');
  const download = await transport(url,{mode:'cors',credentials:'omit',redirect:'error',signal:combined});
  if (!download.ok) throw fail('插圖下載失敗，文字題目已保留。');
  const blob = await download.blob();
  if (blob.size > 10000000 || !/^image\/(png|jpeg)$/.test(blob.type)) throw fail('插圖格式或大小不支援。');
  const data = await new Promise((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(blob); });
  return cropPicture(data);
}
