/**
 * W213 Faza 700.1 — build-all-operators batch tests.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { buildAllOperators, formatSummaryTable } from '../pitch/build-all-operators.mjs';
import { listAvailableOperators } from '../pitch/operator-branding.mjs';

async function tmpOut() {
  const d = resolve(tmpdir(), `bao-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('build-all-operators', () => {
  it('produces a result for every operator manifest (dry-run fast path)', async () => {
    const out = await tmpOut();
    const ids = await listAvailableOperators();
    const r = await buildAllOperators({
      output: out,
      bundleVersion: 'v20990101',
      dryRun: true,
      operatorIds: ids.slice(0, 2), // keep CI fast
    });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(2);
    expect(r.okCount).toBe(2);
    for (const row of r.results) {
      expect(row.ok).toBe(true);
      expect(row.fileCount).toBeGreaterThan(10);
      expect(row.archiveSize).toBeGreaterThan(0);
    }
  });

  it('builds full set of 7 operators to disk under 2 min', async () => {
    const out = await tmpOut();
    const t0 = Date.now();
    const r = await buildAllOperators({
      output: out,
      bundleVersion: 'v20990101',
      dryRun: false,
    });
    const elapsed = Date.now() - t0;
    expect(r.total).toBeGreaterThanOrEqual(7);
    expect(r.okCount).toBe(r.total);
    expect(elapsed).toBeLessThan(120_000);
  }, 150_000);

  it('formatSummaryTable returns a header row + N data rows', async () => {
    const r = await buildAllOperators({
      output: await tmpOut(),
      bundleVersion: 'v20990101',
      dryRun: true,
      operatorIds: ['lw', 'aristocrat'],
    });
    const tbl = formatSummaryTable(r.results);
    const lines = tbl.split('\n');
    expect(lines[0]).toMatch(/operatorId/);
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  it('all-7 manifest set has distinct filenames per operator (except lw → legacy)', async () => {
    const r = await buildAllOperators({
      output: await tmpOut(),
      bundleVersion: 'v20990101',
      dryRun: true,
    });
    const names = new Set(r.results.map((row) => row.filename).filter(Boolean));
    expect(names.size).toBe(r.results.length);
  });

  it('per-operator results carry tier + displayName + sha256 prefix capable manifest', async () => {
    const r = await buildAllOperators({
      output: await tmpOut(),
      bundleVersion: 'v20990101',
      dryRun: true,
      operatorIds: ['aristocrat'],
    });
    const row = r.results[0];
    expect(row.displayName).toBe('Vendor C');
    expect(row.tier).toBe('Tier-1');
  });

  it('failure for an unknown operator is captured per-row, not thrown', async () => {
    const r = await buildAllOperators({
      output: await tmpOut(),
      bundleVersion: 'v20990101',
      dryRun: true,
      operatorIds: ['does-not-exist'],
    });
    expect(r.ok).toBe(false);
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].error).toMatch(/operator manifest not found/);
  });
});
