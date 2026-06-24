#!/usr/bin/env node
/**
 * tests/contracts/pwa-deep-u.test.mjs
 *
 * UQ-DEEP-U regression suite (2026-06-24) — Chrome console warning fixes
 * iz Cash Eruption preview:
 *   1. "apple-mobile-web-app-capable is deprecated. Please include
 *       mobile-web-app-capable" — fix: emit both generic + apple variants
 *   2. "Banner not shown: beforeinstallpromptevent.preventDefault() called.
 *       The page must call prompt() to show the banner" — fix: default
 *       NE preventDefault, only capture kad operator opt-in.
 *
 * Exit 0 PASS, 1 FAIL.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

console.log('═══ pwa-deep-u.test.mjs ═══');

/* ────────────────────────────────────────────────────────────────────── */
/* Fix #1: meta tag deprecation */

await test('U1: pwaInstallability emits BOTH generic + apple meta-tag', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/pwaInstallability.mjs'));
  const html = mod.emitPwaInstallabilityMarkup(mod.defaultConfig());
  assert(html.includes('<meta name="mobile-web-app-capable" content="yes">'),
    'generic mobile-web-app-capable missing');
  assert(html.includes('<meta name="apple-mobile-web-app-capable" content="yes">'),
    'apple-mobile-web-app-capable still present (iOS compat)');
});

await test('U1 E2E: Cash Eruption rebuilt HTML contains both meta tags', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  if (!existsSync(distPath)) throw new Error('Cash Eruption dist not built — run ingest');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('<meta name="mobile-web-app-capable" content="yes">'),
    'generic meta missing in live rendered HTML');
  assert(html.includes('<meta name="apple-mobile-web-app-capable" content="yes">'),
    'apple meta missing in live rendered HTML');
});

/* ────────────────────────────────────────────────────────────────────── */
/* Fix #2: PWA banner warning */

await test('U2: defaultConfig has captureInstallPrompt=false', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/pwaInstallability.mjs'));
  const cfg = mod.defaultConfig();
  assert(cfg.captureInstallPrompt === false,
    `default captureInstallPrompt should be false, got: ${cfg.captureInstallPrompt}`);
});

await test('U2: resolveConfig honors captureInstallPrompt=true override', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/pwaInstallability.mjs'));
  const cfg = mod.resolveConfig({ pwaInstallability: { captureInstallPrompt: true } });
  assert(cfg.captureInstallPrompt === true,
    'captureInstallPrompt=true override not applied');
});

await test('U2: runtime emits CAPTURE_INSTALL_PROMPT gate around preventDefault', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/pwaInstallability.mjs'));
  const runtime = mod.emitPwaInstallabilityRuntime(mod.defaultConfig());
  assert(runtime.includes('CAPTURE_INSTALL_PROMPT'), 'CAPTURE_INSTALL_PROMPT constant missing');
  assert(runtime.includes('if (CAPTURE_INSTALL_PROMPT)'), 'preventDefault gate missing');
  assert(runtime.includes('e.preventDefault()'),
    'preventDefault() still present (must be inside gate, not unconditional)');
});

await test('U2 E2E: Cash Eruption rebuilt HTML has CAPTURE_INSTALL_PROMPT=false', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('CAPTURE_INSTALL_PROMPT = false'),
    'CAPTURE_INSTALL_PROMPT not false in rendered HTML — would re-trigger warning');
  /* Localized test: extract just the beforeinstallprompt listener body and
   * verify the preventDefault inside is guarded by CAPTURE_INSTALL_PROMPT. */
  const idx = html.indexOf("addEventListener('beforeinstallprompt'");
  assert(idx >= 0, 'beforeinstallprompt listener missing entirely');
  /* Slice 400 chars from listener start. */
  const listenerBlock = html.slice(idx, idx + 400);
  assert(listenerBlock.includes('if (CAPTURE_INSTALL_PROMPT)'),
    'preventDefault not gated by CAPTURE_INSTALL_PROMPT inside listener');
  /* Verify preventDefault is INSIDE the gated block (substring match). */
  const gateMatch = listenerBlock.match(/if \(CAPTURE_INSTALL_PROMPT\) \{[^}]*e\.preventDefault\(\)/s);
  assert(gateMatch, 'preventDefault not inside CAPTURE_INSTALL_PROMPT branch');
});

/* ────────────────────────────────────────────────────────────────────── */

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
