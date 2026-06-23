#!/usr/bin/env node
/**
 * tools/v8-assembly-orchestrator.mjs
 *
 * Wave UQ-MASTERY-5 — V8 Game Assembly Orchestrator.
 *
 * Boki: "kreni redom ultimativno" (uq-mastery-4 → v8). Implements the
 * V8 agent contract (agents/V8_GAME_ASSEMBLY.md): take a parsed model
 * (V6 reconcile output), pure-rules-engine decide which blocks are
 * enabled / disabled / conflicting, emit assembly receipt.
 *
 * INPUT
 *   --slug <name>    → load dist/real-games/<slug>/model.json (single)
 *   --limit N        → walk first N slugs (smoke)
 *   (no args)        → walk all dist/real-games/*\/model.json
 *
 * OUTPUT
 *   reports/v8-assembly-<ts>.json (full receipt per slug)
 *   stdout summary table
 *
 * EXIT
 *   0 — every receipt verdict=PASS, 0 conflicts
 *   1 — ≥ 1 receipt verdict=FAIL or any conflict reported
 *
 * NO LLM. Pure deterministic rule engine. LLM escalation hook lives
 * in `escalateToLLM(question, ruleDeadlock)` but is OFF by default
 * (commented out — would call cortex-fable-ask if enabled).
 *
 * --------------------------------------------------------------------
 * LIBRARY MODE (N+1 LIVE WIRE 2026-06-23)
 * --------------------------------------------------------------------
 * Export-ovana `assemble(slug, model)` funkcija dozvoljava ingest.mjs
 * pipeline-u (i bilo kom drugom alatu) da pozove rule engine sinhrono,
 * bez CLI overhead-a — receipt se emit-uje direktno u memoriji za
 * dalju serijalizaciju u `dist/ingest/<slug>/v8.json` + embed kao
 * `<meta name="v8-receipt" content="<base64-json>">` u HTML output.
 *
 * CLI mod (walk-all-slugs) ostaje aktivan i ne menja ponašanje — guard
 * `if (import.meta.url === pathToFileURL(process.argv[1]).href)` odvaja
 * CLI od library import-a, tako da `import` ne izvršava walker.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const OUT_DIR    = `${REPO}/reports`;
const RULES_FILE = `${REPO}/tools/v8-assembly-rules.json`;
const CATALOG    = `${REPO}/src/registry/blockCatalog.json`;

/* ── Load rules + catalog (eager; idempotent so library mode safe) ─── */
const rules = JSON.parse(readFileSync(RULES_FILE, 'utf8'));
const catalogRaw = JSON.parse(readFileSync(CATALOG, 'utf8'));
const blockSet = new Set(Object.values(catalogRaw.catalog || {}).map(b => b.id));

/* Build feature kinds → blocks index (from catalog metadata).
 * Catalog `featureKinds: [...]` declares which feature(s) this block
 * implements. V8 uses this as the primary mapping; v8-rules.json is the
 * supplementary table for cases where catalog metadata is sparse. */
const FEATURE_TO_BLOCKS = {};
for (const block of Object.values(catalogRaw.catalog || {})) {
  for (const k of (block.featureKinds || [])) {
    FEATURE_TO_BLOCKS[k] = FEATURE_TO_BLOCKS[k] || [];
    FEATURE_TO_BLOCKS[k].push(block.id);
  }
}

/* ── Helpers (exported for library users) ─────────────────────────── */
export function jurCodes(model) {
  const c = model.compliance;
  const arr = Array.isArray(c) ? c
            : Array.isArray(c?.jurisdictions) ? c.jurisdictions
            : [];
  return arr.map(j => typeof j === 'string' ? j : (j?.code || j?.id || j?.name)).filter(Boolean);
}

export function featureSet(model) {
  const set = new Set();
  if (Array.isArray(model.features)) {
    for (const f of model.features) set.add(typeof f === 'string' ? f : (f?.kind || f?.id || ''));
  }
  // Top-level feature config objects with enabled=true imply the feature.
  const TOP_KEYS = [
    ['freeSpins', 'free_spins'],
    ['holdAndWin', 'hold_and_win'],
    ['tumble', 'tumble'],
    ['bonusBuy', 'bonus_buy'],
    ['anteBet', 'ante_bet'],
    ['gamble', 'gamble'],
    ['wheelBonus', 'wheel_bonus'],
    ['bonusPick', 'bonus_pick'],
    ['multiplierOrb', 'multiplier'],
    ['expandingWild', 'expanding_wild'],
    ['stickyWild', 'sticky_wild'],
    ['walkingWild', 'walking_wild'],
    ['mysterySymbol', 'mystery_symbol'],
    ['jackpot', 'jackpot'],
    ['lightning', 'lightning'],
    ['winCap', 'win_cap'],
    ['realityCheck', 'reality_check'],
    ['autoplay', 'autoplay'],
    ['persistentMultiplier', 'persistent_multiplier'],
    ['superSymbol', 'super_symbol'],
    ['progressiveFreeSpins', 'progressive_fs'],
  ];
  for (const [key, feat] of TOP_KEYS) {
    const v = model[key];
    if (v?.enabled === true) set.add(feat);
  }
  // Topology-evaluation maps to a feature.
  const ev = model.topology?.evaluation;
  if (ev === 'cluster_pays' || ev === 'cluster') set.add('cluster_pays');
  if (ev === 'ways') set.add('ways');
  if (ev === 'pay_anywhere') set.add('pay_anywhere');
  if (ev === 'scatter_pay') set.add('scatter_pay');
  set.delete('');
  return set;
}

