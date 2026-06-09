#!/usr/bin/env node
/**
 * tools/diff-pdf-vs-md.mjs
 *
 * Cortex eyes — uporedi ParsedModel kada isti GDD dođe kao PDF i kao MD.
 *
 * Cilj: precizno identifikovati koja polja PDF parser gubi u odnosu na native
 * MD parser. Boki spec: *"pogledaj kada uibacis pdf i kada ubacis md fajlove
 * iste igre koje su razlike, a ima ih ne cita se svew iz pdfa"*.
 *
 * Pokretanje:
 *   node tools/diff-pdf-vs-md.mjs <md-path> <pdf-path>
 *   (default fixture pair = Gates of Olympus 1000)
 *
 * Output:
 *   1. Both parsed models, full JSON
 *   2. Polje-po-polje diff table (✅ match / ⚠️ differ / ❌ PDF missing)
 *   3. Loss summary — koja % polja je izgubljeno u PDF putu
 *   4. Exit 0 = parity, 1 = drift detected
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');

const argv = process.argv.slice(2);
/* 2026-06-09 — rule_gdd_folder_desktop: prefer ~/Desktop/GDD/. */
const _HOME = process.env.HOME;
function _findGdd(filename) {
  const newP = `${_HOME}/Desktop/GDD/${filename}`;
  const oldP = `${_HOME}/Desktop/${filename}`;
  return existsSync(newP) ? newP : oldP;
}
const MD_PATH  = argv[0] || _findGdd('Gates_of_Olympus_1000_GDD.md');
const PDF_PATH = argv[1] || _findGdd('Gates_of_Olympus_1000_GDD.pdf');

if (!existsSync(MD_PATH))  { console.error(`❌ MD not found: ${MD_PATH}`);  process.exit(2); }
if (!existsSync(PDF_PATH)) { console.error(`❌ PDF not found: ${PDF_PATH}`); process.exit(2); }

const bar = (ch = '─', n = 78) => ch.repeat(n);

/* ── 1. Parse MD natively ──────────────────────────────────────── */
const mdText = readFileSync(MD_PATH, 'utf-8');
const mdModel = parseGDD(mdText, 'md');

/* ── 2. Parse PDF: extract text → pdfTextToMarkdown → parseGDD ─── */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfBuf = readFileSync(PDF_PATH);
const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf), useSystemFonts: true }).promise;
let pdfRaw = '';
for (let p = 1; p <= pdfDoc.numPages; p++) {
  const page = await pdfDoc.getPage(p);
  const tc = await page.getTextContent();
  const pageText = tc.items.map(i => ('str' in i ? i.str : '')).join(' ');
  pdfRaw += pageText + '\n\n';
}
const pdfMd = pdfTextToMarkdown(pdfRaw);
const pdfModel = parseGDD(pdfMd, 'md');

/* ── 3. Dump intermediate artifacts for inspection ─────────────── */
writeFileSync(resolve(REPO, 'tools/_diff-pdf-raw.txt'),  pdfRaw);
writeFileSync(resolve(REPO, 'tools/_diff-pdf-md.md'),    pdfMd);
writeFileSync(resolve(REPO, 'tools/_diff-md-model.json'),  JSON.stringify(mdModel,  null, 2));
writeFileSync(resolve(REPO, 'tools/_diff-pdf-model.json'), JSON.stringify(pdfModel, null, 2));

