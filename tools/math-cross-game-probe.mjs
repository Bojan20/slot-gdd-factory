#!/usr/bin/env node
/**
 * tools/math-cross-game-probe.mjs
 *
 * MATH-DEEP CROSS-GAME (2026-06-22) — Multi-game RTP comparative probe.
 *
 * Purpose
 *   Run the existing math-rtp-probe across all 5 baseline GDDs (or a custom
 *   set) and produce a comparative report: measured RTP vs declared RTP,
 *   hit frequency delta, max single-spin payout, longest dry streak.
 *
 * Why
 *   Single-game probe (Cash Eruption only) doesn't surface engine
 *   regressions on other topologies (6×5 tumble, cluster, ways, lock_respin).
 *   Cross-game probe catches "plugin works for Cash Eruption but breaks on
 *   Wrath of Olympus" cases before they hit production. Also gives Boki a
 *   one-page summary of where each game stands.
 *
 * Public API
 *   - probeGame(slug, opts) -> probe report (calls math-rtp-probe.mjs)
 *   - generateComparativeReport(slugs, opts) -> { games, summary, exit }
 *
 * Output
 *   reports/cross-game-rtp/cross-game-<ts>.json
 *   stdout: ASCII table with measured/declared/delta per game
 *
 * Exit codes
 *   0 — all probes ran successfully (deltas may be off-target; informational)
 *   1 — at least one game's probe failed (model missing, probe error)
 *   2 — missing required slugs (run parse-real-pdfs.mjs first)
 *
 * CLI
 *   node tools/math-cross-game-probe.mjs                # 5 baselines, default
 *   node tools/math-cross-game-probe.mjs --slugs A,B,C  # custom set
 *   node tools/math-cross-game-probe.mjs --runs 50000   # spin count per game
 *
 * Lifecycle
 *   - Each game's probe is independent (separate process + RNG seed for
 *     reproducibility). Per-game reports go to reports/math-rtp/<slug>.json
 *     (shared with the single-game probe). Cross-game runs are SERIAL by
 *     design; concurrent invocations on overlapping slug sets would race
 *     on per-game report paths. The cross-game SUMMARY itself is timestamp-
 *     suffixed in reports/cross-game-rtp/ (no collision risk).
 *   - Cross-game summary aggregates across all probed games.
 *   - Self-test verifies all 5 baselines parse + produce a non-zero RTP.
 *
 * Performance budget
 *   Each game: ~100ms for 50k spins. Total 5 games × 100ms = ~500ms.
 *
 * HARD RULE #1
 *   No vendor names in summary output — only internal slug + topology kind.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const RTP_REPORTS = join(REPO, 'reports/math-rtp');
const OUT_DIR = join(REPO, 'reports/cross-game-rtp');

const BASELINE_SLUGS = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};

/* ── Per-game probe ───────────────────────────────────────────────────── */

/* Slug regex per UQ-FORTIFY9 NFKD normalization rule. Enforces:
 *   - lowercase alphanumeric + dash + underscore only
 *   - starts with alphanumeric (no leading dash/dot)
 *   - length 2..80 chars
 * Prevents path traversal (../etc/passwd) and shell metacharacter injection. */
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,79}$/;

/**
 * Run math-rtp-probe.mjs for one slug, return its report.
 *
 * Returns { ok: true, report: <json> } on success.
 * Returns { ok: false, error: <msg> } on failure.
 *
 * SECURITY (QA Agent#4 finding #6, 2026-06-22 ultra-deep): rejects slugs
 * containing path traversal sequences (../) or shell metacharacters (;|`).
 * Slug MUST match the canonical NFKD slug regex.
 */
