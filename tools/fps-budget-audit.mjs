#!/usr/bin/env node
/**
 * tools/fps-budget-audit.mjs
 *
 * Wave F4 / A6 — 60fps performance-budget audit for src/blocks/*.mjs.
 *
 * The slot template renders at 60fps minimum on iOS / Android Chrome —
 * which means every animation frame has a hard 16.6 ms budget. This
 * audit walks every block, finds the rAF loops + transition durations
 * + setInterval ticks, and flags shapes that risk frame drops:
 *
 *   1. RAF BUDGET MARKER — any block that calls `requestAnimationFrame`
 *      should either (a) document a `BUDGET ≤ N ms` constant near the
 *      callback OR (b) keep the callback body under ~25 lines so the
 *      reader can spot the cost. Long opaque rAF callbacks accumulate
 *      jank without warning.
 *
 *   2. TRANSITION DURATION — CSS `transition: ... Xms` declarations
 *      with X > 600 ms on a non-modal element risk feeling laggy on
 *      mobile. (Banners and modals get a free pass via class hint.)
 *
 *   3. SETINTERVAL FREQUENCY — `setInterval(..., N)` with N < 16 risks
 *      pinning the main thread. Polling helpers should use rAF.
 *
 *   4. INFINITE ANIMATION — `animation: ... infinite` without a
 *      `prefers-reduced-motion` guard burns CPU off-screen.
 *
 * Default mode: REPORT-ONLY. `--fail-on-violation` flips to gate.
 *
 * Senior-grade rule (rule_senior_grade_code):
 *   • Single responsibility — fps budget audit, nothing else.
 *   • 0 external deps — pure Node 22+.
 *   • Deterministic — same source → same verdict.
 *   • Vendor-neutral.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BLOCKS_DIR = path.join(REPO, 'src', 'blocks');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

const STRICT = process.argv.includes('--warn-strict');
const FAIL_ON_VIOLATION = process.argv.includes('--fail-on-violation');

const MAX_TRANSITION_MS = 600;
const MIN_SETINTERVAL_MS = 16;
const MAX_RAF_CALLBACK_LINES = 35;

function auditFile(file) {
  const src = readFileSync(file, 'utf8');
  const fname = path.basename(file);
  const findings = { violations: [], warnings: [] };
  const lines = src.split('\n');

  /* ── Rule 1: rAF callback budget marker / length ─────────────────── */
  const rafCallbacks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/requestAnimationFrame\s*\(\s*(\(?\s*function\b|\(?\s*\w+\s*\)?\s*=>|\w+)/);
    if (!m) continue;
    /* Inline arrow / function — try to bracket-match a few lines forward. */
    let depth = 0, started = false, len = 0;
    for (let j = i; j < Math.min(lines.length, i + 80); j++) {
      const l = lines[j];
      const opens = (l.match(/\{/g) || []).length;
      const closes = (l.match(/\}/g) || []).length;
      if (opens > 0) started = true;
      depth += opens - closes;
      len = j - i + 1;
      if (started && depth <= 0) break;
    }
    rafCallbacks.push({ line: i + 1, len });
  }
  for (const r of rafCallbacks) {
    if (r.len <= MAX_RAF_CALLBACK_LINES) continue;
    const windowSrc = lines.slice(Math.max(0, r.line - 5), r.line + r.len).join('\n');
    const hasBudgetMarker = /BUDGET|budget_ms|FRAME_MS|≤\s*\d+\s*ms|<=\s*\d+\s*ms/.test(windowSrc);
    if (!hasBudgetMarker) {
      findings.warnings.push({
        rule: 'rAF budget marker',
        detail: `${fname}:${r.line} rAF callback spans ${r.len} lines without a "BUDGET ≤ N ms" marker — cost is opaque`,
      });
    }
  }

  /* ── Rule 2: transition duration cap ─────────────────────────────── */
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/transition\s*:[^;]*?(\d+(?:\.\d+)?)\s*ms/);
    if (!m) continue;
    const ms = Number(m[1]);
    if (ms > MAX_TRANSITION_MS) {
      /* Skip if the line context looks like a banner/modal/celebration
       * (allowed long transitions for one-off reveals). */
      const ctx = lines.slice(Math.max(0, i - 8), i + 1).join(' ').toLowerCase();
      const isCeremonial = /banner|modal|reveal|celebration|toast|backdrop|big-?win/.test(ctx);
      if (isCeremonial) continue;
      findings.warnings.push({
        rule: 'transition cap',
        detail: `${fname}:${i + 1} transition ${ms}ms > ${MAX_TRANSITION_MS}ms on non-ceremonial element — may feel laggy on mobile`,
      });
    }
  }

  /* ── Rule 3: setInterval frequency floor ─────────────────────────── */
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/setInterval\s*\([^,]+,\s*(\d+)/);
    if (!m) continue;
    const ms = Number(m[1]);
    if (ms < MIN_SETINTERVAL_MS) {
      findings.violations.push({
        rule: 'setInterval floor',
        detail: `${fname}:${i + 1} setInterval at ${ms}ms < ${MIN_SETINTERVAL_MS}ms floor — use requestAnimationFrame for sub-frame work`,
      });
    }
  }

  /* ── Rule 4: infinite animation guarded by reduced-motion ────────── */
  if (/animation\s*:[^;]*\binfinite\b/.test(src)) {
    const hasRMGuard = /prefers-reduced-motion/.test(src);
    if (!hasRMGuard) {
      findings.violations.push({
        rule: 'infinite animation',
        detail: `${fname} uses "animation: ... infinite" without a prefers-reduced-motion guard — burns CPU off-screen`,
      });
    }
  }

  return findings;
}

