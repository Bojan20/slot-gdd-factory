#!/usr/bin/env node
/**
 * tools/aria-live-audit.mjs
 *
 * Wave F4 / A3 — Screen reader aria-live audit for src/blocks/*.mjs.
 *
 * Why audit, not lint?
 * --------------------
 * Slot blocks emit dynamic UI (balance ticks, win counters, FS progress,
 * regulator modals, banner reveals) via HookBus listeners + DOM mutation.
 * Screen readers need explicit `aria-live` regions to announce changes;
 * otherwise blind / low-vision players hear silence while the visible UI
 * updates around them. Lint tools can't reason about template-literal
 * HTML emit shape; this is a focused custom check.
 *
 * Compliance contract (per block that mutates DOM on a HookBus event):
 *
 *   1. ARIA-LIVE PRESENCE — any block whose runtime calls textContent /
 *      innerText / innerHTML / classList.add on user-visible nodes
 *      SHOULD declare at least one `aria-live="polite"` or
 *      `aria-live="assertive"` region in its markup OR set
 *      role="status" / role="alert" on the mutating node.
 *
 *   2. POLITE FOR ROUTINE — `aria-live="assertive"` should be reserved
 *      for safety-critical interrupts (regulator stop, session timeout,
 *      cap-hit error). Routine updates (balance tick, win counter, FS
 *      progress) must use "polite" so screen readers don't preempt.
 *
 *   3. ROLE STATUS/ALERT COVERAGE — modal/banner blocks should use
 *      role="status" (polite) or role="alert" (assertive) instead of
 *      generic divs so AT users get semantic intent.
 *
 * Default mode: REPORT-ONLY (same pattern as A2 keyboard-nav audit).
 * --fail-on-violation flips it to a CI gate once per-block fixes land.
 *
 * Senior-grade rule (rule_senior_grade_code):
 *   • Single responsibility — aria-live audit, nothing else.
 *   • 0 external deps — pure Node 22+.
 *   • Deterministic — same source → same verdict.
 *   • Vendor-neutral — no game / studio strings.
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

/* Blocks exempt because they expose no user-visible dynamic text
 * (pure CSS / pure config / pure data / pure evaluator). */
const NON_VISIBLE = new Set([
  'hookBus.mjs', 'reelEngineCSS.mjs', 'themeCSS.mjs',
  'paylines.mjs', 'paylineOverlay.mjs',
  'payAnywhereEval.mjs', 'clusterPaysEval.mjs', 'waysEval.mjs',
  'spinTempo.mjs',
  /* Engine blocks are visual but DOM-driven (canvas/SVG, no text); AT
   * users get the win/balance announce via downstream presenters
   * (winPresentation, balanceHud). */
  'reelEngine.mjs', 'hexReelEngine.mjs', 'wheelSpinEngine.mjs',
  'crashSpinEngine.mjs', 'plinkoSpinEngine.mjs', 'slingoSpinEngine.mjs',
  /* Dev / infrastructure — no a11y surface. */
  'hotReload.mjs', 'universalForcePanel.mjs',
]);

const STRICT = process.argv.includes('--warn-strict');
const FAIL_ON_VIOLATION = process.argv.includes('--fail-on-violation');

