#!/usr/bin/env node
//
// W152 Wave 15 — Faza 14.2 — Continuous Certification Daily Replay.
//
// This script is the "no-silent-drift" guardian: it re-runs every
// reference fixture against the production engine on a daily cadence
// and emits a hash-chained dossier that an auditor can replay months
// later to prove the engine still produces the same output.
//
// Output:
//   * `reports/acceptance/cert-daily/<UTC>.json` — full dossier with
//     per-fixture rtp / hitRate / maxWinX / featureTriggerFreqs at
//     seed 12345 / spins 20_000, plus a SHA-256 of the canonical
//     concatenation of every fixture row. The hash is the daily
//     "engine fingerprint" — if it changes, somebody changed math.
//   * `reports/acceptance/cert-daily/HEAD.json` — symlink-like copy
//     of today's dossier for the dashboard.
//   * `reports/acceptance/cert-daily/CHAIN.json` — appended ledger
//     `[{date, sha256, prevSha256}, ...]` so any drift is replayable.
//
// Comparison against the canonical golden snapshot
// (`reports/acceptance/golden.json`) emits a `driftDetected` boolean
// per fixture — if any flips true, the script exits 2 so CI can fail.
//
// Usage:
//   node scripts/cert-daily.mjs                    # default — 20K spins
//   node scripts/cert-daily.mjs --spins 100000     # tighter precision
//   node scripts/cert-daily.mjs --json-only        # suppress markdown
//
// Determinism contract: seed=12345 across every fixture. Spins=20000.
// If you change either, the daily fingerprint will drift on purpose;
// document it in `CHAIN.json` so the auditor can correlate.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGameIR } from '../dist/ir/index.js';
import { runIRSimulation } from '../dist/engine/irSimulator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'reference');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance', 'cert-daily');
const GOLDEN_PATH = join(REPO_ROOT, 'reports', 'acceptance', 'golden.json');
const HEAD_PATH = join(OUT_DIR, 'HEAD.json');
const CHAIN_PATH = join(OUT_DIR, 'CHAIN.json');

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const valOf = (k, dflt) => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};

const SPINS = Number(valOf('--spins', '20000'));
const SEED = Number(valOf('--seed', '12345'));
const JSON_ONLY = flag('--json-only');

// ─── Helpers ──────────────────────────────────────────────────────────────

function listFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

async function runOne(file) {
  const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
  const parsed = parseGameIR(JSON.parse(raw));
  if (!parsed.ok) {
    throw new Error(`IR parse failed: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  }
  const res = await runIRSimulation(parsed.ir, { spins: SPINS, seed: SEED });
  const features = {};
  for (const [k, v] of Object.entries(res.featureTriggerFreqs)) {
    features[k] = Number.isFinite(v) ? v : null;
  }
  return {
    rtp: Number(res.rtp.toFixed(8)),
    hitRate: Number(res.hitRate.toFixed(8)),
    maxWinX: Number(res.maxWinX.toFixed(8)),
    features,
  };
}

/** Canonical per-fixture row used for hashing. Key order is fixed
 *  alphabetic so re-serialisation across Node versions stays stable. */
function canonicalRow(id, row) {
  const featuresOrdered = Object.fromEntries(
    Object.keys(row.features).sort().map((k) => [k, row.features[k]]),
  );
  return JSON.stringify({
    id,
    rtp: row.rtp,
    hitRate: row.hitRate,
    maxWinX: row.maxWinX,
    features: featuresOrdered,
  });
}

function loadGolden() {
  if (!existsSync(GOLDEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function compareToGolden(today, golden) {
  if (!golden || !golden.fixtures) return {};
  if (golden.seed !== SEED || golden.spins !== SPINS) {
    // Different sample params → drift comparison meaningless.
    return {};
  }
  const out = {};
  for (const [id, row] of Object.entries(today)) {
    const ref = golden.fixtures[id];
    if (!ref || ref.error) {
      out[id] = { driftDetected: null, reason: 'no-baseline' };
      continue;
    }
    // Exact-match expected because seed + spins are pinned.
    const rtpDrift = Math.abs(row.rtp - ref.rtp);
    const hrDrift = Math.abs(row.hitRate - ref.hitRate);
    const maxWinDrift = Math.abs(row.maxWinX - ref.maxWinX);
    const driftDetected = rtpDrift > 1e-6 || hrDrift > 1e-6 || maxWinDrift > 1e-6;
    out[id] = {
      driftDetected,
      rtpDrift,
      hitRateDrift: hrDrift,
      maxWinXDrift: maxWinDrift,
    };
  }
  return out;
}

function loadChain() {
  if (!existsSync(CHAIN_PATH)) return [];
  try {
    return JSON.parse(readFileSync(CHAIN_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const files = listFixtures();
  if (!JSON_ONLY) {
    console.log(
      `cert-daily: ${files.length} fixtures × ${SPINS} spins @ seed ${SEED}`,
    );
  }
  const fixtures = {};
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    try {
      fixtures[id] = await runOne(file);
      if (!JSON_ONLY) {
        console.log(`  ✓ ${id} → rtp=${fixtures[id].rtp.toFixed(6)}`);
      }
    } catch (err) {
      fixtures[id] = { error: err.message };
      if (!JSON_ONLY) console.error(`  ✗ ${id} → ${err.message}`);
    }
  }

  // Build canonical hash chain across all fixture rows.
  const ids = Object.keys(fixtures).sort();
  const hashInput = ids.map((id) => canonicalRow(id, fixtures[id])).join('\n');
  const sha256 = createHash('sha256').update(hashInput).digest('hex');

  // Compare against the canonical golden snapshot.
  const golden = loadGolden();
  const drift = compareToGolden(fixtures, golden);
  const driftDetected = Object.values(drift).some((d) => d.driftDetected === true);

  // Compose dossier.
  const dateUtc = new Date().toISOString();
  const dossier = {
    schemaVersion: '1.0.0',
    generatedAtUtc: dateUtc,
    engineCommit: process.env.GIT_COMMIT ?? null,
    seed: SEED,
    spins: SPINS,
    sha256,
    fixtures,
    drift,
    driftDetected,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const fname = `${dateUtc.replace(/:/g, '-')}.json`;
  writeFileSync(join(OUT_DIR, fname), JSON.stringify(dossier, null, 2) + '\n');
  writeFileSync(HEAD_PATH, JSON.stringify(dossier, null, 2) + '\n');

  // Update chain.
  const chain = loadChain();
  const prevSha = chain.length > 0 ? chain[chain.length - 1].sha256 : null;
  chain.push({ date: dateUtc, sha256, prevSha256: prevSha, driftDetected });
  writeFileSync(CHAIN_PATH, JSON.stringify(chain, null, 2) + '\n');

  if (!JSON_ONLY) {
    console.log(`Daily SHA-256: ${sha256}`);
    if (driftDetected) {
      console.error('DRIFT DETECTED — fixture-level deltas:');
      for (const [id, d] of Object.entries(drift)) {
        if (d.driftDetected) console.error(`  ${id} → ${JSON.stringify(d)}`);
      }
    } else {
      console.log('No drift vs golden snapshot.');
    }
    console.log(`Dossier: ${join(OUT_DIR, fname)}`);
  }

  if (driftDetected) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
