#!/usr/bin/env node
/**
 * tests/blocks/_no-muddy-cell.test.mjs
 *
 * Build-time muddy-cell lint (Wave 1 of the senior spin-quality plan).
 *
 * INVARIANT: during a spin (`.is-spinning`, `.is-blurring`,
 * `.is-stopping`, or any reel state where the cell is in motion), the
 * cell layer MUST NOT carry `filter: blur(...)` with a non-zero radius,
 * `filter: brightness(...)` < 1.0, or `opacity < 1`. Motion legibility
 * comes from a SIBLING `::after` / `::before` overlay on the column,
 * never from a transform applied to the glyph itself.
 *
 * Why a build-time scan and not a Puppeteer probe?
 *   • Sub-millisecond, deterministic.
 *   • Catches the regression at PR time, not at runtime.
 *   • Survives engine refactors — only the CSS string format matters.
 *
 * v7 (commit a0bce12's predecessor) shipped `filter: blur(4.5px)
 * brightness(0.88)` on `.cell.is-blurring` — muddy + dim spin. v8
 * killed it but hex re-introduced the same anti-pattern with
 * `.hex-reel-col.is-spinning .hex-reel-strip { filter: blur(0.4px); }`.
 * This lint catches BOTH.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;
const BLOCKS_DIR = join(REPO, 'src/blocks');

const MOTION_STATES = ['is-spinning', 'is-blurring', 'is-stopping', 'is-streaking'];
const CELL_SELECTORS = ['.cell', '.hex-reel-strip', '.reel-strip', '.cell.hex', '.cell-wrap'];

const failures = [];
let scanned = 0;

const files = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs'));

for (const file of files) {
  const path = join(BLOCKS_DIR, file);
  const src = readFileSync(path, 'utf8');
  scanned++;

  /* Extract every `\`...\`` template literal that looks like CSS. */
  const templates = src.match(/`[^`]*`/g) || [];

  for (const t of templates) {
    /* Cheap pre-filter: does it contain at least one motion state? */
    if (!MOTION_STATES.some(s => t.includes(s))) continue;

    /* Walk every rule body that targets a cell-class under a motion state.
     * We use a regex that matches selectors like
     * `.is-spinning .cell {`, `.is-spinning::after`, `.hex-reel-col.is-spinning .hex-reel-strip {`. */
    const ruleRegex = /([^{}]*?\b(is-spinning|is-blurring|is-stopping|is-streaking)\b[^{}]*?)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRegex.exec(t)) !== null) {
      const selector = m[1].trim();
      const body = m[3];

      /* Skip pure overlay rules (`::after`, `::before`, `::-webkit-*`). */
      if (/::(after|before|-webkit-[\w-]+)/.test(selector)) continue;

      /* Skip rules that target the column container (not the cell). */
      if (!CELL_SELECTORS.some(c => selector.includes(c))) continue;

      /* Skip `prefers-reduced-motion` overrides that explicitly set
       * `filter: none` (defensive accessibility resets). */
      const inRmotion = t.lastIndexOf('@media (prefers-reduced-motion: reduce)', m.index) > -1 &&
                        t.indexOf('}', m.index) < t.indexOf('@media', m.index + 1) + (t.indexOf('@media', m.index + 1) === -1 ? Infinity : 0);

      /* The four forbidden patterns. */
      const blurNonzero = /filter\s*:\s*blur\(\s*(\d*\.?\d+)\s*px\s*\)/i.exec(body);
      if (blurNonzero && parseFloat(blurNonzero[1]) > 0) {
        failures.push(`${file}: muddy-cell — \`${selector} { filter: blur(${blurNonzero[1]}px); }\``);
      }

      const brightnessDim = /filter\s*:[^;]*brightness\(\s*(0?\.\d+)\s*\)/i.exec(body);
      if (brightnessDim && parseFloat(brightnessDim[1]) < 1.0) {
        failures.push(`${file}: dim-cell — \`${selector} { ${brightnessDim[0]}; }\``);
      }

      const opacityFade = /\bopacity\s*:\s*(0?\.\d+)\b/i.exec(body);
      if (opacityFade && parseFloat(opacityFade[1]) < 1.0 && !inRmotion) {
        /* Allow opacity ramp on legacy fade-fallback path only when
         * gated by prefers-reduced-motion (handled above). */
        const isFade = /transition[^;]*opacity/.test(body);
        if (!isFade) {
          failures.push(`${file}: faded-cell — \`${selector} { opacity: ${opacityFade[1]}; }\``);
        }
      }

      const backdropBlur = /backdrop-filter\s*:[^;]*blur\(\s*(\d*\.?\d+)\s*px\s*\)/i.exec(body);
      if (backdropBlur && parseFloat(backdropBlur[1]) > 0) {
        failures.push(`${file}: backdrop-blur-cell — \`${selector} { ${backdropBlur[0]}; }\``);
      }
    }
  }
}

console.log('— muddy-cell lint —');
console.log(`  scanned: ${scanned} block files`);
if (failures.length === 0) {
  console.log('  ✓ no cell-level motion mutations found');
  console.log(`\nResult: ${scanned} files PASS`);
  process.exit(0);
}

for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`\nResult: ${failures.length} violation(s) across ${scanned} files`);
console.log('\nFix: move the blur/dim/fade to a `::after` overlay on the column,');
console.log('     not on the cell glyph layer. See src/blocks/reelEngineCSS.mjs for');
console.log('     the canonical pattern.');
process.exit(1);
