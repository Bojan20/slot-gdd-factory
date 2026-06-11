#!/usr/bin/env node
/**
 * tools/_md-to-pdf-gdd.mjs
 *
 * Boki imperative (2026-06-11): "izanaliziraj dobro igru i ispravi gdd
 * a onda ispravi na osnovu gdd-a ceo grid". For each of the 4 main
 * GDDs in ~/Desktop/GDD/, regenerate the PDF from the comprehensive
 * samples/<NAME>_GAME_GDD.md so the PDF parser extracts the same
 * structured tables (topology, symbols, features) the MD parser does.
 *
 * Why: the original PDFs were free-prose and missing topology/symbol
 * tables, so pdfjs text-extraction stripped them to text snippets the
 * regex parser couldn't classify (resulting in HP=0 MP=0 LP=0 SP=2 on
 * WoO and lock_respin 5×4 inferred from H&W feature). Replacing them
 * with PDFs rendered from the structured MDs gives the PDF parser the
 * same authoritative data.
 *
 * Pipeline per file:
 *   1. Read samples/<NAME>_GAME_GDD.md
 *   2. Lightweight MD → HTML converter (tables / headings / lists)
 *   3. Inject A4 print CSS (deep navy / gold theme matching prior PDFs)
 *   4. Playwright headless Chromium page.pdf({format:'A4'})
 *   5. Output ~/Desktop/GDD/<Name>_GDD.pdf
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const GDD  = `${process.env.HOME}/Desktop/GDD`;

const FIXTURES = [
  { md: `${REPO}/samples/WRATH_OF_OLYMPUS_GAME_GDD.md`,    pdf: `${GDD}/Wrath_of_Olympus_GDD.pdf` },
  { md: `${REPO}/samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md`, pdf: `${GDD}/Gates_of_Olympus_1000_GDD.pdf` },
];

/** Pure-vanilla MD → HTML covering exactly the syntax we use in GDDs:
 *  H1-H4 / tables / paragraphs / `code` / **bold** / *italic* / bullet
 *  lists / blockquotes / horizontal rules. No external deps needed. */
