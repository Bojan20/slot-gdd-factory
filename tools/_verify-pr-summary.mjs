#!/usr/bin/env node
/**
 * tools/_verify-pr-summary.mjs
 *
 * F5-c (Boki 2026-06-27 "nastavi do kraja ultimativno") — verify report
 * → GitHub-flavored Markdown summary. Consumed by ci.yml in two places:
 *
 *   1. GITHUB_STEP_SUMMARY block (always emitted, success or fail).
 *   2. PR comment via `gh pr comment` (PR events only).
 *
 * # USAGE
 *
 *   node tools/verify.mjs --json --quick > /tmp/verify.json
 *   node tools/_verify-pr-summary.mjs --in /tmp/verify.json
 *
 *   # Read from stdin:
 *   node tools/verify.mjs --json --quick | node tools/_verify-pr-summary.mjs
 *
 *   # Compact form (collapsed details block):
 *   node tools/_verify-pr-summary.mjs --in /tmp/verify.json --compact
 *
 * # INPUT
 *
 *   verify --json output:
 *     {
 *       runAt: ISOString,
 *       overall: 'pass' | 'fail',
 *       results: [
 *         { label, ok, exit, durationS, skipped?, stderr?, stdout? },
 *         ...
 *       ]
 *     }
 *
 * # OUTPUT (stdout)
 *
 *   GitHub-flavored Markdown:
 *
 *     ## ✅ verify gate · PASS
 *
 *     | metric | value |
 *     |:--|:--|
 *     | ran at      | 2026-06-27T18:30:00Z |
 *     | total steps | 72 |
 *     | passed      | 67 |
 *     | skipped     | 5 |
 *     | failed      | 0 |
 *     | wallclock   | 125.4s |
 *     | longest     | UQ-FORTIFY8 eighth-tier (56.0s) |
 *
 *     <details><summary>per-step breakdown</summary>
 *     | step | status | duration |
 *     | ...  |        |          |
 *     </details>
 *
 *   On fail: top of report lists the failed steps with tailored
 *   stderr/stdout tails so the PR comment is immediately actionable.
 */

import { readFileSync } from 'node:fs';
import { argv, stdin } from 'node:process';

function parseArgs(args) {
  const out = { in: null, compact: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--in') out.in = args[++i];
    else if (a === '--compact') out.compact = true;
  }
  return out;
}

async function readInput(path) {
  if (path) return readFileSync(path, 'utf-8');
  /* Read stdin to EOF. */
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

export function renderSummary(verifyJson, opts = {}) {
  const { results = [], overall = 'unknown', runAt = '' } = verifyJson;
  const total = results.length;
  const failed = results.filter((r) => r.ok === false && !r.skipped);
  const skipped = results.filter((r) => r.skipped === true || r.exit === -1);
  const passed = total - failed.length - skipped.length;
  const wallS = results.reduce((s, r) => s + (r.durationS || 0), 0);
  const sorted = [...results].sort((a, b) => (b.durationS || 0) - (a.durationS || 0));
  const longest = sorted[0];

  const status = overall === 'pass' ? '✅' : '❌';
  const lines = [];
  lines.push(`## ${status} verify gate · ${overall.toUpperCase()}`);
  lines.push('');
  lines.push('| metric | value |');
  lines.push('|:--|:--|');
  lines.push(`| ran at      | \`${runAt || '—'}\` |`);
  lines.push(`| total steps | ${total} |`);
  lines.push(`| ✅ passed   | ${passed} |`);
  lines.push(`| ⏭ skipped   | ${skipped.length} |`);
  lines.push(`| ❌ failed   | ${failed.length} |`);
  lines.push(`| wallclock   | ${wallS.toFixed(1)}s |`);
  if (longest) {
    lines.push(`| longest     | ${escapePipe(longest.label)} (${(longest.durationS || 0).toFixed(1)}s) |`);
  }
  lines.push('');

  if (failed.length > 0) {
    lines.push('### ❌ failed steps');
    lines.push('');
    for (const f of failed) {
      lines.push(`#### \`${escapePipe(f.label)}\` — exit ${f.exit}`);
      lines.push('');
      const stderrTail = (f.stderr || '').split('\n').slice(-10).join('\n').trim();
      const stdoutTail = (f.stdout || '').split('\n').slice(-10).join('\n').trim();
      if (stderrTail) {
        lines.push('<details><summary>stderr (last 10 lines)</summary>');
        lines.push('');
        lines.push('```');
        lines.push(stderrTail);
        lines.push('```');
        lines.push('');
        lines.push('</details>');
      }
      if (stdoutTail) {
        lines.push('<details><summary>stdout (last 10 lines)</summary>');
        lines.push('');
        lines.push('```');
        lines.push(stdoutTail);
        lines.push('```');
        lines.push('');
        lines.push('</details>');
      }
      lines.push('');
    }
  }

  /* Per-step table — collapsed by default in compact mode. */
  if (opts.compact) {
    lines.push('<details><summary>per-step breakdown</summary>');
    lines.push('');
  } else {
    lines.push('### per-step breakdown');
    lines.push('');
  }
  lines.push('| step | status | duration |');
  lines.push('|:--|:-:|:-:|');
  for (const r of results) {
    let icon = '✅';
    if (r.skipped) icon = '⏭';
    else if (!r.ok) icon = '❌';
    lines.push(`| ${escapePipe(r.label)} | ${icon} | ${(r.durationS || 0).toFixed(1)}s |`);
  }
  if (opts.compact) {
    lines.push('');
    lines.push('</details>');
  }
  lines.push('');
  lines.push(`<sub>Generated by \`tools/_verify-pr-summary.mjs\` · F5-c</sub>`);

  return lines.join('\n') + '\n';
}

function escapePipe(s) {
  return String(s).replace(/\|/g, '\\|');
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  let raw;
  try {
    raw = await readInput(opts.in);
  } catch (e) {
    console.error(`FATAL: cannot read input: ${e.message}`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`FATAL: input is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  process.stdout.write(renderSummary(parsed, { compact: opts.compact }));
}

const __isCliEntry = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; }
  catch { return false; }
})();

if (__isCliEntry) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(2);
  });
}
