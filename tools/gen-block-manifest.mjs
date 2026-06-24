#!/usr/bin/env node
/**
 * tools/gen-block-manifest.mjs
 *
 * Wave Z3 — auto-generate the block manifest powering the Block Playground.
 *
 * Scans `src/blocks/*.mjs` and produces `blocks/_manifest.json` with, per
 * block:
 *   {
 *     name:           "paytable",
 *     file:           "src/blocks/paytable.mjs",
 *     testFile:       "tests/blocks/paytable.test.mjs" | null,
 *     category:       "ui" | "wild" | "multiplier" | "fs" | "round-control"
 *                   | "audit" | "engine" | "uncategorised",
 *     description:    "<one-line summary from JSDoc>",
 *     exports:        ["defaultConfig","resolveConfig",
 *                      "emitPaytableCSS","emitPaytableMarkup",
 *                      "emitPaytableRuntime"],
 *     lifecycleHooks: ["onBetChanged","preSpin","onFsTrigger",
 *                      "onAutoplayStart"],
 *     emittedEvents:  ["onPaytableShown","onPaytableHidden"],
 *     defaultConfig:  { ...resolved from defaultConfig() at scan time },
 *     loc:            512
 *   }
 *
 * Senior-grade hard rules:
 *   • Defensive on missing JSDoc — fall back to a neutral "(no description)"
 *   • Defensive on dynamic exports — only enumerable static exports parsed
 *   • Defensive on defaultConfig that throws — captured + reported
 *   • Vendor-neutral — never bake game / vendor names into manifest text
 *   • Deterministic — sorted by name so manifest JSON has stable git diff
 *
 * Run:
 *   node tools/gen-block-manifest.mjs                       # writes manifest
 *   node tools/gen-block-manifest.mjs --print               # stdout only
 *
 * Output: writes `blocks/_manifest.json` (overwriting existing).
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve as resolvePath, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolvePath(dirname(__filename), '..');
const BLOCKS_DIR = resolvePath(REPO, 'src/blocks');
const TESTS_DIR = resolvePath(REPO, 'tests/blocks');
const OUT_DIR = resolvePath(REPO, 'blocks');
const OUT_FILE = resolvePath(OUT_DIR, '_manifest.json');

const PRINT_ONLY = process.argv.includes('--print');

/** Category buckets — keyword routing keeps the playground sidebar grouped. */
const CATEGORY_RULES = [
  { name: 'engine',        match: /(reelEngine|spinTempo|anticipation|postSpin|tumble|hookBus|themeCSS|reelEngineCSS|hexReelEngine|wheelSpinEngine|crashSpinEngine|plinkoSpinEngine|slingoSpinEngine)/i },
  { name: 'wild',          match: /(wild|stickyWild|expandingWild|walkingWild|wildReel|mysterySymbol|superSymbol)/i },
  { name: 'multiplier',    match: /(multiplier|lightning|persistentMultiplier|pathAware|progressiveFreeSpins)/i },
  { name: 'fs',            match: /(freeSpins|scatterCelebration|stageBadge|triggerCounting)/i },
  { name: 'round-control', match: /(slamStop|forceSkip|spinControl|autoplay|turboMode|winRollup|winPresentation|bigWinTier)/i },
  { name: 'evaluator',     match: /(paylines|paylineOverlay|payAnywhereEval|clusterPaysEval|waysEval)/i },
  { name: 'feature',       match: /(holdAndWin|bonusBuy|bonusPick|wheelBonus|weightedWheelSegments|respin|gamble|gambleSecondary|anteBet|winCap)/i },
  { name: 'ui',            match: /(paytable|historyLog|balanceHud|betSelector|settingsPanel|uiToast|audio)/i },
  { name: 'audit',         match: /(realityCheck|netLossIndicator)/i },
];

function categoriseBlock(name) {
  for (const rule of CATEGORY_RULES) if (rule.match.test(name)) return rule.name;
  return 'uncategorised';
}

/**
 * Extract first non-empty line from a JSDoc block at the top of the file.
 * Falls back to a neutral placeholder.
 */
