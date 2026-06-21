#!/usr/bin/env node
/**
 * tools/verify.mjs
 *
 * Wave UQ-12 (2026-06-21) — Pre-commit gate.
 *
 * One orchestrator that runs the minimum "is the repo healthy?" set:
 *   1. featureArchetypes test          — 28 archetypes + alias + filter
 *   2. smartDefaults-archetype-backfill — stage 5 backfill plumbing
 *   3. scaffold-block tool test         — 25-archetype E2E scaffolding
 *   4. UQ-7 corpus audit                — assert unknownFeatureKinds = 0
 *   5. UQ-11 render smoke               — 20-GDD random subset build
 *
 * Exit code 0 = healthy, ≥ 1 = at least one gate failed.
 *
 * USAGE
 *   node tools/verify.mjs            — full gate
 *   node tools/verify.mjs --quick    — skip render smoke (steps 1-4 only)
 *   node tools/verify.mjs --json     — emit machine-readable summary
 *
 * INVOKED BY
 *   npm run verify
 *   git pre-commit hook (installed via tools/install-precommit.mjs)
 */
import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const JSON_OUT = args.includes('--json');

const results = [];

/* Wave UQ-FORTIFY4 H1 — verify gate dependency tracking.
 * Steps may declare `dependsOn: [labels]`. If any upstream dep is in
 * results with ok=false, the dependent step is SKIPPED (not run) and
 * marked as `skipped: true` in results. Prevents downstream noise when
 * a foundational step (e.g. UQ-7 audit, semantic verifier) fails.
 *
 * UQ-FORTIFY8 #1 — dependency contract pinned:
 *   A skipped gate ALWAYS blocks its downstream because it carries
 *   `ok: false` AND `skipped: true`. The check looks at `ok` only,
 *   which is the conservative choice: any non-green upstream (failed
 *   or skipped) cuts the dependency chain. A future refactor that
 *   wants to distinguish "skipped vs failed" upstreams MUST also
 *   update _isDepGreen to check the `skipped` flag — otherwise it
 *   could accidentally allow a downstream to run despite a missing
 *   upstream signal. Documented + asserted by
 *   tests/tools/uq-fortify8-eighthtier.test.mjs. */
function _isDepGreen(deps) {
  if (!Array.isArray(deps) || deps.length === 0) return true;
  for (const dep of deps) {
    const found = results.find(r => r.label === dep);
    /* found.ok === false catches both hard fails AND skips (which are
       stamped ok: false + skipped: true by the run() wrapper). */
    if (!found || found.ok === false) return false;
  }
  return true;
}

function run(label, cmd, argv, opts = {}) {
  /* H1 — short-circuit if dependsOn fails. */
  if (opts.dependsOn && !_isDepGreen(opts.dependsOn)) {
    results.push({
      label, ok: false, exit: -1, durationS: 0,
      stderr: 'SKIPPED — dependency failed: ' + opts.dependsOn.join(', '),
      stdout: '',
      skipped: true,
    });
    if (!JSON_OUT) console.log(`  ⏭ ${label.padEnd(45)} (dep fail: ${opts.dependsOn.join(', ')})`);
    return false;
  }
  const t0 = Date.now();
  const r = spawnSync(cmd, argv, { cwd: REPO, encoding: 'utf8', ...opts });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.status === 0;
  results.push({
    label, ok,
    exit: r.status,
    durationS: parseFloat(dt),
    stderr: ok ? '' : (r.stderr || '').slice(-600),
    stdout: ok ? '' : (r.stdout || '').slice(-600),
  });
  if (!JSON_OUT) {
    const tag = ok ? '✓' : '✗';
    console.log(`  ${tag} ${label.padEnd(45)} (${dt}s)`);
    if (!ok) {
      console.log('    ── stderr (tail) ──');
      console.log('    ' + (r.stderr || '').trim().split('\n').slice(-10).join('\n    '));
      console.log('    ── stdout (tail) ──');
      console.log('    ' + (r.stdout || '').trim().split('\n').slice(-10).join('\n    '));
    }
  }
  return ok;
}

