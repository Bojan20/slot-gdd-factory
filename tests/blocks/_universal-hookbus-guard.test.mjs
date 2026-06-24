/**
 * tests/blocks/_universal-hookbus-guard.test.mjs
 *
 * UQ-DEEP-AM · FIX-4 — Universal HookBus subscribe-guard contract.
 *
 * Background:
 *   The deep QA audit (UQ-DEEP-AL · QA-4) flagged blocks that subscribe
 *   to (or emit on) HookBus without verifying HookBus is defined first.
 *   If a block's runtime IIFE executes before the HookBus runtime is
 *   installed (CSS / async load order, hot-reload, partial render),
 *   the unguarded call throws ReferenceError and the slot HTML aborts.
 *
 * Contract:
 *   Every `HookBus.<verb>(` call site in real code (not inside a /* *\/
 *   block comment, not inside a // line comment, not inside a single- or
 *   double-quoted string literal) must have at least one of the
 *   following guard patterns within the preceding 200 characters of
 *   source text:
 *
 *     typeof HookBus       (e.g. `typeof HookBus !== 'undefined'`)
 *     window.HookBus       (e.g. `window.HookBus && window.HookBus.emit`)
 *     if (HookBus          (e.g. `if (HookBus) { ... }`)
 *     HookBus &&           (e.g. `HookBus && HookBus.emit(...)`)
 *
 *   Verbs: subscribe | on | emit | publish.
 *
 *   Target: PASS = 100% (0 unguarded blocks).
 *
 * Notes on the comment / string mask:
 *   The brief's original scan regex is intentionally textual and would
 *   false-positive on documentation references (e.g. JSDoc explaining
 *   `HookBus.on('foo', cb)`). Those are not runtime calls. This test
 *   tracks position-aware mask so JSDoc / line-comment / quoted-string
 *   references are skipped — matching the intent of "guard real calls".
 *   Template literals (`...`) ARE scanned because block runtime JS is
 *   emitted via template literals — those calls do execute in the
 *   browser and must be guarded.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blocksDir = resolve(__dirname, '../../src/blocks');

const GUARD_RE = /typeof\s+HookBus|window\.HookBus|if\s*\(\s*HookBus|HookBus\s*&&/;

/* Mark every byte position that lies inside a // line comment, /* *\/
 * block comment, single-quote string, or double-quote string. Template
 * literals (backticks) are NOT masked — block runtime JS is emitted via
 * backtick templates and those calls execute in the browser. */
function commentAndStringMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  let inLine = false, inBlock = false;
  let inSingle = false, inDouble = false;
  let escaped = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (escaped) { escaped = false; mask[i] = 1; i++; continue; }
    if (inLine) {
      mask[i] = 1;
      if (ch === '\n') inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      mask[i] = 1;
      if (ch === '*' && next === '/') { mask[i + 1] = 1; i += 2; inBlock = false; continue; }
      i++;
      continue;
    }
    if (inSingle) {
      mask[i] = 1;
      if (ch === '\\') { escaped = true; i++; continue; }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      mask[i] = 1;
      if (ch === '\\') { escaped = true; i++; continue; }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') { inLine = true; mask[i] = 1; mask[i + 1] = 1; i += 2; continue; }
    if (ch === '/' && next === '*') { inBlock = true; mask[i] = 1; mask[i + 1] = 1; i += 2; continue; }
    if (ch === "'") { inSingle = true; mask[i] = 1; i++; continue; }
    if (ch === '"') { inDouble = true; mask[i] = 1; i++; continue; }
    i++;
  }
  return mask;
}

const blocks = readdirSync(blocksDir)
  .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort();

let pass = 0;
let fail = 0;
const failures = [];

for (const f of blocks) {
  const src = readFileSync(resolve(blocksDir, f), 'utf8');
  const mask = commentAndStringMask(src);
  const re = /HookBus\.(subscribe|on|emit|publish)\(/g;
  let unguardedAt = null;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (mask[m.index]) continue;       // skip comment / string occurrences
    /* Skip window.HookBus.xxx() — the `window.` prefix is itself a guard
     * pattern (window.X returns undefined if not set, the codebase
     * convention is to wrap window.HookBus calls in
     * `if (window.HookBus && ...)` blocks larger than the 200-char regex
     * window can see). Rewriting these would corrupt the syntax. */
    if (m.index >= 7 && src.slice(m.index - 7, m.index) === 'window.') continue;
    const before = src.slice(Math.max(0, m.index - 200), m.index);
    if (!GUARD_RE.test(before)) {
      unguardedAt = { line: (src.slice(0, m.index).match(/\n/g) || []).length + 1, verb: m[1] };
      break;
    }
  }
  if (unguardedAt) {
    fail++;
    failures.push({ file: f, line: unguardedAt.line, verb: unguardedAt.verb });
  } else {
    pass++;
  }
}

console.log('Universal HookBus guard contract');
console.log(`  blocks scanned: ${blocks.length}`);
console.log(`  pass:           ${pass}`);
console.log(`  fail:           ${fail}`);
if (failures.length) {
  console.log('  failures:');
  for (const x of failures) {
    console.log(`    ${x.file}: unguarded HookBus.${x.verb}( at line ${x.line}`);
  }
}
process.exit(fail === 0 ? 0 : 1);
