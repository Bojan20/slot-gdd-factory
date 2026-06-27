/**
 * CORTI W204-AUDIT — tests for scripts/browser-compat-audit.mjs
 */

import { describe, it, expect } from 'vitest';
import {
  APPS,
  BROWSERS,
  FEATURE_RULES,
  scanFeatures,
  cellVerdict,
  auditAppStatic,
  renderMatrixMarkdown,
} from '../browser-compat-audit.mjs';

describe('browser-compat · constants', () => {
  it('BROWSERS includes chromium, firefox, webkit, edge', () => {
    const names = BROWSERS.map(b => b.name);
    expect(names).toContain('chromium');
    expect(names).toContain('firefox');
    expect(names).toContain('webkit');
    expect(names).toContain('edge');
  });

  it('APPS list matches 5 mini-apps', () => {
    expect(APPS).toHaveLength(5);
  });

  it('FEATURE_RULES are well-formed', () => {
    for (const rule of FEATURE_RULES) {
      expect(rule.id).toBeTypeOf('string');
      expect(rule.test).toBeTypeOf('function');
      for (const b of BROWSERS) {
        expect(['ok', 'warn', 'fail']).toContain(rule[b.name]);
      }
    }
  });
});

describe('browser-compat · feature scanning', () => {
  it('detects :has() in CSS', () => {
    const features = scanFeatures('', 'a:has(b) { color: red; }', '');
    expect(features.some(f => f.id === 'css-has')).toBe(true);
  });

  it('detects @container in CSS', () => {
    const features = scanFeatures('', '@container (min-width: 200px) {}', '');
    expect(features.some(f => f.id === 'css-container-queries')).toBe(true);
  });

  it('detects structuredClone in JS source', () => {
    const features = scanFeatures('', '', 'const x = structuredClone(obj);');
    expect(features.some(f => f.id === 'structured-clone')).toBe(true);
  });

  it('detects BigInt literal', () => {
    const features = scanFeatures('', '', 'const x = 1n;');
    expect(features.some(f => f.id === 'bigint')).toBe(true);
  });

  it('returns empty when no modern features present', () => {
    const features = scanFeatures('', 'div{color:red}', 'var x=1;');
    expect(features).toEqual([]);
  });
});

describe('browser-compat · cellVerdict', () => {
  it('returns ok when all features supported', () => {
    const v = cellVerdict([{ chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok' }], 'chromium');
    expect(v.status).toBe('ok');
  });

  it('returns fail when any feature fails', () => {
    const v = cellVerdict([{ id: 'x', chromium: 'fail', firefox: 'ok', webkit: 'ok', edge: 'ok' }], 'chromium');
    expect(v.status).toBe('fail');
  });

  it('returns warn when only warns present', () => {
    const v = cellVerdict([{ id: 'x', chromium: 'warn', firefox: 'ok', webkit: 'ok', edge: 'ok' }], 'chromium');
    expect(v.status).toBe('warn');
  });
});

describe('browser-compat · per-app audit', () => {
  it('returns error for missing HTML', () => {
    const r = auditAppStatic({ name: 'x', url: '', html: 'web/nope.html', css: [] });
    expect(r.error).toMatch(/Missing HTML/);
  });

  it('audits all real apps without error', () => {
    for (const app of APPS) {
      const r = auditAppStatic(app);
      expect(r.error, `${app.name} should not error`).toBeFalsy();
      expect(r.row).toBeDefined();
      for (const b of BROWSERS) {
        expect(r.row[b.name].status).toMatch(/^(ok|warn|fail|skip)$/);
      }
    }
  });

  it('every audited app has ok or warn (no fail) for chromium', () => {
    for (const app of APPS) {
      const r = auditAppStatic(app);
      expect(r.row.chromium.status, `${app.name} chromium should not fail`).not.toBe('fail');
    }
  });
});

describe('browser-compat · markdown rendering', () => {
  it('renderMatrixMarkdown produces app × browser table', () => {
    const results = [
      { name: 'studio', features: ['css-has'], row: {
        chromium: { status: 'ok', reasons: [] },
        firefox:  { status: 'ok', reasons: [] },
        webkit:   { status: 'ok', reasons: [] },
        edge:     { status: 'ok', reasons: [] },
      }},
    ];
    const md = renderMatrixMarkdown(results);
    expect(md).toContain('Browser Compatibility Audit');
    expect(md).toContain('studio');
    expect(md).toContain('chromium');
  });
});
