/**
 * W214 Faza 1100.0 — term-sheet generator tests.
 *
 * Covers: argument parsing, validation, manifest loading, tier numeric
 * computations, full markdown render, HTML render, and 7×3 operator/tier
 * coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  validateArgs,
  loadOperatorManifest,
  computeTierNumbers,
  renderTermSheet,
  renderTermSheetHtml,
  generate,
  SUPPORTED_OPERATORS,
  SUPPORTED_TIERS,
  TIER_DETAIL,
  DISCLAIMER_BLOCK,
} from '../contracts/generate-term-sheet.mjs';

describe('term-sheet generator — args', () => {
  it('parses --operator and --tier', () => {
    const a = parseArgs(['node', 'x', '--operator=aristocrat', '--tier=B']);
    expect(a.operator).toBe('aristocrat');
    expect(a.tier).toBe('B');
  });

  it('validates a known operator + tier', () => {
    expect(() =>
      validateArgs({ operator: 'lw', tier: 'A' }),
    ).not.toThrow();
  });

  it('rejects an unknown operator', () => {
    expect(() =>
      validateArgs({ operator: 'unknown-co', tier: 'A' }),
    ).toThrow(/Unsupported operator/);
  });

  it('rejects an unknown tier', () => {
    expect(() =>
      validateArgs({ operator: 'lw', tier: 'Z' }),
    ).toThrow(/Unsupported tier/);
  });
});

describe('term-sheet generator — manifest loading', () => {
  it('loads each of the 7 supported operator manifests', async () => {
    for (const op of SUPPORTED_OPERATORS) {
      const m = await loadOperatorManifest(op);
      expect(m.operatorId).toBe(op);
      expect(typeof m.displayName).toBe('string');
      expect(typeof m.legalName).toBe('string');
    }
  });
});

describe('term-sheet generator — tier numeric computations', () => {
  it('Tier A returns sensible numbers for Vendor C', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const n = computeTierNumbers(m, 'A');
    expect(n.upfrontUSD).toBeGreaterThan(100_000);
    expect(n.annualMaintenanceUSD).toBeGreaterThan(0);
    expect(n.liabilityCapUSD).toBeGreaterThanOrEqual(1_000_000);
    expect(n.pilotConvertCreditUSD).toBeGreaterThan(0);
  });

  it('Tier B revenue share in [3%, 5%] for Tier-1 operators', async () => {
    for (const op of ['lw', 'aristocrat', 'igt', 'playtech', 'evolution']) {
      const m = await loadOperatorManifest(op);
      const n = computeTierNumbers(m, 'B');
      expect(n.revenueSharePct).toBeGreaterThanOrEqual(3.0);
      expect(n.revenueSharePct).toBeLessThanOrEqual(5.0);
    }
  });

  it('Tier C returns valuation range $200M–$500M', async () => {
    const m = await loadOperatorManifest('lw');
    const n = computeTierNumbers(m, 'C');
    expect(n.valuationLowUSD).toBe(200_000_000);
    expect(n.valuationHighUSD).toBe(500_000_000);
    expect(n.valuationMidUSD).toBeGreaterThan(200_000_000);
    expect(n.valuationMidUSD).toBeLessThan(500_000_000);
  });
});

describe('term-sheet generator — markdown render', () => {
  it('starts and ends with the disclaimer block', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const md = renderTermSheet(m, 'B', { date: '2026-05-18' });
    expect(md.startsWith(DISCLAIMER_BLOCK)).toBe(true);
    expect(md.trimEnd().endsWith(DISCLAIMER_BLOCK)).toBe(true);
  });

  it('includes operator display + legal name in the header', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const md = renderTermSheet(m, 'B', { date: '2026-05-18' });
    expect(md).toMatch(/Vendor C/);
    expect(md).toMatch(/Vendor C Technologies, Inc\./);
    expect(md).toMatch(/Tier B/);
  });

  it('renders tier-specific section title for each tier', async () => {
    const m = await loadOperatorManifest('lw');
    for (const t of SUPPORTED_TIERS) {
      const md = renderTermSheet(m, t, { date: '2026-05-18' });
      expect(md).toContain(`## ${TIER_DETAIL[t].short}`);
    }
  });
});

describe('term-sheet generator — HTML render', () => {
  it('returns a valid HTML document', async () => {
    const m = await loadOperatorManifest('lw');
    const md = renderTermSheet(m, 'A', { date: '2026-05-18' });
    const html = renderTermSheetHtml(md, 'Term Sheet — Vendor B (Tier A)');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/<title>/);
    expect(html).toMatch(/<\/html>/);
  });
});

describe('term-sheet generator — coverage of all 21 combos', () => {
  it('generates without error for every operator × tier combo', async () => {
    for (const op of SUPPORTED_OPERATORS) {
      for (const tier of SUPPORTED_TIERS) {
        const r = await generate({ operator: op, tier }, { write: false });
        expect(r.markdown.length).toBeGreaterThan(500);
        expect(r.html.length).toBeGreaterThan(500);
        expect(r.manifest.operatorId).toBe(op);
      }
    }
  });
});
