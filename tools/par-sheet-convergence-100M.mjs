#!/usr/bin/env node
/**
 * tools/par-sheet-convergence-100M.mjs — PAR-14-D · NIGHTLY CRON TIER
 *
 * Thin wrapper around tools/_par-sheet-convergence.mjs that bumps the
 * sample size from the CI-default 5M × 4 = 20M to the regulator-aimed
 * 100M × 4 = 400M spins per slug. Wall-clock budget ≈ 25–30 min on
 * Apple M-series single-thread (sister kernel ~50–100M spins/s).
 *
 * Purpose: tighter PASS verification at Wilson 99% half-width ≈ 3–5 pp
 * (vs ±14–21 pp at the CI 5M tier). RNG over-fit hidden at CI scale
 * surfaces here. Designed for weekly GitHub Actions cron + ad-hoc runs
 * before significant releases. Output land in reports/par-convergence-
 * 100M/<slug>.json + _aggregate.json with `tier: "100M"` stamp so a
 * historical series can be assembled across runs.
 *
 * Usage:
 *   node tools/par-sheet-convergence-100M.mjs           [--slug <one>]
 *   PAR_CONVERGENCE_SPINS=50000000 node tools/par-sheet-convergence-100M.mjs
 *
 * Env knobs:
 *   PAR_CONVERGENCE_SPINS   override spin count (default 100_000_000)
 *   PAR_CONVERGENCE_SEEDS   override seed count (default 4)
 *
 * Receipt schema matches the base convergence tool exactly so existing
 * aggregators / dashboards consume the 100M tier without changes; the
 * only added field is `__tier__: "100M"` for filtering.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
         renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const BASE_TOOL = resolve(__dirname, '_par-sheet-convergence.mjs');
const SRC_REPORT_DIR = resolve(REPO, 'reports', 'par-convergence');
const DST_REPORT_DIR = resolve(REPO, 'reports', 'par-convergence-100M');

const DEFAULT_SPINS = Number(process.env.PAR_CONVERGENCE_SPINS) || 100_000_000;
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
      j.__tier__ = '100M';
      j.__sample_spins__ = opts.spins;
      j.__sample_seeds__ = opts.seeds;
      j.__captured_at__ = new Date().toISOString();
      writeFileSync(dst, JSON.stringify(j, null, 2) + '\n');
      moved.push(f);
    } catch (e) {
      /* Non-JSON or unreadable — best-effort copy then skip. */
      try { copyFileSync(src, dst); moved.push(f); } catch { /* nop */ }
    }
  }
  return moved;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`▸ PAR-14-D · 100M-tier convergence run`);
  console.log(`  spins=${opts.spins.toLocaleString()} × seeds=${opts.seeds}`);
  console.log(`  total=${(opts.spins * opts.seeds).toLocaleString()} spins per slug`);
  console.log(`  output: reports/par-convergence-100M/`);
  console.log('');

  const t0 = Date.now();
  await runBaseTool(opts);
  const moved = relocateReports(opts);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log(`▸ relocated ${moved.length} receipt(s) to reports/par-convergence-100M/`);
  console.log(`▸ total wallclock ${dt}s`);
}

main().catch((e) => {
  console.error('par-sheet-convergence-100M FAIL:', e.message);
  process.exit(1);
});
