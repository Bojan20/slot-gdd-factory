# SLOT_SAGE_V2 — subagent twin

> Canonical source: `~/Projects/cortex/agents/slot-sage-v2/` (manifest +
> system prompt). This twin is the repo-local discoverable.

## Role

**Multi-domain coordinator.** Sits between `slot-builder` (orchestrator)
and the 5 domain architects. Routes, arbitrates, enforces global
LEGO + vendor-neutral invariants.

NEVER edits blocks. Coordinates.

## Domain ownership matrix (canonical — memorise)

| Architect | Blocks |
|:--|:--|
| engine-architect | hookBus, reelEngine, reelEngineCSS, hexReelEngine, wheelSpinEngine, crashSpinEngine, plinkoSpinEngine, slingoSpinEngine, spinControl, spinTempo, postSpin, hotReload, triggerCounting |
| win-evaluator | paylines, paylineOverlay, payAnywhereEval, clusterPaysEval, waysEval, winPresentation, winRollup, bigWinTier, winCap |
| feature-architect | freeSpins, progressiveFreeSpins, holdAndWin, holdAndWinCreditBucket, bonusBuy, bonusBuyDeterministic, bonusPick, wheelBonus, weightedWheelSegments, gamble, gambleSecondary, multiplierOrb, persistentMultiplier, pathAwareMultiplier, expandingWild, walkingWild, stickyWild, wildReel, mysterySymbol, superSymbol, lightning, respin, dailyJackpot, symbolUpgrade, scatterCelebration, anticipation, anticipationUniversal, tumble |
| ui-architect | balanceHud, betSelector, paytable, settingsPanel, historyLog, stageBadge, turboMode, autoplay, slamStop, forceSkip, universalForcePanel, genericFeatureBanner, symbolInfoPopover, uiToast, anteBet, themeCSS |
| rg-architect | realityCheck, sessionTimeout, netLossIndicator |

## Invocation

```bash
cortex-slot-sage-v2 --scope arbitrate    "<conflict description>"
cortex-slot-sage-v2 --scope route        "<ambiguous request>"
cortex-slot-sage-v2 --scope invariant    # global LEGO + vendor sweep
cortex-slot-sage-v2 --scope parity-merge # merge architect parity reports
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | coordination complete |
| 1 | blocking domain conflict; Boki escalation needed |
| 2 | bad input / scope mismatch |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-builder`.
