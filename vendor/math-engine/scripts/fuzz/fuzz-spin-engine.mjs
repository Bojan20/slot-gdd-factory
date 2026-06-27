#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Fuzz the full spin pipeline.
 *
 * Pipeline:  debit → spin → credit → audit
 *
 * Strategy: synthesise random (tenant, game, amount) triples and feed
 * them into a self-contained stub of the spin pipeline. Asserts that
 *
 *   1. The pipeline NEVER throws an uncaught exception.
 *   2. wallet_after == wallet_before - bet + payout (conservation).
 *   3. The audit trail length matches the requested action count.
 *   4. Currency is preserved across the pipeline.
 *
 * Stubs live in this file so the harness is hermetic for CI runs.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gen, FuzzRng } from './_lib.mjs';
import { runFuzzV2, resolveBudget } from './_lib-v2.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

// ---------------------------------------------------------------------------
// Pipeline stubs — mirror the live spin engine contract.
// ---------------------------------------------------------------------------

const SUPPORTED_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'PLN']);
const KNOWN_GAMES = new Set(['lw-cash-machine', 'lw-monopoly', 'lw-quick-hit', 'lw-rich-bandit']);

/**
 * Apply a debit (bet) to a wallet snapshot. Returns a new snapshot.
 * Never mutates the input. Throws nothing — error → { ok:false }.
 *
 * @param {{balance:number,currency:string,tenantId:string}} wallet
 * @param {number} amount
 */
export function debit(wallet, amount) {
  if (!wallet || typeof wallet !== 'object') return { ok: false, code: 'bad_wallet' };
  if (typeof wallet.balance !== 'number' || !Number.isFinite(wallet.balance) || wallet.balance < 0) {
    return { ok: false, code: 'bad_balance' };
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: 'bad_amount' };
  }
  if (amount > wallet.balance) return { ok: false, code: 'insufficient_funds' };
  if (typeof wallet.currency !== 'string' || !SUPPORTED_CURRENCIES.has(wallet.currency)) {
    return { ok: false, code: 'bad_currency' };
  }
  return { ok: true, wallet: { ...wallet, balance: wallet.balance - amount } };
}

/**
 * Run a single spin given a seed + game + bet. Pure / deterministic.
 * @param {{seed:number,gameId:string,bet:number}} req
 */
export function spin(req) {
  if (!req || typeof req !== 'object') return { ok: false, code: 'bad_req' };
  if (typeof req.gameId !== 'string' || !KNOWN_GAMES.has(req.gameId)) {
    return { ok: false, code: 'unknown_game' };
  }
  if (typeof req.bet !== 'number' || !Number.isFinite(req.bet) || req.bet <= 0) {
    return { ok: false, code: 'bad_bet' };
  }
  if (typeof req.seed !== 'number' || !Number.isFinite(req.seed)) {
    return { ok: false, code: 'bad_seed' };
  }
  // Deterministic payout from seed — emulate ~95% RTP.
  const rng = new FuzzRng(Math.abs(Math.trunc(req.seed)) || 1);
  const roll = rng.unit();
  let payout = 0;
  if (roll < 0.20) payout = req.bet * 0;
  else if (roll < 0.50) payout = Math.round(req.bet * 0.5);
  else if (roll < 0.85) payout = req.bet;
  else if (roll < 0.97) payout = Math.round(req.bet * 5);
  else payout = Math.round(req.bet * 50);
  if (!Number.isFinite(payout) || payout < 0) return { ok: false, code: 'spin_payout_bad' };
  return { ok: true, payout, rngOutput: roll };
}

/**
 * Apply a credit (win payout) to the wallet. Pure.
 */
export function credit(wallet, amount) {
  if (!wallet || typeof wallet !== 'object') return { ok: false, code: 'bad_wallet' };
  if (typeof wallet.balance !== 'number' || !Number.isFinite(wallet.balance)) {
    return { ok: false, code: 'bad_balance' };
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return { ok: false, code: 'bad_amount' };
  }
  // Overflow guard.
  if (wallet.balance + amount > Number.MAX_SAFE_INTEGER / 2) {
    return { ok: false, code: 'overflow' };
  }
  return { ok: true, wallet: { ...wallet, balance: wallet.balance + amount } };
}

