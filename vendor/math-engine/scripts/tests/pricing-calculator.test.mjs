/**
 * W214 Faza 1100.0 — pricing calculator tests.
 *
 * Covers: argument parsing, input validation, tier-A band scaling,
 * tier-B revenue share computation, 5-year projection, margin
 * analysis, status-quo comparison, and output formatters.
 */
import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  validateInputs,
  computeTierABand,
  computeTierBBand,
  projectArrFiveYear,
  computeMarginAnalysis,
  compareToCurrentBusiness,
  calculate,
  formatTable,
  formatJson,
  formatHtml,
  DEFAULT_INPUTS,
  SUPPORT_PREMIUM,
} from '../contracts/pricing-calculator.mjs';

describe('pricing calculator — args', () => {
  it('parses CLI args into an inputs object', () => {
    const a = parseArgs([
      'node',
      'x',
      '--operator-tier=2',
      '--games-per-year=40',
      '--jurisdictions=5',
      '--support-level=premium',
      '--format=json',
    ]);
    expect(a.operatorTier).toBe(2);
    expect(a.gamesPerYear).toBe(40);
    expect(a.jurisdictions).toBe(5);
    expect(a.supportLevel).toBe('premium');
    expect(a.format).toBe('json');
  });

  it('uses defaults when no flags are passed', () => {
    const a = parseArgs(['node', 'x']);
    expect(a.operatorTier).toBe(DEFAULT_INPUTS.operatorTier);
    expect(a.gamesPerYear).toBe(DEFAULT_INPUTS.gamesPerYear);
  });
});

describe('pricing calculator — validation', () => {
  it('accepts defaults', () => {
    expect(() => validateInputs({ ...DEFAULT_INPUTS })).not.toThrow();
  });

  it('rejects out-of-range operator-tier', () => {
    expect(() =>
      validateInputs({ ...DEFAULT_INPUTS, operatorTier: 4 }),
    ).toThrow(/operator-tier/);
  });

  it('rejects out-of-range games-per-year', () => {
    expect(() =>
      validateInputs({ ...DEFAULT_INPUTS, gamesPerYear: 1000 }),
    ).toThrow(/games-per-year/);
  });

  it('rejects bogus support level', () => {
    expect(() =>
      validateInputs({ ...DEFAULT_INPUTS, supportLevel: 'gold-plus' }),
    ).toThrow(/support-level/);
  });
});

describe('pricing calculator — tier A band', () => {
  it('returns low < mid < high', () => {
    const b = computeTierABand({ ...DEFAULT_INPUTS });
    expect(b.low).toBeLessThan(b.mid);
    expect(b.mid).toBeLessThan(b.high);
  });

  it('Tier-1 default mid is around $850K (within 20% tolerance)', () => {
    const b = computeTierABand({ ...DEFAULT_INPUTS, operatorTier: 1 });
    expect(b.mid).toBeGreaterThan(680_000);
    expect(b.mid).toBeLessThan(1_020_000);
  });

  it('Tier-3 mid is materially lower than Tier-1 mid', () => {
    const t1 = computeTierABand({ ...DEFAULT_INPUTS, operatorTier: 1 });
    const t3 = computeTierABand({ ...DEFAULT_INPUTS, operatorTier: 3 });
    expect(t3.mid).toBeLessThan(t1.mid);
  });

  it('premium support raises price; basic lowers it', () => {
    const basic = computeTierABand({ ...DEFAULT_INPUTS, supportLevel: 'basic' });
    const std = computeTierABand({ ...DEFAULT_INPUTS, supportLevel: 'standard' });
    const prem = computeTierABand({ ...DEFAULT_INPUTS, supportLevel: 'premium' });
    expect(basic.mid).toBeLessThan(std.mid);
    expect(std.mid).toBeLessThan(prem.mid);
  });
});

