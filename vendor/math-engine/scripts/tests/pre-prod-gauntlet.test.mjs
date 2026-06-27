/**
 * W212 Faza 600.1 — Pre-prod gauntlet tests (Agent C).
 */
import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  GATES,
  runGauntlet,
  renderMd,
} from '../perf/pre-prod-gauntlet.mjs';
import {
  detect as detectMemoryLeak,
  fitGrowth,
  snapshotMemory,
} from '../perf/memory-leak-detector.mjs';

describe('pre-prod gauntlet — parseArgs', () => {
  it('defaults to synthetic mode', () => {
    const a = parseArgs(['node', 'x']);
    expect(a.synthetic).toBe(true);
  });
  it('handles --only=', () => {
    const a = parseArgs(['node', 'x', '--only=smoke-suite,mutation-refresh']);
    expect(a.only).toEqual(['smoke-suite', 'mutation-refresh']);
  });
  it('handles --skip=', () => {
    const a = parseArgs(['node', 'x', '--skip=load-test-gaas']);
    expect(a.skip).toEqual(['load-test-gaas']);
  });
  it('switches off synthetic with --full', () => {
    const a = parseArgs(['node', 'x', '--full']);
    expect(a.synthetic).toBe(false);
  });
});

describe('pre-prod gauntlet — GATES registry', () => {
  it('declares exactly 10 gates', () => {
    expect(GATES.length).toBe(10);
  });
  it('every gate has id + label + kind', () => {
    for (const g of GATES) {
      expect(typeof g.id).toBe('string');
      expect(typeof g.label).toBe('string');
      expect(['cmd', 'inline']).toContain(g.kind);
    }
  });
  it('gate ids are unique', () => {
    const ids = GATES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pre-prod gauntlet — runGauntlet (inline gates only)', () => {
  it('runs only the requested gates via --only filter', async () => {
    const r = await runGauntlet({ only: ['perf-regression-check', 'latency-budget-snapshot'] });
    expect(r.results.length).toBe(2);
    const ids = r.results.map((x) => x.id).sort();
    expect(ids).toEqual(['latency-budget-snapshot', 'perf-regression-check']);
  }, 30_000);

  it('latency-budget-snapshot passes', async () => {
    const r = await runGauntlet({ only: ['latency-budget-snapshot'] });
    expect(r.results[0].ok).toBe(true);
  }, 15_000);

  it('mutation-refresh inline runner does not crash without baseline', async () => {
    const r = await runGauntlet({ only: ['mutation-refresh'] });
    expect(r.results.length).toBe(1);
    expect(typeof r.results[0].ok).toBe('boolean');
  }, 30_000);

  it('chaos-scenarios is skip-pass when reports/chaos missing', async () => {
    const r = await runGauntlet({ only: ['chaos-scenarios'] });
    // ok true, skipped if dir missing
    expect(r.results[0].ok).toBe(true);
  });

  it('renderMd returns markdown table with all results', async () => {
    const r = await runGauntlet({ only: ['perf-regression-check'] });
    const md = renderMd(r);
    expect(md).toContain('Pre-prod Gauntlet');
    expect(md).toContain('| Gate |');
  });
});

describe('memory leak detector — fitGrowth', () => {
  it('returns zero slope for empty input', () => {
    const f = fitGrowth([]);
    expect(f.slopeBytesPerSec).toBe(0);
  });

  it('positive slope when heap grows linearly', () => {
    const t0 = Date.now();
    const snaps = [];
    for (let i = 0; i < 5; i++) {
      snaps.push({ tMs: t0 + i * 1000, heapUsedBytes: 1_000_000 + i * 100_000 });
    }
    const f = fitGrowth(snaps);
    expect(f.slopeBytesPerSec).toBeGreaterThan(0);
  });

  it('zero slope when heap is flat', () => {
    const t0 = Date.now();
    const snaps = [];
    for (let i = 0; i < 5; i++) {
      snaps.push({ tMs: t0 + i * 1000, heapUsedBytes: 1_000_000 });
    }
    const f = fitGrowth(snaps);
    expect(Math.abs(f.slopeBytesPerSec)).toBeLessThan(1);
  });
});

describe('memory leak detector — snapshotMemory + detect', () => {
  it('snapshotMemory returns RSS + heap fields', () => {
    const s = snapshotMemory('test');
    expect(s.label).toBe('test');
    expect(typeof s.rssBytes).toBe('number');
    expect(typeof s.heapUsedBytes).toBe('number');
    expect(s.tMs).toBeGreaterThan(0);
  });

  it('detect returns a structured verdict in synthetic mode', async () => {
    const r = await detectMemoryLeak({ synthetic: true, samplePeriodMs: 20, samples: 3 });
    expect(r.snapshots.length).toBe(4); // start + 3 samples
    expect(typeof r.leakSuspected).toBe('boolean');
    expect(typeof r.slopeBytesPerSec).toBe('number');
  }, 5_000);
});
