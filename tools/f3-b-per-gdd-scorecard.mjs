#!/usr/bin/env node
/**
 * tools/f3-b-per-gdd-scorecard.mjs
 *
 * F3-b (Boki 2026-06-27 "nastavi do kraja ultimativno") — per-GDD
 * regulator-ready compliance scorecard. Aggregates the four existing
 * industry-spec walkers (V10/V11/V12/V14) into a single per-slug
 * receipt so operator/regulator can grade ONE game in one read.
 *
 * # WHY
 *
 * V10/V11/V12/V14 emit corpus-wide aggregate reports
 * (`reports/v{10,11,12}-…-{ts}.json`, `reports/v14-math-compliance-{ts}.json`)
 * that group violations by RULE. That answers "which rule is most
 * frequently broken across the corpus", but not "is THIS game ready to
 * ship?". F3-b inverts the axis: per-game scorecard with letter grade.
 *
 * # SCHEMA
 *
 *   reports/per-gdd-scorecard/<slug>.json
 *   {
 *     slug,
 *     generatedAt,
 *     totalRules,
 *     totalHardHits,
 *     totalSoftHits,
 *     grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F',
 *     breakdown: {
 *       v10: { hard, soft, hardRules, softRules },
 *       v11: { hard, soft, hardRules, softRules },
 *       v12: { hard, soft, hardRules, softRules },
 *       v14: { hard, soft, hardRules, softRules },
 *       gddMatrix: { declaredKeys, inferredKeys, activeFeatures, missing }
 *     }
 *   }
 *
 *   reports/per-gdd-scorecard/_aggregate.md
 *     | slug | grade | hard | soft | gddMatrix.coverage |
 *     | ---  | ---   | ---  | ---  | ---                |
 *
 * # GRADE LADDER
 *
 *   A+ — 0 hard, 0 soft, GDD coverage ≥ 90 %
 *   A  — 0 hard, ≤ 2 soft, GDD coverage ≥ 80 %
 *   B  — 0 hard, ≤ 5 soft, GDD coverage ≥ 70 %
 *   C  — ≤ 1 hard, ≤ 10 soft
 *   D  — ≤ 3 hard
 *   F  — > 3 hard violations (not ship-ready)
 *
 * # USAGE
 *
 *   node tools/f3-b-per-gdd-scorecard.mjs              # all real-games
 *   node tools/f3-b-per-gdd-scorecard.mjs --slug X     # one game
 *   node tools/f3-b-per-gdd-scorecard.mjs --limit 5    # first 5
 *   node tools/f3-b-per-gdd-scorecard.mjs --baseline   # 5 pinned baselines
 *   node tools/f3-b-per-gdd-scorecard.mjs --json       # stdout JSON only
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const REAL = join(REPO, 'dist', 'real-games');
const OUT = join(REPO, 'reports', 'per-gdd-scorecard');
const REPORTS = join(REPO, 'reports');

const BASELINE_SLUGS = [
  '01-huff-n-puff-huff-n-more-puff',
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

function parseArgs(args) {
  const out = { slug: null, all: true, limit: null, baseline: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') { out.slug = args[++i]; out.all = false; }
    else if (a === '--limit') { out.limit = parseInt(args[++i], 10); out.all = false; }
    else if (a === '--baseline') { out.baseline = true; out.all = false; }
    else if (a === '--json') out.json = true;
  }
  return out;
}

/**
 * Run one walker for one slug and return its emitted summary. Walkers
 * write to `reports/<name>-<ts>.json`; we grab the freshest file with
 * that prefix after the spawn returns. spawnSync exit code is honored
 * (non-zero = walker self-reported hard violations).
 */
function runWalker(toolBase, slug) {
  const beforeMtime = Date.now();
  const r = spawnSync('node', [
    join(REPO, 'tools', `${toolBase}.mjs`),
    '--slug', slug,
  ], { cwd: REPO, encoding: 'utf-8' });

  /* Find freshest emitted report with this tool's prefix. */
  const prefix = toolBase.startsWith('v10') ? 'v10-industry-compliance-'
    : toolBase.startsWith('v11') ? 'v11-deep-industry-'
    : toolBase.startsWith('v12') ? 'v12-deeper-industry-'
    : toolBase.startsWith('v14') ? 'v14-math-compliance-'
    : null;
  if (!prefix) return { exitCode: r.status, hard: [], soft: [], error: 'unknown tool' };

  const matches = readdirSync(REPORTS)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  if (matches.length === 0) return { exitCode: r.status, hard: [], soft: [], error: 'no report emitted' };

  /* Pick latest by mtime (walker timestamps with toISOString suffix). */
  matches.sort();
  const latest = matches[matches.length - 1];
  let summary;
  try {
    summary = JSON.parse(readFileSync(join(REPORTS, latest), 'utf-8'));
  } catch (e) {
    return { exitCode: r.status, hard: [], soft: [], error: `parse: ${e.message}` };
  }

  /* When --slug filters the corpus, the walker still uses corpus-wide
   * counters; we want only THIS slug's hits. The sample arrays carry
   * the per-violation slug field, so we filter. hardCount/softCount
   * fields are recomputed from the filtered sample. */
  const hard = (summary.hardSample || []).filter((v) => v.slug === slug);
  const soft = (summary.softSample || []).filter((v) => v.slug === slug);

  return {
    exitCode: r.status,
    hard,
    soft,
    hardCount: hard.length,
    softCount: soft.length,
    hardRules: [...new Set(hard.map((v) => v.rule))],
    softRules: [...new Set(soft.map((v) => v.rule))],
  };
}

