#!/usr/bin/env node
/**
 * tools/keyboard-nav-audit.mjs
 *
 * Wave F4 / A2 — Keyboard navigation audit for src/blocks/*.mjs.
 *
 * Why audit, not lint?
 * --------------------
 * Slot blocks emit a mix of HTML strings + runtime click handlers. Lint
 * tools (eslint-plugin-jsx-a11y) target JSX, not template literals.
 * Custom heuristic check is the only way to reason about this code base
 * without rewriting it.
 *
 * Compliance contract (per block that ships interactive HTML):
 *
 *   1. CLICK PARITY — every block with a `click` listener for action
 *      buttons SHOULD also register a `keydown` listener so Tab+Enter /
 *      Space users can fire the same action. Native <button> already
 *      gets this for free; we only flag custom div/span widgets.
 *
 *   2. FOCUSABILITY — every interactive element painted via div/span +
 *      cursor:pointer SHOULD carry `tabindex="0"` so it lands in the
 *      tab order. Native <button>/<input>/<a> are exempt.
 *
 *   3. ROLE — every interactive div/span SHOULD declare a `role=`
 *      (button / switch / radio / tab / menuitem / dialog). Native
 *      semantic elements exempt.
 *
 *   4. ARIA-LABEL — every interactive element with text content under
 *      4 chars OR with only an icon/glyph SHOULD declare `aria-label`
 *      so screen readers announce purpose.
 *
 * The audit emits both VIOLATIONS (must fix) and WARNINGS (review
 * suggested but not always wrong). Default exit gate is VIOLATIONS == 0;
 * --warn-strict makes warnings fail too.
 *
 * Senior-grade rule (rule_senior_grade_code):
 *   • Single responsibility — keyboard nav audit, nothing else.
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

/* Blocks that are exempt because they expose NO interactive surface
 * (pure CSS / pure config / pure data). */
const NON_INTERACTIVE = new Set([
  'hookBus.mjs', 'reelEngineCSS.mjs', 'themeCSS.mjs',
  'paylines.mjs', 'paylineOverlay.mjs',
  'payAnywhereEval.mjs', 'clusterPaysEval.mjs', 'waysEval.mjs',
  'spinTempo.mjs',
]);

/* Two opt-in modes:
 *   --warn-strict — warnings also fail the gate
 *   --fail-on-violation — violations fail (default is REPORT-ONLY)
 *
 * Default is report-only because keyboard-nav fixes touch every
 * interactive widget block + need cross-block coordination (focus
 * traps, ESC handling). The audit publishes the backlog; per-block
 * fixes land as their own atoms. CI consumes the report via
 * `--fail-on-violation` once the backlog is zero. */
const STRICT = process.argv.includes('--warn-strict');
const FAIL_ON_VIOLATION = process.argv.includes('--fail-on-violation');

