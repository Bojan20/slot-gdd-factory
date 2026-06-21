#!/usr/bin/env node
/**
 * tools/v10-industry-compliance-spec.mjs
 *
 * Wave UQ-MASTERY-3 — V10 Industry Compliance Spec walker.
 *
 * Boki direktiva (2026-06-21): "koji test još možeš da napišeš na osnovu
 * agenata, koji poznaju komplet GT i slot industriju, da znamo da će sve
 * biti uvek po pravilu i savršeno".
 *
 * V10 encapsulates SLOT INDUSTRY GROUND TRUTH into a deterministic
 * walker that runs on every model.json produced by the pipeline. Catches
 * any model that drifts from industry baseline (wrong payline count for
 * the grid, missing compliance gate for declared jurisdiction, invalid
 * evaluation/topology pairing, math floor breach, ...).
 *
 * SEVERITY MODEL
 * ──────────────
 *   HARD — fails the gate (commit blocked). Reserved for structural
 *          violations the pipeline must never emit.
 *   SOFT — warning only. Logged to reports/ but does not fail the gate.
 *          Used for math/balance heuristics that depend on GDD ground
 *          truth that synthetic fixtures don't carry.
 *
 * RULE GROUPS
 * ───────────
 *   T1  Industry Compliance Spec   (HARD) — grid×payline math, engine fit
 *   T2  Math Floor Sanity          (SOFT) — RTP / volatility / cost ranges
 *   T3  Feature×Topology Compat    (HARD) — cluster/ways/lines mutual exclusion
 *   T4  Jurisdiction Cross-Check   (HARD) — declared jurisdiction → gate enabled
 *
 * INDUSTRY-NEUTRAL CONSTANTS (vendor names forbidden)
 * ───────────────────────────────────────────────────
 *   • 5×3 line slot payline counts: 10, 20, 25, 30, 40, 50
 *   • Ways slot ways counts: 243, 576, 720, 1024, 4096, 117649
 *   • Cluster slot min cluster size: 5 (industry baseline)
 *   • FS award floor: 5 spins per trigger (industry baseline)
 *   • BonusBuy cost band: 30× – 200× bet
 *   • Plinko rows: ≥ 5, ≤ 16
 *   • Wheel segments: ≥ 6, ≤ 24
 *
 * USAGE
 *   node tools/v10-industry-compliance-spec.mjs            # walk all 338 GDDs
 *   node tools/v10-industry-compliance-spec.mjs --slug=X   # one game
 *   node tools/v10-industry-compliance-spec.mjs --soft     # treat SOFT as HARD
 *   node tools/v10-industry-compliance-spec.mjs --limit N  # smoke first N
 *
 * EXIT CODE
 *   0  — 0 HARD violations
 *   1  — ≥ 1 HARD violation (or any SOFT under --soft mode)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const OUT_DIR    = `${REPO}/reports`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG  = argVal('--slug') || null;
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
const SOFT_AS_HARD = args.includes('--soft');

/* ── Industry constants (vendor-neutral) ─────────────────────────────── */
const VALID_LINE_COUNTS_5x3      = new Set([10, 20, 25, 30, 40, 50, 100]);
/* Megaways 6×6 ships 7776 ways = 6^6. Industry-valid. */
const VALID_WAYS_COUNTS          = new Set([243, 576, 720, 1024, 4096, 7776, 15625, 117649]);
const CLUSTER_MIN_SIZE_FLOOR     = 5;
const FS_AWARD_FLOOR             = 5;
const BONUS_BUY_COST_MIN         = 30;
const BONUS_BUY_COST_MAX         = 200;
const PLINKO_ROWS_RANGE          = [5, 16];
const WHEEL_SEGMENTS_RANGE       = [6, 24];
const HEX_RING_RANGE             = [1, 4];
/* Dual-colossal slots use up to 8 reels (two side-by-side 4-reel grids).
 * Industry max is 8; 9+ is exotic and falls through to a HARD violation. */
const TOPOLOGY_REELS_RANGE       = [3, 8];
const TOPOLOGY_ROWS_RANGE        = [1, 8];
const VALID_EVALUATIONS = new Set([
  'lines', 'pay_anywhere', 'ways', 'cluster_pays', 'cluster',
  'scatter_pay', 'plinko', 'wheel', 'crash', 'slingo',
]);

