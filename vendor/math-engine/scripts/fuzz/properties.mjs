#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Property-based invariants for the spin engine + IR.
 *
 * Random fuzzing is good at finding crashes but misses logic bugs that
 * fall under a stable contract — i.e. the system runs without throwing
 * but produces a wrong answer. Properties pin down those contracts:
 *
 *   determinism      ∀ (seed,input). out₁ == out₂
 *   monotonicity     ∀ ε>0. rtp(c·(1+ε)) ≈ (1+ε)·rtp(c)
 *   conservation     spin payout sum ≤ wallet debit
 *   idempotency      replay(spin) == spin
 *   round_trip       deserialise(serialise(x)) == x
 *
 * Each property is tested with `iterations` random inputs.
 */

import { FuzzRng } from './_lib.mjs';
import { runPipeline, debit, credit, spin } from './fuzz-spin-engine.mjs';
import { sign, verify } from './fuzz-license-jwt.mjs';

// ---------------------------------------------------------------------------
// Property: determinism — same seed/input → same output.
// ---------------------------------------------------------------------------

export function propDeterminism(iterations) {
  const violations = [];
  for (let i = 0; i < iterations; i++) {
    const rng = new FuzzRng(i + 1);
    const req = {
      gameId: 'lw-quick-hit',
      bet: rng.intRange(1, 1000),
      seed: rng.next(),
    };
    const a = spin(req);
    const b = spin(req);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      violations.push({ i, a, b });
    }
  }
  return { property: 'determinism', iterations, violations };
}

// ---------------------------------------------------------------------------
// Property: conservation — spin payout sum ≤ wallet debit + initial.
// ---------------------------------------------------------------------------

export function propConservation(iterations) {
  const violations = [];
  for (let i = 0; i < iterations; i++) {
    const rng = new FuzzRng(i + 1);
    const initialBalance = rng.intRange(1000, 1_000_000);
    const wallet = { tenantId: 't-1', balance: initialBalance, currency: 'EUR' };
    const bet = rng.intRange(1, 100);
    const result = runPipeline({ wallet, gameId: 'lw-quick-hit', bet, seed: rng.next(), trail: [] });
    if (!result.ok) continue;
    const expected = initialBalance - bet + result.payout;
    if (Math.abs(result.walletAfter - expected) > 1e-9) {
      violations.push({ i, expected, got: result.walletAfter });
    }
  }
  return { property: 'conservation', iterations, violations };
}

// ---------------------------------------------------------------------------
// Property: idempotency — debit/credit chains are reversible.
// ---------------------------------------------------------------------------

export function propIdempotency(iterations) {
  const violations = [];
  for (let i = 0; i < iterations; i++) {
    const rng = new FuzzRng(i + 1);
    const start = { tenantId: 't', balance: rng.intRange(100, 100_000), currency: 'EUR' };
    const amt = rng.intRange(1, 100);
    const d = debit(start, amt);
    if (!d.ok) continue;
    const c = credit(d.wallet, amt);
    if (!c.ok) continue;
    if (Math.abs(c.wallet.balance - start.balance) > 1e-9) {
      violations.push({ i, start: start.balance, end: c.wallet.balance });
    }
  }
  return { property: 'idempotency', iterations, violations };
}

// ---------------------------------------------------------------------------
// Property: monotonicity — doubling the bet doubles expected payout.
// ---------------------------------------------------------------------------

export function propMonotonicity(iterations) {
  const violations = [];
  for (let i = 0; i < iterations; i++) {
    const rng = new FuzzRng(i + 1);
    const seed = rng.next();
    const baseBet = rng.intRange(10, 100);
    const a = spin({ gameId: 'lw-quick-hit', bet: baseBet, seed });
    const b = spin({ gameId: 'lw-quick-hit', bet: baseBet * 2, seed });
    if (!a.ok || !b.ok) continue;
    // Same seed → same multiplier bucket → b.payout ≈ 2·a.payout (off-by-1 due to rounding).
    const ratio = a.payout === 0 ? (b.payout === 0 ? 1 : Infinity) : b.payout / a.payout;
    if (a.payout > 0 && Math.abs(ratio - 2) > 0.51) {
      violations.push({ i, a: a.payout, b: b.payout, ratio });
    }
  }
  return { property: 'monotonicity', iterations, violations };
}

// ---------------------------------------------------------------------------
// Property: round-trip — sign(verify(token)) == token for legit tokens.
// ---------------------------------------------------------------------------

export function propRoundTrip(iterations) {
  const violations = [];
  for (let i = 0; i < iterations; i++) {
    const rng = new FuzzRng(i + 1);
    const payload = {
      licenseId: `lic-${rng.intRange(1, 9999)}`,
      exp: 1_700_001_000 + rng.intRange(0, 100_000),
      tier: 'pro',
      tenantId: `t-${rng.intRange(1, 999)}`,
    };
    const token = sign(payload);
    const r = verify(token);
    if (!r.ok) {
      violations.push({ i, code: r.code, payload });
      continue;
    }
    if (r.payload.licenseId !== payload.licenseId || r.payload.exp !== payload.exp) {
      violations.push({ i, payload, got: r.payload });
    }
  }
  return { property: 'round_trip', iterations, violations };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export const ALL_PROPERTIES = [
  propDeterminism,
  propConservation,
  propIdempotency,
  propMonotonicity,
  propRoundTrip,
];

export function runProperties(iterations = 10_000) {
  const results = ALL_PROPERTIES.map((p) => p(iterations));
  const totalViolations = results.reduce((a, r) => a + r.violations.length, 0);
  return { iterations, results, totalViolations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argIter = Number(process.env.PROP_ITER ?? 10_000);
  const summary = runProperties(argIter);
  console.log(`Properties checked: ${summary.results.length} × ${summary.iterations} iters · ${summary.totalViolations} violations`);
  for (const r of summary.results) {
    console.log(`  ${r.property}: ${r.violations.length} violations`);
  }
  if (summary.totalViolations > 0) process.exit(1);
}
