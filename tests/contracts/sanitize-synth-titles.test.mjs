#!/usr/bin/env node
/**
 * tests/contracts/sanitize-synth-titles.test.mjs
 *
 * N8 (2026-06-23) — Synth title sanitizer contract.
 */

import s from '../../tools/sanitize-synth-titles.mjs';
const { isPinnedBaseline, sanitizeText, sanitizeHtmlSurfaces } = s;

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const p = (async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  })();
  pending.push(p);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('SANITIZE-SYNTH-TITLES contract · test suite');

test('isPinnedBaseline: detects baseline paths', () => {
  assert(isPinnedBaseline('/x/cash-eruption-foundry-gdd/slot.html') === true, 'cash-eruption');
  assert(isPinnedBaseline('/x/starlight-travellers-gdd/slot.html') === true, 'starlight');
  assert(isPinnedBaseline('/x/006-varreel-cascade-ways-persistmult-1/slot.html') === false, '006 synth');
  assert(isPinnedBaseline('/x/03-88-fortunes/slot.html') === false, '03 synth');
});

test('sanitizeText: replaces Megaways family', () => {
  assert(sanitizeText('Modern Megaways cascade') === 'Modern Synthetic cascade', 'Megaways');
  assert(sanitizeText('MEGAWAYS slot') === 'Synthetic slot', 'MEGAWAYS upper');
  assert(sanitizeText('megaways-style') === 'Synthetic-style', 'megaways lower');
});

test('sanitizeText: replaces Cash Eruption variants', () => {
  assert(sanitizeText('Cash Eruption foundry') === 'Synthetic foundry', 'Cash Eruption');
  assert(sanitizeText('cash_eruption') === 'Synthetic', 'cash_eruption underscore');
  assert(sanitizeText('cash-eruption') === 'Synthetic', 'cash-eruption hyphen');
});

test('sanitizeText: replaces L&W word boundary', () => {
  assert(sanitizeText('Made by L&W studio') === 'Made by Synthetic studio', 'L&W');
});

test('sanitizeText: leaves vendor-free text intact', () => {
  assert(sanitizeText('regular slot game') === 'regular slot game', 'unchanged');
  assert(sanitizeText('') === '', 'empty');
});

test('sanitizeText: idempotent', () => {
  const once  = sanitizeText('Megaways cascade');
  const twice = sanitizeText(once);
  assert(once === twice, 'idempotent (no further change on second pass)');
});

test('sanitizeHtmlSurfaces: rewrites <title>', () => {
  const src = '<html><head><title>Synth 006 Modern Megaways cascade</title></head></html>';
  const { html, changes } = sanitizeHtmlSurfaces(src);
  assert(changes === 1, `1 change, got ${changes}`);
  assert(html.includes('<title>Synth 006 Modern Synthetic cascade</title>'), 'title rewritten');
});

test('sanitizeHtmlSurfaces: rewrites <div class="title">', () => {
  const src = '<div class="title">Modern Megaways</div>';
  const { html, changes } = sanitizeHtmlSurfaces(src);
  assert(changes === 1, '1 change');
  assert(html.includes('class="title">Modern Synthetic</div>'), 'div title rewritten');
});

test('sanitizeHtmlSurfaces: rewrites __MODEL_NAME__ const', () => {
  const src = 'const __MODEL_NAME__ = "Modern Megaways game";';
  const { html, changes } = sanitizeHtmlSurfaces(src);
  assert(changes === 1, '1 change');
  assert(html.includes('"Modern Synthetic game"'), 'const rewritten');
});

test('sanitizeHtmlSurfaces: ignores vendor strings outside the 3 surfaces', () => {
  /* Vendor name in body text NOT in title/div.title/__MODEL_NAME__ stays. */
  const src = '<body><p>Reference to Megaways elsewhere</p></body>';
  const { changes } = sanitizeHtmlSurfaces(src);
  assert(changes === 0, `no change for body text, got ${changes}`);
});

test('sanitizeHtmlSurfaces: idempotent', () => {
  const src = '<title>Megaways</title>';
  const { html: once }  = sanitizeHtmlSurfaces(src);
  const { html: twice, changes } = sanitizeHtmlSurfaces(once);
  assert(once === twice, 'idempotent — second pass produces same output');
  assert(changes === 0, 'second pass produces 0 changes');
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
