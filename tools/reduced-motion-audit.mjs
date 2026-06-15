#!/usr/bin/env node
/**
 * tools/reduced-motion-audit.mjs — W47.S4 / Wave A4
 *
 * Pre-Math Roadmap Faza 4 #A4: "prefers-reduced-motion per blok".
 *
 * Walks every `src/blocks/*.mjs`. For each block that emits an
 * `animation:` rule or `@keyframes`, verifies the file ALSO carries a
 * meaningful `@media (prefers-reduced-motion: reduce)` block that
 * actually neutralises motion — not just declares the media query.
 *
 * "Meaningful" = the reduced-motion block must include AT LEAST ONE
 * concrete motion-kill directive:
 *
 *   animation: none
 *   animation-duration: 0 (or 0s / 0ms)
 *   transition: none
 *   transition-duration: 0
 *   transform: none
 *
 * A block that declares `@media (prefers-reduced-motion: reduce)` and
 * then only changes opacity / colour without killing motion fails the
 * audit — it's a paper-only compliance flag, not a real one.
 *
 * Output: per-block PASS / FAIL with the first offending pattern, plus
 * an aggregate summary. Exit 1 on any fail so CI can gate.
 *
 * Run: `node tools/reduced-motion-audit.mjs` or `npm run test:rmotion`.
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

const MOTION_KILL_PATTERNS = [
  /animation:\s*none/i,
  /animation-duration:\s*0\b/i,
  /animation-duration:\s*0\s*(s|ms)\b/i,
  /transition:\s*none/i,
  /transition-duration:\s*0\b/i,
  /transform:\s*none/i,
];

/* Brace-match the body of a `@media (...)` block starting at `mediaIdx`.
 * Returns { body, end } or null if the block is malformed. */
function extractMediaBody(source, mediaIdx) {
  const openIdx = source.indexOf('{', mediaIdx);
  if (openIdx < 0) return null;
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { body: source.slice(openIdx, i + 1), end: i };
    }
  }
  return null;
}

function auditBlock(source) {
  const hasAnimation = /\banimation:|@keyframes\b/.test(source);
  if (!hasAnimation) return { skip: true };

  /* Superior pattern: animation declared INSIDE
   * `@media (prefers-reduced-motion: no-preference)`. Reduced-motion
   * users never see the animation at all — no override needed because
   * the rule never matches. We accept this as the strongest possible
   * compliance shape and PASS the block. */
  const noPrefIdx = source.indexOf('@media (prefers-reduced-motion: no-preference)');
  if (noPrefIdx >= 0) {
    const wrap = extractMediaBody(source, noPrefIdx);
    if (wrap && /\banimation:|@keyframes\b/.test(wrap.body)) {
      /* Verify the file has NO animation outside this wrap. If there
       * IS animation outside, the no-preference shield doesn't protect
       * it and we fall through to the reduce-block check. */
      const outside = source.slice(0, noPrefIdx) +
                      source.slice(wrap.end + 1);
      if (!/\banimation:|@keyframes\b/.test(outside)) {
        return { ok: true, kill: 'no-preference wrap (superior pattern)' };
      }
    }
  }

  const mediaIdx = source.indexOf('@media (prefers-reduced-motion: reduce)');
  if (mediaIdx < 0) {
    return { ok: false, reason: 'block declares animation but no @media (prefers-reduced-motion: reduce) gate (and no no-preference wrap)' };
  }

  const wrap = extractMediaBody(source, mediaIdx);
  if (!wrap) return { ok: false, reason: 'media block missing opening brace or never closes' };

  const matched = MOTION_KILL_PATTERNS.find(re => re.test(wrap.body));
  if (!matched) {
    return {
      ok: false,
      reason: 'reduced-motion media block has no concrete motion-kill directive (animation: none / animation-duration: 0 / transition: none / transform: none)',
    };
  }
  return { ok: true, kill: matched.source };
}

async function main() {
  const entries = await readdir(BLOCKS_DIR);
  const blockFiles = entries.filter(f => f.endsWith('.mjs')).sort();

  console.log(C.bold(C.cyan('\n🎢  Reduced-motion audit (W47.S4 / Wave A4)')));
  console.log(C.dim(`   src/blocks/ × ${blockFiles.length} files\n`));

  let pass = 0, fail = 0, skip = 0;

  for (const file of blockFiles) {
    const full = resolvePath(BLOCKS_DIR, file);
    const text = await readFile(full, 'utf8');
    const result = auditBlock(text);

    if (result.skip) {
      skip++;
      console.log(`  ${C.dim('· skip')}  ${file}  ${C.dim('— no animation / keyframes')}`);
    } else if (result.ok) {
      pass++;
      console.log(`  ${C.green('✓ pass')}  ${file}  ${C.dim(`(kill: ${result.kill})`)}`);
    } else {
      fail++;
      console.log(`  ${C.red('✗ fail')}  ${file}  ${C.red(result.reason)}`);
    }
  }

  console.log('');
  console.log(C.bold('  summary:'));
  console.log(`    ${C.green('pass:')} ${pass}`);
  console.log(`    ${C.yellow('skip:')} ${skip}  ${C.dim('(no animation in block)')}`);
  console.log(`    ${fail === 0 ? C.green('fail:') : C.red('fail:')} ${fail}`);

  if (fail > 0) {
    console.log(C.red(C.bold(`\n❌ ${fail} block(s) violate A4 reduced-motion contract.\n`)));
    process.exit(1);
  }
  console.log(C.green(C.bold('\n✅ All animated blocks honor prefers-reduced-motion.\n')));
}

main().catch(err => {
  console.error(C.red(`audit failed: ${err.message}`));
  process.exit(2);
});
