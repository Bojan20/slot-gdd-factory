#!/usr/bin/env node
// NIST SP 800-22 finalAnalysisReport.txt → JSON converter.
//
// Reads the canonical NIST `assess` summary file (the one inside
// `experiments/AlgorithmTesting/`) and emits a single JSON document with:
//
//   - per-subtest p-value (uniformity of p-values, χ²) and proportion
//     (passing sequences / total sequences)
//   - per-subtest acceptance flag against the standard NIST bars:
//       • p-value > 0.0001    (uniformity bar)
//       • proportion ≥ confidence interval for α = 0.01 (computed below)
//   - aggregate counts: total subtests, passed, failed, indeterminate
//
// Output format is locked-in for the audit-kit CI job, so the schema
// below is part of the public artefact contract. Don't reorder fields.
//
// Usage:
//   node scripts/nist-to-json.mjs <path/to/finalAnalysisReport.txt> [backend]
//
// The optional `backend` argument is echoed back in the JSON under
// `.backend` for traceability; if omitted, it's inferred from the
// `generator is <...>` line in the report.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

function usage() {
  process.stderr.write(
    'usage: nist-to-json.mjs <finalAnalysisReport.txt> [backend]\n',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 1) usage();
const reportPath = argv[0];
const backendArg = argv[1];

const raw = readFileSync(reportPath, 'utf8');
const lines = raw.split(/\r?\n/);

// ─── Header parsing ──────────────────────────────────────────────────────
// Expected header section, repeated by NIST:
//   ----------- ...
//   RESULTS FOR THE UNIFORMITY OF P-VALUES AND THE PROPORTION OF PASSING SEQUENCES
//   ----------- ...
//      generator is </path/to/file>
//   ----------- ...
//    C1  C2  ... C10  P-VALUE  PROPORTION  STATISTICAL TEST
//   ----------- ...
//   [data rows]
//   ----------- ...
//   [legend / bitstream count]

let generator = null;
let totalBitstreams = null;
for (const ln of lines) {
  const gen = ln.match(/generator is <(.+)>/);
  if (gen) {
    generator = gen[1];
    continue;
  }
  // "The minimum pass rate for each statistical test with the exception of the
  //  random excursion (variant) test is approximately = N for a sample size = M binary sequences."
  const sample = ln.match(/sample size\s*=\s*(\d+)\s*binary sequences/);
  if (sample) {
    totalBitstreams = Number(sample[1]);
  }
}

const backend = backendArg || (generator ? basename(generator).replace(/\.[^.]+$/, '') : 'unknown');

// ─── Row parsing ─────────────────────────────────────────────────────────
// Each data row format (10 frequency-bucket cells, p-value or "----", a
// proportion as "k/N", and a test name; some tests appear multiple times
// because NIST stores Serial as two sub-tests, NonOverlappingTemplate as
// 148 etc.):
//
//   0   1   2   3   4   5   6   7   8   9  P-VALUE   k/N      TEST
//
// The cells are integers; the p-value is "0.123456" or "----" (no
// uniformity computed); the proportion is "k/N".

const ROW_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s*\/\s*(\d+)\s+([A-Za-z0-9_\-]+)\s*$/;

/** Compute the NIST minimum pass-rate (proportion) for α = 0.01 and N samples.
 *  Per SP 800-22 §4.2.1:  p̂ ± 3·sqrt(p̂·(1-p̂) / N),  p̂ = 1 - α = 0.99.
 *
 *  NIST `assess` convention: a row passes iff
 *      passed_sequences ≥ floor(N · (p̂ − 3·√(p̂·q̂ / N)))
 *  so we materialise the threshold as `floor(N·rate) / N`. This makes
 *  96/100 a clean pass (NIST canon) instead of failing by 1e-4.
 */
function minProportion(N) {
  if (!N || N < 1) return 0;
  const pHat = 0.99;
  const lower = pHat - 3 * Math.sqrt((pHat * (1 - pHat)) / N);
  return Math.floor(N * lower) / N;
}

const rows = [];
for (const ln of lines) {
  const m = ln.match(ROW_RE);
  if (!m) continue;
  const buckets = m.slice(1, 11).map(Number);
  const pRaw = m[11];
  const k = Number(m[12]);
  const nTotal = Number(m[13]);
  const name = m[14];
  const pValue = pRaw === '----' ? null : Number(pRaw);
  const proportion = nTotal > 0 ? k / nTotal : 0;
  if (totalBitstreams == null) totalBitstreams = nTotal;
  rows.push({
    test: name,
    buckets,
    p_value: pValue,
    passed_sequences: k,
    total_sequences: nTotal,
    proportion,
  });
}

const minProp = minProportion(totalBitstreams ?? 100); // headline bar (full N)
const ALPHA_UNIFORMITY = 0.0001; // NIST recommendation: p-value of uniformity > 0.0001

// Per-row min proportion uses the **actual** N of that row, which can be
// smaller than the global numOfBitStreams for tests that drop sequences
// without enough cycles (RandomExcursions / RandomExcursionsVariant).
function judge(row) {
  const rowMinProp = minProportion(row.total_sequences);
  const propOk = row.proportion >= rowMinProp;
  const uniOk = row.p_value == null ? true : row.p_value > ALPHA_UNIFORMITY;
  return {
    verdict: propOk && uniOk
      ? 'pass'
      : (!propOk && !uniOk ? 'fail' : (!propOk ? 'fail_proportion' : 'fail_uniformity')),
    row_min_proportion: rowMinProp,
  };
}

const judged = rows.map((r) => ({ ...r, ...judge(r) }));
const counts = {
  total: judged.length,
  pass: judged.filter((r) => r.verdict === 'pass').length,
  fail: judged.filter((r) => r.verdict !== 'pass').length,
  fail_proportion: judged.filter((r) => r.verdict === 'fail_proportion').length,
  fail_uniformity: judged.filter((r) => r.verdict === 'fail_uniformity').length,
  fail_both: judged.filter((r) => r.verdict === 'fail').length,
};

const out = {
  backend,
  source_generator: generator,
  source_report: reportPath,
  battery: 'NIST SP 800-22 (sts-2.1.2)',
  parsed_at: new Date().toISOString(),
  alpha: 0.01,
  uniformity_alpha: ALPHA_UNIFORMITY,
  bitstreams: totalBitstreams,
  bitstream_length: null, // populated by caller if needed
  min_proportion: minProp,
  overall_pass: counts.fail === 0,
  counts,
  tests: judged,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