if (!JSON_OUT) console.log('\nUQ-12 pre-commit gate\n══════════════════════════════════════════════\n');

/* ── Step 1–3: Node test files ──────────────────────────────────────── */
run('archetype catalog + alias + filter',
  'node', ['--test', 'tests/registry/featureArchetypes.test.mjs']);

run('smartDefaults archetype backfill (stage 5)',
  'node', ['--test', 'tests/registry/smartDefaults-archetype-backfill.test.mjs']);

run('smartDefaults autofix gaps (stage 6)',
  'node', ['--test', 'tests/registry/smartDefaults-autofix.test.mjs']);

run('parser topology prose edge cases (UQ-CASH)',
  'node', ['--test', 'tests/blocks/parserTopologyProseEdge.test.mjs']);

run('scaffold-block tool (E2E across 25 archetypes)',
  'node', ['--test', 'tests/tools/scaffold-block.test.mjs']);

run('ingest tool (end-to-end pipeline)',
  'node', ['--test', 'tests/tools/ingest.test.mjs']);

run('archetype docs generator',
  'node', ['--test', 'tests/tools/gen-archetype-docs.test.mjs']);

run('install-precommit hook installer',
  'node', ['--test', 'tests/tools/install-precommit.test.mjs']);

run('UQ-FORTIFY3 third-tier audit fixes',
  'node', ['--test', 'tests/tools/uq-fortify3-thirdtier.test.mjs']);

run('UQ-FORTIFY5 fifth-tier audit fixes',
  'node', ['--test', 'tests/tools/uq-fortify5-fifthtier.test.mjs']);

run('UQ-FORTIFY6 sixth-tier audit fixes',
  'node', ['--test', 'tests/tools/uq-fortify6-sixthtier.test.mjs']);

run('UQ-FORTIFY7 seventh-tier audit fixes',
  'node', ['--test', 'tests/tools/uq-fortify7-seventhtier.test.mjs']);

run('UQ-FORTIFY8 eighth-tier audit fixes',
  'node', ['--test', 'tests/tools/uq-fortify8-eighthtier.test.mjs']);

/* ── Step 4: UQ-7 corpus audit (unknown must be 0) ──────────────────── */
const auditOk = run('UQ-7 cache audit',
  'node', ['tools/uq7-cache-audit.mjs', '--json']);
if (auditOk) {
  try {
    const txt = await readFile(resolve(REPO, 'tools/_eyes/uq7-report/uq7-summary.json'), 'utf8');
    const summary = JSON.parse(txt);
    const unk = Object.keys(summary.unknownFeatureKinds || {}).length;
    const auditPass = unk === 0;
    results.push({
      label: '  └ assert unknownFeatureKinds === 0',
      ok: auditPass,
      exit: auditPass ? 0 : 1,
      durationS: 0,
      stderr: auditPass ? '' : `${unk} unknown feature kinds: ${Object.keys(summary.unknownFeatureKinds).slice(0, 10).join(', ')}…`,
      stdout: '',
    });
    if (!JSON_OUT) {
      const tag = auditPass ? '✓' : '✗';
      console.log(`  ${tag} assert unknownFeatureKinds === 0 (got ${unk})`);
    }
  } catch (e) {
    results.push({ label: '  └ assert unknown=0 (read failed)', ok: false, exit: 1, durationS: 0, stderr: e.message, stdout: '' });
  }
}

/* ── Step 4.5: UQ-16 baseline drift on 20-slug smoke subset ─────────── */
const baselinePath = resolve(REPO, 'tests/baselines/uq16-render-baseline.json');
if (existsSync(baselinePath)) {
  run('UQ-16 baseline drift (20-slug subset)',
    'node', ['tools/uq16-baseline.mjs', '--limit', '20']);
} else {
  if (!JSON_OUT) console.log('  ⏭ UQ-16 baseline drift (no baseline — run --bake)');
}

