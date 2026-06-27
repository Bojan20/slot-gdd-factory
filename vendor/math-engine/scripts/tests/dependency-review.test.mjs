/**
 * W212 Faza 600.1 — dependency-review.mjs specs.
 */

import { describe, it, expect } from 'vitest';
import {
  PACKAGE_ROOTS,
  NON_PERMISSIVE,
  STALENESS_MONTHS,
  readPackageJson,
  listDependencies,
  detectLicense,
  recommend,
  reviewRoot,
  runReview,
  renderMarkdown,
} from '../security/dependency-review.mjs';

describe('W212 dep-review · constants', () => {
  it('PACKAGE_ROOTS includes the root', () => {
    expect(PACKAGE_ROOTS.find((r) => r.id === 'root')).toBeDefined();
  });
  it('NON_PERMISSIVE includes AGPL + SSPL', () => {
    expect(NON_PERMISSIVE.has('AGPL-3.0')).toBe(true);
    expect(NON_PERMISSIVE.has('SSPL-1.0')).toBe(true);
  });
  it('staleness threshold is months', () => {
    expect(STALENESS_MONTHS).toBeGreaterThan(0);
  });
});

describe('W212 dep-review · helpers', () => {
  it('listDependencies enumerates all sections', () => {
    const fakePkg = {
      dependencies: { a: '1.0.0' },
      devDependencies: { b: '2.0.0' },
      optionalDependencies: { c: '3.0.0' },
    };
    const deps = listDependencies(fakePkg);
    expect(deps).toHaveLength(3);
    expect(deps.map((d) => d.section).sort()).toEqual(['dependencies', 'devDependencies', 'optionalDependencies']);
  });

  it('detectLicense parses string + array forms', () => {
    expect(detectLicense({ license: 'MIT' })).toBe('MIT');
    expect(detectLicense({ licenses: [{ type: 'MIT' }, { type: 'BSD' }] })).toBe('MIT OR BSD');
    expect(detectLicense(null)).toBe('UNKNOWN');
  });

  it('recommend uses CVE first, then license, then staleness', () => {
    expect(recommend({ license: 'MIT', staleMonths: 1, highCveCount: 1 })).toBe('update');
    expect(recommend({ license: 'AGPL-3.0', staleMonths: 1, highCveCount: 0 })).toBe('replace');
    expect(recommend({ license: 'MIT', staleMonths: STALENESS_MONTHS + 1, highCveCount: 0 })).toBe('update');
    expect(recommend({ license: 'MIT', staleMonths: 1, highCveCount: 0 })).toBe('keep');
  });
});

describe('W212 dep-review · run', () => {
  it('reviewRoot of the project root returns a dep list', () => {
    const root = PACKAGE_ROOTS.find((r) => r.id === 'root');
    const r = reviewRoot(root);
    expect(r.deps.length).toBeGreaterThan(10);
    for (const d of r.deps) {
      expect(typeof d.name).toBe('string');
      expect(['dependencies', 'devDependencies', 'optionalDependencies']).toContain(d.section);
    }
  }, 30_000);

  it('runReview aggregates totals across roots', () => {
    const report = runReview();
    expect(report.totals.totalDeps).toBeGreaterThan(0);
    expect(typeof report.totals.nonPermissive).toBe('number');
  }, 60_000);

  it('renderMarkdown emits per-root sections', () => {
    const report = runReview();
    const md = renderMarkdown(report);
    expect(md).toContain('# Dependency Review');
    expect(md).toContain('## root (');
  }, 60_000);
});
