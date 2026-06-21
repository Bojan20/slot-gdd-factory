#!/usr/bin/env node
/**
 * tools/_wave-w-build-block-catalog.mjs
 *
 * Wave W1 — Block catalog generator (Boki 2026-06-20 "nastavi").
 *
 * Why
 * ---
 * 193 LEGO blocks exist in `src/blocks/`. Each block carries a JSDoc contract
 * header per rule_senior_grade_code §slot block — Purpose, GDD knobs,
 * Public API, Lifecycle, HookBus events. Today this knowledge is implicit
 * — only `buildSlotHTML.mjs` knows which block to mount when. Wave W
 * needs a searchable catalog: which feature kinds map to which blocks,
 * which lifecycle hooks each block subscribes to, which GDD keys each
 * block consumes.
 *
 * What
 * ----
 * Walks `src/blocks/*.mjs`, parses the JSDoc header of each file, and
 * emits `src/registry/blockCatalog.json` (and a markdown sibling for
 * humans).
 *
 * Per-block schema
 *   {
 *     id:              "<basename without .mjs>",
 *     file:            "src/blocks/<basename>.mjs",
 *     purpose:         "<first prose line after the title>",
 *     gddKeys:         ["<knob name>", ...],
 *     publicApi:       ["<exported fn>", ...],
 *     lifecycleHooks:  ["preSpin", "onSpinResult", ...],
 *     emits:           ["<HookBus event>", ...],
 *     subscribes:      ["<HookBus event>", ...],
 *     conflictsWith:   ["<block id>", ...],
 *     intentStrings:   ["<keyword>", ...],
 *     featureKinds:    ["<canonical kind from feature catalog>", ...],
 *     loc:             <line count>
 *   }
 *
 * Output
 *   src/registry/blockCatalog.json    — full catalog (machine-readable)
 *   src/registry/blockCatalog.md      — human-browsable index
 *
 * Public — usable by:
 *   tools/_wave-w-block-mapper.mjs (W2)
 *   tools/_wave-w-block-scorer.mjs (W3)
 *   gddRealityCheck.mjs (cross-check declared features against catalog)
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO      = resolve(__dirname, '..');
const BLOCKS    = resolve(REPO, 'src/blocks');
const OUT_JSON  = resolve(REPO, 'src/registry/blockCatalog.json');
const OUT_MD    = resolve(REPO, 'src/registry/blockCatalog.md');

/* Canonical feature kinds from src/parser.mjs FEATURE_KEYWORD_MAP +
 * Wave V V3_FEATURE.md catalog. Used to detect which kinds a block claims
 * to own based on its filename + purpose strings. */
const FEATURE_KIND_CATALOG = Object.freeze([
  'freeSpins', 'holdAndWin', 'bonusBuy', 'bonusPick', 'wheelBonus', 'gamble',
  'multiplierOrb', 'persistentMultiplier', 'randomLightningMultiplier',
  'stickyWild', 'expandingWild', 'walkingWild', 'wildReel', 'mysterySymbol',
  'superSymbol', 'clusterPaysEval', 'waysEval', 'payAnywhereEval', 'tumble',
  'anteBet', 'respin', 'autoplay', 'bigWinTier', 'winCap', 'jackpot',
  'scatterCelebration', 'lightning', 'cascade', 'paylines', 'paytable',
  'patternWin', 'bigSymbolRender2x2', 'linkedReels', 'perTriggerVolatilitySet',
  'potSymbolFireball', 'grandInterruptionLock',
  'simultaneousFsHoldAndWinPriority', 'creditAwardConversion',
  'pathAwareMultiplier', 'wildCollisionMultiplier', 'storm',
  'achievement', 'colorblind', 'gddRealityCheck',
]);

/* ── JSDoc extractors ─────────────────────────────────────────────────── */

function _extractJsDocBlock(source) {
  /* First leading /** ... * /  block. */
  const m = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  return m ? m[1] : '';
}