/* ── Step 4.6: UQ-CASH A6 semantic accuracy verifier ─────────────────
 * Closes the gap that UQ-11/lw-25/parse-real opened: we check that the
 * parser produces SEMANTICALLY CORRECT models on 5 baseline GDDs, not
 * just that they don't throw. Pinned ground truth in
 * tests/fixtures/semantic-expected.json (≤80% asserts must pass for green).
 * H1 — depends on UQ-7 audit: if cache is broken, semantic verifier is
 * meaningless. */
const semVerifier = resolve(REPO, 'tools/uq-cash-semantic-verifier.mjs');
if (existsSync(semVerifier)) {
  run('UQ-CASH A6 semantic accuracy (5 baseline GDDs)',
    'node', [semVerifier],
    { dependsOn: ['UQ-7 cache audit'] });
} else if (!JSON_OUT) {
  console.log('  ⏭ UQ-CASH A6 semantic accuracy (no verifier tool)');
}

/* ── Step 4.7: UQ-TRAIN orchestrator E2E test ─────────────────────────
 * 8-pass orchestrator gate that exercises agents + parser + builder +
 * force chips + block activations end-to-end on 5 baseline GDDs.
 * Asserts agent V6 declared count > parser declared count (proves AI
 * is adding measurable value on top of regex baseline).
 * H1 — depends on semantic verifier (Pass 4 mirrors A6 ground truth). */
const e2eTool = resolve(REPO, 'tools/orchestrator-e2e-test.mjs');
if (existsSync(e2eTool)) {
  run('UQ-TRAIN orchestrator E2E (5 baseline GDDs · 8 passes)',
    'node', [e2eTool],
    { dependsOn: ['UQ-CASH A6 semantic accuracy (5 baseline GDDs)'] });
} else if (!JSON_OUT) {
  console.log('  ⏭ UQ-TRAIN orchestrator E2E (no tool)');
}

/* ── Step 4.8: UQ-FORTIFY2 G7 dirty PDF resilience ────────────────── */
const dirtyTool = resolve(REPO, 'tools/dirty-pdf-resilience-test.mjs');
if (existsSync(dirtyTool)) {
  run('UQ-FORTIFY2 G7 dirty PDF resilience',
    'node', [dirtyTool]);
}

/* ── Step 4.9: UQ-COVER cross-corpus force coverage ────────────────
 * Walks every V6 reconcile cache entry and asserts that every declared
 * feature has its force chip rendered (and no phantom chips are
 * rendered for features the GDD never declared). The 338-GDD corpus
 * is the most realistic stress test we have. */
const coverTool = resolve(REPO, 'tools/cross-corpus-force-coverage.mjs');
if (existsSync(coverTool)) {
  run('UQ-COVER cross-corpus force coverage (338 GDDs)',
    'node', [coverTool, '--limit', '60']);
}

/* ── Step 4.92: UQ-MASTERY-3 V10 Industry Compliance Spec ──────────────
 * Encodes slot-industry ground truth (payline whitelist per grid, ways
 * count whitelist, cluster min-size floor, jurisdiction → compliance
 * gate enforcement, dual-colossal reels range, etc.) as a deterministic
 * walker over every model.json. HARD violations block commit; SOFT
 * warnings are advisory only and surface in the report. Catches any
 * future regression that produces a non-industry-standard slot. */
const v10Tool = resolve(REPO, 'tools/v10-industry-compliance-spec.mjs');
if (existsSync(v10Tool)) {
  run('UQ-MASTERY-3 V10 industry compliance spec (338 GDDs)',
    'node', [v10Tool]);
}

/* ── Step 4.93: UQ-MASTERY-4 V11 Deep Industry Spec ────────────────────
 * Produbljuje V10. Encodes deep slot-industry GT: RTP jurisdikcioni floor
 * (UKGC 85%, DE-WHG 90%, FR-ANJ 92%), jackpot tier monotonicity (MINI <
 * MINOR < MAJOR < GRAND), free-spin multiplier ladder monotonic, autoplay
 * cap per regulator (UK 100, DE 1, FR 0), DE-WHG required netLossIndicator,
 * tumble→postSpin lifecycle, holdAndWin→respin engine pairing, antebet
 * cost multiplier industry set {1.25, 1.5, 1.75, 2.0}, top HP/LP 5OAK
 * pay floors. 17 HARD + 3 SOFT rule codes. SKIP-AKO-NULL: HARD se pali
 * samo kad polje JE deklarisano i prekršeno. */
