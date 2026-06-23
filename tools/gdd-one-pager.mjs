#!/usr/bin/env node
/**
 * tools/gdd-one-pager.mjs
 *
 * N1 (2026-06-23) — Per-game compliance one-pager generator.
 *
 * For a given slug, emit ONE Markdown document combining ALL audit data:
 *   - Game basics (topology + RTP + paylines + max win)
 *   - Symbols + paytable summary
 *   - Features list
 *   - Applicable kernels + analytical RTP
 *   - Declared vs measured RTP verdict (CONVERGED/CLOSE/DIVERGED/NON_BINDING)
 *   - Compliance check (jurisdictions, autoplay cap, max win cap)
 *   - Honest convergence (pre-clamp raw)
 *
 * Why
 *   Operators / regulators / compliance teams want ONE document per
 *   game, not 4 separate JSON reports. This is the production
 *   deliverable that audits a single title for regulator submission.
 *
 * USAGE
 *   node tools/gdd-one-pager.mjs --slug cash-eruption-foundry-gdd
 *   node tools/gdd-one-pager.mjs --slug X --json
 *   node tools/gdd-one-pager.mjs --all                # all 5 baselines
 *
 * OUTPUT
 *   reports/gdd-one-pagers/<slug>.md
 *   reports/gdd-one-pagers/<slug>.json (--json)
 *
 * EXIT
 *   0 — one-pager generated
 *   2 — slug missing / model.json absent
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkGame } from './per-game-kernel-coverage.mjs';
import { classify, findLatestReport } from './declared-vs-measured-audit.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const OUT_DIR    = join(REPO, 'reports/gdd-one-pagers');

const BASELINE_SLUGS = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (i === -1) return null;
  return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
};
const useAll  = args.includes('--all');
const jsonOnly = args.includes('--json');
const slugArg = argVal('--slug');

/* ── Data collectors ─────────────────────────────────────────────────── */

function loadCrossGameRow(slug) {
  const latest = findLatestReport();
  if (!latest) return null;
  try {
    const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
    return (payload.games || []).find(g => g.slug === slug) || null;
  } catch { return null; }
}

