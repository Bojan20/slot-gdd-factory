#!/usr/bin/env node
//
// W152 Wave 23 — Unified TS+Rust Test Coverage Report.
// Closes tehnički dug: "Test coverage neujednačen — TS+Rust unified
// coverage report" ⚠️→✅.
//
// Aggregates:
//   * TS vitest test counts (per-file + total).
//   * Rust cargo test counts (per-binary + total).
//   * Categories: unit / integration / acceptance / mutation.
//   * Diff vs prior committed report (regression detector).
//
// Output:
//   * `reports/coverage/TEST_COVERAGE.{json,md}`
//
// NOT line-coverage (separate tool — c8 / tarpaulin); this is
// test-COUNT coverage, sufficient for engagement/triage tracking.

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'coverage');
const TS_TESTS_DIR = join(REPO_ROOT, 'tests');
const RUST_TESTS_DIR = join(REPO_ROOT, 'rust-sim', 'tests');

// ── TS test discovery ───────────────────────────────────────────────────

function categoriseTest(name) {
  const lower = name.toLowerCase();
  if (lower.includes('acceptance') || lower.includes('parity')) return 'acceptance';
  if (lower.includes('integration') || lower.includes('faza')) return 'integration';
  if (lower.includes('mutation') || lower.includes('strength')) return 'mutation';
  return 'unit';
}

function listTsTests() {
  if (!existsSync(TS_TESTS_DIR)) return [];
  return readdirSync(TS_TESTS_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => ({
      file: f,
      category: categoriseTest(f),
      sizeBytes: statSync(join(TS_TESTS_DIR, f)).size,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function listRustTests() {
  if (!existsSync(RUST_TESTS_DIR)) return [];
  return readdirSync(RUST_TESTS_DIR)
    .filter((f) => f.endsWith('.rs'))
    .map((f) => ({
      file: f,
      category: categoriseTest(f),
      sizeBytes: statSync(join(RUST_TESTS_DIR, f)).size,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

// ── Test count via spawning runners ─────────────────────────────────────

function countTsSpecs() {
  console.log('Running vitest to count TS specs (this takes ~40s)…');
  const child = spawnSync(
    'node',
    [
      '--experimental-vm-modules',
      'node_modules/vitest/vitest.mjs',
      'run',
      '--reporter=basic',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 300_000,
    },
  );
  const m = child.stdout.match(/Tests\s+(\d+)\s+passed.*?\((\d+)\)/);
  if (m) return { passed: parseInt(m[1], 10), total: parseInt(m[2], 10) };
  return { passed: 0, total: 0 };
}

function countRustTests() {
  const PATH = process.env.HOME + '/.cargo/bin:' + process.env.PATH;
  console.log('Running cargo test --release to count Rust tests…');
  const child = spawnSync('cargo', ['test', '--release'], {
    cwd: join(REPO_ROOT, 'rust-sim'),
    encoding: 'utf-8',
    env: { ...process.env, PATH },
    timeout: 300_000,
  });
  const matches = [...(child.stdout || '').matchAll(/test result: \w+\.\s*(\d+)\s+passed/g)];
  let total = 0;
  for (const m of matches) total += parseInt(m[1], 10);
  return { passed: total };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const tsFiles = listTsTests();
  const rustFiles = listRustTests();
  const tsCounts = countTsSpecs();
  const rustCounts = countRustTests();

  // Prior report diff
  const priorPath = join(OUT_DIR, 'TEST_COVERAGE.json');
  let prior = null;
  if (existsSync(priorPath)) {
    try {
      prior = JSON.parse(readFileSync(priorPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  const tsByCategory = tsFiles.reduce(
    (acc, f) => {
      acc[f.category] = (acc[f.category] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const rustByCategory = rustFiles.reduce(
    (acc, f) => {
      acc[f.category] = (acc[f.category] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const meta = {
    generatedAtUtc: new Date().toISOString(),
    typescript: {
      testFiles: tsFiles.length,
      passingSpecs: tsCounts.passed,
      totalSpecs: tsCounts.total,
      byCategory: tsByCategory,
    },
    rust: {
      testFiles: rustFiles.length,
      passingTests: rustCounts.passed,
      byCategory: rustByCategory,
    },
    diffVsPrior: prior
      ? {
          tsFilesDelta: tsFiles.length - (prior.typescript?.testFiles ?? 0),
          tsSpecsDelta: tsCounts.passed - (prior.typescript?.passingSpecs ?? 0),
          rustFilesDelta: rustFiles.length - (prior.rust?.testFiles ?? 0),
          rustTestsDelta: rustCounts.passed - (prior.rust?.passingTests ?? 0),
        }
      : null,
  };

  // Write JSON (skip per-file details — those are derivable)
  writeFileSync(join(OUT_DIR, 'TEST_COVERAGE.json'), JSON.stringify(meta, null, 2) + '\n');

  // Markdown
  const md = [];
  md.push('# Unified Test Coverage Report (TS + Rust)');
  md.push('');
  md.push(`> **W152 Wave 23 — tehnički dug closeout.** Generated ${meta.generatedAtUtc}.`);
  md.push('');
  md.push('## Headline');
  md.push('');
  md.push(`- **TypeScript**: ${meta.typescript.testFiles} test files, ${meta.typescript.passingSpecs} specs passing.`);
  md.push(`- **Rust**: ${meta.rust.testFiles} test files, ${meta.rust.passingTests} tests passing.`);
  md.push('');
  if (meta.diffVsPrior) {
    md.push('## Delta vs prior commit');
    md.push('');
    md.push(`- TS files: ${signed(meta.diffVsPrior.tsFilesDelta)}`);
    md.push(`- TS specs: ${signed(meta.diffVsPrior.tsSpecsDelta)}`);
    md.push(`- Rust files: ${signed(meta.diffVsPrior.rustFilesDelta)}`);
    md.push(`- Rust tests: ${signed(meta.diffVsPrior.rustTestsDelta)}`);
    md.push('');
  }
  md.push('## TypeScript by category');
  md.push('');
  md.push('| Category | File count |');
  md.push('|---|---:|');
  for (const [cat, n] of Object.entries(meta.typescript.byCategory).sort()) {
    md.push(`| ${cat} | ${n} |`);
  }
  md.push('');
  md.push('## Rust by category');
  md.push('');
  md.push('| Category | File count |');
  md.push('|---|---:|');
  for (const [cat, n] of Object.entries(meta.rust.byCategory).sort()) {
    md.push(`| ${cat} | ${n} |`);
  }
  md.push('');
  md.push('## Methodology');
  md.push('');
  md.push('- TS test count via vitest --reporter=basic stdout regex match.');
  md.push('- Rust test count via cargo test --release stdout summation across `test result: ok. N passed` lines.');
  md.push('- File categories inferred from filename keywords (acceptance/integration/mutation/unit).');
  md.push('- Coverage = test-COUNT, not line-coverage. Use `c8` (TS) or `tarpaulin` (Rust) for line coverage.');
  md.push('');
  writeFileSync(join(OUT_DIR, 'TEST_COVERAGE.md'), md.join('\n'));
  console.log('');
  console.log(`Wrote ${join(OUT_DIR, 'TEST_COVERAGE.json')}`);
  console.log(`Wrote ${join(OUT_DIR, 'TEST_COVERAGE.md')}`);
}

function signed(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

await main();