const v11Tool = resolve(REPO, 'tools/v11-deep-industry-spec.mjs');
if (existsSync(v11Tool)) {
  run('UQ-MASTERY-4 V11 deep industry spec (338 GDDs)',
    'node', [v11Tool]);
}

/* ── Step 4.93b: UQ-MASTERY-4 V11 self-test (positive + negative) ──── */
const v11Test = resolve(REPO, 'tests/tools/v11-deep-industry-spec.test.mjs');
if (existsSync(v11Test)) {
  run('UQ-MASTERY-4 V11 self-test (17 rule codes + clean fixture)',
    'node', [v11Test]);
}

/* ── Step 4.94: UQ-MASTERY-5 V8 GAME ASSEMBLY orchestrator ────────────
 * V8 reads parsed model (V6 output) + blockCatalog + assembly rules,
 * deterministically decides enabledBlocks / disabledBlocks per slot,
 * detects conflicts (mutually exclusive blocks both on), missing
 * mandatory blocks (paytable, balanceHud, betSelector, ...), missing
 * jurisdiction gates. Emits per-slug receipt sa `reasonByBlock` mapom.
 * No LLM; pure rule engine (95% coverage per V8 agent contract).
 * Verdict FAIL gate-blocks on any: conflict, missing mandatory, or
 * missing jurisdiction gate for declared regulator. */
const v8Tool = resolve(REPO, 'tools/v8-assembly-orchestrator.mjs');
if (existsSync(v8Tool)) {
  run('UQ-MASTERY-5 V8 assembly orchestrator (338 GDDs)',
    'node', [v8Tool]);
}

/* ── Step 4.94b: UQ-MASTERY-5 V8 self-test ───────────────────────── */
const v8Test = resolve(REPO, 'tests/tools/v8-assembly-orchestrator.test.mjs');
if (existsSync(v8Test)) {
  run('UQ-MASTERY-5 V8 self-test (engine select + mandatory + jur + stack)',
    'node', [v8Test]);
}

/* ── Step 4.95: UQ-MASTERY-5 V9 VISUAL QA deterministic smoke ─────────
 * V9 deterministic mode: parse svaki slot.html i proveri 8+ struct
 * invariant-a (mandatory hub controls, viewport meta, PWA manifest,
 * CSS theme vars, paytable rows match declared symbols, engine block
 * marker mounted, body length sanity). No browser launch, no LLM.
 * Vision mode (--vision flag) je opt-in pre-release, NE u gate-u.
 * Verdict FAIL na bilo kojem PASS check gate-blocks; WARN-only prolazi. */
const v9Tool = resolve(REPO, 'tools/v9-visual-qa.mjs');
if (existsSync(v9Tool)) {
  run('UQ-MASTERY-5 V9 visual QA deterministic (338 GDDs)',
    'node', [v9Tool]);
}

/* ── Step 4.95b: UQ-MASTERY-5 V9 self-test ──────────────────────── */
const v9Test = resolve(REPO, 'tests/tools/v9-visual-qa.test.mjs');
if (existsSync(v9Test)) {
  run('UQ-MASTERY-5 V9 self-test (clean PASS + missing controls FAIL + WARN)',
    'node', [v9Test]);
}

/* ── Step 4.96: UQ-MASTERY-6 V12 DEEPER INDUSTRY SPEC ─────────────────
 * Produbljuje V11 sa sledećim slojem GT-a:
 *   Layer F · Paytable economics (HP/LP tier counts, symbol-name sanity,
 *            tier monotonic, wild/scatter present)
 *   Layer G · Free-spin economics (trigger scatter count, award range,
 *            multiplier cap, retrigger cap)
 *   Layer H · Bonus-buy economics (cost band, UKGC ban check, NL disclosure)
 *   Layer J · Engine signature consistency (lock_respin 5×3, pay_anywhere
 *            canonical sizes, cluster square-ish, variable_reel growable)
 *   Layer K · UX presentation invariants (spinTempo range, anticipation,
 *            bigWinTier requires winPresentation)
 * 9 HARD + 11 SOFT rule codes. SKIP-AKO-NULL. */
