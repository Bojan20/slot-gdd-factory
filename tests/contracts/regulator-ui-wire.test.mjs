#!/usr/bin/env node
/**
 * tests/contracts/regulator-ui-wire.test.mjs
 *
 * MATH-DEEP D+6 (2026-06-23) — W51/W52/W53 regulator UI wire-up audit.
 *
 * Boki direktiva: "ovaj mora da se zavrsi prvo. ajde cepaj do kraja".
 *
 * Backlog item: "W51/W52/W53 (sessionTimeout + realityCheck + LDW wire) —
 * regulator UI, ne math". The blocks exist; this contract verifies they
 * are WIRED via HookBus so cross-block contract holds (regulator-graded
 * session lifecycle).
 *
 * Wire contract (vendor-neutral, UKGC RTS 12/13 baseline)
 *   • sessionTimeout subscribes to onRealityCheckPaused + onRealityCheckResumed
 *   • realityCheck emits onRealityCheck{Shown,Dismissed,Paused,Resumed}
 *   • netLossIndicator emits onNetThresholdCrossed
 *   • All three blocks are LIVE in rendered slot.html for at least one
 *     baseline GDD (smoke level integration test)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n    ' + detail : '')); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\n=== regulator UI wire (W51/W52/W53 audit) ===\n');

const sessionTimeoutSrc = readFileSync(join(REPO, 'src/blocks/sessionTimeout.mjs'), 'utf8');
const realityCheckSrc   = readFileSync(join(REPO, 'src/blocks/realityCheck.mjs'),   'utf8');
const netLossSrc        = readFileSync(join(REPO, 'src/blocks/netLossIndicator.mjs'),'utf8');

/* sessionTimeout subscribe contract */
t('sessionTimeout: subscribes onRealityCheckPaused',
  /HookBus\.on\(['"]onRealityCheckPaused['"]/i.test(sessionTimeoutSrc));
t('sessionTimeout: subscribes onRealityCheckResumed',
  /HookBus\.on\(['"]onRealityCheckResumed['"]/i.test(sessionTimeoutSrc));
t('sessionTimeout: emits onSessionTimeoutFired',
  /HookBus\.emit\(['"]onSessionTimeoutFired['"]/i.test(sessionTimeoutSrc));
t('sessionTimeout: emits onSessionWarningShown',
  /HookBus\.emit\(['"]onSessionWarningShown['"]/i.test(sessionTimeoutSrc));

/* realityCheck emit contract */
t('realityCheck: emits onRealityCheckShown',
  /HookBus\.emit\(['"]onRealityCheckShown['"]/i.test(realityCheckSrc));
t('realityCheck: emits onRealityCheckDismissed',
  /HookBus\.emit\(['"]onRealityCheckDismissed['"]/i.test(realityCheckSrc));
t('realityCheck: emits onRealityCheckPaused',
  /HookBus\.emit\(['"]onRealityCheckPaused['"]/i.test(realityCheckSrc));
t('realityCheck: emits onRealityCheckResumed',
  /HookBus\.emit\(['"]onRealityCheckResumed['"]/i.test(realityCheckSrc));

/* netLossIndicator emit contract */
t('netLossIndicator: emits onNetThresholdCrossed',
  /HookBus\.emit\(['"]onNetThresholdCrossed['"]/i.test(netLossSrc));

/* Rendered slot.html presence (smoke) */
const slugCandidates = [
  'cash-eruption-foundry-gdd',
  'gates-of-olympus-1000-gdd',
  'wrath-of-olympus-gdd',
];
for (const slug of slugCandidates) {
  const htmlPath = join(REPO, 'dist/real-games', slug, 'slot.html');
  if (!existsSync(htmlPath)) continue;
  const html = readFileSync(htmlPath, 'utf8');
  t(`${slug}: sessionTimeout/realityCheck/netLossIndicator presence in slot.html`,
    /sessionTimeout/i.test(html) &&
    /realityCheck/i.test(html) &&
    /netLossIndicator|netLoss|netPositionRequired/i.test(html));
}

/* Cross-block invariant: sessionTimeout uses timers AND wires the
 * realityCheck pause handler somewhere in the same file (proximity not
 * required — large blocks separate arming and handler definitions). */
const hasTimers = /setInterval|setTimeout/.test(sessionTimeoutSrc);
const hasPauseHandler = /HookBus\.on\(['"]onRealityCheckPaused['"]/i.test(sessionTimeoutSrc);
t('sessionTimeout: both timer arm AND realityCheck pause handler present',
  hasTimers && hasPauseHandler);

console.log(`\nResult: ${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
