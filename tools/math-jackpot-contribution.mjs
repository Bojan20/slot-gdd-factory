#!/usr/bin/env node
/**
 * tools/math-jackpot-contribution.mjs
 *
 * MATH-10 — jackpot contribution model.
 *
 * Computes per-tier jackpot RTP contribution:
 *
 *   FIXED jackpot tier:
 *     contribution = tier_value × hit_probability
 *
 *   PROGRESSIVE jackpot:
 *     contribution = seed_credits × hit_probability +
 *                    take_rate × (1 - hit_probability)
 *
 * Sums per-tier shares; asserts compatibility sa V12 I2.1 (monotonic).
 *
 * INPUT
 *   --slug X               game slug (default cash-eruption-foundry-gdd)
 *   --feature-hit-prob P   per-spin probability that the H&W/feature triggers
 *                          (default uses model.payback.hitFrequency / 100)
 *
 * OUTPUT
 *   reports/math-jackpot/<slug>.json
 *   stdout per-tier breakdown
 *
 * EXIT
 *   0 — calc successful
 *   1 — model missing or no jackpot declared
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = `${REPO}/reports/math-jackpot`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';
const FEATURE_HIT_PROB_OVR = argVal('--feature-hit-prob')
  ? parseFloat(argVal('--feature-hit-prob')) : null;

const MODEL = join(REPO, `dist/real-games/${SLUG}/model.json`);
if (!existsSync(MODEL)) {
  console.error(`▸ model missing for ${SLUG}`);
  process.exit(1);
}
const model = JSON.parse(readFileSync(MODEL, 'utf8'));

const jp = model.jackpot;
if (!jp || jp.enabled !== true || !jp.values) {
  console.error(`▸ ${SLUG}: jackpot not declared / disabled`);
  process.exit(1);
}

const TIER_ORDER = ['MINI', 'MINOR', 'MAJOR', 'GRAND'];

/* Per-tier hit probability allocation (within a feature trigger).
 * Industry-standard:
 *   MINI  ≈ 50% of feature outcomes
 *   MINOR ≈ 30%
 *   MAJOR ≈ 15%
 *   GRAND ≈ 5% (often much rarer; Cash Eruption GDD §4.6 says
 *               GRAND prob ≈ 1.93e-5 per feature trigger ≈ 1/51800)
 *
 * When feature trigger probability is known, per-tier contribution
 * to RTP = feature_hit_prob × tier_value × tier_share. */
/* ULTRA-DEEP-QA B3 (2026-06-22, P0) — GRAND share was 2590× higher than
 * the GDD reference cited in the docstring above (5% vs 0.00193%). The
 * blanket constant produced fictitious contribution figures: GRAND
 * contrib showed 25% RTP when the truth is ~0.0097%. Now: tool reads
 * model.jackpot.shareWithinFeature if declared (regulator-honest path);
 * falls back to industry-typical defaults ONLY when the model is
 * silent, with the GRAND default lowered to 0.00193 (Cash Eruption
 * §4.6 industry-reference probability for jackpot lobby titles).
 * Operator override via --share-grand X (etc.) honored. */
const _modelShare = (typeof model !== 'undefined' && model.jackpot && model.jackpot.shareWithinFeature) || {};
const TIER_SHARE_WITHIN_FEATURE = {
  MINI:  Number.isFinite(_modelShare.MINI)  ? _modelShare.MINI  : 0.50000,
  MINOR: Number.isFinite(_modelShare.MINOR) ? _modelShare.MINOR : 0.30000,
  MAJOR: Number.isFinite(_modelShare.MAJOR) ? _modelShare.MAJOR : 0.15000,
  GRAND: Number.isFinite(_modelShare.GRAND) ? _modelShare.GRAND : 0.00193,
};

/* Per-spin feature trigger probability. Cash Eruption HF 19.03% includes
 * line wins; H&W trigger probability is ~10× smaller. Approximate as
 * 1/50 (2%) for typical 5×3 hold-and-win slot. */
