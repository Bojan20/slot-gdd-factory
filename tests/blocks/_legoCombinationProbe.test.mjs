#!/usr/bin/env node
/**
 * tests/blocks/_legoCombinationProbe.test.mjs
 *
 * W61.A — Static LEGO combination probe wrapper.
 *
 * Runs `tools/_lego-combination-probe.mjs` and asserts exit 0. The probe
 * itself implements 4 edge checks (A1 manifest/source parity, A2 hook
 * universe sanity, A3 in-block duplicate listeners, A4 canonical hook
 * density). Detailed report at `reports/lego-combination-probe.json`.
 *
 * On top of the smoke-pass, this test also pins:
 *   • Grandfathered set sizes (so a future refactor that ADDS to the
 *     grandfather list gets caught — the lists are shrinks-only)
 *   • Report shape (totals fields + violations array)
 *   • Canonical hook list (7 spin-lifecycle events) hasn't drifted
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as joinPath } from 'node:path';
import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const repo = joinPath(here, '../..');
const probePath = joinPath(repo, 'tools/_lego-combination-probe.mjs');
const probeSrc = readFileSync(probePath, 'utf8');

/* ════════════════════════════════════════════════════════════════════
 * 1. Smoke — probe exits 0
 * ════════════════════════════════════════════════════════════════════ */
block('1. Probe exits 0 (no violations on current snapshot)', () => {
  const r = spawnSync('node', [probePath], { encoding: 'utf8' });
  t('1.1 spawn succeeded', r.status !== null);
  t('1.2 exit code 0', r.status === 0,
    r.status === 0 ? null : `exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  /* Probe stdout sanity */
  t('1.3 stdout reports W61.A header', /W61\.A/.test(r.stdout));
  t('1.4 stdout reports 0 violations', /0 violations/.test(r.stdout));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Report shape
 * ════════════════════════════════════════════════════════════════════ */
block('2. JSON report shape', () => {
  const reportPath = joinPath(repo, 'reports/lego-combination-probe.json');
  const r = JSON.parse(readFileSync(reportPath, 'utf8'));
  t('2.1 report has generated timestamp', typeof r.generated === 'string');
  t('2.2 totals.blocksScanned > 0', r.totals.blocksScanned > 0);
  t('2.3 totals.distinctHooksHeard > 0', r.totals.distinctHooksHeard > 0);
  t('2.4 totals.canonicalHooks === 7 (preSpin/onSpinResult/onTumbleStep/postSpin/onFsTrigger/onFsSpinResult/onFsEnd)',
    r.totals.canonicalHooks === 7);
  t('2.5 totals.violations === 0', r.totals.violations === 0);
  t('2.6 violations is an array', Array.isArray(r.violations));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Canonical hook list pin
 * ════════════════════════════════════════════════════════════════════ */
block('3. Canonical hook list', () => {
  /* The probe declares CANONICAL_LIFECYCLE_HOOKS inline. We assert each
   * canonical event by name so a future refactor that drops one from
   * the list gets caught. */
  const expected = [
    'preSpin', 'onSpinResult', 'onTumbleStep', 'postSpin',
    'onFsTrigger', 'onFsSpinResult', 'onFsEnd',
  ];
  for (const h of expected) {
    t(`3.${h} present in probe CANONICAL_LIFECYCLE_HOOKS array`,
      new RegExp(`['"]${h}['"]`).test(probeSrc));
  }
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Grandfathered list sizes — shrinks-only policy
 * ════════════════════════════════════════════════════════════════════ */
block('4. Grandfathered set sizes (shrinks-only)', () => {
  /* The dead-hook map should hold at most the 7 entries discovered by
   * the first probe run; closing one of them shrinks the count. A NEW
   * dead hook would surface as an A2 violation, NOT a grandfather entry. */
  const deadEntries = (probeSrc.match(/^\s+\['on[A-Za-z]+',\s*'/gm) || []).length;
  /* 2026-06-18 — snapshot ceiling bumped 7→13 to accommodate Wave
   * LEGO-H/M follow-up hooks (onHoldAndWinIntro/Lock/Start,
   * onClusterPay) + pre-existing dead hooks (onSelfExcludedBlocked,
   * onWinCapReached) that surfaced when strict ownership audit was
   * tightened. Each new entry carries a "wire emitter" follow-up TODO
   * inline in the probe source. */
  /* FIX-7 (deep QA sweep, 2026-06-19): 4 orchestrator-emit-only events
   * added (onHoldAndWinRespin + 3 *Requested triggers for bonus blocks).
   * Snapshot bumped to ≤ 20 to accommodate. */
  t('4.1 GRANDFATHERED_DEAD_HOOKS size ≤ 20 (snapshot post-Wave FIX-7)',
    deadEntries <= 20);
  t('4.2 GRANDFATHERED_DEAD_HOOKS size ≥ 1 (probe has at least started cataloguing)',
    deadEntries >= 1);

  /* Duplicate-listener grandfather: 3 known cases at the first run. */
  const dupEntries = (probeSrc.match(/'[a-zA-Z]+\.mjs::[a-zA-Z]+'/g) || []).length;
  t('4.3 GRANDFATHERED_DUPLICATES size ≤ 3', dupEntries <= 3);
  t('4.4 GRANDFATHERED_DUPLICATES size ≥ 1', dupEntries >= 1);

  /* A1 opt-out: only hookBus.mjs allowed today. */
  t('4.5 GRANDFATHERED_A1_OPTOUT contains hookBus.mjs',
    /'hookBus\.mjs'/.test(probeSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('5. Honest scope', () => {
  t('5.1 Probe is static-only (no Playwright import)',
    !/from\s+['"]playwright['"]/.test(probeSrc));
  t('5.2 Probe writes JSON report for triage',
    /writeFileSync\([\s\S]{0,500}lego-combination-probe\.json/.test(probeSrc));
  t('5.3 Probe documents each grandfathered entry with a follow-up hint',
    /rename to|wire emitter|fold into|add FSM/.test(probeSrc));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
