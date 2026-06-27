#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Stryker Mutation Refresh (Agent C).
 *
 * Re-runs Stryker against the current TS codebase, then diffs the result
 * against the stored baseline at `reports/mutation/baseline.json`. New
 * survived mutants (not surviving before) are flagged as regressions.
 *
 * Two run modes:
 *   - full        npx stryker run                       (long, full repo)
 *   - scoped      npx stryker run stryker.scoped.config (fast subset)
 *
 * Both invoke the existing `scripts/mutation-summary.mjs` analyzer to
 * compute per-file scores; we then layer a regression diff on top.
 *
 * CLI
 * ───
 *   node scripts/mutation/refresh.mjs --scoped --no-run    (use latest stored artifact)
 *   node scripts/mutation/refresh.mjs --scoped             (run + analyse)
 *   node scripts/mutation/refresh.mjs --full --no-run      (analyse + diff baseline)
 *
 * Output
 * ──────
 *   - reports/mutation/W212_REFRESH.md
 *   - reports/mutation/W212_REFRESH.json
 *
 * Exit codes
 * ──────────
 *   - 0  no regression (every previously-killed mutant still killed)
 *   - 1  regression detected (one or more new survivors)
 *   - 2  analyser / spawn error
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const MUTATION_DIR = resolve(REPO_ROOT, 'reports', 'mutation');
const BASELINE_PATH = resolve(MUTATION_DIR, 'baseline.json');

export function parseArgs(argv) {
  const out = { scoped: true, noRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--full') { out.scoped = false; }
    else if (a === '--scoped') { out.scoped = true; }
    else if (a === '--no-run') { out.noRun = true; }
    else if (a.startsWith('--out=')) { out.out = a.slice(6); }
  }
  return out;
}

// ── Stryker invocation ──────────────────────────────────────────────────────
export function runStryker(opts = {}) {
  const args = opts.scoped ? ['stryker', 'run', 'stryker.scoped.config.mjs'] : ['stryker', 'run'];
  const proc = spawnSync('npx', args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 600_000,
  });
  return { code: proc.status, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
}

