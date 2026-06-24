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
 * UQ-DEEP-AO · AO-3 (2026-06-24) — Manifest drift fix:
 *   • Discovery now walks two curated sub-folders in addition to top-level
 *     src/blocks: `_auto-scaffolded/` (archetype scaffolds, intentional
 *     `_auto_*` underscore prefix) and `featureSimPlugins/` (math probe
 *     sim plugins). Sub-folder entries get path-prefixed names
 *     (e.g. `featureSimPlugins/patternWin`) so they never collide with a
 *     top-level basename like `patternWin`.
 *   • Adds runtime-truthful presence flags per entry — hasEmitCSS,
 *     hasEmitMarkup, hasEmitRuntime, hasResolveConfig, hasDefaultConfig
 *     — sourced from the LIVE imported module (not regex over source),
 *     so audit tooling sees the real surface and reports 0 drift.
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

/**
 * UQ-DEEP-AO · AO-3 — Sub-directories that should be discovered and emitted
 * as separate manifest entries. Without this list, QA-D Block Presentation
 * Audit reports 17 missing blocks (4 _auto-scaffolded + 13 featureSimPlugins).
 *
 * `allowUnderscorePrefix`: top-level scan strips files like `_internal.mjs`,
 * but the `_auto-scaffolded/` folder uses an `_auto_*` naming convention
 * by design — we must include those.
 */
const SUB_BLOCK_DIRS = [
  { dir: '_auto-scaffolded',  allowUnderscorePrefix: true  },
  { dir: 'featureSimPlugins', allowUnderscorePrefix: false },
];

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
 * Try to load module + defaultConfig() from the file. Defensive — if the
 * module throws on load (e.g. depends on browser globals at import time),
 * we record an error and continue.
 *
 * Returns:
 *   cfg              — JSON-serialisable copy of defaultConfig() (or null / error obj)
 *   frozen           — true iff the LIVE config object is Object.isFrozen at scan time
 *                      (UQ-DEEP-AN — manifest must reflect runtime freeze posture)
 *   hasEmitCSS       — module exports any function matching /^emit[A-Z_].*CSS$/ OR `emitCSS`
 *   hasEmitMarkup    — module exports any function matching /^emit[A-Z_].*Markup$/ OR `emitMarkup`
 *   hasEmitRuntime   — module exports any function matching /^emit[A-Z_].*Runtime$/ OR `emitRuntime`
 *   hasResolveConfig — module exports `resolveConfig`
 *   hasDefaultConfig — module exports `defaultConfig`
 *
 * UQ-DEEP-AO · AO-3 — accurate emit / freeze detection sourced from the
 * live module (not regex over source), so manifest matches runtime posture
 * exactly and the drift detector reports 0.
 */
async function loadModuleSnapshot(absPath) {
  try {
    const mod = await import(pathToFileURL(absPath).href);
    const exportKeys = Object.keys(mod);
    const isFn = (k) => typeof mod[k] === 'function';
    const hasEmitCSS = exportKeys.some(
      (k) => isFn(k) && (/^emit[A-Z_].*CSS$/.test(k) || k === 'emitCSS')
    );
    const hasEmitMarkup = exportKeys.some(
      (k) => isFn(k) && (/^emit[A-Z_].*Markup$/.test(k) || k === 'emitMarkup')
    );
    const hasEmitRuntime = exportKeys.some(
      (k) => isFn(k) && (/^emit[A-Z_].*Runtime$/.test(k) || k === 'emitRuntime')
    );
    const hasResolveConfig = isFn('resolveConfig');
    const hasDefaultConfig = isFn('defaultConfig');
    let cfg = null;
    let frozen = false;
    if (hasDefaultConfig) {
      try {
        const liveCfg = mod.defaultConfig();
        frozen = liveCfg !== null
          && typeof liveCfg === 'object'
          && Object.isFrozen(liveCfg);
        /* Only retain JSON-serialisable values — drops Set, Map, Function. */
        cfg = JSON.parse(JSON.stringify(liveCfg));
      } catch (e) {
        cfg = { __error: `defaultConfig() threw: ${e.message}` };
        frozen = false;
      }
    }
    return {
      cfg, frozen,
      hasEmitCSS, hasEmitMarkup, hasEmitRuntime,
      hasResolveConfig, hasDefaultConfig,
    };
  } catch (e) {
    return {
      cfg: { __error: `import failed: ${e.message}` },
      frozen: false,
      hasEmitCSS: false,
      hasEmitMarkup: false,
      hasEmitRuntime: false,
      hasResolveConfig: false,
      hasDefaultConfig: false,
    };
  }
}

