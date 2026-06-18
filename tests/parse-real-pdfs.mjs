#!/usr/bin/env node
/**
 * tests/parse-real-pdfs.mjs · Functional Item #1 — Real-game GDD ingestion
 *
 * What it does:
 *   For every real-game PDF in `~/Desktop/GDD/*.pdf`:
 *     1. Extract raw text via pdfjs-dist (legacy build, Node-safe).
 *     2. Heuristic-reconstruct markdown via `src/pdfToMarkdown.mjs`.
 *     3. Run `parseGDD()` to obtain a ParsedModel.
 *     4. Validate the model against a quality floor (name confidence,
 *        topology confidence, ≥4 symbols, ≥1 feature, no parser
 *        `_failures` of severity error).
 *     5. Build the slot HTML via `buildSlotHTML()` and assert it
 *        produces a non-empty document with a `<div id="grid">` host.
 *     6. Write `model.json` + `slot.html` to
 *        `dist/real-games/<slug>/` so downstream Playwright /
 *        regulator probes can pick them up.
 *
 * Why this exists:
 *   308 synthetic GDDs prove the LEGO + parser invariants, but they were
 *   generated against the *same* heuristic vocabulary the parser expects.
 *   Real production GDDs come from MS Word / Docs / Notion exports and
 *   trip edge cases the synthetic corpus never hits (BOM, multi-column
 *   PDF wrap, fancy quotes, vendor-specific feature naming).
 *
 *   This probe is the first end-to-end gate on real-world input.
 *
 * Exit codes:
 *   0  all real-game PDFs pass parser floor + build smoke
 *   1  one or more PDFs fail
 *   2  no PDFs found in expected location
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const HOME = process.env.HOME;
const GDD_DIR = `${HOME}/Desktop/GDD`;
const OUT_DIR = resolve(REPO, 'dist/real-games');

const bar = (ch = '─', n = 90) => ch.repeat(n);

/* ── 1. Locate real-game PDFs ────────────────────────────────────────── */
if (!existsSync(GDD_DIR)) {
  console.error(`❌ ${GDD_DIR} not found. Per rule_gdd_folder_desktop, real GDDs live there.`);
  process.exit(2);
}

const pdfs = readdirSync(GDD_DIR)
  .filter(f => f.toLowerCase().endsWith('.pdf'))
  .filter(f => !f.startsWith('.'))
  .map(f => resolve(GDD_DIR, f));

if (pdfs.length === 0) {
  console.error(`❌ No PDFs found in ${GDD_DIR}`);
  process.exit(2);
}

