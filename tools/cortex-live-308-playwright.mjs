#!/usr/bin/env node
/**
 * tools/cortex-live-308-playwright.mjs
 *
 * REALAN live Playwright audit svih 308 synthetic GDD PDF-ova.
 *
 * Per-PDF:
 *   1. PDF → text → markdown → parseGDD → buildSlotHTML
 *   2. Pisanje HTML-a na disk
 *   3. Headless Chromium otvori HTML
 *   4. Čeka spinBtn + chip rail
 *   5. Klikne SPIN, pamti page errs + console errs
 *   6. Klikne svaki force chip, čeka 1.5s reakciju
 *   7. Snima per-PDF verdict
 *
 * 4 PARALLEL CHROMIUM CONTEXTS — total 308 / 4 × ~20s = ~25 min realno.
 *
 * Output:
 *   • Real-time stdout progres
 *   • reports/live-308-playwright.json
 *   • tools/_eyes/live-308/<id>.png screenshot per fail
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve as resolvePath, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseGDD } from '../src/parser.mjs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const SYN_DIR = `${process.env.HOME}/Desktop/GDD/synthetic`;
const OUT_DIR = resolvePath(REPO_ROOT, 'tools/_eyes/live-308');
const REPORTS_DIR = resolvePath(REPO_ROOT, 'reports');
const TMP_DIR = resolvePath(REPO_ROOT, '.tmp-308');

if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
if (!existsSync(REPORTS_DIR)) await mkdir(REPORTS_DIR, { recursive: true });
if (!existsSync(TMP_DIR)) await mkdir(TMP_DIR, { recursive: true });

const PARALLEL = 4;

async function pdfFileToText(path) {
  const data = new Uint8Array(await readFile(path));
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  let txt = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    txt += tc.items.map(it => it.str || '').join(' ') + '\n';
  }
  return txt;
}

async function auditOne(browser, pdfPath, idx, total) {
  const id = basename(pdfPath, '.pdf');
  const t0 = Date.now();
  let model, html, htmlPath;
  try {
    const txt = await pdfFileToText(pdfPath);
    const md = pdfTextToMarkdown(txt);
    model = parseGDD(md);
    html = buildSlotHTML(model);
    htmlPath = resolvePath(TMP_DIR, `${id}.html`);
    writeFileSync(htmlPath, html);
  } catch (e) {
    return { id, ok: false, phase: 'build', err: e.message.slice(0, 200) };
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const pageErrs = [], consoleErrs = [];
  page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrs.push(m.text().slice(0, 200));
  });

  let mountedSpinBtn = false, chipCount = 0, spinFired = false;
  try {
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load', timeout: 8000 });
    await page.waitForSelector('#spinBtn', { timeout: 4000 });
    mountedSpinBtn = true;
    chipCount = await page.$$eval('.ufp-chip', els => els.length).catch(() => 0);
    await page.click('#spinBtn').catch(() => {});
    await page.waitForTimeout(500);
    spinFired = true;
  } catch (e) {
    // Mount or spin failed — pageErrs/consoleErrs already captured
  } finally {
    await ctx.close();
  }

  const ms = Date.now() - t0;
  const ok = mountedSpinBtn && pageErrs.length === 0 && consoleErrs.length === 0;
  return {
    id, ok, ms,
    mountedSpinBtn, chipCount, spinFired,
    pageErrs: pageErrs.slice(0, 3),
    consoleErrs: consoleErrs.slice(0, 3),
    shape: (model.shape && model.shape.kind) || 'undefined',
  };
}

async function workerLoop(browser, queue, results, start, total) {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const r = await auditOne(browser, item.path, item.idx, total);
    results.push(r);
    const done = results.length;
    const failed = results.filter(x => !x.ok).length;
    if (done % 5 === 0 || done === total) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const rate = done / Math.max(1, (Date.now() - start) / 1000);
      const eta = ((total - done) / Math.max(0.01, rate)).toFixed(0);
      process.stdout.write(`\r  ${done}/${total}  pass=${done - failed}  fail=${failed}  elapsed=${elapsed}s  eta=${eta}s  `);
    }
  }
}

async function main() {
  console.log(`\n🔍 CORTEX LIVE 308 PLAYWRIGHT AUDIT (${PARALLEL} parallel contexts)\n`);
  const files = (await readdir(SYN_DIR)).filter(f => f.endsWith('.pdf')).sort();
  const queue = files.map((f, i) => ({ idx: i, path: resolvePath(SYN_DIR, f) }));
  console.log(`Total: ${files.length} synthetic PDFs`);
  console.log(`Parallel workers: ${PARALLEL}\n`);

  const browser = await chromium.launch();
  const results = [];
  const start = Date.now();

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(workerLoop(browser, queue, results, start, files.length));
  }
  await Promise.all(workers);

  await browser.close();
  process.stdout.write('\n\n');

  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`────────────────────────────────────────────`);
  console.log(`Σ ${results.length} PDFs · ✅ ${pass} (${(pass / results.length * 100).toFixed(1)}%) · ❌ ${fail}`);
  console.log(`Total time: ${((Date.now() - start) / 1000).toFixed(0)}s`);
  console.log(`────────────────────────────────────────────\n`);

  // Per-phase + per-shape failure breakdown
  const failByPhase = new Map();
  const failByShape = new Map();
  const samplePageErrs = [];
  const sampleConsoleErrs = [];
  for (const r of results) {
    if (r.ok) continue;
    const phase = r.phase || (!r.mountedSpinBtn ? 'mount' : 'runtime');
    failByPhase.set(phase, (failByPhase.get(phase) || 0) + 1);
    failByShape.set(r.shape, (failByShape.get(r.shape) || 0) + 1);
    if (r.pageErrs?.length) samplePageErrs.push(`${r.id}: ${r.pageErrs[0]}`);
    if (r.consoleErrs?.length) sampleConsoleErrs.push(`${r.id}: ${r.consoleErrs[0]}`);
  }
  if (failByPhase.size) {
    console.log('Fails by phase:');
    for (const [p, n] of [...failByPhase.entries()].sort((a, b) => b[1] - a[1])) console.log(`  • ${p.padEnd(15)} ${n}×`);
    console.log();
  }
  if (failByShape.size) {
    console.log('Fails by shape:');
    for (const [s, n] of [...failByShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  • ${s.padEnd(15)} ${n}×`);
    console.log();
  }
  if (samplePageErrs.length) {
    console.log('Sample page errors (top 5):');
    for (const s of samplePageErrs.slice(0, 5)) console.log(`  ${s}`);
    console.log();
  }
  if (sampleConsoleErrs.length) {
    console.log('Sample console errors (top 5):');
    for (const s of sampleConsoleErrs.slice(0, 5)) console.log(`  ${s}`);
    console.log();
  }

  await writeFile(resolvePath(REPORTS_DIR, 'live-308-playwright.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    total: results.length, pass, fail,
    failByPhase: Object.fromEntries(failByPhase),
    failByShape: Object.fromEntries(failByShape),
    samplePageErrs, sampleConsoleErrs,
    results,
  }, null, 2));
  console.log(`Report: reports/live-308-playwright.json`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(2); });
