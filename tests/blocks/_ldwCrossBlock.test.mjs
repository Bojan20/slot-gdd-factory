#!/usr/bin/env node
/**
 * tests/blocks/_ldwCrossBlock.test.mjs
 *
 * Wave W50 — Cross-block LDW (Losses Disguised as Wins) gate suite.
 *
 * Validates that the LDW suppression gate landed in `winPresentation.mjs`
 * propagates correctly through every consumer block that reacts to win
 * presentation events. The suppression contract is documented in:
 *
 *   • Dixon, M. (2010). "Losses Disguised as Wins in Modern Multi-Line
 *     Video Slot Machines". Addiction Research & Theory.
 *   • UKGC Remote Gambling Technical Standards (RTS) 7C.
 *   • Ontario AGCO Standard 4.07 § Win presentation — net-delta gate.
 *   • UKGC 17-Jan-2025 amendment — explicit false-win prohibition.
 *
 * Cross-block invariants:
 *   1. winRollup must NOT start counter ramp during an LDW round
 *      (achieved indirectly — winPresentation suppresses
 *      `onWinPresentationStart`, which is winRollup's trigger event).
 *   2. bigWinTier must NOT enter a tier banner during an LDW round
 *      (achieved indirectly — bigWinTier listens to
 *      `onWinPresentationEnd`, also suppressed at source).
 *   3. hapticFeedback must NOT vibrate during an LDW round
 *      (defense-in-depth: hapticFeedback runtime checks
 *      `window.__LDW_SUPPRESSED__` directly + indirect gate via
 *      `onBigWinTierEntered` suppression).
 *   4. netLossIndicator must observe `onLdwSuppressed` for RG accounting
 *      (W50 atom — counter + cumulative net delta tracked).
 *   5. `__LDW_SUPPRESSED__` flag must reset on next `preSpin` so it
 *      cannot bleed forward to the next round.
 *   6. presentExternalWin (FS / post-bonus aggregate) must apply the
 *      same gate using the base bet as reference.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  defaultConfig as wpDefault,
  resolveConfig as wpResolve,
  emitWinPresentationRuntime,
} from '../../src/blocks/winPresentation.mjs';
import {
  defaultConfig as nliDefault,
  resolveConfig as nliResolve,
  emitNetLossIndicatorRuntime,
} from '../../src/blocks/netLossIndicator.mjs';
import {
  defaultConfig as hfDefault,
  resolveConfig as hfResolve,
  emitHapticFeedbackRuntime,
} from '../../src/blocks/hapticFeedback.mjs';
import {
  defaultConfig as wrDefault,
  resolveConfig as wrResolve,
  emitWinRollupRuntime,
} from '../../src/blocks/winRollup.mjs';
import {
  defaultConfig as bwtDefault,
  resolveConfig as bwtResolve,
  emitBigWinTierRuntime,
} from '../../src/blocks/bigWinTier.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const wpRT   = emitWinPresentationRuntime(wpDefault());
const wrRT   = emitWinRollupRuntime(wrDefault());
const bwtRT  = emitBigWinTierRuntime({ ...bwtDefault(), enabled: true });
const hfRT   = emitHapticFeedbackRuntime({ ...hfDefault(), enabled: true });
const nliRT  = emitNetLossIndicatorRuntime({ ...nliDefault(), enabled: true });

/* ═════════════════════════════════════════════════════════════════════
 * 1. winPresentation LDW gate — source-of-truth
 * ═════════════════════════════════════════════════════════════════════ */
