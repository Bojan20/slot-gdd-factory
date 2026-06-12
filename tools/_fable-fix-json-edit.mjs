#!/usr/bin/env node
/**
 * tools/_fable-fix-json-edit.mjs
 *
 * Final pass of the Fable Fix Sweep — JSON-edit fallback.
 *
 * WHY
 * ---
 * `_fable-fix-redrive.mjs` already repairs Wave-1 unified diffs that
 * were merely malformed (off-by-one hunk counts etc.). What remains:
 *
 *   • patch-invalid-after-repair (16 blocks): the diff body's context
 *     lines don't match the current source — Opus was reasoning over a
 *     stale snapshot, no amount of normalization will make `git apply`
 *     accept the patch.
 *
 *   • test-failed-redrive (8 blocks): the patch applied cleanly but
 *     per-block tests regressed. Two root causes — (a) the patch is
 *     wrong, (b) the test expectation pre-dates the new behavior. We
 *     re-ask Fable to produce minimal edits AND a matching test patch
 *     when relevant.
 *
 * Both classes need a fresh prompt over the CURRENT source. Unified
 * diff is fragile — we ask for STRUCTURED EDITS (JSON) instead:
 *
 *   {
 *     "edits": [
 *       { "file": "src/blocks/X.mjs", "old": "exact substring", "new": "replacement" },
 *       ...
 *     ]
 *   }
 *
 * Each edit is applied via exact-string `String.replace` — no hunk
 * arithmetic, no context-fuzz, no header synthesis. If `old` appears
 * exactly once in the file, the edit is unambiguous; if zero or >1,
 * we reject the edit and log.
 *
 * AUDIO RULE
 * ----------
 * `audio.mjs` is hard-skipped, mirroring the rest of the sweep.
 *
 * IDEMPOTENCE
 * -----------
 * Already-committed and dirty blocks are skipped. Tests run after
 * apply; on failure the block file is reset and the block lands in
 * `test-failed-json-edit` state for human review.
 *
 * COST
 * ----
 * ~$0.10 per block × 24 = ~$2.50 worst case. Pulled from the same
 * Fable wrapper used by Wave 1 (Opus 4.8 CLI today; Fable 5 REST after
 * 2026-06-23).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

import { extractEditsJson } from './_lib/patchRepair.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const BLOCKS_DIR = resolve(REPO, 'src/blocks');
const AUDIT_DIR = resolve(REPO, 'reports/fable-full-audit');
const STATUS_JSON = resolve(REPO, 'reports/fable-fix-sweep/status.json');
const SUMMARY_MD = resolve(REPO, 'reports/fable-fix-sweep/fable-fix-json-edit.md');
const FABLE_WRAPPER = `${process.env.HOME}/Projects/cortex/scripts/cortex-fable-ask`;

const RETRIABLE_STATES = new Set([
  'patch-invalid-after-repair',
  'test-failed-redrive',
  'test-failed',
  'apply-failed',
]);

const status = existsSync(STATUS_JSON) ? JSON.parse(readFileSync(STATUS_JSON, 'utf8')) : {};

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', ...opts });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function git(args) { return sh('git', args); }

function askFableJsonEdits(block, source, report) {
  const prompt = `You are a senior engineer fixing a slot-machine block.

A previous attempt to apply unified-diff patches FAILED because the model
generated patches over a stale source snapshot. To eliminate that failure
mode, you are now asked for STRUCTURED EDITS as JSON, against the CURRENT
source below.

HARD RULES
----------
1. AUDIO BLOCK SKIP: this project forbids edits to audio.mjs. If the block
   name is "audio", reply with exactly "AUDIO BLOCK SKIPPED" and nothing else.
2. NO VENDOR NAMES: never mention IGT, Pragmatic, NetEnt, Megaways, Cleopatra,
   Buffalo, Wolf Run, Cash Eruption, etc. Use vendor-neutral language ONLY.
3. MINIMAL EDITS: address every review ISSUE but never refactor unrelated code.
   Preserve existing names, indentation, and style.

OUTPUT FORMAT (strict)
----------------------
Return a single JSON object wrapped in a \`\`\`json fenced block, exactly:

\`\`\`json
{
  "edits": [
    {
      "file": "src/blocks/${block}.mjs",
      "old": "EXACT substring currently in the file",
      "new": "REPLACEMENT substring"
    },
    ...
  ]
}
\`\`\`

For each edit:
  - "old" MUST appear EXACTLY ONCE in the current file (verbatim, including
    indentation and surrounding context). If you need a longer "old" to
    disambiguate, include surrounding context.
  - "new" replaces "old" entirely. Do not include diff markers.
  - You may emit additional edits against test files
    ("file": "tests/blocks/${block}.test.mjs") if a test expectation must
    be updated to match the corrected behavior. Tests are optional.

If no safe minimal edits exist (every review issue is already implemented),
reply exactly "PATCH FAILED: already fixed" and nothing else.

REVIEW FINDINGS
---------------
\`\`\`md
${report}
\`\`\`

CURRENT SOURCE (src/blocks/${block}.mjs)
----------------------------------------
\`\`\`js
${source}
\`\`\`

Now emit the JSON edits (or PATCH FAILED):
`;
  return new Promise((resolveCb) => {
    const start = Date.now();
    const proc = spawn(FABLE_WRAPPER,
      ['--log', '--task', `json-edit:${block}`, '--timeout', '300', '--max-tokens', '8192'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      const ms = Date.now() - start;
      const match = stderr.match(/in=(\d+)\s+out=(\d+)/);
      const tokIn = match ? parseInt(match[1], 10) : 0;
      const tokOut = match ? parseInt(match[2], 10) : 0;
      resolveCb({ code, stdout, stderr, ms, tokIn, tokOut });
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function applyJsonEdits(edits) {
  // Group by file so we touch each file once.
  const byFile = new Map();
  for (const e of edits) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  const touched = [];
  const failures = [];
  for (const [file, list] of byFile.entries()) {
    const abs = resolve(REPO, file);
    if (!existsSync(abs)) { failures.push({ file, reason: 'file-not-found' }); continue; }
    let content = readFileSync(abs, 'utf8');
    let appliedThisFile = 0;
    for (const e of list) {
      const occurrences = content.split(e.old).length - 1;
      if (occurrences === 0) {
        failures.push({ file, reason: 'old-not-found', old: e.old.slice(0, 60) });
        continue;
      }
      if (occurrences > 1) {
        failures.push({ file, reason: `old-ambiguous-${occurrences}x`, old: e.old.slice(0, 60) });
        continue;
      }
      content = content.replace(e.old, e.new);
      appliedThisFile++;
    }
    if (appliedThisFile > 0) {
      writeFileSync(abs, content);
      touched.push({ file, applied: appliedThisFile });
    }
  }
  return { touched, failures };
}

function runTestsFor(block) {
  const testFile = resolve(REPO, `tests/blocks/${block}.test.mjs`);
  if (!existsSync(testFile)) return { ran: false, code: 0, stdout: '', stderr: '' };
  const r = sh('node', [testFile], { timeout: 120000 });
  return { ran: true, ...r };
}

async function processBlock(block) {
  const blockFile = resolve(BLOCKS_DIR, `${block}.mjs`);
  const reportFile = resolve(AUDIT_DIR, `${block}.md`);
  if (block === 'audio') return { state: 'skipped', reason: 'audio OFF' };
  if (!existsSync(blockFile) || !existsSync(reportFile)) {
    return { state: 'missing-input', reason: 'block or audit report missing' };
  }
  const dirty = sh('git', ['diff', '--quiet', '--', `src/blocks/${block}.mjs`]);
  if (dirty.code !== 0) return { state: 'dirty', reason: 'has uncommitted human edits at json-edit pass' };

  const source = readFileSync(blockFile, 'utf8');
  const report = readFileSync(reportFile, 'utf8');
  console.log(`[${block}] asking Fable for JSON edits...`);
  const fable = await askFableJsonEdits(block, source, report);
  const raw = fable.stdout || '';

  if (/^AUDIO BLOCK SKIPPED\s*$/m.test(raw)) {
    return { state: 'skipped', reason: 'audio (should not happen)', tokIn: fable.tokIn, tokOut: fable.tokOut };
  }
  if (/^PATCH FAILED/m.test(raw)) {
    return { state: 'already-fixed-json-edit', reason: raw.trim().slice(0, 400), tokIn: fable.tokIn, tokOut: fable.tokOut };
  }

  const parsed = extractEditsJson(raw);
  if (!parsed.ok) {
    return { state: 'json-parse-failed', reason: parsed.reason, tokIn: fable.tokIn, tokOut: fable.tokOut };
  }

  const apply = applyJsonEdits(parsed.edits);
  if (apply.failures.length > 0 && apply.touched.length === 0) {
    return {
      state: 'json-edits-not-applicable',
      reason: `${apply.failures.length} edits unmatched`,
      failures: apply.failures.slice(0, 5),
      tokIn: fable.tokIn,
      tokOut: fable.tokOut,
    };
  }

  // Tests run on the block file.
  const test = runTestsFor(block);
  if (test.ran && test.code !== 0) {
    // Revert all touched files and bail.
    for (const t of apply.touched) git(['checkout', '--', t.file]);
    return {
      state: 'test-failed-json-edit',
      testStderr: test.stderr.slice(0, 400),
      testStdout: test.stdout.slice(-1200),
      tokIn: fable.tokIn,
      tokOut: fable.tokOut,
    };
  }

  // Commit.
  for (const t of apply.touched) git(['add', t.file]);
  const commit = git(['commit', '-m', `fable-fix(json-edit): ${block} — apply structured JSON edits (no unified-diff)`]);
  if (commit.code !== 0) {
    for (const t of apply.touched) git(['checkout', '--', t.file]);
    return { state: 'commit-failed-json-edit', reason: (commit.stderr || commit.stdout).slice(0, 400), tokIn: fable.tokIn, tokOut: fable.tokOut };
  }
  return {
    state: 'committed-json-edit',
    touched: apply.touched.map((t) => t.file),
    partialFailures: apply.failures,
    tokIn: fable.tokIn,
    tokOut: fable.tokOut,
  };
}

const candidates = Object.entries(status)
  .filter(([b, s]) => b !== 'audio' && RETRIABLE_STATES.has(s.state))
  .map(([b]) => b);

console.log(`JSON-edit candidates: ${candidates.length}`);

const results = { committed: 0, alreadyFixed: 0, testFailed: 0, parseFailed: 0, dirty: 0, skipped: 0, other: 0 };
const log = [];
let tokIn = 0, tokOut = 0;

for (const block of candidates) {
  // eslint-disable-next-line no-await-in-loop
  const r = await processBlock(block);
  status[block] = { ...(status[block] || {}), ...r };
  tokIn += r.tokIn || 0;
  tokOut += r.tokOut || 0;
  if (r.state === 'committed-json-edit') results.committed++;
  else if (r.state === 'already-fixed-json-edit') results.alreadyFixed++;
  else if (r.state === 'test-failed-json-edit') results.testFailed++;
  else if (r.state === 'json-parse-failed' || r.state === 'json-edits-not-applicable') results.parseFailed++;
  else if (r.state === 'dirty') results.dirty++;
  else if (r.state === 'skipped') results.skipped++;
  else results.other++;
  log.push({ block, state: r.state, reason: (r.reason || '').slice(0, 120) });
  writeFileSync(STATUS_JSON, JSON.stringify(status, null, 2));
  console.log(`[${block}] → ${r.state}`);
}

const summary = `# Fable Fix Sweep — JSON Edit Pass Summary

Re-asked Fable for STRUCTURED EDITS (JSON) instead of unified diff for
blocks where the Wave-2 normalizer could not save the original patch.
Each edit is an exact-substring replace — no hunk arithmetic, no context
fuzz, fail-loud on ambiguity.

| Metric | Count |
|--|--:|
| Candidates | ${candidates.length} |
| Committed via JSON edits | ${results.committed} |
| Already-fixed (declared by Fable) | ${results.alreadyFixed} |
| Test-failed after apply | ${results.testFailed} |
| JSON parse failed / edits not applicable | ${results.parseFailed} |
| Dirty (skipped) | ${results.dirty} |
| Other / skipped | ${results.skipped + results.other} |
| Tokens in | ${tokIn.toLocaleString()} |
| Tokens out | ${tokOut.toLocaleString()} |

## Per-block outcome

| Block | State | Notes |
|--|:--|:--|
${log.map((l) => `| ${l.block} | ${l.state} | ${l.reason || ''} |`).join('\n')}
`;
writeFileSync(SUMMARY_MD, summary);

console.log(`Done. committed=${results.committed} alreadyFixed=${results.alreadyFixed} testFailed=${results.testFailed} parseFailed=${results.parseFailed}`);
console.log(`Summary: ${SUMMARY_MD}`);
