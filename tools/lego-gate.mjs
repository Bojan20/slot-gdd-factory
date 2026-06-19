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
  'pwaInstallability.mjs', // Wave A8 — emit-only PWA lifecycle (SW ready,
                        // A2HS prompt, appinstalled); listens to window
                        // events directly, never reads HookBus.
  'motionOverlay.mjs',  // Wave 3 — pure CSS emit (per-engine ::after motion
                        // overlay). No runtime, no lifecycle listener; the
                        // overlay is painted by CSS and animated by the
                        // browser when `.is-spinning` class is present.
  /* W47.S2 (2026-06-15) — spinTempo is a pure config emitter: produces a
   * static SPIN_PROFILE literal consumed by the reel engine synchronously.
   * Per its own JSDoc header — "Consumed only at build time, no runtime
   * HookBus subscription. This block neither calls bus.on(...) nor emits
   * bus.emit(...)". Adding it here aligns gate with header contract. */
  'spinTempo.mjs',
  /* W58.J-DE — germanyComplianceGate is an emit-only boot block. Sets
   * window.__DE_MIN_SPIN_MS__ flag + clears prefixed storage + fires
   * onMinSpinPaceEnforced + onGameStateCleared. Has no spin-lifecycle
   * listener — it INFORMS downstream consumers, never reads from them. */
  'germanyComplianceGate.mjs',
  /* W58.J-NL — netherlandsComplianceGate is an emit-only boot block.
   * Sets window.__NL_CRUKS_CHECK_REQUIRED__ + __NL_COOL_OFF_HOURS__
   * flags and fires onCruksCheckRequired + onCoolOffEnforced once at
   * boot. Has no spin-lifecycle listener — it INFORMS the operator's
   * session-init layer of the obligation, never reads from it. */
  'netherlandsComplianceGate.mjs',
  /* W58.J-EU — euAiActComplianceGate is an emit-only boot block. Sets
   * three EU AI Act window flags + fires onAiActDdaProhibited +
   * onAiSystemDeclarationRequired once at boot. Has no spin-lifecycle
   * listener — INFORMS operator session-init + cert harness of the
   * Article 5 + Article 50 obligations. */
  'euAiActComplianceGate.mjs',
  /* W59.H1 — jurisdictionGate is the centralized precedence resolver.
   * Sets window.__SLOT_JURISDICTION__ + fires onJurisdictionResolved
   * once at boot. Has no spin-lifecycle listener — INFORMS downstream
   * consumers (cert harness, telemetry) which jurisdiction the model
   * resolved to, without forcing them to re-walk the precedence chain. */
  'jurisdictionGate.mjs',
  /* W58.J-FR — franceComplianceGate is an emit-only boot block. Sets
   * four ANJ-mandated window flags (autoplay banned, turbo banned,
   * min-spin duration, FRJ self-exclusion check required) and fires
   * the matching audit events once at boot. Has no spin-lifecycle
   * listener — INFORMS the autoplay / turboMode / spin dispatcher of
   * the obligations, never reads from them. */
  'franceComplianceGate.mjs',
  /* W58.J-IT — italyComplianceGate is an emit-only boot block. Sets
   * five ADM-mandated window flags (autoplay banned, turbo banned,
   * min-spin duration, mandatory reality-check interval, RUA self-
   * exclusion check required) and fires the matching audit events
   * once at boot. Has no spin-lifecycle listener. */
  'italyComplianceGate.mjs',
  /* W58.J-ES — spainComplianceGate is an emit-only boot block. Sets
   * five DGOJ-mandated window flags (autoplay banned, min-spin
   * duration, mandatory reality-check interval, RGIAJ self-exclusion
   * check required, bonus-offer restriction) and fires four audit
   * events once at boot. Has no spin-lifecycle listener. */
  'spainComplianceGate.mjs',
]);

