#!/usr/bin/env node
/**
 * tools/_gdd-fleet-to-pdf.mjs
 *
 * Boki imperativ: "nazovi PDF GDD-ove po featurima koje imaju, da znam
 * sta gledam." Convert every MD in `tools/_qa/ultimate-fixtures/` →
 * a polished A4 PDF under `~/Desktop/GDD/synthetic/`.
 *
 * Pipeline per file:
 *   1. pandoc <md> -t html5 --standalone → /tmp/_gdd_pdf/<base>.html
 *   2. Playwright headless Chromium loads HTML + injects print CSS
 *      (deep navy / gold theme matching the WoO PDF style)
 *   3. page.pdf({ format: 'A4', printBackground: true }) → ~/Desktop/GDD/synthetic/<feature_encoded>.pdf
 *
 * Filename: each MD already carries the feature-encoded slug
 * (NNN__GRID__Feat1_Feat2_Feat3[_+N].md). Strip `.md`, swap for `.pdf`.
 *
 * Parallelism: 4 concurrent page contexts inside one browser.
 *
 * Pre-clean: removes every existing PDF under ~/Desktop/GDD/synthetic/
 * before regenerating so stale names don't accumulate.
 */

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync,
         unlinkSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const FIXTURES = resolve(REPO, 'tools/_qa/ultimate-fixtures');
const HOME = process.env.HOME;
const OUT_DIR = `${HOME}/Desktop/GDD/synthetic`;
const TMP_DIR = '/tmp/_gdd_pdf';

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

/* Pre-clean stale PDFs */
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith('.pdf')) {
    try { unlinkSync(resolve(OUT_DIR, f)); } catch (_) {}
  }
}

const mds = readdirSync(FIXTURES)
  .filter(f => f.endsWith('.md'))
  .sort();

console.log(`\n📄 Fleet-to-PDF: ${mds.length} MD fixtures → ${OUT_DIR}\n`);

const PRINT_CSS = `
<style>
  @page { size: A4; margin: 18mm 14mm; }
  body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; max-width: none; margin: 0; padding: 0; }
  h1 { font-size: 22pt; color: #0d1437; border-bottom: 3px solid #c9a227; padding-bottom: 0.3em; margin-top: 1.4em; page-break-after: avoid; }
  h2 { font-size: 16pt; color: #0d1437; border-bottom: 1.5px solid #c9a227; padding-bottom: 0.2em; margin-top: 1.6em; page-break-after: avoid; }
  h3 { font-size: 13pt; color: #1c2a5e; margin-top: 1.2em; page-break-after: avoid; }
  h4 { font-size: 11pt; color: #2a3a7a; margin-top: 0.9em; page-break-after: avoid; }
  p, ul, ol { margin: 0.45em 0; }
  code { background: #f3f3f6; padding: 1px 4px; border-radius: 3px; font-family: "SF Mono", "Menlo", Consolas, monospace; font-size: 9.5pt; color: #1c2a5e; }
  pre { background: #0d1437; color: #f6f1d6; padding: 10px 14px; border-radius: 6px; font-size: 8.8pt; line-height: 1.35; overflow: visible; page-break-inside: avoid; }
  pre code { background: transparent; color: inherit; padding: 0; font-size: 8.8pt; }
  table { border-collapse: collapse; width: 100%; margin: 0.5em 0 0.8em; page-break-inside: avoid; }
  th { background: #0d1437; color: #f6f1d6; text-align: left; padding: 5px 8px; font-size: 9.5pt; }
  td { border: 1px solid #d6d6d6; padding: 4px 8px; font-size: 9.5pt; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f6ee; }
  strong { color: #0d1437; }
  blockquote { border-left: 3px solid #c9a227; background: #faf6e6; padding: 6px 12px; margin: 0.6em 0; font-style: italic; color: #4a4a4a; page-break-inside: avoid; }
  hr { border: 0; border-top: 1px dashed #c9a227; margin: 1.4em 0; }
  a { color: #1c2a5e; text-decoration: none; }
  body > h1:first-of-type { font-size: 28pt; text-align: center; margin-top: 24mm; border: none; }
</style>
`;

/* ── MD → HTML via pandoc ────────────────────────────────────────── */
function pandocToHtml(mdPath, htmlPath) {
  const r = spawnSync('pandoc', [
    mdPath, '-t', 'html5', '--standalone',
    '-o', htmlPath,
  ], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`pandoc failed: ${r.stderr || r.stdout}`);
  }
}

/* Inject print CSS into the pandoc-produced HTML before Chromium PDFs it. */
function injectPrintCss(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const styled = html.includes('</head>')
    ? html.replace('</head>', PRINT_CSS + '</head>')
    : PRINT_CSS + html;
  writeFileSync(htmlPath, styled, 'utf8');
}

/* ── Concurrency pool ────────────────────────────────────────────── */
async function runPool(items, worker, concurrency = 4) {
  const out = [];
  let i = 0;
  const errors = [];
  async function take() {
    while (i < items.length) {
      const myIdx = i++;
      try {
        const r = await worker(items[myIdx], myIdx);
        out[myIdx] = r;
      } catch (e) {
        errors.push({ idx: myIdx, item: items[myIdx], error: String(e) });
        out[myIdx] = { error: String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => take()));
  return { out, errors };
}

/* ── Per-MD job ───────────────────────────────────────────────────── */
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });

let processed = 0;
const T0 = Date.now();
const warned = [];

async function processOne(mdName) {
  const base = mdName.replace(/\.md$/, '');
  const mdPath = resolve(FIXTURES, mdName);
  const htmlPath = resolve(TMP_DIR, `${base}.html`);
  const pdfPath = resolve(OUT_DIR, `${base}.pdf`);
  try {
    pandocToHtml(mdPath, htmlPath);
  } catch (e) {
    warned.push({ md: mdName, err: e.message });
    return { ok: false, mdName, error: e.message };
  }
  injectPrintCss(htmlPath);

  const page = await ctx.newPage();
  try {
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      preferCSSPageSize: true,
    });
  } finally {
    await page.close().catch(() => {});
  }
  processed++;
  if (processed % 25 === 0) {
    const elapsed = ((Date.now() - T0) / 1000).toFixed(1);
    console.log(`  ▶ ${processed}/${mds.length}  (${elapsed}s)`);
  }
  return { ok: true, mdName, pdfPath };
}

const { out, errors } = await runPool(mds, processOne, 4);
await browser.close();

const pdfs = readdirSync(OUT_DIR).filter(f => f.endsWith('.pdf')).sort();
console.log(`\n✓ ${pdfs.length} PDFs written  (~${((Date.now() - T0) / 1000).toFixed(1)}s total)`);
console.log(`\nSample filenames:`);
for (const f of pdfs.slice(0, 6)) console.log(`  • ${f}`);
if (warned.length) {
  console.log(`\n⚠️ ${warned.length} pandoc warnings:`);
  for (const w of warned.slice(0, 5)) console.log(`  · ${w.md}: ${w.err.slice(0, 100)}`);
}
if (errors.length) {
  console.log(`\n❌ ${errors.length} hard errors:`);
  for (const e of errors.slice(0, 5)) console.log(`  · ${e.item}: ${e.error.slice(0, 100)}`);
}
process.exit(errors.length ? 1 : 0);
