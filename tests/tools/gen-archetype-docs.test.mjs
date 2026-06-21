/**
 * tests/tools/gen-archetype-docs.test.mjs
 *
 * Wave UQ-15 (2026-06-21) — Smoke test for the archetype docs generator.
 *
 * Asserts:
 *   1. Tool exits 0 and writes both archetypes.html + archetypes-meta.json
 *   2. HTML is self-contained (no external <link>/<script src>)
 *   3. All 28 archetypes appear as cards
 *   4. Aliases section appears with right count
 *   5. Non-archetype section appears with right count
 *   6. JSON meta mirrors catalog faithfully
 *   7. Vendor-trademark sweep over generated HTML (rule_no_vendor_mentions)
 */
import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ARCHETYPES,
  ARCHETYPE_ALIASES,
  NON_ARCHETYPE_KINDS,
  ARCHETYPE_COUNT,
} from '../../src/registry/featureArchetypes.mjs';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');
const TOOL = resolve(REPO, 'tools/gen-archetype-docs.mjs');
const OUT_DIR = resolve(REPO, 'dist/docs');

const VENDOR_RE = /\b(igt|pragmatic|cash[- ]?eruption|wolf[- ]?run|cleopatra|buffalo|megaways|netent|microgaming|aristocrat|reelplay|wazdan|big[- ]?time[- ]?gaming)\b/i;

after(() => {
  /* Leave the artifact in place — useful for browsing — but clean test re-runs */
});

test('UQ-15: tool exits 0 and writes both expected files', () => {
  const r = spawnSync('node', [TOOL], { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
  assert.ok(existsSync(resolve(OUT_DIR, 'archetypes.html')));
  assert.ok(existsSync(resolve(OUT_DIR, 'archetypes-meta.json')));
});

test('UQ-15: HTML is self-contained — no external link/script src', () => {
  const html = readFileSync(resolve(OUT_DIR, 'archetypes.html'), 'utf8');
  /* No CDN, no remote stylesheet, no external script */
  assert.ok(!/<link[^>]+rel=["']?stylesheet/i.test(html), 'external stylesheet leak');
  assert.ok(!/<script[^>]+src=["']/i.test(html), 'external script src leak');
});

test('UQ-15: all 28 archetype ids appear as cards', () => {
  const html = readFileSync(resolve(OUT_DIR, 'archetypes.html'), 'utf8');
  for (const a of ARCHETYPES) {
    assert.ok(html.includes(`data-id="${a.id}"`), 'archetype card missing: ' + a.id);
    assert.ok(html.includes(`>${a.id}<`) || html.includes(`>${a.id}</code>`),
      'archetype id not rendered: ' + a.id);
  }
});

test('UQ-15: aliases section appears with right entry count', () => {
  const html = readFileSync(resolve(OUT_DIR, 'archetypes.html'), 'utf8');
  assert.ok(html.includes(`${Object.keys(ARCHETYPE_ALIASES).length} synonym mappings`));
  /* Spot-check one alias */
  assert.ok(html.includes('jackpot'));
  assert.ok(html.includes('jackpot-pool'));
});

test('UQ-15: non-archetype section appears with right count', () => {
  const html = readFileSync(resolve(OUT_DIR, 'archetypes.html'), 'utf8');
  assert.ok(html.includes(`${NON_ARCHETYPE_KINDS.size} routed to null`));
  assert.ok(html.includes('bigwintier') || html.includes('big_win_tier'));
});

test('UQ-15: JSON meta mirrors catalog faithfully', () => {
  const meta = JSON.parse(readFileSync(resolve(OUT_DIR, 'archetypes-meta.json'), 'utf8'));
  assert.equal(meta.archetypeCount, ARCHETYPE_COUNT);
  assert.equal(meta.archetypes.length, ARCHETYPE_COUNT);
  assert.equal(meta.nonArchetypeKinds.length, NON_ARCHETYPE_KINDS.size);
  assert.equal(Object.keys(meta.aliases).length, Object.keys(ARCHETYPE_ALIASES).length);
  /* Spot-check shape of first archetype */
  const first = meta.archetypes[0];
  assert.ok(first.id && first.purpose && first.forceFlag && first.windowFlag);
  assert.ok(Array.isArray(first.hooks) && Array.isArray(first.examples));
});

test('UQ-15: vendor-trademark sweep over generated HTML', () => {
  const html = readFileSync(resolve(OUT_DIR, 'archetypes.html'), 'utf8');
  /* Strip the boilerplate to reduce false-positive on CSS class names etc */
  const body = html.split('<main>')[1] || html;
  assert.ok(!VENDOR_RE.test(body),
    'vendor trademark leaked into archetype docs HTML body');
});
