#!/usr/bin/env node
/**
 * tests/contracts/uq-deep-b-hardening.test.mjs
 *
 * UQ-DEEP-B 2026-06-23 — Second-round paralel-agent audit hardening.
 *
 * Covers every fix from the UQ-DEEP-B audit (which found 14 NEW nalaza
 * AFTER the UQ-DEEP-A fix run, including a PLACEBO atomic-write lock):
 *
 *   CRIT-1  Double `.lock` suffix bypass    (acquireLock(outDir+'.lock') →
 *                                            real lockfile `.lock.lock`,
 *                                            mutual exclusion was placebo)
 *   CRIT-3  Orphan `*.tmp.<pid>` pile-up    (cleanupOrphanTmps([outDir])
 *                                            before atomic writes)
 *   BUG-D   100 MB plain-text DoS           (MAX_INPUT_BYTES = 5 MB guard
 *                                            on file size AND extracted len)
 *   EDGE-E  Symlink GDD path escape         (realpath + ALLOWED_INPUT_ROOTS
 *                                            assertion — SSRF analog on FS)
 *   EDGE-G  reports-gc symlink follow       (lstatSync + skip symlinks —
 *                                            statSync was reading targets)
 *
 * Each test isolates ONE invariant.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const INGEST = join(REPO, 'tools/ingest.mjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('UQ-DEEP-B · second-round hardening contract');

/* ── CRIT-1: lock filename is correct (no double `.lock`) ─────────────── */

test('CRIT-1: step 7 atomic write passes outDir (not outDir+".lock") to acquireLock', () => {
  const src = readFileSync(INGEST, 'utf8');
  /* Isolate Step 7 block, then strip JSDoc comments (they MENTION the
   * old buggy call for educational purposes — must not match). */
  const step7Idx = src.indexOf('/* Step 7: write outputs');
  assert(step7Idx > 0, 'Step 7 marker not found');
  const step7End = src.indexOf('/* Step 8', step7Idx);
  assert(step7End > step7Idx, 'Step 7 closing marker (Step 8) not found');
  let slice = src.slice(step7Idx, step7End);
  /* Strip comment lines (those starting with optional whitespace + `*`). */
  slice = slice
    .split('\n')
    .filter(line => !/^\s*\*/.test(line))
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
  const m = slice.match(/acquireLock\(([^)]+)\)/);
  assert(m, 'acquireLock not found inside Step 7 executable code');
  assert(m[1].trim() === 'outDir', `expected 'outDir' in step-7 acquireLock, got '${m[1]}'`);
});

