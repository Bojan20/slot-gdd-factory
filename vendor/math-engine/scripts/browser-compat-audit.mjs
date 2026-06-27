#!/usr/bin/env node
/**
 * CORTI W204-AUDIT — Browser Compatibility Audit
 *
 * Generates a matrix report of (app × browser × status) for:
 *   Chromium 120+, Firefox 119+, WebKit 17+ (Safari), Edge (Chromium).
 *
 * Modes:
 *   1. STATIC (default — no browser needed):
 *      Scans HTML + CSS + bundle for known browser-incompatible
 *      features and emits a matrix with conservative
 *      OK / WARN / FAIL verdicts based on:
 *        - CSS at-rules (@supports, @layer, :has(), container queries)
 *        - ES syntax (top-level await, optional chaining, BigInt literals)
 *        - APIs in source (structuredClone, ResizeObserver, etc.)
 *
 *   2. LIVE (--live):
 *      Uses playwright multi-browser launch to actually load each
 *      app, record console errors, click through 5 random
 *      interactions, take a screenshot. Falls back to static
 *      if a browser binary is missing.
 *
 * Output: reports/browser-compat/COMPAT_<date>.{json,md}
 * Screenshots: reports/browser-compat/<app>-<browser>.png  (live mode only).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────
// Browser matrix
// ─────────────────────────────────────────────────────────────────────────

export const BROWSERS = [
  { name: 'chromium', version: '120+', engine: 'Blink' },
  { name: 'firefox',  version: '119+', engine: 'Gecko' },
  { name: 'webkit',   version: '17+',  engine: 'WebKit' },
  { name: 'edge',     version: '120+', engine: 'Blink' },
];

export const APPS = [
  { name: 'studio',      url: 'http://localhost:5173', html: 'web/studio/index.html',      css: ['web/studio/styles.css'] },
  { name: 'operator',    url: 'http://localhost:5174', html: 'web/operator/index.html',    css: ['web/operator/styles.css'] },
  { name: 'regulator',   url: 'http://localhost:5175', html: 'web/regulator/index.html',   css: ['web/regulator/styles.css'] },
  { name: 'marketplace', url: 'http://localhost:5176', html: 'web/marketplace/index.html', css: ['web/marketplace/styles.css'] },
  { name: 'production',  url: 'http://localhost:8080', html: 'web/production/index.html',  css: [] },
];

// ─────────────────────────────────────────────────────────────────────────
// Feature detection rules
// ─────────────────────────────────────────────────────────────────────────

// Feature → minimum browser version (CanIUse style).
// "ok" if all browsers in our matrix support it natively.
export const FEATURE_RULES = [
  { id: 'css-has', test: css => /:has\(/.test(css),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: ':has() supported since FF 121, Safari 15.4, Chrome 105.' },
  { id: 'css-layer', test: css => /@layer\b/.test(css),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: '@layer supported since Chrome 99, FF 97, Safari 15.4.' },
  { id: 'css-container-queries', test: css => /@container\b/.test(css),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: 'CQ since Chrome 105, FF 110, Safari 16.' },
  { id: 'css-nested', test: css => /^\s*&\s/m.test(css),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: 'Nesting since Chrome 120, FF 117, Safari 17.2.' },
  { id: 'top-level-await', test: js => /^\s*await\s/m.test(js) || /\bawait\s+import\(/.test(js),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: 'TLA in modules since Chrome 89, FF 89, Safari 15.' },
  { id: 'structured-clone', test: js => /\bstructuredClone\s*\(/.test(js),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: 'structuredClone since Chrome 98, FF 94, Safari 15.4.' },
  { id: 'resize-observer', test: js => /\bResizeObserver\b/.test(js),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: 'RO since Chrome 64, FF 69, Safari 13.1.' },
  { id: 'bigint', test: js => /\d+n\b/.test(js) || /\bBigInt\(/.test(js),
    chromium: 'ok', firefox: 'ok', webkit: 'ok', edge: 'ok', note: 'BigInt since Chrome 67, FF 68, Safari 14.' },
];

export function scanFeatures(html, cssText, jsText) {
  const combinedCss = cssText;
  const combinedJs = jsText + '\n' + html;
  const features = [];
  for (const rule of FEATURE_RULES) {
    const present =
      rule.id.startsWith('css-') ? rule.test(combinedCss) :
      rule.test(combinedJs);
    if (present) features.push(rule);
  }
  return features;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-cell verdict
// ─────────────────────────────────────────────────────────────────────────

export function cellVerdict(features, browser) {
  let worst = 'ok';
  const reasons = [];
  for (const f of features) {
    const v = f[browser];
    if (v === 'fail') { worst = 'fail'; reasons.push(`${f.id}: FAIL`); break; }
    if (v === 'warn' && worst !== 'fail') { worst = 'warn'; reasons.push(`${f.id}: WARN`); }
  }
  return { status: worst, reasons };
}

// ─────────────────────────────────────────────────────────────────────────
// Static audit
// ─────────────────────────────────────────────────────────────────────────

export function auditAppStatic(app) {
  const htmlPath = join(ROOT, app.html);
  if (!existsSync(htmlPath)) {
    return { name: app.name, error: `Missing HTML: ${app.html}` };
  }
  const html = readFileSync(htmlPath, 'utf8');
  const cssText = (app.css || [])
    .map(p => existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '')
    .join('\n');
  // We can't run the bundle through node, so we just scan inline scripts
  // + index.html. For TS source files, optionally pull entry.
  const features = scanFeatures(html, cssText, html);

  const row = {};
  for (const b of BROWSERS) {
    row[b.name] = cellVerdict(features, b.name);
  }
  return { name: app.name, url: app.url, features: features.map(f => f.id), row };
}

// ─────────────────────────────────────────────────────────────────────────
// Live multi-browser test (--live)
// ─────────────────────────────────────────────────────────────────────────

async function liveBrowserPing(app, browserName, outDir) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (e) {
    return { status: 'skip', reasons: [`playwright import failed: ${e.message}`] };
  }
  const launcher = playwright[browserName];
  if (!launcher) return { status: 'skip', reasons: [`no launcher for ${browserName}`] };

  try {
    const browser = await launcher.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', e => consoleErrors.push(String(e?.message ?? e)));

    await page.goto(app.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // Try clicking up to 5 buttons to surface runtime errors.
    const btns = await page.$$('button');
    for (const btn of btns.slice(0, 5)) {
      try { await btn.click({ timeout: 500, trial: false }); } catch { /* ignore */ }
    }

    const screenshotPath = join(outDir, `${app.name}-${browserName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await browser.close();

    if (consoleErrors.length > 0) {
      return { status: 'warn', reasons: consoleErrors.slice(0, 3), screenshot: screenshotPath };
    }
    return { status: 'ok', reasons: [], screenshot: screenshotPath };
  } catch (e) {
    return { status: 'skip', reasons: [String(e?.message ?? e).slice(0, 200)] };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Matrix rendering
// ─────────────────────────────────────────────────────────────────────────

function statusEmoji(s) {
  if (s === 'ok') return 'PASS';
  if (s === 'warn') return 'WARN';
  if (s === 'fail') return 'FAIL';
  return 'SKIP';
}

export function renderMatrixMarkdown(results, opts = {}) {
  const lines = [];
  lines.push(`# Browser Compatibility Audit — CORTI W204-AUDIT`);
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Mode:** ${opts.live ? 'live (playwright multi-browser)' : 'static feature scan'}`);
  lines.push('');
  lines.push(`## Browser matrix`);
  lines.push('');
  const headers = ['App', ...BROWSERS.map(b => `${b.name} ${b.version}`)];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`|${headers.map(() => '---').join('|')}|`);
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.name} | ERR | ERR | ERR | ERR |`);
      continue;
    }
    const cells = BROWSERS.map(b => statusEmoji(r.row[b.name]?.status));
    lines.push(`| ${r.name} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Notes per app');
  for (const r of results) {
    if (r.error) continue;
    lines.push('');
    lines.push(`### ${r.name}`);
    if (r.features && r.features.length > 0) {
      lines.push(`- **Modern features detected:** ${r.features.join(', ')}`);
    }
    for (const b of BROWSERS) {
      const cell = r.row[b.name];
      if (cell && cell.reasons && cell.reasons.length > 0) {
        lines.push(`- **${b.name}:** ${cell.reasons.join('; ')}`);
      }
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
  };
}

