#!/usr/bin/env node
/*
 * W215 Faza 800.2 Agent C — synthetic 30-day funnel snapshot generator.
 *
 * Produces a deterministic snapshot of marketing-funnel + A/B
 * experiment data so the analytics dashboard can be exercised end-to-
 * end without a live event stream. Output is keyed solely on the
 * --seed flag (default 'sme-w215'), so two invocations produce
 * byte-identical JSON. Useful for testing and CI.
 *
 * Outputs:
 *   reports/marketing/FUNNEL_SNAPSHOT_<isoDate>.json
 *   reports/marketing/FUNNEL_SNAPSHOT_<isoDate>.md
 *   reports/marketing/FUNNEL_SNAPSHOT_latest.json   (symlink-style copy)
 *
 * Flags:
 *   --seed <string>      deterministic seed (default 'sme-w215')
 *   --days <int>         window size (default 30)
 *   --baseline-uniques <int>   landing uniques per day (default 290)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

/** Mulberry32 PRNG — deterministic, fast, tiny. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h ^ s.length) >>> 0;
}

export function buildSnapshot(opts = {}) {
  const seed = opts.seed ?? 'sme-w215';
  const days = opts.days ?? 30;
  const baselineUniques = opts.baselineUniques ?? 290;
  const rng = mulberry32(hashSeed(seed));

  const pages = [
    '/', '/pages/how-it-works.html', '/pages/pricing.html',
    '/pages/coverage.html', '/pages/demo.html', '/pages/contact.html',
    '/blog/index.html', '/case-studies/case-study-1-multi-jurisdiction.html',
  ];

  // Synthetic but realistic distributions.
  const pageviewWeights = [4.2, 1.9, 1.5, 0.85, 0.6, 0.4, 0.55, 0.35];
  const pageviews = pages.map((page, i) => {
    const wkdayFactor = 1.0 + (rng() - 0.5) * 0.05;
    const uniques = Math.round(baselineUniques * days * pageviewWeights[i] * wkdayFactor);
    const views = Math.round(uniques * (1.2 + rng() * 0.4));
    const bouncePct = Math.round((10 + rng() * 30) * 10) / 10;
    const avgScrollPct = Math.round(40 + rng() * 50);
    return { page, views, uniques, bouncePct, avgScrollPct };
  });

  // Funnel: landing → pricing → demo → contact → signup
  const landing = pageviews[0].uniques;
  const pricing = pageviews[2].uniques;
  const demo    = pageviews[4].uniques;
  const contact = pageviews[5].uniques;
  const signup  = Math.round(contact * (0.20 + rng() * 0.10));
  const funnel = { landing, pricing, demo, contact, signup };

  // CTAs.
  const ctas = [
    { label: 'Talk to sales',     destination: '/pages/contact.html',     clicks: contact, ctr: round1((contact / landing) * 100) },
    { label: 'Book a demo',       destination: '/pages/demo.html',        clicks: demo,    ctr: round1((demo / landing) * 100) },
    { label: 'See pricing',       destination: '/pages/pricing.html',     clicks: pricing, ctr: round1((pricing / landing) * 100) },
    { label: 'Read how it works', destination: '/pages/how-it-works.html',clicks: pageviews[1].uniques, ctr: round1((pageviews[1].uniques / landing) * 100) },
  ];

  // A/B experiments — variants are nudged from a base rate via small
  // additive lifts.
  const experiments = [
    {
      id: 'hero_headline_v2',
      variants: makeAbVariants(rng, ['A', 'B', 'C'], 3000, 0.028, [0, 0.012, -0.008]),
    },
    {
      id: 'pricing_tier_order',
      variants: makeAbVariants(rng, ['indie-first', 'platform-first'], 2100, 0.064, [0, 0.004]),
    },
    {
      id: 'cta_button_color',
      variants: makeAbVariants(rng, ['cyan', 'amber', 'emerald'], 1630, 0.110, [0, -0.012, -0.008]),
    },
  ];

  return {
    seed,
    windowDays: days,
    generatedAt: '2026-05-19T00:00:00.000Z',
    pageviews,
    funnel,
    ctas,
    experiments,
  };
}

function makeAbVariants(rng, names, perVariantImpressions, baseRate, lifts) {
  return names.map((name, i) => {
    const rate = Math.max(0.001, baseRate + (lifts[i] ?? 0) + (rng() - 0.5) * 0.004);
    const impressions = perVariantImpressions + Math.round((rng() - 0.5) * 60);
    const conversions = Math.round(impressions * rate);
    return { name, impressions, conversions };
  });
}

function round1(x) { return Math.round(x * 10) / 10; }

export function toMarkdown(snap) {
  const lines = [
    `# Funnel snapshot — seed \`${snap.seed}\` · window ${snap.windowDays} d`,
    '',
    `Generated at ${snap.generatedAt}.`,
    '',
    '## Pageviews',
    '',
    '| Page | Views | Uniques | Bounce % | Avg scroll % |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...snap.pageviews.map((r) => `| ${r.page} | ${r.views.toLocaleString()} | ${r.uniques.toLocaleString()} | ${r.bouncePct} | ${r.avgScrollPct} |`),
    '',
    '## Funnel',
    '',
    '| Stage | Uniques |',
    '| --- | ---: |',
    `| Landing | ${snap.funnel.landing.toLocaleString()} |`,
    `| Pricing | ${snap.funnel.pricing.toLocaleString()} |`,
    `| Demo    | ${snap.funnel.demo.toLocaleString()} |`,
    `| Contact | ${snap.funnel.contact.toLocaleString()} |`,
    `| Signup  | ${snap.funnel.signup.toLocaleString()} |`,
    '',
    `Landing → Signup: ${((snap.funnel.signup / snap.funnel.landing) * 100).toFixed(2)} %`,
    '',
    '## CTAs',
    '',
    '| Label | Destination | Clicks | CTR |',
    '| --- | --- | ---: | ---: |',
    ...snap.ctas.map((c) => `| ${c.label} | \`${c.destination}\` | ${c.clicks.toLocaleString()} | ${c.ctr} % |`),
    '',
    '## A/B experiments',
    '',
    ...snap.experiments.flatMap((e) => [
      `### ${e.id}`,
      '',
      '| Variant | Impressions | Conversions | Rate |',
      '| --- | ---: | ---: | ---: |',
      ...e.variants.map((v) => `| ${v.name} | ${v.impressions.toLocaleString()} | ${v.conversions.toLocaleString()} | ${((v.conversions / Math.max(1, v.impressions)) * 100).toFixed(2)} % |`),
      '',
    ]),
  ];
  return lines.join('\n');
}

function isoDate(d = new Date('2026-05-19T00:00:00Z')) {
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') out.seed = argv[++i];
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a === '--baseline-uniques') out.baselineUniques = Number(argv[++i]);
  }
  return out;
}

function main(argv) {
  const opts = parseArgs(argv);
  const reportDir = resolve(REPO, 'reports', 'marketing');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const snap = buildSnapshot(opts);
  const stamp = isoDate();
  const jsonPath = join(reportDir, `FUNNEL_SNAPSHOT_${stamp}.json`);
  const mdPath   = join(reportDir, `FUNNEL_SNAPSHOT_${stamp}.md`);
  const latest   = join(reportDir, 'FUNNEL_SNAPSHOT_latest.json');
  const json = JSON.stringify(snap, null, 2);
  writeFileSync(jsonPath, json, 'utf-8');
  writeFileSync(latest,   json, 'utf-8');
  writeFileSync(mdPath,   toMarkdown(snap), 'utf-8');
  process.stdout.write(`Wrote ${jsonPath}\n`);
}

const __isMain = (() => {
  try { return resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (__isMain) main(process.argv.slice(2));
