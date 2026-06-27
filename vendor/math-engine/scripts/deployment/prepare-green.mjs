#!/usr/bin/env node
/**
 * W210 Faza 600.0 — Provision green environment.
 *
 * Stages a new version onto the inactive ("green") side without
 * shifting traffic. Idempotent: re-running with the same `--version`
 * is a no-op.
 *
 * Flags:
 *   --version=2.0.0   target version to stage
 *   --dry-run         print the plan but do not write state
 */
import { parseArgs, loadState, saveState, log } from './_lib.mjs';

const args = parseArgs(process.argv);
const version = args.version ?? '2.0.0';
const dry = !!args['dry-run'];

const state = loadState();
if (state.green.version === version && state.green.healthy) {
  log(`green already prepared @ ${version} (no-op)`);
  process.exit(0);
}

const next = {
  ...state,
  green: { version, healthy: true, trafficPercent: 0 },
};

log(`prepare green ${state.green.version ?? 'unset'} → ${version}`);
if (dry) {
  log('dry-run — state not written');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(next, null, 2));
  process.exit(0);
}
saveState(next);
log('green prepared');
