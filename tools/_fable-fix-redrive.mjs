#!/usr/bin/env node
/**
 * tools/_fable-fix-redrive.mjs
 *
 * Re-applies Fable Wave-1 patch-invalid / patch-failed blocks using the
 * Wave-2 LLM-patch repair pipeline (`tools/_lib/patchRepair.mjs`).
 *
 * WHY THIS EXISTS
 * ---------------
 * Wave-1 sweep produced 22 `patch-invalid` entries — Opus emitted
 * unified diffs with off-by-one hunk counts that `git apply` rejects.
 * The patches themselves are saved under
 * `reports/fable-fix-sweep/patches/<block>.patch`. Re-asking Fable would
 * cost ~$3-5 per block in tokens. Instead we:
 *
 *   1. Repair the saved patch in place (hunk-count recompute + header
 *      synthesis + fence/prose strip).
 *   2. Try `git apply --check`, then `--recount --3way` as a second pass.
 *   3. On success: apply, run tests, commit. On failure: leave for the
 *      JSON-edit fallback pass.
 *
 * This is a pure repair pass — no LLM cost. The companion script
 * `_fable-fix-json-edit.mjs` (next pass) re-asks Fable for structured
 * edits ONLY on blocks this pass cannot repair.
 *
 * AUDIO RULE
 * ----------
 * `audio.mjs` is NEVER touched, mirroring `_fable-fix-sweep.mjs`.
 *
 * IDEMPOTENCE
 * -----------
 * Skips blocks already in `committed` / `skipped` / `already-fixed` /
 * `no-issues` state. Each re-applied block is recommitted with the
 * `fable-fix:` prefix so subsequent runs see it as `already-fixed`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { normalizePatch } from './_lib/patchRepair.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const PATCH_DIR = resolve(REPO, 'reports/fable-fix-sweep/patches');
const STATUS_JSON = resolve(REPO, 'reports/fable-fix-sweep/status.json');
const SUMMARY_MD = resolve(REPO, 'reports/fable-fix-sweep/fable-fix-redrive.md');

if (!existsSync(STATUS_JSON)) {
  console.error('Missing status.json — run _fable-fix-sweep.mjs first.');
  process.exit(2);
}
const status = JSON.parse(readFileSync(STATUS_JSON, 'utf8'));

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', ...opts });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function git(args) { return sh('git', args); }

function tryApply(patchPath) {
  // Strict first.
  let chk = sh('git', ['apply', '--check', patchPath]);
  if (chk.code === 0) return { mode: 'strict', ok: true };
  // Pure recount (correct context, only counts off — safest fallback).
  chk = sh('git', ['apply', '--check', '--recount', patchPath]);
  if (chk.code === 0) return { mode: 'recount', ok: true };
  // We deliberately SKIP --3way here. 3-way merge can leave the working
  // tree in an unmerged (`UU`) state when conflicts are detected during
  // `--check`'s simulated run, and that blocks every subsequent `git
  // commit` in the loop. The JSON-edit fallback pass handles these.
  return { mode: 'failed', ok: false, reason: (chk.stderr || chk.stdout || '').trim() };
}

function applyForReal(patchPath, mode) {
  const args = ['apply', patchPath];
  if (mode === 'recount') args.splice(1, 0, '--recount');
  return sh('git', args);
}

function gitStateClean() {
  // Confirm we're not sitting on unmerged paths from a prior failed apply.
  // If we are, abort the merge state before doing more work — otherwise
  // every subsequent `git commit` will refuse with "unmerged files".
  const r = sh('git', ['ls-files', '--unmerged']);
  return r.stdout.trim() === '';
}

function runTestsFor(block) {
  const testFile = resolve(REPO, `tests/blocks/${block}.test.mjs`);
  if (!existsSync(testFile)) return { ran: false, code: 0, stdout: '', stderr: '' };
  const r = sh('node', [testFile], { timeout: 120000 });
  return { ran: true, ...r };
}

const RETRIABLE_STATES = new Set([
  'patch-invalid',
  'patch-invalid-after-repair',
  'apply-failed',
  'patch-failed',
  'commit-failed-redrive',
  'test-failed-redrive',
]);

const candidates = Object.entries(status)
  .filter(([block, s]) => {
    if (block === 'audio') return false;
    if (!RETRIABLE_STATES.has(s.state)) return false;
    // Verify by checking if a saved patch file exists with real diff content.
    const p = resolve(PATCH_DIR, `${block}.patch`);
    if (!existsSync(p)) return false;
    const raw = readFileSync(p, 'utf8');
    return /@@ -\d/.test(raw);
  })
  .map(([block]) => block);

console.log(`Redrive candidates (have saved patch + non-success state): ${candidates.length}`);

const results = { repaired: 0, applied: 0, committed: 0, testFailed: 0, stillFailed: 0, dirty: 0 };
const log = [];

for (const block of candidates) {
  // Hard pre-flight: if a prior block's apply left unmerged paths around,
  // every subsequent commit will fail with "unmerged files". Bail loudly
  // so the user can clean up rather than silently emit 30 commit-fails.
  if (!gitStateClean()) {
    log.push({ block, action: 'bail-unmerged' });
    results.stillFailed++;
    break;
  }

  const blockFile = resolve(REPO, `src/blocks/${block}.mjs`);
  if (!existsSync(blockFile)) {
    log.push({ block, action: 'skip-missing-block' });
    continue;
  }

  // Don't clobber human edits.
  const dirty = sh('git', ['diff', '--quiet', '--', `src/blocks/${block}.mjs`]);
  if (dirty.code !== 0) {
    status[block] = { ...status[block], state: 'dirty', reason: 'has uncommitted human edits at redrive' };
    log.push({ block, action: 'skip-dirty' });
    results.dirty++;
    continue;
  }

  const patchPath = resolve(PATCH_DIR, `${block}.patch`);
  const raw = readFileSync(patchPath, 'utf8');
  const repaired = normalizePatch(raw, { filePath: `src/blocks/${block}.mjs` });
  const repairedPath = resolve(PATCH_DIR, `${block}.repaired.patch`);
  writeFileSync(repairedPath, repaired.patch);
  if (repaired.repaired) results.repaired++;

  const chk = tryApply(repairedPath);
  if (!chk.ok) {
    status[block] = { ...status[block], state: 'patch-invalid-after-repair', reason: chk.reason, repairNotes: repaired.notes };
    log.push({ block, action: 'still-invalid', notes: repaired.notes });
    results.stillFailed++;
    continue;
  }

  const applied = applyForReal(repairedPath, chk.mode);
  if (applied.code !== 0) {
    status[block] = { ...status[block], state: 'apply-failed', reason: (applied.stderr || applied.stdout).trim(), repairNotes: repaired.notes };
    log.push({ block, action: 'apply-fail', mode: chk.mode });
    results.stillFailed++;
    continue;
  }
  results.applied++;

  const test = runTestsFor(block);
  if (test.ran && test.code !== 0) {
    git(['checkout', '--', `src/blocks/${block}.mjs`]);
    status[block] = { ...status[block], state: 'test-failed-redrive', testStdout: test.stdout, testStderr: test.stderr, repairNotes: repaired.notes };
    log.push({ block, action: 'test-fail', mode: chk.mode });
    results.testFailed++;
    continue;
  }

  // Commit.
  git(['add', `src/blocks/${block}.mjs`]);
  const msg = `fable-fix(redrive): ${block} — repair LLM unified-diff hunk counts (${chk.mode})`;
  const commit = git(['commit', '-m', msg]);
  if (commit.code !== 0) {
    status[block] = { ...status[block], state: 'commit-failed-redrive', reason: commit.stderr || commit.stdout, repairNotes: repaired.notes };
    log.push({ block, action: 'commit-fail' });
    results.stillFailed++;
    continue;
  }

  status[block] = { state: 'committed', mode: chk.mode, repairNotes: repaired.notes, source: 'redrive' };
  log.push({ block, action: 'committed', mode: chk.mode });
  results.committed++;
}

writeFileSync(STATUS_JSON, JSON.stringify(status, null, 2));

const summary = `# Fable Fix Redrive Summary

Pure-repair pass — no LLM cost. Uses tools/_lib/patchRepair.mjs to fix
off-by-one hunk counts, synthesize headers, strip prose/fences, then
applies via git apply (with --recount / --3way fallbacks).

| Metric | Count |
|--|--:|
| Candidates with saved patch | ${candidates.length} |
| Patches that needed repair | ${results.repaired} |
| Successfully applied | ${results.applied} |
| Committed | ${results.committed} |
| Test-failed | ${results.testFailed} |
| Dirty (skipped) | ${results.dirty} |
| Still failed | ${results.stillFailed} |

## Per-block actions

| Block | Action | Mode | Notes |
|--|:--|:--|:--|
${log.map(l => `| ${l.block} | ${l.action} | ${l.mode || ''} | ${(l.notes || []).join(', ')} |`).join('\n')}
`;
writeFileSync(SUMMARY_MD, summary);

console.log(`Done. committed=${results.committed} testFailed=${results.testFailed} stillFailed=${results.stillFailed}`);
console.log(`Summary: ${SUMMARY_MD}`);
