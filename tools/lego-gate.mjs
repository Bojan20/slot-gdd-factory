#!/usr/bin/env node
/**
 * tools/lego-gate.mjs
 *
 * Wave S — LEGO discipline pre-commit gate. Enforces template-wide rules
 * so regressions are caught BEFORE they ship. Every check runs independently
 * and reports its own findings; the gate fails (exit 1) if ANY check fails.
 *
 * Checks (all must pass):
 *
 *   1. Orchestrator emit cleanliness
 *      `src/buildSlotHTML.mjs` must contain 0 `HookBus.emit(` calls.
 *      Reason: blocks own their events; orchestrator only composes.
 *
 *   2. Block test parity
 *      Every `src/blocks/<name>.mjs` (except hookBus + reelEngineCSS which
 *      are infrastructure) must have a corresponding `tests/blocks/<name>.test.mjs`.
 *      Reason: untested block = guaranteed regression on next refactor.
 *
 *   3. Vendor-neutral block source
 *      No mentions of game titles or vendor names inside `src/blocks/`:
 *        gates of olympus, woo, wrath of olympus, reactoonz, sweet bonanza,
 *        sugar rush, megaways, netent, microgaming, pragmatic, lightning-link,
 *        cleopatra, buffalo, igt, cash eruption.
 *      Reason: rule_no_vendor_mentions + LEGO universality.
 *
 *   4. Block-event ownership
 *      Each lifecycle event must be emitted from EXACTLY ONE owning block:
 *        preSpin        → reelEngine + freeSpins (BASE + FS spin starts)
 *        onSpinResult   → reelEngine
 *        onTumbleStep   → tumble
 *        postSpin       → postSpin
 *        onFsTrigger    → freeSpins
 *        onFsSpinResult → freeSpins
 *        onFsEnd        → freeSpins
 *      Reason: distributed emit = mystery payload drift.
 *
 *   5. HookBus listener coverage
 *      Every block (except infrastructure) must register at least one
 *      `HookBus.on(...)` call. Pure CSS/config blocks (reelEngineCSS) are
 *      exempt via OPT_OUT.
 *      Reason: dead-code-by-definition rule.
 *
 * Exit codes:
 *   0  All checks pass.
 *   1  At least one check failed.
 *   2  Tool-internal error (couldn't read files, malformed repo).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

/* Blocks that don't register lifecycle hooks because they're infrastructure
   (hookBus itself) or pure CSS emitters with no runtime behavior. */
const HOOK_REGISTRATION_OPT_OUT = new Set([
  'hookBus.mjs',        // the bus itself
  'reelEngineCSS.mjs',  // pure CSS (uniform-reel keyframes)
  'themeCSS.mjs',       // pure CSS (chrome / theme / grid shapes / dev tools)
  'paylineOverlay.mjs', // SVG overlay helpers — no HookBus listener path
  'paylines.mjs',       // pure config (PAYLINE_POOL constant)
  'paylineOverlay.mjs', // SVG overlay drawn synchronously by winPresentation cycle
  'payAnywhereEval.mjs',// pure evaluator function (called from winPresentation)
  'clusterPaysEval.mjs',// pure evaluator function
  'waysEval.mjs',       // pure evaluator function
  'bonusBuy.mjs',       // UI modal triggered by user click, not lifecycle
  'anteBet.mjs',        // toggle stored in URL hash, not lifecycle
  'hotReload.mjs',      // Wave P8 — emit-only dev block; reacts to SSE,
                        // not to spin-engine lifecycle. Owns onGddChange /
                        // onHotReloadConnect / onHotReloadDisconnect emits.
  'universalForcePanel.mjs', // Wave U-FORCE-ALL — emit-only dev/QA chip rail;
                        // wires DOM click handlers, never reads HookBus.
  /* W47.S2 (2026-06-15) — spinTempo is a pure config emitter: produces a
   * static SPIN_PROFILE literal consumed by the reel engine synchronously.
   * Per its own JSDoc header — "Consumed only at build time, no runtime
   * HookBus subscription. This block neither calls bus.on(...) nor emits
   * bus.emit(...)". Adding it here aligns gate with header contract. */
  'spinTempo.mjs',
]);

