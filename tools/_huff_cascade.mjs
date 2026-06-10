import { readFileSync } from 'node:fs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const buf = readFileSync(process.env.HOME + '/Desktop/GDD/Huff_N_More_Puff_GDD.pdf');
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
let raw = '';
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const tc = await p.getTextContent();
  raw += tc.items.map(it => it.str).join(' ') + '\n';
}
console.log('=== POMENI cascade / tumble / respin / lock u Huff GDD ===\n');
const lines = raw.split('\n');
const hits = [];
lines.forEach((ln, i) => {
  if (/cascade|tumble|respin|hold.{0,3}win|lock.?in|money.{0,3}sym|coin|sticky/i.test(ln)) {
    hits.push({ i, ln: ln.trim() });
  }
});
hits.slice(0, 40).forEach(h => console.log(`L${h.i}: ${h.ln.slice(0, 200)}`));
