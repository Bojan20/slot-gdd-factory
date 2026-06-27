#!/usr/bin/env node
/**
 * W214 Faza 1100.0 — Term Sheet Generator.
 *
 * Pre-fills the commercial term sheet template
 * (`docs/contracts/TERM_SHEET_TEMPLATE.md`) for a specific operator +
 * tier (A / B / C) combination, using the W213 operator manifests in
 * `scripts/pitch/operators/`.
 *
 *   npm run contracts:term-sheet -- --operator=aristocrat --tier=B
 *
 * Outputs both markdown and a minimal standalone HTML rendering to
 * `out/contracts/term-sheets/<operator>-tier-<tier>.{md,html}`.
 *
 * Pure Node built-ins (no third-party deps). All public functions
 * export deterministic output for snapshot testing.
 */
import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const OPERATORS_DIR = resolve(REPO_ROOT, 'scripts', 'pitch', 'operators');
const OUT_DIR = resolve(REPO_ROOT, 'out', 'contracts', 'term-sheets');

export const DISCLAIMER_BLOCK =
  '> **DISCLAIMER:** This is a draft template for negotiation reference only.\n' +
  '> All legal terms require review and approval by licensed counsel before\n' +
  '> execution. Numbers, term lengths, and clause language are illustrative\n' +
  '> starting points — not binding commitments or legal advice.';

export const SUPPORTED_TIERS = Object.freeze(['A', 'B', 'C']);

export const SUPPORTED_OPERATORS = Object.freeze([
  'lw',
  'aristocrat',
  'igt',
  'playtech',
  'pragmatic',
  'evolution',
  'hacksaw',
]);

export const TIER_DETAIL = Object.freeze({
  A: Object.freeze({
    name: 'Platform License (Perpetual + Maintenance)',
    short: 'Tier A',
    headline: 'One-time upfront license + annual maintenance.',
    pricingNote: 'See TERM_SHEET_TEMPLATE.md § Tier A for full pricing bands.',
  }),
  B: Object.freeze({
    name: 'Revenue Share',
    short: 'Tier B',
    headline: 'Low upfront + ongoing % of attributable revenue.',
    pricingNote: 'Default revenue share 3-5%; min annual applies.',
  }),
  C: Object.freeze({
    name: 'Acquisition',
    short: 'Tier C',
    headline: 'Acquirer takes Engine IP outright; founder retention + earnout.',
    pricingNote: 'Headline valuation range $200M–$500M (see ACQUISITION_DEAL_MEMO_TEMPLATE.md).',
  }),
});

/** Parse CLI args; exported for testing. */
export function parseArgs(argv) {
  const out = { operator: null, tier: null, outDir: OUT_DIR };
  for (const raw of argv.slice(2)) {
    const m = /^--([a-z-]+)=(.+)$/.exec(raw);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'operator') out.operator = value.trim().toLowerCase();
    else if (key === 'tier') out.tier = value.trim().toUpperCase();
    else if (key === 'out-dir') out.outDir = value;
  }
  return out;
}

/** Validate parsed args, throw on bad input. */
export function validateArgs(args) {
  if (!args.operator) throw new Error('Missing --operator=<id>');
  if (!SUPPORTED_OPERATORS.includes(args.operator)) {
    throw new Error(
      `Unsupported operator "${args.operator}"; supported: ${SUPPORTED_OPERATORS.join(', ')}`,
    );
  }
  if (!args.tier) throw new Error('Missing --tier=A|B|C');
  if (!SUPPORTED_TIERS.includes(args.tier)) {
    throw new Error(
      `Unsupported tier "${args.tier}"; supported: ${SUPPORTED_TIERS.join(', ')}`,
    );
  }
  return args;
}

/** Load + parse the operator manifest from W213. */
export async function loadOperatorManifest(operatorId, opts = {}) {
  const root = opts.operatorsDir ?? OPERATORS_DIR;
  const p = resolve(root, `${operatorId}.json`);
  const buf = await fs.readFile(p, 'utf8');
  return JSON.parse(buf);
}

