#!/usr/bin/env node
//
// W152 Wave 27 — Faza 7.4 acceptance report generator.
//
// Runs `cargo test --release --test faza74_chi_squared_sizes` and parses the
// stable stdout marker lines (`[chi2-sizes] backend=… n=… chi2=… pass=…`),
// then writes:
//   * reports/rng/CHI_SQUARED_SIZES.json  (machine-readable)
//   * reports/rng/CHI_SQUARED_SIZES.md    (auditor-friendly)
//
// Exits non-zero if any (backend, N) cell fails the gate — useful as a CI
// guard. Lifts the per-fixture proof out of cargo's noisy output so cert
// reviewers don't have to grep.
//
// Run:
//   node scripts/chi-squared-sizes-report.mjs
//   npm run chi-squared-sizes
//
// CLI flags:
//   --skip-test    Don't run cargo; reuse last cargo stdout from --stdin.
//                  (Used by the bench-regression dashboard.)

import { spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const OUT_DIR = join(ROOT, 'reports', 'rng');
const OUT_JSON = join(OUT_DIR, 'CHI_SQUARED_SIZES.json');
const OUT_MD = join(OUT_DIR, 'CHI_SQUARED_SIZES.md');

const args = process.argv.slice(2);
const SKIP_TEST = args.includes('--skip-test');

const MARKER = /^\[chi2-sizes\] backend=(\S+) n=(\d+) buckets=(\d+) chi2=([\d.]+) threshold=([\d.]+) pass=(true|false)/;

function runCargo() {
  console.log('▸ cargo test --release --test faza74_chi_squared_sizes -- --nocapture');
  const r = spawnSync(
    'cargo',
    ['test', '--release', '--test', 'faza74_chi_squared_sizes', '--', '--nocapture'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:${process.env.PATH ?? ''}` },
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  if (r.error) {
    console.error('cargo spawn failed:', r.error);
    process.exit(3);
  }
  if (r.status !== 0) {
    console.error('cargo test exited non-zero — at least one (backend, N) cell failed:');
    console.error(r.stdout);
    console.error(r.stderr);
    process.exit(2);
  }
  return r.stdout;
}

function parseStdout(stdout) {
  const rows = [];
  for (const line of stdout.split('\n')) {
    const m = MARKER.exec(line.trim());
    if (!m) continue;
    rows.push({
      backend: m[1],
      n: Number(m[2]),
      buckets: Number(m[3]),
      chi2: Number(m[4]),
      threshold: Number(m[5]),
      pass: m[6] === 'true',
    });
  }
  return rows;
}

function summarise(rows) {
  const byBackend = new Map();
  for (const r of rows) {
    if (!byBackend.has(r.backend)) byBackend.set(r.backend, []);
    byBackend.get(r.backend).push(r);
  }
  for (const arr of byBackend.values()) arr.sort((a, b) => a.n - b.n);
  const totalCells = rows.length;
  const passCells = rows.filter((r) => r.pass).length;
  const failCells = totalCells - passCells;
  return { byBackend, totalCells, passCells, failCells };
}

function renderJson(rows, summary) {
  return JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      gate: {
        small_n: { n_lt: 1000, threshold: 40.0, note: 'small-N intrinsic variance: gate is 4× df for sanity, not strict' },
        strict: { threshold: 27.877, df: 9, alpha: 0.001, note: 'chi-squared critical value' },
      },
      summary: {
        total_cells: summary.totalCells,
        pass_cells: summary.passCells,
        fail_cells: summary.failCells,
        backends: [...summary.byBackend.keys()],
        sample_sizes: [100, 1000, 10000, 100000, 1000000, 10000000],
      },
      cells: rows,
    },
    null,
    2
  );
}

function renderMd(rows, summary) {
  const ns = [100, 1000, 10000, 100000, 1000000, 10000000];
  const formatChi2 = (v) => v.toFixed(2).padStart(7, ' ');

  const lines = [];
  lines.push('# Faza 7.4 — chi² Uniformity Across All Sample Sizes');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Acceptance');
  lines.push('');
  lines.push('Master TODO §7.4 demands: **"chi-squared test pass za sve sample sizes"**.');
  lines.push('');
  lines.push('Sweep:');
  lines.push('* **5 backends**: Mulberry32 (legacy/TS-parity), Pcg64 (default), Xoshiro256\\*\\*, Philox4x32 (counter-based), ChaCha20 (CSPRNG).');
  lines.push('* **6 sample sizes**: 10², 10³, 10⁴, 10⁵, 10⁶, 10⁷ samples.');
  lines.push('* **10 buckets** (df = 9).');
  lines.push('* **Gate**: χ² < 27.877 for N ≥ 1000 (chi-squared critical value, α=0.001, df=9). For N=100 the small-sample variance is intrinsic, so the gate is the looser sanity bound of 40 (~4× df) — still catches a stuck or constant-bias generator, but doesn\'t false-flag legitimate small-N noise.');
  lines.push('');
  lines.push('## Result');
  lines.push('');
  lines.push(`**${summary.passCells}/${summary.totalCells} (backend × N) cells pass.**${summary.failCells === 0 ? ' All 5 RNG backends are uniform across the full 6-decade sample-size sweep.' : ` ⚠️ ${summary.failCells} cells failed — see table below for details.`}`);
  lines.push('');
  lines.push('## Per-Cell χ² Statistic');
  lines.push('');
  lines.push('| Backend | N=10² | N=10³ | N=10⁴ | N=10⁵ | N=10⁶ | N=10⁷ |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [backend, cells] of summary.byBackend) {
    const cellByN = new Map(cells.map((c) => [c.n, c]));
    const cols = ns.map((n) => {
      const c = cellByN.get(n);
      if (!c) return '—';
      return `${formatChi2(c.chi2)} ${c.pass ? '✅' : '❌'}`;
    });
    lines.push(`| **${backend}** | ${cols.join(' | ')} |`);
  }
  lines.push('');
  lines.push('Gate values: ≤ 40.00 for N=100 (small-N sanity), ≤ 27.88 for N ≥ 1000 (α=0.001, df=9).');
  lines.push('');
  lines.push('## Reproducer');
  lines.push('');
  lines.push('```');
  lines.push('cargo test --release --test faza74_chi_squared_sizes -- --nocapture');
  lines.push('node scripts/chi-squared-sizes-report.mjs   # regenerates this report');
  lines.push('```');
  lines.push('');
  lines.push('Seed is fixed (`0xDEAD_BEEF_CAFE_F00D`) so every audit run produces bit-identical numbers.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let stdout;
  if (SKIP_TEST) {
    stdout = require('fs').readFileSync(0, 'utf8');
  } else {
    stdout = runCargo();
  }

  const rows = parseStdout(stdout);
  if (rows.length === 0) {
    console.error('No [chi2-sizes] marker lines found in cargo stdout — test layout drifted?');
    process.exit(4);
  }

  const summary = summarise(rows);

  writeFileSync(OUT_JSON, renderJson(rows, summary));
  writeFileSync(OUT_MD, renderMd(rows, summary));

  console.log(`\n▸ Wrote ${OUT_JSON}`);
  console.log(`▸ Wrote ${OUT_MD}`);
  console.log(`▸ ${summary.passCells}/${summary.totalCells} cells pass`);

  if (summary.failCells > 0) {
    console.error('⚠️ One or more cells failed — investigate before commit.');
    process.exit(2);
  }
}

main();
