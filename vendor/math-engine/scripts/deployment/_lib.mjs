/**
 * W210 Faza 600.0 — Shared helpers for blue/green deployment scripts.
 *
 * State is persisted to `reports/deployment/state.json` so the scripts
 * compose: prepare-green → traffic-shift → blue-green-switch.
 *
 * Every script supports `--dry-run` and is idempotent.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

export const STATE_DIR = resolve(REPO_ROOT, 'reports', 'deployment');
export const STATE_FILE = resolve(STATE_DIR, 'state.json');

export function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = true;
  }
  return out;
}

export function loadState() {
  if (!existsSync(STATE_FILE)) {
    return {
      active: 'blue',
      blue: { version: '1.0.0', healthy: true },
      green: { version: null, healthy: false, trafficPercent: 0 },
      updatedAt: new Date(0).toISOString(),
    };
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

export function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[deploy] ${msg}`);
}
