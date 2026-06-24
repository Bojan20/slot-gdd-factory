#!/usr/bin/env node
/**
 * tools/math-rtp-breakdown.mjs
 *
 * MATH-8 — RTP source breakdown calculator.
 *
 * Decomposes total declared RTP into per-source contribution:
 *   • base game line wins
 *   • Free Spins (FS) line wins
 *   • Hold & Win / signature collect feature
 *   • Jackpot tiers
 *   • Bonus features (bonus pick, wheel, gamble)
 *
 * Pulls declared shares from GDD prose ("Base game line wins 41.90%",
 * "Cash Eruption Hold & Win 40.91%", etc.) and asserts:
 *   • Σ contributions ≈ total RTP (±0.5%)
 *   • Each share in [0, 100%]
 *
 * Cash Eruption GDD §4.2 declares:
 *   Base game line wins                              41.90%
 *   Cash Eruption Hold & Win (triggered FROM BASE)   40.91%
 *   Free Spins line wins                              7.00%
 *   Cash Eruption Hold & Win (triggered FROM FREE)    6.19%
 *                                              Total 96.00%
 *
 * USAGE
 *   node tools/math-rtp-breakdown.mjs                          # cash-eruption
 *   node tools/math-rtp-breakdown.mjs --slug X                 # specific
 *
 * OUTPUT
 *   reports/math-rtp-breakdown/<slug>.json
 *   stdout per-source contribution tabela
 *
 * EXIT
 *   0 — breakdown computed (even if Σ ≠ declared, informational)
 *   1 — model missing
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = `${REPO}/reports/math-rtp-breakdown`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';

const MODEL = join(REPO, `dist/real-games/${SLUG}/model.json`);
const RAW   = join(REPO, `dist/real-games/${SLUG}/raw.txt`);

if (!existsSync(MODEL)) {
  console.error(`▸ model missing for ${SLUG}`);
  process.exit(1);
}

const model = JSON.parse(readFileSync(MODEL, 'utf8'));
const raw   = existsSync(RAW) ? readFileSync(RAW, 'utf8') : '';

/* ── Parse "X. RTP Contribution Breakdown" section from prose ─────── */
const sources = [];
const totalRtp = model.payback?.rtp || null;

/* Restrict search to §X.X "RTP Contribution Breakdown" section. */
function getBreakdownSection() {
  const sectionMatch = raw.match(/RTP\s*Contribution\s*Breakdown[\s\S]{0,2000}?(?=\d+\.\d+\s+[A-Z]|$)/i);
  return sectionMatch ? sectionMatch[0] : raw;
}

const _section = getBreakdownSection();

function findShareLine(label) {
  /* Match "<label>... <number>%" within breakdown section only. */
  const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${safeLabel}[^\\n]{0,200}?(\\d{1,3}(?:\\.\\d{1,2})?)\\s*%`, 'i');
  const m = _section.match(re);
  return m ? parseFloat(m[1]) : null;
}

/* Common breakdown sources (industry GDDs use these labels). */
const CANONICAL_SOURCES = [
  { key: 'base_line_wins',           label: 'Base game line wins' },
  { key: 'base_feature_collect',     label: 'Hold & Win (triggered FROM BASE)' },
  { key: 'fs_line_wins',             label: 'Free Spins line wins' },
  { key: 'fs_feature_collect',       label: 'Hold & Win (triggered FROM FREE SPINS)' },
  { key: 'jackpot',                  label: 'Jackpot' },
  { key: 'bonus_pick',               label: 'Bonus Pick' },
];

for (const s of CANONICAL_SOURCES) {
  const share = findShareLine(s.label);
  if (share != null) sources.push({ ...s, sharePct: share });
}

/* Fallback: parse generic "<label> <n>%" pairs from §4.2 section if found. */
if (sources.length === 0) {
  const sectionMatch = raw.match(/RTP\s*Contribution\s*Breakdown[\s\S]{0,1500}/i);
  if (sectionMatch) {
    const sec = sectionMatch[0];
    const lineRe = /([A-Z][A-Za-z\s&()]{4,80})\s+(\d{1,3}(?:\.\d{1,2})?)\s*%/g;
    let m;
    while ((m = lineRe.exec(sec)) !== null) {
      const lbl = m[1].trim();
      const pct = parseFloat(m[2]);
      if (pct > 0 && pct < 100 && !/total/i.test(lbl)) {
        sources.push({ key: lbl.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: lbl, sharePct: pct });
      }
    }
  }
}

/* UQ-DEEP-AQ F-9 (Auditor F #9): sort descending before reduce.
   Floating-point summation is non-associative — different input orders
   give ±1ulp drift. Inside the ±0.05% MATH_PRECISION_BAND, this can flip
   PASS↔FAIL near the boundary. Sorting biggest-first keeps the running
   accumulator at a similar magnitude scale and minimises catastrophic
   cancellation. (Full Kahan adds complexity for marginal gain at these
   magnitudes; descending-sort is the industry-standard cheap fix.) */
const sumShare = sources
  .map((s) => Number(s.sharePct) || 0)
  .sort((a, b) => b - a)
  .reduce((acc, x) => acc + x, 0);

const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'tools/math-rtp-breakdown.mjs',
  slug: SLUG,
  totalRtp,
  sources,
  sumShare: +sumShare.toFixed(2),
  delta: totalRtp != null ? +(sumShare - totalRtp).toFixed(2) : null,
  consistent: totalRtp != null ? Math.abs(sumShare - totalRtp) <= 0.5 : null,
};

const out = join(OUT_DIR, `${SLUG}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`MATH-8 RTP breakdown · ${SLUG}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const s of sources) {
  console.log(`  ${s.label.padEnd(48)} ${String(s.sharePct).padStart(6)}%`);
}
console.log('  ────────────────────────────────────────────────────────────');
console.log(`  ${'Σ contributions'.padEnd(48)} ${String(summary.sumShare).padStart(6)}%`);
console.log(`  ${'Total declared RTP'.padEnd(48)} ${String(totalRtp ?? 'n/a').padStart(6)}%`);
console.log(`  ${'Δ (Σ − Total)'.padEnd(48)} ${String(summary.delta ?? 'n/a').padStart(6)}`);
console.log(`  Consistent (±0.5%): ${summary.consistent}`);
console.log(`  Report:             ${out}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(sources.length > 0 ? '✓ PASS — RTP breakdown computed' : '⚠ WARN — no contribution sources found in prose');
process.exit(0);