function matchWhen(when, model) {
  // Evaluate dotted-path when each key
  for (const [path, expected] of Object.entries(when)) {
    const got = getPath(model, path);
    if (got !== expected) return false;
  }
  return true;
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/* ── Single-model assembly (PUBLIC API — used by ingest.mjs live wire) */
export function assemble(slug, model) {
  const enabled  = new Map();   // blockId → reason
  const disabled = new Map();   // blockId → reason
  const conflicts = [];
  const warnings  = [];

  function enable(id, reason) {
    if (!blockSet.has(id)) {
      warnings.push({ slug, code: 'W1.unknown_block', msg: `rule wants enable '${id}' but not in blockCatalog (skipped)` });
      return;
    }
    if (!enabled.has(id)) enabled.set(id, reason);
  }
  function disable(id, reason) {
    if (!blockSet.has(id)) return;
    if (!disabled.has(id)) disabled.set(id, reason);
  }

  /* 1. Topology engine selection (mutually exclusive) */
  const topo = rules.topologyEngines;
  let selectedEngine = null;
  for (const r of topo.rules) {
    if (r.when && matchWhen(r.when, model)) {
      selectedEngine = r.select;
      enable(selectedEngine, r.reason);
      break;
    }
  }
  if (!selectedEngine) {
    const def = topo.rules.find(r => r.default);
    if (def) {
      selectedEngine = def.default;
      enable(selectedEngine, def.reason);
    }
  }
  // Disable all other engines
  for (const eng of topo.engines) {
    if (eng !== selectedEngine) disable(eng, `engine ${selectedEngine} selected — ${eng} mutually exclusive`);
  }

  /* 2. Mandatory core blocks */
  for (const m of rules.mandatoryCore.blocks) enable(m.id, m.reason);

  /* 3. Feature flag activation (catalog + supplementary rules) */
  const feats = featureSet(model);
  for (const fr of rules.featureFlags.rules) {
    if (feats.has(fr.feature)) {
      for (const id of (fr.enable || [])) enable(id, fr.reason);
      for (const id of (fr.disable || [])) disable(id, fr.reason);
    }
  }
  // Also pull from catalog feature kinds for blocks the supplementary rules
  // didn't explicitly mention (e.g., niche kinds).
  for (const f of feats) {
    for (const id of (FEATURE_TO_BLOCKS[f] || [])) {
      if (!enabled.has(id) && !disabled.has(id)) enable(id, `catalog featureKinds=${f}`);
    }
  }

  /* 4. Jurisdiction gates */
  const jur = jurCodes(model);
  const jurSet = new Set(jur);
  for (const jr of rules.jurisdictionGates.rules) {
    if (jr.codes.some(c => jurSet.has(c))) {
      for (const id of jr.enable) enable(id, jr.reason);
    }
  }

  /* 5. Audit-trail pins (cannot be disabled by any GDD signal) */
  for (const id of rules.auditTrailPins.blocks) {
    if (disabled.has(id)) {
      // Override: audit pins always win
      disabled.delete(id);
      enable(id, 'audit-trail pin — cannot be disabled');
    } else if (!enabled.has(id) && blockSet.has(id)) {
      enable(id, 'audit-trail pin — always on');
    }
  }

  /* 6. Conflict detection */
  for (const [a, b] of rules.conflictMatrix.pairs) {
    if (enabled.has(a) && enabled.has(b)) {
      conflicts.push({ slug, blocks: [a, b], reasons: [enabled.get(a), enabled.get(b)] });
    }
  }

  /* 7. Mandatory-block sanity (verdict FAIL if a mandatory block ends up disabled) */
  let missingMandatory = [];
  for (const m of rules.mandatoryCore.blocks) {
    if (!enabled.has(m.id) && blockSet.has(m.id)) {
      missingMandatory.push(m.id);
    }
  }
  // Jurisdiction gate sanity
  let missingJurGates = [];
  for (const jr of rules.jurisdictionGates.rules) {
    if (jr.codes.some(c => jurSet.has(c))) {
      for (const id of jr.enable) {
        if (blockSet.has(id) && !enabled.has(id)) missingJurGates.push({ code: jr.codes[0], block: id });
      }
    }
  }

  const verdict = (
    conflicts.length === 0 &&
    missingMandatory.length === 0 &&
    missingJurGates.length === 0
  ) ? 'PASS' : 'FAIL';

  return {
    wave: 'UQ-MASTERY-5',
    agent: 'V8_GAME_ASSEMBLY',
    slug,
    verdict,
    assembly: {
      enabledBlocks: [...enabled.keys()].sort(),
      disabledBlocks: [...disabled.keys()].sort(),
      reasonByBlock: Object.fromEntries([...enabled.entries(), ...disabled.entries()]),
    },
    conflicts,
    warnings,
    missingMandatory,
    missingJurGates,
    __meta__: {
      ts: new Date().toISOString(),
      enabledCount: enabled.size,
      disabledCount: disabled.size,
      featuresDetected: [...feats],
      jurisdictionsDetected: jur,
      selectedEngine,
    },
  };
}

/* ── CLI walker (only runs when invoked as `node tools/v8-...`) ──────
 * Library importers (ingest.mjs, tests) do NOT execute this branch —
 * import.meta.url match against pathToFileURL(process.argv[1]) is the
 * canonical Node ES-module CLI guard. Without it, just importing this
 * module from ingest would walk all 338 GDDs and exit the process. */
const IS_CLI = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  } catch (_) {
    return false;
  }
})();