/** Compute tier-specific commercial numbers based on the manifest. */
export function computeTierNumbers(manifest, tier) {
  const sp = manifest.samplePricing || {};
  const upfrontA = sp.yearOneLicenseUSD ?? 850000;
  const upfrontB = Math.round(upfrontA * 0.17); // ~17% of A → B upfront band
  const minAnnualB = Math.max(upfrontB, 50000);
  // Revenue share scales mildly with industryRank (lower rank → more leverage)
  const rank = manifest.industryRank ?? 5;
  const revSharePct = Math.max(3.0, Math.min(5.0, 5.5 - rank * 0.25));
  const liabilityCapA = Math.max(1_000_000, upfrontA);

  if (tier === 'A') {
    return {
      upfrontUSD: upfrontA,
      annualMaintenanceUSD: Math.round(upfrontA * 0.2),
      liabilityCapUSD: liabilityCapA,
      pilotConvertCreditUSD: Math.round(upfrontA * 0.15),
    };
  }
  if (tier === 'B') {
    return {
      upfrontUSD: upfrontB,
      revenueSharePct: Number(revSharePct.toFixed(2)),
      minAnnualUSD: minAnnualB,
      liabilityCapUSD: 1_000_000,
      pilotConvertCreditUSD: Math.round(upfrontB * 0.5),
    };
  }
  // Tier C
  // Heuristic: bigger operators (low rank, high revenue) anchor higher
  const valuationMidUSD = (() => {
    if (rank <= 2) return 425_000_000;
    if (rank <= 5) return 300_000_000;
    return 225_000_000;
  })();
  return {
    valuationLowUSD: 200_000_000,
    valuationMidUSD,
    valuationHighUSD: 500_000_000,
    earnoutPctCap: 30,
    foundersRetentionMonths: 36,
  };
}

/** Render a tier-A snippet section. */
export function renderTierASection(manifest, nums) {
  return [
    `## ${TIER_DETAIL.A.short} — ${TIER_DETAIL.A.name}`,
    '',
    TIER_DETAIL.A.headline,
    '',
    '| Item                      | Proposed value (USD)            |',
    '| :------------------------ | -------------------------------: |',
    `| Upfront license fee       | $${nums.upfrontUSD.toLocaleString()}              |`,
    `| Annual maintenance        | $${nums.annualMaintenanceUSD.toLocaleString()}              |`,
    `| Liability cap floor       | $${nums.liabilityCapUSD.toLocaleString()}              |`,
    `| Pilot conversion credit   | $${nums.pilotConvertCreditUSD.toLocaleString()}              |`,
    '',
    'Term: 36 months. Non-exclusive. Renewal: 12-month auto with',
    '60-day non-renewal notice. Services per Statement of Work.',
  ].join('\n');
}

/** Render a tier-B snippet section. */
export function renderTierBSection(manifest, nums) {
  return [
    `## ${TIER_DETAIL.B.short} — ${TIER_DETAIL.B.name}`,
    '',
    TIER_DETAIL.B.headline,
    '',
    '| Item                      | Proposed value                    |',
    '| :------------------------ | :--------------------------------- |',
    `| Upfront fee               | $${nums.upfrontUSD.toLocaleString()}               |`,
    `| Revenue share             | ${nums.revenueSharePct.toFixed(2)}% of attributable revenue |`,
    `| Minimum annual            | $${nums.minAnnualUSD.toLocaleString()}               |`,
    `| Liability cap             | $${nums.liabilityCapUSD.toLocaleString()}               |`,
    `| Pilot conversion credit   | $${nums.pilotConvertCreditUSD.toLocaleString()}               |`,
    '',
    'Term: 36 months. Quarterly royalty reporting. Annual audit right',
    '(Vendor pays if variance > 5%). Buy-out option: 3× trailing-12 royalty.',
  ].join('\n');
}

/** Render a tier-C snippet section. */
export function renderTierCSection(manifest, nums) {
  return [
    `## ${TIER_DETAIL.C.short} — ${TIER_DETAIL.C.name}`,
    '',
    TIER_DETAIL.C.headline,
    '',
    '| Band   | Valuation (USD)                |',
    '| :----- | ------------------------------: |',
    `| Low    | $${(nums.valuationLowUSD / 1e6).toFixed(0)}M                       |`,
    `| Mid    | $${(nums.valuationMidUSD / 1e6).toFixed(0)}M                       |`,
    `| High   | $${(nums.valuationHighUSD / 1e6).toFixed(0)}M                       |`,
    '',
    `Earnout cap: up to ${nums.earnoutPctCap}% of headline. Founder retention:`,
    `${nums.foundersRetentionMonths} months. Non-compete: 24 months.`,
    'See ACQUISITION_DEAL_MEMO_TEMPLATE.md for the full DD checklist.',
  ].join('\n');
}