test('CRIT-1: real lock file is .lock (single), not .lock.lock', () => {
  /* Run a quick ingest, observe lock file naming during execution
   * (lock is released before exit so we can't catch it after; instead
   * verify the path generation logic by inspecting fileLock source). */
  const fileLockSrc = readFileSync(join(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  const lockPathLine = fileLockSrc.match(/const lockPath = ([^;]+);/);
  assert(lockPathLine, 'lockPath generation not found in fileLock.mjs');
  /* fileLock concatenates `.lock`. ingest must NOT pre-concatenate. */
  assert(lockPathLine[1].includes("targetPath + '.lock'"),
    `fileLock contract changed unexpectedly: ${lockPathLine[1]}`);
});

/* ── CRIT-3: orphan tmp sweep happens before atomic writes ───────────── */

test('CRIT-3: ingest step 7 calls cleanupOrphanTmps([outDir]) before atomicWrite', () => {
  const src = readFileSync(INGEST, 'utf8');
  const step7Idx = src.indexOf('/* Step 7: write outputs');
  const step7End = src.indexOf('/* Step 8', step7Idx);
  assert(step7Idx > 0 && step7End > step7Idx, 'Step 7 block not located');
  /* Same comment-strip strategy as CRIT-1 — JSDoc educational mentions
   * of the OLD bug shape must not satisfy the order check. */
  const slice = src.slice(step7Idx, step7End)
    .split('\n')
    .filter(line => !/^\s*\*/.test(line) && !/^\s*\/\//.test(line))
    .join('\n');
  const acquireIdx = slice.indexOf('acquireLock(outDir)');
  const cleanupIdx = slice.indexOf('cleanupOrphanTmps([outDir])');
  const firstWriteIdx = slice.indexOf("atomicWrite(resolve(outDir, 'index.html')");
  assert(acquireIdx > 0, 'acquireLock(outDir) call not found in Step 7 executable code');
  assert(cleanupIdx > acquireIdx, 'cleanupOrphanTmps must come AFTER acquireLock');
  assert(firstWriteIdx > cleanupIdx, 'cleanupOrphanTmps must come BEFORE first atomicWrite');
});

/* ── BUG-D: 100 MB md / txt rejected with clear error ─────────────────── */

test('BUG-D: ingest rejects 6 MB plain-text MD (>5 MB cap)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'uq-b-dos-'));
  const big = join(tmp, 'huge.md');
  /* 6 MB is just over the 5 MB cap. Use deterministic content for
   * reproducibility. */
  writeFileSync(big, 'lorem '.repeat(1_000_000), 'utf8');
  const r = spawnSync('node', [INGEST, '--file', big, '--no-llm'], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000,
  });
  rmSync(tmp, { recursive: true, force: true });
  assert(r.status !== 0, `expected non-zero exit, got ${r.status}`);
  assert(/too large|MAX_INPUT_BYTES|DoS/i.test(r.stdout + r.stderr),
    `expected DoS guard message, got: ${(r.stdout + r.stderr).slice(0, 300)}`);
});

test('BUG-D: ingest accepts a normal-sized MD (<5 MB cap)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'uq-b-ok-'));
  const ok = join(tmp, 'ok.md');
  writeFileSync(ok, '# Reels: 5x3 rect\nSymbols: A B C\nRTP: 96.0%\n', 'utf8');
  const slug = `uq-b-ok-${Date.now()}`;
  const r = spawnSync('node', [INGEST, '--file', ok, '--slug', slug, '--no-llm'], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000,
  });
  rmSync(tmp, { recursive: true, force: true });
  try { rmSync(join(REPO, 'dist/ingest', slug), { recursive: true, force: true }); } catch { /* ignore */ }
  assert(r.status === 0 || r.status === 3, `normal-size MD should succeed, exit ${r.status}: ${r.stderr.slice(0, 200)}`);
});

/* ── EDGE-E: symlink GDD attack blocked ──────────────────────────────── */

test('EDGE-E: ingest rejects symlink pointing OUTSIDE allowed roots', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'uq-b-sym-'));
  const link = join(tmp, 'evil.pdf');
  /* Point at /etc/passwd — definitely outside ~/Desktop/GDD/. */
  try { symlinkSync('/etc/passwd', link); }
  catch (e) {
    /* If symlink creation fails (rare), skip the test gracefully. */
    rmSync(tmp, { recursive: true, force: true });
    console.log('    (symlink unavailable, skipping)');
    return;
  }
  const r = spawnSync('node', [INGEST, '--file', link, '--no-llm'], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000,
  });
  rmSync(tmp, { recursive: true, force: true });
  assert(r.status !== 0, `symlink attack should be blocked, exit ${r.status}`);
  assert(/symlink target outside allowed roots|CORTEX_INGEST_ROOTS/i.test(r.stdout + r.stderr),
    `expected allow-list message, got: ${(r.stdout + r.stderr).slice(0, 300)}`);
});