/* ── 4. Build field-by-field diff ──────────────────────────────── */
const fields = [
  ['name',                    m => m.name],
  ['theme.tags',              m => m.theme.tags.join(', ')],
  ['theme.mood',              m => m.theme.mood],
  ['theme.setting',           m => m.theme.setting],
  ['theme.genre',             m => m.theme.genre],
  ['theme.target_market',     m => m.theme.target_market],
  ['theme.palette',           m => (m.theme.palette || []).join(' ')],
  ['theme.typography',        m => m.theme.typography],
  ['theme.vibe_refs',         m => m.theme.vibe_refs],
  ['topology.reels',          m => m.topology.reels],
  ['topology.rows',           m => m.topology.rows],
  ['topology.evaluation',     m => m.topology.evaluation],
  ['topology.paylines',       m => m.topology.paylines],
  ['topology.rtp',            m => m.topology?.rtp],
  ['topology.maxWin',         m => m.topology?.maxWin],
  ['topology.volatility',     m => m.topology?.volatility],
  ['topology.hitFrequency',   m => m.topology?.hitFrequency],
  ['symbols.high.count',      m => m.symbols.high.length],
  ['symbols.high.ids',        m => m.symbols.high.map(s => s.id).join(',')],
  ['symbols.mid.count',       m => m.symbols.mid.length],
  ['symbols.low.count',       m => m.symbols.low.length],
  ['symbols.low.ids',         m => m.symbols.low.map(s => s.id).join(',')],
  ['symbols.specials.count',  m => m.symbols.specials.length],
  ['symbols.specials.ids',    m => m.symbols.specials.map(s => s.id).join(',')],
  ['features.count',          m => m.features.length],
  ['features.kinds',          m => m.features.map(f => f.kind).sort().join(',')],
  ['confidence.name',         m => m.confidence.name.toFixed(2)],
  ['confidence.topology',     m => m.confidence.topology.toFixed(2)],
  ['confidence.symbols',      m => m.confidence.symbols.toFixed(2)],
  ['confidence.features',     m => m.confidence.features.toFixed(2)],
];

const rows = fields.map(([label, get]) => {
  let mdv, pdfv;
  try { mdv = get(mdModel); } catch { mdv = undefined; }
  try { pdfv = get(pdfModel); } catch { pdfv = undefined; }
  const mdStr  = mdv  === undefined || mdv === null  || mdv === '' ? '—' : String(mdv);
  const pdfStr = pdfv === undefined || pdfv === null || pdfv === '' ? '—' : String(pdfv);
  let verdict;
  if (mdStr === pdfStr)                          verdict = '✅';
  else if (mdStr !== '—' && pdfStr === '—')      verdict = '❌ PDF missing';
  else                                           verdict = '⚠️  drift';
  return { label, mdStr, pdfStr, verdict };
});

/* ── 5. Render report ──────────────────────────────────────────── */
console.log(bar('═'));
console.log(`🔬 CORTEX EYES — PDF vs MD parity diff`);
console.log(`MD  : ${MD_PATH}`);
console.log(`PDF : ${PDF_PATH}`);
console.log(bar('═'));

const padLabel = Math.max(...rows.map(r => r.label.length));
const padMd    = Math.min(40, Math.max(...rows.map(r => r.mdStr.length)));
const padPdf   = Math.min(40, Math.max(...rows.map(r => r.pdfStr.length)));
const truncate = (s, n) => s.length <= n ? s.padEnd(n) : s.slice(0, n - 1) + '…';

console.log(`${'FIELD'.padEnd(padLabel)}  ${'MD →'.padEnd(padMd)}  ${'PDF →'.padEnd(padPdf)}  VERDICT`);
console.log(`${'─'.repeat(padLabel)}  ${'─'.repeat(padMd)}  ${'─'.repeat(padPdf)}  ${'─'.repeat(16)}`);
for (const r of rows) {
  console.log(`${r.label.padEnd(padLabel)}  ${truncate(r.mdStr, padMd)}  ${truncate(r.pdfStr, padPdf)}  ${r.verdict}`);
}

const matches  = rows.filter(r => r.verdict === '✅').length;
const drifts   = rows.filter(r => r.verdict.startsWith('⚠️')).length;
const missing  = rows.filter(r => r.verdict.startsWith('❌')).length;
const parityPct = (matches / rows.length * 100).toFixed(1);

console.log(bar('═'));
console.log(`SUMMARY: ${matches}/${rows.length} match (${parityPct}%) · ${drifts} drift · ${missing} missing`);
console.log(`Artifacts written to tools/_diff-*.{txt,md,json}`);
console.log(bar('═'));

process.exit(drifts + missing === 0 ? 0 : 1);