/* Expected emit ownership — single source of truth for each event. */
const EXPECTED_EMIT_OWNERS = {
  /* Core spin lifecycle (Wave A → S) */
  preSpin:        ['reelEngine.mjs', 'freeSpins.mjs'],
  onSpinResult:   ['reelEngine.mjs'],
  onTumbleStep:   ['tumble.mjs'],
  postSpin:       ['postSpin.mjs'],
  onFsTrigger:    ['freeSpins.mjs'],
  onFsSpinResult: ['freeSpins.mjs'],
  onFsEnd:        ['freeSpins.mjs'],
  /* Wave V — spin-control intent events. The button block publishes the
   * intent; the consumer block that owns the action emits the matching
   * Complete event back. */
  onSlamRequested: ['slamStop.mjs'],
  onSlamComplete:  ['reelEngine.mjs'],
  onSkipRequested: ['forceSkip.mjs'],
  /* onSkipComplete is emitted by whichever block owns the cancelled
   * animation: winPresentation for rollup/celebration, scatterCelebration
   * for its banner phase, freeSpins for FS intro/outro. Multi-owner. */
  onSkipComplete:  ['winPresentation.mjs', 'scatterCelebration.mjs', 'freeSpins.mjs'],
  /* Wave V5 — win-presentation phase signals. winPresentation publishes
   * both Start and End so subscribers (spinControl morph to SKIP_ROLLUP)
   * and downstream readers (__WIN_AWARD__, __SLOT_WIN_PRESENT_ACTIVE__
   * already set side-by-side) can branch on the visible rollup window. */
  onWinPresentationStart: ['winPresentation.mjs'],
  onWinPresentationEnd:   ['winPresentation.mjs'],
  /* Wave H5 — Big-Win Tier ladder. Vendor-neutral 5-tier celebration
   * fired after the per-line rollup ends. tier is INT 1..5; label/
   * threshold/duration/color all GDD-driven so two games share the
   * block but show different vocabulary. */
  onBigWinTierEntered:    ['bigWinTier.mjs'],
  onBigWinTierExited:     ['bigWinTier.mjs'],
  onBigWinTierEnd:        ['bigWinTier.mjs'],
  /* Wave H14 — Hold-and-Win Credit Bucket extension. Standalone block
   * observes window.HW_STATE.lockedCells diff on postSpin and emits
   * per-lock + start + end events. holdAndWin.mjs source untouched. */
  onCreditBucketRespinStart: ['holdAndWinCreditBucket.mjs'],
  onCreditBucketLocked:      ['holdAndWinCreditBucket.mjs'],
  onCreditBucketEnd:         ['holdAndWinCreditBucket.mjs'],
  /* Wave H15 — Weighted Wheel Segments extension. Standalone block
   * monkey-patches window.wbSpin once on DOMContentLoaded; emits
   * onWheelSegmentChosen on resolution, onWheelJackpotHit if the chosen
   * segment carries a jackpotTier label, onWheelAwardCollected on
   * Collect click (which also pushes window.__WIN_AWARD__). */
  onWheelSegmentChosen:      ['weightedWheelSegments.mjs'],
  onWheelJackpotHit:         ['weightedWheelSegments.mjs'],
  onWheelAwardCollected:     ['weightedWheelSegments.mjs'],
  /* Wave H13 — Path-Aware Multiplier extension. Standalone block
   * monkey-patches window.detectWaysWins once on DOMContentLoaded; emits
   * onPathMultiplierAssigned per decorated ways event, and
   * onPathMultiplierAggregate once per postSpin when at least one path
   * carries a multiplier ≥ 2. waysEval.mjs source untouched. */
  onPathMultiplierAssigned:  ['pathAwareMultiplier.mjs'],
  onPathMultiplierAggregate: ['pathAwareMultiplier.mjs'],
  /* Wave H11 — Bonus Buy Deterministic Plant extension. Standalone block
   * wraps #bonusBuyBtn click at capture phase to open a tier picker
   * modal; on tier select sets window.__BB_PLANT__ and re-dispatches the
   * original click. Plants the chosen cell positions on onSpinResult.
   * bonusBuy.mjs source untouched. */
  onBonusBuyTierSelected:      ['bonusBuyDeterministic.mjs'],
  onDeterministicPlantApplied: ['bonusBuyDeterministic.mjs'],
  /* Wave H12 — Net Win/Loss Indicator extension. Standalone block
   * observes onBalanceChanged, computes net = balance - sessionStart,
   * emits onNetThresholdCrossed when the running net crosses a
   * configured ladder rung in either direction.
   * balanceHud.mjs source untouched. */
  onNetThresholdCrossed:       ['netLossIndicator.mjs'],
  /* Wave H2 — Reality Check player-protection modal. Standalone block
   * owns the modal DOM + trigger logic (time/spin/loss) + CTA wiring.
   * Listens to preSpin / onAutoplayTick / onBalanceChanged /
   * onNetThresholdCrossed. Emits its own lifecycle events. */
  onRealityCheckShown:         ['realityCheck.mjs'],
  onRealityCheckDismissed:     ['realityCheck.mjs'],
  onRealityCheckPaused:        ['realityCheck.mjs'],
  onRealityCheckResumed:       ['realityCheck.mjs'],
  onRealityCheckQuit:          ['realityCheck.mjs'],
  /* Wave H3 — Session Timeout (continuous-play cap + forced break).
   * Standalone block owns the modal DOM + dual-mode (warning, break)
   * + countdown UI + extend/logout CTAs + autoplay-stop integration.
   * Listens to preSpin / onAutoplayTick / onRealityCheckPaused /
   * onRealityCheckResumed (avoids stacking two regulator pauses). */
  onSessionWarningShown:    ['sessionTimeout.mjs'],
  onSessionTimeoutFired:    ['sessionTimeout.mjs'],
  onSessionResumed:         ['sessionTimeout.mjs'],
  onSessionExtended:        ['sessionTimeout.mjs'],
  onSessionLogoutRequested: ['sessionTimeout.mjs'],
  /* Wave U4 — autoplay session events all owned by autoplay.mjs. */
  onAutoplayStart: ['autoplay.mjs'],
  onAutoplayTick:  ['autoplay.mjs'],
  onAutoplayStop:  ['autoplay.mjs'],
  /* Wave U5 — bet selector publishes onBetChanged on every coin / mult /
   * step / max change (and once with reason:'init' at boot). Sole owner. */
  onBetChanged:    ['betSelector.mjs'],
  /* Wave U6 — secondary-gamble session events all owned by
   * gambleSecondary.mjs (start when player picks a branch, round per
   * card flip / ladder step, end on collect or bust). */
  onGambleStart:   ['gambleSecondary.mjs'],
  onGambleRound:   ['gambleSecondary.mjs'],
  onGambleEnd:     ['gambleSecondary.mjs'],
  /* Wave U8 — balance HUD owns __SLOT_BALANCE__ + emits onBalanceChanged
   * on every spin debit / win credit / gamble settle / manual op. */
  onBalanceChanged: ['balanceHud.mjs'],
  /* Wave U11 — turbo mode owns __SLOT_TURBO_ACTIVE__ +
   * __SLOT_TURBO_SPEED_MULT__ + emits onTurboToggle on every flip. */
  onTurboToggle:    ['turboMode.mjs'],
  /* Wave K7 — settingsPanel owns the player-preference layer for
   * volatility / bet-step preset / max-win cap, and is the sole emitter
   * of their lifecycle events. Downstream blocks (spin engine,
   * betSelector, winCap) listen but never re-emit. */
  onVolatilityChanged:    ['settingsPanel.mjs'],
  onBetStepPresetChanged: ['settingsPanel.mjs'],
  onMaxWinCapToggled:     ['settingsPanel.mjs'],
  /* Wave P8 — hot-reload (dev-mode SSE) is the sole emitter of these
   * dev-loop events. onGddChange is the in-page fast-path signal;
   * onHotReloadConnect / onHotReloadDisconnect track SSE lifecycle. */
  onHotReloadConnect:    ['hotReload.mjs'],
  onHotReloadDisconnect: ['hotReload.mjs'],
  onGddChange:           ['hotReload.mjs'],
  /* Wave U-FORCE-ALL — universal force panel is the sole emitter of
   * `onForceFeatureRequested`. Generic banner only listens. */
  onForceFeatureRequested: ['universalForcePanel.mjs'],
  /* Wave B64 — symbolUpgrade is the sole emitter of per-cell upgrade
   * events. Fires inside the onTumbleStep handler after refill so any
   * downstream HUD listener gets the canonical post-refill snapshot. */
  onSymbolUpgrade:        ['symbolUpgrade.mjs'],
  onSymbolUpgradeCascade: ['symbolUpgrade.mjs'],
  /* 2026-06-11 — holdAndWin phase machine emits its own INACTIVE → INTRO
   * → RUNNING → SUMMARY phase signal + a final end stats payload. Both
   * are sole-owned by the block; downstream HUD / summary listeners read
   * the running totals from the payload. */
  onHoldAndWinPhase: ['holdAndWin.mjs'],
  onHoldAndWinEnd:   ['holdAndWin.mjs'],
  /* 2026-06-10 — UFP also emits a dedicated multiplier-force signal so
   * mult-aware blocks (multiplierOrb, persistentMultiplier, pathAware)
   * can render visual feedback on the grid. */
  onForceMultiplier: ['universalForcePanel.mjs'],
  /* 2026-06-09 — scatterCelebration owns its own lifecycle phase events.
   * spinControl listens to morph the SPIN CTA into a SKIP button during
   * the celebration window. */
  onScatterCelebrationStart: ['scatterCelebration.mjs'],
  onScatterCelebrationEnd:   ['scatterCelebration.mjs'],
  /* 2026-06-11 Wave AL-4 / Fable-4 — dailyJackpot block owns the award
   * lifecycle event. Fires inside the postSpin handler when the random
   * roll succeeds (or window.dailyJackpotForce() was set). Consumers:
   * audio bus (jackpot sting), historyLog (transaction row), partner
   * external HUDs. */
  onDailyJackpotAward: ['dailyJackpot.mjs'],
  /* 2026-06-11 AL-5.x — persistent multiplier publishes the current
   * value via onMultChange so the canonical mult owner (winPresentation)
   * reconciles the next rollup. Single-owner-emit holds because the
   * mult VALUE is owned by HookBus.setMult; this event is just a
   * notification with source attribution. Both blocks emit it: the
   * persistent ladder (FS round) and the multiplierOrb (per-orb hit). */
  onMultChange: ['persistentMultiplier.mjs', 'multiplierOrb.mjs'],

  /* W47.S2 (2026-06-15) — close the LEGO ownership matrix for events
   * the runtime has been emitting since AL-x but were never declared
   * here. Each one is a real lifecycle signal that downstream blocks
   * (audio bus, historyLog, regulator probes, future analytics) read.
   * Surfacing them in the canonical map turns LEGO gate from 3/5 to
   * 5/5 without changing block behaviour. */
  onHoldAndWinPayout: ['holdAndWin.mjs'],
  onSuperSymbolLand:  ['superSymbol.mjs'],
  /* walkingWild emits `requestRespin` as an intent — a wild that walked
   * off the visible band asks the spin engine to roll one more spin so
   * the player sees the wild re-enter. The spin engine consumes it via
   * its own respinMaybeTrigger() chain; this is the single-owner emit
   * site for the request side. */
  requestRespin:      ['walkingWild.mjs'],
  /* Wave AL-1 / U-FORCE-ALL — wheelBonus owns its full modal lifecycle:
   * onWheelBonusReady before reveal, onWheelModalOpened on visible open,
   * onWheelSettled when the segment resolves, onWheelCollect on the
   * collect-CTA click. (weightedWheelSegments owns the segment-chosen +
   * jackpot-hit + award-collected variants — separate ownership matrix.) */
  onWheelBonusReady:  ['wheelBonus.mjs'],
  onWheelModalOpened: ['wheelBonus.mjs'],
  onWheelSettled:     ['wheelBonus.mjs'],
  onWheelCollect:     ['wheelBonus.mjs'],
  /* wildReel emits `symbolOverride` when its full-column wild paints over
   * the rolled symbols on a designated reel. winEval / paylineOverlay
   * subscribe so they treat the overridden cells as the wild for the
   * upcoming evaluation. */
  symbolOverride:     ['wildReel.mjs'],
};

