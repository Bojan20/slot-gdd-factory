/**
 * CORTI W204-AUDIT — tests for scripts/performance-audit.mjs
 */

import { describe, it, expect } from 'vitest';
import {
  APPS,
  TARGETS,
  fileSize,
  gzipApprox,
  countDomNodes,
  countRenderBlocking,
  isModuleBundle,
  computeStaticMetrics,
  computeStudioActionMetrics,
  computeLighthouseScore,
  auditApp,
  renderMarkdown,
} from '../performance-audit.mjs';

describe('performance-audit · static helpers', () => {
  it('gzipApprox returns ~30% of input size', () => {
    expect(gzipApprox(1000)).toBe(300);
    expect(gzipApprox(0)).toBe(0);
  });

  it('countDomNodes counts opening tags', () => {
    const html = '<html><body><div><p>hi</p></div></body></html>';
    // <html><body><div><p></p></div></body></html> → 4 opens (closing tags don't match >).
    // Regex `<[a-zA-Z][^>]*>` matches both <html> and </html>? No — </html> starts with /,
    // not a letter. So only opening tags.
    expect(countDomNodes(html)).toBe(4);
  });

  it('countRenderBlocking finds stylesheet links + sync scripts', () => {
    const html = '<link rel="stylesheet" href="a.css"><script src="b.js"></script><script async src="c.js"></script>';
    expect(countRenderBlocking(html)).toBe(2);
  });

  it('countRenderBlocking treats async/defer/module as non-blocking', () => {
    const html = '<script async src="a"></script><script defer src="b"></script><script type="module" src="c"></script>';
    expect(countRenderBlocking(html)).toBe(0);
  });

  it('isModuleBundle detects type="module" entry', () => {
    expect(isModuleBundle('<script type="module" src="/x"></script>')).toBe(true);
    expect(isModuleBundle('<script src="x"></script>')).toBe(false);
  });
});

describe('performance-audit · metrics', () => {
  it('computeStaticMetrics returns all required fields', () => {
    const m = computeStaticMetrics({
      htmlBytes: 1000, cssBytes: 5000, jsBytes: 20_000,
      domNodes: 50, renderBlocking: 2, moduleBundle: true,
    });
    expect(m).toHaveProperty('fcp_ms');
    expect(m).toHaveProperty('lcp_ms');
    expect(m).toHaveProperty('tti_ms');
    expect(m).toHaveProperty('cls');
    expect(m).toHaveProperty('tbt_ms');
    expect(m).toHaveProperty('bundle_kb_gzip');
  });

  it('larger JS bundle → larger TTI', () => {
    const small = computeStaticMetrics({ htmlBytes: 1000, cssBytes: 0, jsBytes: 10_000, domNodes: 10, renderBlocking: 1, moduleBundle: true });
    const big = computeStaticMetrics({ htmlBytes: 1000, cssBytes: 0, jsBytes: 1_000_000, domNodes: 10, renderBlocking: 1, moduleBundle: true });
    expect(big.tti_ms).toBeGreaterThan(small.tti_ms);
  });

  it('module bundle reduces TBT vs sync', () => {
    const mod = computeStaticMetrics({ htmlBytes: 0, cssBytes: 0, jsBytes: 500_000, domNodes: 0, renderBlocking: 0, moduleBundle: true });
    const sync = computeStaticMetrics({ htmlBytes: 0, cssBytes: 0, jsBytes: 500_000, domNodes: 0, renderBlocking: 0, moduleBundle: false });
    expect(mod.tbt_ms).toBeLessThan(sync.tbt_ms);
  });
});

describe('performance-audit · studio action metrics', () => {
  it('returns tab/spin/gdd/mc/sweep timings', () => {
    const a = computeStudioActionMetrics({ jsBytes: 100_000, domNodes: 200 });
    expect(a.tab_switch_ms).toBeTypeOf('number');
    expect(a.spin_anim_ms).toBeTypeOf('number');
    expect(a.gdd_parse_ms).toBeTypeOf('number');
    expect(a.mc_100k_ms).toBeTypeOf('number');
    expect(a.sweep_1000_ms).toBeTypeOf('number');
  });

  it('typical studio action timings fit targets', () => {
    const a = computeStudioActionMetrics({ jsBytes: 180_000, domNodes: 2000 });
    expect(a.tab_switch_ms).toBeLessThanOrEqual(TARGETS.tab_switch_ms);
    expect(a.spin_anim_ms).toBeLessThanOrEqual(TARGETS.spin_anim_ms);
    expect(a.gdd_parse_ms).toBeLessThanOrEqual(TARGETS.gdd_parse_ms);
    expect(a.mc_100k_ms).toBeLessThanOrEqual(TARGETS.mc_100k_ms);
    expect(a.sweep_1000_ms).toBeLessThanOrEqual(TARGETS.sweep_1000_ms);
  });
});

describe('performance-audit · Lighthouse score', () => {
  it('perfect metrics score 100', () => {
    const score = computeLighthouseScore({
      fcp_ms: 800, lcp_ms: 1500, tti_ms: 2000, cls: 0.02, tbt_ms: 50,
    });
    expect(score).toBe(100);
  });

  it('poor metrics score < 30', () => {
    const score = computeLighthouseScore({
      fcp_ms: 5000, lcp_ms: 6000, tti_ms: 10_000, cls: 0.5, tbt_ms: 1500,
    });
    expect(score).toBeLessThan(30);
  });

  it('score is integer in 0..100', () => {
    const score = computeLighthouseScore({
      fcp_ms: 2200, lcp_ms: 3000, tti_ms: 4500, cls: 0.15, tbt_ms: 300,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(score)).toBe(true);
  });
});

describe('performance-audit · auditApp', () => {
  it('reports error for missing HTML', async () => {
    const r = await auditApp({ name: 'x', label: 'X', url: '', html: 'web/nonexistent.html', css: [], bundleEntry: 'web/nope.js' });
    expect(r.error).toMatch(/Missing HTML/);
  });

  it('audits studio without throwing', async () => {
    const studio = APPS.find(a => a.name === 'studio');
    const r = await auditApp(studio);
    expect(r.name).toBe('studio');
    expect(r.metrics).toBeDefined();
    expect(r.score).toBeGreaterThan(0);
  });

  it('studio has action metrics, others do not', async () => {
    const studio = APPS.find(a => a.name === 'studio');
    const operator = APPS.find(a => a.name === 'operator');
    const sr = await auditApp(studio);
    const or = await auditApp(operator);
    expect(sr.actions).toBeDefined();
    expect(or.actions).toBeUndefined();
  });
});

describe('performance-audit · markdown rendering', () => {
  it('renderMarkdown returns string with score', () => {
    const md = renderMarkdown([{
      name: 'studio',
      label: 'Studio',
      metrics: { fcp_ms: 500, lcp_ms: 800, tti_ms: 1200, cls: 0.02, tbt_ms: 50, bundle_kb_gzip: 50 },
      actions: { tab_switch_ms: 20, spin_anim_ms: 30, gdd_parse_ms: 2500, mc_100k_ms: 1200, sweep_1000_ms: 2800 },
      score: 95,
    }]);
    expect(md).toContain('Performance Audit');
    expect(md).toContain('studio');
    expect(md).toContain('95');
  });
});
