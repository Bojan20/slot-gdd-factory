/**
 * W212 Faza 800.0 — pitch README generator tests.
 */
import { describe, it, expect } from 'vitest';
import {
  parseReadmeArgs,
  renderReadme,
  renderInstall,
  renderContact,
  renderVersionTxt,
  ROLE_GUIDES,
  DEFAULT_STATS,
  DEFAULT_OPERATOR_NAME,
} from '../pitch/generate-pitch-readme.mjs';

describe('pitch readme — parseReadmeArgs', () => {
  it('defaults to operator Vendor B and no greeting override', () => {
    const a = parseReadmeArgs(['node', 'x']);
    expect(a.operator).toBe(DEFAULT_OPERATOR_NAME);
    expect(a.greeting).toBeNull();
  });

  it('parses --operator= and --greeting=', () => {
    const a = parseReadmeArgs(['node', 'x', '--operator=Vendor C', '--greeting=Hi A!']);
    expect(a.operator).toBe('Vendor C');
    expect(a.greeting).toBe('Hi A!');
  });
});

describe('pitch readme — ROLE_GUIDES', () => {
  it('covers all four executive roles', () => {
    expect(Object.keys(ROLE_GUIDES).sort()).toEqual(['CEO', 'CFO', 'CMO', 'CTO']);
  });

  it('each role has a non-empty ordered reading list', () => {
    for (const role of Object.keys(ROLE_GUIDES)) {
      const guide = ROLE_GUIDES[role];
      expect(typeof guide.headline).toBe('string');
      expect(guide.headline.length).toBeGreaterThan(0);
      expect(Array.isArray(guide.order)).toBe(true);
      expect(guide.order.length).toBeGreaterThan(0);
    }
  });
});

describe('pitch readme — renderReadme structure', () => {
  it('begins with the operator title', () => {
    const md = renderReadme({ operator: 'Vendor B', bundleVersion: 'v20990101' });
    expect(md.split('\n')[0]).toBe('# Slot Math Engine — Vendor B Acceleration Pilot Package');
  });

  it('substitutes a custom operator', () => {
    const md = renderReadme({ operator: 'Vendor C', bundleVersion: 'v20990101' });
    expect(md).toMatch(/Vendor C Acceleration Pilot Package/);
    expect(md).toMatch(/Vendor C team/);
  });

  it('includes the quick stats table with all 9 default rows', () => {
    const md = renderReadme({ operator: 'Vendor B', bundleVersion: 'v20990101' });
    expect(md).toMatch(/Quick stats/);
    expect(md).toMatch(/Closed-form solvers/);
    expect(md).toMatch(/Industry-pattern catalog/);
    expect(md).toMatch(/Vitest grand-total specs/);
    expect(md).toMatch(/Vendor B M-gaps closed/);
  });

  it('renders every per-role section header', () => {
    const md = renderReadme({ operator: 'Vendor B', bundleVersion: 'v20990101' });
    for (const role of Object.keys(ROLE_GUIDES)) {
      expect(md).toMatch(new RegExp(`For the ${role}`));
    }
  });

  it('includes the verify-yourself section pointing at verify.mjs / pitch:verify', () => {
    const md = renderReadme({ operator: 'Vendor B', bundleVersion: 'v20990101' });
    expect(md).toMatch(/## Verify yourself/);
    expect(md).toMatch(/verify\.mjs/);
    expect(md).toMatch(/pitch:verify/);
  });

  it('respects a custom greeting override', () => {
    const md = renderReadme({ operator: 'Vendor B', greeting: 'Hi Boki!', bundleVersion: 'v20990101' });
    expect(md).toContain('Hi Boki!');
  });
});

describe('pitch readme — companion files', () => {
  it('renderInstall lists the 3 reproduction commands', () => {
    const md = renderInstall({ operator: 'Vendor B' });
    expect(md).toMatch(/pilot:seed/);
    expect(md).toMatch(/pilot:integration/);
    expect(md).toMatch(/pilot:dossier/);
  });

  it('renderContact has placeholders for sales/technical/escalation', () => {
    const md = renderContact({ operator: 'Vendor B' });
    expect(md).toMatch(/## Commercial/);
    expect(md).toMatch(/## Technical/);
    expect(md).toMatch(/## Escalations/);
  });

  it('renderVersionTxt emits key=value lines for bundle/git/engine', () => {
    const v = renderVersionTxt({
      bundleVersion: 'v1',
      gitCommit: 'abc',
      gitBranch: 'main',
      generatedAt: '2099-01-01T00:00:00Z',
      engineVersion: '1.2.3',
    });
    expect(v).toMatch(/bundleVersion=v1/);
    expect(v).toMatch(/gitCommit=abc/);
    expect(v).toMatch(/gitBranch=main/);
    expect(v).toMatch(/generatedAt=2099-01-01T00:00:00Z/);
    expect(v).toMatch(/engineVersion=1\.2\.3/);
  });
});

describe('pitch readme — DEFAULT_STATS', () => {
  it('reports the engine live numbers', () => {
    expect(DEFAULT_STATS.closedFormSolvers).toBe(77);
    expect(DEFAULT_STATS.industryPatternIds).toBe(97);
    expect(DEFAULT_STATS.ciGates).toBe(106);
    expect(DEFAULT_STATS.lwMechanicGapsClosed).toBe(DEFAULT_STATS.lwMechanicGapsTotal);
  });
});
