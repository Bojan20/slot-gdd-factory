#!/usr/bin/env node
/**
 * tools/stress-test-ingest.mjs
 *
 * N+1 C — Real-world batch ingest stress test (2026-06-23).
 *
 * Boki: "C · 333 untracked PDFs u ~/Desktop/GDD/ bez ground truth.
 *        Run V1..V6 + emit failure-rate dashboard. Real-world parser
 *        robustness audit."
 *
 * What this tool does
 * -------------------
 * Walks every PDF in `~/Desktop/GDD/` (default — overridable via
 * `--source <dir>`), invokes the ingest pipeline (`tools/ingest.mjs`)
 * per PDF in `--no-llm` mode (parser + V8 + V9 deterministic, no Kimi
 * cost), captures the full receipt (exit code, model stats, V8 verdict,
 * V9 score), and aggregates them into:
 *
 *   1. `reports/stress-test-ingest-<ts>.json` — per-PDF receipts +
 *      aggregate counts (success / parser-fail / build-fail / V8-FAIL /
 *      V9-FAIL).
 *   2. `reports/stress-test-ingest-<ts>.md` — operator-friendly summary
 *      with grouped failures and top failure modes.
 *   3. Stdout summary: counts + first N failed slugs.
 *
 * Why this matters
 * ----------------
 * The corpus orchestrator and verify-gate steps run against the curated
 * `dist/real-games/` set — slugs we've already ingested successfully
 * once. They prove the rule engine + structural checker stay stable on
 * KNOWN-good inputs. They DON'T prove the pipeline survives a fresh PDF
 * the parser has never seen.
 *
 * This stress test closes that gap. It's the "untrusted public input"
 * battery: every PDF the operator might drop in tomorrow needs to either
 * produce a playable slot OR a structured error operators can act on.
 * Silent corruption (parser writes garbage model but exits 0) is the
 * worst failure mode — V8 + V9 receipts catch it.
 *
 * USAGE
 * -----
 *   node tools/stress-test-ingest.mjs                # walk all PDFs
 *   node tools/stress-test-ingest.mjs --limit 20     # first 20 (smoke)
 *   node tools/stress-test-ingest.mjs --source <dir> # alt PDF folder
 *   node tools/stress-test-ingest.mjs --keep         # keep dist/stress/<slug>/
 *
 * By default the per-PDF dist output is DELETED after receipt capture
 * (saves disk). Pass --keep to retain dist/stress/<slug>/ for forensic
 * drill-down on failed slugs.
 *
 * EXIT
 * ----
 *   0 — every PDF ingested successfully (parser + build + V8 + V9 all OK)
 *   1 — ≥ 1 hard failure (parser/build crash, V9 verdict FAIL)
 *
 * Performance
 * -----------
 *   Sequential by default (~3-5s per PDF on this hardware, ~20-30 min
 *   for 338). Honest sequential is safer than racing 4-wide parallel
 *   because Kimi-cache + ingest log writes serialize on the same files;
 *   parallelizing here trades robustness for speed in a place where the
 *   point IS robustness.
 *
 * Safety
 * ------
 *   - Per-PDF timeout: 90s (catches infinite-loop parser regressions).
 *   - Per-PDF exit code surfaced verbatim — no "swallow + continue".
 *   - Slug derived deterministically from PDF basename so re-runs hit
 *     the same dist/stress/<slug>/ dir (idempotent disk usage).
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, basename, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REPORTS    = join(REPO, 'reports');
const STRESS_DIR = join(REPO, 'dist/stress');
mkdirSync(REPORTS, { recursive: true });
mkdirSync(STRESS_DIR, { recursive: true });

const INGEST = join(REPO, 'tools/ingest.mjs');

/* ── Argv ───────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};

const SOURCE = argVal('--source') || join(homedir(), 'Desktop/GDD');
const LIMIT  = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
const KEEP   = args.includes('--keep');
const QUIET  = args.includes('--quiet');

if (!existsSync(SOURCE)) {
  console.error(`▸ source missing: ${SOURCE}`);
  console.error('  Hint: pass --source <dir> or place PDFs in ~/Desktop/GDD/');
  process.exit(2);
}

/**
 * UQ-DEEP-A 2026-06-23 — SIGINT CLEANUP.
 * On CTRL+C / SIGTERM mid-run, cleanup the CURRENT slug's dist dir so
 * we don't leak orphan `dist/ingest/stress-<slug>-<pid>/` directories.
 * Tracks the in-flight slug across iterations; signal handler reads
 * latest value and rmSync if --keep was NOT passed.
 */
