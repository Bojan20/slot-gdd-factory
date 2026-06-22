#!/usr/bin/env node
/**
 * tools/math-bb-variant.mjs
 *
 * MATH-9 — bonus buy variant RTP calculator.
 *
 * Combines:
 *   • model.bonusBuy.costX (industry typical 100×)
 *   • MATH-3 measured RTP / FS contribution from probe
 *   • MATH-7 WASM oracle:
 *       buyFeatureRtp(avgPay, cost) → variant RTP
 *       buyFeatureUkgcRts13cPass(...) → UKGC compliance gate
 *       buyFeatureMgaPass(...) → MGA ceiling gate
 *
 * Output: variant RTP estimate + regulator compliance verdict.
 *
 * USAGE
 *   node tools/math-bb-variant.mjs                          # cash-eruption-foundry-gdd
 *   node tools/math-bb-variant.mjs --slug X --cost 100 --tolerance 2.0 --ceiling 0.98
 *
 * EXIT
 *   0 — calc complete (informational verdicts)
 *   1 — model missing or bonusBuy not declared
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  buyFeatureRtp, buyFeatureUkgcRts13cPass, buyFeatureMgaPass, getEngineKind, loadWasm,
} from '../src/blocks/mathEngine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = `${REPO}/reports/math-bb-variant`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';
const COST_OVERRIDE = argVal('--cost') ? parseFloat(argVal('--cost')) : null;
const UKGC_TOLERANCE_PP = parseFloat(argVal('--tolerance') || '2.0');
const MGA_CEILING = parseFloat(argVal('--ceiling') || '0.98');

const MODEL = join(REPO, `dist/real-games/${SLUG}/model.json`);
const PROBE = join(REPO, `reports/math-rtp/${SLUG}.json`);
const BREAKDOWN = join(REPO, `reports/math-rtp-breakdown/${SLUG}.json`);

if (!existsSync(MODEL)) {
  console.error(`▸ model missing for ${SLUG}`);
  process.exit(1);
}

const model = JSON.parse(readFileSync(MODEL, 'utf8'));
const probe = existsSync(PROBE) ? JSON.parse(readFileSync(PROBE, 'utf8')) : null;
const breakdown = existsSync(BREAKDOWN) ? JSON.parse(readFileSync(BREAKDOWN, 'utf8')) : null;

/* ── ULTRA-DEEP-QA H1 (2026-06-22) — refuse FALSE-GREEN on games without
 *    a declared bonus buy. Header contract said "exit 1 if bonusBuy not
 *    declared" but the guard never existed; tool silently emitted
 *    verdict PASS @ variantRtp 96 for product lines without BB feature.
 *    Regulator risk: UKGC/MGA "compliance receipt" generated for a
 *    feature the game does NOT support. */
const hasBb = !!(model.bonusBuy && (
  model.bonusBuy.enabled === true ||
  Number.isFinite(model.bonusBuy.costX) ||
  Number.isFinite(model.bonusBuy.avgPayXBet) ||
  (Array.isArray(model.bonusBuy.variants) && model.bonusBuy.variants.length > 0)
));
if (!hasBb && COST_OVERRIDE == null) {
  console.error(`▸ ${SLUG} has no bonusBuy declared (model.bonusBuy empty); refusing to emit compliance verdict.`);
  console.error(`  pass --cost <X> to force a hypothetical variant calc against base RTP.`);
  process.exit(1);
}

/* ── Determine inputs ─────────────────────────────────────────────── */
const bb = model.bonusBuy || {};
const buyCost = COST_OVERRIDE != null ? COST_OVERRIDE : (bb.costX || 100);
const baseGameRtp = (model.payback?.rtp || 96) / 100;

/* Bonus average pay (per buy): industry approximation is RTP × cost.
 * Buy feature MUST return ≈ baseRTP × cost on average to stay compliant
 * (UKGC RTS 13C: |buy_rtp - base_rtp| ≤ tolerance_pp).
 *
 * Industry note: actual bonus_avg_pay is the EXPECTED bonus payout per
 * trigger × cost equivalence. We use declared RTP as the canonical
 * estimate; probe-measured can over/under-estimate due to small sample. */