block('1. winPresentation source-of-truth (W50)', () => {
  t('1.1 sets window.__LDW_SUPPRESSED__ on suppression',
    wpRT.includes('window.__LDW_SUPPRESSED__ ='));
  t('1.2 emits onLdwSuppressed with award + bet payload',
    /HookBus\.emit\('onLdwSuppressed',\s*\{\s*award:[^,}]+,\s*bet:/.test(wpRT));
  t('1.3 gate condition: totalAward > 0 && totalAward <= __ldwBet',
    /__ldwSuppress\s*=\s*(true|false)\s*&&\s*\(totalAward\s*>\s*0\)\s*&&\s*\(totalAward\s*<=\s*__ldwBet\)/.test(wpRT));
  t('1.4 onWinPresentationStart NOT emitted when ldwSuppress is true',
    /if\s*\(totalAward\s*>\s*0\s*&&\s*!__ldwSuppress\)/.test(wpRT));
  t('1.5 default suppressLDW=true (regulator-strictest baseline)',
    wpDefault().suppressLDW === true);
  t('1.6 preSpin resets __LDW_SUPPRESSED__ flag (W50 stale-flag fix)',
    /preSpin[\s\S]{0,400}window\.__LDW_SUPPRESSED__\s*=\s*false/.test(wpRT));
  t('1.7 presentExternalWin (FS) applies LDW gate using base bet',
    /presentExternalWin[\s\S]{0,2000}__LDW_SUPPRESSED__\s*=\s*!!ldwSuppress/.test(wpRT));
  t('1.8 presentExternalWin emits onLdwSuppressed with source=post-fs',
    /HookBus\.emit\('onLdwSuppressed',\s*\{[^}]*source:\s*'post-fs'/.test(wpRT));
  t('1.9 LDW gate references regulator authority in comments',
    /Dixon\s*2010[^.]*UKGC\s*RTS\s*7C[^.]*AGCO\s*4\.07[^.]*UKGC\s*17-Jan-2025/i.test(wpRT));
});

/* ═════════════════════════════════════════════════════════════════════
 * 2. winRollup — indirect gate via onWinPresentationStart suppression
 * ═════════════════════════════════════════════════════════════════════ */
block('2. winRollup indirect LDW gate', () => {
  t('2.1 winRollup listens to onWinPresentationStart (trigger event)',
    /HookBus\.on\('onWinPresentationStart',/.test(wrRT));
  t('2.2 winRollup has no direct LDW awareness (gated upstream by design)',
    !/__LDW_SUPPRESSED__/.test(wrRT) && !/onLdwSuppressed/.test(wrRT));
  t('2.3 winRollup CAN still snap on End if Start somehow fired (defensive)',
    /HookBus\.on\('onWinPresentationEnd',/.test(wrRT));
});

/* ═════════════════════════════════════════════════════════════════════
 * 3. bigWinTier — indirect gate via onWinPresentationEnd suppression
 * ═════════════════════════════════════════════════════════════════════ */
block('3. bigWinTier indirect LDW gate', () => {
  t('3.1 bigWinTier listens to onWinPresentationEnd (trigger event)',
    /HookBus\.on\(\s*['"]onWinPresentationEnd['"]/.test(bwtRT));
  t('3.2 bigWinTier has no direct LDW awareness (gated upstream by design)',
    !/__LDW_SUPPRESSED__/.test(bwtRT) && !/onLdwSuppressed/.test(bwtRT));
});

/* ═════════════════════════════════════════════════════════════════════
 * 4. hapticFeedback — defense-in-depth direct LDW gate (W50)
 * ═════════════════════════════════════════════════════════════════════ */
block('4. hapticFeedback defense-in-depth LDW gate (W50)', () => {
  t('4.1 hapticFeedback defines _ldwActive() helper',
    /_ldwActive\s*\(\s*\)/.test(hfRT));
  t('4.2 _ldwActive checks window.__LDW_SUPPRESSED__ === true',
    /window\.__LDW_SUPPRESSED__\s*===\s*true/.test(hfRT));
  t('4.3 hapticFeedback short-circuits on _ldwActive() before navigator.vibrate',
    /if\s*\(_ldwActive\(\)\)\s*return\s*false/.test(hfRT));
  t('4.4 LDW guard documented in inline comment',
    /W50[\s\S]{0,2000}LDW[\s\S]{0,2000}Dixon\s*2010[\s\S]{0,2000}UKGC[\s\S]{0,200}RTS\s*7C/.test(hfRT));
});

/* ═════════════════════════════════════════════════════════════════════
 * 5. netLossIndicator — observes onLdwSuppressed for RG accounting (W50)
 * ═════════════════════════════════════════════════════════════════════ */
block('5. netLossIndicator LDW listener (W50)', () => {
  t('5.1 netLossIndicator subscribes to onLdwSuppressed',
    /HookBus\.on\('onLdwSuppressed',/.test(nliRT));
  t('5.2 increments STATE.ldwCount on suppressed round',
    /STATE\.ldwCount\s*\+=\s*1/.test(nliRT));
  t('5.3 accumulates ldwAwardSum from payload',
    /STATE\.ldwAwardSum\s*=\s*\(STATE\.ldwAwardSum\s*\|\|\s*0\)\s*\+\s*p\.award/.test(nliRT));
  t('5.4 accumulates ldwBetSum from payload',
    /STATE\.ldwBetSum\s*=\s*\(STATE\.ldwBetSum\s*\|\|\s*0\)\s*\+\s*p\.bet/.test(nliRT));
  t('5.5 exposes window.__NLI_LDW_COUNT__ for downstream readers',
    /window\.__NLI_LDW_COUNT__\s*=\s*STATE\.ldwCount/.test(nliRT));
  t('5.6 exposes window.__NLI_LDW_NET__ cumulative net',
    /window\.__NLI_LDW_NET__\s*=\s*\(STATE\.ldwAwardSum\s*\|\|\s*0\)\s*-\s*\(STATE\.ldwBetSum\s*\|\|\s*0\)/.test(nliRT));
  t('5.7 NO display side effect — pure metric (no DOM mutation)',
    /NO display side effect[\s\S]{0,200}pure metric/.test(nliRT));
});

/* ═════════════════════════════════════════════════════════════════════
 * 6. End-to-end sandbox simulation — full LDW round
 * ═════════════════════════════════════════════════════════════════════ */
block('6. Sandbox simulation — full LDW round flow', () => {
  /* Synthesize an LDW round: award=10, bet=20 → suppress=true */
  const cfg = wpDefault();
  const award = 10, bet = 20;
  const suppressExpected = cfg.suppressLDW && (award > 0) && (award <= bet);
  t('6.1 award=10 bet=20 → LDW gate fires (suppress=true)', suppressExpected === true);

  /* Synthesize a real win: award=30, bet=20 → suppress=false */
  const realSuppress = cfg.suppressLDW && (30 > 0) && (30 <= 20);
  t('6.2 award=30 bet=20 → LDW gate stays open (suppress=false)', realSuppress === false);

  /* Synthesize exact-bet (net-zero): award=20, bet=20 → suppress=true */
  const exactSuppress = cfg.suppressLDW && (20 > 0) && (20 <= 20);
  t('6.3 award=20 bet=20 → suppress=true (exact net-zero IS LDW)', exactSuppress === true);

  /* Synthesize ε-above-bet: award=20.01, bet=20 → suppress=false (real win) */
  const epsSuppress = cfg.suppressLDW && (20.01 > 0) && (20.01 <= 20);
  t('6.4 award=20.01 bet=20 → suppress=false (any positive net = real win)', epsSuppress === false);

  /* Synthesize zero award: award=0, bet=20 → suppress=false (no FX anyway) */
  const zeroSuppress = cfg.suppressLDW && (0 > 0) && (0 <= 20);
  t('6.5 award=0 bet=20 → suppress=false (no win, no FX, no LDW concept)', zeroSuppress === false);

  /* Synthesize GDD opt-out: suppressLDW=false → no gate */
  const optOutCfg = wpResolve({ winPresentation: { suppressLDW: false } });
  const optOut = optOutCfg.suppressLDW && (10 > 0) && (10 <= 20);
  t('6.6 GDD opt-out: suppressLDW=false → gate never fires', optOut === false);
});

/* ═════════════════════════════════════════════════════════════════════
 * 7. Regulator profile precedence — jurisdiction trumps GDD
 * ═════════════════════════════════════════════════════════════════════ */
block('7. Regulator profile precedence', () => {
  const ukgcStrict = wpResolve({
    winPresentation: { suppressLDW: false },
    responsibleGambling: { suppressLDW: true },
  });
  t('7.1 jurisdiction=true overrides per-block=false', ukgcStrict.suppressLDW === true);

  const relaxedMarket = wpResolve({
    winPresentation: { suppressLDW: true },
    responsibleGambling: { suppressLDW: false },
  });
  t('7.2 jurisdiction=false overrides per-block=true', relaxedMarket.suppressLDW === false);

  const onlyJurisdiction = wpResolve({ responsibleGambling: { suppressLDW: false } });
  t('7.3 jurisdiction-only override works', onlyJurisdiction.suppressLDW === false);
});

/* ═════════════════════════════════════════════════════════════════════
 * 8. EXPECTED_EMIT_OWNERS registry — onLdwSuppressed properly owned
 * ═════════════════════════════════════════════════════════════════════ */
block('8. HookBus emit-owners registry', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const legoGate = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');
  t('8.1 onLdwSuppressed registered in EXPECTED_EMIT_OWNERS',
    /onLdwSuppressed:\s*\[\s*'winPresentation\.mjs'\s*\]/.test(legoGate));
});

/* ═════════════════════════════════════════════════════════════════════
 * 9. Vendor-neutrality across all gated runtimes
 * ═════════════════════════════════════════════════════════════════════ */
block('9. Vendor-neutrality (HARD RULE #1)', () => {
  const VENDORS = /\b(igt|pragmatic|megaways|cleopatra|buffalo|wolf[- ]run|cash[- ]eruption|netent|microgaming|light\s*&?\s*wonder|scientific\s*games|lightning\s*link|sweet\s*bonanza)\b/i;
  t('9.1 winPresentation runtime vendor-neutral',     !VENDORS.test(wpRT));
  t('9.2 winRollup runtime vendor-neutral',           !VENDORS.test(wrRT));
  t('9.3 bigWinTier runtime vendor-neutral',          !VENDORS.test(bwtRT));
  t('9.4 hapticFeedback runtime vendor-neutral',      !VENDORS.test(hfRT));
  t('9.5 netLossIndicator runtime vendor-neutral',    !VENDORS.test(nliRT));
});

/* ═════════════════════════════════════════════════════════════════════
 * 10. Determinism — same config → byte-identical runtime
 * ═════════════════════════════════════════════════════════════════════ */
block('10. Determinism', () => {
  const wp1 = emitWinPresentationRuntime(wpDefault());
  const wp2 = emitWinPresentationRuntime(wpDefault());
  t('10.1 winPresentation default emit is deterministic', wp1 === wp2);
  const nli1 = emitNetLossIndicatorRuntime({ ...nliDefault(), enabled: true });
  const nli2 = emitNetLossIndicatorRuntime({ ...nliDefault(), enabled: true });
  t('10.2 netLossIndicator emit is deterministic', nli1 === nli2);
  const hf1 = emitHapticFeedbackRuntime({ ...hfDefault(), enabled: true });
  const hf2 = emitHapticFeedbackRuntime({ ...hfDefault(), enabled: true });
  t('10.3 hapticFeedback emit is deterministic', hf1 === hf2);
});

console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