test('EDGE-E: ingest accepts symlink pointing INSIDE allowed roots', () => {
  /* A symlink inside /tmp/ (which IS allowed) → another tmp file with
   * valid content should pass the path check. */
  const tmp = mkdtempSync(join(tmpdir(), 'uq-b-sym-ok-'));
  const real = join(tmp, 'real.md');
  writeFileSync(real, '# Reels: 5x3 rect\nSymbols: A B C\nRTP: 96.0%\n', 'utf8');
  const link = join(tmp, 'link.md');
  symlinkSync(real, link);
  const slug = `uq-b-sym-ok-${Date.now()}`;
  const r = spawnSync('node', [INGEST, '--file', link, '--slug', slug, '--no-llm'], {
    cwd: REPO, encoding: 'utf8', timeout: 30_000,
  });
  rmSync(tmp, { recursive: true, force: true });
  try { rmSync(join(REPO, 'dist/ingest', slug), { recursive: true, force: true }); } catch { /* ignore */ }
  assert(r.status === 0 || r.status === 3,
    `in-bounds symlink should succeed, exit ${r.status}: ${r.stderr.slice(0, 200)}`);
});

/* ── EDGE-G: reports-gc skips symlinks (uses lstatSync) ──────────────── */

test('EDGE-G: reports-gc.mjs uses lstatSync (not statSync) for file detection', () => {
  const src = readFileSync(join(REPO, 'tools/reports-gc.mjs'), 'utf8');
  assert(src.includes('lstatSync'), 'lstatSync not imported');
  assert(/ls\.isSymbolicLink\(\)/.test(src), 'symbolic-link detection branch missing');
  /* Ensure the symlink-skip happens BEFORE the file/dir check. */
  const symIdx = src.indexOf('isSymbolicLink');
  const fileCheckIdx = src.indexOf('!ls.isFile()');
  assert(symIdx > 0 && fileCheckIdx > symIdx,
    'symlink check must happen BEFORE file-check');
});

test('EDGE-G: reports-gc DOES NOT include symlink targets in deletion plan', () => {
  /* Plant a symlink in reports/ pointing at an external file, run GC
   * dry-run, and confirm the symlink does NOT appear in the plan. */
  const reports = join(REPO, 'reports');
  const linkName = `uq-b-test-symlink-${Date.now()}.json`;
  const linkPath = join(reports, linkName);
  /* Target /etc/hosts — always exists on macOS/Linux, small, safe. */
  symlinkSync('/etc/hosts', linkPath);
  try {
    const r = spawnSync('node', [join(REPO, 'tools/reports-gc.mjs'), '--quiet'], {
      cwd: REPO, encoding: 'utf8', timeout: 15_000,
    });
    /* dry-run is exit 0; symlink should NOT appear anywhere in output. */
    assert(!r.stdout.includes(linkName) && !r.stderr.includes(linkName),
      `symlink leaked into GC plan output`);
  } finally {
    try { rmSync(linkPath, { force: true }); } catch { /* ignore */ }
  }
});

/* ── Vendor leak removed from test fixtures ──────────────────────────── */

test('Test fixtures use vendor-neutral PDF discovery (no hardcoded vendor name)', () => {
  for (const f of ['tests/contracts/v8-ingest-wire.test.mjs',
                   'tests/contracts/v9-ingest-wire.test.mjs']) {
    const src = readFileSync(join(REPO, f), 'utf8');
    /* Forbid known vendor titles per rule_no_vendor_mentions. */
    assert(!/Cash_Eruption|Gates_of_Olympus|Wrath_of_Olympus|Huff_N_More_Puff|Starlight_Travellers/i.test(src),
      `${f} still contains hardcoded vendor PDF title`);
    /* MUST use generic discovery instead. */
    assert(src.includes('pickTestPdf'), `${f} should use pickTestPdf() helper`);
  }
});

/* ── Stress test magic numbers documented ────────────────────────────── */

test('Stress test magic numbers replaced with named constants', () => {
  const src = readFileSync(join(REPO, 'tools/stress-test-ingest.mjs'), 'utf8');
  assert(src.includes('SLUG_MAX_CHARS'), 'SLUG_MAX_CHARS const missing');
  assert(src.includes('MD_FAILED_PDFS_CAP'), 'MD_FAILED_PDFS_CAP const missing');
  assert(src.includes('STDERR_SNIPPET_MAX'), 'STDERR_SNIPPET_MAX const missing');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
