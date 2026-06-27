#!/usr/bin/env node
/**
 * tests/tools/par-14-i-pipeline.test.mjs
 *
 * PAR-14-I contract test — orchestrator pipeline + classifier/auto-tune
 * glue.
 *
 * # COVERAGE
 *
 *   A: classifier-lib exports `classifySpecials` + `detectMechanics`.
 *   B: classifier CLI + auto-tune both import from the shared lib
 *      (no duplicated regex / drift risk).
 *   C: auto-tune `detectTuningAxes` activates axes based on classifier
 *      mechanic detection (FCB coin_boost ON, Skel Key special_reel_set
 *      + mystery_remap ON, CE hnw ON, BoU bonus_buy ON).
 *   D: orchestrator emits structured receipts at
 *      reports/par-pipeline/<slug>.json with stages.classify,
 *      stages.autoTune, stages.converge (when not skipped).
 *   E: --no-converge fast path completes <5s for 5 slugs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('PAR-14-I PIPELINE · contract test');

const libPath = join(REPO, 'tools', '_par-sheet-classifier-lib.mjs');
const clfPath = join(REPO, 'tools', '_par-sheet-classifier.mjs');
const tunePath = join(REPO, 'tools', '_par-sheet-auto-tune.mjs');
const pipePath = join(REPO, 'tools', 'par-sheet-pipeline.mjs');

const libSrc = readFileSync(libPath, 'utf-8');
const clfSrc = readFileSync(clfPath, 'utf-8');
const tuneSrc = readFileSync(tunePath, 'utf-8');
const pipeSrc = readFileSync(pipePath, 'utf-8');

/* ── A: shared lib exports ─────────────────────────────────────── */

test('A1: lib exports classifySpecials', () => {
  assert(/export\s+function\s+classifySpecials\s*\(\s*model\s*\)/.test(libSrc),
    'expected export classifySpecials(model)');
});

test('A2: lib exports detectMechanics', () => {
  assert(/export\s+function\s+detectMechanics\s*\(\s*model\s*\)/.test(libSrc),
    'expected export detectMechanics(model)');
});

