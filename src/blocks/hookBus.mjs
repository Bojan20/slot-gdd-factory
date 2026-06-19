/**
 * Slot GDD Factory · hookBus BLOCK
 *
 * THE central lifecycle bus. Every feature block registers its runtime
 * callbacks here; the spin engine (runOneBaseSpin / handlePostSpin /
 * FSM_runNextFsSpin / runTumbleChain) emits events into it. NO block ever
 * calls another block's runtime directly — they all talk through HookBus.
 *
 * This is the LEGO rule (Boki, 2026-06-04, REINFORCED): every block must
 * register on at least one of these lifecycle events, otherwise it is
 * dead code by definition.
 *
 * ─── Events ─────────────────────────────────────────────────────────
 *
 *   preSpin       ({ duringFs })
 *      Emitted right before a spin begins (button click / FS auto-spin).
 *      Use to: arm anticipation, prepare wild placements, reset per-spin
 *      counters. NEVER mutate the grid here (grid is being rebuilt).
 *
 *   onSpinResult  ({ duringFs })
 *      Emitted after reels settle but before any cascade/tumble loop.
 *      Use to: annotate special cells (orbs, mystery, super), apply
 *      sticky/expanding/walking wild visuals, fire lightning multipliers.
 *
 *   onTumbleStep  ({ duringFs, chainIndex, events })
 *      Emitted once per tumble cascade step. `events` is the win-event
 *      array detected this step. Listeners can mutate the multiplier
 *      (HookBus.setMult) or wins ledger.
 *
 *   postSpin      ({ duringFs })
 *      Emitted after the final cascade step completes (or after settle if
 *      no cascade). Use to: run win presentation, count triggers, apply
 *      cap, trigger respin/hold-and-win/bonus modes.
 *
 *   onFsTrigger   ({ award, scatters })
 *      Emitted when FS round is about to start. Use to: reset persistent
 *      counters (BONUS_MULTIPLIER, sticky wild collection, hold-and-win
 *      board, FSM.mult to 1).
 *
 *   onFsSpinResult ({ chainIndex })
 *      Emitted after every FS spin settles (before tumble starts). This
 *      is where blocks that ESCALATE on every FS spin (progressive mult,
 *      persistent multiplier, multiplier-orb-bonus-accumulate) bump.
 *
 *   onFsEnd       ({ totalWin })
 *      Emitted as FS round closes (FSM_enterOutro path). Listeners reset
 *      persistent state so next FS round starts clean.
 *
 *   ─── Wave V: spin-control intent events ───────────────────────────
 *
 *   onSlamRequested  ({ phase: 'pre' | 'post', source: 'button' | 'reelsArea' | 'keyboard' })
 *      Emitted when the player asks reels to stop NOW (slam-stop button
 *      or click-on-reels area). `phase` distinguishes pre-response
 *      (server result not yet received → engine must wait via HookBus.once
 *      for onSpinResult, then collapse all reels to landed strip) from
 *      post-response (result received → engine collapses immediately).
 *      Owner: src/blocks/slamStop.mjs (emit). Consumers: reelEngine.mjs.
 *
 *   onSlamComplete   ({ duration: number })
 *      Emitted by reelEngine.mjs after all reels have visually collapsed
 *      into their final landed positions following a slam request.
 *      `duration` = ms elapsed from onSlamRequested to all-reels-stopped.
 *      Owner: src/blocks/reelEngine.mjs. Consumers: postSpin coordinator
 *      (transitions UI state out of slam phase), audio cues (future ADB).
 *
 *   onSkipRequested  ({ phase: 'rollup' | 'fsIntro' | 'fsOutro' | 'celebration', source: 'button' | 'keyboard' })
 *      Emitted when the player asks the current win-presentation /
 *      transition animation to terminate immediately. `phase` lets each
 *      listener decide whether it owns the cancellable animation.
 *      Sets a global `window.__SLOT_SKIPPED__ = true` flag; long-running
 *      animation chains poll this flag at every setTimeout step and bail
 *      to final state when set. Owner: src/blocks/forceSkip.mjs (emit).
 *      Consumers: winPresentation.mjs, scatterCelebration.mjs, freeSpins.mjs.
 *
 *   onSkipComplete   ({ phase: string, duration: number })
 *      Emitted by whichever block owns the animation that was skipped,
 *      after it has fully collapsed to its final state. Resets
 *      `window.__SLOT_SKIPPED__` to false. Owner: animation-owning block.
 *      Consumers: postSpin coordinator (re-enables spin button).
 *
 *   ─── Wave U4: autoplay session events ─────────────────────────────
 *
 *   onAutoplayStart  ({ remaining: number, step: number })
 *      Emitted by autoplay.mjs when the player starts an autoplay
 *      session. `step` is the requested step value (e.g. 25, 50, 100);
 *      `remaining` mirrors it on start.
 *      Consumers: slamStop (sets autospin global flag), uiToast.
 *
 *   onAutoplayTick   ({ remaining: number, totalWin: number, totalLoss: number, lastWin: number })
 *      Emitted after every autoplay-driven spin completes. Lets the UI
 *      show a remaining-spins counter and lets analytics blocks track
 *      session win/loss.
 *
 *   onAutoplayStop   ({ reason: string, completed: number })
 *      Emitted when an autoplay session ends for ANY reason (see
 *      `AUTOPLAY_STOP_REASONS` enum). `completed` = spins actually
 *      played before stopping.
 *
 * ─── Shared state ──────────────────────────────────────────────────
 *
 *   HookBus.getMult() / HookBus.setMult(v) / HookBus.addMult(delta)
 *      The CURRENT effective payout multiplier. Set by listeners during
 *      onSpinResult / onTumbleStep / onFsSpinResult. Read by win-payout
 *      dispatcher (winPresentation) when computing event.payX.
 *
 *   HookBus.getMult() is the single source of truth — never read FSM.mult
 *   or BONUS_MULTIPLIER directly from non-HookBus consumers.
 *
 * ─── Performance budget ────────────────────────────────────────────
 *   emit fanout: O(handlers); target ≤ 0.2ms for 50 listeners.
 *
 * GDD-driven configuration (consumed from `model.hookBus`):
 *   debugLog   boolean — log every event to console            (default false)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitHookBusRuntime(cfg) → runtime JS string
 */

const DEFAULTS = Object.freeze({
  debugLog: false,
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.hookBus) || {};
  if (src.debugLog === true) cfg.debugLog = true;
  return cfg;
}

