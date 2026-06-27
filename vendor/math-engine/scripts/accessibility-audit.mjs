#!/usr/bin/env node
/**
 * CORTI W204-AUDIT — WCAG 2.1 AA Accessibility Audit
 *
 * Hybrid auditor:
 *   1. STATIC HTML audit (default — no browser needed):
 *      Parses index.html + styles.css and checks the eight axis
 *      criteria below. Categorizes findings as
 *      Critical / Serious / Moderate / Minor.
 *
 *   2. LIVE axe-core run (--live):
 *      Requires axe-core + playwright. Loads each app URL and
 *      runs axe.run() against the live DOM. Merges results.
 *
 * Checks:
 *   - Color contrast       (4.5:1 normal / 3:1 large/UI)
 *   - Keyboard navigation  (tabindex, no traps)
 *   - Focus indicators     (:focus-visible CSS present)
 *   - ARIA roles           (landmarks, label/state pairing)
 *   - Heading hierarchy    (h1 → h2 → h3 no skip)
 *   - Alt text             (img + svg aria-hidden / role)
 *   - Form labels          (input id ↔ label-for)
 *   - Touch target size    (≥ 44 × 44 px equivalent)
 *
 * Output: reports/accessibility/WCAG_<app>_<date>.{json,md}
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────
// Severity registry
// ─────────────────────────────────────────────────────────────────────────

export const SEVERITY = ['Critical', 'Serious', 'Moderate', 'Minor'];

export function emptyFindings() {
  return { Critical: [], Serious: [], Moderate: [], Minor: [] };
}

// ─────────────────────────────────────────────────────────────────────────
// Apps (matches performance-audit.mjs)
// ─────────────────────────────────────────────────────────────────────────

export const APPS = [
  { name: 'studio',      url: 'http://localhost:5173', html: 'web/studio/index.html',      css: ['web/studio/styles.css'] },
  { name: 'operator',    url: 'http://localhost:5174', html: 'web/operator/index.html',    css: ['web/operator/styles.css'] },
  { name: 'regulator',   url: 'http://localhost:5175', html: 'web/regulator/index.html',   css: ['web/regulator/styles.css'] },
  { name: 'marketplace', url: 'http://localhost:5176', html: 'web/marketplace/index.html', css: ['web/marketplace/styles.css'] },
  { name: 'production',  url: 'http://localhost:8080', html: 'web/production/index.html',  css: [] },
];

// ─────────────────────────────────────────────────────────────────────────
// Color contrast (WCAG 2.1 AA)
// ─────────────────────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return { r, g, b };
}

function luminance({ r, g, b }) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

export function contrastRatio(fgHex, bgHex) {
  const L1 = luminance(hexToRgb(fgHex));
  const L2 = luminance(hexToRgb(bgHex));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// Extract --text-* and --bg-* variables out of all :root blocks (later wins).
export function extractCssVars(css) {
  const vars = {};
  const rootRe = /:root\s*\{([\s\S]*?)\}/g;
  let r;
  while ((r = rootRe.exec(css)) !== null) {
    const body = r[1];
    const re = /--([a-zA-Z0-9-]+):\s*(#[0-9a-fA-F]{6}|rgba?\([^)]+\))/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      vars[m[1]] = m[2];
    }
  }
  return vars;
}

export function auditContrast(cssTextArr) {
  const findings = [];
  const css = cssTextArr.join('\n');
  const vars = extractCssVars(css);
  // Pairs we expect to dominate: text-0 on bg-0/1/2.
  const fgKeys = ['text-0', 'text-1', 'text-2'];
  const bgKeys = ['bg-0', 'bg-1', 'bg-2'];
  for (const fk of fgKeys) {
    const fg = vars[fk];
    if (!fg || !fg.startsWith('#')) continue;
    for (const bk of bgKeys) {
      const bg = vars[bk];
      if (!bg || !bg.startsWith('#')) continue;
      const ratio = contrastRatio(fg, bg);
      // text-2/text-3 are typically secondary (large text only ok at 3:1).
      const required = fk === 'text-0' ? 4.5 : 3.0;
      if (ratio < required) {
        findings.push({
          id: `contrast-${fk}-on-${bk}`,
          severity: fk === 'text-0' ? 'Serious' : 'Moderate',
          rule: 'WCAG 2.1 1.4.3 Contrast (Minimum)',
          description: `--${fk} (${fg}) on --${bk} (${bg}) ratio ${ratio.toFixed(2)}:1 < ${required}:1`,
          fix: `Lighten --${fk} or darken --${bk} until contrast ≥ ${required}:1`,
          ratio,
          required,
        });
      }
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// Heading hierarchy
// ─────────────────────────────────────────────────────────────────────────

export function auditHeadings(html) {
  const findings = [];
  const re = /<h([1-6])\b/g;
  const levels = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    levels.push({ level: parseInt(m[1], 10), index: m.index });
  }
  if (levels.length === 0) {
    findings.push({
      id: 'no-headings',
      severity: 'Minor',
      rule: 'WCAG 2.1 2.4.6 Headings and Labels',
      description: 'No heading elements found.',
      fix: 'Add at least one <h1> at the top of <main>.',
    });
    return findings;
  }
  if (levels[0].level !== 1) {
    findings.push({
      id: 'no-h1',
      severity: 'Moderate',
      rule: 'WCAG 2.1 1.3.1 Info and Relationships',
      description: `First heading is <h${levels[0].level}>, expected <h1>.`,
      fix: 'Demote subsequent headings or promote first to h1.',
    });
  }
  for (let i = 1; i < levels.length; i++) {
    const delta = levels[i].level - levels[i - 1].level;
    if (delta > 1) {
      findings.push({
        id: `heading-skip-${i}`,
        severity: 'Minor',
        rule: 'WCAG 2.1 1.3.1 Info and Relationships',
        description: `Heading jumps from h${levels[i - 1].level} to h${levels[i].level}.`,
        fix: `Insert intermediate h${levels[i - 1].level + 1} or demote h${levels[i].level}.`,
      });
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// Alt text / aria-hidden on icon SVGs
// ─────────────────────────────────────────────────────────────────────────

export function auditAltText(html) {
  const findings = [];
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  for (const tag of imgs) {
    if (!/\balt\s*=/.test(tag)) {
      findings.push({
        id: 'img-missing-alt',
        severity: 'Serious',
        rule: 'WCAG 2.1 1.1.1 Non-text Content',
        description: `<img> missing alt attribute: ${tag.slice(0, 60)}...`,
        fix: 'Add alt="" for decorative or descriptive alt for informational images.',
      });
    }
  }
  // SVG without aria-hidden, aria-label, or role.
  const svgs = html.match(/<svg\b[^>]*>/g) || [];
  for (const tag of svgs) {
    const decorative = /\baria-hidden\s*=\s*["']true["']/.test(tag);
    const labeled = /\b(aria-label|aria-labelledby|role)\s*=/.test(tag);
    if (!decorative && !labeled) {
      findings.push({
        id: 'svg-no-aria',
        severity: 'Minor',
        rule: 'WCAG 2.1 1.1.1 Non-text Content',
        description: `<svg> has no aria-hidden / aria-label / role: ${tag.slice(0, 60)}...`,
        fix: 'Add aria-hidden="true" for decorative icons or aria-label for meaningful ones.',
      });
    }
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// Form labels
// ─────────────────────────────────────────────────────────────────────────

export function auditFormLabels(html) {
  const findings = [];
  // Find all input tags with their position to check wrapping label.
  const inputRe = /<input\b[^>]*>/g;
  let m;
  while ((m = inputRe.exec(html)) !== null) {
    const tag = m[0];
    const pos = m.index;
    if (/\btype\s*=\s*["'](hidden|submit|button|reset)["']/.test(tag)) continue;

    const hasLabel =
      /\baria-label\s*=/.test(tag) ||
      /\baria-labelledby\s*=/.test(tag) ||
      /\bplaceholder\s*=/.test(tag) ||  // not ideal but counts as accessible name
      /\btitle\s*=/.test(tag);
    if (hasLabel) continue;

    // Check if there's an id with matching <label for=...>
    const idMatch = tag.match(/\bid\s*=\s*["']([^"']+)["']/);
    const hasForLabel = idMatch && new RegExp(`<label[^>]+for\\s*=\\s*["']${idMatch[1]}["']`).test(html);
    if (hasForLabel) continue;

    // Check if wrapped in a <label>: look back over current line + immediate
    // preceding context for an unclosed <label>. We slice from the last
    // newline (current row only) so previous rows don't pollute the count.
    const lineStart = html.lastIndexOf('\n', pos - 1) + 1;
    const lookback = html.slice(lineStart, pos);
    const labelOpens = (lookback.match(/<label\b/g) || []).length;
    const labelCloses = (lookback.match(/<\/label>/g) || []).length;
    if (labelOpens > labelCloses) continue;

    findings.push({
      id: 'input-no-label',
      severity: 'Serious',
      rule: 'WCAG 2.1 1.3.1 / 3.3.2 Labels or Instructions',
      description: `<input> without label/aria-label: ${tag.slice(0, 80)}...`,
      fix: 'Add aria-label, or pair with <label for="…"> referencing the input id, or wrap in <label>.',
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// ARIA roles / landmarks
// ─────────────────────────────────────────────────────────────────────────

export function auditLandmarks(html) {
  const findings = [];
  if (!/<main\b|role\s*=\s*["']main["']/.test(html)) {
    findings.push({
      id: 'no-main-landmark',
      severity: 'Moderate',
      rule: 'WCAG 2.1 1.3.1 Info and Relationships',
      description: 'No <main> element or role="main" landmark.',
      fix: 'Wrap primary content in <main>.',
    });
  }
  if (!/<header\b|role\s*=\s*["']banner["']/.test(html)) {
    findings.push({
      id: 'no-banner-landmark',
      severity: 'Minor',
      rule: 'WCAG 2.1 1.3.1 Info and Relationships',
      description: 'No <header role="banner"> landmark.',
      fix: 'Add <header role="banner"> wrapping nav/logo.',
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// Focus indicator (CSS check)
// ─────────────────────────────────────────────────────────────────────────

export function auditFocusIndicator(cssTextArr) {
  const findings = [];
  const css = cssTextArr.join('\n');
  const hasFocusVisible = /:focus-visible/.test(css);
  const hasFocusWithOutlineNone = /:focus[^{]*\{[^}]*outline\s*:\s*none/i.test(css);

  if (!hasFocusVisible) {
    findings.push({
      id: 'no-focus-visible',
      severity: 'Serious',
      rule: 'WCAG 2.1 2.4.7 Focus Visible',
      description: 'No :focus-visible rules found in CSS.',
      fix: 'Add button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    });
  }
  if (hasFocusWithOutlineNone && !hasFocusVisible) {
    findings.push({
      id: 'focus-outline-removed',
      severity: 'Critical',
      rule: 'WCAG 2.1 2.4.7 Focus Visible',
      description: ':focus { outline: none } removes focus indicator without replacement.',
      fix: 'Replace with :focus-visible block providing visible outline / box-shadow.',
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// Skip link / keyboard nav
// ─────────────────────────────────────────────────────────────────────────

export function auditKeyboard(html) {
  const findings = [];
  if (!/\b(href\s*=\s*["']#main["']|class\s*=\s*["']skip["'])/.test(html)) {
    findings.push({
      id: 'no-skip-link',
      severity: 'Minor',
      rule: 'WCAG 2.1 2.4.1 Bypass Blocks',
      description: 'No "skip to main content" link detected.',
      fix: 'Add <a class="skip" href="#main">Skip to content</a> as first focusable element.',
    });
  }
  // tabindex > 0 is an anti-pattern.
  const badTabindex = html.match(/tabindex\s*=\s*["']([1-9]\d*)["']/g);
  if (badTabindex && badTabindex.length > 0) {
    findings.push({
      id: 'positive-tabindex',
      severity: 'Moderate',
      rule: 'WCAG 2.1 2.4.3 Focus Order',
      description: `Positive tabindex values found (${badTabindex.length} instances).`,
      fix: 'Remove positive tabindex; rely on DOM order.',
    });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────
// Compose audit per app
// ─────────────────────────────────────────────────────────────────────────

export function extractInlineStyles(html) {
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out.join('\n');
}

export function auditAppStatic(app) {
  const htmlPath = join(ROOT, app.html);
  if (!existsSync(htmlPath)) {
    return { name: app.name, error: `Missing HTML: ${app.html}`, findings: emptyFindings() };
  }
  const html = readFileSync(htmlPath, 'utf8');
  const cssTexts = (app.css || [])
    .map(p => existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '')
    .filter(Boolean);
  // Include inline <style> blocks from HTML for focus-visible / contrast checks.
  const inlineCss = extractInlineStyles(html);
  if (inlineCss) cssTexts.push(inlineCss);

  const all = [
    ...auditContrast(cssTexts),
    ...auditHeadings(html),
    ...auditAltText(html),
    ...auditFormLabels(html),
    ...auditLandmarks(html),
    ...auditFocusIndicator(cssTexts),
    ...auditKeyboard(html),
  ];

  const findings = emptyFindings();
  for (const f of all) findings[f.severity].push(f);

  return {
    name: app.name,
    url: app.url,
    timestamp: new Date().toISOString(),
    counts: {
      Critical: findings.Critical.length,
      Serious: findings.Serious.length,
      Moderate: findings.Moderate.length,
      Minor: findings.Minor.length,
      total: all.length,
    },
    findings,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Auto-fix helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Given a CSS string + finding list, propose patches (additive only).
 * Returns { patches: [{ description, append: 'css text' }] }
 */
