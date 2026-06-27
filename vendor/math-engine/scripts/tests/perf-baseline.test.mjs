/**
 * W212 Faza 600.1 — Perf regression baseline tests (Agent C).
 */
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import {
  METRICS,
  PROBES,
  REGRESSION_THRESHOLD,
  parseArgs,
  measure,
  compareMetric,
  runCheck,
  runUpdate,
  loadBaselines,
  saveBaselines,
  renderCheckMd,
} from '../perf/baseline-tracker.mjs';

describe('perf baseline — registry', () => {
  it('declares all seven contractual metrics', () => {
    const ids = METRICS.map((m) => m.id).sort();
    expect(ids).toEqual([
      'cache_hit_rate',
      'cert_dossier_build_s',
      'marketplace_endpoint_p99_ms',
      'pilot_suite_s',
      'rust_1m_mc_ms',
      'single_spin_latency_p99_ms',
      'smoke_suite_s',
    ]);
  });

  it('every metric has a matching synthetic probe', () => {
    for (const m of METRICS) {
      expect(typeof PROBES[m.id]).toBe('function');
    }
  });

  it('cache_hit_rate is the only higher-is-better metric', () => {
    const higher = METRICS.filter((m) => m.direction === 'higher');
    expect(higher.length).toBe(1);
    expect(higher[0].id).toBe('cache_hit_rate');
  });
});

describe('perf baseline — measure()', () => {
  it('returns a value/capturedAtUtc/source tuple', () => {
    const m = measure('single_spin_latency_p99_ms');
    expect(typeof m.value).toBe('number');
    expect(m.metricId).toBe('single_spin_latency_p99_ms');
    expect(typeof m.capturedAtUtc).toBe('string');
    expect(m.source).toBe('synthetic');
  });

  it('throws on unknown metric', () => {
    expect(() => measure('not_a_metric')).toThrow(/unknown metric/);
  });
});

describe('perf baseline — compareMetric()', () => {
  const lowerMetric = { id: 'foo', direction: 'lower', target: 100 };
  const higherMetric = { id: 'bar', direction: 'higher', target: 0.9 };

  it('flags regression when lower-is-better and current > threshold × baseline', () => {
    const current = { value: 130 };
    const baseline = { value: 100 };
    const r = compareMetric(lowerMetric, current, baseline);
    expect(r.regression).toBe(true);
    expect(r.deltaPct).toBe(30);
  });

  it('passes when lower-is-better and current is within threshold', () => {
    const current = { value: 105 };
    const baseline = { value: 100 };
    const r = compareMetric(lowerMetric, current, baseline);
    expect(r.regression).toBe(false);
  });

  it('flags regression when higher-is-better and current < baseline/threshold', () => {
    const current = { value: 0.5 };
    const baseline = { value: 0.9 };
    const r = compareMetric(higherMetric, current, baseline);
    expect(r.regression).toBe(true);
  });

  it('reports no_baseline when stored baseline is missing', () => {
    const r = compareMetric(lowerMetric, { value: 5 }, null);
    expect(r.regression).toBe(false);
    expect(r.reason).toBe('no_baseline');
  });

  it('tracks target met / not met independently from regression', () => {
    const r = compareMetric(lowerMetric, { value: 150 }, { value: 100 });
    expect(r.regression).toBe(true);
    expect(r.targetMet).toBe(false);
  });
});

describe('perf baseline — parseArgs', () => {
  it('defaults to mode=check, metric=all', () => {
    const a = parseArgs(['node', 'x']);
    expect(a.mode).toBe('check');
    expect(a.metric).toBe('all');
  });

  it('parses --mode= and --metric=', () => {
    const a = parseArgs(['node', 'x', '--mode=update', '--metric=cache_hit_rate']);
    expect(a.mode).toBe('update');
    expect(a.metric).toBe('cache_hit_rate');
  });
});

describe('perf baseline — runCheck / runUpdate', () => {
  it('runCheck against repo-committed baselines.json returns a structured report', () => {
    const r = runCheck();
    expect(r.results.length).toBe(METRICS.length);
    expect(typeof r.regressionCount).toBe('number');
    expect(typeof r.overallOk).toBe('boolean');
  });

  it('runUpdate writes a new baseline file with all metrics', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'perf-baseline-'));
    const path = resolve(dir, 'baselines.json');
    runUpdate({ path });
    expect(existsSync(path)).toBe(true);
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored.schema).toBe('perf-baseline/v1');
    for (const m of METRICS) {
      expect(stored.metrics[m.id]).toBeDefined();
      expect(typeof stored.metrics[m.id].value).toBe('number');
    }
  });

  it('runCheck honours an injected baselines object', () => {
    const baselines = {
      schema: 'perf-baseline/v1',
      metrics: Object.fromEntries(METRICS.map((m) => [m.id, { metricId: m.id, value: m.direction === 'higher' ? 0.95 : 1, capturedAtUtc: '2026-01-01', source: 't' }])),
    };
    const r = runCheck({ baselines, threshold: 1.5 });
    expect(r.results.length).toBe(METRICS.length);
  });

  it('REGRESSION_THRESHOLD default is 1.10 (10% above baseline)', () => {
    expect(REGRESSION_THRESHOLD).toBe(1.10);
  });

  it('renderCheckMd returns a markdown table', () => {
    const r = runCheck();
    const md = renderCheckMd(r);
    expect(md).toContain('| Metric |');
    expect(md).toContain('Perf Regression Check');
  });

  it('saveBaselines + loadBaselines round-trip preserves metrics', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'perf-baseline-rt-'));
    const path = resolve(dir, 'b.json');
    const obj = {
      schema: 'perf-baseline/v1',
      metrics: { foo: { metricId: 'foo', value: 1, capturedAtUtc: 't', source: 's' } },
    };
    saveBaselines(obj, path);
    const loaded = loadBaselines(path);
    expect(loaded.metrics.foo.value).toBe(1);
  });
});
