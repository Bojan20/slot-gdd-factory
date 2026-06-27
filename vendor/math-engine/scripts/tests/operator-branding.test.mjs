/**
 * W213 Faza 700.1 — operator-branding tests.
 */
import { describe, it, expect } from 'vitest';
import {
  REQUIRED_FIELDS,
  PRICING_FIELDS,
  OPERATOR_DIR,
  DEFAULT_OPERATOR_ID,
  listAvailableOperators,
  loadOperatorManifest,
  validateOperatorManifest,
  applyBranding,
  applyBrandingToHtml,
  applyBrandingToCss,
  operatorReplacements,
  splitOutCodeRegions,
  renderContactPlaceholders,
} from '../pitch/operator-branding.mjs';

describe('operator-branding — manifests', () => {
  it('listAvailableOperators returns the 7 defaults', async () => {
    const ids = await listAvailableOperators();
    expect(ids).toEqual(
      expect.arrayContaining(['lw', 'aristocrat', 'igt', 'pragmatic', 'hacksaw', 'evolution', 'playtech'])
    );
    // _template.json is excluded.
    expect(ids).not.toContain('_template');
  });

  it('loads + validates every default operator manifest', async () => {
    const ids = await listAvailableOperators();
    for (const id of ids) {
      const m = await loadOperatorManifest(id);
      expect(m.operatorId).toBe(id);
      expect(typeof m.displayName).toBe('string');
      expect(typeof m.legalName).toBe('string');
      expect(/^#[0-9a-fA-F]+$/.test(m.primaryColor)).toBe(true);
      expect(Array.isArray(m.certLabsUsed)).toBe(true);
      expect(Array.isArray(m.jurisdictions)).toBe(true);
    }
  });

  it('_template.json is loadable + valid', async () => {
    const m = await loadOperatorManifest('_template');
    expect(m.operatorId).toBe('custom');
    expect(validateOperatorManifest(m)).toBe(true);
  });

  it('REQUIRED_FIELDS list is non-empty and covers core fields', () => {
    expect(REQUIRED_FIELDS.length).toBeGreaterThanOrEqual(15);
    expect(REQUIRED_FIELDS).toContain('operatorId');
    expect(REQUIRED_FIELDS).toContain('primaryColor');
    expect(REQUIRED_FIELDS).toContain('samplePricing');
  });

  it('validateOperatorManifest rejects empty object', () => {
    expect(() => validateOperatorManifest({})).toThrow(/missing required field/);
  });

  it('validateOperatorManifest rejects bad operatorId slug', () => {
    expect(() => validateOperatorManifest({
      operatorId: 'BadCAPS',
      displayName: 'x', legalName: 'x', shortName: 'x', hqLocation: 'x',
      primaryColor: '#abc', accentColor: '#abc', tier: 'Tier-2',
      contactRole: 'x', contactName: 'x', contactEmail: 'x', typicalTitle: 'x',
      portfolioSize: 1, annualReleases: 1, certLabsUsed: [], jurisdictions: [],
      rtpStandard: 'x', decisionMakerRole: 'x', landingPageSlug: 'x',
      pricingTierLabel: 'x',
      samplePricing: { pilotUSD: 0, yearOneLicenseUSD: 0, perSpinCostMills: 0 },
    })).toThrow(/operatorId must be a lower-case slug/);
  });

  it('validateOperatorManifest rejects bad primaryColor', () => {
    const minimal = (overrides = {}) => ({
      operatorId: 'x', displayName: 'x', legalName: 'x', shortName: 'x',
      hqLocation: 'x', primaryColor: '#abc', accentColor: '#abc',
      tier: 'Tier-2', contactRole: 'x', contactName: 'x', contactEmail: 'x',
      typicalTitle: 'x', portfolioSize: 1, annualReleases: 1,
      certLabsUsed: [], jurisdictions: [], rtpStandard: 'x',
      decisionMakerRole: 'x', landingPageSlug: 'x', pricingTierLabel: 'x',
      samplePricing: { pilotUSD: 0, yearOneLicenseUSD: 0, perSpinCostMills: 0 },
      ...overrides,
    });
    expect(() => validateOperatorManifest(minimal({ primaryColor: 'red' })))
      .toThrow(/primaryColor must be a hex/);
  });

  it('validateOperatorManifest rejects missing samplePricing keys', () => {
    expect(() => validateOperatorManifest({
      operatorId: 'x', displayName: 'x', legalName: 'x', shortName: 'x',
      hqLocation: 'x', primaryColor: '#abc', accentColor: '#abc',
      tier: 'Tier-2', contactRole: 'x', contactName: 'x', contactEmail: 'x',
      typicalTitle: 'x', portfolioSize: 1, annualReleases: 1,
      certLabsUsed: [], jurisdictions: [], rtpStandard: 'x',
      decisionMakerRole: 'x', landingPageSlug: 'x', pricingTierLabel: 'x',
      samplePricing: { pilotUSD: 0 },
    })).toThrow(/samplePricing missing/);
  });
});

describe('operator-branding — replacements', () => {
  it('default operator (lw) produces no replacements', async () => {
    const m = await loadOperatorManifest('lw');
    expect(operatorReplacements(m).length).toBe(0);
    // applyBranding is identity for default operator.
    const txt = 'Hello Vendor B team — Vendor B rocks. Vendor B ticker.';
    expect(applyBranding(txt, m)).toBe(txt);
  });

  it('aristocrat manifest produces replacements for Vendor B tokens', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const reps = operatorReplacements(m);
    const froms = reps.map((r) => r.from);
    expect(froms).toContain('Vendor B');
    expect(froms).toContain('Vendor B');
    expect(froms).toContain('Vendor B');
  });

  it('applyBranding swaps "Vendor B" → "Vendor C" in plain text', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const out = applyBranding('Hello Vendor B team — welcome to Vendor B.', m);
    expect(out).toBe('Hello Vendor C team — welcome to Vendor C.');
  });

  it('applyBranding does NOT swap inside fenced code blocks', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const src = [
      'Hello Vendor B team',
      '```',
      'const operator = "Vendor B";', // must remain Vendor B
      '```',
      'See you at Vendor B.',
    ].join('\n');
    const out = applyBranding(src, m);
    expect(out).toContain('const operator = "Vendor B"');
    expect(out).toContain('Hello Vendor C team');
    expect(out).toContain('See you at Vendor C.');
  });

  it('applyBranding swaps "Vendor B" before "Vendor B" so legal name wins', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const out = applyBranding('Visit Vendor B HQ — Vendor B rules.', m);
    expect(out).toContain('Vendor C HQ');
    expect(out).not.toContain('Vendor B');
  });

  it('applyBranding swaps Vendor B ticker → ALL.AX for aristocrat', async () => {
    const m = await loadOperatorManifest('aristocrat');
    // NASDAQ ticker LNW is the public stock symbol; kept un-sanitized
    // so per-operator ticker swap can run without colliding with the
    // display-name `Vendor B` token.
    const out = applyBranding('Ticker: LNW.', m);
    expect(out).toBe('Ticker: ALL.AX.');
  });

  it('applyBrandingToHtml updates <style>, <title>, and color tokens', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const html = '<html><head><title>L&amp;W deck</title><style>:root{--brand-primary:#22d3ee}.x{color:#22d3ee}</style></head><body>L&amp;W</body></html>';
    const out = applyBrandingToHtml(html, m);
    expect(out).toContain('<title>Vendor C deck</title>');
    expect(out).toContain('--brand-primary: #dc2626');
    expect(out).toContain(m.primaryColor);
  });

  it('applyBrandingToCss replaces Vendor B cyan with operator primary', async () => {
    const m = await loadOperatorManifest('hacksaw');
    const out = applyBrandingToCss('.h1 { color: #22d3ee } --brand-primary: #22d3ee;', m);
    expect(out).toContain('#a855f7');
    expect(out).not.toMatch(/#22d3ee/i);
  });

  it('splitOutCodeRegions preserves fenced-block boundaries', () => {
    const t = ['plain', '```', 'code1', 'code2', '```', 'plain2'].join('\n');
    const parts = splitOutCodeRegions(t);
    expect(parts.some((p) => p.kind === 'code')).toBe(true);
    expect(parts.some((p) => p.kind === 'text')).toBe(true);
    // Round-trip text reconstruction.
    expect(parts.map((p) => p.value).join('')).toContain('code1');
  });
});

describe('operator-branding — placeholders', () => {
  it('renderContactPlaceholders returns the canonical 5 fields', async () => {
    const m = await loadOperatorManifest('aristocrat');
    const p = renderContactPlaceholders(m);
    expect(p.name).toContain('Vendor C');
    expect(p.email).toContain('Vendor C');
    expect(p.role).toBe(m.contactRole);
    expect(p.calendar).toContain('aristocrat-pilot');
    expect(p.decisionMaker).toBe(m.decisionMakerRole);
  });
});