/* Expected emit ownership — single source of truth for each event. */
const EXPECTED_EMIT_OWNERS = {
  /* Core spin lifecycle (Wave A → S) */
  /* W57.A2 — `freeSpins.mjs` was co-listed as a `preSpin` emitter but a
   * source audit showed 0 `HookBus.emit('preSpin'` calls inside it
   * (reelEngine.mjs is the sole emitter; freeSpins consumes preSpin
   * via HookBus.on). Dropping the ghost owner so EXPECTED_EMIT_OWNERS
   * tells the truth — gate goes from "matrix lies" to single-owner. */
  preSpin:        ['reelEngine.mjs'],
  /* 2026-06-18 WASH PASS fix — onSpinResult is now emitted by ANY of
   * the topology-specific spin engines (5 engines). Each engine owns
   * the settle moment for its own grid kind; the LEGO single-owner
   * rule is preserved per-topology because at runtime exactly one of
   * these engines is wired (kind-dispatch via window.__SLOT_KIND_RUNSPIN__).
   * Without this multi-listed ownership, hex/wheel/slingo/plinko/crash
   * slots had a silent broken lifecycle — 40+ downstream listeners
   * (multiplierOrb, mysterySymbolMultiplier, wildCollisionMultiplier,
   * stickyWild, etc.) never fired on these topologies. */
  /* WASH PASS #2 (2026-06-19) — REVERTED multi-owner. Commit 406a63f added
   * 5 engines as co-owners, but reelEngine wrapper _wrappedSettled (line
   * 1041) ALREADY emits onSpinResult when it invokes the cb that engines
   * call. Multi-owner caused DOUBLE-EMIT regression. Restored single-owner
   * per CLAUDE.md hard rule. */
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
  /* Wave LDW (W48) — emitted when net delta ≤ 0 and celebration FX is
   * suppressed per Dixon 2010 / UKGC RTS 7C / AGCO 4.07 / UKGC 17-Jan-
   * 2025. Listeners (future): audio block can mute sound, haptic block
   * can skip vibration, telemetry can log the suppressed round. */
  onLdwSuppressed: ['winPresentation.mjs'],
  onWinPresentationEnd:   ['winPresentation.mjs'],
  /* W51 — Win-cap audit events. Cross-jurisdiction enforcement: when
   * cumulative win reaches per-jurisdiction ceiling (UKGC 100k× / MGA
   * 500k× / SE 500k× / DE 100k× / NL 250k× / ON 250k× / NJ 500k×) the
   * round terminates and downstream consumers (telemetry, audit trail,
   * cert harness) log the hit. onWinCapClamped fires once at boot when
   * the operator's requested maxWinX exceeded the jurisdiction ceiling
   * and was forcibly lowered. */
  onWinCapTriggered: ['winCap.mjs'],
  onWinCapClamped:   ['winCap.mjs'],
  /* W58.J-AGCO — RTP transparency disclosure event. ON AGCO Standard
   * 4.06 + UKGC RTS 8 require RTP visible to player at session launch.
   * Emitted once at boot when jurisdiction profile is ON/UKGC/MGA;
   * downstream consumer (regulator modal / paytable / H1 jurisdictionGate)
   * surfaces the RTP to the player. Payload: { jurisdiction, rtp } where
   * rtp may be null when math layer gated (consumer renders placeholder). */
  onRtpDisclosureRequired: ['winCap.mjs'],
  /* W60 — Universal regulator disclosure modal. Listens to ALL
   * *DisclosureRequired / *Enforced / *Prohibited events from W58.J-*
   * gates, renders one accessible queue-aware modal, emits shown/acked
   * envelope events for cert harness + audit log. */
  onRegulatorDisclosureShown:        ['regulatorDisclosureModal.mjs'],
  onRegulatorDisclosureAcknowledged: ['regulatorDisclosureModal.mjs'],
  /* W58.J-UKGC — Autoplay disclosure gate per UKGC LCCP 1.4.6 +
   * ON AGCO Standard 4.06 + MGA Player Protection. Fires when player
   * tries autoplayStart() but jurisdiction requires disclosure and
   * window.__AUTOPLAY_DISCLOSURE_ACK__ is not yet set. Downstream
   * consumer (future H1 jurisdictionGate / regulator modal block)
   * shows the disclosure UI then re-calls autoplayStart with ack set. */
  onAutoplayDisclosureRequired: ['autoplay.mjs'],
  /* W58.J-SE — Persistent play-time display gate per SE Spelinspektionen
   * Föreskrifter SIFS 2018:6 §7.2 (continuous-time + net-loss display
   * obligation). Fires ONCE at DOM ready when realityCheck block boots
   * with requirePersistentPlayTimeDisplay=true (jurisdiction === 'SE').
   * Downstream consumer (cert harness audit trail, telemetry) records
   * the obligation activation. Payload: { jurisdiction, rule }. */
  onPlayTimeDisplayRequired: ['realityCheck.mjs'],
  /* W58.J-DE — German GlüStV (Glücksspielstaatsvertrag 2021) compliance
   * gate. Two boot-time obligations fired by germanyComplianceGate.mjs
   * when jurisdiction === 'DE':
   *   • §11(2) Spielpause — 5-second spin-pace floor; sets
   *     window.__DE_MIN_SPIN_MS__ and emits onMinSpinPaceEnforced once.
   *     Downstream consumers (autoplay tick, slamStop, turboMode dispatch)
   *     must respect the floor at spin-trigger time.
   *   • §6e Speicherverbot — clears localStorage + sessionStorage entries
   *     matching SGF prefixes (__SLOT_, __FS_, __HW_, __BB_, __RC_, __BG_)
   *     and emits onGameStateCleared with the count and prefix list.
   * §11(3) bonus-buy ban is already enforced by bonusBuy.mjs (W57.A4)
   * and not duplicated here. */
  onMinSpinPaceEnforced: ['germanyComplianceGate.mjs'],
  onGameStateCleared:    ['germanyComplianceGate.mjs'],
  /* W58.J-DE.3 — §6e IndexedDB sweep (dopuna of the localStorage /
   * sessionStorage sweep already shipped in W58.J-DE). Modern browsers
   * expose indexedDB.databases() which is enumerated then deleteDatabase
   * is called on each name matching SGF prefixes. Older browsers fall
   * back to best-effort delete-by-prefix-name. The event fires once at
   * boot AFTER the async chain resolves so cert-harness sees the IDB
   * sweep count distinct from the synchronous storage sweep. */
  onIndexedDbCleared:    ['germanyComplianceGate.mjs'],
  /* W58.J-NL — NL KSA (Wet KSA — Wet kansspelen op afstand) compliance
   * gate. Two boot-time obligations fired by netherlandsComplianceGate.mjs when
   * jurisdiction === 'NL':
   *   • §31 Cruks register check obligation — sets
   *     window.__NL_CRUKS_CHECK_REQUIRED__ flag and emits
   *     onCruksCheckRequired once. Operator session-init layer must
   *     verify the player against Cruks (Centraal Register Uitsluiting
   *     Kansspelen) and flip __NL_CRUKS_CHECK_PASSED__ true before the
   *     spin dispatcher allows first spin.
   *   • §33 Cool-off period floor — sets window.__NL_COOL_OFF_HOURS__
   *     (default 24h) and emits onCoolOffEnforced so downstream RG
   *     blocks (sessionTimeout / realityCheck) respect local cool-off.
   * §31a bonus-buy ban is already enforced by bonusBuy.mjs (W57.A4)
   * and not duplicated here. */
  onCruksCheckRequired: ['netherlandsComplianceGate.mjs'],
  onCoolOffEnforced:    ['netherlandsComplianceGate.mjs'],
  /* W58.J-NL.3 — Persistent local cool-off lifecycle (Wet KSA §33).
   * netherlandsComplianceGate.mjs writes / reads localStorage key
   * __NL_COOL_OFF_UNTIL__ (ms epoch) and exposes window.startNlCoolOff(hours)
   * helper. Three lifecycle events:
   *   • onCoolOffPeriodActive  — fired at boot when persisted deadline is
   *     in the future. Spin dispatcher consumes window.__NL_COOL_OFF_ACTIVE__
   *     to refuse first spin. Payload: { jurisdiction, remainingMs, rule }.
   *   • onCoolOffPeriodExpired — fired at boot when persisted deadline has
   *     passed. Auto-cleared from localStorage. Payload: { jurisdiction, rule }.
   *   • onCoolOffPeriodStarted — fired when startNlCoolOff(hours) helper is
   *     invoked successfully. Payload: { jurisdiction, hours, rule }. */
  onCoolOffPeriodActive:  ['netherlandsComplianceGate.mjs'],
  onCoolOffPeriodExpired: ['netherlandsComplianceGate.mjs'],
  onCoolOffPeriodStarted: ['netherlandsComplianceGate.mjs'],
  /* W58.J-EU — EU AI Act (Regulation 2024/1689) compliance gate. Three
   * boot-time obligations fired by euAiActComplianceGate.mjs when
   * jurisdiction === 'EU':
   *   • Art.5(1)(a) Subliminal-manipulation prohibition — sets
   *     window.__EU_AI_SUBLIMINAL_BANNED__ flag (when declareNoAi=true)
   *     asserting the template contains no subliminal AI.
   *   • Art.5(1)(b) Vulnerability-exploitation (DDA) prohibition — sets
   *     window.__EU_AI_ACT_DDA_PROHIBITED__ flag and emits
   *     onAiActDdaProhibited so any DDA attempt aborts. Slot-specific:
   *     mood sensing, problem-gambler profiling, dynamic-odds tuning
   *     are all banned.
   *   • Art.50(1) Transparency on AI-generated content — sets
   *     window.__EU_AI_DECLARATION_REQUIRED__ flag and emits
   *     onAiSystemDeclarationRequired so operator session-init surfaces
   *     the declaration UI before first spin.
   * Bonus-buy ban not part of AI Act scope — covered by W57.A4 + per-
   * member-state gates (W58.J-DE / J-NL). */
  onAiActDdaProhibited:          ['euAiActComplianceGate.mjs'],
  onAiSystemDeclarationRequired: ['euAiActComplianceGate.mjs'],
  /* W58.J-{FR,IT,ES} — Member-state compliance gates. Each fires its own
   * runtime when its jurisdiction matches; the per-runtime ownership of
   * these shared events is mutually exclusive (FR runtime never co-fires
   * with IT runtime — `resolveJurisdiction` returns exactly one). The
   * jurisdiction field on every payload identifies the emitting block.
   *
   * onAutoplayBanned           — FR ANJ Reco 2022-01 §3.2 / IT ADM §6.2 /
   *                              ES RD 958/2020 Art.26
   * onTurboBanned              — FR ANJ Reco 2022-01 §3.3 / IT ADM §6.3
   *                              (ES does NOT ban turbo per current spec)
   * onMinSpinDurationEnforced  — FR Decree 2019-1061 Art.4 / IT ADM §6.4 /
   *                              ES DGOJ Tech Spec §5
   * onMandatoryRealityCheckIntervalEnforced — IT Decreto Dignità Art.9 /
   *                              ES RD 958/2020 Art.21
   * onFrjCheckRequired         — FR Decree 2019-1061 Art.21 (FRJ register)
   * onRuaCheckRequired         — IT LD 132/2020 Art.5 (RUA register)
   * onRgiajCheckRequired       — ES RD 958/2020 Art.28 (RGIAJ register) */
  onAutoplayBanned:              ['franceComplianceGate.mjs', 'italyComplianceGate.mjs', 'spainComplianceGate.mjs'],
  onTurboBanned:                 ['franceComplianceGate.mjs', 'italyComplianceGate.mjs'],
  onMinSpinDurationEnforced:     ['franceComplianceGate.mjs', 'italyComplianceGate.mjs', 'spainComplianceGate.mjs'],
  onMandatoryRealityCheckIntervalEnforced: ['italyComplianceGate.mjs', 'spainComplianceGate.mjs'],
  onFrjCheckRequired:            ['franceComplianceGate.mjs'],
  onRuaCheckRequired:            ['italyComplianceGate.mjs'],
  onRgiajCheckRequired:          ['spainComplianceGate.mjs'],
  /* W59.H1 — Centralized jurisdiction-precedence resolver. Six per-
   * jurisdiction gates (W57.A4 + W58.J-{UKGC,AGCO,SE,DE,NL,EU}) used
   * to inline the same 3-key precedence chain. The chain now lives in
   * jurisdictionGate.mjs `resolveJurisdiction(model)` helper; each
   * downstream block imports the helper instead of re-implementing
   * the chain. The boot-time audit event records the active jurisdiction
   * + which precedence path it came from for cert-harness / telemetry. */
  onJurisdictionResolved: ['jurisdictionGate.mjs'],
  /* W58.J-DE.2 — Downstream enforcement of GlüStV §11(2) spin-pace floor.
   * autoplay tick reads window.__DE_MIN_SPIN_MS__ (set by germanyCompliance-
   * Gate at boot) + window.__lastSpinAt__ (set by reelEngine on each spin
   * trigger) and CLAMPS the inter-spin delay so the floor is never violated.
   * Emits onMinSpinPaceDeferred when the floor extends the schedule
   * beyond what autoplay config requested. Payload: { requestedMs,
   * deferredMs, floorMs, rule }. cert-harness can count defers per
   * session to attest GlüStV compliance to the regulator. */
  onMinSpinPaceDeferred: ['autoplay.mjs'],
  /* W58.J-NL.2 — Downstream enforcement of Wet KSA §31 Cruks check.
   * reelEngine.runOneBaseSpin reads window.__NL_CRUKS_CHECK_REQUIRED__
   * (set by netherlandsComplianceGate at boot) + __NL_CRUKS_CHECK_PASSED__
   * (operator session-init MUST flip to true after Cruks verification).
   * When the check is pending, the spin dispatch is ABORTED and this
   * event fires so cert-harness can count blocked dispatches per session
   * to attest Wet KSA compliance to the regulator. */
  onCruksCheckPending: ['reelEngine.mjs'],
  /* W58.J-DE.3 — Manual dispatch-side enforcement of GlüStV §11(2). W58.J-DE.2
   * closed autoplay (autoplay tick clamps inter-spin delay against the floor);
   * this closes the manual path. reelEngine.runOneBaseSpin reads
   * __DE_MIN_SPIN_MS__ (set by germanyComplianceGate at boot) + __lastSpinAt__
   * (set on each spin trigger) and silently aborts dispatch when the wall-clock
   * elapsed since the prior spin is below the floor. Distinct event name
   * (onManualSpinPaceBlocked) lets cert-harness distinguish manual blocks from
   * autoplay defers. Payload: { jurisdiction, floorMs, elapsedMs, remainingMs,
   * rule } so audit-trail consumers see how much time the player must wait. */
  onManualSpinPaceBlocked: ['reelEngine.mjs'],
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
  /* Wave A5 — locale + dir lifecycle. settingsPanel owns the locale
   * preference write; rtlLayout consumes it and is the sole owner of
   * the resulting html[dir] flip + onDirChanged announcement. */
  onLocaleChanged:        ['settingsPanel.mjs'],
  onDirChanged:           ['rtlLayout.mjs'],
  /* Wave A8 — PWA install lifecycle. pwaInstallability is sole emitter
   * (SW ready + A2HS prompt + appinstalled). */
  onPwaInstallable:       ['pwaInstallability.mjs'],
  onPwaInstalled:         ['pwaInstallability.mjs'],
  onPwaSwReady:           ['pwaInstallability.mjs'],
  /* Wave HX3+HX4 — i18n locale apply event. i18n.mjs is sole emitter
   * (setLocale + initial paint announce). */
  onLanguagePackApplied:  ['i18n.mjs'],
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
  /* W56 — Aux multiplier reel (vendor-neutral aux_reel_multiplier).
   * Side-by-side strip reel that spins with the main grid and lands on
   * a multiplier value (or MISS). Per-spin draw is math-controlled
   * externally; this block only PRESENTS the value from
   * spinResult.stormMultiplierTarget. Closes W49.T5.B GDD corpus RE gap. */
  onStormMultiplierStart: ['stormMultiplierReel.mjs'],
  onStormMultiplierStop:  ['stormMultiplierReel.mjs'],
  /* W57.A7 — Canonical camelCase event names for renamed legacy events.
   * Pre-W57: 'anteBet:changed' / 'bonus.buy.requested' (colon/dot form).
   * Both were orphan-emit (no listeners) so rename is safe; legacy form
   * removed from source. LEGO §7 colon/dot gate blocks new emissions of
   * the legacy shape — and §4 here declares the canonical owners. */
  onAnteBetChanged:    ['anteBet.mjs'],
  onBonusBuyRequested: ['bonusBuy.mjs'],
  /* Wave LEGO-BUY (4/8) — multi-tier menu + ladder variants. Mutually
   * exclusive with the legacy single-button / single-toggle blocks
   * (orchestrator wires one or the other based on tier-count). */
  onBonusBuyMenuOpened:    ['bonusBuyMenu.mjs'],
  onBonusBuyMenuClosed:    ['bonusBuyMenu.mjs'],
  onBonusBuyMenuTierSelected:  ['bonusBuyMenu.mjs'],
  onAnteBetLadderChanged:  ['anteBetLadder.mjs'],
  /* Wave LEGO-RANDOM (B-3) — in-spin random pattern blocks. */
  onMysteryPrizeBoxAppeared:   ['mysteryPrizeBox.mjs'],
  onMysteryPrizeBoxOpened:     ['mysteryPrizeBox.mjs'],
  onMysteryPrizeBoxDismissed:  ['mysteryPrizeBox.mjs'],
  onRandomWildBurstFired:      ['randomWildBurst.mjs'],
  /* Wave LEGO-COLLECT (B-4) — coin-collect meta-game trio. */
  onCoinCollected:                ['coinCollect.mjs'],
  onCumulativeMeterThresholdHit:  ['cumulativeMeter.mjs'],
  onCumulativeMeterReset:         ['cumulativeMeter.mjs'],
  onCollectRevealOpened:          ['collectRevealOverlay.mjs'],
  onCollectRevealClaimed:         ['collectRevealOverlay.mjs'],
  /* Wave LEGO-VOLATILITY (B-6) — pre-spin player choice. Multi-owner
   * with pre-existing settingsPanel.mjs (which already emitted this
   * event from a "Settings → Volatility" knob). Both surfaces are
   * legitimate emit sources; downstream subscribers may filter by
   * payload.source ('settings' / undefined for selector). */
  onVolatilityChanged:            ['volatilitySelector.mjs', 'settingsPanel.mjs'],
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
  /* Wave LEGO-M (2026-06-18) — six new multiplier-variant blocks, each
   * owns its single canonical event. onMultiplierChanged is owned by
   * hookBus.mjs itself (emitted from setMult internals). */
  onPerFsSpinMultiplierRolled:     ['perFsSpinMultiplier.mjs'],
  onMysteryMultiplierRevealed:     ['mysterySymbolMultiplier.mjs'],
  onWildCollision:                 ['wildCollisionMultiplier.mjs'],
  onRetriggerMultiplierBumped:     ['retriggerMultiplierBump.mjs'],
  onClusterSizeMultiplierApplied:  ['clusterSizeMultiplier.mjs'],
  onMultiplierChanged:             ['hookBus.mjs'],
  /* Wave LEGO-FSV (Free Spins variants, 2026-06-18 evening) — 4 new blocks. */
  onFsModePicked:                    ['pickYourFs.mjs'],
  onLockedSymbolFsSeeded:            ['lockedSymbolFs.mjs'],
  onTumbleOnlyFsModeEntered:         ['tumbleOnlyFs.mjs'],
  onTumbleOnlyFsChainEnded:          ['tumbleOnlyFs.mjs'],
  onInfiniteFsStreakBumped:          ['infiniteFsUntilLoss.mjs'],
  onInfiniteFsModeEnded:             ['infiniteFsUntilLoss.mjs'],
  /* Wave LEGO-W2 (Wild variants, 2026-06-19) — 2 new wild-family blocks. */
  onCascadingWildPinned:             ['cascadingWildPersistence.mjs'],
  onMysteryWildRevealed:             ['mysteryWildReveal.mjs'],
  /* Wave LEGO-FS2 (FS variants, 2026-06-19) — 2 new FS-family blocks. */
  onFsSymbolUpgraded:                ['fsSymbolUpgradeEscalation.mjs'],
  onFsJackpotPoolBumped:             ['fsPersistentJackpotPool.mjs'],
  onFsJackpotPoolPaidOut:            ['fsPersistentJackpotPool.mjs'],
  onFsJackpotPoolEndRequested:       ['fsPersistentJackpotPool.mjs'],
  /* Wave LEGO-HW2 (Hold & Win variants, 2026-06-19) — 2 new blocks. */
  onWildTriggerHoldAndWinRequested:  ['wildTriggerHoldAndWin.mjs'],
  onHoldAndWinReelExpanded:          ['holdAndWinReelExpansion.mjs'],
  /* Wave LEGO-B2 (Bonus reveal variants, 2026-06-19) — 3 new blocks. */
  onMatchThreeBonusEntered:          ['matchThreeBonusReveal.mjs'],
  onMatchThreeBonusRevealed:         ['matchThreeBonusReveal.mjs'],
  onMatchThreeBonusEnded:            ['matchThreeBonusReveal.mjs'],
  onMoneyGrabEntered:                ['moneyGrabGrid.mjs'],
  onMoneyGrabRevealed:               ['moneyGrabGrid.mjs'],
  onMoneyGrabEnded:                  ['moneyGrabGrid.mjs'],
  onPathBonusEntered:                ['pathBonusEngine.mjs'],
  onPathBonusRolled:                 ['pathBonusEngine.mjs'],
  onPathBonusEnded:                  ['pathBonusEngine.mjs'],
  /* Wave LEGO-ENG (Engine topology, 2026-06-19) — 2 new blocks. */
  onPyramidSpinResult:               ['pyramidGridEngine.mjs'],
  onHexClusterPay:                   ['hexClusterEngine.mjs'],
  /* Wave LEGO-FS3 (FS variants tier 3, 2026-06-19) — 2 new blocks. */
  onWinBothWaysActivated:            ['winBothWaysActivation.mjs'],
  onWinBothWaysDeactivated:          ['winBothWaysActivation.mjs'],
  onFsReelHeightEscalated:           ['fsReelHeightEscalation.mjs'],
  /* Wave LEGO-FS3.3 (Adapter wave, 2026-06-19) — 2 new blocks. */
  onReelHeightGrown:                 ['reelHeightAdapter.mjs'],
  onReelHeightShrunk:                ['reelHeightAdapter.mjs'],
  onBonusOverlayMutexAcquired:       ['bonusOverlayMutex.mjs'],
  onBonusOverlayMutexReleased:       ['bonusOverlayMutex.mjs'],
  /* Wave LEGO-H/FS/W (2026-06-18) — 8 new GDD-driven variants. Each
   * block owns its single canonical event pair (rolled/cleared etc). */
  onFrameMultiplierBumped:           ['holdAndWinFrameMultiplier.mjs'],
  onFrameMultiplierFinal:            ['holdAndWinFrameMultiplier.mjs'],
  onLockedOrbMultiplierRolled:       ['holdAndWinLockedOrbMultiplier.mjs'],
  onLockedOrbMultiplierFinal:        ['holdAndWinLockedOrbMultiplier.mjs'],
  onRoomPromoted:                    ['holdAndWinRoomJackpotMultiplier.mjs'],
  onRoomJackpotFinal:                ['holdAndWinRoomJackpotMultiplier.mjs'],
  onTumbleMultiplierGrown:           ['tumbleGrowingFsMultiplier.mjs'],
  onTumbleMultiplierReset:           ['tumbleGrowingFsMultiplier.mjs'],
  onExpansionWildAdded:              ['fsExpansionWilds.mjs'],
  onExpansionWildsCleared:           ['fsExpansionWilds.mjs'],
  onLadderRungPromoted:              ['progressiveFsRetriggerLadder.mjs'],
  onLadderReset:                     ['progressiveFsRetriggerLadder.mjs'],
  onExpandingWildMultRolled:         ['expandingWildMultiplier.mjs'],
  onExpandingWildMultsCleared:       ['expandingWildMultiplier.mjs'],
  onMegaWildClusterLanded:           ['megaWildCluster.mjs'],
  onMegaWildClusterCleared:          ['megaWildCluster.mjs'],
  /* WASH PASS #3 (2026-06-19) — canonical per-cluster event so the
   * orphan listener in clusterSizeMultiplier fires. Emitted from
   * clusterPaysEval's 'reels:stopped' handler in parallel with the
   * legacy clusterPays:evaluated bus event. */
  onClusterPay:                      ['clusterPaysEval.mjs'],
  /* Wave LEGO-EV (2026-06-19) — universal all-ways + bidirectional ways
   * evaluators. Pre-Megaways industry standard (Aristocrat universal,
   * Microgaming 243-both-ways). */
  onAllWaysPay:                      ['allWaysEval.mjs'],
  onAllWaysCleared:                  ['allWaysEval.mjs'],
  onBidirectionalWaysPay:            ['bidirectionalWaysEval.mjs'],
  onBidirectionalWaysCleared:        ['bidirectionalWaysEval.mjs'],
  /* Wave LEGO-L (2026-06-18) — random spin-wide lightning multiplier
   * (WoO §5.2 + Crystal Forge §5.2 explicit GDD demand). */
  onLightningStrike:                 ['randomLightningMultiplier.mjs'],
  onLightningStrikeMissed:           ['randomLightningMultiplier.mjs'],
  /* Wave LEGO-WW (2026-06-18) — walking wild stepper with progressive ×N. */
  onWalkingWildStep:                 ['walkingWildStepper.mjs'],
  onWalkingWildSpawned:              ['walkingWildStepper.mjs'],
  onWalkingWildExited:               ['walkingWildStepper.mjs'],
  /* Wave LEGO-WAYS (2026-06-18) — dynamic variable rows per reel ways. */
  onWaysReshaped:                    ['dynamicWaysEngine.mjs'],
  onWaysResetForRound:               ['dynamicWaysEngine.mjs'],
  /* Wave LEGO-INF (2026-06-18) — infinity reels grid expansion + mult bump.
   * NOTE: event names use "InfinityEngine" prefix to avoid collision with
   * existing H18 infinityReels.mjs ownership of onInfinityReelsReset. */
  onInfinityEngineExpanded:          ['infinityReelsEngine.mjs'],
  onInfinityEngineCommit:            ['infinityReelsEngine.mjs'],
  onInfinityEngineReset:             ['infinityReelsEngine.mjs'],
  /* Wave LEGO-SS (2026-06-18) — super symbol family (split reveal + upgrade). */
  onSymbolSplitStarted:              ['symbolSplitReveal.mjs'],
  onSymbolSplitRevealed:             ['symbolSplitReveal.mjs'],
  onSymbolSplitCleared:              ['symbolSplitReveal.mjs'],
  onSuperSymbolUpgraded:             ['superSymbolUpgrade.mjs'],
  onSuperSymbolUpgradeReset:         ['superSymbolUpgrade.mjs'],
  /* Wave LEGO-JR (2026-06-18) — jackpot room family (room reveal + pick grid). */
  onJackpotRoomRevealed:             ['jackpotRoomReveal.mjs'],
  onJackpotRoomDismissed:            ['jackpotRoomReveal.mjs'],
  onJackpotPickerTileRevealed:       ['jackpotPicker.mjs'],
  onJackpotPickerComplete:           ['jackpotPicker.mjs'],
  onJackpotPickerDismissed:          ['jackpotPicker.mjs'],
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
   * notification with source attribution.
   * W57.A2 — `multiplierOrb.mjs` was co-listed but a source audit showed
   * 0 `HookBus.emit('onMultChange'` calls inside it (only persistentMultiplier
   * emits; multiplierOrb consumes via HookBus.on). Dropped ghost owner so
   * EXPECTED_EMIT_OWNERS matches reality. */
  onMultChange: ['persistentMultiplier.mjs'],

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
  /* B67 multiplierLadder — sole emitter of ladder lifecycle events. */
  onMultLadderStep:   ['multiplierLadder.mjs'],
  onMultLadderReset:  ['multiplierLadder.mjs'],
  /* B70 stickyMeter — sole emitter of sticky-count delta events. */
  onStickyCountChange: ['stickyMeter.mjs'],
  /* B73 energyMeter — sole emitter of gauge fill + full trigger events. */
  onEnergyChange:      ['energyMeter.mjs'],
  onEnergyFull:        ['energyMeter.mjs'],
  /* B68 coinShower — particle-burst block, sole owner of its lifecycle. */
  onCoinShowerStart:  ['coinShower.mjs'],
  onCoinShowerEnd:    ['coinShower.mjs'],
  /* B71 pickBonusReveal — post-pick reveal presenter, sole owner. */
  onPickRevealStart:  ['pickBonusReveal.mjs'],
  onPickRevealEnd:    ['pickBonusReveal.mjs'],
  /* B74 rewardChest — chest-reveal presenter, sole owner of its lifecycle. */
  onRewardChestOpen:  ['rewardChest.mjs'],
  onRewardChestClose: ['rewardChest.mjs'],
  /* B75 symbolStackCollapse — full-reel stack drop presenter. */
  onStackCollapseStart: ['symbolStackCollapse.mjs'],
  onStackCollapseEnd:   ['symbolStackCollapse.mjs'],
  /* B65 mysteryReveal — event-presenter sibling of mysterySymbol. */
  onMysteryRevealStart: ['mysteryReveal.mjs'],
  onMysteryRevealEnd:   ['mysteryReveal.mjs'],
  /* B72 wheelBonusReveal — post-wheel-settle reveal presenter, sole owner. */
  onWheelRevealStart:   ['wheelBonusReveal.mjs'],
  onWheelRevealEnd:     ['wheelBonusReveal.mjs'],
  /* wildReel emits `symbolOverride` when its full-column wild paints over
   * the rolled symbols on a designated reel. winEval / paylineOverlay
   * subscribe so they treat the overridden cells as the wild for the
   * upcoming evaluation. */
  symbolOverride:     ['wildReel.mjs'],
  /* H4 colorblindPatterns — color-blind pattern overlay toggle (WCAG SC 1.4.1).
   * Sole owner of the toggle event; chip click / API / settings panel all
   * route through colorblindPatterns.mjs which is the canonical state-of-
   * truth for `__SLOT_CB_PATTERNS_ON__`. */
  onCbPatternsToggle: ['colorblindPatterns.mjs'],
  /* H6 bonusClimaxReveal — full-screen presenter for any bonus-entry event. */
  onBonusClimaxStart: ['bonusClimaxReveal.mjs'],
  onBonusClimaxEnd:   ['bonusClimaxReveal.mjs'],
  /* H7 cellLevelUpgrade — per-cell numeric meter (sole owner of both events). */
  onCellLevelUp:      ['cellLevelUpgrade.mjs'],
  onCellLevelReset:   ['cellLevelUpgrade.mjs'],
  /* H8 cellOverflowCounter — stack-overflow per-reel badge. */
  onCellOverflow:     ['cellOverflowCounter.mjs'],
  /* H9 ambientBackgroundWheel — ambient layer phase transitions. */
  onAmbientPhase:     ['ambientBackgroundWheel.mjs'],
  /* H10 dualRoleScatter — scatter-as-wild / scatter-as-pay activation. */
  onDualRoleActivated:['dualRoleScatter.mjs'],
  /* H11 megaSymbol — oversized 2×2/3×3 block presenter (sole owner of placement events). */
  onMegaSymbolPlaced:  ['megaSymbol.mjs'],
  onMegaSymbolCleared: ['megaSymbol.mjs'],
  /* onMegaSymbolLanded is engine-driven (engine emits, megaSymbol.mjs listens).
   * To satisfy LEGO single-owner emit check we attribute it to megaSymbol.mjs
   * because the only emitter present in src/blocks/ is the megaSymbol.mjs API
   * (window.megaSymbolPlant could emit it; current implementation lets engine
   * own the emit, but here the sole in-block emitter is megaSymbol). */
  onMegaSymbolLanded:  ['megaSymbol.mjs'],
  /* H12 wildCollectionTrail — persistent wild meter (sole owner of all 3 events). */
  onWildTrailBump:        ['wildCollectionTrail.mjs'],
  onWildCollectionReward: ['wildCollectionTrail.mjs'],
  onWildTrailReset:       ['wildCollectionTrail.mjs'],
  /* H13 jackpotLadderRooms — 4-tier room ladder presenter (sole owner of all 5 events). */
  onJackpotRoomEnter:   ['jackpotLadderRooms.mjs'],
  onJackpotRoomWin:     ['jackpotLadderRooms.mjs'],
  onJackpotRoomEntered: ['jackpotLadderRooms.mjs'],
  onJackpotRoomWon:     ['jackpotLadderRooms.mjs'],
  onJackpotRoomExit:    ['jackpotLadderRooms.mjs'],
  /* H14 superchargedFs — FS retrigger multiplier escalation (sole owner of 3 events). */
  /* FIX-4 (deep QA #17, 2026-06-19): freeSpins.FSM_handleRetrigger now
   * emits onFsRetrigger as a fallback when superchargedFs is NOT in the
   * build (soft-dependency was creating silent dead-event downstream).
   * superchargedFs remains the canonical sole-owner when present (via
   * its re-entrancy-guarded superchargedFsAnnounceRetrigger helper). */
  onFsRetrigger:           ['superchargedFs.mjs', 'freeSpins.mjs'],
  onFsMultiplierEscalated: ['superchargedFs.mjs'],
  onFsSuperchargeReset:    ['superchargedFs.mjs'],
  /* H15 cascadeBooster — per-cascade-depth multiplier (sole owner of 2 events). */
  onCascadeBoosterTick:  ['cascadeBooster.mjs'],
  onCascadeBoosterReset: ['cascadeBooster.mjs'],
  /* H16 splitSymbol — one symbol divides into two (sole owner of 2 events). */
  onSplitSymbolPlaced:   ['splitSymbol.mjs'],
  onSplitSymbolCleared:  ['splitSymbol.mjs'],
  /* H17 nudgeReel — classic near-miss rescue presenter (sole owner of 4 events). */
  onNudgeOffered:        ['nudgeReel.mjs'],
  onNudgeAccepted:       ['nudgeReel.mjs'],
  onNudgeDeclined:       ['nudgeReel.mjs'],
  onNudgeResolved:       ['nudgeReel.mjs'],
  /* H18 respinCharge — charge counter (sole owner of 4 events). */
  onRespinChargeBump:    ['respinCharge.mjs'],
  onRespinChargeFull:    ['respinCharge.mjs'],
  onRespinChargeReset:   ['respinCharge.mjs'],
  onRespinChargeTick:    ['respinCharge.mjs'],
  /* H19 syncReels — N reels match (sole owner of 2 events). */
  onReelsSynced:         ['syncReels.mjs'],
  onSyncReelsCleared:    ['syncReels.mjs'],
  /* H20 winMultiplierBadge — × N chip on win lines (sole owner of 2 events). */
  onWinMultBadgePlaced:  ['winMultiplierBadge.mjs'],
  onWinMultBadgeCleared: ['winMultiplierBadge.mjs'],
  /* Hi-Lo Gamble — card-based hi-lo risk presenter (sole owner of 4 events). */
  onHiLoStart:           ['hiLoGamble.mjs'],
  onHiLoChoice:          ['hiLoGamble.mjs'],
  onHiLoResolved:        ['hiLoGamble.mjs'],
  onHiLoCollected:       ['hiLoGamble.mjs'],
  /* H18 infinityReels — grid-grows-per-cascade chain counter (sole owner of 3 events). */
  onInfinityReelAdded:      ['infinityReels.mjs'],
  onInfinityReelsReset:     ['infinityReels.mjs'],
  onInfinityChainMilestone: ['infinityReels.mjs'],
  /* H19 collectableSymbol — symbol-collector HUD meter (sole owner of 3 events). */
  onSymbolCollected: ['collectableSymbol.mjs'],
  onCollectionFull:  ['collectableSymbol.mjs'],
  onCollectionReset: ['collectableSymbol.mjs'],
  /* H20 retriggerMeter — FS retrigger HUD meter presenter (sole owner of 3 events;
   * listens to onFsRetrigger which is owned by superchargedFs.mjs). */
  onRetriggerMeterTick:   ['retriggerMeter.mjs'],
  onRetriggerMeterCommit: ['retriggerMeter.mjs'],
  onRetriggerMeterReset:  ['retriggerMeter.mjs'],
  /* H21 winLineFlash — per-line directional flash on win (sole owner of 3 events). */
  onWinLineFlashStart:   ['winLineFlash.mjs'],
  onWinLineFlashEnd:     ['winLineFlash.mjs'],
  onWinLineFlashCleared: ['winLineFlash.mjs'],
  /* H22 nearMissTease — almost-won highlight (sole owner of 2 events). */
  onNearMissTease:   ['nearMissTease.mjs'],
  onNearMissCleared: ['nearMissTease.mjs'],
  /* H23 reelLockHold — lock whole reels with countdown (sole owner of 4 events). */
  onReelLockStart:   ['reelLockHold.mjs'],
  onReelLockEnd:     ['reelLockHold.mjs'],
  onReelLockTick:    ['reelLockHold.mjs'],
  onReelLockCleared: ['reelLockHold.mjs'],
  /* H24 cascadePathDraw — SVG chain between cluster win cells (sole owner of 2 events). */
  onCascadePathDrawn:   ['cascadePathDraw.mjs'],
  onCascadePathCleared: ['cascadePathDraw.mjs'],
  /* H25 streakBonus — N consecutive wins bonus (sole owner of 3 events). */
  onStreakBump:        ['streakBonus.mjs'],
  onStreakBonusEarned: ['streakBonus.mjs'],
  onStreakReset:       ['streakBonus.mjs'],
  /* H27 paylineDimmer — dim non-winning cells during win presentation (sole owner of 2 events). */
  onPaylineDimmerStart:   ['paylineDimmer.mjs'],
  onPaylineDimmerCleared: ['paylineDimmer.mjs'],
  /* H30 retriggerEscalator — multi-tier FS retrigger reward ladder (sole owner of 2 events). */
  onRetriggerEscalated:      ['retriggerEscalator.mjs'],
  onRetriggerEscalatorReset: ['retriggerEscalator.mjs'],
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

/* Check 6 — Backtick-free template-literal scope (W47.S4 anti-recurrence).
 *
 * Closes the regression class that hit twice in two days:
 *   - W47.S1 #3: `return` literal inside a comment closed the template
 *     literal in respin.mjs → "Unexpected token const" cascade.
 *   - W47.S3 #2: daemon-added `--bw-shake-amp` and `prefers-reduced-motion`
 *     backticks inside JSDoc comments inside emitBigWinTier{CSS,Runtime}
 *     template scope → "Invalid left-hand side expression" → ModuleJob.link.
 *
 * Rule: inside the body of any `return \`...\`;` block (or `= \`...\`;`),
 * no further backtick may appear EXCEPT the closing one. JSDoc comments
 * that want to reference identifiers should use plain text or single
 * quotes — backticks have no syntactic meaning in CSS / HTML output.
 *
 * Implementation: scan each block for a return statement whose body
 * begins with a backtick, capture the literal range up to the next
 * unescaped backtick at statement boundary, and assert no backtick lives
 * inside that range outside of `\${...}` substitution heads.
 *
 * Trade-off: this is intentionally conservative — we only check the
 * common `return \`...\`;` and `const X = \`...\`;` patterns where the
 * literal is the WHOLE statement value. Nested template literals or
 * tagged templates won't trip the check, but they're not the regression
 * shape we're trying to prevent. */
async function checkBacktickInTemplate() {
  const blocks = await listBlockFiles();
  const offenders = [];
  /* Markdown-style backtick pair: `text` with no `$` inside (which would
   * mean a template substitution, not a Markdown span). This is the
   * exact shape that bit us twice — JSDoc / line comments quoting an
   * identifier the Markdown-way inside an emit*CSS / emit*Runtime
   * template literal body. */
  const MARKDOWN_BACKTICK_PAIR = /`[^`$\n]+`/;
  for (const b of blocks) {
    const src = await readBlockSrc(b);
    const lines = src.split('\n');
    let inTemplate = false;
    let templateStartLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inTemplate) {
        /* Open: line ends with `return \`` or `= \`` (no closing same-line). */
        if (/(?:^|\s)return\s+`[^`]*$/.test(line)
            || /=\s+`[^`]*$/.test(line)) {
          inTemplate = true;
          templateStartLine = i + 1;
        }
        continue;
      }
      /* Inside template body. Two regression shapes to catch BEFORE we
       * decide on closing:
       *   (a) Comment line (starts with `*` or `//`) containing a
       *       Markdown backtick pair → premature close + cascade.
       *   (b) Reserved JS keyword as a backticked code span (`return`,
       *       `const`, `let`, etc) — that pattern hit W47.S1 too. */
      const isCommentLine = /^\s*(\*|\/\/|\/\*)/.test(line);
      if (isCommentLine && MARKDOWN_BACKTICK_PAIR.test(line)) {
        offenders.push(`${b}:${i + 1} (template opened at line ${templateStartLine}): "${line.trim().slice(0, 80)}"`);
        continue;
      }
      /* Closing detection — ONLY when the line is the canonical close
       * pattern: `  \`;` (whitespace + backtick + semicolon). Anything
       * else stays "inside template" so the comment-pair check above
       * keeps firing for the rest of the body. */
      if (/^\s*`;?\s*$/.test(line)) {
        inTemplate = false;
      }
    }
  }
  const pass = offenders.length === 0;
  return {
    name: '6. Backtick-free template body',
    pass,
    detail: pass
      ? `${blocks.length} blocks scanned, no Markdown backtick spans inside comment lines within return template literals`
      : `Markdown backtick pair in comment inside template body (closes literal prematurely):\n      ${offenders.join('\n      ')}`,
  };
}

/* ════════════════════════════════════════════════════════════════════
 * W57.A7 — Colon/dot event-name canonicalization gate.
 *
 * Canonical event names follow the `on<PascalCase>` shape (e.g. `onSpinStart`,
 * `onBigWinTierEntered`). Colon-separated names (`anteBet:changed`) and
 * dot-separated names (`bonus.buy.requested`) are LEGACY: they predate the
 * convention. This gate accepts the existing legacy survivors via an
 * explicit whitelist, but BLOCKS any NEW colon/dot event names — every
 * future emit/listener must use the canonical form.
 *
 * Whitelist policy: shrinks only (existing legacy can be renamed; the
 * whitelist entry is then removed). Adding to the whitelist requires an
 * explicit rationale in the comment.
 * ════════════════════════════════════════════════════════════════════ */
const COLON_DOT_LEGACY_WHITELIST = new Set([
  /* expandingWild block — orphan-emit pair predating the convention.
   * No listeners in source; safe to rename in a future W57.A7.2. */
  'expandingWild:applied',
  'expandingWild:cleared',
  /* clusterPaysEval ↔ engine handshake — `reels:stopped` is the legacy
   * trigger for cluster re-evaluation; full rename would touch the
   * engine dispatcher chain. Defer to dedicated W57.A7.3. */
  'reels:stopped',
  'clusterPays:evaluated',
  /* wheelBonus family — 6 events form the wheelBonus block's own
   * open/close/request/spin/complete/result protocol. Rename touches
   * wheelBonusReveal listener wiring too (W57.A7.4 candidate). */
  'wheelBonus.open',
  'wheelBonus.close',
  'wheelBonus.request',
  'wheelBonus.spin',
  'wheelBonus.complete',
  'wheelBonus.result',
  /* bonusPick feature trigger — namespaced "feature:" prefix matches the
   * feature-discovery protocol; rename in W57.A7.5 alongside other
   * `feature:*` events when they're introduced. */
  'feature:bonusPick:trigger',
]);

async function checkColonDotEventNames() {
  const blocks = await listBlockFiles();
  /* Capture every HookBus.emit('...') / HookBus.on('...') call where the
   * event name contains : or . — flag any not on the whitelist. */
  const EVENT_NAME_RE = /HookBus\.(?:emit|on)\(\s*['"]([^'"]*[:.][^'"]*)['"]/g;
  const offenders = [];
  for (const b of blocks) {
    const src = await readBlockSrc(b);
    let m;
    EVENT_NAME_RE.lastIndex = 0;
    while ((m = EVENT_NAME_RE.exec(src))) {
      const eventName = m[1];
      if (!COLON_DOT_LEGACY_WHITELIST.has(eventName)) {
        offenders.push(`${b}: "${eventName}" (use canonical on<PascalCase>)`);
      }
    }
  }
  const pass = offenders.length === 0;
  return {
    name: '7. Colon/dot event canonicalization (W57.A7)',
    pass,
    detail: pass
      ? `${blocks.length} blocks scanned, ${COLON_DOT_LEGACY_WHITELIST.size} legacy events whitelisted; no new colon/dot events`
      : `New colon/dot event name(s) outside legacy whitelist:\n      ${offenders.join('\n      ')}`,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Invariant #8 — HOOK_EVENTS registry completeness (FIX-1 wave, 2026-06-19)
 *
 * Browser runtime initialiazira `handlers = {}` po svakom event-u iz
 * HOOK_EVENTS array-a. Ako blok emit-uje event koji nije u tom array-u:
 *   • `HookBus.on('unknownEvent', fn)` → console.warn + no-op stub
 *   • `HookBus.emit('unknownEvent', payload)` → silent early-return
 * → cross-block coordination tiho mrtav, EXPECTED_EMIT_OWNERS bi taj
 * propustio jer validira ownership a NE registry membership.
 *
 * Ovaj invariant kompletno zatvara drift: svaki emit() poziv iz
 * src/blocks/ MORA imati string odgovarajuću registered key u HOOK_EVENTS.
 * ────────────────────────────────────────────────────────────────────────── */
async function checkHookEventsRegistry() {
  const hookBusPath = resolvePath(REPO_ROOT, 'src/blocks/hookBus.mjs');
  const hookBusSrc = await readFile(hookBusPath, 'utf8');

  /* Extract registered events from HOOK_EVENTS array (between
   * `HOOK_EVENTS = Object.freeze([` and the matching `]);`). */
  const startIdx = hookBusSrc.indexOf('HOOK_EVENTS = Object.freeze([');
  if (startIdx === -1) {
    return {
      name: '8. HOOK_EVENTS registry completeness',
      pass: false,
      detail: 'Could not locate HOOK_EVENTS Object.freeze block in hookBus.mjs',
    };
  }
  const endIdx = hookBusSrc.indexOf(']);', startIdx);
  if (endIdx === -1) {
    return {
      name: '8. HOOK_EVENTS registry completeness',
      pass: false,
      detail: 'Malformed HOOK_EVENTS block — no closing ]);',
    };
  }
  /* Strip block + line comments FIRST so narrative apostrophes inside JSDoc
   * (e.g. `'natural'`, `'rollup'`, "what's") cannot leak into the registry
   * set as false-positive entries. */
  const registryBody = hookBusSrc.slice(startIdx, endIdx)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  /* Restrict captured token to valid event-name shape so we don't catch
   * narrative quotes that happen to survive comment stripping. */
  const REGISTRY_TOKEN_RE = /'([a-zA-Z0-9_:.]+)'/g;
  const registered = new Set();
  let rm;
  REGISTRY_TOKEN_RE.lastIndex = 0;
  while ((rm = REGISTRY_TOKEN_RE.exec(registryBody))) registered.add(rm[1]);

  /* Walk every block source, collect every `HookBus.emit('NAME'` AND every
   * `_emit('NAME'` (internal aliases used by some blocks like turboMode). */
  const blocks = await listBlockFiles();
  const EMIT_RE = /(?:HookBus\.)?_?emit\s*\(\s*['"]([a-zA-Z0-9_:.]+)['"]/g;
  const emitted = new Map(); /* event → first owner block */
  for (const b of blocks) {
    if (b === 'hookBus.mjs') continue; /* the bus itself defines but doesn't emit */
    const src = await readBlockSrc(b);
    EMIT_RE.lastIndex = 0;
    let em;
    while ((em = EMIT_RE.exec(src))) {
      const name = em[1];
      if (!emitted.has(name)) emitted.set(name, b);
    }
  }

  const missing = [];
  for (const [evt, owner] of emitted) {
    if (!registered.has(evt)) missing.push(`${evt}  (emitted by ${owner})`);
  }

  const pass = missing.length === 0;
  return {
    name: '8. HOOK_EVENTS registry completeness',
    pass,
    detail: pass
      ? `${registered.size} events registered, ${emitted.size} distinct emits scanned, 0 drift`
      : `${missing.length} emit-ed event(s) NOT in HOOK_EVENTS:\n      ${missing.slice(0, 30).join('\n      ')}${missing.length > 30 ? `\n      ... +${missing.length - 30} more` : ''}\n      Fix: append each to HOOK_EVENTS array in src/blocks/hookBus.mjs with Owner: comment.`,
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
    await checkBacktickInTemplate(),
    await checkColonDotEventNames(),
    await checkHookEventsRegistry(),
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
