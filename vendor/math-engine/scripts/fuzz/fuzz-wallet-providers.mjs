#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Fuzz wallet provider adapter response parsers.
 *
 * Wallet providers (Vendor G-style, Vendor D-aggregator, Vendor F,
 * generic-PAM) all return JSON shaped slightly differently. Each
 * adapter normalises into our internal {@link WalletTx} shape. This
 * harness pummels the normaliser with malformed responses to ensure:
 *
 *   1. Garbage payloads return a typed error, never throw.
 *   2. No partial credit / debit balance leaks into the result.
 *   3. Currency / amount fields are validated and rejected if absurd.
 *
 * Self-contained stubs mirror the adapter contract.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gen, runFuzz } from './_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

const CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'PLN', 'SEK', 'NOK', 'CHF']);

// ---------------------------------------------------------------------------
// Adapter normalisers
// ---------------------------------------------------------------------------

export function normaliseMicrogaming(raw) {
  return safeWrap(() => {
    if (raw == null || typeof raw !== 'object') return errResp('non_object');
    if (raw.errorCode) return errResp(`provider:${raw.errorCode}`);
    if (typeof raw.balance !== 'number' || !Number.isFinite(raw.balance) || raw.balance < 0) {
      return errResp('bad_balance');
    }
    if (typeof raw.txId !== 'string' || raw.txId.length === 0 || raw.txId.length > 128) {
      return errResp('bad_tx_id');
    }
    if (typeof raw.currency !== 'string' || !CURRENCIES.has(raw.currency)) {
      return errResp('bad_currency');
    }
    return okResp({ providerTxId: raw.txId, balance: raw.balance, currency: raw.currency });
  });
}

export function normaliseNetentAggregator(raw) {
  return safeWrap(() => {
    if (!raw || typeof raw !== 'object') return errResp('non_object');
    const data = raw.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return errResp('bad_data');
    if (typeof data.balance_cents !== 'number' || data.balance_cents < 0 || !Number.isInteger(data.balance_cents)) {
      return errResp('bad_balance_cents');
    }
    if (typeof data.reference !== 'string' || !/^[a-z0-9-]{4,64}$/i.test(data.reference)) {
      return errResp('bad_ref');
    }
    if (typeof data.iso_currency !== 'string' || !CURRENCIES.has(data.iso_currency.toUpperCase())) {
      return errResp('bad_currency');
    }
    return okResp({
      providerTxId: data.reference,
      balance: data.balance_cents / 100,
      currency: data.iso_currency.toUpperCase(),
    });
  });
}

export function normalisePlaytechStyle(raw) {
  return safeWrap(() => {
    if (raw == null) return errResp('null');
    if (typeof raw !== 'object') return errResp('non_object');
    const inner = raw.PlaytechResponse;
    if (!inner || typeof inner !== 'object') return errResp('bad_envelope');
    if (inner.status !== 'OK') return errResp(`provider:${inner.status ?? 'unknown'}`);
    const amount = Number(inner.balance);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) return errResp('bad_balance');
    const cur = String(inner.currency ?? '');
    if (!CURRENCIES.has(cur)) return errResp('bad_currency');
    if (typeof inner.refid !== 'string' || inner.refid.length > 128) return errResp('bad_ref');
    return okResp({ providerTxId: inner.refid, balance: amount, currency: cur });
  });
}

export function normaliseGenericPam(raw) {
  return safeWrap(() => {
    if (!raw || typeof raw !== 'object') return errResp('non_object');
    if (raw.error) return errResp(`provider:${typeof raw.error === 'string' ? raw.error : 'unknown'}`);
    if (typeof raw.balance !== 'number' || !Number.isFinite(raw.balance)) return errResp('bad_balance');
    if (raw.balance < 0) return errResp('negative_balance');
    if (typeof raw.transactionId !== 'string' || raw.transactionId.length === 0) {
      return errResp('bad_tx_id');
    }
    if (typeof raw.currency !== 'string' || raw.currency.length !== 3) return errResp('bad_currency');
    return okResp({
      providerTxId: raw.transactionId,
      balance: raw.balance,
      currency: raw.currency.toUpperCase(),
    });
  });
}

function safeWrap(fn) {
  try {
    return fn();
  } catch (e) {
    return errResp(`exception:${e instanceof Error ? e.name : 'unknown'}`);
  }
}

function okResp(p) { return { ok: true, ...p }; }
function errResp(code) { return { ok: false, code }; }

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function genMicrogaming(rng) {
  return {
    balance: gen.number(rng),
    txId: gen.badString(rng),
    currency: rng.unit() < 0.3 ? gen.choice(rng, ['EUR', 'XXX', '']) : gen.badString(rng),
    errorCode: rng.unit() < 0.1 ? gen.badString(rng) : undefined,
  };
}

function genNetent(rng) {
  return {
    data: rng.unit() < 0.85 ? {
      balance_cents: gen.number(rng),
      reference: gen.badString(rng),
      iso_currency: rng.unit() < 0.3 ? 'EUR' : gen.badString(rng),
    } : gen.badString(rng),
  };
}

function genPlaytech(rng) {
  return {
    PlaytechResponse: rng.unit() < 0.9 ? {
      status: rng.unit() < 0.7 ? 'OK' : gen.badString(rng),
      balance: gen.number(rng),
      currency: rng.unit() < 0.3 ? 'EUR' : gen.badString(rng),
      refid: gen.badString(rng),
    } : null,
  };
}

function genPam(rng) {
  return {
    balance: gen.number(rng),
    transactionId: gen.badString(rng),
    currency: rng.unit() < 0.3 ? 'EUR' : gen.badString(rng),
    error: rng.unit() < 0.1 ? gen.badString(rng) : undefined,
  };
}

const KINDS = ['microgaming', 'netent', 'playtech', 'pam'];

function makeInput(rng) {
  const kind = rng.pick(KINDS);
  let raw;
  if (kind === 'microgaming') raw = genMicrogaming(rng);
  else if (kind === 'netent') raw = genNetent(rng);
  else if (kind === 'playtech') raw = genPlaytech(rng);
  else raw = genPam(rng);
  // Occasionally inject completely off-shape payloads.
  if (rng.unit() < 0.05) raw = null;
  if (rng.unit() < 0.05) raw = gen.badString(rng);
  return { kind, raw };
}

export function body(input) {
  const { kind, raw } = input;
  let res;
  if (kind === 'microgaming') res = normaliseMicrogaming(raw);
  else if (kind === 'netent') res = normaliseNetentAggregator(raw);
  else if (kind === 'playtech') res = normalisePlaytechStyle(raw);
  else res = normaliseGenericPam(raw);
  if (!res || typeof res.ok !== 'boolean') throw new Error(`${kind} non-result`);
  if (!res.ok && typeof res.code !== 'string') throw new Error(`${kind} err missing code`);
  if (res.ok) {
    if (typeof res.balance !== 'number' || res.balance < 0) {
      throw new Error(`${kind} ok with bad balance`);
    }
    if (typeof res.currency !== 'string' || res.currency.length !== 3) {
      throw new Error(`${kind} ok with bad currency`);
    }
  }
}

export function main(opts = {}) {
  const iter = opts.iterations ?? Number(process.env.ITER) ?? 10_000;
  const report = runFuzz({
    name: 'wallet-providers',
    makeInput,
    body,
    iterations: iter,
  });
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'REPORT-wallet.json'), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = main();
  if (r.crashes.length > 0) {
    console.error(`fuzz-wallet-providers: ${r.crashes.length} crashes`);
    process.exit(1);
  }
}
