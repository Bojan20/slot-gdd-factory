#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Discovery Run orchestrator.
 *
 * Drives every fuzz harness (W212 4 targets + W215 3 targets = 7) and
 * produces a timestamped discovery report under
 *
 *   reports/fuzz/discovery/<ISO_TIMESTAMP>/
 *     ├── summary.json            top-level stats
 *     ├── summary.md              human-readable
 *     ├── crashes/<harness>.json  unique crashes per harness
 *     ├── coverage/<harness>.json branch hit counts per harness
 *     └── interesting-inputs/     seed corpus diff
 *
 * Modes:
 *   --synthetic   50K iter / target  (default, completes <2 min)
 *   --discovery   1M iter / target   (~30 min budget)
 *   --exhaustive  100M iter / target (CI-only, hours)
 *
 * Targets run sequentially in-process (Node) — the runner is engineered
 * to finish synthetic in under 2 minutes on commodity hardware. For
 * the longer modes the per-target wall-clock cap (default 4 min) keeps
 * any single target from monopolising the budget.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as irMod from './fuzz-ir-evaluator.mjs';
import * as mpMod from './fuzz-marketplace-api.mjs';
import * as wpMod from './fuzz-wallet-providers.mjs';
import * as cbMod from './fuzz-cert-bundle.mjs';
import * as seMod from './fuzz-spin-engine.mjs';
import * as ccMod from './fuzz-canary-controller.mjs';
import * as ljMod from './fuzz-license-jwt.mjs';
import { runFuzzV2, resolveBudget } from './_lib-v2.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const DISCOVERY_DIR = join(ROOT, 'reports', 'fuzz', 'discovery');

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

function parseMode(argv) {
  if (argv.includes('--exhaustive')) return { mode: 'exhaustive', perTarget: resolveBudget('exhaustive') };
  if (argv.includes('--discovery')) return { mode: 'discovery', perTarget: resolveBudget('discovery') };
  // synthetic is the default — small enough for CI.
  return { mode: 'synthetic', perTarget: 50_000 };
}

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

/**
 * Per-target wall budget (ms). Default 4 min protects single targets from
 * blowing the global budget. Synthetic mode shrinks it to 12s/target so
 * the total stays well under 2 minutes.
 */
function perTargetWallMs(mode) {
  if (mode === 'synthetic') return 12_000;
  if (mode === 'discovery') return 4 * 60_000;
  return 30 * 60_000;
}

const HARNESSES = [
  // Existing W212 targets — promoted to V2 via a thin wrapper so the
  // discovery runner gets dedup + coverage stats from every harness.
  {
    id: 'ir-evaluator',
    run: ({ budget, maxWallMs }) => runFuzzV2({
      name: 'ir-evaluator',
      makeInput: (rng) => buildIrInput(rng),
      body: (input, cov) => { cov?.mark('ir'); irMod.bodyOnce(input); },
      budget,
      maxWallMs,
    }),
  },
  {
    id: 'marketplace-api',
    run: ({ budget, maxWallMs }) => runFuzzV2({
      name: 'marketplace-api',
      makeInput: (rng) => makeMarketplaceInput(rng),
      body: (input, cov) => { cov?.mark(`mp:${input.__kind}`); mpMod.body(input); },
      budget,
      maxWallMs,
    }),
  },
  {
    id: 'wallet-providers',
    run: ({ budget, maxWallMs }) => runFuzzV2({
      name: 'wallet-providers',
      makeInput: (rng) => makeWalletInput(rng),
      body: (input, cov) => { cov?.mark(`wp:${input.kind}`); wpMod.body(input); },
      budget,
      maxWallMs,
    }),
  },
  {
    id: 'cert-bundle',
    run: ({ budget, maxWallMs }) => runFuzzV2({
      name: 'cert-bundle',
      makeInput: (rng) => makeCertInput(rng),
      body: (input, cov) => { cov?.mark('cb'); cbMod.body(input); },
      budget,
      maxWallMs,
    }),
  },
  // W215 new targets — already V2-native.
  { id: 'spin-engine', run: (o) => seMod.main(o) },
  { id: 'canary-controller', run: (o) => ccMod.main(o) },
  { id: 'license-jwt', run: (o) => ljMod.main(o) },
];

// Tiny per-target input builders — copied from the original harnesses
// because their `makeInput` is closed-over the module-private state.
function buildIrInput(rng) {
  const SYMBOLS = ['WILD', 'SCATTER', 'A', 'K', 'Q', 'J', '10', '9', 'BONUS', 'MULT'];
  return {
    version: rng.intRange(-1, 5),
    reels: Array.from({ length: rng.intRange(0, 6) }, () =>
      Array.from({ length: rng.intRange(0, 64) }, () => SYMBOLS[rng.next() % SYMBOLS.length])),
    paytable: Array.from({ length: rng.intRange(0, 32) }, () => ({
      symbol: SYMBOLS[rng.next() % SYMBOLS.length],
      count: rng.intRange(-5, 5),
      payout: rng.unit() < 0.15 ? NaN : rng.intRange(-100, 1000),
    })),
    rtpTarget: rng.unit() < 0.85 ? rng.unit() : (rng.unit() < 0.5 ? NaN : -1),
    name: 'fuzz',
    features: {},
  };
}

