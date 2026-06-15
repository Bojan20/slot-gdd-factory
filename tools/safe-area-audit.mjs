#!/usr/bin/env node
/**
 * tools/safe-area-audit.mjs — W47.S8 / Wave A9
 *
 * Pre-Math Roadmap Faza 4 #A9: "Safe-area + notch — env(safe-area-inset-*)
 * na svim edge UI — iOS sim screenshot".
 *
 * Audits every `src/blocks/*.mjs` that emits a `position: fixed` rule.
 * For each fixed-pos rule, finds the edge anchors (top / bottom / left /
 * right) and verifies they are wrapped in either:
 *
 *   max(<fallback>, env(safe-area-inset-<side>, <fallback>))
 *
 * or use calc()/max() in any composition that references
 * `env(safe-area-inset-*)`. A pure numeric anchor (top: 18px) on a
 * fixed-positioned element is a notch / home-bar collision risk on
 * modern iPhones, Android punch-hole displays, and any device with a
 * non-rectangular visible viewport.
 *
 * Skip rules (legitimate exemptions):
 *   - Centred overlays whose ONLY edge anchor is `top: 50%` AND
 *     `transform: translate(-50%, -50%)` — they pin to viewport centre,
 *     not an edge, so safe-area is irrelevant.
 *   - Full-bleed overlays with `inset: 0` — they cover the whole screen
 *     including the safe area on purpose (modal backdrops).
 *
 * Output: per-block PASS / SKIP / FAIL with the first offending anchor.
 *
 * Exit codes
 * ----------
 *   0   all fixed-pos blocks comply (or are legitimately exempt).
 *   1   at least one block has an unsafe edge anchor.
 *   2   tool-internal error.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const BLOCKS_DIR = resolvePath(REPO_ROOT, 'src/blocks');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

/* Match a single CSS rule body that contains `position: fixed`. We
 * brace-match from the next `{` after the selector list back to the
 * matching `}`. The text before `{` is the selector list which we
 * keep so the finding is human-meaningful. */
function findFixedRules(source) {
  const rules = [];
  const re = /position\s*:\s*fixed/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    /* Walk backward to find the opening `{` of THIS rule body. */
    let braceOpen = m.index;
    while (braceOpen > 0 && source[braceOpen] !== '{') braceOpen--;
    if (braceOpen <= 0) continue;
    let braceClose = -1;
    let depth = 0;
    for (let i = braceOpen; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) { braceClose = i; break; }
      }
    }
    if (braceClose < 0) continue;
    /* Selector list = the text between previous `}` (or start of CSS
     * literal) and braceOpen. */
    let selStart = braceOpen - 1;
    while (selStart > 0 && source[selStart] !== '}' && source[selStart] !== '`') selStart--;
    const selector = source.slice(selStart + 1, braceOpen).trim().replace(/\s+/g, ' ').slice(-80);
    const body = source.slice(braceOpen + 1, braceClose);
    rules.push({ selector, body });
  }
  return rules;
}

const SIDES = ['top', 'bottom', 'left', 'right'];

/* True if `value` already references env(safe-area-inset-*). */
function isSafe(value) {
  return /env\(\s*safe-area-inset-(top|bottom|left|right)\s*[,)]/i.test(value);
}