export const HOOK_EVENTS = Object.freeze([
  /* Wave A → S: core spin lifecycle */
  'preSpin',
  'onSpinResult',
  'onTumbleStep',
  'postSpin',
  'onFsTrigger',
  'onFsSpinResult',
  'onFsEnd',
  /* Wave V: spin-control intent events (slam-stop + force-skip) */
  'onSlamRequested',
  'onSlamComplete',
  'onSkipRequested',
  'onSkipComplete',
  /* Wave V5: win-presentation phase signals
   * onWinPresentationStart {award, eventCount} — fires after detection,
   *   before the visual rollup cycle. Marks the start of a skippable
   *   presentation window. Owner: winPresentation.mjs.
   * onWinPresentationEnd {award} — fires when the cycle finishes
   *   naturally (NOT via skip — onSkipComplete handles that path).
   *   Owner: winPresentation.mjs. */
  'onWinPresentationStart',
  'onWinPresentationEnd',
  /* Wave H5: Big-Win Tier ladder phase signals
   * onBigWinTierEntered {tier, x, label, durationMs, soundBus} — fires
   *   when totalAward/bet crosses a threshold and the ladder banner
   *   starts. tier is INT 1..5 (vendor-neutral); label is GDD-driven.
   *   Owner: bigWinTier.mjs.
   * onBigWinTierExited {tier, reason} — fires when the banner exits.
   *   reason is 'natural' (duration expired) or 'skipped' (player skip).
   *   Owner: bigWinTier.mjs. */
  'onBigWinTierEntered',
  'onBigWinTierExited',
  /* onBigWinTierEnd {tier, x, reason} — fires once when the entire
   * compound walkthrough finishes (natural or skipped). Distinct from
   * per-tier Exited which fires for every walked tier. */
  'onBigWinTierEnd',
  /* Wave H14: Hold-and-Win Credit Bucket extension events
   * onCreditBucketRespinStart {startingRespins} — fires when holdAndWin
   *   enters its respin round and the credit-bucket layer arms.
   *   Owner: holdAndWinCreditBucket.mjs.
   * onCreditBucketLocked {cell, amount, label, isJackpot} — fires for
   *   each newly locked bonus cell as its credit/jackpot value is drawn.
   *   Owner: holdAndWinCreditBucket.mjs.
   * onCreditBucketEnd {total, jackpotTier, cellCount, allLocked} — fires
   *   once when the H&W round ends (respins exhausted or grid filled).
   *   Owner: holdAndWinCreditBucket.mjs. */
  'onCreditBucketRespinStart',
  'onCreditBucketLocked',
  'onCreditBucketEnd',
  /* Wave H15: Weighted Wheel Segments extension events
   * onWheelSegmentChosen {index, label, value, jackpotTier?, jackpotX?} —
   *   fires when the wheel animation ends and the winning segment is
   *   resolved (weighted draw). Owner: weightedWheelSegments.mjs.
   * onWheelJackpotHit {tier, x} — fires when the chosen segment carries
   *   a jackpotTier label that matched cfg.jackpotMap.
   *   Owner: weightedWheelSegments.mjs.
   * onWheelAwardCollected {award, isJackpot, tier?} — fires on Collect
   *   click; window.__WIN_AWARD__ is pushed so the existing
   *   winPresentation → bigWinTier chain handles payout.
   *   Owner: weightedWheelSegments.mjs. */
  'onWheelSegmentChosen',
  'onWheelJackpotHit',
  'onWheelAwardCollected',
  /* Wave H13: Path-Aware Multiplier extension events
   * onPathMultiplierAssigned {eventIdx, symbol, ways, multiplier, label} —
   *   fires once per ways event that pathAwareMultiplier decorated with
   *   a per-path multiplier (during the patched detectWaysWins call).
   *   Owner: pathAwareMultiplier.mjs.
   * onPathMultiplierAggregate {events, totalMult, awardBonus, bet} —
   *   fires once per postSpin when at least one path carried a
   *   multiplier ≥ 2. Aggregation mode (additive | multiplicative) is
   *   set in GDD config. Owner: pathAwareMultiplier.mjs. */
  'onPathMultiplierAssigned',
  'onPathMultiplierAggregate',
  /* Wave H11: Bonus Buy Deterministic Plant extension events
   * onBonusBuyTierSelected {tier, costX, plantedCount} — fires when the
   *   player picks a tier in the picker modal.
   *   Owner: bonusBuyDeterministic.mjs.
   * onDeterministicPlantApplied {tier, positions, symbol, count} — fires
   *   on onSpinResult after the planted cells are rewritten in the DOM.
   *   Owner: bonusBuyDeterministic.mjs. */
  'onBonusBuyTierSelected',
  'onDeterministicPlantApplied',
  /* Wave H12: Net Win/Loss Indicator extension events
   * onNetThresholdCrossed {from, to, level, net, direction, threshold} —
   *   fires when running session net crosses any configured threshold in
   *   either direction. `direction` is 'losing' or 'recovering';
   *   `threshold` is the matching ladder entry (null if returning to
   *   the empty level). Owner: netLossIndicator.mjs. */
  'onNetThresholdCrossed',
  /* Wave H2: Reality Check player-protection modal events
   * onRealityCheckShown {reason, stats} — fires when the modal opens
   *   (reason: 'time' | 'spins' | 'loss' | 'manual').
   *   Owner: realityCheck.mjs.
   * onRealityCheckDismissed {reason} — fires when CONTINUE clicked.
   * onRealityCheckPaused {durationMs} — fires when player picks a pause.
   * onRealityCheckResumed {} — fires when the pause timer expires.
   * onRealityCheckQuit {stats} — fires when QUIT clicked; session ends. */
  'onRealityCheckShown',
  'onRealityCheckDismissed',
  'onRealityCheckPaused',
  'onRealityCheckResumed',
  'onRealityCheckQuit',
  /* Wave H3: Session Timeout (continuous-play cap + forced break) events
   * onSessionWarningShown {remainingMs, sessionMs} — fires when sessionMs
   *   crosses `maxMs - warnMs` threshold (single-shot until reset).
   *   Owner: sessionTimeout.mjs.
   * onSessionTimeoutFired {sessionMs, breakMs, forceLogout} — fires when
   *   sessionMs reaches the hard `maxMs` cap; forced break begins.
   * onSessionResumed {breakDurationMs, reason} — fires when break ends
   *   (auto | manual | logout) and the spin gateway is released.
   * onSessionExtended {extendedMs} — fires when player acknowledges the
   *   warning modal under UKGC soft-model (skips forced break this cycle).
   * onSessionLogoutRequested {sessionMs} — fires when player picks QUIT
   *   inside a forced break (AGCO/NJDGE hard-exit submode). */
  'onSessionWarningShown',
  'onSessionTimeoutFired',
  'onSessionResumed',
  'onSessionExtended',
  'onSessionLogoutRequested',
  /* Wave U4: autoplay session events */
  'onAutoplayStart',
  'onAutoplayStop',
  'onAutoplayTick',
  /* Wave U5: bet-selector state change event */
  'onBetChanged',
  /* Wave U6: secondary-gamble session events */
  'onGambleStart',
  'onGambleRound',
  'onGambleEnd',
  /* Wave U8: balance HUD state change event */
  'onBalanceChanged',
  /* Wave U11: turbo-mode toggle event */
  'onTurboToggle',
  /* Wave K7: settings-panel extension — sole-owned by settingsPanel.mjs */
  'onVolatilityChanged',
  'onBetStepPresetChanged',
  'onMaxWinCapToggled',
  /* Wave A5: locale + dir lifecycle (settingsPanel→rtlLayout). */
  'onLocaleChanged',
  'onDirChanged',
  /* Wave A8: PWA installability lifecycle (sole-owned by pwaInstallability). */
  'onPwaInstallable',
  'onPwaInstalled',
  'onPwaSwReady',
  /* Wave HX3+HX4: i18n + currency lifecycle (sole-owned by i18n.mjs). */
  'onLanguagePackApplied',
  /* Wave P8: hot-reload BLOCK events (dev-mode, production-disabled).
   * onHotReloadConnect    {}                — SSE established.
   * onHotReloadDisconnect { reason }        — SSE closed / errored.
   * onGddChange           { model, src }    — dev server reported a sample
   *   GDD change AND the page successfully re-parsed it in-place. Blocks
   *   that hold parsed-model-derived state (paytable, themeCSS, anticipation
   *   thresholds, …) can subscribe to re-arm without a full page reload.
   *   Owner: src/blocks/hotReload.mjs (emit). Consumers: any block that
   *   wants live-edit responsiveness. */
  'onHotReloadConnect',
  'onHotReloadDisconnect',
  'onGddChange',
  /* Wave U-FORCE-ALL: universal feature force panel.
   * onForceFeatureRequested {kind, label, source} — fires when a chip
   *   in the universal force panel is pressed. `kind` is one of the
   *   parser-recognized feature kinds (free_spins, bonus_buy, hold_and_win,
   *   bonus_pick, wheel_bonus, multiplier, cascade, cluster_pays, ways,
   *   expanding_wild, walking_wild, sticky_wild, mystery_symbol, scatter_pay,
   *   lightning, respin, wild_reel, gamble, ante_bet, super_symbol, big_win).
   *   `source` is 'panel' for chip-clicks. Owner: src/blocks/universalForcePanel.mjs.
   *   Consumers: any feature block that wants to react deterministically;
   *   genericFeatureBanner.mjs is the catch-all for kinds without a
   *   dedicated handler. */
  'onForceFeatureRequested',
  /* onForceMultiplier {multX} — fires when the UFP multiplier chip
   *   force-sets a multiplier value. Owner: universalForcePanel.mjs.
   *   Consumers: multiplierOrb / persistentMultiplier / pathAwareMultiplier
   *   blocks that want to render a visual feedback ON THE GRID for the
   *   forced value (orb chip, frame badge, etc). genericFeatureBanner
   *   already handles the banner placard separately. */
  'onForceMultiplier',
  /* Wave LEGO-M multiplier-variant events (6 new blocks, 2026-06-18).
   * Each owned by a single block per LEGO discipline.
   *
   * onPerFsSpinMultiplierRolled {multX, fsRemain} — fires at every FS
   *   spin start with a new random draw from the configured weighted
   *   distribution. Owner: perFsSpinMultiplier.mjs. Consumers: HUD chips
   *   that want to mirror the rolling FS mult.
   *
   * onMysteryMultiplierRevealed {cellKey, multX} — fires when a mystery
   *   "?" symbol on the grid reveals as a multiplier value (×N) rather
   *   than a pay symbol. Owner: mysterySymbolMultiplier.mjs.
   *
   * onWildCollision {wildCount, productMult, lineIdx} — fires when 2+
   *   wilds contribute to the same chain / line / cluster and the block
   *   multiplies their per-wild values into a combined product mult.
   *   Owner: wildCollisionMultiplier.mjs.
   *
   * onRetriggerMultiplierBumped {newMultX, retriggerCount} — fires when
   *   an FS retrigger bumps the round-level multiplier by step or by
   *   the next ladder rung. Owner: retriggerMultiplierBump.mjs.
   *
   * onClusterSizeMultiplierApplied {clusterSize, multX} — fires when
   *   a winning cluster's size tier maps to a multiplier. Owner:
   *   clusterSizeMultiplier.mjs. Consumes onClusterPay from the
   *   cluster-pays evaluator.
   *
   * onMultiplierChanged {multX, value} — bus-level signal emitted by
   *   HookBus.setMult itself; pure read-only listener event. Owner:
   *   hookBus.mjs (this file). Consumers: totalMultiplierChip.mjs and
   *   any presentation block that mirrors the canonical lastMult. */
  'onPerFsSpinMultiplierRolled',
  'onMysteryMultiplierRevealed',
  'onWildCollision',
  'onRetriggerMultiplierBumped',
  'onClusterSizeMultiplierApplied',
  'onMultiplierChanged',
  /* Wave LEGO-FSV (Free Spins variants, 2026-06-18 evening) — 6 new
   * events from 4 new FS-variant blocks. Each single-owner per LEGO.
   *
   * onFsModePicked {modeIndex, spinsCount, baseMultiplier, label} —
   *   fires when player taps a card on the pre-FS choice overlay.
   *   Owner: pickYourFs.mjs.
   *
   * onLockedSymbolFsSeeded {cellKeys, lockSymbol} — fires at FS_INTRO
   *   after N random cells are pinned with the lock symbol for the
   *   round. Owner: lockedSymbolFs.mjs.
   *
   * onTumbleOnlyFsModeEntered {chainsBudget} / onTumbleOnlyFsChainEnded
   *   {chainsRemaining} — pair fires at FS enter + end of each tumble
   *   chain for tumble-only FS rounds. Owner: tumbleOnlyFs.mjs.
   *
   * onInfiniteFsStreakBumped {streak} / onInfiniteFsModeEnded
   *   {finalStreak} — pair fires per winning FS spin and at the first
   *   losing FS spin. Owner: infiniteFsUntilLoss.mjs. */
  'onFsModePicked',
  'onLockedSymbolFsSeeded',
  'onTumbleOnlyFsModeEntered',
  'onTumbleOnlyFsChainEnded',
  'onInfiniteFsStreakBumped',
  'onInfiniteFsModeEnded',
  /* Wave LEGO-W2 (Wild variants, 2026-06-19) — 2 new wild-family blocks.
   *
   * onCascadingWildPinned {cellKey, totalPinned, chainStep} — fires for
   *   each wild that gets pinned this tumble chain step. Owner:
   *   cascadingWildPersistence.mjs.
   *
   * onMysteryWildRevealed {cellKey, wildSymbolId} — fires when a mystery
   *   "?" cell reveals as wild (not as pay or mult). Owner:
   *   mysteryWildReveal.mjs. */
  'onCascadingWildPinned',
  'onMysteryWildRevealed',
  /* Wave LEGO-FS2 (FS variants, 2026-06-19) — 2 new FS-family blocks.
   *
   * onFsSymbolUpgraded {removedSymbol, remainingSymbols, tierIndex} —
   *   fires every spinsPerUpgrade FS spin when the lowest pay symbol
   *   is removed from the pool and tier index bumps. Owner:
   *   fsSymbolUpgradeEscalation.mjs.
   *
   * onFsJackpotPoolBumped {newPoolX, deltaX, spinWinX} — fires on every
   *   FS spin to track the carry-over pool growth. Owner:
   *   fsPersistentJackpotPool.mjs.
   *
   * onFsJackpotPoolPaidOut {finalPoolX, trigger} — fires when pool pays
   *   out (trigger ∈ {fsEnd, maxScatters}). Owner: fsPersistentJackpotPool.mjs. */
  'onFsSymbolUpgraded',
  'onFsJackpotPoolBumped',
  'onFsJackpotPoolPaidOut',
  /* onFsJackpotPoolEndRequested {reason} — fires when fsPersistentJackpotPool
   * decides the round should end early (e.g. maxScatters trigger). Owner:
   * fsPersistentJackpotPool.mjs. Consumer: freeSpins state machine can
   * gracefully wind down on the next transition. Defensive fallback
   * (FREESPINS.remaining=0) remains in place for engines without listener. */
  'onFsJackpotPoolEndRequested',
  /* Wave LEGO-HW2 (Hold & Win variants, 2026-06-19) — 2 new blocks.
   *
   * onWildTriggerHoldAndWinRequested {wildCount, threshold, mode, wildCellKeys}
   *   — fires when wild cluster threshold is met in base game; canonical
   *   request signal for holdAndWin.mjs to start a round via alternative
   *   trigger path. Owner: wildTriggerHoldAndWin.mjs.
   *
   * onHoldAndWinReelExpanded {newColumnCount, trigger, expansionsThisRound}
   *   — fires when mid-round H&W column expansion lands a new reel.
   *   Owner: holdAndWinReelExpansion.mjs. */
  'onWildTriggerHoldAndWinRequested',
  'onHoldAndWinReelExpanded',
  /* Wave LEGO-B2 (Bonus reveal variants, 2026-06-19) — 3 new bonus blocks.
   * Each block emits Entered/Revealed/Rolled/Ended trail events.
   * Requested events (onMatchThreeBonusRequested etc.) are CONSUMER-only
   * here — they are fired by an upstream trigger block (TBD per GDD)
   * and consumed by these bonus engines; thus they intentionally have
   * no canonical-emitter declaration. */
  'onMatchThreeBonusEntered',
  'onMatchThreeBonusRevealed',
  'onMatchThreeBonusEnded',
  'onMoneyGrabEntered',
  'onMoneyGrabRevealed',
  'onMoneyGrabEnded',
  'onPathBonusEntered',
  'onPathBonusRolled',
  'onPathBonusEnded',
  /* Wave LEGO-ENG (Engine topology, 2026-06-19) — 2 new engine blocks.
   *
   * onPyramidSpinResult {duringFs, topology} — fires from pyramidGrid-
   * Engine at settle, alongside canonical onSpinResult (40+ listeners).
   * Topology field allows hex/wheel/pyramid-aware listeners to branch.
   * Owner: pyramidGridEngine.mjs.
   *
   * onHexClusterPay {clusterSize, cellKeys, awardX, symbol} — fires per
   * detected cluster from hexClusterEngine after BFS flood-fill scan.
   * Owner: hexClusterEngine.mjs. */
  'onPyramidSpinResult',
  'onHexClusterPay',
  /* Wave LEGO-FS3 (Free Spins variants tier 3, 2026-06-19) — 2 new blocks.
   *
   * onWinBothWaysActivated {active:true} / onWinBothWaysDeactivated
   *   {active:false} — pair fires on FS enter/end. Sets canonical
   *   window.__WIN_BOTH_WAYS__ flag that paylines evaluators read for
   *   transient bidirectional pay mode. Owner: winBothWaysActivation.mjs.
   *
   * onFsReelHeightEscalated {newRowCount, retriggerCount, perReel}
   *   — fires on FS retrigger when reel rows escalate by configured
   *   delta. Owner: fsReelHeightEscalation.mjs. */
  'onWinBothWaysActivated',
  'onWinBothWaysDeactivated',
  'onFsReelHeightEscalated',
  /* Wave LEGO-FS3.3 (Adapter wave, 2026-06-19) — 2 new blocks closing
   * deferred QA findings.
   *
   * onReelHeightGrown {reelIdx, addedRows, newVisibleRows} /
   * onReelHeightShrunk {reelIdx, removedRows, newVisibleRows} — pair
   * fires per reel when adapter atomically grows or shrinks column DOM.
   * Owner: reelHeightAdapter.mjs.
   *
   * onBonusOverlayMutexAcquired {ownerKind, queueLen} /
   * onBonusOverlayMutexReleased {ownerKind, nextOwnerKind, queueLen}
   * — pair fires when bonus overlay serial-queue grants or releases
   * the screen-owner slot. Owner: bonusOverlayMutex.mjs. */
  'onReelHeightGrown',
  'onReelHeightShrunk',
  'onBonusOverlayMutexAcquired',
  'onBonusOverlayMutexReleased',
  /* Scatter Celebration phase signals
   * onScatterCelebrationStart {cellCount, durationMs} — fires when the
   *   FS trigger scatter celebration animation begins. spinControl uses
   *   this to morph its #spinBtn into a SKIP CTA for the celebration
   *   phase. Owner: scatterCelebration.mjs.
   * onScatterCelebrationEnd {reason} — fires when the celebration ends
   *   (reason: 'natural' | 'skipped'). Owner: scatterCelebration.mjs. */
  'onScatterCelebrationStart',
  'onScatterCelebrationEnd',
  /* onDailyJackpotAward {amount, currency, atUtcDay} — fires when the
   *   daily-jackpot per-spin random roll succeeds (or force-chip flagged
   *   the next spin). Owner: src/blocks/dailyJackpot.mjs.
   *   Consumers: audio bus (jackpot sting), historyLog (transaction row),
   *   any external HUD that wants to react to the award. */
  'onDailyJackpotAward',
  /* Wave H4: Color-blind pattern overlay (WCAG 2.2 SC 1.4.1)
   * onCbPatternsToggle {enabled, source} — fires when player toggles the
   *   pattern overlay layer (chip click | settings panel | API).
   *   `source` is 'chip' | 'api' | 'settings'. Owner: colorblindPatterns.mjs.
   *   Consumers: settingsPanel mirrors the state row; any UI that wants to
   *   reflect the colour-independence mode. */
  'onCbPatternsToggle',
  /* Wave H6: Bonus Climax Reveal (presenter for any bonus-entry event)
   * onBonusClimaxStart {kind, label, durationMs} — fires when the full-
   *   screen placard appears. `kind` ∈ {free_spins, wheel, bonus_buy,
   *   hold_and_win, jackpot, pick, generic}. Owner: bonusClimaxReveal.mjs.
   * onBonusClimaxEnd {kind, reason} — fires when placard dismisses;
   *   reason ∈ {natural, skipped, manual}. Owner: bonusClimaxReveal.mjs. */
  'onBonusClimaxStart',
  'onBonusClimaxEnd',
  /* Wave H7: Cell Level Upgrade — per-cell numeric meter
   * onCellLevelUp {reel, row, sym, fromLevel, toLevel, source} — fires
   *   when a cell's tracked level increments. Owner: cellLevelUpgrade.mjs.
   * onCellLevelReset {scope, source} — fires when the level map is
   *   cleared (per round / FS / manual). Owner: cellLevelUpgrade.mjs. */
  'onCellLevelUp',
  'onCellLevelReset',
  /* Wave H8: Cell Overflow Counter — stack overflow per reel
   * onCellOverflow {reel, count, total} — fires per reel after settle
   *   when the symbol stack exceeds the visible rows. Owner:
   *   cellOverflowCounter.mjs. */
  'onCellOverflow',
  /* Wave H9: Ambient Background Wheel — theme atmosphere visual
   * onAmbientPhase {phase, speedMul} — fires when ambient layer changes
   *   speed ('idle' | 'spinning' | 'win'). Owner: ambientBackgroundWheel.mjs. */
  'onAmbientPhase',
  /* Wave H10: Dual-Role Scatter — scatter that doubles as wild or pay
   * onDualRoleActivated {reel, row, sym, role} — fires per dual-role
   *   activation (role ∈ 'wild' | 'pay' | 'scatter'). Owner:
   *   dualRoleScatter.mjs. */
  'onDualRoleActivated',
  /* Wave H11: Mega Symbol (oversized 2×2 / 3×3 block presenter)
   * onMegaSymbolLanded {reel, row, size, sym} — engine OR force chip drives
   *   this; megaSymbol.mjs LISTENS and renders the overlay. Engine-owned.
   * onMegaSymbolPlaced {reel, row, size, sym, source} — fires AFTER overlay
   *   is mounted. Owner: megaSymbol.mjs.
   * onMegaSymbolCleared {source} — fires when overlay removed.
   *   Owner: megaSymbol.mjs. */
  'onMegaSymbolLanded',
  'onMegaSymbolPlaced',
  'onMegaSymbolCleared',
  /* Wave H12: Wild Collection Trail (persistent wild-counter meter)
   * onWildTrailBump {from, to, max, source} — fires per spin/cascade.
   * onWildCollectionReward {step, total, kind} — fires when a configured
   *   threshold (5, 10, …) is crossed; kind ∈ {fsBonus, multBump, cashBonus,
   *   wildBoost}. Owner: wildCollectionTrail.mjs.
   * onWildTrailReset {reason, source} — fires on auto-reset at max OR
   *   manual API. Owner: wildCollectionTrail.mjs. */
  'onWildTrailBump',
  'onWildCollectionReward',
  'onWildTrailReset',
  /* Wave H13: Jackpot Ladder Rooms (4-tier visual presenter)
   * onJackpotRoomEnter {tier} — engine OR API drives, presenter listens.
   * onJackpotRoomWin   {tier, amount} — engine OR API drives.
   * onJackpotRoomEntered {tier, label} — presenter ack. Owner: jackpotLadderRooms.mjs.
   * onJackpotRoomWon    {tier, label, amount} — presenter ack. Owner: jackpotLadderRooms.mjs.
   * onJackpotRoomExit   {tier, reason} — presenter ack. Owner: jackpotLadderRooms.mjs. */
  'onJackpotRoomEnter',
  'onJackpotRoomWin',
  'onJackpotRoomEntered',
  'onJackpotRoomWon',
  'onJackpotRoomExit',
  /* Wave H14: Supercharged FS (retrigger multiplier escalation)
   * onFsRetrigger {} — engine drives; superchargedFs.mjs listens.
   * onFsMultiplierEscalated {from, to, retriggerCount, ladderIdx, source}
   *   — fires on each retrigger after badge update.
   *   Owner: superchargedFs.mjs.
   * onFsSuperchargeReset {reason} — fires on round end. Owner: superchargedFs.mjs. */
  'onFsRetrigger',
  'onFsMultiplierEscalated',
  'onFsSuperchargeReset',
  /* Wave H15: Cascade Booster (per-cascade-depth multiplier escalation)
   * onCascadeBoosterTick {from, to, depth, ladderIdx, source} — fires per
   *   bumped cascade. Owner: cascadeBooster.mjs.
   * onCascadeBoosterReset {reason} — fires on preSpin / onFsEnd / manual.
   *   Owner: cascadeBooster.mjs. */
  'onCascadeBoosterTick',
  'onCascadeBoosterReset',
  /* Wave H16: Split Symbol (one symbol divides into two)
   * onSplitSymbolPlaced  {reel, row, sym, source} — Owner: splitSymbol.mjs.
   * onSplitSymbolCleared {source}                  — Owner: splitSymbol.mjs. */
  'onSplitSymbolPlaced',
  'onSplitSymbolCleared',
  /* Wave H17: Nudge Reel (classic fruit-machine near-miss rescue presenter)
   * onNudgeOffered  {reel, direction, reason, source}      — Owner: nudgeReel.mjs.
   * onNudgeAccepted {reel, direction, source}              — Owner: nudgeReel.mjs.
   * onNudgeDeclined {reel, direction, reason, source}      — Owner: nudgeReel.mjs.
   * onNudgeResolved {reel, direction, outcome, source}     — Owner: nudgeReel.mjs. */
  'onNudgeOffered',
  'onNudgeAccepted',
  'onNudgeDeclined',
  'onNudgeResolved',
  /* Wave H18: Respin Charge (charges → auto-respin)
   * onRespinChargeBump  {from, to, max, source} — Owner: respinCharge.mjs.
   * onRespinChargeFull  {capacity, source}       — Owner: respinCharge.mjs.
   * onRespinChargeReset {reason}                 — Owner: respinCharge.mjs.
   * onRespinChargeTick  {delta}                  — Owner: respinCharge.mjs (engine-facing API). */
  'onRespinChargeBump',
  'onRespinChargeFull',
  'onRespinChargeReset',
  'onRespinChargeTick',
  /* Wave H19: Sync Reels (N reels match identical stack)
   * onReelsSynced       {reels[], count, signature, source} — Owner: syncReels.mjs.
   * onSyncReelsCleared  {reason}                            — Owner: syncReels.mjs. */
  'onReelsSynced',
  'onSyncReelsCleared',
  /* Wave H20: Win Multiplier Badge (× N chip on win lines)
   * onWinMultBadgePlaced  {reel, row, mult, source} — Owner: winMultiplierBadge.mjs.
   * onWinMultBadgeCleared {reason}                  — Owner: winMultiplierBadge.mjs. */
  'onWinMultBadgePlaced',
  'onWinMultBadgeCleared',
  /* Hi-Lo Gamble (card hi-lo risk-it presenter)
   * onHiLoStart     {award, source}                              — Owner: hiLoGamble.mjs.
   * onHiLoChoice    {choice, card, source}                       — Owner: hiLoGamble.mjs.
   * onHiLoResolved  {result, choice, card, nextCard, stake, src} — Owner: hiLoGamble.mjs.
   * onHiLoCollected {stake, rounds, source}                      — Owner: hiLoGamble.mjs. */
  'onHiLoStart',
  'onHiLoChoice',
  'onHiLoResolved',
  'onHiLoCollected',
  /* H18 infinityReels — grid grows per cascade win
   * onInfinityReelAdded      {from, to, newReelCount, source} — Owner: infinityReels.mjs.
   * onInfinityReelsReset     {reason, finalCount, source}     — Owner: infinityReels.mjs.
   * onInfinityChainMilestone {count, milestoneIdx, label, source} — Owner: infinityReels.mjs. */
  'onInfinityReelAdded',
  'onInfinityReelsReset',
  'onInfinityChainMilestone',
  /* H19 collectableSymbol — sym-collector HUD meter
   * onSymbolCollected {symbol, count, threshold, delta, source} — Owner: collectableSymbol.mjs.
   * onCollectionFull  {symbol, count, threshold, source}        — Owner: collectableSymbol.mjs.
   * onCollectionReset {symbol, reason, source}                  — Owner: collectableSymbol.mjs. */
  'onSymbolCollected',
  'onCollectionFull',
  'onCollectionReset',
  /* H20 retriggerMeter — FS retrigger HUD meter presenter (listens to
   * onFsRetrigger which is owned by superchargedFs.mjs)
   * onRetriggerMeterTick   {scattersThisSpin, scattersTotal, threshold, ratio, source} — Owner: retriggerMeter.mjs.
   * onRetriggerMeterCommit {addedCount, newTotalFs, scattersTotal, source}             — Owner: retriggerMeter.mjs.
   * onRetriggerMeterReset  {reason, finalTotal, source}                                — Owner: retriggerMeter.mjs. */
  'onRetriggerMeterTick',
  'onRetriggerMeterCommit',
  'onRetriggerMeterReset',
  /* Wave H21: Win Line Flash (per-line directional flash on win)
   * onWinLineFlashStart   {lineIdx, cellCount, source} — Owner: winLineFlash.mjs.
   * onWinLineFlashEnd     {lineIdx, source}            — Owner: winLineFlash.mjs.
   * onWinLineFlashCleared {reason}                     — Owner: winLineFlash.mjs. */
  'onWinLineFlashStart',
  'onWinLineFlashEnd',
  'onWinLineFlashCleared',
  /* Wave H22: Near-Miss Tease (almost-won highlight)
   * onNearMissTease   {count, trigger, deficit, source} — Owner: nearMissTease.mjs.
   * onNearMissCleared {reason}                          — Owner: nearMissTease.mjs. */
  'onNearMissTease',
  'onNearMissCleared',
  /* Wave H23: Reel Lock Hold (lock whole reels with countdown)
   * onReelLockStart   {reel, rounds, source}            — Owner: reelLockHold.mjs.
   * onReelLockEnd     {reel, source}                    — Owner: reelLockHold.mjs.
   * onReelLockTick    {ended[], remaining[], source}    — Owner: reelLockHold.mjs.
   * onReelLockCleared {reason}                          — Owner: reelLockHold.mjs. */
  'onReelLockStart',
  'onReelLockEnd',
  'onReelLockTick',
  'onReelLockCleared',
  /* Wave H24: Cascade Path Draw (SVG chain between cluster win cells)
   * onCascadePathDrawn   {eventIdx, points, source} — Owner: cascadePathDraw.mjs.
   * onCascadePathCleared {reason}                    — Owner: cascadePathDraw.mjs. */
  'onCascadePathDrawn',
  'onCascadePathCleared',
  /* Wave H25: Streak Bonus (N consecutive wins → bonus)
   * onStreakBump          {from, to, threshold, source} — Owner: streakBonus.mjs.
   * onStreakBonusEarned   {threshold, kind, source}     — Owner: streakBonus.mjs.
   * onStreakReset         {reason}                       — Owner: streakBonus.mjs. */
  'onStreakBump',
  'onStreakBonusEarned',
  'onStreakReset',
  /* Wave H27: Payline Dimmer (dim non-winning cells during win presentation)
   * onPaylineDimmerStart   {dimmedCount, source} — Owner: paylineDimmer.mjs.
   * onPaylineDimmerCleared {reason}              — Owner: paylineDimmer.mjs. */
  'onPaylineDimmerStart',
  'onPaylineDimmerCleared',
  /* Wave H30: Retrigger Escalator (multi-tier FS retrigger reward ladder)
   * onRetriggerEscalated      {fromTier, toTier, fsAdded, totalFsAdded, source} — Owner: retriggerEscalator.mjs.
   * onRetriggerEscalatorReset {reason}                                          — Owner: retriggerEscalator.mjs. */
  'onRetriggerEscalated',
  'onRetriggerEscalatorReset',
  /* Mega-fix sweep: legacy events that were emit-ed by blocks before the canonical HOOK_EVENTS registry existed. Auto-added by tools/cortex-block-mega-fix.mjs. Per-event owners are recorded in tools/lego-gate.mjs (EXPECTED_EMIT_OWNERS). */
  'onAiActDdaProhibited',  // Owner: euAiActComplianceGate.mjs
  'onAiSystemDeclarationRequired',  // Owner: euAiActComplianceGate.mjs
  'onAnteBetChanged',  // Owner: anteBet.mjs
  'onAnteBetLadderChanged',  // Owner: anteBetLadder.mjs (LEGO-BUY Wave 4)
  'onAutoplayBanned',  // Owner: franceComplianceGate.mjs, italyComplianceGate.mjs, spainComplianceGate.mjs
  'onAutoplayDisclosureRequired',  // Owner: autoplay.mjs
  'onBonusBuyRequested',  // Owner: bonusBuy.mjs
  'onBonusBuyMenuOpened',  // Owner: bonusBuyMenu.mjs (LEGO-BUY Wave 4)
  'onBonusBuyMenuClosed',  // Owner: bonusBuyMenu.mjs (LEGO-BUY Wave 4)
  'onBonusBuyMenuTierSelected',  // Owner: bonusBuyMenu.mjs (LEGO-BUY Wave 4)
  'onMysteryPrizeBoxAppeared',  // Owner: mysteryPrizeBox.mjs (LEGO-RANDOM B-3)
  'onMysteryPrizeBoxOpened',  // Owner: mysteryPrizeBox.mjs (LEGO-RANDOM B-3)
  'onMysteryPrizeBoxDismissed',  // Owner: mysteryPrizeBox.mjs (LEGO-RANDOM B-3)
  'onRandomWildBurstFired',  // Owner: randomWildBurst.mjs (LEGO-RANDOM B-3)
  'onCoinCollected',  // Owner: coinCollect.mjs (LEGO-COLLECT B-4)
  'onCumulativeMeterThresholdHit',  // Owner: cumulativeMeter.mjs (LEGO-COLLECT B-4)
  'onCumulativeMeterReset',  // Owner: cumulativeMeter.mjs (LEGO-COLLECT B-4)
  'onCollectRevealOpened',  // Owner: collectRevealOverlay.mjs (LEGO-COLLECT B-4)
  'onCollectRevealClaimed',  // Owner: collectRevealOverlay.mjs (LEGO-COLLECT B-4)
  'onCoinShowerEnd',  // Owner: coinShower.mjs
  'onCoinShowerStart',  // Owner: coinShower.mjs
  'onCoolOffEnforced',  // Owner: netherlandsComplianceGate.mjs
  'onCoolOffPeriodActive',  // Owner: netherlandsComplianceGate.mjs
  'onCoolOffPeriodExpired',  // Owner: netherlandsComplianceGate.mjs
  'onCoolOffPeriodStarted',  // Owner: netherlandsComplianceGate.mjs
  'onCruksCheckPending',  // Owner: reelEngine.mjs
  'onCruksCheckRequired',  // Owner: netherlandsComplianceGate.mjs
  'onEnergyChange',  // Owner: energyMeter.mjs
  'onEnergyFull',  // Owner: energyMeter.mjs
  'onFrjCheckRequired',  // Owner: franceComplianceGate.mjs
  'onGameStateCleared',  // Owner: germanyComplianceGate.mjs
  'onHoldAndWinEnd',  // Owner: holdAndWin.mjs
  'onHoldAndWinPayout',  // Owner: holdAndWin.mjs
  'onHoldAndWinPhase',  // Owner: holdAndWin.mjs
  'onIndexedDbCleared',  // Owner: germanyComplianceGate.mjs
  'onJurisdictionResolved',  // Owner: jurisdictionGate.mjs
  'onLdwSuppressed',  // Owner: winPresentation.mjs, winPresentation.mjs
  'onMandatoryRealityCheckIntervalEnforced',  // Owner: italyComplianceGate.mjs, spainComplianceGate.mjs
  'onManualSpinPaceBlocked',  // Owner: reelEngine.mjs
  'onMinSpinDurationEnforced',  // Owner: franceComplianceGate.mjs, italyComplianceGate.mjs, spainComplianceGate.mjs
  'onMinSpinPaceDeferred',  // Owner: autoplay.mjs
  'onMinSpinPaceEnforced',  // Owner: germanyComplianceGate.mjs
  'onMultChange',  // Owner: persistentMultiplier.mjs, persistentMultiplier.mjs
  'onMultLadderReset',  // Owner: multiplierLadder.mjs
  'onMultLadderStep',  // Owner: multiplierLadder.mjs
  'onMysteryRevealEnd',  // Owner: mysteryReveal.mjs
  'onMysteryRevealStart',  // Owner: mysteryReveal.mjs
  'onPickRevealEnd',  // Owner: pickBonusReveal.mjs
  'onPickRevealStart',  // Owner: pickBonusReveal.mjs
  'onPlayTimeDisplayRequired',  // Owner: realityCheck.mjs
  'onRegulatorDisclosureAcknowledged',  // Owner: regulatorDisclosureModal.mjs
  'onRegulatorDisclosureShown',  // Owner: regulatorDisclosureModal.mjs
  'onRewardChestClose',  // Owner: rewardChest.mjs
  'onRewardChestOpen',  // Owner: rewardChest.mjs
  'onRgiajCheckRequired',  // Owner: spainComplianceGate.mjs
  'onRtpDisclosureRequired',  // Owner: winCap.mjs
  'onRuaCheckRequired',  // Owner: italyComplianceGate.mjs
  'onStackCollapseEnd',  // Owner: symbolStackCollapse.mjs
  'onStackCollapseStart',  // Owner: symbolStackCollapse.mjs
  'onStickyCountChange',  // Owner: stickyMeter.mjs, stickyMeter.mjs
  'onStormMultiplierStart',  // Owner: stormMultiplierReel.mjs
  'onStormMultiplierStop',  // Owner: stormMultiplierReel.mjs, stormMultiplierReel.mjs
  'onSuperSymbolLand',  // Owner: superSymbol.mjs
  'onSymbolUpgrade',  // Owner: symbolUpgrade.mjs
  'onSymbolUpgradeCascade',  // Owner: symbolUpgrade.mjs, symbolUpgrade.mjs
  'onTurboBanned',  // Owner: franceComplianceGate.mjs, italyComplianceGate.mjs
  'onWheelBonusReady',  // Owner: wheelBonus.mjs
  'onWheelCollect',  // Owner: wheelBonus.mjs
  'onWheelModalOpened',  // Owner: wheelBonus.mjs
  'onWheelRevealEnd',  // Owner: wheelBonusReveal.mjs
  'onWheelRevealStart',  // Owner: wheelBonusReveal.mjs
  'onWheelSettled',  // Owner: wheelBonus.mjs
  'onWinCapClamped',  // Owner: winCap.mjs
  'onWinCapTriggered',  // Owner: winCap.mjs
  'requestRespin',  // Owner: walkingWild.mjs
  'symbolOverride',  // Owner: wildReel.mjs

  /* ──────────────────────────────────────────────────────────────────
   * Wave FIX-1 (2026-06-19) — 46-event registry-drift closure.
   *
   * Pre ovog wave-a 46 emit-ed events postojalo je u src/blocks/ ali
   * NIJE u HOOK_EVENTS — `HookBus.on()` ih je odbijao ("unknown event")
   * i `emit()` no-op-ovao. Cross-block coordination tih.
   *
   * Owner mapping mirror-uje EXPECTED_EMIT_OWNERS u tools/lego-gate.mjs.
   * Invariant #8 u istom gate-u (parseHookEventsFromSource ⊇ all emits)
   * sprečava regresiju.
   * ────────────────────────────────────────────────────────────────── */
  'clusterPays:evaluated',  // Owner: clusterPaysEval.mjs (legacy colon, W57.A7 whitelist)
  'expandingWild:applied',  // Owner: expandingWild.mjs (legacy colon)
  'expandingWild:cleared',  // Owner: expandingWild.mjs (legacy colon)
  'init',  // Owner: turboMode.mjs (Wave U pre-canonical naming)
  'onAllWaysCleared',  // Owner: allWaysEval.mjs
  'onAllWaysPay',  // Owner: allWaysEval.mjs
  'onBidirectionalWaysCleared',  // Owner: bidirectionalWaysEval.mjs
  'onBidirectionalWaysPay',  // Owner: bidirectionalWaysEval.mjs
  'onClusterPay',  // Owner: clusterPaysEval.mjs
  'onExpandingWildMultRolled',  // Owner: expandingWildMultiplier.mjs
  'onExpandingWildMultsCleared',  // Owner: expandingWildMultiplier.mjs
  'onExpansionWildAdded',  // Owner: fsExpansionWilds.mjs
  'onExpansionWildsCleared',  // Owner: fsExpansionWilds.mjs
  'onFrameMultiplierBumped',  // Owner: holdAndWinFrameMultiplier.mjs
  'onFrameMultiplierFinal',  // Owner: holdAndWinFrameMultiplier.mjs
  'onInfinityEngineCommit',  // Owner: infinityReelsEngine.mjs
  'onInfinityEngineExpanded',  // Owner: infinityReelsEngine.mjs
  'onInfinityEngineReset',  // Owner: infinityReelsEngine.mjs
  'onJackpotPickerComplete',  // Owner: jackpotPicker.mjs
  'onJackpotPickerDismissed',  // Owner: jackpotPicker.mjs
  'onJackpotPickerTileRevealed',  // Owner: jackpotPicker.mjs
  'onJackpotRoomDismissed',  // Owner: jackpotRoomReveal.mjs
  'onJackpotRoomRevealed',  // Owner: jackpotRoomReveal.mjs
  'onLadderReset',  // Owner: progressiveFsRetriggerLadder.mjs
  'onLadderRungPromoted',  // Owner: progressiveFsRetriggerLadder.mjs
  'onLightningStrike',  // Owner: randomLightningMultiplier.mjs
  'onLightningStrikeMissed',  // Owner: randomLightningMultiplier.mjs
  'onLockedOrbMultiplierFinal',  // Owner: holdAndWinLockedOrbMultiplier.mjs
  'onLockedOrbMultiplierRolled',  // Owner: holdAndWinLockedOrbMultiplier.mjs
  'onMegaWildClusterCleared',  // Owner: megaWildCluster.mjs
  'onMegaWildClusterLanded',  // Owner: megaWildCluster.mjs
  'onRoomJackpotFinal',  // Owner: holdAndWinRoomJackpotMultiplier.mjs
  'onRoomPromoted',  // Owner: holdAndWinRoomJackpotMultiplier.mjs
  'onSuperSymbolUpgradeReset',  // Owner: superSymbolUpgrade.mjs
  'onSuperSymbolUpgraded',  // Owner: superSymbolUpgrade.mjs
  'onSymbolSplitCleared',  // Owner: symbolSplitReveal.mjs
  'onSymbolSplitRevealed',  // Owner: symbolSplitReveal.mjs
  'onSymbolSplitStarted',  // Owner: symbolSplitReveal.mjs
  'onTumbleMultiplierGrown',  // Owner: tumbleGrowingFsMultiplier.mjs
  'onTumbleMultiplierReset',  // Owner: tumbleGrowingFsMultiplier.mjs
  'onWalkingWildExited',  // Owner: walkingWildStepper.mjs
  'onWalkingWildSpawned',  // Owner: walkingWildStepper.mjs
  'onWalkingWildStep',  // Owner: walkingWildStepper.mjs
  'onWaysResetForRound',  // Owner: dynamicWaysEngine.mjs
  'onWaysReshaped',  // Owner: dynamicWaysEngine.mjs
  'wheelBonus.complete',  // Owner: wheelBonus.mjs (legacy dot, W57.A7 whitelist)
  'wheelBonus.spin',  // Owner: wheelBonus.mjs (legacy dot, W57.A7 whitelist)
]);

