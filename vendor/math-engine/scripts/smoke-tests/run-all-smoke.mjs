#!/usr/bin/env node
/**
 * W210 Faza 600.0 — Smoke orchestrator.
 *
 * Runs every smoke-*.mjs in parallel, aggregates the single-line JSON
 * result envelopes each one emits, prints a summary, and writes
 * `reports/smoke/summary.json`. Exits non-zero if any smoke failed.
 *
 * Budget: 5 minutes total (`MAX_TOTAL_MS`).
 *
 * Args forwarded to each smoke: --synthetic, --target, --tenant.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { parseArgs, REPO_ROOT } from './_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_TOTAL_MS = 5 * 60 * 1000;

const args = parseArgs(process.argv);
const passthrough = [];
if (args.synthetic) passthrough.push('--synthetic');
if (args.target) passthrough.push(`--target=${args.target}`);
if (args.tenant) passthrough.push(`--tenant=${args.tenant}`);

const ONLY = args.only ? String(args.only).split(',') : null;

const scripts = readdirSync(HERE)
  .filter((f) => f.startsWith('smoke-') && f.endsWith('.mjs'))
  .filter((f) => (ONLY ? ONLY.includes(f.replace(/^smoke-|\.mjs$/g, '')) : true))
  .sort();

function runOne(file) {
  return new Promise((res) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [resolve(HERE, file), ...passthrough], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b.toString('utf8')));
    child.stderr.on('data', (b) => (err += b.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, MAX_TOTAL_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      // last non-empty line should be the JSON envelope
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      let env = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          env = JSON.parse(lines[i]);
          break;
        } catch {
          // not JSON — keep walking
        }
      }
      res({
        file,
        exitCode: code,
        durationMs: Date.now() - t0,
        envelope:
          env ?? { name: file, ok: code === 0, message: err || 'no envelope' },
      });
    });
  });
}

const startedAt = Date.now();
const results = await Promise.all(scripts.map(runOne));
const totalMs = Date.now() - startedAt;
const okCount = results.filter((r) => r.envelope.ok).length;
const failCount = results.length - okCount;

// Persist summary
const dir = resolve(REPO_ROOT, 'reports', 'smoke');
mkdirSync(dir, { recursive: true });
const summary = {
  startedAt: new Date(startedAt).toISOString(),
  totalMs,
  totalScripts: results.length,
  okCount,
  failCount,
  results: results.map((r) => ({
    name: r.envelope.name ?? r.file,
    ok: !!r.envelope.ok,
    durationMs: r.durationMs,
    message: r.envelope.message,
  })),
};
writeFileSync(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2));

// eslint-disable-next-line no-console
console.log(
  `smoke: ${okCount}/${results.length} ok, ${failCount} failed, ${totalMs}ms`
);
for (const r of results) {
  // eslint-disable-next-line no-console
  console.log(
    `  ${r.envelope.ok ? 'OK' : 'FAIL'}  ${r.envelope.name ?? r.file} (${r.durationMs}ms)`
  );
}

process.exit(failCount > 0 || totalMs > MAX_TOTAL_MS ? 1 : 0);