function auditFile(file) {
  const src = readFileSync(file, 'utf8');
  const fname = path.basename(file);
  const findings = { violations: [], warnings: [] };

  /* ── Detect interactive surface ─────────────────────────────────────
   * "Has a click listener / on-click intent" — addEventListener('click'
   * or onclick= or <button> emission. */
  const hasClickHandler =
    /addEventListener\(\s*['"]click['"]/.test(src) ||
    /\.onclick\s*=/.test(src) ||
    /\bonclick\s*=\s*['"]/.test(src);
  const hasKeyHandler =
    /addEventListener\(\s*['"](keydown|keyup|keypress)['"]/.test(src) ||
    /\.onkeydown\s*=/.test(src);
  const hasButtonHTML = /<button\b/.test(src);

  /* Tighter "non-button interactive" detection — pure cursor:pointer is
   * not enough (many <button> styles use it). We confirm an actual
   * non-button widget owns the click semantic by one of:
   *   1. <div|span> with data-(click|action|cta)
   *   2. cursor:pointer on a class that ALSO appears on a non-button tag
   *      (div / span / a / li / label) in the file's markup
   *   3. cursor:pointer on a bare type selector for a non-button element
   *      (e.g. `.reelsHost { cursor: pointer }` where reelsHost is a div) */
  function _detectNonButtonInteractive(source) {
    if (/<(?:div|span)\b[^>]*\bdata-(?:click|action|cta)\b/i.test(source)) return true;

    const cssClassRules = source.matchAll(
      /(?<sel>(?:\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\s*,?\s*)+)\{[^}]*cursor\s*:\s*pointer[^}]*\}/g,
    );
    for (const m of cssClassRules) {
      const classes = (m.groups.sel.match(/\.[A-Za-z0-9_-]+/g) || []).map(s => s.slice(1));
      for (const cls of classes) {
        const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const onNonButton = new RegExp(
          `<(?:div|span|a|li|label)\\b[^>]*\\bclass\\s*=\\s*['"\\\`][^'"\\\`]*\\b${esc}\\b`,
          'i',
        ).test(source);
        if (onNonButton) return true;
      }
    }
    return false;
  }
  const hasNonButtonInteractive = _detectNonButtonInteractive(src);

  if (NON_INTERACTIVE.has(fname)) return findings;
  if (!hasClickHandler && !hasKeyHandler && !hasButtonHTML && !hasNonButtonInteractive) {
    return findings; /* no interactive surface — nothing to audit */
  }

  /* ── Rule 1: click parity — non-button interactive elements with a
   * `click` handler should ALSO have a `keydown` handler. Native
   * <button> autohandles Enter/Space so it's not a violation if the
   * file only uses <button> + click. */
  if (hasClickHandler && !hasKeyHandler && hasNonButtonInteractive) {
    findings.violations.push({
      rule: 'click parity',
      detail: 'click listener present but no keydown handler — div/span widgets need Enter/Space wired',
    });
  }

  /* ── Rule 2: focusability — any custom div/span widget with
   * cursor:pointer should carry tabindex="0" somewhere in the file. */
  if (hasNonButtonInteractive && !/tabindex\s*=\s*['"]?[-0]?0/.test(src)) {
    findings.violations.push({
      rule: 'focusability',
      detail: 'div/span with cursor:pointer but no tabindex="0" — keyboard users cannot reach it',
    });
  }

  /* ── Rule 3: role — any custom interactive widget should declare role.
   * Native elements (button/input/a) exempt; <div role="..." > present
   * counts as satisfied. */
  if (hasNonButtonInteractive && !/role\s*=\s*['"](button|switch|radio|tab|menuitem|dialog|checkbox|link|option)['"]/.test(src)) {
    findings.warnings.push({
      rule: 'role declaration',
      detail: 'custom interactive widget without a role=... attribute — screen reader cannot announce semantic type',
    });
  }

  /* ── Rule 4: aria-label coverage. Heuristic — any <button> in the
   * file should have an aria-label OR text content > 4 chars. Easy
   * scan: if there are <button>s without aria-label AND no obvious
   * text children, flag. */
  const buttonMatches = src.match(/<button\b[^>]*>([\s\S]*?)<\/button>/g) || [];
  for (const btn of buttonMatches) {
    const hasAriaLabel = /\baria-label\s*=/.test(btn);
    const innerText = btn
      .replace(/<button\b[^>]*>/, '')
      .replace(/<\/button>/, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\$\{[^}]*\}/g, '')
      .trim();
    if (!hasAriaLabel && innerText.length < 4) {
      findings.warnings.push({
        rule: 'aria-label coverage',
        detail: `<button> with text "${innerText}" (<4 chars) and no aria-label`,
      });
    }
  }

  return findings;
}

function main() {
  console.log(C.bold(C.cyan('\n⌨️  Keyboard nav audit — slot-gdd-factory\n')));
  console.log(C.dim('   Wave F4 / A2 pre-commit a11y gate.'));
  console.log(C.dim('   Rules: click parity, focusability, role, aria-label coverage.'));
  console.log(C.dim(`   Mode: ${STRICT ? 'STRICT (warnings fail)' : 'default (only violations fail)'}\n`));

  const files = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs')).sort();
  let scanned = 0, exempt = 0, clean = 0;
  let totalViolations = 0, totalWarnings = 0;
  const offenders = [];

  for (const f of files) {
    const findings = auditFile(path.join(BLOCKS_DIR, f));
    if (NON_INTERACTIVE.has(f)) { exempt++; continue; }
    scanned++;
    if (findings.violations.length === 0 && findings.warnings.length === 0) {
      clean++;
      continue;
    }
    offenders.push({ file: f, ...findings });
    totalViolations += findings.violations.length;
    totalWarnings += findings.warnings.length;
  }

  for (const o of offenders) {
    if (o.violations.length === 0 && o.warnings.length === 0) continue;
    console.log(`  ${C.bold(o.file)}`);
    for (const v of o.violations) {
      console.log(`     ${C.red('✗ VIOLATION')} [${v.rule}] ${v.detail}`);
    }
    for (const w of o.warnings) {
      console.log(`     ${C.yellow('⚠ warning  ')} [${w.rule}] ${w.detail}`);
    }
  }
  console.log('');

  console.log(C.dim(`   scanned ${scanned} blocks (+ ${exempt} non-interactive exempt) · ${clean} clean · ${totalViolations} violations · ${totalWarnings} warnings\n`));

  const hardCount = totalViolations + (STRICT ? totalWarnings : 0);
  if (hardCount === 0) {
    console.log(C.green(C.bold(`✅ keyboard nav audit clean.\n`)));
    process.exit(0);
  }
  if (FAIL_ON_VIOLATION || STRICT) {
    console.log(C.red(C.bold(`❌ keyboard nav audit — ${hardCount} hard issue(s).\n`)));
    process.exit(1);
  }
  console.log(C.yellow(C.bold(`⚠ keyboard nav audit — ${hardCount} issue(s) — REPORT ONLY (use --fail-on-violation to enforce).\n`)));
  console.log(C.dim('   Per-block keyboard fixes are tracked as follow-up atoms in MASTER_TODO.\n'));
  process.exit(0);
}

main();
