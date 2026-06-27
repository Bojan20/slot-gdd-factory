#!/usr/bin/env node
//
// W152 Wave 17 — Mutation score consolidated report (Faza 10.7 acceptance).
//
// Faza 10.7 acceptance: "mutation score ≥ 95 % obe runtime". Status was ⚠️
// because no consolidated report existed — individual TS Stryker JSON
// dumps and Rust cargo-mutants outcomes lived under
// `reports/mutation/{scoped-*.json, rust/<crate>/mutants.out/outcomes.json}`,
// but no single dossier collated them with a verdict.
//
// This script reads the latest stored mutation artifacts and produces:
//   * `reports/mutation/SUMMARY.json` — machine-readable per-target
//     killed/survived/timeout/coverage tally.
//   * `reports/mutation/SUMMARY.md`   — markdown verdict for PR review,
//     master_todo and audit dossiers.
//
// Re-run cadence:
//   * After every `npm run mutate:scoped` or `npm run mutate:rust`,
//     re-run this script. It's a pure read of stored JSONs — fast.
//   * CI can invoke it to fail-build on a score regression vs the
//     committed SUMMARY.json.
//
// Pure read — no mutation engine spawned. Fast (< 1 s).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '..', '..');
const MUTATION_DIR = join(REPO_ROOT, 'reports', 'mutation');

// ── TS Stryker parser (scoped JSON dumps) ────────────────────────────────
// Stryker JSON shape: { files: { "<path>": { mutants: [{status, ...}] } } }

function parseStryker(jsonPath) {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const files = raw.files ?? {};
  const perFile = [];
  let killed = 0, survived = 0, timeout = 0, noCoverage = 0, ignored = 0, runtimeErr = 0, other = 0;
  let total = 0;
  for (const [filePath, fileData] of Object.entries(files)) {
    const mutants = fileData?.mutants ?? [];
    let fKilled = 0, fSurvived = 0, fTimeout = 0, fNoCov = 0, fIgnored = 0, fRuntimeErr = 0, fOther = 0;
    for (const m of mutants) {
      total++;
      switch (m.status) {
        case 'Killed': killed++; fKilled++; break;
        case 'Survived': survived++; fSurvived++; break;
        case 'Timeout': timeout++; fTimeout++; break;
        case 'NoCoverage': noCoverage++; fNoCov++; break;
        case 'Ignored': ignored++; fIgnored++; break;
        case 'RuntimeError': runtimeErr++; fRuntimeErr++; break;
        case 'CompileError': runtimeErr++; fRuntimeErr++; break;
        default: other++; fOther++; break;
      }
    }
    const fTotal = mutants.length;
    const fScored = fTotal - fIgnored - fRuntimeErr - fOther;
    const fScoreStrict = fScored > 0 ? (fKilled + fTimeout) / fScored : 0;
    const fScoreLenient = fScored - fNoCov > 0 ? (fKilled + fTimeout) / (fScored - fNoCov) : 0;
    perFile.push({
      file: filePath,
      total: fTotal,
      killed: fKilled,
      survived: fSurvived,
      timeout: fTimeout,
      noCoverage: fNoCov,
      ignored: fIgnored,
      runtimeError: fRuntimeErr,
      scoreStrict: fScoreStrict,
      scoreLenient: fScoreLenient,
    });
  }
  const scored = total - ignored - runtimeErr - other;
  const scoreStrict = scored > 0 ? (killed + timeout) / scored : 0;
  const scoreLenient = scored - noCoverage > 0 ? (killed + timeout) / (scored - noCoverage) : 0;
  return {
    runtime: 'typescript',
    tool: 'stryker',
    source: jsonPath,
    total,
    killed,
    survived,
    timeout,
    noCoverage,
    ignored,
    runtimeError: runtimeErr,
    other,
    scoreStrict,
    scoreLenient,
    perFile,
  };
}

// ── Rust cargo-mutants parser (outcomes.json) ────────────────────────────
// outcomes.json shape: { total_mutants, caught, missed, timeout, unviable,
//                        success, outcomes: [...] }

function parseCargoMutants(outcomesPath) {
  const raw = JSON.parse(readFileSync(outcomesPath, 'utf-8'));
  const total = raw.total_mutants ?? 0;
  const caught = raw.caught ?? 0;
  const missed = raw.missed ?? 0;
  const timeout = raw.timeout ?? 0;
  const unviable = raw.unviable ?? 0;
  const success = raw.success ?? 0; // mutant compiled + tests passed → SURVIVED
  // Strict score: caught / (caught + missed + timeout + success), excluding unviable.
  // Strictly speaking `success` and `missed` both indicate survived mutants under
  // cargo-mutants semantics (test suite did not catch the mutation). We treat
  // both as "not killed" for the strict pass-rate computation.
  const scored = caught + missed + timeout + success;
  const scoreStrict = scored > 0 ? (caught + timeout) / scored : 0;
  return {
    runtime: 'rust',
    tool: 'cargo-mutants',
    source: outcomesPath,
    total,
    caught,
    missed,
    timeout,
    unviable,
    success,
    scoreStrict,
  };
}

// ── Discover newest TS Stryker JSON ──────────────────────────────────────