function main() {
  console.log(C.bold(C.cyan('\n⏱  60fps budget audit — slot-gdd-factory\n')));
  console.log(C.dim('   Wave F4 / A6 pre-commit perf gate.'));
  console.log(C.dim('   Rules: rAF budget marker, transition cap, setInterval floor, infinite-anim guard.'));
  console.log(C.dim(`   Mode: ${FAIL_ON_VIOLATION || STRICT ? 'STRICT (failing gate)' : 'REPORT-ONLY (exit 0 even on violations)'}\n`));

  const files = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs')).sort();
  let totalViolations = 0, totalWarnings = 0, offending = 0, clean = 0;
  const rows = [];

  for (const f of files) {
    const findings = auditFile(path.join(BLOCKS_DIR, f));
    if (findings.violations.length === 0 && findings.warnings.length === 0) {
      clean++;
      continue;
    }
    offending++;
    rows.push({ file: f, ...findings });
    totalViolations += findings.violations.length;
    totalWarnings += findings.warnings.length;
  }

  for (const r of rows) {
    console.log(`  ${C.bold(r.file)}`);
    for (const v of r.violations) {
      console.log(`     ${C.red('✗ VIOLATION')} [${v.rule}] ${v.detail}`);
    }
    for (const w of r.warnings) {
      console.log(`     ${C.yellow('⚠ warning  ')} [${w.rule}] ${w.detail}`);
    }
  }
  console.log('');
  console.log(C.dim(`   ${files.length} blocks · ${clean} clean · ${offending} offending · ${totalViolations} violations · ${totalWarnings} warnings\n`));

  const hardCount = totalViolations + (STRICT ? totalWarnings : 0);
  if (hardCount === 0) {
    console.log(C.green(C.bold(`✅ fps budget audit clean.\n`)));
    process.exit(0);
  }
  if (FAIL_ON_VIOLATION || STRICT) {
    console.log(C.red(C.bold(`❌ fps budget audit — ${hardCount} hard issue(s).\n`)));
    process.exit(1);
  }
  console.log(C.yellow(C.bold(`⚠ fps budget audit — ${hardCount} issue(s) — REPORT ONLY (use --fail-on-violation to enforce).\n`)));
  process.exit(0);
}

main();
