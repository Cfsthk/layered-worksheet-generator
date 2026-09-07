import WordOleExtractor from 'word-extractor/lib/word-ole-extractor.js';
import BufferReader from 'word-extractor/lib/buffer-reader.js';
import OleCompoundDoc from 'word-extractor/lib/ole-compound-doc.js';
import { Buffer } from 'buffer';

self.onmessage = async ({ data }) => {
  try {
    const extractor = new WordOleExtractor();
    const reader = new BufferReader(Buffer.from(data));
    const doc = await extractor.extract(reader);
    const compound = await new OleCompoundDoc(reader).read();
    const streams = [];
    // Reassemble OLE sectors before locating embedded raster pictures.
    for (const name of ['Data', '0Table', '1Table', 'WordDocument']) {
      const bytes = await extractor.streamBuffer(compound.stream(name));
      if (bytes.length) streams.push(new Uint8Array(bytes));
    }
    self.postMessage({ text: [doc.getBody({ filterUnicode: false }), doc.getTextboxes(), doc.getHeaders(), doc.getFootnotes(), doc.getEndnotes()].filter(Boolean).join('\n'), streams });
  } catch { self.postMessage({ error: '這份 DOC 文件受保護、損壞或版本不支援。請用 Word 另存為 DOCX 後重試。' }); }
};
