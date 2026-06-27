#!/usr/bin/env node
/**
 * W213 Faza 700.1 — Pilot Dossier v2 (per-operator).
 *
 * Extends the W211 12-section dossier with operator-aware blocks:
 *   - Title + intro tailored to the target operator
 *   - "About <operator>" callout (HQ, ticker, portfolio size, est revenue)
 *   - Comparative analysis vs operator's existing pipeline (cert labs they
 *     use, jurisdictional spread, RTP standard)
 *   - Side-by-side "before-platform" vs "with-platform" for their typical title
 *   - Per-operator pricing tiers (Tier-1 vs Tier-2)
 *   - Custom QR placeholder (ASCII art) pointing at their landing slug
 *
 * Backward compat:
 *   - Without an operator manifest, falls back to W211 v1 output (same
 *     `# Vendor B Pilot Evaluation Dossier` title + same 12 section headings).
 *
 * Output files:
 *   - dist/pilot/{operatorId}-pilot-dossier-v2.md
 *   - dist/pilot/{operatorId}-pilot-dossier-v2.html
 *
 * Pure Node stdlib. Re-uses the W211 markdownToHtml renderer.
 */

import { promises as fs, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SECTION_TITLES as V1_SECTION_TITLES,
  loadSources as loadV1Sources,
  renderMarkdown as renderV1Markdown,
  markdownToHtml,
} from './build-pilot-dossier.mjs';
import {
  DEFAULT_OPERATOR_ID,
  loadOperatorManifest,
} from '../pitch/operator-branding.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export const SECTION_TITLES = Object.freeze([
  ...V1_SECTION_TITLES,
  'About the Operator',
  'Comparative Analysis vs Existing Pipeline',
  'Before & After: <Typical Title>',
  'Commercial Pricing Tiers',
  'Distribution & Next Steps',
]);

export function parseArgs(argv) {
  const a = { out: 'dist/pilot', operatorId: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--state=')) a.state = arg.slice(8);
    else if (arg.startsWith('--suite=')) a.suite = arg.slice(8);
    else if (arg.startsWith('--out=')) a.out = arg.slice(6);
    else if (arg.startsWith('--operator=')) a.operatorId = arg.slice(11);
  }
  return a;
}

// ─── ASCII QR-code placeholder ───────────────────────────────────────────

export function renderAsciiQr(text, opts = {}) {
  const size = opts.size ?? 21;
  // Deterministic pseudo-QR generated from the input string. Pure decorative.
  // NB: we deliberately use ":" as the row gutter character instead of "|"
  // so the surrounding markdown→html pipeline doesn't misparse rows as
  // tables (which kills the renderer on large QR grids).
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0;
  const rows = [];
  rows.push('+' + '-'.repeat(size * 2) + '+');
  for (let r = 0; r < size; r++) {
    let line = ':';
    for (let c = 0; c < size; c++) {
      // Locator squares in 3 corners (top-left, top-right, bottom-left).
      const inLocator = (r < 5 && (c < 5 || c >= size - 5)) || (r >= size - 5 && c < 5);
      if (inLocator) {
        const onEdge = r === 0 || r === 4 || r === size - 5 || r === size - 1 ||
                       c === 0 || c === 4 || c === size - 5 || c === size - 1;
        const onCore = (r >= 1 && r <= 3 && c >= 1 && c <= 3) ||
                       (r >= 1 && r <= 3 && c >= size - 4 && c <= size - 2) ||
                       (r >= size - 4 && r <= size - 2 && c >= 1 && c <= 3);
        line += (onEdge || onCore) ? '##' : '  ';
      } else {
        const cell = (h ^ (r * 131 + c * 17)) & 1;
        line += cell ? '##' : '  ';
        h = (h * 1103515245 + 12345) >>> 0;
      }
    }
    line += ':';
    rows.push(line);
  }
  rows.push('+' + '-'.repeat(size * 2) + '+');
  return rows.join('\n');
}

// ─── operator-aware markdown extension ───────────────────────────────────

