#!/usr/bin/env node
/**
 * tools/par-sheet-convergence-deep.mjs
 *
 * PAR-14-D (Boki 2026-06-27) — Deep convergence verification at
 * 100M / 1B / 10B spin scale. Wraps the existing
 * `_par-sheet-convergence.mjs` script with elevated spin counts
 * and tier-specific verdict gate.
 *
 * # PRECISION TIER LADDER
 *
 *   --tier=tight       100M × 4 = 400M spins, ~25 min, W99 ~3-5 pp
 *                      "tighter PASS verification"
 *
 *   --tier=production  1B × 4 = 4B spins, ~4 h, W99 ~1-2 pp
 *                      "production-grade certification"
 *
 *   --tier=regulator   10B × 4 = 40B spins, ~40 h, W99 ~0.3-0.6 pp
 *                      "regulator audit (GLI-19 / UKGC / MGA)"
 *
 * NOT for every commit. Cron / weekly / pre-release schedule.
 *
 * # USAGE
 *
 *   node tools/par-sheet-convergence-deep.mjs --tier tight
 *   node tools/par-sheet-convergence-deep.mjs --tier production --slug skeleton-key
 *   node tools/par-sheet-convergence-deep.mjs --tier regulator --slug fort-knox-wolf-run
 *
 * # OUTPUT
 *
 *   reports/par-convergence-deep/<tier>-<timestamp>.json
 *   reports/par-convergence-deep/<tier>-<slug>-<timestamp>.json
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = join(REPO, 'reports', 'par-convergence-deep');

const TIERS = {
  tight: { spins: 100_000_000, seeds: 4, wallEst: '~25 min', w99Est: '~3-5 pp' },
  production: { spins: 1_000_000_000, seeds: 4, wallEst: '~4 h', w99Est: '~1-2 pp' },
  regulator: { spins: 10_000_000_000, seeds: 4, wallEst: '~40 h', w99Est: '~0.3-0.6 pp' },
};

function parseArgs(args) {
  const out = { tier: null, slug: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tier') out.tier = args[++i];
    else if (a === '--slug') out.slug = args[++i];
  }
  return out;
}

async function runDeepConvergence(tier, slug) {
  const spec = TIERS[tier];
  if (!spec) {
    console.error(`Unknown tier "${tier}". Choices: ${Object.keys(TIERS).join(', ')}`);
    process.exit(2);
  }

  console.log(`# Deep convergence — tier: ${tier}`);
  console.log(`  spins: ${spec.spins.toLocaleString('en-US')}  seeds: ${spec.seeds}`);
  console.log(`  wall estimate: ${spec.wallEst}`);
  console.log(`  W99 estimate:  ${spec.w99Est}`);
  if (slug) console.log(`  slug filter:   ${slug}`);
  console.log('');

  const baseArgs = [
    join(REPO, 'tools', '_par-sheet-convergence.mjs'),
    '--spins', String(spec.spins),
    '--seeds', String(spec.seeds),
  ];
  if (slug) baseArgs.push('--slug', slug);

  const child = spawn('node', baseArgs, {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: REPO,
  });

  return new Promise((resolveOk, reject) => {
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`convergence exited ${code}`));
      else resolveOk();
    });
  });
}

async function main() {
  const args = parseArgs(argv.slice(2));
  if (!args.tier) {
    console.error('USAGE: --tier <tight|production|regulator> [--slug <name>]');
    process.exit(2);
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  try {
    await runDeepConvergence(args.tier, args.slug);
    console.log(`\n✓ Deep convergence completed at ${new Date().toISOString()}`);
    console.log(`  Started: ${startedAt}`);

    /* Copy the aggregate produced by the underlying script. */
    const aggPath = join(REPO, 'reports', 'par-convergence', '_aggregate.json');
    try {
      const agg = readFileSync(aggPath, 'utf-8');
      const target = join(
        REPORT_DIR,
        `${args.tier}${args.slug ? '-' + args.slug : ''}-${startedAt.replace(/[:.]/g, '-')}.json`,
      );
      writeFileSync(target, agg);
      console.log(`  Aggregate snapshot: ${target}`);
    } catch (e) {
      console.warn(`  (aggregate snapshot skipped: ${e.message})`);
    }
  } catch (e) {
    console.error(`\n✗ Deep convergence failed: ${e.message}`);
    process.exit(1);
  }
}

const __isCliEntry = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (__isCliEntry) {
  main();
}