/** Render the full markdown term sheet for an operator + tier. */
export function renderTermSheet(manifest, tier, opts = {}) {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const nums = computeTierNumbers(manifest, tier);

  const header = [
    DISCLAIMER_BLOCK,
    '',
    `# Commercial Term Sheet — ${manifest.displayName} (Tier ${tier})`,
    '',
    `- **Operator:** ${manifest.displayName} (${manifest.legalName})`,
    `- **Vendor:** Slot Math Engine, Inc.`,
    `- **Tier:** ${tier} — ${TIER_DETAIL[tier].name}`,
    `- **Term sheet date:** ${date}`,
    `- **Operator HQ:** ${manifest.hqLocation}`,
    `- **Operator tier:** ${manifest.tier}`,
    `- **Pricing tier label:** ${manifest.pricingTierLabel}`,
    `- **Anchor title:** "${manifest.typicalTitle}"`,
    `- **Cert labs in scope:** ${(manifest.certLabsUsed || []).join(', ')}`,
    `- **Jurisdictions in scope:** ${(manifest.jurisdictions || []).join(', ')}`,
    '',
  ].join('\n');

  let tierSection;
  if (tier === 'A') tierSection = renderTierASection(manifest, nums);
  else if (tier === 'B') tierSection = renderTierBSection(manifest, nums);
  else tierSection = renderTierCSection(manifest, nums);

  const footer = [
    '',
    '## Non-Binding Acknowledgement',
    '',
    'This Term Sheet is non-binding except for confidentiality and',
    'exclusivity-of-negotiations provisions. Binding obligations are',
    'subject to definitive agreements (see `MSA_TEMPLATE.md`).',
    '',
    DISCLAIMER_BLOCK,
    '',
  ].join('\n');

  return `${header}\n${tierSection}\n${footer}`;
}

/** Minimal HTML render — wraps markdown in a styled pre block (no deps). */
export function renderTermSheetHtml(markdown, title) {
  const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeMd = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    `<meta charset="utf-8"><title>${safeTitle}</title>`,
    '<style>',
    'body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #1a1a1a; }',
    'pre { background: #f6f8fa; padding: 1em; border-radius: 6px; white-space: pre-wrap; }',
    'h1 { border-bottom: 1px solid #eee; padding-bottom: 0.3em; }',
    '</style>',
    '</head>',
    '<body>',
    `<h1>${safeTitle}</h1>`,
    `<pre>${safeMd}</pre>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Top-level entrypoint used by both CLI and tests. */
export async function generate(args, opts = {}) {
  validateArgs(args);
  const manifest = await loadOperatorManifest(args.operator, opts);
  const md = renderTermSheet(manifest, args.tier, opts);
  const html = renderTermSheetHtml(
    md,
    `Term Sheet — ${manifest.displayName} (Tier ${args.tier})`,
  );

  if (opts.write !== false) {
    const dir = args.outDir ?? OUT_DIR;
    await fs.mkdir(dir, { recursive: true });
    const base = `${args.operator}-tier-${args.tier.toLowerCase()}`;
    await fs.writeFile(resolve(dir, `${base}.md`), md, 'utf8');
    await fs.writeFile(resolve(dir, `${base}.html`), html, 'utf8');
  }

  return { manifest, markdown: md, html };
}

// CLI entry
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('generate-term-sheet.mjs');
if (isMain) {
  const args = parseArgs(process.argv);
  try {
    const result = await generate(args);
    process.stdout.write(
      `wrote term sheet for ${result.manifest.displayName} (Tier ${args.tier})\n`,
    );
  } catch (err) {
    process.stderr.write(`term-sheet generator failed: ${err.message}\n`);
    process.exit(1);
  }
}
