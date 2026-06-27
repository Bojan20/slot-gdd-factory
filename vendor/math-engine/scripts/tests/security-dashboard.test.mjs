/**
 * W214 Faza 600.3 — security dashboard specs.
 */

import { describe, it, expect } from 'vitest';
import {
  WINDOW_DAYS,
  REGRESSION_WINDOW_DAYS,
  windowSnapshots,
  summariseCategories,
  detectRegressions,
  trendCounts,
  buildDashboard,
  renderMarkdown,
  renderHtml,
} from '../security/dashboard.mjs';

function mkSnap(daysAgo, cats) {
  const now = Date.now();
  return {
    takenAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    categories: cats,
  };
}

describe('W214 dashboard · constants', () => {
  it('windows are sane', () => {
    expect(WINDOW_DAYS).toBeGreaterThan(0);
    expect(REGRESSION_WINDOW_DAYS).toBeGreaterThan(0);
    expect(WINDOW_DAYS).toBeGreaterThanOrEqual(REGRESSION_WINDOW_DAYS);
  });
});

describe('W214 dashboard · windowing', () => {
  it('windowSnapshots filters by recency', () => {
    const all = [
      mkSnap(40, []),
      mkSnap(5, []),
      mkSnap(1, []),
    ];
    const within = windowSnapshots(all, 30);
    expect(within).toHaveLength(2);
  });

  it('summariseCategories groups by id', () => {
    const map = summariseCategories([
      mkSnap(2, [{ id: 'a', verdict: 'pass' }, { id: 'b', verdict: 'warn' }]),
      mkSnap(1, [{ id: 'a', verdict: 'pass' }]),
    ]);
    expect(map.get('a')).toHaveLength(2);
    expect(map.get('b')).toHaveLength(1);
  });
});

describe('W214 dashboard · regressions', () => {
  it('detects pass→warn transition within window', () => {
    const snaps = [
      mkSnap(5, [{ id: 'cors', verdict: 'pass' }]),
      mkSnap(1, [{ id: 'cors', verdict: 'warn' }]),
    ];
    const regs = detectRegressions(snaps);
    expect(regs).toHaveLength(1);
    expect(regs[0].category).toBe('cors');
    expect(regs[0].from).toBe('pass');
    expect(regs[0].to).toBe('warn');
  });

  it('does not flag warn→pass (improvement)', () => {
    const snaps = [
      mkSnap(5, [{ id: 'cors', verdict: 'warn' }]),
      mkSnap(1, [{ id: 'cors', verdict: 'pass' }]),
    ];
    const regs = detectRegressions(snaps);
    expect(regs).toHaveLength(0);
  });

  it('ignores snapshots outside the regression window', () => {
    const snaps = [
      mkSnap(20, [{ id: 'cors', verdict: 'pass' }]),
      mkSnap(1, [{ id: 'cors', verdict: 'warn' }]),
    ];
    // Only one snapshot in 7d window → cannot regress.
    const regs = detectRegressions(snaps);
    expect(regs).toHaveLength(0);
  });
});

describe('W214 dashboard · trends + dashboard build', () => {
  it('trendCounts returns one row per snapshot', () => {
    const snaps = [
      mkSnap(2, [{ id: 'a', verdict: 'pass' }, { id: 'b', verdict: 'fail' }]),
      mkSnap(1, [{ id: 'a', verdict: 'pass' }, { id: 'b', verdict: 'pass' }]),
    ];
    const t = trendCounts(snaps);
    expect(t).toHaveLength(2);
    expect(t[0].pass).toBe(1);
    expect(t[0].fail).toBe(1);
    expect(t[1].pass).toBe(2);
  });

  it('buildDashboard produces structured object with latest + regressions + trend', () => {
    const snaps = [
      mkSnap(20, [{ id: 'x', verdict: 'pass' }]),
      mkSnap(2, [{ id: 'x', verdict: 'fail' }]),
    ];
    const dash = buildDashboard(snaps);
    expect(dash.snapshotsInWindow).toBe(2);
    expect(dash.latest?.categories[0].verdict).toBe('fail');
    expect(Array.isArray(dash.trend)).toBe(true);
    expect(Array.isArray(dash.regressions)).toBe(true);
  });

  it('handles empty history gracefully', () => {
    const dash = buildDashboard([]);
    expect(dash.snapshotsInWindow).toBe(0);
    expect(dash.latest).toBeNull();
    expect(dash.regressions).toEqual([]);
  });
});

describe('W214 dashboard · renderers', () => {
  it('renderMarkdown contains category table when latest exists', () => {
    const snaps = [mkSnap(1, [{ id: 'cors', verdict: 'pass' }])];
    const md = renderMarkdown(buildDashboard(snaps));
    expect(md).toContain('# Security Dashboard');
    expect(md).toContain('cors');
    expect(md).toContain('PASS');
  });

  it('renderHtml emits valid SVG line chart elements', () => {
    const snaps = [
      mkSnap(2, [{ id: 'a', verdict: 'pass' }]),
      mkSnap(1, [{ id: 'a', verdict: 'pass' }, { id: 'b', verdict: 'warn' }]),
    ];
    const html = renderHtml(buildDashboard(snaps));
    expect(html).toContain('<svg');
    expect(html).toContain('polyline');
    expect(html).toContain('Security Dashboard');
  });
});
