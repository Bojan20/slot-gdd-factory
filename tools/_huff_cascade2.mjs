import { readFileSync } from 'node:fs';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const buf = readFileSync(process.env.HOME + '/Desktop/GDD/Huff_N_More_Puff_GDD.pdf');
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
let raw = '';
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const tc = await p.getTextContent();
  raw += tc.items.map(it => it.str).join(' ') + '\n';
}
const sents = raw.split(/[.!?]\s+|\n/);
console.log('=== Sentences with cascade/tumble in Huff GDD ===\n');
sents.forEach(s => {
  if (/cascade|tumble/i.test(s)) console.log('→ ' + s.trim().slice(0, 400));
});
