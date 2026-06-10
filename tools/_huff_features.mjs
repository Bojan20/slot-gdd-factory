import { readFileSync } from 'node:fs';
import { parseMarkdownGDD } from '../src/parser.mjs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const PDF = process.env.HOME + '/Desktop/GDD/Huff_N_More_Puff_GDD.pdf';
const buf = readFileSync(PDF);
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
let text = '';
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const tc = await p.getTextContent();
  text += tc.items.map(it => it.str).join(' ') + '\n';
}
const md = pdfTextToMarkdown(text);
const m = parseMarkdownGDD(md);

console.log('=== HUFF & MORE PUFF — features po GDD-u ===\n');
console.log('Topology:', m.topology.shapeNote || m.topology.kind, '· evaluation:', m.topology.evaluation, '· paylines:', m.topology.paylines, '· ways:', m.topology.wayCount);
console.log('\nFeatures detected:');
(m.features || []).forEach(f => console.log('  ·', f.kind + (f.label ? ' ("'+f.label+'")' : '')));
console.log('\nFree Spins config:');
console.log('  enabled:', m.freeSpins?.enabled);
console.log('  triggerSymbol:', m.freeSpins?.triggerSymbol);
console.log('  spins ladder:', JSON.stringify(m.freeSpins?.spinsByTriggerCount || m.freeSpins?.spinsAward));
console.log('  retrigger:', JSON.stringify(m.freeSpins?.retrigger));
console.log('  multiplier:', JSON.stringify(m.freeSpins?.multiplier));
console.log('\nSymbols:');
console.log('  HP:', m.symbols.high.map(s => s.id+'='+s.name).join(', '));
console.log('  MP:', m.symbols.mid.map(s => s.id+'='+s.name).join(', '));
console.log('  LP:', m.symbols.low.map(s => s.id+'='+s.name).join(', '));
console.log('  ★:', m.symbols.specials.map(s => s.id+'='+s.name+(s.role?'('+s.role+')':'')).join(', '));
console.log('\nMechanics:');
console.log('  Hold & Win (lock_respin):', m.topology.mechanics?.lockRespin ? 'YES' : 'no');
console.log('  Cascade:', m.topology.mechanics?.cascade ? 'YES' : 'no');
console.log('  Twin reels:', m.topology.mechanics?.twinReels ? 'YES' : 'no');
console.log('  Mirrored:', m.topology.mechanics?.mirroredReels ? 'YES' : 'no');
console.log('\nBig Win Tier:', JSON.stringify(m.bigWinTier).slice(0,200));
console.log('Bonus Buy:', JSON.stringify(m.bonusBuy).slice(0,200));
console.log('Max Win Cap:', m.winCap?.maxWinX || '—');