function mdToHtml(md) {
  const lines = md.split('\n');
  let out = '';
  let inTable = false, tableRows = [];
  let inList = false;
  let inCode = false;
  const flushTable = () => {
    if (!tableRows.length) return;
    const [header, sep, ...body] = tableRows;
    const cells = (row) => row.split('|').slice(1, -1).map(c => c.trim());
    const head = cells(header).map(c => `<th>${inline(c)}</th>`).join('');
    const rowsHtml = body.map(r => '<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('');
    out += `<table><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table>\n`;
    tableRows = [];
  };
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  for (const raw of lines) {
    const line = raw;
    if (line.startsWith('```')) {
      if (inCode) { out += '</code></pre>\n'; inCode = false; }
      else { out += '<pre><code>'; inCode = true; }
      continue;
    }
    if (inCode) { out += line.replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch])) + '\n'; continue; }
    if (/^\s*\|/.test(line)) {
      if (!inTable) { inTable = true; tableRows = []; }
      tableRows.push(line.trim());
      continue;
    } else if (inTable) { flushTable(); inTable = false; }
    if (inList && !/^\s*[-*+]\s+/.test(line)) { out += '</ul>\n'; inList = false; }
    if (/^\s*[-*+]\s+/.test(line)) {
      if (!inList) { out += '<ul>\n'; inList = true; }
      out += `<li>${inline(line.replace(/^\s*[-*+]\s+/, ''))}</li>\n`;
      continue;
    }
    let m;
    if ((m = line.match(/^####\s+(.+)/))) out += `<h4>${inline(m[1])}</h4>\n`;
    else if ((m = line.match(/^###\s+(.+)/))) out += `<h3>${inline(m[1])}</h3>\n`;
    else if ((m = line.match(/^##\s+(.+)/))) out += `<h2>${inline(m[1])}</h2>\n`;
    else if ((m = line.match(/^#\s+(.+)/))) out += `<h1>${inline(m[1])}</h1>\n`;
    else if (/^---+\s*$/.test(line)) out += '<hr/>\n';
    else if ((m = line.match(/^>\s*(.*)/))) out += `<blockquote>${inline(m[1])}</blockquote>\n`;
    else if (line.trim() === '') out += '\n';
    else out += `<p>${inline(line)}</p>\n`;
  }
  if (inTable) flushTable();
  if (inList) out += '</ul>\n';
  if (inCode) out += '</code></pre>\n';
  return out;
}

const printCSS = `
@page { size: A4; margin: 18mm 15mm 18mm 15mm; }
body { font: 10pt/1.45 -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
       background: #0a0e1c; color: #e5e9f0; padding: 0; margin: 0; }
h1, h2, h3, h4 { font-weight: 700; line-height: 1.2; color: #ffd700; }
h1 { font-size: 22pt; margin: 0 0 8pt 0; border-bottom: 1px solid #2c3651; padding-bottom: 6pt; }
h2 { font-size: 16pt; margin: 16pt 0 6pt 0; color: #f8c54a; }
h3 { font-size: 13pt; margin: 12pt 0 4pt 0; color: #f0c75e; }
h4 { font-size: 11pt; margin: 8pt 0 2pt 0; color: #ddd; }
p  { margin: 4pt 0; }
ul { margin: 4pt 0 4pt 18pt; padding: 0; }
li { margin: 1pt 0; }
blockquote { margin: 6pt 0; padding: 4pt 8pt; border-left: 3px solid #3df0ff; color: #c9d1e0; }
hr { border: none; border-top: 1px solid #2c3651; margin: 10pt 0; }
code { background: #16213a; color: #fce184; padding: 0 3pt; border-radius: 2pt; font-size: 9pt; }
pre { background: #16213a; color: #e9eef6; padding: 6pt 8pt; border-radius: 3pt; overflow: auto;
      font-size: 8.5pt; line-height: 1.35; }
pre.gdd-source { background: transparent; color: #d8e1ee; font: 9pt/1.42 "SF Mono", Menlo,
                 "Courier New", monospace; padding: 0; white-space: pre-wrap; word-wrap: break-word; }
pre code { background: transparent; padding: 0; }
table { border-collapse: collapse; margin: 6pt 0 8pt 0; width: 100%; font-size: 9pt;
        page-break-inside: avoid; }
th, td { border: 1px solid #2c3651; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #16213a; color: #f0c75e; font-weight: 700; }
tr:nth-child(even) td { background: #0d1226; }
strong { color: #ffd166; }
em { color: #b8d4ff; }
`;

const browser = await chromium.launch();
for (const fx of FIXTURES) {
  console.log('  →', fx.pdf);
  const md = readFileSync(fx.md, 'utf-8');
  /* 2026-06-11 Wave AL-3 (Boki WoO audit): render the LITERAL markdown
   * source in a styled <pre> block so PDF.js extraction recovers the
   * `##` / `###` / pipe-table markers verbatim. The parser's
   * `looksLikeMd` gate (≥ 3 `## `-prefixed headers) then passes and the
   * MD parser runs natively over the PDF-extracted text, recovering
   * symbol tables / topology / feature mix at full fidelity. Single
   * rendering (no separate HTML view) — avoids the double-detection bug
   * where the parser counted symbols once from the HTML-rendered table
   * AND once from the raw MD block. The styled <pre> still presents
   * as a readable structured document on screen / print. */
  const mdEscaped = md.replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch]));
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${fx.pdf.split('/').pop()}</title><style>${printCSS}</style></head>
<body><pre class="gdd-source">${mdEscaped}</pre></body></html>`;
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: fx.pdf, format: 'A4', printBackground: true,
                   margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' } });
  await page.close();
  console.log('     OK');
}
await browser.close();
console.log('Done.');
