#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Chaos scenario: cert pipeline corrupt.
 *
 * Build a 100-entry hash chain → inject the chaos audit-chain-gap fault
 * → the observer must catch the break and emit `auto_rollback` while
 * preserving the rest of the chain integrity for forensics.
 */

import { createHash } from 'node:crypto';
import { MiniChaosController, mulberry32, pretty } from './_lib.mjs';

const ZERO_HASH = '0'.repeat(64);
const ENTRY_COUNT = 100;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function sealEntry(draft, prevHash) {
  const prev = prevHash ?? ZERO_HASH;
  const sealed = { seq: draft.seq, ts: draft.ts, type: draft.type, payload: draft.payload, prev };
  return { ...draft, prev, current: sha256(canonicalize(sealed)) };
}

function buildChain(n) {
  const out = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const e = sealEntry({ seq: i, ts: `2026-05-18T12:${String(i).padStart(2, '0')}:00Z`, type: 'spin', payload: { idx: i } }, prev);
    out.push(e);
    prev = e.current;
  }
  return out;
}

function verifyChain(chain) {
  let prev = ZERO_HASH;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.prev !== prev) return i;
    const recomputed = sha256(canonicalize({ seq: e.seq, ts: e.ts, type: e.type, payload: e.payload, prev: e.prev }));
    if (recomputed !== e.current) return i;
    prev = e.current;
  }
  return null;
}

export async function runScenario(opts = {}) {
  const rng = opts.rng ?? mulberry32(0xBADC0DE);
  const controller = new MiniChaosController({ rng });
  controller.enable('audit.chain-gap', 1.0);

  const chain = buildChain(ENTRY_COUNT);
  // Pre-condition: clean chain.
  const preIdx = verifyChain(chain);
  if (preIdx !== null) {
    return { name: 'cert-pipeline-corrupt', pass: false, summary: { error: 'baseline chain corrupt', brokenAt: preIdx } };
  }

  // Inject the gap.
  let brokenAt = null;
  if (controller.shouldInject('audit.chain-gap')) {
    brokenAt = 1 + Math.floor(rng() * (chain.length - 1));
    chain[brokenAt] = { ...chain[brokenAt], prev: 'f'.repeat(64) };
  }

  const detectedAt = verifyChain(chain);
  const rollbackTriggered = detectedAt !== null;

  // Forensics: every entry AFTER the broken index should still be
  // internally consistent (current = sha256(canonicalize({...}))) so
  // operators can rebuild upstream from that boundary.
  let postIntact = 0;
  for (let i = (brokenAt ?? 0) + 1; i < chain.length; i++) {
    const e = chain[i];
    const recomputed = sha256(canonicalize({ seq: e.seq, ts: e.ts, type: e.type, payload: e.payload, prev: e.prev }));
    if (recomputed === e.current) postIntact++;
  }

  const expectedPostIntact = chain.length - ((brokenAt ?? 0) + 1);
  const pass =
    brokenAt !== null &&
    rollbackTriggered &&
    detectedAt === brokenAt &&
    postIntact === expectedPostIntact;

  return {
    name: 'cert-pipeline-corrupt',
    pass,
    summary: {
      entries: ENTRY_COUNT,
      brokenAt,
      detectedAt,
      rollbackTriggered,
      postIntact,
      expectedPostIntact,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScenario().then((v) => {
    console.log(pretty(v));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.pass ? 0 : 1);
  });
}