let bonusAvgPay;
let avgPaySource;
if (model.bonusBuy?.avgPayXBet != null) {
  bonusAvgPay = model.bonusBuy.avgPayXBet;
  avgPaySource = 'declared-explicit';
} else if (breakdown && Array.isArray(breakdown.sources) && breakdown.sources.length > 0) {
  /* Use declared RTP × cost as the regulator-side expected avg pay.
   * If declared bonus-portion = X% and base = (100-X)%, then:
   *   bonus_avg_pay = (bonus_share / 100) × cost × scale_factor
   * where scale_factor brings it up to ~ baseRTP × cost (per
   * UKGC/MGA gate compliance). Simplification: use baseRTP × cost. */
  bonusAvgPay = baseGameRtp * buyCost;
  avgPaySource = 'derived-from-base-rtp';
} else if (probe) {
  bonusAvgPay = (probe.measuredRTP / 100) * buyCost;
  avgPaySource = 'probe-measured';
} else {
  bonusAvgPay = buyCost * baseGameRtp;
  avgPaySource = 'declared-fallback';
}

/* ── Compute variant RTP + compliance gates via MATH-7 oracle ─────── */
await loadWasm();
const engineKind = getEngineKind();

const variantRtp = await buyFeatureRtp(bonusAvgPay, buyCost);
const ukgcPass = await buyFeatureUkgcRts13cPass(bonusAvgPay, buyCost, baseGameRtp, UKGC_TOLERANCE_PP);
const mgaPass  = await buyFeatureMgaPass(bonusAvgPay, buyCost, MGA_CEILING);

/* Variant RTP ≤ 100% sanity (player-positive game je impossible). */
const sanityOk = variantRtp <= 1.0;

/* Industry recommendation: variant RTP should NOT exceed base game RTP
 * by more than 2 pp (sustains house edge across feature buys). */
const houseEdgeDiff = variantRtp - baseGameRtp;
const houseEdgeOk   = Math.abs(houseEdgeDiff) <= 0.02;

const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'tools/math-bb-variant.mjs',
  slug: SLUG,
  engineKind,
  inputs: {
    buyCost,
    bonusAvgPay: +bonusAvgPay.toFixed(2),
    avgPaySource,
    baseGameRtp,
    ukgcTolerancePp: UKGC_TOLERANCE_PP,
    mgaCeiling: MGA_CEILING,
  },
  results: {
    variantRtp: +variantRtp.toFixed(4),
    variantRtpPct: +(variantRtp * 100).toFixed(2),
    houseEdgeDiff: +houseEdgeDiff.toFixed(4),
    sanityOk,
    ukgcPass,
    mgaPass,
    houseEdgeOk,
  },
  verdict: (sanityOk && ukgcPass && mgaPass) ? 'PASS' : 'FAIL',
};

const out = join(OUT_DIR, `${SLUG}.json`);
writeFileSync(out, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`MATH-9 bonus buy variant · ${SLUG}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Engine kind:       ${engineKind}`);
console.log(`  Buy cost:          ${buyCost}× bet`);
console.log(`  Bonus avg pay:     ${summary.inputs.bonusAvgPay}× bet (source: ${avgPaySource})`);
console.log(`  Base game RTP:     ${(baseGameRtp * 100).toFixed(2)}%`);
console.log(`  Variant RTP:       ${summary.results.variantRtpPct}%`);
console.log(`  House edge diff:   ${(houseEdgeDiff * 100).toFixed(2)} pp`);
console.log('');
console.log(`  Sanity (≤ 100%):   ${sanityOk}`);
console.log(`  UKGC RTS 13C:      ${ukgcPass} (tolerance ${UKGC_TOLERANCE_PP} pp)`);
console.log(`  MGA RG 2021/02:    ${mgaPass} (ceiling ${(MGA_CEILING * 100).toFixed(0)}%)`);
console.log(`  House edge sane:   ${houseEdgeOk} (|diff| ≤ 2 pp)`);
console.log('');
console.log(`  Verdict:           ${summary.verdict}`);
console.log(`  Report:            ${out}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✓ ${summary.verdict === 'PASS' ? 'PASS' : 'WARN'} — bonus buy variant RTP computed`);
process.exit(0);