function makeMarketplaceInput(rng) {
  const which = rng.next() % 3;
  if (which === 0) return { __kind: 'listing', payload: { title: 't', priceCents: rng.intRange(-10, 1e10), tags: undefined } };
  if (which === 1) return { __kind: 'search', payload: { q: 'x', limit: rng.intRange(-1, 200), offset: rng.intRange(-1, 2e6) } };
  return { __kind: 'purchase', payload: { listingId: 'lid', tenantId: 't', note: undefined } };
}

function makeWalletInput(rng) {
  const kind = ['microgaming', 'netent', 'playtech', 'pam'][rng.next() % 4];
  return { kind, raw: { balance: rng.intRange(0, 1e6), txId: 'tx-1', currency: 'EUR' } };
}

function makeCertInput(rng) {
  return {
    version: rng.unit() < 0.5 ? '1.2.3' : 'bad',
    gameId: 'lw-test',
    rtp: rng.unit() < 0.85 ? 0.5 + rng.unit() * 0.5 : NaN,
    paytables: ['pt-1.json'],
    acceptance: ['a-1.json'],
    signatures: [{ algorithm: 'ecdsa', value: 'x'.repeat(128) }],
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function discoveryRun(opts = {}) {
  const { mode, perTarget } = opts.mode
    ? { mode: opts.mode, perTarget: resolveBudget(opts.mode) }
    : parseMode(process.argv);
  const wallCap = opts.maxWallMs ?? perTargetWallMs(mode);
  const runDir = join(DISCOVERY_DIR, opts.timestamp ?? timestamp());
  mkdirSync(join(runDir, 'crashes'), { recursive: true });
  mkdirSync(join(runDir, 'coverage'), { recursive: true });
  mkdirSync(join(runDir, 'interesting-inputs'), { recursive: true });

  const start = Date.now();
  const reports = [];
  for (const h of HARNESSES) {
    const t0 = Date.now();
    const r = h.run({ budget: perTarget, maxWallMs: wallCap });
    const wallMs = Date.now() - t0;
    reports.push({ id: h.id, ...r, wallMs });
    if (r.crashes && r.crashes.length > 0) {
      writeFileSync(join(runDir, 'crashes', `${h.id}.json`), JSON.stringify(r.crashes, null, 2));
    }
    writeFileSync(join(runDir, 'coverage', `${h.id}.json`), JSON.stringify({
      branches: r.branches,
      coverage: r.coverage,
    }, null, 2));
    if (opts.quiet !== true) {
      console.log(`[discovery] ${h.id} · ${r.iterations} iters in ${wallMs}ms (${r.iterPerSec}/s) · ${r.uniqueCrashes} unique crashes · ${r.branches} branches`);
    }
  }
  const totalMs = Date.now() - start;
  const summary = {
    at: new Date().toISOString(),
    mode,
    perTargetBudget: perTarget,
    perTargetWallMsCap: wallCap,
    totalWallMs: totalMs,
    harnesses: reports.map((r) => ({
      id: r.id,
      iterations: r.iterations,
      iterPerSec: r.iterPerSec,
      uniqueCrashes: r.uniqueCrashes,
      totalCrashes: r.crashes.length,
      branches: r.branches,
      wallMs: r.wallMs,
    })),
    totalUniqueCrashes: reports.reduce((a, r) => a + r.uniqueCrashes, 0),
    totalBranches: reports.reduce((a, r) => a + r.branches, 0),
  };
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(runDir, 'summary.md'), renderSummary(summary));
  // Pin a "latest" symlink-style file so ingest can find the most recent run.
  writeFileSync(join(DISCOVERY_DIR, 'LATEST.txt'), runDir);
  return { summary, runDir };
}

function renderSummary(s) {
  const lines = [];
  lines.push(`# Fuzz Discovery Run — ${s.at}`);
  lines.push('');
  lines.push(`**Mode**: ${s.mode}  **Per-target budget**: ${s.perTargetBudget.toLocaleString()} iter  **Wall cap**: ${s.perTargetWallMsCap}ms`);
  lines.push(`**Total wall**: ${s.totalWallMs}ms · **Unique crashes**: ${s.totalUniqueCrashes} · **Branches**: ${s.totalBranches}`);
  lines.push('');
  lines.push('| Harness | Iter | Iter/s | Unique crashes | Total crashes | Branches | Wall ms |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const h of s.harnesses) {
    lines.push(`| ${h.id} | ${h.iterations} | ${h.iterPerSec} | ${h.uniqueCrashes} | ${h.totalCrashes} | ${h.branches} | ${h.wallMs} |`);
  }
  lines.push('');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  discoveryRun().then(({ summary, runDir }) => {
    console.log(`\nDiscovery report written to ${runDir}`);
    if (summary.totalUniqueCrashes > 0) {
      console.error(`Discovery found ${summary.totalUniqueCrashes} unique crash(es) — see ${runDir}/crashes/`);
      process.exit(1);
    }
  });
}
