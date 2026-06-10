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
// Show ANY hit on the 3 keywords plus 80 char of context
['cascade','tumble','sweep','tumbl','casc'].forEach(kw => {
  const re = new RegExp(kw, 'gi');
  let m, hits = 0;
  while ((m = re.exec(raw)) && hits < 5) {
    const s = Math.max(0, m.index - 60);
    const e = Math.min(raw.length, m.index + 100);
    console.log(`[${kw}] ...${raw.slice(s, e).replace(/\s+/g,' ')}...`);
    hits++;
  }
  if (hits === 0) console.log(`[${kw}] NO HIT`);
});