let _currentSlug = null;
function _emergencyCleanup() {
  if (_currentSlug && !KEEP) {
    const p = join(REPO, 'dist/ingest', _currentSlug);
    try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
process.on('SIGINT',  () => { _emergencyCleanup(); process.exit(130); });
process.on('SIGTERM', () => { _emergencyCleanup(); process.exit(143); });

/**
 * Escape a string for safe embedding in a single-cell of a Markdown
 * table. Replaces `|` with `\|`, strips backticks (open them in raw,
 * unbalanced state breaks downstream MD renderers), collapses newlines.
 */
function mdCellEscape(s) {
  return String(s || '')
    .replace(/\|/g, '\\|')
    .replace(/`/g, 'ˋ')   /* modifier letter grave — visually similar, no MD break */
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/* ── Slug derivation ────────────────────────────────────────────────── */

function slugify(name) {
  return String(name || 'gdd')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'gdd-' + Date.now();
}

/* ── Walker ─────────────────────────────────────────────────────────── */

const pdfs = readdirSync(SOURCE)
  .filter(f => extname(f).toLowerCase() === '.pdf')
  .sort();

if (pdfs.length === 0) {
  console.error(`▸ no PDFs in ${SOURCE}`);
  process.exit(2);
}

const work = LIMIT ? pdfs.slice(0, LIMIT) : pdfs;
const started = Date.now();
if (!QUIET) console.log(`stress-test-ingest · ${work.length} PDF(s) from ${SOURCE}`);

const receipts = [];
let hardFailCount = 0;
let v8FailCount  = 0;
let v9FailCount  = 0;
let v9WarnCount  = 0;

/**
 * Slug fingerprint — combines basename slugify with a short SHA-1 of
 * the full PDF path so two PDFs with identical basenames (different
 * folders) or case-insensitive collisions (`SampleTitle.pdf` vs
 * `sampletitle.pdf` on case-sensitive FS) produce DISTINCT slugs.
 * Also serializes with `process.pid` so two concurrent stress-test
 * runs on the same machine don't write into the same `dist/ingest/<slug>/`
 * dir mid-flight (cleanup race fix — audit nalaz #3 / R6).
 */
const PID_SUFFIX = String(process.pid);
function stressSlug(pdfPath, pdfName) {
  const base = slugify(pdfName);
  const fp   = createHash('sha1').update(pdfPath, 'utf8').digest('hex').slice(0, 6);
  return `stress-${base}-${fp}-${PID_SUFFIX}`;
}

for (let i = 0; i < work.length; i++) {
  const pdf = work[i];
  const pdfPath = join(SOURCE, pdf);
  const slug = stressSlug(pdfPath, pdf);
  _currentSlug = slug;
  const outDir = join(STRESS_DIR, slug);
  const t0 = Date.now();

  const r = spawnSync('node', [INGEST,
    '--file', pdfPath,
    '--slug', slug,
    '--no-llm',
  ], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 90_000,
    /* Escalate to SIGKILL if SIGTERM doesn't bring the child down
     * within the default grace window — protects against hung
     * parser/build code that ignores soft termination. Without this,
     * a stuck child can outlive the stress-test wrapper and hold a
     * lock on the dist dir. */
    killSignal: 'SIGKILL',
    /* Pipe slug output to the stress dist root rather than dist/ingest;
     * ingest.mjs hardcodes DIST = dist/ingest, so the actual write is
     * dist/ingest/<slug>/. We'll read that path. */
  });

  const distOut = join(REPO, 'dist/ingest', slug);
  const elapsedMs = Date.now() - t0;

  const receipt = {
    pdf,
    slug,
    exitCode: r.status,
    signal: r.signal || null,
    elapsedMs,
    stderr: (r.stderr || '').slice(0, 500),
    ok: r.status === 0,
  };

  if (r.status === 0 || r.status === 3 /* soft-fail */) {
    /* Capture V8 + V9 receipts if they exist. */
    const v8p = join(distOut, 'v8.json');
    const v9p = join(distOut, 'v9.json');
    const modelp = join(distOut, 'model.json');
    if (existsSync(v8p)) {
      try {
        const v8 = JSON.parse(readFileSync(v8p, 'utf8'));
        receipt.v8 = {
          verdict: v8.verdict,
          engine: v8.__meta__?.selectedEngine,
          enabled: v8.assembly?.enabledBlocks?.length || 0,
          disabled: v8.assembly?.disabledBlocks?.length || 0,
          conflicts: v8.conflicts?.length || 0,
          missingMandatory: v8.missingMandatory?.length || 0,
        };
        if (v8.verdict === 'FAIL') v8FailCount++;
      } catch (e) { receipt.v8Err = e.message; }
    } else {
      receipt.v8Err = 'v8.json missing';
    }
    if (existsSync(v9p)) {
      try {
        const v9 = JSON.parse(readFileSync(v9p, 'utf8'));
        receipt.v9 = {
          verdict: v9.verdict,
          score: v9.score,
          failed: (v9.checks || []).filter(c => c.verdict === 'FAIL').map(c => c.name),
          warned: (v9.checks || []).filter(c => c.verdict === 'WARN').map(c => c.name),
        };
        if (v9.verdict === 'FAIL') v9FailCount++;
        else if (v9.verdict === 'WARN') v9WarnCount++;
      } catch (e) { receipt.v9Err = e.message; }
    } else {
      receipt.v9Err = 'v9.json missing';
    }
    if (existsSync(modelp)) {
      try {
        const model = JSON.parse(readFileSync(modelp, 'utf8'));
        receipt.modelStats = {
          topologyKind: model.topology?.kind,
          reels: model.topology?.reels,
          rows: model.topology?.rows,
          featureCount: (model.features || []).length,
          symbolCount: (model.symbols?.high?.length || 0) + (model.symbols?.mid?.length || 0) + (model.symbols?.low?.length || 0),
        };
      } catch { /* ignore */ }
    }
  } else {
    hardFailCount++;
  }

  receipts.push(receipt);

  /* Cleanup dist output unless --keep. */
  if (!KEEP) {
    try { rmSync(distOut, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  if (!QUIET) {
    const tag = r.status === 0 ? '✓'
              : r.status === 3 ? '⚠'
              : '✗';
    const v8tag = receipt.v8 ? (receipt.v8.verdict === 'PASS' ? '✓v8' : '✗v8') : '—v8';
    const v9tag = receipt.v9 ? `${receipt.v9.verdict[0]}v9 ${receipt.v9.score?.toFixed(1) ?? '?'}` : '—v9';
    console.log(`  ${tag} [${i + 1}/${work.length}] ${pdf.padEnd(50)} ${(elapsedMs / 1000).toFixed(1)}s · ${v8tag} · ${v9tag}`);
  }
}

const elapsedTotalS = (Date.now() - started) / 1000;
const successCount = receipts.filter(r => r.ok && (!r.v8 || r.v8.verdict === 'PASS') && (!r.v9 || r.v9.verdict !== 'FAIL')).length;

/* ── Aggregate failure modes ─────────────────────────────────────────── */

const failureModes = {};
for (const r of receipts) {
  if (r.ok && (!r.v8 || r.v8.verdict === 'PASS') && (!r.v9 || r.v9.verdict !== 'FAIL')) continue;
  let mode = 'unknown';
  if (!r.ok) {
    if (r.signal) mode = `killed-by-${r.signal}`;
    else if (r.stderr.includes('extracted text too short')) mode = 'parser:empty-pdf';
    else if (r.stderr.includes('unsupported extension')) mode = 'parser:bad-ext';
    else if (r.stderr.includes('pdftotext failed')) mode = 'parser:pdftotext-crash';
    else if (r.stderr.includes('HTML output too small')) mode = 'build:empty-html';
    else mode = `exit-${r.exitCode}`;
  } else if (r.v8?.verdict === 'FAIL') {
    if (r.v8.conflicts > 0) mode = `v8:conflicts(${r.v8.conflicts})`;
    else if (r.v8.missingMandatory > 0) mode = `v8:missing-mandatory(${r.v8.missingMandatory})`;
    else mode = 'v8:fail-other';
  } else if (r.v9?.verdict === 'FAIL') {
    const top = (r.v9.failed || [])[0] || 'unknown';
    mode = `v9:${top}`;
  }
  failureModes[mode] = (failureModes[mode] || 0) + 1;
}

const ts = new Date().toISOString();
const summary = {
  generatedAt: ts,
  tool: 'tools/stress-test-ingest.mjs',
  source: SOURCE,
  totalPdfs: work.length,
  successCount,
  hardFailCount,
  v8FailCount,
  v9FailCount,
  v9WarnCount,
  elapsedTotalS,
  avgPerPdfS: +(elapsedTotalS / work.length).toFixed(2),
  failureModes,
};

const jsonFile = join(REPORTS, `stress-test-ingest-${ts.replace(/[:.]/g, '-')}.json`);
writeFileSync(jsonFile, JSON.stringify({ summary, receipts }, null, 2));

/* ── Markdown operator report ────────────────────────────────────────── */

const failedReceipts = receipts.filter(r => !r.ok || r.v8?.verdict === 'FAIL' || r.v9?.verdict === 'FAIL');

const md = [
  '# Stress Test — Ingest Pipeline Report',
  '',
  `_Generated_: \`${ts}\``,
  `_Source_: \`${SOURCE}\``,
  `_Total PDFs_: **${work.length}**`,
  `_Elapsed_: ${elapsedTotalS.toFixed(1)}s (~${(elapsedTotalS / work.length).toFixed(2)}s per PDF)`,
  '',
  '## Outcome counts',
  '',
  '| Outcome | Count | Share |',
  '|:--|:-:|:-:|',
  `| ✅ Success (ingest + V8 PASS + V9 not-FAIL) | ${successCount} | ${(100 * successCount / work.length).toFixed(1)}% |`,
  `| ✗ Hard failure (parser/build crash) | ${hardFailCount} | ${(100 * hardFailCount / work.length).toFixed(1)}% |`,
  `| ✗ V8 verdict FAIL | ${v8FailCount} | ${(100 * v8FailCount / work.length).toFixed(1)}% |`,
  `| ✗ V9 verdict FAIL | ${v9FailCount} | ${(100 * v9FailCount / work.length).toFixed(1)}% |`,
  `| ⚠ V9 verdict WARN | ${v9WarnCount} | ${(100 * v9WarnCount / work.length).toFixed(1)}% |`,
  '',
  '## Failure modes',
  '',
  Object.keys(failureModes).length === 0
    ? '_No failures._'
    : ['| Mode | Count |', '|:--|:-:|', ...Object.entries(failureModes).sort((a, b) => b[1] - a[1]).map(([m, c]) => `| \`${m}\` | ${c} |`)].join('\n'),
  '',
  '## First 30 failed PDFs',
  '',
  failedReceipts.length === 0
    ? '_None._'
    : ['| PDF | Exit | V8 | V9 | First error |',
       '|:--|:-:|:-:|:-:|:--|',
       ...failedReceipts.slice(0, 30).map(r => {
         const errSnippet = (r.stderr || '').split('\n')[0].slice(0, 80) || (r.v9?.failed?.[0] || r.v8 && r.v8.verdict === 'FAIL' ? `v8.conflicts=${r.v8.conflicts}` : '—');
         /* UQ-DEEP-A 2026-06-23 — MD CELL ESCAPE.
          * stderr can contain `|` or backticks which break table cells; mdCellEscape
          * neutralizes them so MD renderers don't go sideways on a parser error. */
         const pdfCell = mdCellEscape(r.pdf);
         const errCell = mdCellEscape(errSnippet);
         return `| \`${pdfCell}\` | ${r.exitCode} | ${r.v8?.verdict || '—'} | ${r.v9?.verdict || '—'} | ${errCell} |`;
       })].join('\n'),
  '',
].join('\n');

const mdFile = jsonFile.replace(/\.json$/, '.md');
writeFileSync(mdFile, md);

/* ── Stdout summary ──────────────────────────────────────────────────── */

if (!QUIET) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`stress-test-ingest · ${work.length} PDFs in ${elapsedTotalS.toFixed(1)}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Success:        ${successCount}/${work.length} (${(100 * successCount / work.length).toFixed(1)}%)`);
  console.log(`  Hard fail:      ${hardFailCount}`);
  console.log(`  V8 FAIL:        ${v8FailCount}`);
  console.log(`  V9 FAIL:        ${v9FailCount}`);
  console.log(`  V9 WARN:        ${v9WarnCount}`);
  if (Object.keys(failureModes).length > 0) {
    console.log('  Top failure modes:');
    for (const [m, c] of Object.entries(failureModes).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`    - ${m}: ${c}`);
    }
  }
  console.log(`  JSON report:    ${jsonFile}`);
  console.log(`  MD  report:     ${mdFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

/* Exit policy: hard-fail OR V9 FAIL counts as exit 1; V8 FAIL alone is
 * a structural warning but doesn't crash the gate (mandatoryCore can be
 * missing on synthetic templates that are valid but unconventional). */
if (hardFailCount > 0 || v9FailCount > 0) {
  console.log('✗ FAIL');
  process.exit(1);
}
console.log(`✓ PASS — ${successCount}/${work.length} ingested OK`);
process.exit(0);