/**
 * UQ-DEEP-AO · AO-3 — Discover every `.mjs` block file under src/blocks:
 *   • top-level (excluding `_`-prefixed internals)
 *   • `_auto-scaffolded/*.mjs` (auto-generated archetype scaffolds — the
 *     `_auto_*` underscore prefix is by design, must include)
 *   • `featureSimPlugins/*.mjs` (sim plugins consumed by math probes)
 *
 * Returns `[{ name, file, abs }]` where `name` is path-aware for sub-folder
 * blocks (e.g. `featureSimPlugins/patternWin`) so the manifest never has
 * duplicate keys when two folders share a basename.
 */
function discoverBlocks() {
  const out = [];

  /* Top-level src/blocks/*.mjs (no leading underscore). */
  for (const f of readdirSync(BLOCKS_DIR)) {
    if (!f.endsWith('.mjs') || f.startsWith('_')) continue;
    const abs = resolvePath(BLOCKS_DIR, f);
    if (!statSync(abs).isFile()) continue;
    out.push({
      name: basename(f, '.mjs'),
      file: `src/blocks/${f}`,
      abs,
    });
  }

  /* Curated sub-folders. */
  for (const { dir, allowUnderscorePrefix } of SUB_BLOCK_DIRS) {
    const subDir = resolvePath(BLOCKS_DIR, dir);
    if (!existsSync(subDir)) continue;
    for (const f of readdirSync(subDir)) {
      if (!f.endsWith('.mjs')) continue;
      if (!allowUnderscorePrefix && f.startsWith('_')) continue;
      const abs = resolvePath(subDir, f);
      if (!statSync(abs).isFile()) continue;
      const baseName = basename(f, '.mjs');
      out.push({
        /* Path-prefixed name avoids basename collisions across folders. */
        name: `${dir}/${baseName}`,
        file: `src/blocks/${dir}/${f}`,
        abs,
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/* ── Main ── */

if (!existsSync(BLOCKS_DIR)) {
  console.error(`✗ Blocks dir not found: ${BLOCKS_DIR}`);
  process.exit(1);
}

const discovered = discoverBlocks();

const manifest = {
  generatedAt: new Date().toISOString(),
  blocksDir: 'src/blocks',
  totalBlocks: discovered.length,
  blocks: [],
};

for (const d of discovered) {
  const { name, file: rel, abs } = d;
  const source = readFileSync(abs, 'utf8');
  const loc = source.split('\n').length;
  /* Test file lookup uses the basename only — tests/blocks/<basename>.test.mjs
   * remains the convention; sub-folder blocks rarely have a sibling test and
   * simply emit testFile: null. */
  const baseName = basename(rel, '.mjs');
  const testCandidate = resolvePath(TESTS_DIR, `${baseName}.test.mjs`);
  const testFile = existsSync(testCandidate) ? `tests/blocks/${baseName}.test.mjs` : null;

  const {
    cfg: defaultConfig,
    frozen,
    hasEmitCSS,
    hasEmitMarkup,
    hasEmitRuntime,
    hasResolveConfig,
    hasDefaultConfig,
  } = await loadModuleSnapshot(abs);

  const entry = {
    name,
    file: rel,
    testFile,
    category: categoriseBlock(baseName),
    description: extractDescription(source),
    exports: extractExports(source),
    enabledByDefault:
      defaultConfig && typeof defaultConfig === 'object' && !defaultConfig.__error
        && 'enabled' in defaultConfig
        ? !!defaultConfig.enabled
        : true,
    frozen,
    /* UQ-DEEP-AO · AO-3 — runtime-truthful emit / config presence flags. */
    hasEmitCSS,
    hasEmitMarkup,
    hasEmitRuntime,
    hasResolveConfig,
    hasDefaultConfig,
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
