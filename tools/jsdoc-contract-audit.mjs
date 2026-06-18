#!/usr/bin/env node
/**
 * tools/jsdoc-contract-audit.mjs
 *
 * Wave W47.S28 — JSDoc contract header audit for every block.
 *
 * Senior-grade rule (`rule_senior_grade_code`):
 *   every src/blocks/*.mjs MUST begin with a JSDoc block whose body
 *   names the 7 senior-grade contract slots:
 *
 *     1. purpose       — what + why
 *     2. industry-ref  — vendor-neutral baseline reference
 *     3. public API    — exported functions
 *     4. lifecycle     — HookBus subscribes + emits
 *     5. perf budget   — declared cost ceilings
 *     6. a11y          — keyboard + ARIA + reduced-motion gates
 *     7. GDD keys      — consumed model.<slot> keys
 *
 * The audit is heuristic — keywords in the leading JSDoc block. A block
 * scoring < 5 of 7 slots reports as a violation; 5..6 is a warning;
 * 7 is clean. CSS-only / data-only blocks (no public API surface) are
 * exempt — same NON_INTERACTIVE list as keyboard-nav-audit.
 *
 * Modes:
 *   default — report-only, exit 0
 *   --strict — exit 1 on any violation
 *
 * Vendor-neutral. 0 external deps. Pure pass.
 */

import { readdirSync, readFileSync } from 'node:fs';
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

const STRICT = process.argv.includes('--strict');

const NON_INTERACTIVE = new Set([
  /* Same exempt list as keyboard-nav-audit — these blocks expose no
   * runtime contract that needs the 7-slot header. */
  'hookBus.mjs', 'reelEngineCSS.mjs', 'themeCSS.mjs',
  'paylines.mjs', 'paylineOverlay.mjs',
  'payAnywhereEval.mjs', 'clusterPaysEval.mjs', 'waysEval.mjs',
  'spinTempo.mjs',
]);

/* Slot patterns — case-insensitive regexes that should match somewhere
 * in the leading JSDoc block. Multiple synonyms allowed to keep the
 * contract from being over-specific about wording. */
const SLOT_PATTERNS = [
  ['purpose',      /(purpose|orchestrates|presenter|engine|coordinator|carries|renders|implements|adds|provides|emits|owns)/i],
  ['industry-ref', /(industry|vendor-neutral|reference|baseline|classic|standard|canonical|industry pattern|industry baseline)/i],
  ['public api',   /(public api|exports|export\s+\w+|defaultConfig\s*\(\)|emit\w+\s*\()/i],
  ['lifecycle',    /(lifecycle|hookbus|subscribes|emits|onSpinResult|preSpin|postSpin|onFs|onTumble|HookBus\.on|HookBus\.emit)/i],
  ['perf budget',  /(perf|performance|budget|≤|<=|listener|ms\b|kb\b|deterministic)/i],
  ['a11y',         /(a11y|aria|wcag|screen reader|reduced[-\s]?motion|keyboard|focus[\s-]?trap|sr\b)/i],
  ['gdd keys',     /(gdd|model\.[a-zA-Z]+|@param|knobs|config|consumed from)/i],
];

function leadingJsDoc(src) {
  const m = src.match(/^\s*\/\*\*[\s\S]*?\*\/\s*/);
  return m ? m[0] : '';
}

function auditOne(file, src) {
  const head = leadingJsDoc(src);
  if (!head) return { name: path.basename(file), score: 0, missing: SLOT_PATTERNS.map(([n]) => n), hasHeader: false };
  const missing = [];
  let score = 0;
  for (const [name, re] of SLOT_PATTERNS) {
    if (re.test(head)) score++;
    else missing.push(name);
  }
  return { name: path.basename(file), score, missing, hasHeader: true };
}

function main() {
  console.log(C.bold(C.cyan('\n📜 JSDoc contract audit — 7-slot senior-grade header\n')));
  console.log(C.dim('   purpose · industry-ref · public API · lifecycle · perf budget · a11y · GDD keys'));
  console.log(C.dim(`   Mode: ${STRICT ? C.yellow('--strict') : 'report-only'}\n`));

  const files = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs') && !NON_INTERACTIVE.has(f));
  let clean = 0, warns = 0, viols = 0;
  const sub = [];
  for (const f of files) {
    const p = path.join(BLOCKS_DIR, f);
    const src = readFileSync(p, 'utf8');
    const r = auditOne(p, src);
    if (r.score === 7) {
      clean++;
    } else if (r.score >= 5) {
      warns++;
      sub.push(r);
    } else {
      viols++;
      sub.push(r);
    }
  }

  /* Sort by score asc so the most-incomplete headers surface first. */
  sub.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  for (const r of sub) {
    const cls = r.score >= 5 ? C.yellow('!') : C.red('✗');
    console.log(`  ${cls} ${C.bold(r.name)} — ${r.score}/7  (missing: ${r.missing.join(', ')})`);
  }

  console.log(C.dim(
    `\n   ${files.length} blocks audited · ${clean} clean (7/7) · ${warns} warn (5-6/7) · ${viols} violation (<5/7)\n`
  ));

  if (STRICT && viols > 0) {
    console.log(C.red(C.bold(`✖ ${viols} block(s) have incomplete JSDoc contract headers (<5/7).`)));
    process.exit(1);
  }
  if (viols === 0) {
    console.log(C.green(C.bold(
      warns === 0
        ? '✅ all 7/7 headers complete.'
        : `✅ no violations (${warns} block(s) at 5-6/7 — polish opportunity).`
    )));
  } else {
    console.log(C.yellow(C.bold(`! report-only — ${viols} violation(s) ignored (use --strict to fail).`)));
  }
}

const invokedFromCli =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] || '');
if (invokedFromCli) main();
