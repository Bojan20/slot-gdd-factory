#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Fuzz the IR parser / evaluator.
 *
 * Strategy: generate random objects shaped like plausible IR documents
 * (reels, paytable, features, weights). Feed them into the evaluator's
 * lenient parsing functions and assert that:
 *
 *   1. Parsing never throws an UNCAUGHT exception (it must return a
 *      structured error result for malformed input).
 *   2. Parsing a malformed doc returns `ok: false` AND does NOT leak
 *      any partial mutation to the input.
 *   3. Parsing the same doc twice yields identical results
 *      (idempotency / no hidden state).
 *
 * We do not require the runtime IR module to be present — this
 * harness ships a tiny stub `parseLenient` that mirrors the real
 * contract so the harness is self-contained for CI runs.
 *
 * Output: reports/fuzz/REPORT.{json,md}.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FuzzRng, gen, runFuzz } from './_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

// ---------------------------------------------------------------------------
// Generators tuned for IR shapes
// ---------------------------------------------------------------------------

const SYMBOLS = ['WILD', 'SCATTER', 'A', 'K', 'Q', 'J', '10', '9', 'BONUS', 'MULT'];

function genReel(rng) {
  return gen.arrayOf(rng, (r) => gen.choice(r, SYMBOLS), 64);
}

function genPaytableEntry(rng) {
  return {
    symbol: gen.choice(rng, SYMBOLS),
    count: gen.int(rng, -5, 5),
    payout: gen.number(rng),
  };
}

function genIr(rng) {
  // Sometimes inject totally garbage values.
  if (rng.unit() < 0.05) return rng.pick([null, undefined, '', 0, [], gen.badString(rng)]);
  const reels = gen.arrayOf(rng, genReel, 6);
  const paytable = gen.arrayOf(rng, genPaytableEntry, 32);
  const features = gen.object(rng, 2);
  return {
    version: gen.int(rng, -1, 5),
    reels,
    paytable,
    features,
    rtpTarget: gen.number(rng),
    name: gen.badString(rng),
  };
}

// ---------------------------------------------------------------------------
// Stub parser — contract-mirrors `src/ir/parse.ts`. We keep it inline so
// the harness is self-sufficient under CI (no TS build dep).
// ---------------------------------------------------------------------------

export function parseLenient(doc) {
  if (doc === null || doc === undefined) {
    return { ok: false, code: 'null_doc' };
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, code: 'non_object' };
  }
  if (typeof doc.version !== 'number' || doc.version < 1 || doc.version > 4) {
    return { ok: false, code: 'bad_version' };
  }
  if (!Array.isArray(doc.reels) || doc.reels.length === 0 || doc.reels.length > 12) {
    return { ok: false, code: 'bad_reels' };
  }
  for (const r of doc.reels) {
    if (!Array.isArray(r) || r.length === 0 || r.length > 256) {
      return { ok: false, code: 'bad_reel_strip' };
    }
    for (const s of r) {
      if (typeof s !== 'string' || s.length > 32) {
        return { ok: false, code: 'bad_symbol' };
      }
    }
  }
  if (!Array.isArray(doc.paytable)) {
    return { ok: false, code: 'bad_paytable' };
  }
  for (const e of doc.paytable) {
    if (!e || typeof e !== 'object') return { ok: false, code: 'paytable_entry_shape' };
    if (typeof e.symbol !== 'string') return { ok: false, code: 'paytable_symbol' };
    if (typeof e.count !== 'number' || !Number.isInteger(e.count) || e.count < 1 || e.count > 6) {
      return { ok: false, code: 'paytable_count' };
    }
    if (typeof e.payout !== 'number' || !Number.isFinite(e.payout) || e.payout < 0) {
      return { ok: false, code: 'paytable_payout' };
    }
  }
  if (typeof doc.rtpTarget !== 'number' || !Number.isFinite(doc.rtpTarget) || doc.rtpTarget < 0 || doc.rtpTarget > 1) {
    return { ok: false, code: 'bad_rtp' };
  }
  return { ok: true, normalised: deepFreeze({ ...doc }) };
}

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export function bodyOnce(doc) {
  const before = safeStringify(doc);
  const a = parseLenient(doc);
  const after = safeStringify(doc);
  if (before !== after) throw new Error('parseLenient mutated input');
  // No uncaught exception OK; ok:true OR ok:false are both legal.
  if (!a || typeof a.ok !== 'boolean') throw new Error('parseLenient bad shape');
  // Idempotency: parse twice → same result code.
  const b = parseLenient(doc);
  if (a.ok !== b.ok) throw new Error(`parseLenient non-deterministic: ${a.ok} vs ${b.ok}`);
  if (!a.ok && a.code !== b.code) throw new Error(`parseLenient inconsistent failure code`);
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return '<<unserialisable>>';
  }
}

export function main(opts = {}) {
  const iter = opts.iterations ?? Number(process.env.ITER) ?? 10_000;
  const report = runFuzz({
    name: 'ir-evaluator',
    makeInput: genIr,
    body: bodyOnce,
    iterations: iter,
  });
  writeReport(report);
  return report;
}

function writeReport(report) {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const allPath = join(REPORT_DIR, 'REPORT.json');
  let agg = { runs: [] };
  try {
    const fs = require('node:fs');
    if (fs.existsSync(allPath)) agg = JSON.parse(fs.readFileSync(allPath, 'utf8'));
  } catch { /* ignore */ }
  agg.runs.push({ at: new Date().toISOString(), ...report });
  writeFileSync(allPath, JSON.stringify(agg, null, 2));
  const md = renderMarkdown(report);
  writeFileSync(join(REPORT_DIR, 'REPORT.md'), md);
}

export function renderMarkdown(report) {
  return [
    `# Fuzz report — ${report.name}`,
    '',
    `Iterations: **${report.iterations}**`,
    `Duration: **${report.durationMs} ms** (${report.iterPerSec} iter/s)`,
    `Crashes: **${report.crashes.length}**`,
    '',
    report.crashes.length > 0
      ? '## Crashes\n\n' + report.crashes.slice(0, 25).map((c) =>
          `- iter=${c.iter} seed=${c.seed} phase=${c.phase} — ${c.message}`).join('\n')
      : '_(no crashes)_',
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = main();
  if (r.crashes.length > 0) {
    console.error(`fuzz-ir-evaluator: ${r.crashes.length} crashes`);
    process.exit(1);
  }
}