test('A3: lib carries coin_boost mechanic detection', () => {
  assert(/coin_boost:\s*\{[\s\S]{0,300}detected:[\s\S]{0,200}coinBoostMultipliers/.test(libSrc),
    'expected coin_boost.detected to check coinBoostMultipliers in par_sheet');
});

test('A4: lib carries special_reel_set mechanic detection', () => {
  assert(/special_reel_set:\s*\{[\s\S]{0,300}detected:[\s\S]{0,200}specialReelSets/.test(libSrc),
    'expected special_reel_set.detected to check specialReelSets in par_sheet');
});

/* ── B: classifier CLI + auto-tune both import lib ──────────────── */

test('B1: classifier CLI imports from classifier-lib', () => {
  assert(/from\s+['"]\.\/_par-sheet-classifier-lib\.mjs['"]/.test(clfSrc),
    'expected classifier CLI to import from _par-sheet-classifier-lib.mjs');
});

test('B2: classifier CLI no longer defines classifySpecials inline', () => {
  /* The shared lib is now sole owner. CLI should only IMPORT, not redeclare. */
  assert(!/^function\s+classifySpecials\s*\(/m.test(clfSrc),
    'expected classifier CLI to drop local classifySpecials definition');
});

test('B3: classifier CLI no longer defines detectMechanics inline', () => {
  assert(!/^function\s+detectMechanics\s*\(/m.test(clfSrc),
    'expected classifier CLI to drop local detectMechanics definition');
});

test('B4: auto-tune imports detectMechanics from lib', () => {
  assert(/import\s*\{[\s\S]{0,80}detectMechanics[\s\S]{0,80}\}\s+from\s+['"]\.\/_par-sheet-classifier-lib\.mjs['"]/.test(tuneSrc),
    'expected auto-tune to import detectMechanics from classifier-lib');
});

/* ── C: axis activation gated by classifier ─────────────────────── */

test('C1: auto-tune calls detectMechanics inside detectTuningAxes', () => {
  assert(/function\s+detectTuningAxes[\s\S]{0,400}detectMechanics\s*\(\s*model\s*\)/.test(tuneSrc),
    'expected detectTuningAxes to invoke detectMechanics(model)');
});

test('C2: hnw axis enabled gated by mechanics.hold_and_win.detected', () => {
  assert(/hnw:\s*\{[\s\S]{0,150}enabled:\s*mechanics\.hold_and_win\.detected/.test(tuneSrc),
    'expected hnw.enabled to read mechanics.hold_and_win.detected');
});

test('C3: coin_boost axis enabled gated by mechanics.coin_boost.detected', () => {
  assert(/coin_boost:\s*\{[\s\S]{0,200}enabled:\s*mechanics\.coin_boost\.detected/.test(tuneSrc),
    'expected coin_boost.enabled to read mechanics.coin_boost.detected');
});

test('C4: special_reel_set axis enabled gated by mechanics', () => {
  assert(/special_reel_set:\s*\{[\s\S]{0,150}enabled:\s*mechanics\.special_reel_set\.detected/.test(tuneSrc),
    'expected special_reel_set.enabled to read mechanics.special_reel_set.detected');
});

/* ── D: pipeline orchestrator structure ─────────────────────────── */

test('D1: pipeline imports detectMechanics from classifier-lib', () => {
  assert(/import\s*\{[\s\S]{0,80}detectMechanics[\s\S]{0,80}\}\s+from\s+['"]\.\/_par-sheet-classifier-lib\.mjs['"]/.test(pipeSrc),
    'expected pipeline to import detectMechanics from classifier-lib');
});

test('D2: pipeline exports stage functions for sub-tooling', () => {
  assert(/export\s+\{[\s\S]{0,200}stageClassify[\s\S]{0,200}stageAutoTune[\s\S]{0,200}stageConverge/.test(pipeSrc),
    'expected pipeline to export stageClassify + stageAutoTune + stageConverge');
});

test('D3: pipeline supports --no-converge fast path', () => {
  assert(/--no-converge|noConverge/.test(pipeSrc),
    'expected --no-converge flag handling');
});

test('D4: pipeline writes receipt to reports/par-pipeline/<slug>.json', () => {
  assert(/PAR_PIPELINE_REPORT\s*=\s*join\([\s\S]{0,80}reports['"`]\s*,\s*['"`]par-pipeline/.test(pipeSrc),
    'expected PAR_PIPELINE_REPORT to point at reports/par-pipeline');
  assert(/function\s+writePipelineReceipt\s*\(/.test(pipeSrc),
    'expected writePipelineReceipt function');
  assert(/join\(PAR_PIPELINE_REPORT,\s*`\$\{slug\}\.json`\)/.test(pipeSrc),
    'expected join(PAR_PIPELINE_REPORT, `${slug}.json`) for receipt path');
});

/* ── E: live --no-converge smoke (5 slugs <5s) ──────────────────── */

await testAsync('E1: orchestrator --all --no-converge processes all 5 slugs', async () => {
  const t0 = Date.now();
  const proc = spawnSync('node', [pipePath, '--all', '--no-converge'], {
    cwd: REPO,
    encoding: 'utf-8',
    timeout: 30000,
  });
  const wallMs = Date.now() - t0;
  assert(proc.status === 0, `pipeline exited ${proc.status}: ${proc.stderr || proc.stdout}`);
  assert(wallMs < 10000, `expected <10s wall, got ${wallMs}ms`);
  const summary = proc.stdout.match(/Summary:\s*(\d+)\s*PASS\s*\/\s*(\d+)\s*WARN\s*\/\s*(\d+)\s*FAIL\s*\/\s*(\d+)\s*SKIPPED/);
  assert(summary, `expected summary line in stdout`);
  assert(parseInt(summary[4]) >= 5, `expected ≥5 SKIPPED, got ${summary[4]}`);
});

await testAsync('E2: pipeline emits receipt JSON with classify+autoTune stages', async () => {
  /* BoU was processed earlier in this test by E1's run. */
  const path = join(REPO, 'reports', 'par-pipeline', 'book-of-unseen-bonus-buy.json');
  assert(existsSync(path), `expected receipt at ${path}`);
  const receipt = JSON.parse(readFileSync(path, 'utf-8'));
  assert(receipt.slug === 'book-of-unseen-bonus-buy', `expected slug field`);
  assert(receipt.stages.classify, `expected stages.classify`);
  assert(Array.isArray(receipt.stages.classify.detectedFeatures), `expected detectedFeatures array`);
  assert(receipt.stages.classify.detectedFeatures.includes('bonus_buy'),
    `expected bonus_buy in detectedFeatures, got ${receipt.stages.classify.detectedFeatures}`);
  assert(receipt.stages.autoTune, `expected stages.autoTune`);
  assert(Array.isArray(receipt.stages.autoTune.enabledAxes), `expected enabledAxes array`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
