#!/usr/bin/env node
/**
 * tests/contracts/ui-collapse-deep-v.test.mjs
 *
 * UQ-DEEP-V regression suite (2026-06-24) — UI overlap eliminated kroz
 * dva collapsible refactor-a:
 *
 *   1. universalForcePanel — bilo flex-wrap chip cluster top-right;
 *      preklapao liveRtpHud + hub elemente. Sad: dropdown toggle button
 *      + scrollable menu (hidden by default).
 *   2. batchSimulatorPanel — bilo fixed bottom-right; preklapao spin
 *      button / credits display. Sad: bottom-LEFT collapsed launcher
 *      sa upward-expand panel.
 *
 *   Oba sa: aria-expanded mirror, click-outside close, Escape close.
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
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}

console.log('═══ ui-collapse-deep-v.test.mjs ═══');

/* ────────────────────────────────────────────────────────────────────── */
/* UFP dropdown */

await test('UFP CSS: .ufp-root fixed + .ufp-menu[hidden] default-hidden', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/universalForcePanel.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  const css = mod.emitUniversalForcePanelCSS(cfg);
  assert(css.includes('.ufp-root {'), '.ufp-root selector missing');
  assert(css.includes('position: fixed'), 'fixed positioning missing');
  assert(css.includes('.ufp-menu[hidden]'), 'hidden state CSS missing');
  assert(css.includes('.ufp-toggle'), '.ufp-toggle selector missing');
  assert(css.includes('aria-expanded="true"'), 'expanded state styling missing');
});

await test('UFP markup: toggle button + menu wrapper sa hidden + aria-controls', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/universalForcePanel.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  /* Stub model sa minimum 1 feature kind. */
  const model = { features: [{ kind: 'free_spins' }, { kind: 'hold_and_win' }] };
  const markup = mod.emitUniversalForcePanelMarkup(cfg, model);
  assert(markup.includes('class="ufp-root"'), '.ufp-root wrapper missing');
  assert(markup.includes('id="ufpToggle"'), 'ufpToggle id missing');
  assert(markup.includes('aria-expanded="false"'), 'default closed state missing');
  assert(markup.includes('aria-controls="ufpMenu"'), 'aria-controls binding missing');
  assert(markup.includes('id="ufpMenu"'), 'ufpMenu id missing');
  assert(markup.includes('hidden>'), 'hidden default flag on menu missing');
});

await test('UFP runtime: toggle handler + click-outside + Escape', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/universalForcePanel.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  const model = { features: [{ kind: 'free_spins' }] };
  const runtime = mod.emitUniversalForcePanelRuntime(cfg, model);
  assert(runtime.includes('getElementById(\'ufpToggle\')'), 'toggle lookup missing');
  assert(runtime.includes('getElementById(\'ufpMenu\')'), 'menu lookup missing');
  assert(runtime.includes('aria-expanded'), 'aria-expanded mirror missing');
  assert(runtime.includes("e.key !== 'Escape'"), 'Escape key handler missing');
  assert(runtime.includes('toggle.contains(e.target) || menu.contains(e.target)'),
    'click-outside check missing');
});

/* ────────────────────────────────────────────────────────────────────── */
/* Batch simulator panel */

await test('BSP CSS: .batch-sim-root fixed bottom-LEFT (NOT bottom-right)', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  const css = mod.emitBatchSimulatorPanelCSS(cfg);
  assert(css.includes('.batch-sim-root {'), '.batch-sim-root missing');
  /* Must contain left positioning. */
  const rootBlock = css.match(/\.batch-sim-root\s*\{[^}]+\}/);
  assert(rootBlock, '.batch-sim-root rules not extractable');
  assert(/left:\s*12px/.test(rootBlock[0]), 'left:12px missing (root)');
  /* Old bottom-right rule must NOT be on the root anymore. */
  assert(!/\.batch-sim-panel\s*\{[^}]*position:\s*fixed[^}]*right:\s*12px/.test(css),
    'old bottom-right .batch-sim-panel fixed still present');
  assert(css.includes('.batch-sim-panel[hidden]'), 'panel hidden state CSS missing');
  assert(css.includes('.batch-sim-toggle'), 'launcher button CSS missing');
});

await test('BSP markup: toggle launcher + hidden default panel + aria-controls', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  const markup = mod.emitBatchSimulatorPanelMarkup(cfg);
  assert(markup.includes('class="batch-sim-root"'), 'root wrapper missing');
  assert(markup.includes('id="bspToggle"'), 'bspToggle id missing');
  assert(markup.includes('aria-controls="batchSimPanel"'), 'aria-controls missing');
  assert(markup.includes('aria-expanded="false"'), 'default closed state missing');
  assert(markup.includes('id="batchSimPanel" hidden'), 'panel default-hidden missing');
});

await test('BSP runtime: toggle handler + click-outside + Escape', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/batchSimulatorPanel.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  const runtime = mod.emitBatchSimulatorPanelRuntime(cfg, {});
  assert(runtime.includes("$('bspToggle')"), 'bspToggle lookup missing');
  assert(runtime.includes('bspSetOpen'), 'setOpen helper missing');
  assert(runtime.includes("e.key !== 'Escape'"), 'Escape handler missing');
  assert(runtime.includes('toggle.contains(e.target) || panel.contains(e.target)'),
    'click-outside check missing');
});

/* ────────────────────────────────────────────────────────────────────── */
/* E2E: live Cash Eruption HTML */

const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');

await test('E2E: Cash Eruption HTML contains UFP dropdown markers', async () => {
  if (!existsSync(distPath)) throw new Error('dist not built — run ingest');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('class="ufp-root"'), 'ufp-root not rendered');
  assert(html.includes('id="ufpToggle"'), 'ufpToggle not rendered');
  assert(html.includes('id="ufpMenu"'), 'ufpMenu not rendered');
  /* aria-expanded default false in markup. */
  assert(/id="ufpToggle"[^>]*aria-expanded="false"/.test(html),
    'ufpToggle not default-closed');
});

await test('E2E: Cash Eruption HTML contains batch sim collapsed launcher', async () => {
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('class="batch-sim-root"'), 'batch-sim-root not rendered');
  assert(html.includes('id="bspToggle"'), 'bspToggle not rendered');
  assert(/id="batchSimPanel" hidden/.test(html), 'batchSimPanel not default-hidden');
});

await test('E2E: no z-index 60 collision — UFP root + batch root differ in position', async () => {
  const html = readFileSync(distPath, 'utf8');
  /* UFP root is top-right (offset), batch root is bottom-left → no overlap
   * geometrically. Sanity-check by ensuring both CSS rules exist with the
   * expected anchoring sides. */
  assert(/\.ufp-root\s*\{[^}]*right:/.test(html), 'UFP root not right-anchored');
  assert(/\.batch-sim-root\s*\{[^}]*left:\s*12px/.test(html), 'batch root not left-anchored');
});

/* ────────────────────────────────────────────────────────────────────── */
/* Backwards-compat: legacy .ufp-panel selector still emit-uje za stari
 * test scrape (display:contents drži ga prisutnim u CSS, ne lomi DOM). */

await test('UFP backcompat: legacy .ufp-panel selector preserved', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/universalForcePanel.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  const css = mod.emitUniversalForcePanelCSS(cfg);
  assert(css.includes('.ufp-panel'), 'legacy .ufp-panel selector dropped');
  assert(css.includes('display: contents'), 'display:contents bridge missing');
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