function listSlugs(SLUG, LIMIT) {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing.`);
    process.exit(2);
  }
  const all = readdirSync(REAL_GAMES).filter(d => {
    const p = join(REAL_GAMES, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'model.json'));
  });
  if (SLUG) return all.filter(d => d === SLUG);
  if (LIMIT) return all.slice(0, LIMIT);
  return all;
}

if (IS_CLI) {
  const args = process.argv.slice(2);
  const argVal = (flag) => {
    const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
    if (idx === -1) return null;
    const a = args[idx];
    return a.includes('=') ? a.split('=')[1] : args[idx + 1];
  };
  const SLUG  = argVal('--slug') || null;
  const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;

  mkdirSync(OUT_DIR, { recursive: true });
  const slugs = listSlugs(SLUG, LIMIT);
  if (slugs.length === 0) {
    console.error('▸ no model.json files found');
    process.exit(2);
  }

  console.log(`V8 Assembly Orchestrator · processing ${slugs.length} models...`);

  const receipts = [];
  let passCount = 0, failCount = 0, totalConflicts = 0;
  for (const slug of slugs) {
    let model;
    try {
      model = JSON.parse(readFileSync(join(REAL_GAMES, slug, 'model.json'), 'utf8'));
    } catch (e) {
      receipts.push({ slug, verdict: 'FAIL', error: `model.json unreadable: ${e.message}` });
      failCount++;
      continue;
    }
    const receipt = assemble(slug, model);
    receipts.push(receipt);
    if (receipt.verdict === 'PASS') passCount++; else failCount++;
    totalConflicts += receipt.conflicts.length;
  }

  const ts = new Date().toISOString();
  const summary = {
    generatedAt: ts,
    tool: 'tools/v8-assembly-orchestrator.mjs',
    gamesProcessed: receipts.length,
    passCount,
    failCount,
    totalConflicts,
    failedSlugs: receipts.filter(r => r.verdict === 'FAIL').slice(0, 50).map(r => ({
      slug: r.slug,
      error: r.error,
      conflicts: r.conflicts,
      missingMandatory: r.missingMandatory,
      missingJurGates: r.missingJurGates,
    })),
  };

  const reportFile = join(OUT_DIR, `v8-assembly-${ts.replace(/[:.]/g, '-')}.json`);
  writeFileSync(reportFile, JSON.stringify({ summary, receipts }, null, 2));

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`V8 Assembly Orchestrator · processed ${receipts.length} games`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  PASS: ${passCount}`);
  console.log(`  FAIL: ${failCount}`);
  console.log(`  Conflicts total: ${totalConflicts}`);
  if (failCount > 0) {
    console.log('  First failed slugs:');
    for (const r of receipts.filter(x => x.verdict === 'FAIL').slice(0, 5)) {
      const detail = [
        r.error,
        r.conflicts?.length ? `conflicts=${JSON.stringify(r.conflicts.map(c => c.blocks))}` : '',
        r.missingMandatory?.length ? `missingMandatory=${JSON.stringify(r.missingMandatory)}` : '',
        r.missingJurGates?.length ? `missingJurGates=${JSON.stringify(r.missingJurGates)}` : '',
      ].filter(Boolean).join(' · ');
      console.log(`    - ${r.slug}: ${detail || 'unknown reason'}`);
    }
  }
  console.log(`  Report: ${reportFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (failCount > 0 || totalConflicts > 0) {
    console.log('✗ FAIL');
    process.exit(1);
  }
  console.log('✓ PASS — 0 assembly conflicts, 0 mandatory misses');
  process.exit(0);
}
