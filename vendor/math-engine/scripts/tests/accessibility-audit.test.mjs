/**
 * CORTI W204-AUDIT — tests for scripts/accessibility-audit.mjs
 */

import { describe, it, expect } from 'vitest';
import {
  APPS,
  SEVERITY,
  emptyFindings,
  hexToRgb,
  contrastRatio,
  extractCssVars,
  extractInlineStyles,
  auditContrast,
  auditHeadings,
  auditAltText,
  auditFormLabels,
  auditLandmarks,
  auditFocusIndicator,
  auditKeyboard,
  auditAppStatic,
  proposeAutoFixes,
  renderAppMarkdown,
} from '../accessibility-audit.mjs';

describe('a11y-audit · color contrast helpers', () => {
  it('hexToRgb decodes 6-digit hex', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('contrastRatio white-on-black ≈ 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
  });

  it('contrastRatio black-on-black ≈ 1:1', () => {
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 1);
  });

  it('extractCssVars parses :root variables', () => {
    const css = ':root { --bg-0: #0A0D11; --text-0: #E8ECF1; --other: 12px; }';
    const v = extractCssVars(css);
    expect(v['bg-0']).toBe('#0A0D11');
    expect(v['text-0']).toBe('#E8ECF1');
  });

  it('extractCssVars merges multiple :root (later wins)', () => {
    const css = ':root { --text-2: #5C6470; } :root { --text-2: #8A92A0; }';
    expect(extractCssVars(css)['text-2']).toBe('#8A92A0');
  });

  it('extractInlineStyles grabs <style> blocks', () => {
    const html = '<style>body{color:red}</style><div></div><style>p{color:blue}</style>';
    const inline = extractInlineStyles(html);
    expect(inline).toContain('body{color:red}');
    expect(inline).toContain('p{color:blue}');
  });
});

describe('a11y-audit · rule checks', () => {
  it('auditContrast flags low-contrast text-2 on bg-2', () => {
    const css = [':root { --text-0: #E8ECF1; --text-2: #5C6470; --bg-0: #0A0D11; --bg-2: #171C24; }'];
    const findings = auditContrast(css);
    expect(findings.some(f => f.id.includes('contrast-text-2'))).toBe(true);
  });

  it('auditContrast passes when contrast is high enough', () => {
    const css = [':root { --text-0: #FFFFFF; --text-2: #FFFFFF; --bg-0: #000000; --bg-2: #000000; }'];
    expect(auditContrast(css)).toEqual([]);
  });

  it('auditHeadings flags skipped levels', () => {
    const html = '<h1>x</h1><h3>y</h3>';
    const findings = auditHeadings(html);
    expect(findings.some(f => f.id.startsWith('heading-skip'))).toBe(true);
  });

  it('auditHeadings flags missing h1 first', () => {
    const html = '<h2>x</h2><h3>y</h3>';
    const findings = auditHeadings(html);
    expect(findings.some(f => f.id === 'no-h1')).toBe(true);
  });

  it('auditAltText flags images without alt', () => {
    const html = '<img src="x.png">';
    const findings = auditAltText(html);
    expect(findings.some(f => f.id === 'img-missing-alt')).toBe(true);
  });

  it('auditFormLabels flags bare input', () => {
    const html = '<input type="text">';
    const findings = auditFormLabels(html);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('auditFormLabels accepts wrapped <label><input></label>', () => {
    const html = '<label>Name <input type="text"></label>';
    expect(auditFormLabels(html)).toEqual([]);
  });

  it('auditFormLabels accepts aria-label', () => {
    const html = '<input type="text" aria-label="Name">';
    expect(auditFormLabels(html)).toEqual([]);
  });

  it('auditLandmarks flags missing <main>', () => {
    const html = '<div>no main</div>';
    const findings = auditLandmarks(html);
    expect(findings.some(f => f.id === 'no-main-landmark')).toBe(true);
  });

  it('auditFocusIndicator flags outline:none without focus-visible replacement', () => {
    const css = ['button:focus { outline: none; }'];
    const findings = auditFocusIndicator(css);
    expect(findings.some(f => f.severity === 'Critical')).toBe(true);
  });

  it('auditKeyboard flags positive tabindex', () => {
    const html = '<button tabindex="5">x</button>';
    expect(auditKeyboard(html).some(f => f.id === 'positive-tabindex')).toBe(true);
  });
});

describe('a11y-audit · per-app integration', () => {
  it('emptyFindings returns severity buckets', () => {
    const f = emptyFindings();
    for (const s of SEVERITY) expect(Array.isArray(f[s])).toBe(true);
  });

  it('audits studio without throwing', () => {
    const studio = APPS.find(a => a.name === 'studio');
    const r = auditAppStatic(studio);
    expect(r.name).toBe('studio');
    expect(r.counts).toBeDefined();
    expect(r.counts.Critical).toBeGreaterThanOrEqual(0);
  });

  it('audits all apps without Critical findings post auto-fix', () => {
    for (const app of APPS) {
      const r = auditAppStatic(app);
      expect(r.counts.Critical, `${app.name} has ${r.counts.Critical} Critical`).toBe(0);
    }
  });

  it('audits all apps without Serious findings post auto-fix', () => {
    for (const app of APPS) {
      const r = auditAppStatic(app);
      expect(r.counts.Serious, `${app.name} has ${r.counts.Serious} Serious`).toBe(0);
    }
  });
});

describe('a11y-audit · proposeAutoFixes', () => {
  it('proposes focus-visible patch when missing', () => {
    const findings = [{ id: 'no-focus-visible', severity: 'Serious', rule: '', description: '', fix: '' }];
    const patches = proposeAutoFixes(findings);
    expect(patches.some(p => p.append.includes('focus-visible'))).toBe(true);
  });

  it('returns empty patch list when no findings', () => {
    expect(proposeAutoFixes([])).toEqual([]);
  });
});

describe('a11y-audit · markdown rendering', () => {
  it('renderAppMarkdown returns string with counts', () => {
    const r = {
      name: 'x',
      url: 'http://x',
      timestamp: '2026-05-18T00:00:00Z',
      counts: { Critical: 0, Serious: 0, Moderate: 1, Minor: 2, total: 3 },
      findings: { Critical: [], Serious: [], Moderate: [{ id: 'a', rule: 'R', description: 'D', fix: 'F' }], Minor: [{ id: 'b', rule: 'R', description: 'D', fix: 'F' }, { id: 'c', rule: 'R', description: 'D', fix: 'F' }] },
    };
    const md = renderAppMarkdown(r);
    expect(md).toContain('WCAG');
    expect(md).toContain('Moderate findings');
    expect(md).toContain('Minor findings');
  });
});
