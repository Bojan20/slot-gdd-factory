#!/usr/bin/env node
/**
 * W210 Faza 600.0 — Smoke: RNG replay determinism.
 *
 * Runs a 1000-spin sequence twice with the same seed and asserts a
 * bit-identical digest (sha256 over the concatenated outcomes). This
 * matches the canary controller's `replayDeterministic` gate.
 */
import { createHash } from 'node:crypto';
import { parseArgs, emit, timed, makeRng } from './_lib.mjs';

const args = parseArgs(process.argv);
const SPINS = Number.parseInt(args.spins ?? '1000', 10);
const SEED = Number.parseInt(args.seed ?? '424242', 10);
const t0 = Date.now();

function digestSpins(seed, count) {
  const rng = makeRng(seed);
  const h = createHash('sha256');
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < count; i++) {
    // Two 32-bit draws per spin: pick a "reel index" and a "payout".
    const a = Math.floor(rng() * 0xffffffff) >>> 0;
    const b = Math.floor(rng() * 0xffffffff) >>> 0;
    view.setUint32(0, a, true);
    view.setUint32(4, b, true);
    h.update(buf);
  }
  return h.digest('hex');
}

try {
  const r = await timed(async () => {
    const d1 = digestSpins(SEED, SPINS);
    const d2 = digestSpins(SEED, SPINS);
    if (d1 !== d2) throw new Error(`digest mismatch: ${d1} vs ${d2}`);
    return { digest: d1, spins: SPINS, seed: SEED };
  });
  emit('smoke-rng-determinism', true, {
    durationMs: Date.now() - t0,
    message: 'bit-identical replay',
    extra: r.value,
  });
} catch (e) {
  emit('smoke-rng-determinism', false, {
    durationMs: Date.now() - t0,
    message: e instanceof Error ? e.message : String(e),
  });
}