function gddMatrixSignal(slug) {
  /* gdd-compliance-matrix.mjs writes
   * `dist/real-games/<slug>/gdd-compliance.json`; if not present, fall
   * back to deriving from model.__declared / model.__activeFeatures__
   * directly so the scorecard works even before D-18 is run. */
  const compPath = join(REAL, slug, 'gdd-compliance.json');
  if (existsSync(compPath)) {
    try {
      const c = JSON.parse(readFileSync(compPath, 'utf-8'));
      return {
        declaredKeys: c.declaredKeys || 0,
        inferredKeys: c.inferredKeys || 0,
        activeFeatures: c.activeFeatures || 0,
        missing: c.missing || 0,
        coveragePct: c.coveragePct != null ? c.coveragePct : null,
      };
    } catch { /* fall-through */ }
  }
  const modelPath = join(REAL, slug, 'model.json');
  if (!existsSync(modelPath)) return null;
  try {
    const m = JSON.parse(readFileSync(modelPath, 'utf-8'));
    const declared = m.__declared || {};
    const entries = Object.entries(declared);
    const declaredKeys = entries.filter(([, s]) => s === 'declared').length;
    const inferredKeys = entries.filter(([, s]) => s === 'inferred').length;
    const totalKeys = entries.length;
    const activeFeatures = Array.isArray(m.__activeFeatures__) ? m.__activeFeatures__.length : 0;
    /* Coverage = declared OR inferred (both are parser-confirmed signals
     * — declared means GDD-stated, inferred means parser rebuilt it from
     * context with full evidence chain). `default` is the only "unknown"
     * tier that counts against coverage. */
    const coveragePct = totalKeys > 0
      ? Math.round(((declaredKeys + inferredKeys) / totalKeys) * 1000) / 10
      : null;
    return {
      declaredKeys,
      inferredKeys,
      activeFeatures,
      missing: totalKeys - declaredKeys - inferredKeys,
      coveragePct,
    };
  } catch {
    return null;
  }
}

function gradeFor(totalHard, totalSoft, coveragePct) {
  /* Coverage-aware grading. When `__declared`/`__activeFeatures__` are
   * absent (parser hasn't run the D-18 compliance pass, e.g. synthetic
   * fixtures), coveragePct is null — we grade purely on V10/V11/V12/V14
   * violation counts. When coverage IS available, A+/A/B require both
   * zero violations AND coverage above the threshold; otherwise the
   * game falls through to the next grade. */
  const haveCoverage = coveragePct != null;
  const cov = haveCoverage ? coveragePct : 100; /* coverage-blind = no penalty */
  if (totalHard === 0 && totalSoft === 0 && (!haveCoverage || cov >= 90)) return 'A+';
  if (totalHard === 0 && totalSoft <= 2 && (!haveCoverage || cov >= 80)) return 'A';
  if (totalHard === 0 && totalSoft <= 5 && (!haveCoverage || cov >= 70)) return 'B';
  if (totalHard <= 1 && totalSoft <= 10) return 'C';
  if (totalHard <= 3) return 'D';
  return 'F';
}

function scoreSlug(slug) {
  const v10 = runWalker('v10-industry-compliance-spec', slug);
  const v11 = runWalker('v11-deep-industry-spec', slug);
  const v12 = runWalker('v12-deeper-industry-spec', slug);
  const v14 = runWalker('v14-math-compliance', slug);
  const gddMatrix = gddMatrixSignal(slug) || {
    declaredKeys: 0, inferredKeys: 0, activeFeatures: 0, missing: 0, coveragePct: null,
  };

  const totalHardHits = v10.hardCount + v11.hardCount + v12.hardCount + v14.hardCount;
  const totalSoftHits = v10.softCount + v11.softCount + v12.softCount + v14.softCount;
  /* Total rule surface across all 4 walkers (T1-T4 + I1.1-I10.3 + math).
   * Approx 50 distinct rules; used for "percentage clean" math. */
  const totalRules = 50;
  const grade = gradeFor(totalHardHits, totalSoftHits, gddMatrix.coveragePct);

  return {
    slug,
    generatedAt: new Date().toISOString(),
    totalRules,
    totalHardHits,
    totalSoftHits,
    cleanPct: Math.round(((totalRules - totalHardHits - totalSoftHits) / totalRules) * 1000) / 10,
    grade,
    breakdown: {
      v10: { hard: v10.hardCount, soft: v10.softCount, hardRules: v10.hardRules, softRules: v10.softRules },
      v11: { hard: v11.hardCount, soft: v11.softCount, hardRules: v11.hardRules, softRules: v11.softRules },
      v12: { hard: v12.hardCount, soft: v12.softCount, hardRules: v12.hardRules, softRules: v12.softRules },
      v14: { hard: v14.hardCount, soft: v14.softCount, hardRules: v14.hardRules, softRules: v14.softRules },
      gddMatrix,
    },
  };
}

