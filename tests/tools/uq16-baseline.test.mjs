/**
 * tests/tools/uq16-baseline.test.mjs
 *
 * Wave UQ-16 (2026-06-21) — coverage for the visual regression baseline.
 *
 * Asserts:
 *   1. Baseline file exists and is well-formed
 *   2. Baseline covers all 338 cached slugs (or whatever the cache holds)
 *   3. Compare exits 0 on a 20-slug subset against the live build
 *   4. Compare detects a synthetic drift when we tamper with the baseline
 *   5. --report-only never exits non-zero even on drift
 */
import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');
const TOOL = resolve(REPO, 'tools/uq16-baseline.mjs');
const BASELINE = resolve(REPO, 'tests/baselines/uq16-render-baseline.json');

function run(args) {
  return spawnSync('node', [TOOL, ...args], { encoding: 'utf8', cwd: REPO });
}

test('UQ-16: baseline file exists and is well-formed JSON', () => {
  assert.ok(existsSync(BASELINE), 'baseline missing — run `node tools/uq16-baseline.mjs --bake`');
  const j = JSON.parse(readFileSync(BASELINE, 'utf8'));
  assert.ok(j.generatedAt);
  assert.ok(j.prints && typeof j.prints === 'object');
  assert.ok(Object.keys(j.prints).length > 100, 'baseline too small — should be near 338');
  /* spot-check one fingerprint shape */
  const first = Object.values(j.prints)[0];
  assert.ok(first.slug);
  assert.ok(Number.isFinite(first.htmlBytes100));
  assert.ok(/^[a-f0-9]{16}$/.test(first.htmlSha), 'htmlSha not 16 hex chars: ' + first.htmlSha);
  assert.ok(Array.isArray(first.archetypeBackfillIds));
  assert.ok(Array.isArray(first.autofixedKeys));
  assert.ok(Array.isArray(first.derivedKeys));
});

test('UQ-16: compare exits 0 on 20-slug subset matching current build', () => {
  const r = run(['--limit', '20']);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr + '\nstdout: ' + r.stdout);
  assert.ok(/all 20 fingerprints match baseline/.test(r.stdout));
});

test('UQ-16: compare detects synthetic drift when baseline is tampered', () => {
  /* Back up baseline, mutate one slug's htmlSha to a wrong value, then
     verify compare exits 1. Restore at end. */
  const backup = BASELINE + '.bak-uq16test';
  copyFileSync(BASELINE, backup);
  try {
    const j = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const firstSlug = Object.keys(j.prints).slice(0, 20).pop();
    j.prints[firstSlug].htmlSha = '0000000000000000';
    writeFileSync(BASELINE, JSON.stringify(j));
    const r = run(['--limit', '20']);
    assert.equal(r.status, 1, 'expected exit 1 on synthetic drift, got ' + r.status);
    assert.ok(/drift/i.test(r.stdout) || /drift/i.test(r.stderr),
      'no drift report in output');
  } finally {
    copyFileSync(backup, BASELINE);
    unlinkSync(backup);
  }
});

test('UQ-16: --report-only does NOT exit non-zero on drift', () => {
  const backup = BASELINE + '.bak-uq16test2';
  copyFileSync(BASELINE, backup);
  try {
    const j = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const firstSlug = Object.keys(j.prints).slice(0, 20).pop();
    j.prints[firstSlug].htmlSha = 'deadbeefdeadbeef';
    writeFileSync(BASELINE, JSON.stringify(j));
    const r = run(['--limit', '20', '--report-only']);
    assert.equal(r.status, 0, '--report-only should suppress non-zero exit');
  } finally {
    copyFileSync(backup, BASELINE);
    unlinkSync(backup);
  }
});