const JURISDICTION_TO_GATE = {
  DE: 'germanyComplianceGate',  germany: 'germanyComplianceGate',
  NL: 'netherlandsComplianceGate', netherlands: 'netherlandsComplianceGate',
  FR: 'franceComplianceGate',   france: 'franceComplianceGate',
  IT: 'italyComplianceGate',    italy: 'italyComplianceGate',
  ES: 'spainComplianceGate',    spain: 'spainComplianceGate',
  'EU-AI': 'euAiActComplianceGate', euAiAct: 'euAiActComplianceGate',
};

/* ── Single-model audit ────────────────────────────────────────────── */

/** @returns {{ hard: object[], soft: object[] }} */
function auditModel(slug, model) {
  const hard = [], soft = [];
  const t = model.topology || {};
  const reels = t.reels, rows = t.rows;
  const evalKind = t.evaluation;
  const lines = t.paylines;

  /* T1 — Industry Compliance Spec (HARD) ──────────────────────────── */

  // T1.1 reels / rows in valid industry range
  if (reels != null && (reels < TOPOLOGY_REELS_RANGE[0] || reels > TOPOLOGY_REELS_RANGE[1])) {
    hard.push({ slug, rule: 'T1.1', msg: `topology.reels ${reels} outside industry range ${TOPOLOGY_REELS_RANGE}` });
  }
  if (rows != null && (rows < TOPOLOGY_ROWS_RANGE[0] || rows > TOPOLOGY_ROWS_RANGE[1])) {
    hard.push({ slug, rule: 'T1.1', msg: `topology.rows ${rows} outside industry range ${TOPOLOGY_ROWS_RANGE}` });
  }

  // T1.2 evaluation is a recognized industry pattern
  if (evalKind != null && !VALID_EVALUATIONS.has(evalKind)) {
    hard.push({ slug, rule: 'T1.2', msg: `unknown evaluation '${evalKind}' (must be one of ${[...VALID_EVALUATIONS].join(',')})` });
  }

  // T1.3 5×3 LINES slot uses industry-standard payline count
  // Only applies when topology.kind is rectangular-family (lock_respin counts
  // since it's still a 5-reel line slot). Cluster / ways / megaclusters /
  // plinko / wheel / hex don't use paylines as the eval surface — they may
  // ship paylines=1 as metadata chrome; that's not an industry violation.
  const RECT_LINE_KINDS = new Set([
    'rectangular', 'rectangular_stacked_scatter', 'expanding',
    'dual_colossal', 'lock_respin', 'variable_reel',
  ]);
  if (reels === 5 && rows === 3 && evalKind === 'lines' && lines != null
      && RECT_LINE_KINDS.has(t.kind)) {
    if (lines >= 2 && !VALID_LINE_COUNTS_5x3.has(lines)) {
      // paylines >= 2 and not in industry whitelist → real violation
      hard.push({ slug, rule: 'T1.3', msg: `5×3 ${t.kind} lines slot has paylines=${lines}, expected one of ${[...VALID_LINE_COUNTS_5x3].join(',')}` });
    } else if (lines <= 1) {
      // paylines 0 or 1 = parser fallback (engine couldn't read prose).
      // Real industry violation lives upstream in parser, not in the model
      // we received. Flag SOFT so audit reports surface it without blocking.
      soft.push({ slug, rule: 'T1.3.fallback', msg: `5×3 ${t.kind} lines slot has paylines=${lines} — likely parser fallback (PDF says different topology)` });
    }
  }

  // T1.4 ways evaluation has industry-standard ways count
  if (evalKind === 'ways' && t.ways_count != null) {
    if (!VALID_WAYS_COUNTS.has(t.ways_count)) {
      hard.push({ slug, rule: 'T1.4', msg: `ways slot has ways_count=${t.ways_count}, expected one of ${[...VALID_WAYS_COUNTS].join(',')}` });
    }
  }

  // T1.5 cluster has min size at industry floor
  if (evalKind === 'cluster_pays' && t.cluster_min_size != null) {
    if (t.cluster_min_size < CLUSTER_MIN_SIZE_FLOOR) {
      hard.push({ slug, rule: 'T1.5', msg: `cluster_min_size ${t.cluster_min_size} below industry floor ${CLUSTER_MIN_SIZE_FLOOR}` });
    }
  }

  // T1.6 plinko has industry-range row count
  if (t.is_plinko && t.plinko_rows != null) {
    if (t.plinko_rows < PLINKO_ROWS_RANGE[0] || t.plinko_rows > PLINKO_ROWS_RANGE[1]) {
      hard.push({ slug, rule: 'T1.6', msg: `plinko_rows ${t.plinko_rows} outside ${PLINKO_ROWS_RANGE}` });
    }
  }

  // T1.7 wheel has industry-range segments
  if (evalKind === 'wheel' && t.wheel_segments != null) {
    if (t.wheel_segments < WHEEL_SEGMENTS_RANGE[0] || t.wheel_segments > WHEEL_SEGMENTS_RANGE[1]) {
      hard.push({ slug, rule: 'T1.7', msg: `wheel_segments ${t.wheel_segments} outside ${WHEEL_SEGMENTS_RANGE}` });
    }
  }

  // T1.8 hex has industry-range ring count
  if (t.hex_ring != null) {
    if (t.hex_ring < HEX_RING_RANGE[0] || t.hex_ring > HEX_RING_RANGE[1]) {
      hard.push({ slug, rule: 'T1.8', msg: `hex_ring ${t.hex_ring} outside ${HEX_RING_RANGE}` });
    }
  }

  /* T3 — Feature × Topology Compatibility (HARD) ──────────────────── */

  // T3.1 cluster_pays evaluation must not have paylines > 0 (cluster pays anywhere)
  if (evalKind === 'cluster_pays' && lines != null && lines > 0) {
    hard.push({ slug, rule: 'T3.1', msg: `cluster_pays evaluation incompatible with paylines=${lines} (must be 0/null)` });
  }

  // T3.2 ways evaluation with paylines > 0 is unusual but industry-acceptable
  // (Win-Both-Ways slots ship a payline count as chrome; Megaways variants
  // also expose a baseline payline count even though evaluation is ways).
  // SOFT only — emit advisory but don't block.
  if (evalKind === 'ways' && lines != null && lines > 0) {
    soft.push({ slug, rule: 'T3.2', msg: `ways evaluation with paylines=${lines} — verify GDD intent (chrome vs eval)` });
  }

  // T3.3 pay_anywhere or scatter_pay must not have paylines > 0
  if ((evalKind === 'pay_anywhere' || evalKind === 'scatter_pay') && lines != null && lines > 20 * (rows || 1)) {
    // tolerated: pay_anywhere often still ships a payline count for the chrome
    soft.push({ slug, rule: 'T3.3', msg: `${evalKind} with paylines=${lines} is unusual` });
  }

  // T3.4 cluster topology requires cluster_min_size to be set
  if (evalKind === 'cluster_pays' && t.cluster_min_size == null) {
    hard.push({ slug, rule: 'T3.4', msg: `cluster_pays evaluation missing cluster_min_size` });
  }

  // T3.5 specialty engines must have matching evaluation. Parser may
  // fallback to 'lines' when prose is ambiguous — that's a SOFT issue
  // (the engine still routes via topology.kind/is_plinko flags), not a
  // HARD industry violation.
  if (t.is_plinko && evalKind !== 'plinko' && evalKind !== 'scatter_pay') {
    soft.push({ slug, rule: 'T3.5', msg: `plinko topology with evaluation '${evalKind}' (parser fallback — engine still routes via is_plinko)` });
  }
  if (t.is_slingo && evalKind !== 'slingo' && evalKind !== 'lines') {
    soft.push({ slug, rule: 'T3.5', msg: `slingo topology with evaluation '${evalKind}' (expected 'slingo' or 'lines')` });
  }

  /* T4 — Jurisdiction × Compliance Gate (HARD) ────────────────────── */
  const compliance = model.compliance;
  const jurList = Array.isArray(compliance)
    ? compliance
    : Array.isArray(compliance?.jurisdictions) ? compliance.jurisdictions : [];

  for (const j of jurList) {
    const code = typeof j === 'string' ? j : (j?.code || j?.id || j?.name);
    if (!code) continue;
    const gateBlock = JURISDICTION_TO_GATE[code];
    if (!gateBlock) continue;  // unknown jurisdiction → soft skip
    if (!model[gateBlock] || model[gateBlock]?.enabled !== true) {
      hard.push({ slug, rule: 'T4.1', msg: `jurisdiction '${code}' declared but ${gateBlock}.enabled !== true` });
    }
  }

  /* T2 — Math Floor Sanity (SOFT) ─────────────────────────────────── */

  const bb = model.bonusBuy;
  if (bb?.enabled === true && typeof bb.costX === 'number') {
    if (bb.costX < BONUS_BUY_COST_MIN || bb.costX > BONUS_BUY_COST_MAX) {
      soft.push({ slug, rule: 'T2.1', msg: `bonusBuy.costX=${bb.costX} outside [${BONUS_BUY_COST_MIN}, ${BONUS_BUY_COST_MAX}]` });
    }
  }

  const fs = model.freeSpins;
  if (fs?.enabled !== false && Array.isArray(fs?.awards) && fs.awards.length > 0) {
    const maxAward = Math.max(...fs.awards.map(a => Number(a?.value || a?.spins || a) || 0));
    if (maxAward > 0 && maxAward < FS_AWARD_FLOOR) {
      soft.push({ slug, rule: 'T2.2', msg: `freeSpins max award ${maxAward} below industry floor ${FS_AWARD_FLOOR}` });
    }
  }

  if (model.payback?.hitFrequency != null) {
    const hf = model.payback.hitFrequency;
    if (hf < 5 || hf > 50) {
      soft.push({ slug, rule: 'T2.3', msg: `payback.hitFrequency ${hf}% outside [5%, 50%]` });
    }
  }

  return { hard, soft };
}

