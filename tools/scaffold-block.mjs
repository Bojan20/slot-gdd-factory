#!/usr/bin/env node
/**
 * tools/scaffold-block.mjs
 *
 * Wave Z-2 (2026-06-21, Boki "kreni") — Archetype → Block scaffolder.
 *
 * Generates a senior-grade starter `src/blocks/<kind>.mjs` plus a matching
 * `tests/blocks/<kind>.test.mjs` directly from an entry in the 25-archetype
 * catalog (src/registry/featureArchetypes.mjs).
 *
 * The generated block is NOT runnable feature code on its own — it is a
 * lifecycle skeleton with all the right hook subscriptions, force/window
 * flag plumbing, state shape, defaultConfig/resolveConfig, and JSDoc
 * contract header already in place. A senior dev fills the CSS/runtime
 * bodies + win-eval wiring, then the test scaffold is incrementally
 * tightened.
 *
 * USAGE
 *   node tools/scaffold-block.mjs --archetype <id> --kind <camelCaseKind>
 *   node tools/scaffold-block.mjs --archetype multiplier-trail --kind tumbleMultLadder
 *   node tools/scaffold-block.mjs --list                  # list archetypes
 *   node tools/scaffold-block.mjs --dry-run               # print to stdout
 *
 * SAFETY
 *   • Refuses to overwrite an existing block unless --force is passed.
 *   • Refuses to scaffold if the archetype id is unknown.
 *   • Refuses to scaffold if --kind is not lowerCamelCase.
 *
 * OUTPUT
 *   src/blocks/<kind>.mjs        — senior-grade starter
 *   tests/blocks/<kind>.test.mjs — scaffolded sanity test
 *
 * INVARIANTS (rule_slot_gdd_lego_blocks + rule_senior_grade_code)
 *   • One block per file (LEGO discipline)
 *   • JSDoc contract header with purpose / archetype / lifecycle / perf / a11y
 *   • defaultConfig() returns Object.freeze()-d shape
 *   • resolveConfig() defensive on input, auto-enables on feature match
 *   • emit*CSS()/emit*Runtime() are pure string emitters
 *   • forceFlag + windowFlag exactly match archetype declaration
 *   • Test scaffold asserts contract surface, not implementation details
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES, getArchetype } from '../src/registry/featureArchetypes.mjs';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO      = resolve(__dirname, '..');
const BLOCKS    = resolve(REPO, 'src/blocks');
const TESTS     = resolve(REPO, 'tests/blocks');

/* ── arg parsing ──────────────────────────────────────────────────────── */

function _flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
function _has(args, name) {
  return args.includes(name);
}

/* ── name helpers ─────────────────────────────────────────────────────── */

/* N+2 G C3 audit fix: handle underscore-prefixed inputs (e.g. `_auto_wild`)
 * by stripping leading underscores + splitting on _ boundaries. Without
 * this, toPascalCase('_auto_wild') → '_auto_wild' (only uppercases first
 * char which is `_`, no-op) → emit_auto_wildCSS (broken identifier-like
 * name). Now: '_auto_wild' → 'AutoWild'. */
function toPascalCase(s) {
  const cleaned = String(s || '').replace(/^_+/, '');
  return cleaned
    .replace(/([_-])([a-z0-9])/g, (_, _sep, c) => c.toUpperCase())
    .replace(/^./, c => c.toUpperCase());
}
function toScreamingSnake(s) {
  return s.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
}
function isLowerCamelCase(s) {
  return typeof s === 'string' && /^[a-z][a-zA-Z0-9]+$/.test(s);
}

/* ── code emitters ────────────────────────────────────────────────────── */

/* N+2 G — exported so tools/auto-scaffold-detector.mjs can reuse the
 * template generator without spawning the CLI for every unknown kind. */
