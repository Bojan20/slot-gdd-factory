#!/usr/bin/env node
/**
 * tools/declared-vs-measured-audit.mjs
 *
 * Production-grade audit: declared RTP vs measured RTP (probe) per game,
 * with verdict ladder (CONVERGED / CLOSE / DIVERGED). Reads latest
 * `reports/cross-game-rtp/cross-game-*.json` snapshot from the
 * math-cross-game-probe tool — no live probe re-run.
 *
 * Why
 *   Regulator / compliance / operator wants ONE number per game:
 *   "is our probe converging to the declared RTP within tolerance?"
 *   Hard precision band: ±0.5pp = CONVERGED, ±2pp = CLOSE, else DIVERGED.
 *   Same precision band as MATH_PRECISION_BAND_PCT (registry SSoT).
 *
 * USAGE
 *   node tools/declared-vs-measured-audit.mjs                  # ASCII table
 *   node tools/declared-vs-measured-audit.mjs --json           # JSON only
 *   node tools/declared-vs-measured-audit.mjs --strict         # exit 1 if any DIVERGED
 *   node tools/declared-vs-measured-audit.mjs --file <path>    # specific report
 *
 * OUTPUT
 *   stdout: ASCII audit table + portfolio verdict
 *   reports/declared-vs-measured-audit.json
 *
 * EXIT
 *   0 — audit produced
 *   1 — --strict + any DIVERGED game
 *   2 — no cross-game report found
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const CROSS_DIR  = join(REPO, 'reports/cross-game-rtp');
const OUT_DIR    = join(REPO, 'reports');

/* Precision band (pp). Identical to MATH_PRECISION_BAND_PP registry. */
const CONVERGED_PP = 0.5;
const CLOSE_PP     = 2.0;

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const strict   = args.includes('--strict');
const fileArg  = (() => {
  const i = args.findIndex(a => a === '--file' || a.startsWith('--file='));
  if (i === -1) return null;
  return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
})();

/* ── Latest cross-game report finder ─────────────────────────────────── */

