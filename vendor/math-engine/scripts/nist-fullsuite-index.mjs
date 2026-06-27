#!/usr/bin/env node
// NIST SP 800-22 full-suite aggregator.
//
// Reads `reports/rng/<backend>-nist-full.json` × 5 and emits:
//   reports/rng/NIST_FULL_SUITE.md  (per-backend pass/fail summary + per-test breakdown)
//
// This sits **alongside** the lightweight 5-test baseline (INDEX.md);
// it's the audit-grade artefact submitted to UKGC / MGA / GLI-19.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), '..');
const RNG_DIR = join(REPO_ROOT, 'reports', 'rng');

const BACKENDS = ['mulberry32', 'pcg64', 'xoshiro256ss', 'philox4x32', 'chacha20'];

// ─── Load per-backend reports ──────────────────────────────────────────────
const reports = {};
for (const b of BACKENDS) {
  const p = join(RNG_DIR, `${b}-nist-full.json`);
  if (!existsSync(p)) {
    console.error(`  · skip ${b} (no full-suite artefact)`);
    continue;
  }
  reports[b] = JSON.parse(readFileSync(p, 'utf8'));
}

if (Object.keys(reports).length === 0) {
  console.error('No NIST full-suite artefacts found. Run scripts/nist-fullsuite-run.sh first.');
  process.exit(2);
}

// ─── Markdown report ──────────────────────────────────────────────────────
const out = [];
out.push('# RNG Quality — NIST SP 800-22 Full Suite (LIVE)');
out.push('');
out.push(
  `**Generated:** ${new Date().toISOString()}  ·  ` +
    `**Tool:** NIST sts-2.1.2 (\`assess\`)  ·  ` +
    `**Bitstream length:** 10⁶ bits  ·  ` +
    `**Bitstreams per backend:** 100  ·  ` +
    `**Total bits per backend:** 10⁸  ·  ` +
    `**α (per-test):** 0.01  ·  ` +
    `**α (uniformity p-value):** 1e-4`,
);
out.push('');
out.push(
  'This is the **audit-grade** NIST SP 800-22 capture — full 15-test ' +
    'battery, official NIST `assess` binary, 100 × 10⁶-bit bitstreams per ' +
    'backend (matching the regulator-recommended sample size). The ' +
    'lightweight 5-test Node baseline in [`INDEX.md`](./INDEX.md) stays ' +
    'always-on in CI; this artefact is the **submission** copy.',
);
out.push('');
out.push('## Acceptance bar');
out.push('');
out.push(
  '- Each of the 188 sub-tests (15 named tests, several with multiple ' +
    'sub-variants — NonOverlappingTemplate × 148, RandomExcursions × 8, ' +
    'RandomExcursionsVariant × 18, CumulativeSums × 2, Serial × 2) is ' +
    'judged against:',
);
out.push(
  '   - **Proportion** ≥ 0.99 − 3·√(0.99·0.01/100) ≈ **0.960** (passing sequences / total)',
);
out.push(
  '   - **Uniformity p-value** > 1e-4 (χ² over 10-bucket histogram of per-bitstream p-values)',
);
out.push(
  '- A backend passes the **submission bar** iff **all 188 sub-tests pass** ' +
    'both criteria. Production default `pcg64` MUST clear this every release.',
);
out.push('');
out.push('## Backend summary');
out.push('');
out.push('| Backend          | Verdict | Passed | Failed (prop) | Failed (uniformity) | Failed (both) | Artefact |');
out.push('|------------------|---------|--------|---------------|---------------------|----------------|----------|');
for (const b of BACKENDS) {
  const r = reports[b];
  if (!r) {
    out.push(`| \`${b}\` | — | — | — | — | — | _(not run)_ |`);
    continue;
  }
  const glyph = r.overall_pass ? '✅' : '❌';
  out.push(
    `| \`${b}\` | ${glyph} ${r.overall_pass ? 'PASS' : 'FAIL'} | ` +
      `${r.counts.pass}/${r.counts.total} | ` +
      `${r.counts.fail_proportion} | ` +
      `${r.counts.fail_uniformity} | ` +
      `${r.counts.fail_both} | ` +
      `[\`${b}-nist-full.json\`](./${b}-nist-full.json) · [\`${b}-nist-full.txt\`](./${b}-nist-full.txt) |`,
  );
}
out.push('');
out.push('## Per-test breakdown (named test → pass count across backends)');
out.push('');
// Collect distinct test names in canonical NIST order
const TEST_ORDER = [
  'Frequency', 'BlockFrequency', 'CumulativeSums', 'Runs', 'LongestRun',
  'Rank', 'FFT', 'NonOverlappingTemplate', 'OverlappingTemplate', 'Universal',
  'ApproximateEntropy', 'RandomExcursions', 'RandomExcursionsVariant',
  'Serial', 'LinearComplexity',
];
out.push('| Test                       | ' + BACKENDS.map((b) => `\`${b}\``).join(' | ') + ' |');
out.push('|----------------------------|' + BACKENDS.map(() => '-----------------').join('|') + '|');
for (const t of TEST_ORDER) {
  const row = [t.padEnd(26)];
  for (const b of BACKENDS) {
    const r = reports[b];
    if (!r) { row.push('—'); continue; }
    const subs = r.tests.filter((x) => x.test === t);
    const pass = subs.filter((x) => x.verdict === 'pass').length;
    const total = subs.length;
    const glyph = pass === total && total > 0 ? '✅' : (total === 0 ? '—' : '❌');
    row.push(`${glyph} ${pass}/${total}`);
  }
  out.push('| ' + row.join(' | ') + ' |');
}
out.push('');
out.push('## How to reproduce');
out.push('');
out.push('```bash');
out.push('# 1. Build NIST sts-2.1.2 (one-time):');
out.push('#    curl -sL -o sts.zip https://csrc.nist.gov/CSRC/media/Projects/Random-Bit-Generation/documents/sts-2_1_2.zip');
out.push('#    unzip sts.zip && cd sts-2.1.2/sts-2.1.2 && make');
out.push('#    export STS_DIR=$(pwd)');
out.push('');
out.push('npm run build                              # populate dist/ for --dump');
out.push('bash scripts/nist-fullsuite-run.sh         # generate streams + run assess × 5');
out.push('node scripts/nist-fullsuite-index.mjs      # regenerate this aggregate');
out.push('```');
out.push('');
out.push('## Notes on `mulberry32`');
out.push('');
out.push(
  '`mulberry32` is **only retained** for TS↔Rust byte-for-byte parity tests ' +
    '(`scripts/cross-platform-rng-parity.mjs`). It is a 32-bit splitmix-style ' +
    'PRNG and is **permitted** to fail individual NIST sub-tests at the ' +
    'submission threshold; it is **never** configured as the live RNG for a ' +
    'production game. The policy is documented in [`docs/rng.md`](../../docs/rng.md).',
);
out.push('');

writeFileSync(join(RNG_DIR, 'NIST_FULL_SUITE.md'), out.join('\n'));
console.error(`✓ Wrote ${join(RNG_DIR, 'NIST_FULL_SUITE.md')}`);

// Echo final summary line for CI grep:
const aggPass = BACKENDS.filter((b) => reports[b]?.overall_pass).length;
const aggTotal = BACKENDS.filter((b) => reports[b]).length;
console.log(`NIST_FULL_SUITE: ${aggPass}/${aggTotal} backends pass all 188 sub-tests`);