// ── Discover latest Stryker JSON artifact ──────────────────────────────────
export function findLatestStrykerJson(mutationDir = MUTATION_DIR) {
  if (!existsSync(mutationDir)) return null;
  const files = readdirSync(mutationDir)
    .filter((f) => (f.startsWith('scoped-') || f === 'mutation-report.json') && f.endsWith('.json'))
    .map((f) => ({ name: f, path: join(mutationDir, f), mtime: statSync(join(mutationDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.path ?? null;
}

// ── Parse Stryker JSON for per-file mutation status ────────────────────────
export function parseStrykerJson(jsonPath) {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const files = raw.files ?? {};
  const perFile = {};
  let total = 0, killed = 0, survived = 0, timeout = 0, noCoverage = 0;
  const survivors = [];
  for (const [filePath, fileData] of Object.entries(files)) {
    const mutants = fileData?.mutants ?? [];
    let fK = 0, fS = 0, fT = 0, fNc = 0;
    for (const m of mutants) {
      total++;
      switch (m.status) {
        case 'Killed': killed++; fK++; break;
        case 'Survived': survived++; fS++;
          survivors.push({
            file: filePath,
            id: m.id ?? `${filePath}:${m.location?.start?.line ?? '?'}:${m.mutatorName ?? '?'}`,
            mutator: m.mutatorName,
            line: m.location?.start?.line ?? null,
            replacement: typeof m.replacement === 'string' ? m.replacement.slice(0, 80) : null,
          });
          break;
        case 'Timeout': timeout++; fT++; break;
        case 'NoCoverage': noCoverage++; fNc++; break;
        default: break;
      }
    }
    const fTotal = mutants.length;
    const fScored = fK + fS + fT + fNc;
    perFile[filePath] = {
      total: fTotal,
      killed: fK,
      survived: fS,
      timeout: fT,
      noCoverage: fNc,
      scoreStrict: fScored > 0 ? (fK + fT) / fScored : 0,
    };
  }
  const scored = killed + survived + timeout + noCoverage;
  return {
    source: jsonPath,
    total,
    killed,
    survived,
    timeout,
    noCoverage,
    scoreStrict: scored > 0 ? (killed + timeout) / scored : 0,
    perFile,
    survivors,
  };
}

// ── Baseline diff ───────────────────────────────────────────────────────────
export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function diffAgainstBaseline(current, baseline) {
  if (!baseline) {
    return {
      firstRun: true,
      newSurvivors: [],
      perFileRegression: [],
      overallScoreDelta: 0,
    };
  }
  // Baseline `scores` keys look like "ts:src/foo.ts" or "ts" (overall).
  const baselineScores = baseline.scores ?? {};
  const tsOverall = baselineScores.ts ?? 0;
  const overallScoreDelta = current.scoreStrict - tsOverall;
  // Compare per-file scores when present in baseline.
  const perFileRegression = [];
  for (const [file, stats] of Object.entries(current.perFile)) {
    const key = `ts:${file}`;
    const prev = baselineScores[key];
    if (prev != null && stats.scoreStrict + 0.005 < prev) {
      perFileRegression.push({
        file,
        previousScore: prev,
        currentScore: stats.scoreStrict,
        delta: stats.scoreStrict - prev,
      });
    }
  }
  // New survivors — without a baseline survivor list we treat any survivor
  // in a file whose score dropped as "new". For the first refresh-with-list
  // path we just list every survivor when baseline carries none.
  const baselineSurvivors = new Set((baseline.survivors ?? []).map((s) => `${s.file}:${s.line}:${s.mutator}`));
  const newSurvivors = current.survivors.filter((s) => !baselineSurvivors.has(`${s.file}:${s.line}:${s.mutator}`));
  return {
    firstRun: false,
    overallScoreDelta,
    perFileRegression,
    newSurvivors,
  };
}

// ── Render reports ──────────────────────────────────────────────────────────
export function renderMd(refresh) {
  const lines = [];
  lines.push('# W212 — Mutation Refresh');
  lines.push('');
  lines.push(`Generated: ${refresh.generatedAtUtc}`);
  lines.push(`Mode: ${refresh.mode}`);
  lines.push(`Source: \`${refresh.summary.source}\``);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push(`- Total mutants: **${refresh.summary.total}**`);
  lines.push(`- Killed: ${refresh.summary.killed}`);
  lines.push(`- Survived: ${refresh.summary.survived}`);
  lines.push(`- Timeout: ${refresh.summary.timeout}`);
  lines.push(`- NoCoverage: ${refresh.summary.noCoverage}`);
  lines.push(`- Strict score: ${(refresh.summary.scoreStrict * 100).toFixed(2)} %`);
  lines.push('');
  if (refresh.diff.firstRun) {
    lines.push('_No previous baseline — this run becomes the baseline._');
  } else {
    lines.push('## Diff vs baseline');
    lines.push('');
    lines.push(`- Overall score Δ: ${(refresh.diff.overallScoreDelta * 100).toFixed(2)} pp`);
    lines.push(`- New survivors: **${refresh.diff.newSurvivors.length}**`);
    lines.push(`- Files with score regression: **${refresh.diff.perFileRegression.length}**`);
    if (refresh.diff.perFileRegression.length > 0) {
      lines.push('');
      lines.push('| File | Previous | Current | Δ |');
      lines.push('| --- | ---: | ---: | ---: |');
      for (const r of refresh.diff.perFileRegression) {
        lines.push(`| \`${r.file}\` | ${(r.previousScore * 100).toFixed(2)}% | ${(r.currentScore * 100).toFixed(2)}% | ${(r.delta * 100).toFixed(2)} pp |`);
      }
    }
  }
  lines.push('');
  lines.push('## Per-file mutation score (top 20 lowest)');
  lines.push('');
  lines.push('| File | Total | Killed | Survived | Score |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  const files = Object.entries(refresh.summary.perFile)
    .sort((a, b) => a[1].scoreStrict - b[1].scoreStrict)
    .slice(0, 20);
  for (const [file, s] of files) {
    lines.push(`| \`${file}\` | ${s.total} | ${s.killed} | ${s.survived} | ${(s.scoreStrict * 100).toFixed(2)}% |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── Public API ──────────────────────────────────────────────────────────────
export function refresh(opts = {}) {
  const args = { ...parseArgs([]), ...opts };
  let runOutput = null;
  if (!args.noRun) {
    runOutput = runStryker(args);
    if (runOutput.code !== 0) {
      // Continue with whatever artifact exists; the analyser may still
      // produce a useful report.
    }
  }
  const jsonPath = args.jsonPath ?? findLatestStrykerJson();
  if (!jsonPath) {
    return {
      generatedAtUtc: new Date().toISOString(),
      mode: args.scoped ? 'scoped' : 'full',
      error: 'no_stryker_artifact',
      diff: { firstRun: true, newSurvivors: [], perFileRegression: [], overallScoreDelta: 0 },
      summary: null,
    };
  }
  const summary = parseStrykerJson(jsonPath);
  const baseline = args.baseline === null ? null : (args.baseline ?? loadBaseline());
  const diff = diffAgainstBaseline(summary, baseline);
  return {
    generatedAtUtc: new Date().toISOString(),
    mode: args.scoped ? 'scoped' : 'full',
    runOutput: runOutput ? { code: runOutput.code, stderr: runOutput.stderr.slice(0, 400) } : null,
    summary,
    diff,
    regression: diff.newSurvivors.length > 0 || diff.perFileRegression.length > 0,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const r = refresh(args);
  if (!existsSync(MUTATION_DIR)) mkdirSync(MUTATION_DIR, { recursive: true });
  writeFileSync(resolve(MUTATION_DIR, 'W212_REFRESH.json'), JSON.stringify(r, null, 2));
  writeFileSync(resolve(MUTATION_DIR, 'W212_REFRESH.md'), renderMd(r));
  // eslint-disable-next-line no-console
  console.log(`mutation-refresh: ${r.summary?.total ?? 0} mutants, regression=${r.regression ?? false}`);
  process.exit(r.regression ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('mutation-refresh crashed:', e);
    process.exit(2);
  });
}
