/**
 * W210 Faza 600.0 — Shared smoke-test helpers.
 *
 * Smoke scripts must:
 *   - run standalone with no external deps beyond Node 18+,
 *   - support `--synthetic` to be runnable without a live backend (used
 *     by CI rehearsal),
 *   - emit a single-line JSON result envelope to stdout, and exit 0 on
 *     success / non-zero on failure.
 *
 * The envelope shape is:
 *
 *   { name, ok, durationMs, message?, details? }
 *
 * which the orchestrator parses to compile the aggregate report.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

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

export async function probeTarget(url, timeoutMs = 1500) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

/** Emit the result envelope and exit. */
export function emit(name, ok, details = {}) {
  const env = {
    name,
    ok,
    durationMs: details.durationMs ?? 0,
    message: details.message,
    details: details.extra,
  };
  // single-line JSON for easy parsing by orchestrator
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(env));
  process.exit(ok ? 0 : 1);
}

export function writeArtifact(rel, content) {
  const dir = resolve(REPO_ROOT, 'reports', 'smoke');
  mkdirSync(dir, { recursive: true });
  const p = resolve(dir, rel);
  writeFileSync(p, content);
  return p;
}

/** Tiny deterministic LCG for synthetic mode. */
export function makeRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Time a block and return { value, durationMs }. */
export async function timed(fn) {
  const t0 = process.hrtime.bigint();
  const value = await fn();
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return { value, durationMs };
}