export function probeGame(slug, opts = {}) {
  const { runs = 50000, seed = 42, bet = 1, kernelPreflight = false } = opts;
  if (typeof slug !== 'string' || !SAFE_SLUG_RE.test(slug)) {
    return { ok: false, error: `invalid slug "${slug}" — must match ${SAFE_SLUG_RE}` };
  }
  const slugDir = join(REAL_GAMES, slug);
  /* Path containment check: resolved slugDir MUST be inside REAL_GAMES. */
  const resolvedSlugDir = resolve(slugDir);
  if (!resolvedSlugDir.startsWith(resolve(REAL_GAMES) + '/')) {
    return { ok: false, error: `slug ${slug} resolves outside REAL_GAMES sandbox` };
  }
  if (!existsSync(slugDir) || !existsSync(join(slugDir, 'model.json'))) {
    return { ok: false, error: `slug ${slug} missing model.json (run parse-real-pdfs.mjs)` };
  }
  const probe = join(REPO, 'tools/math-rtp-probe.mjs');
  /* 2026-06-23: cross-game probe always enables --auto-clamp so the
   * comparative report shows declared-target-aligned RTP for declared
   * games. Single-game probe defaults to raw (opt-in); cross-game wants
   * the calibrated view by default.
   *
   * Optional --kernel-preflight (B+++) attaches sister-repo analytical
   * RTP per game to the comparative report. Parsed from probe stdout via
   * the "H&W kernel:" / "Cluster kernel:" lines emitted in preflight
   * section. */
  const probeArgs = [
    `--slug=${slug}`,
    `--runs=${runs}`,
    `--seed=${seed}`,
    `--bet=${bet}`,
    '--auto-clamp',
  ];
  if (kernelPreflight) probeArgs.push('--kernel-preflight');
  const r = spawnSync('node', [probe, ...probeArgs],
    { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    return { ok: false, error: `probe exit ${r.status}: ${(r.stderr || '').slice(0, 200)}` };
  }
  const reportPath = join(RTP_REPORTS, `${slug}.json`);
  if (!existsSync(reportPath)) {
    return { ok: false, error: `report not generated at ${reportPath}` };
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    /* When --kernel-preflight was passed, parse the analytical RTP lines
     * from probe stdout and attach to report.kernel. Regex matches both:
     *   H&W kernel:     rtpContrib 2.9580%  (money 1.8580% + jackpot 1.1000%)
     *   Cluster kernel: rtpContrib 6.1630× bet  (perSymbol 8 entries, ...)
     * Result preserves raw lines + a numeric extraction. */
    if (kernelPreflight) {
      const kernel = { lines: [] };
      const hwM = r.stdout.match(/H&W kernel:\s+rtpContrib\s+([\d.]+)%/);
      if (hwM) kernel.hwRtpPct = parseFloat(hwM[1]);
      const clM = r.stdout.match(/Cluster kernel:\s+rtpContrib\s+([\d.]+)×\s+bet/);
      if (clM) kernel.clusterRtpXBet = parseFloat(clM[1]);
      const stdoutLines = r.stdout.split('\n').filter(l =>
        l.includes('H&W kernel:') || l.includes('Cluster kernel:') || l.includes('KERNEL PRE-FLIGHT'));
      kernel.lines = stdoutLines;
      report._kernelPreflight = kernel;
    }
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: `report parse failed: ${e.message}` };
  }
}

/* ── Topology classification (vendor-neutral) ──────────────────────────── */

function topologyKind(model) {
  const t = model.topology || {};
  if (t.is_plinko) return 'plinko';
  if (t.is_slingo) return 'slingo';
  if (t.is_hex)    return 'hex';
  if (t.is_wheel)  return 'wheel';
  if (t.is_radial) return 'radial';
  if (t.is_crash)  return 'crash';
  const kind = (t.kind || t.evaluation || '').toString().toLowerCase();
  if (kind.includes('cluster'))   return 'cluster';
  if (kind.includes('cascade'))   return 'cascade';
  if (kind.includes('tumble'))    return 'tumble';
  if (kind.includes('lock'))      return 'lock_respin';
  if (kind.includes('ways'))      return 'ways';
  return 'lines';
}

/* ── Comparative report ───────────────────────────────────────────────── */