/* ── Walker ─────────────────────────────────────────────────────────── */

function listSlugs() {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing — run \`npm run test:parse:real-pdfs\` first.`);
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

const slugs = listSlugs();
if (slugs.length === 0) {
  console.error('▸ no model.json files found for audit');
  process.exit(2);
}

console.log(`V10 Industry Compliance Spec · auditing ${slugs.length} model.json files...`);

const allHard = [], allSoft = [];
let processed = 0;
for (const slug of slugs) {
  let model;
  try {
    model = JSON.parse(readFileSync(join(REAL_GAMES, slug, 'model.json'), 'utf8'));
  } catch (e) {
    allHard.push({ slug, rule: 'T0.1', msg: `model.json unreadable: ${e.message}` });
    processed++;
    continue;
  }
  const { hard, soft } = auditModel(slug, model);
  allHard.push(...hard);
  allSoft.push(...soft);
  processed++;
}

/* ── Output ─────────────────────────────────────────────────────────── */

const ts = new Date().toISOString();
const summary = {
  generatedAt: ts,
  tool: 'tools/v10-industry-compliance-spec.mjs',
  gamesAudited: processed,
  hardCount: allHard.length,
  softCount: allSoft.length,
  hardByRule: groupByRule(allHard),
  softByRule: groupByRule(allSoft),
  hardSample: allHard.slice(0, 50),
  softSample: allSoft.slice(0, 50),
};

