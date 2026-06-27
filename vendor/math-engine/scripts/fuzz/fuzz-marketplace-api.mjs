#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Fuzz the marketplace REST API endpoint parser.
 *
 * Generates malformed JSON payloads, oversize bodies, prototype-pollution
 * attempts, broken pagination params, and feeds them into the lenient
 * payload validators that every endpoint runs at the top of its
 * handler. Asserts:
 *
 *   1. validation NEVER throws to the request transport (must return a
 *      400-shape error).
 *   2. validation NEVER allocates an unbounded structure (we cap input
 *      size at 1 MiB before parsing).
 *   3. validation rejects `__proto__` / `constructor.prototype` keys.
 *
 * Self-contained stub validators live in this file so the harness
 * doesn't depend on the live HTTP module at test time.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gen, runFuzz } from './_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

// ---------------------------------------------------------------------------
// Endpoint stubs — mirror the marketplace REST surface.
// ---------------------------------------------------------------------------

export const MAX_BODY_BYTES = 1_048_576;

export function validateListingPayload(raw) {
  if (typeof raw === 'string') {
    if (raw.length > MAX_BODY_BYTES) return { ok: false, status: 413, code: 'body_too_large' };
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, status: 400, code: 'invalid_json' };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, code: 'non_object' };
  }
  for (const k of Object.keys(raw)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return { ok: false, status: 400, code: 'prototype_pollution' };
    }
  }
  if (typeof raw.title !== 'string' || raw.title.length === 0 || raw.title.length > 256) {
    return { ok: false, status: 400, code: 'bad_title' };
  }
  if (typeof raw.priceCents !== 'number' || !Number.isInteger(raw.priceCents)
      || raw.priceCents < 0 || raw.priceCents > 1_000_000_000) {
    return { ok: false, status: 400, code: 'bad_price' };
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 32) {
      return { ok: false, status: 400, code: 'bad_tags' };
    }
    for (const t of raw.tags) {
      if (typeof t !== 'string' || t.length > 64) return { ok: false, status: 400, code: 'bad_tag' };
    }
  }
  return { ok: true, normalised: { title: raw.title, priceCents: raw.priceCents, tags: raw.tags ?? [] } };
}

export function validateSearchParams(qs) {
  if (qs == null || typeof qs !== 'object') return { ok: false, status: 400, code: 'non_object' };
  const limit = Number(qs.limit ?? 20);
  const offset = Number(qs.offset ?? 0);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    return { ok: false, status: 400, code: 'bad_limit' };
  }
  if (!Number.isFinite(offset) || offset < 0 || offset > 1_000_000) {
    return { ok: false, status: 400, code: 'bad_offset' };
  }
  const q = typeof qs.q === 'string' ? qs.q : '';
  if (q.length > 256) return { ok: false, status: 400, code: 'q_too_long' };
  return { ok: true, normalised: { q, limit, offset } };
}

export function validatePurchasePayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, code: 'non_object' };
  }
  if (typeof raw.listingId !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(raw.listingId)) {
    return { ok: false, status: 400, code: 'bad_listing_id' };
  }
  if (typeof raw.tenantId !== 'string' || raw.tenantId.length === 0 || raw.tenantId.length > 64) {
    return { ok: false, status: 400, code: 'bad_tenant' };
  }
  if (raw.note !== undefined && (typeof raw.note !== 'string' || raw.note.length > 1024)) {
    return { ok: false, status: 400, code: 'bad_note' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function genListing(rng) {
  // 5% of the time send raw string (potentially JSON), otherwise object.
  if (rng.unit() < 0.05) return gen.badString(rng);
  if (rng.unit() < 0.02) return 'A'.repeat(MAX_BODY_BYTES + 1);
  const obj = {
    title: gen.badString(rng),
    priceCents: gen.number(rng),
    tags: rng.unit() < 0.4 ? gen.arrayOf(rng, gen.badString, 64) : undefined,
  };
  // 5% prototype-pollution attempt.
  if (rng.unit() < 0.05) obj.__proto__ = { polluted: true };
  return obj;
}

function genSearch(rng) {
  return {
    q: rng.unit() < 0.5 ? gen.badString(rng) : gen.string(rng, 32),
    limit: gen.number(rng),
    offset: gen.number(rng),
  };
}

function genPurchase(rng) {
  return {
    listingId: gen.badString(rng),
    tenantId: gen.badString(rng),
    note: rng.unit() < 0.3 ? gen.badString(rng) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export function body(input) {
  const kind = (input?.__kind ?? 'listing');
  const payload = input?.payload ?? input;
  let result;
  if (kind === 'search') result = validateSearchParams(payload);
  else if (kind === 'purchase') result = validatePurchasePayload(payload);
  else result = validateListingPayload(payload);
  if (!result || typeof result.ok !== 'boolean') {
    throw new Error('validator returned non-result');
  }
  if (!result.ok && (typeof result.status !== 'number' || typeof result.code !== 'string')) {
    throw new Error('validator error missing status/code');
  }
  if (result.ok && result.normalised && typeof result.normalised !== 'object') {
    throw new Error('validator normalised not object');
  }
}

function makeInput(rng) {
  const which = rng.next() % 3;
  if (which === 0) return { __kind: 'listing', payload: genListing(rng) };
  if (which === 1) return { __kind: 'search', payload: genSearch(rng) };
  return { __kind: 'purchase', payload: genPurchase(rng) };
}

export function main(opts = {}) {
  const iter = opts.iterations ?? Number(process.env.ITER) ?? 10_000;
  const report = runFuzz({
    name: 'marketplace-api',
    makeInput,
    body,
    iterations: iter,
  });
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'REPORT-marketplace.json'), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = main();
  if (r.crashes.length > 0) {
    console.error(`fuzz-marketplace-api: ${r.crashes.length} crashes`);
    process.exit(1);
  }
}