export function generateComparativeReport(slugs, opts = {}) {
  const games = [];
  let exit = 0;
  for (const slug of slugs) {
    const r = probeGame(slug, opts);
    if (!r.ok) {
      games.push({ slug, ok: false, error: r.error });
      exit = 1;
      continue;
    }
    const rep = r.report;
    const modelPath = join(REAL_GAMES, slug, 'model.json');
    let topo = 'unknown', topoKind = 'unknown';
    try {
      const model = JSON.parse(readFileSync(modelPath, 'utf8'));
      topo = `${model.topology?.reels || '?'}x${model.topology?.rows || '?'}`;
      topoKind = topologyKind(model);
    } catch { /* ignore */ }
    /* Kernel comparison: ANALYTICAL component RTP from sister-repo kernels
     * alongside MEASURED total RTP from probe. Kernels operate on SYNTHETIC
     * percolation/value distributions (no real par-sheet data) — analytical
     * numbers are illustrative, NOT a regression signal vs measured total.
     * Real disagreement detection requires par-sheet-derived distributions
     * (future enhancement when PAR upload pipeline lands per-game).
     *
     * For now: just stash both numbers + synthetic flag for operator review. */
    const kernel = rep._kernelPreflight;
    let kernelComparison = null;
    if (kernel) {
      if (Number.isFinite(kernel.hwRtpPct)) {
        kernelComparison = {
          source: 'hw',
          analyticalPctOfComponent: kernel.hwRtpPct,
          measuredPctOfTotalRtp: rep.measuredRTP,
          isSyntheticDistribution: true,
          note: 'analytical is H&W-component-only; measured is total RTP — direct subtraction not meaningful without par-sheet data',
        };
      } else if (Number.isFinite(kernel.clusterRtpXBet)) {
        kernelComparison = {
          source: 'cluster',
          analyticalXBetTotal: kernel.clusterRtpXBet,
          analyticalPctEquivalent: +(kernel.clusterRtpXBet * 100).toFixed(2),
          measuredPctOfTotalRtp: rep.measuredRTP,
          isSyntheticDistribution: true,
          note: 'analytical from synthetic percolation approximation; supply empirical clusterCountDistribution via API for real comparison',
        };
      }
    }
    games.push({
      slug,
      ok: true,
      topology: topo,
      topologyKind: topoKind,
      measuredRTP: rep.measuredRTP,
      declaredRTP: rep.declaredRTP,
      declaredRTPSource: rep.declaredRTPSource ?? null,
      declaredRTPIsSynthetic: rep.declaredRTPIsSynthetic ?? false,
      rtpDelta: rep.rtpDelta,
      measuredHF: rep.measuredHF,
      declaredHF: rep.declaredHF,
      hfDelta: rep.hfDelta,
      runs: rep.runs,
      spinsPerSec: rep.spinsPerSec,
      maxSingleSpin: rep.maxSingleSpinX || null,
      /* 2026-06-23 — per-component RTP breakdown propagated from probe. */
      measuredRtpBreakdown: rep.measuredRtpBreakdown || null,
      kernelComparison,
      longestLosingStreak: rep.longestLosingStreak || null,
    });
  }
  const succeeded = games.filter(g => g.ok);
  const withDeclared = succeeded.filter(g => Number.isFinite(g.declaredRTP) && g.declaredRTP > 0);
  /* Kernel preflight comparison summary (when --kernel-preflight was on).
   * Just count games with kernel data + flag any that have non-synthetic
   * (par-sheet-derived) distributions. Synthetic comparisons are NOT
   * regressions — they're audit-grade analytical numbers operators use
   * to sanity-check probe direction. */
  const withKernel = succeeded.filter(g => g.kernelComparison);
  const kernelPerSource = {
    hw:      withKernel.filter(g => g.kernelComparison.source === 'hw').length,
    cluster: withKernel.filter(g => g.kernelComparison.source === 'cluster').length,
  };

  /* Per-component aggregate across all probed games (2026-06-23).
   * For each component, compute count (games where component > 0), avg
   * (per-game pct mean over games where >0), and max (highest single-game
   * pct). Lets operator see which feature dominates corpus economics. */
  const componentAgg = {};
  const compKeys = ['line', 'cluster', 'payAnywhere', 'scatter', 'pattern', 'hw', 'fsRound'];
  for (const k of compKeys) {
    const vals = succeeded
      .map(g => g.measuredRtpBreakdown?.[k])
      .filter(v => Number.isFinite(v) && v > 0);
    componentAgg[k] = {
      gamesActive: vals.length,
      avgPct: vals.length > 0 ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 0,
      maxPct: vals.length > 0 ? +Math.max(...vals).toFixed(2) : 0,
    };
  }
  /* 2026-06-23 — gap distribution histogram for full-corpus runs.
   * Buckets games-with-declared-RTP by |Δ| into industry-meaningful bands:
   *   exact (±0.5pp)  — auto-clamp converged
   *   tight (±5pp)    — within ±5pp precision band
   *   medium (±20pp)  — engine over/under-counts, needs topology kernel
   *   wide (>20pp)    — likely broken model OR missing eval kernel
   * Topology distribution shows where the corpus sits across eval kinds. */
  const gapBuckets = { exact: 0, tight: 0, medium: 0, wide: 0 };
  const topoDist = {};
  for (const g of withDeclared) {
    const d = Math.abs(g.rtpDelta || 0);
    if (d <= 0.5) gapBuckets.exact++;
    else if (d <= 5) gapBuckets.tight++;
    else if (d <= 20) gapBuckets.medium++;
    else gapBuckets.wide++;
  }
  for (const g of succeeded) {
    const k = g.topologyKind || 'unknown';
    topoDist[k] = (topoDist[k] || 0) + 1;
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/math-cross-game-probe.mjs',
    gamesProbed: games.length,
    gamesOk: succeeded.length,
    gamesFailed: games.length - succeeded.length,
    gamesWithDeclaredRTP: withDeclared.length,
    avgMeasuredRTP: succeeded.length > 0
      ? +(succeeded.reduce((s, g) => s + g.measuredRTP, 0) / succeeded.length).toFixed(2)
      : null,
    avgDeclaredRTP: withDeclared.length > 0
      ? +(withDeclared.reduce((s, g) => s + g.declaredRTP, 0) / withDeclared.length).toFixed(2)
      : null,
    maxRTPGap: withDeclared.length > 0
      ? +(Math.max(...withDeclared.map(g => Math.abs(g.rtpDelta || 0)))).toFixed(2)
      : null,
    minRTPGap: withDeclared.length > 0
      ? +(Math.min(...withDeclared.map(g => Math.abs(g.rtpDelta || 0)))).toFixed(2)
      : null,
    gapBuckets,
    topologyDistribution: topoDist,
    componentAggregate: componentAgg,
    /* Kernel-preflight summary (populated only when --kernel-preflight on).
     * NOTE: synthetic distributions inflate analytical numbers; treat as
     * informational, not regression signal. Real disagreement detection
     * requires per-game empirical PAR data. */
    kernelPreflight: withKernel.length > 0 ? {
      gamesWithKernelData: withKernel.length,
      perSource: kernelPerSource,
      syntheticDistribution: true,
      note: 'analytical RTPs use synthetic percolation / industry-typical pools — pass empirical par-sheet data via API for actionable disagreement detection',
    } : null,
  };
  return { games, summary, exit };
}

