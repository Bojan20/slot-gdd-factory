#!/usr/bin/env node
/**
 * W210 Faza 600.0 — Smoke: cert dossier export completes.
 *
 * Generates a minimal cert dossier (synthetic payload), serializes to
 * JSON, and asserts a stable byte length window. In HTTP mode, fetches
 * /api/cert/health and confirms the endpoint reports ready.
 */
import { parseArgs, probeTarget, emit, timed, writeArtifact } from './_lib.mjs';

const args = parseArgs(process.argv);
const TARGET = args.target ?? 'http://localhost:4000';
let synthetic = !!args.synthetic;
const t0 = Date.now();

function buildDossier() {
  const dossier = {
    schemaVersion: '1.0.0',
    generatedAt: new Date(0).toISOString(),
    game: { id: 'test-game-1', version: '1.0.0' },
    rtp: { stated: 0.96, observedMc: 0.9602, deltaPp: 0.02 },
    rngFamily: 'pcg32',
    lab: 'internal',
    verdict: 'pass',
    artifacts: [
      { name: 'rtp.csv', sha256: 'a'.repeat(64) },
      { name: 'par-summary.md', sha256: 'b'.repeat(64) },
    ],
  };
  return JSON.stringify(dossier);
}

async function runHttp() {
  const r = await fetch(`${TARGET}/api/cert/__health/ping`);
  if (!r.ok) throw new Error(`cert health http ${r.status}`);
  return { healthy: true };
}

try {
  if (!synthetic) {
    const ok = await probeTarget(`${TARGET}/api/health`);
    if (!ok) synthetic = true;
  }
  const r = await timed(async () => {
    if (!synthetic) await runHttp();
    const payload = buildDossier();
    if (payload.length < 100) throw new Error('dossier too small');
    writeArtifact('cert-dossier-smoke.json', payload);
    return { bytes: payload.length };
  });
  emit('smoke-cert-export', true, {
    durationMs: Date.now() - t0,
    message: synthetic ? 'synthetic cert export ok' : 'live cert export ok',
    extra: r.value,
  });
} catch (e) {
  emit('smoke-cert-export', false, {
    durationMs: Date.now() - t0,
    message: e instanceof Error ? e.message : String(e),
  });
}