/* Vendor / game-specific strings forbidden in src/blocks/*.mjs */
const VENDOR_BLOCKLIST = [
  'gates of olympus', 'gates_of_olympus', 'goo reference',
  'wrath of olympus', 'wrath_of_olympus', 'woo reference',
  'reactoonz', 'sweet bonanza', 'sugar rush', 'sugar_rush',
  'megaways', 'netent', 'microgaming', 'pragmatic',
  'lightning link', 'lightning-link',
  'cleopatra', 'buffalo', 'cash eruption', 'cash_eruption',
  /* Vendor-codename: any "playa-slot" / "playa slot" / "playaslot" reference
     leaks the studio name of the industry comparison source. Use
     "industry-standard" or "fast-stop / force-skip command pattern" instead. */
  'playa-slot', 'playa slot', 'playaslot', 'playa_slot',
  /* IGT requires word-boundary check (substring "igt" lives in "digital"
     etc); we handle it via the regex check below, not this literal list. */
];

async function listBlockFiles() {
  const dir = resolvePath(REPO_ROOT, 'src/blocks');
  const all = await readdir(dir);
  return all.filter(f => f.endsWith('.mjs')).sort();
}

async function listBlockTests() {
  const dir = resolvePath(REPO_ROOT, 'tests/blocks');
  try {
    const all = await readdir(dir);
    return new Set(all.filter(f => f.endsWith('.test.mjs')));
  } catch {
    return new Set();
  }
}