/**
 * Append spin record to the audit trail.
 */
export function audit(trail, entry) {
  if (!Array.isArray(trail)) return { ok: false, code: 'bad_trail' };
  if (!entry || typeof entry !== 'object') return { ok: false, code: 'bad_entry' };
  if (typeof entry.tenantId !== 'string') return { ok: false, code: 'bad_tenant' };
  return { ok: true, trail: [...trail, { ...entry, at: 0 /* deterministic */ }] };
}

/**
 * Full spin pipeline: debit → spin → credit → audit.
 */
export function runPipeline(input) {
  const { wallet, gameId, bet, seed, trail } = input;
  const d = debit(wallet, bet);
  if (!d.ok) return { ok: false, stage: 'debit', code: d.code };
  const s = spin({ gameId, bet, seed });
  if (!s.ok) return { ok: false, stage: 'spin', code: s.code };
  const c = credit(d.wallet, s.payout);
  if (!c.ok) return { ok: false, stage: 'credit', code: c.code };
  const a = audit(trail, { tenantId: wallet.tenantId, gameId, bet, payout: s.payout });
  if (!a.ok) return { ok: false, stage: 'audit', code: a.code };
  return {
    ok: true,
    walletBefore: wallet.balance,
    walletAfter: c.wallet.balance,
    bet,
    payout: s.payout,
    trail: a.trail,
    currency: wallet.currency,
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function genWallet(rng) {
  const validCurrency = rng.unit() < 0.7;
  return {
    tenantId: rng.unit() < 0.9 ? `t-${rng.intRange(1, 9999)}` : gen.badString(rng),
    balance: rng.unit() < 0.85 ? rng.intRange(0, 1_000_000) : gen.number(rng),
    currency: validCurrency
      ? rng.pick(['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'PLN'])
      : gen.badString(rng),
  };
}

function makeInput(rng) {
  return {
    wallet: genWallet(rng),
    gameId: rng.unit() < 0.7
      ? rng.pick(['lw-cash-machine', 'lw-monopoly', 'lw-quick-hit', 'lw-rich-bandit'])
      : gen.badString(rng),
    bet: rng.unit() < 0.85 ? rng.intRange(1, 1000) : gen.number(rng),
    seed: rng.next(),
    trail: [],
  };
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export function body(input, cov) {
  const res = runPipeline(input);
  if (!res || typeof res.ok !== 'boolean') throw new Error('pipeline non-result');
  if (!res.ok) {
    if (cov) cov.mark(`fail:${res.stage}:${res.code}`);
    return;
  }
  if (cov) cov.mark('ok');
  // Conservation invariant: walletAfter == walletBefore - bet + payout.
  const expected = res.walletBefore - res.bet + res.payout;
  if (Math.abs(res.walletAfter - expected) > 1e-9) {
    throw new Error(`conservation violated: ${res.walletAfter} != ${expected}`);
  }
  // Audit trail must have grown by exactly 1.
  if (res.trail.length !== 1) {
    throw new Error(`trail length ${res.trail.length}, expected 1`);
  }
  // Currency preserved.
  if (res.currency !== input.wallet.currency) {
    throw new Error(`currency drift: ${res.currency} vs ${input.wallet.currency}`);
  }
}

// ---------------------------------------------------------------------------
// Entry-point
// ---------------------------------------------------------------------------

export function main(opts = {}) {
  const budget = opts.budget ?? process.env.FUZZ_BUDGET ?? 'synthetic';
  const report = runFuzzV2({
    name: 'spin-engine',
    makeInput,
    body,
    budget,
    maxWallMs: opts.maxWallMs,
  });
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'REPORT-spin-engine.json'), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = main({ budget: resolveBudget(process.env.FUZZ_BUDGET ?? 'synthetic') });
  if (r.uniqueCrashes > 0) {
    console.error(`fuzz-spin-engine: ${r.uniqueCrashes} unique crashes`);
    process.exit(1);
  }
}