function findLatestReport() {
  if (!existsSync(CROSS_DIR)) return null;
  const candidates = readdirSync(CROSS_DIR)
    .filter(f => f.startsWith('cross-game-') && f.endsWith('.json'))
    .map(f => ({ file: f, path: join(CROSS_DIR, f), mtime: statSync(join(CROSS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

/* ── Verdict classifier ──────────────────────────────────────────────── */

function classify(rtpDelta) {
  if (!Number.isFinite(rtpDelta)) return 'UNKNOWN';
  const absDelta = Math.abs(rtpDelta);
  if (absDelta <= CONVERGED_PP) return 'CONVERGED';
  if (absDelta <= CLOSE_PP)     return 'CLOSE';
  return 'DIVERGED';
}

const VERDICT_BADGE = {
  CONVERGED: '✓',
  CLOSE:     '~',
  DIVERGED:  '✗',
  UNKNOWN:   '?',
};

/* ── Audit builder ───────────────────────────────────────────────────── */

function buildAudit(reportPayload, reportFile) {
  const games = reportPayload.games || [];
  const rows = games
    .filter(g => g.ok !== false)
    .map(g => {
      const verdict = classify(g.rtpDelta);
      return {
        slug: g.slug,
        topology: g.topology || 'unknown',
        declaredRTP: g.declaredRTP,
        measuredRTP: g.measuredRTP,
        rtpDelta:    g.rtpDelta,
        verdict,
      };
    });
  /* Aggregate verdict counts. */
  const verdictCounts = { CONVERGED: 0, CLOSE: 0, DIVERGED: 0, UNKNOWN: 0 };
  for (const r of rows) verdictCounts[r.verdict]++;
  const portfolioVerdict = verdictCounts.DIVERGED > 0 ? 'DIVERGED'
    : verdictCounts.CLOSE > 0 ? 'CLOSE'
    : verdictCounts.UNKNOWN > 0 ? 'UNKNOWN'
    : 'CONVERGED';
  return {
    reportFile,
    portfolioVerdict,
    verdictCounts,
    bands: { converged_pp: CONVERGED_PP, close_pp: CLOSE_PP },
    rows,
  };
}

/* ── ASCII renderer ──────────────────────────────────────────────────── */

function renderAudit(audit) {
  const lines = [];
  lines.push(`Declared vs Measured RTP audit (source: ${audit.reportFile})`);
  lines.push('');
  lines.push(`  Precision bands: ±${CONVERGED_PP}pp = CONVERGED · ±${CLOSE_PP}pp = CLOSE · else DIVERGED`);
  lines.push('');
  const slugCol = 28;
  lines.push('  ' + 'Game'.padEnd(slugCol) + ' │ Topology    │ Declared │ Measured │ ΔRTP   │ Verdict');
  lines.push('  ' + '─'.repeat(slugCol) + '─┼─────────────┼──────────┼──────────┼────────┼──────────');
  for (const r of audit.rows) {
    const slug = r.slug.length > slugCol ? r.slug.slice(0, slugCol - 1) + '…' : r.slug.padEnd(slugCol);
    const topo = (r.topology || 'unknown').slice(0, 11).padEnd(11);
    const decl = (r.declaredRTP != null ? `${r.declaredRTP.toFixed(2)}%` : '—').padStart(8);
    const meas = (r.measuredRTP != null ? `${r.measuredRTP.toFixed(2)}%` : '—').padStart(8);
    const dlt  = (r.rtpDelta != null
      ? `${r.rtpDelta >= 0 ? '+' : ''}${r.rtpDelta.toFixed(2)}pp`
      : '—').padStart(7);
    const verdict = `${VERDICT_BADGE[r.verdict]} ${r.verdict}`.padEnd(11);
    lines.push(`  ${slug} │ ${topo} │ ${decl} │ ${meas} │ ${dlt} │ ${verdict}`);
  }
  lines.push('');
  lines.push('  PORTFOLIO VERDICT');
  lines.push(`    Aggregate:   ${VERDICT_BADGE[audit.portfolioVerdict]} ${audit.portfolioVerdict}`);
  lines.push(`    Converged:   ${audit.verdictCounts.CONVERGED}/${audit.rows.length}`);
  lines.push(`    Close:       ${audit.verdictCounts.CLOSE}/${audit.rows.length}`);
  lines.push(`    Diverged:    ${audit.verdictCounts.DIVERGED}/${audit.rows.length}`);
  if (audit.verdictCounts.UNKNOWN > 0) {
    lines.push(`    Unknown:     ${audit.verdictCounts.UNKNOWN}/${audit.rows.length} (missing delta)`);
  }
  return lines.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('declared-vs-measured-audit.mjs')) {
  let reportPath, reportFile;
  if (fileArg) {
    reportPath = resolve(fileArg);
    reportFile = fileArg;
    if (!existsSync(reportPath)) {
      console.error(`▸ Report not found: ${reportPath}`);
      process.exit(2);
    }
  } else {
    const latest = findLatestReport();
    if (!latest) {
      console.error(`▸ No cross-game-rtp reports in ${CROSS_DIR}\n` +
                    `  Run: node tools/math-cross-game-probe.mjs --all`);
      process.exit(2);
    }
    reportPath = latest.path;
    reportFile = latest.file;
  }
  const payload = JSON.parse(readFileSync(reportPath, 'utf8'));
  const audit = buildAudit(payload, reportFile);
  if (!jsonOnly) {
    console.log(renderAudit(audit));
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/declared-vs-measured-audit.mjs',
    sourceReport: reportFile,
    ...audit,
  };
  const outPath = join(OUT_DIR, 'declared-vs-measured-audit.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  if (jsonOnly) console.log(JSON.stringify(out, null, 2));
  else console.log(`\nReport: ${outPath}`);
  if (strict && audit.verdictCounts.DIVERGED > 0) {
    console.error(`▸ STRICT FAIL: ${audit.verdictCounts.DIVERGED} game(s) DIVERGED`);
    process.exit(1);
  }
  process.exit(0);
}

export { buildAudit, renderAudit, classify, findLatestReport };
