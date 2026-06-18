#!/usr/bin/env node
/**
 * tools/_universal-spin-cta-coverage.mjs
 *
 * Boki rule (2026-06-18): "spin, stop, skip dugme mora da radi u svim
 * blokovima savršeno". Static coverage probe — verifies that the unified
 * SPIN / STOP / SLAM / SKIP CTA (`spinControl.mjs` V3) is mounted and the
 * full state-machine wiring is present in every capsule under
 * dist/real-games/<game>/slot.html AND every grid-kind demo under
 * dist/<kind>_playable.html.
 *
 * Coverage matrix:
 *   • 4 real GDD capsules (HNP, WoO, GoO1000, Starlight)
 *   • All grid-kind demos under dist/ (rectangular, cluster, hex, wheel,
 *     crash, slingo, plinko, expanding, infinity, lock_respin, etc.)
 *
 * For each capsule we check:
 *   1. spinBtn DOM node mounted (the V3 unified CTA host)
 *   2. State-machine wiring: preSpin / postSpin / onSlamComplete /
 *      onWinPresentationStart / onWinPresentationEnd / onFsTrigger /
 *      onFsEnd / onBigWinTierEntered / onSkipComplete listeners
 *   3. H&W lifecycle integration (BUG-3 fix): onHoldAndWinIntro /
 *      onHoldAndWinStart / onHoldAndWinEnd listeners
 *   4. Compliance gate recovery (BUG-5 fix): onCruksCheckPending /
 *      onManualSpinPaceBlocked / onCoolOffEnforced / onWinCapReached
 *   5. Race-window hardening: slamPendingSettle guard in reels-area
 *      handler + expectsFinalize guard in pending-slam timer
 *   6. Space-key drain hardened (BUG-2): MutationObserver checks
 *      slamPendingSettle before draining
 *
 * Output: per-capsule table + final summary. Exit 1 on any miss.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const RED = '\x1b[31m', GREEN = '\x1b[32m', RESET = '\x1b[0m', DIM = '\x1b[2m';

const CHECKS = [
  // Mount
  ['1. spinBtn mounted',                'id="spinBtn"'],
  // Core lifecycle wiring (existing contract)
  ['2. preSpin listener',               "HookBus.on('preSpin'"],
  ['3. postSpin listener',              "HookBus.on('postSpin'"],
  ['4. onSlamComplete listener',        "HookBus.on('onSlamComplete'"],
  ['5. onWinPresentationStart',         "HookBus.on('onWinPresentationStart'"],
  ['6. onWinPresentationEnd',           "HookBus.on('onWinPresentationEnd'"],
  ['7. onFsTrigger morph',              "HookBus.on('onFsTrigger'"],
  ['8. onFsEnd morph',                  "HookBus.on('onFsEnd'"],
  ['9. onBigWinTierEntered',            "HookBus.on('onBigWinTierEntered'"],
  ['10. onSkipComplete',                "HookBus.on('onSkipComplete'"],
  // BUG-3 fix — H&W lifecycle awareness
  ['11. onHoldAndWinIntro hide CTA',    "HookBus.on('onHoldAndWinIntro'"],
  ['12. onHoldAndWinStart restore CTA', "HookBus.on('onHoldAndWinStart'"],
  ['13. onHoldAndWinEnd restore CTA',   "HookBus.on('onHoldAndWinEnd'"],
  // BUG-5 fix — compliance gate recovery
  ['14. onCruksCheckPending recover',   "HookBus.on('onCruksCheckPending'"],
  ['15. onManualSpinPaceBlocked',       "HookBus.on('onManualSpinPaceBlocked'"],
  ['16. onCoolOffEnforced',             "HookBus.on('onCoolOffEnforced'"],
  ['17. onWinCapReached',               "HookBus.on('onWinCapReached'"],
  // BUG-1, BUG-7, BUG-8 race / pending-slam hardening
  ['18. reels-click slamPendingSettle', 'STATE.slamPendingSettle) return'],
  ['19. pending-slam expectsFinalize',  '!STATE.expectsFinalize) return'],
  ['20. reels-click try/finally',       'STATE.dispatchLocked = false;'],
  // BUG-2 fix — Space-drain observer guard
  ['21. Space-drain guard',             'slamPendingSettle'],
];

function capsule(label, path) {
  if (!existsSync(path)) return null;
  const html = readFileSync(path, 'utf8');
  const rows = CHECKS.map(([name, token]) => ({ name, token, present: html.includes(token) }));
  return { label, path, rows, size: html.length };
}

const capsules = [];
// 4 real GDDs
const realGames = [
  'huff-n-more-puff-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
  'starlight-travellers-gdd',
];
for (const g of realGames) {
  capsules.push(capsule(`REAL · ${g}`, `${REPO}/dist/real-games/${g}/slot.html`));
}
// Grid-kind playable demos
const distDir = `${REPO}/dist`;
if (existsSync(distDir)) {
  for (const f of readdirSync(distDir).sort()) {
    if (/_playable\.html$/.test(f)) {
      const kind = f.replace(/_playable\.html$/, '');
      capsules.push(capsule(`KIND · ${kind}`, `${distDir}/${f}`));
    }
  }
}

const present = capsules.filter(Boolean);
console.log(`\n══ SPIN/STOP/SKIP CTA COVERAGE · ${present.length} capsule(s) ═══════════════════════════`);
let allPass = true;
const aggregate = {};
for (const cap of present) {
  const passed = cap.rows.filter(x => x.present).length;
  const total = cap.rows.length;
  const verdict = passed === total ? `${GREEN}${passed}/${total}${RESET}` : `${RED}${passed}/${total}${RESET}`;
  console.log(`\n— ${cap.label} (${(cap.size / 1024).toFixed(1)} KB) · ${verdict} —`);
  for (const row of cap.rows) {
    const mark = row.present ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    if (!row.present) allPass = false;
    if (!aggregate[row.name]) aggregate[row.name] = { token: row.token, pass: 0, fail: [] };
    if (row.present) aggregate[row.name].pass++;
    else aggregate[row.name].fail.push(cap.label);
    console.log(`  ${mark} ${row.name.padEnd(40)} ${DIM}[${row.token.slice(0, 50)}]${RESET}`);
  }
}

const missing = Object.entries(aggregate).filter(([, v]) => v.fail.length > 0);
console.log('\n══ AGGREGATE — checks MISSING in ANY capsule ════════════════════════════════');
if (missing.length === 0) {
  console.log(`${GREEN}✓ All ${CHECKS.length} CTA checks present in all ${present.length} capsules${RESET}`);
} else {
  for (const [name, v] of missing) {
    console.log(`${RED}✗${RESET} ${name.padEnd(40)} → missing in ${v.fail.length}/${present.length}: ${v.fail.slice(0, 3).join(', ')}${v.fail.length > 3 ? `, +${v.fail.length - 3} more` : ''}`);
  }
  process.exit(1);
}