function newestStrykerJson() {
  if (!existsSync(MUTATION_DIR)) return null;
  const candidates = readdirSync(MUTATION_DIR)
    .filter((f) => f.startsWith('scoped-') && f.endsWith('.json'))
    .map((f) => ({ name: f, path: join(MUTATION_DIR, f), mtime: statSync(join(MUTATION_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

// ── Discover Rust outcomes JSONs ─────────────────────────────────────────

function discoverRustOutcomes() {
  const rustDir = join(MUTATION_DIR, 'rust');
  if (!existsSync(rustDir)) return [];
  return readdirSync(rustDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'old' && !d.name.startsWith('.'))
    .map((d) => {
      const p = join(rustDir, d.name, 'mutants.out', 'outcomes.json');
      return existsSync(p) ? { crate: d.name, path: p } : null;
    })
    .filter((x) => x !== null);
}

// ── Markdown render ──────────────────────────────────────────────────────

function pct(x) {
  return (x * 100).toFixed(2) + ' %';
}

function renderMd(summary) {
  const lines = [];
  lines.push('# Mutation Testing Consolidated Report');
  lines.push('');
  lines.push(`> **W152 Wave 17 — Faza 10.7 acceptance proof.** Generated ${summary.generatedAtUtc} from stored mutation artifacts. Pure read — no mutation engine spawned.`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  if (summary.typescript) {
    const ts = summary.typescript;
    lines.push(
      `* **TypeScript (Stryker scoped)**: ${ts.killed + ts.timeout} / ${ts.killed + ts.timeout + ts.survived + ts.noCoverage} mutants killed → strict ${pct(ts.scoreStrict)} / lenient ${pct(ts.scoreLenient)}.`,
    );
  } else {
    lines.push('* **TypeScript**: no Stryker artifact found. Run `npm run mutate:scoped` first.');
  }
  if (summary.rust && summary.rust.length > 0) {
    for (const r of summary.rust) {
      lines.push(
        `* **Rust ${r.crate}** (cargo-mutants): ${r.caught + r.timeout} / ${r.caught + r.timeout + r.missed + r.success} scored mutants killed → strict ${pct(r.scoreStrict)}.`,
      );
    }
  } else {
    lines.push('* **Rust**: no `mutants.out/outcomes.json` found under `reports/mutation/rust/<crate>/`.');
  }
  lines.push('');
  lines.push('## Pass/fail vs Faza 10.7 acceptance');
  lines.push('');
  lines.push('Acceptance: mutation score ≥ 95 % both runtimes.');
  lines.push('');
  lines.push('| Runtime | Strict score | Faza 10.7 ≥ 95 % | Notes |');
  lines.push('|---|---:|:---:|---|');
  if (summary.typescript) {
    const ts = summary.typescript;
    const ok = ts.scoreStrict >= 0.95;
    lines.push(`| TypeScript (Stryker scoped) | ${pct(ts.scoreStrict)} | ${ok ? '✅' : '⚠️'} | scoped to RG/sensitivity hot-paths |`);
  }
  if (summary.rust) {
    for (const r of summary.rust) {
      const ok = r.scoreStrict >= 0.95;
      lines.push(`| Rust \`${r.crate}\` | ${pct(r.scoreStrict)} | ${ok ? '✅' : '⚠️'} | `);
    }
  }
  lines.push('');
  lines.push('## Per-file detail (TypeScript)');
  lines.push('');
  if (summary.typescript) {
    lines.push('| File | Mutants | Killed | Survived | NoCov | Strict | Lenient |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const f of summary.typescript.perFile.sort((a, b) => a.scoreStrict - b.scoreStrict)) {
      lines.push(
        `| \`${f.file}\` | ${f.total} | ${f.killed} | ${f.survived} | ${f.noCoverage} | ${pct(f.scoreStrict)} | ${pct(f.scoreLenient)} |`,
      );
    }
  } else {
    lines.push('_(no Stryker artifact)_');
  }
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('* **TS source**: latest `reports/mutation/scoped-*.json` (most recent mtime). Strict score = (killed + timeout) / (killed + survived + timeout + noCoverage). Lenient excludes `noCoverage` from denominator.');
  lines.push('* **Rust source**: each `reports/mutation/rust/<crate>/mutants.out/outcomes.json`. Strict score = (caught + timeout) / (caught + missed + timeout + success). `success` = mutant compiled + tests passed → counts as SURVIVED.');
  lines.push('* **Re-generation**: `npm run mutation-summary` after every fresh `mutate:scoped` or `mutate:rust` run. CI can diff committed SUMMARY.json to detect score regressions.');
  lines.push('');
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(MUTATION_DIR)) mkdirSync(MUTATION_DIR, { recursive: true });

  const tsJson = newestStrykerJson();
  const tsSummary = tsJson ? parseStryker(tsJson) : null;
  if (tsJson) console.log(`TS: parsed ${tsJson}`);
  else console.log('TS: no Stryker artifact found.');

  const rustOutcomes = discoverRustOutcomes();
  const rustSummary = rustOutcomes.map(({ crate, path }) => ({ crate, ...parseCargoMutants(path) }));
  for (const r of rustSummary) console.log(`Rust ${r.crate}: parsed ${r.source}`);
  if (rustSummary.length === 0) console.log('Rust: no outcomes.json found.');

  const summary = {
    generatedAtUtc: new Date().toISOString(),
    typescript: tsSummary,
    rust: rustSummary,
  };

  writeFileSync(join(MUTATION_DIR, 'SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  writeFileSync(join(MUTATION_DIR, 'SUMMARY.md'), renderMd(summary), 'utf-8');
  console.log('');
  console.log(`Wrote ${join(MUTATION_DIR, 'SUMMARY.json')}`);
  console.log(`Wrote ${join(MUTATION_DIR, 'SUMMARY.md')}`);
}

main();