export function emitBlockSource(kind, archetype) {
  const Pascal      = toPascalCase(kind);
  const SCREAMING   = toScreamingSnake(kind);
  /* Nest archetype state under cfg.state to avoid colliding with block-
     level fields like `mode` (some archetypes declare their own `mode`
     state value, e.g. variable-ways { mode: 'base' }). */
  const stateKeys   = Object.keys(archetype.stateShape || {});
  const stateLines  = stateKeys.length
    ? '    state: ' + JSON.stringify(archetype.stateShape, null, 6).split('\n').join('\n    ')
    : '    state: {} /* no archetype state — fill in feature-specific fields */';
  const hookList    = (archetype.hooks || []).map(h => `'${h}'`).join(', ');
  const subscribes  = (archetype.hooks || []).map(h => `      bus.on('${h}', (payload) => _on_${h}(payload));`).join('\n');
  const handlers    = (archetype.hooks || []).map(h => `
function _on_${h}(_payload) {
  /* TODO(${kind}): implement ${h} handler.
     Read from window.${archetype.windowFlag} as needed, write back to it
     when the block's state advances. Force-chip override:
     window.${archetype.forceFlag}. */
}`).join('\n');

  /* heuristic: derive feature-kind matcher for auto-enable.
     Archetype examples are camelCase; convert to snake_case for GDD match. */
  const featureKinds = (archetype.examples || []).map(e =>
    e.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
  );
  /* and also include the bare kind string itself */
  if (!featureKinds.includes(kind.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''))) {
    featureKinds.unshift(kind.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''));
  }

  return `/**
 * src/blocks/${kind}.mjs
 *
 * Wave Z-2 scaffold (2026-06-21) — auto-generated from archetype
 * "${archetype.id}" via tools/scaffold-block.mjs.
 *
 * PURPOSE
 * -------
 * ${archetype.purpose}
 *
 * ARCHETYPE CONTRACT
 * ------------------
 *   id          : ${archetype.id}
 *   force-chip  : window.${archetype.forceFlag}
 *   window-flag : window.${archetype.windowFlag}
 *   hook bus    : ${hookList || '(none)'}
 *
 * GDD KNOBS (resolved from model.${kind})
 * ----------
 *   enabled         : boolean (defaults false; auto-true on feature match)
 *   mode            : 'fs' | 'base' | 'both'
 *
 * LIFECYCLE
 * ---------
 * Block subscribes to the archetype's canonical HookBus events. Each
 * handler is currently a TODO — fill in the spin-result mutation, then
 * publish a '${kind}:applied' event so win-eval / animation / analytics
 * can react. Silent payouts = silent regressions; always emit when state
 * actually changes.
 *
 * PERF BUDGET
 * -----------
 * ≤ 0.5 ms per spin on 6×5 grid. No per-spin allocations after warm-up.
 * No layout thrash inside hook handlers.
 *
 * A11Y
 * ----
 * Respects prefers-reduced-motion via the emitted CSS (animations gated).
 * Status changes that affect the win amount must be visible to AT (text
 * label or aria-live region; not emitted yet — to be added with runtime).
 *
 * SECURITY / DETERMINISM
 * ----------------------
 * No randomness inside the block. All entropy comes from engine spin
 * outcomes. Force chip (${archetype.forceFlag}) is honored ONLY when set
 * via the dev/force panel, never from URL params or external storage.
 */

const ${SCREAMING}_FORCE_FLAG  = '${archetype.forceFlag}';
const ${SCREAMING}_WINDOW_FLAG = '${archetype.windowFlag}';

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'fs',
${stateLines},
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.${kind}) || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;

  /* Auto-enable on feature-kind match (parser populates model.features). */
  const featureKinds = ${JSON.stringify(featureKinds)};
  if (Array.isArray(model.features) && model.features.some(f =>
    f && typeof f.kind === 'string' && featureKinds.includes(f.kind)
  )) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emit${Pascal}CSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return \`
/* ─── ${kind} (archetype: ${archetype.id}) ───────────────────────── */
.cell.is-\${'${kind}'.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())} {
  /* TODO(${kind}): scaffolded CSS — fill in animation + glow per GDD */
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-\${'${kind}'.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())} { animation: none; }
}
\`;
}

export function emit${Pascal}Runtime(cfg = defaultConfig()) {
  if (!cfg.enabled) return \`/* ${kind}: disabled */\`;
  return \`/* ─── ${kind} runtime (archetype: ${archetype.id}) ────────────── */
const ${SCREAMING}_FORCE = ${SCREAMING}_FORCE_FLAG;
const ${SCREAMING}_WIN   = ${SCREAMING}_WINDOW_FLAG;
const ${SCREAMING}_MODE  = \${JSON.stringify(cfg.mode)};

(function _init${Pascal}() {
  const bus = window.HookBus || globalThis.HookBus;
  if (!bus || typeof bus.on !== 'function') return;
${subscribes}
})();
${handlers}
\`;
}

export const ARCHETYPE_ID = '${archetype.id}';
export const FORCE_FLAG   = ${SCREAMING}_FORCE_FLAG;
export const WINDOW_FLAG  = ${SCREAMING}_WINDOW_FLAG;
`;
}