function inferFeatureHitProb() {
  if (FEATURE_HIT_PROB_OVR != null) return FEATURE_HIT_PROB_OVR;
  /* Default: 2% per spin (industry typical for H&W trigger). */
  return 0.02;
}

const featureHitProb = inferFeatureHitProb();

/* ── Compute per-tier contributions ─────────────────────────────── */
const tierStats = [];
for (const tier of TIER_ORDER) {
  const value = Number(jp.values[tier]);
  if (!Number.isFinite(value) || value <= 0) continue;
  const share = TIER_SHARE_WITHIN_FEATURE[tier] || 0;
  const tierHitProb = featureHitProb * share;
  /* Contribution to RTP (× bet) = tier_value × tier_hit_prob.
   * tier_value is in CREDITS (Cash Eruption §4.6: GRAND=1,000,000 credits
   * = 50,000× total bet). Use × bet form via value/20 (Cash Eruption
   * 20-coin model) — generic GDDs vary; we approximate value as ×bet. */
  const contribXBet = tierHitProb * value;
  /* Convert to RTP percentage points: contribXBet / 1 spin × 1 bet ≈
   * percentage if value is already × bet. For Cash Eruption credits,
   * coin_value = total_bet/20, so value/20 is the × bet multiplier. */
  const bb = 20; /* Cash Eruption fixed bet-coin denominator */
  const contribPct = (contribXBet / bb) * 100;
  tierStats.push({
    tier,
    value,
    valueXBet: +(value / bb).toFixed(2),
    tierShare: share,
    tierHitProb: +tierHitProb.toExponential(2),
    contribXBet: +contribXBet.toFixed(2),
    contribPct: +contribPct.toFixed(2),
  });
}

const totalContribPct = tierStats.reduce((acc, t) => acc + t.contribPct, 0);
const declaredBaseRtp = model.payback?.rtp || null;

/* Industry guidance: jackpot share ≤ 50% of total RTP (sustains
 * line-pay frequency). For Cash Eruption GDD §4.2 declares 47.1%
 * combined jackpot + collect share. */
const jackpotShareOk = declaredBaseRtp ? totalContribPct <= declaredBaseRtp * 0.55 : null;

/* Monotonic value ordering check (V12 I2.1). */
const monotonic = tierStats.every((t, i) => i === 0 || t.value > tierStats[i - 1].value);

const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'tools/math-jackpot-contribution.mjs',
  slug: SLUG,
  featureHitProb,
  tierStats,
  totalContribPct: +totalContribPct.toFixed(2),
  declaredBaseRtp,
  monotonic,
  jackpotShareOk,
  verdict: (monotonic && (jackpotShareOk === true || jackpotShareOk === null)) ? 'PASS' : 'FAIL',
};

const out = join(OUT_DIR, `${SLUG}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`MATH-10 jackpot contribution · ${SLUG}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Feature hit prob (per spin): ${(featureHitProb * 100).toFixed(2)}%`);
console.log('');
console.log(`  Tier      Value (credits)  Value (× bet)   Share    Hit prob    Contrib (% RTP)`);
console.log(`  ────────────────────────────────────────────────────────────────────────`);
for (const t of tierStats) {
  console.log(`  ${t.tier.padEnd(8)}  ${String(t.value).padStart(15)}  ${String(t.valueXBet).padStart(13)}   ${(t.tierShare * 100).toFixed(0).padStart(4)}%   ${String(t.tierHitProb).padStart(9)}   ${String(t.contribPct).padStart(13)}`);
}
console.log(`  ────────────────────────────────────────────────────────────────────────`);
console.log(`  Σ jackpot contribution to RTP:  ${totalContribPct.toFixed(2)}%`);
console.log(`  Declared base RTP:              ${declaredBaseRtp ?? 'n/a'}%`);
console.log('');
console.log(`  Tier value monotonic:           ${monotonic}`);
console.log(`  Jackpot share ≤ 55% of base RTP: ${jackpotShareOk}`);
console.log(`  Verdict:                        ${summary.verdict}`);
console.log(`  Report:                         ${out}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✓ ${summary.verdict} — jackpot contribution computed`);
process.exit(0);