function auditFile(file) {
  const src = readFileSync(file, 'utf8');
  const fname = path.basename(file);
  const findings = { violations: [], warnings: [] };

  if (NON_VISIBLE.has(fname)) return findings;

  /* ── Detect dynamic-text surface ─────────────────────────────────────
   * A block "mutates user-visible text" if its runtime calls
   * textContent / innerText / innerHTML on a DOM node. classList.add
   * alone doesn't count (style-only change). */
  const mutatesText =
    /\.textContent\s*=/.test(src) ||
    /\.innerText\s*=/.test(src) ||
    /\.innerHTML\s*=/.test(src);
  const subscribesHookBus = /HookBus\.on\s*\(/.test(src);

  /* No dynamic text surface → nothing to audit. */
  if (!mutatesText || !subscribesHookBus) return findings;

  /* ── Rule 1: aria-live presence ─────────────────────────────────── */
  const hasAriaLive = /aria-live\s*=\s*['"](polite|assertive)['"]/.test(src);
  const hasStatusRole = /role\s*=\s*['"](status|alert)['"]/.test(src);
  if (!hasAriaLive && !hasStatusRole) {
    findings.violations.push({
      rule: 'aria-live presence',
      detail: 'block mutates textContent/innerText/innerHTML on HookBus event but declares no aria-live region or role="status|alert" — screen reader users hear silence while UI changes',
    });
  }

  /* ── Rule 2: assertive only for critical interrupts ──────────────── */
  const assertiveMatches = src.match(/aria-live\s*=\s*['"]assertive['"]/g) || [];
  const isCriticalBlock = /regulator|sessionTimeout|realityCheck|winCap|netLossIndicator/.test(fname);
  if (assertiveMatches.length > 0 && !isCriticalBlock) {
    findings.warnings.push({
      rule: 'assertive scope',
      detail: 'aria-live="assertive" used outside a known critical-interrupt block — consider downgrade to "polite" for routine updates',
    });
  }

  /* ── Rule 3: modal/banner blocks should use role status/alert ─── */
  const hasModalMarkup = /\brole\s*=\s*['"]dialog['"]/.test(src);
  const hasBannerHint = /class\s*=\s*['"][^'"]*\b(banner|toast|reveal|celebration|announce)\b/i.test(src);
  if ((hasModalMarkup || hasBannerHint) && !hasStatusRole && !hasAriaLive) {
    findings.warnings.push({
      rule: 'modal/banner role',
      detail: 'modal/banner-like block without role="status" or "alert" — AT users may not get the announcement',
    });
  }

  return findings;
}

function main() {
  console.log(C.bold(C.cyan('\n📣 Screen-reader aria-live audit — slot-gdd-factory\n')));
  console.log(C.dim('   Wave F4 / A3 pre-commit a11y gate.'));
  console.log(C.dim('   Rules: aria-live presence, assertive scope, modal/banner role.'));
  console.log(C.dim(`   Mode: ${FAIL_ON_VIOLATION || STRICT ? 'STRICT (failing gate)' : 'REPORT-ONLY (exit 0 even on violations)'}\n`));

  const files = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs')).sort();
  let scanned = 0, exempt = 0, skipped = 0, clean = 0;
  let totalViolations = 0, totalWarnings = 0;
  const offenders = [];

  for (const f of files) {
    if (NON_VISIBLE.has(f)) { exempt++; continue; }
    const findings = auditFile(path.join(BLOCKS_DIR, f));
    /* No mutate / no HookBus.on → file silently skipped (not a problem) */
    if (findings.violations.length === 0 && findings.warnings.length === 0) {
      const src = readFileSync(path.join(BLOCKS_DIR, f), 'utf8');
      const mutates = /\.textContent\s*=/.test(src) || /\.innerText\s*=/.test(src) || /\.innerHTML\s*=/.test(src);
      const subscribes = /HookBus\.on\s*\(/.test(src);
      if (mutates && subscribes) clean++;
      else skipped++;
      continue;
    }
    scanned++;
    offenders.push({ file: f, ...findings });
    totalViolations += findings.violations.length;
    totalWarnings += findings.warnings.length;
  }

  for (const o of offenders) {
    console.log(`  ${C.bold(o.file)}`);
    for (const v of o.violations) {
      console.log(`     ${C.red('✗ VIOLATION')} [${v.rule}] ${v.detail}`);
    }
    for (const w of o.warnings) {
      console.log(`     ${C.yellow('⚠ warning  ')} [${w.rule}] ${w.detail}`);
    }
  }
  console.log('');
  console.log(C.dim(`   ${exempt} exempt · ${skipped} no-text-mutate · ${clean} clean (aria-live present) · ${offenders.length} offending · ${totalViolations} violations · ${totalWarnings} warnings\n`));

  const hardCount = totalViolations + (STRICT ? totalWarnings : 0);
  if (hardCount === 0) {
    console.log(C.green(C.bold(`✅ aria-live audit clean.\n`)));
    process.exit(0);
  }
  if (FAIL_ON_VIOLATION || STRICT) {
    console.log(C.red(C.bold(`❌ aria-live audit — ${hardCount} hard issue(s).\n`)));
    process.exit(1);
  }
  console.log(C.yellow(C.bold(`⚠ aria-live audit — ${hardCount} issue(s) — REPORT ONLY (use --fail-on-violation to enforce).\n`)));
  console.log(C.dim('   Per-block aria fixes are tracked as follow-up atoms in MASTER_TODO.\n'));
  process.exit(0);
}

main();
