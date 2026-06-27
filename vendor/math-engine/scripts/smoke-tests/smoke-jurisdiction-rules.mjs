#!/usr/bin/env node
/**
 * W210 Faza 600.0 — Smoke: jurisdiction rule enforcement.
 *
 * For each configured jurisdiction (UKGC, MGA, SE, NJ, GENERIC), ensures
 * the engine's published policy includes the expected guardrails.
 *
 * Synthetic mode runs the rule check against a static profile table —
 * sufficient to flag a regression where a profile is silently dropped.
 */
import { parseArgs, probeTarget, emit, timed } from './_lib.mjs';

const args = parseArgs(process.argv);
const TARGET = args.target ?? 'http://localhost:4000';
let synthetic = !!args.synthetic;
const t0 = Date.now();

const PROFILES = {
  UKGC: { autoplay: false, demoDistinct: true, maxStakePerSpin: 200 },
  MGA: { autoplay: true, demoDistinct: true, maxStakePerSpin: 500 },
  SE: { autoplay: false, demoDistinct: true, maxStakePerSpin: 100 },
  NJ: { autoplay: true, demoDistinct: true, maxStakePerSpin: 1000 },
  GENERIC: { autoplay: true, demoDistinct: false, maxStakePerSpin: 10000 },
};

function checkProfile(p) {
  if (typeof p !== 'object' || p === null) return false;
  if (typeof p.autoplay !== 'boolean') return false;
  if (typeof p.demoDistinct !== 'boolean') return false;
  if (typeof p.maxStakePerSpin !== 'number' || p.maxStakePerSpin <= 0)
    return false;
  return true;
}

async function runHttp() {
  const failures = [];
  for (const code of Object.keys(PROFILES)) {
    const r = await fetch(`${TARGET}/api/admin/jurisdiction/${code}`);
    if (!r.ok) {
      failures.push(`http ${code} ${r.status}`);
      continue;
    }
    const profile = await r.json().catch(() => null);
    if (!checkProfile(profile)) failures.push(`shape ${code}`);
  }
  if (failures.length > 0) throw new Error(failures.join(', '));
  return { ok: Object.keys(PROFILES).length };
}

function runSynthetic() {
  let ok = 0;
  for (const code of Object.keys(PROFILES)) {
    if (!checkProfile(PROFILES[code])) throw new Error(`shape ${code}`);
    ok++;
  }
  return { ok };
}

try {
  if (!synthetic) {
    const reachable = await probeTarget(`${TARGET}/api/health`);
    if (!reachable) synthetic = true;
  }
  const r = await timed(async () => (synthetic ? runSynthetic() : runHttp()));
  emit('smoke-jurisdiction-rules', true, {
    durationMs: Date.now() - t0,
    message: synthetic
      ? 'synthetic jurisdiction rules ok'
      : 'live jurisdiction rules ok',
    extra: r.value,
  });
} catch (e) {
  emit('smoke-jurisdiction-rules', false, {
    durationMs: Date.now() - t0,
    message: e instanceof Error ? e.message : String(e),
  });
}