/* Wave U4: canonical autoplay stop reasons. */
export const AUTOPLAY_STOP_REASONS = Object.freeze([
  'completed',      /* all configured spins played, natural end */
  'manual',         /* player clicked stop button or spin button */
  'feature',        /* FS / lightning / bonus pick / gamble triggered */
  'singleWinAbove', /* single-spin win crossed threshold */
  'balanceBelow',   /* balance dropped below floor */
  'lossLimit',      /* cumulative loss exceeded ceiling */
  'winLimit',       /* cumulative win exceeded ceiling */
  'slam',           /* player slam-stopped a spin during autoplay */
]);

/* Wave V: phase enums for slam/skip payloads — exported so blocks can
 * import the canonical strings instead of stringly-typing. */
export const SLAM_PHASES = Object.freeze(['pre', 'post']);
export const SKIP_PHASES = Object.freeze(['rollup', 'fsIntro', 'fsOutro', 'celebration']);
export const SLAM_SOURCES = Object.freeze(['button', 'reelsArea', 'keyboard']);
export const SKIP_SOURCES = Object.freeze(['button', 'keyboard']);

export function emitHookBusRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ hookBus: cfg });
  const debug = !!c.debugLog;

  return `
  /* ── HookBus BLOCK — emitted by src/blocks/hookBus.mjs ─────────────
     The central lifecycle bus. Every feature block registers here and
     the spin engine emits into it. NO block calls another block directly.
     Events: preSpin, onSpinResult, onTumbleStep, postSpin, onFsTrigger,
             onFsSpinResult, onFsEnd
     Shared state: getMult / setMult / addMult / resetMult (1× baseline).
     Debug mode = ${debug}. */
  const HookBus = (function () {
    const handlers = Object.create(null);
    const EVENTS = ${JSON.stringify(Array.from(HOOK_EVENTS))};
    for (const e of EVENTS) handlers[e] = [];

    const MULT_IDENTITY = 1;
    let _mult = MULT_IDENTITY;
    let _multBase = MULT_IDENTITY;

    function on(event, fn, opts) {
      if (!handlers[event]) {
        console.warn('[HookBus] unknown event:', event);
        return () => {};
      }
      if (typeof fn !== 'function') {
        console.warn('[HookBus] handler is not a function for', event);
        return () => {};
      }
      const priority = (opts && typeof opts.priority === 'number') ? opts.priority : 0;
      const entry = { fn, priority };
      handlers[event].push(entry);
      /* stable insertion order within same priority; higher priority first */
      handlers[event].sort((a, b) => b.priority - a.priority);
      return () => off(event, fn);
    }

    function off(event, fn) {
      if (!handlers[event]) return;
      handlers[event] = handlers[event].filter(e => e.fn !== fn);
    }

    function emit(event, payload) {
      const list = handlers[event];
      if (!list || list.length === 0) return [];
      const results = [];
      ${debug ? `console.log('[HookBus]', event, payload, 'handlers:', list.length);` : ''}
      const snap = list.slice();
      for (const entry of snap) {
        try {
          const r = entry.fn(payload || {});
          results.push(r);
        } catch (err) {
          console.error('[HookBus] handler threw on', event, err);
        }
      }
      return results;
    }

    async function emitAsync(event, payload) {
      const list = handlers[event];
      if (!list || list.length === 0) return [];
      const results = [];
      ${debug ? `console.log('[HookBus.async]', event, payload, 'handlers:', list.length);` : ''}
      const snap = list.slice();
      for (const entry of snap) {
        try {
          const r = await entry.fn(payload || {});
          results.push(r);
        } catch (err) {
          console.error('[HookBus] async handler threw on', event, err);
        }
      }
      return results;
    }

    function getMult() { return _mult; }
    function setMult(v) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) {
        const prev = _mult;
        _mult = n;
        if (typeof window !== 'undefined') {
          window.__HOOKBUS_MULT__ = _mult;
          /* Expose lastMult for presentation blocks (totalMultiplierChip,
           * etc.) that need a stable read-side accessor without the
           * encapsulation jump through HookBus.getMult(). */
          if (window.HookBus) window.HookBus.lastMult = _mult;
        }
        if (n !== prev) {
          /* Emit onMultiplierChanged so display blocks may mirror the new
           * canonical mult value. Single bus event regardless of source
           * (orb sum, retrigger bump, cluster tier, wild collision, …).
           * Note: equivalent to HookBus.emit('onMultiplierChanged', payload)
           * — local emit binding is the same function the public API
           * exports, so ownership grep finds the canonical reference. */
          try { emit('onMultiplierChanged', { multX: _mult, value: _mult, previous: prev }); } catch (_) {}
        }
      }
    }
    function addMult(delta) {
      const n = Number(delta);
      if (Number.isFinite(n)) setMult(_mult + n);
    }
    function resetMult() {
      const prev = _mult;
      _mult = _multBase;
      if (typeof window !== 'undefined') {
        window.__HOOKBUS_MULT__ = _mult;
        if (window.HookBus) window.HookBus.lastMult = _mult;
      }
      if (_mult !== prev) {
        try { emit('onMultiplierChanged', { multX: _mult, value: _mult, previous: prev }); } catch (_) {}
      }
    }
    function setMultBaseline(v) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) _multBase = n;
    }

    function listenerCount(event) {
      return (handlers[event] && handlers[event].length) || 0;
    }

    /* Wave V: once(event, fn) — register a handler that auto-unsubscribes
     * after its first invocation. Industry-standard one-shot reactive
     * primitive (equivalent of when/addWhen reactions) used by slam-stop
     * and force-skip blocks for pre-response to post-response
     * coordination. */
    function once(event, fn, opts) {
      if (typeof fn !== 'function') return () => {};
      let fired = false;
      const wrapped = function (payload) {
        if (fired) return;
        fired = true;
        off(event, wrapped);
        try { return fn(payload); }
        catch (err) { console.error('[HookBus] once handler threw on', event, err); }
      };
      return on(event, wrapped, opts);
    }

    /* Wave V: cancellable wait — resolves on next emit of 'event'. Used by
     * reelEngine slam-stop pre-response path: await HookBus.waitFor('onSpinResult'). */
    function waitFor(event, timeoutMs) {
      /* Default timeout = no timeout (resolves only when emit lands).
       * Pass 0 or omit to wait indefinitely; pass positive ms to cap. */
      const useTimer = typeof timeoutMs === 'number' && timeoutMs > 0;
      return new Promise(function (resolve, reject) {
        let timer = null;
        const dispose = once(event, function (payload) {
          if (timer) clearTimeout(timer);
          resolve(payload);
        });
        if (useTimer) {
          timer = setTimeout(function () {
            dispose();
            reject(new Error('[HookBus] waitFor timeout: ' + event));
          }, timeoutMs);
        }
      });
    }

    return {
      on, off, once, emit, emitAsync, waitFor,
      getMult, setMult, addMult, resetMult, setMultBaseline,
      listenerCount,
      EVENTS,
    };
  })();

  if (typeof window !== 'undefined') {
    window.HookBus = HookBus;
    /* Always expose the current multiplier on window so QA harness +
     * playground inspectors can read it without poking HookBus.getMult(). */
    window.__HOOKBUS_MULT__ = HookBus.getMult();
  }
`;
}