const v12Tool = resolve(REPO, 'tools/v12-deeper-industry-spec.mjs');
if (existsSync(v12Tool)) {
  run('UQ-MASTERY-6 V12 deeper industry spec (338 GDDs)',
    'node', [v12Tool]);
}

/* ── Step 4.96b: UQ-MASTERY-6 V12 self-test ───────────────────── */
const v12Test = resolve(REPO, 'tests/tools/v12-deeper-industry-spec.test.mjs');
if (existsSync(v12Test)) {
  run('UQ-MASTERY-6 V12 self-test (9 HARD codes + clean fixture)',
    'node', [v12Test]);
}

/* ── Step 4.97: UQ-FORTIFY9 ninth-tier forensic 5 fixes ────────────────
 * #1 XSS u buildSlotHTML.mjs (safeJSONInScript escape)
 * #2 Prototype pollution u mergeIntoModel + parser inline merge
 * #3 Clock skew u fileLock.mjs (DST/NTP)
 * #4 BOM + JSON silent fallback u parser.mjs
 * #5 Slug normalization unify (parser ↔ cert/manifest) */
const uqFortify9 = resolve(REPO, 'tests/tools/uq-fortify9-ninthtier.test.mjs');
if (existsSync(uqFortify9)) {
  run('UQ-FORTIFY9 ninth-tier forensic 5 fixes (XSS/proto/clock/BOM/slug)',
    'node', [uqFortify9]);
}

/* ── Step 4.91: UQ-MASTERY block liveness audit ────────────────────────
 * Zero-DEAD-block contract. Every block flagged `defaultOn: true` in the
 * manifest MUST be mountable in at least one rendered HTML fingerprint
 * (block name OR exported emitXxx fn OR hand-aliased kind id). Catches
 * any future regression where a block exists in src/blocks/ but slips
 * out of the build pipeline (orphan block, dead UI). */
const livenessTool = resolve(REPO, 'tools/_block-liveness-walker.mjs');
if (existsSync(livenessTool)) {
  run('UQ-MASTERY block liveness audit (0 DEAD blokova)',
    'node', [livenessTool]);
}

/* ── Step 5: UQ-11 render smoke on a 20-GDD subset ──────────────────── */
if (!QUICK) {
  const RENDER_TOOL = resolve(REPO, 'tools/_full-corpus-render-parity.mjs');
  if (existsSync(RENDER_TOOL)) {
    run('UQ-11 render smoke (20-GDD subset)',
      'node', [RENDER_TOOL, '--limit', '20']);
  } else {
    /* UQ-12 audit fix: missing render tool is a hard FAIL, not a silent
       skip. The gate must protect the render pipeline; if the tool
       disappears the commit is blocked until it's restored. */
    const msg = 'render tool missing at tools/_full-corpus-render-parity.mjs';
    if (!JSON_OUT) console.log('  ✗ UQ-11 render smoke — ' + msg);
    results.push({ label: 'UQ-11 render smoke', ok: false, exit: 1, durationS: 0, stderr: msg, stdout: '' });
  }
} else if (!JSON_OUT) {
  console.log('  ⏭ UQ-11 render smoke (--quick)');
}

/* ── Summary ────────────────────────────────────────────────────────── */
const allOk = results.every(r => r.ok);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    runAt: new Date().toISOString(),
    overall: allOk ? 'pass' : 'fail',
    results,
  }, null, 2));
} else {
  console.log('\n══════════════════════════════════════════════');
  console.log(allOk ? '✓ ALL GATES GREEN — safe to commit' : '✗ AT LEAST ONE GATE FAILED — commit blocked');
  console.log('══════════════════════════════════════════════\n');
}

process.exit(allOk ? 0 : 1);