/* ── Stdout ASCII table ───────────────────────────────────────────────── */

function pad(s, n, align = 'l') {
  s = String(s);
  if (s.length >= n) return s.slice(0, n);
  const fill = ' '.repeat(n - s.length);
  return align === 'r' ? fill + s : s + fill;
}

function printTable(games) {
  console.log('┌──────────────────────────────────────────┬──────┬────────────┬────────┬────────┬────────┬────────┬────────┐');
  console.log('│ Slug                                       │ Topo │ Kind        │ RTP m  │ RTP d  │ Δ      │ HF m   │ HF d   │');
  console.log('├──────────────────────────────────────────┼──────┼────────────┼────────┼────────┼────────┼────────┼────────┤');
  for (const g of games) {
    if (!g.ok) {
      console.log(`│ ${pad(g.slug, 42)} │ ERROR: ${pad(g.error || '?', 92)} │`);
      continue;
    }
    console.log(`│ ${pad(g.slug, 42)} │ ${pad(g.topology, 4)} │ ${pad(g.topologyKind, 10)} │ ${pad(g.measuredRTP?.toFixed(2) || '-', 6, 'r')} │ ${pad((g.declaredRTP || '-').toString(), 6, 'r')} │ ${pad((g.rtpDelta || 0).toFixed(2), 6, 'r')} │ ${pad(g.measuredHF?.toFixed(2) || '-', 6, 'r')} │ ${pad((g.declaredHF || '-').toString(), 6, 'r')} │`);
  }
  console.log('└──────────────────────────────────────────┴──────┴────────────┴────────┴────────┴────────┴────────┴────────┘');
}

/* ── CSV + Markdown emitters ──────────────────────────────────────────── */

