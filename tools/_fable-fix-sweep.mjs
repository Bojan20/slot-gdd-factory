#!/usr/bin/env node
/**
 * tools/_fable-fix-sweep.mjs
 *
 * Boki imperative (2026-06-11): "ajde neka prodje ceo slot gdd i neka
 * fiksuje sve moguce i nemoguce".
 *
 * Strategy
 * --------
 * Consume the review reports produced by `tools/_fable-full-project-audit.mjs`
 * and ask Fable to emit a unified diff patch per block. Apply, test, commit.
 * Audio block is NEVER touched (project-scoped rule).
 *
 * Resume / idempotence
 * --------------------
 * • Skips `audio.md` always.
 * • Skips blocks already committed with `fable-fix:` prefix in the latest
 *   commit message (so re-runs don't duplicate work).
 * • Writes `reports/fable-fix-sweep/status.json` for crash resume.
 * • Saves each raw patch under `reports/fable-fix-sweep/patches/<block>.patch`
 *   so failures can be inspected / hand-applied.
 *
 * Output
 * ------
 *   reports/fable-fix-sweep/status.json     — per-block result
 *   reports/fable-fix-sweep/patches/*.patch — raw unified diffs
 *   reports/fable-fix-sweep/fable-fix-sweep.md — human summary
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const BLOCKS_DIR = resolve(REPO, 'src/blocks');
const AUDIT_DIR = resolve(REPO, 'reports/fable-full-audit');
const OUT_DIR = resolve(REPO, 'reports/fable-fix-sweep');
const PATCH_DIR = resolve(OUT_DIR, 'patches');
const STATUS_JSON = resolve(OUT_DIR, 'status.json');
const SUMMARY_MD = resolve(OUT_DIR, 'fable-fix-sweep.md');
const FABLE_WRAPPER = `${process.env.HOME}/Projects/cortex/scripts/cortex-fable-ask`;

mkdirSync(PATCH_DIR, { recursive: true });

const blocks = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs')).map(f => f.replace(/\.mjs$/, '')).sort();

const status = existsSync(STATUS_JSON) ? JSON.parse(readFileSync(STATUS_JSON, 'utf8')) : {};

function execSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', ...opts });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function git(args) {
  return execSync('git', args);
}

function alreadyFixed(block) {
  const { stdout } = git(['log', '-1', '--format=%s', '--', `src/blocks/${block}.mjs`]);
  return /^fable-fix:/.test(stdout.trim());
}

function hasIssues(reportText) {
  return /ISSUE:/i.test(reportText) && !/^\s*NO ISSUES FOUND\s*$/i.test(reportText.trim());
}

function askFablePatch(block, source, report) {
  const prompt = `You are a senior engineer fixing a slot-machine block based on a code review.

AUDIO RULE (HARD): this project has a project-scoped rule that the \\"audio.mjs\\" block must NEVER be modified. If the block name is \\"audio\\", respond ONLY with \\"AUDIO BLOCK SKIPPED\\" and nothing else.

Apply every ISSUE from the review below. Emit a single unified diff patch in \\"git diff\\" format that can be applied with \\"git apply\\". Do NOT change behavior unrelated to the listed issues. Preserve existing code style. Keep the patch minimal and focused. If an issue requires changes in multiple files, include all hunks. If you cannot safely produce a patch, respond with \\"PATCH FAILED: <reason>\\".

Review findings:
\`\`\`md
${report}
\`\`\`

Source file (src/blocks/${block}.mjs):
\`\`\`js
${source}
\`\`\`

Patch (unified diff, no explanation outside the diff):
`;
  return new Promise((resolveCb) => {
    const start = Date.now();
    const proc = spawn(FABLE_WRAPPER,
      ['--log', '--task', `fix:${block}`, '--timeout', '300', '--max-tokens', '8192'],
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

function runTestsFor(block) {
  const testFile = resolve(REPO, `tests/blocks/${block}.test.mjs`);
  if (!existsSync(testFile)) return { ran: false, code: 0, stdout: '', stderr: '' };
  const r = execSync('node', [testFile], { timeout: 120000 });
  return { ran: true, ...r };
}

function stripFences(text) {
  const t = text.trim();
  if (t.startsWith('```diff')) return t.replace(/^```diff\n/, '').replace(/\n```$/, '');
  if (t.startsWith('```')) return t.replace(/^```\w*\n/, '').replace(/\n```$/, '');
  return t;
}

function notify(kind, message) {
  const notifier = `${process.env.HOME}/Projects/cortex/scripts/cortex-notify`;
  if (existsSync(notifier)) {
    spawnSync(notifier, [kind === 'critical' ? '--critical' : kind === 'done' ? '--done' : '--info', message], { stdio: 'ignore' });
  }
}

async function processBlock(block) {
  const blockFile = resolve(BLOCKS_DIR, `${block}.mjs`);
  const reportFile = resolve(AUDIT_DIR, `${block}.md`);

  if (block === 'audio') {
    status[block] = { state: 'skipped', reason: 'project-scoped audio OFF' };
    return;
  }

  if (status[block]?.state === 'committed') {
    console.log(`[${block}] already committed in this sweep, skip`);
    return;
  }

  if (alreadyFixed(block)) {
    status[block] = { state: 'already-fixed', reason: 'latest commit is fable-fix:' };
    console.log(`[${block}] already fixed in git history, skip`);
    return;
  }

  if (!existsSync(reportFile)) {
    status[block] = { state: 'pending-audit', reason: 'report not ready yet' };
    console.log(`[${block}] audit report not ready yet`);
    return;
  }

  const report = readFileSync(reportFile, 'utf8');
  if (!hasIssues(report)) {
    status[block] = { state: 'no-issues', report };
    console.log(`[${block}] no issues found`);
    return;
  }

  console.log(`[${block}] asking Fable for patch...`);
  const source = readFileSync(blockFile, 'utf8');
  const fable = await askFablePatch(block, source, report);
  const raw = fable.stdout || '';

  if (/AUDIO BLOCK SKIPPED/i.test(raw)) {
    status[block] = { state: 'skipped', reason: 'audio OFF (should not happen)', tokIn: fable.tokIn, tokOut: fable.tokOut };
    return;
  }

  if (/PATCH FAILED/i.test(raw)) {
    status[block] = { state: 'patch-failed', reason: raw.trim(), tokIn: fable.tokIn, tokOut: fable.tokOut };
    notify('warning', `Fable fix patch failed for ${block}`);
    return;
  }

  const patchText = stripFences(raw);
  const patchFile = resolve(PATCH_DIR, `${block}.patch`);
  writeFileSync(patchFile, patchText);

  // Only proceed if the block file is clean (don't clobber human edits).
  const dirty = execSync('git', ['diff', '--quiet', '--', `src/blocks/${block}.mjs`]);
  if (dirty.code !== 0) {
    status[block] = { state: 'dirty', reason: 'src/blocks/' + block + '.mjs has uncommitted human edits', tokIn: fable.tokIn, tokOut: fable.tokOut };
    notify('warning', `Fable fix skipped for ${block}: file has uncommitted edits`);
    return;
  }

  const apply = execSync('git', ['apply', '--check', patchFile]);
  if (apply.code !== 0) {
    status[block] = { state: 'patch-invalid', reason: apply.stderr || apply.stdout, tokIn: fable.tokIn, tokOut: fable.tokOut };
    notify('warning', `Fable patch for ${block} does not apply cleanly`);
    return;
  }
  const applied = execSync('git', ['apply', patchFile]);
  if (applied.code !== 0) {
    status[block] = { state: 'apply-failed', reason: applied.stderr || applied.stdout, tokIn: fable.tokIn, tokOut: fable.tokOut };
    notify('warning', `git apply failed for ${block}`);
    return;
  }

  console.log(`[${block}] patch applied, running tests...`);
  const test = runTestsFor(block);

  if (test.ran && test.code !== 0) {
    git(['checkout', '--', `src/blocks/${block}.mjs`]);
    status[block] = { state: 'test-failed', testStdout: test.stdout, testStderr: test.stderr, tokIn: fable.tokIn, tokOut: fable.tokOut };
    notify('warning', `Tests failed for ${block} after Fable patch`);
    return;
  }

  // Commit
  git(['add', `src/blocks/${block}.mjs`]);
  const commitMsg = `fable-fix: ${block} — apply senior review patch\n\nIssues addressed:\n${report.split('\\n').filter(l => l.startsWith('ISSUE:')).map(l => '- ' + l.replace('ISSUE:', '').trim()).join('\\n')}`;
  const commit = git(['commit', '-m', commitMsg]);
  if (commit.code !== 0) {
    status[block] = { state: 'commit-failed', reason: commit.stderr, tokIn: fable.tokIn, tokOut: fable.tokOut };
    notify('critical', `Commit failed for ${block}`);
    return;
  }


  status[block] = { state: 'committed', tokIn: fable.tokIn, tokOut: fable.tokOut, testRan: test.ran };
  console.log(`[${block}] ✅ committed`);
}

async function main() {
  console.log(`Fable fix sweep starting. Blocks: ${blocks.length}. Audio OFF enforced.`);
  let budgetIn = 0;
  let budgetOut = 0;
  let fixed = 0;
  let failed = 0;

  for (const block of blocks) {
    try {
      await processBlock(block);
      const s = status[block] || {};
      budgetIn += s.tokIn || 0;
      budgetOut += s.tokOut || 0;
      if (s.state === 'committed') fixed++;
      if (s.state && !['committed', 'skipped', 'no-issues', 'already-fixed', 'pending-audit'].includes(s.state)) failed++;
    } catch (e) {
      status[block] = { state: 'exception', reason: String(e) };
      failed++;
      console.error(`[${block}] exception:`, e);
    }
    writeFileSync(STATUS_JSON, JSON.stringify(status, null, 2));
  }

  const summary = `# Fable Fix Sweep Summary

| | Count |
|--|--:|
| Total blocks | ${blocks.length} |
| Committed fixes | ${fixed} |
| Skipped / no-issues / already-fixed | ${blocks.length - fixed - failed} |
| Failed / pending | ${failed} |
| Estimated tokens in | ${budgetIn.toLocaleString()} |
| Estimated tokens out | ${budgetOut.toLocaleString()} |

## Per-block status

| Block | State | Notes |
|--|:--|:--|
${blocks.map(b => `| ${b} | ${status[b]?.state || 'unknown'} | ${(status[b]?.reason || '').split('\\n')[0] || ''} |`).join('\\n')}
`;
  writeFileSync(SUMMARY_MD, summary);

  notify('done', `Fable fix sweep done: ${fixed} committed, ${failed} failed/pending`);
  console.log('Done. Summary:', SUMMARY_MD);
}

main();