/* Extract the first numeric value of a given side from the rule body. */
function getAnchor(body, side) {
  const re = new RegExp(`(?:^|[\\s;])${side}\\s*:\\s*([^;]+?)(?:;|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function isCentered(body) {
  /* Modal pattern: top:50% + left:50% + transform: translate(-50%, -50%). */
  const top = getAnchor(body, 'top') || '';
  const left = getAnchor(body, 'left') || '';
  if (!/^50%/.test(top) || !/^50%/.test(left)) return false;
  return /transform\s*:\s*[^;]*translate\s*\(\s*-50%\s*,\s*-50%/.test(body);
}

function isFullBleed(body) {
  /* `inset: 0` or all 4 sides explicitly at 0. */
  if (/inset\s*:\s*0\b/.test(body)) return true;
  return SIDES.every(s => {
    const v = getAnchor(body, s);
    return v !== null && /^0(?:px|rem|em)?\b/.test(v);
  });
}

function auditRule(rule) {
  const body = rule.body;
  if (isCentered(body)) return { kind: 'skip', reason: 'centered overlay' };
  if (isFullBleed(body)) return { kind: 'skip', reason: 'full-bleed backdrop' };
  /* Each side anchor that's set must reference safe-area-inset OR be
   * a non-numeric percentage / auto. Pure numeric (px / rem / em / vh)
   * is a violation. */
  const violations = [];
  for (const side of SIDES) {
    const v = getAnchor(body, side);
    if (!v) continue;
    /* Allow `auto`. Allow percentages > 0 (they scale with viewport). */
    if (/^auto\b/.test(v)) continue;
    if (/^\d+(\.\d+)?%/.test(v) && !/^0%/.test(v)) continue;
    if (isSafe(v)) continue;
    /* Pure numeric → violation. */
    if (/^\d+(\.\d+)?(px|rem|em|vh|vw)\b/.test(v)) {
      violations.push({ side, value: v });
    }
  }
  if (violations.length === 0) return { kind: 'pass' };
  return { kind: 'fail', violations };
}

async function main() {
  const entries = await readdir(BLOCKS_DIR);
  const blockFiles = entries.filter(f => f.endsWith('.mjs')).sort();

  console.log(C.bold(C.cyan('\n📱  Safe-area + notch audit (W47.S8 / Wave A9)')));
  console.log(C.dim(`   src/blocks/ × ${blockFiles.length} files\n`));

  let pass = 0, fail = 0, skip = 0, noFixed = 0;
  const failByBlock = {};

  for (const file of blockFiles) {
    const full = resolvePath(BLOCKS_DIR, file);
    const text = await readFile(full, 'utf8');
    const rules = findFixedRules(text);
    if (rules.length === 0) { noFixed++; continue; }

    let blockPass = 0, blockSkip = 0, blockFail = 0;
    const blockViolations = [];
    for (const r of rules) {
      const res = auditRule(r);
      if (res.kind === 'pass') blockPass++;
      else if (res.kind === 'skip') blockSkip++;
      else {
        blockFail++;
        blockViolations.push({ selector: r.selector, ...res });
      }
    }
    if (blockFail === 0) {
      pass++;
      console.log(`  ${C.green('✓ pass')}  ${file.padEnd(36)} ${C.dim(`(${blockPass} fixed rules, ${blockSkip} centered/full-bleed)`)}`);
    } else {
      fail++;
      failByBlock[file] = blockViolations;
      console.log(`  ${C.red('✗ fail')}  ${file.padEnd(36)} ${C.red(`${blockFail} unsafe rule(s)`)}`);
      for (const v of blockViolations.slice(0, 2)) {
        for (const x of v.violations.slice(0, 2)) {
          console.log(C.dim(`        - ${v.selector}  ${x.side}: ${x.value}`));
        }
      }
    }
    skip += blockSkip;
  }

  console.log('');
  console.log(C.bold('  summary:'));
  console.log(`    ${C.green('pass:')} ${pass}  ${C.dim(`(${noFixed} blocks have no fixed-pos rules)`)}`);
  console.log(`    ${C.yellow('skip:')} ${skip}  ${C.dim('(centered overlays / full-bleed backdrops)')}`);
  console.log(`    ${fail === 0 ? C.green('fail:') : C.red('fail:')} ${fail}`);

  if (fail > 0) {
    console.log(C.red(C.bold(`\n❌ ${fail} block(s) have unsafe edge anchors.\n`)));
    process.exit(1);
  }
  console.log(C.green(C.bold('\n✅ All edge-anchored fixed-pos rules honor safe-area-inset.\n')));
}

main().catch(err => {
  console.error(C.red(`audit failed: ${err && err.stack || err}`));
  process.exit(2);
});
