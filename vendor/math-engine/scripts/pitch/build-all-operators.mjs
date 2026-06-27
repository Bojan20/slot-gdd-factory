#!/usr/bin/env node
/**
 * W213 Faza 700.1 — Multi-operator batch build.
 *
 * Runs `buildPitchTarball({ operatorId })` for every operator manifest under
 * `scripts/pitch/operators/*.json` in parallel. Prints a summary table.
 *
 * Target: 7 operators in <2 min on a typical dev laptop.
 *
 * Exports:
 *   - buildAllOperators({ output, format, bundleVersion, ... })
 *   - formatSummaryTable(results)
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPitchTarball } from './build-pitch-tarball.mjs';
import { listAvailableOperators, loadOperatorManifest } from './operator-branding.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export async function buildAllOperators(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const ids = opts.operatorIds ?? (await listAvailableOperators());
  const concurrency = opts.concurrency ?? Math.min(4, ids.length);
  const bundleVersion = opts.bundleVersion;
  const format = opts.format ?? 'tar.gz';
  const dryRun = opts.dryRun ?? false;
  const output = opts.output ?? 'dist/pitch';
  const generatedAt = opts.generatedAt; // optional, lets caller pin determinism

  const results = [];
  // simple worker pool
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const i = idx++;
      const id = ids[i];
      const t0 = Date.now();
      try {
        const manifest = await loadOperatorManifest(id);
        const r = await buildPitchTarball({
          root,
          output,
          format,
          operatorId: id,
          operatorManifest: manifest,
          bundleVersion,
          dryRun,
          generatedAt,
        });
        results[i] = {
          ok: true,
          operatorId: id,
          displayName: manifest.displayName,
          tier: manifest.tier,
          filename: r.filename,
          fileCount: r.fileCount,
          archiveSize: r.archiveSize,
          sha256Prefix: r.manifest?.signature?.signature?.slice(0, 12) ?? null,
          elapsedMs: Date.now() - t0,
        };
      } catch (err) {
        results[i] = {
          ok: false,
          operatorId: id,
          error: err.message,
          elapsedMs: Date.now() - t0,
        };
      }
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const okCount = results.filter((r) => r?.ok).length;
  return {
    ok: okCount === results.length,
    okCount,
    total: results.length,
    results,
  };
}

export function formatSummaryTable(results) {
  const rows = results.map((r) => {
    if (!r.ok) {
      return [r.operatorId, '-', 'FAIL', '-', '-', `${r.elapsedMs}ms`, r.error.slice(0, 24)];
    }
    return [
      r.operatorId,
      r.displayName,
      r.tier,
      String(r.fileCount),
      `${(r.archiveSize / 1024).toFixed(1)}KB`,
      `${r.elapsedMs}ms`,
      r.filename,
    ];
  });
  const header = ['operatorId', 'displayName', 'tier', 'files', 'size', 'elapsed', 'filename/err'];
  const all = [header, ...rows];
  const widths = header.map((_, c) =>
    Math.max(...all.map((row) => String(row[c] ?? '').length))
  );
  const fmt = (row) =>
    row.map((cell, c) => String(cell ?? '').padEnd(widths[c], ' ')).join('  ');
  return [
    fmt(header),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(fmt),
  ].join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bvArg = args.find((a) => a.startsWith('--bundle-version='));
  const outArg = args.find((a) => a.startsWith('--output='));
  const t0 = Date.now();
  buildAllOperators({
    bundleVersion: bvArg ? bvArg.slice(17) : undefined,
    output: outArg ? outArg.slice(9) : 'dist/pitch',
    dryRun,
  })
    .then((r) => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.log(formatSummaryTable(r.results));
      console.log('');
      console.log(`build-all-operators: ${r.okCount}/${r.total} ok in ${elapsed}s`);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('build-all-operators FAILED', err);
      process.exit(2);
    });
}