/* N+2 G — exported for auto-scaffold-detector.mjs reuse. */
export function emitTestSource(kind, archetype) {
  const Pascal = toPascalCase(kind);
  const featureKind = (archetype.examples && archetype.examples[0]) ||
    (kind.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''));
  return `/**
 * tests/blocks/${kind}.test.mjs
 *
 * Wave Z-2 scaffold (2026-06-21) — auto-generated alongside
 * src/blocks/${kind}.mjs.
 *
 * Asserts the LEGO public API contract:
 *   1. defaultConfig() returns frozen shape with enabled === false
 *   2. resolveConfig({}) === defaults
 *   3. resolveConfig auto-enables on feature-kind match
 *   4. emit*CSS / emit*Runtime are string-typed
 *   5. ARCHETYPE_ID / FORCE_FLAG / WINDOW_FLAG match the archetype declaration
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  defaultConfig,
  resolveConfig,
  emit${Pascal}CSS,
  emit${Pascal}Runtime,
  ARCHETYPE_ID,
  FORCE_FLAG,
  WINDOW_FLAG,
} from '../../src/blocks/${kind}.mjs';
import { getArchetype } from '../../src/registry/featureArchetypes.mjs';

const ARCH = getArchetype('${archetype.id}');

test('${kind}: defaultConfig is frozen, enabled=false', () => {
  const cfg = defaultConfig();
  assert.ok(Object.isFrozen(cfg), 'defaultConfig must be frozen');
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.mode, 'fs');
});

test('${kind}: resolveConfig({}) returns defaults clone', () => {
  const a = resolveConfig({});
  const b = defaultConfig();
  assert.equal(a.enabled, b.enabled);
  assert.equal(a.mode, b.mode);
});

test('${kind}: resolveConfig auto-enables on feature-kind match', () => {
  const cfg = resolveConfig({ features: [{ kind: '${featureKind.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')}' }] });
  assert.equal(cfg.enabled, true, 'feature match must auto-enable block');
});

test('${kind}: emit*CSS returns empty when disabled', () => {
  assert.equal(emit${Pascal}CSS(defaultConfig()), '');
});

test('${kind}: emit*CSS returns CSS string when enabled', () => {
  const css = emit${Pascal}CSS({ ...defaultConfig(), enabled: true });
  assert.equal(typeof css, 'string');
  assert.ok(css.length > 0, 'enabled CSS must be non-empty');
  assert.ok(css.includes('${archetype.id}'), 'CSS comment must reference archetype id');
});

test('${kind}: emit*Runtime returns disabled stub when disabled', () => {
  const rt = emit${Pascal}Runtime(defaultConfig());
  assert.equal(typeof rt, 'string');
  assert.ok(/disabled/.test(rt), 'disabled runtime must say so in a comment');
});

test('${kind}: emit*Runtime returns runtime string when enabled', () => {
  const rt = emit${Pascal}Runtime({ ...defaultConfig(), enabled: true });
  assert.equal(typeof rt, 'string');
  assert.ok(rt.length > 0);
  assert.ok(rt.includes('${archetype.id}'), 'runtime header must reference archetype id');
});

test('${kind}: ARCHETYPE_ID / FORCE_FLAG / WINDOW_FLAG match archetype declaration', () => {
  assert.equal(ARCHETYPE_ID, ARCH.id);
  assert.equal(FORCE_FLAG, ARCH.forceFlag);
  assert.equal(WINDOW_FLAG, ARCH.windowFlag);
});
`;
}

/* ── main ─────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);

  if (_has(args, '--list')) {
    console.log('Available archetypes:');
    for (const a of ARCHETYPES) {
      console.log(`  ${a.id.padEnd(22)} — ${a.purpose}`);
    }
    process.exit(0);
  }

  const archId = _flag(args, '--archetype');
  const kind   = _flag(args, '--kind');
  const force  = _has(args, '--force');
  const dry    = _has(args, '--dry-run');

  if (!archId || !kind) {
    console.error('Usage: node tools/scaffold-block.mjs --archetype <id> --kind <camelCaseKind> [--force] [--dry-run]');
    console.error('       node tools/scaffold-block.mjs --list');
    process.exit(2);
  }
  if (!isLowerCamelCase(kind)) {
    console.error(`✗ --kind must be lowerCamelCase (got "${kind}")`);
    process.exit(2);
  }
  const arch = getArchetype(archId);
  if (!arch) {
    console.error(`✗ Unknown archetype id "${archId}". Run --list to see options.`);
    process.exit(2);
  }

  const blockPath = resolve(BLOCKS, `${kind}.mjs`);
  const testPath  = resolve(TESTS,  `${kind}.test.mjs`);

  if (!force && existsSync(blockPath)) {
    console.error(`✗ Block already exists: ${blockPath}. Pass --force to overwrite.`);
    process.exit(2);
  }
  if (!force && existsSync(testPath)) {
    console.error(`✗ Test already exists: ${testPath}. Pass --force to overwrite.`);
    process.exit(2);
  }

  const blockSrc = emitBlockSource(kind, arch);
  const testSrc  = emitTestSource(kind, arch);

  if (dry) {
    console.log('=== ' + blockPath + ' ===');
    console.log(blockSrc);
    console.log('=== ' + testPath + ' ===');
    console.log(testSrc);
    process.exit(0);
  }

  await mkdir(BLOCKS, { recursive: true });
  await mkdir(TESTS,  { recursive: true });
  await writeFile(blockPath, blockSrc, 'utf8');
  await writeFile(testPath,  testSrc,  'utf8');
  console.log(`✓ scaffolded ${blockPath}`);
  console.log(`✓ scaffolded ${testPath}`);
  console.log(`  archetype: ${arch.id}  forceFlag: ${arch.forceFlag}  windowFlag: ${arch.windowFlag}`);
  console.log(`  next: node --test ${testPath}`);
}

/* N+2 G — CLI guard so importing emitBlockSource/emitTestSource from
 * tools/auto-scaffold-detector.mjs doesn't trigger main() and dump
 * Usage to stderr. main() runs only when invoked as a script. */
if (process.argv[1]?.endsWith('scaffold-block.mjs')) {
  main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
}
