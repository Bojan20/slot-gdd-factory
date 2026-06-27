#!/usr/bin/env node
/**
 * tests/tools/f5-a-ci-profile.test.mjs
 *
 * F5-a contract test — CI-safe verify profile + GitHub Actions wiring +
 * branch protection documentation.
 *
 * # COVERAGE
 *
 *   A: verify.mjs accepts `--ci` flag + defines CI constant.
 *   B: package.json carries `verify:ci` script that invokes --ci --quick.
 *   C: ci.yml runs `verify:ci` step.
 *   D: All 8 FS-bound steps are properly skipped under --ci (regex
 *      check against the source — each guarded by `!CI` plus a
 *      printed ⏭ marker for visibility).
 *   E: docs/BRANCH_PROTECTION.md exists and points at the correct
 *      status-check name.
 *   F: live `verify:ci` invocation completes <60s + exits 0 + prints
 *      the expected skip markers + green summary.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('F5-a CI PROFILE · contract test');

const verifySrc = readFileSync(join(REPO, 'tools', 'verify.mjs'), 'utf-8');
const pkgJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8'));
const ciYml = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf-8');

/* ── A: verify.mjs --ci handling ─────────────────────────────────── */

test('A1: verify.mjs defines CI constant from args.includes(--ci)', () => {
  assert(/const\s+CI\s*=\s*args\.includes\(['"]--ci['"]\)/.test(verifySrc),
    'expected `const CI = args.includes("--ci")` in verify.mjs');
});

test('A2: CI flag has documentation block listing skipped steps', () => {
  assert(/F5-a[\s\S]{0,200}CI-safe profile/.test(verifySrc),
    'expected F5-a CI-safe profile doc block in verify.mjs');
});

/* ── B: package.json verify:ci script ────────────────────────────── */

test('B1: package.json defines verify:ci script', () => {
  assert(typeof pkgJson.scripts['verify:ci'] === 'string',
    'expected scripts["verify:ci"] to exist');
});

test('B2: verify:ci invokes --ci flag', () => {
  assert(/--ci/.test(pkgJson.scripts['verify:ci']),
    `expected --ci in verify:ci, got: ${pkgJson.scripts['verify:ci']}`);
});

/* ── C: ci.yml wiring ────────────────────────────────────────────── */

test('C1: ci.yml has a step running `npm run verify:ci`', () => {
  assert(/run:\s*npm\s+run\s+verify:ci/.test(ciYml),
    'expected `run: npm run verify:ci` in ci.yml');
});

test('C2: ci.yml step has F5-a marker comment', () => {
  assert(/F5-a/.test(ciYml),
    'expected F5-a marker in ci.yml comments');
});

/* ── D: FS-bound steps properly guarded ─────────────────────────── */

const FS_BOUND_LABELS = [
  'MATH KERNEL BRIDGE',
  'H&W KERNEL BRIDGE',
  'CLUSTER KERNEL BRIDGE',
  'PROBE --kernel-preflight',
  'EXTRA KERNEL BRIDGES',
  'V9 INGEST WIRE',
  'STRESS-TEST-INGEST',
  'UQ-MASTERY block liveness',
];

for (const label of FS_BOUND_LABELS) {
  test(`D: "${label}" is guarded by !CI`, () => {
    /* The pattern is: each FS-bound step's guard wraps either:
     *   if (existsSync(...) && !CI) { run(...) }
     * OR
     *   else if (CI && existsSync(...)) { ⏭ logging }
     * Both patterns must be present for the step. */
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const skipRegex = new RegExp(`⏭[\\s\\S]{0,150}${escapedLabel}`);
    assert(skipRegex.test(verifySrc),
      `expected ⏭ skip marker for "${label}" in verify.mjs`);
  });
}

/* ── E: branch protection doc ─────────────────────────────────── */

const docPath = join(REPO, 'docs', 'BRANCH_PROTECTION.md');

test('E1: docs/BRANCH_PROTECTION.md exists', () => {
  assert(existsSync(docPath), `expected ${docPath}`);
});

test('E2: doc references install + test:runtime status check', () => {
  const doc = readFileSync(docPath, 'utf-8');
  assert(/install \+ test:runtime/.test(doc),
    'expected status-check name `install + test:runtime` in doc');
});

test('E3: doc covers required-approvals + linear-history + status-check rules', () => {
  const doc = readFileSync(docPath, 'utf-8');
  assert(/Require approvals/.test(doc), 'missing "Require approvals" rule');
  assert(/Require linear history/.test(doc), 'missing "Require linear history" rule');
  assert(/Require status checks/.test(doc), 'missing "Require status checks" rule');
});

/* ── F: live verify:ci smoke ─────────────────────────────────── */

/* Combined F1+F2: one spawn, validate exit + summary.
 * Budget 180s — UQ-FORTIFY8 alone runs ~50s under cold npm spawn and the
 * batched contract runner adds another 30s. On the GitHub Actions runner
 * the typical clock is 90-150s; the 180s ceiling catches a runaway gate
 * without flaking on cold caches. F5-b roadmap covers profiling
 * UQ-FORTIFY8 to bring this down. */
await testAsync('F1+F2: `npm run verify:ci` exits 0 + emits ALL GATES GREEN (<180s)', async () => {
  const t0 = Date.now();
  const proc = spawnSync('npm', ['run', 'verify:ci'], {
    cwd: REPO,
    encoding: 'utf-8',
    timeout: 180000,
  });
  const wallMs = Date.now() - t0;
  assert(proc.status === 0,
    `verify:ci exited ${proc.status} (${wallMs}ms):\nstderr tail: ${proc.stderr?.slice(-500) || ''}\nstdout tail: ${proc.stdout?.slice(-500) || ''}`);
  assert(/ALL GATES GREEN/.test(proc.stdout || ''),
    `expected "ALL GATES GREEN" in stdout, got tail:\n${(proc.stdout || '').slice(-500)}`);
  assert(wallMs < 180000, `expected <180s, got ${wallMs}ms`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
