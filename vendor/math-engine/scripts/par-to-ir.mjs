#!/usr/bin/env node
/**
 * Generic PAR → IR enricher
 * ─────────────────────────
 *
 * Takes any *par-style* simulation report (a JSON with `rtp`, `hit_rate`,
 * `volatility_index`, `win_distribution`, optional `confidence` /
 * `rtp_breakdown`) and merges its statistics into a canonical IR-1.0.0
 * JSON's `validated_metrics` block.  Studio's Build tab L1 row then
 * displays engine-truth Hit / σ / P99 values for ANY game (not just
 * Pattern-WO).
 *
 * Usage:
 *
 *   node scripts/par-to-ir.mjs \
 *     --ir   path/to/game.ir.json \
 *     --par  path/to/par-*.json \
 *     [--out path/to/output.ir.json]  # default: overwrite --ir in-place
 *     [--source "human-readable source label"]
 *     [--total-spins 500000000]       # override if not in --par
 *
 * Expected PAR JSON shape (all fields optional except rtp + win_distribution):
 *
 *   {
 *     "total_spins":      500000000,
 *     "rtp":              96.0232,           // percent (0..100)
 *     "hit_rate":         20.6855,           // percent (0..100)
 *     "volatility_index": 4.5096,
 *     "fs_frequency":     117.98,
 *     "hnw_frequency":    110.91,
 *     "max_win_x":        1596.0,
 *     "win_distribution": {
 *       "0-0.5x":  N,
 *       "0.5-1x":  N,
 *       ...,
 *       "5000-+x": N
 *     },
 *     "confidence":     { mean_rtp, std_dev, std_error, ci_95_low, ci_95_high },
 *     "rtp_breakdown":  { ...arbitrary per-feature numbers... }
 *   }
 *
 * Exit codes:
 *   0  on success
 *   1  bad CLI arguments
 *   2  IR or PAR file unreadable / invalid JSON
 *   3  PAR schema validation failed
 *   4  IR schema unrecognised (no schema_version === "1.0.0")
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ─── CLI parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { ir: null, par: null, out: null, source: null, totalSpins: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--ir')          a.ir = argv[++i];
    else if (k === '--par')    a.par = argv[++i];
    else if (k === '--out')    a.out = argv[++i];
    else if (k === '--source') a.source = argv[++i];
    else if (k === '--total-spins') a.totalSpins = parseInt(argv[++i], 10);
    else if (k === '--help' || k === '-h') {
      console.log(fs.readFileSync(import.meta.url.replace('file://', ''), 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return a;
}

function die(code, msg) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

function readJson(p, code) {
  if (!fs.existsSync(p)) die(code, `file not found: ${p}`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(code, `invalid JSON in ${p}: ${e.message}`); }
}

// ─── PAR schema validation + percentile derivation ──────────────────────────
const BUCKET_EDGES = [
  ['0-0.5x',     0.0,    0.5],
  ['0.5-1x',     0.5,    1.0],
  ['1-2x',       1.0,    2.0],
  ['2-3x',       2.0,    3.0],
  ['3-5x',       3.0,    5.0],
  ['5-10x',      5.0,    10.0],
  ['10-20x',     10.0,   20.0],
  ['20-50x',     20.0,   50.0],
  ['50-100x',    50.0,   100.0],
  ['100-200x',   100.0,  200.0],
  ['200-500x',   200.0,  500.0],
  ['500-1000x',  500.0,  1000.0],
  ['1000-5000x', 1000.0, 5000.0],
  ['5000-+x',    5000.0, 10000.0],
];

function validatePar(par) {
  const errors = [];
  if (typeof par !== 'object' || par === null) errors.push('PAR must be a JSON object');
  if (typeof par.rtp !== 'number') errors.push('PAR.rtp must be a number (percent 0..100)');
  if (!par.win_distribution || typeof par.win_distribution !== 'object')
    errors.push('PAR.win_distribution must be an object with bucket counts');
  // Soft validation: warn but don't fail when optional metrics are missing
  return errors;
}

function computePercentiles(buckets) {
  let total = 0;
  for (const [k] of BUCKET_EDGES) total += Number(buckets[k] || 0);
  if (total <= 0) return null;
  const at = (targetPct) => {
    let cum = 0;
    for (const [k, lo, hi] of BUCKET_EDGES) {
      const prev = cum;
      cum += Number(buckets[k] || 0);
      const prevPct = (prev / total) * 100;
      const nextPct = (cum / total) * 100;
      if (nextPct >= targetPct) {
        if (nextPct === prevPct) return hi;
        const frac = (targetPct - prevPct) / (nextPct - prevPct);
        return +(lo + frac * (hi - lo)).toFixed(2);
      }
    }
    return BUCKET_EDGES[BUCKET_EDGES.length - 1][2];
  };
  return {
    p50:    at(50),
    p75:    at(75),
    p90:    at(90),
    p95:    at(95),
    p99:    at(99),
    p99_9:  at(99.9),
    p99_99: at(99.99),
  };
}

// ─── Build validated_metrics block from PAR ─────────────────────────────────
function buildValidatedMetrics(par, sourceLabel) {
  const percentiles = computePercentiles(par.win_distribution || {});
  return {
    source: sourceLabel || 'PAR sim (par-to-ir.mjs)',
    total_spins: par.total_spins ?? null,
    rtp: par.rtp,
    hit_rate: par.hit_rate ?? null,
    volatility_index: par.volatility_index ?? null,
    fs_frequency: par.fs_frequency ?? null,
    hnw_frequency: par.hnw_frequency ?? null,
    max_win_observed_x: par.max_win_x ?? null,
    win_percentiles: percentiles,
    confidence: par.confidence ?? null,
    rtp_breakdown: par.rtp_breakdown ?? null,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
if (!args.ir)  die(1, 'missing --ir <path>');
if (!args.par) die(1, 'missing --par <path>');

const ir  = readJson(args.ir,  2);
const par = readJson(args.par, 2);

if (ir.schema_version !== '1.0.0')
  die(4, `IR schema_version must be "1.0.0" (got ${JSON.stringify(ir.schema_version)})`);

const parErrors = validatePar(par);
if (parErrors.length) {
  for (const e of parErrors) console.error(`  ✗ ${e}`);
  die(3, 'PAR validation failed');
}

const sourceLabel = args.source || `${path.basename(args.par)} (${par.total_spins ? par.total_spins.toLocaleString() : '?'} spins)`;
const validated = buildValidatedMetrics(par, sourceLabel);
ir.validated_metrics = validated;

const outPath = args.out || args.ir;
fs.writeFileSync(outPath, JSON.stringify(ir, null, 2) + '\n');

const sha = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
const size = fs.statSync(outPath).size;

console.log('✓ IR enriched with validated_metrics');
console.log(`  IR:        ${args.ir}`);
console.log(`  PAR:       ${args.par}`);
console.log(`  Output:    ${outPath}`);
console.log(`  Size:      ${(size / 1024).toFixed(1)} KB · SHA-256 ${sha.slice(0, 12)}…`);
console.log(`  Source:    ${sourceLabel}`);
console.log('  Metrics:');
console.log(`    RTP              ${validated.rtp}%`);
console.log(`    Hit rate         ${validated.hit_rate ?? '—'}%`);
console.log(`    Volatility       σ ${validated.volatility_index ?? '—'}`);
console.log(`    Max win observed ${validated.max_win_observed_x ?? '—'}×`);
if (validated.win_percentiles) {
  const wp = validated.win_percentiles;
  console.log(`    P95 / P99 / P99.9   ${wp.p95}× / ${wp.p99}× / ${wp.p99_9}×`);
}
console.log(`    FS  freq         1-in-${validated.fs_frequency ?? '—'}`);
console.log(`    H&W freq         1-in-${validated.hnw_frequency ?? '—'}`);
