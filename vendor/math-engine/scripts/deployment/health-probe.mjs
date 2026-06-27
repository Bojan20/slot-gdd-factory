#!/usr/bin/env node
/**
 * W210 Faza 600.0 — Health probe (works on either blue or green).
 *
 * Returns exit code 0 when the requested environment passes its health
 * checks; non-zero otherwise. In synthetic mode the response is
 * derived from the persisted deployment state.
 *
 * Flags:
 *   --env=blue|green
 *   --target=http://host:port  (live mode)
 *   --synthetic                 (bypass HTTP)
 */
import { parseArgs, loadState, log } from './_lib.mjs';

const args = parseArgs(process.argv);
const env = args.env ?? 'blue';
const target = args.target ?? 'http://localhost:4000';
const synthetic = !!args.synthetic;

async function probe(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

const state = loadState();
let healthy = state[env]?.healthy === true;
if (!synthetic) {
  healthy = await probe(`${target}/api/health`);
}
log(`probe env=${env} healthy=${healthy}`);
process.exit(healthy ? 0 : 1);