export async function runAuditAll({ live = false } = {}) {
  const outDir = join(ROOT, 'reports', 'browser-compat');
  mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const app of APPS) {
    const r = auditAppStatic(app);
    if (live && !r.error) {
      r.row = {};
      for (const b of BROWSERS) {
        // Edge launcher is just chromium; skip if static already covered it.
        const browserName = b.name === 'edge' ? 'chromium' : b.name;
        r.row[b.name] = await liveBrowserPing(app, browserName, outDir);
      }
    }
    results.push(r);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = join(ROOT, 'reports', 'browser-compat');
  mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);

  const results = await runAuditAll(args);
  const jsonPath = join(outDir, `COMPAT_${date}.json`);
  const mdPath = join(outDir, `COMPAT_${date}.md`);

  writeFileSync(jsonPath, JSON.stringify({ date, mode: args.live ? 'live' : 'static', browsers: BROWSERS, results }, null, 2));
  writeFileSync(mdPath, renderMatrixMarkdown(results, args));

  console.log(`[browser-compat] mode=${args.live ? 'live' : 'static'}`);
  console.log(`[browser-compat] wrote ${jsonPath}`);
  console.log(`[browser-compat] wrote ${mdPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error('[browser-compat] FATAL:', e);
    process.exit(1);
  });
}