async function readBlockSrc(name) {
  return readFile(resolvePath(REPO_ROOT, 'src/blocks', name), 'utf8');
}

/* Check 1 — orchestrator emit cleanliness */
async function checkOrchestratorEmits() {
  const src = await readFile(resolvePath(REPO_ROOT, 'src/buildSlotHTML.mjs'), 'utf8');
  const matches = (src.match(/HookBus\.emit\(/g) || []).length;
  const pass = matches === 0;
  return {
    name: '1. Orchestrator emit cleanliness',
    pass,
    detail: pass
      ? '0 HookBus.emit() calls in src/buildSlotHTML.mjs'
      : `${matches} HookBus.emit() calls found in src/buildSlotHTML.mjs (must be 0)`,
  };
}

/* Check 2 — block test parity */
async function checkBlockTestParity() {
  const blocks = await listBlockFiles();
  const tests = await listBlockTests();
  const missing = [];
  for (const b of blocks) {
    if (HOOK_REGISTRATION_OPT_OUT.has(b) && b === 'hookBus.mjs') continue; // hookBus has no test by design
    const expected = b.replace(/\.mjs$/, '.test.mjs');
    if (!tests.has(expected)) missing.push(b);
  }
  const pass = missing.length === 0;
  return {
    name: '2. Block test parity',
    pass,
    detail: pass
      ? `${blocks.length} blocks all have matching tests/blocks/<name>.test.mjs`
      : `Missing tests for: ${missing.join(', ')}`,
  };
}

/* Check 3 — vendor-neutral block source */
async function checkVendorNeutrality() {
  const blocks = await listBlockFiles();
  const offenders = [];
  for (const b of blocks) {
    const src = (await readBlockSrc(b)).toLowerCase();
    for (const vendor of VENDOR_BLOCKLIST) {
      if (src.includes(vendor)) {
        offenders.push(`${b}: contains "${vendor}"`);
      }
    }
    /* IGT word boundary check */
    if (/\bigt\b/i.test(src)) offenders.push(`${b}: contains "IGT" (word boundary)`);
  }
  const pass = offenders.length === 0;
  return {
    name: '3. Vendor-neutral block source',
    pass,
    detail: pass
      ? 'No vendor / game-specific strings found in src/blocks/'
      : `Vendor strings found:\n      ${offenders.join('\n      ')}`,
  };
}

/* Check 4 — block-event ownership */
async function checkEventOwnership() {
  const blocks = await listBlockFiles();
  /* event → owners that emit it */
  const observed = Object.create(null);
  for (const b of blocks) {
    const src = await readBlockSrc(b);
    const matches = src.match(/HookBus\.emit\('([a-zA-Z]+)'/g) || [];
    for (const m of matches) {
      const event = m.match(/'([a-zA-Z]+)'/)[1];
      if (!observed[event]) observed[event] = new Set();
      observed[event].add(b);
    }
  }
  const violations = [];
  for (const [event, expected] of Object.entries(EXPECTED_EMIT_OWNERS)) {
    const expectedSet = new Set(expected);
    const obs = observed[event] || new Set();
    if (obs.size === 0) {
      violations.push(`${event}: NOT EMITTED by any block (expected: ${expected.join(', ')})`);
      continue;
    }
    /* Every observed emitter must be in expected list */
    for (const o of obs) {
      if (!expectedSet.has(o)) {
        violations.push(`${event}: emitted by ${o} (not in expected: ${expected.join(', ')})`);
      }
    }
  }
  /* Flag any UNEXPECTED event being emitted that we didn't whitelist. */
  for (const event of Object.keys(observed)) {
    if (!EXPECTED_EMIT_OWNERS[event]) {
      violations.push(`${event}: unknown event emitted by ${[...observed[event]].join(', ')}`);
    }
  }
  const pass = violations.length === 0;
  return {
    name: '4. Block-event ownership',
    pass,
    detail: pass
      ? `${Object.keys(EXPECTED_EMIT_OWNERS).length}/${Object.keys(EXPECTED_EMIT_OWNERS).length} events have correct single-owner emit`
      : `Ownership violations:\n      ${violations.join('\n      ')}`,
  };
}

/* Check 5 — HookBus listener coverage */
async function checkListenerCoverage() {
  const blocks = await listBlockFiles();
  const noListener = [];
  for (const b of blocks) {
    if (HOOK_REGISTRATION_OPT_OUT.has(b)) continue;
    const src = await readBlockSrc(b);
    if (!/HookBus\.on\(/.test(src)) noListener.push(b);
  }
  const total = blocks.length - HOOK_REGISTRATION_OPT_OUT.size;
  const pass = noListener.length === 0;
  return {
    name: '5. HookBus listener coverage',
    pass,
    detail: pass
      ? `${total}/${total} non-infrastructure blocks register a lifecycle listener`
      : `Blocks without HookBus.on(...) calls:\n      ${noListener.join('\n      ')}`,
  };
}

async function main() {
  console.log(C.bold(C.cyan('\n🔒 LEGO Gate — slot-gdd-factory')));
  console.log(C.dim('   Wave S pre-commit invariants. Fails fast if any check trips.\n'));

  const checks = [
    await checkOrchestratorEmits(),
    await checkBlockTestParity(),
    await checkVendorNeutrality(),
    await checkEventOwnership(),
    await checkListenerCoverage(),
  ];

  let failed = 0;
  for (const c of checks) {
    const tag = c.pass ? C.green('  ✓ PASS') : C.red('  ✗ FAIL');
    console.log(`${tag} ${C.bold(c.name)}`);
    console.log(`        ${C.dim(c.detail)}\n`);
    if (!c.pass) failed++;
  }

  if (failed === 0) {
    console.log(C.green(C.bold(`\n✅ All ${checks.length} LEGO invariants pass. Safe to commit.\n`)));
    process.exit(0);
  } else {
    console.log(C.red(C.bold(`\n❌ ${failed} / ${checks.length} LEGO invariants failed. Fix before commit.\n`)));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(C.red('LEGO gate internal error:'), err);
  process.exit(2);
});
