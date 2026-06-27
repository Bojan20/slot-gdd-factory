#!/usr/bin/env node
/**
 * tools/par-sheet-convergence-10B.mjs — PAR-14-D · REGULATOR AUDIT TIER
 *
 * Same shape as par-sheet-convergence-100M.mjs but bumps the sample to
 * 10B × 4 = 40B spins per slug. Wall-clock budget ≈ 35–40 h per slug on
 * Apple M-series single-thread. Run ONLY for regulator-grade audits,
 * never as part of release or CI cycles.
 *
 * Wilson 99% half-width drops to ≈ 0.3–0.6 pp, satisfying any reasonable
 * external math audit gate (typical regulators ask for ±1 pp).
 *
 * Usage:
 *   node tools/par-sheet-convergence-10B.mjs [--slug <one>]
 *
 * Receipts emitted to reports/par-convergence-10B/<slug>.json with
 * `__tier__: "10B"` so an audit-grade historical series can be archived.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
         writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const BASE_TOOL = resolve(__dirname, '_par-sheet-convergence.mjs');
const SRC_REPORT_DIR = resolve(REPO, 'reports', 'par-convergence');
const DST_REPORT_DIR = resolve(REPO, 'reports', 'par-convergence-10B');

const DEFAULT_SPINS = Number(process.env.PAR_CONVERGENCE_SPINS) || 10_000_000_000;
const DEFAULT_SEEDS = Number(process.env.PAR_CONVERGENCE_SEEDS) || 4;

function parseArgs(args) {
  const out = { slug: null, spins: DEFAULT_SPINS, seeds: DEFAULT_SEEDS };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') out.slug = args[++i];
    else if (a === '--spins') out.spins = parseInt(args[++i], 10);
    else if (a === '--seeds') out.seeds = parseInt(args[++i], 10);
  }
  return out;
}

function runBaseTool(opts) {
  return new Promise((res, rej) => {
    const args = [BASE_TOOL, '--spins', String(opts.spins), '--seeds', String(opts.seeds)];
    if (opts.slug) args.push('--slug', opts.slug);
    const child = spawn('node', args, { stdio: 'inherit' });
    child.on('error', rej);
    child.on('exit', (code) => {
      if (code === 0) res();
      else rej(new Error(`base convergence tool exited code ${code}`));
    });
  });
}

function relocateReports(opts) {
  if (!existsSync(SRC_REPORT_DIR)) return [];
  mkdirSync(DST_REPORT_DIR, { recursive: true });
  const files = readdirSync(SRC_REPORT_DIR).filter((f) => f.endsWith('.json'));
  const moved = [];
  for (const f of files) {
    const src = resolve(SRC_REPORT_DIR, f);
    const dst = resolve(DST_REPORT_DIR, f);
    try {
      const raw = readFileSync(src, 'utf-8');
      const j = JSON.parse(raw);
      j.__tier__ = '10B';
      j.__sample_spins__ = opts.spins;
      j.__sample_seeds__ = opts.seeds;
      j.__captured_at__ = new Date().toISOString();
      writeFileSync(dst, JSON.stringify(j, null, 2) + '\n');
      moved.push(f);
    } catch {
      try { copyFileSync(src, dst); moved.push(f); } catch { /* nop */ }
    }
  }
  return moved;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`▸ PAR-14-D · 10B-tier convergence run (REGULATOR AUDIT)`);
  console.log(`  spins=${opts.spins.toLocaleString()} × seeds=${opts.seeds}`);
  console.log(`  total=${(opts.spins * opts.seeds).toLocaleString()} spins per slug`);
  console.log(`  WARNING: expect 35–40h wallclock PER SLUG on single-thread.`);
  console.log(`  output: reports/par-convergence-10B/`);
  console.log('');

  const t0 = Date.now();
  await runBaseTool(opts);
  const moved = relocateReports(opts);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(`▸ relocated ${moved.length} receipt(s) to reports/par-convergence-10B/`);
  console.log(`▸ total wallclock ${dt}s`);
}

main().catch((e) => {
  console.error('par-sheet-convergence-10B FAIL:', e.message);
  process.exit(1);
});