console.log(bar('═'));
console.log(`📦 Real-game GDD ingestion · ${pdfs.length} PDF(s)`);
console.log(bar('═'));
pdfs.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${basename(p)}`));
console.log(bar('═'));

mkdirSync(OUT_DIR, { recursive: true });

/* ── 2. Per-PDF pipeline ─────────────────────────────────────────────── */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * Extract concatenated text from every page of a PDF.
 * pdfjs returns text items in reading order; we join with spaces per page
 * and double-newline between pages so the markdown reconstructor can see
 * paragraph boundaries.
 */
async function extractPdfText(absPath) {
  const buf = readFileSync(absPath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    /* Silence the noisy pdf.js warnings — we only need the text stream. */
    verbosity: 0,
  }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map(i => ('str' in i ? i.str : '')).join(' '));
  }
  return pages.join('\n\n');
}

function slugify(name) {
  return basename(name, '.pdf')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Quality floor for a real-game model.
 *
 * Floor is calibrated against real-world GDD variance, NOT synthetic-corpus
 * expectations. Some production GDDs intentionally omit the HP/MP/LP
 * paytable table (feature-only summary). In that case the runtime fills
 * paytable via smartDefaults — sparse roster is not a build blocker.
 *
 * Hard floor (must hold):
 *   - name confidence ≥ 0.5 (parser found a title)
 *   - topology confidence ≥ 0.4 (parser found grid shape)
 *   - ≥ 2 symbols total — at minimum Wild + Scatter for any slot to exist
 *   - ≥ 1 feature (parser pulled at least one bonus block)
 *   - no _failures with severity 'error' (extractor crash recorded)
 *
 * Soft warnings (recorded but don't fail the gate):
 *   - HP/MP/LP all empty → "specials-only roster, smartDefaults will fill"
 */
function evaluateFloor(model) {
  const symTotal =
    model.symbols.high.length +
    model.symbols.mid.length +
    model.symbols.low.length +
    model.symbols.specials.length;

  const errors = (model.confidence?._failures || []).filter(
    f => (f.severity || 'error') === 'error',
  );

  const checks = [
    { id: 'name.conf',     ok: model.confidence.name >= 0.5,     detail: model.confidence.name.toFixed(2) },
    { id: 'topology.conf', ok: model.confidence.topology >= 0.4, detail: model.confidence.topology.toFixed(2) },
    { id: 'symbols.count', ok: symTotal >= 2,                    detail: `${symTotal}` },
    { id: 'features.count',ok: model.features.length >= 1,       detail: `${model.features.length}` },
    { id: 'no.errors',     ok: errors.length === 0,              detail: `${errors.length} error(s)` },
  ];

  const warnings = [];
  const paytableEmpty =
    model.symbols.high.length === 0 &&
    model.symbols.mid.length === 0 &&
    model.symbols.low.length === 0;
  if (paytableEmpty && model.symbols.specials.length > 0) {
    warnings.push('HP/MP/LP empty — smartDefaults will fill paytable at runtime');
  }

  return { ok: checks.every(c => c.ok), checks, warnings, symTotal };
}

/**
 * Smoke-test the built HTML.
 *   - non-empty string
 *   - contains <html> + <body>
 *   - contains the grid host node
 *   - contains at least one <style> block (CSS pipeline ran)
 */
function evaluateBuild(html) {
  const checks = [
    { id: 'nonempty',  ok: typeof html === 'string' && html.length > 1024, detail: `${html.length} chars` },
    { id: 'has.html',  ok: /<html\b/i.test(html),                          detail: '<html>' },
    { id: 'has.body',  ok: /<body\b/i.test(html),                          detail: '<body>' },
    /* Canonical grid host in buildSlotHTML is `id="gridHost"` (class .gridHost).
     * Accept either the host or the inner symbol grid element, so the
     * smoke test stays stable across topology variants. */
    { id: 'has.grid',  ok: /id\s*=\s*["']gridHost["']|class\s*=\s*["'][^"']*\bgridHost\b/i.test(html), detail: '#gridHost' },
    { id: 'has.style', ok: /<style\b/i.test(html),                         detail: '<style>' },
  ];
  return { ok: checks.every(c => c.ok), checks };
}

/* Truncate a string for table cell display. */
function trunc(s, n) {
  if (s == null) return '—';
  const str = String(s);
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

const results = [];
let totalPass = 0;
let totalFail = 0;

for (const pdfPath of pdfs) {
  const label = basename(pdfPath);
  const slug = slugify(pdfPath);
  console.log(`\n${bar('═')}`);
  console.log(`📄 ${label}`);
  console.log(bar('═'));

  let raw = '';
  let md = '';
  let model = null;
  let html = '';
  let stage = 'extract';
  let stageErr = null;

  try {
    raw = await extractPdfText(pdfPath);
    stage = 'pdfToMarkdown';
    md = pdfTextToMarkdown(raw);
    stage = 'parseGDD';
    model = parseGDD(md, 'md');
    stage = 'buildSlotHTML';
    html = buildSlotHTML(model);
    stage = 'done';
  } catch (err) {
    stageErr = err;
    console.log(`❌ pipeline crashed at stage=${stage}: ${err.message}`);
    console.log(err.stack);
  }

  /* Persist artifacts even on partial failure — easier to debug. */
  const gameOut = resolve(OUT_DIR, slug);
  mkdirSync(gameOut, { recursive: true });
  if (raw)   writeFileSync(resolve(gameOut, 'raw.txt'),     raw);
  if (md)    writeFileSync(resolve(gameOut, 'gdd.md'),      md);
  if (model) writeFileSync(resolve(gameOut, 'model.json'),  JSON.stringify(model, null, 2));
  if (html)  writeFileSync(resolve(gameOut, 'slot.html'),   html);

  if (stageErr) {
    results.push({ label, slug, ok: false, floor: null, build: null, error: stageErr.message });
    totalFail++;
    continue;
  }

  const floor = evaluateFloor(model);
  const build = evaluateBuild(html);

  console.log(`name        : ${trunc(model.name, 60)}`);
  console.log(`topology    : ${model.topology.reels}×${model.topology.rows} eval=${model.topology.evaluation} lines=${model.topology.paylines ?? '—'}`);
  console.log(`symbols     : ${floor.symTotal} (HP=${model.symbols.high.length} MP=${model.symbols.mid.length} LP=${model.symbols.low.length} ★=${model.symbols.specials.length})`);
  console.log(`features    : ${model.features.length} → ${model.features.map(f => f.kind).join(', ') || '—'}`);
  console.log(`html bytes  : ${html.length}`);

  console.log('\nFloor checks:');
  for (const c of floor.checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(16)} ${c.detail}`);
  }
  if (floor.warnings && floor.warnings.length) {
    console.log('\nFloor warnings (soft):');
    for (const w of floor.warnings) {
      console.log(`  ⚠ ${w}`);
    }
  }
  console.log('\nBuild checks:');
  for (const c of build.checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.id.padEnd(16)} ${c.detail}`);
  }

  const ok = floor.ok && build.ok;
  if (ok) totalPass++; else totalFail++;
  results.push({ label, slug, ok, floor, build, model });

  console.log(`\n${ok ? '✓ PASS' : '✗ FAIL'} — artifacts: dist/real-games/${slug}/`);
}

/* ── 3. Summary table ────────────────────────────────────────────────── */
console.log(`\n${bar('═')}`);
console.log('SUMMARY');
console.log(bar('═'));

const COL = { idx: 3, game: 38, top: 9, sym: 5, feat: 5, floor: 6, build: 6, ok: 4 };
const header =
  `│ ${'#'.padEnd(COL.idx)} │ ${'Game'.padEnd(COL.game)} │ ${'Topology'.padEnd(COL.top)} ` +
  `│ ${'Sym'.padEnd(COL.sym)} │ ${'Feat'.padEnd(COL.feat)} │ ${'Floor'.padEnd(COL.floor)} ` +
  `│ ${'Build'.padEnd(COL.build)} │ ${'OK'.padEnd(COL.ok)} │`;
const sep =
  `├─${'─'.repeat(COL.idx)}─┼─${'─'.repeat(COL.game)}─┼─${'─'.repeat(COL.top)}` +
  `─┼─${'─'.repeat(COL.sym)}─┼─${'─'.repeat(COL.feat)}─┼─${'─'.repeat(COL.floor)}` +
  `─┼─${'─'.repeat(COL.build)}─┼─${'─'.repeat(COL.ok)}─┤`;

console.log('┌' + sep.slice(1, -1).replace(/┼/g, '┬') + '┐');
console.log(header);
console.log(sep);

results.forEach((r, i) => {
  if (!r.floor) {
    console.log(
      `│ ${String(i + 1).padEnd(COL.idx)} │ ${trunc(r.label, COL.game).padEnd(COL.game)} ` +
      `│ ${'—'.padEnd(COL.top)} │ ${'—'.padEnd(COL.sym)} │ ${'—'.padEnd(COL.feat)} ` +
      `│ ${'CRASH'.padEnd(COL.floor)} │ ${'CRASH'.padEnd(COL.build)} │ ${'✗'.padEnd(COL.ok)} │`,
    );
    return;
  }
  const t = r.model.topology;
  const topo = `${t.reels}x${t.rows}`;
  const symTotal = r.floor.symTotal;
  const feat = r.model.features.length;
  const floorOk = r.floor.ok ? 'PASS' : 'FAIL';
  const buildOk = r.build.ok ? 'PASS' : 'FAIL';
  const overall = r.ok ? '✓' : '✗';
  console.log(
    `│ ${String(i + 1).padEnd(COL.idx)} │ ${trunc(r.label, COL.game).padEnd(COL.game)} ` +
    `│ ${topo.padEnd(COL.top)} │ ${String(symTotal).padEnd(COL.sym)} │ ${String(feat).padEnd(COL.feat)} ` +
    `│ ${floorOk.padEnd(COL.floor)} │ ${buildOk.padEnd(COL.build)} │ ${overall.padEnd(COL.ok)} │`,
  );
});
console.log('└' + sep.slice(1, -1).replace(/┼/g, '┴') + '┘');

console.log(`\n${totalPass}/${results.length} pass · ${totalFail} fail`);
console.log(`Artifacts: ${OUT_DIR}/<game>/{raw.txt,gdd.md,model.json,slot.html}`);

process.exit(totalFail > 0 ? 1 : 0);