function extractDescription(source) {
  const m = source.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return '(no JSDoc description)';
  const lines = m[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').trim())
    .filter(l => l && !/^src\/blocks\//.test(l) && !/^Wave [A-Z0-9]+ —/.test(l));
  /* prefer the first informative line that's not a header */
  for (const l of lines) {
    if (l.length >= 16 && !/^(@|----|====|####|—|Industry|Lifecycle|Composition|Public|Runtime|Bake)/.test(l)) {
      return l.slice(0, 240);
    }
  }
  /* fallback: first non-empty line at all */
  return (lines[0] || '(no JSDoc description)').slice(0, 240);
}

/**
 * Static scan: enumerate `export function` / `export const` symbols.
 */
function extractExports(source) {
  const re = /^export\s+(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*))/gm;
  const names = new Set();
  let m;
  while ((m = re.exec(source))) names.add(m[1] || m[2]);
  return [...names].sort();
}

/**
 * Lifecycle listeners — every `HookBus.on('eventName', ...)` occurrence
 * inside any emit*Runtime block. We snapshot the canonical event list
 * referenced in the block (deduped + sorted).
 */
function extractLifecycleHooks(source) {
  const set = new Set();
  /* HookBus.on('event', ...) OR HookBus.on("event", ...) */
  const reA = /HookBus\.on\(\s*['"]([a-zA-Z]+)['"]/g;
  let m;
  while ((m = reA.exec(source))) set.add(m[1]);
  /* Also support HookBus.once / waitFor patterns */
  const reB = /HookBus\.(?:once|waitFor)\(\s*['"]([a-zA-Z]+)['"]/g;
  while ((m = reB.exec(source))) set.add(m[1]);
  return [...set].sort();
}

/**
 * Events the block EMITS (single-owner enforced by LEGO gate). Pattern:
 * `HookBus.emit('event', ...)` inside the source.
 */
function extractEmittedEvents(source) {
  const set = new Set();
  const re = /HookBus\.emit\(\s*['"]([a-zA-Z]+)['"]/g;
  let m;
  while ((m = re.exec(source))) set.add(m[1]);
  return [...set].sort();
}

/**
 * Try to load defaultConfig() from the module. Defensive — if the module
 * throws on load (e.g. depends on browser globals at import time), we
 * record an error and continue.
 *
 * Returns { cfg, frozen } where:
 *   cfg    — JSON-serialisable copy of defaultConfig() (or null / error obj)
 *   frozen — true iff the LIVE config object is Object.isFrozen at scan time
 *            (UQ-DEEP-AN — manifest must reflect runtime freeze posture so
 *            audit tooling sees the real coverage, not 0)
 */
async function loadDefaultConfig(absPath) {
  try {
    const mod = await import(pathToFileURL(absPath).href);
    if (typeof mod.defaultConfig === 'function') {
      try {
        const liveCfg = mod.defaultConfig();
        const frozen = liveCfg !== null
          && typeof liveCfg === 'object'
          && Object.isFrozen(liveCfg);
        /* Only retain JSON-serialisable values — drops Set, Map, Function. */
        const cfg = JSON.parse(JSON.stringify(liveCfg));
        return { cfg, frozen };
      } catch (e) {
        return { cfg: { __error: `defaultConfig() threw: ${e.message}` }, frozen: false };
      }
    }
    return { cfg: null, frozen: false };
  } catch (e) {
    return { cfg: { __error: `import failed: ${e.message}` }, frozen: false };
  }
}

/* ── Main ── */

if (!existsSync(BLOCKS_DIR)) {
  console.error(`✗ Blocks dir not found: ${BLOCKS_DIR}`);
  process.exit(1);
}

const blockFiles = readdirSync(BLOCKS_DIR)
  .filter(f => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort();

const manifest = {
  generatedAt: new Date().toISOString(),
  blocksDir: 'src/blocks',
  totalBlocks: blockFiles.length,
  blocks: [],
};

for (const f of blockFiles) {
  const abs = resolvePath(BLOCKS_DIR, f);
  const rel = `src/blocks/${f}`;
  const name = basename(f, '.mjs');
  const source = readFileSync(abs, 'utf8');
  const loc = source.split('\n').length;
  const testCandidate = resolvePath(TESTS_DIR, `${name}.test.mjs`);
  const testFile = existsSync(testCandidate) ? `tests/blocks/${name}.test.mjs` : null;

  const { cfg: defaultConfig, frozen } = await loadDefaultConfig(abs);
  const entry = {
    name,
    file: rel,
    testFile,
    category: categoriseBlock(name),
    description: extractDescription(source),
    exports: extractExports(source),
    enabledByDefault:
      defaultConfig && typeof defaultConfig === 'object' && !defaultConfig.__error
        && 'enabled' in defaultConfig
        ? !!defaultConfig.enabled
        : true,
    frozen,
    lifecycleHooks: extractLifecycleHooks(source),
    emittedEvents: extractEmittedEvents(source),
    defaultConfig,
    loc,
  };
  manifest.blocks.push(entry);
}

/* sort once more by name to ensure stable output even if readdir order shifts */
manifest.blocks.sort((a, b) => a.name.localeCompare(b.name));

const json = JSON.stringify(manifest, null, 2);

if (PRINT_ONLY) {
  /* Wave P8 fix — never call process.exit() before stdout has drained
   * AND make sure the summary console.log lines below NEVER append to
   * the printed JSON (they would corrupt the JSON.parse downstream).
   * console.log + immediate exit truncates at the stream highWaterMark
   * (~65 KB) on macOS, causing JSON.parse to throw "Unterminated string"
   * in the manifest-freshness test. Use write+callback so we exit only
   * after the kernel has accepted the full payload. */
  process.stdout.write(json + '\n', () => process.exit(0));
  /* Keep the event loop alive long enough for the drain callback to
   * fire; the explicit infinite timeout is unref'd so it never blocks
   * a normal exit path on its own. */
  setTimeout(() => process.exit(0), 5000).unref();
  /* Halt synchronous execution so the summary below does not interleave
   * with the JSON payload on stdout. */
  await new Promise(() => {});
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, json + '\n', 'utf8');

/* Pretty summary */
const byCat = {};
for (const b of manifest.blocks) {
  byCat[b.category] = (byCat[b.category] || 0) + 1;
}
const cats = Object.keys(byCat).sort();
const frozenCount = manifest.blocks.filter(b => b.frozen === true).length;
console.log(`✓ Wrote ${OUT_FILE}`);
console.log(`  Total blocks: ${manifest.blocks.length}`);
console.log(`  Frozen      : ${frozenCount}/${manifest.blocks.length} (UQ-DEEP-AN drift gate)`);
console.log(`  Categories  : ${cats.map(c => `${c}=${byCat[c]}`).join(', ')}`);
const blocksWithErrors = manifest.blocks.filter(b => b.defaultConfig && b.defaultConfig.__error);
if (blocksWithErrors.length) {
  console.log(`  ⚠️  ${blocksWithErrors.length} block(s) defaultConfig load failed:`);
  for (const b of blocksWithErrors) console.log(`     • ${b.name}: ${b.defaultConfig.__error}`);
}
const blocksWithoutTests = manifest.blocks.filter(b => !b.testFile);
if (blocksWithoutTests.length) {
  console.log(`  ⚠️  ${blocksWithoutTests.length} block(s) without test:`);
  for (const b of blocksWithoutTests) console.log(`     • ${b.name}`);
}
