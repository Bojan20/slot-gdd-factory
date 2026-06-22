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
 *     reproducibility). Reports go to reports/math-rtp/<slug>.json.
 *   - Cross-game summary aggregates across all probed games.
 *   - Self-test verifies all 5 baselines parse + produce a non-zero RTP.
 *
 * Performance budget
 *   Each game: ~100ms for 50k spins. Total 5 games × 100ms = ~500ms.
 *
 * HARD RULE #1
 *   No vendor names in summary output — only internal slug + topology kind.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
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

/**
 * Run math-rtp-probe.mjs for one slug, return its report.
 *
 * Returns { ok: true, report: <json> } on success.
 * Returns { ok: false, error: <msg> } on failure.
 */
export function probeGame(slug, opts = {}) {
  const { runs = 50000, seed = 42, bet = 1 } = opts;
  const slugDir = join(REAL_GAMES, slug);
  if (!existsSync(slugDir) || !existsSync(join(slugDir, 'model.json'))) {
    return { ok: false, error: `slug ${slug} missing model.json (run parse-real-pdfs.mjs)` };
  }
  const probe = join(REPO, 'tools/math-rtp-probe.mjs');
  const r = spawnSync('node', [probe,
    `--slug=${slug}`,
    `--runs=${runs}`,
    `--seed=${seed}`,
    `--bet=${bet}`,
  ], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    return { ok: false, error: `probe exit ${r.status}: ${(r.stderr || '').slice(0, 200)}` };
  }
  const reportPath = join(RTP_REPORTS, `${slug}.json`);
  if (!existsSync(reportPath)) {
    return { ok: false, error: `report not generated at ${reportPath}` };
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
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
    games.push({
      slug,
      ok: true,
      topology: topo,
      topologyKind: topoKind,
      measuredRTP: rep.measuredRTP,
      declaredRTP: rep.declaredRTP,
      rtpDelta: rep.rtpDelta,
      measuredHF: rep.measuredHF,
      declaredHF: rep.declaredHF,
      hfDelta: rep.hfDelta,
      runs: rep.runs,
      spinsPerSec: rep.spinsPerSec,
      maxSingleSpin: rep.maxSingleSpinX || null,
      longestLosingStreak: rep.longestLosingStreak || null,
    });
  }
  const succeeded = games.filter(g => g.ok);
  const summary = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/math-cross-game-probe.mjs',
    gamesProbed: games.length,
    gamesOk: succeeded.length,
    gamesFailed: games.length - succeeded.length,
    avgMeasuredRTP: succeeded.length > 0
      ? +(succeeded.reduce((s, g) => s + g.measuredRTP, 0) / succeeded.length).toFixed(2)
      : null,
    avgDeclaredRTP: succeeded.length > 0
      ? +(succeeded.reduce((s, g) => s + (g.declaredRTP || 0), 0) / succeeded.length).toFixed(2)
      : null,
    /* Per-game stats; succeeded.length>0 guaranteed before compute. */
    maxRTPGap: succeeded.length > 0
      ? Math.max(...succeeded.map(g => Math.abs(g.rtpDelta || 0)))
      : null,
    minRTPGap: succeeded.length > 0
      ? Math.min(...succeeded.map(g => Math.abs(g.rtpDelta || 0)))
      : null,
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

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('math-cross-game-probe.mjs')) {
  const slugsArg = argVal('--slugs');
  const runs = parseInt(argVal('--runs') || '50000', 10);
  const seed = parseInt(argVal('--seed') || '42', 10);
  const slugs = slugsArg ? slugsArg.split(',').map(s => s.trim()) : BASELINE_SLUGS;
  console.log(`MATH-DEEP cross-game probe · ${slugs.length} games × ${runs} spins · seed ${seed}`);
  console.log('');
  const { games, summary, exit } = generateComparativeReport(slugs, { runs, seed });
  printTable(games);
  console.log('');
  console.log(`Summary: ${summary.gamesOk}/${summary.gamesProbed} ok · avg measured ${summary.avgMeasuredRTP}% · avg declared ${summary.avgDeclaredRTP}% · max gap ${summary.maxRTPGap?.toFixed(2)}pp · min gap ${summary.minRTPGap?.toFixed(2)}pp`);
  /* Write summary report. */
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(OUT_DIR, `cross-game-${ts}.json`);
  writeFileSync(outPath, JSON.stringify({ summary, games }, null, 2), 'utf8');
  console.log(`Report: ${outPath}`);
  process.exit(exit);
}