function _stripStarPrefix(line) {
  return line.replace(/^\s*\*\s?/, '');
}

function _extractPurpose(jsdoc) {
  /* First non-empty prose line after the title (filename) and any blank
   * separator, falling back to any explicit "Purpose:" section. */
  const lines = jsdoc.split('\n').map(_stripStarPrefix);
  /* Look for explicit `Purpose:` block */
  const idxP = lines.findIndex((l) => /^Purpose\b/i.test(l));
  if (idxP >= 0) {
    /* Concatenate following indented prose lines until blank */
    const acc = [];
    for (let i = idxP + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || /^[A-Z][a-zA-Z ]{2,}:/.test(t)) break;
      acc.push(t);
    }
    if (acc.length) return acc.join(' ').slice(0, 240);
  }
  /* Fallback: first prose line of substance (skip title) */
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && !t.startsWith('src/') && !t.startsWith('@module') && t.length > 12) {
      return t.slice(0, 240);
    }
  }
  return '';
}

function _extractListSection(jsdoc, headerRegex) {
  /* Returns array of bullets between a named header line and the next blank
   * gap or new header. */
  const lines = jsdoc.split('\n').map(_stripStarPrefix);
  const idx = lines.findIndex((l) => headerRegex.test(l));
  if (idx < 0) return [];
  const acc = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      if (acc.length) break;          /* stop on first blank after content */
      else continue;
    }
    if (/^[A-Z][a-zA-Z ]{2,}:/.test(t)) break;
    /* split bullet markers */
    const bullets = t.split(/[•·]\s*|^[\-*]\s*|,\s+/g).map((s) => s.trim()).filter(Boolean);
    for (const b of bullets) acc.push(b.slice(0, 160));
  }
  return acc;
}

function _extractGddKeys(jsdoc) {
  /* Match `• keyName: ...` or `keyName: ...` from a GDD knobs section. */
  const lines = jsdoc.split('\n').map(_stripStarPrefix);
  const idx = lines.findIndex((l) => /GDD knobs/i.test(l));
  if (idx < 0) return [];
  const keys = new Set();
  for (let i = idx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      if (keys.size) break;
      else continue;
    }
    if (/^[A-Z][a-zA-Z ]{2,}:/.test(t)) break;
    /* Match `[•·\-]?\s*\bkeyName\b:` pattern */
    const km = t.match(/^[•·\-*]?\s*\b([a-zA-Z_][a-zA-Z0-9_]*)\s*[:—]/);
    if (km) keys.add(km[1]);
  }
  return Array.from(keys);
}

function _extractPublicApi(source) {
  /* exported function names from the runtime emitter side. */
  const out = new Set();
  const re = /export\s+(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(source)) != null) out.add(m[1]);
  return Array.from(out);
}

function _extractEmits(source) {
  /* HookBus.emit('<name>'…  AND nested template literals.
   * Source-of-truth for sole-owner events. */
  const out = new Set();
  const re = /HookBus\.emit\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g;
  let m;
  while ((m = re.exec(source)) != null) out.add(m[1]);
  return Array.from(out);
}

function _extractSubscribes(source) {
  const out = new Set();
  const re = /HookBus\.on\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g;
  let m;
  while ((m = re.exec(source)) != null) out.add(m[1]);
  return Array.from(out);
}

function _extractIntents(jsdoc, purpose) {
  /* Pull domain keywords from JSDoc body: wild, scatter, free spins,
   * cluster, multiplier, jackpot, etc. Used by mapper for fuzzy match. */
  const text = (jsdoc + ' ' + purpose).toLowerCase();
  const candidates = [
    'free spins', 'hold and win', 'hold & win', 'cluster pays', 'cascade',
    'tumble', 'sticky wild', 'expanding wild', 'walking wild', 'wild reel',
    'multiplier', 'multiplier orb', 'persistent multiplier', 'lightning',
    'bonus buy', 'bonus pick', 'wheel bonus', 'gamble', 'respin',
    'pay anywhere', 'megaways', 'ways', 'mystery symbol', 'super symbol',
    'big win', 'win cap', 'jackpot', 'ante bet', 'autoplay', 'paylines',
    'paytable', 'scatter', 'reality check', 'compliance', 'jurisdiction',
  ];
  return candidates.filter((c) => text.includes(c));
}