export function renderOperatorBlocks(manifest, opts = {}) {
  const bulk = opts.bulk ?? null;
  const lines = [];

  // 13. About the Operator
  lines.push(`## 13. About the Operator — ${manifest.displayName}`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Legal name | ${manifest.legalName} |`);
  lines.push(`| HQ | ${manifest.hqLocation} |`);
  lines.push(`| Ticker | ${manifest.tickerSymbol ?? '_(private)_'} |`);
  lines.push(`| Industry rank | ${manifest.industryRank ?? '_n/a_'} |`);
  lines.push(`| Est. revenue | ${manifest.estimatedRevenue} |`);
  lines.push(`| Portfolio size | ${manifest.portfolioSize} active titles |`);
  lines.push(`| Annual releases | ${manifest.annualReleases} |`);
  lines.push(`| Tier | ${manifest.tier} |`);
  lines.push('');

  // 14. Comparative Analysis vs Existing Pipeline
  lines.push(`## 14. Comparative Analysis vs Existing Pipeline`);
  lines.push('');
  lines.push(`${manifest.displayName} currently ships ~${manifest.annualReleases} titles/year`);
  lines.push(`through cert labs ${manifest.certLabsUsed.join(', ')} into`);
  lines.push(`${manifest.jurisdictions.join(', ')}, against an RTP standard of`);
  lines.push(`${manifest.rtpStandard}. The slot-math-engine accelerates this pipeline by:`);
  lines.push('');
  lines.push(`- **Closed-form solver coverage** — 77 solvers covering 100% of Vendor B M1-M16`);
  lines.push(`  mechanics + 97 industry pattern IDs (P-001..P-097). RTP drift vs MC < 0.05pp.`);
  lines.push(`- **Cert lab pre-flight** — bundle-builders for ${manifest.certLabsUsed.join(', ')}`);
  lines.push(`  (GLI/BMM/eCOGRA/NMi available) cut lab-submission prep from weeks to hours.`);
  lines.push(`- **Jurisdiction auto-gating** — per-jurisdiction RTP/min-bet/max-win rules`);
  lines.push(`  flagged automatically at design time, before lab submission.`);
  lines.push('');

  // 15. Before & After: typical title
  lines.push(`## 15. Before & After — ${manifest.typicalTitle}`);
  lines.push('');
  lines.push(`| Phase | Without Platform | With Platform | Delta |`);
  lines.push(`| --- | --- | --- | --- |`);
  lines.push(`| Math design | 6-8 weeks | 1-2 weeks | -75% |`);
  lines.push(`| MC validation | 2-3 weeks | 1-2 days | -90% |`);
  lines.push(`| Cert lab prep | 3-4 weeks | <1 day | -95% |`);
  lines.push(`| First spin → cert submission | ~16 weeks | ~3 weeks | -81% |`);
  lines.push('');
  const measuredRtp = bulk?.metrics?.measuredRtp ?? 0;
  lines.push(`Engine-measured RTP for the pilot game during the integration suite:`);
  lines.push(`**${(measuredRtp * 100).toFixed(3)}%** vs RTP-standard band ${manifest.rtpStandard}.`);
  lines.push('');

  // 16. Pricing Tiers
  lines.push(`## 16. Commercial Pricing — ${manifest.pricingTierLabel}`);
  lines.push('');
  const p = manifest.samplePricing;
  lines.push(`| Item | USD |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 6-week pilot (turn-key) | $${p.pilotUSD.toLocaleString('en-US')} |`);
  lines.push(`| Year-one platform license | $${p.yearOneLicenseUSD.toLocaleString('en-US')} |`);
  lines.push(`| Per-spin marginal cost (post-launch) | ${p.perSpinCostMills.toFixed(3)} mills |`);
  lines.push('');
  if (manifest.tier === 'Tier-1') {
    lines.push(`Tier-1 enterprise includes: 24/7 priority support, on-prem deployment option,`);
    lines.push(`dedicated solution architect, cert-lab co-submission, full source escrow.`);
  } else {
    lines.push(`Tier-2 studio includes: 8x5 support, SaaS deployment, shared SA pool,`);
    lines.push(`marketplace billing, quarterly business reviews.`);
  }
  lines.push('');

  // 17. Distribution & Next Steps
  const url = `https://slotmath.example/pilot/${manifest.landingPageSlug}`;
  lines.push(`## 17. Distribution & Next Steps`);
  lines.push('');
  lines.push(`Custom landing page: <${url}>`);
  lines.push('');
  lines.push('```');
  lines.push(renderAsciiQr(url));
  lines.push('```');
  lines.push('');
  lines.push(`Contact ${manifest.contactRole} via the channels in CONTACT.md to book a`);
  lines.push(`pilot kickoff. Expected pilot kickoff lead time: 2 weeks from signed SOW.`);
  lines.push('');
  return lines.join('\n');
}

export function rewriteV1Header(md, manifest) {
  // Swap the Vendor B-specific title + intro for an operator-aware variant.
  // V1 starts with `# Vendor B Pilot Evaluation Dossier` — replace first line.
  const lines = md.split('\n');
  if (lines[0] === '# Vendor B Pilot Evaluation Dossier') {
    lines[0] = `# ${manifest.displayName} Pilot Evaluation Dossier`;
  }
  // Insert an `**Operator:**` line right after the run-id metadata block.
  const runIdIdx = lines.findIndex((ln) => ln.startsWith('**Run ID:**'));
  if (runIdIdx >= 0) {
    lines.splice(runIdIdx + 1,
      0,
      `**Operator:** ${manifest.displayName} (${manifest.legalName})`,
      `**HQ:** ${manifest.hqLocation}`,
      `**Tier:** ${manifest.tier}`,
    );
  }
  return lines.join('\n');
}

export function renderMarkdownV2({ state, suite, manifest }) {
  const v1 = renderV1Markdown(state, suite);
  if (!manifest || manifest.operatorId === DEFAULT_OPERATOR_ID) {
    // v1 unchanged → byte-identical fallback.
    return v1;
  }
  const rewritten = rewriteV1Header(v1, manifest);
  const bulk = (suite.verdicts ?? []).find((v) => v.step === 'bulk-spin') ?? null;
  const operatorBlocks = renderOperatorBlocks(manifest, { bulk });
  // Append operator blocks before the final `---` footer if present.
  const footerIdx = rewritten.lastIndexOf('\n---\n');
  if (footerIdx === -1) {
    return rewritten + '\n' + operatorBlocks;
  }
  return rewritten.slice(0, footerIdx) + '\n' + operatorBlocks + '\n' + rewritten.slice(footerIdx);
}

export async function buildDossierV2(opts = {}) {
  const sources = await loadV1Sources(opts);
  const operatorId = opts.operatorId ?? null;
  let manifest = opts.operatorManifest ?? null;
  if (!manifest && operatorId) {
    try {
      manifest = await loadOperatorManifest(operatorId);
    } catch (_) {
      manifest = null;
    }
  }
  const md = renderMarkdownV2({ state: sources.state, suite: sources.suite, manifest });
  const titleSuffix = manifest ? `${manifest.displayName} Pilot Evaluation Dossier` : 'Vendor B Pilot Evaluation Dossier';
  const html = markdownToHtml(md, titleSuffix);
  const outDir = resolve(opts.root ?? REPO_ROOT, opts.out ?? 'dist/pilot');
  const idForFilename = manifest?.operatorId ?? DEFAULT_OPERATOR_ID;
  const baseName = `${idForFilename}-pilot-dossier-v2`;
  const mdPath = resolve(outDir, `${baseName}.md`);
  const htmlPath = resolve(outDir, `${baseName}.html`);
  if (!opts.dryRun) {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(mdPath, md);
    await fs.writeFile(htmlPath, html);
  }
  return {
    markdownPath: mdPath,
    htmlPath,
    markdownBytes: Buffer.byteLength(md, 'utf8'),
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    sectionCount: manifest ? SECTION_TITLES.length : V1_SECTION_TITLES.length,
    operatorId: idForFilename,
    operatorManifest: manifest,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  buildDossierV2({
    state: args.state,
    suite: args.suite,
    out: args.out,
    operatorId: args.operatorId,
  })
    .then((r) => {
      console.log(`pilot-dossier-v2: operator=${r.operatorId} sections=${r.sectionCount}`);
      console.log(`  md:   ${basename(r.markdownPath)} (${r.markdownBytes} bytes)`);
      console.log(`  html: ${basename(r.htmlPath)} (${r.htmlBytes} bytes)`);
    })
    .catch((err) => {
      console.error('build-pilot-dossier-v2 failed', err);
      process.exit(2);
    });
}