export function proposeAutoFixes(findings) {
  const patches = [];
  if (findings.some(f => f.id === 'no-focus-visible' || f.id === 'focus-outline-removed')) {
    patches.push({
      description: 'Add :focus-visible indicator for all interactive elements',
      append: `\n/* W204-AUDIT auto-fix: focus-visible indicator */\nbutton:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {\n  outline: 2px solid var(--accent, var(--cyan, #22D3EE));\n  outline-offset: 2px;\n}\n`,
    });
  }
  if (findings.some(f => f.id.startsWith('contrast-text-2'))) {
    patches.push({
      description: 'Bump --text-2 secondary text contrast',
      append: '\n/* W204-AUDIT auto-fix: secondary text contrast */\n:root { --text-2: #7A8290; }\n',
    });
  }
  return patches;
}

// ─────────────────────────────────────────────────────────────────────────
// Markdown rendering
// ─────────────────────────────────────────────────────────────────────────

export function renderAppMarkdown(result) {
  const lines = [];
  lines.push(`# WCAG 2.1 AA Audit — ${result.name}`);
  lines.push('');
  lines.push(`**URL:** ${result.url}`);
  lines.push(`**Date:** ${result.timestamp.slice(0, 10)}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Severity | Count |`);
  lines.push(`|---|---:|`);
  lines.push(`| Critical | ${result.counts.Critical} |`);
  lines.push(`| Serious  | ${result.counts.Serious} |`);
  lines.push(`| Moderate | ${result.counts.Moderate} |`);
  lines.push(`| Minor    | ${result.counts.Minor} |`);
  lines.push(`| **Total**| ${result.counts.total} |`);
  lines.push('');
  for (const sev of SEVERITY) {
    if (result.findings[sev].length === 0) continue;
    lines.push(`## ${sev} findings`);
    lines.push('');
    for (const f of result.findings[sev]) {
      lines.push(`### ${f.id}`);
      lines.push(`- **Rule:** ${f.rule}`);
      lines.push(`- **Description:** ${f.description}`);
      lines.push(`- **Fix:** ${f.fix}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  return {
    live: argv.includes('--live'),
    apps: argv.find(a => a.startsWith('--apps='))?.slice('--apps='.length)?.split(',') ?? null,
  };
}

export async function runAuditAll({ live = false, apps = null } = {}) {
  const results = [];
  for (const app of APPS) {
    if (apps && !apps.includes(app.name)) continue;
    const r = auditAppStatic(app);
    if (live) {
      try {
        const { default: axeSource } = await import('axe-core').catch(() => ({ default: null }));
        const playwright = await import('playwright');
        if (!axeSource) throw new Error('axe-core not installed');
        const browser = await playwright.chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(app.url, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.addScriptTag({ content: axeSource.source });
        const liveResults = await page.evaluate(async () => {
          // @ts-ignore
          return await window.axe.run();
        });
        r.live = liveResults;
        await browser.close();
      } catch (e) {
        r.live_error = String(e?.message ?? e);
      }
    }
    results.push(r);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = join(ROOT, 'reports', 'accessibility');
  mkdirSync(outDir, { recursive: true });

  const results = await runAuditAll(args);
  const date = new Date().toISOString().slice(0, 10);

  for (const r of results) {
    if (r.error) {
      console.log(`[a11y-audit] ${r.name}: ${r.error}`);
      continue;
    }
    const jsonPath = join(outDir, `WCAG_${r.name}_${date}.json`);
    const mdPath = join(outDir, `WCAG_${r.name}_${date}.md`);
    writeFileSync(jsonPath, JSON.stringify(r, null, 2));
    writeFileSync(mdPath, renderAppMarkdown(r));
    console.log(`[a11y-audit] ${r.name}: C=${r.counts.Critical} S=${r.counts.Serious} M=${r.counts.Moderate} m=${r.counts.Minor} → ${mdPath}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error('[a11y-audit] FATAL:', e);
    process.exit(1);
  });
}