function _matchFeatureKinds(blockId, purpose, intents) {
  /* Heuristic: block file basename most often matches canonical kind. */
  const out = new Set();
  for (const k of FEATURE_KIND_CATALOG) {
    if (blockId.toLowerCase() === k.toLowerCase()) out.add(k);
    if (blockId.toLowerCase().startsWith(k.toLowerCase())) out.add(k);
  }
  /* Backstop: scan purpose for canonical kind strings. */
  const haystack = (purpose + ' ' + intents.join(' ')).toLowerCase();
  for (const k of FEATURE_KIND_CATALOG) {
    if (haystack.includes(k.toLowerCase())) out.add(k);
  }
  return Array.from(out);
}

/* ── per-file analysis ────────────────────────────────────────────────── */

async function analyzeBlock(file) {
  const id = basename(file, '.mjs');
  const source = await readFile(file, 'utf8');
  const jsdoc = _extractJsDocBlock(source);
  const loc = source.split('\n').length;

  const purpose = _extractPurpose(jsdoc);
  const gddKeys = _extractGddKeys(jsdoc);
  const publicApi = _extractPublicApi(source);
  const emits = _extractEmits(source);
  const subscribes = _extractSubscribes(source);
  const intents = _extractIntents(jsdoc, purpose);
  const featureKinds = _matchFeatureKinds(id, purpose, intents);

  /* Lifecycle hooks = the canonical lifecycle event names this block
   * subscribes to. We filter from `subscribes` to the well-known set. */
  const LIFECYCLE_HOOKS = new Set([
    'preSpin', 'postSpin', 'onSpinResult', 'onTumbleStep',
    'onFsTrigger', 'onFsEnter', 'onFsSpinResult', 'onFsEnd',
    'onRespinAwarded', 'onRoundEnd', 'onFsIntro', 'onFsActive',
    'onSlamStop', 'onBetChanged', 'onMultChange', 'onAutoplayStart',
    'onAutoplayEnd',
  ]);
  const lifecycleHooks = subscribes.filter((s) => LIFECYCLE_HOOKS.has(s));

  return {
    id,
    file: `src/blocks/${id}.mjs`,
    purpose,
    gddKeys,
    publicApi,
    lifecycleHooks,
    emits,
    subscribes,
    intentStrings: intents,
    featureKinds,
    conflictsWith: [],   /* filled in cross-pass below */
    loc,
  };
}

/* Cross-pass: detect intra-catalog conflicts. Two blocks claiming the
 * SAME canonical featureKind without sharing a deps/peer relation are
 * candidates for conflictsWith. Examples: expandingWild vs walkingWild
 * (both modify wild placement) — Wave W4 conflict resolver consumes this. */
function _crossLinkConflicts(catalog) {
  const byKind = new Map();
  for (const b of catalog) {
    for (const k of b.featureKinds) {
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k).push(b.id);
    }
  }
  /* Hand-curated mutually-exclusive families that share a domain. */
  const FAMILIES = [
    ['expandingWild', 'walkingWild', 'stickyWild', 'wildReel'],
    ['clusterPaysEval', 'waysEval', 'payAnywhereEval', 'paylines'],
    ['holdAndWin', 'respin'],
  ];
  for (const family of FAMILIES) {
    const inFamily = catalog.filter((b) => family.some((k) => b.id === k || b.featureKinds.includes(k)));
    for (const b of inFamily) {
      for (const peer of inFamily) {
        if (peer.id === b.id) continue;
        if (!b.conflictsWith.includes(peer.id)) b.conflictsWith.push(peer.id);
      }
    }
  }
}

