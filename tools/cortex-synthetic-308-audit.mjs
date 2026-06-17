#!/usr/bin/env node
/**
 * tools/cortex-synthetic-308-audit.mjs
 *
 * BATCH STATIC AUDIT — 308 synthetic GDD PDFs in ~/Desktop/GDD/synthetic/.
 *
 * Per-PDF flow (no Playwright — strict static check):
 *   1. pdfToMarkdown(pdfPath)
 *   2. parseGDD(md) → model
 *   3. buildSlotHTML(model)
 *   4. extract <script> body → node parse-check (syntax)
 *   5. extract data-ufp-kind chips → integrity vs model.features
 *   6. record verdict per-fixture
 *
 * Output:
 *   • stdout per-PDF row (✓ / ✗ with diag)
 *   • reports/synthetic-308-audit.json — machine-readable
 *   • aggregate failure-by-cause + per-shape pass-rate
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve as resolvePath, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseGDD } from '../src/parser.mjs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const SYN_DIR = `${process.env.HOME}/Desktop/GDD/synthetic`;
const REPORTS_DIR = resolvePath(REPO_ROOT, 'reports');
if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

const C = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

const AUTO_INJECTED = new Set(['big_win']);
const SYNTHETIC_KINDS = new Set(['feature_generic']);
const DEDICATED_BLOCKS = new Map([
  ['bonus_buy',             'id="bonusBuyBtn"'],
  ['ante_bet',              'id="anteBetToggle"'],
  ['autoplay',              'id="autoplayBackdrop"'],
  ['reality_check',         'id="rcOverlay"'],
  ['net_loss_indicator',    'NLI_STATE'],
  ['win_cap',               'id="winCapOverlay"'],
  ['gamble_secondary',      'id="gsOverlay"'],
  ['progressive_free_spins','id="pfsChip"'],
  ['path_aware_multiplier', 'window.PAW_STATE'],
]);

function declaredKinds(model) {
  const s = new Set();
  for (const f of (model.features || [])) {
    if (f && typeof f.kind === 'string') s.add(f.kind);
  }
  return s;
}

function chippedKinds(html) {
  const s = new Set();
  const re = /data-ufp-kind=['"]([\w]+)['"]/g;
  let m;
  while ((m = re.exec(html)) !== null) s.add(m[1]);
  return s;
}

function checkSyntax(scriptBody) {
  // Spawn node --check via stdin, no file write needed if scriptBody small
  const r = spawnSync('node', ['--check'], { input: scriptBody, encoding: 'utf8' });
  if (r.status === 0) return { ok: true };
  return { ok: false, msg: (r.stderr || '').split('\n').slice(0, 3).join(' | ') };
}

async function auditOne(pdfPath) {
  const id = basename(pdfPath, '.pdf');
  const t0 = Date.now();
  let md, model, html, scriptBody;

  try {
    const txt = await pdfFileToText(pdfPath);
    md = pdfTextToMarkdown(txt);
  } catch (e) { return { id, ok: false, phase: 'pdf', err: e.message }; }
  try { model = parseGDD(md); } catch (e) { return { id, ok: false, phase: 'parse', err: e.message }; }
  try { html = buildSlotHTML(model); } catch (e) { return { id, ok: false, phase: 'build', err: e.message }; }

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return { id, ok: false, phase: 'extract-script', err: 'no <script> in output' };
  scriptBody = scriptMatch[1];

  const syntax = checkSyntax(scriptBody);
  if (!syntax.ok) return { id, ok: false, phase: 'syntax', err: syntax.msg };

  // GDD integrity
  const declared = declaredKinds(model);
  const chipped = chippedKinds(html);
  const extra = [...chipped].filter(k => !declared.has(k) && !AUTO_INJECTED.has(k));
  const trulyMissing = [];
  for (const k of declared) {
    if (chipped.has(k)) continue;
    if (SYNTHETIC_KINDS.has(k)) continue;
    if (DEDICATED_BLOCKS.has(k) && html.includes(DEDICATED_BLOCKS.get(k))) continue;
    trulyMissing.push(k);
  }
  return {
    id, ok: extra.length === 0 && trulyMissing.length === 0,
    shape: (model.shape && model.shape.kind) || 'undefined',
    chipCount: chipped.size,
    declaredCount: declared.size,
    extra, missing: trulyMissing,
    msMs: Date.now() - t0,
  };
}

async function main() {
  console.log(C.bold(C.cyan('\n🔍 CORTEX SYNTHETIC 308 BATCH AUDIT\n')));

  const files = (await readdir(SYN_DIR))
    .filter(f => f.endsWith('.pdf'))
    .sort();
  console.log(C.dim(`Total: ${files.length} synthetic PDFs in ${SYN_DIR}\n`));

  const reports = [];
  let pass = 0, fail = 0;
  const failByPhase = new Map();
  const passByShape = new Map();
  const failByShape = new Map();

  const start = Date.now();
  let lastLog = Date.now();

  for (let i = 0; i < files.length; i++) {
    const r = await auditOne(resolvePath(SYN_DIR, files[i]));
    reports.push(r);
    if (r.ok) {
      pass++;
      passByShape.set(r.shape, (passByShape.get(r.shape) || 0) + 1);
    } else {
      fail++;
      const phase = r.phase || 'integrity';
      failByPhase.set(phase, (failByPhase.get(phase) || 0) + 1);
      failByShape.set(r.shape || 'unknown', (failByShape.get(r.shape || 'unknown') || 0) + 1);
    }

    // Progress every 50
    if (i % 50 === 0 || i === files.length - 1) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      const rate = (i + 1) / Math.max(1, (Date.now() - start) / 1000);
      process.stdout.write(`\r  Progress: ${i + 1}/${files.length}  pass=${pass}  fail=${fail}  elapsed=${elapsed}s  rate=${rate.toFixed(1)}/s`);
    }
  }
  console.log('\n');

  console.log(C.bold(`────────────────────────────────────────────`));
  console.log(C.bold(`Σ ${files.length} PDFs · ✅ ${pass} (${(pass / files.length * 100).toFixed(1)}%) · ❌ ${fail}`));
  console.log(C.bold(`────────────────────────────────────────────\n`));

  if (failByPhase.size > 0) {
    console.log(C.bold('Failures by phase:'));
    for (const [p, n] of [...failByPhase.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${C.red('•')} ${p.padEnd(20)} ${n}×`);
    }
    console.log();
  }

  console.log(C.bold('Pass / Fail by shape:'));
  const allShapes = new Set([...passByShape.keys(), ...failByShape.keys()]);
  for (const sh of [...allShapes].sort()) {
    const p = passByShape.get(sh) || 0;
    const f = failByShape.get(sh) || 0;
    const total = p + f;
    const pct = total ? (p / total * 100).toFixed(0) : '—';
    const bar = total ? '█'.repeat(Math.round(p / total * 20)) + '░'.repeat(20 - Math.round(p / total * 20)) : '────────────────────';
    console.log(`  ${sh.padEnd(18)} ${bar} ${p}/${total} (${pct}%)`);
  }
  console.log();

  // Save JSON
  const jsonPath = resolvePath(REPORTS_DIR, 'synthetic-308-audit.json');
  writeFileSync(jsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    total: files.length, pass, fail,
    failByPhase: Object.fromEntries(failByPhase),
    passByShape: Object.fromEntries(passByShape),
    failByShape: Object.fromEntries(failByShape),
    reports,
  }, null, 2));
  console.log(C.dim(`Report: ${jsonPath}`));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(C.red(`FATAL: ${e.stack || e.message}`)); process.exit(2); });