describe('pricing calculator — tier B band', () => {
  it('revenue share is in [2.5%, 6%]', () => {
    for (const t of [1, 2, 3]) {
      for (const lvl of ['basic', 'standard', 'premium']) {
        const b = computeTierBBand({
          ...DEFAULT_INPUTS,
          operatorTier: t,
          supportLevel: lvl,
        });
        expect(b.sharePct).toBeGreaterThanOrEqual(2.5);
        expect(b.sharePct).toBeLessThanOrEqual(6.0);
      }
    }
  });

  it('min annual floor is at least $50K', () => {
    const b = computeTierBBand({ ...DEFAULT_INPUTS });
    expect(b.minAnnualUSD).toBeGreaterThanOrEqual(50_000);
  });
});

describe('pricing calculator — 5-year projection', () => {
  it('Tier-A projects byYear[0] = upfront + maintenance and rest = maintenance only', () => {
    const p = projectArrFiveYear({ ...DEFAULT_INPUTS });
    const yr0 = p.tierA.byYear[0];
    const yr1 = p.tierA.byYear[1];
    expect(yr0).toBeGreaterThan(yr1);
    for (let i = 2; i < 5; i++) {
      expect(p.tierA.byYear[i]).toBe(yr1);
    }
  });

  it('Tier-B totals are non-negative and grow with games-per-year', () => {
    const small = projectArrFiveYear({ ...DEFAULT_INPUTS, gamesPerYear: 10 });
    const big = projectArrFiveYear({ ...DEFAULT_INPUTS, gamesPerYear: 80 });
    expect(big.tierB.total).toBeGreaterThan(small.tierB.total);
  });
});

describe('pricing calculator — margin', () => {
  it('GM% lies in [-50, 100]', () => {
    const m = computeMarginAnalysis({ ...DEFAULT_INPUTS });
    expect(m.tierA.grossMarginPct).toBeGreaterThan(-50);
    expect(m.tierA.grossMarginPct).toBeLessThanOrEqual(100);
    expect(m.tierB.grossMarginPct).toBeGreaterThan(-50);
    expect(m.tierB.grossMarginPct).toBeLessThanOrEqual(100);
  });
});

describe('pricing calculator — status-quo comparison', () => {
  it('engine cost < status-quo cost (positive savings)', () => {
    const c = compareToCurrentBusiness({ ...DEFAULT_INPUTS });
    expect(c.operatorSavings5yrUSD).toBeGreaterThan(0);
    expect(c.operatorReturnMultiple).toBeGreaterThan(1);
  });
});

describe('pricing calculator — top-level + formatters', () => {
  it('calculate() returns the full bundle for defaults', () => {
    const r = calculate({ ...DEFAULT_INPUTS });
    expect(r.tierA).toBeTruthy();
    expect(r.tierB).toBeTruthy();
    expect(r.projection).toBeTruthy();
    expect(r.margin).toBeTruthy();
    expect(r.compareCurrent).toBeTruthy();
  });

  it('formatTable contains key headings', () => {
    const r = calculate({ ...DEFAULT_INPUTS });
    const t = formatTable(r);
    expect(t).toMatch(/Vendor Pricing Calculator/);
    expect(t).toMatch(/Tier-A/);
    expect(t).toMatch(/Tier-B/);
    expect(t).toMatch(/Operator-side comparison/);
  });

  it('formatJson returns parsable JSON', () => {
    const r = calculate({ ...DEFAULT_INPUTS });
    const j = formatJson(r);
    const parsed = JSON.parse(j);
    expect(parsed.tierA.mid).toBeGreaterThan(0);
  });

  it('formatHtml returns an HTML document', () => {
    const r = calculate({ ...DEFAULT_INPUTS });
    const h = formatHtml(r);
    expect(h.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(h).toMatch(/Vendor Pricing Calculator/);
  });

  it('SUPPORT_PREMIUM has 3 levels with correct ordering', () => {
    expect(SUPPORT_PREMIUM.basic).toBeLessThan(SUPPORT_PREMIUM.standard);
    expect(SUPPORT_PREMIUM.standard).toBeLessThan(SUPPORT_PREMIUM.premium);
  });
});