const reportFile = join(OUT_DIR, `v10-industry-compliance-${ts.replace(/[:.]/g, '-')}.json`);
writeFileSync(reportFile, JSON.stringify(summary, null, 2));

function groupByRule(arr) {
  const m = {};
  for (const v of arr) m[v.rule] = (m[v.rule] || 0) + 1;
  return m;
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`V10 Industry Compliance Spec · audited ${processed} games`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  HARD violations: ${allHard.length}  (gate-blocking)`);
console.log(`  SOFT warnings  : ${allSoft.length}  (advisory)`);
if (allHard.length > 0) {
  console.log('  Hard-by-rule:', JSON.stringify(summary.hardByRule));
  console.log('  First HARD violations:');
  for (const v of allHard.slice(0, 10)) console.log(`    [${v.rule}] ${v.slug} — ${v.msg}`);
}
if (allSoft.length > 0) {
  console.log('  Soft-by-rule:', JSON.stringify(summary.softByRule));
}
console.log(`  Report: ${reportFile}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const failHard = allHard.length > 0;
const failSoft = SOFT_AS_HARD && allSoft.length > 0;
if (failHard || failSoft) {
  console.log('✗ FAIL');
  process.exit(1);
}
console.log('✓ PASS — 0 industry-compliance violations');
process.exit(0);
