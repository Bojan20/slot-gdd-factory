/* eslint-disable no-console */
/**
 * Wave D4 — Orchestrator LOC budget gate.
 *
 * Pre-fix: `src/buildSlotHTML.mjs` had an undocumented "should-be-≤ 800"
 * convention tracked only in MASTER_TODO prose. Real file size: 886
 * LOC at audit time. No automated enforcement → silent drift.
 *
 * Post-fix: this script asserts every orchestrator-class file stays
 * under a documented ceiling, so a refactor below the ceiling is a
 * green build and a regression above it is an immediate red.
 *
 * Why 1000 (not 600):
 *   T-slim Phase 2 already extracted ~280 LOC into per-block .mjs files
 *   (winPresentation, anticipation, scatterCelebration, stageBadge, ...).
 *   Further splitting at this stage would create a deeper hierarchy
 *   without a clear seam to follow — the orchestrator is *intentionally*
 *   the seam that knows about HTML composition + per-block emit order.
 *   1000 LOC matches the documented `cortex-architect: god-object-budget`
 *   pattern used in the cortex repo for similar T-slim orchestrators.
 *
 * To re-tighten the budget later (when the math layer lands and we can
 * extract `mathDispatch.mjs`), edit `BUDGETS` below and ship the new
 * value with a single follow-up commit.
 *
 * Exit codes:
 *   0  → all files within budget
 *   1  → at least one file over budget (CI must fail)
 *   2  → script error (missing file, IO problem)
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, '..');

/**
 * @type {Array<{ path: string, maxLoc: number, rationale: string }>}
 */
const BUDGETS = [
  {
    path: 'src/buildSlotHTML.mjs',
    maxLoc: 1050,
    rationale:
      'Orchestrator — owns HTML composition + per-block emit order. ' +
      'T-slim Phase 2 closed ~280 LOC of extracts. Wave B64 adds the ' +
      'symbolUpgrade wire (import + CSS/markup/runtime emits = +12 LOC). ' +
      'Next split candidate is `mathDispatch.mjs` (post math layer wave).',
  },
  /* Add more orchestrators here when the codebase grows new top-level
     composition seams — e.g. cert pipeline orchestrator. */
];

let failed = 0;
let checked = 0;

console.log('🧭 Wave D4 — Orchestrator LOC budget gate');
console.log('═══════════════════════════════════════════════');

for (const { path, maxLoc, rationale } of BUDGETS) {
  const abs = resolve(REPO, path);
  let loc = -1;
  try {
    statSync(abs);
    loc = readFileSync(abs, 'utf8').split('\n').length;
  } catch (err) {
    console.error(`❌ ${path} — could not stat/read: ${err.message}`);
    process.exit(2);
  }
  checked++;
  const ratio = ((loc / maxLoc) * 100).toFixed(1);
  if (loc <= maxLoc) {
    console.log(`✅ ${path.padEnd(36)} ${String(loc).padStart(5)} / ${maxLoc} LOC  (${ratio}%)`);
  } else {
    console.log(`❌ ${path.padEnd(36)} ${String(loc).padStart(5)} / ${maxLoc} LOC  (${ratio}%) — OVER BUDGET`);
    console.log(`   Rationale for budget: ${rationale}`);
    failed++;
  }
}

console.log('═══════════════════════════════════════════════');
console.log(
  `Checked ${checked} orchestrator${checked === 1 ? '' : 's'}; ` +
  `${failed} over budget.`
);
if (failed > 0) {
  console.log();
  console.log('To resolve:');
  console.log('  1. Extract a clearly-bounded block (CSS / runtime / dispatch)');
  console.log('     into `src/blocks/<name>.mjs` and import from the orchestrator.');
  console.log('  2. OR raise the budget in tools/orchestrator-loc-budget.mjs with');
  console.log('     a rationale comment + Master TODO follow-up note.');
  process.exit(1);
}
process.exit(0);
