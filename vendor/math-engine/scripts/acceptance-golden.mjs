#!/usr/bin/env node
//
// W152 Faza 10.5 — Acceptance golden snapshot generator.
//
// Runs every IR fixture in `tests/fixtures/reference/` through the
// IR-native simulator with a fixed seed and a fixed spin count, then
// commits the resulting `{rtp, hitRate, featureTriggerFreqs, maxWinX}`
// tuple to `reports/acceptance/golden.json`. The companion replay test
// re-runs the same configuration and asserts equality within tolerance.
//
// Why a separate generator (not an inline test):
//   * Spin count for stable RTP is in the 10⁴–10⁵ range. At 30+ fixtures
//     that overflows the vitest 60 s default. The generator is run when
//     fixture behaviour is intentionally changed; the test only verifies
//     no drift.
//   * The golden file is reviewable: an engineer eye-balls the JSON
//     diff and pin-points which fixture moved. With per-test RTP the
//     output is buried in CI logs.
//
// Usage:
//   npm run build && node scripts/acceptance-golden.mjs
//
// Determinism contract:
//   * Seed = 12345 across every fixture.
//   * Spins = 20_000 (CI-friendly; lab-grade 10⁹ runs live in
//     `scripts/par-distribution-stress.mjs`).
//   * `forceBuyFeature`, `forceAnte` left default-false.
//
// Output schema (golden.json):
//   {
//     "generatedAtUtc": "2026-…",
//     "engineCommit": "…",        // optional; injected via env
//     "seed": 12345,
//     "spins": 20000,
//     "fixtures": {
//       "<fixture-id>": { rtp, hitRate, maxWinX, features: { name: 1in } }
//     }
//   }

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGameIR } from '../dist/ir/index.js';
import { runIRSimulation } from '../dist/engine/irSimulator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'reference');
const OUT_PATH = join(REPO_ROOT, 'reports', 'acceptance', 'golden.json');

const SEED = 12345;
const SPINS = 20_000;

function listFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

async function runOne(file) {
  const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
  const json = JSON.parse(raw);
  const parsed = parseGameIR(json);
  if (!parsed.ok) {
    throw new Error(
      `IR parse failed: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
    );
  }
  const res = await runIRSimulation(parsed.ir, {
    spins: SPINS,
    seed: SEED,
  });
  // Normalise feature freqs: replace Infinity (never triggered) with
  // null so JSON output is parseable everywhere.
  const features = {};
  for (const [k, v] of Object.entries(res.featureTriggerFreqs)) {
    features[k] = Number.isFinite(v) ? v : null;
  }
  return {
    rtp: Number(res.rtp.toFixed(6)),
    hitRate: Number(res.hitRate.toFixed(6)),
    maxWinX: Number(res.maxWinX.toFixed(6)),
    features,
  };
}

async function main() {
  const files = listFixtures();
  console.log(`Acceptance golden: ${files.length} fixtures × ${SPINS} spins @ seed ${SEED}`);
  const fixtures = {};
  let done = 0;
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const t0 = Date.now();
    try {
      fixtures[id] = await runOne(file);
      done++;
      console.log(`  [${done}/${files.length}] ${id} → rtp=${fixtures[id].rtp.toFixed(4)} (${Date.now() - t0}ms)`);
    } catch (err) {
      console.error(`  [${done + 1}/${files.length}] ${id} → FAIL: ${err.message}`);
      // Continue so a single broken fixture doesn't poison the entire snapshot.
      fixtures[id] = { error: err.message };
    }
  }
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const out = {
    generatedAtUtc: new Date().toISOString(),
    engineCommit: process.env.GIT_COMMIT ?? null,
    seed: SEED,
    spins: SPINS,
    fixtures,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