/* ── markdown export ─────────────────────────────────────────────────── */

function _toMarkdown(catalog) {
  const lines = [
    '# Slot GDD Factory · block catalog (Wave W1)',
    '',
    '> Auto-generated from `src/blocks/*.mjs` JSDoc contract headers.',
    '> Regenerate with `node tools/_wave-w-build-block-catalog.mjs`.',
    '',
    `**${catalog.length} blocks indexed**`,
    '',
    '| Block | Purpose (one-line) | GDD keys | Emits | Subscribes | Feature kinds |',
    '|:--|:--|:--|:--|:--|:--|',
  ];
  for (const b of catalog) {
    const fmt = (arr) => (arr.length ? arr.slice(0, 4).join(', ') + (arr.length > 4 ? ' …' : '') : '—');
    const purposeShort = (b.purpose || '').slice(0, 80).replace(/\|/g, '\\|');
    lines.push(
      `| \`${b.id}\` | ${purposeShort} | ${fmt(b.gddKeys)} | ${fmt(b.emits)} | ${fmt(b.lifecycleHooks)} | ${fmt(b.featureKinds)} |`
    );
  }
  return lines.join('\n');
}

/* ── main ─────────────────────────────────────────────────────────────── */

async function main() {
  const entries = await readdir(BLOCKS);
  const files = entries.filter((f) => f.endsWith('.mjs')).map((f) => resolve(BLOCKS, f));
  console.log(`Indexing ${files.length} blocks from ${BLOCKS}`);

  const catalog = await Promise.all(files.map(analyzeBlock));
  _crossLinkConflicts(catalog);

  /* Sort by id for deterministic output. */
  catalog.sort((a, b) => a.id.localeCompare(b.id));

  /* Wave UQ-FORTIFY4 H9 — file lock + atomic write so concurrent
   * scaffolder + manual catalog regen don't race-overwrite each other. */
  const { acquireLock: _cAcq, releaseLock: _cRel } = await import('../src/registry/fileLock.mjs');
  const { renameSync: _cRename } = await import('node:fs');
  const _catTok = _cAcq(OUT_JSON);
  try {
    const payload = JSON.stringify({
      generatedAt: new Date().toISOString(),
      blockCount:  catalog.length,
      catalog,
    }, null, 2);
    const tmpJson = OUT_JSON + '.tmp.' + process.pid;
    await writeFile(tmpJson, payload, 'utf8');
    _cRename(tmpJson, OUT_JSON);
    const tmpMd = OUT_MD + '.tmp.' + process.pid;
    await writeFile(tmpMd, _toMarkdown(catalog), 'utf8');
    _cRename(tmpMd, OUT_MD);
  } finally {
    _cRel(_catTok);
  }

  /* Summary stats */
  const withPurpose = catalog.filter((b) => b.purpose).length;
  const withGddKeys = catalog.filter((b) => b.gddKeys.length).length;
  const withEmits   = catalog.filter((b) => b.emits.length).length;
  const withKinds   = catalog.filter((b) => b.featureKinds.length).length;
  const withSubs    = catalog.filter((b) => b.subscribes.length).length;
  const totalEmits  = catalog.reduce((s, b) => s + b.emits.length, 0);
  const totalKinds  = catalog.reduce((s, b) => s + b.featureKinds.length, 0);

  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('Wave W1 block catalog');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  blocks indexed:        ${catalog.length}`);
  console.log(`  with purpose line:     ${withPurpose}`);
  console.log(`  with GDD knobs:        ${withGddKeys}`);
  console.log(`  with HookBus emits:    ${withEmits}  (Σ ${totalEmits} events)`);
  console.log(`  with HookBus subs:     ${withSubs}`);
  console.log(`  with featureKinds:     ${withKinds}  (Σ ${totalKinds} kinds)`);
  console.log('');
  console.log(`  → ${OUT_JSON}`);
  console.log(`  → ${OUT_MD}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