function toCsv(games, summary) {
  const head = 'slug,topology,topologyKind,measuredRTP,declaredRTP,rtpDelta,measuredHF,declaredHF,maxSingleSpin,longestLosingStreak,ok,error';
  const rows = games.map(g => [
    g.slug,
    g.topology || '',
    g.topologyKind || '',
    g.measuredRTP != null ? g.measuredRTP : '',
    g.declaredRTP != null ? g.declaredRTP : '',
    g.rtpDelta != null ? g.rtpDelta : '',
    g.measuredHF != null ? g.measuredHF : '',
    g.declaredHF != null ? g.declaredHF : '',
    g.maxSingleSpin != null ? g.maxSingleSpin : '',
    g.longestLosingStreak != null ? g.longestLosingStreak : '',
    g.ok ? 'true' : 'false',
    (g.error || '').replace(/[,\n"]/g, ' '),
  ].join(','));
  return [head, ...rows].join('\n') + '\n';
}

function toMd(games, summary) {
  const lines = [];
  lines.push(`# Cross-Game RTP Report · ${summary.generatedAt}`);
  lines.push('');
  lines.push(`Games probed: ${summary.gamesProbed} · ok ${summary.gamesOk} · failed ${summary.gamesFailed}`);
  lines.push(`Games with declared RTP: ${summary.gamesWithDeclaredRTP}`);
  lines.push(`Avg measured: ${summary.avgMeasuredRTP}% · avg declared: ${summary.avgDeclaredRTP}% · max gap ${summary.maxRTPGap}pp · min gap ${summary.minRTPGap}pp`);
  lines.push('');
  lines.push('| Slug | Topo | Kind | Measured | Declared | Δ | HF m | HF d |');
  lines.push('|------|------|------|---------:|---------:|---:|----:|----:|');
  for (const g of games) {
    if (!g.ok) {
      lines.push(`| ${g.slug} | ERR | — | — | — | — | — | — |`);
      continue;
    }
    lines.push(`| ${g.slug} | ${g.topology} | ${g.topologyKind} | ${g.measuredRTP?.toFixed(2) || '—'}% | ${g.declaredRTP != null ? g.declaredRTP + '%' : '—'} | ${g.rtpDelta != null ? g.rtpDelta.toFixed(2) : '—'} | ${g.measuredHF?.toFixed(2) || '—'} | ${g.declaredHF != null ? g.declaredHF + '%' : '—'} |`);
  }
  return lines.join('\n') + '\n';
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('math-cross-game-probe.mjs')) {
  const slugsArg = argVal('--slugs');
  const runs = parseInt(argVal('--runs') || '50000', 10);
  const seed = parseInt(argVal('--seed') || '42', 10);
  const format = (argVal('--format') || 'json').toLowerCase();
  const useAllCorpus = args.includes('--all');
  const kernelPreflight = args.includes('--kernel-preflight');
  let slugs;
  if (useAllCorpus) {
    /* All 338 GDDs in dist/real-games/ with model.json. */
    const allDirs = readdirSync(REAL_GAMES);
    slugs = allDirs.filter(d => {
      const p = join(REAL_GAMES, d);
      try {
        const s = statSync(p);
        return s.isDirectory() && existsSync(join(p, 'model.json'));
      } catch { return false; }
    });
  } else {
    slugs = slugsArg ? slugsArg.split(',').map(s => s.trim()) : BASELINE_SLUGS;
  }
  console.log(`MATH-DEEP cross-game probe · ${slugs.length} games × ${runs} spins · seed ${seed}`);
  console.log('');
  const { games, summary, exit } = generateComparativeReport(slugs, { runs, seed, kernelPreflight });
  printTable(games);
  console.log('');
  console.log(`Summary: ${summary.gamesOk}/${summary.gamesProbed} ok · ${summary.gamesWithDeclaredRTP} with declared RTP · avg measured ${summary.avgMeasuredRTP}% · avg declared ${summary.avgDeclaredRTP}% · max gap ${summary.maxRTPGap}pp · min gap ${summary.minRTPGap}pp`);
  /* Per-component aggregate line (only non-zero components for legibility). */
  const compLines = [];
  for (const [k, v] of Object.entries(summary.componentAggregate || {})) {
    if (v.gamesActive > 0) {
      compLines.push(`${k}: ${v.gamesActive} games (avg ${v.avgPct}%, max ${v.maxPct}%)`);
    }
  }
  if (compLines.length > 0) {
    console.log(`Component aggregate:`);
    for (const l of compLines) console.log(`  · ${l}`);
  }
  /* Write summary report. */
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const baseOut = join(OUT_DIR, `cross-game-${ts}`);
  if (format === 'csv') {
    const csvPath = baseOut + '.csv';
    writeFileSync(csvPath, toCsv(games, summary), 'utf8');
    console.log(`Report (CSV): ${csvPath}`);
  } else if (format === 'md' || format === 'markdown') {
    const mdPath = baseOut + '.md';
    writeFileSync(mdPath, toMd(games, summary), 'utf8');
    console.log(`Report (Markdown): ${mdPath}`);
  } else {
    const outPath = baseOut + '.json';
    writeFileSync(outPath, JSON.stringify({ summary, games }, null, 2), 'utf8');
    console.log(`Report (JSON): ${outPath}`);
  }
  process.exit(exit);
}