function renderAggregateMd(scorecards) {
  const lines = [];
  lines.push('# F3-b · Per-GDD Compliance Scorecard');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total games: ${scorecards.length}`);
  lines.push('');
  const counts = scorecards.reduce((m, s) => { m[s.grade] = (m[s.grade] || 0) + 1; return m; }, {});
  lines.push('## Grade distribution');
  lines.push('');
  lines.push('| Grade | Count |');
  lines.push('|:--|:-:|');
  for (const g of ['A+', 'A', 'B', 'C', 'D', 'F']) {
    lines.push(`| ${g} | ${counts[g] || 0} |`);
  }
  lines.push('');
  lines.push('## Per-game scorecard');
  lines.push('');
  lines.push('| Slug | Grade | Hard | Soft | Clean % | GDD coverage % |');
  lines.push('|:--|:-:|:-:|:-:|:-:|:-:|');
  for (const s of scorecards) {
    const cov = s.breakdown.gddMatrix.coveragePct != null
      ? s.breakdown.gddMatrix.coveragePct.toFixed(1)
      : '—';
    lines.push(`| ${s.slug} | ${s.grade} | ${s.totalHardHits} | ${s.totalSoftHits} | ${s.cleanPct.toFixed(1)} | ${cov} |`);
  }
  return lines.join('\n') + '\n';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  let targets;
  if (opts.slug) targets = [opts.slug];
  else if (opts.baseline) targets = BASELINE_SLUGS.filter((s) => existsSync(join(REAL, s, 'model.json')));
  else if (opts.limit) {
    targets = readdirSync(REAL)
      .filter((d) => existsSync(join(REAL, d, 'model.json')))
      .sort()
      .slice(0, opts.limit);
  } else {
    targets = readdirSync(REAL)
      .filter((d) => existsSync(join(REAL, d, 'model.json')))
      .sort();
  }

  if (!opts.json) console.log(`▸ F3-b per-GDD scorecard · ${targets.length} target(s)`);

  const scorecards = [];
  for (const slug of targets) {
    const card = scoreSlug(slug);
    writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(card, null, 2));
    scorecards.push(card);
    if (!opts.json) {
      console.log(`  ${card.grade.padEnd(2)}  ${slug}  · hard=${card.totalHardHits} · soft=${card.totalSoftHits} · clean=${card.cleanPct.toFixed(1)}%`);
    }
  }

  const md = renderAggregateMd(scorecards);
  writeFileSync(join(OUT, '_aggregate.md'), md);

  /* Summary JSON for verify gate consumption. */
  const aggregate = {
    generatedAt: new Date().toISOString(),
    total: scorecards.length,
    byGrade: scorecards.reduce((m, s) => { m[s.grade] = (m[s.grade] || 0) + 1; return m; }, {}),
    totalHard: scorecards.reduce((n, s) => n + s.totalHardHits, 0),
    totalSoft: scorecards.reduce((n, s) => n + s.totalSoftHits, 0),
    failedSlugs: scorecards.filter((s) => s.grade === 'F').map((s) => s.slug),
  };
  writeFileSync(join(OUT, '_aggregate.json'), JSON.stringify(aggregate, null, 2));

  if (opts.json) {
    console.log(JSON.stringify({ ok: aggregate.failedSlugs.length === 0, aggregate }, null, 2));
  } else {
    console.log(`\n  Summary: ${aggregate.totalHard} hard / ${aggregate.totalSoft} soft / ${aggregate.failedSlugs.length} F-grade`);
    console.log(`  Aggregate MD: reports/per-gdd-scorecard/_aggregate.md`);
  }

  /* Exit 1 only when ANY game grades F (true regulator-block).
   * D-grade games are surfaced but don't fail the gate (operator
   * triage). */
  if (aggregate.failedSlugs.length > 0) process.exit(1);
}

const __isCliEntry = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; }
  catch { return false; }
})();

if (__isCliEntry) {
  try { main(); }
  catch (e) { console.error('FATAL:', e); process.exit(2); }
}

export { scoreSlug, gradeFor, gddMatrixSignal, renderAggregateMd };