async function buildOnePager(slug) {
  const modelPath = join(REAL_GAMES, slug, 'model.json');
  if (!existsSync(modelPath)) {
    return { ok: false, slug, error: `model.json missing at ${modelPath}` };
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const coverage = await walkGame(slug);
  const crossRow = loadCrossGameRow(slug);
  /* Verdict computed from cross-game row if available. */
  const declaredRTP = crossRow?.declaredRTP ?? model.payback?.rtp ?? null;
  const measuredRTP = crossRow?.measuredRTP ?? null;
  const rawMeasuredRTP = crossRow?.rawMeasuredRTP ?? null;
  const rtpDelta = crossRow?.rtpDelta ?? null;
  const rawRtpDelta = crossRow?.rawRtpDelta ?? null;
  const isSynthetic = !!crossRow?.declaredRTPIsSynthetic
    || (typeof model.payback?.rtpSource === 'string'
        && model.payback.rtpSource.startsWith('synthetic-fallback')
        && !(Array.isArray(model.payback?.rtpVariants) && model.payback.rtpVariants.length > 0));
  const verdict = classify(rtpDelta, isSynthetic);
  const honestVerdict = classify(rawRtpDelta, isSynthetic);
  /* Compliance markers. */
  const jurisdictions = model.compliance?.jurisdictions || [];
  const autoplayCap = model.compliance?.autoplayCap ?? model.session?.autoplayMaxSpins ?? null;
  const maxWinCap = model.payback?.maxWinX ?? model.engine?.winCap ?? null;
  const volatilityIdx = model.payback?.volatilityIdx ?? null;
  return {
    ok: true,
    slug,
    generatedAt: new Date().toISOString(),
    basics: {
      topology: model.topology?.kind || 'unknown',
      evaluation: model.topology?.evaluation || null,
      reels: model.topology?.reels ?? null,
      rows: model.topology?.rows ?? null,
      paylines: model.topology?.paylines ?? null,
      declaredRTP, declaredRTPSource: model.payback?.rtpSource ?? null,
      maxWinX: maxWinCap,
      volatilityIdx,
    },
    symbols: {
      highCount: Array.isArray(model.symbols?.high) ? model.symbols.high.length : 0,
      lowCount:  Array.isArray(model.symbols?.low)  ? model.symbols.low.length  : 0,
      hasScatter: !!model.symbols?.scatter,
      hasWild:    !!model.symbols?.wild,
    },
    features: (Array.isArray(model.features) ? model.features : []).map(f => f.kind || f.label || '?'),
    kernels: {
      applicable: coverage.kernelsApplicable ?? 0,
      ok: coverage.kernelsOk ?? 0,
      top3: (coverage.kernels || [])
        .filter(k => k.ok && Number.isFinite(k.rtpContribution) && k.rtpContribution > 0)
        .sort((a, b) => b.rtpContribution - a.rtpContribution)
        .slice(0, 3)
        .map(k => ({ name: k.name, rtpContribution: +k.rtpContribution.toFixed(4) })),
    },
    convergence: {
      declaredRTP, measuredRTP, rawMeasuredRTP,
      rtpDelta, rawRtpDelta,
      verdict, honestVerdict,
      isSynthetic,
    },
    compliance: {
      jurisdictions,
      autoplayCap,
      maxWinCap,
    },
  };
}

/* ── MD renderer ─────────────────────────────────────────────────────── */

const VERDICT_BADGE = {
  CONVERGED:   '🟢 CONVERGED',
  CLOSE:       '🟡 CLOSE',
  DIVERGED:    '🔴 DIVERGED',
  NON_BINDING: '◌ NON_BINDING',
  UNKNOWN:     '? UNKNOWN',
};

function renderMarkdown(report) {
  if (!report.ok) {
    return `# GDD compliance one-pager — ERROR\n\nSlug: \`${report.slug}\`\nError: ${report.error}\n`;
  }
  const r = report;
  const lines = [];
  lines.push(`# GDD Compliance One-Pager — \`${r.slug}\``);
  lines.push('');
  lines.push(`> generated: ${r.generatedAt}`);
  lines.push(`> tool: tools/gdd-one-pager.mjs`);
  lines.push('');
  /* Section 1: basics. */
  lines.push('## 1. Game basics');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|:--|:--|');
  lines.push(`| Topology | \`${r.basics.topology}\` ${r.basics.evaluation ? `(eval: ${r.basics.evaluation})` : ''} |`);
  lines.push(`| Reels × Rows | ${r.basics.reels ?? '—'} × ${r.basics.rows ?? '—'} |`);
  lines.push(`| Paylines | ${r.basics.paylines ?? '—'} |`);
  lines.push(`| Declared RTP | ${r.basics.declaredRTP != null ? r.basics.declaredRTP + '%' : '—'} \`(${r.basics.declaredRTPSource ?? '—'})\` |`);
  lines.push(`| Max win | ${r.basics.maxWinX != null ? r.basics.maxWinX + '× bet' : '—'} |`);
  lines.push(`| Volatility index | ${r.basics.volatilityIdx ?? '—'} / 10 |`);
  lines.push('');
  /* Section 2: symbols. */
  lines.push('## 2. Symbols');
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('|:--|:-:|');
  lines.push(`| High | ${r.symbols.highCount} |`);
  lines.push(`| Low | ${r.symbols.lowCount} |`);
  lines.push(`| Scatter | ${r.symbols.hasScatter ? '✓' : '—'} |`);
  lines.push(`| Wild | ${r.symbols.hasWild ? '✓' : '—'} |`);
  lines.push('');
  /* Section 3: features. */
  lines.push('## 3. Features');
  lines.push('');
  if (r.features.length === 0) {
    lines.push('_no features declared_');
  } else {
    for (const f of r.features) lines.push(`- ${f}`);
  }
  lines.push('');
  /* Section 4: kernel coverage. */
  lines.push('## 4. Math kernel coverage');
  lines.push('');
  lines.push(`Applicable: **${r.kernels.applicable}** · OK: **${r.kernels.ok}**`);
  lines.push('');
  lines.push('Top 3 RTP-contributing kernels (analytical, × bet):');
  lines.push('');
  if (r.kernels.top3.length === 0) {
    lines.push('_no scoring kernels (inverse-solvers/composites skipped)_');
  } else {
    lines.push('| Rank | Kernel | RTP contribution |');
    lines.push('|:-:|:--|:-:|');
    for (let i = 0; i < r.kernels.top3.length; i++) {
      const k = r.kernels.top3[i];
      lines.push(`| ${i + 1} | \`${k.name}\` | ${k.rtpContribution.toFixed(4)}× bet |`);
    }
  }
  lines.push('');
  /* Section 5: RTP convergence. */
  lines.push('## 5. RTP convergence');
  lines.push('');
  lines.push('| Mode | Declared | Measured | ΔRTP | Verdict |');
  lines.push('|:--|:-:|:-:|:-:|:--|');
  lines.push(`| Operator (clamp-aware) | ${r.convergence.declaredRTP != null ? r.convergence.declaredRTP + '%' : '—'} | ${r.convergence.measuredRTP != null ? r.convergence.measuredRTP + '%' : '—'} | ${r.convergence.rtpDelta != null ? r.convergence.rtpDelta + 'pp' : '—'} | ${VERDICT_BADGE[r.convergence.verdict]} |`);
  lines.push(`| Honest (pre-clamp) | ${r.convergence.declaredRTP != null ? r.convergence.declaredRTP + '%' : '—'} | ${r.convergence.rawMeasuredRTP != null ? r.convergence.rawMeasuredRTP + '%' : '—'} | ${r.convergence.rawRtpDelta != null ? r.convergence.rawRtpDelta + 'pp' : '—'} | ${VERDICT_BADGE[r.convergence.honestVerdict]} |`);
  lines.push('');
  if (r.convergence.isSynthetic) {
    lines.push('> ⚠ Declared RTP derived from synthetic-fallback (PDF lacked explicit RTP). Verdict is audit-only — NOT a production divergence.');
    lines.push('');
  }
  /* Section 6: compliance. */
  lines.push('## 6. Compliance');
  lines.push('');
  lines.push('| Marker | Value |');
  lines.push('|:--|:--|');
  lines.push(`| Jurisdictions | ${r.compliance.jurisdictions.length > 0 ? r.compliance.jurisdictions.join(', ') : '_none declared_'} |`);
  lines.push(`| Autoplay cap | ${r.compliance.autoplayCap ?? '_not enforced_'} |`);
  lines.push(`| Max win cap | ${r.compliance.maxWinCap != null ? r.compliance.maxWinCap + '× bet' : '_not enforced_'} |`);
  lines.push('');
  /* Footer. */
  lines.push('---');
  lines.push(`_Generated by tools/gdd-one-pager.mjs. For full audit data, see \`reports/audit-summary.json\` and \`reports/per-game-kernel-coverage/${r.slug}.json\`._`);
  lines.push('');
  return lines.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('gdd-one-pager.mjs')) {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing — run parse-real-pdfs.mjs first`);
    process.exit(2);
  }
  let slugs;
  if (useAll) slugs = BASELINE_SLUGS;
  else if (slugArg) slugs = [slugArg];
  else {
    console.error('Usage: --slug <slug> | --all');
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const slug of slugs) {
    const report = await buildOnePager(slug);
    const md = renderMarkdown(report);
    const mdPath = join(OUT_DIR, `${slug}.md`);
    writeFileSync(mdPath, md);
    if (report.ok) {
      const jsonPath = join(OUT_DIR, `${slug}.json`);
      writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log(`✓ ${slug}  →  ${mdPath}`);
    } else {
      console.log(`✗ ${slug}: ${report.error}`);
    }
    if (slugArg && !jsonOnly) {
      console.log('');
      console.log(md);
    }
  }
  process.exit(0);
}

export { buildOnePager, renderMarkdown };
